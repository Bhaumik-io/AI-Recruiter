import { useEffect, useState } from "react";

// Shows a "please wait, don't refresh" banner whenever a sign-up / login / face-check / start / submit
// request has been running for more than a few seconds (the free server can be slow when many students
// arrive together). Refreshing or clicking again only makes the queue longer.
// Mounted once in App.jsx; it watches network calls (fetch and axios) so no page needs to change.
const WATCH = ["/auth/", "/exam/face-check", "/exam/start", "/exam/submit", "/exam-invites/", "/exam/syllabus", "/exam/papers/generate", "/exam/approve", "/rescore"];
const SHOW_AFTER_MS = 3000;
const watched = (url) => WATCH.some((p) => String(url || "").includes(p));

export default function SlowNotice() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const pending = new Map(); // id -> start time
    let n = 0;
    const begin = () => {
      const id = ++n;
      pending.set(id, Date.now());
      return id;
    };
    const end = (id) => pending.delete(id);

    // fetch
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input?.url;
      if (!watched(url)) return origFetch.apply(this, arguments);
      const id = begin();
      return origFetch.apply(this, arguments).finally(() => end(id));
    };

    // XMLHttpRequest (axios uses this)
    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    proto.open = function (method, url) {
      this.__slowUrl = url;
      return origOpen.apply(this, arguments);
    };
    proto.send = function () {
      if (watched(this.__slowUrl)) {
        const id = begin();
        this.addEventListener("loadend", () => end(id));
      }
      return origSend.apply(this, arguments);
    };

    const timer = setInterval(() => {
      const oldest = Math.min(Infinity, ...pending.values());
      setSlow(pending.size > 0 && Date.now() - oldest > SHOW_AFTER_MS);
    }, 500);

    return () => {
      clearInterval(timer);
      window.fetch = origFetch;
      proto.open = origOpen;
      proto.send = origSend;
    };
  }, []);

  if (!slow) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[100] border-b border-[#5a4a1f] bg-[#241c08] px-4 py-2.5 text-center text-xs text-[#e3b552] shadow-lg"
    >
      ⏳ Please wait. This can take up to a minute when many people are online or the AI is working.{" "}
      <b className="text-white">Do not refresh the page or click again.</b>
    </div>
  );
}
