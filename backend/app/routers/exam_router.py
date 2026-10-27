"""Exam module routes: syllabus upload -> paper generation -> edit/approve ->
candidate attempt -> Gemini scoring -> HR report.

Auth comes from exam_deps.py, which decodes your JWTs via app/core/auth.py.
"""
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.core import exam_storage as st
from app.core import gemini_exam_service as gem
from app.core import storage as app_storage  # the existing proctoring events live here
from app.routers.exam_deps import get_current_candidate, get_current_hr

try:  # student names / roll numbers come from the Exam module's invite lists
    from app.core import invite_storage
except ImportError:  # module not installed: reports just show ids
    invite_storage = None

router = APIRouter(prefix="/exam", tags=["exam"])

FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.5"))  # same as login
CHECK_VALID_SECONDS = 15 * 60  # a passed face check is good for 15 minutes
ONE_STUDENT_PER_DEVICE = os.getenv("ONE_STUDENT_PER_DEVICE", "true").lower() == "true"
GRACE_SECONDS = 60  # network slack when auto-submitting at the deadline


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts):
    if not ts:
        return None
    d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _norm(ts):
    """Validate an ISO time from HR and store it as UTC."""
    if not ts:
        return None
    try:
        return _parse(ts).astimezone(timezone.utc).isoformat()
    except ValueError:
        raise HTTPException(400, "Invalid exam start/end time")


def _phase(p: dict, now: datetime) -> str:
    ws, we = _parse(p.get("window_start")), _parse(p.get("window_end"))
    if ws and now < ws:
        return "waiting"
    if we and now >= we:
        return "closed"
    return "open"


def _deadline(p: dict, started_at: datetime) -> datetime:
    d = started_at + timedelta(minutes=p["duration_minutes"])
    we = _parse(p.get("window_end"))
    return min(d, we) if we else d


ALLOWED_MIME = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
MAX_FILE_BYTES = 15 * 1024 * 1024


# ---------------------------------------------------------------- models
class GenerateBody(BaseModel):
    syllabus_id: str
    prompt: str = Field(min_length=1, description='e.g. "go with chapters 4, 5 and 7"')
    duration_minutes: int = 60
    style: Literal["default", "scenario", "custom"] = "default"  # theory / scenario / HR's own prompt
    qtype: Literal["mcq", "fill", "descriptive", "mix"] = "mix"
    custom_prompt: str = ""


class QuestionIn(BaseModel):
    q_no: int
    chapter: int | None = None
    topic: str = ""
    type: str = "short"
    question: str
    marks: int = 1
    reference_answer: str = ""
    key_points: list[str] = []
    sources: list[dict] = []
    options: list[str] = []  # mcq only
    answer: str = ""  # mcq: correct letter A-D, fill: the missing word


class PaperUpdate(BaseModel):
    title: str
    duration_minutes: int = 60
    window_start: str | None = None  # ISO time; students can't start before this
    window_end: str | None = None  # ISO time; exam closes for everyone at this moment
    questions: list[QuestionIn]


class FaceCheckBody(BaseModel):
    descriptor: list[float]  # 128-d face-api.js descriptor, computed in the browser


class SaveBody(BaseModel):
    paper_id: str
    answers: dict[str, str]


class SubmitBody(BaseModel):
    paper_id: str
    answers: dict[str, str]  # {"1": "answer text", "2": "..."}


# ---------------------------------------------------------------- HR side
@router.post("/syllabus")
def upload_syllabus(files: list[UploadFile] = File(...), hr=Depends(get_current_hr)):
    if not files:
        raise HTTPException(400, "Upload at least one file")
    blobs = []
    for f in files:
        mime = f.content_type or ""
        if mime not in ALLOWED_MIME:
            raise HTTPException(400, f"{f.filename}: only PDF, PNG, JPG, WEBP are supported")
        data = f.file.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(400, f"{f.filename}: file too large (max 15 MB)")
        blobs.append((data, mime))
    try:
        parsed = gem.extract_syllabus(blobs)
    except Exception as e:
        raise HTTPException(502, f"Could not read syllabus: {e}")
    doc = {
        "syllabus_id": st.new_id("SYL"),
        "subject": parsed.get("subject", ""),
        "chapters": parsed.get("chapters", []),
        "raw_text": parsed.get("raw_text", ""),
        "created_at": st.now(),
    }
    st.syllabi.insert_one(dict(doc))
    doc.pop("raw_text")
    return doc


