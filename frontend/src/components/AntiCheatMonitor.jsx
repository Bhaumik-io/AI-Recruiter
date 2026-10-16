import { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'
import { candidateApi } from '../api/client'

const MODEL_URL = '/models'
const CHECK_INTERVAL_MS = 500
const MAX_WARNINGS = 3
// Larger inputSize = more accurate landmark localization (matters for the
// gaze heuristic), at some extra CPU cost per 2s tick — worth it for a
// proctoring context where accuracy beats raw speed.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })

/**
 * Mounts a small always-on webcam feed + periodic face-presence/gaze
 * check, plus tab-visibility / window-focus / fullscreen-exit /
 * dev-tools / copy-paste / screen-share / browser-close listeners, for
 * the duration an interview is open. Every notable event is throttled
 * and POSTed to /proctoring/{candidateId}/event. This never uploads
 * video or screen content — only short event labels, on purpose (see
 * proctoring_router.py). The backend is the source of truth for the
 * strike count and for deciding when to auto-terminate; once it reports
 * back terminated: true (3rd strike), onTerminated(reason) fires so the
 * parent page can immediately lock the candidate out of the interview.
 *
 * screenStream (optional): the MediaStream from the mandatory full-screen
 * share started on the "Ready to begin?" gate in CandidateInterview.jsx.
 * We only watch it for two things — did they stop sharing, and did they
 * share the whole screen vs. just a window/tab — we never read its pixels.
 */
// Consecutive misses required before a face-presence/gaze event is
// reported. At CHECK_INTERVAL_MS=500, 4 misses in a row means ~4s of
// sustained no-face/gaze-away — still enough to filter out a single bad
// frame (blink, motion blur), but half the reaction time of before.
// Multiple faces is treated as unambiguous, not a flaky-frame risk, so it
// fires on the very first detection instead of waiting for a streak.
const CONSECUTIVE_MISSES_REQUIRED = 4
const MULTI_FACE_MISSES_REQUIRED = 1

// Heuristic gaze/head-pose thresholds — NOT true 3D pose estimation,
// just nose-vs-eye-center offset relative to face box size. Tightened
// for a strict interview setting: catches looking down at a phone/notes
// or turning toward a second screen noticeably faster, at the cost of
// being pickier about "normal" reading posture too.
const GAZE_HORIZONTAL_THRESHOLD = 0.15
const GAZE_VERTICAL_DOWN_THRESHOLD = 0.18

function avgPoint(points) {
  const n = points.length
  const sum = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / n, y: sum.y / n }
}

