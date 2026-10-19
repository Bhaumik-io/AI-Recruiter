"""
embeddings.py
One place that turns text into vectors, used by resume ranking and interview answer scoring.

Backends (EMBEDDING_BACKEND):
  auto    (default)  local sentence-transformers if it is installed, otherwise Gemini
  gemini             always Gemini embeddings (no PyTorch needed)  <- what the slim server uses
  local              always sentence-transformers

Gemini free-tier protection (gemini-embedding-001: about 100 requests/min, 30k tokens/min,
1k requests/day, counted separately from your question-generation model):
  * texts are sent in batches (one API call for up to EMBED_BATCH texts)
  * identical texts are never embedded twice (memory cache + MongoDB cache)
  * a sliding-window limiter keeps tokens/min under EMBED_TPM
  * 429 errors are retried with a pause
  * a daily budget (EMBED_DAILY_BUDGET new texts) stops runaway usage with a clear message
"""
import hashlib
import math
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone

BACKEND = os.getenv("EMBEDDING_BACKEND", "auto").lower()
GEMINI_MODEL = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")
DIM = int(os.getenv("EMBED_DIM", "768"))
BATCH = int(os.getenv("EMBED_BATCH", "50"))
TPM = int(os.getenv("EMBED_TPM", "24000"))  # free tier is 30k tokens/min, keep a margin
DAILY_BUDGET = int(os.getenv("EMBED_DAILY_BUDGET", "800"))  # new texts per day; 0 = no limit
CACHE_DAYS = int(os.getenv("EMBED_CACHE_DAYS", "30"))

_lock = threading.Lock()
_mem_cache: dict = {}
_window: deque = deque()  # (timestamp, tokens) of recent calls
_client_obj = None
_local_model = None
_db_obj = None
_db_failed = False


class EmbeddingError(RuntimeError):
    pass


# ------------------------------------------------------------------ helpers
def cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _tokens(text: str) -> int:
    return int(len(text.split()) * 1.4) + 4


def _use_local() -> bool:
    if BACKEND == "gemini":
        return False
    if BACKEND == "local":
        return True
    try:  # auto
        import sentence_transformers  # noqa: F401
        return True
    except ImportError:
        return False


# ------------------------------------------------------------------ local backend
def get_local_model():
    global _local_model
    if _local_model is None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise EmbeddingError("EMBEDDING_BACKEND=local but sentence-transformers is not installed.")
        _local_model = SentenceTransformer(os.getenv("RANKING_EMBEDDING_MODEL", "all-MiniLM-L6-v2"))
    return _local_model


def _embed_local(texts):
    vecs = get_local_model().encode(texts, batch_size=64, convert_to_numpy=True)
    return [v.tolist() for v in vecs]


# ------------------------------------------------------------------ Mongo (cache + daily budget)
def _db():
    """Best effort: if Mongo is unreachable the cache and budget are skipped, never fatal."""
    global _db_obj, _db_failed
    if _db_obj is not None or _db_failed:
        return _db_obj
    try:
        from pymongo import MongoClient

        c = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"), serverSelectionTimeoutMS=4000)
        _db_obj = c[os.getenv("MONGO_DB_NAME", "ai_recruiter")]
        _db_obj.embedding_cache.create_index("at", expireAfterSeconds=CACHE_DAYS * 86400)
    except Exception:
        _db_failed = True
        _db_obj = None
    return _db_obj


def _key(text: str, task: str) -> str:
    return hashlib.sha256(f"{GEMINI_MODEL}|{DIM}|{task}|{text}".encode("utf-8")).hexdigest()


def _cache_get_many(keys):
    found = {}
    db = _db()
    if db is None or not keys:
        return found
    try:
        for d in db.embedding_cache.find({"_id": {"$in": keys}}):
            found[d["_id"]] = d["v"]
    except Exception:
        pass
    return found


def _cache_put_many(items):
    db = _db()
    if db is None or not items:
        return
    try:
        now = datetime.now(timezone.utc)
        from pymongo import ReplaceOne

        db.embedding_cache.bulk_write(
            [ReplaceOne({"_id": k}, {"_id": k, "v": v, "at": now}, upsert=True) for k, v in items.items()],
            ordered=False,
        )
    except Exception:
        pass


