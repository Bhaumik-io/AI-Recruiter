"""
feedback_router.py
Turns the resume score + interview Q&A + answer scores into a short,
structured feedback note the candidate can read afterwards. Reuses the
same Gemini client setup as question_gen.py so there's only one place
that knows how to talk to Gemini.
"""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core import storage
from app.core.question_gen import get_client, MODEL_NAME
from app.deps import require_hr, require_candidate

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _build_feedback(candidate: dict) -> dict:
    questions = candidate.get("questions") or []
    answers = candidate.get("answers") or []
    scores = candidate.get("answer_scores") or []

    qa_block = "\n".join(
        f"Q{i+1}: {q['question']}\nAnswer: {answers[i] if i < len(answers) else '(no answer)'}\n"
        f"Score: {scores[i] if i < len(scores) else 'N/A'}"
        for i, q in enumerate(questions)
    )

    prompt = f"""
You are an HR interview coach giving constructive feedback to a candidate.

Resume match score: {candidate.get('resume_score')}
Overall interview score: {candidate.get('interview_score')}

Interview transcript:
{qa_block}

Write feedback as JSON with these exact keys:
- "summary": 2-3 sentence overall impression, encouraging but honest tone.
- "strengths": 2-3 bullet points (as a single string, "- " separated) on what went well.
- "improvements": 2-3 bullet points (same format) on what to work on.
- "recommendation": one of "Strong fit", "Potential fit", "Needs improvement".

Return ONLY valid JSON, nothing else.
"""
    try:
        client = get_client()
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
    except Exception as e:
        print(f"Feedback generation failed, using fallback: {e}")
        score = candidate.get("interview_score") or 0
        data = {
            "summary": "Thanks for completing the interview. Here is a quick automated summary.",
            "strengths": "- Completed all interview questions" if scores else "- N/A",
            "improvements": "- Add more specific, measurable examples to your answers.",
            "recommendation": "Potential fit" if score >= 0.5 else "Needs improvement",
        }
    return data


@router.post("/{candidate_id}/generate")
def generate_feedback(candidate_id: str, _hr=Depends(require_hr)):
    candidate = storage.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate.get("interview_score") is None:
        raise HTTPException(400, "Candidate hasn't completed the interview yet")

    data = _build_feedback(candidate)
    feedback_id = str(uuid.uuid4())
    storage.add_feedback(
        feedback_id, candidate_id,
        data.get("summary", ""), data.get("strengths", ""),
        data.get("improvements", ""), data.get("recommendation", ""),
    )
    return {"feedback_id": feedback_id, **data}


@router.get("/{candidate_id}")
def read_feedback(candidate_id: str, token=Depends(require_candidate)):
    if token["sub"] != candidate_id:
        raise HTTPException(403, "You can only view your own feedback")
    feedback = storage.get_feedback_for_candidate(candidate_id)
    if not feedback:
        raise HTTPException(404, "No feedback available yet")
    return feedback
