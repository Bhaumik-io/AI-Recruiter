import { useEffect, useState } from "react";
import { T } from "../lib/examTheme";
import { FEEDBACK_URL, feedbackGiven, markFeedbackGiven, popupSeen, markPopupSeen } from "../lib/feedback";

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

// One-time popup on the student's result screen. It appears the first time the result is
// shown and never again for this student (in this browser), whether they open the form or
// choose "Later". The Feedback button at the top right stays available.
export function FeedbackPopup({ userId }) {
  const url = FEEDBACK_URL.candidate;
  const [show, setShow] = useState(() => !!url && !popupSeen(userId) && !feedbackGiven("candidate", userId));

  useEffect(() => {
    if (show) markPopupSeen(userId); // counts as shown as soon as it appears
  }, [show]);

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className={`${T.card} w-full max-w-sm text-center`}>
        <div className={T.eyebrow}>Thank you</div>
        <div className={T.cardTitle}>How was your exam experience?</div>
        <div className={T.muted}>Please take a minute to share feedback about the exam and the platform.</div>
        <div className="flex justify-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              markFeedbackGiven("candidate", userId);
              setShow(false);
            }}
            className={T.btnGold}
          >
            Give feedback
          </a>
          <button onClick={() => setShow(false)} className={T.btnGhost}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
