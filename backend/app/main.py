import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth_router, candidates_router, interview_router, feedback_router, proctoring_router, conference_router, dev_router, exam_router, invite_router

ENV = os.getenv("ENV", "production")
IS_PROD = ENV == "production"

app = FastAPI(
    title="AI Recruiter API",
    version="1.0.0",
    docs_url=None if IS_PROD else "/docs",
    redoc_url=None if IS_PROD else "/redoc",
    openapi_url=None if IS_PROD else "/openapi.json",
)

# In production FRONTEND_ORIGIN MUST be your exact https frontend URL
# e.g. https://ai-recruiter.vercel.app - never "*"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "")

if IS_PROD and (not FRONTEND_ORIGIN or FRONTEND_ORIGIN == "*"):
    raise RuntimeError("FRONTEND_ORIGIN must be set to your https:// frontend URL in production")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN] if IS_PROD else ["*"] if FRONTEND_ORIGIN == "*" else [FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(candidates_router.router)
app.include_router(interview_router.router)
app.include_router(feedback_router.router)
app.include_router(proctoring_router.router)
app.include_router(conference_router.router)
app.include_router(exam_router.router)
app.include_router(invite_router.router)

# TESTING ONLY — disabled in production unless explicitly enabled
if os.getenv("DEV_RESET_ENABLED", "false").lower() == "true":
    app.include_router(dev_router.router)


@app.get("/health")
def health():
    return {"status": "ok"}