@router.post("/papers/generate")
def generate_paper(body: GenerateBody, hr=Depends(get_current_hr)):
    syl = st.syllabi.find_one({"syllabus_id": body.syllabus_id}, st.NO_ID)
    if not syl:
        raise HTTPException(404, "Syllabus not found")
    if body.style == "custom" and not body.custom_prompt.strip():
        raise HTTPException(400, "Type your instructions for the questions first")
    try:
        paper = gem.generate_paper(
            syl, body.prompt, body.duration_minutes, body.style, body.qtype, body.custom_prompt
        )
        # MCQ / fill-in questions already carry their answer; only written ones need references
        written = [q for q in paper["questions"] if q["type"] not in ("mcq", "fill")]
        refs = gem.build_references(syl.get("subject", ""), written) if written else {}
    except Exception as e:
        raise HTTPException(502, f"Generation failed: {e}")
    for q in paper["questions"]:
        if q["type"] in ("mcq", "fill"):
            q["reference_answer"] = _objective_reference(q)
            q["key_points"], q["sources"] = [], []
            continue
        r = refs.get(q["q_no"], {})
        q["reference_answer"] = r.get("reference_answer", "")
        q["key_points"] = r.get("key_points", [])
        q["sources"] = r.get("sources", [])
    doc = {
        "paper_id": st.new_id("PAPER"),
        "syllabus_id": body.syllabus_id,
        "subject": syl.get("subject", ""),
        "title": paper.get("title", "Sample Paper"),
        "chapters_covered": paper.get("chapters_covered", []),
        "duration_minutes": body.duration_minutes,
        "questions": paper["questions"],
        "status": "draft",  # draft -> approved
        "is_active": False,
        "created_at": st.now(),
    }
    st.papers.insert_one(dict(doc))
    return doc


@router.get("/papers")
def list_papers(hr=Depends(get_current_hr)):
    rows = st.papers.find({}, {**st.NO_ID, "questions": 0}).sort("created_at", -1)
    return list(rows)


@router.get("/papers/{paper_id}")
def get_paper(paper_id: str, hr=Depends(get_current_hr)):
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    return p


@router.put("/papers/{paper_id}")
def update_paper(paper_id: str, body: PaperUpdate, hr=Depends(get_current_hr)):
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    if p["status"] != "draft":
        raise HTTPException(409, "Approved papers can't be edited")
    qs = [q.model_dump() for q in body.questions]
    for i, q in enumerate(qs, start=1):
        q["q_no"] = i
        if q["type"] in ("mcq", "fill"):  # keep the stored reference in step with HR's edits
            q["reference_answer"] = _objective_reference(q)
    ws, we = _norm(body.window_start), _norm(body.window_end)
    if ws and we and _parse(we) <= _parse(ws):
        raise HTTPException(400, "Exam end time must be after the start time")
    st.papers.update_one(
        {"paper_id": paper_id},
        {"$set": {"title": body.title, "duration_minutes": body.duration_minutes, "questions": qs,
                  "window_start": ws, "window_end": we}},
    )
    return st.papers.find_one({"paper_id": paper_id}, st.NO_ID)


@router.post("/papers/{paper_id}/approve")
def approve_paper(paper_id: str, hr=Depends(get_current_hr)):
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    if not p["questions"]:
        raise HTTPException(400, "Paper has no questions")
    we = _parse(p.get("window_end"))
    if we and we <= _utcnow():
        raise HTTPException(400, "The exam end time has already passed. Pick a new time window.")
    # only one live paper at a time: every student gets the same one
    st.papers.update_many({"is_active": True}, {"$set": {"is_active": False}})
    st.papers.update_one(
        {"paper_id": paper_id},
        {"$set": {"status": "approved", "is_active": True, "approved_at": st.now()}},
    )
    pruned = _prune_history()
    return {"ok": True, "paper_id": paper_id, "pruned": pruned}


MAX_HISTORY = 10  # newest papers kept; older ones (and their results) are removed automatically


def _delete_papers(ids: list[str]) -> int:
    if not ids:
        return 0
    st.submissions.delete_many({"paper_id": {"$in": ids}})
    st.starts.delete_many({"paper_id": {"$in": ids}})
    st.checks.delete_many({"paper_id": {"$in": ids}})
    return st.papers.delete_many({"paper_id": {"$in": ids}}).deleted_count


def _prune_history() -> int:
    """Keep only the newest MAX_HISTORY papers. The live paper is never removed."""
    rows = list(st.papers.find({}, {"_id": 0, "paper_id": 1, "is_active": 1}).sort("created_at", -1))
    old = [r["paper_id"] for r in rows[MAX_HISTORY:] if not r.get("is_active")]
    return _delete_papers(old)


@router.delete("/devices/{candidate_id}")
def reset_device(candidate_id: str, hr=Depends(get_current_hr)):
    """HR releases a student's device lock (new laptop, cleared browser...)."""
    return {"ok": True, "released": st.devices.delete_one({"candidate_id": candidate_id}).deleted_count}


