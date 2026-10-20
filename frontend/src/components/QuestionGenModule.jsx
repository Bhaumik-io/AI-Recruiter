import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { examApi } from "../lib/examApi";
import { T } from "../lib/examTheme";
import ExamReports from "./ExamReports";
import ResultsTab from "./ResultsTab";

// ISO (UTC) <-> the value a <input type="datetime-local"> wants (this computer's local time)
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

export default function QuestionGenModule() {
  const [tab, setTab] = useState("create"); // create | reports | results
  const [files, setFiles] = useState([]);
  const [syllabus, setSyllabus] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(60);
  const [style, setStyle] = useState("default"); // default | scenario | custom
  const [qtype, setQtype] = useState("mix"); // mcq | fill | descriptive | mix
  const [customPrompt, setCustomPrompt] = useState("");
  const [paper, setPaper] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const inputRef = useRef(null);

  const run = async (label, fn) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const addFiles = (list) => setFiles((prev) => [...prev, ...Array.from(list)]);

  const readSyllabus = () =>
    run("Reading syllabus…", async () => {
      setSyllabus(await examApi.uploadSyllabus(files));
      setPaper(null);
      setApproved(false);
    });

  const generate = () =>
    run("Generating paper (this can take a minute)…", async () => {
      setPaper(
        await examApi.generate(syllabus.syllabus_id, prompt, Number(duration), {
          style,
          qtype,
          custom_prompt: style === "custom" ? customPrompt : "",
        })
      );
      setApproved(false);
    });

  const updateQ = (i, patch) =>
    setPaper((p) => ({ ...p, questions: p.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) }));
  const removeQ = (i) => setPaper((p) => ({ ...p, questions: p.questions.filter((_, idx) => idx !== i) }));
  const addQ = () =>
    setPaper((p) => ({
      ...p,
      questions: [
        ...p.questions,
        { q_no: p.questions.length + 1, chapter: null, topic: "", type: "short", question: "", marks: 2, reference_answer: "", key_points: [], sources: [], options: [], answer: "" },
      ],
    }));

  const save = () => run("Saving…", async () => setPaper(await examApi.savePaper(paper.paper_id, paper)));
  const approve = () =>
    run("Approving…", async () => {
      setPaper(await examApi.savePaper(paper.paper_id, paper)); // save edits first
      await examApi.approve(paper.paper_id);
      setApproved(true);
    });

  const totalMarks = paper ? paper.questions.reduce((s, q) => s + Number(q.marks || 0), 0) : 0;

  return (
    <div className={T.page}>
      <div className="flex items-start justify-between">
        <div>
          <div className={T.eyebrow}>HR workspace</div>
          <h1 className={T.h1}>Question paper generator</h1>
        </div>
        <Link to="/hr/dashboard" className={T.btnGhost}>
          ← Dashboard
        </Link>
      </div>

      <div className={T.tabs}>
        <button className={T.tab(tab === "create")} onClick={() => setTab("create")}>
          Create paper
        </button>
        <button className={T.tab(tab === "reports")} onClick={() => setTab("reports")}>
          Student reports
        </button>
        <button className={T.tab(tab === "results")} onClick={() => setTab("results")}>
          Result
        </button>
      </div>

      {tab === "reports" && <ExamReports />}
      {tab === "results" && <ResultsTab />}

      {tab === "create" && (
        <>
          {error && <div className={T.error}>{error}</div>}
          {busy && <div className={T.info}>{busy}</div>}

          {/* Step 1: documents */}
          <section className={T.card}>
            <h2 className={T.cardTitle}>1. Add syllabus (PDF or photos)</h2>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={T.drop}
            >
              Drop files here or click to browse · PDF, PNG, JPG, WEBP
              <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className={`${T.sub} flex items-center justify-between !py-2 text-xs text-[#cfd3dc]`}>
                    <span className="truncate">{f.name}</span>
                    <button className={T.btnDanger} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button disabled={!files.length || !!busy} onClick={readSyllabus} className={T.btnGold}>
              Analyze syllabus
            </button>
          </section>

          {/* Step 2: detected chapters + prompt bar */}
          {syllabus && (
            <section className={T.card}>
              <h2 className={T.cardTitle}>2. Detected chapters — {syllabus.subject || "Subject"}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {syllabus.chapters.map((c) => (
                  <div key={c.number} className={T.sub}>
                    <div className="text-xs font-semibold text-white">
                      Ch {c.number}: {c.title}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[#6b7385]">{c.topics.join(" · ")}</div>
                  </div>
                ))}
              </div>
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Which chapters? e.g. "Go with chapters 6 and 7"'
                className={T.input}
              />

              {/* question style */}
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ["default", "Default", "Theory based"],
                  ["scenario", "Application", "Scenario based"],
                  ["custom", "+ More", "Write your own prompt"],
                ].map(([key, title, sub]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setStyle(key)}
                    className={`rounded-lg border px-3 py-2 text-left ${
                      style === key ? "border-[#c9962f] bg-[#1a1608]" : "border-[#1c2230] bg-[#0a0d14] hover:border-[#2a3246]"
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">{title}</div>
                    <div className="text-[11px] text-[#6b7385]">{sub}</div>
                  </button>
                ))}
              </div>

              {style === "custom" ? (
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={4}
                  className={T.input}
                  placeholder='Tell Gemini how you want the questions, e.g. "15 MCQs on real-world case studies, 5 fill-ups, 2 long 10-mark questions, hard difficulty"'
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={T.muted}>Type:</span>
                  {[
                    ["mcq", "MCQ"],
                    ["fill", "Fill in the blanks"],
                    ["descriptive", "Questions"],
                    ["mix", "Mix"],
                  ].map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setQtype(key)}
                      className={`rounded-md border px-3 py-1 text-xs ${
                        qtype === key ? "border-[#c9962f] text-[#c9962f]" : "border-[#1c2230] text-[#8a93a6] hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="number"
                  min={10}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={`${T.input} !w-24`}
                  title="Duration (minutes)"
                />
                <button
                  disabled={!prompt.trim() || !!busy || (style === "custom" && !customPrompt.trim())}
                  onClick={generate}
                  className={T.btnGold}
                >
                  Generate
                </button>
              </div>
              <div className={T.muted}>The number box is the exam duration in minutes.</div>
            </section>
          )}

          {/* Step 3: preview / edit / approve */}
          {paper && (
            <section className={T.card}>
              <div className="flex items-center justify-between">
                <h2 className={T.cardTitle}>3. Preview, edit and approve</h2>
                <span className={T.muted}>
                  {paper.questions.length} questions · {totalMarks} marks
                </span>
              </div>
              <input
                value={paper.title}
                disabled={approved}
                onChange={(e) => setPaper({ ...paper, title: e.target.value })}
                className={`${T.input} font-semibold`}
              />

              {/* exam time window: enforced by the server clock */}
              <div className={`${T.sub} space-y-2`}>
                <div className="text-xs font-semibold text-white">Exam time window (optional)</div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs text-[#8a93a6]">
                    Opens
                    <input
                      type="datetime-local"
                      disabled={approved}
                      value={toLocalInput(paper.window_start)}
                      onChange={(e) => setPaper({ ...paper, window_start: fromLocalInput(e.target.value) })}
                      className={`${T.input} mt-1`}
                    />
                  </label>
                  <label className="text-xs text-[#8a93a6]">
                    Closes
                    <input
                      type="datetime-local"
                      disabled={approved}
                      value={toLocalInput(paper.window_end)}
                      onChange={(e) => setPaper({ ...paper, window_end: fromLocalInput(e.target.value) })}
                      className={`${T.input} mt-1`}
                    />
                  </label>
                  {!approved && (paper.window_start || paper.window_end) && (
                    <button
                      className={T.btnGhost}
                      onClick={() => setPaper({ ...paper, window_start: null, window_end: null })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className={T.muted}>
                  Students can't open the paper before “Opens” and everyone is auto-submitted at “Closes”. A student who
                  starts late gets only the time left. Leave both empty to keep the exam open whenever it is live. The
                  duration box ({paper.duration_minutes} min) is each student's own limit; whichever ends first applies.
                </div>
              </div>

              {paper.questions.map((q, i) => (
                <div key={i} className={`${T.sub} space-y-2`}>
                  <div className="flex items-start gap-2">
                    <span className="pt-2 text-xs font-semibold text-[#c9962f]">Q{i + 1}</span>
                    <textarea
                      value={q.question}
                      disabled={approved}
                      onChange={(e) => updateQ(i, { question: e.target.value })}
                      rows={2}
                      className={T.input}
                    />
                    <input
                      type="number"
                      min={0}
                      value={q.marks}
                      disabled={approved}
                      onChange={(e) => updateQ(i, { marks: Number(e.target.value) })}
                      className={`${T.input} !w-16`}
                      title="Marks"
                    />
                    {!approved && (
                      <button className={`${T.btnDanger} px-1 pt-2`} onClick={() => removeQ(i)} title="Remove question">
                        ✕
                      </button>
                    )}
                  </div>
                  <div className={T.muted}>
                    Ch {q.chapter ?? "—"} · {q.topic} · {q.type}
                  </div>
                  {q.type === "mcq" && (
                    <div className="space-y-1.5 pl-6">
                      {(q.options || []).map((o, k) => (
                        <div key={k} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`ans-${i}`}
                            disabled={approved}
                            checked={q.answer === "ABCD"[k]}
                            onChange={() => updateQ(i, { answer: "ABCD"[k] })}
                            title="Correct answer"
                          />
                          <span className="text-xs font-semibold text-[#c9962f]">{"ABCD"[k]}</span>
                          <input
                            value={o}
                            disabled={approved}
                            onChange={(e) =>
                              updateQ(i, { options: q.options.map((x, n) => (n === k ? e.target.value : x)) })
                            }
                            className={T.input}
                          />
                        </div>
                      ))}
                      <div className={T.muted}>Select the radio next to the correct option.</div>
                    </div>
                  )}
                  {q.type === "fill" && (
                    <div className="flex items-center gap-2 pl-6">
                      <span className={T.muted}>Correct answer:</span>
                      <input
                        value={q.answer || ""}
                        disabled={approved}
                        onChange={(e) => updateQ(i, { answer: e.target.value })}
                        className={T.input}
                      />
                    </div>
                  )}
                  {q.type !== "mcq" && q.type !== "fill" && (
                  <details>
                    <summary className="cursor-pointer text-xs text-[#8a93a6] hover:text-[#cfd3dc]">
                      Reference answer (used for scoring)
                    </summary>
                    <textarea
                      value={q.reference_answer}
                      disabled={approved}
                      onChange={(e) => updateQ(i, { reference_answer: e.target.value })}
                      rows={4}
                      className={`${T.input} mt-2`}
                    />
                    {q.sources?.length > 0 && (
                      <div className={`${T.muted} mt-1`}>
                        Sources:{" "}
                        {q.sources.slice(0, 3).map((s, k) => (
                          <a key={k} href={s.url} target="_blank" rel="noreferrer" className="mr-2 text-[#c9962f] underline">
                            {s.title || "link"}
                          </a>
                        ))}
                      </div>
                    )}
                  </details>
                  )}
                </div>
              ))}

              {!approved ? (
                <div className="flex gap-2">
                  <button onClick={addQ} className={T.btnGhost}>
                    + Add question
                  </button>
                  <button onClick={save} disabled={!!busy} className={T.btnGhost}>
                    Save draft
                  </button>
                  <button onClick={approve} disabled={!!busy || !paper.questions.length} className={`${T.btnGold} ml-auto`}>
                    Approve &amp; publish to all students
                  </button>
                </div>
              ) : (
                <div className={T.success}>
                  Approved. Every candidate who logs in or signs up will now get this paper. Check the “Student reports”
                  tab for results.
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
