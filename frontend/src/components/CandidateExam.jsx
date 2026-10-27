import { useEffect, useRef, useState } from "react";
import { examApi } from "../lib/examApi";
import { useAuth } from "../context/AuthContext";
import { T } from "../lib/examTheme";
import AntiCheatMonitor from "./AntiCheatMonitor";
import ExamReadiness from "./ExamReadiness";
import { FeedbackButton, FeedbackPopup } from "./FeedbackButton";

// stable (module level) because AntiCheatMonitor keeps the props of its first render
const verifyFace = (descriptor) => examApi.faceCheck(descriptor).then((r) => r.match);

// Exam page for MST students. Uses the same proctoring as the interview:
// mandatory full-screen share + fullscreen gate, then AntiCheatMonitor
// (webcam face checks, tab / window switches, copy-paste, dev tools...).
// The 3rd strike auto-submits whatever has been written so far.
const ALLOW_BACK = true; // set to false to allow forward-only navigation (no going back to earlier questions)

export default function CandidateExam() {
  const { candidateId, logoutCandidate } = useAuth();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [started, setStarted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [gateError, setGateError] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [endedReason, setEndedReason] = useState(""); // set when proctoring auto-ends the exam
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false); // on the camera + face check screen
  const [checkKey, setCheckKey] = useState(0);
  const [checkError, setCheckError] = useState("");
  const [cameraLost, setCameraLost] = useState(false);
  const [monitorKey, setMonitorKey] = useState(0);
  const [saveState, setSaveState] = useState(""); // "", "saved HH:MM:SS", "offline"
  const lastSavedRef = useRef("");
  const [questions, setQuestions] = useState([]); // released by the server only after Start
  const [, setTick] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [qIndex, setQIndex] = useState(0); // one question on screen at a time
  const offsetRef = useRef(0); // server clock minus this computer's clock, in ms

  // The monitor keeps the callbacks from its first render, so anything it
  // triggers must read fresh values from refs, not from state.
  const answersRef = useRef({});
  const paperIdRef = useRef(null);
  const submittingRef = useRef(false);
  const screenRef = useRef(null);
  const camPreRef = useRef(null); // webcam opened before screen sharing

  const load = () =>
    examApi
      .active()
      .then((d) => {
        paperIdRef.current = d.paper?.paper_id ?? null;
        if (d.paper?.server_now) offsetRef.current = Date.parse(d.paper.server_now) - Date.now();
        setData(d);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    return () => screenRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const stopProctoringMedia = () => {
    screenRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    setScreenStream(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  const setAnswer = (n, v) => {
    const next = { ...answersRef.current, [n]: v };
    answersRef.current = next;
    setAnswers(next);
  };

  // Step 1 (one click, needs a user gesture): full-screen share + fullscreen
  async function begin() {
    setGateError("");
    setGateBusy(true);
    // Open the webcam FIRST and let it warm up, then ask for screen sharing. Opening them the other
    // way round gives a black camera picture on some laptops.
    try {
      camPreRef.current?.getTracks().forEach((t) => t.stop());
      camPreRef.current = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
    } catch {
      camPreRef.current = null; // the system check explains any camera problem
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
        audio: false,
      });
      const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
      if (settings.displaySurface && settings.displaySurface !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        setGateError('Please share your ENTIRE screen, not a window or tab. Reopen sharing and choose "Entire screen".');
        setGateBusy(false);
        return;
      }
      screenRef.current = stream;
      setScreenStream(stream);
    } catch (e) {
      const mac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
      setGateError(
        "Screen sharing is required to start the exam: " + (e.message || "permission denied") +
          (mac
            ? ". On a Mac: open System Settings → Privacy & Security → Screen & System Audio Recording, turn ON your browser (Chrome), then fully quit the browser (Cmd+Q), reopen it and try again."
            : ""),
      );
      setGateBusy(false);
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* best effort, same as the interview */
    }
    setGateBusy(false);
    setChecking(true); // -> camera + face check screen
  }

  // Step 2: after the camera and face check passed. The SERVER releases the
  // paper and starts this student's timer (it also re-checks the face pass).
  async function beginExam() {
    setCheckError("");
    setGateBusy(true);
    try {
      const s = await examApi.start();
      setQuestions(s.questions);
      setSecondsLeft(s.remaining_seconds);
      if (s.answers && Object.keys(s.answers).length) {
        answersRef.current = s.answers; // restore what was auto-saved before a reload / crash
        setAnswers(s.answers);
        lastSavedRef.current = JSON.stringify(s.answers);
      }
    } catch (e) {
      setCheckError(e.message);
      setCheckKey((k) => k + 1); // restart the checks (e.g. the face pass expired)
      setGateBusy(false);
      load();
      return;
    }
    setGateBusy(false);
    setStarted(true);
  }

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await examApi.submit(paperIdRef.current, answersRef.current);
    } catch (e) {
      if (!/already submitted/i.test(e.message)) {
        setError(e.message);
        submittingRef.current = false;
        setBusy(false);
        return;
      }
    }
    stopProctoringMedia();
    await load();
    setBusy(false);
  }

  // 3rd strike: lock the exam and submit what is written so far
  const handleTerminated = (reason) => {
    setEndedReason(reason || "Proctoring warnings reached.");
    submit();
  };

  // countdown, auto-submit at zero
  useEffect(() => {
    if (!started || data?.submission || endedReason) return;
    if (secondsLeft <= 0) {
      submit();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [started, secondsLeft, data?.submission, endedReason]);

  // waiting room: tick every second, re-check with the server at start time
  const phase = data?.paper?.phase;
  useEffect(() => {
    if (started || phase !== "waiting") return;
    const t = setInterval(() => {
      setTick((n) => n + 1);
      const left = Date.parse(data.paper.window_start) - (Date.now() + offsetRef.current);
      if (left <= 0) load();
    }, 1000);
    const poll = setInterval(load, 20000);
    return () => {
      clearInterval(t);
      clearInterval(poll);
    };
  }, [started, phase, data?.paper?.window_start]);

  // auto-save the answers every 5 seconds (only when something changed)
  useEffect(() => {
    if (!started || data?.submission || endedReason) return;
    const t = setInterval(async () => {
      const snap = JSON.stringify(answersRef.current);
      if (snap === lastSavedRef.current || !paperIdRef.current) return;
      try {
        await examApi.save(paperIdRef.current, answersRef.current);
        lastSavedRef.current = snap;
        setSaveState("saved " + new Date().toLocaleTimeString());
      } catch {
        setSaveState("offline");
      }
    }, 5000);
    return () => clearInterval(t);
  }, [started, data?.submission, endedReason]);

  // exam-time lockdown: no right-click, view-source, save, print, dev-tools shortcuts
  useEffect(() => {
    if (!started || data?.submission) return;
    const block = (e) => e.preventDefault();
    const onKey = (e) => {
      const k = (e.key || "").toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (
        k === "f12" ||
        (ctrl && e.shiftKey && ["i", "j", "c", "k"].includes(k)) ||
        (ctrl && ["u", "s", "p", "g"].includes(k)) ||
        (e.altKey && e.metaKey && ["i", "j", "c"].includes(k)) ||
        k === "printscreen"
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [started, data?.submission]);

  // poll while the AI is scoring

  // "Your exam is submitted" stays until the exam window has closed (everyone is done)
  // plus 5 minutes, then the page goes back to "No exam is live right now".
  const SUBMITTED_HOLD_MS = 5 * 60 * 1000;
  const subRec = data?.submission;
  const pp = data?.paper;
  const holdUntil =
    subRec && pp
      ? (pp.window_end
          ? Date.parse(pp.window_end)
          : Date.parse(subRec.submitted_at || pp.server_now) + pp.duration_minutes * 60000) + SUBMITTED_HOLD_MS
      : null;
  const showSubmitted = !!subRec && holdUntil !== null && Date.now() + offsetRef.current < holdUntil;

  useEffect(() => {
    if (!showSubmitted) return;
    const wait = holdUntil - (Date.now() + offsetRef.current) + 500;
    const flip = setTimeout(() => setTick((n) => n + 1), Math.min(wait, 2 ** 31 - 1));
    const poll = setInterval(load, 20000); // picks up "window closed" and the final marks
    return () => {
      clearTimeout(flip);
      clearInterval(poll);
    };
  }, [showSubmitted, holdUntil]);

  // Once submitted, going back (Alt+Left, browser Back, swipe) must not return to the exam:
  // the student is logged out and sent to the home page, and has to sign in again.
  const isSubmitted = !!data?.submission;
  useEffect(() => {
    if (!isSubmitted) return;
    const kick = () => {
      try {
        logoutCandidate();
      } catch {}
      window.location.replace("/");
    };
    window.history.pushState({ submitted: true }, "", window.location.href);
    window.history.pushState({ submitted: true }, "", window.location.href);
    window.addEventListener("popstate", kick);
    const onShow = (e) => {
      if (e.persisted) kick(); // page restored from the back/forward cache
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("popstate", kick);
      window.removeEventListener("pageshow", onShow);
    };
  }, [isSubmitted]);

  if (!data)
    return (
      <Page>{error ? <div className={T.error}>{error}</div> : <div className={T.muted}>Loading…</div>}</Page>
    );

  if (!data.paper || (data.submission && !showSubmitted))
    return (
      <Page>
        <div className={T.card}>
          <div className={T.eyebrow}>Exam</div>
          <div className={T.cardTitle}>No exam is live right now.</div>
          <div className={T.muted}>Please check back later.</div>
        </div>
        <HistoryPanel />
        <button onClick={logoutCandidate} className={T.btnGhost}>
          Log out
        </button>
      </Page>
    );

  const { paper, submission } = data;

  // ---- results (after submit)
  if (submission) {
    return (
      <Page>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={T.eyebrow}>{paper.subject || "Exam"}</div>
            <h1 className={T.h1}>{paper.title}</h1>
          </div>
          <FeedbackButton role="candidate" userId={candidateId} />
        </div>
        {submission.terminated && (
          <div className={T.error}>
            ⛔ Your exam was auto-submitted after 3 proctoring warnings. This has been reported to your teacher.
          </div>
        )}
        <div className={T.card}>
          <div className="text-2xl font-semibold text-white">✅ Your exam is submitted</div>
          <div className={T.muted}>
            Please wait quietly until your teacher announces that everyone has finished. Your teacher will share the results.
          </div>
        </div>
        <FeedbackPopup userId={candidateId} />
        <div className="flex gap-2">
          <button onClick={() => setShowHistory((v) => !v)} className={T.btnGhost}>
            {showHistory ? "Hide history" : "History"}
          </button>
          <button onClick={logoutCandidate} className={T.btnGhost}>
            Log out
          </button>
        </div>
        {showHistory && <HistoryPanel />}
      </Page>
    );
  }

  // ---- struck out, answers being submitted
  if (endedReason) {
    return (
      <Page>
        <div className={T.card}>
          <div className={T.eyebrow}>Exam ended</div>
          <h1 className="text-lg font-semibold text-[#f0908a]">⛔ Your exam was ended after 3 proctoring warnings</h1>
          <div className={T.muted}>{endedReason}</div>
          <div className={T.info}>
            {error ? "Could not submit your answers yet." : "Submitting the answers you wrote so far…"}
          </div>
          {error && (
            <>
              <div className={T.error}>{error}</div>
              <button onClick={submit} disabled={busy} className={T.btnGold}>
                Try again
              </button>
            </>
          )}
        </div>
      </Page>
    );
  }

  // ---- before the start time / after the end time
  if (!started && paper.phase === "waiting") {
    const left = Math.max(0, Date.parse(paper.window_start) - (Date.now() + offsetRef.current));
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    return (
      <Page>
        <div className={`${T.card} text-center`}>
          <div className={T.eyebrow}>{paper.subject || "Exam"}</div>
          <h1 className="text-xl font-semibold text-white">{paper.title}</h1>
          <div className={T.muted}>
            Starts at {new Date(paper.window_start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {paper.window_end &&
              ` · ends ${new Date(paper.window_end).toLocaleTimeString([], { timeStyle: "short" })}`}
          </div>
          <div className="font-mono text-3xl text-[#c9962f]">
            {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(sec).padStart(2, "0")}
          </div>
          <div className={T.muted}>
            Keep this page open. The exam unlocks automatically when the time comes. Get your camera and screen-share ready.
          </div>
          <button onClick={logoutCandidate} className={T.btnGhost}>
            Log out
          </button>
        </div>
      </Page>
    );
  }

  if (!started && paper.phase === "closed") {
    return (
      <Page>
        <div className={`${T.card} text-center`}>
          <div className={T.eyebrow}>{paper.subject || "Exam"}</div>
          <h1 className="text-xl font-semibold text-white">{paper.title}</h1>
          <div className={T.error}>This exam window has closed. If you missed it, please contact your teacher.</div>
          <button onClick={logoutCandidate} className={T.btnGhost}>
            Log out
          </button>
        </div>
      </Page>
    );
  }

  // ---- camera + face check
  if (!started && checking) {
    return (
      <Page>
        <ExamReadiness
          key={checkKey}
          screenStream={screenStream}
          cameraStream={camPreRef.current}
          onBegin={beginExam}
          beginBusy={gateBusy}
          error={checkError}
        />
      </Page>
    );
  }

  // ---- gate: screen share + fullscreen, like the interview
  if (!started) {
    return (
      <Page>
        <div className={`${T.card} text-center`}>
          <div className={T.eyebrow}>{paper.subject || "Exam"}</div>
          <h1 className="text-xl font-semibold text-white">{paper.title}</h1>
          <div className={T.muted}>
            {paper.question_count} questions · {paper.duration_minutes} minutes{paper.window_end ? ` · closes at ${new Date(paper.window_end).toLocaleTimeString([], { timeStyle: "short" })} sharp` : ""}
          </div>
          <p className="text-xs leading-relaxed text-[#8a93a6]">
            This exam is proctored. You'll be asked to share your <b className="text-white">entire screen</b> and
            enter fullscreen. Next we check your camera and match your face to your sign-up photo before the exam opens. Your webcam stays on for the whole exam. Switching tabs or windows, leaving
            fullscreen, copy-paste, looking away or having another person in view each count as a warning, and the{" "}
            <b className="text-white">3rd warning ends the exam</b> and submits what you have written. Close other
            apps and put your phone away first.
          </p>
          {gateError && <div className={T.error}>{gateError}</div>}
          <button onClick={begin} disabled={gateBusy} className={T.btnGold}>
            {gateBusy ? "Waiting for permissions…" : "Share screen & start system check"}
          </button>
        </div>
      </Page>
    );
  }

  // ---- the exam itself
  const mm = String(Math.floor((secondsLeft ?? 0) / 60)).padStart(2, "0");
  const ss = String((secondsLeft ?? 0) % 60).padStart(2, "0");

  return (
    <Page>
      <AntiCheatMonitor key={monitorKey} onCameraState={(ok) => setCameraLost(!ok)} candidateId={candidateId} screenStream={screenStream} label="exam" onTerminated={handleTerminated} verifyFn={verifyFace} verifyEveryMs={60000} />

      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1c2230] bg-[#0a0d14] py-3">
        <div>
          <div className={T.eyebrow}>{paper.subject || "Exam"}</div>
          <h1 className={T.h1}>{paper.title}</h1>
        </div>
        <span
          className={`rounded-md border px-3 py-1 font-mono text-sm ${
            secondsLeft < 120 ? "border-[#5a2323] text-[#f0908a]" : "border-[#1c2230] text-[#c9962f]"
          }`}
        >
          {mm}:{ss}
        </span>
      </div>
      <div className="text-right text-[11px] text-[#6b7385]">
        {saveState === "offline" ? <span className="text-[#e0645c]">Not saved — check your internet</span> : saveState ? `✓ ${saveState}` : "Answers auto-save"}
      </div>

      {cameraLost && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-6">
          <div className={`${T.card} max-w-md text-center`}>
            <div className="text-lg font-semibold text-[#f0908a]">Camera lost</div>
            <p className="text-xs text-[#cfd3dc]">
              Your camera stopped. The exam is paused on screen but your timer keeps running. Reconnect the camera or
              allow it in the browser, then press the button. Call your invigilator if it won't come back.
            </p>
            <button className={T.btnGold} onClick={() => { setCameraLost(false); setMonitorKey((k) => k + 1); }}>
              Retry camera
            </button>
          </div>
        </div>
      )}

      {questions.slice(qIndex, qIndex + 1).map((q) => (
        <div key={q.q_no} className={`${T.card} select-none`}>
          <div className="text-sm font-semibold text-white">
            <span className="text-[#c9962f]">Q{q.q_no}.</span> {q.question}{" "}
            <span className="text-xs font-normal text-[#6b7385]">[{q.marks} marks]</span>
          </div>
          {q.type === "mcq" ? (
            <div className="space-y-2">
              {(q.options || []).map((opt, k) => {
                const letter = "ABCD"[k];
                const on = answers[q.q_no] === letter;
                return (
                  <button
                    type="button"
                    key={letter}
                    onClick={() => setAnswer(q.q_no, letter)}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                      on
                        ? "border-[#c9962f] bg-[#1a1608] text-white"
                        : "border-[#1c2230] bg-[#0a0d14] text-[#cfd3dc] hover:border-[#2a3246]"
                    }`}
                  >
                    <span className="font-semibold text-[#c9962f]">{letter}</span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
          ) : q.type === "fill" ? (
            <input
              value={answers[q.q_no] || ""}
              onChange={(e) => setAnswer(q.q_no, e.target.value)}
              className={T.input}
              placeholder="Type the missing word / phrase…"
            />
          ) : (
            <textarea
              rows={q.type === "long" ? 8 : 4}
              value={answers[q.q_no] || ""}
              onChange={(e) => setAnswer(q.q_no, e.target.value)}
              className={T.input}
              placeholder="Type your answer…"
            />
          )}
        </div>
      ))}

      {questions.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setQIndex((i) => Math.max(0, i - 1))}
            disabled={!ALLOW_BACK || qIndex === 0}
            className={T.btnGhost}
          >
            ← Previous
          </button>
          <span className="text-xs text-[#8a93a6]">
            Question {qIndex + 1} of {questions.length} · {questions.filter((x) => (answers[x.q_no] || "").toString().trim()).length} answered
          </span>
          {qIndex < questions.length - 1 ? (
            <button type="button" onClick={() => { setQIndex((i) => i + 1); setConfirming(false); }} className={T.btnGold}>
              Next →
            </button>
          ) : (
            <span className="w-[88px]" />
          )}
        </div>
      )}

      {error && <div className={T.error}>{error}</div>}

      {/* in-page confirm: a native confirm() dialog could trigger a window-blur strike */}
      {qIndex < questions.length - 1 ? null : !confirming ? (
        <button onClick={() => setConfirming(true)} disabled={busy} className={T.btnGold}>
          Submit paper
        </button>
      ) : (
        <div className={`${T.sub} flex items-center gap-3`}>
          <span className="text-xs text-[#cfd3dc]">
            Submit now? You can't change answers afterwards.
            {(() => { const n = questions.filter((x) => !(answers[x.q_no] || "").toString().trim()).length; return n ? ` ${n} question(s) are unanswered.` : ""; })()}
          </span>
          <button onClick={submit} disabled={busy} className={T.btnGold}>
            {busy ? "Submitting…" : "Yes, submit"}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy} className={T.btnGhost}>
            Keep working
          </button>
        </div>
      )}
    </Page>
  );
}

// Must live OUTSIDE CandidateExam: a component defined inside another one gets a
// new identity on every render, which would remount the webcam monitor and make
// the answer boxes lose focus every time the timer ticks.
function HistoryPanel() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    examApi.history().then((d) => setRows(d.history)).catch((e) => setErr(e.message));
  }, []);
  return (
    <div className={T.card}>
      <div className={T.eyebrow}>History</div>
      <div className="mb-2 text-sm font-semibold text-white">Your last 10 exams</div>
      {err && <div className={T.error}>{err}</div>}
      {!rows && !err && <div className={T.muted}>Loading…</div>}
      {rows && rows.length === 0 && <div className={T.muted}>No exams yet.</div>}
      {rows?.map((r) => (
        <div key={r.paper_id + r.submitted_at} className="flex items-center justify-between gap-3 border-t border-[#1c2230] py-2 text-xs">
          <div>
            <div className="text-white">{r.title}</div>
            <div className="text-[#6b7385]">
              {r.subject ? r.subject + " · " : ""}
              {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[#c9962f]">{r.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Page({ children }) {
  return <div className={T.page}>{children}</div>;
}