@router.delete("/papers/history/all")
def clear_history(hr=Depends(get_current_hr)):
    """Delete every paper and its student results, except the live one."""
    ids = [r["paper_id"] for r in st.papers.find({"is_active": {"$ne": True}}, {"_id": 0, "paper_id": 1})]
    return {"ok": True, "deleted": _delete_papers(ids)}


@router.delete("/papers/{paper_id}")
def delete_paper(paper_id: str, hr=Depends(get_current_hr)):
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    if p.get("is_active"):
        raise HTTPException(400, "This paper is live. Click “Stop accepting attempts” first.")
    return {"ok": True, "deleted": _delete_papers([paper_id])}


@router.post("/papers/{paper_id}/deactivate")
def deactivate_paper(paper_id: str, hr=Depends(get_current_hr)):
    st.papers.update_one({"paper_id": paper_id}, {"$set": {"is_active": False}})
    return {"ok": True}


STALE_SCORING_SECONDS = 300


def _requeue_stale(paper_id: str, rows: list[dict], bg: BackgroundTasks) -> None:
    """A submission stuck in "scoring" (server restarted mid-job) is queued again."""
    now = _utcnow()
    for r in rows:
        if r.get("status") != "scoring":
            continue
        last = _parse(r.get("requeued_at") or r.get("submitted_at"))
        if last and (now - last).total_seconds() > STALE_SCORING_SECONDS:
            st.submissions.update_one(
                {"paper_id": paper_id, "candidate_id": r["candidate_id"]},
                {"$set": {"requeued_at": now.isoformat()}},
            )
            bg.add_task(_score_in_background, paper_id, r["candidate_id"])


@router.post("/papers/{paper_id}/rescore-all")
def rescore_all(paper_id: str, bg: BackgroundTasks, hr=Depends(get_current_hr)):
    """One click: score again every student whose scoring failed."""
    ids = [r["candidate_id"] for r in st.submissions.find({"paper_id": paper_id, "status": "score_failed"}, st.NO_ID)]
    for cid in ids:
        st.submissions.update_one({"paper_id": paper_id, "candidate_id": cid}, {"$set": {"status": "scoring"}})
        bg.add_task(_score_in_background, paper_id, cid)
    return {"ok": True, "queued": len(ids)}


@router.get("/papers/{paper_id}/report")
def paper_report(paper_id: str, bg: BackgroundTasks, hr=Depends(get_current_hr)):
    p = st.papers.find_one(
        {"paper_id": paper_id}, {**st.NO_ID, "questions": 1, "title": 1, "approved_at": 1}
    )
    if not p:
        raise HTTPException(404, "Paper not found")
    total = sum(q["marks"] for q in p["questions"])
    rows = list(st.submissions.find({"paper_id": paper_id}, st.NO_ID).sort("submitted_at", 1))
    _requeue_stale(paper_id, rows, bg)
    people = _people([r["candidate_id"] for r in rows])
    for r in rows:
        r.update(people.get(r["candidate_id"], {}))  # name, roll_no
    scored = [r["total_score"] for r in rows if r["status"] == "scored"]

    # signed-up exam students who never submitted still show up (with their strikes)
    not_submitted = []
    if invite_storage is not None:
        done = {r["candidate_id"] for r in rows}
        for inv in invite_storage.invites.find({"used": True}, st.NO_ID):
            cid = inv.get("used_by")
            if not cid or cid in done:
                continue
            pr = _proctor(cid, p.get("approved_at"))
            not_submitted.append(
                {
                    "candidate_id": cid,
                    "name": inv.get("name", ""),
                    "roll_no": inv.get("roll", ""),
                    "status": "not_submitted",
                    "total_score": None,
                    "max_total": total,
                    "proctoring": pr,
                    "flagged": pr["total"] > 0,
                    "terminated": pr["terminated"],
                }
            )
    students = rows + not_submitted
    return {
        "paper_id": paper_id,
        "title": p["title"],
        "max_total": total,
        "submitted": len(rows),
        "scored": len(scored),
        "not_submitted": len(not_submitted),
        "flagged": sum(1 for s in students if s.get("flagged")),
        "average": round(sum(scored) / len(scored), 2) if scored else None,
        "students": students,
    }


@router.post("/papers/{paper_id}/rescore/{candidate_id}")
def rescore(paper_id: str, candidate_id: str, bg: BackgroundTasks, hr=Depends(get_current_hr)):
    st.submissions.update_one(
        {"paper_id": paper_id, "candidate_id": candidate_id}, {"$set": {"status": "scoring"}}
    )
    bg.add_task(_score_in_background, paper_id, candidate_id)
    return {"ok": True}


