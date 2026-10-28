"""Exam module routes: upload a student list, generate one-time access codes,
deliver them by email or SMS, and track delivery / sign-up status."""
import os
import smtplib
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core import exam_storage as exst
from app.core import invite_service as svc
from app.core import storage as app_storage
from app.core import invite_storage as st
from app.routers.exam_deps import get_current_hr

router = APIRouter(prefix="/exam-invites", tags=["exam-invites"])

SIGNUP_URL = os.getenv("CANDIDATE_SIGNUP_URL", "http://localhost:5173/candidate/login")
MAX_FILE_BYTES = 5 * 1024 * 1024


class SendBody(BaseModel):
    channel: Literal["email", "phone"]
    exam_title: str = "MST"
    note: str = ""


class CheckBody(BaseModel):
    code: str


# ---------------------------------------------------------------- views
def _counts(rows: list[dict]) -> dict:
    c = {"pending": 0, "queued": 0, "sent": 0, "failed": 0, "used": 0}
    for r in rows:
        c[r["status"]] = c.get(r["status"], 0) + 1
        if r.get("used"):
            c["used"] += 1
    return c


def _batch_view(batch_id: str) -> dict:
    b = st.invite_batches.find_one({"batch_id": batch_id}, st.NO_ID)
    if not b:
        raise HTTPException(404, "Batch not found")
    rows = list(st.invites.find({"batch_id": batch_id}, st.NO_ID).sort("created_at", 1))
    return {**b, "counts": _counts(rows), "invites": rows}


# ---------------------------------------------------------------- upload
@router.post("/upload")
def upload(file: UploadFile = File(...), hr=Depends(get_current_hr)):
    data = file.file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(400, "File too large (max 5 MB)")
    try:
        parsed = svc.parse_students(svc.read_rows(file.filename or "", data))
    except ValueError as e:
        raise HTTPException(400, str(e))

    batch_id = st.new_id("BATCH")
    created = st.now()
    used_codes: set[str] = set()
    docs = []
    for s in parsed["students"]:
        code = svc.new_code()
        while code in used_codes:
            code = svc.new_code()
        used_codes.add(code)
        docs.append({
            "invite_id": st.new_id("INV"), "batch_id": batch_id, "code": code,
            "name": s["name"], "roll": s["roll"], "email": s["email"], "phone": s["phone"],
            "channel": None, "status": "pending", "error": "", "sent_at": None,
            "used": False, "used_by": None, "used_at": None, "created_at": created,
        })
    st.invite_batches.insert_one({
        "batch_id": batch_id, "filename": file.filename, "created_at": created,
        "columns": parsed["columns"], "stats": parsed["stats"], "last_send": None,
    })
    st.invites.insert_many(docs)
    return _batch_view(batch_id)


@router.get("/batches")
def list_batches(hr=Depends(get_current_hr)):
    out = []
    for b in st.invite_batches.find({}, st.NO_ID).sort("created_at", -1).limit(30):
        rows = list(st.invites.find({"batch_id": b["batch_id"]}, {"status": 1, "used": 1, "_id": 0}))
        out.append({**b, "counts": _counts(rows), "total": len(rows)})
    return out


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str, hr=Depends(get_current_hr)):
    return _batch_view(batch_id)


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: str, hr=Depends(get_current_hr)):
    st.invites.delete_many({"batch_id": batch_id})  # codes stop working
    st.invite_batches.delete_one({"batch_id": batch_id})
    return {"ok": True}