def _spend_budget(n: int):
    if not DAILY_BUDGET:
        return
    db = _db()
    if db is None:
        return
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        doc = db.embedding_usage.find_one_and_update(
            {"_id": day}, {"$inc": {"texts": n}}, upsert=True, return_document=True
        )
        if doc["texts"] > DAILY_BUDGET:
            db.embedding_usage.update_one({"_id": day}, {"$inc": {"texts": -n}})
            raise EmbeddingError(
                f"Daily embedding budget reached ({DAILY_BUDGET} new texts). "
                "Try again tomorrow, or raise EMBED_DAILY_BUDGET."
            )
    except EmbeddingError:
        raise
    except Exception:
        pass


# ------------------------------------------------------------------ Gemini backend
def _client():
    global _client_obj
    if _client_obj is None:
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise EmbeddingError("GEMINI_API_KEY is not set.")
        from google import genai

        _client_obj = genai.Client(api_key=key)
    return _client_obj


def _wait_for_tokens(tokens: int):
    """Sliding 60-second window so we never exceed the tokens-per-minute limit."""
    while True:
        with _lock:
            now = time.time()
            while _window and now - _window[0][0] > 60:
                _window.popleft()
            used = sum(t for _, t in _window)
            if used + tokens <= TPM or not _window:
                _window.append((now, tokens))
                return
            wait = 60 - (now - _window[0][0]) + 0.2
        time.sleep(max(wait, 0.5))


def _call_gemini(batch, task):
    from google.genai import types

    cfg = types.EmbedContentConfig(task_type=task, output_dimensionality=DIM)
    delay = 3
    for attempt in range(5):
        try:
            resp = _client().models.embed_content(model=GEMINI_MODEL, contents=batch, config=cfg)
            vecs = [list(e.values) for e in resp.embeddings]
            if len(vecs) != len(batch):
                raise EmbeddingError("Gemini returned a different number of embeddings than texts.")
            return vecs
        except EmbeddingError:
            raise
        except Exception as e:  # network / quota
            msg = str(e)
            limited = getattr(e, "code", None) == 429 or "429" in msg or "RESOURCE_EXHAUSTED" in msg
            if attempt == 4 or not (limited or "503" in msg or "timed out" in msg.lower()):
                if limited:
                    raise EmbeddingError("Gemini embedding quota is used up for now. Wait a minute and retry.")
                raise EmbeddingError(f"Gemini embedding failed: {msg[:200]}")
            time.sleep(delay)
            delay = min(delay * 2, 30)


def _embed_gemini(texts, task):
    keys = [_key(t, task) for t in texts]
    have = {}
    for k, t in zip(keys, texts):
        if k in _mem_cache:
            have[k] = _mem_cache[k]
    missing_keys = [k for k in dict.fromkeys(keys) if k not in have]
    if missing_keys:
        have.update(_cache_get_many(missing_keys))
    key_to_text = dict(zip(keys, texts))
    todo = [k for k in dict.fromkeys(keys) if k not in have]

    if todo:
        _spend_budget(len(todo))
        new = {}
        i = 0
        while i < len(todo):
            batch_keys, tok = [], 0
            while i < len(todo) and len(batch_keys) < BATCH:
                t = _tokens(key_to_text[todo[i]])
                if batch_keys and tok + t > TPM * 0.8:
                    break
                batch_keys.append(todo[i])
                tok += t
                i += 1
            _wait_for_tokens(tok)
            vecs = _call_gemini([key_to_text[k] for k in batch_keys], task)
            new.update(dict(zip(batch_keys, vecs)))
        have.update(new)
        _mem_cache.update(new)
        _cache_put_many(new)
    for k in keys:
        _mem_cache.setdefault(k, have[k])
    return [have[k] for k in keys]


# ------------------------------------------------------------------ public
def embed(texts, task="SEMANTIC_SIMILARITY"):
    """texts: list[str] -> list of vectors (plain Python lists), same order."""
    texts = [t if t and t.strip() else "(empty)" for t in texts]
    if not texts:
        return []
    if _use_local():
        return _embed_local(texts)
    return _embed_gemini(texts, task)