# ---------------------------------------------------------------- HR: result review + manual score edit


class ScoreEditBody(BaseModel):
    q_no: int
    score: float
    note: str = ""


def _hr_detail(p: dict, sub: dict) -> dict:
    """One student's answers next to the ideal answers, AI marks and any HR edits."""
    by_q = {r["q_no"]: r for r in (sub.get("results") or [])}
    answers = sub.get("answers") or {}
    items = []
    for q in p["questions"]:
        r = by_q.get(q["q_no"], {})
        ai = r.get("ai_score", r.get("score"))
        items.append(
            {
                "q_no": q["q_no"],
                "type": q.get("type", ""),
                "question": q["question"],
                "options": q.get("options", []),
                "max_marks": q["marks"],
                "student_answer": r.get("student_answer", answers.get(str(q["q_no"]), "")),
                "ideal_answer": q.get("reference_answer", ""),
                "key_points": q.get("key_points", []),
                "ai_score": ai,
                "score": r.get("score"),
                "edited": bool(r.get("edited")),
                "note": r.get("note", ""),
                "feedback": r.get("feedback", ""),
                "missing_points": r.get("missing_points", []),
            }
        )
    return {
        "paper_id": p["paper_id"],
        "candidate_id": sub["candidate_id"],
        "status": sub.get("status"),
        "total_score": sub.get("total_score"),
        "max_total": sub.get("max_total"),
        "flagged": sub.get("flagged", False),
        "terminated": sub.get("terminated", False),
        "termination_reason": sub.get("termination_reason", ""),
        "proctoring": sub.get("proctoring"),
        "submitted_at": sub.get("submitted_at"),
        "items": items,
    }


@router.get("/papers/{paper_id}/submissions/{candidate_id}")
def hr_submission_detail(paper_id: str, candidate_id: str, hr=Depends(get_current_hr)):
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    sub = st.submissions.find_one({"paper_id": paper_id, "candidate_id": candidate_id}, st.NO_ID)
    if not sub:
        raise HTTPException(404, "This student has not submitted")
    out = _hr_detail(p, sub)
    out.update(_people([candidate_id]).get(candidate_id, {}))  # name, roll_no
    return out


@router.put("/papers/{paper_id}/submissions/{candidate_id}/score")
def hr_edit_score(paper_id: str, candidate_id: str, body: ScoreEditBody, hr=Depends(get_current_hr)):
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    q = next((x for x in p["questions"] if x["q_no"] == body.q_no), None)
    if not q:
        raise HTTPException(404, "Question not found")
    if body.score < 0 or body.score > q["marks"]:
        raise HTTPException(400, f"Score must be between 0 and {q['marks']}")
    key = {"paper_id": paper_id, "candidate_id": candidate_id}
    sub = st.submissions.find_one(key, st.NO_ID)
    if not sub:
        raise HTTPException(404, "This student has not submitted")
    if sub.get("status") != "scored":
        raise HTTPException(409, "Wait until this answer sheet has been scored (or rescore it first)")
    results = sub.get("results") or []
    r = next((x for x in results if x["q_no"] == body.q_no), None)
    if not r:
        raise HTTPException(404, "No result row for this question")
    r.setdefault("ai_score", r.get("score"))  # keep the AI's mark the first time only
    r["score"] = round(body.score, 2)
    r["edited"] = True
    r["note"] = body.note.strip()[:500]
    r["edited_at"] = st.now()
    total = round(sum(x["score"] for x in results), 2)
    st.submissions.update_one(key, {"$set": {"results": results, "total_score": total}})
    return _hr_detail(p, {**sub, "results": results, "total_score": total})


@router.post("/papers/{paper_id}/submissions/{candidate_id}/score/reset")
def hr_reset_score(paper_id: str, candidate_id: str, body: ScoreEditBody, hr=Depends(get_current_hr)):
    """Put the AI's original mark back for one question."""
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    key = {"paper_id": paper_id, "candidate_id": candidate_id}
    sub = st.submissions.find_one(key, st.NO_ID)
    if not p or not sub:
        raise HTTPException(404, "Not found")
    results = sub.get("results") or []
    r = next((x for x in results if x["q_no"] == body.q_no), None)
    if not r or not r.get("edited"):
        raise HTTPException(400, "This question has not been edited")
    r["score"] = r.get("ai_score", r["score"])
    r["edited"] = False
    r["note"] = ""
    total = round(sum(x["score"] for x in results), 2)
    st.submissions.update_one(key, {"$set": {"results": results, "total_score": total}})
    return _hr_detail(p, {**sub, "results": results, "total_score": total})


