"""
auth_router.py
- HR: email/password signup + login.
- Candidate: two-factor. Password (or signup) verifies identity and
  returns a short-lived PRE-AUTH token (role=candidate_pre_auth). That
  token only unlocks /auth/face/enroll (signup path, first time only)
  or /auth/face/verify (login path) — either of those, on success,
  exchanges it for a real candidate token. A password alone, or a face
  alone, is never enough to reach the interview.

Face design (important — read before changing):
The BROWSER computes the 128-d face descriptor client-side with
face-api.js and sends only that float array here — never raw images or
video frames. This keeps biometric raw data off the server entirely.
Verification is 1:1 (this candidate's own enrolled descriptor only) —
not a 1:N identification scan — since by the time we check the face we
already know who's claiming to log in from their password step.
"""

import hmac
import math
import os
import secrets
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from app.auth import create_token, hash_password, verify_password
from app.core import invite_storage, storage
from app.core.ratelimit import client_ip, limit
from app.deps import require_candidate_pre_auth

router = APIRouter(prefix="/auth", tags=["auth"])

FACE_MATCH_THRESHOLD = 0.5  # lower = stricter. face-api.js descriptors: <0.5 is a solid same-person match, ~0.6 is the usual cutoff, we go tighter to reduce false accepts.
PRE_AUTH_EXPIRE_SECONDS = 60 * 10  # 10 minutes to complete face enroll/verify after password step

# One-click "Continue as Guest HR" — no signup form, no real credentials.
# This trades verification for convenience (demos, quick testing), so it's
# gated behind an env var you can flip off before a real deployment.
HR_QUICK_LOGIN_ENABLED = os.getenv("HR_QUICK_LOGIN_ENABLED", "false").lower() == "true"  # keep OFF: it lets anyone in
QUICK_LOGIN_EXPIRE_SECONDS = 60 * 60 * 2  # 2h — shorter-lived than a normal 12h HR session


# ---------------------------------------------------------------------------
# HR auth
# ---------------------------------------------------------------------------

# ===========================================================================
# >>> SET THE ONLY HR LOGIN HERE <<<
# Only this ID + password can sign up / log in as HR. Everyone else is
# rejected. Best: put them in backend/.env (HR_ADMIN_ID / HR_ADMIN_PASSWORD)
# instead of the code. Restart the backend after changing them.
# ===========================================================================
HR_ADMIN_ID = os.getenv("HR_ADMIN_ID", "CHANGE_ME_ID").strip()
HR_ADMIN_PASSWORD = os.getenv("HR_ADMIN_PASSWORD", "CHANGE_ME_PASSWORD")

# brute-force guard: 5 wrong tries from one IP -> locked for 5 minutes
_MAX_FAILS, _LOCK_SECONDS = 5, 300
_fails: dict[str, list] = {}  # ip -> [count, locked_until]


def _hr_credentials_ok(uid: str, password: str) -> bool:
    if HR_ADMIN_ID.startswith("CHANGE_ME") or HR_ADMIN_PASSWORD.startswith("CHANGE_ME"):
        raise HTTPException(503, "HR login is not configured. Set HR_ADMIN_ID and HR_ADMIN_PASSWORD in backend/.env")
    a = hmac.compare_digest(uid.strip().lower().encode(), HR_ADMIN_ID.lower().encode())
    b = hmac.compare_digest(password.encode(), HR_ADMIN_PASSWORD.encode())
    return a and b


def _check_hr(request: Request, uid: str, password: str):
    ip = client_ip(request)
    rec = _fails.get(ip, [0, 0])
    if rec[1] > time.time():
        raise HTTPException(429, "Too many wrong attempts. Try again in a few minutes.")
    if not _hr_credentials_ok(uid, password):
        rec = [rec[0] + 1, 0]
        if rec[0] >= _MAX_FAILS:
            rec = [0, time.time() + _LOCK_SECONDS]
        _fails[ip] = rec
        raise HTTPException(401, "Invalid ID or password")
    _fails.pop(ip, None)


def _hr_session():
    """Get (or create once) the single HR account and issue its token."""
    user = storage.get_hr_user_by_email(HR_ADMIN_ID)
    if not user:
        user_id = str(uuid.uuid4())
        storage.create_hr_user(user_id, HR_ADMIN_ID, hash_password(secrets.token_urlsafe(16)), "HR")
        user = {"id": user_id, "email": HR_ADMIN_ID, "name": "HR"}
    token = create_token(user["id"], "hr", {"email": user["email"], "name": user.get("name", "HR")})
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user.get("name", "HR")}}


class HRSignup(BaseModel):
    email: str  # this is the HR "ID" (any text, not necessarily an email)
    password: str
    name: str = ""


