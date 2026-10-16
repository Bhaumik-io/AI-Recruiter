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
import os

from sentence_transformers import SentenceTransformer, util

try:
    import streamlit as st
    IN_STREAMLIT = True
except ImportError:
    IN_STREAMLIT = False  # allows this module to be imported outside Streamlit
                           # (e.g. load_kaggle_dataset.py)

_model = None


def get_model():
    """
    Load the embedding model once and reuse it.
    Cache it in memory so repeated calls don't reload it.
    """
    global _model

    if _model is None:
        model_name = os.getenv(
            "RANKING_EMBEDDING_MODEL",
            "all-MiniLM-L6-v2",
        )
        _model = SentenceTransformer(model_name)
    return _model




if IN_STREAMLIT:
    # Wrap with Streamlit's resource cache too (belt-and-suspenders across
    # sessions), with the default "Running get_model()..." spinner suppressed
    # so it doesn't show up as visible UI noise.
    get_model = st.cache_resource(show_spinner=False)(get_model)


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

    # Build ONE combined list of chunks across ALL candidates, remembering
    # which candidate each chunk belongs to, then encode everything in a
    # single batched model.encode() call instead of one call per candidate.
    # Batching is the single biggest speedup available here since it lets
    # the model process many chunks via vectorized ops instead of paying
    # per-call overhead once per candidate.
    results = []
    all_chunks = []
    chunk_owner = []  # parallel list: candidate id each chunk in all_chunks belongs to
    no_text_ids = []

    for cid, data in candidates.items():
        resume_text = data.get("resume_text", "")
        if not resume_text:
            no_text_ids.append(cid)
            continue
        chunks = chunk_text(resume_text)
        all_chunks.extend(chunks)
        chunk_owner.extend([cid] * len(chunks))

    for cid in no_text_ids:
        results.append({
            "candidate_id": cid,
            "score": 0.0,
            "reason": "No extractable text from resume.",
        })

    if all_chunks:
        # batch_size can be tuned depending on available RAM/CPU; 64 is a
        # safe default that still captures most of the speedup.
        chunk_embeddings = model.encode(
            all_chunks, convert_to_tensor=True, batch_size=64
        )
        chunk_similarities = util.cos_sim(chunk_embeddings, jd_embedding).squeeze(-1)

        # Regroup per-chunk scores back by candidate, keep each
        # candidate's best-matching chunk.
        best_by_candidate = {}
        for cid, sim in zip(chunk_owner, chunk_similarities.tolist()):
            if cid not in best_by_candidate or sim > best_by_candidate[cid]:
                best_by_candidate[cid] = sim

        for cid, best_score in best_by_candidate.items():
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
