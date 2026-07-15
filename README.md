AI Recruiter — End-to-End Candidate Screening & Interview System
An AI-powered recruitment pipeline: bulk resume screening, semantic ranking,
personalized AI-generated interviews, and a combined final report — across
two portals (HR and Candidate).
Features
Bulk resume upload (PDF, including scanned/image PDFs via OCR fallback)
Semantic similarity ranking using sentence-transformer embeddings (not keyword matching)
Chunked embedding comparison so long resumes aren't silently truncated
Shortlisting workflow with auto-generated candidate interview links
LLM-generated personalized interview questions per candidate
Semantic answer scoring against AI-generated ideal answers
Combined final report (resume score + interview score)
Tech Stack
Frontend: Streamlit (multipage app)
Embeddings: sentence-transformers (`all-MiniLM-L6-v2`)
LLM: OpenAI API (question generation)
PDF parsing: pdfplumber + pytesseract/pdf2image (OCR fallback)
Storage: JSON file (see "Production Notes" for scaling this up)
---
Local Setup
```bash
# 1. Clone/unzip this project, then:
cd ai-recruiter-mvp
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set your API key
cp .env.example .env
# then edit .env and paste your real OPENAI_API_KEY

# 4. (Optional, for OCR support on scanned PDFs) Install system dependencies:
#    - Tesseract OCR: https://github.com/UB-Mannheim/tesseract/wiki
#    - Poppler: https://github.com/oschwartz10612/poppler-windows/releases
#    Then set the paths in core/resume_parser.py (see comments in that file)

# 5. Run
streamlit run Home.py
```
Open the printed `localhost:8501` link. Use the HR Dashboard to upload
resumes + a job description, rank and shortlist candidates, and generate
interview links. Open a generated link in a new tab to test the Candidate
Portal.
Bulk Testing with a Real Dataset
`load_kaggle_dataset.py` bulk-loads resumes directly from a labeled CSV
dataset (e.g., Kaggle's "Resume Dataset" with `Resume_str`/`Category`
columns), ranks them, and prints a validation comparison. Put your CSV at
`data/Resume.csv` and run:
```bash
python load_kaggle_dataset.py
```
It will prompt you for a job description and target category directly in
the terminal.
---
Deployment (Streamlit Community Cloud — free)
Push this project to a public or private GitHub repository
Go to https://share.streamlit.io and sign in with GitHub
Click "New app", select this repo, set the main file path to `Home.py`
Under Advanced settings → Secrets, add:
```toml
   OPENAI_API_KEY = "sk-your-real-key-here"
   ```
(Streamlit Cloud uses `st.secrets` instead of a local `.env` file — see
"Production Notes" below for the one code change this requires.)
Deploy. You'll get a public URL like `https://your-app-name.streamlit.app`
Note: Streamlit Community Cloud's free tier does not support installing
system-level packages like Tesseract/Poppler, so the OCR fallback for
scanned PDFs will not work on this free deployment — only text-based PDFs
will parse correctly. This is fine for demo purposes; mention it as a known
constraint of the free hosting tier.
---
Production Notes (what an industry-grade version would add)
This project is built as a working proof-of-concept. To honestly call it
production/industry-ready, the following would need to be added — listed
here so you can speak to this directly in a report or interview:
Area	Current (MVP)	Production-grade
Storage	JSON file	PostgreSQL/MySQL with proper schema, indexing
Auth	None (URL-based candidate ID)	Real login (OAuth/JWT) for HR and candidates
Secrets	`.env` file	Secrets manager (AWS Secrets Manager, Streamlit Secrets, etc.)
Bias handling	None	Mask name/gender/college before scoring
Interview logic	Fixed 5 questions	Adaptive follow-up based on answer quality
Scale	Single JSON file, single process	Async task queue for bulk ranking (Celery/RQ), proper API backend
Deployment	Streamlit Cloud (free tier)	Containerized (Docker) on a cloud provider with CI/CD
Monitoring	None	Logging, error tracking (Sentry), usage analytics
Being able to name this gap clearly is itself a strong signal in a viva —
it shows you understand the difference between a working prototype and a
deployable product.
Known Limitations
OCR fallback requires local Tesseract/Poppler install; not available on
free-tier cloud hosting
No authentication — anyone with a candidate link can access that
candidate's interview
JSON file storage is fine for small-scale testing but not concurrent
multi-user production use
Ranking accuracy depends on resume text quality; heavily templated or
very short resumes may score lower even if genuinely relevant