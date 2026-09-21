"""
interview_router.py
Candidate-facing interview flow, gated behind require_candidate so a
token issued at password/face login is required for every call — this
is the piece that was entirely missing in the Streamlit MVP (anyone
who guessed/knew a candidate id could open ?candidate=CAND_001).
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core import storage
from app.core.question_gen import generate_questions
from app.core.answer_scoring import score_all_answers
from app.deps import require_candidate

router = APIRouter(prefix="/interview", tags=["interview"])


def _own_candidate_or_403(token_payload: dict, candidate_id: str):
    if token_payload["sub"] != candidate_id:
        raise HTTPException(403, "You can only access your own interview")


@router.get("/{candidate_id}/status")
def interview_status(candidate_id: str, token=Depends(require_candidate)):
    _own_candidate_or_403(token, candidate_id)
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    return {
        "shortlisted": bool(candidate.get("shortlisted")),
        "completed": candidate.get("interview_score") is not None,
        "interview_score": candidate.get("interview_score"),
        "terminated": bool(candidate.get("interview_terminated")),
        "termination_reason": candidate.get("termination_reason"),
    }


@router.get("/{candidate_id}/questions")
def get_questions(candidate_id: str, token=Depends(require_candidate)):
    _own_candidate_or_403(token, candidate_id)
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if not candidate.get("shortlisted"):
        raise HTTPException(403, "You have not been shortlisted for interview yet")
    if candidate.get("interview_terminated"):
        raise HTTPException(400, "This interview was auto-ended for suspected cheating")
    if candidate.get("interview_score") is not None:
        raise HTTPException(400, "Interview already completed")

    if not candidate.get("questions"):
        jd_text = storage.get_setting("jd_text", "")
        questions = generate_questions(candidate.get("resume_text", ""), jd_text, num_questions=5)
        storage.update_candidate(candidate_id, {"questions": questions})
        candidate = storage.get_candidate(candidate_id)

    # Never send ideal_answer to the client — that's the answer key.
    return {
        "questions": [
            {"question": q["question"], "type": q.get("type", "general")}
            for q in candidate["questions"]
        ]
    }


class AnswerSubmission(BaseModel):
    answers: list[str]


@router.post("/{candidate_id}/submit")
def submit_answers(candidate_id: str, body: AnswerSubmission, token=Depends(require_candidate)):
    _own_candidate_or_403(token, candidate_id)
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate.get("interview_terminated"):
        raise HTTPException(400, "This interview was auto-ended for suspected cheating and cannot be submitted")
    if candidate.get("interview_score") is not None:
        raise HTTPException(400, "Interview already completed")
    questions = candidate.get("questions") or []
    if len(body.answers) != len(questions):
        raise HTTPException(400, f"Expected {len(questions)} answers, got {len(body.answers)}")
    if any(not a.strip() for a in body.answers):
        raise HTTPException(400, "Please answer all questions before submitting")

    qa_pairs = [
        {"question": q["question"], "ideal_answer": q["ideal_answer"], "candidate_answer": body.answers[i]}
        for i, q in enumerate(questions)
    ]
    result = score_all_answers(qa_pairs)
    storage.update_candidate(candidate_id, {
        "answers": body.answers,
        "answer_scores": result["scores"],
        "interview_score": result["average_score"],
        "completed_at": storage._now_iso(),
    })
    return {"interview_score": result["average_score"], "scores": result["scores"]}