class HRLogin(BaseModel):
    email: str
    password: str


@router.post("/hr/signup")
def hr_signup(body: HRSignup, request: Request):
    _check_hr(request, body.email, body.password)  # only the configured ID/password gets in
    return _hr_session()


@router.post("/hr/login")
def hr_login(body: HRLogin, request: Request):
    _check_hr(request, body.email, body.password)
    return _hr_session()


@router.post("/hr/quick-login")
def hr_quick_login():
    """One-click 'Continue as Guest HR' — no form, no password. Spins up a
    throwaway HR account on the spot and returns a real HR token straight
    away. Meant for demos and quick local testing, not for real recruiters.

    Unauthenticated account creation is inherently open — anyone who can
    reach this route becomes HR. Set HR_QUICK_LOGIN_ENABLED=false before
    any real deployment.
    """
    if not HR_QUICK_LOGIN_ENABLED:
        raise HTTPException(403, "Quick login is disabled")

    user_id = str(uuid.uuid4())
    tag = secrets.token_hex(4)
    email = f"guest-{tag}@temp.local"
    name = f"Guest HR {tag}"
    # Random, never-shown password — this account is only ever reached via
    # its token, but create_hr_user still needs a hash to store.
    storage.create_hr_user(user_id, email, hash_password(secrets.token_urlsafe(16)), name, is_temp=True)

    token = create_token(user_id, "hr", {"email": email, "name": name, "temp": True}, expire_seconds=QUICK_LOGIN_EXPIRE_SECONDS)
    return {"token": token, "user": {"id": user_id, "email": email, "name": name, "temp": True}}


# ---------------------------------------------------------------------------
# Candidate auth — step 1: password (signup or login) -> pre-auth token
# ---------------------------------------------------------------------------

class CandidateSignup(BaseModel):
    candidate_id: str  # must already exist from resume upload / interview invite
    email: EmailStr
    password: str


class CandidateLogin(BaseModel):
    email: EmailStr
    password: str


def _exam_student_signup(body: CandidateSignup, invite: dict):
    """Sign-up for MST students: the box on the form holds the access code HR
    sent them. The student's id is the invite id (INV_...), so no resume /
    candidate record is needed. The code is only burned once face enrollment
    succeeds (see face_enroll), so a failed camera step can be retried."""
    try:
        invite_storage.validate_invite(invite["code"], body.email)
    except ValueError as e:
        raise HTTPException(400, str(e))

    candidate_id = invite["invite_id"]
    existing = storage.get_candidate_auth_by_email(body.email)
    if existing and existing.get("id") != candidate_id:
        raise HTTPException(400, "An account with this email already exists")
    row = storage.get_candidate_auth(candidate_id)
    if row and row.get("face_descriptor"):
        raise HTTPException(400, "This code has already been used to create an account")

    storage.upsert_candidate_auth(
        candidate_id, email=body.email.lower(), password_hash=hash_password(body.password)
    )
    token = create_token(candidate_id, "candidate_pre_auth", expire_seconds=PRE_AUTH_EXPIRE_SECONDS)
    return {"token": token, "candidate_id": candidate_id, "face_enrolled": False}


_COMMON_PASSWORDS = {
    "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890",
    "qwerty123", "qwertyuiop", "iloveyou", "admin123", "welcome1", "abc12345", "11111111",
    "00000000", "student123", "college123", "india123", "letmein123",
}


