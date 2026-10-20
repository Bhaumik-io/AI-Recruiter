// frontend/src/components/ResultsTab.jsx
// HR "Result" tab: filter/sort students, open one student's sheet, see the AI's marks and the
// ideal answer, and edit marks. Props: paperId (string).
import { useEffect, useMemo, useState } from 'react'
import { hrApi } from '../api/client'
import { FeedbackButton } from './FeedbackButton'

const FILTERS = [
  ['all', 'All'], ['scored', 'Scored'], ['flagged', 'Flagged / cheating'],
  ['terminated', 'Auto-ended'], ['not_submitted', 'Not submitted'], ['edited', 'Edited by me'],
]
// Spreadsheet programs run text starting with = + - @ as a formula; neutralise it.
const cell = (v) => {
  let t = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
  return `"${t.replace(/"/g, '""')}"`
}

function downloadCsv(data, rows) {
  const qn = Math.max(0, ...rows.map((s) => (s.results || []).length))
  const head = ['Name', 'Roll no', 'Candidate ID', 'Status', 'Total', 'Max', 'Percent',
    'Flagged', 'Proctoring events', 'Auto-ended', 'Submitted at', 'Edited by HR']
  for (let i = 1; i <= qn; i++) head.push(`Q${i} mark`)
  const lines = [head.map(cell).join(',')]
  for (const s of rows) {
    const res = s.results || []
    const pct = s.total_score != null && s.max_total ? Math.round((s.total_score / s.max_total) * 1000) / 10 : ''
    const row = [s.name, s.roll_no, s.candidate_id, s.status, s.total_score ?? '', s.max_total ?? '', pct,
      s.flagged ? 'Yes' : 'No', s.proctoring?.total ?? 0, s.terminated ? 'Yes' : 'No',
      s.submitted_at || '', res.some((x) => x.edited) ? 'Yes' : 'No']
    for (let i = 0; i < qn; i++) row.push(res[i] ? res[i].score : '')
    lines.push(row.map(cell).join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(data.title || 'results').replace(/[^\w-]+/g, '_')}_results.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const SORTS = [['high', 'Score: high to low'], ['low', 'Score: low to high'], ['name', 'Name A-Z']]

export default function ResultsTab({ paperId }) {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('high')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // candidate_id being reviewed
  const [err, setErr] = useState('')

  async function load() {
    try {
      setErr('')
      const res = await hrApi.get(`/exam/papers/${paperId}/report`)
      setData(res.data)
    } catch (e) { setErr(e.response?.data?.detail || 'Could not load results') }
  }
  useEffect(() => { if (paperId) load() }, [paperId])

  const rows = useMemo(() => {
    let r = [...(data?.students || [])]
    if (filter === 'scored') r = r.filter((s) => s.status === 'scored')
    if (filter === 'flagged') r = r.filter((s) => s.flagged)
    if (filter === 'terminated') r = r.filter((s) => s.terminated)
    if (filter === 'not_submitted') r = r.filter((s) => s.status === 'not_submitted')
    if (filter === 'edited') r = r.filter((s) => (s.results || []).some((x) => x.edited))
    const s = q.trim().toLowerCase()
    if (s) r = r.filter((x) => `${x.name} ${x.roll_no} ${x.candidate_id}`.toLowerCase().includes(s))
    const sc = (x) => (x.total_score == null ? -1 : x.total_score)
    if (sort === 'high') r.sort((a, b) => sc(b) - sc(a))
    if (sort === 'low') r.sort((a, b) => (a.total_score == null) - (b.total_score == null) || sc(a) - sc(b))
    if (sort === 'name') r.sort((a, b) => (a.name || a.candidate_id).localeCompare(b.name || b.candidate_id))
    return r
  }, [data, filter, sort, q])

  if (!paperId) return <p className="text-sm text-slate-500">Pick a paper first.</p>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h2 className="font-semibold">Results {data && <span className="text-slate-500 text-sm">({rows.length} of {data.students.length})</span>}</h2>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600">↻ Refresh</button>
          <button onClick={() => data && downloadCsv(data, rows)} disabled={!data}
            title="Downloads the students currently shown (filters apply)"
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40">⬇ Download CSV</button>
          <FeedbackButton role="hr" userId="hr" />
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`text-xs px-3 py-1.5 rounded-full ${filter === v ? 'bg-indigo-600 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{l}</button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input !w-auto text-xs">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="input !w-48 text-xs" placeholder="Search name / roll" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-700">
            <th className="py-2 pr-3">Student</th><th className="pr-3 text-center">Score</th>
            <th className="pr-3 text-center">Status</th><th className="pr-3 text-center">Proctoring</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((s) => {
              const edited = (s.results || []).some((x) => x.edited)
              return (
                <tr key={s.candidate_id} className="border-b border-slate-800/60">
                  <td className="py-2 pr-3">
                    <div>{s.name || s.candidate_id}</div>
                    <div className="text-xs text-slate-500">{s.roll_no}</div>
                  </td>
                  <td className="pr-3 text-center font-semibold">
                    {s.total_score != null ? `${s.total_score} / ${s.max_total}` : '—'}
                    {edited && <span className="ml-1 text-xs text-amber-300" title="You edited some marks">✎</span>}
                  </td>
                  <td className="pr-3 text-center text-xs">{s.status}</td>
                  <td className="pr-3 text-center text-xs">
                    {s.terminated ? <span className="text-red-300">⛔ ended</span>
                      : s.flagged ? <span className="text-amber-300">⚠ {s.proctoring?.total}</span> : '—'}
                  </td>
                  <td className="text-right">
                    {s.status !== 'not_submitted' && (
                      <button onClick={() => setOpen(s.candidate_id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600">Review answers</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">No students match.</td></tr>}
          </tbody>
        </table>
      </div>

      {open && <SheetModal paperId={paperId} cid={open} onClose={() => { setOpen(null); load() }} />}
    </div>
  )
}

function SheetModal({ paperId, cid, onClose }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const base = `/exam/papers/${paperId}/submissions/${cid}`

  useEffect(() => {
    hrApi.get(base).then((r) => setD(r.data)).catch((e) => setErr(e.response?.data?.detail || 'Failed to load'))
  }, [cid])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto p-4" onClick={onClose}>
      <div className="max-w-3xl mx-auto bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold">{d?.name || cid} <span className="text-slate-500 text-sm">{d?.roll_no}</span></h3>
            {d && <p className="text-sm text-slate-400">Total: <b className="text-slate-100">{d.total_score ?? '—'} / {d.max_total}</b> · {d.status}</p>}
            {d?.terminated && <p className="text-xs text-red-300">{d.termination_reason}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">✕</button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        {!d && !err && <p className="text-sm text-slate-500">Loading...</p>}
        {d?.items.map((it) => <QuestionCard key={it.q_no} it={it} base={base} onSaved={setD} />)}
        {d?.proctoring?.events?.length > 0 && (
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer">Proctoring events ({d.proctoring.events.length})</summary>
            <ul className="mt-2 space-y-1">
              {d.proctoring.events.map((e, i) => <li key={i}>{e.at?.slice(11, 19)} · {e.severity} · {e.event_type} {e.detail}</li>)}
            </ul>
          </details>
        )}
        <div className="flex justify-end"><FeedbackButton role="hr" userId="hr" /></div>
      </div>
    </div>
  )
}

function QuestionCard({ it, base, onSaved }) {
  const [val, setVal] = useState(it.score ?? 0)
  const [note, setNote] = useState(it.note || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setVal(it.score ?? 0); setNote(it.note || '') }, [it.score, it.note])

  async function save() {
    setBusy(true); setMsg('')
    try {
      const r = await hrApi.put(`${base}/score`, { q_no: it.q_no, score: Number(val), note })
      onSaved(r.data); setMsg('Saved')
    } catch (e) { setMsg(e.response?.data?.detail || 'Failed') } finally { setBusy(false) }
  }
  async function reset() {
    setBusy(true); setMsg('')
    try {
      const r = await hrApi.post(`${base}/score/reset`, { q_no: it.q_no, score: 0 })
      onSaved(r.data); setMsg('Back to AI score')
    } catch (e) { setMsg(e.response?.data?.detail || 'Failed') } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg bg-slate-800/60 p-3 space-y-2">
      <div className="text-sm"><span className="text-slate-500">Q{it.q_no} · {it.type} · {it.max_marks} mark(s)</span><br />{it.question}</div>
      {it.options?.length > 0 && <ul className="text-xs text-slate-400 list-disc pl-5">{it.options.map((o, i) => <li key={i}>{'ABCD'[i]}. {o}</li>)}</ul>}
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="rounded bg-slate-900 p-2">
          <div className="text-xs text-slate-500 mb-1">Student's answer</div>
          <div className="text-sm whitespace-pre-wrap">{it.student_answer || <i className="text-slate-500">No answer</i>}</div>
        </div>
        <div className="rounded bg-slate-900 p-2">
          <div className="text-xs text-slate-500 mb-1">Ideal answer used by AI</div>
          <div className="text-sm whitespace-pre-wrap">{it.ideal_answer || '—'}</div>
          {it.key_points?.length > 0 && <ul className="mt-1 text-xs text-slate-400 list-disc pl-4">{it.key_points.map((k, i) => <li key={i}>{k}</li>)}</ul>}
        </div>
      </div>
      {it.feedback && <p className="text-xs text-slate-400">AI feedback: {it.feedback}</p>}
      {it.missing_points?.length > 0 && <p className="text-xs text-amber-300/80">Missing: {it.missing_points.join('; ')}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">AI mark: <b>{it.ai_score ?? '—'}</b></span>
        <label className="text-slate-400">Your mark:
          <input type="number" step="0.5" min="0" max={it.max_marks} value={val}
            onChange={(e) => setVal(e.target.value)} className="input !w-20 ml-1 text-sm" />
        </label>
        <input className="input flex-1 min-w-[8rem] text-xs" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button disabled={busy} onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 disabled:opacity-40">Save</button>
        {it.edited && <button disabled={busy} onClick={reset} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700">Reset to AI</button>}
        {it.edited && <span className="text-xs text-amber-300">edited</span>}
        {msg && <span className="text-xs text-slate-400">{msg}</span>}
      </div>
    </div>
  )
}
