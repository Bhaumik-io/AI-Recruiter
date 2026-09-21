# AI Recruiter v2 — FastAPI + React

> The original MVP (Streamlit version) lives on the [`v1` branch](https://github.com/Bhaumik-io/AI-Recruiter/tree/v1).

This is original Streamlit MVP's `core/` logic (resume parsing,
ranking, question generation, answer scoring) re-wired behind a FastAPI
backend, with a new React frontend and four new features: HR/candidate
auth, face-authentication login, an anti-cheat/proctoring monitor, and
AI-generated candidate feedback.

```
ai_recruiter_v2/
├── backend/     FastAPI app — reuses your original core/*.py almost unchanged
└── frontend/    React + Vite + Tailwind — replaces the Streamlit UI
```

## Why this split (read this before changing architecture)

Streamlit reruns the whole page top-to-bottom on every interaction and
has no clean way to hold a persistent webcam stream or push real-time
events — both of which face-auth and anti-cheat need. Splitting into a
stateless REST API (FastAPI) + a stateful browser client (React) is
the standard fix and is what makes deployment predictable later: the
backend can scale independently, and the frontend can be hosted as
static files on a CDN.

Your resume-ranking, question-generation, and answer-scoring logic
(the actual hard part of this project) is unchanged — it was just
lifted out of Streamlit pages into REST endpoints.

---

