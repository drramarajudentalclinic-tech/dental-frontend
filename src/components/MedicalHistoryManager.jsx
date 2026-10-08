import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import api from "../api/api";

/* ══════════════════════════════════════════════════════════════════════
   MEDICAL HISTORY MANAGER
   ──────────────────────────────────────────────────────────────────────
   ONE component used by BOTH Reception and Doctor screens for all five
   medical-history sections:

       Medical Conditions · Allergy Records · Current Medications ·
       Personal Habits · Women's Health

   Every section works the same way:

     [ + Add … ]      opens an empty "Add" form   →  POST   (always a NEW record)
     [ Edit ]         opens that record's form    →  PUT    /<record id>
     [ Update … ]     saves that one record only
     [ Delete ]       asks for confirmation       →  DELETE /<record id>

   Add and Update are never the same button. The form remembers which mode
   it is in and which record id it belongs to; nothing is ever matched by
   name, date or patient alone.

   Both roles read and write the same records through
       /api/patients/<patient_id>/medical-history
   (see backend/medical_history.py). The list refreshes by itself every few
   seconds and whenever the window regains focus, so a change made at
   Reception appears on the Doctor's screen and vice-versa.

   Props
     patientId     number | null. null = the patient is not registered yet
                   (new-registration form): records are kept on the page
                   and handed to the parent through ref.getDrafts().
     gender        patient's gender. Women's Health is shown for "Female".
     onChange      (history) => void. Called after every load / change.
     pollSeconds   refresh interval, default 15. 0 switches it off.

   Ref
     getDrafts()     → payload for POST /patients { medical_history: … }
     hasOpenForm()   → true while an Add/Edit form is open
     reload()        → fetch again now
══════════════════════════════════════════════════════════════════════ */

/* ── Option lists (keep in step with backend/medical_history.py) ── */
export const CONDITION_OPTIONS = [
  ["aids", "AIDS"], ["asthma", "Asthma"], ["arthritis_rheumatism", "Arthritis / Rheumatism"],
  ["blood_disease", "Blood Disease"], ["bp_high", "High Blood Pressure"], ["bp_low", "Low Blood Pressure"],
  ["corticosteroid_treatment", "Corticosteroid Treatment"], ["cancer", "Cancer"], ["diabetes", "Diabetes"],
  ["epilepsy", "Epilepsy"], ["heart_problems", "Heart Problems"], ["hepatitis", "Hepatitis"],
  ["herpes", "Herpes"], ["jaundice", "Jaundice"], ["liver_disease", "Liver Disease"],
  ["kidney_disease", "Kidney Disease"], ["psychiatric_treatment", "Psychiatric Treatment"],
  ["radiation_treatment", "Radiation Treatment"], ["respiratory_disease", "Respiratory Disease"],
  ["rheumatic_fever", "Rheumatic Fever"], ["tb", "Tuberculosis"], ["thyroid_problems", "Thyroid Problems"],
  ["ulcer", "Ulcer"], ["venereal_disease", "Venereal Disease"],
];
export const HABIT_OPTIONS = [
  ["smoking", "Smoking"], ["alcohol", "Alcohol"], ["tobacco", "Tobacco / Chewing Tobacco"],
  ["pan_chewing", "Pan / Betel Nut"], ["spicy_foods", "Spicy Foods"],
];
const WOMEN_TYPES = ["Pregnancy", "Nursing", "Menstrual history", "Menopause", "Gynecological", "Other"];
const ALLERGY_TYPES = ["Drug", "Food", "Environmental", "Anesthesia", "Latex", "Iodine", "Insect", "Skin", "Other"];
const ALLERGY_REACTIONS = ["Rash / Hives", "Swelling", "Itching", "Sneezing", "Breathing Difficulty", "Vomiting", "Anaphylaxis"];
const SEVERITIES = ["Mild", "Moderate", "Severe", "Life-threatening"];
const MED_FREQUENCIES = ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "Weekly", "Monthly", "Custom"];
const MED_DURATIONS = ["3 Days", "5 Days", "7 Days", "10 Days", "14 Days", "21 Days", "1 Month", "2 Months", "3 Months", "6 Months", "Ongoing", "Custom"];
const MED_ROUTES = ["Oral", "Topical", "Injection", "Inhalation", "Sublingual", "Eye / Ear drops", "Other"];
const MED_PURPOSES = ["Diabetes", "Hypertension", "Cardiac", "Thyroid", "Asthma", "Pain Relief", "Antibiotic", "Vitamin Supplement", "Gastric Protection", "Blood Thinner"];

const labelOf = (options, key) => (options.find(([k]) => k === key) || [])[1];

/* ── Dates: always the clinic's timezone, never the computer's ── */
const CLINIC_TZ = "Asia/Kolkata";
export const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ }).format(new Date()); // YYYY-MM-DD
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : String(iso);
};

const text = (v) => (v == null ? "" : String(v));
const dash = (v) => (text(v).trim() ? v : <span className="mhm-muted">—</span>);
const same = (a, b) => text(a).trim().toLowerCase() === text(b).trim().toLowerCase();

/* ══════════════════════════════════════════════════════════════
   SECTION DEFINITIONS
   Each section only describes its fields and table columns; the
   Add / Edit / Update / Delete behaviour is shared by all five.
══════════════════════════════════════════════════════════════ */
const dateField = { name: "recorded_date", label: "Date", type: "date", fallback: todayISO };
const notesField = { name: "notes", label: "Notes", type: "text", wide: true, placeholder: "Additional notes…" };

