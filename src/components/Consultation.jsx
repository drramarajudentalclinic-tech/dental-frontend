import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";
import { CONDITIONS as DENTAL_CHART_CONDITIONS, CMAP as DENTAL_CHART_CMAP } from "./DentalChart";

// Teeth are listed the way the dentist sees the patient: the patient's RIGHT
// side is on the LEFT of the screen.
const PERMANENT = {
  upperRight: [18,17,16,15,14,13,12,11],
  upperLeft:  [21,22,23,24,25,26,27,28],
  lowerLeft:  [31,32,33,34,35,36,37,38],
  lowerRight: [48,47,46,45,44,43,42,41],
};
const DECIDUOUS = {
  upperRight: [55,54,53,52,51],
  upperLeft:  [61,62,63,64,65],
  lowerLeft:  [71,72,73,74,75],
  lowerRight: [85,84,83,82,81],
};
const QUADRANT_NAMES = {
  upperRight: "Upper right",
  upperLeft:  "Upper left",
  lowerLeft:  "Lower left",
  lowerRight: "Lower right",
};

// ── Treatment options shown per-tooth in "Treatment Done Today" ─────────────
const PERMANENT_TREATMENTS = [
  "A/O Done",
  "Obturation Done",
  "Implant Done",
  "Extraction",
  "Surgical Extraction",
  "Composite Restoration",
  "GIC Restoration",
  "Permanent Cementation",
  "Temporary Cementation",
  "Temporary Restoration",
  "Other",
];
const DECIDUOUS_TREATMENTS = [
  "Pulpectomy",
  "Space Maintainer",
  "Extraction",
  "Other",
];

// ── Treatment options shown per-tooth in "Advice & Treatment Plan" chart ────
const ADVICE_PERMANENT_TREATMENTS = [
  "Rct & Crown",
  "Re-Rct",
  "Zirconia Crown",
  "Dmls Crown",
  "Bridge",
  "Implant",
  "Ortho Extraction",
  "Surgical Extraction",
  "Composite Restoration",
  "Gic Restoration",
  "Permanent Cementation",
  "Temporary Cementation",
  "Temporary Restoration",
  "Other",
];
const ADVICE_DECIDUOUS_TREATMENTS = [
  "Pulpectomy",
  "Space Maintainer",
  "Extraction",
  "Other",
];

// ── One fixed colour per treatment, so the same treatment always looks the same
// on the chart, in the list and in the legend. ─────────────────────────────────
const TREATMENT_COLORS = {
  "A/O Done":              "#0284c7",
  "Obturation Done":       "#4f46e5",
  "Implant Done":          "#0f766e",
  "Implant":               "#0f766e",
  "Extraction":            "#dc2626",
  "Surgical Extraction":   "#991b1b",
  "Ortho Extraction":      "#ea580c",
  "Composite Restoration": "#16a34a",
  "GIC Restoration":       "#65a30d",
  "Gic Restoration":       "#65a30d",
  "Permanent Cementation": "#7c3aed",
  "Temporary Cementation": "#a855f7",
  "Temporary Restoration": "#d97706",
  "Rct & Crown":           "#1e3a8a",
  "Re-Rct":                "#9333ea",
  "Zirconia Crown":        "#0891b2",
  "Dmls Crown":            "#64748b",
  "Bridge":                "#b45309",
  "Pulpectomy":            "#db2777",
  "Space Maintainer":      "#0d9488",
  "Other":                 "#475569",
};

// ── Conditions shown per-tooth when adding a Dental Chart finding to Diagnosis ─
// Sourced directly from DentalChart.jsx's own CONDITIONS/CMAP so this picker
// always matches the real Dental Chart tab — no separately-maintained list to
// drift out of sync. The Dental Chart doesn't restrict conditions by chart type
// (only tooth numbering differs for permanent vs deciduous), so both pickers
// use the same full set.
const DIAGNOSIS_CONDITIONS = DENTAL_CHART_CONDITIONS.map(label => ({
  label,
  color: DENTAL_CHART_CMAP[label]?.a || "#475569",
}));
const PERMANENT_DIAGNOSIS_CONDITIONS  = DIAGNOSIS_CONDITIONS;
const DECIDUOUS_DIAGNOSIS_CONDITIONS  = DIAGNOSIS_CONDITIONS;

// ── Findings offered when adding an "Other Finding" to Diagnosis (not tooth-specific) ─
// Alphabetical, "Other" last. Same list as the Other Findings section.
const OTHER_FINDINGS_OPTIONS = [
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
  "Other",
];

// ── Color helpers: any condition label — known or freeform — gets a stable color ─
const CONDITION_COLOR_MAP = [...PERMANENT_DIAGNOSIS_CONDITIONS, ...DECIDUOUS_DIAGNOSIS_CONDITIONS]
  .reduce((m, c) => (m[c.label] = c.color, m), {});
const FALLBACK_PALETTE = ["#ef4444","#f97316","#ca8a04","#16a34a","#0891b2","#3b82f6","#8b5cf6","#db2777","#64748b","#0d9488"];
function colorForLabel(label) {
  if (!label) return "#94a3b8";
  if (CONDITION_COLOR_MAP[label]) return CONDITION_COLOR_MAP[label];
  if (TREATMENT_COLORS[label]) return TREATMENT_COLORS[label];
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}
function isDeciduousTooth(n) { return Number(n) >= 51 && Number(n) <= 85; }
function isLowerTooth(n) { const q = Math.floor(Number(n) / 10); return q === 3 || q === 4 || q === 7 || q === 8; }
// The label is the part before " — " ("Extraction — deep decay" → "Extraction").
function labelOf(note) { return String(note || "").split(" — ")[0]; }
function sortedTeeth(list) { return [...list].map(Number).sort((a, b) => a - b); }

