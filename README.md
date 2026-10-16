# AI Recruiter V3 — Exam + Interview Suite

A hiring and examination platform: HR ranks resumes and runs proctored AI
interviews, and teachers run proctored MST-style exams for a whole class from
one syllabus. FastAPI + React, MongoDB Atlas, Gemini, and in-browser face
recognition.

> History: the original Streamlit MVP is on the [`v1` branch](https://github.com/Bhaumik-io/AI-Recruiter/tree/v1).
> V2 added the FastAPI + React rebuild, face login and anti-cheat. **V3 adds the Exam suite.**

```
ai_recruiter/
├── backend/     FastAPI app (routers, Gemini services, MongoDB storage)
└── frontend/    React + Vite + Tailwind (HR dashboard, candidate and exam pages)
```

## What it does

### Interview suite (HR → candidate)
- Upload resumes + a job description; candidates are parsed and ranked.
- Shortlist, then invite by email. Candidates sign up with their ID and enrol their face.
- Gemini-generated interview questions and answer scoring, plus AI feedback for each candidate.
- Live proctoring during the interview (see *Proctoring* below).
- Video conference scheduling with email notifications.

### Exam suite (teacher → whole class)
1. **Question paper generator.** Upload a syllabus (PDF or photos). Gemini detects chapters and topics. Type which
   chapters ("go with 6 and 7"), pick the style — *Default* (theory), *Application* (scenario) or *+ More* (write
   your own prompt) — and the type: MCQ, fill in the blanks, questions or a mix. Preview, edit and approve.
2. **Exam module.** Upload a student list (.csv / .xlsx). Emails and phone numbers are extracted automatically. Send
   each student a one-time access code by email (or SMS) with one click.
3. **Time window.** Set when the exam opens and closes. The server enforces it: the paper stays hidden until the start
   time, and everyone is auto-submitted at the end.
4. **Students** sign up with their code at one shared link (`/candidate/login`), enrol their face, then take the exam.
5. **Marking.** MCQs are marked instantly in code; fill-ins and written answers are marked by Gemini against model
   answers. Reports show scores, answers and the proctoring log per student. HR can rescore, reset a device,
   delete a paper or clear history. The latest 10 papers are kept automatically.

### Proctoring and anti-cheat
- Mandatory entire-screen share and fullscreen.
- **System check before the exam:** camera working, exactly one clear face, and the face matches the sign-up photo.
  Checked again on the server before the paper is released.
- During the exam: face re-check about once a minute, tab/window switching, looking away, extra faces, copy-paste,
  dev-tools, leaving fullscreen, stopped screen share. Three strikes end the exam and submit the answers so far.
- Camera lost → a blocking overlay until it is restored.
- One device per student, one open exam window at a time, strong passwords, rate-limited login.
- Answers auto-save every 5 seconds, so a crash or reload loses almost nothing.
- Only the face-match numbers and warning events are stored. Video and screen content are never uploaded.

> Browser-based proctoring cannot be made airtight (a second device or a person off camera can still help a
> student). Treat flags as evidence for a teacher to review, and run exams with an invigilator in the room.

## Local setup

**Backend**
```bash
cd backend
python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # then fill it in (table below)
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env             # VITE_API_URL=http://localhost:8000
npm run dev                      # http://localhost:5173
```
The face model files live in `frontend/public/models/` (commit them).

OCR for scanned PDFs needs Tesseract and Poppler installed on the machine (see `backend/Dockerfile`).

## Environment variables (`backend/.env`)

| Variable                                                                      | Purpose |
|-------------------------------------------------------------------------------|---|
| `MONGO_URI`, `MONGO_DB`                                                       | MongoDB connection (Atlas) and database name (default `ai_recruiter`) |
| `JWT_SECRET`                                                                  | Long random string that signs logins. Changing it logs everyone out |
| `HR_ADMIN_ID`, `HR_ADMIN_PASSWORD`                                            | The only HR login that is accepted |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                                              | Gemini access and model name |
| `GEMINI_CONCURRENCY`                                                          | Parallel Gemini calls (use `2` on the free tier) |
| `USE_SEARCH_GROUNDING`                                                        | `true` lets Gemini use Google Search for model answers (needs paid quota). Default off |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `MAIL_ENABLED`                         | Sending access codes and notifications. Use a Gmail **App Password** |
| `FRONTEND_ORIGIN`                                                             | Your deployed frontend URL (comma separated for several) |
| `APP_ENV`                                                                     | `production` hides `/docs` and refuses `*` for CORS |
| `TRUST_PROXY`                                                                 | `true` behind Nginx/Render so rate limits see the real client IP |
| `FACE_MATCH_THRESHOLD`                                                        | Face match strictness, default `0.5` (try `0.55` if students fail in poor light) |
| `ONE_STUDENT_PER_DEVICE`                                                      | `false` if students share lab computers. Default `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`                                         | Optional overrides for a non-Gmail mail server |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM(SMS Not Working Yet)` | Optional, for SMS access codes |
| `DEFAULT_COUNTRY_CODE`, `INVITE_CODE_PREFIX`                                  | Optional, default `+91` and `EXAM` |

Never commit `.env`.

## How to run an exam

1. Log in at `/hr/login` with your `HR_ADMIN_ID` / `HR_ADMIN_PASSWORD`.
2. **Question gen** → add the syllabus → type the chapters → pick style and type → Generate.
3. Edit the paper, set the **exam time window**, then **Approve**. Only one paper is live at a time.
4. **Exam module** → upload the student list → **Send access codes**.
5. Share one link with the class: `https://your-site/candidate/login`.
6. Students sign up with their code, enrol their face, and wait for the start time.
7. After the exam, open **Question gen → Student reports** for scores, answers and integrity flags.

## Deployment

- **Backend** (Render, Railway, Fly.io or a VPS): root `backend`, build `pip install -r requirements.txt`, start
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Use a **single worker**: rate limits and background scoring run
  in-process. Set the variables above and `APP_ENV=production`.
- **Frontend** (Vercel, Netlify): root `frontend`, build `npm run build`, output `dist`, `VITE_API_URL` = backend URL.
  Add `vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}` so page reloads work.
- **HTTPS is required** for camera and screen share.
- **Atlas:** restrict network access where you can, use a strong database password, enable backups.
- Free hosts sleep when idle and may block outgoing mail ports. Wake the site before an exam and send access codes
  ahead of time.

## Known limits

- Free Gemini keys are rate-limited. Prefer mostly MCQ/fill-in papers; use **Rescore all failed** if some marking fails.
- Proctoring runs in the student's browser (see the note above).
- Device locks follow the browser's stored data; HR can reset a student's device from the reports tab.
- Face matching is a 1:1 comparison against the sign-up photo's descriptor, not a vector search.

## Roadmap

- Job queue for scoring that survives restarts
- Server-side proctoring signals and invigilator live view
- Per-student data export and automatic deletion after a retention period

## License / credits

Built by Bhaumik. Uses FastAPI, React, MongoDB, Gemini and face-api.js.
