/* ═══════════════════════════════════════════════════════════════════════
   VOICE TO CHART — speak, check, save
   1. The doctor presses the microphone (or Alt+M) and speaks naturally —
      English with Telugu / Hindi words is fine — or types shorthand.
   2. The Dental Normaliser turns every sentence into entries at once.
      "✨ AI tidy-up" asks the server's AI to re-read difficult sentences.
   3. Every entry is shown as a short, readable line for checking; tap a
      line to change it. Nothing is saved until "Save" is pressed.

   Doctor-friendly extras (gloves on, hands busy):
   • Spoken commands: "undo" / "scratch that", "clear all", "save",
     "read back", "stop listening".
   • 🔊 Read back: the app says what it understood ("16, deep caries, M O D").
   • 🦷 Tooth-by-tooth (gum chart): the app holds the tooth; just say the
     six depths — "5 4 6, 4 3 5, bleeding" — and it moves to the next tooth.
     Say "next", "back", "skip" or "missing".
   • The unsaved text is kept if the window is closed by mistake.

   <VoicePanel open modes={["chart","perio"]} onSave={async (items,{date}) => …}
     onClose={…} existing={chartRows} colors={{Caries:"#dc2626",…}} draftKey={visitId} />
   ═══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../api/api";
import { useSpeech, LANGS, blobToBase64, claimMic } from "./useSpeech";
import {
  parse, CHART_CONDITIONS, TREATMENT_LABELS, ADVICE_LABELS, FREQUENCY_OPTIONS, WHEN_OPTIONS, SEVERITIES, isTooth, isDeciduous,
} from "./dentalNormalizer";

const MODES = {
  chart:     { label: "🦷 Chart findings",     hint: "Teeth and what you see on them." },
  perio:     { label: "📏 Gum (perio) chart",   hint: "Pocket depths, bleeding, recession, mobility, furcation." },
  both:      { label: "✅ Treatment & advice",  hint: "“done” → today’s treatment · “advise” → plan · “26 deep caries” → chart." },
  treatment: { label: "✅ Treatment done",      hint: "What was done today." },
  advice:    { label: "💊 Advice / plan",       hint: "What the patient needs next." },
  rx:        { label: "💊 Prescription",        hint: "Medicine, strength, how often, how many days, before/after food." },
};
const EXAMPLES = {
  chart: [
    "16 MOD deep caries, 36 RC treated, 48 impacted",
    "upper right first molar distal caries moderate",
    "caries on 16 and 17, calculus 31 to 41",
    "lower anteriors calculus, 46 missing, 47 mobility grade 2",
    "26 pannu puchu · 36 daant keeda · 46 kadulutundi",
    "generalised calculus and stains",
  ],
  perio: [
    "16 buccal 5 4 6 lingual 4 3 5 bleeding",
    "26 5-4-6 4-3-5, mobility 1, furcation 2",
    "11 recession 3 mm",
    "36 pocket 6 mm bleeding, 37 pocket 5",
  ],
  both: [
    "access opening done on 36 working length 21 mm, advise zirconia crown",
    "scaling and polishing done, advise RCT and crown 46",
    "extraction done 38, advise implant 36",
    "48 teeseyali (Telugu: should be removed)",
  ],
  treatment: ["composite filling 11 and 21", "obturation done 46 protaper F2 working length 21 mm", "implant placed 36 4.1 by 10 35 Ncm"],
  advice: ["advise RCT and crown 36", "extraction 18 28 38 48", "zirconia crown 46, scaling"],
  rx: [
    "amoxicillin 500 three times a day after food 5 days",
    "pan 40 once daily before food 5 days",
    "zerodol P 1-0-1 3 days, chlorhexidine mouthwash twice 7 days",
    "dolo 650 SOS 3 days",
  ],
};
const COMMANDS = [
  ["undo  ·  scratch that", "removes the last thing you said"],
  ["clear all", "starts again"],
  ["read back", "says the entries aloud"],
  ["save", "saves the ticked entries"],
  ["stop listening", "turns the microphone off"],
];
const GUIDED_COMMANDS = [["next  ·  skip", "next tooth"], ["back", "previous tooth"], ["missing", "marks the tooth missing, moves on"]];
const DEFAULT_COLORS = {
  Caries: "#dc2626", "Deep Caries": "#991b1b", "Proximal Caries": "#e11d48", "Root Caries": "#b91c1c", "Secondary Caries": "#f43f5e",
  "Occlusal Pits": "#9f1239", Calculus: "#a16207", Stains: "#78350f", Attrition: "#065f46", "Cervical Abrasion": "#0891b2", Erosion: "#0f766e",
  Fracture: "#d97706", Gingivitis: "#db2777", "Gum Recession": "#be185d", Pockets: "#7e22ce", Furcation: "#9333ea", "Mobility I": "#d97706",
  "Mobility II": "#ea580c", "Mobility III": "#dc2626", Pulpitis: "#c026d3", "Periapical Pathology": "#a21caf", Abscess: "#86198f",
  "RC Treated": "#7c3aed", "Root Stump": "#57534e", Restored: "#0369a1", "Faulty Restoration": "#0284c7", Crown: "#b45309", Bridge: "#c2410c",
  Implant: "#1d4ed8", Missing: "#475569", Impacted: "#9d174d", Other: "#6366f1",
};
// standard probing order: upper right → upper left, lower left → lower right
const PERIO_ORDER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48];
const SURF_NAME = { M: "mesial", O: "occlusal", I: "incisal", D: "distal", B: "buccal", L: "lingual" };

const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const fmtDay = (d) => { const p = String(d || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d; };
let STATUS = null;   // { ai: "anthropic"|"gemini"|"off", audio: bool } — asked once
async function aiStatus() {
  if (STATUS) return STATUS;
  try { const r = await api.get("/voice/status"); STATUS = r.data || { ai: "off" }; }
  catch { STATUS = { ai: "off", audio: false, missing: true }; }
  return STATUS;
}
const store = (kind) => ({
  get(k, d) { try { return window[kind].getItem(`vx-${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { if (v === null) window[kind].removeItem(`vx-${k}`); else window[kind].setItem(`vx-${k}`, v); } catch { /* private window */ } },
});
const prefs = store("localStorage");
const drafts = store("sessionStorage");
const parseTeeth = (s) => String(s || "").split(/[^0-9]+/).map(Number).filter((n) => isTooth(n));
let rowSeq = 0;
const withIds = (items) => items.map((it) => ({ ...it, _id: ++rowSeq, _on: true }));
// is what the microphone heard just the app reading back? (most of its words were in what the app said)
function isEcho(heard, spoken) {
  const words = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const h = words(heard), sp = new Set(words(spoken));
  if (!h.length || !sp.size) return false;
  return h.filter((w) => sp.has(w)).length / h.length >= 0.6;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hasToothWords = (t) => /\b([1-4][1-8]|[5-8][1-5])\b|\b(upper|lower|ur|ul|lr|ll|maxillary|mandibular|one|two|three|four)\s/i.test(` ${t} `);

/* What the app understood, in words (for the screen and for read-back) */
export function describe(r, { speak = false } = {}) {
  if (r.kind === "finding") {
    const label = r.condition === "Other" ? r.other_text || "other" : r.condition;
    const surf = (r.surfaces || []).length ? (speak ? r.surfaces.join(" ") : r.surfaces.join("")) : "";
    return [speak ? `tooth ${String(r.tooth).split("").join(" ")}` : r.tooth, label, surf, r.severity, r.notes].filter(Boolean).join(speak ? ", " : " · ");
  }
  if (r.kind === "general") return [speak ? "whole mouth" : "Whole mouth", r.label, r.notes].filter(Boolean).join(", ");
  if (r.kind === "treatment" || r.kind === "advice") {
    const what = r.label === "Other" ? r.text : r.label;
    const teeth = (r.teeth || []).length ? (speak ? `on ${r.teeth.join(", ")}` : `IRT ${r.teeth.join(", ")}`) : "";
    return [speak ? (r.kind === "treatment" ? "done today" : "advice") : "", what, teeth, r.note].filter(Boolean).join(speak ? ", " : " · ");
  }
  if (r.kind === "medicine") return [r.name, r.times, r.days ? `${r.days} days` : "", r.when, r.note].filter(Boolean).join(speak ? ", " : " · ");
  return "";
}

export default function VoicePanel({
  open, onClose, onSave, modes = ["chart"], initialMode, title = "Voice to chart",
  existing = [], colors = DEFAULT_COLORS, catalogue = [], showDate = true, saveLabel, draftKey = "",
}) {
  const [mode, setMode] = useState(initialMode && modes.includes(initialMode) ? initialMode : modes[0]);
  const [text, setText] = useState("");
  const [history, setHistory] = useState([]);          // earlier versions of the text, for "undo"
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);           // rows edited by hand → do not overwrite from the text
  const [stale, setStale] = useState(false);
  const [problems, setProblems] = useState([]);
  const [lang, setLang] = useState(() => prefs.get("lang", "en-IN"));
  const [sendVoice, setSendVoice] = useState(() => prefs.get("sendVoice", "1") === "1");
  const [readBack, setReadBack] = useState(() => prefs.get("readBack", "0") === "1");
  const [ai, setAi] = useState({ ai: "off" });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [help, setHelp] = useState(false);
  const [heard, setHeard] = useState(null);            // { text, n } — last sentence and how many entries it gave
  const [guided, setGuided] = useState(false);         // tooth-by-tooth gum charting
  const [gIdx, setGIdx] = useState(0);
  const speakingUntil = useRef(0);
  const lastSpoken = useRef("");
  const doSaveRef = useRef(null);
  const heardTimer = useRef(null);

  const missingTeeth = useMemo(() => new Set((existing || []).filter((r) => r.condition === "Missing").map((r) => Number(r.tooth_number))), [existing]);
  const guidedTeeth = useMemo(() => PERIO_ORDER.filter((t) => !missingTeeth.has(t)), [missingTeeth]);
  const curTooth = guidedTeeth[Math.min(gIdx, guidedTeeth.length - 1)];

  /* ── speaking back ── */
  const say = (words) => {
    if (!readBack || !words || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const u = new window.SpeechSynthesisUtterance(words);
      u.lang = "en-IN"; u.rate = 1.05;
      lastSpoken.current = words;
      speakingUntil.current = Date.now() + 700 + words.length * 70;     // the microphone may hear the app's own voice
      u.onend = () => { speakingUntil.current = Date.now() + 500; };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* no voice on this computer */ }
  };

  /* ── what to do with one finished sentence ── */
  const appendText = (piece) => {
    setText((old) => {
      setHistory((h) => [...h.slice(-30), old]);
      return old && !/[\s,.]$/.test(old) ? `${old}, ${piece}` : `${old}${piece}`;
    });
  };
  const flashHeard = (t, n) => {
    setHeard({ text: t, n });
    clearTimeout(heardTimer.current);
    heardTimer.current = setTimeout(() => setHeard(null), 4000);
  };
  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setText(h[h.length - 1]);
      setDirty(false);
      return h.slice(0, -1);
    });
  };
  const moveTooth = (step) => setGIdx((i) => Math.max(0, Math.min(guidedTeeth.length - 1, i + step)));

  const onFinal = (raw) => {
    if (Date.now() < speakingUntil.current && isEcho(raw, lastSpoken.current)) return;   // the app's own voice, heard by the microphone
    const t = raw.trim();
    const c = t.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
    // spoken commands
    if (["undo", "scratch that", "delete last", "remove last", "delete that", "cancel that", "go back"].includes(c)) { undo(); flashHeard("↩ undone", 0); say("undone"); return; }
    if (["clear all", "clear everything", "start again", "start over"].includes(c)) { clearAll(false); flashHeard("cleared", 0); say("cleared"); return; }
    if (["stop listening", "stop recording", "microphone off", "mic off"].includes(c)) { sp.stop(); return; }
    if (["read back", "read it back", "repeat", "read"].includes(c)) { readAll(); return; }
    if (["save", "save all", "save entries", "save it", "save now"].includes(c)) { sp.stop(); setTimeout(() => doSaveRef.current?.(), 250); return; }
    if (guided && mode === "perio") {
      if (["next", "next tooth", "skip", "skip tooth", "skip it"].includes(c)) { moveTooth(1); say(`tooth ${String(guidedTeeth[Math.min(gIdx + 1, guidedTeeth.length - 1)]).split("").join(" ")}`); return; }
      if (["back", "previous", "previous tooth", "last tooth"].includes(c)) { moveTooth(-1); say(`tooth ${String(guidedTeeth[Math.max(gIdx - 1, 0)]).split("").join(" ")}`); return; }
      if (["missing", "tooth missing", "absent", "ledu"].includes(c)) {
        appendText(`${curTooth} missing`); flashHeard(`${curTooth} missing`, 1); moveTooth(1); say("missing, next"); return;
      }
      // values without a tooth number belong to the tooth on screen
      const piece = hasToothWords(t) ? t : `${curTooth} ${t}`;
      const got = parse(piece, mode, { catalogue }).items;
      appendText(piece);
      flashHeard(piece, got.length);
      if (got.length) { moveTooth(1); say(`${got.map((r) => describe(r, { speak: true })).join(". ")}. Next, tooth ${String(guidedTeeth[Math.min(gIdx + 1, guidedTeeth.length - 1)]).split("").join(" ")}`); }
      return;
    }
    const got = parse(t, mode, { catalogue }).items;
    appendText(t);
    flashHeard(t, got.length);
    if (got.length) say(got.map((r) => describe(r, { speak: true })).join(". "));
    else say("not understood");
  };

  const sp = useSpeech({ lang, record: sendVoice && ai.audio, owner: "panel", onFinal });

  useEffect(() => { if (open) aiStatus().then(setAi); }, [open]);
  useEffect(() => { if (!open) { sp.stop(); try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { prefs.set("lang", lang); }, [lang]);
  useEffect(() => { prefs.set("sendVoice", sendVoice ? "1" : "0"); }, [sendVoice]);
  useEffect(() => { prefs.set("readBack", readBack ? "1" : "0"); }, [readBack]);

  // keep the unsaved text if the window is closed by mistake (this browser tab only)
  const draftId = `draft:${draftKey}:${mode}`;
  useEffect(() => { if (open && !text) { const d = drafts.get(draftId, ""); if (d) setText(d); } }, [open, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) drafts.set(draftId, text || null); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // text → entries (live), unless the doctor has edited the list by hand
  useEffect(() => {
    const r = parse(text, mode, { catalogue });
    if (dirty) { setStale(Boolean(text.trim())); return; }
    setRows(withIds(r.items));
    setProblems(r.problems);
    setStale(false);
  }, [text, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const reread = () => { const r = parse(text, mode, { catalogue }); setRows(withIds(r.items)); setProblems(r.problems); setDirty(false); setStale(false); setAiNote(""); };
  const switchMode = (m) => { sp.stop(); setText(""); setHistory([]); setMode(m); setDirty(false); setAiNote(""); setGuided(false); };
  const edit = (id, patch) => { setDirty(true); setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r))); };
  const remove = (id) => { setDirty(true); setRows((rs) => rs.filter((r) => r._id !== id)); };
  function clearAll(stopMic = true) {
    if (stopMic) sp.stop();
    setText((old) => { if (old) setHistory((h) => [...h.slice(-30), old]); return ""; });
    setRows([]); setProblems([]); setDirty(false); setStale(false); setAiNote(""); setSaveErr("");
  }
  const readAll = () => {
    const on = rows.filter((r) => r._on);
    if (!readBack) { setReadBack(true); }
    setTimeout(() => {
      const words = on.length ? `${plural(on.length, "entry", "entries")}. ${on.map((r) => describe(r, { speak: true })).join(". ")}` : "nothing yet";
      try {
        const u = new window.SpeechSynthesisUtterance(words); u.lang = "en-IN"; u.rate = 1.05;
        lastSpoken.current = words;
        speakingUntil.current = Date.now() + 700 + words.length * 70;
        u.onend = () => { speakingUntil.current = Date.now() + 500; };
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
      } catch { /* no voice */ }
    }, 50);
  };

  // keyboard: Alt+M mic, Ctrl+Enter save, Ctrl+Z (outside the text box) undo, Esc close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.altKey && (e.key === "m" || e.key === "M")) { e.preventDefault(); sp.listening ? sp.stop() : sp.start(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doSaveRef.current?.(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !/TEXTAREA|INPUT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); undo(); }
      else if (e.key === "Escape" && !saving) { if (help) setHelp(false); else { sp.stop(); onClose?.(); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const runAI = async () => {
    if (aiBusy) return;
    if (sp.listening) sp.stop();
    setAiBusy(true); setAiNote("");
    try {
      const body = { mode, text, lang, catalogue: catalogue.map((c) => c.name).slice(0, 80) };
      await new Promise((r) => setTimeout(r, 350));            // let the recording finish
      const audio = sendVoice && ai.audio ? sp.takeAudio() : null;
      if (audio && audio.blob.size < 6 * 1024 * 1024) { body.audio = await blobToBase64(audio.blob); body.mime = audio.mime; }
      if (!body.text.trim() && !body.audio) { setAiNote("Speak or type something first."); return; }
      const r = await api.post("/voice/normalize", body);
      const items = Array.isArray(r.data?.items) ? r.data.items : [];
      if (r.data?.transcript && body.audio && !text.trim()) setText(r.data.transcript);
      setRows(withIds(items)); setDirty(true); setStale(false);
      setProblems(Array.isArray(r.data?.problems) ? r.data.problems : []);
      setAiNote(items.length ? `✨ AI read ${plural(items.length, "entry", "entries")}${body.audio ? " (it also listened to your voice)" : ""}. Please check them.` : "✨ The AI found nothing to add.");
    } catch (e) {
      setAiNote(`AI tidy-up is not available: ${e?.response?.data?.error || "the server did not answer."}`);
    } finally { setAiBusy(false); }
  };

  const chosen = rows.filter((r) => r._on);
  const incomplete = (r) => (r.kind === "finding" && !isTooth(Number(r.tooth))) || (r.kind === "medicine" && (!String(r.name || "").trim() || !r.times))
    || ((r.kind === "treatment" || r.kind === "advice") && !String(r.label === "Other" ? r.text : r.label || "").trim());
  const doSave = async () => {
    if (saving || !chosen.length) return;
    const bad = chosen.find((r) => (r.kind === "finding" && !isTooth(Number(r.tooth))) || (r.kind === "medicine" && !String(r.name || "").trim())
      || ((r.kind === "treatment" || r.kind === "advice") && !String(r.label === "Other" ? r.text : r.label || "").trim()));
    if (bad) { setSaveErr("One of the ticked entries is incomplete (tooth number or name). Fix it or untick it."); return; }
    setSaving(true); setSaveErr("");
    try {
      const clean = chosen.map(({ _id, _on, src, _teethText, ...r }) => ({ ...r, tooth: r.tooth != null ? Number(r.tooth) : r.tooth }));
      const res = await onSave?.(clean, { date, mode });
      if (typeof res === "string" && res) { setSaveErr(res); return; }
      drafts.set(draftId, null);
      setText(""); setHistory([]); setRows([]); setProblems([]); setDirty(false); setStale(false); setAiNote(""); setGIdx(0); setGuided(false);
      say(`saved ${plural(clean.length, "entry", "entries")}`);
      onClose?.();
    } catch (e) {
      setSaveErr(e?.response?.data?.error || e?.message || "Could not save. Please try again.");
    } finally { setSaving(false); }
  };
  doSaveRef.current = doSave;

  // what is already on the chart (for warnings)
  const already = useMemo(() => {
    const m = new Map();
    for (const r of existing || []) {
      const t = Number(r.tooth_number);
      const label = r.condition === "Other" && r.other_text ? r.other_text : r.condition;
      if (!m.has(t)) m.set(t, new Set());
      m.get(t).add(String(label || "").toLowerCase());
    }
    return m;
  }, [existing]);
  const warnOf = (r) => {
    if (r.kind === "medicine") return !r.times ? "How often? Choose it before saving." : r.days === "" || r.days == null ? "How many days?" : "";
    if (r.kind !== "finding") return "";
    const t = Number(r.tooth);
    if (!isTooth(t)) return "Not a tooth number";
    const have = already.get(t);
    const label = String(r.condition === "Other" ? r.other_text : r.condition).toLowerCase();
    if (have?.has(label)) return "Already on the chart — its details will be updated";
    if (have?.has("missing") && r.condition !== "Missing" && r.condition !== "Implant" && r.condition !== "Bridge") return "This tooth is marked Missing";
    return "";
  };

  if (!open) return null;
  const isChart = mode === "chart" || mode === "perio";
  const isConsult = mode === "both" || mode === "treatment" || mode === "advice";
  const bars = [0.35, 0.7, 1, 0.7, 0.35].map((k) => Math.max(0.12, Math.min(1, sp.level * 1.6 * k + (sp.listening ? 0.08 : 0))));
  const tickAll = (on) => { setDirty(true); setRows((rs) => rs.map((r) => ({ ...r, _on: on }))); };

  return createPortal(
    <div className="vx-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) { sp.stop(); onClose?.(); } }}>
      <style>{CSS}</style>
      <div className="vx-panel">
        <div className="vx-head">
          <div>
            <div className="vx-title">🎙 {title}</div>
            <div className="vx-sub">Speak or type — every entry is shown for checking before it is saved.</div>
          </div>
          <div className="vx-headbtns">
            <button type="button" className={`vx-chip ${readBack ? "on" : ""}`} aria-pressed={readBack} onClick={() => setReadBack((v) => !v)}
              title="The app says aloud what it understood">🔊 Read back {readBack ? "on" : "off"}</button>
            <button type="button" className={`vx-chip ${help ? "on" : ""}`} onClick={() => setHelp((v) => !v)} aria-expanded={help}>❔ How to speak</button>
            <button type="button" className="vx-x" aria-label="Close" onClick={() => { sp.stop(); onClose?.(); }}>✕</button>
          </div>
        </div>

        {modes.length > 1 && (
          <div className="vx-tabs" role="tablist">
            {modes.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`vx-tab ${mode === m ? "on" : ""}`} onClick={() => switchMode(m)}>{MODES[m]?.label || m}</button>
            ))}
          </div>
        )}

        {help && (
          <div className="vx-help">
            <div>
              <b>Try saying</b>
              {(EXAMPLES[mode] || []).map((ex) => (
                <button key={ex} type="button" className="vx-ex" onClick={() => { setDirty(false); appendText(ex); }}>“{ex}”</button>
              ))}
            </div>
            <div>
              <b>Teeth</b>
              <span>16 · “one six” · “upper right first molar” · UR6 · “lower left E” (milk) · 31 to 41 · “lower anteriors”</span>
              <b>Surfaces</b>
              <span>MOD · mesial · distal · occlusal · buccal · palatal / lingual</span>
              <b>Telugu / Hindi</b>
              <span>pannu, puchu, noppi, kadulutundi, teeseyali · daant, keeda, dard, hilta, nikalna</span>
            </div>
            <div>
              <b>Spoken commands</b>
              {[...COMMANDS, ...(mode === "perio" ? GUIDED_COMMANDS : [])].map(([c, d]) => <span key={c}><code>{c}</code> — {d}</span>)}
              <b>Keys</b>
              <span><kbd>Alt</kbd>+<kbd>M</kbd> microphone · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Esc</kbd> close</span>
            </div>
          </div>
        )}

        <div className="vx-body">
          <div className="vx-left">
            {mode === "perio" && (
              <div className={`vx-guide ${guided ? "on" : ""}`}>
                <label className="vx-switch">
                  <input type="checkbox" checked={guided} onChange={(e) => { setGuided(e.target.checked); setGIdx(0); }} />
                  <span>🦷 Tooth by tooth</span>
                </label>
                {guided ? (
                  <div className="vx-guide-row">
                    <button type="button" className="vx-btn ghost sm" onClick={() => moveTooth(-1)} disabled={gIdx === 0} aria-label="Previous tooth">◀</button>
                    <div className="vx-guide-tooth" aria-live="polite"><small>Now probing</small><b>{curTooth}</b><small>{gIdx + 1} / {guidedTeeth.length}</small></div>
                    <button type="button" className="vx-btn ghost sm" onClick={() => moveTooth(1)} disabled={gIdx >= guidedTeeth.length - 1} aria-label="Next tooth">▶</button>
                    <button type="button" className="vx-btn ghost sm" onClick={() => { appendText(`${curTooth} missing`); moveTooth(1); }}>Missing</button>
                    <span className="vx-small">Just say the depths — “5 4 6, 4 3 5, bleeding”. It moves on by itself.{missingTeeth.size ? ` Missing teeth are skipped.` : ""}</span>
                  </div>
                ) : <span className="vx-small">Turn on to probe in order (18 → 28, 38 → 48) without saying tooth numbers.</span>}
              </div>
            )}

            <div className="vx-microw">
              <button type="button" className={`vx-mic ${sp.listening ? "live" : ""}`} onClick={() => (sp.listening ? sp.stop() : sp.start())}
                aria-label={sp.listening ? "Stop listening" : "Start listening"} title="Alt+M">
                {sp.listening ? "■" : "🎙"}
              </button>
              <div className="vx-micinfo">
                <div className="vx-status">
                  <b>{sp.listening ? "Listening…" : "Press the microphone and speak"}</b>
                  {sp.listening && <span className="vx-bars" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ transform: `scaleY(${h})` }} />)}</span>}
                </div>
                <span>{MODES[mode]?.hint}</span>
                <div className="vx-opts">
                  <select value={lang} onChange={(e) => { setLang(e.target.value); if (sp.listening) sp.stop(); }} aria-label="Speech language">
                    {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                  {ai.audio && (
                    <label className="vx-check" title="The recording is sent to the clinic server's AI only when you press AI tidy-up">
                      <input type="checkbox" checked={sendVoice} onChange={(e) => setSendVoice(e.target.checked)} /> keep my voice for AI tidy-up
                    </label>
                  )}
                </div>
              </div>
            </div>

            {heard && (
              <div className={`vx-heard ${heard.n ? "ok" : heard.text.startsWith("↩") || heard.text === "cleared" ? "info" : "miss"}`} role="status">
                {heard.n ? `✓ “${heard.text}” → ${plural(heard.n, "entry", "entries")}` : heard.text.startsWith("↩") || heard.text === "cleared" ? heard.text : `? “${heard.text}” — not understood. Say it again or type it.`}
              </div>
            )}
            {!sp.supported && (
              <div className="vx-note warn">This browser cannot turn speech into text. Use Google Chrome or Microsoft Edge{ai.audio ? ", or record and press “AI tidy-up”" : ""}. You can still type below.</div>
            )}
            {sp.error && <div className="vx-note err">{sp.error}</div>}

            <div className="vx-lblrow">
              <label className="vx-lbl" htmlFor="vx-text">What you said — you can type or correct it here</label>
              <button type="button" className="vx-link" onClick={undo} disabled={!history.length} title="Ctrl+Z">↩ Undo</button>
            </div>
            <textarea id="vx-text" className="vx-text" value={text} spellCheck={false} data-novoice
              placeholder={EXAMPLES[mode]?.[0] ? `e.g. ${EXAMPLES[mode][0]}` : ""}
              onChange={(e) => { setHistory((h) => (h.length && h[h.length - 1] === text ? h : [...h.slice(-30), text])); setText(e.target.value); }} />
            {sp.interim && <div className="vx-interim">… {sp.interim}</div>}

            <div className="vx-tools">
              <button type="button" className="vx-btn ghost" onClick={() => clearAll()} disabled={!text && !rows.length}>Clear</button>
              {ai.ai && ai.ai !== "off" ? (
                <button type="button" className="vx-btn ai" onClick={runAI} disabled={aiBusy || (!text.trim() && !(sendVoice && ai.audio))}>
                  {aiBusy ? "✨ Reading…" : "✨ AI tidy-up"}
                </button>
              ) : (
                <span className="vx-small" title={ai.missing ? "The voice server file is not installed yet" : "Add an AI key in Render to switch this on"}>✨ AI tidy-up: off</span>
              )}
              {!help && (EXAMPLES[mode] || []).slice(0, 2).map((ex) => (
                <button key={ex} type="button" className="vx-try" onClick={() => { setDirty(false); appendText(ex); }} title="Add this example">+ {ex.length > 34 ? `${ex.slice(0, 32)}…` : ex}</button>
              ))}
            </div>
            {aiNote && <div className="vx-note info">{aiNote}</div>}
            {(isChart || isConsult) && <MiniChart rows={chosen} colors={colors} focus={guided && mode === "perio" ? curTooth : null} />}
          </div>

          <div className="vx-right">
            <div className="vx-listhead">
              <b>{rows.length ? `${chosen.length} of ${plural(rows.length, "entry", "entries")} ticked` : "Entries will appear here"}</b>
              <span style={{ display: "flex", gap: 6 }}>
                {stale && <button type="button" className="vx-btn ghost sm" onClick={reread}>↻ Re-read from the text</button>}
                {rows.length > 1 && <button type="button" className="vx-link" onClick={() => tickAll(chosen.length !== rows.length)}>{chosen.length === rows.length ? "Untick all" : "Tick all"}</button>}
              </span>
            </div>
            {problems.length > 0 && <div className="vx-note warn">{problems.map((p) => <div key={p}>• {p}</div>)}</div>}
            <div className="vx-rows">
              {rows.map((r) => (
                <Row key={r._id} r={r} mode={mode} colors={colors} warn={warnOf(r)} startOpen={incomplete(r)}
                  onToggle={() => edit(r._id, { _on: !r._on })} onEdit={(p) => edit(r._id, p)} onRemove={() => remove(r._id)} />
              ))}
              {!rows.length && (
                <div className="vx-empty">
                  Nothing yet. Press 🎙 and say, for example:<br /><i>“{EXAMPLES[mode]?.[0]}”</i>
                  <div className="vx-small" style={{ marginTop: 8 }}>Tap ❔ How to speak for tooth names, Telugu / Hindi words and spoken commands.</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="vx-foot">
          {showDate && (
            <label className="vx-date" title="Date saved with these entries">
              📅 <span>{fmtDay(date)}</span>{date === todayISO() ? <em>today</em> : <em className="other">chosen</em>}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} aria-label="Date" />
            </label>
          )}
          {saveErr && <span className="vx-saveerr" role="alert">{saveErr}</span>}
          <div className="vx-footbtns">
            <button type="button" className="vx-btn ghost" disabled={saving} onClick={() => { sp.stop(); onClose?.(); }}>Cancel</button>
            <button type="button" className="vx-btn primary" disabled={saving || !chosen.length} onClick={doSave} title="Ctrl+Enter — or say “save”">
              {saving ? "Saving…" : saveLabel ? saveLabel(chosen.length) : `Save ${chosen.length || ""} ${chosen.length === 1 ? "entry" : "entries"}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── one entry: a readable line; tap to change ─────────────────────────── */
function Row({ r, mode, colors, warn, startOpen, onToggle, onEdit, onRemove }) {
  const [editing, setEditing] = useState(Boolean(startOpen));
  const color = r.kind === "finding" ? (colors[r.condition] || colors.Other || "#6366f1")
    : r.kind === "treatment" ? "#0f766e" : r.kind === "advice" ? "#4338ca" : r.kind === "medicine" ? "#be185d" : "#64748b";
  const tag = r.kind === "finding" ? null : r.kind === "general" ? "Whole mouth" : r.kind === "treatment" ? "Done today" : r.kind === "advice" ? "Advice" : null;
  return (
    <div className={`vx-row ${r._on ? "" : "off"} ${editing ? "editing" : ""}`} style={{ borderLeftColor: color }}>
      <input type="checkbox" className="vx-tick" checked={r._on} onChange={onToggle} aria-label="Include this entry" />
      {!editing ? (
        <button type="button" className="vx-view" onClick={() => setEditing(true)} title="Tap to change">
          {r.kind === "finding" && <span className="vx-badge" style={{ background: color }}>{r.tooth}</span>}
          {(r.kind === "treatment" || r.kind === "advice") && (r.teeth || []).map((t) => <span key={t} className="vx-badge sm" style={{ background: color }}>{t}</span>)}
          {tag && <span className="vx-tag" style={{ color }}>{tag}</span>}
          <span className="vx-main">
            {r.kind === "finding" ? (r.condition === "Other" ? r.other_text || "Other" : r.condition)
              : r.kind === "general" ? r.label
              : r.kind === "medicine" ? r.name
              : r.label === "Other" ? r.text : r.label}
          </span>
          {r.kind === "finding" && (r.surfaces || []).length > 0 && <span className="vx-pill" title={r.surfaces.map((s) => SURF_NAME[s]).join(", ")}>{r.surfaces.join("")}</span>}
          {r.severity && <span className={`vx-pill sev-${r.severity}`}>{r.severity}</span>}
          {r.kind === "medicine" && <>
            {r.times ? <span className="vx-pill">{r.times}</span> : <span className="vx-pill miss">how often?</span>}
            {r.days ? <span className="vx-pill">{r.days} days</span> : <span className="vx-pill miss">days?</span>}
            {r.when && <span className="vx-pill">{r.when}</span>}
          </>}
          {(r.notes || r.note) && <span className="vx-notes">{r.notes || r.note}</span>}
          <span className="vx-edit" aria-hidden="true">✎</span>
        </button>
      ) : (
        <div className="vx-fields">
          {r.kind === "finding" && (
            <>
              <input className="vx-in tooth" value={r.tooth ?? ""} inputMode="numeric" aria-label="Tooth" onChange={(e) => onEdit({ tooth: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
              <select className="vx-in" value={r.condition} aria-label="Condition" onChange={(e) => onEdit({ condition: e.target.value })}>
                {CHART_CONDITIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
              {r.condition === "Other" && <input className="vx-in" value={r.other_text || ""} placeholder="Describe" onChange={(e) => onEdit({ other_text: e.target.value })} />}
              <div className="vx-surfs" role="group" aria-label="Surfaces">
                {["M", "O", "D", "B", "L"].map((s) => {
                  const on = (r.surfaces || []).includes(s) || (s === "O" && (r.surfaces || []).includes("I"));
                  return <button key={s} type="button" className={on ? "on" : ""} title={SURF_NAME[s]} aria-pressed={on}
                    onClick={() => onEdit({ surfaces: "MOIDBL".split("").filter((x) => (x === s ? !on : (r.surfaces || []).includes(x) && !(s === "O" && x === "I"))) })}>{s}</button>;
                })}
              </div>
              <select className="vx-in" value={r.severity || ""} aria-label="Severity" onChange={(e) => onEdit({ severity: e.target.value })}>
                <option value="">severity</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="vx-in grow" value={r.notes || ""} placeholder="notes" onChange={(e) => onEdit({ notes: e.target.value })} />
            </>
          )}
          {r.kind === "general" && (
            <>
              <span className="vx-tag">whole mouth</span>
              <input className="vx-in grow" value={r.label} onChange={(e) => onEdit({ label: e.target.value })} />
              <input className="vx-in grow" value={r.notes || ""} placeholder="notes" onChange={(e) => onEdit({ notes: e.target.value })} />
            </>
          )}
          {(r.kind === "treatment" || r.kind === "advice") && (
            <>
              {mode === "both" ? (
                <div className="vx-seg" role="group" aria-label="Done today or advice">
                  {[["treatment", "Done today"], ["advice", "Advice"]].map(([k, l]) => (
                    <button key={k} type="button" className={r.kind === k ? "on" : ""} onClick={() => onEdit({ kind: k, label: k === "advice" ? (ADVICE_LABELS.includes(r.label) ? r.label : "Other") : (TREATMENT_LABELS.includes(r.label) ? r.label : "Other") })}>{l}</button>
                  ))}
                </div>
              ) : <span className="vx-tag">{r.kind === "treatment" ? "done today" : "advice"}</span>}
              <select className="vx-in" value={r.label} aria-label="Treatment" onChange={(e) => onEdit({ label: e.target.value, text: e.target.value === "Other" ? r.text : e.target.value })}>
                {(r.kind === "advice" ? ADVICE_LABELS : TREATMENT_LABELS).map((c) => <option key={c}>{c}</option>)}
              </select>
              {r.label === "Other" && <input className="vx-in" value={r.text || ""} placeholder="Treatment" onChange={(e) => onEdit({ text: e.target.value })} />}
              <input className="vx-in teeth" value={r._teethText ?? (r.teeth || []).join(", ")} placeholder="teeth" aria-label="Teeth"
                onChange={(e) => onEdit({ teeth: parseTeeth(e.target.value), _teethText: e.target.value })} />
              <input className="vx-in grow" value={r.note || ""} placeholder="details" onChange={(e) => onEdit({ note: e.target.value })} />
            </>
          )}
          {r.kind === "medicine" && (
            <>
              <input className="vx-in grow" value={r.name} aria-label="Medicine" onChange={(e) => onEdit({ name: e.target.value })} />
              <select className="vx-in" value={r.times || ""} aria-label="How often" onChange={(e) => onEdit({ times: e.target.value })}>
                <option value="">how often?</option>{FREQUENCY_OPTIONS.map((f) => <option key={f}>{f}</option>)}
              </select>
              <input className="vx-in days" value={r.days ?? ""} inputMode="numeric" placeholder="days" aria-label="Days" onChange={(e) => onEdit({ days: e.target.value.replace(/\D/g, "") === "" ? "" : Number(e.target.value.replace(/\D/g, "")) })} />
              <select className="vx-in" value={r.when || ""} aria-label="When" onChange={(e) => onEdit({ when: e.target.value })}>
                <option value="">when?</option>{WHEN_OPTIONS.map((f) => <option key={f}>{f}</option>)}
              </select>
              <input className="vx-in grow" value={r.note || ""} placeholder="instructions" onChange={(e) => onEdit({ note: e.target.value })} />
            </>
          )}
          <button type="button" className="vx-btn ghost sm" onClick={() => setEditing(false)}>Done</button>
        </div>
      )}
      {warn && <div className="vx-warn">⚠ {warn}</div>}
      <button type="button" className="vx-del" aria-label="Remove entry" onClick={onRemove}>✕</button>
    </div>
  );
}

/* ── small chart preview: which teeth get something ────────────────────── */
const UP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LO = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const UPD = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const LOD = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
function MiniChart({ rows, colors, focus }) {
  const marks = new Map();
  for (const r of rows) {
    const teeth = r.kind === "finding" ? [Number(r.tooth)] : r.teeth || [];
    const color = r.kind === "finding" ? (colors[r.condition] || colors.Other || "#6366f1") : r.kind === "treatment" ? "#0f766e" : "#4338ca";
    const label = r.kind === "finding" ? (r.condition === "Other" ? r.other_text : r.condition) : (r.label === "Other" ? r.text : r.label);
    for (const t of teeth) { if (!marks.has(t)) marks.set(t, []); marks.get(t).push({ color, label }); }
  }
  if (!marks.size && !focus) return null;
  const deci = [...marks.keys()].some((t) => isDeciduous(t));
  const cell = (t) => {
    const m = marks.get(t);
    return (
      <span key={t} className={`vx-t ${m ? "on" : ""} ${focus === t ? "focus" : ""}`} title={m ? `${t}: ${m.map((x) => x.label).join(", ")}` : String(t)}
        style={m ? { background: m[0].color, borderColor: m[0].color } : undefined}>
        {t}{m && m.length > 1 && <i>{m.length}</i>}
      </span>
    );
  };
  return (
    <div className="vx-mini" aria-label="Chart preview">
      <div className="vx-mini-h">Preview <span>(patient's right on the left)</span></div>
      <div className="vx-arch">{UP.map(cell)}</div>
      <div className="vx-arch">{LO.map(cell)}</div>
      {deci && <><div className="vx-arch d">{UPD.map(cell)}</div><div className="vx-arch d">{LOD.map(cell)}</div></>}
    </div>
  );
}

/* Small button to open the panel from any screen */
export function VoiceButton({ onClick, label = "Voice", disabled, title = "Speak to fill this in (Voice to chart)" }) {
  return (
    <button type="button" className="vx-open" onClick={() => { claimMic("panel"); onClick?.(); }} disabled={disabled} title={title}>
      <style>{OPEN_CSS}</style>
      <span aria-hidden="true">🎙</span> {label}
    </button>
  );
}
const OPEN_CSS = `
.vx-open{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:9px;border:1.5px solid #c7d2fe;background:linear-gradient(180deg,#eef2ff,#e0e7ff);
  color:#3730a3;font:600 12.5px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;transition:transform .12s,box-shadow .12s;white-space:nowrap}
.vx-open:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 3px 10px rgba(67,56,202,.18)}
.vx-open:disabled{opacity:.5;cursor:not-allowed}`;

const CSS = `
.vx-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;animation:vxFade .15s ease}
@keyframes vxFade{from{opacity:0}to{opacity:1}}
.vx-panel{background:#fff;border-radius:16px;width:min(1160px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;
  box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden;color:#0f172a;animation:vxUp .18s ease}
@keyframes vxUp{from{transform:translateY(10px);opacity:.6}to{transform:none;opacity:1}}
.vx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 20px 10px;border-bottom:1px solid #eef2f7}
.vx-title{font-size:17px;font-weight:800}
.vx-sub{font-size:12.5px;color:#64748b;margin-top:2px}
.vx-headbtns{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.vx-chip{border:1.5px solid #e2e8f0;background:#fff;border-radius:999px;padding:5px 11px;font:600 12px system-ui,sans-serif;color:#475569;cursor:pointer}
.vx-chip.on{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}
.vx-x{border:none;background:#f1f5f9;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:14px;color:#475569}
.vx-tabs{display:flex;gap:6px;padding:10px 20px 0;flex-wrap:wrap}
.vx-tab{border:1.5px solid #e2e8f0;background:#f8fafc;border-radius:999px;padding:7px 14px;font:600 13px system-ui,sans-serif;color:#334155;cursor:pointer}
.vx-tab.on{background:#1e293b;border-color:#1e293b;color:#fff}
.vx-help{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:10px 20px 0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:12.5px;color:#334155}
.vx-help > div{display:flex;flex-direction:column;gap:4px;min-width:0}
.vx-help b{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-top:4px}
.vx-help code{background:#eef2ff;color:#3730a3;border-radius:5px;padding:0 5px;font-size:12px}
.vx-help kbd{background:#fff;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:0 4px;font-size:11px}
@media (max-width:900px){.vx-help{grid-template-columns:1fr}}
.vx-body{display:grid;grid-template-columns:minmax(300px,1fr) minmax(360px,1.25fr);gap:18px;padding:14px 20px;overflow:auto;flex:1}
@media (max-width:860px){.vx-body{grid-template-columns:1fr}}
.vx-guide{border:1.5px dashed #c4b5fd;background:#faf5ff;border-radius:12px;padding:8px 12px;margin-bottom:10px;display:flex;flex-direction:column;gap:6px}
.vx-guide.on{border-style:solid;background:#f5f3ff}
.vx-switch{display:flex;align-items:center;gap:8px;font:700 13px system-ui,sans-serif;color:#5b21b6;cursor:pointer}
.vx-switch input{width:16px;height:16px}
.vx-guide-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vx-guide-tooth{display:flex;flex-direction:column;align-items:center;min-width:70px;background:#fff;border:2px solid #7c3aed;border-radius:12px;padding:2px 10px}
.vx-guide-tooth b{font-size:26px;line-height:1.1;color:#5b21b6}
.vx-guide-tooth small{font-size:10px;color:#7c3aed}
.vx-microw{display:flex;gap:14px;align-items:center;margin-bottom:8px}
.vx-mic{flex:none;width:68px;height:68px;border-radius:50%;border:none;cursor:pointer;font-size:27px;color:#fff;
  background:linear-gradient(145deg,#4f46e5,#2563eb);box-shadow:0 6px 18px rgba(37,99,235,.35);transition:transform .12s}
.vx-mic:hover{transform:scale(1.04)}
.vx-mic.live{background:linear-gradient(145deg,#ef4444,#dc2626);animation:vxPulse 1.4s infinite}
@keyframes vxPulse{0%,100%{box-shadow:0 0 0 4px rgba(239,68,68,.25),0 6px 18px rgba(220,38,38,.4)}50%{box-shadow:0 0 0 13px rgba(239,68,68,.06),0 6px 18px rgba(220,38,38,.4)}}
.vx-micinfo{display:flex;flex-direction:column;gap:3px;font-size:13px;min-width:0}
.vx-micinfo > span{color:#64748b;font-size:12px}
.vx-status{display:flex;align-items:center;gap:10px}
.vx-bars{display:inline-flex;gap:3px;align-items:center;height:18px}
.vx-bars i{display:block;width:4px;height:18px;background:#ef4444;border-radius:2px;transition:transform .08s linear;transform-origin:center}
.vx-opts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px}
.vx-opts select{font-size:12px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;max-width:250px}
.vx-check{font-size:11.5px;color:#475569;display:flex;gap:5px;align-items:center;cursor:pointer}
.vx-heard{font-size:12.5px;border-radius:9px;padding:7px 11px;margin:2px 0 6px;animation:vxIn .18s ease}
.vx-heard.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.vx-heard.miss{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
.vx-heard.info{background:#f1f5f9;border:1px solid #e2e8f0;color:#334155}
.vx-lblrow{display:flex;justify-content:space-between;align-items:flex-end;gap:8px}
.vx-lbl{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:6px 0 4px}
.vx-link{border:none;background:none;color:#4338ca;font:600 12px system-ui,sans-serif;cursor:pointer;padding:2px 4px}
.vx-link:disabled{color:#cbd5e1;cursor:default}
.vx-text{width:100%;min-height:96px;resize:vertical;border:1.5px solid #cbd5e1;border-radius:10px;padding:10px 12px;font:14.5px/1.55 system-ui,sans-serif;box-sizing:border-box;color:#0f172a}
.vx-text:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}
.vx-interim{font-size:13px;color:#94a3b8;font-style:italic;margin-top:4px}
.vx-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
.vx-btn{border:1.5px solid transparent;border-radius:9px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}
.vx-btn.sm{padding:4px 10px;font-size:12px}
.vx-btn:disabled{opacity:.5;cursor:not-allowed}
.vx-btn.ghost{background:#fff;border-color:#e2e8f0;color:#334155}
.vx-btn.ai{background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff}
.vx-btn.primary{background:#2563eb;color:#fff;box-shadow:0 3px 10px rgba(37,99,235,.25);padding:9px 18px}
.vx-try{border:1px dashed #c7d2fe;background:#fff;border-radius:999px;padding:4px 10px;font:12px system-ui,sans-serif;color:#4338ca;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx-small{font-size:11.5px;color:#94a3b8}
.vx-note{font-size:12.5px;border-radius:9px;padding:8px 11px;margin-top:8px;line-height:1.45}
.vx-note.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.vx-note.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.vx-note.info{background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6}
.vx-ex{text-align:left;border:none;background:none;color:#3730a3;font:13px system-ui,sans-serif;cursor:pointer;padding:2px 0}
.vx-ex:hover{text-decoration:underline}
.vx-listhead{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;margin-bottom:6px}
.vx-rows{display:flex;flex-direction:column;gap:7px}
.vx-row{position:relative;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;border:1px solid #e2e8f0;border-left:5px solid #6366f1;border-radius:10px;padding:8px 30px 8px 10px;background:#fff;animation:vxIn .18s ease}
.vx-row.editing{background:#fbfdff;box-shadow:0 0 0 3px rgba(99,102,241,.08)}
@keyframes vxIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.vx-row.off{opacity:.45;background:#f8fafc}
.vx-tick{margin-top:6px;width:17px;height:17px;flex:none;cursor:pointer}
.vx-view{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px;border:none;background:none;text-align:left;cursor:pointer;padding:2px 0;font:14px system-ui,sans-serif;color:#0f172a}
.vx-view:hover .vx-edit{opacity:1}
.vx-badge{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:26px;border-radius:8px;color:#fff;font-weight:800;font-size:13.5px;padding:0 6px}
.vx-badge.sm{min-width:26px;height:22px;font-size:12px}
.vx-main{font-weight:700}
.vx-pill{font-size:11.5px;font-weight:700;background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 7px}
.vx-pill.miss{background:#fff7ed;color:#c2410c}
.vx-pill.sev-mild{background:#ecfdf5;color:#047857}.vx-pill.sev-moderate{background:#fffbeb;color:#b45309}
.vx-pill.sev-severe{background:#fef2f2;color:#b91c1c}.vx-pill.sev-critical{background:#7f1d1d;color:#fff}
.vx-notes{font-size:12.5px;color:#64748b;flex-basis:100%;padding-left:2px}
.vx-edit{margin-left:auto;color:#94a3b8;font-size:13px;opacity:.5}
.vx-fields{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0;align-items:center}
.vx-in{border:1px solid #cbd5e1;border-radius:7px;padding:6px 8px;font:13px system-ui,sans-serif;background:#fff;color:#0f172a;min-width:0}
.vx-in.tooth{width:48px;text-align:center;font-weight:800}
.vx-in.teeth{width:96px}
.vx-in.days{width:56px}
.vx-in.grow{flex:1 1 140px}
.vx-surfs,.vx-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:7px;overflow:hidden}
.vx-surfs button,.vx-seg button{border:none;background:#fff;padding:6px 8px;font:700 12px system-ui,sans-serif;color:#475569;cursor:pointer;border-right:1px solid #e2e8f0}
.vx-surfs button:last-child,.vx-seg button:last-child{border-right:none}
.vx-surfs button.on{background:#1e293b;color:#fff}
.vx-seg button.on{background:#0f766e;color:#fff}
.vx-tag{font-size:10.5px;font-weight:800;color:#475569;background:#f1f5f9;border-radius:6px;padding:3px 7px;text-transform:uppercase;letter-spacing:.04em}
.vx-warn{flex-basis:100%;font-size:11.5px;color:#b45309;padding-left:25px}
.vx-del{position:absolute;top:6px;right:6px;border:none;background:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:4px}
.vx-del:hover{color:#dc2626}
.vx-empty{font-size:13px;color:#94a3b8;border:1.5px dashed #e2e8f0;border-radius:10px;padding:22px;text-align:center;line-height:1.6}
.vx-mini{margin-top:12px;border:1px solid #e2e8f0;border-radius:10px;padding:8px;background:#fbfdff}
.vx-mini-h{font-size:10.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.vx-mini-h span{text-transform:none;letter-spacing:0;font-weight:500}
.vx-arch{display:flex;gap:2px;justify-content:center;margin:2px 0}
.vx-arch.d{margin-top:6px}
.vx-t{position:relative;width:22px;height:20px;border:1px solid #e2e8f0;border-radius:4px;font-size:8.5px;display:flex;align-items:center;justify-content:center;color:#94a3b8;background:#fff}
.vx-t.on{color:#fff;font-weight:700}
.vx-t.focus{outline:2px solid #7c3aed;outline-offset:1px;color:#5b21b6;font-weight:800}
.vx-t i{position:absolute;top:-6px;right:-5px;background:#0f172a;color:#fff;border-radius:6px;font-size:8px;font-style:normal;padding:0 3px}
.vx-arch .vx-t:nth-child(8){margin-right:5px}
.vx-arch.d .vx-t:nth-child(8){margin-right:0}
.vx-arch.d .vx-t:nth-child(5){margin-right:5px}
.vx-foot{display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #eef2f7;flex-wrap:wrap;background:#fafbfc}
.vx-footbtns{margin-left:auto;display:flex;gap:8px}
.vx-date{position:relative;display:inline-flex;align-items:center;gap:6px;font-size:13px;border:1.5px solid #e2e8f0;border-radius:9px;padding:6px 10px;background:#fff;cursor:pointer}
.vx-date em{font-style:normal;font-size:10.5px;background:#dcfce7;color:#166534;border-radius:5px;padding:1px 5px;font-weight:700}
.vx-date em.other{background:#fef3c7;color:#92400e}
.vx-date input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
.vx-saveerr{color:#b91c1c;font-size:12.5px}
/* phones and small tablets: full-height sheet, big buttons */
@media (max-width:640px){
  .vx-overlay{padding:0;align-items:flex-end}
  .vx-panel{border-radius:16px 16px 0 0;max-height:100vh;height:100vh}
  .vx-head{padding:12px 14px 8px}.vx-tabs{padding:8px 14px 0}.vx-body{padding:12px 14px}.vx-foot{padding:10px 14px}
  .vx-footbtns{width:100%}.vx-footbtns .vx-btn{flex:1}
  .vx-sub{display:none}
}
`;