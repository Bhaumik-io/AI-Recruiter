import { Fragment, useEffect, useState } from "react";
import { examApi } from "../lib/examApi";
import { T } from "../lib/examTheme";

const EVENT_LABELS = {
  no_face: "No face in camera",
  multiple_faces: "Multiple faces in frame",
  face_mismatch: "Face did not match",
  tab_blur: "Switched browser tab",
  window_blur: "Switched to another window/app",
  looking_away: "Looking away from screen",
  fullscreen_exit: "Exited fullscreen",
  copy_paste: "Copy / paste",
  dev_tools_opened: "Developer tools opened",
  screen_share_stopped: "Stopped screen sharing",
  screen_share_not_full: "Shared a window, not the full screen",
  browser_close: "Closed or reloaded the tab",
};

export default function ExamReports() {
  const [papers, setPapers] = useState([]);
  const [paperId, setPaperId] = useState("");
  const [report, setReport] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");

  const [confirm, setConfirm] = useState(""); // "" | "one" | "all"

  const loadPapers = () =>
    examApi
      .listPapers()
      .then((rows) => {
        const approved = rows.filter((p) => p.status === "approved");
        setPapers(approved);
        setPaperId((cur) => (approved.some((p) => p.paper_id === cur) ? cur : approved[0]?.paper_id || ""));
        if (!approved.length) setReport(null);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    loadPapers();
  }, []);

  const doDelete = async () => {
    setError("");
    try {
      if (confirm === "one") await examApi.deletePaper(paperId);
      else await examApi.clearHistory();
      setReport(null);
      setConfirm("");
      await loadPapers();
    } catch (e) {
      setError(e.message);
      setConfirm("");
    }
  };

  const load = () => paperId && examApi.report(paperId).then(setReport).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // auto-refresh while any student is still being scored
    const t = setInterval(() => {
      if (report?.students?.some((s) => s.status === "scoring")) load();
    }, 5000);
    return () => clearInterval(t);
  }, [paperId, report?.students?.length]);

  const current = papers.find((p) => p.paper_id === paperId);

  return (
    <div className="space-y-5">
      {error && <div className={T.error}>{error}</div>}

      <section className={`${T.card} !space-y-0`}>
        <div className="flex flex-wrap items-center gap-3">
          <select value={paperId} onChange={(e) => setPaperId(e.target.value)} className={`${T.input} !w-auto min-w-[16rem]`}>
            {papers.length === 0 && <option>No approved papers yet</option>}
            {papers.map((p) => (
              <option key={p.paper_id} value={p.paper_id}>
                {p.title} {p.is_active ? "(live)" : ""}
              </option>
            ))}
          </select>
          <button onClick={load} className={T.btnGhost}>
            ↻ Refresh
          </button>
          {current?.is_active && (
            <button
              onClick={() => examApi.deactivate(paperId).then(() => window.location.reload())}
              className={`${T.btnGhost} ml-auto !text-[#e0645c]`}
            >
              Stop accepting attempts
            </button>
          )}
          {papers.length > 0 && (
            <div className={`flex items-center gap-2 ${current?.is_active ? "" : "ml-auto"}`}>
              <button onClick={() => setConfirm("one")} disabled={!!current?.is_active} title={current?.is_active ? "Stop the live paper first" : ""} className={`${T.btnGhost} !text-[#e0645c] disabled:opacity-40`}>
                Delete this paper
              </button>
              <button onClick={() => setConfirm("all")} className={`${T.btnGhost} !text-[#e0645c]`}>
                Clear history
              </button>
            </div>
          )}
        </div>
        <div className={`${T.muted} mt-2`}>
          History keeps the latest 10 papers with their student results; older ones are removed automatically. The live paper is never removed.
        </div>
        {confirm && (
          <div className={`${T.sub} mt-3 flex flex-wrap items-center gap-3`}>
            <span className="text-xs text-[#cfd3dc]">
              {confirm === "one"
                ? "Delete this paper and all its student results? This can't be undone."
                : "Delete ALL papers and results except the live one? This can't be undone."}
            </span>
            <button onClick={doDelete} className={`${T.btnGold} !bg-[#e0645c]`}>
              Yes, delete
            </button>
            <button onClick={() => setConfirm("")} className={T.btnGhost}>
              Cancel
            </button>
          </div>
        )}
      </section>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Submitted" value={report.submitted} />
            <Stat label="Scored" value={report.scored} />
            <Stat label="Flagged (cheating)" value={report.flagged ?? 0} warn={(report.flagged ?? 0) > 0} />
            <Stat label="Average" value={report.average != null ? `${report.average} / ${report.max_total}` : "—"} />
          </div>
          {report.students.some((s) => s.status === "score_failed") && (
            <div className={`${T.error} flex items-center gap-3`}>
              Scoring failed for {report.students.filter((s) => s.status === "score_failed").length} student(s).
              <button className={T.btnLink} onClick={() => examApi.rescoreAll(paperId).then(load).catch((e) => setError(e.message))}>
                Rescore all failed
              </button>
            </div>
          )}
          {report.not_submitted > 0 && (
            <div className={T.muted}>
              {report.not_submitted} signed-up student(s) have not submitted this paper (listed below as “not submitted”).
            </div>
          )}

          <section className={T.card}>
            <h2 className={T.cardTitle}>Student results</h2>
            {report.students.length === 0 ? (
              <div className={T.muted}>No submissions yet.</div>
            ) : (
              <table className="w-full">
                <thead className={T.rowLine}>
                  <tr>
                    <th className={T.th}>Student</th>
                    <th className={T.th}>Status</th>
                    <th className={T.th}>Score</th>
                    <th className={T.th}>Integrity</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {report.students.map((s) => {
                    const events = s.proctoring?.events || [];
                    const canOpen = !!s.results || events.length > 0;
                    return (
                      <Fragment key={s.candidate_id}>
                        <tr className={T.rowLine}>
                          <td className={T.td}>
                            <div>{s.name || "—"}</div>
                            <div className="font-mono text-[10px] text-[#6b7385]">
                              {s.roll_no ? `${s.roll_no} · ` : ""}
                              {s.candidate_id}
                            </div>
                          </td>
                          <td className={T.td}>
                            <Badge status={s.status} />
                          </td>
                          <td className={T.td}>{s.total_score != null ? `${s.total_score} / ${s.max_total}` : "—"}</td>
                          <td className={T.td}>
                            <Integrity s={s} />
                          </td>
                          <td className={`${T.td} space-x-3 text-right`}>
                            {s.status === "score_failed" && (
                              <button className={T.btnLink} onClick={() => examApi.rescore(paperId, s.candidate_id).then(load)}>
                                Rescore
                              </button>
                            )}
                            <button
                              className={T.btnLink}
                              title="Let this student use a different device"
                              onClick={() =>
                                window.confirm("Release this student's device lock?") &&
                                examApi.resetDevice(s.candidate_id).catch((e) => setError(e.message))
                              }
                            >
                              Reset device
                            </button>
                            {canOpen && (
                              <button className={T.btnLink} onClick={() => setOpen(open === s.candidate_id ? null : s.candidate_id)}>
                                {open === s.candidate_id ? "Hide" : "Details"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {open === s.candidate_id && (
                          <tr>
                            <td colSpan={5} className="space-y-3 py-3">
                              {events.length > 0 && (
                                <div className={T.sub}>
                                  <div className="mb-2 text-xs font-semibold text-white">
                                    Proctoring log ({events.length} warning{events.length === 1 ? "" : "s"})
                                  </div>
                                  <ul className="space-y-1">
                                    {events.map((e, i) => (
                                      <li key={i} className="flex items-center gap-2 text-xs text-[#cfd3dc]">
                                        <span className="w-20 shrink-0 font-mono text-[10px] text-[#6b7385]">
                                          {new Date(e.at.endsWith("Z") || e.at.includes("+") ? e.at : e.at + "Z").toLocaleTimeString()}
                                        </span>
                                        <span className={e.severity === "high" ? "text-[#f0908a]" : "text-[#e3b552]"}>
                                          {e.severity === "high" ? "●" : "○"}
                                        </span>
                                        <span>{EVENT_LABELS[e.event_type] || e.event_type}</span>
                                        {e.detail && <span className="text-[#6b7385]">({e.detail})</span>}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {(s.results || []).map((r) => (
                                <div key={r.q_no} className={T.sub}>
                                  <div className="text-xs font-semibold text-white">
                                    Q{r.q_no}. {r.question}{" "}
                                    <span className="font-normal text-[#c9962f]">
                                      ({r.score}/{r.max_marks})
                                    </span>
                                  </div>
                                  <div className="mt-1.5 text-xs text-[#cfd3dc]">
                                    Answer: {r.student_answer || <i className="text-[#6b7385]">blank</i>}
                                  </div>
                                  <div className={`${T.muted} mt-1`}>{r.feedback}</div>
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Integrity({ s }) {
  const p = s.proctoring;
  if (!p) return <span className="text-[#6b7385]">—</span>;
  if (p.terminated)
    return (
      <span className="rounded-full bg-[#241012] px-2 py-0.5 text-[11px] text-[#f0908a]">
        ⛔ Cheating · auto-ended ({p.total}/{p.max})
      </span>
    );
  if (p.total > 0)
    return (
      <span className="rounded-full bg-[#1a1608] px-2 py-0.5 text-[11px] text-[#e3b552]">
        ⚠ {p.total}/{p.max} warning{p.total === 1 ? "" : "s"}
      </span>
    );
  return <span className="rounded-full bg-[#0f2219] px-2 py-0.5 text-[11px] text-[#6fd3a0]">✓ Clean</span>;
}

function Stat({ label, value, warn }) {
  return (
    <div className="rounded-xl border border-[#1c2230] bg-[#0f131c] p-4">
      <div className="text-[11px] uppercase tracking-wide text-[#6b7385]">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${warn ? "text-[#f0908a]" : "text-white"}`}>{value}</div>
    </div>
  );
}

function Badge({ status }) {
  const styles = {
    scored: "bg-[#0f2219] text-[#6fd3a0]",
    scoring: "bg-[#0f1a2b] text-[#8db8ee]",
    score_failed: "bg-[#241012] text-[#f0908a]",
    not_submitted: "bg-[#1a1608] text-[#e3b552]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${styles[status] || "bg-[#1c2230] text-[#cfd3dc]"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
