import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hrApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'

export default function HRLogin() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', name: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const infoRef = useRef(null)
  const { loginHR } = useAuth()
  const navigate = useNavigate()

  // Close the info popup when clicking outside it or pressing Escape
  useEffect(() => {
    if (!showInfo) return
    function onClick(e) {
      if (infoRef.current && !infoRef.current.contains(e.target)) setShowInfo(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setShowInfo(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [showInfo])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const path = mode === 'login' ? '/auth/hr/login' : '/auth/hr/signup'
      const res = await hrApi.post(path, form)
      loginHR(res.data.token, res.data.user.id)
      navigate('/hr/dashboard')
    } catch (e) {
      setError(e.response?.data?.detail || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function quickLogin() {
    setError('')
    setBusy(true)
    try {
      const res = await hrApi.post('/auth/hr/quick-login')
      loginHR(res.data.token, res.data.user.id)
      navigate('/hr/dashboard')
    } catch (e) {
      setError(e.response?.data?.detail || 'Quick login is unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <Link to="/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Back to home
          </Link>

          <div className="relative" ref={infoRef}>
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-expanded={showInfo}
              className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${
                showInfo
                  ? 'bg-slate-700 border-slate-500'
                  : 'bg-slate-800 border-slate-600 hover:bg-slate-700 hover:border-slate-500'
              }`}
              aria-label="Info about HR credentials"
            >
              <span className="text-xs font-bold text-slate-300 leading-none">i</span>
            </button>
            {showInfo && (
              <div
                role="dialog"
                className="absolute right-0 top-8 w-64 p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs leading-relaxed text-slate-300 shadow-2xl z-20"
              >
                HR ID and pass can only be set and accessed from the software's .env file only for security purpose.
                <div className="absolute -top-1 right-2.5 w-2 h-2 bg-slate-800 border-l border-t border-slate-700 rotate-45"></div>
              </div>
            )}
          </div>
        </div>

        <p className="eyebrow mb-1">AI Recruiter</p>
        <h1 className="text-xl font-semibold mb-4">{mode === 'login' ? 'HR Login' : 'Create HR Account'}</h1>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <input className="input" placeholder="Name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          )}
          <input className="input" type="email" placeholder="Email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" type="password" placeholder="Password" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button disabled={busy} className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium disabled:opacity-40">
            {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
          <p className={`text-xs ${busy ? 'text-amber-300' : 'text-slate-500'}`}>
            ⏳ Login can take up to a minute when the server is busy. Please wait and do not refresh the page or click again.
          </p>
        </form>
      </Card>
    </div>
  )
}
