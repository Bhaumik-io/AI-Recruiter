import { useEffect, useState, useCallback } from 'react'
import { hrApi } from '../api/client'
import Card from './Card'

// Default candidate-facing conference time: 2 hours after their
// interview finished — HR can freely edit it before sending.
function defaultScheduledAt(completedAtIso) {
  const base = completedAtIso ? new Date(completedAtIso) : new Date()
  const withOffset = new Date(base.getTime() + 2 * 60 * 60 * 1000)
  // datetime-local input wants "YYYY-MM-DDTHH:mm" in local time
  const pad = (n) => String(n).padStart(2, '0')
  return `${withOffset.getFullYear()}-${pad(withOffset.getMonth() + 1)}-${pad(withOffset.getDate())}T${pad(withOffset.getHours())}:${pad(withOffset.getMinutes())}`
}

function displayDateTime(localValue) {
  if (!localValue) return ''
  const d = new Date(localValue)
  if (isNaN(d)) return localValue
  return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}

const STATUS_LABEL = {
  scheduled: { text: 'Scheduled', cls: 'bg-indigo-900/50 text-indigo-300 border-indigo-700/50' },
  in_progress: { text: 'In progress', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' },
  completed: { text: 'Completed', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  cancelled: { text: 'Cancelled', cls: 'bg-red-950/50 text-red-300 border-red-800/50' },
}

export default function ConferencePanel() {
  const [candidates, setCandidates] = useState([])
  const [sort, setSort] = useState('score_desc')
  const [limit, setLimit] = useState('all')
  const [cheatingOnly, setCheatingOnly] = useState(false)
  const [drafts, setDrafts] = useState({})   // candidate_id -> datetime-local value being edited
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState(null)

  const refresh = useCallback(async () => {
    const res = await hrApi.get('/conference/candidates', { params: { sort, limit, cheating_only: cheatingOnly } })
    setCandidates(res.data.candidates)
  }, [sort, limit, cheatingOnly])

  useEffect(() => { refresh() }, [refresh])

  function draftFor(c) {
    return drafts[c.candidate_id] ?? (c.conference_scheduled_at
      ? c.conference_scheduled_at.slice(0, 16)
      : defaultScheduledAt(c.completed_at))
  }

  async function confirmOrReschedule(c) {
    setBusyId(c.candidate_id)
    setMessage('')
    const scheduled_at = draftFor(c)
    const path = c.conference_status === 'scheduled' || c.conference_status === 'in_progress'
      ? `/conference/${c.candidate_id}/reschedule`
      : `/conference/${c.candidate_id}/confirm`
    try {
      const res = await hrApi.post(path, { scheduled_at, scheduled_at_display: displayDateTime(scheduled_at) })
      const email = res.data.email
      setMessage(email?.status === 'sent' ? `Email sent to ${email.to}.` : `Saved, but email wasn't sent: ${email?.reason || 'unknown error'}`)
      refresh()
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Failed to schedule the conference')
    } finally {
      setBusyId(null)
    }
  }

  async function resend(c) {
    setBusyId(c.candidate_id)
    setMessage('')
    try {
      const res = await hrApi.post(`/conference/${c.candidate_id}/resend`)
      setMessage(res.data.email?.status === 'sent' ? `Resent to ${res.data.email.to}.` : `Couldn't resend: ${res.data.email?.reason}`)
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Failed to resend')
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(c) {
    const reason = window.prompt('Optional note to include in the cancellation email (leave blank to skip):', '')
    if (reason === null) return
    setBusyId(c.candidate_id)
    setMessage('')
    try {
      const res = await hrApi.post(`/conference/${c.candidate_id}/cancel`, { reason })
      setMessage(res.data.email?.status === 'sent' ? 'Cancellation email sent.' : `Cancelled, but email wasn't sent: ${res.data.email?.reason}`)
      refresh()
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Failed to cancel')
    } finally {
      setBusyId(null)
    }
  }

  const pct = (v) => v != null ? `${Math.round(v * 100)}%` : '—'

  return (
    <Card id="conference" className="scroll-mt-16">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="eyebrow mb-1">Next stage</p>
          <h2 className="font-semibold">Conference with Candidate</h2>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Completed interviews only. Confirm a selection to email the candidate a scheduled video-conference link.
      </p>

      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input w-auto py-1.5">
          <option value="score_desc">Score: high to low</option>
          <option value="score_asc">Score: low to high</option>
        </select>
        <select value={limit} onChange={(e) => setLimit(e.target.value)} className="input w-auto py-1.5">
          <option value="all">All candidates</option>
          <option value="10">Top 10</option>
          <option value="50">Top 50</option>
        </select>
        <label className="flex items-center gap-2 text-slate-400 px-1">
          <input type="checkbox" checked={cheatingOnly} onChange={(e) => setCheatingOnly(e.target.checked)} />
          Flagged / cheating only
        </label>
      </div>

      {message && <p className="text-xs text-indigo-300 mb-3">{message}</p>}

      <div className="space-y-3">
        {candidates.length === 0 && <p className="text-sm text-slate-500">No completed interviews match these filters.</p>}
        {candidates.map((c) => {
          const status = STATUS_LABEL[c.conference_status]
          const flagged = c.cheat_warning_count > 0 || c.interview_terminated
          return (
            <div key={c.candidate_id} className="border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-mono text-sm text-slate-300">{c.candidate_id}</div>
                  <div className="text-xs text-slate-500">{c.filename} · {c.contact_email || 'no email on file'}</div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full bg-slate-800 text-slate-300">Score: {pct(c.interview_score)}</span>
                  {flagged && (
                    <span className="px-2 py-1 rounded-full bg-red-950/50 text-red-300 border border-red-800/50">
                      {c.interview_terminated ? 'Terminated for cheating' : `${c.cheat_warning_count} flag(s)`}
                    </span>
                  )}
                  {status && <span className={`px-2 py-1 rounded-full border ${status.cls}`}>{status.text}</span>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" value={draftFor(c)}
                  onChange={(e) => setDrafts({ ...drafts, [c.candidate_id]: e.target.value })}
                  className="input w-auto py-1.5 text-xs" />
                <button disabled={busyId === c.candidate_id} onClick={() => confirmOrReschedule(c)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium disabled:opacity-40">
                  {c.conference_status === 'scheduled' || c.conference_status === 'in_progress' ? 'Reschedule' : 'Confirm selection'}
                </button>
                {c.conference_status === 'scheduled' && (
                  <>
                    <button disabled={busyId === c.candidate_id} onClick={() => resend(c)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium disabled:opacity-40">
                      Resend mail
                    </button>
                    <button disabled={busyId === c.candidate_id} onClick={() => cancel(c)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-900 text-red-200 font-medium disabled:opacity-40">
                      Cancel
                    </button>
                  </>
                )}
                {c.conference_room_id && (
                  <a href={`/conference/${c.conference_room_id}`} target="_blank" rel="noreferrer"
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline ml-auto">
                    Open room →
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