class ResetPwBody(BaseModel):
    who: str  # the student's email or roll number
    password: str = ""  # optional: HR's own choice; blank = auto-generate


@router.post("/students/reset-password")
def hr_reset_student_password(body: ResetPwBody, hr=Depends(get_current_hr)):
    """HR-only. Gives a student who forgot their password a new temporary one.
    Face check, device lock and proctoring are untouched: the student still has
    to pass the face match after logging in."""
    import secrets
    from app.auth import hash_password

    q = body.who.strip()
    if not q:
        raise HTTPException(400, "Enter the student's email or roll number")
    row = app_storage.get_candidate_auth_by_email(q) if "@" in q else None
    if not row and invite_storage is not None:
        inv = invite_storage.invites.find_one(
            {"roll": {"$regex": f"^{re.escape(q)}$", "$options": "i"}}, st.NO_ID
        )
        if inv:
            row = app_storage.get_candidate_auth(inv["invite_id"])
    if not row or not row.get("password_hash"):
        raise HTTPException(404, "No signed-up student found. If they never signed up, just resend their code.")
    custom = body.password.strip()
    if custom:
        from app.routers.auth_router import _check_password
        _check_password(custom, row.get("email") or "")  # same strength rules as sign-up
        temp = custom
    else:
        temp = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz") for _ in range(4)) + "".join(secrets.choice("23456789") for _ in range(4))
    app_storage.upsert_candidate_auth(row["id"], password_hash=hash_password(temp))
    mailed = False
    try:  # best effort: the page always shows the password too, in case mail is down
        from email.message import EmailMessage
        from app.core import invite_service as svc

        cfg = svc.email_config()
        if cfg and row.get("email"):
            m = EmailMessage()
            m["Subject"] = "Your exam portal password was reset"
            m["From"] = cfg["from"]
            m["To"] = row["email"]
            m.set_content(
                f"Hello,\n\nYour password for the exam portal has been reset by HR.\n\n"
                f"Email: {row['email']}\nNew password: {temp}\n\n"
                f"Log in with it (the face check still applies). Do not share this password."
            )
            smtp = svc.smtp_open(cfg)
            smtp.send_message(m)
            try:
                smtp.quit()
            except Exception:
                pass
            mailed = True
    except Exception as e:
        print(f"[reset-password] email failed: {e}")
    return {"email": row.get("email"), "candidate_id": row["id"], "temp_password": temp, "emailed": mailed}


@router.post("/papers/{paper_id}/submissions/{candidate_id}/reattempt")
def hr_allow_reattempt(paper_id: str, candidate_id: str, hr=Depends(get_current_hr)):
    """HR lets a student take this exam again (for example after a wrongly flagged auto-end).
    Removes their submission, their start record and the proctoring strikes for this exam, and
    releases the device lock. The student then goes through the system check and starts a fresh
    attempt, as long as the exam window is still open."""
    p = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
    if not p:
        raise HTTPException(404, "Paper not found")
    key = {"paper_id": paper_id, "candidate_id": candidate_id}
    removed_sub = st.submissions.delete_one(key).deleted_count
    removed_start = st.starts.delete_one(key).deleted_count
    q = {"candidate_id": candidate_id}
    if p.get("approved_at"):
        q["created_at"] = {"$gte": p["approved_at"]}
    strikes = app_storage.get_db().proctoring_events.delete_many(q).deleted_count
    st.devices.delete_one({"candidate_id": candidate_id})
    return {
        "ok": True,
        "submission_removed": removed_sub,
        "strikes_removed": strikes,
        "window_open": _phase(p, _utcnow()) != "closed" and bool(p.get("is_active")),
    }


# ---------------------------------------------------------------- candidate side
def _bind_device(cid: str, request: Request) -> str:
    """Lock each student to the first browser they use for the exam, and
    (optionally) one student per browser. HR can release a lock from Reports."""
    dev = (request.query_params.get("device") or "").strip()
    if len(dev) < 16:
        raise HTTPException(400, "Could not identify this browser. Refresh the page and try again.")
    row = st.devices.find_one({"candidate_id": cid}, st.NO_ID)
    if not row:
        # first time this student is seen: refuse before binding if the device is taken
        if ONE_STUDENT_PER_DEVICE and st.devices.find_one({"device_id": dev, "candidate_id": {"$ne": cid}}):
            raise HTTPException(403, "This device was already used by another student. Use your own device or ask your teacher.")
        try:
            st.devices.update_one(
                {"candidate_id": cid}, {"$setOnInsert": {"device_id": dev, "bound_at": st.now()}}, upsert=True
            )
        except DuplicateKeyError:
            pass  # two requests raced; the other one bound it
        row = st.devices.find_one({"candidate_id": cid}, st.NO_ID)
    if row["device_id"] != dev:
        raise HTTPException(403, "This account is locked to a different device. Ask your teacher to reset it.")
    return request.query_params.get("session") or ""


