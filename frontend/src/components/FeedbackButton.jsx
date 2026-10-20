// frontend/src/components/FeedbackButton.jsx
import { useEffect, useState } from 'react'
import { FEEDBACK_URL, FEEDBACK_GATE, feedbackGiven, markFeedbackGiven } from '../lib/feedback'

// Small "Give feedback" button. Opens the Google Form in a new tab, once marks it as done.
export function FeedbackButton({ role, userId, className = '' }) {
  const [done, setDone] = useState(feedbackGiven(role, userId))
  const url = FEEDBACK_URL[role]
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      onClick={() => { markFeedbackGiven(role, userId); setDone(true) }}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${done ? 'bg-slate-700 text-slate-300' : 'bg-indigo-600 hover:bg-indigo-500 text-slate-950'} ${className}`}>
      {done ? 'Feedback sent ✓ (open again)' : '★ Give feedback'}
    </a>
  )
}

// Wrap the student's result screen. Until they have opened the form once, the result stays
// hidden. (Google Forms cannot tell us they actually submitted, so this is on trust.)
export function FeedbackGate({ userId, children }) {
  const url = FEEDBACK_URL.candidate
  const [done, setDone] = useState(feedbackGiven('candidate', userId))
  const [opened, setOpened] = useState(false)

  // If they close the tab without having given feedback, the browser shows its own
  // "Leave site?" prompt. (Browsers do not allow a page to open a new tab on close.)
  useEffect(() => {
    if (!url || done) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [url, done])

  if (!url || !FEEDBACK_GATE || done) return children
  return (
    <div className="max-w-md mx-auto mt-16 rounded-xl border border-slate-700 bg-slate-900 p-6 text-center space-y-4">
      <h2 className="text-lg font-semibold">One quick step before your result</h2>
      <p className="text-sm text-slate-400">Please fill in the short feedback form. It takes about a minute.</p>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}
        className="inline-block px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium">
        Open feedback form
      </a>
      <div>
        <button disabled={!opened}
          onClick={() => { markFeedbackGiven('candidate', userId); setDone(true) }}
          className="px-4 py-2 rounded-lg bg-emerald-600 disabled:opacity-40 text-sm font-medium">
          I've submitted it. Show my result
        </button>
      </div>
    </div>
  )
}
