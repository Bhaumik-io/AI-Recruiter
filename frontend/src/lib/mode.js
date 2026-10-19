// Exam-only mode is ON unless you set VITE_EXAM_ONLY=false (in frontend/.env for local use).
export const EXAM_ONLY = import.meta.env.VITE_EXAM_ONLY !== 'false'