def _cid(cand) -> str:
    return cand["candidate_id"]  # set in exam_deps (token "sub" unless a candidate_id claim exists)


def _objective_reference(q: dict) -> str:
    """Model answer text for MCQ / fill-in questions, shown to HR."""
    if q.get("type") == "mcq":
        letter = (q.get("answer") or "").strip().upper()[:1]
        opts = q.get("options") or []
        i = "ABCD".find(letter)
        return f"{letter}. {opts[i]}" if 0 <= i < len(opts) else letter
    return (q.get("answer") or "").strip()


def _people(ids: list[str]) -> dict:
    if invite_storage is None or not ids:
        return {}
    return {
        i["invite_id"]: {"name": i.get("name", ""), "roll_no": i.get("roll", "")}
        for i in invite_storage.invites.find({"invite_id": {"$in": ids}}, st.NO_ID)
    }


def _proctor(cid: str, since: str | None = None) -> dict:
    """This student's proctoring strikes for the current exam.

    The existing AntiCheatMonitor logs events through /proctoring/{id}/event
    (stored by storage.py). Only events after the paper was approved count, so
    strikes from an earlier exam never carry over to the next one.
    """
    events = app_storage.get_proctoring_events(cid)
    if since:
        events = [e for e in events if e["created_at"] >= since]
    mx = app_storage.MAX_CHEAT_WARNINGS
    return {
        "total": len(events),
        "high": sum(1 for e in events if e["severity"] == "high"),
        "warning": sum(1 for e in events if e["severity"] == "warning"),
        "max": mx,
        "terminated": len(events) >= mx,
        "events": [
            {"event_type": e["event_type"], "severity": e["severity"],
             "detail": e.get("detail", ""), "at": e["created_at"]}
            for e in events
        ],
    }


def _store_submission(p: dict, cid: str, answers: dict, bg: BackgroundTasks) -> None:
    pr = _proctor(cid, p.get("approved_at"))
    doc = {
        "paper_id": p["paper_id"],
        "candidate_id": cid,
        "answers": answers,
        "status": "scoring",
        "submitted_at": st.now(),
        "max_total": sum(q["marks"] for q in p["questions"]),
        "proctoring": pr,
        "flagged": pr["total"] > 0,
        "terminated": pr["terminated"],
        "termination_reason": (
            f"Cheating detected: {pr['max']} proctoring warnings reached. Exam auto-submitted."
            if pr["terminated"] else ""
        ),
    }
    blank = not any((a or "").strip() for a in answers.values())
    if blank:  # nothing to grade: record zeros and skip the Gemini call
        doc.update(
            status="scored", total_score=0.0, scored_at=st.now(),
            results=[
                {"q_no": q["q_no"], "question": q["question"], "max_marks": q["marks"],
                 "student_answer": "", "score": 0, "feedback": "No answer submitted.",
                 "missing_points": []}
                for q in p["questions"]
            ],
        )
    try:
        st.submissions.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "You have already submitted this paper")
    if not blank:
        bg.add_task(_score_in_background, p["paper_id"], cid)


def _finalize_blank(p: dict, cid: str, bg: BackgroundTasks) -> None:
    """Time ran out (or the student was struck out) and nothing was handed in:
    close the attempt with whatever the auto-save last stored."""
    rec = st.starts.find_one({"paper_id": p["paper_id"], "candidate_id": cid}, st.NO_ID) or {}
    try:
        _store_submission(p, cid, rec.get("answers") or {}, bg)
    except HTTPException:
        pass


def _safe_questions(p: dict) -> list[dict]:
    # never leak model answers to the candidate
    return [
        {k: q.get(k) for k in ("q_no", "chapter", "topic", "type", "question", "marks", "options")}
        for q in p["questions"]
    ]


