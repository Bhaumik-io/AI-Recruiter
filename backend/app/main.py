import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth_router, candidates_router, interview_router, feedback_router, proctoring_router, conference_router, dev_router

app = FastAPI(title="AI Recruiter API", version="1.0.0")

# In production, set FRONTEND_ORIGIN to your deployed React URL (e.g.
# https://ai-recruiter.vercel.app). "*" is fine for local dev only.
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN] if FRONTEND_ORIGIN != "*" else ["*"],
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
app.include_router(dev_router.router)  # TESTING ONLY — remove before deploying for real


@app.get("/health")
def health():
    return {"status": "ok"}
