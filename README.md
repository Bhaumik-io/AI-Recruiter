# 🤖 AI Recruiter

> An AI-powered recruitment platform that automates resume screening, candidate ranking, personalized interview generation, and AI-based interview evaluation.

AI Recruiter helps HR teams streamline the hiring process by leveraging Artificial Intelligence to identify the best candidates through semantic resume analysis and personalized interviews.

---

# ✨ Features

## 📄 Resume Screening

- Upload multiple PDF resumes simultaneously
- Automatic text extraction from resumes
- OCR fallback for scanned or image-based PDFs
- Semantic similarity matching against the Job Description
- AI-generated candidate ranking with reasoning

---

## 👨‍💼 HR Dashboard

- Upload resumes
- Add Job Description
- Rank candidates automatically
- Shortlist candidates
- Generate interview links
- View final interview reports

---

## 👨‍🎓 Candidate Portal

- Secure interview access through candidate-specific links
- Personalized interview questions
- Technical and behavioral interview rounds
- Submit answers through the web portal
- Receive AI-based interview evaluation

---

## 🤖 AI Interview System

Using **Google Gemini**, the application:

- Generates personalized interview questions
- Creates ideal answers for evaluation
- Scores candidate responses
- Calculates an overall interview score

---

# 🛠 Technology Stack

| Category | Technology |
|-----------|------------|
| Language | Python |
| Frontend | Streamlit |
| AI Model | Google Gemini API |
| Resume Ranking | Sentence Transformers |
| PDF Parsing | pdfplumber |
| OCR | pytesseract + pdf2image |
| Storage | JSON (MVP) |

---

# 📁 Project Structure

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
├── README.md
└── .env.example
```

---

# 🚀 Installation

Clone the repository

```bash
git clone https://github.com/Bhaumik-io/AI-Recruiter.git
cd AI-Recruiter
```

Create a virtual environment

```bash
python -m venv .venv
```

Activate it

### Windows

```bash
.venv\Scripts\activate
```

### Linux/macOS

```bash
source .venv/bin/activate
```

Install dependencies

```bash
pip install -r requirements.txt
```

Create a `.env` file

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Run the application

```bash
streamlit run Home.py
```

---

# 📝 OCR Support

The application supports scanned or image-based PDF resumes using OCR.

Install:

- **Tesseract OCR**
- **Poppler**

After installation, update the paths inside:

```
core/resume_parser.py
```

If OCR is not installed, the application will still process standard text-based PDF resumes.

---

# 🔄 Application Workflow

```
Upload Resumes
        │
        ▼
Resume Parsing
        │
        ▼
OCR (if required)
        │
        ▼
Semantic Resume Ranking
        │
        ▼
Candidate Shortlisting
        │
        ▼
Generate Interview Link
        │
        ▼
Candidate Interview
        │
        ▼
Gemini Answer Evaluation
        │
        ▼
Final Hiring Report
```

---

# 📸 Screenshots

> Screenshots will be added in a future update.

Recommended screenshots:

- Home Page
- HR Dashboard
- Candidate Portal
- Final Report

---

# 📊 Current Project Status

This repository represents **Version 1.0 (MVP)**.

The MVP demonstrates the complete AI-powered recruitment workflow, including:

- Resume parsing
- AI resume ranking
- Candidate shortlisting
- AI-generated interviews
- AI answer evaluation

---

# 🚧 Roadmap (Version 2.0)

The next version will introduce:

- JWT Authentication
- HR / Candidate / Admin Login
- PostgreSQL Database
- Docker Support
- FastAPI Backend
- React Frontend
- Voice-based Interviews
- Speech-to-Text Evaluation
- Webcam Proctoring
- Anti-Cheating Detection
- Email Notifications
- Analytics Dashboard
- Cloud Deployment
- CI/CD Pipeline

---

# ⚠ Known Limitations

As this is an MVP:

- Uses JSON storage instead of a database
- No authentication
- Candidate access is link-based
- OCR requires local installation of Tesseract and Poppler
- No interview scheduling
- No voice interview support
- No webcam monitoring

---

# 👨‍💻 Author

**Bhaumik**

AI Recruiter is an ongoing project focused on building an industry-ready AI-powered recruitment platform using modern AI technologies.

---

# ⭐ Support

If you found this project helpful, consider giving it a ⭐ on GitHub.