"""
answer_scoring.py
Scores a candidate's free-text answer against the "ideal answer"
using embeddings (semantic similarity, not keyword matching).
Embeddings come from app.core.embeddings: local sentence-transformers if installed,
otherwise Gemini embeddings.
"""

from app.core.embeddings import cosine, embed


def score_answer(candidate_answer: str, ideal_answer: str) -> float:
    """Returns a similarity score between 0 and 1."""
    if not candidate_answer.strip():
        return 0.0
    emb1, emb2 = embed([candidate_answer, ideal_answer])
    return round(max(cosine(emb1, emb2), 0.0), 3)


def score_all_answers(qa_pairs: list) -> dict:
    """
    qa_pairs: [{"question": ..., "ideal_answer": ..., "candidate_answer": ...}, ...]
    Returns: {"scores": [0.8, 0.6, ...], "average_score": 0.7}
    All answers and ideals are embedded in ONE batched call (one API request per candidate).
    """
    texts, idx = [], []
    for n, pair in enumerate(qa_pairs):
        cand = (pair.get("candidate_answer") or "")
        if cand.strip():
            idx.append(n)
            texts.extend([cand, pair.get("ideal_answer") or ""])
    vecs = embed(texts) if texts else []

    scores = [0.0] * len(qa_pairs)
    for k, n in enumerate(idx):
        scores[n] = round(max(cosine(vecs[2 * k], vecs[2 * k + 1]), 0.0), 3)

    average = round(sum(scores) / len(scores), 3) if scores else 0.0
    return {"scores": scores, "average_score": average}
