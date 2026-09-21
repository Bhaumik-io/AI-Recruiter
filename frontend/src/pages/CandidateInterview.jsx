import { useEffect, useState } from 'react'
import { candidateApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'
import AntiCheatMonitor from '../components/AntiCheatMonitor'

export default function CandidateInterview() {
  const { candidateId: subjectId, logoutCandidate } = useAuth()
  const [status, setStatus] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [answers, setAnswers] = useState([])
  const [feedback, setFeedback] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [terminated, setTerminated] = useState(null) // termination reason string, once ended for cheating
  const [fullscreenReady, setFullscreenReady] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [screenStream, setScreenStream] = useState(null)
  const [screenShareError, setScreenShareError] = useState('')
  const [screenShareBusy, setScreenShareBusy] = useState(false)

  useEffect(() => {
    candidateApi.get(`/interview/${subjectId}/status`).then((res) => {
      setStatus(res.data)
      if (res.data.terminated) setTerminated(res.data.termination_reason)
    }).catch((e) =>
      setError(e.response?.data?.detail || 'Could not load interview status')
    )
  }, [subjectId])

  useEffect(() => {
    if (terminated) return
    if (status?.completed) {
      candidateApi.get(`/feedback/${subjectId}`).then((res) => setFeedback(res.data)).catch(() => {})
    } else if (status?.shortlisted && !questions) {
      candidateApi.get(`/interview/${subjectId}/questions`).then((res) => {
        setQuestions(res.data.questions)
        setAnswers(new Array(res.data.questions.length).fill(''))
      }).catch((e) => setError(e.response?.data?.detail || 'Could not load questions'))
    }
  }, [status])

  async function startInterview() {
    setFullscreenError('')
    setScreenShareError('')
    setScreenShareBusy(true)
    try {
      // Screen share is the real gate — it's what lets the check below
      // catch a second monitor, a floating overlay, or a phone propped
      // next to the screen sitting outside the shared area. Mandatory:
      // if the candidate denies it or cancels the picker, they can't
      // proceed. Fullscreen below is best-effort on top of it.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      const settings = track.getSettings ? track.getSettings() : {}
      if (settings.displaySurface && settings.displaySurface !== 'monitor') {
        setScreenShareError(
          'Please share your ENTIRE screen, not a single window or tab — reopen sharing and choose "Entire screen".'
        )
        stream.getTracks().forEach((t) => t.stop())
        setScreenShareBusy(false)
        return
      }
      setScreenStream(stream)
    } catch (e) {
      setScreenShareError('Screen sharing is required to start the interview: ' + (e.message || 'permission denied'))
      setScreenShareBusy(false)
      return
    }

    try {
      await document.documentElement.requestFullscreen()
    } catch (e) {
      // Best-effort only — some contexts (embedded iframes, certain OS
      // window managers) reject this. Don't block the interview over it,
      // just flag it so it's visible rather than silently skipped.
      setFullscreenError("Couldn't enter fullscreen — continuing without it. " + (e.message || ''))
    }
    setScreenShareBusy(false)
    setFullscreenReady(true)
  }

  // Screen share must stop when the interview ends, one way or another.
  useEffect(() => {
    return () => {
      screenStream?.getTracks().forEach((t) => t.stop())
    }
  }, [screenStream])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await candidateApi.post(`/interview/${subjectId}/submit`, { answers })
      setResult(res.data)
      setStatus({ ...status, completed: true, interview_score: res.data.interview_score })
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      screenStream?.getTracks().forEach((t) => t.stop())
    } catch (e) {
      setError(e.response?.data?.detail || 'Submission failed')
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <Centered>{error || 'Loading...'}</Centered>

  if (!status.shortlisted) {
    return <Centered>You have not been shortlisted for interview yet. Please check back later.</Centered>
  }

  if (terminated) {
    return (
      <Centered>
        <Card className="max-w-lg w-full">
          <h1 className="text-xl font-semibold mb-2 text-red-400">⛔ Interview ended</h1>
          <p className="text-slate-300 mb-4">
            Your interview was automatically ended after 3 proctoring warnings. Reason: cheating detected by candidate.
          </p>
          <p className="text-sm text-slate-500 mb-4">{terminated}</p>
          <p className="text-sm text-slate-500">This report, including the same reason shown above, has been sent to HR.</p>
          <button onClick={logoutCandidate} className="mt-6 text-sm text-slate-400 hover:text-slate-200">Log out</button>
        </Card>
      </Centered>
    )
  }

  if (status.completed) {
    return (
      <Centered>
        <Card className="max-w-lg w-full">
          <h1 className="text-xl font-semibold mb-2">🎉 Interview completed</h1>
          <p className="text-slate-300 mb-4">Your interview score: {Math.round(status.interview_score * 100)}%</p>
          {feedback ? (
            <div className="space-y-3 text-sm">
              <div><span className="text-slate-400">Summary: </span>{feedback.summary}</div>
              <div><span className="text-slate-400">Strengths:</span><br />{feedback.strengths}</div>
              <div><span className="text-slate-400">Areas to improve:</span><br />{feedback.improvements}</div>
              <div className="font-medium">Recommendation: {feedback.recommendation}</div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Feedback hasn't been generated by HR yet — check back soon.</p>
          )}
          <button onClick={logoutCandidate} className="mt-6 text-sm text-slate-400 hover:text-slate-200">Log out</button>
        </Card>
      </Centered>
    )
  }

  if (!questions) return <Centered>{error || 'Preparing your questions...'}</Centered>

  if (!fullscreenReady) {
    return (
      <Centered>
        <Card className="max-w-md w-full text-center">
          <h1 className="text-xl font-semibold mb-2">Ready to begin?</h1>
          <p className="text-sm text-slate-400 mb-5">
            You'll be asked to share your <strong>entire screen</strong> and enter fullscreen
            so proctoring can reliably tell if you leave the interview or open something
            else. Close any other apps or windows you don't need — put your phone away
            too, the webcam monitor stays on for the whole interview.
          </p>
          {screenShareError && <p className="text-xs text-red-400 mb-3">{screenShareError}</p>}
          {fullscreenError && <p className="text-xs text-amber-400 mb-3">{fullscreenError}</p>}
          <button onClick={startInterview} disabled={screenShareBusy}
            className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium disabled:opacity-50">
            {screenShareBusy ? 'Waiting for permissions...' : 'Share screen & start interview'}
          </button>
        </Card>
      </Centered>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <AntiCheatMonitor candidateId={subjectId} screenStream={screenStream}
        onTerminated={(reason) => setTerminated(reason)} />
      <p className="eyebrow mb-1">Candidate portal</p>
      <h1 className="text-2xl font-bold mb-1">Your Interview</h1>
      <p className="text-slate-400 text-sm mb-6">{questions.length} questions · answer each thoughtfully</p>
      <form onSubmit={submit} className="space-y-4">
        {questions.map((q, i) => (
          <Card key={i}>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-600/40 text-indigo-200">{q.type}</span>
            <p className="font-medium mt-2 mb-2">Q{i + 1}. {q.question}</p>
            <textarea className="input h-24" placeholder="Type your answer here..."
              value={answers[i]}
              onChange={(e) => setAnswers((a) => a.map((v, idx) => idx === i ? e.target.value : v))} />
          </Card>
        ))}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button disabled={busy} className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium disabled:opacity-40">
          {busy ? 'Submitting...' : 'Submit interview'}
        </button>
      </form>
    </div>
  )
}

function Centered({ children }) {
  return <div className="min-h-screen flex items-center justify-center px-4 text-center">{children}</div>
}
