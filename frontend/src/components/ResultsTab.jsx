import { useEffect, useMemo, useState } from "react";
import { examApi } from "../lib/examApi";
import { T } from "../lib/examTheme";
import { FeedbackButton, FeedbackDialog } from "./FeedbackButton";
import { feedbackGiven } from "../lib/feedback";

const FILTERS = [
  ["all", "All"],
  ["scored", "Scored"],
  ["flagged", "Flagged / cheating"],
  ["terminated", "Auto-ended"],
  ["not_submitted", "Not submitted"],
  ["edited", "Edited by me"],
];
const SORTS = [
  ["high", "Score: high to low"],
  ["low", "Score: low to high"],
  ["name", "Name A-Z"],
];

// Spreadsheet programs run text starting with = + - @ as a formula; neutralise it.
const cell = (v) => {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
};

function downloadCsv(report, rows) {
  // Simple sheet: one row per student, plain-language columns.
  // "26 out of 36" is written in words so Excel does not turn it into a date.
  const head = ["Sr No", "Name", "Roll No", "Marks", "Percent", "Cheating check", "Status"];
  const lines = [head.map(cell).join(",")];
  rows.forEach((s, i) => {
    const has = s.total_score != null;
    const pct = has && s.max_total ? `${Math.round((s.total_score / s.max_total) * 1000) / 10}%` : "";
    const p = s.proctoring;
    const integrity = s.terminated
      ? "Auto-ended (cheating)"
      : p?.total > 0
        ? `${p.total} warning${p.total === 1 ? "" : "s"}`
        : "Clean";
    const status = { scored: "Checked", scoring: "Being checked", score_failed: "Scoring failed", not_submitted: "Not submitted" }[s.status] || s.status;
    const row = [i + 1, s.name || s.candidate_id, s.roll_no, has ? `${s.total_score} out of ${s.max_total}` : "", pct, integrity, status];
    lines.push(row.map(cell).join(","));
  });
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(report.title || "results").replace(/[^\w-]+/g, "_")}_results.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// HR "Result" tab: filter / sort students, open one student's sheet, compare with the ideal
// answer, see the AI's mark and change it. Every edit also updates the student's total.
export default function ResultsTab() {
  const [papers, setPapers] = useState([]);
  const [paperId, setPaperId] = useState("");
  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("high");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null); // candidate_id whose sheet is open
  const [error, setError] = useState("");
  const [showFb, setShowFb] = useState(false); // feedback popup after the CSV download

  useEffect(() => {
    examApi
      .listPapers()
      .then((rows) => {
        const approved = rows.filter((p) => p.status === "approved");
        setPapers(approved);
        setPaperId((approved.find((p) => p.is_active) || approved[0])?.paper_id || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  const load = () => {
    if (!paperId) return;
    setError("");
    examApi.report(paperId).then(setReport).catch((e) => setError(e.message));
  };
  useEffect(load, [paperId]);

  const rows = useMemo(() => {
    let r = [...(report?.students || [])];
    if (filter === "scored") r = r.filter((s) => s.status === "scored");
    if (filter === "flagged") r = r.filter((s) => s.flagged);
    if (filter === "terminated") r = r.filter((s) => s.terminated);
    if (filter === "not_submitted") r = r.filter((s) => s.status === "not_submitted");
    if (filter === "edited") r = r.filter((s) => (s.results || []).some((x) => x.edited));
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((s) => `${s.name} ${s.roll_no} ${s.candidate_id}`.toLowerCase().includes(needle));
    const sc = (s) => (s.total_score == null ? -1 : s.total_score);
    if (sort === "high") r.sort((a, b) => sc(b) - sc(a));
    if (sort === "low") r.sort((a, b) => (a.total_score == null) - (b.total_score == null) || sc(a) - sc(b));
    if (sort === "name") r.sort((a, b) => (a.name || a.candidate_id).localeCompare(b.name || b.candidate_id));
    return r;
  }, [report, filter, sort, q]);

  return (
    <div className="space-y-5">
      {error && <div className={T.error}>{error}</div>}

      <section className={`${T.card} !space-y-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <select value={paperId} onChange={(e) => setPaperId(e.target.value)} className={`${T.input} !w-auto min-w-[16rem]`}>
            {papers.length === 0 && <option>No approved papers yet</option>}
            {papers.map((p) => (
              <option key={p.paper_id} value={p.paper_id}>
                {p.title} {p.is_active ? "(live)" : ""}
              </option>
            ))}
          </select>
          <button onClick={load} className={T.btnGhost}>↻ Refresh</button>
          <button
            onClick={() => {
              if (!report) return;
              downloadCsv(report, rows);
              if (!feedbackGiven("hr", "hr-v2")) setShowFb(true);
            }}
            disabled={!report}
            title="Downloads the students currently shown (filters apply)"
            className={T.btnGhost}
          >
            ⬇ Download CSV
          </button>
          <span className="ml-auto" />
          <FeedbackButton role="hr" userId="hr-v2" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === v ? "border-[#c9962f] text-[#c9962f]" : "border-[#1c2230] text-[#8a93a6] hover:text-white"
              }`}
            >
              {l}
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${T.input} !w-auto !py-1 text-xs`}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / roll no" className={`${T.input} !w-48 !py-1 text-xs`} />
        </div>
        <div className={T.muted}>
          Showing {rows.length} of {report?.students?.length ?? 0}. The CSV contains exactly the students shown, so pick "All" first to export everyone.
        </div>
      </section>

      <section className={T.card}>
        <table className="w-full">
          <thead className={T.rowLine}>
            <tr>
              <th className={T.th}>Student</th>
              <th className={T.th}>Score</th>
              <th className={T.th}>Status</th>
              <th className={T.th}>Integrity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const edited = (s.results || []).some((x) => x.edited);
              const p = s.proctoring;
              return (
                <tr key={s.candidate_id} className={T.rowLine}>
                  <td className={T.td}>
                    <div>{s.name || "—"}</div>
                    <div className="font-mono text-[10px] text-[#6b7385]">
                      {s.roll_no ? `${s.roll_no} · ` : ""}{s.candidate_id}
                    </div>
                  </td>
                  <td className={T.td}>
                    {s.total_score != null ? `${s.total_score} / ${s.max_total}` : "—"}
                    {edited && <span className="ml-1 text-[#e3b552]" title="You edited some marks">✎</span>}
                  </td>
                  <td className={T.td}>{s.status.replaceAll("_", " ")}</td>
                  <td className={T.td}>
                    {s.terminated ? <span className="text-[#f0908a]">⛔ auto-ended</span>
                      : p?.total > 0 ? <span className="text-[#e3b552]">⚠ {p.total}/{p.max}</span>
                      : <span className="text-[#6fd3a0]">✓ clean</span>}
                  </td>
                  <td className={`${T.td} text-right`}>
                    {s.status !== "not_submitted" && (
                      <button className={T.btnLink} onClick={() => setOpen(s.candidate_id)}>Review answers</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className={`${T.td} text-center text-[#6b7385]`}>No students match.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {showFb && <FeedbackDialog role="hr" userId="hr-v2" onClose={() => setShowFb(false)} />}

      {open && <SheetModal paperId={paperId} cid={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function SheetModal({ paperId, cid, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    examApi.submission(paperId, cid).then(setD).catch((e) => setError(e.message));
  }, [cid]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4" onClick={onClose}>
      <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-[#1c2230] bg-[#0a0d14] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-white">
              {d?.name || cid} <span className="font-normal text-[#6b7385]">{d?.roll_no}</span>
            </div>
            {d && (
              <div className="text-xs text-[#8a93a6]">
                Total: <b className="text-white">{d.total_score ?? "—"} / {d.max_total}</b> · {d.status}
              </div>
            )}
            {d?.terminated && <div className="mt-1 text-xs text-[#f0908a]">{d.termination_reason}</div>}
          </div>
          <button onClick={onClose} className={T.btnGhost}>Close ✕</button>
        </div>
        {error && <div className={T.error}>{error}</div>}
        {!d && !error && <div className={T.muted}>Loading…</div>}
        {d?.items.map((it) => (
          <QuestionCard key={it.q_no} it={it} paperId={paperId} cid={cid} onSaved={setD} />
        ))}
        <div className="flex justify-end"><FeedbackButton role="hr" userId="hr-v2" /></div>
      </div>
    </div>
  );
}

function QuestionCard({ it, paperId, cid, onSaved }) {
  const [val, setVal] = useState(it.score ?? 0);
  const [note, setNote] = useState(it.note || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { setVal(it.score ?? 0); setNote(it.note || ""); }, [it.score, it.note]);

  const run = async (fn, ok) => {
    setBusy(true);
    setMsg("");
    try {
      onSaved(await fn());
      setMsg(ok);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${T.sub} space-y-2`}>
      <div className="text-xs font-semibold text-white">
        <span className="text-[#c9962f]">Q{it.q_no}</span> · {it.type} · {it.max_marks} mark(s)
        <div className="mt-1 font-normal text-[#cfd3dc]">{it.question}</div>
      </div>
      {it.options?.length > 0 && (
        <ul className="list-disc pl-5 text-[11px] text-[#8a93a6]">
          {it.options.map((o, i) => <li key={i}>{"ABCD"[i]}. {o}</li>)}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[#1c2230] p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[#6b7385]">Student's answer</div>
          <div className="whitespace-pre-wrap text-xs text-[#e6e8ee]">
            {it.student_answer || <i className="text-[#6b7385]">blank</i>}
          </div>
        </div>
        <div className="rounded-lg border border-[#1c2230] p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[#6b7385]">Ideal answer used by AI</div>
          <div className="whitespace-pre-wrap text-xs text-[#e6e8ee]">{it.ideal_answer || "—"}</div>
          {it.key_points?.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[11px] text-[#8a93a6]">
              {it.key_points.map((k, i) => <li key={i}>{k}</li>)}
            </ul>
          )}
        </div>
      </div>
      {it.feedback && <div className={T.muted}>AI feedback: {it.feedback}</div>}
      {it.missing_points?.length > 0 && (
        <div className="text-[11px] text-[#e3b552]">Missing: {it.missing_points.join("; ")}</div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#cfd3dc]">
        <span>AI mark: <b className="text-white">{it.ai_score ?? "—"}</b></span>
        <label className="flex items-center gap-1">
          Your mark
          <input
            type="number" step="0.5" min="0" max={it.max_marks} value={val}
            onChange={(e) => setVal(e.target.value)}
            className={`${T.input} !w-20 !py-1`}
          />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (only you see this)" className={`${T.input} !w-auto min-w-[10rem] flex-1 !py-1`} />
        <button disabled={busy} className={T.btnGold} onClick={() => run(() => examApi.editScore(paperId, cid, it.q_no, Number(val), note), "Saved")}>
          Save
        </button>
        {it.edited && (
          <button disabled={busy} className={T.btnGhost} onClick={() => run(() => examApi.resetScore(paperId, cid, it.q_no), "Back to AI mark")}>
            Reset to AI
          </button>
        )}
        {it.edited && <span className="text-[#e3b552]">edited</span>}
        {msg && <span className="text-[#8a93a6]">{msg}</span>}
      </div>
    </div>
  );
}
