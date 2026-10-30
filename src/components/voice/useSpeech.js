/* Microphone → text, using the browser's own speech service (Chrome / Edge,
   desktop and Android). Optionally also records the sound, so the server's
   AI can listen to it again for difficult or mixed-language sentences.

   const sp = useSpeech({ lang: "en-IN", record: true, onFinal: (text) => … });
   sp.start(); sp.stop(); sp.listening; sp.interim; sp.error; sp.level (0–1);
   sp.takeAudio() → { blob, mime, seconds } | null   (the last recording)      */
import { useCallback, useEffect, useRef, useState } from "react";

const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const speechSupported = () => Boolean(SR);
export const recordingSupported = () => typeof window !== "undefined" && Boolean((window.AudioContext || window.webkitAudioContext) && navigator.mediaDevices?.getUserMedia);

export const LANGS = [
  { code: "en-IN", label: "English (India) — Telugu/Hindi words OK" },
  { code: "te-IN", label: "తెలుగు (Telugu)" },
  { code: "hi-IN", label: "हिन्दी (Hindi)" },
];

// Only one microphone user at a time across the app.
const BUS = "vx-mic-owner";
export function claimMic(owner) {
  try { window.dispatchEvent(new CustomEvent(BUS, { detail: owner })); } catch { /* old browsers */ }
}

const MAX_SECONDS = 120;   // a recording longer than this stops by itself

export function useSpeech({ lang = "en-IN", record = false, onFinal, owner = "panel" } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const want = useRef(false);
  const rec = useRef(null);
  const media = useRef(null);         // { stream, ctx, proc, pcm, raf, started }
  const lastAudio = useRef(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const restarts = useRef(0);

  const stopMedia = useCallback(() => {
    const m = media.current;
    media.current = null;
    if (!m) return;
    try { cancelAnimationFrame(m.raf); } catch { /* ignore */ }
    if (m.pcm && m.pcm.length) {
      try {
        const blob = encodeWav(m.pcm, m.ctx.sampleRate);
        lastAudio.current = { blob, mime: "audio/wav", seconds: Math.round((Date.now() - m.started) / 1000) };
      } catch { lastAudio.current = null; }
    }
    try { m.proc && m.proc.disconnect(); } catch { /* ignore */ }
    try { m.ctx && m.ctx.close(); } catch { /* ignore */ }
    setTimeout(() => { try { m.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } }, 300);
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    want.current = false;
    setListening(false);
    setInterim("");
    try { rec.current && rec.current.stop(); } catch { /* ignore */ }
    stopMedia();
  }, [stopMedia]);

  const startMedia = useCallback(async () => {
    if (!recordingSupported()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!want.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const m = { stream, started: Date.now(), raf: 0 };
      // level meter — the ring around the button moves while you speak
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        m.ctx = new Ctx();
        const an = m.ctx.createAnalyser();
        an.fftSize = 512;
        const src = m.ctx.createMediaStreamSource(stream);
        src.connect(an);
        if (record && m.ctx.createScriptProcessor) {
          // keep the sound as plain WAV (every AI service understands it)
          m.pcm = [];
          const proc = m.ctx.createScriptProcessor(4096, 1, 1);
          proc.onaudioprocess = (e) => { if (m.pcm.length < 1600) m.pcm.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
          src.connect(proc);
          proc.connect(m.ctx.destination);
          m.proc = proc;
        }
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          setLevel(Math.min(1, peak / 60));
          if (Date.now() - m.started > MAX_SECONDS * 1000) { stop(); return; }
          m.raf = requestAnimationFrame(tick);
        };
        m.raf = requestAnimationFrame(tick);
      } catch { /* meter is optional */ }
      media.current = m;
    } catch (e) {
      if (!SR) setError("The microphone is blocked. Click the 🔒 next to the address and allow the microphone.");
    }
  }, [record, stop]);

  const start = useCallback(() => {
    setError("");
    setInterim("");
    lastAudio.current = null;
    claimMic(owner);
    want.current = true;
    restarts.current = 0;
    setListening(true);
    startMedia();
    if (!SR) {
      if (!recordingSupported()) { setError("This browser cannot use the microphone. Please use Google Chrome or Microsoft Edge."); stop(); }
      return;
    }
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript || "";
        if (res.isFinal) { if (text.trim()) finalRef.current?.(text.trim()); }
        else live += text;
      }
      setInterim(live);
      restarts.current = 0;
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("The microphone is blocked. Click the 🔒 next to the address bar, allow the microphone, then try again.");
      else if (e.error === "network") setError("The speech service could not be reached. Check the internet connection.");
      else if (e.error === "audio-capture") setError("No microphone was found. Plug in a microphone or headset.");
      else if (e.error === "language-not-supported") setError("This language is not available in this browser. Choose English (India).");
      else setError(`Speech stopped (${e.error}).`);
      want.current = false;
    };
    r.onend = () => {
      // Chrome stops after a pause; keep listening until the doctor presses stop
      if (want.current && restarts.current < 20) {
        restarts.current += 1;
        try { r.start(); return; } catch { /* fall through */ }
      }
      setListening(false);
      setInterim("");
      stopMedia();
    };
    rec.current = r;
    try { r.start(); } catch { /* already started */ }
  }, [lang, owner, startMedia, stop, stopMedia]);

  // another part of the app took the microphone
  useEffect(() => {
    const onBus = (e) => { if (e.detail !== owner && want.current) stop(); };
    window.addEventListener(BUS, onBus);
    return () => { window.removeEventListener(BUS, onBus); want.current = false; try { rec.current && rec.current.abort(); } catch { /* ignore */ } stopMedia(); };
  }, [owner, stop, stopMedia]);

  const takeAudio = useCallback(() => lastAudio.current, []);
  return { listening, interim, error, level, start, stop, takeAudio, supported: Boolean(SR), canRecord: recordingSupported() };
}

/* Float32 chunks → 16 kHz mono 16-bit WAV (about 1.9 MB per minute) */
function encodeWav(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const target = 16000, step = rate / target;
  const len = Math.floor(total / step);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, target, true);
  v.setUint32(28, target * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const x = Math.max(-1, Math.min(1, all[Math.floor(i * step)] || 0));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}