"""
proctoring_router.py
The React AntiCheatMonitor component runs face-api.js in the browser
during the interview and POSTs short event records here whenever
something suspicious happens (no face, multiple faces, tab blurred,
etc). We only ever receive small event labels — never video/images —
which keeps this endpoint cheap and keeps raw biometric data off the
server. HR reads back a rollup + timeline per candidate.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Literal

from app.core import storage
from app.deps import require_candidate, require_hr

router = APIRouter(prefix="/proctoring", tags=["proctoring"])

EventType = Literal[
    "no_face", "multiple_faces", "face_mismatch", "tab_blur", "window_blur",
    "looking_away", "fullscreen_exit", "copy_paste", "dev_tools_opened",
    "screen_share_stopped", "screen_share_not_full", "browser_close",
]

# Human-readable phrasing per event type, used to build the termination
# reason string shown to the candidate and handed back to HR.
_EVENT_LABELS = {
    "no_face": "camera showed no face",
    "multiple_faces": "multiple faces in frame",
    "face_mismatch": "face did not match the enrolled candidate",
    "tab_blur": "switched away from the interview tab",
    "window_blur": "switched to another application or window",
    "looking_away": "looking away from the screen for an extended period",
    "fullscreen_exit": "exited fullscreen",
    "copy_paste": "copy/paste activity",
    "dev_tools_opened": "developer tools opened",
    "screen_share_stopped": "stopped sharing their screen",
    "screen_share_not_full": "shared a window/tab instead of the full screen",
    "browser_close": "closed or reloaded the browser tab",
}


class ProctoringEvent(BaseModel):
    event_type: EventType
    severity: Literal["warning", "high"] = "warning"
    detail: str = ""


@router.post("/{candidate_id}/event")
def log_event(candidate_id: str, body: ProctoringEvent, token=Depends(require_candidate)):
    if token["sub"] != candidate_id:
        raise HTTPException(403, "You can only log events for your own interview")

    storage.log_proctoring_event(candidate_id, body.event_type, body.severity, body.detail)
    summary = storage.get_proctoring_summary(candidate_id)
    warning_count = summary["total"]

    terminated = summary["terminated"]
    reason = summary["termination_reason"]

    if not terminated and warning_count >= storage.MAX_CHEAT_WARNINGS:
        reason = (
            f"Cheating detected by candidate: {storage.MAX_CHEAT_WARNINGS} proctoring "
            f"warnings reached (most recent: {_EVENT_LABELS.get(body.event_type, body.event_type)}). "
            "Interview auto-ended."
        )
        storage.terminate_interview_for_cheating(candidate_id, reason)
        terminated = True

    return {
        "status": "logged",
        "warning_count": min(warning_count, storage.MAX_CHEAT_WARNINGS),
        "max_warnings": storage.MAX_CHEAT_WARNINGS,
        "terminated": terminated,
        "termination_reason": reason,
    }


@router.get("/{candidate_id}/summary")
def get_summary(candidate_id: str, _hr=Depends(require_hr)):
    return storage.get_proctoring_summary(candidate_id)
