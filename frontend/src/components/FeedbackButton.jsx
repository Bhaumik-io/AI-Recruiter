import { useEffect, useState } from "react";
import { T } from "../lib/examTheme";
import { FEEDBACK_URL, FEEDBACK_GATE, feedbackGiven, markFeedbackGiven } from "../lib/feedback";

// Small "Feedback" button. Opens the Google Form in a new tab and remembers it was opened.
// Only put it on the RESULT screens: opening a new tab during the exam would count as a
// proctoring warning.
export function FeedbackButton({ role, userId }) {
  const [done, setDone] = useState(feedbackGiven(role, userId));
  const url = FEEDBACK_URL[role];
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        markFeedbackGiven(role, userId);
        setDone(true);
      }}
      className={done ? T.btnGhost : T.btnGold}
    >
      {done ? "Feedback sent ✓" : "★ Give feedback"}
    </a>
  );
}

// Wraps the student's score. Until they have opened the form once, the score stays hidden.
// (Google Forms can't tell us the form was really submitted, so this is on trust.)
export function FeedbackGate({ userId, children }) {
  const url = FEEDBACK_URL.candidate;
  const [done, setDone] = useState(feedbackGiven("candidate", userId));
  const [opened, setOpened] = useState(false);

  // Closing the tab before giving feedback shows the browser's own "Leave site?" prompt.
  // (Browsers do not allow a page to open anything when it is closed.)
  useEffect(() => {
    if (!url || done) return;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [url, done]);

  if (!url || !FEEDBACK_GATE || done) return children;
  return (
    <div className={`${T.card} text-center`}>
      <div className={T.eyebrow}>One quick step</div>
      <div className={T.cardTitle}>Please share your feedback to see your result</div>
      <div className={T.muted}>It takes about a minute. Open the form, fill it in, then come back to this tab.</div>
      <div>
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className={T.btnGold}>
          Open feedback form
        </a>
      </div>
      <div>
        <button
          disabled={!opened}
          onClick={() => {
            markFeedbackGiven("candidate", userId);
            setDone(true);
          }}
          className={T.btnGhost}
        >
          I've submitted it. Show my result
        </button>
      </div>
    </div>
  );
}
