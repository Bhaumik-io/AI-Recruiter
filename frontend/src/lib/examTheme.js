// Shared look for the exam pages, matched to the HR dashboard's dark theme.
// To retune colours later, change them here only.
const GOLD = "#c9962f";
const LINE = "#1c2230";

export const T = {
  page: "mx-auto max-w-4xl space-y-5 px-4 py-8 text-[#e6e8ee]",
  eyebrow: "text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c9962f]",
  h1: "text-2xl font-semibold text-white",
  card: "rounded-xl border border-[#1c2230] bg-[#0f131c] p-5 space-y-4",
  cardTitle: "text-sm font-semibold text-white",
  muted: "text-xs text-[#6b7385]",
  input:
    "w-full rounded-lg border border-[#1c2230] bg-[#0a0d14] px-3 py-2 text-sm text-[#e6e8ee] placeholder-[#566074] outline-none focus:border-[#c9962f] disabled:opacity-60",
  btnGold:
    "rounded-md bg-[#c9962f] px-4 py-2 text-xs font-semibold text-[#14100a] hover:bg-[#d8a63f] disabled:cursor-not-allowed disabled:opacity-40",
  btnGhost:
    "rounded-md bg-[#1c2230] px-3 py-2 text-xs font-medium text-[#cfd3dc] hover:bg-[#252d3f] disabled:cursor-not-allowed disabled:opacity-40",
  btnLink: "text-xs text-[#c9962f] hover:underline",
  btnDanger: "text-xs text-[#e0645c] hover:underline",
  error: "rounded-lg border border-[#5a2323] bg-[#241012] p-3 text-xs text-[#f0908a]",
  info: "rounded-lg border border-[#1f3556] bg-[#0f1a2b] p-3 text-xs text-[#8db8ee]",
  success: "rounded-lg border border-[#1f4d36] bg-[#0f2219] p-3 text-xs text-[#6fd3a0]",
  sub: "rounded-lg border border-[#1c2230] bg-[#0a0d14] p-3",
  drop:
    "cursor-pointer rounded-lg border-2 border-dashed border-[#2a3246] p-6 text-center text-xs text-[#6b7385] hover:border-[#c9962f] hover:text-[#cfd3dc]",
  tabs: "flex gap-6 border-b border-[#1c2230] text-xs",
  tab: (active) =>
    `-mb-px pb-2 ${active ? "border-b-2 border-[#c9962f] text-white" : "text-[#6b7385] hover:text-[#cfd3dc]"}`,
  th: "py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#6b7385]",
  td: "py-2.5 text-xs text-[#cfd3dc]",
  rowLine: "border-b border-[#1c2230]",
};

export { GOLD, LINE };
