// Small fetch helper for the exam module.
// ADJUST: TOKEN_KEY must match where your login stores the JWT, and BASE
// should match how your other API calls reach FastAPI.
const BASE = import.meta.env.VITE_API_URL || "";
const CANDIDATE_PATHS = ["/exam/active", "/exam/history", "/exam/start", "/exam/face-check", "/exam/save", "/exam/submit"];
const tokenFor = (path) =>
  localStorage.getItem(CANDIDATE_PATHS.some((p) => path.startsWith(p)) ? "candidate_token" : "hr_token");

// Browser id (kept in this browser) + window id (new on every page load). They ride
// on the query string so no extra CORS header has to be allowed.
function deviceId() {
  try {
    let d = localStorage.getItem("exam_device_id");
    if (!d) {
      d = crypto.randomUUID();
      localStorage.setItem("exam_device_id", d);
    }
    return d;
  } catch {
    return "nostorage-" + SESSION_ID;
  }
}
const SESSION_ID = crypto.randomUUID();

async function req(path, { method = "GET", json, form } = {}) {
  const headers = {};
  const token = tokenFor(path);
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // browser sets the multipart boundary itself
  }
  if (CANDIDATE_PATHS.some((p) => path.startsWith(p))) {
    path += `${path.includes("?") ? "&" : "?"}device=${encodeURIComponent(deviceId())}&session=${SESSION_ID}`;
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail);
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const examApi = {
  uploadSyllabus: (files) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return req("/exam/syllabus", { method: "POST", form });
  },
  generate: (syllabus_id, prompt, duration_minutes, opts = {}) =>
    req("/exam/papers/generate", {
      method: "POST",
      json: { syllabus_id, prompt, duration_minutes, ...opts }, // opts: { style, qtype, custom_prompt }
    }),
  listPapers: () => req("/exam/papers"),
  getPaper: (id) => req(`/exam/papers/${id}`),
  savePaper: (id, paper) => req(`/exam/papers/${id}`, { method: "PUT", json: paper }),
  approve: (id) => req(`/exam/papers/${id}/approve`, { method: "POST" }),
  deletePaper: (id) => req(`/exam/papers/${id}`, { method: "DELETE" }),
  clearHistory: () => req("/exam/papers/history/all", { method: "DELETE" }),
  resetDevice: (cid) => req(`/exam/devices/${cid}`, { method: "DELETE" }),
  rescoreAll: (id) => req(`/exam/papers/${id}/rescore-all`, { method: "POST" }),
  deactivate: (id) => req(`/exam/papers/${id}/deactivate`, { method: "POST" }),
  report: (id) => req(`/exam/papers/${id}/report`),
  rescore: (id, cid) => req(`/exam/papers/${id}/rescore/${cid}`, { method: "POST" }),
  // HR result review + manual score edits
  submission: (id, cid) => req(`/exam/papers/${id}/submissions/${cid}`),
  editScore: (id, cid, q_no, score, note = "") =>
    req(`/exam/papers/${id}/submissions/${cid}/score`, { method: "PUT", json: { q_no, score, note } }),
  downloadQuestions: async (id, format = "xlsx") => {
    const res = await fetch(`${BASE}/exam/papers/${id}/export?format=${format}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("hr_token")}` },
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Download failed");
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const name = (cd.match(/filename="?([^"]+)"?/) || [])[1] || `questions.${format}`;
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = name;
    document.body.appendChild(el);
    el.click();
    el.remove();
    URL.revokeObjectURL(url);
  },
  reattempt: (id, cid) => req(`/exam/papers/${id}/submissions/${cid}/reattempt`, { method: "POST" }),
  resetScore: (id, cid, q_no) =>
    req(`/exam/papers/${id}/submissions/${cid}/score/reset`, { method: "POST", json: { q_no, score: 0 } }),
  resetStudentPassword: (who, password = "") => req("/exam/students/reset-password", { method: "POST", json: { who, password } }),
  // candidate
  active: () => req("/exam/active"),
  history: () => req("/exam/history"),
  faceCheck: (descriptor) => req("/exam/face-check", { method: "POST", json: { descriptor } }),
  save: (paper_id, answers) => req("/exam/save", { method: "POST", json: { paper_id, answers } }),
  start: () => req("/exam/start", { method: "POST" }),
  submit: (paper_id, answers) => req("/exam/submit", { method: "POST", json: { paper_id, answers } }),
};
