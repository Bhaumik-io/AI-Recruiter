import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { candidateApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'
import FaceAuth from '../components/FaceAuth'

// Two-factor candidate auth: password step first (signup or login),
// which only returns a short-lived pre-auth token. That token unlocks
// exactly one next step — face enrollment (first time) or face
// verification (every time after) — which is the only thing that
// hands back a real, usable candidate token. Neither password nor
// face alone is enough.
export default function CandidateLogin() {
  const [mode, setMode] = useState(() => localStorage.getItem('candidateAuthMode') || 'signup') // 'login' | 'signup' — opens on Sign up by default
  const [step, setStep] = useState(() =>
    localStorage.getItem('candidate_role') === 'candidate_pre_auth' && localStorage.getItem('candidatePreAuthId')
      ? 'face' : 'password'
  )
  const [form, setForm] = useState({ email: '', password: '', candidate_id: '' })
  const [candidateId, setCandidateId] = useState(() => localStorage.getItem('candidatePreAuthId') || '')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { loginCandidate } = useAuth()
  const navigate = useNavigate()

  async function submitPassword(e) {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && !consent) {
      setError('You must agree to camera, face and screen monitoring to continue.')
      return
    }
    setBusy(true)
    try {
      const path = mode === 'signup' ? '/auth/candidate/signup' : '/auth/candidate/login'
      const res = await candidateApi.post(path, form)
      // Stash the pre-auth token (and which step/candidate we're mid-flow
      // for) so a refresh here resumes at the face step instead of
      // bouncing back to square one.
      localStorage.setItem('candidate_token', res.data.token)
      localStorage.setItem('candidate_role', 'candidate_pre_auth')
      localStorage.setItem('candidatePreAuthId', res.data.candidate_id)
      localStorage.setItem('candidateAuthMode', mode)
      setCandidateId(res.data.candidate_id)
      setStep('face')
    } catch (e) {
      setError(e.response?.data?.detail || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  function onFaceSuccess(data) {
    localStorage.removeItem('candidatePreAuthId')
    localStorage.removeItem('candidateAuthMode')
    loginCandidate(data.token, 'candidate', data.candidate_id)
    // MST students (id starts with INV_) go to the exam; resume candidates keep the interview.
    navigate(String(data.candidate_id || '').startsWith('INV_') ? '/candidate/exam' : '/candidate/interview')
  }

  function goBackToPassword() {
    setStep('password')
    setError('')
    localStorage.removeItem('candidate_token')
    localStorage.removeItem('candidate_role')
    localStorage.removeItem('candidatePreAuthId')
    localStorage.removeItem('candidateAuthMode')
  }

  if (step === 'face') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <h2 className="font-semibold mb-1">
            {mode === 'signup' ? 'Step 2 of 2 — enroll your face' : 'Step 2 of 2 — verify your face'}
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            {mode === 'signup'
              ? 'This is mandatory and only needs to be done once. From now on, every login needs both your password and your face.'
              : "Your password checked out — now confirm it's really you."}
          </p>
          <FaceAuth
            mode={mode === 'signup' ? 'enroll' : 'verify'}
            candidateId={candidateId}
            onSuccess={onFaceSuccess}
            onError={setError}
          />
          <p className="text-xs text-slate-500 mt-3">
            Allow camera access and face the light. Loading the camera can take a moment: please wait and do not refresh.
          </p>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button
            onClick={goBackToPassword}
            className="mt-4 text-xs text-slate-500 hover:text-slate-300"
          >
            ← Back
          </button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <Link to="/" className="text-sm text-slate-400 hover:text-slate-200 inline-block mb-4">
          ← Back to home
        </Link>
        <p className="eyebrow mb-3 text-cyan-400/90">AI Recruiter — Candidate</p>
        <div className="flex gap-2 mb-4 text-sm">
          {['login', 'signup'].map((t) => (
            <button key={t} onClick={() => { setMode(t); setError('') }}
              className={`px-3 py-1 rounded-full ${mode === t ? 'bg-cyan-600 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
              {t === 'login' ? 'Log in' : 'First time / sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={submitPassword} className="space-y-3">
          {mode === 'signup' && (
            <input className="input" placeholder="Access code (from your email / SMS) or Candidate ID" required
              value={form.candidate_id} onChange={(e) => setForm({ ...form, candidate_id: e.target.value })} />
          )}
          <input className="input" type="email" autoComplete="email" placeholder="Email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" type="password" placeholder={mode === 'signup' ? 'Create a password (8+ chars, letters + numbers)' : 'Password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />

          {mode === 'signup' && (
            <label className="flex gap-2 items-start text-xs text-slate-400 bg-slate-800/50 p-2 rounded">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required className="mt-0.5" />
              <span>I agree to camera, face and screen monitoring during the exam. My data will be used only for proctoring and evaluation and can be deleted on request to HR.</span>
            </label>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button disabled={busy || (mode === 'signup' && !consent)} className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-medium disabled:opacity-40">
            {busy ? 'Please wait...' : mode === 'signup' ? 'Continue to face enrollment →' : 'Continue to face verification →'}
          </button>
        </form>
        <p className={`text-xs mt-2 ${busy ? 'text-amber-300' : 'text-slate-500'}`}>
          ⏳ This can take up to a minute when many students are online. Please wait and do not refresh the page or click again.
        </p>
        <p className="text-xs text-slate-500 mt-3">
          {mode === 'signup'
            ? "Step 1 of 2 — password sets up your account, face enrollment (next) is required to finish."
            : 'Step 1 of 2 — password, then face verification.'}
        </p>
      </Card>
    </div>
  )
}