# ---------------------------------------------------------------- send
@router.post("/batches/{batch_id}/send")
def send(batch_id: str, body: SendBody, bg: BackgroundTasks, hr=Depends(get_current_hr)):
    if not st.invite_batches.find_one({"batch_id": batch_id}):
        raise HTTPException(404, "Batch not found")
    hint = svc.channel_hint(body.channel)
    if hint:
        raise HTTPException(400, hint)
    contact = "email" if body.channel == "email" else "phone"
    res = st.invites.update_many(
        {
            "batch_id": batch_id,
            contact: {"$ne": ""},
            "used": False,
            # skip students who already got a code on this same channel
            "$nor": [{"status": "sent", "channel": body.channel}],
        },
        {"$set": {"status": "queued", "channel": body.channel, "error": ""}},
    )
    if res.matched_count == 0:
        raise HTTPException(400, f"Nothing to send: no students with a {contact} left to message.")
    st.invite_batches.update_one(
        {"batch_id": batch_id},
        {"$set": {"last_send": {"channel": body.channel, "exam_title": body.exam_title, "note": body.note}}},
    )
    bg.add_task(_deliver, batch_id, body.channel, body.exam_title.strip() or "MST", body.note.strip())
    return _batch_view(batch_id)


def _mark(invite_id: str, status: str, error: str = "") -> None:
    st.invites.update_one(
        {"invite_id": invite_id},
        {"$set": {"status": status, "error": error, "sent_at": st.now() if status == "sent" else None}},
    )


def _deliver(batch_id: str, channel: str, title: str, note: str) -> None:
    items = list(st.invites.find({"batch_id": batch_id, "status": "queued", "channel": channel}, st.NO_ID))
    if channel == "email":
        cfg = svc.email_config()
        smtp = None
        for n, it in enumerate(items):
            try:
                if smtp is None:
                    smtp = svc.smtp_open(cfg)
                smtp.send_message(svc.build_email(cfg, it, title, note, SIGNUP_URL))
                _mark(it["invite_id"], "sent")
            except smtplib.SMTPAuthenticationError:
                # wrong login: fail everything left instead of hammering Gmail
                msg = "Gmail login failed. Check GMAIL_ADDRESS / GMAIL_APP_PASSWORD (use an App Password)."
                for rest in items[n:]:
                    _mark(rest["invite_id"], "failed", msg)
                return
            except Exception as e:
                _mark(it["invite_id"], "failed", str(e)[:200])
                try:
                    smtp.quit()
                except Exception:
                    pass
                smtp = None
        if smtp:
            try:
                smtp.quit()
            except Exception:
                pass
    else:
        cfg = svc.sms_config()
        for it in items:
            try:
                svc.send_sms(cfg, it["phone"], svc.build_sms(it, title, SIGNUP_URL))
                _mark(it["invite_id"], "sent")
            except Exception as e:
                _mark(it["invite_id"], "failed", str(e)[:200])


# ---------------------------------------------------------------- manual add, resend, delete account
class AddStudent(BaseModel):
    name: str = ""
    roll: str = ""
    email: str = ""
    phone: str = ""
    batch_id: str | None = None  # blank = put the student in a "Manual additions" list (created on first use)


