# AI Recruiter

AI Recruiter is an AI-powered recruitment system developed to simplify the hiring process. The application helps HR professionals screen resumes, rank candidates according to a job description, generate personalized interview questions, and evaluate interview responses using Artificial Intelligence.

The project is developed as a proof-of-concept to demonstrate how AI can assist different stages of the recruitment process.

---

## Features

### Resume Screening
- Upload multiple candidate resumes (PDF)
- Automatic resume text extraction
- OCR support for scanned or image-based PDFs
- Semantic resume ranking based on the Job Description
- Resume match score with ranking explanation

### HR Dashboard
- Upload resumes
- Enter Job Description
- Rank candidates automatically
- Shortlist candidates
- Generate interview links
- View final interview results

### Candidate Portal
- Candidate-specific interview link
- Personalized interview questions
- Technical and behavioral questions
- Submit interview answers
- AI-based interview evaluation

### AI Interview Evaluation
- Personalized question generation using Google Gemini
- AI-generated ideal answers
- Candidate answer scoring
- Overall interview score generation

---

# Technologies Used

| Technology | Purpose |
|------------|---------|
| Python | Programming Language |
| Streamlit | Web Application |
| Google Gemini API | Question Generation and Answer Evaluation |
| Sentence Transformers | Resume Ranking |
| pdfplumber | PDF Text Extraction |
| pytesseract | OCR |
| pdf2image | Image Conversion for OCR |
| JSON | Data Storage (MVP) |

---

# Project Structure

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

# Installation

## 1. Clone the Repository

```bash
git clone https://github.com/Bhaumik-io/AI-Recruiter.git
cd AI-Recruiter
```

---

## 2. Create a Virtual Environment

```bash
python -m venv .venv
```

Activate the environment.

### Windows

```bash
.venv\Scripts\activate
```

### Linux / macOS

```bash
source .venv/bin/activate
```

---

## 3. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## 4. Configure the Gemini API Key

Create a `.env` file in the project folder.

Example:

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

---

## 5. Run the Application

```bash
streamlit run Home.py
```

Open the local URL displayed in the terminal.

---

# OCR Support

The application supports scanned or image-based PDF resumes using OCR.

To enable OCR:

- Install Tesseract OCR
- Install Poppler

After installation, configure the paths inside:

```
core/resume_parser.py
```

If OCR is not installed, the application will still process normal text-based PDF resumes.

---

# Application Workflow

```
HR Dashboard
      │
      ▼
Upload Resumes
      │
      ▼
Resume Parsing
      │
      ▼
OCR (if required)
      │
      ▼
Resume Ranking
      │
      ▼
Candidate Shortlisting
      │
      ▼
Generate Interview Link
      │
      ▼
Candidate Portal
      │
      ▼
Generate Interview Questions
      │
      ▼
Candidate Answers
      │
      ▼
AI Answer Evaluation
      │
      ▼
Final Report
```

---

# Current Limitations

This project is currently implemented as a Minimum Viable Product (MVP).

Some current limitations are:

- JSON is used instead of a database.
- Authentication has not been implemented.
- Candidate access is based on interview links.
- OCR requires local installation of Tesseract and Poppler.
- Voice interviews are not supported.
- Webcam monitoring and anti-cheating features are not implemented.

---

# Future Improvements

Some features planned for future development include:

- User Authentication
- HR, Candidate and Admin Accounts
- PostgreSQL Database
- Docker Support
- Voice-based Interview
- Speech-to-Text
- Interview Scheduling
- Email Notifications
- Webcam Proctoring
- Anti-Cheating Detection
- Cloud Deployment

---

# Author

**Bhaumik Kumar**

Major Project 
