from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.auth import decode_token

bearer_scheme = HTTPBearer(auto_error=False)


def _get_payload(creds: HTTPAuthorizationCredentials | None):
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        return decode_token(creds.credentials)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))


def require_hr(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    payload = _get_payload(creds)
    if payload.get("role") != "hr":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "HR access required")
    return payload


def require_candidate(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    payload = _get_payload(creds)
    if payload.get("role") != "candidate":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Candidate access required")
    return payload


def require_candidate_pre_auth(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    """Password has been verified but face verification is still pending —
    used only by the signup-enroll and login-verify steps."""
    payload = _get_payload(creds)
    if payload.get("role") != "candidate_pre_auth":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password verification required first")
    return payload
