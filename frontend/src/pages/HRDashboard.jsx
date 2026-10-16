import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hrApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'
import ConferencePanel from '../components/ConferencePanel'

function overallScore(c) {
  const r = c.resume_score
  const i = c.interview_score
  if (r == null && i == null) return null
  if (r == null) return i
  if (i == null) return r
  return (r + i) / 2
}

export default function HRDashboard() {
  const [files, setFiles] = useState([])
  const [jdText, setJdText] = useState('')
  const [candidates, setCandidates] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const { logoutHR } = useAuth()

  async function refresh() {
    setRefreshing(true)
    try {
      const res = await hrApi.get('/candidates')
      setCandidates(res.data.candidates)
      setJdText((prev) => prev || res.data.jd_text || '')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function handleUpload(e) {
    e.preventDefault()
    if (!files.length || !jdText.trim()) {
      setMessage('Please add resumes and a job description.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))
      formData.append('jd_text', jdText)
      const res = await hrApi.post('/candidates/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMessage(`Processed ${res.data.uploaded} resume(s), ranked ${res.data.ranked}.`)
      await refresh()
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function toggleShortlist(candidateId, current) {
    const res = await hrApi.post(`/candidates/${candidateId}/shortlist?shortlisted=${!current}`)
    const invite = res.data.invite_email
    if (invite && invite.status === 'sent') {
      setMessage(`Shortlisted ${candidateId} — invite email sent to ${invite.to}.`)
    } else if (invite && invite.status !== 'sent') {
      setMessage(`Shortlisted ${candidateId}, but the invite email wasn't sent: ${invite.reason}`)
    }
    refresh()
  }

  async function sendInvite(candidateId) {
    try {
      const res = await hrApi.post(`/candidates/${candidateId}/send-invite`)
      if (res.data.status === 'sent') {
        setMessage(`Invite email sent to ${res.data.to}.`)
      } else {
        setMessage(`Couldn't send invite: ${res.data.reason}`)
      }
      refresh()
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Failed to send invite')
    }
  }

  async function editEmail(candidateId, current) {
    const email = window.prompt('Candidate email (used for the shortlist invite):', current || '')
    if (email === null || !email.trim()) return
    try {
      await hrApi.put(`/candidates/${candidateId}/email`, { email: email.trim() })
      refresh()
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Failed to save email')
    }
  }

  async function generateFeedback(candidateId) {
    try {
      await hrApi.post(`/feedback/${candidateId}/generate`)
      setMessage(`Feedback generated for ${candidateId}.`)
      refresh()
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Feedback generation failed')
    }
  }

  const pct = (v) => v != null ? `${Math.round(v * 100)}%` : '—'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <p className="eyebrow mb-1">HR workspace</p>
          <h1 className="text-2xl font-bold">HR Dashboard</h1>
        </div>
        <button onClick={logoutHR} className="text-sm text-slate-400 hover:text-slate-200">Log out</button>
      </div>

      <nav className="sticky top-0 z-10 -mx-4 px-4 py-2.5 bg-slate-950/90 backdrop-blur border-b border-slate-800 flex gap-1 text-sm">
        {[
          ['#upload', 'Upload'],
          ['#ranked', `Ranked (${candidates.length})`],
          ['#report', 'Overall report'],
          ['#conference', 'Conference with Candidate'],
        ].map(([href, label]) => (
          <a key={href} href={href}
            className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            {label}
          </a>
        ))}
        {[
            ['/hr/exam-module', 'Exam module'],
            ['/hr/question-gen', 'Question gen'],
        ].map(([to, label]) => (
          <Link key={to} to={to}
            className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            {label}
          </Link>
        ))}
      </nav>

      <Card id="upload" className="scroll-mt-16">
        <h2 className="font-semibold mb-3">1. Upload resumes & job description</h2>
        <form onSubmit={handleUpload} className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium">
              Choose files
              <input type="file" multiple accept=".pdf" className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files))} />
            </label>
            <span className="text-sm text-slate-400">
              {files.length > 0 ? `${files.length} file(s) selected: ${files.map((f) => f.name).join(', ')}` : 'No files chosen'}
            </span>
          </div>
          <textarea className="input h-28" placeholder="Paste job description..." value={jdText}
            onChange={(e) => setJdText(e.target.value)} />
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium disabled:opacity-40">
            {busy ? 'Processing...' : 'Process & rank resumes'}
          </button>
          {message && <p className="text-sm text-slate-300">{message}</p>}
        </form>
      </Card>

      <Card id="ranked" className="scroll-mt-16">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">2. Ranked candidates ({candidates.length})</h2>
          <button onClick={refresh} disabled={refreshing}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40">
            {refreshing ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
        <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
          {candidates.map((c, i) => (
            <div key={c.candidate_id} className="flex items-center gap-3 bg-slate-800/60 rounded-lg p-3">
              <div className="w-8 text-center text-slate-400 text-sm">#{i + 1}</div>
              <div className="flex-1">
                <div className="font-mono text-sm text-slate-300">{c.candidate_id}</div>
                <div className="text-xs text-slate-500">{c.filename}</div>
                <button onClick={() => editEmail(c.candidate_id, c.contact_email)}
                  className="text-xs text-slate-400 hover:text-slate-200 underline decoration-dotted">
                  {c.contact_email || 'No email found — click to add'}
                </button>
              </div>
              <div className="text-sm w-20 text-center">
                {c.resume_score != null ? `${Math.round(c.resume_score * 100)}%` : 'N/A'}
              </div>
              <div className="text-sm w-24 text-center">
                {c.interview_score != null ? `Interview ${Math.round(c.interview_score * 100)}%` : '—'}
              </div>
              {c.interview_terminated ? (
                <div className="text-xs px-2 py-1 rounded-full bg-red-600/30 text-red-300 max-w-[14rem]"
                  title={c.termination_reason || ''}>
                  ⛔ Cheating detected — auto-ended ({c.cheat_warning_count}/{c.max_cheat_warnings} warnings)
                </div>
              ) : (c.proctoring_flags.warning + c.proctoring_flags.high) > 0 && (
                <div className={`text-xs px-2 py-1 rounded-full ${c.proctoring_flags.high ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  ⚠ {c.cheat_warning_count}/{c.max_cheat_warnings} warning(s)
                </div>
              )}
              <button onClick={() => toggleShortlist(c.candidate_id, c.shortlisted)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium ${c.shortlisted ? 'bg-emerald-600' : 'bg-slate-700 hover:bg-slate-600'}`}>
                {c.shortlisted ? 'Shortlisted' : 'Shortlist'}
              </button>
              {c.shortlisted && (
                <button onClick={() => sendInvite(c.candidate_id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium">
                  {c.invite_sent_at ? 'Resend invite' : 'Send invite'}
                </button>
              )}
              {c.interview_score != null && (
                <button onClick={() => generateFeedback(c.candidate_id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-slate-100 font-medium">
                  Generate feedback
                </button>
              )}
            </div>
          ))}
          {candidates.length === 0 && <p className="text-sm text-slate-500">No candidates yet.</p>}
        </div>
      </Card>

      <Card id="report" className="scroll-mt-16">
        <h2 className="font-semibold mb-1">3. Overall report</h2>
        <p className="text-xs text-slate-500 mb-3">
          Overall score = average of resume match score and interview score (whichever are available).
          Hit "↻ Refresh" above after a candidate finishes their interview to pull in their latest score here.
        </p>
        <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="py-2 pr-4">Candidate</th>
                <th className="py-2 pr-4 text-center">Resume score</th>
                <th className="py-2 pr-4 text-center">Interview score</th>
                <th className="py-2 pr-4 text-center">Overall score</th>
                <th className="py-2 pr-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...candidates]
                .sort((a, b) => (overallScore(b) ?? -1) - (overallScore(a) ?? -1))
                .map((c) => (
                  <tr key={c.candidate_id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4">
                      <div className="font-mono text-slate-300">{c.candidate_id}</div>
                      <div className="text-xs text-slate-500">{c.filename}</div>
                    </td>
                    <td className="py-2 pr-4 text-center">{pct(c.resume_score)}</td>
                    <td className="py-2 pr-4 text-center">{pct(c.interview_score)}</td>
                    <td className="py-2 pr-4 text-center font-semibold">{pct(overallScore(c))}</td>
                    <td className="py-2 pr-4 text-center">
                      {c.interview_terminated
                        ? <span className="text-red-300">Cheating — ended</span>
                        : c.interview_score != null
                          ? <span className="text-emerald-300">Interview done</span>
                          : c.shortlisted
                            ? <span className="text-amber-300">Awaiting interview</span>
                            : <span className="text-slate-500">Not shortlisted</span>}
                    </td>
                  </tr>
                ))}
              {candidates.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-slate-500">No candidates yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConferencePanel />
    </div>
  )
}
