"""
ranking.py
Ranks candidates against a job description using semantic similarity
(sentence embeddings), not keyword matching. This is the core AI/ML piece.

IMPORTANT: embedding models like all-MiniLM-L6-v2 only "read" the first ~256
tokens (roughly 150-200 words) of any text passed to them. A full resume is
often much longer, so embedding it as one single block silently truncates
everything after that point. To fix this, we split each resume into chunks,
embed each chunk separately, and take the BEST-matching chunk's score. This
way relevant experience buried later in a resume still gets captured.
"""

from sentence_transformers import SentenceTransformer, util

_model = None


def get_model():
    """Load the embedding model once and reuse it (loading is slow)."""
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def chunk_text(text: str, max_words: int = 150, overlap: int = 30) -> list:
    """
    Splits text into overlapping word-based chunks so no relevant section
    of a long resume gets silently cut off by the model's token limit.
    """
    words = text.split()
    if len(words) <= max_words:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = start + max_words
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        start += max_words - overlap  # step forward with overlap so context isn't lost at boundaries

    return chunks


def rank_candidates(candidates: dict, jd_text: str) -> list:
    """
    candidates: dict of {candidate_id: {"resume_text": "...", ...}}
    jd_text: the job description text

    Returns a list of dicts sorted by score descending:
    [{"candidate_id": ..., "score": 0.82, "reason": "..."}, ...]
    """
    model = get_model()
    jd_embedding = model.encode(jd_text, convert_to_tensor=True)

    results = []
    for cid, data in candidates.items():
        resume_text = data.get("resume_text", "")
        if not resume_text:
            results.append({
                "candidate_id": cid,
                "score": 0.0,
                "reason": "No extractable text from resume.",
            })
            continue

        chunks = chunk_text(resume_text)
        chunk_embeddings = model.encode(chunks, convert_to_tensor=True)
        chunk_similarities = util.cos_sim(chunk_embeddings, jd_embedding).squeeze(-1)

        # Take the best-matching chunk (captures relevant experience wherever
        # it appears in the resume) rather than just the truncated start.
        best_score = chunk_similarities.max().item()
        best_score = max(best_score, 0.0)  # clip negatives, not meaningful as a "match"

        results.append({
            "candidate_id": cid,
            "score": round(best_score, 3),
            "reason": generate_reason(best_score),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def generate_reason(score: float) -> str:
    """
    Simple, honest, rule-based explanation (no LLM call needed for this part,
    keeps ranking fast and free of API dependency).
    """
    if score >= 0.7:
        return "Strong semantic match with job requirements."
    elif score >= 0.5:
        return "Moderate match — some relevant skills/experience found."
    elif score >= 0.3:
        return "Weak match — limited overlap with job requirements."
    else:
        return "Very low match — resume content differs significantly from job description."