// verifyFn (optional): async (descriptor) => boolean. Exam only: every verifyEveryMs the
// current face is compared with the enrolled one; 3 misses in a row = 'face_mismatch' strike.
export default function AntiCheatMonitor({ candidateId, onTerminated, screenStream, label = 'interview', verifyFn, verifyEveryMs = 60000, onCameraState }) {
  const cameraCbRef = useRef(onCameraState)
  cameraCbRef.current = onCameraState
  const cameraLostRef = useRef(false)
  const videoRef = useRef(null)
  const [warnings, setWarnings] = useState([])
  const [warningCount, setWarningCount] = useState(0)
  const lastEventAtRef = useRef({})
  const terminatedRef = useRef(false)
  const noFaceStreakRef = useRef(0)
  const multiFaceStreakRef = useRef(0)
  const lookingAwayStreakRef = useRef(0)
  const lastVerifyRef = useRef(Date.now())
  const verifyBusyRef = useRef(false)
  const mismatchRef = useRef(0)

  function pushWarning(text) {
    setWarnings((w) => [...w.slice(-4), { text, at: new Date().toLocaleTimeString() }])
  }

  // Single entry point for every proctoring signal. Throttling happens
  // here, BEFORE the UI banner is shown — that way the banner and the
  // backend strike count can never drift apart: if it's on screen, it was
  // actually logged as a strike.
  async function report(eventType, severity, uiText, detail = '', { beacon = false } = {}) {
    if (terminatedRef.current) return
    // throttle identical event types so a flaky webcam frame doesn't spam
    // the log, but tight enough for a strict interview: repeated real
    // violations of the same kind can still rack up strikes quickly.
    const now = Date.now()
    const last = lastEventAtRef.current[eventType] || 0
    if (now - last < 5000) return
    lastEventAtRef.current[eventType] = now

    pushWarning(uiText)

    const payload = { event_type: eventType, severity, detail }

    // beforeunload can't reliably await a normal axios response, so a
    // browser close / hard reload uses fetch(..., {keepalive: true})
    // instead — it still carries the Authorization header (sendBeacon
    // can't set headers, so it can't hit our bearer-token-gated route).
    if (beacon) {
      try {
        const token = localStorage.getItem('candidate_token')
        fetch(`${candidateApi.defaults.baseURL}/proctoring/${candidateId}/event`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        })
      } catch (e) {
        console.warn('Failed to log browser-close proctoring event', e)
      }
      return
    }

    try {
      const res = await candidateApi.post(`/proctoring/${candidateId}/event`, payload)
      const data = res.data
      setWarningCount(data.warning_count)
      if (data.terminated && !terminatedRef.current) {
        terminatedRef.current = true
        onTerminated?.(data.termination_reason)
      }
    } catch (e) {
      console.warn('Failed to log proctoring event', e)
    }
  }

  useEffect(() => {
    let stream
    let intervalId
    // Same guard as FaceAuth: if this component unmounts (interview
    // submitted, terminated, or the page navigates away) before
    // getUserMedia() resolves, stop the stream the instant it arrives
    // instead of attaching it to a video element that's already gone.
    let cancelled = false

    Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      ...(verifyFn ? [faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)] : []),
    ])
      .then(() => navigator.mediaDevices.getUserMedia({ video: {} }))
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
        cameraCbRef.current?.(true)
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (!cameraLostRef.current) {
            cameraLostRef.current = true
            cameraCbRef.current?.(false)
            report('no_face', 'high', 'Camera stopped working', 'camera lost')
          }
        })

        intervalId = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 3) return
          const detections = await faceapi.detectAllFaces(
            videoRef.current,
            DETECTOR_OPTIONS
          )

          if (detections.length === 0) {
            multiFaceStreakRef.current = 0
            lookingAwayStreakRef.current = 0
            noFaceStreakRef.current += 1
            if (noFaceStreakRef.current >= CONSECUTIVE_MISSES_REQUIRED) {
              report('no_face', 'warning', 'No face detected in frame')
            }
          } else if (detections.length > 1) {
            noFaceStreakRef.current = 0
            lookingAwayStreakRef.current = 0
            multiFaceStreakRef.current += 1
            if (multiFaceStreakRef.current >= MULTI_FACE_MISSES_REQUIRED) {
              report('multiple_faces', 'high', 'Multiple faces detected', `${detections.length} faces`)
            }
          } else {
            // exactly one face — reset presence streaks, then check gaze
            noFaceStreakRef.current = 0
            multiFaceStreakRef.current = 0

            // exam only: is this still the enrolled student?
            if (verifyFn && !verifyBusyRef.current && Date.now() - lastVerifyRef.current > verifyEveryMs) {
              verifyBusyRef.current = true
              try {
                const full = await faceapi.detectSingleFace(videoRef.current, DETECTOR_OPTIONS).withFaceLandmarks().withFaceDescriptor()
                if (full) {
                  const ok = await verifyFn(Array.from(full.descriptor))
                  if (ok) {
                    mismatchRef.current = 0
                    lastVerifyRef.current = Date.now()
                  } else {
                    mismatchRef.current += 1
                    if (mismatchRef.current >= 3) {
                      mismatchRef.current = 0
                      lastVerifyRef.current = Date.now()
                      report('face_mismatch', 'high', 'Face does not match the registered student')
                    }
                  }
                }
              } catch (e) {
                console.warn('Face re-check failed', e)
              } finally {
                verifyBusyRef.current = false
              }
            }

            const withLandmarks = await faceapi
              .detectSingleFace(videoRef.current, DETECTOR_OPTIONS)
              .withFaceLandmarks()
            if (withLandmarks) {
              const box = withLandmarks.detection.box
              const nose = avgPoint(withLandmarks.landmarks.getNose())
              const leftEye = avgPoint(withLandmarks.landmarks.getLeftEye())
              const rightEye = avgPoint(withLandmarks.landmarks.getRightEye())
              const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 }

              const horizontalOffset = (nose.x - eyeCenter.x) / box.width
              const verticalOffset = (nose.y - eyeCenter.y) / box.height

              const lookingAway =
                Math.abs(horizontalOffset) > GAZE_HORIZONTAL_THRESHOLD ||
                verticalOffset > GAZE_VERTICAL_DOWN_THRESHOLD

              if (lookingAway) {
                lookingAwayStreakRef.current += 1
                if (lookingAwayStreakRef.current >= CONSECUTIVE_MISSES_REQUIRED) {
                  report('looking_away', 'warning', 'Looking away from the screen')
                }
              } else {
                lookingAwayStreakRef.current = 0
              }
            }
          }
        }, CHECK_INTERVAL_MS)
      })
      .catch(() => {
        pushWarning('Camera unavailable — proctoring limited')
        cameraCbRef.current?.(false)
      })

    const onVisibilityChange = () => {
      if (document.hidden) {
        report('tab_blur', 'high', 'Switched away from the interview tab')
      }
    }
    // visibilitychange only fires once the page is FULLY occluded (a
    // different tab, a minimized window, or a window that completely
    // covers the browser). If another window — Notepad, a phone-mirroring
    // app, an always-on-top overlay — only partially covers the browser or
    // sits beside it, the tab is still technically "visible" and
    // visibilitychange never fires at all. window blur/focus fire on ANY
    // OS-level focus change regardless of what's actually covered, so this
    // is the real catch-all for "switched to another app without fully
    // hiding the browser."
    const onWindowBlur = () => {
      report('window_blur', 'high', 'Switched to another window or application')
    }

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        report('fullscreen_exit', 'warning', 'Exited fullscreen mode')
      }
    }
    const onCopy = () => report('copy_paste', 'warning', 'Copy detected', 'copy')
    const onPaste = () => report('copy_paste', 'warning', 'Paste detected', 'paste')
    const onBeforeUnload = () => {
      if (terminatedRef.current) return
      report('browser_close', 'high', 'Tab closed or reloaded', 'tab closed or reloaded mid-interview', { beacon: true })
    }

    // Heuristic dev-tools-open check: when a browser's DevTools panel is
    // docked (not floating in its own window), it shrinks the page's
    // visible viewport relative to the outer browser window. Not
    // foolproof (undocked/separate-window DevTools won't trigger this),
    // but catches the common case with no false positives from normal
    // window resizing, since the threshold is generous.
    const DEVTOOLS_SIZE_THRESHOLD = 160
    const devToolsIntervalId = setInterval(() => {
      const widthGap = window.outerWidth - window.innerWidth
      const heightGap = window.outerHeight - window.innerHeight
      if (widthGap > DEVTOOLS_SIZE_THRESHOLD || heightGap > DEVTOOLS_SIZE_THRESHOLD) {
        report('dev_tools_opened', 'high', 'Developer tools panel detected')
      }
    }, CHECK_INTERVAL_MS)

    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      clearInterval(intervalId)
      clearInterval(devToolsIntervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [candidateId])

  // Separate effect: watch the screen-share stream handed down from
  // CandidateInterview.jsx. We only ever look at track metadata (is it
  // still live, is it "monitor" vs "window"/"tab") — never the actual
  // screen pixels.
  useEffect(() => {
    if (!screenStream) return
    const track = screenStream.getVideoTracks()[0]
    if (!track) return

    const settings = track.getSettings()
    if (settings.displaySurface && settings.displaySurface !== 'monitor') {
      report('screen_share_not_full', 'warning', 'Shared a window/tab instead of the full screen')
    }

    const onEnded = () => {
      report('screen_share_stopped', 'high', 'Screen sharing was stopped mid-interview')
    }
    track.addEventListener('ended', onEnded)
    return () => track.removeEventListener('ended', onEnded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenStream])

  return (
    <div className="fixed bottom-4 right-4 w-56 z-50 flex flex-col items-end gap-2">
      <video ref={videoRef} autoPlay muted playsInline
        className="w-40 h-28 object-cover rounded-lg border-2 border-slate-700 shadow-lg opacity-90" />
      {warningCount > 0 && (
        <div className="text-xs font-semibold bg-red-500/20 border border-red-500/40 text-red-300 px-2 py-1 rounded">
          ⚠ Cheating warning {warningCount}/{MAX_WARNINGS} — 3rd strike auto-ends the {label}
        </div>
      )}
      <div className="flex flex-col gap-1 w-full">
        {warnings.map((w, i) => (
          <div key={i} className="text-xs bg-amber-500/20 border border-amber-500/40 text-amber-200 px-2 py-1 rounded">
            ⚠ {w.text}
          </div>
        ))}
      </div>
    </div>
  )
}
