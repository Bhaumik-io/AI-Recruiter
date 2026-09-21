"""
dev_router.py
TESTING-ONLY endpoint to wipe all app data in one call, so the flow
(HR signup -> shortlist -> candidate signup -> face enroll -> interview)
can be re-run from scratch without manually touching MongoDB.
No auth on purpose, since resetting is also needed from logged-out
screens (candidate/HR login pages). Gated behind DEV_RESET_ENABLED —
defaults to true for local dev, but set it to false (or remove the
include_router() call in main.py entirely) before any real deployment,
since an unauthenticated data-wipe endpoint on a public URL is a real
risk, not just a theoretical one.
"""
import os

from fastapi import APIRouter, HTTPException
from app.core.storage import get_db

router = APIRouter(prefix="/dev", tags=["dev"])

DEV_RESET_ENABLED = os.getenv("DEV_RESET_ENABLED", "true").lower() == "true"


@router.post("/reset-all")
def reset_all():
    if not DEV_RESET_ENABLED:
        raise HTTPException(403, "Dev reset is disabled on this deployment")
    db = get_db()
    for name in ["candidates", "hr_users", "candidate_auth", "feedback", "proctoring_events", "settings"]:
        db[name].delete_many({})
    return {"status": "ok", "message": "All data wiped"}