import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Card from '../components/Card'

const API_BASE = import.meta.env.VITE_API_URL || '/api'
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

function wsUrl(path) {
  if (API_BASE.startsWith('http')) return API_BASE.replace(/^http/, 'ws') + path
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${API_BASE}${path}`
}

async function fetchRoomInfo(roomId, token) {
  const res = await fetch(`${API_BASE}/conference/room/${roomId}?token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not open this room')
  return res.json()
}

export default function ConferenceRoom() {
  const { roomId } = useParams()
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const pcRef = useRef(null)
  const wsRef = useRef(null)
  const localStreamRef = useRef(null)

  const [info, setInfo] = useState(null)      // room_info response
  const [error, setError] = useState('')
  const [callState, setCallState] = useState('connecting') // connecting | waiting | live | ended | cancelled
  const [peerPresent, setPeerPresent] = useState(false)
  const [mediaError, setMediaError] = useState('')

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    pcRef.current?.close()
    wsRef.current?.close()
  }, [])

  useEffect(() => {
    let cancelled = false
    // Owned by THIS invocation only. React's StrictMode intentionally
    // mounts every component twice in dev (mount -> cleanup -> mount) to
    // surface exactly this class of bug: if cleanup tore down whatever
    // was sitting in a shared ref, the phantom first pass's cleanup
    // could kill the SECOND, real pass's live socket/camera/peer
    // connection instead of its own — which is what was happening here
    // (candidate socket opened, then immediately closed, and nothing
    // reconnected). Using local variables instead of refs for teardown
    // means each invocation only ever closes what it personally opened.
    let myStream, myPc, myWs

    async function start() {
      const hrToken = localStorage.getItem('hr_token')
      const candidateToken = localStorage.getItem('candidate_token')
      let token = null
      let roomInfo = null

      // Try whichever session actually has access to this room — a
      // browser may have both an HR and a candidate session open in
      // different tabs (see api/client.js), so we can't assume role.
      for (const t of [hrToken, candidateToken]) {
        if (!t) continue
        try {
          roomInfo = await fetchRoomInfo(roomId, t)
          token = t
          break
        } catch { /* try the next token */ }
      }

      if (cancelled) return
      if (!token || !roomInfo) {
        setError('You need to be logged in (as HR or as the invited candidate) to open this conference.')
        return
      }
      setInfo(roomInfo)

      if (roomInfo.conference_status === 'cancelled') {
        setCallState('cancelled')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        myStream = stream
        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
      } catch (e) {
        setMediaError('Camera/microphone access is required to join: ' + (e.message || 'permission denied'))
      }

      if (cancelled) { myStream?.getTracks().forEach((t) => t.stop()); return }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      myPc = pc
      pcRef.current = pc
      myStream?.getTracks().forEach((t) => pc.addTrack(t, myStream))
      pc.ontrack = (e) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'ice-candidate', candidate: e.candidate })
      }

      if (cancelled) { pc.close(); return }

      const ws = new WebSocket(wsUrl(`/conference/room/${roomId}/ws?token=${encodeURIComponent(token)}`))
      myWs = ws
      wsRef.current = ws

      function send(msg) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      }

      ws.onopen = () => {
        if (cancelled) { ws.close(); return }
        setCallState(roomInfo.started ? 'live' : 'waiting')
      }

      // Distinguish OUR OWN intentional close (cancelled / call ended)
      // from an unexpected drop (network blip, backend restart, a
      // flaky virtual/phone-camera driver). Silently doing nothing on
      // an unexpected close is exactly what produced the permanently
      // black remote tile here — surface it instead.
      ws.onclose = () => {
        if (cancelled) return
        setCallState((prev) => (prev === 'ended' ? prev : 'disconnected'))
      }

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'peer-joined':
            setPeerPresent(true)
            break
          case 'peer-left':
            setPeerPresent(false)
            break
          case 'room-started':
            setCallState('live')
            break
          case 'room-ended':
            setCallState('ended')
            cleanup()
            break
          case 'offer': {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            send({ type: 'answer', sdp: answer })
            break
          }
          case 'answer':
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            break
          case 'ice-candidate':
            try { await pc.addIceCandidate(msg.candidate) } catch { /* ignore late candidates */ }
            break
        }
      }

      // Exposed for the Start/End buttons below.
      wsRef.current.startMeeting = async () => {
        send({ type: 'start' })
        setCallState('live')
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send({ type: 'offer', sdp: offer })
      }
      wsRef.current.endMeeting = () => {
        send({ type: 'end' })
        setCallState('ended')
        cleanup()
      }
    }

    start()
    return () => {
      cancelled = true
      myStream?.getTracks().forEach((t) => t.stop())
      myPc?.close()
      myWs?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  if (error) {
    return (
      <Centered>
        <Card className="max-w-md text-center">
          <p className="text-red-300 mb-4">{error}</p>
          <Link to="/" className="text-indigo-400 hover:text-indigo-300 text-sm">← Back to home</Link>
        </Card>
      </Centered>
    )
  }

  if (!info) return <Centered><p className="text-slate-400">Opening conference room…</p></Centered>

  if (callState === 'cancelled') {
    return (
      <Centered>
        <Card className="max-w-md text-center">
          <p className="eyebrow mb-2">Conference</p>
          <h1 className="text-xl font-semibold mb-2">This conference was cancelled</h1>
          <p className="text-sm text-slate-400">Check your email for any updates, or contact HR directly.</p>
        </Card>
      </Centered>
    )
  }

  if (callState === 'disconnected') {
    return (
      <Centered>
        <Card className="max-w-md text-center">
          <p className="eyebrow mb-2">Conference</p>
          <h1 className="text-xl font-semibold mb-2">Connection lost</h1>
          <p className="text-sm text-slate-400 mb-5">
            The connection to this room dropped unexpectedly. Reload the page to rejoin —
            the other side won't see you again until you do.
          </p>
          <button onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium">
            Reload and rejoin
          </button>
        </Card>
      </Centered>
    )
  }

  if (callState === 'ended') {
    return (
      <Centered>
        <Card className="max-w-md text-center">
          <p className="eyebrow mb-2">Conference</p>
          <h1 className="text-xl font-semibold mb-2">The meeting has ended</h1>
          <p className="text-sm text-slate-400">Thanks for joining — you can close this tab now.</p>
        </Card>
      </Centered>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      <p className="eyebrow mb-1">Conference · {info.candidate_label}</p>
      <h1 className="text-2xl font-bold mb-1">
        {info.is_hr ? 'Candidate conference' : 'Your conference'}
      </h1>
      <p className="text-slate-400 text-sm mb-6">
        Scheduled for {info.conference_scheduled_at ? new Date(info.conference_scheduled_at).toLocaleString() : '—'}
      </p>

      {mediaError && <p className="text-xs text-amber-400 mb-4">{mediaError}</p>}

      {callState === 'waiting' && !info.is_hr && (
        <Card className="text-center py-12 mb-6">
          <div className="w-2 h-2 rounded-full bg-indigo-500 mx-auto mb-4 animate-pulse" />
          <h2 className="text-lg font-semibold mb-1">Waiting for HR to start the meeting</h2>
          <p className="text-sm text-slate-400">You're in the room — the call will begin automatically once HR starts it.</p>
        </Card>
      )}

      {callState === 'waiting' && info.is_hr && (
        <Card className="text-center py-10 mb-6">
          <h2 className="text-lg font-semibold mb-1">Ready to start</h2>
          <p className="text-sm text-slate-400 mb-5">
            {peerPresent ? 'The candidate is in the room, waiting.' : 'Waiting for the candidate to join the room…'}
          </p>
          <button onClick={() => wsRef.current?.startMeeting()}
            className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium">
            Start meeting
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900 aspect-video relative">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <span className="absolute bottom-2 left-2 text-xs bg-black/60 px-2 py-0.5 rounded">You</span>
        </div>
        <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900 aspect-video relative">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <span className="absolute bottom-2 left-2 text-xs bg-black/60 px-2 py-0.5 rounded">
            {info.is_hr ? 'Candidate' : 'HR'}
          </span>
          {callState !== 'live' && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Not connected yet</div>
          )}
        </div>
      </div>

      {callState === 'live' && info.is_hr && (
        <button onClick={() => wsRef.current?.endMeeting()}
          className="px-5 py-2.5 rounded-lg bg-red-900/70 hover:bg-red-900 text-red-100 font-medium">
          End meeting
        </button>
      )}
    </div>
  )
}

function Centered({ children }) {
  return <div className="min-h-screen flex items-center justify-center px-4">{children}</div>
}