const StatusPill = ({ value }) => {
  const tone = { Active: "on", Current: "on", Controlled: "mid", Occasional: "mid", Resolved: "off", Former: "off", Past: "off", Stopped: "off" }[value] || "on";
  return <span className={`mhm-pill mhm-pill-${tone}`}>{value || "—"}</span>;
};
const SeverityPill = ({ value }) => {
  if (!value) return <span className="mhm-muted">—</span>;
  const tone = { Mild: "on", Moderate: "mid", Severe: "bad", "Life-threatening": "crit" }[value] || "mid";
  return <span className={`mhm-pill mhm-pill-${tone}`}>{value}</span>;
};
const Main = ({ children, sub }) => (
  <>
    <span className="mhm-main">{children}</span>
    {sub ? <span className="mhm-sub">{sub}</span> : null}
  </>
);
const joinParts = (...parts) => parts.filter((p) => text(p).trim()).join(" · ");

export const SECTIONS = [
  {
    key: "conditions", slug: "conditions", title: "Medical Conditions", noun: "Condition", icon: "📋",
    accent: "#dc2626", tint: "#fff5f5", noneKnown: "No known medical conditions",
    emptyText: "No medical conditions recorded.",
    fields: [
      { name: "condition_key", label: "Condition", type: "select", required: true, placeholder: "Select condition…",
        options: [...CONDITION_OPTIONS, ["other", "Other (type the name)"]] },
      { name: "condition_name", label: "Condition name", type: "text", required: true, placeholder: "e.g. Hypothyroidism",
        showIf: (v) => v.condition_key === "other" },
      { name: "details", label: "Details", type: "text", placeholder: "e.g. Type 2, on tablets" },
      { name: "status", label: "Status", type: "select", options: ["Current", "Controlled", "Resolved"], fallback: "Current" },
      { name: "since", label: "Since", type: "text", placeholder: "e.g. 2019 / 5 years" },
      dateField, notesField,
    ],
    columns: [
      ["Condition", (r) => <Main sub={r.notes}>{r.condition_name}</Main>],
      ["Details", (r) => dash(r.details)],
      ["Since", (r) => dash(r.since)],
      ["Status", (r) => <StatusPill value={r.status} />],
    ],
    describe: (r) => [["Condition", r.condition_name], ["Details", r.details], ["Status", r.status]],
    duplicateOf: (v, r) => v.condition_key && v.condition_key !== "other" && r.condition_key === v.condition_key,
    nameOf: (r) => r.condition_name,
    finish: (v) => (v.condition_key !== "other" ? { ...v, condition_name: labelOf(CONDITION_OPTIONS, v.condition_key) } : v),
  },
  {
    key: "allergies", slug: "allergies", title: "Allergy Records", noun: "Allergy", icon: "⚠️",
    accent: "#d97706", tint: "#fffbeb", noneKnown: "No known allergies",
    emptyText: "No allergies recorded.",
    fields: [
      { name: "allergen", label: "Allergy / Substance", type: "text", required: true, placeholder: "e.g. Penicillin" },
      { name: "type", label: "Type", type: "select", options: ALLERGY_TYPES, placeholder: "Select type…" },
      { name: "reaction", label: "Reaction", type: "suggest", options: ALLERGY_REACTIONS, placeholder: "e.g. Skin rash" },
      { name: "severity", label: "Severity", type: "select", options: SEVERITIES, placeholder: "Select severity…" },
      { name: "status", label: "Status", type: "select", options: ["Active", "Resolved"], fallback: "Active" },
      dateField, notesField,
    ],
    columns: [
      ["Allergy", (r) => <Main sub={r.notes}>{r.allergen}</Main>],
      ["Type", (r) => dash(r.type)],
      ["Reaction", (r) => dash(r.reaction)],
      ["Severity", (r) => <SeverityPill value={r.severity} />],
      ["Status", (r) => <StatusPill value={r.status || "Active"} />],
    ],
    describe: (r) => [["Allergy", r.allergen], ["Reaction", r.reaction], ["Severity", r.severity]],
    duplicateOf: (v, r) => text(v.allergen).trim() && same(v.allergen, r.allergen),
    nameOf: (r) => r.allergen,
  },
  {
    key: "medications", slug: "medications", title: "Current Medications", noun: "Medication", icon: "💊",
    accent: "#2563eb", tint: "#eff6ff", emptyText: "No current medications recorded.",
    fields: [
      { name: "medicine_name", label: "Medication name", type: "text", required: true, placeholder: "e.g. Metformin" },
      { name: "dosage", label: "Dosage", type: "text", placeholder: "e.g. 500 mg" },
      { name: "frequency", label: "Frequency", type: "select", options: MED_FREQUENCIES, placeholder: "Select…" },
      { name: "route", label: "Route", type: "select", options: MED_ROUTES, placeholder: "Select…" },
      { name: "purpose", label: "Reason / Indication", type: "suggest", options: MED_PURPOSES, placeholder: "e.g. Diabetes" },
      { name: "duration", label: "Duration", type: "select", options: MED_DURATIONS, placeholder: "Select…" },
      { name: "start_date", label: "Start date", type: "date" },
      { name: "end_date", label: "End date (if any)", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Active", "Stopped"], fallback: "Active" },
      { name: "prescribed_by", label: "Prescribed by", type: "text", placeholder: "Doctor name" },
      dateField, notesField,
    ],
    columns: [
      ["Medication", (r) => (
        <Main sub={joinParts(
          r.duration, r.start_date && `from ${fmtDate(r.start_date)}`, r.end_date && `to ${fmtDate(r.end_date)}`,
          r.prescribed_by && `by ${r.prescribed_by}`, r.notes,
        )}>{r.medicine_name}</Main>
      )],
      ["Dosage", (r) => dash(r.dosage)],
      ["Frequency", (r) => dash(r.frequency)],
      ["Route", (r) => dash(r.route)],
      ["Reason", (r) => dash(r.purpose)],
      ["Status", (r) => <StatusPill value={r.active === false ? "Stopped" : "Active"} />],
    ],
    describe: (r) => [["Medication", r.medicine_name], ["Dosage", joinParts(r.dosage, r.frequency)], ["Reason", r.purpose]],
    duplicateOf: (v, r) => text(v.medicine_name).trim() && same(v.medicine_name, r.medicine_name),
    nameOf: (r) => r.medicine_name,
    toForm: (r) => ({ status: r.active === false ? "Stopped" : "Active" }),
    finish: (v) => {
      const { status, ...rest } = v;
      return { ...rest, active: status !== "Stopped" };
    },
    validate: (v) => (v.start_date && v.end_date && v.end_date < v.start_date ? "End date cannot be before the start date." : ""),
  },
  {
    key: "habits", slug: "habits", title: "Personal Habits", noun: "Habit", icon: "🧬",
    accent: "#0d6e4a", tint: "#f0fdf4", noneKnown: "No habits",
    emptyText: "No habits recorded.",
    fields: [
      { name: "habit_key", label: "Habit", type: "select", required: true, placeholder: "Select habit…",
        options: [...HABIT_OPTIONS, ["other", "Other (type the name)"]] },
      { name: "habit_name", label: "Habit name", type: "text", required: true, placeholder: "e.g. Gutka",
        showIf: (v) => v.habit_key === "other" },
      { name: "details", label: "Details", type: "text", placeholder: "e.g. 5 cigarettes/day" },
      { name: "frequency", label: "Frequency", type: "text", placeholder: "e.g. Daily" },
      { name: "duration", label: "Duration", type: "text", placeholder: "e.g. 10 years" },
      { name: "status", label: "Status", type: "select", options: ["Current", "Occasional", "Former"], fallback: "Current" },
      dateField, notesField,
    ],
    columns: [
      ["Habit", (r) => <Main sub={r.notes}>{r.habit_name}</Main>],
      ["Details", (r) => dash(r.details)],
      ["Frequency", (r) => dash(r.frequency)],
      ["Duration", (r) => dash(r.duration)],
      ["Status", (r) => <StatusPill value={r.status} />],
    ],
    describe: (r) => [["Habit", r.habit_name], ["Details", r.details], ["Status", r.status]],
    duplicateOf: (v, r) => v.habit_key && v.habit_key !== "other" && r.habit_key === v.habit_key,
    nameOf: (r) => r.habit_name,
    finish: (v) => (v.habit_key !== "other" ? { ...v, habit_name: labelOf(HABIT_OPTIONS, v.habit_key) } : v),
  },
  {
    key: "womens_health", slug: "womens-health", title: "Women's Health", noun: "Record", icon: "🌸",
    accent: "#be185d", tint: "#fdf2f8", femaleOnly: true, emptyText: "No women's health records.",
    fields: [
      { name: "record_type", label: "Type", type: "select", required: true, options: WOMEN_TYPES, placeholder: "Select type…" },
      { name: "details", label: "Details", type: "text", placeholder: "e.g. 2nd trimester / regular cycles" },
      { name: "lmp_date", label: "LMP date", type: "date", showIf: (v) => ["Pregnancy", "Menstrual history", "Other"].includes(v.record_type) },
      { name: "due_date", label: "Due date", type: "date", showIf: (v) => v.record_type === "Pregnancy" },
      { name: "status", label: "Status", type: "select", options: ["Current", "Past"], fallback: "Current" },
      dateField, notesField,
    ],
    columns: [
      ["Type", (r) => <Main sub={r.notes}>{r.record_type}</Main>],
      ["Details", (r) => dash(r.details)],
      ["LMP", (r) => (r.lmp_date ? fmtDate(r.lmp_date) : dash(""))],
      ["Due date", (r) => (r.due_date ? fmtDate(r.due_date) : dash(""))],
      ["Status", (r) => <StatusPill value={r.status} />],
    ],
    describe: (r) => [["Type", r.record_type], ["Details", r.details], ["Due date", r.due_date && fmtDate(r.due_date)]],
    duplicateOf: () => false,
    nameOf: (r) => r.record_type,
  },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);
const NONE_KNOWN_KEYS = SECTIONS.filter((s) => s.noneKnown).map((s) => s.key);
const emptyHistory = () => ({
  conditions: [], allergies: [], medications: [], habits: [], womens_health: [],
  none_known: { conditions: false, allergies: false, habits: false },
});

/* Sections that still need either one record or the "none known" tick.
   Reception uses this before saving a registration. */
export const missingAcknowledgements = (history) =>
  SECTIONS
    .filter((s) => s.noneKnown && !(history?.[s.key] || []).length && !history?.none_known?.[s.key])
    .map((s) => s.title);

/* ── Form values ── */
const blankValues = (section) => {
  const values = {};
  section.fields.forEach((f) => {
    values[f.name] = typeof f.fallback === "function" ? f.fallback() : f.fallback || "";
  });
  return values;
};
const valuesFromRecord = (section, record) => {
  const values = {};
  section.fields.forEach((f) => { values[f.name] = text(record[f.name]); });
  return { ...values, ...(section.toForm ? section.toForm(record) : {}) };
};
const visibleFields = (section, values) => section.fields.filter((f) => !f.showIf || f.showIf(values));

/* What is sent to the server: visible fields trimmed, hidden fields cleared. */
const buildPayload = (section, values) => {
  let out = {};
  section.fields.forEach((f) => {
    const shown = !f.showIf || f.showIf(values);
    const v = shown ? text(values[f.name]).trim() : "";
    out[f.name] = v === "" ? null : v;
  });
  if (section.finish) out = section.finish(out);
  return out;
};
const validateValues = (section, values) => {
  for (const f of visibleFields(section, values)) {
    if (f.required && !text(values[f.name]).trim()) return `${f.label} is required.`;
  }
  return section.validate ? section.validate(values) : "";
};

const errorText = (err, fallback) => {
  const data = err?.response?.data;
  if (data?.error) return data.detail && data.error === "Forbidden" ? data.detail : data.error;
  return fallback || err?.message || "Something went wrong.";
};

/* ══════════════════════════════════════════════════════════════
   STYLES (injected once; every class is prefixed mhm-)
══════════════════════════════════════════════════════════════ */
const STYLE_ID = "mhm-styles";
const injectStyles = () => {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    .mhm-root { display: flex; flex-direction: column; gap: 22px; font-family: inherit; color: #1a2540; text-align: left; }
    .mhm-root *, .mhm-overlay * { box-sizing: border-box; }
    .mhm-banner { padding: 10px 14px; border-radius: 9px; font-size: 13px; line-height: 1.5; }
    .mhm-banner-info { background: #f0f7ff; border: 1px solid #bfdbfe; color: #1d4d7a; }
    .mhm-banner-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; display: flex; gap: 12px; align-items: center; justify-content: space-between; }
    .mhm-card { background: #fff; border: 1px solid #e3e9f5; border-left: 4px solid var(--mhm-accent, #2563eb); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(15,35,80,0.04); }
    .mhm-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .mhm-title { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: var(--mhm-accent); background: var(--mhm-tint); border: 1px solid color-mix(in srgb, var(--mhm-accent) 22%, transparent); padding: 5px 13px; border-radius: 20px; margin: 0; }
    .mhm-count { font-weight: 700; opacity: 0.75; letter-spacing: 0; text-transform: none; }
    .mhm-head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .mhm-none { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: #475569; cursor: pointer; user-select: none; }
    .mhm-none input { width: 16px; height: 16px; accent-color: #059669; cursor: pointer; }
    .mhm-btn { font-family: inherit; font-size: 12.5px; font-weight: 700; border-radius: 8px; padding: 7px 14px; cursor: pointer; border: 1.5px solid transparent; line-height: 1.2; transition: background 0.15s, border-color 0.15s, opacity 0.15s; white-space: nowrap; }
    .mhm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .mhm-btn:focus-visible, .mhm-input:focus-visible, .mhm-none input:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .mhm-btn-add { background: #059669; color: #fff; }
    .mhm-btn-add:hover:not(:disabled) { background: #047857; }
    .mhm-btn-update { background: #b45309; color: #fff; }
    .mhm-btn-update:hover:not(:disabled) { background: #92400e; }
    .mhm-btn-edit { background: #eff4ff; color: #1d4ed8; border-color: #c7d9fc; }
    .mhm-btn-edit:hover:not(:disabled) { background: #dbe7ff; }
    .mhm-btn-delete { background: #fff1f1; color: #b91c1c; border-color: #fecaca; }
    .mhm-btn-delete:hover:not(:disabled) { background: #fee2e2; }
    .mhm-btn-danger { background: #dc2626; color: #fff; }
    .mhm-btn-danger:hover:not(:disabled) { background: #b91c1c; }
    .mhm-btn-plain { background: #fff; color: #475569; border-color: #d8e0ee; }
    .mhm-btn-plain:hover:not(:disabled) { background: #f5f7fc; }
    .mhm-btn-link { background: none; border: none; padding: 0; color: #1d4ed8; font-weight: 700; font-size: 12.5px; cursor: pointer; text-decoration: underline; font-family: inherit; }
    .mhm-form { border-radius: 12px; padding: 14px 16px 16px; margin-bottom: 14px; }
    .mhm-form-add { background: #f0fdf7; border: 1.5px solid #6ee7b7; }
    .mhm-form-edit { background: #fffaf0; border: 1.5px solid #fbbf24; }
    .mhm-form-title { font-size: 15px; font-weight: 800; margin: 0 0 2px; color: #0b2540; }
    .mhm-form-hint { font-size: 12px; color: #5b6b8c; margin: 0 0 12px; }
    .mhm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .mhm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .mhm-field-wide { grid-column: 1 / -1; }
    .mhm-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #64748b; }
    .mhm-req { color: #dc2626; margin-left: 2px; }
    .mhm-input { width: 100%; padding: 9px 11px; border: 1.5px solid #d8e0ee; border-radius: 8px; font-family: inherit; font-size: 13.5px; color: #1a2540; background: #fff; }
    .mhm-input:focus { border-color: #2563eb; }
    .mhm-form-msg { margin-top: 12px; }
    .mhm-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .mhm-table-wrap { overflow-x: auto; border: 1px solid #e8edf8; border-radius: 10px; }
    .mhm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .mhm-table th { text-align: left; padding: 9px 12px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #5b6b8c; background: #f6f8fd; border-bottom: 1px solid #e8edf8; white-space: nowrap; }
    .mhm-table td { padding: 10px 12px; border-bottom: 1px solid #f0f3fb; vertical-align: top; }
    .mhm-table tr:last-child td { border-bottom: none; }
    .mhm-table td.mhm-nowrap { white-space: nowrap; }
    .mhm-main { display: block; font-weight: 700; color: #0b2540; }
    .mhm-sub { display: block; font-size: 11.5px; color: #64748b; margin-top: 2px; }
    .mhm-stamp { display: block; font-size: 12px; color: #334155; font-weight: 600; }
    .mhm-stamp-time { display: block; font-size: 11px; color: #7b8aa8; margin-top: 1px; white-space: nowrap; }
    .mhm-muted { color: #a3aec4; }
    .mhm-actions { display: flex; gap: 6px; flex-wrap: nowrap; }
    .mhm-pill { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
    .mhm-pill-on { background: #dcfce7; color: #166534; }
    .mhm-pill-mid { background: #fef3c7; color: #92400e; }
    .mhm-pill-bad { background: #fee2e2; color: #991b1b; }
    .mhm-pill-crit { background: #ede9fe; color: #5b21b6; }
    .mhm-pill-off { background: #e2e8f0; color: #475569; }
    .mhm-empty { text-align: center; padding: 20px 12px; background: #fafbff; border: 1.5px dashed #dde8f8; border-radius: 10px; color: #7b8aa8; font-size: 13.5px; }
    .mhm-empty-ok { background: #ecfdf5; border: 1.5px solid #6ee7b7; color: #065f46; font-weight: 600; }
    .mhm-log summary { cursor: pointer; font-size: 12.5px; font-weight: 700; color: #475569; }
    .mhm-log-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
    .mhm-log-item { font-size: 12.5px; padding: 8px 12px; background: #f8faff; border: 1px solid #e8edf8; border-radius: 8px; }
    .mhm-log-meta { display: block; font-size: 11px; color: #7b8aa8; margin-top: 2px; }
    .mhm-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(10,25,55,0.55); display: flex; align-items: center; justify-content: center; padding: 16px; font-family: inherit; }
    .mhm-dialog { background: #fff; border-radius: 16px; width: 100%; max-width: 440px; padding: 22px 24px; box-shadow: 0 24px 70px rgba(10,25,55,0.3); color: #1a2540; text-align: left; }
    .mhm-dialog h3 { font-size: 16.5px; font-weight: 800; margin: 0 0 12px; color: #0b2540; }
    .mhm-dialog dl { margin: 0 0 12px; padding: 12px 14px; background: #fff7f7; border: 1px solid #fecaca; border-radius: 10px; display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; font-size: 13.5px; }
    .mhm-dialog dt { color: #7f1d1d; font-weight: 700; }
    .mhm-dialog dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .mhm-dialog p { font-size: 12.5px; color: #5b6b8c; margin: 0 0 16px; line-height: 1.5; }
    @media (prefers-reduced-motion: reduce) { .mhm-btn { transition: none; } }
  `;
  document.head.appendChild(el);
};

/* ══════════════════════════════════════════════════════════════
   FORM  (the same component shows either "Add …" or "Edit …")
══════════════════════════════════════════════════════════════ */
function RecordForm({ section, form, records, onValue, onSubmit, onCancel, onLoadLatest, onClose }) {
  const { mode, values, saving, error, recordId } = form;
  const isEdit = mode === "edit";
  const uid = `${section.key}-${isEdit ? recordId : "new"}`;
  const firstRef = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const serverRecord = isEdit ? records.find((r) => r._key === form.recordKey) : null;
  const deletedElsewhere = isEdit && !serverRecord;
  const changedElsewhere = isEdit && serverRecord && serverRecord.version != null && form.version != null
    && serverRecord.version !== form.version;

  const duplicate = !isEdit
    ? records.find((r) => section.duplicateOf(values, r))
    : null;

  const renderInput = (f, index) => {
    const common = {
      id: `mhm-${uid}-${f.name}`,
      className: "mhm-input",
      value: values[f.name] ?? "",
      disabled: saving,
      onChange: (e) => onValue(f.name, e.target.value),
      ref: index === 0 ? firstRef : undefined,
    };
    if (f.type === "select") {
      const options = f.options.map((o) => (Array.isArray(o) ? o : [o, o]));
      // Keep a value that is already stored even if it is not in today's list.
      if (common.value && !options.some(([k]) => k === common.value)) options.push([common.value, common.value]);
      return (
        <select {...common}>
          {!f.fallback && <option value="">{f.placeholder || "Select…"}</option>}
          {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      );
    }
    if (f.type === "suggest") {
      return (
        <>
          <input {...common} type="text" list={`${common.id}-list`} placeholder={f.placeholder} />
          <datalist id={`${common.id}-list`}>{f.options.map((o) => <option key={o} value={o} />)}</datalist>
        </>
      );
    }
    return <input {...common} type={f.type === "date" ? "date" : "text"} placeholder={f.placeholder} />;
  };

  return (
    <div className={`mhm-form ${isEdit ? "mhm-form-edit" : "mhm-form-add"}`} role="group" aria-label={`${isEdit ? "Edit" : "Add"} ${section.noun}`}>
      <p className="mhm-form-title">{isEdit ? `Edit ${section.noun}` : `Add ${section.noun}`}</p>
      <p className="mhm-form-hint">
        {isEdit
          ? `You are changing one existing record${recordId ? ` (record #${recordId})` : ""}. No other record is affected.`
          : "This creates a new record. Existing records are not changed."}
      </p>

      {deletedElsewhere ? (
        <div className="mhm-banner mhm-banner-error" role="alert">
          <span>This record was deleted by another user while you had it open.</span>
          <button type="button" className="mhm-btn mhm-btn-plain" onClick={onClose}>Close</button>
        </div>
      ) : (
        <>
          <div className="mhm-grid">
            {visibleFields(section, values).map((f, i) => (
              <div key={f.name} className={`mhm-field ${f.wide ? "mhm-field-wide" : ""}`}>
                <label className="mhm-label" htmlFor={`mhm-${uid}-${f.name}`}>
                  {f.label}{f.required && <span className="mhm-req" aria-hidden="true">*</span>}
                </label>
                {renderInput(f, i)}
              </div>
            ))}
          </div>

          {duplicate && (
            <div className="mhm-banner mhm-banner-info mhm-form-msg">
              Already on record: <strong>{section.nameOf(duplicate)}</strong>
              {duplicate.recorded_date ? ` (${fmtDate(duplicate.recorded_date)})` : ""}. Adding will create a second, separate record — the existing one stays as it is.
            </div>
          )}
          {changedElsewhere && (
            <div className="mhm-banner mhm-banner-error mhm-form-msg" role="alert">
              <span>
                This record was just changed by {serverRecord.updated_by_label || "another user"}.
                Load the latest values before making your change.
              </span>
              <button type="button" className="mhm-btn mhm-btn-plain" onClick={onLoadLatest}>Load latest values</button>
            </div>
          )}
          {error && <div className="mhm-banner mhm-banner-error mhm-form-msg" role="alert"><span>{error}</span></div>}

          <div className="mhm-form-actions">
            <button type="button" className="mhm-btn mhm-btn-plain" disabled={saving} onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className={`mhm-btn ${isEdit ? "mhm-btn-update" : "mhm-btn-add"}`}
              disabled={saving || changedElsewhere}
              onClick={onSubmit}
            >
              {saving ? "Saving…" : isEdit ? `Update ${section.noun}` : `Add ${section.noun}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DELETE CONFIRMATION
══════════════════════════════════════════════════════════════ */
function DeleteDialog({ target, onCancel, onConfirm }) {
  const { section, record, deleting, error } = target;
  const cancelRef = useRef(null);

  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;

  // Focus starts on Cancel, so pressing Enter by habit never deletes.
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !deleting) cancelFn.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleting]);

  const lines = section.describe(record).filter(([, v]) => text(v).trim());
  const what = `${section.title === "Women's Health" ? "women's health" : section.noun.toLowerCase()} record`;

  return (
    <div className="mhm-overlay" onClick={() => !deleting && onCancel()}>
      <div className="mhm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mhm-del-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="mhm-del-title">Are you sure you want to delete this {what}?</h3>
        <dl>
          {lines.map(([k, v]) => (<div key={k} style={{ display: "contents" }}><dt>{k}:</dt><dd>{v}</dd></div>))}
        </dl>
        <p>
          Only this record{record.id ? ` (#${record.id})` : ""} will be deleted. All other records stay as they are.
          {record.id ? " The deletion is noted in the change log." : ""}
        </p>
        {error && <div className="mhm-banner mhm-banner-error" role="alert" style={{ marginBottom: 14 }}><span>{error}</span></div>}
        <div className="mhm-form-actions" style={{ marginTop: 0 }}>
          <button ref={cancelRef} type="button" className="mhm-btn mhm-btn-plain" disabled={deleting} onClick={onCancel}>Cancel</button>
          <button type="button" className="mhm-btn mhm-btn-danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CHANGE LOG (who added / changed / deleted what)
══════════════════════════════════════════════════════════════ */
function ChangeLog({ patientId, refreshKey }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.get(`/patients/${patientId}/medical-history/audit`)
      .then((res) => { if (!cancelled) { setRows(Array.isArray(res.data) ? res.data : []); setError(""); } })
      .catch((err) => { if (!cancelled) setError(errorText(err, "Could not load the change log.")); });
    return () => { cancelled = true; };
  }, [open, patientId, refreshKey]);

  return (
    <details className="mhm-log" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Change log — who added, changed or deleted what</summary>
      {error && <div className="mhm-banner mhm-banner-error" style={{ marginTop: 10 }}><span>{error}</span></div>}
      {open && !error && rows === null && <p className="mhm-sub" style={{ marginTop: 10 }}>Loading…</p>}
      {rows && rows.length === 0 && <p className="mhm-sub" style={{ marginTop: 10 }}>No changes recorded yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="mhm-log-list">
          {rows.map((r) => (
            <li key={r.id} className="mhm-log-item">
              {r.summary}
              <span className="mhm-log-meta">{r.at_display} · {r.performed_by_label || "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
let tempSeq = 0;

const MedicalHistoryManager = forwardRef(function MedicalHistoryManager(
  { patientId, gender, onChange, pollSeconds = 15 },
  ref,
) {
  const live = patientId !== null && patientId !== undefined && patientId !== "";
  const isFemale = text(gender).trim().toLowerCase() === "female";

  const [history, setHistory] = useState(emptyHistory);   // live: from server · draft: kept here
  const [loaded, setLoaded] = useState(!live);
  const [loadError, setLoadError] = useState("");
  const [forms, setForms] = useState({});                 // { [sectionKey]: form }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [noneBusy, setNoneBusy] = useState("");
  const [logKey, setLogKey] = useState(0);

  const mutationSeq = useRef(0);     // bumps on every write; stale refreshes are discarded
  const lastJson = useRef("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => { injectStyles(); }, []);

  /* ── Loading & keeping in step with the other role ── */
  const load = useCallback(async () => {
    if (!live) return;
    const seq = mutationSeq.current;
    try {
      const res = await api.get(`/patients/${patientId}/medical-history`);
      if (seq !== mutationSeq.current) return;           // something was saved meanwhile
      const json = JSON.stringify(res.data);
      setLoadError("");
      setLoaded(true);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setHistory({ ...emptyHistory(), ...res.data });
      }
    } catch (err) {
      if (seq !== mutationSeq.current) return;
      const status = err?.response?.status;
      const serverMessage = err?.response?.data?.error;
      if (status === 404 && serverMessage !== "Patient not found.") {
        // The address itself does not exist: the backend is still the old one.
        setLoadError(
          "The server does not have the medical-history service yet. On the backend, replace patients.py, " +
          "add medical_history.py in the same folder, replace models.py, and restart the server.",
        );
      } else {
        setLoadError(errorText(err, "Could not load medical history."));
      }
    }
  }, [live, patientId]);

  useEffect(() => {
    // Patient changed (or was just registered): start clean.
    lastJson.current = "";
    setForms({});
    setDeleteTarget(null);
    setLoadError("");
    if (live) {
      setLoaded(false);
      setHistory(emptyHistory());
      load();
    } else {
      setLoaded(true);
      setHistory(emptyHistory());
    }
  }, [live, patientId, load]);

  useEffect(() => {
    if (!live) return undefined;
    const refresh = () => { if (document.visibilityState !== "hidden") load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = pollSeconds > 0 ? setInterval(refresh, pollSeconds * 1000) : null;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (timer) clearInterval(timer);
    };
  }, [live, load, pollSeconds]);

  useEffect(() => {
    if (!loaded) return;
    onChangeRef.current?.({ ...history, loaded: true, draft: !live });
  }, [history, loaded, live]);

  const afterWrite = async () => {
    mutationSeq.current += 1;
    setLogKey((k) => k + 1);
    await load();
  };

  /* Records with a stable key for React + form matching. */
  const recordsOf = (key) => (history[key] || []).map((r) => ({ ...r, _key: r.id != null ? `id-${r.id}` : r._temp }));

  /* ── Forms ── */
  const setForm = (key, patch) =>
    setForms((all) => (all[key] ? { ...all, [key]: { ...all[key], ...(typeof patch === "function" ? patch(all[key]) : patch) } } : all));
  const closeForm = (key) => setForms((all) => { const next = { ...all }; delete next[key]; return next; });

  const openAdd = (section) =>
    setForms((all) => ({ ...all, [section.key]: { mode: "add", recordId: null, recordKey: null, version: null, values: blankValues(section), saving: false, error: "" } }));

  const openEdit = (section, record) =>
    setForms((all) => ({
      ...all,
      [section.key]: {
        mode: "edit", recordId: record.id ?? null, recordKey: record._key, version: record.version ?? null,
        values: valuesFromRecord(section, record), saving: false, error: "",
      },
    }));

  const submitForm = async (section) => {
    const form = forms[section.key];
    if (!form || form.saving) return;
    const problem = validateValues(section, form.values);
    if (problem) { setForm(section.key, { error: problem }); return; }
    const payload = buildPayload(section, form.values);

    /* Not registered yet: keep the record on the page. */
    if (!live) {
      setHistory((h) => {
        const list = h[section.key] || [];
        const next = form.mode === "edit"
          ? list.map((r) => (r._temp === form.recordKey ? { ...r, ...payload } : r))       // UPDATE: that one draft
          : [...list, { ...payload, id: null, _temp: `new-${++tempSeq}` }];                 // ADD: a new draft
        const none = section.noneKnown ? { ...h.none_known, [section.key]: false } : h.none_known;
        return { ...h, [section.key]: next, none_known: none };
      });
      closeForm(section.key);
      return;
    }

    setForm(section.key, { saving: true, error: "" });
    const base = `/patients/${patientId}/medical-history/${section.slug}`;
    try {
      if (form.mode === "edit") {
        // UPDATE — addressed by this record's own id.
        await api.put(`${base}/${form.recordId}`, { ...payload, version: form.version });
      } else {
        // ADD — always creates a new record.
        await api.post(base, payload);
      }
      closeForm(section.key);
      await afterWrite();
    } catch (err) {
      const status = err?.response?.status;
      const latest = err?.response?.data?.record;
      if (status === 409 && latest) {
        // Someone else saved this record first: show their values, keep the form open.
        setForm(section.key, { saving: false, error: errorText(err), version: latest.version, values: valuesFromRecord(section, latest) });
      } else {
        setForm(section.key, { saving: false, error: errorText(err, `Could not save this ${section.noun.toLowerCase()}.`) });
      }
      if (status === 404 || status === 409) await afterWrite();
    }
  };

  const loadLatestIntoForm = (section) => {
    const form = forms[section.key];
    const latest = recordsOf(section.key).find((r) => r._key === form?.recordKey);
    if (latest) setForm(section.key, { values: valuesFromRecord(section, latest), version: latest.version ?? null, error: "" });
  };

  /* ── Delete ── */
  const confirmDelete = async () => {
    if (!deleteTarget || deleteTarget.deleting) return;
    const { section, record } = deleteTarget;

    if (!live) {
      setHistory((h) => ({ ...h, [section.key]: (h[section.key] || []).filter((r) => r._temp !== record._temp) }));
      setDeleteTarget(null);
      return;
    }

    setDeleteTarget((t) => ({ ...t, deleting: true, error: "" }));
    try {
      // DELETE — addressed by this record's own id.
      await api.delete(`/patients/${patientId}/medical-history/${section.slug}/${record.id}`);
      setDeleteTarget(null);
      await afterWrite();
    } catch (err) {
      if (err?.response?.status === 404) {       // already deleted by someone else
        setDeleteTarget(null);
        await afterWrite();
      } else {
        setDeleteTarget((t) => (t ? { ...t, deleting: false, error: errorText(err, "Could not delete this record.") } : t));
      }
    }
  };

  /* ── "No known …" tick box ── */
  const toggleNone = async (section, value) => {
    if (!live) {
      setHistory((h) => ({ ...h, none_known: { ...h.none_known, [section.key]: value } }));
      return;
    }
    setNoneBusy(section.key);
    try {
      await api.put(`/patients/${patientId}/medical-history/${section.slug}/none-known`, { none_known: value });
      setLoadError("");
    } catch (err) {
      setLoadError(errorText(err, "Could not save."));
    } finally {
      await afterWrite();
      setNoneBusy("");
    }
  };

  /* ── What the parent page can ask for ── */
  useImperativeHandle(ref, () => ({
    getDrafts: () => {
      const out = { none_known: { ...history.none_known } };
      SECTIONS.forEach((s) => {
        const include = !s.femaleOnly || isFemale;
        out[s.key] = include ? (history[s.key] || []).map(({ _temp, id, ...fields }) => fields) : [];
      });
      return out;
    },
    hasOpenForm: () => Object.keys(forms).length > 0,
    openFormTitles: () => SECTIONS.filter((s) => forms[s.key]).map((s) => s.title),
    reload: load,
  }), [history, forms, isFemale, load]);

  /* ── Render ── */
  if (live && !loaded && !loadError) {
    return <div className="mhm-root"><div className="mhm-empty">Loading medical history…</div></div>;
  }

  return (
    <div className="mhm-root">
      {loadError && (
        <div className="mhm-banner mhm-banner-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="mhm-btn mhm-btn-plain" onClick={load}>Try again</button>
        </div>
      )}
      {!live && (
        <div className="mhm-banner mhm-banner-info">
          Add each condition, allergy, medication and habit as its own record. They are saved together with the patient when you register.
        </div>
      )}

      {SECTIONS.map((section) => {
        const records = recordsOf(section.key);
        // Women's Health follows the existing rule (gender = Female). Records that
        // already exist for a saved patient stay visible so they can still be managed.
        if (section.femaleOnly && !isFemale && (records.length === 0 || !live)) return null;

        const form = forms[section.key];
        const busy = Boolean(form);                     // one form at a time per section
        const noneTicked = Boolean(section.noneKnown && history.none_known?.[section.key]);
        const canAdd = !section.femaleOnly || isFemale;
        const lockTitle = busy ? "Finish or cancel the open form first" : undefined;

        return (
          <section key={section.key} className="mhm-card" style={{ "--mhm-accent": section.accent, "--mhm-tint": section.tint }} aria-label={section.title}>
            <div className="mhm-head">
              <h3 className="mhm-title">
                <span aria-hidden="true">{section.icon}</span> {section.title}
                {records.length > 0 && <span className="mhm-count">· {records.length}</span>}
              </h3>
              <div className="mhm-head-actions">
                {section.noneKnown && records.length === 0 && !busy && (
                  <label className="mhm-none">
                    <input
                      type="checkbox"
                      checked={noneTicked}
                      disabled={noneBusy === section.key}
                      onChange={(e) => toggleNone(section, e.target.checked)}
                    />
                    {section.noneKnown}
                  </label>
                )}
                {canAdd && (
                  <button type="button" className="mhm-btn mhm-btn-add" disabled={busy} title={lockTitle} onClick={() => openAdd(section)}>
                    + Add {section.noun}
                  </button>
                )}
              </div>
            </div>

            {form?.mode === "add" && (
              <RecordForm
                section={section} form={form} records={records}
                onValue={(name, value) => setForm(section.key, (f) => ({ values: { ...f.values, [name]: value }, error: "" }))}
                onSubmit={() => submitForm(section)}
                onCancel={() => closeForm(section.key)}
              />
            )}

            {records.length === 0 ? (
              form?.mode !== "add" && (
                <div className={`mhm-empty ${noneTicked ? "mhm-empty-ok" : ""}`}>
                  {noneTicked ? `✓ ${section.noneKnown}` : section.emptyText}
                </div>
              )
            ) : (
              <div className="mhm-table-wrap">
                <table className="mhm-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      {section.columns.map(([head]) => <th key={head} scope="col">{head}</th>)}
                      <th scope="col">Created by</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      if (form?.mode === "edit" && form.recordKey === record._key) {
                        return (
                          <tr key={record._key}>
                            <td colSpan={section.columns.length + 4} style={{ padding: 10 }}>
                              <RecordForm
                                section={section} form={form} records={records}
                                onValue={(name, value) => setForm(section.key, (f) => ({ values: { ...f.values, [name]: value }, error: "" }))}
                                onSubmit={() => submitForm(section)}
                                onCancel={() => closeForm(section.key)}
                                onLoadLatest={() => loadLatestIntoForm(section)}
                                onClose={() => closeForm(section.key)}
                              />
                            </td>
                          </tr>
                        );
                      }
                      const name = section.nameOf(record) || section.noun;
                      return (
                        <tr key={record._key} style={section.key === "medications" && record.active === false ? { opacity: 0.6 } : undefined}>
                          <td className="mhm-nowrap">{fmtDate(record.recorded_date)}</td>
                          {section.columns.map(([head, cell]) => <td key={head}>{cell(record)}</td>)}
                          <td>
                            {record.id == null ? (
                              <span className="mhm-stamp-time">Not saved yet</span>
                            ) : (
                              <>
                                {/* Rows saved before user tracking existed have no name on file. */}
                                <span className={record.created_by_label ? "mhm-stamp" : "mhm-stamp mhm-muted"}>
                                  {record.created_by_label || "Not recorded"}
                                </span>
                                <span className="mhm-stamp-time">{record.created_at_display || ""}</span>
                              </>
                            )}
                          </td>
                          <td>
                            {record.updated_at_display ? (
                              <>
                                <span className="mhm-stamp">{record.updated_at_display}</span>
                                <span className="mhm-stamp-time" style={{ whiteSpace: "normal" }}>{record.updated_by_label || ""}</span>
                              </>
                            ) : <span className="mhm-muted">—</span>}
                          </td>
                          <td>
                            <div className="mhm-actions">
                              <button type="button" className="mhm-btn mhm-btn-edit" disabled={busy} title={lockTitle}
                                aria-label={`Edit ${name}`} onClick={() => openEdit(section, record)}>Edit</button>
                              <button type="button" className="mhm-btn mhm-btn-delete" disabled={busy} title={lockTitle}
                                aria-label={`Delete ${name}`} onClick={() => setDeleteTarget({ section, record, deleting: false, error: "" })}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {live && <ChangeLog patientId={patientId} refreshKey={logKey} />}

      {deleteTarget && (
        <DeleteDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
});

export default MedicalHistoryManager;
export { SECTION_KEYS, NONE_KNOWN_KEYS };