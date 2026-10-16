"""MongoDB collections for the exam module.

Uses its own handle so it works without touching storage.py. If storage.py
already exposes a `db` object, replace the three lines below with that.
"""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import ASCENDING, MongoClient

load_dotenv()

_client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"))
db = _client[os.getenv("MONGO_DB", os.getenv("MONGO_DB_NAME", "ai_recruiter"))]

syllabi = db["syllabi"]
papers = db["exam_papers"]
submissions = db["exam_submissions"]
devices = db["exam_devices"]  # one browser/device bound to each student
checks = db["exam_checks"]  # last passed camera + face check per student
starts = db["exam_starts"]  # when each student pressed Start (server clock)

# one submission per candidate per paper (blocks double-submit at DB level)
submissions.create_index(
    [("paper_id", ASCENDING), ("candidate_id", ASCENDING)], unique=True
)
devices.create_index([("candidate_id", ASCENDING)], unique=True)
devices.create_index([("device_id", ASCENDING)])
checks.create_index(
    [("paper_id", ASCENDING), ("candidate_id", ASCENDING)], unique=True
)
starts.create_index(
    [("paper_id", ASCENDING), ("candidate_id", ASCENDING)], unique=True
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


NO_ID = {"_id": 0}
