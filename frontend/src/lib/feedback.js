// frontend/src/lib/feedback.js
// One Google Form is used for both students and HR. To change it later without editing code,
// set VITE_FEEDBACK_URL in Vercel.
const FORM = import.meta.env.VITE_FEEDBACK_URL || 'https://forms.gle/HMY3YHhoXnf3hb8h7'
export const FEEDBACK_URL = { candidate: FORM, hr: FORM }  // one form for both

const k = (role, id) => `feedback_done:${role}:${id || 'me'}`

export function feedbackGiven(role, id) {
  try { return localStorage.getItem(k(role, id)) === '1' } catch { return false }
}
export function markFeedbackGiven(role, id) {
  try { localStorage.setItem(k(role, id), '1') } catch { /* private window: ignore */ }
}

// The auto popup is shown only once per student (per browser), whether they open the form or not.
const pk = (id) => `feedback_popup_seen:${id || 'me'}`
export function popupSeen(id) {
  try { return localStorage.getItem(pk(id)) === '1' } catch { return false }
}
export function markPopupSeen(id) {
  try { localStorage.setItem(pk(id), '1') } catch { /* ignore */ }
}
