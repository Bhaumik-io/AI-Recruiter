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
export default function ExamReadiness({ screenStream, onBegin, beginBusy, error , cameraStream }) {
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
  const [attempt, setAttempt] = useState(0); // bumped by "Retry camera"

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
    let darkTicks = 0; // consecutive ticks where the picture is (nearly) black
    let reopens = 0;
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 24;

    // average brightness 0-255 of the current video frame
    function brightness(v) {
      try {
        const c = probe.getContext("2d", { willReadFrequently: true });
        c.drawImage(v, 0, 0, 32, 24);
        const d = c.getImageData(0, 0, 32, 24).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        return sum / (d.length / 4);
      } catch {
        return 255;
      }
    }

    // Some webcams (HP Omen / Victus among them) report "working" but send black frames, especially
    // right after screen sharing starts. Close and reopen the camera a few times before giving up.
    async function reopenCamera() {
      reopens += 1;
      setCameraMsg("Camera picture is black. Restarting the camera…");
      stream?.getTracks().forEach((t) => t.stop());
      await new Promise((r) => setTimeout(r, 800));
      if (cancelled) return;
      try {
        stream = await openCamera();
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        darkTicks = 0;
      } catch (e) {
        setCamera(false);
        setCameraMsg("Could not restart the camera. Close other apps using it, then press Retry camera.");
      }
    }

    async function loop() {
      const v = videoRef.current;
      if (running || cancelled || !v || v.readyState < 3) return;
      running = true;
      try {
        const live = stream?.getVideoTracks()[0]?.readyState === "live";
        setCamera(live);
        if (!live) {
          setCameraMsg("The camera stopped. Unplug/replug it or allow it again, then press Retry camera.");
          return;
        }
        if (brightness(v) < 8) {
          darkTicks += 1;
          setFaceOk(false);
          setFaceMsg("The camera picture is black. Check the camera shutter or the laptop's camera key (Fn), and wait a few seconds.");
          if (darkTicks >= 6 && reopens < 3) await reopenCamera(); // ~5 seconds of black
          else if (darkTicks >= 6) setCameraMsg("Camera picture stays black. Close other apps using the camera, check the shutter / privacy key, then press Retry camera.");
          return;
        }
        darkTicks = 0;
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

    const stopStream = (st) => st?.getTracks().forEach((t) => t.stop());
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));

    // the face-check files are downloaded from this site; retry a few times on a weak connection
    async function loadModels() {
      for (let i = 0; i < 3; i++) {
        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
          ]);
          return;
        } catch {
          if (cancelled) return;
          setCameraMsg(`Downloading the face-check files… (try ${i + 2} of 3)`);
          await pause(1500 * (i + 1));
        }
      }
      throw Object.assign(new Error("Could not download the face-check files. Check your internet, then press Retry camera."), { name: "ModelLoadError" });
    }

    async function openCamera() {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      } catch (e) {
        if (e?.name === "OverconstrainedError" || e?.name === "TypeError") {
          return navigator.mediaDevices.getUserMedia({ video: true }); // camera that cannot do 640x480
        }
        throw e;
      }
    }

    (async () => {
      let camStream = null;
      try {
        setCamera(false);
        setCameraMsg("Starting camera…");
        // ask for the camera and download the models at the same time (saves several seconds)
        // the camera may already be open (it is opened BEFORE screen sharing starts, which avoids
        // the black picture some laptops give when both start together)
        const preLive = cameraStream?.getVideoTracks()[0]?.readyState === "live";
        const camPromise = (preLive ? Promise.resolve(cameraStream) : openCamera()).then(
          (st) => ({ st }),
          (err) => ({ err })
        );
        try {
          await loadModels();
        } catch (e) {
          stopStream((await camPromise).st);
          throw e;
        }
        const cam = await camPromise;
        camStream = cam.st || null;
        if (cancelled) {
          stopStream(camStream);
          return;
        }
        setModelsReady(true);
        if (!camStream) throw cam.err;
        stream = camStream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCamera(true);
        setCameraMsg("Camera is working.");
        stream.getVideoTracks()[0].addEventListener("ended", () => {
          setCamera(false);
          setCameraMsg("The camera stopped. Reconnect it and press Retry camera.");
        });
        timer = setInterval(loop, LOOP_MS);
      } catch (e) {
        setCamera(false);
        const n = e?.name;
        setCameraMsg(
          n === "NotAllowedError" || n === "SecurityError"
            ? "Camera permission was blocked. Click the camera icon in the address bar, choose Allow, then press Retry camera."
            : n === "NotReadableError" || n === "TrackStartError"
              ? "The camera is being used by another app or browser tab (Zoom, Meet, Teams, camera app). Close it, then press Retry camera."
              : n === "NotFoundError" || n === "DevicesNotFoundError"
                ? "No camera was found. Connect or enable a camera, then press Retry camera."
                : n === "ModelLoadError"
                  ? e.message
                  : "Could not start the camera: " + (e?.message || "unknown error") + ". Press Retry camera."
        );
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop()); // AntiCheatMonitor opens its own stream
    };
  }, [attempt]);

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
          <Row
            ok={modelsReady && camera}
            label="Camera is working"
            hint={cameraMsg}
            action={
              !camera && (
                <button className={T.btnLink} onClick={() => setAttempt((a) => a + 1)}>
                  Retry camera
                </button>
              )
            }
          />
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
