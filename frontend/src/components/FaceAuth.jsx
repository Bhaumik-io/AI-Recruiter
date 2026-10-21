import { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'
import { candidateApi } from '../api/client'

// Models are loaded from /public/models — see frontend/public/models/README.md
const MODEL_URL = '/models'

// Bigger inputSize + a lower scoreThreshold catches faces far more reliably.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })

// Models are loaded once and shared. A failed load is NOT cached (it used to
// be: one flaky network blip meant "Retry" could never work until a full reload),
// and each load is retried a few times.
let modelsLoadedPromise = null
function ensureModelsLoaded() {
  if (!modelsLoadedPromise) {
    const loadOnce = () =>
      Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
    modelsLoadedPromise = (async () => {
      let last
      for (let i = 0; i < 3; i++) {
        try {
          return await loadOnce()
        } catch (e) {
          last = e
          await new Promise((r) => setTimeout(r, 800 * (i + 1)))
        }
      }
      throw last
    })().catch((e) => {
      modelsLoadedPromise = null
      throw e
    })
  }
  return modelsLoadedPromise
}

async function openCamera() {
  const tries = [
    { video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' } },
    { video: true }, // some webcams reject size hints
  ]
  let last
  for (const c of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia(c)
    } catch (e) {
      last = e
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break // retrying won't help
    }
  }
  throw last
}

function cameraMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera is blocked. Click the camera/lock icon in the address bar, allow the camera, then press Retry.'
    case 'NotFoundError':
      return 'No camera found on this device.'
    case 'NotReadableError':
      return 'Camera is being used by another app or tab. Close it (Zoom, Meet, other tabs), then press Retry.'
    default:
      return `Camera/model init failed: ${e?.message || e}`
  }
}

function waitForVideoReady(video, ms = 8000) {
  if (video.readyState >= 3) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Camera did not start in time')), ms)
    video.addEventListener('loadeddata', () => { clearTimeout(t); resolve() }, { once: true })
  })
}

/**
 * mode: "enroll" (needs candidateId, mandatory right after signup) or
 * "verify" (needs candidateId, mandatory right after password login).
 * Both require a pre-auth bearer token already set on the api client.
 * onSuccess(payload) gets the real candidate token.
 */
export default function FaceAuth({ mode, candidateId, onSuccess, onError }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [status, setStatus] = useState('loading-models')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [liveHint, setLiveHint] = useState('Position your face in the frame')
  const stopLiveRef = useRef(false)

  function stopCamera() {
    stopLiveRef.current = true
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    // Guard: if we unmount while getUserMedia is pending, stop the stream.
    let cancelled = false
    stopLiveRef.current = false
    setStatus('loading-models')

    // Camera and models start together (was one after the other).
    Promise.all([ensureModelsLoaded(), openCamera()])
      .then(([, s]) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = s
        videoRef.current.srcObject = s
        return waitForVideoReady(videoRef.current).then(() => {
          if (cancelled) return
          setStatus('ready')
          // Live "is a face visible" hint. Runs one check at a time (no
          // pile-up on slow laptops) and at a relaxed pace so it doesn't
          // fight the real capture for CPU.
          const loop = async () => {
            while (!cancelled && !stopLiveRef.current) {
              try {
                if (videoRef.current && videoRef.current.readyState >= 3 && !document.hidden) {
                  const d = await faceapi.detectSingleFace(videoRef.current, DETECTOR_OPTIONS)
                  if (!cancelled && !stopLiveRef.current)
                    setLiveHint(d ? '✅ Face detected — hold still and capture' : '⚠ No face detected — move closer / improve lighting')
                }
              } catch {}
              await new Promise((r) => setTimeout(r, 900))
            }
          }
          loop()
        })
      })
      .catch((e) => {
        if (cancelled) return
        stopCamera()
        setStatus('error')
        onError?.(cameraMessage(e))
      })
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [attempt])

  async function captureAndSubmit() {
    setBusy(true)
    try {
      await waitForVideoReady(videoRef.current)
      // Try up to 3 frames: a single blink/blur frame no longer fails the login.
      let detection = null
      for (let i = 0; i < 3 && !detection; i++) {
        detection = await faceapi
          .detectSingleFace(videoRef.current, DETECTOR_OPTIONS)
          .withFaceLandmarks()
          .withFaceDescriptor()
        if (!detection) await new Promise((r) => setTimeout(r, 300))
      }

      if (!detection) {
        onError?.('No face detected. Make sure your face is clearly visible, centered, and well-lit, then try again.')
        setBusy(false)
        return
      }

      const descriptor = Array.from(detection.descriptor)
      const path = mode === 'enroll' ? '/auth/face/enroll' : '/auth/face/verify'
      const res = await candidateApi.post(path, { candidate_id: candidateId, descriptor })
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
            Starting camera & face models…
          </div>
        )}
        {status === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300 bg-black">
            ✅ Verified — camera off
          </div>
        )}
      </div>
      {status === 'ready' && <p className="text-xs -mt-2 text-slate-300">{liveHint}</p>}
      {status === 'error' ? (
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-slate-950 font-medium transition"
        >
          Retry camera
        </button>
      ) : (
        <button
          onClick={captureAndSubmit}
          disabled={status !== 'ready' || busy}
          className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-slate-950 font-medium transition"
        >
          {busy ? 'Processing...' : mode === 'enroll' ? 'Enroll my face' : 'Verify my face'}
        </button>
      )}
      <p className="text-xs text-slate-400 max-w-xs text-center">
        Your face is processed entirely in your browser. Only a numeric descriptor
        (not your photo or video) is ever sent to the server.
      </p>
    </div>
  )
}
