import streamlit as st
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from core.resume_parser import extract_all_resumes
from core.storage import load_candidates, save_candidates
from core.ranking import rank_candidates

st.set_page_config(page_title="HR Dashboard", layout="wide")
st.title("HR Dashboard")
st.caption("Upload resumes, rank candidates, shortlist, and review final results.")

# ---------- STEP 1: Upload resumes ----------
st.header("1. Upload Resumes")
uploaded_files = st.file_uploader(
    "Upload candidate resumes (PDF)",
    type=["pdf"],
    accept_multiple_files=True,
)

jd_text = st.text_area(
    "Paste the Job Description here",
    height=150,
    placeholder="e.g. Looking for a Python developer with experience in machine "
                "learning, data analysis, and REST APIs...",
)

if st.button("Process & Rank Resumes", type="primary"):
    if not uploaded_files:
        st.warning("Please upload at least one resume.")
    elif not jd_text.strip():
        st.warning("Please paste a job description.")
    else:
        with st.spinner("Extracting text and ranking candidates..."):
            new_candidates = extract_all_resumes(uploaded_files)

            existing = load_candidates()
            existing.update(new_candidates)
            existing["_jd_text"] = jd_text
            save_candidates(existing)

            candidate_items = {k: v for k, v in existing.items() if k != "_jd_text"}
            ranked = rank_candidates(candidate_items, jd_text)

            for r in ranked:
                existing[r["candidate_id"]]["resume_score"] = r["score"]
                existing[r["candidate_id"]]["rank_reason"] = r["reason"]
            save_candidates(existing)

        st.success(f"Processed and ranked {len(new_candidates)} resumes.")

# ---------- STEP 2: Ranked list + shortlisting ----------
st.header("2. Ranked Candidates")
all_data = load_candidates()
jd_saved = all_data.get("_jd_text", "")
candidate_items = {k: v for k, v in all_data.items() if k != "_jd_text"}

if not candidate_items:
    st.info("No candidates processed yet. Upload resumes above to get started.")
else:
    sorted_ids = sorted(
        candidate_items.keys(),
        key=lambda cid: candidate_items[cid].get("resume_score", 0),
        reverse=True,
    )

    for rank, cid in enumerate(sorted_ids, start=1):
        data = candidate_items[cid]
        score = data.get("resume_score")
        reason = data.get("rank_reason", "Not ranked yet.")
        score_display = f"{score * 100:.0f}%" if score is not None else "N/A"

        cols = st.columns([1, 3, 2, 4, 2])
        cols[0].markdown(f"**#{rank}**")
        cols[1].markdown(f"**{cid}** — {data.get('filename', '')}")
        cols[2].markdown(f"Match: **{score_display}**")
        cols[3].caption(reason)

        is_shortlisted = data.get("shortlisted", False)
        if cols[4].checkbox("Shortlist", value=is_shortlisted, key=f"shortlist_{cid}"):
            if not is_shortlisted:
                all_data[cid]["shortlisted"] = True
                save_candidates(all_data)
        else:
            if is_shortlisted:
                all_data[cid]["shortlisted"] = False
                save_candidates(all_data)

    st.markdown("---")

    # ---------- STEP 3: Interview links for shortlisted candidates ----------
    st.header("3. Interview Links (Shortlisted Candidates)")
    shortlisted = {cid: d for cid, d in candidate_items.items() if d.get("shortlisted")}

    if not shortlisted:
        st.info("Shortlist at least one candidate above to generate interview links.")
    else:
        base_url = "http://localhost:8501/Candidate_Portal"
        for cid in shortlisted:
            link = f"{base_url}?candidate={cid}"
            st.code(link, language=None)

    st.markdown("---")

    # ---------- STEP 4: Final Report ----------
    st.header("4. Final Report")
    completed = {
        cid: d for cid, d in candidate_items.items()
        if d.get("shortlisted") and d.get("interview_score") is not None
    }

    if not completed:
        st.info("No completed interviews yet. Final scores will appear here once "
                 "shortlisted candidates finish their interview.")
    else:
        report_rows = []
        for cid, d in completed.items():
            resume_score = d.get("resume_score", 0)
            interview_score = d.get("interview_score", 0)
            final_score = 0.5 * resume_score + 0.5 * interview_score
            report_rows.append({
                "Candidate": cid,
                "Resume Match": f"{resume_score * 100:.0f}%",
                "Interview Score": f"{interview_score * 100:.0f}%",
                "Final Score": f"{final_score * 100:.0f}%",
                "_sort_key": final_score,
            })

        report_rows.sort(key=lambda r: r["_sort_key"], reverse=True)
        for row in report_rows:
            del row["_sort_key"]
        st.table(report_rows)
