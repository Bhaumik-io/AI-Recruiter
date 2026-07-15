"""
question_gen.py
Generates personalized interview questions from a candidate's resume + JD,
using Gemini. Also generates a brief "ideal answer" per question so we can
later score the candidate's actual answer against it.
"""

import os
import json
import time
from dotenv import load_dotenv
from google import genai
from google.genai.errors import ServerError

load_dotenv()


def get_api_key() -> str:
    """
    Works both locally (.env file) and on Streamlit Community Cloud.
    """
    key = os.getenv("GEMINI_API_KEY")
    if key:
        return key

    try:
        import streamlit as st
        return st.secrets["GEMINI_API_KEY"]
    except Exception:
        return None


client = genai.Client(api_key=get_api_key())


MODEL_NAME = "gemini-3.1-flash-lite"


def generate_questions(resume_text: str, jd_text: str, num_questions: int = 5) -> list:
    """
    Returns:
    [
        {
            "question": "...",
            "ideal_answer": "...",
            "type": "technical"
        },
        ...
    ]
    """

    prompt = f"""
You are an expert technical interviewer.

Job Description:
{jd_text}

Candidate Resume:
{resume_text}

Generate exactly {num_questions} interview questions tailored to this candidate
and this role.

Requirements:
- Mix technical and behavioral questions.
- Every question must be unique.
- Cover different skills, projects, technologies and experiences.
- Avoid repetition.

For each question provide:
- question
- ideal_answer (2-3 sentences)
- type ("technical" or "behavioral")

Return ONLY valid JSON.

Example:

[
  {{
    "question": "...",
    "ideal_answer": "...",
    "type": "technical"
  }}
]
"""

    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )

            raw = response.text.strip()

            if raw.startswith("```"):
                raw = raw.replace("```json", "").replace("```", "").strip()

            questions = json.loads(raw)

            question_texts = [
                q.get("question", "").strip().lower()
                for q in questions
            ]

            if len(set(question_texts)) < len(question_texts):
                print("Warning: Duplicate questions returned. Using fallback.")
                return fallback_questions(num_questions)

            return questions

        except ServerError:
            wait = 2 ** attempt
            print(f"Gemini busy. Retrying in {wait} seconds...")
            time.sleep(wait)

        except Exception as e:
            print(f"Question generation failed: {e}")
            break

    return fallback_questions(num_questions)


def fallback_questions(num_questions: int) -> list:
    """Fallback questions used if Gemini fails."""

    base_questions = [
        {
            "question": "Tell me about a project you're most proud of and your specific role in it.",
            "ideal_answer": "A clear, specific example with measurable results and personal contribution.",
            "type": "behavioral",
        },
        {
            "question": "What technical skill from your resume do you feel most confident in, and why?",
            "ideal_answer": "A specific skill with an example of applying it successfully.",
            "type": "technical",
        },
        {
            "question": "Describe a time you faced a challenge or disagreement at work or college and how you handled it.",
            "ideal_answer": "A specific situation, the action taken, and a positive resolution.",
            "type": "behavioral",
        },
        {
            "question": "How would you approach solving a problem you've never encountered before in this role?",
            "ideal_answer": "A structured approach: understand the problem, research, break it down, test solutions.",
            "type": "technical",
        },
        {
            "question": "Why are you interested in this specific role and how does it fit your career goals?",
            "ideal_answer": "A genuine, specific connection between the role and the candidate's goals and experience.",
            "type": "behavioral",
        },
    ]

    return base_questions[:num_questions]