@router.post("/students")
def add_student(body: AddStudent, hr=Depends(get_current_hr)):
    """HR adds one student by hand (the + button). Gets their own access code like everyone else."""
    email = svc.find_email(body.email) if body.email.strip() else ""
    phone = svc.normalize_phone(body.phone) if body.phone.strip() else ""
    if body.email.strip() and not email:
        raise HTTPException(400, "That email address doesn't look valid")
    if body.phone.strip() and not phone:
        raise HTTPException(400, "That phone number doesn't look valid")
    if not email and not phone:
        raise HTTPException(400, "Enter an email or a phone number")

    batch_id = body.batch_id
    if batch_id and not st.invite_batches.find_one({"batch_id": batch_id}):
        raise HTTPException(404, "List not found")
    if not batch_id:
        existing = st.invite_batches.find_one({"filename": "Manual additions"}, st.NO_ID)
        if existing:
            batch_id = existing["batch_id"]
        else:
            batch_id = st.new_id("BATCH")
            st.invite_batches.insert_one({
                "batch_id": batch_id, "filename": "Manual additions", "created_at": st.now(),
                "columns": {"name": "Name", "roll": "Roll", "email": "Email", "phone": "Phone"},
                "stats": {"total_rows": 0, "with_email": 0, "with_phone": 0,
                          "invalid_email": 0, "invalid_phone": 0, "duplicates": 0},
                "last_send": None,
            })
    # same email already in this list? don't create a second code for them
    if email and st.invites.find_one({"batch_id": batch_id, "email": email}):
        raise HTTPException(400, "This email is already in the list")

    code = svc.new_code()
    while st.invites.find_one({"code": code}):
        code = svc.new_code()
    st.invites.insert_one({
        "invite_id": st.new_id("INV"), "batch_id": batch_id, "code": code,
        "name": body.name.strip(), "roll": body.roll.strip(), "email": email, "phone": phone,
        "channel": None, "status": "pending", "error": "", "sent_at": None,
        "used": False, "used_by": None, "used_at": None, "created_at": st.now(),
    })
    stats_inc = {"stats.total_rows": 1}
    if email:
        stats_inc["stats.with_email"] = 1
    if phone:
        stats_inc["stats.with_phone"] = 1
    st.invite_batches.update_one({"batch_id": batch_id}, {"$inc": stats_inc})
    return _batch_view(batch_id)


@router.post("/invites/{invite_id}/resend")
def resend_one(invite_id: str, hr=Depends(get_current_hr)):
    """Send (or resend) this one student's access code by email."""
    inv = st.invites.find_one({"invite_id": invite_id}, st.NO_ID)
    if not inv:
        raise HTTPException(404, "Student not found")
    if inv.get("used"):
        raise HTTPException(400, "This student has already signed up. Delete their account first if they need to sign up again.")
    if not inv.get("email"):
        raise HTTPException(400, "No email on file for this student. Share their code from the CSV instead.")
    hint = svc.channel_hint("email")
    if hint:
        raise HTTPException(400, hint)
    batch = st.invite_batches.find_one({"batch_id": inv["batch_id"]}, st.NO_ID) or {}
    last = batch.get("last_send") or {}
    cfg = svc.email_config()
    try:
        smtp = svc.smtp_open(cfg)
        smtp.send_message(svc.build_email(cfg, inv, last.get("exam_title") or "MST", last.get("note") or "", SIGNUP_URL))
        try:
            smtp.quit()
        except Exception:
            pass
    except Exception as e:
        _mark(invite_id, "failed", str(e)[:200])
        st.invites.update_one({"invite_id": invite_id}, {"$set": {"channel": "email"}})
        raise HTTPException(502, f"Could not send the email: {str(e)[:200]}")
    st.invites.update_one({"invite_id": invite_id}, {"$set": {"channel": "email"}})
    _mark(invite_id, "sent")
    return _batch_view(inv["batch_id"])


@router.post("/invites/{invite_id}/reset-account")
def reset_account(invite_id: str, hr=Depends(get_current_hr)):
    """Delete a student's account (password + enrolled face) and free their access code, so they can
    sign up again with the same code. Exam submissions are kept. The device lock is released too."""
    inv = st.invites.find_one({"invite_id": invite_id}, st.NO_ID)
    if not inv:
        raise HTTPException(404, "Student not found")
    removed = app_storage.get_db().candidate_auth.delete_one({"_id": invite_id}).deleted_count
    st.invites.update_one(
        {"invite_id": invite_id}, {"$set": {"used": False, "used_by": None, "used_at": None}}
    )
    exst.devices.delete_one({"candidate_id": invite_id})
    return {**_batch_view(inv["batch_id"]), "account_removed": removed}


# ---------------------------------------------------------------- public: used by the sign-up form
@router.post("/check")
def check(body: CheckBody):
    inv = st.invites.find_one({"code": body.code.strip().upper()}, st.NO_ID)
    if not inv:
        return {"valid": False}
    return {"valid": not inv["used"], "used": inv["used"], "email_hint": svc.mask_email(inv["email"])}
