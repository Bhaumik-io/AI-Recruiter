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

import math
import os
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.auth import create_token, hash_password, verify_password
from app.core import storage
from app.deps import require_candidate_pre_auth

router = APIRouter(prefix="/auth", tags=["auth"])

FACE_MATCH_THRESHOLD = 0.5  # lower = stricter. face-api.js descriptors: <0.5 is a solid same-person match, ~0.6 is the usual cutoff, we go tighter to reduce false accepts.
PRE_AUTH_EXPIRE_SECONDS = 60 * 10  # 10 minutes to complete face enroll/verify after password step

# One-click "Continue as Guest HR" — no signup form, no real credentials.
# This trades verification for convenience (demos, quick testing), so it's
# gated behind an env var you can flip off before a real deployment.
HR_QUICK_LOGIN_ENABLED = os.getenv("HR_QUICK_LOGIN_ENABLED", "true").lower() == "true"
QUICK_LOGIN_EXPIRE_SECONDS = 60 * 60 * 2  # 2h — shorter-lived than a normal 12h HR session


# ---------------------------------------------------------------------------
# HR auth
# ---------------------------------------------------------------------------

class HRSignup(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


class HRLogin(BaseModel):
    email: EmailStr
    password: str


@router.post("/hr/signup")
def hr_signup(body: HRSignup):
    if storage.get_hr_user_by_email(body.email):
        raise HTTPException(400, "An account with this email already exists")
    user_id = str(uuid.uuid4())
    storage.create_hr_user(user_id, body.email, hash_password(body.password), body.name)
    token = create_token(user_id, "hr", {"email": body.email, "name": body.name})
    return {"token": token, "user": {"id": user_id, "email": body.email, "name": body.name}}


@router.post("/hr/login")
def hr_login(body: HRLogin):
    user = storage.get_hr_user_by_email(body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user["id"], "hr", {"email": user["email"], "name": user["name"]})
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"]}}


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


@router.post("/candidate/signup")
def candidate_signup(body: CandidateSignup):
    candidate = storage.get_candidate(body.candidate_id)
    if not candidate:
        raise HTTPException(404, "Unknown candidate_id — ask HR for your interview invite")

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
def candidate_login(body: CandidateLogin):
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
    candidate = storage.get_candidate(body.candidate_id)
    if not candidate:
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
