"""
storage.py
MongoDB-backed storage for candidate records and app settings.

Switched from SQLite to MongoDB Atlas (free tier) so the data lives in
the cloud instead of a local file — multiple people/machines can hit
the same backend, and there's nothing to lose if a laptop's disk goes
away. Every function here keeps the exact same name and signature as
the old SQLite version, so nothing in routers/*.py had to change —
this module is the only place that knows it's talking to Mongo.

Collections:
  candidates          _id = candidate_id (e.g. "CAND_02FD1417")
  settings            _id = key
  hr_users            _id = user_id (uuid)
  candidate_auth      _id = candidate_id
  feedback            _id = feedback_id (uuid)
  proctoring_events   _id = event id (uuid)

Mongo documents store lists/dicts natively, so fields that needed
json.dumps/json.loads round-tripping in SQLite (questions, answers,
answer_scores, face_descriptor) are just plain Python lists here.
"""

import datetime
import os
import uuid

from dotenv import load_dotenv
from pymongo import MongoClient, ASCENDING, DESCENDING

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "ai_recruiter")

# Number of proctoring strikes (tab switches, browser closes, no-face /
# multi-face frames, fullscreen exits, etc.) allowed before an interview
# is auto-ended for suspected cheating.
MAX_CHEAT_WARNINGS = 3

_client = None  # module-level pooled client, reused for the process lifetime


def _init_client():
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB_NAME]
    db.candidates.create_index([("resume_score", DESCENDING)])
    db.hr_users.create_index("email", unique=True)
    db.candidate_auth.create_index("email", unique=True, sparse=True)
    db.proctoring_events.create_index("candidate_id")
    db.feedback.create_index("candidate_id")
    return client


def get_db():
    """One pooled MongoClient per process, reused for the lifetime of the
    FastAPI worker process (mirrors the old get_conn() pattern)."""
    global _client
    if _client is None:
        _client = _init_client()
    return _client[MONGO_DB_NAME]


def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


def _strip_mongo_id(doc):
    """Mongo's _id is whatever we set it to (candidate_id, uuid, etc);
    surface it back out as 'id' the same way the SQLite rows did, and
    drop the raw _id key so nothing downstream trips on it."""
    if doc is None:
        return None
    doc = dict(doc)
    doc["id"] = doc.pop("_id")
    return doc


def load_candidates() -> dict:
    """All candidates as {candidate_id: {...}}, best matches first."""
    db = get_db()
    # Mongo sorts None as less than any number, so this puts un-scored
    # candidates last regardless of sort direction — do it in two passes
    # to match the old "unscored last" SQLite behavior exactly.
    scored = db.candidates.find({"resume_score": {"$ne": None}}).sort("resume_score", DESCENDING)
    unscored = db.candidates.find({"resume_score": None})
    out = {}
    for doc in list(scored) + list(unscored):
        d = _strip_mongo_id(doc)
        out[d["id"]] = d
    return out


def get_candidate(candidate_id: str):
    db = get_db()
    doc = db.candidates.find_one({"_id": candidate_id})
    return _strip_mongo_id(doc)


def add_candidates(new_candidates: dict):
    """Bulk-upsert freshly parsed resumes (one round trip for the whole
    upload batch, not one per file)."""
    if not new_candidates:
        return
    db = get_db()
    for cid, d in new_candidates.items():
        db.candidates.update_one(
            {"_id": cid},
            {"$set": {
                "filename": d.get("filename"),
                "resume_text": d.get("resume_text"),
                "contact_email": d.get("contact_email"),
            },
             "$setOnInsert": {"created_at": _now_iso()}},
            upsert=True,
        )


def update_candidate(candidate_id: str, updates: dict):
    """Merge new fields into one candidate's document."""
    db = get_db()
    updates = dict(updates)
    updates.pop("id", None)
    db.candidates.update_one(
        {"_id": candidate_id},
        {"$set": updates, "$setOnInsert": {"created_at": _now_iso()}},
        upsert=True,
    )


def get_setting(key: str, default=None):
    db = get_db()
    doc = db.settings.find_one({"_id": key})
    return doc["value"] if doc else default


def set_setting(key: str, value: str):
    db = get_db()
    db.settings.update_one({"_id": key}, {"$set": {"value": value}}, upsert=True)


# ---------------------------------------------------------------------------
# HR auth
# ---------------------------------------------------------------------------