@router.get("/active")
def active_paper(bg: BackgroundTasks, request: Request, cand=Depends(get_current_candidate)):
    p = st.papers.find_one({"is_active": True}, st.NO_ID)
    if not p:
        return {"paper": None}
    cid = _cid(cand)
    _bind_device(cid, request)
    key = {"paper_id": p["paper_id"], "candidate_id": cid}
    now = _utcnow()
    sub = st.submissions.find_one(key, st.NO_ID)
    rec = st.starts.find_one(key, st.NO_ID)
    # Struck out, or started and ran out of time, but nothing was submitted
    # (page reloaded / browser closed): end the attempt now.
    if not sub and (
        _proctor(cid, p.get("approved_at"))["terminated"]
        or (rec and now > _deadline(p, _parse(rec["started_at"])) + timedelta(seconds=GRACE_SECONDS))
    ):
        _finalize_blank(p, cid, bg)
        sub = st.submissions.find_one(key, st.NO_ID)
    # Questions are NOT sent here: they are only released by /exam/start,
    # after the window check, so nobody can read the paper early.
    return {
        "paper": {
            "paper_id": p["paper_id"],
            "title": p["title"],
            "subject": p["subject"],
            "duration_minutes": p["duration_minutes"],
            "question_count": len(p["questions"]),
            "window_start": p.get("window_start"),
            "window_end": p.get("window_end"),
            "phase": _phase(p, now),  # waiting | open | closed
            "server_now": now.isoformat(),
        },
        # Students never receive marks, answers-vs-ideal or feedback: HR decides if and
        # when to share results (class / WhatsApp). Only the fact that it was submitted.
        "submission": (
            {
                "status": "submitted",
                "submitted_at": sub.get("submitted_at"),
                "terminated": sub.get("terminated", False),
                "termination_reason": sub.get("termination_reason", ""),
            }
            if sub
            else None
        ),
    }


@router.get("/history")
def my_history(cand=Depends(get_current_candidate)):
    """This student's last 10 exams with their status. Marks are never included."""
    cid = _cid(cand)
    now = _utcnow()
    rows = list(st.submissions.find({"candidate_id": cid}, st.NO_ID).sort("submitted_at", -1).limit(10))
    out = []
    for r in rows:
        p = st.papers.find_one({"paper_id": r["paper_id"]}, st.NO_ID)
        if r.get("terminated"):
            label = "Auto-submitted (proctoring)"
        else:
            label = "Submitted"
        out.append(
            {
                "paper_id": r["paper_id"],
                "title": (p or {}).get("title", "Exam"),
                "subject": (p or {}).get("subject", ""),
                "submitted_at": r.get("submitted_at"),
                "status": label,
            }
        )
    return {"history": out}


@router.post("/face-check")
def face_check(body: FaceCheckBody, request: Request, cand=Depends(get_current_candidate)):
    """Pre-exam identity check: compare the live face with the one enrolled at
    sign-up. A pass is stored on the server; /exam/start refuses without it."""
    p = st.papers.find_one({"is_active": True}, st.NO_ID)
    if not p:
        raise HTTPException(404, "No exam is live right now")
    cid = _cid(cand)
    _bind_device(cid, request)
    if len(body.descriptor) != 128:
        raise HTTPException(400, "Expected a 128-length face descriptor")
    row = app_storage.get_candidate_auth(cid) or {}
    enrolled = row.get("face_descriptor")
    if not enrolled:
        raise HTTPException(400, "No face enrolled for this account")
    ref = json.loads(enrolled)
    dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(body.descriptor, ref)))
    key = {"paper_id": p["paper_id"], "candidate_id": cid}
    if dist <= FACE_MATCH_THRESHOLD:
        st.checks.update_one(key, {"$set": {"verified_at": st.now()}}, upsert=True)
        return {"match": True}
    st.checks.update_one(key, {"$inc": {"fails": 1}}, upsert=True)
    return {"match": False}


@router.post("/start")
def start_exam(bg: BackgroundTasks, request: Request, cand=Depends(get_current_candidate)):
    """Release the paper. Starts this student's own timer on the SERVER clock;
    their deadline is the earlier of (start + duration) and the window end."""
    p = st.papers.find_one({"is_active": True}, st.NO_ID)
    if not p:
        raise HTTPException(404, "No exam is live right now")
    cid = _cid(cand)
    session = _bind_device(cid, request)
    key = {"paper_id": p["paper_id"], "candidate_id": cid}
    if st.submissions.find_one(key, st.NO_ID):
        raise HTTPException(409, "You have already submitted this paper")
    now = _utcnow()
    chk = st.checks.find_one(key, st.NO_ID)
    verified = _parse(chk.get("verified_at")) if chk else None
    if not verified or now - verified > timedelta(seconds=CHECK_VALID_SECONDS):
        raise HTTPException(403, "Complete the camera and face check first")
    rec = st.starts.find_one(key, st.NO_ID)
    if not rec:
        phase = _phase(p, now)
        if phase == "waiting":
            raise HTTPException(403, "The exam has not started yet")
        if phase == "closed":
            raise HTTPException(403, "The exam window has closed")
        if _proctor(cid, p.get("approved_at"))["terminated"]:
            raise HTTPException(403, "Your exam was ended after proctoring warnings")
        try:
            st.starts.insert_one({**key, "started_at": now.isoformat()})
        except DuplicateKeyError:
            pass
        rec = st.starts.find_one(key, st.NO_ID)
    deadline = _deadline(p, _parse(rec["started_at"]))
    if now > deadline + timedelta(seconds=GRACE_SECONDS):
        _finalize_blank(p, cid, bg)
        raise HTTPException(403, "Your time for this exam is over")
    # newest window wins: any older window of this student stops being able to submit
    st.starts.update_one(key, {"$set": {"session_id": session}})
    return {
        "questions": _safe_questions(p),
        "answers": rec.get("answers") or {},  # auto-saved earlier (reload / crash recovery)
        "deadline": deadline.isoformat(),
        "server_now": now.isoformat(),
        "remaining_seconds": max(0, int((deadline - now).total_seconds())),
    }


