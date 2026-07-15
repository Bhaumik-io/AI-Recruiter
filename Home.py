import streamlit as st

st.set_page_config(page_title="AI Recruiter", layout="centered")

st.title("AI Recruiter")
st.write(
    "An end-to-end recruitment assistant: screen resumes, rank candidates, "
    "and run personalized interviews — all in one pipeline."
)

st.markdown("---")
st.subheader("Choose your role")

col1, col2 = st.columns(2)
with col1:
    st.markdown("### HR")
    st.write("Upload resumes, rank candidates, shortlist, and view final reports.")
    st.page_link("pages/1_HR_Dashboard.py", label="Go to HR Dashboard", icon="🧑‍💼")

with col2:
    st.markdown("### Candidate")
    st.write("If you were sent an interview link, open it directly — "
             "or use the Candidate Portal page from the sidebar.")
    st.page_link("pages/2_Candidate_Portal.py", label="Go to Candidate Portal", icon="🎤")
