"""
conference_router.py
Post-interview "Conference with Candidate" flow:
  1. HR reviews completed interviews (filterable/sortable) and confirms
     selection for one, choosing a date/time (defaults to 2 hours after
     the interview was submitted, editable in the dashboard).
  2. That sends a selection-confirmation email with a link to a shared
     video-conference room.
  3. Both HR and the candidate log in as normal (candidate: same
     password + face verification as their interview) and open the
     room link. The candidate sees a waiting screen; HR holds the only
     "Start" control. HR can also end the call.
  4. HR can reschedule or cancel before the call happens — either
     re-sends an updated email.

The actual video call is peer-to-peer WebRTC (exactly two participants,
so no media server is needed) — this router only relays signaling
messages (SDP offers/answers, ICE candidates) between the HR and
candidate sockets in a room, plus a couple of control messages
("start", "end"). No video/audio ever passes through the backend.

Room state lives in memory (a plain dict keyed by room_id) rather than
Mongo, since it's ephemeral, per-process, real-time connection state,
not durable data — restarting the backend simply ends any live calls,
which is an acceptable tradeoff for a single-process deployment.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.auth import decode_token
from app.core import storage, mailer
from app.deps import require_hr

router = APIRouter(prefix="/conference", tags=["conference"])


# ---------------------------------------------------------------------------
# HR-side: list completed interviews, filterable/sortable
# ---------------------------------------------------------------------------

@router.get("/candidates")
def list_conference_candidates(
    sort: str = "score_desc",       # score_desc (default) | score_asc
    limit: str = "all",             # "10" | "50" | "all"
    cheating_only: bool = False,
    _hr=Depends(require_hr),
):
    candidates = storage.load_candidates()
    out = []
    for cid, data in candidates.items():
        if data.get("interview_score") is None:
            continue  # only completed interviews belong on this tab
        proctoring = storage.get_proctoring_summary(cid)
        is_flagged = proctoring["cheat_warning_count"] > 0 or data.get("interview_terminated", False)
        if cheating_only and not is_flagged:
            continue
        out.append({
            "candidate_id": cid,
            "filename": data.get("filename"),
            "contact_email": data.get("contact_email"),
            "interview_score": data.get("interview_score"),
            "completed_at": data.get("completed_at"),
            "interview_terminated": data.get("interview_terminated", False),
            "termination_reason": data.get("termination_reason"),
            "cheat_warning_count": proctoring["cheat_warning_count"],
            "conference_status": data.get("conference_status"),
            "conference_scheduled_at": data.get("conference_scheduled_at"),
            "conference_room_id": data.get("conference_room_id"),
        })

    reverse = sort != "score_asc"
    out.sort(key=lambda c: c["interview_score"] or 0, reverse=reverse)

    if limit not in ("all", "", None):
        try:
            n = int(limit)
            out = out[:n]
        except ValueError:
            pass

    return {"candidates": out}


# ---------------------------------------------------------------------------
# HR-side: confirm / reschedule / cancel / resend
# ---------------------------------------------------------------------------

class ScheduleBody(BaseModel):
    scheduled_at: str   # ISO datetime string, from a <input type="datetime-local">
    scheduled_at_display: str | None = None  # human-readable version for the email body


def _default_scheduled_at(candidate: dict) -> str:
    """2 hours after interview submission — used as a fallback only; the
    dashboard is expected to send an explicit (possibly HR-edited) value."""
    completed_at = candidate.get("completed_at")
    base = datetime.now(timezone.utc)
    if completed_at:
        try:
            base = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        except ValueError:
            pass
    return (base + timedelta(hours=2)).isoformat()


def _join_url(room_id: str) -> str:
    return mailer._frontend_origin() + f"/conference/{room_id}"


@router.post("/{candidate_id}/confirm")
def confirm_selection(candidate_id: str, body: ScheduleBody, _hr=Depends(require_hr)):
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate.get("interview_score") is None:
        raise HTTPException(400, "This candidate hasn't completed an interview yet")

    room_id = candidate.get("conference_room_id") or uuid.uuid4().hex[:12]
    scheduled_at = body.scheduled_at or _default_scheduled_at(candidate)
    storage.update_candidate(candidate_id, {
        "conference_room_id": room_id,
        "conference_status": "scheduled",
        "conference_scheduled_at": scheduled_at,
    })

    email_result = _send_conference_email(
        candidate_id, "confirm",
        scheduled_at_display=body.scheduled_at_display or scheduled_at,
        join_url=_join_url(room_id),
    )
    return {"candidate_id": candidate_id, "room_id": room_id, "conference_status": "scheduled", "email": email_result}


@router.post("/{candidate_id}/reschedule")
def reschedule_conference(candidate_id: str, body: ScheduleBody, _hr=Depends(require_hr)):
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    room_id = candidate.get("conference_room_id")
    if not room_id:
        raise HTTPException(400, "No conference has been scheduled for this candidate yet")

    storage.update_candidate(candidate_id, {
        "conference_status": "scheduled",
        "conference_scheduled_at": body.scheduled_at,
    })
    email_result = _send_conference_email(
        candidate_id, "reschedule",
        scheduled_at_display=body.scheduled_at_display or body.scheduled_at,
        join_url=_join_url(room_id),
    )
    return {"candidate_id": candidate_id, "conference_status": "scheduled", "email": email_result}


class CancelBody(BaseModel):
    reason: str | None = None


@router.post("/{candidate_id}/cancel")
def cancel_conference(candidate_id: str, body: CancelBody, _hr=Depends(require_hr)):
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if not candidate.get("conference_room_id"):
        raise HTTPException(400, "No conference has been scheduled for this candidate yet")

    storage.update_candidate(candidate_id, {"conference_status": "cancelled"})
    room = _rooms.get(candidate["conference_room_id"])
    if room:
        room["started"] = False

    email_result = _send_conference_email(candidate_id, "cancel", reason=body.reason or "")
    return {"candidate_id": candidate_id, "conference_status": "cancelled", "email": email_result}


@router.post("/{candidate_id}/resend")
def resend_conference_email(candidate_id: str, _hr=Depends(require_hr)):
    """Resend the CURRENT scheduled email as-is — for when the address
    was just corrected, or the first send failed."""
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    room_id = candidate.get("conference_room_id")
    status = candidate.get("conference_status")
    if not room_id or status != "scheduled":
        raise HTTPException(400, "No active scheduled conference to resend for this candidate")

    email_result = _send_conference_email(
        candidate_id, "confirm",
        scheduled_at_display=candidate.get("conference_scheduled_at"),
        join_url=_join_url(room_id),
    )
    return {"candidate_id": candidate_id, "email": email_result}


def _send_conference_email(candidate_id: str, kind: str, scheduled_at_display: str = "", join_url: str = "", reason: str = ""):
    candidate = storage.get_candidate(candidate_id)
    contact_email = candidate.get("contact_email") if candidate else None
    if not contact_email:
        return {"status": "skipped", "reason": "No email on file for this candidate — add one first."}
    try:
        if kind == "confirm":
            mailer.send_selection_confirmation_email(contact_email, candidate_id, scheduled_at_display, join_url)
        elif kind == "reschedule":
            mailer.send_conference_rescheduled_email(contact_email, candidate_id, scheduled_at_display, join_url)
        elif kind == "cancel":
            mailer.send_conference_cancelled_email(contact_email, candidate_id, reason)
    except mailer.MailNotConfigured as e:
        return {"status": "not_configured", "reason": str(e)}
    except mailer.MailSendError as e:
        return {"status": "failed", "reason": str(e)}
    return {"status": "sent", "to": contact_email}


# ---------------------------------------------------------------------------
# Room info — either HR (any) or the specific candidate for that room
# ---------------------------------------------------------------------------

def _candidate_for_room(room_id: str):
    candidates = storage.load_candidates()
    for cid, data in candidates.items():
        if data.get("conference_room_id") == room_id:
            return cid, data
    return None, None


@router.get("/room/{room_id}")
def room_info(room_id: str, token: str):
    """token passed as a query param (not a header) so this same helper
    shape can be reused by the frontend before the WebSocket connects."""
    try:
        payload = decode_token(token)
    except ValueError as e:
        raise HTTPException(401, str(e))

    candidate_id, candidate = _candidate_for_room(room_id)
    if not candidate:
        raise HTTPException(404, "Conference room not found")

    role = payload.get("role")
    if role == "hr":
        is_hr = True
    elif role == "candidate" and payload.get("sub") == candidate_id:
        is_hr = False
    else:
        raise HTTPException(403, "You don't have access to this conference room")

    room = _rooms.get(room_id, {})
    return {
        "room_id": room_id,
        "candidate_id": candidate_id,
        "candidate_label": candidate.get("filename") or candidate_id,
        "conference_status": candidate.get("conference_status"),
        "conference_scheduled_at": candidate.get("conference_scheduled_at"),
        "is_hr": is_hr,
        "started": bool(room.get("started")),
    }


# ---------------------------------------------------------------------------
# WebSocket signaling relay — exactly two seats per room: "hr" and
# "candidate". Whatever one side sends is relayed verbatim to the other,
# except SDP/ICE messages are only relayed once the room has been
# started by HR — this enforces the "candidate waits, HR controls start"
# rule server-side, not just in the UI.
# ---------------------------------------------------------------------------

_rooms: dict[str, dict] = {}  # room_id -> {"started": bool, "sockets": {"hr": ws|None, "candidate": ws|None}}

_SIGNAL_TYPES = {"offer", "answer", "ice-candidate"}


def _get_room(room_id: str) -> dict:
    return _rooms.setdefault(room_id, {"started": False, "sockets": {"hr": None, "candidate": None}})


@router.websocket("/room/{room_id}/ws")
async def conference_ws(websocket: WebSocket, room_id: str, token: str):
    try:
        payload = decode_token(token)
    except ValueError:
        await websocket.close(code=4401)
        return

    candidate_id, candidate = _candidate_for_room(room_id)
    if not candidate:
        await websocket.close(code=4404)
        return

    role = payload.get("role")
    if role == "hr":
        seat = "hr"
    elif role == "candidate" and payload.get("sub") == candidate_id:
        seat = "candidate"
    else:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    room = _get_room(room_id)
    room["sockets"][seat] = websocket
    other_seat = "candidate" if seat == "hr" else "hr"

    async def notify_other(message: dict):
        other = room["sockets"].get(other_seat)
        if other:
            try:
                await other.send_json(message)
            except Exception:
                pass

    await notify_other({"type": "peer-joined", "seat": seat})
    if room["started"]:
        await websocket.send_json({"type": "room-started"})

    try:
        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")

            if mtype == "start" and seat == "hr":
                room["started"] = True
                storage.update_candidate(candidate_id, {"conference_status": "in_progress"})
                await notify_other({"type": "room-started"})

            elif mtype == "end" and seat == "hr":
                room["started"] = False
                storage.update_candidate(candidate_id, {"conference_status": "completed"})
                await notify_other({"type": "room-ended"})

            elif mtype in _SIGNAL_TYPES:
                # Only relay actual call signaling once HR has started
                # the room — closes off the "just skip the waiting
                # screen" path on the client side.
                if room["started"]:
                    await notify_other(msg)

    except WebSocketDisconnect:
        room["sockets"][seat] = None
        await notify_other({"type": "peer-left", "seat": seat})
