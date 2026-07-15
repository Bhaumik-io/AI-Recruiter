import streamlit as st
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from core.storage import load_candidates, save_candidates, get_candidate
from core.question_gen import generate_questions
from core.answer_scoring import score_all_answers

st.set_page_config(page_title="Candidate Portal", layout="centered")
st.title("Candidate Interview Portal")

candidate_id = st.query_params.get("candidate")

if not candidate_id:
    st.info(
        "No candidate ID found. Please use the interview link provided by HR "
        "(it looks like `?candidate=CAND_001` at the end of the URL)."
    )
    st.stop()

all_data = load_candidates()
candidate = all_data.get(candidate_id)

if not candidate:
    st.error(f"No candidate found with ID `{candidate_id}`.")
    st.stop()

if not candidate.get("shortlisted"):
    st.warning("This candidate has not been shortlisted for interview yet.")
    st.stop()

if candidate.get("interview_score") is not None:
    st.success("You have already completed this interview. Thank you!")
    st.metric("Your Interview Score", f"{candidate['interview_score'] * 100:.0f}%")
    st.caption("(For testing only) You can reset this interview below.")
    if st.button("Reset this interview (testing only)"):
        for key in ["questions", "answers", "answer_scores", "interview_score"]:
            all_data[candidate_id].pop(key, None)
        save_candidates(all_data)
        st.rerun()
    st.stop()

st.write(f"Welcome! You're interviewing for candidate ID: **{candidate_id}**")

# ---------- Generate questions once, cache them ----------
if "questions" not in candidate or not candidate["questions"]:
    with st.spinner("Preparing your personalized questions..."):
        jd_text = all_data.get("_jd_text", "")
        resume_text = candidate.get("resume_text", "")
        questions = generate_questions(resume_text, jd_text, num_questions=5)
        all_data[candidate_id]["questions"] = questions
        save_candidates(all_data)
        candidate = all_data[candidate_id]

questions = candidate["questions"]

st.markdown("---")
st.subheader("Please answer the following questions")

answers = []
with st.form("interview_form"):
    for i, q in enumerate(questions):
        st.markdown(f"**Q{i+1}. {q['question']}**")
        ans = st.text_area(f"Your answer to Q{i+1}", key=f"answer_{i}", height=100)
        answers.append(ans)

    submitted = st.form_submit_button("Submit Interview", type="primary")

if submitted:
    if any(not a.strip() for a in answers):
        st.warning("Please answer all questions before submitting.")
    else:
        with st.spinner("Scoring your answers..."):
            qa_pairs = [
                {
                    "question": q["question"],
                    "ideal_answer": q["ideal_answer"],
                    "candidate_answer": answers[i],
                }
                for i, q in enumerate(questions)
            ]
            result = score_all_answers(qa_pairs)

            all_data[candidate_id]["answers"] = answers
            all_data[candidate_id]["answer_scores"] = result["scores"]
            all_data[candidate_id]["interview_score"] = result["average_score"]
            save_candidates(all_data)

        st.success("Interview submitted successfully! Thank you for your time.")
        st.metric("Your Interview Score", f"{result['average_score'] * 100:.0f}%")
        st.rerun()
