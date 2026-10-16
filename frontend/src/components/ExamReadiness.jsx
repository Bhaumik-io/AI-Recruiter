import { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { examApi } from "../lib/examApi";
import { T } from "../lib/examTheme";

const MODEL_URL = "/models";
const OPTS = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
const LOOP_MS = 800;
const MAX_TRIES = 12; // wrong-face attempts before asking for the invigilator

// Step between "share screen" and "start exam": proves the camera works, shows ONE
// clear face, and that it is the same person who enrolled at sign-up. The server
// remembers the pass (/exam/face-check) and /exam/start refuses without it.
export default function ExamReadiness({ screenStream, onBegin, beginBusy, error }) {
  const videoRef = useRef(null);
  const matchedRef = useRef(false);
  const busyRef = useRef(false);
  const triesRef = useRef(0);
  const [modelsReady, setModelsReady] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraMsg, setCameraMsg] = useState("Starting camera…");
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [screenOk, setScreenOk] = useState(true);
  const [faceOk, setFaceOk] = useState(false);
  const [faceMsg, setFaceMsg] = useState("Looking for your face…");
  const [matched, setMatched] = useState(false);
  const [matchMsg, setMatchMsg] = useState("");
  const [tries, setTries] = useState(0);

  // fullscreen state
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // screen share must still be live and be the entire screen
  useEffect(() => {
    const track = screenStream?.getVideoTracks?.()[0];
    if (!track) {
      setScreenOk(false);
      return;
    }
    const check = () => {
      const s = track.getSettings?.() || {};
      setScreenOk(track.readyState === "live" && (!s.displaySurface || s.displaySurface === "monitor"));
    };
    check();
    track.addEventListener("ended", check);
    return () => track.removeEventListener("ended", check);
  }, [screenStream]);

  // models + camera + detection loop
  useEffect(() => {
    let cancelled = false;
    let stream;
    let timer;
    let running = false;
    let single = 0; // consecutive frames with exactly one good face

    async function loop() {
      const v = videoRef.current;
      if (running || cancelled || !v || v.readyState < 3) return;
      running = true;
      try {
        const live = stream?.getVideoTracks()[0]?.readyState === "live";
        setCamera(live);
        if (!live) {
          setCameraMsg("The camera stopped. Unplug/replug it or allow it again, then refresh this page.");
          return;
        }
        const dets = await faceapi.detectAllFaces(v, OPTS);
        if (dets.length === 0) {
          single = 0;
          setFaceOk(false);
          setFaceMsg("No face found. Sit in front of the camera with good light.");
        } else if (dets.length > 1) {
          single = 0;
          setFaceOk(false);
          setFaceMsg("More than one face in view. Only you should be visible.");
        } else if (dets[0].box.width < v.videoWidth * 0.15) {
          single = 0;
          setFaceOk(false);
          setFaceMsg("Move a little closer to the camera.");
        } else {
          single += 1;
          if (single >= 2) {
            setFaceOk(true);
            setFaceMsg("One clear face detected.");
          }
          if (single >= 2 && !matchedRef.current && !busyRef.current && triesRef.current < MAX_TRIES) {
            busyRef.current = true;
            setMatchMsg("Checking it is you…");
            try {
              const full = await faceapi.detectSingleFace(v, OPTS).withFaceLandmarks().withFaceDescriptor();
              if (full) {
                const res = await examApi.faceCheck(Array.from(full.descriptor));
                if (res.match) {
                  matchedRef.current = true;
                  setMatched(true);
                  setMatchMsg("Face matches your sign-up photo.");
                } else {
                  triesRef.current += 1;
                  setTries(triesRef.current);
                  setMatchMsg("This face doesn't match the one used at sign-up. Face the camera straight, in good light.");
                }
              }
            } catch (e) {
              setMatchMsg(e.message || "Face check failed. Trying again…");
            } finally {
              busyRef.current = false;
            }
          }
        }
      } finally {
        running = false;
      }
    }

    (async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        if (cancelled) return;
        setModelsReady(true);
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCamera(true);
        setCameraMsg("Camera is working.");
        stream.getVideoTracks()[0].addEventListener("ended", () => {
          setCamera(false);
          setCameraMsg("The camera stopped. Reconnect it and refresh this page.");
        });
        timer = setInterval(loop, LOOP_MS);
      } catch (e) {
        setCamera(false);
        setCameraMsg(
          e?.name === "NotAllowedError"
            ? "Camera permission was blocked. Click the camera icon in the address bar, allow it, then refresh."
            : "Could not start the camera: " + (e?.message || "unknown error")
        );
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop()); // AntiCheatMonitor opens its own stream
    };
  }, []);

  const allOk = camera && screenOk && fullscreen && faceOk && matched;

  return (
    <div className={`${T.card} space-y-4`}>
      <div>
        <div className={T.eyebrow}>Before you begin</div>
        <h1 className="text-lg font-semibold text-white">System check</h1>
        <div className={T.muted}>The exam starts only when every item below is green.</div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-40 w-52 shrink-0 rounded-lg border border-[#1c2230] bg-black object-cover [transform:scaleX(-1)]"
        />
        <ul className="flex-1 space-y-2 text-xs">
          <Row ok={modelsReady && camera} label="Camera is working" hint={cameraMsg} />
          <Row ok={screenOk} label="Entire screen is being shared" hint="Sharing stopped or a window was shared. Refresh and share the ENTIRE screen." />
          <Row
            ok={fullscreen}
            label="Fullscreen is on"
            hint="Press the button to go fullscreen."
            action={
              !fullscreen && (
                <button className={T.btnLink} onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>
                  Enter fullscreen
                </button>
              )
            }
          />
          <Row ok={faceOk} label="One clear face in view" hint={faceMsg} />
          <Row ok={matched} label="Face matches your sign-up" hint={matchMsg || "Waiting for a clear face…"} />
        </ul>
      </div>

      {tries >= MAX_TRIES && !matched && (
        <div className={T.error}>
          Your face could not be matched after several tries. Please call your invigilator.
          <button
            className={`${T.btnLink} ml-3`}
            onClick={() => {
              triesRef.current = 0;
              setTries(0);
              setMatchMsg("");
            }}
          >
            Try again
          </button>
        </div>
      )}
      {error && <div className={T.error}>{error}</div>}

      <button onClick={onBegin} disabled={!allOk || beginBusy} className={`${T.btnGold} w-full`}>
        {beginBusy ? "Starting…" : allOk ? "Begin exam" : "Complete the checks to begin"}
      </button>
    </div>
  );
}

function Row({ ok, label, hint, action }) {
  return (
    <li className="flex items-start gap-2">
      <span className={ok ? "text-[#6fd3a0]" : "text-[#e0645c]"}>{ok ? "✓" : "✗"}</span>
      <div>
        <div className={ok ? "text-[#cfd3dc]" : "text-white"}>{label}</div>
        {!ok && <div className="text-[#6b7385]">{hint}</div>}
        {action}
      </div>
    </li>
  );
}
