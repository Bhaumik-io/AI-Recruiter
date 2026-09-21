import { useState } from 'react'
import { hrApi } from '../api/client'

// TESTING ONLY — wipes every table (candidates, HR accounts, candidate
// accounts, feedback, proctoring logs) in one click and drops back to a
// clean logged-out state, so the full signup -> shortlist -> interview
// flow can be re-run from scratch. Remove this component (and the
// matching backend dev_router, or set DEV_RESET_ENABLED=false) before
// any real deployment.
export default function DevResetButton() {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function reset() {
    setBusy(true)
    try {
      await hrApi.post('/dev/reset-all')
    } catch (e) {
      // even if the call fails, still clear local session state below
      console.error('Reset failed', e)
    } finally {
      localStorage.clear()
      sessionStorage.clear()
      window.location.href = '/'
    }
  }

  if (confirming) {
    return (
      <div className="fixed top-3 left-3 z-50 bg-red-950 border border-red-700 rounded-lg p-2 text-xs shadow-lg">
        <p className="text-red-200 mb-2">Wipe ALL data? This can't be undone.</p>
        <div className="flex gap-2">
          <button onClick={reset} disabled={busy}
            className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-40">
            {busy ? 'Wiping...' : 'Yes, wipe it'}
          </button>
          <button onClick={() => setConfirming(false)} className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="TESTING ONLY — wipe all data"
      className="fixed top-3 left-3 z-50 text-xs px-2 py-1 rounded-lg bg-red-900/70 hover:bg-red-800 text-red-200 border border-red-700/50 shadow-lg"
    >
      🗑 Reset data
    </button>
  )
}