## 1. Local setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then fill in GEMINI_API_KEY, JWT_SECRET, MONGO_URI
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` to see every endpoint and try them
interactively (this is FastAPI's auto-generated Swagger UI — a big
upgrade over the old MVP's total lack of an API contract).

**Storage:** this now runs on MongoDB, not SQLite — `app/core/storage.py`
was rewritten to talk to Mongo (every function kept the same name/signature,
so nothing in `routers/*.py` had to change). Set `MONGO_URI` in `.env`; it
defaults to `mongodb://localhost:27017` for a local Mongo instance, or point
it at a MongoDB Atlas free-tier connection string for cloud storage. There's
no `data/*.db` file to manage anymore.

**OCR note:** scanned/image PDFs still need Tesseract + Poppler
installed system-side, same as before — see `backend/Dockerfile` for
the exact packages if you want it working in a container.

**Dev-only reset endpoint:** `POST /dev/reset-all` wipes every collection
(candidates, HR users, candidate auth, feedback, proctoring events,
settings) in one call, so you can re-run the whole flow from scratch
without touching Mongo by hand. It's intentionally unauthenticated so it
can be called from logged-out screens too — **remove the `dev_router`
`include_router()` call in `app/main.py` before deploying for real.**

### Frontend

```bash
cd frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:8000
npm run dev
```

The face-api.js model weights are already committed under
`frontend/public/models/` — no separate download step needed.

Visit `http://localhost:5173`. In dev, Vite proxies `/api/*` to the
FastAPI server on port 8000 (see `vite.config.js`), so you don't need
CORS configured for local work.

### Try it end-to-end

1. Go to `/hr/login`, sign up an HR account.
2. Upload a resume PDF + paste a job description → candidates get
   ranked automatically.
3. Shortlist a candidate from the dashboard.
4. Note the `CAND_XXXXXXXX` id shown for that candidate.
5. Go to `/candidate/login` → "First time" tab → sign up with that
   candidate id + an email/password. (Face enrollment happens the
   first time you use "Face login" successfully once you've set up a
   descriptor — see the note below on adding an enroll button to the
   candidate flow if you want it front-and-center.)
6. Take the interview — the small webcam thumbnail bottom-right is the
   anti-cheat monitor running live.
7. Back on the HR dashboard, click "Generate feedback" once the
   candidate finishes — the candidate will see it next time they log in.
8. Want to start over? Hit the dev-reset button on the login screens
   (wired to `POST /dev/reset-all`), or call that endpoint directly.

---

## 2. What's implemented for each feature you asked for

| Feature | Where |
|---|---|
| Candidate face detection | `AntiCheatMonitor.jsx` (continuous, during interview) |
| Face authentication login | `FaceAuth.jsx` + `auth_router.py` (`/auth/face/enroll`, `/auth/face/login`) |
| Feedback to candidate | `feedback_router.py` + candidate interview page (shown after completion) |
| UI advancement | Full React/Tailwind rebuild replacing Streamlit |
| Anti-cheat / warning system | `AntiCheatMonitor.jsx` + `proctoring_router.py` (no-face, multiple-faces, tab-switch, fullscreen-exit, copy/paste) |
| Dev/testing reset | `dev_router.py` (`POST /dev/reset-all`) + `DevResetButton.jsx` |

**Security note on face auth:** the browser computes a 128-number face
descriptor locally and only ever sends that array to the server — never
a photo or video frame. Enrollment stores the descriptor per candidate;
login does a nearest-match search against all enrolled descriptors.
This keeps raw biometric images off your server, which matters a lot
for privacy/compliance once you have real candidates using this.

**What's stubbed / simplified on purpose** (call these out to yourself
before a real launch):
- Face descriptors are compared with a linear scan — fine for hundreds
  of candidates, but swap for a proper vector index (e.g. Atlas Vector
  Search / pgvector) if you scale past that.
- There's no "enroll my face" step wired into the UI yet beyond the
  API — add a button on the candidate dashboard that calls
  `FaceAuth mode="enroll"` once they've done their first password login.
- Proctoring events are logged but there's no auto-disqualify rule for
  most flags — `MAX_CHEAT_WARNINGS` (in `storage.py`, currently 3) does
  auto-end an interview once enough strikes accumulate, but HR still
  makes the final call rather than anything being auto-rejected.
- `dev_router.py` / `POST /dev/reset-all` has no auth and wipes all
  data — fine for local testing, must be removed before a real deploy.

---

## 3. Deployment (so you don't hit surprises)

**Backend** — needs a real process host (not static hosting) because
of the OCR system dependencies:
- Render / Railway / Fly.io all work well with the provided `Dockerfile`.
- Storage is already MongoDB, so there's no SQLite-to-Postgres migration
  needed — just point `MONGO_URI` at a MongoDB Atlas (or other hosted
  Mongo) connection string instead of a local instance before you have
  real concurrent users.
- Set `GEMINI_API_KEY`, `JWT_SECRET` (long random string, not the demo
  default), `MONGO_URI`, and `FRONTEND_ORIGIN` (your deployed frontend
  URL, not `*`) as environment variables on the host.
- Remove the `dev_router` include in `app/main.py` before deploying.

**Frontend** — static hosting is fine:
- Vercel / Netlify / Cloudflare Pages: point at `frontend/`, build
  command `npm run build`, output dir `dist`.
- Set `VITE_API_URL` to your deployed backend's URL at build time.
- Face-api.js model files ship automatically since they live under
  `public/models/` and are already committed — nothing extra to fetch
  in CI.
- **HTTPS is mandatory** for webcam access (`getUserMedia`) to work on
  any domain other than `localhost` — browsers block camera access on
  plain HTTP. Both Vercel/Netlify give you HTTPS by default, so this is
  usually automatic, just don't skip it if you self-host.

---

## 4. Suggested next steps, roughly in priority order

1. Remove `dev_router` (`/dev/reset-all`) from `app/main.py` before any
   real candidates use this.
2. Add rate limiting on `/auth/*` endpoints (brute-force protection).
3. Add an "enroll face" button into the candidate's post-login flow.
4. Add email notifications (interview invite, feedback ready) — you
   already have the candidate's email captured at signup.
5. Move Gemini calls to background tasks/a queue if question generation
   or feedback generation starts feeling slow under load.
6. Swap the linear face-descriptor scan for a proper vector index
   (Atlas Vector Search or similar) once candidate volume grows.
