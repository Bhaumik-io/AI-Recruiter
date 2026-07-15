# AI Recruiter

AI Recruiter is a recruitment assistance platform developed to simplify the initial hiring process. It helps HR professionals screen resumes, rank candidates based on job requirements, conduct AI-generated interviews, and evaluate candidate responses automatically.

The project was developed using Streamlit as the frontend framework, Google's Gemini API for AI-powered interview generation and answer evaluation, and sentence-transformer embeddings for semantic resume ranking.

> **Current Status:** MVP (Minimum Viable Product)

---

## Features

- Upload multiple resumes in PDF format
- Extract text from both normal and scanned PDFs (OCR supported)
- Match resumes against a Job Description using semantic similarity
- Rank candidates based on resume relevance
- Shortlist candidates from the HR dashboard
- Generate interview links for shortlisted candidates
- Generate personalized interview questions using Google Gemini
- Evaluate candidate answers using AI
- Generate interview scores automatically
- Display a final report combining resume and interview performance

---

## Technology Stack

| Component | Technology |
|------------|------------|
| Frontend | Streamlit |
| AI Model | Google Gemini API |
| Resume Ranking | Sentence Transformers (all-MiniLM-L6-v2) |
| PDF Parsing | pdfplumber |
| OCR | pytesseract + pdf2image |
| Storage | JSON (MVP) |
| Language | Python |

---

## Project Structure

```
AI-Recruiter/
│
├── core/
│   ├── answer_scoring.py
│   ├── question_gen.py
│   ├── ranking.py
│   ├── resume_parser.py
│   └── storage.py
│
├── data/
│   └── candidates.json
│
├── pages/
│   ├── 1_HR_Dashboard.py
│   └── 2_Candidate_Portal.py
│
├── Home.py
├── requirements.txt
├── .env.example
└── README.md
```

---

## How the System Works

### HR Dashboard

1. Upload one or more resumes.
2. Paste the Job Description.
3. The system extracts resume content.
4. Each resume is compared with the Job Description.
5. Candidates are ranked according to their relevance.
6. HR shortlists suitable candidates.
7. Interview links are generated.

### Candidate Portal

1. Candidate opens the interview link.
2. AI generates interview questions based on the resume and job description.
3. Candidate answers the questions.
4. Gemini evaluates the responses.
5. The interview score is stored and shown to HR.

---

## Installation

Clone the repository

```bash
git clone https://github.com/Bhaumik-io/AI-Recruiter.git
```

Move into the project folder

```bash
cd AI-Recruiter
```

Create a virtual environment

```bash
python -m venv .venv
```

Activate the virtual environment

Windows

```bash
.venv\Scripts\activate
```

Linux / macOS

```bash
source .venv/bin/activate
```

Install the required packages

```bash
pip install -r requirements.txt
```

---

## Gemini API Setup

Create a `.env` file in the project directory.

Add your Gemini API key.

```env
GEMINI_API_KEY=YOUR_API_KEY
```

---

## Running the Project

Start the Streamlit application.

```bash
streamlit run Home.py
```

The application will open in your browser.

---

## OCR Support

The project also supports scanned PDF resumes using OCR.

To enable OCR, install:

- Tesseract OCR
- Poppler

After installation, configure their paths inside `core/resume_parser.py`.

If OCR is not installed, the application will still work normally for text-based PDF resumes.

---

## Current Limitations

This project is currently developed as a Minimum Viable Product (MVP). Some limitations are:

- JSON is used instead of a relational database.
- Authentication has not been implemented yet.
- Candidate interview links are URL-based.
- AI response time depends on Gemini API availability.
- Free deployment platforms may not support OCR because of missing system dependencies.

---

## Future Improvements

The following features are planned for future versions:

- HR and Candidate authentication
- PostgreSQL or MySQL integration
- Docker support
- Cloud deployment
- Email notifications
- Voice-based interviews
- Webcam monitoring during interviews
- Anti-cheating mechanisms
- Resume history and analytics
- Admin dashboard
- Candidate performance reports

---

## Screenshots

Screenshots of the HR Dashboard and Candidate Portal will be added after the UI redesign.

---

## Author

**Bhaumik**

Developed as part of an AI-based recruitment system project.

---

## License

This project is intended for educational and learning purposes.