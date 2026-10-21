import { useState } from \'react\'
import { Link, useNavigate } from \'react-router-dom\'
import { hrApi } from \'../api/client\'
import { useAuth } from \'../context/AuthContext\'
import Card from \'../components/Card\'

export default function HRLogin() {
  const [mode, setMode] = useState(\'login\')
  const [form, setForm] = useState({ email: \'\', password: \'\', name: \'\' })
  const [error, setError] = useState(\'\')
  const [busy, setBusy] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const { loginHR } = useAuth()
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError(\'\')
    setBusy(true)
    try {
      const path = mode === \'login\' ? \'/auth/hr/login\' : \'/auth/hr/signup\'
      const res = await hrApi.post(path, form)
      loginHR(res.data.token, res.data.user.id)
      navigate(\'/hr/dashboard\')
    } catch (e) {
      setError(e.response?.data?.detail || \'Something went wrong\')
    } finally {
      setBusy(false)
    }
  }

  async function quickLogin() {
    setError(\'\')
    setBusy(true)
    try {
      const res = await hrApi.post(\'/auth/hr/quick-login\')
      loginHR(res.data.token, res.data.user.id)
      navigate(\'/hr/dashboard\')
    } catch (e) {
      setError(e.response?.data?.detail || \'Quick login is unavailable\')
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
          
          {/* i button with tooltip */}
          <div className="relative">
            <button
              type="button"
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
              onClick={() => setShowInfo(!showInfo)}
              className="w-5 h-5 rounded-full border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 flex items-center justify-center text-[11px] font-bold leading-none"
              aria-label="Info about HR credentials"
            >
              i
            </button>
            {showInfo && (
              <div className="absolute right-0 top-7 w-64 p-3 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 shadow-xl z-20">
                HR ID and pass can only be set and accessed from the software\'s .env file only for security purpose.
              </div>
            )}
          </div>
        </div>

        <p className="eyebrow mb-1">AI Recruiter</p>
        <h1 className="text-xl font-semibold mb-4">{mode === \'login\' ? \'HR Login\' : \'Create HR Account\'}</h1>
        <form onSubmit={submit} className="space-y-3">
          {mode === \'signup\' && (
            <input className="input" placeholder="Name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          )}
          <input className="input" type="email" placeholder="Email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" type="password" placeholder="Password" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button disabled={busy} className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium disabled:opacity-40">
            {busy ? \'Please wait...\' : mode === \'login\' ? \'Log in\' : \'Sign up\'}
          </button>
          <p className={`text-xs ${busy ? \'text-amber-300\' : \'text-slate-500\'}`}>
            ⏳ Login can take up to a minute when the server is busy. Please wait and do not refresh the page or click again.
          </p>
        </form>
        {/*<button onClick={() => setMode(mode === \'login\' ? \'signup\' : \'login\')}
          className="text-sm text-slate-400 hover:text-slate-200 mt-4">
          {mode === \'login\' ? "Don\'t have an account? Sign up" : \'Already have an account? Log in\'}
        </button>*/}

        {/*<div className="flex items-center gap-2 my-4">
          <div className="h-px bg-slate-700 flex-1" />
          <span className="text-xs text-slate-500">or</span>
          <div className="h-px bg-slate-700 flex-1" />
        </div>

        <button type="button" disabled={busy} onClick={quickLogin}
          className="w-full py-2 rounded-lg border border-slate-600 hover:border-slate-400 text-sm font-medium disabled:opacity-40">
          {busy ? \'Please wait...\' : \'Continue as Guest HR (demo)\'}
        </button>
        <p className="text-xs text-slate-500 mt-2 text-center">
          Instant temp account — no signup needed. For demos/testing only.
        </p>*/}
      </Card>
    </div>
  )
}