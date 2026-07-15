"""
storage.py
Simple JSON-file-based storage acting as our "database" for the MVP.
Reliable and dependency-free — good for a 1-week build and live demo.
"""

import json
import os

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "candidates.json")


def load_candidates() -> dict:
    """Load all candidate data. Returns {} if file doesn't exist yet."""
    if not os.path.exists(DATA_PATH):
        return {}
    with open(DATA_PATH, "r") as f:
        content = f.read().strip()
        if not content:
            return {}
        return json.loads(content)


def save_candidates(candidates: dict):
    """Save the full candidates dict back to disk."""
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w") as f:
        json.dump(candidates, f, indent=2)


def update_candidate(candidate_id: str, updates: dict):
    """Merge new fields into one candidate's record and save."""
    candidates = load_candidates()
    if candidate_id not in candidates:
        candidates[candidate_id] = {}
    candidates[candidate_id].update(updates)
    save_candidates(candidates)


def get_candidate(candidate_id: str):
    """Fetch a single candidate's data, or None if not found."""
    candidates = load_candidates()
    return candidates.get(candidate_id)
