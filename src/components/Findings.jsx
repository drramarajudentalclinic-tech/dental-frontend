import { useEffect, useState } from "react";
import api from "../api/api";

// ─────────────────────────────────────────────────────────────────────────────
//  OTHER FINDINGS
//  Findings that are not about one particular tooth (gums, bite, jaw, soft
//  tissue, habits…). Each finding is its own record:
//      finding_type = the text of the finding   ("Gingivitis — generalised")
//      value        = the date                  ("2026-10-07")
//  That is exactly how they were stored before, so every old record still
//  shows, and the Diagnosis panel in Consultation keeps picking them up.
// ─────────────────────────────────────────────────────────────────────────────

// Common findings, alphabetical. Anything else can be typed in the box below them.
const COMMON_FINDINGS = [
  "Angular Cheilitis",
  "Bleeding Gums",
  "Bruxism / Attrition",
  "Calculus / Tartar",
  "Crossbite",
  "Crowding",
  "Deep Bite",
  "Dry Mouth (Xerostomia)",
  "Fluorosis",
  "Generalised Sensitivity",
  "Gingival Recession",
  "Gingivitis",
  "Halitosis",
  "High Frenal Attachment",
  "Leukoplakia / White Patch",
  "Malocclusion",
  "Mouth Breathing",
  "Open Bite",
  "Oral Submucous Fibrosis (OSMF)",
  "Periodontitis",
  "Poor Oral Hygiene",
  "Spacing",
  "Stains / Discoloration",
  "TMJ Disorder",
  "Tongue Tie",
  "Ulcer / Soft Tissue Lesion",
];

