import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { inviteApi } from "../lib/inviteApi";
import { T } from "../lib/examTheme";

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm";

// ---- access-code CSV (for when e-mail does not arrive: share the codes yourself)
const csvCell = (v) => {
  let t = v == null ? "" : String(v);
  // stop spreadsheets from running text as a formula; keep normal phone numbers like +91 98765 43210
  if (/^[=@\t\r]/.test(t) || (/^[+\-]/.test(t) && !/^[+\-][\d\s()-]+$/.test(t))) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
};

function downloadCodesCsv(view) {
  const state = (r) =>
    r.used ? "Signed up" : r.status === "sent" ? "Code sent" : r.status === "failed" ? "Sending failed" : r.status === "queued" ? "Sending" : "Not sent yet";
  const head = ["Sr No", "Name", "Roll No", "Email", "Phone", "Access Code", "Status"];
  const lines = [head.map(csvCell).join(",")];
  view.invites.forEach((r, i) => {
    lines.push([i + 1, r.name, r.roll, r.email, r.phone, r.code, state(r)].map(csvCell).join(","));
  });
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(view.filename || "students").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_")}_access_codes.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ExamModule() {
  const [file, setFile] = useState(null);
  const [batch, setBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(false);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef(null);

  const loadBatches = () => inviteApi.list().then(setBatches).catch(() => {});
  // On every visit / refresh, reopen the list you were last working on (or the newest one),
  // so the student records are always there.
  useEffect(() => {
    inviteApi
      .list()
      .then((l) => {
        setBatches(l);
        let saved = "";
        try {
          saved = localStorage.getItem("exam_batch_id") || "";
        } catch {}
        const id = l.find((b) => b.batch_id === saved)?.batch_id || l[0]?.batch_id;
        if (id) inviteApi.get(id).then(setBatch).catch(() => {});
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!batch?.batch_id) return;
    try {
      localStorage.setItem("exam_batch_id", batch.batch_id);
    } catch {}
  }, [batch?.batch_id]);

  // keep refreshing while codes are being delivered
  useEffect(() => {
    if (!batch || !batch.counts.queued) return;
    const t = setInterval(() => {
      inviteApi.get(batch.batch_id).then(setBatch).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [batch?.batch_id, batch?.counts?.queued]);

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

  const upload = () =>
    run("Reading student list…", async () => {
      setBatch(await inviteApi.upload(file));
      setFile(null);
      loadBatches();
    });

  const openBatch = (id) => run("Opening…", async () => setBatch(await inviteApi.get(id)));

  const deleteBatch = (id) => {
    if (!window.confirm("Delete this list? Its unused access codes will stop working.")) return;
    run("Deleting…", async () => {
      await inviteApi.remove(id);
      if (batch?.batch_id === id) setBatch(null);
      loadBatches();
    });
  };

  const retry = () =>
    run("Sending…", async () => {
      setBatch(await inviteApi.send(batch.batch_id, batch.last_send));
    });

  const resendOne = (r) =>
    run("Sending…", async () => {
      setBatch(await inviteApi.resend(r.invite_id));
      loadBatches();
    });

  const resetAccount = (r) => {
    if (!window.confirm(`Delete ${r.name || r.email || "this student"}'s account? Their password and face are removed and they can sign up again with the same code. Exam answers already submitted are kept.`)) return;
    run("Deleting account…", async () => {
      setBatch(await inviteApi.resetAccount(r.invite_id));
      loadBatches();
    });
  };

  const s = batch?.stats;
  const skipped = s ? s.duplicates + s.invalid_email + s.invalid_phone : 0;

  return (
    <div className={T.page}>
      <div className="flex items-start justify-between">
        <div>
          <div className={T.eyebrow}>HR workspace</div>
          <h1 className={T.h1}>Exam module</h1>
          <p className={`${T.muted} mt-1`}>
            Upload your student list, then send every student a one-time access code to sign up for the exam.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAdding(true)} className={T.btnGold} title="Add a student manually">
            ＋ Add student
          </button>
          <Link to="/hr/dashboard" className={T.btnGhost}>
            ← Dashboard
          </Link>
        </div>
      </div>

      {error && <div className={T.error}>{error}</div>}
      {busy && <div className={T.info}>{busy}</div>}

      {/* 1. upload */}
      <section className={T.card}>
        <h2 className={T.cardTitle}>1. Upload student list</h2>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={T.drop}
        >
          {file ? file.name : "Drop your CSV / Excel file here or click to browse"}
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files[0] && setFile(e.target.files[0])} />
        </div>
        <div className={T.muted}>
          We look for email and phone columns automatically (name and roll number too), skip duplicates and invalid
          entries, and give each student their own code.
        </div>
        <button disabled={!file || !!busy} onClick={upload} className={T.btnGold}>
          Read student list
        </button>
      </section>

      {/* 2. review + send */}
      {batch && (
        <section className={T.card}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className={T.cardTitle}>2. Students — {batch.filename}</h2>
              <div className={`${T.muted} mt-1`}>
                Detected columns:{" "}
                {["name", "roll", "email", "phone"]
                  .filter((k) => batch.columns[k])
                  .map((k) => `${k} → "${batch.columns[k]}"`)
                  .join(" · ")}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => downloadCodesCsv(batch)} className={T.btnGhost} title="Download every student's access code as a CSV file">
                ⬇ Download codes (CSV)
              </button>
              <button onClick={() => setDialog(true)} disabled={!!busy} className={T.btnGold}>
                Send access codes…
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Students" value={batch.invites.length} />
            <Stat label="With email" value={s.with_email} />
            <Stat label="With phone" value={s.with_phone} />
            <Stat label="Delivered" value={batch.counts.sent} />
            <Stat label="Signed up" value={batch.counts.used} />
          </div>

          {skipped > 0 && (
            <div className={T.muted}>
              Skipped: {s.duplicates} duplicate rows, {s.invalid_email} invalid emails, {s.invalid_phone} invalid phone
              numbers.
            </div>
          )}

          {batch.counts.queued > 0 && (
            <div className={T.info}>
              Sending… {batch.counts.sent} sent, {batch.counts.failed} failed, {batch.counts.queued} waiting.
            </div>
          )}
          {batch.counts.failed > 0 && batch.counts.queued === 0 && batch.last_send && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#f0908a]">{batch.counts.failed} messages failed to send.</span>
              <button onClick={retry} disabled={!!busy} className={T.btnGhost}>
                Retry failed / unsent
              </button>
            </div>
          )}

          <div className="max-h-96 overflow-auto rounded-lg border border-[#1c2230]">
            <table className="w-full">
              <thead className="sticky top-0 bg-[#0f131c]">
                <tr className={T.rowLine}>
                  <th className={`${T.th} px-3`}>Student</th>
                  <th className={T.th}>Email</th>
                  <th className={T.th}>Phone</th>
                  <th className={T.th}>Code</th>
                  <th className={T.th}>Status</th>
                  <th className={T.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batch.invites.map((r) => (
                  <tr key={r.invite_id} className={T.rowLine}>
                    <td className={`${T.td} px-3`}>
                      <div>{r.name || "—"}</div>
                      {r.roll && <div className={T.muted}>{r.roll}</div>}
                    </td>
                    <td className={T.td}>{r.email || "—"}</td>
                    <td className={T.td}>{r.phone || "—"}</td>
                    <td className={`${T.td} font-mono text-[#c9962f]`}>{r.code}</td>
                    <td className={T.td}>
                      <Badge invite={r} />
                      {r.status === "failed" && r.error && (
                        <div className="mt-1 max-w-[14rem] truncate text-[10px] text-[#f0908a]" title={r.error}>
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td className={`${T.td} whitespace-nowrap`}>
                      {!r.used && r.email && (
                        <button className={T.btnLink} disabled={!!busy} onClick={() => resendOne(r)}>
                          {r.status === "sent" ? "Resend" : "Send"}
                        </button>
                      )}
                      {r.used && (
                        <button className={T.btnDanger} disabled={!!busy} onClick={() => resetAccount(r)} title="Delete this account so the student can sign up again">
                          Delete account
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* past lists */}
      {batches.length > 0 && (
        <section className={T.card}>
          <h2 className={T.cardTitle}>Previous lists</h2>
          <div className="space-y-2">
            {batches.map((b) => (
              <div key={b.batch_id} className={`${T.sub} flex items-center justify-between`}>
                <div>
                  <div className="text-xs font-semibold text-white">{b.filename}</div>
                  <div className={T.muted}>
                    {new Date(b.created_at).toLocaleString()} · {b.total} students · {b.counts.sent} sent ·{" "}
                    {b.counts.used} signed up
                  </div>
                </div>
                <div className="space-x-3">
                  <button className={T.btnLink} onClick={() => openBatch(b.batch_id)}>
                    Open
                  </button>
                  <button className={T.btnLink} onClick={() => run("Preparing CSV…", async () => downloadCodesCsv(await inviteApi.get(b.batch_id)))}>
                    Codes CSV
                  </button>
                  <button className={T.btnDanger} onClick={() => deleteBatch(b.batch_id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {adding && (
        <AddStudentDialog
          batchId={batch?.batch_id}
          onClose={() => setAdding(false)}
          onAdded={(view) => {
            setBatch(view);
            setAdding(false);
            loadBatches();
          }}
        />
      )}

      {dialog && batch && (
        <SendDialog
          batch={batch}
          onClose={() => setDialog(false)}
          onSent={(view) => {
            setBatch(view);
            setDialog(false);
            loadBatches();
          }}
        />
      )}
    </div>
  );
}

function AddStudentDialog({ batchId, onClose, onAdded }) {
  const [f, setF] = useState({ name: "", roll: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      onAdded(await inviteApi.addStudent({ ...f, batch_id: batchId || null }));
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className={`${T.card} w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div>
          <div className={T.eyebrow}>Add manually</div>
          <h3 className="text-lg font-semibold text-white">New student</h3>
          <div className={T.muted}>
            {batchId ? "Added to the list you have open." : "Added to a “Manual additions” list."} They get their own
            access code.
          </div>
        </div>
        <input className={T.input} placeholder="Name" value={f.name} onChange={set("name")} />
        <input className={T.input} placeholder="Roll no" value={f.roll} onChange={set("roll")} />
        <input className={T.input} placeholder="Email" value={f.email} onChange={set("email")} />
        <input className={T.input} placeholder="Phone (optional)" value={f.phone} onChange={set("phone")} />
        {err && <div className={T.error}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={T.btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy || (!f.email.trim() && !f.phone.trim())} className={T.btnGold}>
            {busy ? "Adding…" : "Add student"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SendDialog({ batch, onClose, onSent }) {
  const { with_email, with_phone } = batch.stats;
  const [channel, setChannel] = useState(batch.last_send?.channel || (with_email > 0 ? "email" : "phone"));
  const [title, setTitle] = useState(batch.last_send?.exam_title || "MST");
  const [note, setNote] = useState(batch.last_send?.note || "");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  const options = [
    { key: "email", label: "Gmail / Email", count: with_email, unit: "email addresses" },
    { key: "phone", label: "Phone (SMS)", count: with_phone, unit: "phone numbers" },
  ];
  const count = channel === "email" ? with_email : with_phone;

  const send = async () => {
    setSending(true);
    setErr("");
    try {
      onSent(await inviteApi.send(batch.batch_id, { channel, exam_title: title, note }));
    } catch (e) {
      setErr(e.message);
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className={`${T.card} w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div>
          <div className={T.eyebrow}>Next step</div>
          <h3 className="text-lg font-semibold text-white">Send access codes</h3>
        </div>

        <div className="space-y-2">
          <div className={T.muted}>Send codes using</div>
          {options.map((o) => (
            <button
              key={o.key}
              disabled={o.count === 0}
              onClick={() => setChannel(o.key)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                channel === o.key ? "border-[#c9962f] bg-[#1a1608] text-white" : "border-[#1c2230] bg-[#0a0d14] text-[#cfd3dc]"
              }`}
            >
              <span>{o.label}</span>
              <span className="text-xs text-[#6b7385]">
                {o.count} {o.unit} found
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Exam name, e.g. MST 1 – Cloud Computing" className={T.input} />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note, e.g. date and venue"
            className={T.input}
          />
        </div>

        {err && <div className={T.error}>{err}</div>}

        <div className="flex items-center justify-between">
          <span className={T.muted}>
            {count} student{count === 1 ? "" : "s"} will get a code
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className={T.btnGhost}>
              Cancel
            </button>
            <button onClick={send} disabled={sending || count === 0 || !title.trim()} className={T.btnGold}>
              {sending ? "Sending…" : "Send codes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-[#1c2230] bg-[#0a0d14] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[#6b7385]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Badge({ invite }) {
  let label = invite.status;
  let cls = "bg-[#1c2230] text-[#cfd3dc]";
  if (invite.used) {
    label = "signed up";
    cls = "bg-[#0f2219] text-[#6fd3a0]";
  } else if (invite.status === "sent") {
    label = `sent · ${invite.channel === "phone" ? "SMS" : "email"}`;
    cls = "bg-[#0f1a2b] text-[#8db8ee]";
  } else if (invite.status === "queued") {
    cls = "bg-[#1a1608] text-[#c9962f]";
  } else if (invite.status === "failed") {
    cls = "bg-[#241012] text-[#f0908a]";
  }
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{label}</span>;
}
