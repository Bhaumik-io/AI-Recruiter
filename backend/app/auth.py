"""
auth.py
Password hashing + JWT issuing/verification for two separate audiences:
HR users and candidates. Kept in one place so both the password-login
routes and the face-login route issue identically-shaped tokens.
"""

import os
import time
import uuid

from jose import jwt, JWTError
from passlib.context import CryptContext

SECRET_KEY = os.getenv("JWT_SECRET", "dev-secret-change-me-in-.env")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 60 * 60 * 12  # 12 hours

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_token(subject: str, role: str, extra: dict | None = None, expire_seconds: int | None = None) -> str:
    """role is 'hr', 'candidate', or 'candidate_pre_auth' (password verified,
    face verification still required before a full candidate token is issued)."""
    now = int(time.time())
    payload = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + (expire_seconds if expire_seconds is not None else ACCESS_TOKEN_EXPIRE_SECONDS),
        "jti": str(uuid.uuid4()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise ValueError(f"Invalid or expired token: {e}")
