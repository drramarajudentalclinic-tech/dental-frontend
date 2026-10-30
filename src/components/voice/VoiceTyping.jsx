/* ═══════════════════════════════════════════════════════════════════════
   DICTATE ANYWHERE
   Click into any text box in the app (notes, complaint, history, advice,
   prescription notes…) and a small 🎙 button appears at the bottom right.
   Press it (or Alt+D) and speak: the words are typed into that box, with
   dental clean-up — "tooth one six" → "tooth 16", "r c t" → "RCT",
   "upper right first molar" → "16", "comma" / "full stop" / "new line".

   Loaded once for the whole app: importing this file is enough
   (import "./components/voice/VoiceTyping"; in main.jsx). It is also
   imported by the Dental Chart and Consultation screens, so it is there
   on the visit page even without that line. Boxes inside the Voice panel,
   password / number / date boxes and boxes marked data-novoice are skipped.
   ═══════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useSpeech, LANGS, speechSupported } from "./useSpeech";
import { normalizeDictation } from "./dentalNormalizer";

const TEXT_TYPES = new Set(["text", "search", "", "url", "tel", "email"]);
function isDictatable(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.closest?.("[data-novoice], .vx-panel, .vxt-root")) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") return TEXT_TYPES.has((el.getAttribute("type") || "").toLowerCase()) && el.type !== "tel" && el.type !== "email";
  return false;
}
// React keeps its own copy of the value: set it the way a keyboard would
function insertText(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start), after = el.value.slice(end);
  const needsSpace = before && !/[\s(\n]$/.test(before) && !/^[.,;:?!)\n]/.test(text);
  const atSentenceStart = !before.trim() || /[.?!\n]\s*$/.test(before);
  let piece = normalizeDictation(text, { sentenceStart: atSentenceStart });
  if (!atSentenceStart) piece = piece.replace(/^([A-Z])(?![A-Z0-9])/, (m) => m.toLowerCase());
  piece = (needsSpace ? " " : "") + piece;
  const value = before + piece + after;
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const pos = before.length + piece.length;
  try { el.setSelectionRange(pos, pos); } catch { /* some inputs cannot */ }
  return piece.trim();
}
const prefs = {
  get(k, d) { try { return window.localStorage.getItem(`vxt-${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { window.localStorage.setItem(`vxt-${k}`, v); } catch { /* private window */ } },
};

function VoiceTyping() {
  const [target, setTarget] = useState(null);       // the text box that will receive the words
  const [show, setShow] = useState(false);
  const [lang, setLang] = useState(() => prefs.get("lang", "en-IN"));
  const [flash, setFlash] = useState("");
  const [hidden, setHidden] = useState(() => prefs.get("hidden", "0") === "1");
  const targetRef = useRef(null);
  targetRef.current = target;
  const hideTimer = useRef(null);

  const sp = useSpeech({
    lang, owner: "typing",
    onFinal: (t) => {
      const el = targetRef.current;
      if (el && document.contains(el)) { setFlash(insertText(el, t)); setTimeout(() => setFlash(""), 1800); }
    },
  });

  useEffect(() => {
    const onFocus = (e) => {
      const el = e.target;
      if (isDictatable(el)) {
        clearTimeout(hideTimer.current);
        if (targetRef.current !== el && sp.listening) sp.stop();
        setTarget(el); setShow(true);
      }
    };
    const onBlur = () => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        const a = document.activeElement;
        if (!isDictatable(a) && !sp.listening) setShow(false);
      }, 2500);
    };
    const onKey = (e) => {
      if (e.altKey && (e.key === "d" || e.key === "D")) {
        const a = document.activeElement;
        if (isDictatable(a) || sp.listening) { e.preventDefault(); if (isDictatable(a)) setTarget(a); setShow(true); sp.listening ? sp.stop() : sp.start(); }
      }
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("focusin", onFocus); document.removeEventListener("focusout", onBlur); document.removeEventListener("keydown", onKey); };
  }, [sp]);

  useEffect(() => { prefs.set("lang", lang); }, [lang]);
  useEffect(() => { if (target && !document.contains(target)) { sp.stop(); setShow(false); } });

  if (!speechSupported() || !show || !target) return null;
  if (hidden) {
    return (
      <button type="button" className="vxt-root vxt-mini" title="Show the dictation microphone" onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setHidden(false); prefs.set("hidden", "0"); }}>
        <style>{CSS}</style>🎙
      </button>
    );
  }
  const name = target.getAttribute("aria-label") || target.getAttribute("placeholder") || target.name || "this box";
  return (
    <div className="vxt-root" onMouseDown={(e) => { if (e.target.tagName !== "SELECT") e.preventDefault(); }}>
      <style>{CSS}</style>
      {(sp.listening || sp.error || flash) && (
        <div className={`vxt-bubble ${sp.error ? "err" : ""}`}>
          {sp.error || (sp.interim ? `… ${sp.interim}` : flash ? `✓ ${flash}` : `Listening — speaking into “${String(name).slice(0, 40)}”`)}
        </div>
      )}
      <div className="vxt-bar">
        <select value={lang} aria-label="Dictation language" onChange={(e) => { setLang(e.target.value); if (sp.listening) sp.stop(); }}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.code === "en-IN" ? "EN" : l.code === "te-IN" ? "తె" : "हि"}</option>)}
        </select>
        <button type="button" className={`vxt-mic ${sp.listening ? "live" : ""}`} title="Dictate into this box (Alt+D)"
          aria-label={sp.listening ? "Stop dictation" : "Start dictation"} onClick={() => (sp.listening ? sp.stop() : sp.start())}
          style={sp.listening ? { boxShadow: `0 0 0 ${4 + sp.level * 10}px rgba(239,68,68,.18)` } : undefined}>
          {sp.listening ? "■" : "🎙"}
        </button>
        <button type="button" className="vxt-hide" title="Hide the microphone" aria-label="Hide" onClick={() => { sp.stop(); setHidden(true); prefs.set("hidden", "1"); }}>–</button>
      </div>
    </div>
  );
}

const CSS = `
.vxt-root{position:fixed;right:18px;bottom:18px;z-index:9990;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.vxt-bar{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:4px 6px 4px 8px;box-shadow:0 8px 24px rgba(15,23,42,.18)}
.vxt-bar select{border:none;background:#f1f5f9;border-radius:999px;font-size:12px;padding:3px 4px;color:#334155;cursor:pointer}
.vxt-mic{width:42px;height:42px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:18px;background:linear-gradient(145deg,#4f46e5,#2563eb);transition:box-shadow .08s linear}
.vxt-mic.live{background:linear-gradient(145deg,#ef4444,#dc2626)}
.vxt-hide{border:none;background:none;color:#94a3b8;cursor:pointer;font-size:16px;width:20px}
.vxt-bubble{max-width:320px;background:#0f172a;color:#fff;font-size:12.5px;line-height:1.4;border-radius:10px;padding:7px 11px;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.vxt-bubble.err{background:#991b1b}
.vxt-mini{width:30px;height:30px;border-radius:50%;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.12);display:block}
@media print{.vxt-root{display:none!important}}
`;

// mount once for the whole app
if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__vxTypingMounted) {
  window.__vxTypingMounted = true;
  const mount = () => {
    const host = document.createElement("div");
    host.className = "vxt-host";
    document.body.appendChild(host);
    createRoot(host).render(<VoiceTyping />);
  };
  if (document.body) mount(); else window.addEventListener("DOMContentLoaded", mount);
}
export default VoiceTyping;