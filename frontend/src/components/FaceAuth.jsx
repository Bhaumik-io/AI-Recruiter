import { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'
import { candidateApi } from '../api/client'

// Models are loaded from /public/models — see frontend/public/models/README.md
// for the one-time download step required before this works.
const MODEL_URL = '/models'

// Bigger inputSize + a lower scoreThreshold catches faces far more
// reliably than the tiny-face-detector defaults, at a small speed cost
// that's a non-issue for a single still capture.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })

let modelsLoadedPromise = null
function ensureModelsLoaded() {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
  }
  return modelsLoadedPromise
}

function waitForVideoReady(video) {
  if (video.readyState >= 3) return Promise.resolve()
  return new Promise((resolve) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true })
  })
}

/**
 * mode: "enroll" (needs candidateId, mandatory right after signup) or
 * "verify" (needs candidateId, mandatory right after password login).
 * Both require a pre-auth bearer token already set on the api client —
 * the caller is responsible for that. onSuccess(payload) gets the real
 * candidate token: {status:"enrolled", token, candidate_id} for enroll,
 * or {token, candidate_id, confidence} for verify.
 */
export default function FaceAuth({ mode, candidateId, onSuccess, onError }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [status, setStatus] = useState('loading-models')
  const [busy, setBusy] = useState(false)
  const [liveHint, setLiveHint] = useState('Position your face in the frame')
  const liveCheckRef = useRef(null)

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (liveCheckRef.current) {
      clearInterval(liveCheckRef.current)
      liveCheckRef.current = null
    }
  }

  useEffect(() => {
    // If the component unmounts (or the user backs out / navigates away)
    // while getUserMedia() is still pending, the promise still resolves
    // afterward — without this guard, the resulting stream gets attached
    // to nothing and just keeps running (camera light stays on forever,
    // with no component left around to stop it).
    let cancelled = false

    ensureModelsLoaded()
      .then(() => navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 } }))
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = s
        if (videoRef.current) videoRef.current.srcObject = s
        return waitForVideoReady(videoRef.current)
      })
      .then(() => {
        if (cancelled) return
        setStatus('ready')
        // Live feedback loop so the candidate knows *before* clicking
        // capture whether a face is actually being picked up — this is
        // what actually fixes "the software can't detect my face":
        // people were clicking capture before the frame was readable.
        liveCheckRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 3) return
          const d = await faceapi.detectSingleFace(videoRef.current, DETECTOR_OPTIONS)
          setLiveHint(d ? '✅ Face detected — hold still and capture' : '⚠ No face detected — move closer / improve lighting')
        }, 600)
      })
      .catch((e) => {
        setStatus('error')
        onError?.(`Camera/model init failed: ${e.message}`)
      })
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [])

  async function captureAndSubmit() {
    setBusy(true)
    try {
      await waitForVideoReady(videoRef.current)
      const detection = await faceapi
        .detectSingleFace(videoRef.current, DETECTOR_OPTIONS)
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (!detection) {
        onError?.('No face detected. Make sure your face is clearly visible, centered, and well-lit, then try again.')
        setBusy(false)
        return
      }

      const descriptor = Array.from(detection.descriptor)
      const path = mode === 'enroll' ? '/auth/face/enroll' : '/auth/face/verify'
      const res = await candidateApi.post(path, { candidate_id: candidateId, descriptor })
      // Turn the camera off the instant verification succeeds — don't
      // wait for this component to unmount (navigation can lag a beat
      // behind the network response, and the light stays on until then).
      stopCamera()
      setStatus('done')
      onSuccess(res.data)
    } catch (e) {
      onError?.(e.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-80 h-60 rounded-xl overflow-hidden border border-slate-700 bg-black">
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
        {status === 'loading-models' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
            Loading face models...
          </div>
        )}
        {status === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300 bg-black">
            ✅ Verified — camera off
          </div>
        )}
      </div>
      {status === 'ready' && (
        <p className="text-xs -mt-2 text-slate-300">{liveHint}</p>
      )}
      <button
        onClick={captureAndSubmit}
        disabled={status !== 'ready' || busy}
        className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-slate-950 font-medium transition"
      >
        {busy ? 'Processing...' : mode === 'enroll' ? 'Enroll my face' : 'Verify my face'}
      </button>
      <p className="text-xs text-slate-400 max-w-xs text-center">
        Your face is processed entirely in your browser. Only a numeric descriptor
        (not your photo or video) is ever sent to the server.
      </p>
    </div>
  )
}