const SEP = " — ";
const MAX_LEN = 1000;

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function fmtDisplay(dateStr) {
  if (!dateStr) return "";
  const parts = String(dateStr).split("T")[0].split("-");
  if (parts.length !== 3) return String(dateStr);
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}
// "Gingivitis — generalised" → { label: "Gingivitis", detail: "generalised" }
function splitFinding(text) {
  const s = String(text || "");
  const i = s.indexOf(SEP);
  if (i === -1) return { label: s, detail: "" };
  return { label: s.slice(0, i), detail: s.slice(i + SEP.length) };
}
function joinFinding(label, detail) {
  const d = String(detail || "").trim();
  return d ? `${label}${SEP}${d}` : label;
}
function errorText(err, fallback) {
  const fromServer = err?.response?.data?.error;
  if (fromServer) return fromServer;
  if (err?.response?.status === 404) return "This finding no longer exists — it may have been deleted on another screen.";
  if (!err?.response) return `${fallback} The server could not be reached — please check the connection and try again.`;
  return `${fallback} Please try again.`;
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

  .of-root, .of-root * { box-sizing: border-box; }
  .of-root {
    font-family: 'DM Sans', sans-serif;
    background: #f8fafc;
    border-radius: 16px;
    padding: 24px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    color: #1e293b;
  }
  .of-root button { font-family: inherit; }
  .of-root button:focus-visible, .of-root input:focus-visible, .of-root textarea:focus-visible {
    outline: 2px solid #1d4ed8; outline-offset: 2px;
  }

  @keyframes ofFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Header */
  .of-header {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 16px; padding-bottom: 16px;
    border-bottom: 1px solid #e9eef4;
  }
  .of-header-icon {
    width: 36px; height: 36px; flex-shrink: 0;
    background: linear-gradient(135deg, #dbeafe, #bfdbfe);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 17px;
  }
  .of-header-text { flex: 1 1 200px; min-width: 0; }
  .of-header-title { font-size: 15px; font-weight: 600; color: #1e293b; display: flex; align-items: center; gap: 8px; }
  .of-count {
    font-size: 11px; font-weight: 700; color: #1d4ed8; background: #dbeafe;
    border-radius: 20px; padding: 1px 9px; font-family: 'DM Mono', monospace;
  }
  .of-header-sub { font-size: 12px; color: #64748b; margin-top: 1px; }

  /* Buttons */
  .of-add-btn {
    padding: 8px 16px; background: #2563eb; color: #fff;
    border: 1.5px solid #2563eb; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; gap: 5px; transition: background 0.15s;
  }
  .of-add-btn:hover { background: #1d4ed8; }
  .of-add-btn.open { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
  .of-btn {
    padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
    cursor: pointer; border: 1.5px solid transparent; transition: background 0.15s;
  }
  .of-btn:disabled { cursor: not-allowed; }
  .of-btn-cancel { background: #f1f5f9; color: #475569; }
  .of-btn-cancel:hover:not(:disabled) { background: #e2e8f0; }
  .of-btn-ok { background: #2563eb; color: #fff; }
  .of-btn-ok:hover:not(:disabled) { background: #1d4ed8; }
  .of-btn-ok:disabled { background: #93c5fd; }
  .of-btn-danger { background: #dc2626; color: #fff; }
  .of-btn-danger:hover:not(:disabled) { background: #b91c1c; }
  .of-btn-danger:disabled { background: #fca5a5; }
  .of-btn-sm { padding: 6px 13px; font-size: 12.5px; }

  /* Messages */
  .of-msg {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 500; margin-bottom: 12px;
  }
  .of-msg.error  { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
  .of-msg.locked { background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; }
  .of-msg.ok     { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
  .of-msg button {
    background: #fff; border: 1px solid currentColor; color: inherit; border-radius: 6px;
    padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
  }

  /* Add panel */
  .of-input-box {
    background: #fff; border: 1.5px solid #bfdbfe; border-radius: 12px;
    padding: 16px; margin-bottom: 16px;
    box-shadow: 0 2px 10px rgba(37,99,235,0.07);
    animation: ofFadeIn 0.2s ease;
  }
  .of-step-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .of-step-title { font-size: 13px; font-weight: 600; color: #1e293b; }
  .of-step-hint  { font-size: 12px; font-weight: 400; color: #64748b; }
  .of-search {
    flex: 0 1 220px; min-width: 140px; padding: 6px 10px;
    border: 1.5px solid #e2e8f0; border-radius: 8px;
    font-family: inherit; font-size: 12.5px; color: #1e293b; outline: none;
  }
  .of-search:focus { border-color: #3b82f6; }
  .of-chip-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px;
    margin-bottom: 14px;
  }
  .of-chip {
    display: flex; align-items: center; gap: 7px; min-width: 0;
    padding: 8px 10px; border-radius: 8px;
    border: 1.5px solid #e2e8f0; background: #f8fafc;
    font-size: 12.5px; font-weight: 500; color: #334155; text-align: left; cursor: pointer;
  }
  .of-chip:hover:not(:disabled) { border-color: #60a5fa; background: #fff; }
  .of-chip.on { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
  .of-chip:disabled { cursor: not-allowed; background: #f1f5f9; color: #94a3b8; border-style: dashed; }
  .of-chip-box {
    flex-shrink: 0; width: 16px; height: 16px; border-radius: 4px;
    border: 1.5px solid #cbd5e1; background: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; line-height: 1; color: #2563eb; font-weight: 700;
  }
  .of-chip.on .of-chip-box { border-color: #fff; }
  .of-chip:disabled .of-chip-box { border-color: #cbd5e1; color: #94a3b8; }
  .of-chip-lbl { min-width: 0; overflow-wrap: anywhere; }
  .of-chip-note { margin-left: auto; font-size: 10px; font-weight: 600; flex-shrink: 0; }
  .of-none { grid-column: 1 / -1; font-size: 12.5px; color: #64748b; padding: 6px 2px; }

  .of-picked { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .of-picked-row {
    display: grid; grid-template-columns: minmax(120px, 220px) minmax(0, 1fr) 30px; gap: 8px; align-items: center;
    background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9px; padding: 6px 8px 6px 12px;
  }
  .of-picked-lbl { font-size: 13px; font-weight: 600; color: #1e3a8a; overflow-wrap: anywhere; }
  .of-detail {
    width: 100%; padding: 7px 10px; border: 1.5px solid #dbeafe; border-radius: 7px;
    font-family: inherit; font-size: 13px; color: #1e293b; background: #fff; outline: none;
  }
  .of-detail:focus { border-color: #3b82f6; }
  .of-x {
    width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent;
    color: #64748b; font-size: 12px; cursor: pointer;
  }
  .of-x:hover { background: #dbeafe; color: #b91c1c; }

  .of-textarea {
    width: 100%; min-height: 64px; padding: 10px 12px;
    border: 1.5px solid #e2e8f0; border-radius: 10px;
    font-family: 'DM Sans', sans-serif; font-size: 13.5px; color: #1e293b;
    resize: vertical; background: #f8fafc; outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    margin-bottom: 12px; display: block;
  }
  .of-textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); background: #fff; }
  .of-textarea::placeholder, .of-detail::placeholder { color: #94a3b8; }

  /* Date */
  .of-date-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .of-date-label { font-size: 12px; color: #64748b; font-weight: 500; white-space: nowrap; }
  .of-date-chip {
    display: inline-flex; align-items: center; gap: 6px; position: relative;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 8px;
    padding: 6px 10px; font-size: 12.5px; color: #334155;
    font-family: 'DM Mono', monospace; cursor: pointer;
  }
  .of-date-chip:hover { border-color: #3b82f6; }
  .of-date-today {
    font-family: 'DM Sans', sans-serif; font-size: 10px; font-weight: 700;
    color: #15803d; background: #dcfce7; border-radius: 4px; padding: 1px 5px;
  }
  .of-date-change { font-family: 'DM Sans', sans-serif; font-size: 10.5px; color: #2563eb; text-decoration: underline; }
  .of-date-input {
    position: absolute; opacity: 0; width: 100%; height: 100%;
    top: 0; left: 0; cursor: pointer; font-size: 0;
  }
  .of-date-input::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0; width: 100%; height: 100%; position: absolute; top: 0; left: 0; }
  .of-link { background: none; border: none; padding: 0; color: #2563eb; font-size: 11.5px; font-weight: 600; text-decoration: underline; cursor: pointer; }

  .of-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .of-actions { display: flex; gap: 8px; margin-left: auto; }

  /* List */
  .of-list { display: flex; flex-direction: column; gap: 8px; }
  .of-list-header {
    font-size: 11.5px; font-weight: 600; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
  }
  .of-item {
    background: #fff; border: 1.5px solid #e9eef4; border-left: 4px solid #38bdf8;
    border-radius: 10px; padding: 11px 14px;
    display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;
    transition: border-color 0.15s, box-shadow 0.15s;
    animation: ofFadeIn 0.2s ease;
  }
  .of-item:hover { box-shadow: 0 1px 6px rgba(59,130,246,0.08); }
  .of-item.editing { border-color: #3b82f6; border-left-color: #2563eb; box-shadow: 0 0 0 3px rgba(59,130,246,0.08); }
  .of-item.confirming { border-color: #fca5a5; border-left-color: #dc2626; background: #fffafa; }
  .of-item-body { flex: 1 1 260px; min-width: 0; }
  .of-item-text { font-size: 13.5px; color: #1e293b; line-height: 1.5; overflow-wrap: anywhere; }
  .of-item-text b { font-weight: 600; }
  .of-item-detail { color: #475569; }
  .of-item-date {
    font-size: 11px; font-family: 'DM Mono', monospace; color: #64748b;
    margin-top: 3px; display: flex; align-items: center; gap: 4px;
  }
  .of-item-btns { display: flex; gap: 6px; flex-shrink: 0; margin-left: auto; }
  .of-icon-btn {
    display: inline-flex; align-items: center; gap: 5px;
    height: 30px; padding: 0 10px;
    border: 1.5px solid #e2e8f0; border-radius: 7px; background: #fff;
    cursor: pointer; font-size: 12px; font-weight: 600; color: #475569;
    transition: all 0.15s;
  }
  .of-icon-btn.edit:hover { border-color: #3b82f6; color: #1d4ed8; background: #eff6ff; }
  .of-icon-btn.delete:hover { border-color: #ef4444; color: #b91c1c; background: #fef2f2; }

  .of-edit-area {
    width: 100%; min-height: 60px; padding: 8px 10px;
    border: 1.5px solid #3b82f6; border-radius: 8px;
    font-family: 'DM Sans', sans-serif; font-size: 13.5px; color: #1e293b;
    resize: vertical; outline: none; display: block; margin-bottom: 8px;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
  }
  .of-edit-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .of-row-error { width: 100%; font-size: 12px; font-weight: 500; color: #b91c1c; margin-top: 6px; }
  .of-confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
  .of-confirm-q { font-size: 12.5px; font-weight: 600; color: #b91c1c; }

  .of-empty {
    text-align: center; color: #64748b; font-size: 13px;
    padding: 22px 12px; background: #fff; border: 1.5px dashed #cbd5e1; border-radius: 12px;
  }
  .of-empty b { display: block; font-size: 14px; color: #334155; margin-bottom: 3px; }

  @media (max-width: 560px) {
    .of-root { padding: 16px; }
    .of-picked-row { grid-template-columns: minmax(0, 1fr) 30px; }
    .of-picked-row .of-detail { grid-column: 1 / -1; grid-row: 2; }
    .of-actions { width: 100%; }
    .of-actions .of-btn { flex: 1; }
  }
`;

// Date chip: always shows dd/mm/yyyy; click it to choose another date.
function DateChip({ value, onChange, label = "Date" }) {
  const isToday = value === todayStr();
  return (
    <div className="of-date-row">
      <span className="of-date-label">{label}</span>
      <span className="of-date-chip" title="Click to choose another date">
        📅 {fmtDisplay(value)}
        {isToday && <span className="of-date-today">today</span>}
        <span className="of-date-change">change</span>
        <input
          type="date"
          className="of-date-input"
          aria-label={label}
          value={value}
          onChange={e => onChange(e.target.value || todayStr())}
        />
      </span>
      {!isToday && (
        <button type="button" className="of-link" onClick={() => onChange(todayStr())}>Use today</button>
      )}
    </div>
  );
}

export default function OtherFindings({ visitId, onFindingsChange, externalFindings, disabled = false }) {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // "Add findings" panel
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState([]);        // labels ticked in the list, in the order they were ticked
  const [details, setDetails] = useState({});      // { label: optional details }
  const [text, setText] = useState("");            // a finding typed by hand
  const [date, setDate] = useState(todayStr());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [justAdded, setJustAdded] = useState("");

  // Editing / deleting one row
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState(todayStr());
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState({ id: null, text: "" });

  // Notify parent whenever findings list changes
  useEffect(() => {
    if (onFindingsChange) onFindingsChange(findings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings]);

  // Load existing findings
  const load = () => {
    if (!visitId) return;
    setLoading(true);
    setLoadError("");
    api.get(`/visits/${visitId}/findings`)
      .then(res => { if (Array.isArray(res.data)) setFindings(res.data); })
      .catch(err => {
        console.error("Failed to load findings:", err);
        setLoadError("Could not load the findings for this visit.");
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  // Keep this list in sync with findings added/edited/deleted from outside —
  // most importantly, the Diagnosis panel's "+ Add" flow. Content-compared so
  // this component's own writes (which already update both local and lifted
  // state to the same value) don't cause a redundant re-render loop.
  useEffect(() => {
    if (externalFindings === undefined) return;
    setFindings(prev => {
      const prevJSON = JSON.stringify(prev);
      const extJSON  = JSON.stringify(externalFindings);
      return prevJSON === extJSON ? prev : externalFindings;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(externalFindings)]);

  // A closed visit is read-only: shut anything that was open.
  useEffect(() => {
    if (!disabled) return;
    setShowAdd(false); setEditingId(null); setConfirmId(null);
  }, [disabled]);

  // ── Add ────────────────────────────────────────────────────────────────────
  const resetAdd = () => {
    setPicked([]); setDetails({}); setText(""); setDate(todayStr()); setQuery(""); setAddError("");
  };
  const toggleAdd = () => {
    setJustAdded("");
    if (showAdd) { setShowAdd(false); resetAdd(); }
    else { resetAdd(); setShowAdd(true); setEditingId(null); setConfirmId(null); }
  };
  const togglePick = label => {
    setAddError("");
    setPicked(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);
  };

  // Common findings already recorded for the chosen date can't be added twice.
  const recordedOnDate = new Set(
    findings
      .filter(f => (f.value || "").split("T")[0] === date)
      .map(f => splitFinding(f.finding_type).label.trim().toLowerCase())
  );
  const shownOptions = query.trim()
    ? COMMON_FINDINGS.filter(o => o.toLowerCase().includes(query.trim().toLowerCase()))
    : COMMON_FINDINGS;
  const activePicked = picked.filter(l => !recordedOnDate.has(l.toLowerCase()));
  const addCount = activePicked.length + (text.trim() ? 1 : 0);

  const handleAdd = async () => {
    if (addCount === 0 || saving) return;
    const texts = activePicked.map(l => joinFinding(l, details[l]));
    if (text.trim()) texts.push(text.trim());
    const tooLong = texts.find(t => t.length > MAX_LEN);
    if (tooLong) { setAddError(`One finding is too long (${tooLong.length} characters). Please keep each finding under ${MAX_LEN} characters.`); return; }

    setSaving(true); setAddError("");
    try {
      const payload = texts.map(t => ({ finding_type: t, value: date, notes: null }));
      const res = await api.post(`/visits/${visitId}/findings`, payload);
      const saved = Array.isArray(res.data) ? res.data : [res.data];
      setFindings(prev => [...prev, ...saved]);
      setJustAdded(saved.length === 1 ? "1 finding added." : `${saved.length} findings added.`);
      resetAdd();
      setShowAdd(false);
    } catch (err) {
      // Nothing is cleared on a failed save, so nothing typed is lost.
      console.error("Failed to save finding:", err);
      setAddError(errorText(err, "The findings were NOT saved."));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit ───────────────────────────────────────────────────────────────────
  const startEdit = (f) => {
    setJustAdded("");
    setShowAdd(false);
    setConfirmId(null);
    setRowError({ id: null, text: "" });
    setEditingId(f.id);
    setEditText(f.finding_type || "");
    setEditDate((f.value || "").split("T")[0] || todayStr());
  };

  const saveEdit = async (f) => {
    const newText = editText.trim();
    if (!newText || busyId) return;
    if (newText.length > MAX_LEN) {
      setRowError({ id: f.id, text: `Too long (${newText.length} characters). Please keep it under ${MAX_LEN} characters.` });
      return;
    }
    setBusyId(f.id); setRowError({ id: null, text: "" });
    try {
      const res = await api.put(`/findings/${f.id}`, { finding_type: newText, value: editDate });
      const updated = res.data && res.data.id ? res.data : { ...f, finding_type: newText, value: editDate };
      setFindings(prev => prev.map(x => x.id === f.id ? { ...x, ...updated } : x));
      setEditingId(null);
    } catch (err) {
      console.error("Failed to update finding:", err);
      setRowError({ id: f.id, text: errorText(err, "The change was NOT saved.") });
    } finally {
      setBusyId(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const askDelete = (f) => {
    setJustAdded("");
    setEditingId(null);
    setRowError({ id: null, text: "" });
    setConfirmId(f.id);
  };

  const handleDelete = async (f) => {
    if (busyId) return;
    setBusyId(f.id); setRowError({ id: null, text: "" });
    try {
      await api.delete(`/findings/${f.id}`);
      setFindings(prev => prev.filter(x => x.id !== f.id));
      setConfirmId(null);
    } catch (err) {
      if (err?.response?.status === 404) {
        // Already deleted somewhere else — just drop it from the list.
        setFindings(prev => prev.filter(x => x.id !== f.id));
        setConfirmId(null);
      } else {
        console.error("Failed to delete finding:", err);
        setRowError({ id: f.id, text: errorText(err, "The finding was NOT deleted.") });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="of-root">
        {/* Header */}
        <div className="of-header">
          <div className="of-header-icon">🔍</div>
          <div className="of-header-text">
            <div className="of-header-title">
              Other Findings
              {findings.length > 0 && <span className="of-count">{findings.length}</span>}
            </div>
            <div className="of-header-sub">Findings that are not about one tooth — gums, bite, jaw, soft tissue</div>
          </div>
          {!disabled && (
            <button type="button" className={`of-add-btn${showAdd ? " open" : ""}`} onClick={toggleAdd} aria-expanded={showAdd}>
              {showAdd ? "✕ Close" : "+ Add Finding"}
            </button>
          )}
        </div>

        {disabled && (
          <div className="of-msg locked">🔒 This visit is closed — findings can be viewed but not changed.</div>
        )}
        {loadError && (
          <div className="of-msg error" role="alert">
            <span>⚠️ {loadError}</span>
            <button type="button" onClick={load}>Try again</button>
          </div>
        )}
        {justAdded && !showAdd && (
          <div className="of-msg ok" role="status">✅ {justAdded}</div>
        )}

        {/* Add panel */}
        {showAdd && !disabled && (
          <div className="of-input-box">
            <div className="of-step-head">
              <span className="of-step-title">
                Common findings <span className="of-step-hint">— tick all that apply</span>
              </span>
              <input
                type="search"
                className="of-search"
                placeholder="Search findings…"
                aria-label="Search common findings"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <div className="of-chip-grid" role="group" aria-label="Common findings, A to Z">
              {shownOptions.map(label => {
                const already = recordedOnDate.has(label.toLowerCase());
                const on = !already && picked.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    className={`of-chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    disabled={already}
                    title={already ? "Already recorded for this date — use Edit on it below to change it" : undefined}
                    onClick={() => togglePick(label)}
                  >
                    <span className="of-chip-box">{on || already ? "✓" : ""}</span>
                    <span className="of-chip-lbl">{label}</span>
                    {already && <span className="of-chip-note">added</span>}
                  </button>
                );
              })}
              {shownOptions.length === 0 && (
                <div className="of-none">Nothing matches "{query}" — type it in the box below instead.</div>
              )}
            </div>

            {activePicked.length > 0 && (
              <>
                <div className="of-step-head">
                  <span className="of-step-title">
                    Ticked ({activePicked.length}) <span className="of-step-hint">— add details if you want</span>
                  </span>
                </div>
                <div className="of-picked">
                  {activePicked.map(label => (
                    <div key={label} className="of-picked-row">
                      <span className="of-picked-lbl">{label}</span>
                      <input
                        type="text"
                        className="of-detail"
                        placeholder="Details (optional) — e.g. generalised, lower front teeth"
                        aria-label={`Details for ${label}`}
                        maxLength={MAX_LEN - label.length - SEP.length}
                        value={details[label] || ""}
                        onChange={e => setDetails(d => ({ ...d, [label]: e.target.value }))}
                      />
                      <button type="button" className="of-x" aria-label={`Remove ${label}`} title="Remove" onClick={() => togglePick(label)}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="of-step-head">
              <span className="of-step-title">
                Something else? <span className="of-step-hint">— type any other finding</span>
              </span>
            </div>
            <textarea
              className="of-textarea"
              placeholder="Enter finding details…"
              aria-label="Other finding"
              maxLength={MAX_LEN}
              value={text}
              onChange={e => { setText(e.target.value); setAddError(""); }}
            />

            {addError && <div className="of-msg error" role="alert">⚠️ {addError}</div>}

            <div className="of-foot">
              <DateChip value={date} onChange={setDate} />
              <div className="of-actions">
                <button type="button" className="of-btn of-btn-cancel" onClick={toggleAdd} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="of-btn of-btn-ok" onClick={handleAdd} disabled={addCount === 0 || saving}>
                  {saving ? "Saving…" : addCount <= 1 ? "Add Finding" : `Add ${addCount} Findings`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Findings List */}
        {findings.length > 0 && (
          <div className="of-list">
            <div className="of-list-header">Recorded Findings ({findings.length})</div>
            {findings.map(f => {
              const isEditing = editingId === f.id;
              const isConfirming = confirmId === f.id;
              const isBusy = busyId === f.id;
              const { label, detail } = splitFinding(f.finding_type);
              return (
                <div
                  key={f.id}
                  className={`of-item${isEditing ? " editing" : ""}${isConfirming ? " confirming" : ""}`}
                >
                  <div className="of-item-body">
                    {isEditing ? (
                      <>
                        <textarea
                          className="of-edit-area"
                          aria-label="Finding"
                          maxLength={MAX_LEN}
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          autoFocus
                        />
                        <div className="of-edit-foot">
                          <DateChip value={editDate} onChange={setEditDate} />
                          <div className="of-actions">
                            <button type="button" className="of-btn of-btn-sm of-btn-cancel" onClick={() => { setEditingId(null); setRowError({ id: null, text: "" }); }} disabled={isBusy}>
                              Cancel
                            </button>
                            <button type="button" className="of-btn of-btn-sm of-btn-ok" onClick={() => saveEdit(f)} disabled={!editText.trim() || isBusy}>
                              {isBusy ? "Saving…" : "Update Finding"}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="of-item-text">
                          <b>{label}</b>
                          {detail && <span className="of-item-detail">{SEP}{detail}</span>}
                        </div>
                        <div className="of-item-date">
                          <span>📅</span>
                          {fmtDisplay(f.value || f._date || todayStr())}
                        </div>
                      </>
                    )}
                  </div>

                  {!disabled && !isEditing && !isConfirming && (
                    <div className="of-item-btns">
                      <button type="button" className="of-icon-btn edit" title="Edit this finding" onClick={() => startEdit(f)}>✏️ Edit</button>
                      <button type="button" className="of-icon-btn delete" title="Delete this finding" onClick={() => askDelete(f)}>🗑️ Delete</button>
                    </div>
                  )}

                  {isConfirming && (
                    <div className="of-confirm" role="group" aria-label="Confirm delete">
                      <span className="of-confirm-q">Delete this finding?</span>
                      <button type="button" className="of-btn of-btn-sm of-btn-cancel" onClick={() => { setConfirmId(null); setRowError({ id: null, text: "" }); }} disabled={isBusy}>
                        No, keep it
                      </button>
                      <button type="button" className="of-btn of-btn-sm of-btn-danger" onClick={() => handleDelete(f)} disabled={isBusy}>
                        {isBusy ? "Deleting…" : "Yes, delete"}
                      </button>
                    </div>
                  )}

                  {rowError.id === f.id && rowError.text && (
                    <div className="of-row-error" role="alert">⚠️ {rowError.text}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {findings.length === 0 && !showAdd && !loadError && (
          <div className="of-empty">
            {loading ? "Loading findings…" : disabled ? "No findings were recorded for this visit." : (
              <>
                <b>No findings recorded yet</b>
                Press "+ Add Finding" to tick common findings or type your own.
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}