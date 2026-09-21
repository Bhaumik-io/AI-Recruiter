"""
candidates_router.py
HR-facing endpoints: upload resumes, rank against a JD, list/shortlist
candidates. Mirrors the old Streamlit HR Dashboard page 1:1 in behavior,
just as REST endpoints instead of a top-to-bottom script rerun.
"""

import io
import uuid

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.resume_parser import extract_text, extract_email
from app.core.ranking import rank_candidates
from app.core import storage, mailer
from app.deps import require_hr

router = APIRouter(prefix="/candidates", tags=["candidates"])


@router.post("/upload")
async def upload_resumes(
    files: list[UploadFile] = File(...),
    jd_text: str = Form(...),
    _hr=Depends(require_hr),
):
    if not jd_text.strip():
        raise HTTPException(400, "Job description is required")

    new_candidates = {}
    for f in files:
        raw = await f.read()
        candidate_id = f"CAND_{uuid.uuid4().hex[:8].upper()}"
        try:
            resume_text = extract_text(io.BytesIO(raw))
        except Exception as e:
            resume_text = ""
            print(f"Error parsing {f.filename}: {e}")
        new_candidates[candidate_id] = {
            "filename": f.filename,
            "resume_text": resume_text,
            "contact_email": extract_email(resume_text),
        }

    storage.add_candidates(new_candidates)

    previous_jd = storage.get_setting("jd_text", "")
    jd_changed = previous_jd != jd_text
    storage.set_setting("jd_text", jd_text)

    all_candidates = storage.load_candidates()
    if jd_changed:
        to_rank = all_candidates
    else:
        to_rank = {cid: d for cid, d in all_candidates.items() if d.get("resume_score") is None}

    if to_rank:
        ranked = rank_candidates(to_rank, jd_text)
        for r in ranked:
            storage.update_candidate(r["candidate_id"], {
                "resume_score": r["score"],
                "rank_reason": r["reason"],
            })

    return {"uploaded": len(new_candidates), "ranked": len(to_rank)}


@router.get("")
def list_candidates(_hr=Depends(require_hr)):
    candidates = storage.load_candidates()
    jd_text = storage.get_setting("jd_text", "")
    out = []
    for cid, data in candidates.items():
        proctoring = storage.get_proctoring_summary(cid)
        out.append({
            "candidate_id": cid,
            "filename": data.get("filename"),
            "contact_email": data.get("contact_email"),
            "invite_sent_at": data.get("invite_sent_at"),
            "resume_score": data.get("resume_score"),
            "rank_reason": data.get("rank_reason"),
            "shortlisted": data.get("shortlisted", False),
            "interview_score": data.get("interview_score"),
            "completed_at": data.get("completed_at"),
            "conference_status": data.get("conference_status"),
            "conference_scheduled_at": data.get("conference_scheduled_at"),
            "conference_room_id": data.get("conference_room_id"),
            "proctoring_flags": {"warning": proctoring["warning"], "high": proctoring["high"]},
            "interview_terminated": data.get("interview_terminated", False),
            "termination_reason": data.get("termination_reason"),
            "cheat_warning_count": proctoring["cheat_warning_count"],
            "max_cheat_warnings": proctoring["max_cheat_warnings"],
        })
    return {"candidates": out, "jd_text": jd_text}


@router.get("/{candidate_id}")
def get_candidate_detail(candidate_id: str, _hr=Depends(require_hr)):
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    candidate["proctoring"] = storage.get_proctoring_summary(candidate_id)
    candidate["feedback"] = storage.get_feedback_for_candidate(candidate_id)
    return candidate


class SetEmail(BaseModel):
    email: EmailStr


@router.put("/{candidate_id}/email")
def set_candidate_email(candidate_id: str, body: SetEmail, _hr=Depends(require_hr)):
    """Correct/add the resume-extracted email — the regex extractor in
    resume_parser.py is best-effort and can miss or misfire."""
    if not storage.get_candidate(candidate_id):
        raise HTTPException(404, "Candidate not found")
    storage.update_candidate(candidate_id, {"contact_email": body.email})
    return {"candidate_id": candidate_id, "contact_email": body.email}


@router.post("/{candidate_id}/shortlist")
def shortlist_candidate(candidate_id: str, shortlisted: bool = True, _hr=Depends(require_hr)):
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    storage.update_candidate(candidate_id, {"shortlisted": shortlisted})

    email_result = None
    if shortlisted and not candidate.get("invite_sent_at"):
        # Only auto-send the FIRST time a candidate is shortlisted, so
        # toggling shortlist off/on again doesn't spam them with repeat
        # emails — use POST /{candidate_id}/send-invite to resend on purpose.
        email_result = _send_invite(candidate_id, candidate.get("contact_email"))

    return {"candidate_id": candidate_id, "shortlisted": shortlisted, "invite_email": email_result}


@router.post("/{candidate_id}/send-invite")
def send_invite(candidate_id: str, _hr=Depends(require_hr)):
    """Manually (re)send the candidate-ID email — for a first send that
    failed, a corrected email address, or just resending on request."""
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    return _send_invite(candidate_id, candidate.get("contact_email"))


def _send_invite(candidate_id: str, contact_email: str | None):
    if not contact_email:
        return {"status": "skipped", "reason": "No email on file for this candidate — add one first."}
    try:
        mailer.send_shortlist_email(contact_email, candidate_id)
    except mailer.MailNotConfigured as e:
        return {"status": "not_configured", "reason": str(e)}
    except mailer.MailSendError as e:
        return {"status": "failed", "reason": str(e)}
    storage.update_candidate(candidate_id, {"invite_sent_at": storage._now_iso()})
    return {"status": "sent", "to": contact_email}
