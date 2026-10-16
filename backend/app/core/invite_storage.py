"""MongoDB collections for the Exam module (student invites / access codes).

Builds on exam_storage.py, so no existing file needs editing.
"""
from pymongo import ASCENDING

from app.core.exam_storage import NO_ID, db, new_id, now  # noqa: F401  (re-exported)

invite_batches = db["exam_invite_batches"]
invites = db["exam_invites"]

invites.create_index([("code", ASCENDING)], unique=True)
invites.create_index([("batch_id", ASCENDING)])


# ---- helpers for the candidate sign-up flow (wire these in auth_router) ----
def validate_invite(code: str, email: str | None = None) -> dict:
    """Return the invite if the code is usable, else raise ValueError with a
    message that is safe to show the student."""
    inv = invites.find_one({"code": (code or "").strip().upper()}, NO_ID)
    if not inv:
        raise ValueError("Invalid access code")
    if inv.get("used"):
        raise ValueError("This access code has already been used")
    # if the code was emailed, it only works for that email address
    if email and inv.get("channel") == "email" and inv.get("email"):
        if inv["email"] != email.strip().lower():
            raise ValueError("This code was sent to a different email address")
    return inv


def mark_invite_used(code: str, candidate_id: str) -> None:
    invites.update_one(
        {"code": (code or "").strip().upper()},
        {"$set": {"used": True, "used_by": candidate_id, "used_at": now()}},
    )