def _check_password(pw: str, email: str = "") -> None:
    if len(pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if pw.isdigit() or pw.isalpha() or len(set(pw)) < 4:
        raise HTTPException(400, "Use a mix of letters and numbers in your password")
    low = pw.lower()
    if low in _COMMON_PASSWORDS or (email and low == email.split("@")[0].lower()):
        raise HTTPException(400, "That password is too easy to guess. Choose a different one")


@router.post("/candidate/signup")
def candidate_signup(body: CandidateSignup, request: Request):
    # a whole classroom shares one public IP, so the per-IP caps are generous; the per-code / per-email caps do the real work
    limit(f"signup-ip:{client_ip(request)}", 300, 600, "Too many sign-up attempts. Wait a few minutes.")
    limit(f"signup-code:{body.candidate_id.strip().upper()}", 10, 600, "Too many tries with this code. Wait 10 minutes.")
    _check_password(body.password, body.email)
    # An MST access code in the ID box? Use the exam sign-up path.
    invite = invite_storage.invites.find_one(
        {"code": body.candidate_id.strip().upper()}, invite_storage.NO_ID
    )
    if invite:
        return _exam_student_signup(body, invite)

    candidate = storage.get_candidate(body.candidate_id)
    if not candidate:
        raise HTTPException(404, "Unknown access code or candidate ID — ask HR for yours")

    existing = storage.get_candidate_auth_by_email(body.email)
    if existing:
        if existing.get("face_descriptor"):
            # Face enrollment actually completed — this is a real, finished
            # account. Don't let signup silently take it over.
            raise HTTPException(400, "An account with this email already exists")
        if existing.get("id") and existing["id"] != body.candidate_id:
            # Email is tied to a different candidate's in-progress signup.
            raise HTTPException(400, "An account with this email already exists")
        # Otherwise: same candidate started signup before but never finished
        # face enrollment (camera failed, they backed out, etc.). Let them
        # redo step 1 — this just refreshes the password hash and issues a
        # fresh pre-auth token so they can retry face enroll.

    storage.upsert_candidate_auth(
        body.candidate_id, email=body.email.lower(), password_hash=hash_password(body.password)
    )
    # Not a full token yet — face enrollment is mandatory before the
    # candidate can reach anything else.
    token = create_token(body.candidate_id, "candidate_pre_auth", expire_seconds=PRE_AUTH_EXPIRE_SECONDS)
    return {"token": token, "candidate_id": body.candidate_id, "face_enrolled": False}


@router.post("/candidate/login")
def candidate_login(body: CandidateLogin, request: Request):
    ip = client_ip(request)
    limit(f"login-ip:{ip}", 400, 300, "Too many login attempts. Wait a few minutes.")
    limit(f"login-email:{body.email.lower()}", 8, 300, "Too many attempts for this account. Wait 5 minutes.")
    auth_row = storage.get_candidate_auth_by_email(body.email)
    if not auth_row or not auth_row.get("password_hash") or not verify_password(
        body.password, auth_row["password_hash"]
    ):
        raise HTTPException(401, "Invalid email or password")
    candidate_id = auth_row["id"]
    face_enrolled = bool(auth_row.get("face_descriptor"))
    token = create_token(candidate_id, "candidate_pre_auth", expire_seconds=PRE_AUTH_EXPIRE_SECONDS)
    return {"token": token, "candidate_id": candidate_id, "face_enrolled": face_enrolled}


# ---------------------------------------------------------------------------
# Candidate auth — step 2: face enroll (signup, one-time) / face verify
# (login, every time) -> exchanges the pre-auth token for a real one
# ---------------------------------------------------------------------------

class FaceEnroll(BaseModel):
    candidate_id: str
    descriptor: list[float]  # 128-d face-api.js descriptor


class FaceVerify(BaseModel):
    candidate_id: str
    descriptor: list[float]


def _euclidean(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


@router.post("/face/enroll")
def face_enroll(body: FaceEnroll, token=Depends(require_candidate_pre_auth)):
    if token["sub"] != body.candidate_id:
        raise HTTPException(403, "You can only enroll your own face")
    exam_invite = invite_storage.invites.find_one({"invite_id": body.candidate_id}, invite_storage.NO_ID)
    if not exam_invite and not storage.get_candidate(body.candidate_id):
        raise HTTPException(404, "Unknown candidate_id")
    if len(body.descriptor) != 128:
        raise HTTPException(400, "Expected a 128-length face descriptor from face-api.js")
    import json as _json
    import datetime as _dt
    storage.upsert_candidate_auth(
        body.candidate_id,
        face_descriptor=_json.dumps(body.descriptor),
        face_enrolled_at=_dt.datetime.utcnow().isoformat(),
    )
    if exam_invite:
        invite_storage.mark_invite_used(exam_invite["code"], body.candidate_id)  # burn the access code
    # Enrollment doubles as the first login — hand over the real token now.
    real_token = create_token(body.candidate_id, "candidate")
    return {"status": "enrolled", "candidate_id": body.candidate_id, "token": real_token}


@router.post("/face/verify")
def face_verify(body: FaceVerify, token=Depends(require_candidate_pre_auth)):
    if token["sub"] != body.candidate_id:
        raise HTTPException(403, "You can only verify your own face")
    if len(body.descriptor) != 128:
        raise HTTPException(400, "Expected a 128-length face descriptor from face-api.js")

    auth_row = storage.get_candidate_auth(body.candidate_id)
    enrolled = auth_row.get("face_descriptor") if auth_row else None
    if not enrolled:
        raise HTTPException(400, "No face enrolled for this account yet")

    import json as _json
    dist = _euclidean(body.descriptor, _json.loads(enrolled))
    if dist > FACE_MATCH_THRESHOLD:
        raise HTTPException(401, "Face not recognized. Make sure you're well-lit and try again.")

    real_token = create_token(body.candidate_id, "candidate")
    return {"token": real_token, "candidate_id": body.candidate_id, "confidence": round(1 - dist, 3)}
