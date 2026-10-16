"""Auth dependencies for the exam routes, built directly on app/core/auth.py
(decode_token). Rejects 'candidate_pre_auth' tokens, so a candidate who has
only passed the password step (face check pending) can't open the exam.
"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import decode_token # <-- adjust path if auth.py lives elsewhere

_bearer = HTTPBearer(auto_error=False)


def _payload(creds: HTTPAuthorizationCredentials | None, role: str) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        p = decode_token(creds.credentials)
    except ValueError as e:
        raise HTTPException(401, str(e))
    if p.get("role") != role:
        raise HTTPException(403, f"{role} access only")
    return p


def get_current_hr(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    return _payload(creds, "hr")


def get_current_candidate(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    p = _payload(creds, "candidate")
    # candidate id is the token subject unless an explicit claim exists
    p["candidate_id"] = p.get("candidate_id") or p["sub"]
    return p
