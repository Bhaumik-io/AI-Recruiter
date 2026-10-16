// API helper for the Exam module (HR only, so it always uses the HR token).
const BASE = import.meta.env.VITE_API_URL || "";

async function req(path, { method = "GET", json, form } = {}) {
  const headers = {};
  const token = localStorage.getItem("hr_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
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

export const inviteApi = {
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return req("/exam-invites/upload", { method: "POST", form });
  },
  list: () => req("/exam-invites/batches"),
  get: (id) => req(`/exam-invites/batches/${id}`),
  send: (id, body) => req(`/exam-invites/batches/${id}/send`, { method: "POST", json: body }),
  remove: (id) => req(`/exam-invites/batches/${id}`, { method: "DELETE" }),
};
