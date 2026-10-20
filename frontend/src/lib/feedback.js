// frontend/src/lib/feedback.js
// One Google Form is used for both students and HR. To change it later without editing code,
// set VITE_FEEDBACK_URL in Vercel. Set VITE_FEEDBACK_GATE=false to stop hiding the student's
// result until they open the form.
const FORM = import.meta.env.VITE_FEEDBACK_URL || 'https://forms.gle/HMY3YHhoXnf3hb8h7'
export const FEEDBACK_URL = { candidate: FORM, hr: FORM }  // one form for both
export const FEEDBACK_GATE = String(import.meta.env.VITE_FEEDBACK_GATE || 'true') === 'true'

const k = (role, id) => `feedback_done:${role}:${id || 'me'}`

export function feedbackGiven(role, id) {
  try { return localStorage.getItem(k(role, id)) === '1' } catch { return false }
}
export function markFeedbackGiven(role, id) {
  try { localStorage.setItem(k(role, id), '1') } catch { /* private window: ignore */ }
}
