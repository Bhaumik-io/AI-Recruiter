"""Tiny in-memory rate limiter (per process). Fine for one backend process; if you
run several workers, each keeps its own counters (still blocks brute force, just
less strictly). Behind Nginx/Render set TRUST_PROXY=true so the real client IP
(X-Forwarded-For) is used instead of the proxy's."""
import os
import time

from fastapi import HTTPException, Request

TRUST_PROXY = os.getenv("TRUST_PROXY", "false").lower() == "true"
_hits: dict[str, list[float]] = {}


def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


def limit(key: str, max_hits: int, window_seconds: int, message: str = "Too many attempts. Please wait a few minutes.") -> None:
    now = time.time()
    hits = [t for t in _hits.get(key, []) if now - t < window_seconds]
    if len(hits) >= max_hits:
        _hits[key] = hits
        raise HTTPException(429, message)
    hits.append(now)
    _hits[key] = hits
    if len(_hits) > 20000:  # keep memory bounded
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
            _hits.pop(k, None)
