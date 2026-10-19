import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth_router, proctoring_router, exam_router, invite_router

# APP_ENV=production  ->  API docs are hidden and a wildcard CORS origin is refused.
APP_ENV = os.getenv("APP_ENV", "dev").lower()
IS_PROD = APP_ENV == "production"

# EXAM_ONLY=true (default)  ->  only the exam suite is served. The interview, resume-ranking,
# feedback and conference routes are not loaded at all (no endpoints, no heavy imports).
# Set EXAM_ONLY=false to bring the whole recruiter suite back (e.g. on your laptop).
EXAM_ONLY = os.getenv("EXAM_ONLY", "true").lower() == "true"

app = FastAPI(
    title="AI Recruiter API",
    version="1.0.0",
    docs_url=None if IS_PROD else "/docs",
    redoc_url=None if IS_PROD else "/redoc",
    openapi_url=None if IS_PROD else "/openapi.json",
)

# FRONTEND_ORIGIN = your deployed React URL, e.g. https://exam.yourcollege.in
# (several allowed, comma separated). "*" is for local dev only.
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")
origins = [o.strip().rstrip("/") for o in FRONTEND_ORIGIN.split(",") if o.strip()]
if IS_PROD and ("*" in origins or not origins):
    raise RuntimeError("Set FRONTEND_ORIGIN to your real frontend URL when APP_ENV=production")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


app.include_router(auth_router.router)
app.include_router(proctoring_router.router)
app.include_router(exam_router.router)
app.include_router(invite_router.router)

if not EXAM_ONLY:
    from app.routers import candidates_router, interview_router, feedback_router, conference_router

    app.include_router(candidates_router.router)
    app.include_router(interview_router.router)
    app.include_router(feedback_router.router)
    app.include_router(conference_router.router)

# The dev reset router was removed on purpose (it wiped all data without a login).
# For local testing only, you can bring it back:
#   if not IS_PROD:
#       from app.routers import dev_router
#       app.include_router(dev_router.router)


@app.get("/health")
def health():
    return {"status": "ok"}
