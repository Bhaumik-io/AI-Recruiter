"""
answer_scoring.py
Scores a candidate's free-text answer against the "ideal answer"
using the same embedding model as ranking.py (semantic similarity,
not keyword matching).
"""

from core.ranking import get_model
from sentence_transformers import util


def score_answer(candidate_answer: str, ideal_answer: str) -> float:
    """Returns a similarity score between 0 and 1."""
    if not candidate_answer.strip():
        return 0.0

    model = get_model()
    emb1 = model.encode(candidate_answer, convert_to_tensor=True)
    emb2 = model.encode(ideal_answer, convert_to_tensor=True)
    similarity = util.cos_sim(emb1, emb2).item()
    return round(max(similarity, 0.0), 3)


def score_all_answers(qa_pairs: list) -> dict:
    """
    qa_pairs: [{"question": ..., "ideal_answer": ..., "candidate_answer": ...}, ...]
    Returns: {"scores": [0.8, 0.6, ...], "average_score": 0.7}
    """
    scores = []
    for pair in qa_pairs:
        s = score_answer(pair.get("candidate_answer", ""), pair.get("ideal_answer", ""))
        scores.append(s)

    average = round(sum(scores) / len(scores), 3) if scores else 0.0
    return {"scores": scores, "average_score": average}