def create_hr_user(user_id: str, email: str, password_hash: str, name: str = "", is_temp: bool = False):
    db = get_db()
    db.hr_users.insert_one({
        "_id": user_id,
        "email": email.lower(),
        "password_hash": password_hash,
        "name": name,
        "is_temp": is_temp,  # True for one-click guest logins — never a real account
        "created_at": _now_iso(),
    })


def get_hr_user_by_email(email: str):
    db = get_db()
    doc = db.hr_users.find_one({"email": email.lower()})
    return _strip_mongo_id(doc)


# ---------------------------------------------------------------------------
# Candidate auth + face descriptor
# ---------------------------------------------------------------------------

def upsert_candidate_auth(candidate_id: str, **fields):
    """fields may include email, password_hash, face_descriptor (a plain
    list of floats — no JSON round-trip needed with Mongo), face_enrolled_at."""
    db = get_db()
    if "email" in fields and fields["email"]:
        fields["email"] = fields["email"].lower()
    db.candidate_auth.update_one(
        {"_id": candidate_id}, {"$set": fields}, upsert=True
    )


def get_candidate_auth(candidate_id: str):
    db = get_db()
    doc = db.candidate_auth.find_one({"_id": candidate_id})
    return _strip_mongo_id(doc)


def get_candidate_auth_by_email(email: str):
    db = get_db()
    doc = db.candidate_auth.find_one({"email": email.lower()})
    return _strip_mongo_id(doc)


def list_face_descriptors():
    """All enrolled (candidate_id, descriptor) pairs. Kept for parity
    with the old 1:N face-login path; the current 1:1 verify flow
    doesn't need this, but it's cheap to keep around."""
    db = get_db()
    out = []
    for doc in db.candidate_auth.find({"face_descriptor": {"$ne": None}}):
        out.append((doc["_id"], doc["face_descriptor"]))
    return out


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

def add_feedback(feedback_id: str, candidate_id: str, summary: str, strengths: str,
                  improvements: str, recommendation: str):
    db = get_db()
    db.feedback.insert_one({
        "_id": feedback_id,
        "candidate_id": candidate_id,
        "summary": summary,
        "strengths": strengths,
        "improvements": improvements,
        "recommendation": recommendation,
        "created_at": _now_iso(),
    })


def get_feedback_for_candidate(candidate_id: str):
    db = get_db()
    cursor = db.feedback.find({"candidate_id": candidate_id}).sort("created_at", DESCENDING).limit(1)
    doc = next(cursor, None)
    return _strip_mongo_id(doc)


# ---------------------------------------------------------------------------
# Proctoring / anti-cheat events
# ---------------------------------------------------------------------------

def log_proctoring_event(candidate_id: str, event_type: str, severity: str = "warning", detail: str = ""):
    db = get_db()
    db.proctoring_events.insert_one({
        "_id": str(uuid.uuid4()),
        "candidate_id": candidate_id,
        "event_type": event_type,
        "severity": severity,
        "detail": detail,
        "created_at": _now_iso(),
    })


def get_proctoring_events(candidate_id: str):
    db = get_db()
    docs = db.proctoring_events.find({"candidate_id": candidate_id}).sort("created_at", ASCENDING)
    return [_strip_mongo_id(d) for d in docs]


def get_proctoring_summary(candidate_id: str) -> dict:
    """Small rollup used by the HR dashboard's integrity column."""
    events = get_proctoring_events(candidate_id)
    high = sum(1 for e in events if e["severity"] == "high")
    warning = sum(1 for e in events if e["severity"] == "warning")
    candidate = get_candidate(candidate_id) or {}
    return {
        "total": len(events),
        "high": high,
        "warning": warning,
        "events": events,
        "cheat_warning_count": min(len(events), MAX_CHEAT_WARNINGS),
        "max_cheat_warnings": MAX_CHEAT_WARNINGS,
        "terminated": candidate.get("interview_terminated", False),
        "termination_reason": candidate.get("termination_reason"),
    }


def terminate_interview_for_cheating(candidate_id: str, reason: str):
    """Auto-end an interview once the candidate has crossed
    MAX_CHEAT_WARNINGS proctoring strikes. Idempotent: a candidate who is
    already terminated, or who already has a submitted interview_score,
    is left untouched (nothing to overwrite; HR already has a result)."""
    candidate = get_candidate(candidate_id)
    if not candidate:
        return
    if candidate.get("interview_terminated") or candidate.get("interview_score") is not None:
        return
    update_candidate(candidate_id, {
        "interview_terminated": True,
        "termination_reason": reason,
        "interview_score": 0.0,
    })