@router.post("/save")
def save_answers(body: SaveBody, request: Request, cand=Depends(get_current_candidate)):
    """Auto-save: the browser sends the answers every few seconds so a crash,
    reload or power cut loses at most a few seconds of typing."""
    p = st.papers.find_one({"paper_id": body.paper_id, "is_active": True}, st.NO_ID)
    if not p:
        raise HTTPException(404, "This paper is not active")
    cid = _cid(cand)
    session = _bind_device(cid, request)
    key = {"paper_id": p["paper_id"], "candidate_id": cid}
    rec = st.starts.find_one(key, st.NO_ID)
    if not rec:
        raise HTTPException(403, "Start the exam first")
    if rec.get("session_id") and rec["session_id"] != session:
        raise HTTPException(409, "This exam is open in another window.")
    if st.submissions.find_one(key, st.NO_ID):
        raise HTTPException(409, "Already submitted")
    if _utcnow() > _deadline(p, _parse(rec["started_at"])) + timedelta(seconds=GRACE_SECONDS):
        raise HTTPException(403, "Time is over")
    if sum(len(v) for v in body.answers.values()) > 200_000:
        raise HTTPException(413, "Answers are too long")
    st.starts.update_one(key, {"$set": {"answers": body.answers, "saved_at": st.now()}})
    return {"ok": True}


@router.post("/submit")
def submit(body: SubmitBody, bg: BackgroundTasks, request: Request, cand=Depends(get_current_candidate)):
    p = st.papers.find_one({"paper_id": body.paper_id, "is_active": True}, st.NO_ID)
    if not p:
        raise HTTPException(404, "This paper is not active")
    cid = _cid(cand)
    session = _bind_device(cid, request)
    rec = st.starts.find_one({"paper_id": p["paper_id"], "candidate_id": cid}, st.NO_ID)
    if not rec:
        raise HTTPException(403, "Start the exam first")
    if rec.get("session_id") and rec["session_id"] != session:
        raise HTTPException(409, "This exam is open in another window. Only the newest window can submit.")
    if _utcnow() > _deadline(p, _parse(rec["started_at"])) + timedelta(seconds=GRACE_SECONDS):
        _finalize_blank(p, cid, bg)  # too late: late answers are not accepted
        raise HTTPException(403, "Time is over. Your attempt was closed.")
    # strikes are read from the server's own proctoring log, never from the browser
    _store_submission(p, cid, body.answers, bg)
    return {"ok": True}


# ---------------------------------------------------------------- background job
def _score_in_background(paper_id: str, candidate_id: str):
    key = {"paper_id": paper_id, "candidate_id": candidate_id}
    try:
        paper = st.papers.find_one({"paper_id": paper_id}, st.NO_ID)
        sub = st.submissions.find_one(key, st.NO_ID)
        results = gem.score_submission(paper, sub["answers"])
        by_q = {r["q_no"]: r for r in results}
        merged = []
        for q in paper["questions"]:
            r = by_q.get(q["q_no"], {"score": 0, "feedback": "Not scored", "missing_points": []})
            merged.append(
                {
                    "q_no": q["q_no"],
                    "question": q["question"],
                    "max_marks": q["marks"],
                    "student_answer": sub["answers"].get(str(q["q_no"]), ""),
                    "score": r["score"],
                    "feedback": r.get("feedback", ""),
                    "missing_points": r.get("missing_points", []),
                }
            )
        st.submissions.update_one(
            key,
            {"$set": {
                "results": merged,
                "total_score": round(sum(m["score"] for m in merged), 2),
                "status": "scored",
                "scored_at": st.now(),
            }},
        )
    except Exception as e:
        st.submissions.update_one(key, {"$set": {"status": "score_failed", "error": str(e)[:300]}})