function todayStr() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d) {
  if (!d) return "";
  const p = String(d).split("T")[0].split("-");
  if (p.length !== 3) return d;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOTH CHART — one shared chart used by every tooth picker in this file and by
//  the small coloured charts inside each section. Each quadrant is a fixed grid,
//  so the teeth can never wrap onto a second line, however narrow the window is.
// ═════════════════════════════════════════════════════════════════════════════

// Simple tooth outlines, drawn for an UPPER tooth (roots up, crown down).
// Lower teeth use the same outline flipped upside-down.
const TOOTH_PATHS = {
  molar:    "M2.6 19.5 Q2.4 15.6 5.6 15.2 L5.9 7.2 Q7 2.6 8.6 7 L9.6 13.8 L11 7.4 Q12 3.6 13 7.4 L14.4 13.8 L15.4 7 Q17 2.6 18.1 7.2 L18.4 15.2 Q21.6 15.6 21.4 19.5 L21.6 27 Q21.4 32 17.4 31.2 Q14.6 30 12 31.2 Q9.4 30 6.6 31.2 Q2.6 32 2.4 27 Z",
  premolar: "M5.4 19.5 Q5.2 15.8 8.4 15.2 L9.2 7.4 Q10.4 3 11.4 7.4 L12 12.6 L12.6 7.4 Q13.6 3 14.8 7.4 L15.6 15.2 Q18.8 15.8 18.6 19.5 L18.8 27 Q18.6 32 15 31.2 Q12 29.8 9 31.2 Q5.4 32 5.2 27 Z",
  canine:   "M6.6 19.8 Q6.4 16 9.4 15 L10.2 5.4 Q12 0.6 13.8 5.4 L14.6 15 Q17.6 16 17.4 19.8 L17.2 25.4 Q15.4 30.2 12 33 Q8.6 30.2 6.8 25.4 Z",
  incisor:  "M7 19 Q6.9 15.8 9.6 15 L10.4 6.6 Q12 2.2 13.6 6.6 L14.4 15 Q17.1 15.8 17 19 L17.4 29.8 Q12 32.2 6.6 29.8 Z",
};
function toothKind(n) {
  const pos = Number(n) % 10;
  if (isDeciduousTooth(n)) return pos >= 4 ? "molar" : pos === 3 ? "canine" : "incisor";
  return pos >= 6 ? "molar" : pos >= 4 ? "premolar" : pos === 3 ? "canine" : "incisor";
}

function ToothGlyph({ n, fill = "#ffffff", stroke = "#94a3b8" }) {
  return (
    <svg className="ctp-glyph" viewBox="0 0 24 34" aria-hidden="true" focusable="false">
      <path d={TOOTH_PATHS[toothKind(n)]}
        transform={isLowerTooth(n) ? "translate(0 34) scale(1 -1)" : undefined}
        fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  );
}

// marks    : { toothNumber: { color, label, count } }  — coloured teeth
// selected : Set of tooth numbers currently picked (blue outline)
// hints    : { toothNumber: ["Diagnosis: Dental Caries", …] } — small amber dot
// onToothClick / onQuadrantClick : leave both out for a read-only chart
// mini     : small version for the section cards
// footNote : small explanation printed under the chart (what the dot means)
function ToothChart({ chartType = "permanent", marks = {}, selected = null, hints = null, onToothClick = null, onQuadrantClick = null, mini = false, footNote = "" }) {
  const chart = chartType === "deciduous" ? DECIDUOUS : PERMANENT;
  const colWidth = mini ? 24 : 46;

  const renderTooth = n => {
    const mark   = marks[n];
    const isSel  = !!selected && selected.has(n);
    const hint   = hints && hints[n] && hints[n].length ? hints[n] : null;
    const fill   = mark ? mark.color : isSel ? "#bfdbfe" : "#ffffff";
    const stroke = mark ? "rgba(15,23,42,0.45)" : isSel ? "#2563eb" : "#94a3b8";
    const cls = `ctp-tooth${isLowerTooth(n) ? " lower" : ""}${mark ? " done" : ""}${isSel ? " sel" : ""}`;
    const describe = [
      `Tooth ${n} (${toothKind(n)})`,
      mark ? mark.label : null,
      hint ? hint.join("; ") : null,
    ].filter(Boolean).join(" — ");
    const inner = (
      <>
        <span className="ctp-num">{n}</span>
        <ToothGlyph n={n} fill={fill} stroke={stroke}/>
        {hint && <span className="ctp-hintdot" aria-hidden="true"/>}
        {mark && mark.count > 1 && <span className="ctp-count" aria-hidden="true">{mark.count}</span>}
      </>
    );
    if (!onToothClick) {
      return <span key={n} className={cls} style={mark ? { "--c": mark.color } : undefined} title={describe}>{inner}</span>;
    }
    return (
      <button key={n} type="button" className={cls} style={mark ? { "--c": mark.color } : undefined}
        title={describe} aria-label={describe} aria-pressed={isSel}
        onClick={() => onToothClick(n)}>
        {inner}
      </button>
    );
  };

  const quad = (key, side) => (
    <div className={`ctp-quad ${side}`} style={{ gridTemplateColumns: `repeat(${chart[key].length}, minmax(0, ${colWidth}px))` }}>
      {chart[key].map(renderTooth)}
    </div>
  );

  const quadLabel = key => {
    if (mini) return <span className="ctp-qname">{QUADRANT_NAMES[key]}</span>;
    if (!onQuadrantClick) return <span className="ctp-qname">{QUADRANT_NAMES[key]}</span>;
    return (
      <button type="button" className="ctp-qbtn" title={`Select every ${QUADRANT_NAMES[key].toLowerCase()} tooth`}
        onClick={() => onQuadrantClick(chart[key])}>
        {QUADRANT_NAMES[key]}
      </button>
    );
  };

  return (
    <div className={`ctp-chart${mini ? " mini" : ""}`}>
      <div className="ctp-qrow">
        <span className="ctp-qside"><span className="ctp-side">◀ <span className="ctp-side-long">Patient's </span>right</span>{quadLabel("upperRight")}</span>
        <span className="ctp-qside">{quadLabel("upperLeft")}<span className="ctp-side"><span className="ctp-side-long">Patient's </span>left ▶</span></span>
      </div>
      <div className="ctp-arch">
        {quad("upperRight", "right")}
        <div className="ctp-mid"/>
        {quad("upperLeft", "left")}
      </div>
      <div className="ctp-occl"/>
      <div className="ctp-arch">
        {quad("lowerRight", "right")}
        <div className="ctp-mid"/>
        {quad("lowerLeft", "left")}
      </div>
      <div className="ctp-qrow">
        {quadLabel("lowerRight")}
        {footNote && <span className="ctp-foot"><span className="ctp-hintdot static"/> {footNote}</span>}
        {quadLabel("lowerLeft")}
      </div>
    </div>
  );
}

// ── Small coloured chart shown inside a section card ─────────────────────────
// entries: [{ note, teeth, color }]. A tooth with several entries shows the first
// colour and a small number; hovering lists everything on that tooth.
function SectionChart({ entries, title }) {
  const marks = {};
  entries.forEach(e => {
    const label = labelOf(e.note);
    const color = e.color || colorForLabel(label);
    (e.teeth || []).forEach(t => {
      const n = Number(t);
      if (!marks[n]) marks[n] = { color, label, labels: [label], count: 1 };
      else if (!marks[n].labels.includes(label)) {
        marks[n].labels.push(label);
        marks[n].count = marks[n].labels.length;
        marks[n].label = marks[n].labels.join(", ");
      }
    });
  });
  const teeth = Object.keys(marks);
  if (teeth.length === 0) return null;

  const hasPerm = teeth.some(t => !isDeciduousTooth(t));
  const hasDec  = teeth.some(t => isDeciduousTooth(t));

  const legend = {};
  Object.values(marks).forEach(m => m.labels.forEach(l => { if (!legend[l]) legend[l] = colorForLabel(l); }));
  entries.forEach(e => { const l = labelOf(e.note); if (legend[l] && e.color) legend[l] = e.color; });

  return (
    <div className="csec-chart">
      <div className="csec-chart-title">{title}</div>
      {hasPerm && (
        <div style={{ marginBottom: hasDec ? 8 : 0 }}>
          {hasDec && <div className="csec-chart-sub">Permanent</div>}
          <ToothChart chartType="permanent" marks={marks} mini/>
        </div>
      )}
      {hasDec && (
        <div>
          {hasPerm && <div className="csec-chart-sub">Deciduous</div>}
          <ToothChart chartType="deciduous" marks={marks} mini/>
        </div>
      )}
      <div className="csec-legend">
        {Object.entries(legend).map(([label, color]) => (
          <span key={label} className="csec-legend-chip">
            <span className="csec-legend-dot" style={{ background: color }}/>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Window (modal) frame ─────────────────────────────────────────────────────
// Drawn directly on the page body, so it is always centred on the screen no
// matter where the Consultation card sits or how the page is animated.
function Modal({ title, onClose, children, footer, size = "md", escCloses = true }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape" && escCloses) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, escCloses]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  return createPortal(
    <div className="cmod-overlay">
      <div className={`cmod cmod-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="cmod-head">
          <span className="cmod-title">{title}</span>
          <button type="button" className="cmod-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cmod-body">{children}</div>
        <div className="cmod-foot">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

// ── Date chip: shows dd/mm/yyyy, click it to pick another date ───────────────
function DateField({ value, onChange }) {
  const isToday = value === todayStr();
  return (
    <div className="cdate">
      <span className="cdate-lbl">Date</span>
      <span className="cdate-chip" title="Click to choose another date">
        📅 {fmtDate(value)}
        {isToday && <span className="cdate-today">today</span>}
        <span className="cdate-change">change</span>
        <input type="date" className="cdate-input" aria-label="Date" value={value}
          onChange={e => onChange(e.target.value || todayStr())}/>
      </span>
      {!isToday && (
        <button type="button" className="cdate-reset" onClick={() => onChange(todayStr())}>Use today</button>
      )}
    </div>
  );
}

function ChartTypeTabs({ chartType, onChange, counts = null }) {
  return (
    <div className="ctabs" role="group" aria-label="Type of teeth">
      {[["permanent", "Permanent teeth"], ["deciduous", "Deciduous (milk) teeth"]].map(([key, label]) => (
        <button key={key} type="button" className={`ctab${chartType === key ? " active" : ""}`}
          aria-pressed={chartType === key} onClick={() => onChange(key)}>
          {label}
          {counts && counts[key] > 0 && <span className="ctab-count">{counts[key]}</span>}
        </button>
      ))}
    </div>
  );
}

// Tick / untick a whole quadrant: if every tooth in it is already selected the
// quadrant is cleared, otherwise all of it is selected.
function toggleQuadrant(prev, teeth) {
  const s = new Set(prev);
  const allIn = teeth.every(t => s.has(t));
  teeth.forEach(t => { if (allIn) s.delete(t); else s.add(t); });
  return s;
}

function SelectionBar({ selected, onClear, emptyText }) {
  const list = sortedTeeth(selected);
  return (
    <div className={`csel${list.length ? " has" : ""}`} aria-live="polite">
      {list.length === 0 ? (
        <span className="csel-empty">{emptyText}</span>
      ) : (
        <>
          <span className="csel-lbl">Selected {list.length === 1 ? "tooth" : `${list.length} teeth`}:</span>
          <span className="csel-teeth">{list.map(n => <span key={n} className="ctag">{n}</span>)}</span>
          <button type="button" className="csel-clear" onClick={onClear}>Clear selection</button>
        </>
      )}
    </div>
  );
}

// ── Dental Chart Modal — pick teeth and type one note for all of them ────────
function DentalChartModal({ onClose, onConfirm }) {
  const [chartType, setChartType] = useState("permanent");
  const [selected,  setSelected]  = useState(new Set());
  const [note,      setNote]      = useState("");
  const [date,      setDate]      = useState(todayStr());
  const toggle = n => setSelected(p => { const s=new Set(p); s.has(n)?s.delete(n):s.add(n); return s; });
  const sorted = sortedTeeth(selected);
  const counts = {
    permanent: sorted.filter(n => !isDeciduousTooth(n)).length,
    deciduous: sorted.filter(n => isDeciduousTooth(n)).length,
  };
  const ready = sorted.length > 0 && note.trim();

  return (
    <Modal title="🦷 Select Teeth" onClose={onClose} size="lg" escCloses={sorted.length === 0 && !note.trim()}
      footer={
        <>
          <DateField value={date} onChange={setDate}/>
          <div className="cmod-actions">
            <button type="button" className="cbtn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="cbtn primary" disabled={!ready}
              onClick={()=>onConfirm({teeth:sorted,note:note.trim(),date,chartType})}>OK</button>
          </div>
        </>
      }>
      <ChartTypeTabs chartType={chartType} onChange={setChartType} counts={counts}/>
      <ToothChart chartType={chartType} selected={selected} onToothClick={toggle}
        onQuadrantClick={teeth => setSelected(p => toggleQuadrant(p, teeth))}/>
      <SelectionBar selected={selected} onClear={() => setSelected(new Set())}
        emptyText="Tap the teeth this note is about."/>
      <textarea className="cmod-textarea" placeholder="Enter notes for selected teeth…"
        value={note} onChange={e=>setNote(e.target.value)}/>
    </Modal>
  );
}

// ── Treatment Chart Modal ────────────────────────────────────────────────────
// Used for "Advice & Treatment Plan", "Treatment Done Today" and for adding a
// Dental Chart finding from Diagnosis.
//   1. tap one or more teeth      2. choose the treatment      3. press Apply
// Repeat for other teeth, then press the blue button at the bottom.
// Every option gets a note box: optional for the fixed options, required for
// "Other" (its whole description comes from the note).
function TreatmentChartModal({
  onClose,
  onConfirm,
  permanentOptions = PERMANENT_TREATMENTS,
  deciduousOptions = DECIDUOUS_TREATMENTS,
  title = "✅ Treatment Done — Select Tooth",
  hints = null,          // { tooth: ["Diagnosis: Dental Caries", …] } → dot on those teeth
  hintLabel = "",        // what the dot means, shown under the chart
  itemWord = "treatment" // "treatment" or "condition" — only changes the wording
}) {
  const [chartType,  setChartType]  = useState("permanent");
  const [assign,     setAssign]     = useState({});          // { toothNum: { label, note, color } }
  const [selected,   setSelected]   = useState(new Set());   // teeth picked, waiting for a treatment
  const [draftLabel, setDraftLabel] = useState(null);        // treatment picked, waiting for "Apply"
  const [noteDraft,  setNoteDraft]  = useState("");
  const [query,      setQuery]      = useState("");
  const [date,       setDate]       = useState(todayStr());
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  const rawOptions = (chartType === "permanent" ? permanentOptions : deciduousOptions) || [];
  // Normalize to {label,color} — plain-string option lists still work.
  const options = useMemo(
    () => rawOptions.map(o => typeof o === "string" ? { label: o, color: TREATMENT_COLORS[o] || colorForLabel(o) } : o),
    [rawOptions]
  );
  const shownOptions = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const resetDraft = () => { setDraftLabel(null); setNoteDraft(""); };

  const toggleTooth = n => {
    const next = new Set(selected);
    if (next.has(n)) next.delete(n); else next.add(n);
    setSelected(next);
    // Tapping a single tooth that already has a treatment loads it for editing.
    if (next.size === 1 && !draftLabel) {
      const only = [...next][0];
      if (assign[only]) { setDraftLabel(assign[only].label); setNoteDraft(assign[only].note || ""); }
    }
  };

  const switchChart = t => {
    if (t === chartType) return;
    setChartType(t); setSelected(new Set()); resetDraft(); setQuery("");
  };

  const selectedList = sortedTeeth(selected);
  const canApply = selectedList.length > 0 && !!draftLabel && (draftLabel !== "Other" || !!noteDraft.trim());

  const withDraftApplied = base => {
    const color = options.find(o => o.label === draftLabel)?.color || colorForLabel(draftLabel);
    const next = { ...base };
    selectedList.forEach(n => { next[n] = { label: draftLabel, note: noteDraft.trim(), color }; });
    return next;
  };

  const applyDraft = () => {
    if (!canApply) return;
    setAssign(withDraftApplied(assign));
    setSelected(new Set());
    resetDraft();
    setQuery("");
    setError("");
  };

  const removeTeeth = list => {
    setAssign(p => { const c = { ...p }; list.forEach(n => { delete c[n]; }); return c; });
    setSelected(p => { const s = new Set(p); list.forEach(n => s.delete(n)); return s; });
    resetDraft();
  };

  // How a tooth's treatment renders as text, e.g. "Extraction — deep decay" or just the "Other" text
  const fmtInfo = info => {
    if (info.label === "Other") return info.note || "Other";
    return info.note ? `${info.label} — ${info.note}` : info.label;
  };

  // Group teeth by identical treatment+note text — mirrors auto-diagnosis grouping
  const buildGroups = map => {
    const groups = {};
    Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([tooth, info]) => {
      const text = fmtInfo(info);
      if (!groups[text]) groups[text] = { note: text, label: info.label, freeText: info.note || "", teeth: [], color: info.color || null };
      groups[text].teeth.push(Number(tooth));
    });
    return Object.values(groups);
  };

  const groups = buildGroups(assign);
  const assignedTeeth = Object.keys(assign).map(Number);
  const counts = {
    permanent: assignedTeeth.filter(n => !isDeciduousTooth(n)).length,
    deciduous: assignedTeeth.filter(n => isDeciduousTooth(n)).length,
  };
  // What will be saved if the bottom button is pressed now. A treatment that is
  // chosen but not yet "Applied" is included, so nothing the doctor picked is lost.
  const finalAssign = canApply ? withDraftApplied(assign) : assign;
  const finalCount  = Object.keys(finalAssign).length;

  const handleOk = async () => {
    if (finalCount === 0 || saving) return;
    const finalGroups = buildGroups(finalAssign);
    const all = Object.keys(finalAssign);
    const kind = all.every(isDeciduousTooth) ? "deciduous" : all.some(isDeciduousTooth) ? "mixed" : "permanent";
    setSaving(true); setError("");
    try {
      await onConfirm({ groups: finalGroups, date, chartType: kind });
    } catch (err) {
      console.error("Could not save", err);
      setError(err?.response?.data?.error || "Could not save — please check the connection and try again.");
      setSaving(false);
    }
  };

  const marks = {};
  Object.entries(assign).forEach(([tooth, info]) => { marks[tooth] = { color: info.color, label: fmtInfo(info) }; });

  const selectedAssigned = selectedList.filter(n => assign[n]);
  const selectedHints = hints ? selectedList.filter(n => hints[n] && hints[n].length) : [];
  const hasAnyHint = hints && Object.keys(hints).some(t =>
    (chartType === "deciduous") === isDeciduousTooth(t) && hints[t].length);

  return (
    <Modal title={title} onClose={onClose} size="xl" escCloses={!saving && finalCount === 0 && selected.size === 0}
      footer={
        <>
          <DateField value={date} onChange={setDate}/>
          <div className="cmod-actions">
            <button type="button" className="cbtn ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="cbtn primary" disabled={finalCount === 0 || saving} onClick={handleOk}>
              {saving ? "Saving…" : finalCount === 0 ? "OK" : `OK — add ${finalCount} ${finalCount === 1 ? "tooth" : "teeth"}`}
            </button>
          </div>
        </>
      }>
      <div className="ctm-layout">
        {/* ── Left: the chart ── */}
        <div className="ctm-left">
          <ChartTypeTabs chartType={chartType} onChange={switchChart} counts={counts}/>

          <div className="csteps">
            <span><b>1</b> Tap one or more teeth</span>
            <span><b>2</b> Choose the {itemWord}</span>
            <span><b>3</b> Press Apply</span>
          </div>

          <ToothChart chartType={chartType} marks={marks} selected={selected} hints={hints}
            onToothClick={toggleTooth}
            onQuadrantClick={teeth => setSelected(p => toggleQuadrant(p, teeth))}
            footNote={hasAnyHint && hintLabel ? hintLabel : ""}/>

          {groups.length > 0 && (
            <div className="csum">
              <div className="csum-title">Ready to add ({assignedTeeth.length} {assignedTeeth.length === 1 ? "tooth" : "teeth"})</div>
              {groups.map(g => (
                <div key={g.note} className="csum-row" style={{ "--c": g.color || "#3b82f6" }}>
                  <span className="csum-text">{g.note}</span>
                  <span className="csum-teeth">
                    {g.teeth.map(n => (
                      <span key={n} className="ctag" style={{ background: g.color || "#3b82f6" }}>
                        {n}
                        <button type="button" className="ctag-x" aria-label={`Remove tooth ${n}`} title={`Remove tooth ${n}`}
                          onClick={() => removeTeeth([n])}>✕</button>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: what to put on the selected teeth ── */}
        <div className={`copt${selectedList.length ? " active" : ""}`}>
          <div className="copt-head" aria-live="polite">
            {selectedList.length ? (
              <>
                <span className="copt-title">{itemWord === "condition" ? "Condition" : "Treatment"} for tooth</span>
                <span className="csel-teeth">{selectedList.map(n => <span key={n} className="ctag">{n}</span>)}</span>
                <button type="button" className="csel-clear" onClick={() => { setSelected(new Set()); resetDraft(); }}>Clear selection</button>
              </>
            ) : (
              <span className="copt-title muted">No tooth selected yet — tap a tooth on the chart (or a quadrant name for the whole quadrant).</span>
            )}
          </div>

          {selectedHints.length > 0 && (
            <div className="chint-list">
              {selectedHints.map(n => (
                <div key={n}><span className="ctag light">{n}</span> {hints[n].join(" · ")}</div>
              ))}
            </div>
          )}

          {options.length > 16 && (
            <input type="search" className="copt-search" placeholder={`Search ${itemWord}s…`} aria-label={`Search ${itemWord}s`}
              value={query} onChange={e => setQuery(e.target.value)}/>
          )}
          <div className={`copt-grid${options.length > 16 ? " scroll" : ""}`} role="group" aria-label={`${itemWord}s`}>
            {shownOptions.map(opt => (
              <button key={opt.label} type="button"
                className={`copt-btn${draftLabel === opt.label ? " on" : ""}`}
                style={{ "--c": opt.color || "#3b82f6" }}
                aria-pressed={draftLabel === opt.label}
                onClick={() => { setDraftLabel(opt.label); setError(""); }}>
                <span className="copt-dot"/>
                {itemWord === "condition" && DENTAL_CHART_CMAP[opt.label]?.emoji && <span className="copt-emoji">{DENTAL_CHART_CMAP[opt.label].emoji}</span>}
                <span className="copt-lbl">{opt.label}</span>
              </button>
            ))}
            {shownOptions.length === 0 && <div className="copt-none">Nothing matches "{query}". Choose "Other" to type your own.</div>}
          </div>

          {draftLabel && (
            <div className="copt-note">
              <textarea className="cmod-textarea small" rows={1}
                placeholder={draftLabel === "Other" ? `Describe the ${itemWord} (needed for "Other")…` : "Add a note (optional)…"}
                aria-label="Note"
                value={noteDraft} onChange={e => setNoteDraft(e.target.value)}/>
            </div>
          )}

          <div className="copt-actions">
            <span className="copt-why">
              {!selectedList.length ? "Select a tooth first."
                : !draftLabel ? `Now choose the ${itemWord}.`
                : draftLabel === "Other" && !noteDraft.trim() ? `Type a description for "Other".`
                : ""}
            </span>
            {selectedAssigned.length > 0 && (
              <button type="button" className="cbtn danger-ghost" onClick={() => removeTeeth(selectedAssigned)}>
                🗑️ Remove from tooth {selectedAssigned.join(", ")}
              </button>
            )}
            <button type="button" className="cbtn apply" disabled={!canApply} onClick={applyDraft}>
              {canApply ? `Apply ${draftLabel} to tooth ${selectedList.join(", ")}` : "Apply"}
            </button>
          </div>

          {error && <div className="cerr" role="alert">⚠️ {error}</div>}
        </div>
      </div>
    </Modal>
  );
}

// ── Other Finding Modal — pick a whole-mouth finding (not tooth-specific) ───
// Selecting "Other" requires the text area, since its description comes from there.
function OtherFindingModal({ onClose, onConfirm, options = OTHER_FINDINGS_OPTIONS, title = "🔍 Add Other Finding" }) {
  const [label,  setLabel]  = useState(null);
  const [note,   setNote]   = useState("");
  const [query,  setQuery]  = useState("");
  const [date,   setDate]   = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const canConfirm = !!label && (label !== "Other" || !!note.trim());
  const shown = query.trim() ? options.filter(o => o.toLowerCase().includes(query.trim().toLowerCase())) : options;

  const handleOk = async () => {
    if (!canConfirm || saving) return;
    const text = label === "Other" ? note.trim() : (note.trim() ? `${label} — ${note.trim()}` : label);
    setSaving(true); setError("");
    try {
      await onConfirm({ note: text, date });
    } catch (err) {
      console.error("Could not save finding", err);
      setError(err?.response?.data?.error || "Could not save — please check the connection and try again.");
      setSaving(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} size="md" escCloses={!saving && !label}
      footer={
        <>
          <DateField value={date} onChange={setDate}/>
          <div className="cmod-actions">
            <button type="button" className="cbtn ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="cbtn primary" disabled={!canConfirm || saving} onClick={handleOk}>
              {saving ? "Saving…" : "OK"}
            </button>
          </div>
        </>
      }>
      <div className="copt active">
        <div className="copt-head">
          <span className="copt-title">Choose the finding</span>
          <input type="search" className="copt-search" placeholder="Search findings…" aria-label="Search findings"
            value={query} onChange={e => setQuery(e.target.value)}/>
        </div>
        <div className="copt-grid scroll">
          {shown.map(opt => (
            <button key={opt} type="button" className={`copt-btn${label === opt ? " on" : ""}`}
              style={{ "--c": "#0369a1" }} aria-pressed={label === opt}
              onClick={() => { setLabel(opt); setError(""); }}>
              <span className="copt-lbl">{opt}</span>
            </button>
          ))}
          {shown.length === 0 && <div className="copt-none">Nothing matches "{query}". Choose "Other" to type your own.</div>}
        </div>
        {label && (
          <div className="copt-note">
            <textarea className="cmod-textarea small"
              placeholder={label === "Other" ? "Describe the finding…" : "Add a note (optional)…"}
              aria-label="Note"
              value={note} onChange={e => setNote(e.target.value)} autoFocus/>
          </div>
        )}
      </div>
      {error && <div className="cerr" role="alert">⚠️ {error}</div>}
    </Modal>
  );
}

// ── Entry item (with IRT teeth display) ──────────────────────────────────────
// entry.editText (optional) is what the edit box starts with, when that is
// different from the text shown (used by Diagnosis: only the notes are editable).
function EntryItem({ entry, onEdit, onDelete, readOnly = false, editPlaceholder = "" }) {
  const [editing, setEditing] = useState(false);
  const [text,    setText]    = useState(entry.note||"");
  const startEdit = () => { setText(entry.editText !== undefined ? entry.editText : (entry.note || "")); setEditing(true); };
  const save = () => { onEdit(entry.id, text); setEditing(false); };

  const hasTeeth = entry.teeth && entry.teeth.length > 0;
  const accent = entry.color || null;

  return (
    <div style={{...S.entryItem,...(entry.auto?S.entryAuto:{}),...(accent?{borderLeft:`4px solid ${accent}`}:{})}}>
      <div style={S.entryMeta}>
        <span style={S.entryDate}>📅 {fmtDate(entry.date||todayStr())}</span>
        {entry.auto&&<span style={S.autoBadge}>auto</span>}
      </div>
      {editing?(
        <div>
          <textarea style={S.editArea} value={text} placeholder={editPlaceholder} onChange={e=>setText(e.target.value)} autoFocus/>
          <div style={{display:"flex",gap:6,marginTop:6}}>
            <button style={S.saveSm} onClick={save}>Save</button>
            <button style={S.cancelSm} onClick={()=>setEditing(false)}>Cancel</button>
          </div>
        </div>
      ):(
        <div style={{...S.entryText,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",paddingRight:readOnly?0:58}}>
          <span style={{minWidth:0}}>{entry.note}</span>
          {hasTeeth&&(
            <span style={S.entryIRT}>
              <span style={S.irtLabel}>IRT</span>
              <span style={S.irtTeeth}>
                {entry.teeth.join(", ")}
              </span>
            </span>
          )}
        </div>
      )}
      {!readOnly && !editing && (
        <div style={S.entryBtns}>
          <button style={S.iconBtn} onClick={startEdit} title="Edit">✏️</button>
          <button style={S.iconBtn} onClick={()=>onDelete(entry.id)} title="Delete">🗑️</button>
        </div>
      )}
    </div>
  );
}

// ── Entry section ─────────────────────────────────────────────────────────────
function EntrySection({ title, entries, onAdd, onEdit, onDelete, showChart=false, chartVariant="teeth", placeholder="", treatmentOptions=null, disabled=false, hints=null, hintLabel="", chartTitle="🦷 Teeth in this section" }) {
  const [open,      setOpen]      = useState(false);
  const [text,      setText]      = useState("");
  const [date,      setDate]      = useState(todayStr());
  const [chartOpen, setChartOpen] = useState(false);

  const handleOk = () => {
    if (!text.trim()) return;
    onAdd({ id:Date.now(), note:text.trim(), date, teeth:[] });
    setText(""); setDate(todayStr()); setOpen(false);
  };

  return (
    <div style={S.section}>
      <div style={S.sectionHeader}>
        <span style={S.sectionTitle}>{title}</span>
        {!disabled && (
          <div style={{display:"flex",gap:6}}>
            {showChart&&<button style={S.chartBtn} onClick={()=>setChartOpen(true)} title="Pick teeth on the chart">🦷 Chart</button>}
            <button style={S.addBtn} onClick={()=>setOpen(o=>!o)} title="Type a note without choosing teeth">+ Add</button>
          </div>
        )}
      </div>
      {open&&!disabled&&(
        <div style={S.inputBox}>
          <textarea style={S.inputArea} placeholder={placeholder} value={text} onChange={e=>setText(e.target.value)} autoFocus/>
          <DateField value={date} onChange={setDate}/>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
            <button style={S.cancelBtnSt} onClick={()=>setOpen(false)}>Cancel</button>
            <button style={{...S.okBtnSt,...(text.trim()?{}:S.btnOff)}} onClick={handleOk} disabled={!text.trim()}>OK</button>
          </div>
        </div>
      )}
      {chartOpen && chartVariant==="treatment" && (
        <TreatmentChartModal onClose={()=>setChartOpen(false)}
          permanentOptions={treatmentOptions?.permanent}
          deciduousOptions={treatmentOptions?.deciduous}
          title={treatmentOptions?.title}
          hints={hints}
          hintLabel={hintLabel}
          onConfirm={({groups,date,chartType})=>{
            groups.forEach((g,i)=>{
              onAdd({id:Date.now()+i,note:g.note,date,teeth:g.teeth,chartType,color:g.color});
            });
            setChartOpen(false);
          }}/>
      )}
      {chartOpen && chartVariant!=="treatment" && (
        <DentalChartModal onClose={()=>setChartOpen(false)}
          onConfirm={data=>{
            onAdd({id:Date.now(),note:data.note,date:data.date,teeth:data.teeth,chartType:data.chartType});
            setChartOpen(false);
          }}/>
      )}
      {showChart && <SectionChart entries={entries} title={chartTitle}/>}
      <div style={S.entryList}>
        {entries.map(e=>(
          <EntryItem key={e.id} entry={e} onEdit={onEdit} onDelete={onDelete} readOnly={disabled}/>
        ))}
        {entries.length===0&&(
          <div style={S.emptyMsg}>
            {disabled ? "No entries" : showChart ? "No entries yet — press 🦷 Chart to pick teeth, or + Add to type a note" : "No entries yet"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Diagnosis cell — always read-only ────────────────────────────────────────
function DiagnosisReadOnly({ text }) {
  if (!text) return <span style={{color:"#cbd5e1",fontStyle:"italic",fontSize:12}}>—</span>;
  const items = text.split(";").map(s=>s.trim()).filter(Boolean);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      {items.map((item,i)=>(
        <div key={i} style={{display:"flex",alignItems:"flex-start",gap:5}}>
          <span style={{flexShrink:0,marginTop:5,width:5,height:5,borderRadius:"50%",
            background:"#94a3b8",display:"inline-block"}}/>
          <span style={{fontSize:12.5,color:"#1e293b",lineHeight:1.5}}>{item}</span>
        </div>
      ))}
    </div>
  );
}

// ── Read-only row (past records) ─────────────────────────────────────────────
function HistoryRowReadOnly({ r }) {
  return (
    <tr style={{background:"#fafbfc"}}>
      <td style={{fontFamily:"'DM Mono',monospace",fontSize:11.5,color:"#64748b",whiteSpace:"nowrap",verticalAlign:"top"}}>
        {fmtDate(r.created_at||r.updated_at||"")}
      </td>
      <td><DiagnosisReadOnly text={r.diagnosis}/></td>
      <td style={{fontSize:12.5,color:"#64748b",lineHeight:1.5,verticalAlign:"top",fontStyle:"italic"}}>
        {r.advice||r.treatment_plan||"—"}
      </td>
      <td style={{fontSize:12.5,color:"#64748b",lineHeight:1.5,verticalAlign:"top",fontStyle:"italic"}}>
        {r.treatment_done_today||"—"}
      </td>
      <td style={{fontFamily:"'DM Mono',monospace",fontSize:12,verticalAlign:"top",color:"#94a3b8"}}>
        {r.follow_up_date ? (
          <div>
            <div>{fmtDate(r.follow_up_date)}</div>
            {r.follow_up_time && <div style={{fontSize:10.5,color:"#64748b",fontFamily:"'DM Mono',monospace",marginTop:2}}>🕐 {r.follow_up_time}</div>}
          </div>
        ) : "—"}
      </td>
      <td style={{verticalAlign:"top"}}>
        <span style={{fontSize:10,color:"#94a3b8",background:"#f1f5f9",border:"1px solid #e2e8f0",
          borderRadius:4,padding:"2px 6px",whiteSpace:"nowrap"}}>🔒 past</span>
      </td>
    </tr>
  );
}

// ── Editable row (today's records) ───────────────────────────────────────────
function HistoryRow({ r, onSave, onDelete }) {
  const [editing,   setEditing]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [adv,       setAdv]       = useState(r.advice||r.treatment_plan||"");
  const [treat,     setTreat]     = useState(r.treatment_done_today||"");
  const [fupManual, setFupManual] = useState(r.follow_up_date||"");

  useEffect(()=>{
    setAdv(r.advice||r.treatment_plan||"");
    setTreat(r.treatment_done_today||"");
    setFupManual(r.follow_up_date||"");
  },[r.id, r.advice, r.treatment_done_today, r.follow_up_date]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(r.id, {
      advice: adv,
      treatment_plan: adv,
      treatment_done_today: treat,
      follow_up_date: fupManual,
    });
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <tr style={{background:"#fffbeb",outline:"2px solid #fcd34d",outlineOffset:-1}}>
        <td style={{fontFamily:"'DM Mono',monospace",fontSize:11.5,color:"#64748b",whiteSpace:"nowrap",verticalAlign:"top",paddingTop:10}}>
          {fmtDate(r.created_at||r.updated_at||todayStr())}
          <div style={{fontSize:9,color:"#a3a3a3",marginTop:2}}>today</div>
        </td>
        <td style={{verticalAlign:"top"}}>
          <DiagnosisReadOnly text={r.diagnosis}/>
          <div style={{marginTop:5,display:"inline-flex",alignItems:"center",gap:4,
            background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:5,padding:"2px 7px",
            fontSize:10,color:"#94a3b8"}}>🔒 read-only</div>
        </td>
        <td style={{verticalAlign:"top"}}>
          <textarea style={S.histEdit} value={adv} onChange={e=>setAdv(e.target.value)}/>
        </td>
        <td style={{verticalAlign:"top"}}>
          <textarea style={S.histEdit} value={treat} onChange={e=>setTreat(e.target.value)}/>
        </td>
        <td style={{verticalAlign:"top"}}>
          <div style={{position:"relative",display:"inline-flex",alignItems:"center",gap:4,
            background:"#f1f5f9",border:"1.5px solid #e2e8f0",borderRadius:6,padding:"5px 9px",
            fontSize:11.5,color:"#475569",cursor:"pointer",minWidth:100}}>
            🗓 {fupManual?fmtDate(fupManual):"Pick date"}
            <input type="date" value={fupManual} onChange={e=>setFupManual(e.target.value)}
              style={{position:"absolute",opacity:0,inset:0,cursor:"pointer",fontSize:0,width:"100%",height:"100%"}}/>
          </div>
        </td>
        <td style={{verticalAlign:"top"}}>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            <button className="tbl-btn edit" onClick={handleSave} disabled={saving}>
              {saving?"⏳":"💾"}
            </button>
            <button className="tbl-btn del" onClick={()=>setEditing(false)}>✕</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={{fontFamily:"'DM Mono',monospace",fontSize:11.5,color:"#64748b",whiteSpace:"nowrap",verticalAlign:"top"}}>
        {fmtDate(r.created_at||r.updated_at||todayStr())}
        <div style={{fontSize:9,color:"#22c55e",marginTop:2,fontWeight:600}}>today</div>
      </td>
      <td style={{verticalAlign:"top"}}><DiagnosisReadOnly text={r.diagnosis}/></td>
      <td style={{fontSize:12.5,color:"#1e293b",lineHeight:1.6,verticalAlign:"top"}}>{r.advice||r.treatment_plan||"—"}</td>
      <td style={{fontSize:12.5,color:"#1e293b",lineHeight:1.6,verticalAlign:"top"}}>{r.treatment_done_today||"—"}</td>
      <td style={{fontFamily:"'DM Mono',monospace",fontSize:12,verticalAlign:"top"}}>
        {r.follow_up_date ? (
          <div>
            <div>{fmtDate(r.follow_up_date)}</div>
            {r.follow_up_time && <div style={{fontSize:10.5,color:"#64748b",marginTop:2}}>🕐 {r.follow_up_time}</div>}
          </div>
        ) : "—"}
      </td>
      <td style={{verticalAlign:"top"}}>
        <button className="tbl-btn edit" title="Edit" onClick={()=>setEditing(true)}>✏️</button>
        <button className="tbl-btn del"  title="Delete" onClick={()=>onDelete(r.id)}>🗑️</button>
      </td>
    </tr>
  );
}

// ── Separated Diagnosis Section with dental chart + other findings ──────────
function DiagnosisSection({
  dentalEntries, findingEntries,
  onAddDental, onEditDental, onDeleteDental,
  onAddFinding, onEditFinding, onDeleteFinding,
  disabled = false,
}) {
  const [addChoice, setAddChoice] = useState(false);   // shows the "Dental Chart / Other Finding" chooser
  const [dentalModalOpen,  setDentalModalOpen]  = useState(false);
  const [findingModalOpen, setFindingModalOpen] = useState(false);

  // Teeth that already have a condition recorded today → small dot in the picker
  const recorded = {};
  dentalEntries.forEach(e => {
    const label = labelOf(e.note);
    (e.teeth || []).forEach(t => { (recorded[t] = recorded[t] || []).push(`Already recorded: ${label}`); });
  });

  return (
    <div style={S.section}>
      <div style={S.sectionHeader}>
        <span style={S.sectionTitle}>📋 Diagnosis</span>
        {!disabled && (
          <div style={{display:"flex",gap:6}}>
            <button style={S.addBtn} onClick={()=>setAddChoice(o=>!o)}>+ Add</button>
          </div>
        )}
      </div>

      {/* Auto-fill notice */}
      <div style={S.autoNote}>
        {disabled
          ? "✅ Filled in from the Dental Chart & Other Findings"
          : "✅ Auto-filled from Dental Chart & Other Findings — editable, addable, deletable"}
      </div>

      {addChoice && !disabled && (
        <div style={S.addChooserBox}>
          <div style={S.addChooserLabel}>What would you like to add?</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button style={S.chooserBtn}
              onClick={()=>{setAddChoice(false);setDentalModalOpen(true);}}>
              🦷 Dental Chart Finding
            </button>
            <button style={S.chooserBtn}
              onClick={()=>{setAddChoice(false);setFindingModalOpen(true);}}>
              🔍 Other Finding
            </button>
          </div>
          <button style={{...S.cancelBtnSt,marginTop:8}} onClick={()=>setAddChoice(false)}>Cancel</button>
        </div>
      )}

      {dentalModalOpen && (
        <TreatmentChartModal onClose={()=>setDentalModalOpen(false)}
          permanentOptions={PERMANENT_DIAGNOSIS_CONDITIONS}
          deciduousOptions={DECIDUOUS_DIAGNOSIS_CONDITIONS}
          title="🦷 Dental Chart — Select Tooth & Condition"
          itemWord="condition"
          hints={recorded}
          hintLabel="Orange dot = this tooth already has a condition recorded today"
          onConfirm={async ({groups,date})=>{
            for (const g of groups) {
              // "Other" → the typed description becomes the condition name;
              // any other condition → the typed text is saved as its note.
              const isOther = g.label === "Other";
              await onAddDental({
                teeth: g.teeth,
                label: isOther ? (g.freeText || "Other") : g.label,
                freeText: g.freeText,
                date,
                color: g.color,
                notes: isOther ? "" : g.freeText,
              });
            }
            setDentalModalOpen(false);
          }}/>
      )}

      {findingModalOpen && (
        <OtherFindingModal onClose={()=>setFindingModalOpen(false)}
          onConfirm={async ({note,date})=>{
            await onAddFinding({ note, date });
            setFindingModalOpen(false);
          }}/>
      )}

      {/* Visual full-mouth chart, colored by condition */}
      <SectionChart entries={dentalEntries} title="🦷 Dental Chart Overview"/>

      {/* Dental Chart sub-section */}
      {dentalEntries.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{
            fontSize:10.5, fontWeight:700, color:"#1d4ed8",
            textTransform:"uppercase", letterSpacing:"0.06em",
            background:"#eff6ff", border:"1px solid #bfdbfe",
            borderRadius:"6px 6px 0 0", padding:"5px 10px",
            display:"flex", alignItems:"center", gap:6,
          }}>
            🦷 Dental Chart Conditions
          </div>
          <div style={{border:"1px solid #bfdbfe",borderTop:"none",borderRadius:"0 0 6px 6px",overflow:"hidden"}}>
            {dentalEntries.map(e => {
              const label = labelOf(e.note);
              const color = e.color || colorForLabel(label);
              return (
                <div key={e.id} style={{borderLeft:`4px solid ${color}`}}>
                  <EntryItem
                    entry={{ ...e, color: null }}
                    readOnly={disabled}
                    editPlaceholder={`Notes for ${label} (optional)…`}
                    onEdit={(_id, txt) => Promise.all(e.recordIds.map(rid => onEditDental(rid, { notes: txt.trim() })))}
                    onDelete={() => {
                      if (!window.confirm(`Delete "${label}" from ${e.recordIds.length} tooth record(s)?`)) return;
                      Promise.all(e.recordIds.map(rid => onDeleteDental(rid)));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other Findings sub-section */}
      {findingEntries.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{
            fontSize:10.5, fontWeight:700, color:"#0369a1",
            textTransform:"uppercase", letterSpacing:"0.06em",
            background:"#e0f2fe", border:"1px solid #7dd3fc",
            borderRadius:"6px 6px 0 0", padding:"5px 10px",
            display:"flex", alignItems:"center", gap:6,
          }}>
            🔍 Other Findings
          </div>
          <div style={{border:"1px solid #7dd3fc",borderTop:"none",borderRadius:"0 0 6px 6px",overflow:"hidden"}}>
            {findingEntries.map(e => (
              <EntryItem
                key={e.id}
                entry={e}
                readOnly={disabled}
                onEdit={(_id, txt) => { if (txt.trim()) onEditFinding(e.findingId, txt.trim()); }}
                onDelete={() => {
                  if (!window.confirm(`Delete this finding?`)) return;
                  onDeleteFinding(e.findingId);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {dentalEntries.length === 0 && findingEntries.length === 0 && (
        <div style={S.emptyMsg}>Will auto-populate once conditions or findings are recorded</div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Consultation({
  visitId,
  disabled       = false,
  otherFindings  = [],
  dentalChartLog = [],
  patient        = null,
  onSaved,                  // FIX: callback to notify parent after a successful save
  onAddDentalRecord,        // writes a real dental-chart record (single source of truth lives in VisitPage)
  onEditDentalRecord,
  onDeleteDentalRecord,
  onAddFindingRecord,       // writes a real findings record
  onEditFindingRecord,
  onDeleteFindingRecord,
}) {
  const [records,        setRecords]        = useState([]);
  // Separated diagnosis
  const [dentalDiag,     setDentalDiag]     = useState([]);   // derived from dentalChartLog (real records)
  const [findingsDiag,   setFindingsDiag]   = useState([]);   // derived from otherFindings (real records)
  const [advice,         setAdvice]         = useState([]);
  const [treatDone,      setTreatDone]      = useState([]);
  const [followUps,      setFollowUps]      = useState([]);
  const [followDate,     setFollowDate]     = useState("");
  const [followTime,     setFollowTime]     = useState("09:00");
  const [showFollowAdd,  setShowFollowAdd]  = useState(false);
  const [showPast,       setShowPast]       = useState(false);
  const [patientInfo,    setPatientInfo]    = useState(patient);

  // Fetch patient info — only runs once when visitId changes and patientInfo is missing
  useEffect(() => {
    if (patientInfo || !visitId) return;
    api.get(`/visits/${visitId}`)
      .then(res => {
        const v = res.data || {};
        setPatientInfo({
          name:        v.patient?.name        || v.patient_name   || v.name   || "",
          mobile:      v.patient?.mobile      || v.patient_mobile || v.mobile || "",
          case_number: v.patient?.case_number || v.case_number    || "",
        });
      })
      .catch(() => setPatientInfo({ name:"", mobile:"", case_number:"" }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  const chartLogKey  = JSON.stringify(dentalChartLog);
  const findingsKey  = JSON.stringify(otherFindings);

  // Auto-fill dental chart diagnosis — fully derived from the real dental-chart
  // records passed down from VisitPage. Manual "+ Add" entries from this panel are
  // now written straight to those same records (see onAddDentalRecord), so this
  // view is always in sync with the Dental Chart tab — no separate manual state.
  useEffect(() => {
    const today = todayStr();
    const condGroups = {};
    dentalChartLog.forEach(row => {
      const rowDate = row.created_at ? row.created_at.split("T")[0] : today;
      if (rowDate !== today) return;
      const condLabel = row.condition==="Other"&&row.other_text ? row.other_text : row.condition;
      if (!condGroups[condLabel]) condGroups[condLabel] = { teeth: [], notes: [], ids: [] };
      condGroups[condLabel].teeth.push(row.tooth_number);
      condGroups[condLabel].ids.push(row.id);
      if (row.notes) condGroups[condLabel].notes.push(row.notes);
    });

    const auto = [];
    Object.entries(condGroups).forEach(([condLabel, { teeth, notes, ids }]) => {
      const sortedTeeth = [...teeth].sort((a,b)=>a-b);
      const noteStr = notes.length > 0 ? ` — ${notes.join("; ")}` : "";
      auto.push({
        id:        `auto-chart-${condLabel.replace(/\s+/g,"-")}`,
        auto:      true,
        date:      today,
        teeth:     sortedTeeth,
        recordIds: ids,           // real dental_chart row ids behind this grouped entry
        note:      `${condLabel}${noteStr}`,
        editText:  notes.join("; "),   // the edit box changes the notes only, never the condition name
        color:     colorForLabel(condLabel),
      });
    });

    setDentalDiag(auto);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartLogKey]);

  // Auto-fill other findings diagnosis — fully derived from the real findings
  // records, same reasoning as above.
  useEffect(() => {
    const today = todayStr();
    const auto = [];
    otherFindings.forEach(f => {
      const fDate = f.value ? f.value.split("T")[0] : today;
      if (fDate !== today) return;
      auto.push({
        id:        `auto-finding-${f.id}`,
        auto:      true,
        date:      today,
        teeth:     [],
        findingId: f.id,          // real findings row id behind this entry
        note:      f.finding_type,
      });
    });

    setFindingsDiag(auto);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findingsKey]);

  // FIX: Load history once on mount — no polling, no repeated fetches
  useEffect(() => {
    if (!visitId) return;
    Promise.all([
      api.get(`/visits/${visitId}/consultations`).catch(()=>({data:[]})),
      api.get(`/appointments`).catch(()=>({data:[]})),
    ]).then(([cRes, aRes]) => {
      const rows  = cRes.data || [];
      const appts = aRes.data || [];
      const enriched = rows.map(r => {
        if (r.follow_up_time || !r.follow_up_date) return r;
        const match = appts.find(a =>
          a.date === r.follow_up_date &&
          (String(a.visit_id) === String(visitId) ||
           a.case_number === (patientInfo?.case_number || "") ||
           a.name === (patientInfo?.name || ""))
        );
        return match?.time ? { ...r, follow_up_time: match.time } : r;
      });
      setRecords(enriched);
    }).catch(()=>{});
  }, [visitId, patientInfo]); // FIX: added patientInfo so enrichment runs with correct data

  // Dots shown on the tooth pickers, so the doctor can see at a glance which
  // teeth already have a diagnosis (and, for "Treatment Done", a plan) today.
  const adviceHints = {};
  dentalDiag.forEach(e => (e.teeth || []).forEach(t => {
    (adviceHints[t] = adviceHints[t] || []).push(`Diagnosis: ${labelOf(e.note)}`);
  }));
  const treatHints = {};
  Object.entries(adviceHints).forEach(([t, list]) => { treatHints[t] = [...list]; });
  advice.forEach(e => (e.teeth || []).forEach(t => {
    (treatHints[t] = treatHints[t] || []).push(`Plan: ${e.note}`);
  }));

  const addEntry  = setter => entry => setter(prev=>[...prev,entry]);
  const editEntry = setter => (id,txt) => setter(prev=>prev.map(e=>e.id===id?{...e,note:txt}:e));
  const delEntry  = setter => id => setter(prev=>prev.filter(e=>e.id!==id));

  const resetForm = () => {
    setAdvice([]);
    setTreatDone([]);
    setFollowUps([]);
    setFollowDate("");
    setFollowTime("09:00");
    setShowFollowAdd(false);
  };

  // Combined diagnosis string for saving: dental chart + other findings
  const buildDiagnosisText = () => {
    const fmtEntry = e => {
      if (e.teeth && e.teeth.length > 0)
        return `${e.note} IRT ${e.teeth.sort((a,b)=>a-b).join(", ")}`;
      return e.note;
    };
    const dentalParts   = dentalDiag.map(fmtEntry);
    const findingsParts = findingsDiag.map(fmtEntry);
    const all = [...dentalParts, ...findingsParts].filter(Boolean);
    return all.join("; ");
  };

  const saveAll = async () => {
    try {
      const diagText = buildDiagnosisText();
      const fmtE = e => {
        if (e.teeth && e.teeth.length > 0)
          return `${e.note} IRT ${e.teeth.sort((a,b)=>a-b).join(", ")}`;
        return e.note;
      };
      const followUpDate = followUps.length>0 ? followUps[followUps.length-1].date : "";
      const payload = {
        diagnosis:            diagText,
        advice:               advice.map(fmtE).join("; "),
        treatment_plan:       advice.map(e=>e.note).join("; "),
        treatment_done_today: treatDone.map(fmtE).join("; "),
        follow_up_date:       followUpDate,
        follow_up_time:       followUps.length>0 ? (followUps[followUps.length-1].time || "") : "",
      };

      await api.post(`/visits/${visitId}/consultations`, payload);

      if (followUps.length > 0) {
        for (const f of followUps) {
          try {
            await api.post(`/appointments`, {
              source:      "consultation",
              name:        patientInfo?.name        || "Patient",
              mobile:      patientInfo?.mobile      || "",
              case_number: patientInfo?.case_number || "",
              date:        f.date,
              time:        f.time || "09:00",
              treatment:   "Follow-up",
              notes:       diagText ? `Follow-up for: ${diagText}` : "Follow-up appointment",
              status:      "pending",
            });
          } catch(apptErr) {
            console.warn("Could not create follow-up appointment:", f.date, apptErr);
          }
        }
      }

      const savedTime = followUps.length>0 ? (followUps[followUps.length-1].time || "") : "";
      const savedDate = followUps.length>0 ? followUps[followUps.length-1].date : "";
      // FIX: single fetch after save — not inside a polling loop
      const res = await api.get(`/visits/${visitId}/consultations`);
      const rows = res.data||[];
      if (rows.length > 0 && savedTime) {
        const last = rows[rows.length-1];
        if (!last.follow_up_time && last.follow_up_date === savedDate) {
          rows[rows.length-1] = { ...last, follow_up_time: savedTime };
        }
      }
      setRecords(rows);
      resetForm();
      onSaved?.(); // FIX: notify parent (VisitPage) to refresh latestConsultation
    } catch(err) { console.error("Save failed", err); }
  };

  const updateRecord = async (id, payload) => {
    try {
      await api.put(`/consultations/${id}`, payload);
      // FIX: update local state directly — no re-fetch needed
      setRecords(prev => prev.map(r => r.id===id ? {...r,...payload} : r));
    } catch(err) {
      console.error("Update failed", err);
      throw err;
    }
  };

  const deleteRecord = async (id) => {
    if (!window.confirm("Delete this consultation record?")) return;
    try {
      await api.delete(`/consultations/${id}`);
      setRecords(prev => prev.filter(r=>r.id!==id));
    } catch(err) { console.error("Delete failed", err); }
  };

  return (
    <>
      <style>{css}</style>
      <div className="cons-root">

        {/* Header */}
        <div className="cons-header">
          <div className="cons-header-icon">🩺</div>
          <div>
            <div className="cons-header-title">Consultation</div>
            <div className="cons-header-sub">Doctor's notes &amp; advice</div>
          </div>
        </div>

        <div className="cons-grid">

          {/* DIAGNOSIS — separated dental + findings */}
          <div className="cons-col">
            <DiagnosisSection
              dentalEntries={dentalDiag}
              findingEntries={findingsDiag}
              onAddDental={onAddDentalRecord}
              onEditDental={onEditDentalRecord}
              onDeleteDental={onDeleteDentalRecord}
              onAddFinding={onAddFindingRecord}
              onEditFinding={onEditFindingRecord}
              onDeleteFinding={onDeleteFindingRecord}
              disabled={disabled}
            />
          </div>

          {/* ADVICE & TREATMENT PLAN */}
          <div className="cons-col">
            <EntrySection
              title="💊 Advice & Treatment Plan"
              entries={advice}
              onAdd={addEntry(setAdvice)}
              onEdit={editEntry(setAdvice)}
              onDelete={delEntry(setAdvice)}
              showChart={true}
              chartVariant="treatment"
              treatmentOptions={{
                permanent: ADVICE_PERMANENT_TREATMENTS,
                deciduous: ADVICE_DECIDUOUS_TREATMENTS,
                title: "💊 Advice & Treatment Plan — Select Tooth",
              }}
              placeholder="Enter advice or treatment plan…"
              disabled={disabled}
              hints={adviceHints}
              hintLabel="Orange dot = this tooth has a diagnosis recorded today"
              chartTitle="🦷 Planned teeth"
            />
          </div>

          {/* TREATMENT DONE TODAY */}
          <div className="cons-col">
            <EntrySection
              title="✅ Treatment Done Today"
              entries={treatDone}
              onAdd={addEntry(setTreatDone)}
              onEdit={editEntry(setTreatDone)}
              onDelete={delEntry(setTreatDone)}
              showChart={true}
              chartVariant="treatment"
              placeholder="Enter treatment done today…"
              disabled={disabled}
              hints={treatHints}
              hintLabel="Orange dot = this tooth has a diagnosis or a plan recorded today"
              chartTitle="🦷 Teeth treated today"
            />
          </div>
        </div>

        {/* NEXT FOLLOW-UP DATE */}
        <div className="cons-followup">
          <div className="cons-followup-header">
            <span className="cons-section-title">🗓 Next Follow-up Date</span>
            {!disabled&&<button className="add-btn" onClick={()=>setShowFollowAdd(o=>!o)}>+ Add</button>}
          </div>
          {showFollowAdd&&(
            <div className="followup-input" style={{alignItems:"flex-start",flexDirection:"column",gap:10}}>
              <div style={{fontSize:11.5,color:"#64748b",fontWeight:500}}>Choose a date:</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <button
                  style={{
                    display:"flex",alignItems:"center",gap:6,
                    background: followDate===todayStr()?"#dcfce7":"#f1f5f9",
                    border: followDate===todayStr()?"1.5px solid #16a34a":"1.5px solid #e2e8f0",
                    borderRadius:8,padding:"7px 13px",fontSize:12.5,
                    color: followDate===todayStr()?"#15803d":"#475569",
                    fontFamily:"'DM Mono',monospace",cursor:"pointer",fontWeight:600,
                    transition:"all .14s"
                  }}
                  onClick={()=>setFollowDate(todayStr())}>
                  📅 {fmtDate(todayStr())}
                  <span style={{fontSize:10,background:"#d1fae5",color:"#059669",borderRadius:4,padding:"1px 5px",fontWeight:700}}>
                    today
                  </span>
                </button>
                <input
                  type="date"
                  value={followDate!==todayStr() ? followDate : ""}
                  min={todayStr()}
                  onChange={e=>setFollowDate(e.target.value)}
                  style={{
                    padding:"7px 13px",
                    border: followDate&&followDate!==todayStr()?"1.5px solid #3b82f6":"1.5px solid #e2e8f0",
                    borderRadius:8,fontSize:12.5,
                    fontFamily:"'DM Mono',monospace",cursor:"pointer",fontWeight:600,
                    background: followDate&&followDate!==todayStr()?"#eff6ff":"#f8fafc",
                    color: followDate&&followDate!==todayStr()?"#1d4ed8":"#64748b",
                    outline:"none",transition:"all .14s"
                  }}/>
              </div>
              {followDate&&(
                <div style={{display:"flex",flexDirection:"column",gap:8,width:"100%"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",
                    background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8}}>
                    <span style={{fontSize:12,color:"#15803d",fontWeight:600}}>
                      ✅ Follow-up: {fmtDate(followDate)}
                    </span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11.5,color:"#64748b",fontWeight:500,whiteSpace:"nowrap"}}>🕐 Appointment time:</span>
                    <input
                      type="time"
                      value={followTime}
                      onChange={e=>setFollowTime(e.target.value)}
                      style={{padding:"6px 10px",border:"1.5px solid #e2e8f0",borderRadius:7,
                        fontFamily:"'DM Mono',monospace",fontSize:13,outline:"none",
                        background:"#f8fafc",color:"#1e293b",cursor:"pointer"}}/>
                  </div>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button
                  className="ok-btn"
                  disabled={!followDate}
                  style={{opacity:followDate?1:0.45,cursor:followDate?"pointer":"not-allowed"}}
                  onClick={()=>{
                    if(!followDate) return;
                    setFollowUps(prev=>[...prev,{id:Date.now(),date:followDate,time:followTime}]);
                    setFollowDate("");
                    setFollowTime("09:00");
                    setShowFollowAdd(false);
                  }}>
                  ✔ Confirm Date
                </button>
                <button className="cancel-btn" onClick={()=>{setFollowDate("");setFollowTime("09:00");setShowFollowAdd(false);}}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="followup-list">
            {followUps.map(f=>(
              <div key={f.id} className="followup-chip">
                📅 {fmtDate(f.date)}{f.time && <span style={{marginLeft:5,color:"#64748b",fontFamily:"'DM Mono',monospace",fontSize:11}}>🕐 {f.time}</span>}
                {!disabled&&(
                  <button className="chip-del"
                    onClick={()=>setFollowUps(prev=>prev.filter(x=>x.id!==f.id))}>✕</button>
                )}
              </div>
            ))}
            {followUps.length===0&&<span className="empty-msg">No follow-up date added yet</span>}
          </div>
        </div>

        {/* SAVE */}
        {!disabled&&(
          <div className="cons-save-row">
            <button className="save-all-btn" onClick={saveAll}>💾 Save Consultation</button>
          </div>
        )}

        {/* CONSULTATION HISTORY */}
        {records.length > 0 && (() => {
          const today = todayStr();
          const todayRecs = records.filter(r => {
            const d = (r.created_at||r.updated_at||"").split("T")[0];
            return d === today;
          });
          const pastRecs = records.filter(r => {
            const d = (r.created_at||r.updated_at||"").split("T")[0];
            return d !== today;
          });

          const tableHead = (
            <thead>
              <tr>
                <th style={{width:"10%",whiteSpace:"nowrap"}}>Date</th>
                <th style={{width:"22%"}}>
                  Diagnosis
                  <span style={{display:"inline-block",marginLeft:6,fontSize:9,color:"#94a3b8",
                    background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:4,
                    padding:"1px 5px",verticalAlign:"middle",fontWeight:400}}>🔒 read-only</span>
                </th>
                <th style={{width:"22%"}}>Advice &amp; Treatment Plan</th>
                <th style={{width:"22%"}}>Treatment Done</th>
                <th style={{width:"13%"}}>Follow-up</th>
                <th style={{width:"11%"}}>Action</th>
              </tr>
            </thead>
          );

          return (
            <div className="cons-table-wrap">
              {todayRecs.length > 0 && (
                <>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <div className="cons-table-title" style={{marginBottom:0}}>Today's Consultations</div>
                    <span style={{fontSize:11,color:"#22c55e",background:"#f0fdf4",border:"1px solid #bbf7d0",
                      borderRadius:20,padding:"2px 9px",fontWeight:600}}>
                      {fmtDate(today)}
                    </span>
                  </div>
                  <table className="cons-table" style={{marginBottom:16}}>
                    {tableHead}
                    <tbody>
                      {todayRecs.map(r=>(
                        <HistoryRow key={r.id} r={r}
                          onSave={updateRecord}
                          onDelete={deleteRecord}/>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {pastRecs.length > 0 && (
                <div style={{marginTop:4}}>
                  <button onClick={()=>setShowPast(p=>!p)} style={{
                    display:"flex",alignItems:"center",gap:8,
                    padding:"8px 14px",borderRadius:9,
                    border:"1.5px solid #e2e8f0",background:"#f8fafc",
                    fontSize:12.5,fontWeight:600,color:"#475569",
                    cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
                    transition:"all .15s",width:"100%",justifyContent:"space-between"}}>
                    <span>
                      🗂 Past Consultations
                      <span style={{marginLeft:8,fontSize:11,background:"#e2e8f0",
                        borderRadius:20,padding:"1px 8px",fontWeight:700,color:"#64748b"}}>
                        {pastRecs.length}
                      </span>
                    </span>
                    <span style={{fontSize:14,color:"#94a3b8",transition:"transform .2s",
                      transform:showPast?"rotate(180deg)":"rotate(0deg)"}}>▼</span>
                  </button>
                  {showPast && (
                    <div style={{marginTop:8,border:"1.5px solid #e2e8f0",borderRadius:10,overflow:"hidden"}}>
                      <div style={{padding:"7px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",
                        fontSize:11,color:"#94a3b8",fontWeight:600,letterSpacing:".05em",textTransform:"uppercase"}}>
                        🔒 Past records are read-only
                      </div>
                      <table className="cons-table">
                        {tableHead}
                        <tbody>
                          {pastRecs.map(r=>(
                            <HistoryRowReadOnly key={r.id} r={r}/>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  okBtnSt:      {padding:"8px 20px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  btnOff:       {background:"#93c5fd",cursor:"not-allowed"},
  cancelBtnSt:  {padding:"8px 16px",background:"#f1f5f9",color:"#64748b",border:"none",borderRadius:8,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  section:      {marginBottom:0},
  sectionHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8},
  sectionTitle: {fontSize:13,fontWeight:600,color:"#1e293b"},
  addBtn:       {padding:"5px 11px",background:"#eff6ff",color:"#3b82f6",border:"1.5px solid #bfdbfe",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  chartBtn:     {padding:"5px 11px",background:"#3b82f6",color:"#fff",border:"1.5px solid #3b82f6",borderRadius:7,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  inputBox:     {background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:12,marginBottom:10},
  inputArea:    {width:"100%",minHeight:68,padding:"9px 11px",border:"1.5px solid #e2e8f0",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,resize:"vertical",outline:"none",boxSizing:"border-box",marginBottom:8,background:"#fff"},
  entryList:    {display:"flex",flexDirection:"column",gap:8,marginTop:6},
  entryItem:    {background:"#fff",border:"1.5px solid #e9eef4",borderRadius:10,padding:"10px 12px",position:"relative",animation:"fadeIn 0.2s ease"},
  entryAuto:    {background:"#f0fdf4",border:"1.5px solid #bbf7d0"},
  entryMeta:    {display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"},
  entryDate:    {fontSize:11,color:"#94a3b8",fontFamily:"'DM Mono',monospace"},
  entryIRT:     {display:"inline-flex",alignItems:"baseline",gap:4,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,padding:"1px 8px",maxWidth:"100%",minWidth:0},
  irtTeeth:     {fontSize:12,fontWeight:600,color:"#1d4ed8",fontFamily:"'DM Mono',monospace",minWidth:0,overflowWrap:"anywhere"},
  irtLabel:     {fontSize:10,fontWeight:700,color:"#7c3aed",marginRight:2,flexShrink:0,whiteSpace:"nowrap",overflowWrap:"normal"},
  autoBadge:    {fontSize:10,background:"#dcfce7",color:"#16a34a",borderRadius:5,padding:"1px 7px",fontWeight:600},
  entryText:    {fontSize:13,color:"#1e293b",lineHeight:1.5,paddingRight:58,overflowWrap:"anywhere"},
  entryBtns:    {position:"absolute",top:8,right:8,display:"flex",gap:4},
  iconBtn:      {width:26,height:26,border:"1.5px solid #e2e8f0",borderRadius:6,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12},
  editArea:     {width:"100%",minHeight:55,padding:"7px 9px",border:"1.5px solid #3b82f6",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,resize:"vertical",outline:"none",boxSizing:"border-box",boxShadow:"0 0 0 3px rgba(59,130,246,0.1)"},
  histEdit:     {width:"100%",minHeight:52,padding:"6px 8px",border:"1.5px solid #3b82f6",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:12,resize:"vertical",outline:"none",boxSizing:"border-box",background:"#fffbeb"},
  saveSm:       {padding:"4px 12px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  cancelSm:     {padding:"4px 12px",background:"#f1f5f9",color:"#64748b",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  emptyMsg:     {fontSize:12,color:"#94a3b8",fontStyle:"italic",padding:"6px 0"},
  autoNote:     {fontSize:11,color:"#16a34a",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:7,padding:"5px 10px",marginBottom:10},

  // Diagnosis "+ Add" chooser (Dental Chart vs Other Finding)
  addChooserBox:{background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,padding:12,marginBottom:10},
  addChooserLabel:{fontSize:12,color:"#475569",fontWeight:600,marginBottom:8},
  chooserBtn:   {padding:"8px 14px",background:"#fff",color:"#334155",border:"1.5px solid #cbd5e1",borderRadius:8,fontSize:12.5,fontWeight:500,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
@keyframes fadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }

.cons-root { font-family:'DM Sans',sans-serif; background:#f8fafc; border-radius:16px; padding:24px; border:1px solid #e2e8f0; box-shadow:0 1px 4px rgba(0,0,0,0.06); }
.cons-header { display:flex; align-items:center; gap:12px; margin-bottom:22px; padding-bottom:16px; border-bottom:1px solid #e9eef4; }
.cons-header-icon { width:38px; height:38px; background:linear-gradient(135deg,#dbeafe,#bfdbfe); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px; }
.cons-header-title { font-size:15px; font-weight:600; color:#1e293b; }
.cons-header-sub   { font-size:12px; color:#94a3b8; }
.cons-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:16px; }
@media(max-width:800px){ .cons-grid{ grid-template-columns:minmax(0,1fr); } }
.cons-col { background:#fff; border:1.5px solid #e9eef4; border-radius:12px; padding:14px; min-width:0; }
.cons-followup { background:#fff; border:1.5px solid #e9eef4; border-radius:12px; padding:14px; margin-bottom:16px; }
.cons-followup-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.cons-section-title { font-size:13px; font-weight:600; color:#1e293b; }
.followup-input { display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap; }
.followup-date-input { padding:7px 10px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:13px; font-family:'DM Sans',sans-serif; outline:none; }
.followup-date-input:focus { border-color:#3b82f6; }
.ok-btn { padding:7px 16px; background:#3b82f6; color:#fff; border:none; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; }
.ok-btn:disabled { background:#93c5fd; cursor:not-allowed; }
.cancel-btn { padding:7px 14px; background:#f1f5f9; color:#64748b; border:none; border-radius:7px; font-size:12px; cursor:pointer; font-family:'DM Sans',sans-serif; }
.add-btn { padding:5px 12px; background:#eff6ff; color:#3b82f6; border:1.5px solid #bfdbfe; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; }
.followup-list { display:flex; flex-wrap:wrap; gap:8px; }
.followup-chip { display:flex; align-items:center; gap:6px; background:#eff6ff; border:1.5px solid #bfdbfe; border-radius:8px; padding:5px 10px; font-size:12px; color:#1d4ed8; font-family:'DM Mono',monospace; animation:fadeIn 0.2s ease; }
.chip-del { border:none; background:none; color:#93c5fd; cursor:pointer; font-size:11px; padding:0; }
.chip-del:hover { color:#ef4444; }
.empty-msg { font-size:12px; color:#cbd5e1; font-style:italic; }
.cons-save-row { display:flex; justify-content:flex-end; margin-bottom:18px; }
.save-all-btn { padding:10px 26px; background:#3b82f6; color:#fff; border:none; border-radius:9px; font-size:14px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; box-shadow:0 2px 8px rgba(59,130,246,0.25); transition:background 0.15s; }
.save-all-btn:hover { background:#2563eb; }
.cons-table-wrap { margin-top:4px; }
.cons-table-title { font-size:11.5px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px; }
.cons-table { width:100%; border-collapse:collapse; font-size:13px; background:#fff; border-radius:10px; overflow:hidden; border:1px solid #e9eef4; }
.cons-table th { background:#f8fafc; padding:10px 12px; text-align:left; font-size:12px; color:#64748b; border-bottom:1px solid #e9eef4; }
.cons-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; color:#1e293b; vertical-align:top; }
.cons-table tr:last-child td { border-bottom:none; }
.tbl-btn { border:1.5px solid #e2e8f0; background:#fff; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:12px; margin-right:4px; transition:all 0.15s; }
.tbl-btn.edit:hover { border-color:#3b82f6; background:#eff6ff; }
.tbl-btn.del:hover  { border-color:#ef4444; background:#fef2f2; }

/* ── Tooth chart (shared by every tooth picker and the small section charts) ── */
.ctp-chart { background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:10px 12px; margin-bottom:10px; }
.ctp-qrow { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin:2px 0; }
.ctp-qside { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ctp-side { font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#64748b; }
.ctp-foot { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:#92400e; text-align:center; }
.ctp-qname { font-size:10px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; }
.ctp-qbtn { font-family:inherit; font-size:11px; font-weight:600; color:#2563eb; background:#fff; border:1px solid #bfdbfe; border-radius:999px; padding:2px 10px; cursor:pointer; }
.ctp-qbtn:hover { background:#eff6ff; border-color:#60a5fa; }
.ctp-arch { display:grid; grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr); align-items:stretch; }
.ctp-quad { display:grid; gap:2px; min-width:0; }
.ctp-quad.right { justify-content:end; }
.ctp-quad.left  { justify-content:start; }
.ctp-mid { width:2px; background:#cbd5e1; justify-self:center; border-radius:2px; }
.ctp-occl { height:2px; background:#cbd5e1; margin:4px 0; border-radius:2px; }
.ctp-tooth { position:relative; display:flex; flex-direction:column; align-items:center; gap:2px; min-width:0; padding:3px 1px; margin:0; border:1.5px solid transparent; border-radius:9px; background:transparent; font-family:inherit; color:inherit; }
.ctp-tooth.lower { flex-direction:column-reverse; }
button.ctp-tooth { cursor:pointer; transition:background .12s,border-color .12s,box-shadow .12s; }
button.ctp-tooth:hover { background:#eff6ff; border-color:#bfdbfe; }
button.ctp-tooth:focus-visible, .ctp-qbtn:focus-visible, .copt-btn:focus-visible, .cbtn:focus-visible, .ctab:focus-visible { outline:2px solid #1d4ed8; outline-offset:2px; }
.ctp-tooth.sel, button.ctp-tooth.sel:hover { background:#dbeafe; border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.22); }
.ctp-num { font-family:'DM Mono',monospace; font-size:11px; font-weight:600; line-height:1; color:#475569; padding:2px 3px; border-radius:5px; }
.ctp-tooth.done .ctp-num { background:var(--c); color:#fff; }
.ctp-tooth.sel .ctp-num { color:#1d4ed8; }
.ctp-tooth.done.sel .ctp-num { color:#fff; }
.ctp-glyph { display:block; width:100%; max-width:30px; height:auto; }
.ctp-hintdot { position:absolute; bottom:0; right:0; width:9px; height:9px; border-radius:50%; background:#f59e0b; border:1.5px solid #fff; }
.ctp-tooth.lower .ctp-hintdot { bottom:auto; top:0; }
.ctp-hintdot.static { position:static; display:inline-block; flex-shrink:0; vertical-align:middle; }
.ctp-count { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); min-width:13px; height:13px; padding:0 2px; border-radius:7px; background:#0f172a; color:#fff; font-size:8.5px; font-weight:700; line-height:13px; text-align:center; font-family:'DM Mono',monospace; }
.ctp-chart.mini { padding:6px 6px; border-radius:9px; margin-bottom:0; }
.ctp-chart.mini .ctp-arch { grid-template-columns:minmax(0,1fr) 6px minmax(0,1fr); }
.ctp-chart.mini .ctp-quad { gap:0; }
.ctp-chart.mini .ctp-tooth { padding:1px 0; gap:1px; border-width:0; border-radius:4px; }
.ctp-chart.mini .ctp-num { font-size:8px; padding:1px 1px; border-radius:3px; letter-spacing:-.02em; }
.ctp-chart.mini .ctp-glyph { max-width:18px; }
.ctp-chart.mini .ctp-qrow { display:none; }
.ctp-chart.mini .ctp-occl { margin:2px 0; height:1.5px; }
.ctp-chart.mini .ctp-mid { width:1.5px; }

/* Small chart inside a section card */
.csec-chart { background:#fff; border:1.5px solid #e9eef4; border-radius:10px; padding:10px; margin-bottom:10px; }
.csec-chart-title { font-size:11.5px; font-weight:700; color:#1e293b; margin-bottom:6px; }
.csec-chart-sub { font-size:10px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px; }
.csec-legend { display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:8px; }
.csec-legend-chip { display:inline-flex; align-items:center; gap:5px; font-size:10.5px; color:#475569; font-weight:500; }
.csec-legend-dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex-shrink:0; }

/* ── Window (modal) ── */
.cmod-overlay { position:fixed; inset:0; z-index:5000; display:flex; align-items:center; justify-content:center; padding:12px; background:rgba(15,23,42,.55); backdrop-filter:blur(4px); font-family:'DM Sans',sans-serif; }
.cmod, .cmod * { box-sizing:border-box; }
.cmod { display:flex; flex-direction:column; width:100%; max-height:calc(100vh - 24px); background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.25); overflow:hidden; color:#1e293b; }
.cmod-md { max-width:640px; }
.cmod-lg { max-width:880px; }
.cmod-xl { max-width:1180px; }
.ctm-layout { display:grid; grid-template-columns:minmax(0,1.85fr) minmax(300px,1fr); gap:14px; align-items:start; }
.ctm-left { min-width:0; }
@media (max-width:1040px) { .ctm-layout { grid-template-columns:minmax(0,1fr); } }
.cmod-head { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid #e9eef4; }
.cmod-title { font-size:15.5px; font-weight:600; color:#1e293b; }
.cmod-close { flex-shrink:0; width:32px; height:32px; border:none; border-radius:8px; background:#f1f5f9; color:#64748b; font-size:13px; cursor:pointer; }
.cmod-close:hover { background:#e2e8f0; color:#0f172a; }
.cmod-body { padding:14px 18px; overflow-y:auto; flex:1 1 auto; min-height:0; }
.cmod-foot { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 18px; border-top:1px solid #e9eef4; background:#f8fafc; }
.cmod-actions { display:flex; gap:8px; margin-left:auto; }
.cmod-textarea { display:block; width:100%; min-height:68px; padding:10px 12px; border:1.5px solid #e2e8f0; border-radius:10px; font-family:inherit; font-size:13px; color:#1e293b; resize:vertical; outline:none; background:#fff; }
.cmod-textarea.small { min-height:40px; }
.cmod-textarea:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.12); }

.cbtn { font-family:inherit; font-size:13px; font-weight:600; border-radius:8px; padding:9px 18px; border:1.5px solid transparent; cursor:pointer; transition:background .12s; }
.cbtn:disabled { cursor:not-allowed; }
.cbtn.primary { background:#2563eb; color:#fff; }
.cbtn.primary:hover:not(:disabled) { background:#1d4ed8; }
.cbtn.primary:disabled { background:#93c5fd; }
.cbtn.apply { background:#16a34a; color:#fff; }
.cbtn.apply:hover:not(:disabled) { background:#15803d; }
.cbtn.apply:disabled { background:#e2e8f0; color:#94a3b8; }
.cbtn.ghost { background:#f1f5f9; color:#475569; }
.cbtn.ghost:hover:not(:disabled) { background:#e2e8f0; }
.cbtn.danger-ghost { background:#fff; color:#b91c1c; border-color:#fecaca; padding:8px 12px; font-size:12.5px; }
.cbtn.danger-ghost:hover { background:#fef2f2; }

.ctabs { display:flex; gap:8px; margin-bottom:10px; }
.ctab { flex:1; display:flex; align-items:center; justify-content:center; gap:7px; padding:8px 6px; border-radius:9px; border:1.5px solid #e2e8f0; background:#f8fafc; font-family:inherit; font-size:13px; font-weight:600; color:#64748b; cursor:pointer; }
.ctab:hover { border-color:#bfdbfe; }
.ctab.active { background:#2563eb; border-color:#2563eb; color:#fff; }
.ctab-count { min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:#16a34a; color:#fff; font-size:11px; line-height:18px; text-align:center; font-family:'DM Mono',monospace; }

.csteps { display:flex; flex-wrap:wrap; gap:6px 16px; margin-bottom:10px; font-size:12px; color:#475569; }
.csteps b { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; margin-right:5px; border-radius:50%; background:#dbeafe; color:#1d4ed8; font-size:11px; }

.chint-list { margin:0 0 10px; padding:7px 10px; border-radius:8px; background:#fffbeb; border:1px solid #fde68a; font-size:12px; color:#78350f; display:flex; flex-direction:column; gap:4px; }

.csel { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-height:38px; margin-bottom:10px; padding:7px 10px; border-radius:9px; border:1px dashed #cbd5e1; background:#fff; }
.csel.has { border:1px solid #bfdbfe; background:#eff6ff; }
.csel-empty { font-size:12px; color:#64748b; }
.csel-lbl { font-size:12px; font-weight:700; color:#1d4ed8; }
.csel-teeth { display:flex; flex-wrap:wrap; gap:4px; }
.csel-clear { margin-left:auto; font-family:inherit; font-size:11.5px; font-weight:600; color:#475569; background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:3px 9px; cursor:pointer; }
.csel-clear:hover { background:#f1f5f9; }
.ctag { display:inline-flex; align-items:center; gap:3px; background:#2563eb; color:#fff; border-radius:5px; padding:2px 7px; font-size:11.5px; font-weight:600; font-family:'DM Mono',monospace; }
.ctag.light { background:#fde68a; color:#78350f; }
.ctag-x { border:none; background:rgba(255,255,255,.22); color:#fff; border-radius:4px; width:16px; height:16px; padding:0; font-size:9px; line-height:16px; cursor:pointer; }
.ctag-x:hover { background:rgba(0,0,0,.3); }

.copt { border:1.5px solid #e2e8f0; border-radius:12px; padding:12px; background:#fff; min-width:0; }
.copt.active { border-color:#bfdbfe; box-shadow:0 2px 10px rgba(37,99,235,.07); }
.copt-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-height:26px; margin-bottom:10px; }
.copt-title { font-size:13px; font-weight:600; color:#1e293b; }
.copt-title.muted { font-weight:500; color:#64748b; font-size:12.5px; }
.copt-search { display:block; width:100%; padding:7px 10px; margin-bottom:8px; border:1.5px solid #e2e8f0; border-radius:8px; font-family:inherit; font-size:12.5px; color:#1e293b; outline:none; }
.copt-search:focus { border-color:#3b82f6; }
.copt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:6px; }
.copt-grid.scroll { max-height:284px; overflow-y:auto; padding:2px; }
.copt-btn { display:flex; align-items:center; gap:7px; min-width:0; padding:7px 10px; border-radius:8px; border:1.5px solid #e2e8f0; background:#f8fafc; font-family:inherit; font-size:12.5px; font-weight:500; color:#334155; text-align:left; cursor:pointer; }
.copt-btn:hover { border-color:var(--c); background:#fff; }
.copt-btn.on { background:var(--c); border-color:var(--c); color:#fff; font-weight:600; }
.copt-dot { flex-shrink:0; width:10px; height:10px; border-radius:50%; background:var(--c); }
.copt-btn.on .copt-dot { background:#fff; }
.copt-emoji { flex-shrink:0; }
.copt-lbl { min-width:0; overflow-wrap:anywhere; }
.copt-none { grid-column:1/-1; font-size:12.5px; color:#64748b; padding:8px 2px; }
.copt-note { margin-top:10px; }
.copt-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap; margin-top:10px; }
.copt-why { font-size:12px; color:#64748b; margin-right:auto; }

.csum { border:1.5px solid #bbf7d0; background:#f0fdf4; border-radius:12px; padding:10px 12px; }
.csum-title { font-size:11.5px; font-weight:700; color:#15803d; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
.csum-row { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding:6px 10px; margin-top:5px; background:#fff; border:1px solid #e2e8f0; border-left:4px solid var(--c); border-radius:8px; }
.csum-text { font-size:13px; font-weight:500; color:#1e293b; overflow-wrap:anywhere; }
.csum-teeth { display:flex; flex-wrap:wrap; gap:4px; }

.cerr { margin-top:10px; padding:8px 12px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; font-size:12.5px; font-weight:500; }

.cdate { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-family:'DM Sans',sans-serif; }
.cdate-lbl { font-size:12px; color:#64748b; font-weight:500; }
.cdate-chip { position:relative; display:inline-flex; align-items:center; gap:6px; background:#fff; border:1.5px solid #e2e8f0; border-radius:8px; padding:6px 10px; font-size:12.5px; color:#334155; font-family:'DM Mono',monospace; cursor:pointer; }
.cdate-chip:hover { border-color:#3b82f6; }
.cdate-today { font-family:'DM Sans',sans-serif; font-size:10px; font-weight:700; color:#15803d; background:#dcfce7; border-radius:4px; padding:1px 5px; }
.cdate-change { font-family:'DM Sans',sans-serif; font-size:10.5px; color:#2563eb; text-decoration:underline; }
.cdate-input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; font-size:0; }
.cdate-input::-webkit-calendar-picker-indicator { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
.cdate-reset { font-family:'DM Sans',sans-serif; font-size:11.5px; font-weight:600; color:#2563eb; background:none; border:none; padding:0; cursor:pointer; text-decoration:underline; }

@media (max-width:560px) {
  .cmod-head, .cmod-body, .cmod-foot { padding-left:12px; padding-right:12px; }
  .ctp-chart { padding:8px 6px; }
  .ctp-num { font-size:9.5px; padding:2px 1px; }
  .ctp-tooth { padding:2px 0; }
  .ctp-quad { gap:0; }
  .ctp-arch { grid-template-columns:minmax(0,1fr) 8px minmax(0,1fr); }
  .ctp-side-long { display:none; }
  .ctp-qrow { flex-wrap:wrap; }
  .ctp-qside { flex-wrap:nowrap; gap:5px; }
  .ctp-qbtn { padding:2px 7px; font-size:10.5px; }
  .ctp-foot { order:3; flex-basis:100%; justify-content:center; }
  .ctp-hintdot { width:7px; height:7px; border-width:1px; }
  .copt-grid { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); }
  .cmod-actions { width:100%; }
  .cmod-actions .cbtn { flex:1; }
}
`;