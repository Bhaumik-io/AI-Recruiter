import { useEffect, useRef, useState } from "react";

const EMAIL = "bhaumik5173@gmail.com";
const REPO = "https://github.com/Bhaumik-io/AI-Recruiter";
const README = `${REPO}#readme`;
const VERSIONS = `${REPO}/branches`;

// Universal help button: a small round logo at the top-right of every page.
// Mounted once in App.jsx.
export default function HelpButton() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const link = { color: "#c6a154", textDecoration: "underline", wordBreak: "break-all" };

  return (
    <div ref={box} style={{ position: "fixed", top: 14, right: 14, zIndex: 60 }}>
      <button
        type="button"
        aria-label="Help"
        title="Help"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 40, height: 40, borderRadius: "50%", border: "1px solid #2a3140",
          background: "#12161f", cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 0,
          boxShadow: "0 2px 10px rgba(0,0,0,.45)",
        }}
      >
        {/* small logo: face outline with a check */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c6a154" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.7 2.7L16 9.5" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          style={{
            position: "absolute", top: 48, right: 0, width: 290, maxWidth: "calc(100vw - 28px)",
            background: "#12161f", color: "#e9ebf1", border: "1px solid #2a3140",
            borderRadius: 12, padding: 16, fontSize: 13, lineHeight: 1.55,
            boxShadow: "0 10px 30px rgba(0,0,0,.55)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#fff" }}>Need help?</div>
          <p style={{ margin: "0 0 8px" }}>
            Mail on <a style={link} href={`mailto:${EMAIL}`}>{EMAIL}</a> if you have any queries or didn't understand anything.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Or visit the GitHub repo and read the <a style={link} href={README} target="_blank" rel="noreferrer">README.md</a> to
            understand how it works: <a style={link} href={REPO} target="_blank" rel="noreferrer">{REPO.replace("https://", "")}</a>
          </p>
          <p style={{ margin: 0, color: "#8991a5" }}>
            Older versions (V1, V2): <a style={link} href={VERSIONS} target="_blank" rel="noreferrer">see branches</a>
          </p>
        </div>
      )}
    </div>
  );
}
