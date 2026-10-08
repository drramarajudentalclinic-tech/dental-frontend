import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/* ═══════════════════════════════════════════════════════
   DENTAL CHART

   What this component does
     • A tooth can carry SEVERAL findings (e.g. 16: Caries + Calculus).
       Every finding is its own record with its own Edit and Delete.
     • Click a tooth      → that tooth's findings: add, edit, delete.
     • Quick mark         → pick one condition, then click every tooth
                            that has it (fast for calculus, stains…).
     • The chart shows the main finding as the tooth colour, affected
       surfaces as coloured bands, and extra findings as small dots.

   Props (unchanged)
     visitId, disabled, onRecordsChange(records), externalRecords

   Exports (unchanged, used by the Diagnosis panel)
     default DentalChart, CONDITIONS, CMAP, resolveDiagnosisCondition
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   INJECT STYLES
═══════════════════════════════════════════════════════ */
const injectStyles = () => {
  if (document.getElementById("dc-pro-styles-v2")) return;
  const s = document.createElement("style");
  s.id = "dc-pro-styles-v2";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

    :root {
      --dc-bg: #f0f2f5;
      --dc-surface: #ffffff;
      --dc-surface2: #f7f8fa;
      --dc-border: #e4e8ef;
      --dc-border2: #d1d8e4;
      --dc-text: #0d1b2a;
      --dc-text2: #4a5568;
      --dc-text3: #6b7789;
      --dc-accent: #1a56db;
      --dc-accent2: #1046c4;
      --dc-accent-soft: #e8effe;
      --dc-shadow: 0 1px 3px rgba(13,27,42,0.08), 0 4px 16px rgba(13,27,42,0.06);
      --dc-radius: 14px;
      --dc-font: 'DM Sans', sans-serif;
      --dc-mono: 'DM Mono', monospace;
    }

    * { box-sizing: border-box; }

    .dc-root { font-family: var(--dc-font); color: var(--dc-text); background: var(--dc-bg); padding: 0; text-align: left; }
    .dc-root button, .dc-overlay button { font-family: var(--dc-font); }
    .dc-root button:focus-visible, .dc-overlay button:focus-visible,
    .dc-root input:focus-visible, .dc-overlay input:focus-visible,
    .dc-overlay textarea:focus-visible { outline: 2px solid var(--dc-accent); outline-offset: 2px; }

    /* ── PANELS ── */
    .dc-panel { background: var(--dc-surface); border: 1px solid var(--dc-border); border-radius: var(--dc-radius); box-shadow: var(--dc-shadow); margin-bottom: 14px; overflow: hidden; }

    /* ── HEADER ── */
    .dc-header { padding: 16px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; overflow: visible; }
    .dc-header-title { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; display: flex; align-items: center; gap: 9px; }
    .dc-header-title-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #1a56db, #2e70f0); border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 17px; box-shadow: 0 3px 10px rgba(26,86,219,.30); }
    .dc-tab-group { display: flex; background: var(--dc-surface2); border: 1px solid var(--dc-border); border-radius: 10px; padding: 3px; gap: 2px; }
    .dc-tab { padding: 7px 16px; border-radius: 8px; border: none; background: transparent; font-size: 12.5px; font-weight: 600; color: var(--dc-text3); cursor: pointer; transition: all .18s; white-space: nowrap; }
    .dc-tab.active { background: var(--dc-surface); color: var(--dc-accent); box-shadow: 0 1px 4px rgba(0,0,0,.10); }
    .dc-stats-row { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; align-items: center; }
    .dc-stat-chip { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 20px; font-size: 11.5px; font-weight: 600; border: 1.5px solid; white-space: nowrap; }
    .dc-stat-dot { width: 7px; height: 7px; border-radius: 50%; }

    /* ── MODE BAR (click a tooth / quick mark) ── */
    .dc-mode { padding: 14px 18px; }
    .dc-mode-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .dc-mode-hint { font-size: 13px; color: var(--dc-text2); font-weight: 500; }
    .dc-mode-hint b { color: var(--dc-text); }
    .dc-mode-active { border: 2px solid var(--dc-qm, var(--dc-accent)); }
    .dc-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px; border-radius: 20px; color: #fff; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
    .dc-opt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 22px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--dc-border2); }
    .dc-marked { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; }
    .dc-marked-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border-radius: 20px; font-family: var(--dc-mono); font-size: 12px; font-weight: 600; background: var(--dc-surface2); border: 1px solid var(--dc-border2); color: var(--dc-text); }
    .dc-marked-chip button { width: 20px; height: 20px; border-radius: 50%; border: none; background: transparent; color: var(--dc-text3); cursor: pointer; font-size: 11px; line-height: 1; }
    .dc-marked-chip button:hover { background: #fee2e2; color: #dc2626; }
    .dc-notice { margin-top: 10px; padding: 8px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 500; }
    .dc-notice-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
    .dc-notice-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    .dc-notice-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }

    /* ── BUTTONS ── */
    .dc-btn { padding: 8px 15px; border-radius: 9px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1.5px solid transparent; transition: all .14s; white-space: nowrap; line-height: 1.2; }
    .dc-btn:disabled { opacity: .45; cursor: not-allowed; }
    .dc-btn-primary { background: linear-gradient(135deg,#1a56db,#2e70f0); color: #fff; box-shadow: 0 3px 10px rgba(26,86,219,.25); }
    .dc-btn-primary:hover:not(:disabled) { box-shadow: 0 5px 16px rgba(26,86,219,.38); }
    .dc-btn-update { background: #b45309; color: #fff; }
    .dc-btn-update:hover:not(:disabled) { background: #92400e; }
    .dc-btn-soft { background: var(--dc-accent-soft); color: var(--dc-accent); border-color: #bcd0fb; }
    .dc-btn-soft:hover:not(:disabled) { background: #dbe6fd; }
    .dc-btn-ghost { background: var(--dc-surface); color: var(--dc-text2); border-color: var(--dc-border2); }
    .dc-btn-ghost:hover:not(:disabled) { background: var(--dc-surface2); }
    .dc-btn-danger { background: #dc2626; color: #fff; }
    .dc-btn-danger:hover:not(:disabled) { background: #b91c1c; }
    .dc-btn-danger-soft { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
    .dc-btn-danger-soft:hover:not(:disabled) { background: #ffe4e6; }
    .dc-btn-sm { padding: 4px 10px; font-size: 11.5px; border-radius: 7px; }

    /* ── CHART ── */
    .dc-chart-inner { background: #f8fafd; background-image: radial-gradient(circle at 50% 50%, rgba(26,86,219,0.04) 0%, transparent 70%); display: flex; justify-content: center; align-items: center; padding: 22px 12px 14px; }
    .dc-chart-inner svg { display: block; width: 100%; height: auto; }
    .dc-tooth-g { cursor: pointer; transition: opacity .15s; }
    .dc-tooth-g:hover .dc-tooth-body { filter: brightness(0.94) drop-shadow(0 3px 7px rgba(0,0,0,.22)); }
    .dc-tooth-g.dim { opacity: .22; }
    .dc-tooth-g:focus { outline: none; }
    .dc-focus-ring { opacity: 0; pointer-events: none; }
    .dc-tooth-g:focus-visible .dc-focus-ring { opacity: 1; }
    .dc-qlabel { font-family: var(--dc-mono); font-size: 9px; font-weight: 500; fill: rgba(26,86,219,0.45); letter-spacing: .5px; }
    .dc-sidelabel { font-family: var(--dc-font); font-size: 9.5px; font-weight: 700; fill: #8a96a8; letter-spacing: 1.2px; }

    /* ── LEGEND ── */
    .dc-legend-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 11px 16px; border-top: 1px solid var(--dc-border); background: var(--dc-surface2); }
    .dc-legend-cap { font-size: 10px; font-weight: 700; color: var(--dc-text3); text-transform: uppercase; letter-spacing: .8px; margin-right: 4px; }
    .dc-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11.5px; font-weight: 600; background: var(--dc-surface); border: 1.5px solid var(--dc-border); color: var(--dc-text2); cursor: pointer; transition: all .12s; }
    .dc-legend-item.static { cursor: default; }
    .dc-legend-item.on { border-color: var(--dc-accent); background: var(--dc-accent-soft); color: var(--dc-accent); }
    .dc-legend-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
    .dc-legend-key { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--dc-text3); font-weight: 500; margin-left: 6px; }

    /* ── CONDITION PICKER ── */
    .dc-search { width: 100%; padding: 9px 12px; border: 1.5px solid var(--dc-border2); border-radius: 9px; font-family: var(--dc-font); font-size: 13px; color: var(--dc-text); background: #fff; margin-bottom: 10px; }
    .dc-cond-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 6px; }
    .dc-cond-btn { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-radius: 8px; border: 1.5px solid transparent; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .12s; text-align: left; line-height: 1.25; }
    .dc-cond-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0,0,0,.10); }
    .dc-cond-btn:disabled { opacity: .5; cursor: not-allowed; }
    .dc-cond-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .dc-cond-tag { font-size: 9.5px; font-weight: 700; opacity: .8; text-transform: uppercase; letter-spacing: .4px; }

    /* ── FORM BITS ── */
    .dc-field-label { font-size: 10.5px; font-weight: 700; color: var(--dc-text3); letter-spacing: .8px; text-transform: uppercase; display: block; margin-bottom: 7px; }
    .dc-field-group { margin-bottom: 16px; }
    .dc-severity-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .dc-sev-btn { flex: 1; min-width: 70px; padding: 8px 6px; border-radius: 9px; border: 1.5px solid var(--dc-border); background: var(--dc-surface2); font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all .13s; text-align: center; color: var(--dc-text2); }
    .dc-sev-btn.s1.active { background:#dcfce7; border-color:#16a34a; color:#15803d; }
    .dc-sev-btn.s2.active { background:#fef9c3; border-color:#ca8a04; color:#a16207; }
    .dc-sev-btn.s3.active { background:#ffedd5; border-color:#ea580c; color:#c2410c; }
    .dc-sev-btn.s4.active { background:#fee2e2; border-color:#dc2626; color:#b91c1c; }
    .dc-surf-wrap { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .dc-surf-zone { cursor: pointer; transition: fill .12s; }
    .dc-surf-zone:hover { fill: #dbeafe; }
    .dc-surf-zone.on, .dc-surf-zone.on:hover { fill: var(--dc-accent); }
    .dc-surf-letter { font-family: var(--dc-mono); font-size: 13px; font-weight: 600; fill: #4a5568; pointer-events: none; }
    .dc-surf-letter.on { fill: #fff; }
    .dc-surf-list { font-size: 12px; color: var(--dc-text2); font-weight: 500; line-height: 1.6; }
    .dc-notes-ta { width: 100%; padding: 9px 12px; border: 1.5px solid var(--dc-border2); border-radius: 9px; font-family: var(--dc-font); font-size: 13px; color: var(--dc-text); background: #fff; resize: vertical; min-height: 58px; line-height: 1.5; }
    .dc-input { width: 100%; padding: 9px 12px; border: 1.5px solid var(--dc-border2); border-radius: 9px; font-family: var(--dc-font); font-size: 13px; color: var(--dc-text); background: #fff; }
    .dc-other-panel { background: linear-gradient(135deg,#f5f7ff,#eff1ff); border: 1.5px solid #c7d2fe; border-radius: 12px; padding: 14px; margin-top: 10px; }
    .dc-palette { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .dc-pdot { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; padding: 0; }
    .dc-pdot.sel { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #0f172a; }

    /* ── MODAL ── */
    .dc-overlay { position: fixed; inset: 0; background: rgba(8,15,30,.58); display: flex; align-items: center; justify-content: center; z-index: 9000; padding: 14px; animation: dcFadeIn .16s ease both; font-family: var(--dc-font); color: var(--dc-text); text-align: left; }
    @keyframes dcFadeIn { from { opacity:0 } to { opacity:1 } }
    .dc-modal { background: var(--dc-surface); border-radius: 18px; width: 100%; max-width: 780px; max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 40px 100px rgba(8,15,30,.40); }
    .dc-modal-top { padding: 18px 22px; border-bottom: 1px solid var(--dc-border); flex-shrink: 0; background: linear-gradient(160deg, #f8faff 0%, var(--dc-surface) 100%); display: flex; align-items: center; gap: 14px; }
    .dc-modal-scroll { overflow-y: auto; flex: 1; padding: 18px 22px 22px; }
    .dc-modal-badge { width: 50px; height: 50px; border-radius: 13px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; flex-shrink: 0; font-family: var(--dc-mono); background: var(--dc-accent-soft); color: var(--dc-accent); border: 2px solid #bcd0fb; }
    .dc-modal-title { font-size: 17px; font-weight: 700; }
    .dc-modal-sub { font-size: 12.5px; color: var(--dc-text3); margin-top: 2px; font-weight: 500; }
    .dc-close-btn { margin-left: auto; width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--dc-border); background: var(--dc-surface); color: var(--dc-text3); font-size: 15px; cursor: pointer; flex-shrink: 0; }
    .dc-close-btn:hover { background: #fee2e2; color: #dc2626; border-color: #fecdd3; }
    .dc-section-title { font-size: 12px; font-weight: 700; color: var(--dc-text2); text-transform: uppercase; letter-spacing: .7px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
    .dc-form { border-radius: 13px; padding: 16px; margin-top: 14px; }
    .dc-form-add { background: #f3fbf7; border: 1.5px solid #86e3b9; }
    .dc-form-edit { background: #fffaf0; border: 1.5px solid #fbbf24; }
    .dc-form-title { font-size: 15px; font-weight: 700; margin: 0 0 2px; }
    .dc-form-hint { font-size: 12px; color: var(--dc-text3); margin: 0 0 14px; }
    .dc-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 6px; }
    .dc-modal-scroll::-webkit-scrollbar { width: 6px; }
    .dc-modal-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 99px; }
    .dc-confirm { max-width: 420px; padding: 22px 24px; }
    .dc-confirm h4 { font-size: 16px; font-weight: 700; margin: 0 0 10px; }
    .dc-confirm p { font-size: 13px; color: var(--dc-text2); margin: 0 0 18px; line-height: 1.55; }

    /* ── FINDING ROWS (modal + log) ── */
    .dc-frow { display: flex; align-items: center; gap: 9px; padding: 5px 8px; border-radius: 9px; background: var(--dc-surface2); border: 1px solid var(--dc-border); margin-bottom: 5px; }
    .dc-frow-main { flex: 1; min-width: 0; }
    .dc-frow-line { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .dc-frow-notes { font-size: 12px; color: var(--dc-text2); font-style: italic; margin-top: 3px; line-height: 1.4; overflow-wrap: anywhere; }
    .dc-frow-actions { display: flex; gap: 5px; flex-shrink: 0; }
    .dc-sev-tag { display: inline-block; padding: 2px 8px; border-radius: 5px; font-size: 10px; font-weight: 700; font-family: var(--dc-mono); letter-spacing: .3px; white-space: nowrap; text-transform: uppercase; }
    .dc-surf-tag { display: inline-block; padding: 2px 8px; border-radius: 5px; font-family: var(--dc-mono); font-size: 10.5px; font-weight: 600; background: #fff; border: 1px solid var(--dc-border2); color: var(--dc-text2); white-space: nowrap; }
    .dc-date { font-family: var(--dc-mono); font-size: 10.5px; color: var(--dc-text3); white-space: nowrap; }
    .dc-tooth-badge { min-width: 32px; height: 26px; padding: 0 6px; border-radius: 8px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-family: var(--dc-mono); font-weight: 700; font-size: 12px; cursor: pointer; border: 1.5px solid; background: #fff; }

    /* ── LOG ── */
    .dc-log-head { padding: 13px 18px; border-bottom: 1px solid var(--dc-border); background: var(--dc-surface2); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .dc-log-title { font-size: 13.5px; font-weight: 700; }
    .dc-count-badge { padding: 2px 9px; border-radius: 20px; font-size: 11px; font-weight: 700; background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
    .dc-log-body { padding: 12px 14px 4px; columns: 2 400px; column-gap: 10px; }
    .dc-log-empty { padding: 34px 20px; text-align: center; color: var(--dc-text3); font-size: 13px; line-height: 1.6; }
    .dc-gcard { background: #fff; border: 1.5px solid var(--dc-border); border-radius: 12px; padding: 9px 10px 5px; margin-bottom: 9px; break-inside: avoid; }
    .dc-gcard-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .dc-gcard-teeth { font-size: 11.5px; color: var(--dc-text3); }
    .dc-gcard-teeth b { font-family: var(--dc-mono); font-weight: 600; }

    @media (prefers-reduced-motion: reduce) {
      .dc-overlay { animation: none; }
      .dc-btn, .dc-cond-btn, .dc-tab, .dc-tooth-g { transition: none; }
    }
  `;
  document.head.appendChild(s);
};

/* ═══════════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════════ */
/* Conditions, in alphabetical order (A–Z), with "Other" last because it is
   the catch-all. The 21 names that existed before are unchanged (records are
   stored by name); the rest are new. */
const CONDITIONS = [
  "Abscess", "Attrition", "Bridge", "Calculus", "Caries", "Cervical Abrasion", "Crown",
  "Deep Caries", "Erosion", "Faulty Restoration", "Fluorosis", "Food Impaction", "Fracture",
  "Furcation", "Gingivitis", "Gum Recession", "Hypoplasia", "Impacted", "Implant", "Malposed",
  "Missing", "Mobility I", "Mobility II", "Mobility III", "Occlusal Pits", "Partially Erupted",
  "Periapical Pathology", "Pockets", "Proximal Caries", "Pulpitis", "RC Treated", "Restored",
  "Retained Deciduous", "Root Caries", "Root Stump", "Secondary Caries", "Sensitive Tooth",
  "Stains", "Supernumerary", "Veneer",
  "Other",
];
const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });

const SEVERITY_LEVELS = [
  { key:"mild",    label:"Mild",     cls:"s1" },
  { key:"moderate",label:"Moderate", cls:"s2" },
  { key:"severe",  label:"Severe",   cls:"s3" },
  { key:"critical",label:"Critical", cls:"s4" },
];
const SEV_STYLE = {
  critical:{bg:"#fee2e2",col:"#b91c1c",bdr:"#fca5a5",ring:"#dc2626"},
  severe:  {bg:"#ffedd5",col:"#c2410c",bdr:"#fdba74",ring:"#ea580c"},
  moderate:{bg:"#fef9c3",col:"#a16207",bdr:"#fde047",ring:"#ca8a04"},
  mild:    {bg:"#dcfce7",col:"#15803d",bdr:"#86efac",ring:null},
};
const SEV_RANK = { mild:1, moderate:2, severe:3, critical:4 };

/* a = main colour, dark = outline/text, hi = soft tint, short = code on the tooth.
   `surf` (optional) = surfaces pre-selected when the condition is picked. */
const CMAP = {
  // ── Caries ──
  "Caries":           { a:"#dc2626", dark:"#7f1d1d", hi:"rgba(220,38,38,.15)",   emoji:"🔴", short:"CAR" },
  "Deep Caries":      { a:"#991b1b", dark:"#450a0a", hi:"rgba(153,27,27,.15)",   emoji:"🦷", short:"DCR" },
  "Proximal Caries":  { a:"#e11d48", dark:"#881337", hi:"rgba(225,29,72,.15)",   emoji:"↔️", short:"PXC" },
  "Occlusal Pits":    { a:"#9f1239", dark:"#4c0519", hi:"rgba(159,18,57,.15)",   emoji:"⚫", short:"PIT", surf:["O"] },
  "Root Caries":      { a:"#b91c1c", dark:"#7f1d1d", hi:"rgba(185,28,28,.15)",   emoji:"🔻", short:"RTC" },
  "Secondary Caries": { a:"#f43f5e", dark:"#9f1239", hi:"rgba(244,63,94,.15)",   emoji:"♻️", short:"SCR" },
  // ── Deposits & stains ──
  "Calculus":         { a:"#a16207", dark:"#713f12", hi:"rgba(161,98,7,.15)",    emoji:"🪨", short:"CAL" },
  "Stains":           { a:"#78350f", dark:"#451a03", hi:"rgba(120,53,15,.15)",   emoji:"🟤", short:"STN" },
  // ── Wear & defects ──
  "Attrition":        { a:"#065f46", dark:"#022c22", hi:"rgba(6,95,70,.15)",     emoji:"⚡", short:"ATT" },
  "Cervical Abrasion":{ a:"#0891b2", dark:"#164e63", hi:"rgba(8,145,178,.15)",   emoji:"🪥", short:"CAB" },
  "Erosion":          { a:"#0f766e", dark:"#134e4a", hi:"rgba(15,118,110,.15)",  emoji:"💧", short:"ERO" },
  "Fracture":         { a:"#d97706", dark:"#78350f", hi:"rgba(217,119,6,.15)",   emoji:"💥", short:"FRC" },
  "Fluorosis":        { a:"#65a30d", dark:"#365314", hi:"rgba(101,163,13,.15)",  emoji:"⚪", short:"FLU" },
  "Hypoplasia":       { a:"#4d7c0f", dark:"#1a2e05", hi:"rgba(77,124,15,.15)",   emoji:"◌",  short:"HYP" },
  "Sensitive Tooth":  { a:"#0d9488", dark:"#134e4a", hi:"rgba(13,148,136,.15)",  emoji:"❄️", short:"SEN" },
  // ── Gums & support ──
  "Gingivitis":       { a:"#db2777", dark:"#831843", hi:"rgba(219,39,119,.15)",  emoji:"🩸", short:"GIN" },
  "Gum Recession":    { a:"#be185d", dark:"#831843", hi:"rgba(190,24,93,.15)",   emoji:"📉", short:"GRC" },
  "Pockets":          { a:"#7e22ce", dark:"#4a044e", hi:"rgba(126,34,206,.15)",  emoji:"🫧", short:"PKT" },
  "Furcation":        { a:"#9333ea", dark:"#581c87", hi:"rgba(147,51,234,.15)",  emoji:"🔱", short:"FUR" },
  "Mobility I":       { a:"#d97706", dark:"#92400e", hi:"rgba(217,119,6,.15)",   emoji:"Ⅰ",  short:"M-I" },
  "Mobility II":      { a:"#ea580c", dark:"#7c2d12", hi:"rgba(234,88,12,.15)",   emoji:"Ⅱ",  short:"M-II"},
  "Mobility III":     { a:"#dc2626", dark:"#7f1d1d", hi:"rgba(220,38,38,.15)",   emoji:"Ⅲ",  short:"M-III"},
  "Food Impaction":   { a:"#ca8a04", dark:"#854d0e", hi:"rgba(202,138,4,.15)",   emoji:"🍃", short:"FIM" },
  // ── Pulp & root ──
  "Pulpitis":         { a:"#c026d3", dark:"#701a75", hi:"rgba(192,38,211,.15)",  emoji:"🔥", short:"PUL" },
  "Periapical Pathology": { a:"#a21caf", dark:"#701a75", hi:"rgba(162,28,175,.15)", emoji:"🔬", short:"PAP" },
  "Abscess":          { a:"#86198f", dark:"#4a044e", hi:"rgba(134,25,143,.15)",  emoji:"🟣", short:"ABS" },
  "RC Treated":       { a:"#7c3aed", dark:"#4c1d95", hi:"rgba(124,58,237,.15)",  emoji:"🔩", short:"RCT" },
  "Root Stump":       { a:"#57534e", dark:"#292524", hi:"rgba(87,83,78,.15)",    emoji:"🪵", short:"RTS" },
  // ── Restorations ──
  "Restored":         { a:"#0369a1", dark:"#0c4a6e", hi:"rgba(3,105,161,.15)",   emoji:"🛡", short:"RST" },
  "Faulty Restoration": { a:"#0284c7", dark:"#075985", hi:"rgba(2,132,199,.15)", emoji:"⚠️", short:"FRS" },
  "Crown":            { a:"#b45309", dark:"#78350f", hi:"rgba(180,83,9,.15)",    emoji:"👑", short:"CRW" },
  "Bridge":           { a:"#c2410c", dark:"#7c2d12", hi:"rgba(194,65,12,.15)",   emoji:"🌉", short:"BRG" },
  "Veneer":           { a:"#0ea5e9", dark:"#0c4a6e", hi:"rgba(14,165,233,.15)",  emoji:"✨", short:"VNR" },
  "Implant":          { a:"#1d4ed8", dark:"#1e3a8a", hi:"rgba(29,78,216,.15)",   emoji:"🔧", short:"IMP" },
  // ── Tooth status ──
  "Missing":          { a:"#475569", dark:"#1e293b", hi:"rgba(71,85,105,.15)",   emoji:"✖",  short:"MIS" },
  "Impacted":         { a:"#9d174d", dark:"#500724", hi:"rgba(157,23,77,.15)",   emoji:"⬇", short:"IPT" },
  "Partially Erupted":{ a:"#64748b", dark:"#334155", hi:"rgba(100,116,139,.15)", emoji:"🌱", short:"PER" },
  "Retained Deciduous": { a:"#525252", dark:"#262626", hi:"rgba(82,82,82,.15)",  emoji:"👶", short:"RTD" },
  "Supernumerary":    { a:"#3f3f46", dark:"#18181b", hi:"rgba(63,63,70,.15)",    emoji:"➕", short:"SUP" },
  "Malposed":         { a:"#4338ca", dark:"#312e81", hi:"rgba(67,56,202,.15)",   emoji:"↪️", short:"MAL" },
  // ── Other ──
  "Other":            { a:"#6366f1", dark:"#312e81", hi:"rgba(99,102,241,.15)",  emoji:"📋", short:"OTH" },
};

/* When a tooth has several findings, the one highest in this list gives
   the tooth its main colour. */
const PRIORITY = [
  "Missing", "Root Stump", "Impacted", "Implant", "Bridge", "Crown", "Veneer", "RC Treated",
  "Periapical Pathology", "Abscess", "Fracture", "Deep Caries", "Pulpitis", "Caries", "Proximal Caries",
  "Root Caries", "Secondary Caries", "Occlusal Pits", "Faulty Restoration", "Restored",
  "Mobility III", "Mobility II", "Mobility I", "Furcation", "Pockets", "Gum Recession", "Gingivitis",
  "Cervical Abrasion", "Attrition", "Erosion", "Hypoplasia", "Fluorosis", "Sensitive Tooth",
  "Partially Erupted", "Retained Deciduous", "Supernumerary", "Malposed", "Food Impaction",
  "Calculus", "Stains", "Other",
];

// Other wordings (Diagnosis panel labels, older "Other" entries) → the chart's own name.
const DIAGNOSIS_CONDITION_ALIASES = {
  "Missing Tooth":   "Missing",
  "Fractured Tooth": "Fracture",
  "Mobile Tooth":    "Mobility I",
  "Impacted Tooth":  "Impacted",
  "Stain":           "Stains",
  "Staining":        "Stains",
  "Tartar":          "Calculus",
  "Interproximal Caries": "Proximal Caries",
  "Proximal Decay":  "Proximal Caries",
  "Pit and Fissure Caries": "Occlusal Pits",
  "Pits and Fissures": "Occlusal Pits",
  "Occlusal Pit":    "Occlusal Pits",
  "Recurrent Caries": "Secondary Caries",
  "Filling":         "Restored",
  "Root Canal Treated": "RC Treated",
};
const KNOWN_BY_LOWER = {};
Object.keys(CMAP).forEach(k => { KNOWN_BY_LOWER[k.toLowerCase()] = k; });
Object.entries(DIAGNOSIS_CONDITION_ALIASES).forEach(([k, v]) => { KNOWN_BY_LOWER[k.toLowerCase()] = v; });
const knownCondition = (label) => KNOWN_BY_LOWER[String(label || "").trim().toLowerCase()] || null;

// Resolves a Diagnosis-panel condition label to the canonical Dental Chart condition
// (aliased where an equivalent already exists, "Other" as a last resort otherwise).
export function resolveDiagnosisCondition(label) {
  if (CMAP[label]) return { condition: label, otherText: "" };
  const known = knownCondition(label);
  if (known) return { condition: known, otherText: "" };
  return { condition: "Other", otherText: label };
}
export { CONDITIONS, CMAP };

const OTHER_PALETTE = [
  "#ef4444","#f97316","#eab308","#84cc16","#22c55e",
  "#14b8a6","#06b6d4","#3b82f6","#6366f1","#8b5cf6",
  "#ec4899","#f43f5e","#d97706","#7c3aed","#0ea5e9",
  "#10b981","#64748b","#dc2626","#0f172a","#374151",
];

/* Surfaces. Stored as before: comma-separated letters, e.g. "M,O,D". */
const SURF_ORDER = ["M","O","I","D","B","L"];
const SURF_FULL = { M:"Mesial", D:"Distal", O:"Occlusal", B:"Buccal / Labial", L:"Lingual / Palatal", I:"Incisal" };

function hexToRgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || ""));
function colorEntryFromHex(hex){
  return { a:hex, dark:hexToRgba(hex,.88), hi:hexToRgba(hex,.15), emoji:"📋", short:"OTH" };
}
function resolveColor(condition,customColor,otherText){
  if(!condition) return null;
  if(condition==="Other"){
    if(isHex(customColor)) return colorEntryFromHex(customColor);
    const known = knownCondition(otherText);          // older "Other: Calculus" entries
    if(known) return CMAP[known];
    return CMAP["Other"];
  }
  return CMAP[condition] || CMAP[knownCondition(condition)] || CMAP["Other"];
}

/* ── Tooth helpers (FDI numbering) ── */
const inChart = (n, chartType) => chartType === "permanent" ? (n >= 11 && n <= 48) : (n >= 51 && n <= 85);
const isAnterior = (n) => (n % 10) <= 3;
const centerCode = (n) => (isAnterior(n) ? "I" : "O");
function toothName(n){
  const q = Math.floor(n / 10), p = n % 10;
  const side = { 1:"Upper right", 2:"Upper left", 3:"Lower left", 4:"Lower right", 5:"Upper right", 6:"Upper left", 7:"Lower left", 8:"Lower right" }[q];
  const kind = q >= 5
    ? { 1:"central incisor", 2:"lateral incisor", 3:"canine", 4:"first molar", 5:"second molar" }[p]
    : { 1:"central incisor", 2:"lateral incisor", 3:"canine", 4:"first premolar", 5:"second premolar", 6:"first molar", 7:"second molar", 8:"third molar" }[p];
  if (!side || !kind) return `Tooth ${n}`;
  return `${side} ${kind}${q >= 5 ? " (deciduous)" : ""}`;
}

/* ── Finding helpers ── */
function parseSurfaces(value){
  const raw = String(value || "").toUpperCase();
  const letters = raw.replace(/[^A-Z]/g, "").split("");
  if (!letters.length || !letters.every(c => SURF_ORDER.includes(c))) return [];
  return SURF_ORDER.filter(c => letters.includes(c));
}
const findingLabel = (r) => (r.condition === "Other" && r.other_text ? r.other_text : r.condition);
const sameFinding = (r, condition, otherText) =>
  String(r.condition || "").toLowerCase() === String(condition || "").toLowerCase() &&
  (String(condition).toLowerCase() !== "other" ||
    String(r.other_text || "").trim().toLowerCase() === String(otherText || "").trim().toLowerCase());

/* Server rows → rows the chart can work with. The server sends tooth numbers
   as text ("16"); everything in here compares them as numbers. */
function normalize(raw){
  const byId = new Map();                       // the same row listed twice counts once
  (Array.isArray(raw) ? raw : []).forEach((r, i) => { if (r) byId.set(r.id != null ? `id-${r.id}` : `row-${i}`, r); });
  return [...byId.values()]
    .map(r => {
      const label = findingLabel(r);
      const known = r.condition === "Other" ? (knownCondition(r.other_text) || "Other") : (knownCondition(r.condition) || r.condition);
      const rank = PRIORITY.indexOf(known);
      return {
        ...r,
        tooth_number: Number(r.tooth_number),
        _label: label,
        _known: known,
        _cm: resolveColor(r.condition, r.custom_color, r.other_text),
        _surf: parseSurfaces(r.surface),
        _rank: rank < 0 ? PRIORITY.length : rank,
      };
    })
    .filter(r => Number.isFinite(r.tooth_number))
    .sort((a, b) => a._rank - b._rank || (a.id || 0) - (b.id || 0));
}
const formatDate = (d) => {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }); }
  catch { return ""; }
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ═══════════════════════════════════════════════════════
   TOOTH PATHS
═══════════════════════════════════════════════════════ */
function pathMolar(w,h,r){
  return [`M ${-w/2+r} ${-h/2}`,`L ${w/2-r} ${-h/2} Q ${w/2} ${-h/2} ${w/2} ${-h/2+r}`,
    `L ${w/2} ${h/2-r} Q ${w/2} ${h/2} ${w/2-r} ${h/2}`,
    `L ${-w/2+r} ${h/2} Q ${-w/2} ${h/2} ${-w/2} ${h/2-r}`,
    `L ${-w/2} ${-h/2+r} Q ${-w/2} ${-h/2} ${-w/2+r} ${-h/2} Z`].join(' ');
}
function pathCentral(w,h){
  const hw=w/2,hh=h/2;
  return [`M ${-hw+3} ${hh}`,`C ${-hw} ${hh} ${-hw} ${-hh+8} ${-hw+2} ${-hh+2}`,
    `C ${-hw+5} ${-hh} ${-3} ${-hh-1} 0 ${-hh-1}`,`C ${3} ${-hh-1} ${hw-5} ${-hh} ${hw-2} ${-hh+2}`,
    `C ${hw} ${-hh+8} ${hw} ${hh} ${hw-3} ${hh}`,'Z'].join(' ');
}
function pathLateral(w,h){
  const hw=w/2,hh=h/2;
  return [`M ${-hw+3} ${hh}`,`C ${-hw} ${hh} ${-hw} ${-hh+7} ${-hw+3} ${-hh+1}`,
    `C ${-hw+6} ${-hh-1} ${hw-6} ${-hh-1} ${hw-3} ${-hh+1}`,
    `C ${hw} ${-hh+7} ${hw} ${hh} ${hw-3} ${hh}`,'Z'].join(' ');
}
function pathCanine(w,h){
  const hw=w/2,hh=h/2;
  return [`M ${-hw+3} ${hh}`,`C ${-hw} ${hh} ${-hw} ${-hh+12} ${-hw+3} ${-hh+4}`,
    `C ${-hw+5} ${-hh+1} ${-3} ${-hh-3} 0 ${-hh-4}`,`C ${3} ${-hh-3} ${hw-5} ${-hh+1} ${hw-3} ${-hh+4}`,
    `C ${hw} ${-hh+12} ${hw} ${hh} ${hw-3} ${hh}`,'Z'].join(' ');
}
function pathPremolar(w,h){
  const hw=w/2,hh=h/2;
  return [`M ${-hw+4} ${hh}`,`C ${-hw} ${hh} ${-hw} ${-hh+9} ${-hw+3} ${-hh+2}`,
    `C ${-hw+7} ${-hh-2} ${-3} ${-hh-3} 0 ${-hh-3}`,`C ${3} ${-hh-3} ${hw-7} ${-hh-2} ${hw-3} ${-hh+2}`,
    `C ${hw} ${-hh+9} ${hw} ${hh} ${hw-4} ${hh}`,'Z'].join(' ');
}
function toothShape(num){
  const n=num%10;
  if(num>=51&&num<=85){
    const s=n>=4?{w:38,h:34,r:12}:n===3?{w:30,h:36,r:12}:{w:25,h:30,r:10};
    return { path:pathMolar(s.w,s.h,s.r), w:s.w, h:s.h };
  }
  if(n===1){const w=31,h=42;return{path:pathCentral(w,h),w,h};}
  if(n===2){const w=26,h=38;return{path:pathLateral(w,h),w,h};}
  if(n===3){const w=29,h=44;return{path:pathCanine(w,h),w,h};}
  if(n===4||n===5){const w=34,h=37;return{path:pathPremolar(w,h),w,h};}
  const ms=n===8?{w:44,h:36,r:13}:n===7?{w:43,h:35,r:13}:{w:42,h:34,r:12};
  return{path:pathMolar(ms.w,ms.h,ms.r),w:ms.w,h:ms.h};
}

/* ═══════════════════════════════════════════════════════
   ARCH LAYOUT — pronounced U-shape
═══════════════════════════════════════════════════════ */
function buildArch(isDeciduous){
  const W=680, CX=W/2;
  const A=isDeciduous?180:228;
  const B=isDeciduous?178:222;
  const P=isDeciduous?1.28:1.22;

  const cv=t=>B*Math.pow(Math.sin(t*Math.PI),1/P);
  const cxAt=t=>CX-A*Math.cos(t*Math.PI);

  function radialDeg(t,ySign){
    const dxdt=A*Math.PI*Math.sin(t*Math.PI);
    const sa=Math.sin(t*Math.PI);
    const dcdt=sa<1e-9?0:B*Math.PI*(1/P)*Math.pow(sa,1/P-1)*Math.cos(t*Math.PI);
    const dydt=ySign*dcdt;
    return Math.atan2(dxdt,-dydt)*180/Math.PI-90;
  }

  function placeTeeth(nums,ySign,GAP){
    const K=1200,lens=[0];
    for(let i=1;i<=K;i++){
      const t0=(i-1)/K,t1=i/K;
      const dx=cxAt(t1)-cxAt(t0),dy=ySign*cv(t1)-ySign*cv(t0);
      lens.push(lens[i-1]+Math.hypot(dx,dy));
    }
    const N=nums.length;
    const widths=nums.map(n=>toothShape(n).w);
    const totalW=widths.reduce((a,b)=>a+b,0);
    const gapEach=Math.max(GAP,(lens[K]-totalW)/(N-1));
    const tAt=s=>{
      let lo=0,hi=K;
      while(lo<hi-1){const m=(lo+hi)>>1;lens[m]<=s?(lo=m):(hi=m);}
      const f=lens[lo+1]>lens[lo]?(s-lens[lo])/(lens[lo+1]-lens[lo]):0;
      return Math.min(1,Math.max(0,(lo+f)/K));
    };
    const ts=[];let cursor=widths[0]/2;
    for(let j=0;j<N;j++){
      ts.push(tAt(cursor));
      if(j<N-1)cursor+=widths[j]/2+gapEach+widths[j+1]/2;
    }
    return ts;
  }

  const BASE_U=isDeciduous?210:268;
  const SEP=isDeciduous?62:82;
  const BASE_L=BASE_U+SEP;

  const upNums=isDeciduous?[55,54,53,52,51,61,62,63,64,65]:[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
  const loNums=isDeciduous?[85,84,83,82,81,71,72,73,74,75]:[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

  const teeth=[];
  placeTeeth(upNums,-1,5).forEach((t,i)=>{
    teeth.push({num:upNums[i],x:cxAt(t),y:BASE_U-cv(t),rot:radialDeg(t,-1),isUpper:true});
  });
  placeTeeth(loNums,+1,5).forEach((t,i)=>{
    teeth.push({num:loNums[i],x:cxAt(t),y:BASE_L+cv(t),rot:radialDeg(t,+1)+180,isUpper:false});
  });

  const ys=teeth.map(t=>t.y),minY=Math.min(...ys),shift=minY<30?30-minY:0;
  teeth.forEach(t=>{t.y+=shift;});
  return{teeth,W,H:Math.max(...teeth.map(t=>t.y))+58,CX};
}

/* Which side of each tooth is mesial / buccal on screen, worked out from the
   arch itself (so the surface bands always sit on the correct side). */
function orientArch(arch){
  const half = arch.teeth.length / 2;
  const annotate = (row) => {
    const cx = row.reduce((s,t)=>s+t.x,0)/row.length;
    const cy = row.reduce((s,t)=>s+t.y,0)/row.length;
    const mid = row.length / 2;
    row.forEach((t,i)=>{
      const th = t.rot * Math.PI / 180;
      const ax = [Math.cos(th), Math.sin(th)];        // tooth's own +x on screen
      const ay = [-Math.sin(th), Math.cos(th)];       // tooth's own +y on screen
      const nb = row[i < mid ? i + 1 : i - 1];        // neighbour towards the midline
      t.mesial = (ax[0]*(nb.x-t.x) + ax[1]*(nb.y-t.y)) >= 0 ? 1 : -1;
      t.buccal = (ay[0]*(t.x-cx) + ay[1]*(t.y-cy)) >= 0 ? 1 : -1;   // away from the arch centre
    });
  };
  annotate(arch.teeth.slice(0, half));
  annotate(arch.teeth.slice(half));
  return arch;
}

/* ═══════════════════════════════════════════════════════
   TOOTH SVG
   findings = this tooth's findings, most important first.
═══════════════════════════════════════════════════════ */
let clipSeq = 0;

function ToothSVG({t,findings,clipPrefix,onClick,isSelected,isMarked,dim}){
  const {num,x,y,rot,mesial,buccal}=t;
  const{path,w,h}=toothShape(num);
  const fs=w>30?11:w>22?10:9;
  const clipId=`${clipPrefix}-${num}`;

  const missing=findings.find(f=>f._known==="Missing");
  const top=findings[0]||null;                               // the main (most important) finding
  const whole=top&&top._surf.length===0?top:null;            // it colours the tooth unless it is limited to surfaces
  const withSurf=findings.filter(f=>f._surf.length>0);

  let fill="#ffffff",stroke="#9aa6b8",dash=undefined;
  if(missing){fill="#eef1f5";stroke="#64748b";dash="3 2.5";}
  else if(whole){fill=whole._cm.a;stroke=whole._cm.dark;}
  else if(top){stroke=top._cm.dark;}

  const centreBand=!missing&&withSurf.some(f=>f._surf.includes("O")||f._surf.includes("I"));
  const filled=Boolean(!missing&&whole);
  const txtC=filled||centreBand?"#fff":"#1f2937";

  const sevKey=findings.reduce((best,f)=>(SEV_RANK[f.severity]||0)>(SEV_RANK[best]||0)?f.severity:best,"");
  const sevColor=SEV_STYLE[sevKey]?.ring||null;

  // Surface bands, drawn inside the tooth outline.
  const tb=Math.max(6,Math.min(w,h)*0.26);
  const bands=[];
  if(!missing){
    [...withSurf].reverse().forEach(f=>{
      f._surf.forEach(s=>{
        const key=`${f.id}-${s}`;
        const paint={fill:f._cm.a,stroke:"#fff",strokeWidth:0.8};
        if(s==="B") bands.push(<rect key={key} {...paint} x={-w/2-4} y={buccal<0?-h/2-6:h/2-tb} width={w+8} height={tb+6}/>);
        if(s==="L") bands.push(<rect key={key} {...paint} x={-w/2-4} y={buccal<0?h/2-tb:-h/2-6} width={w+8} height={tb+6}/>);
        if(s==="M") bands.push(<rect key={key} {...paint} x={mesial>0?w/2-tb:-w/2-6} y={-h/2-6} width={tb+6} height={h+12}/>);
        if(s==="D") bands.push(<rect key={key} {...paint} x={mesial>0?-w/2-6:w/2-tb} y={-h/2-6} width={tb+6} height={h+12}/>);
        if(s==="O"||s==="I") bands.push(<circle key={key} {...paint} cy={-1} r={Math.max(8.5,Math.min(w,h)*0.27)}/>);
      });
    });
  }

  // One small dot per finding when there is more than one.
  const pips=findings.length>1?findings.slice(0,4):[];
  const pipY=buccal<0?-h/2-9:h/2+9;

  const summary=findings.length
    ? findings.map(f=>`${f._label}${f._surf.length?` (${f._surf.join("")})`:""}${f.severity?` – ${f.severity}`:""}`).join("; ")
    : "no findings";

  return(
    <g className={`dc-tooth-g${dim?" dim":""}`}
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)})`}
      role="button" tabIndex={0}
      aria-label={`Tooth ${num}, ${toothName(num)}: ${summary}`}
      onClick={()=>onClick(num)}
      onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onClick(num);}}}>
      <title>{`${num} · ${toothName(num)}\n${summary}`}</title>

      <defs><clipPath id={clipId}><path d={path}/></clipPath></defs>

      {sevColor&&(
        <ellipse rx={w/2+5} ry={h/2+5} fill="none" stroke={sevColor} strokeWidth={2} strokeDasharray="4 3" opacity={0.75}/>
      )}
      {isMarked&&!isSelected&&(
        <ellipse rx={w/2+7} ry={h/2+7} fill="none" stroke="#16a34a" strokeWidth={2.2} opacity={0.85}/>
      )}
      {isSelected&&(
        <ellipse rx={w/2+7} ry={h/2+7} fill="none" stroke="#1a56db" strokeWidth={2.5} opacity={0.85}/>
      )}
      <ellipse className="dc-focus-ring" rx={w/2+8} ry={h/2+8} fill="none" stroke="#0d1b2a" strokeWidth={2} strokeDasharray="2 2"/>

      {/* Shadow + body */}
      <path d={path} transform="translate(0.5,1.5)" fill="rgba(0,0,0,0.10)"/>
      <path className="dc-tooth-body" d={path} fill={fill} stroke="none"/>

      {/* Surface bands */}
      {bands.length>0&&<g clipPath={`url(#${clipId})`}>{bands}</g>}

      {/* Outline on top so bands never spill over it */}
      <path d={path} fill="none" stroke={stroke} strokeWidth={findings.length?1.4:1} strokeLinejoin="round" strokeDasharray={dash}/>

      {/* Missing X */}
      {missing&&(
        <g opacity={0.7}>
          <line x1={-w*.26} y1={-h*.26} x2={w*.26} y2={h*.26} stroke="#475569" strokeWidth={1.8} strokeLinecap="round"/>
          <line x1={w*.26}  y1={-h*.26} x2={-w*.26} y2={h*.26} stroke="#475569" strokeWidth={1.8} strokeLinecap="round"/>
        </g>
      )}

      {/* Number */}
      <text x={0} y={(findings.length===1&&!missing)||centreBand?-1.5:0} textAnchor="middle" dominantBaseline="middle"
        fontSize={fs} fontWeight="600" fontFamily="'DM Mono','Courier New',monospace"
        fill={txtC} transform={`rotate(${(-rot).toFixed(1)})`}
        pointerEvents="none" style={{userSelect:"none"}}>{num}</text>

      {/* Short code when the tooth has exactly one finding (and room for it) */}
      {findings.length===1&&!missing&&!centreBand&&(
        <text x={0} y={h*0.31} textAnchor="middle" dominantBaseline="middle"
          fontSize={6.4} fontWeight="700" fontFamily="'DM Mono','Courier New',monospace"
          fill={filled?"rgba(255,255,255,0.9)":top._cm.dark}
          transform={`rotate(${(-rot).toFixed(1)})`}
          pointerEvents="none" style={{userSelect:"none"}}>{top._cm.short}</text>
      )}

      {/* Dots: one per finding */}
      {pips.map((f,i)=>(
        <circle key={f.id} cx={(i-(pips.length-1)/2)*7.6} cy={pipY} r={3.2}
          fill={f._cm.a} stroke="#fff" strokeWidth={1}/>
      ))}
      {findings.length>4&&(
        <text x={(pips.length-1)/2*7.6+9} y={pipY} dominantBaseline="middle" fontSize={7} fontWeight="700" fill="#4a5568"
          pointerEvents="none">+</text>
      )}
    </g>
  );
}

/* ═══════════════════════════════════════════════════════
   DENTAL DIAGRAM
═══════════════════════════════════════════════════════ */
function DentalDiagram({findings,chartType,onToothClick,selectedTooth,markedTeeth,focus}){
  const isDeciduous=chartType==="deciduous";
  const arch=useMemo(()=>orientArch(buildArch(isDeciduous)),[isDeciduous]);
  const[clipPrefix]=useState(()=>`dc-clip-${++clipSeq}`);
  const{teeth,W,H,CX}=arch;

  const byTooth={};
  findings.forEach(f=>{(byTooth[f.tooth_number]=byTooth[f.tooth_number]||[]).push(f);});
  const upperBottom=Math.max(...teeth.filter(t=>t.isUpper).map(t=>t.y));
  const lowerTop=Math.min(...teeth.filter(t=>!t.isUpper).map(t=>t.y));
  const midY=(upperBottom+lowerTop)/2;

  return(
    <div className="dc-chart-inner">
      <svg viewBox={`0 0 ${W} ${H}`} style={{maxWidth:Math.round(W*1.22)}} role="group"
        aria-label={`${isDeciduous?"Deciduous":"Permanent"} teeth chart. Patient's right is on the left of the picture.`}>
        <line x1={CX} y1={10} x2={CX} y2={H-10} stroke="rgba(26,86,219,0.14)" strokeWidth={1} strokeDasharray="5 4"/>

        {[{t:"UR",x:CX-8,y:13,a:"end"},{t:"UL",x:CX+8,y:13,a:"start"},
          {t:"LR",x:CX-8,y:H-5,a:"end"},{t:"LL",x:CX+8,y:H-5,a:"start"}].map(q=>(
          <text key={q.t} x={q.x} y={q.y} textAnchor={q.a} className="dc-qlabel">{q.t}</text>
        ))}
        <text x={CX} y={midY-7} textAnchor="middle" className="dc-sidelabel">UPPER</text>
        <text x={CX} y={midY+15} textAnchor="middle" className="dc-sidelabel">LOWER</text>
        <text x={12} y={midY+4} textAnchor="start" className="dc-sidelabel">RIGHT</text>
        <text x={W-12} y={midY+4} textAnchor="end" className="dc-sidelabel">LEFT</text>

        {teeth.map(t=>{
          const list=byTooth[t.num]||[];
          const dim=Boolean(focus)&&!list.some(f=>f._label.toLowerCase()===focus);
          return(
            <ToothSVG key={t.num} t={t} findings={list} clipPrefix={clipPrefix}
              onClick={onToothClick}
              isSelected={selectedTooth===t.num}
              isMarked={markedTeeth.has(t.num)}
              dim={dim}/>
          );
        })}
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SMALL SHARED PIECES
═══════════════════════════════════════════════════════ */
function ConditionPill({cm,label,small}){
  return(
    <span className="dc-pill" style={{background:cm.a,boxShadow:`0 2px 8px ${hexToRgbaSafe(cm.a,.27)}`,
      ...(small?{padding:"3px 10px",fontSize:11.5}:{})}}>
      <span aria-hidden="true">{cm.emoji}</span> {label}
    </span>
  );
}
function hexToRgbaSafe(c,a){ return isHex(c)?hexToRgba(c,a):"rgba(0,0,0,.15)"; }

function SeverityTag({value}){
  const sv=SEV_STYLE[value];
  if(!sv) return null;
  return <span className="dc-sev-tag" style={{background:sv.bg,color:sv.col,border:`1px solid ${sv.bdr}`}}>{value}</span>;
}

/* Searchable list of conditions in alphabetical order.
   taken = labels already on the tooth (shown, but cannot be picked again). */
function ConditionPicker({value,onPick,taken,autoFocus}){
  const[q,setQ]=useState("");
  const needle=q.trim().toLowerCase();
  const items=CONDITIONS.filter(c=>!needle||c.toLowerCase().includes(needle));

  return(
    <div>
      <input className="dc-search" type="search" placeholder="Search conditions… (e.g. calculus, caries, crown)"
        aria-label="Search conditions" value={q} autoFocus={autoFocus}
        onChange={e=>setQ(e.target.value)}/>
      {items.length===0&&(
        <div className="dc-notice dc-notice-info" style={{marginTop:0}}>
          Nothing matches “{q}”. Clear the search and choose <b>Other</b> to type your own description.
        </div>
      )}
      <div className="dc-cond-grid" role="group" aria-label="Conditions, A to Z">
        {items.map(c=>{
          const cm=CMAP[c];
          const sel=value===c;
          const isTaken=c!=="Other"&&!sel&&taken&&taken.has(c.toLowerCase());
          return(
            <button key={c} type="button" className="dc-cond-btn"
              aria-pressed={sel} disabled={isTaken}
              title={isTaken?"Already recorded on this tooth":undefined}
              style={sel?{background:cm.a,color:"#fff",borderColor:cm.dark}:{borderColor:hexToRgba(cm.a,.25),color:cm.dark}}
              onClick={()=>onPick(c)}>
              <span className="dc-cond-dot" style={{background:sel?"#fff":cm.a}}/>
              {c}
              {isTaken&&<span className="dc-cond-tag">✓ on tooth</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OtherFields({text,color,onText,onColor,autoFocus}){
  return(
    <div className="dc-other-panel">
      <label className="dc-field-label" style={{color:"#4f46e5"}} htmlFor="dc-other-text">Describe the condition</label>
      <input id="dc-other-text" className="dc-input" placeholder="Type the condition name…" maxLength={200}
        value={text} autoFocus={autoFocus} onChange={e=>onText(e.target.value)}/>
      <div className="dc-palette" role="radiogroup" aria-label="Colour on the chart">
        {OTHER_PALETTE.map(hex=>(
          <button key={hex} type="button" className={`dc-pdot${color===hex?" sel":""}`}
            role="radio" aria-checked={color===hex} aria-label={`Colour ${hex}`}
            style={{background:hex}} onClick={()=>onColor(hex)}/>
        ))}
      </div>
    </div>
  );
}

function SeverityPicker({value,onChange}){
  return(
    <div className="dc-severity-row" role="group" aria-label="Severity">
      {SEVERITY_LEVELS.map(sv=>(
        <button key={sv.key} type="button" aria-pressed={value===sv.key}
          className={`dc-sev-btn ${sv.cls}${value===sv.key?" active":""}`}
          onClick={()=>onChange(value===sv.key?"":sv.key)}>
          {sv.label}
        </button>
      ))}
    </div>
  );
}

/* Five-surface picture of a tooth. centre = "O", "I", or "O/I" when several
   teeth are being marked at once (each tooth then gets the right one). */
function SurfacePicker({value,onChange,centre}){
  const centreCode=centre==="I"?"I":"O";
  const has=c=>value.includes(c);
  const toggle=c=>onChange(has(c)?value.filter(x=>x!==c):SURF_ORDER.filter(x=>has(x)||x===c));
  const zones=[
    {c:"B",pts:"6,6 94,6 68,32 32,32",lx:50,ly:20,name:SURF_FULL.B},
    {c:"L",pts:"6,94 94,94 68,68 32,68",lx:50,ly:82,name:SURF_FULL.L},
    {c:"M",pts:"6,6 32,32 32,68 6,94",lx:19,ly:51,name:SURF_FULL.M},
    {c:"D",pts:"94,6 94,94 68,68 68,32",lx:81,ly:51,name:SURF_FULL.D},
    {c:centreCode,pts:"32,32 68,32 68,68 32,68",lx:50,ly:51,
      name:centre==="O/I"?"Occlusal / Incisal":SURF_FULL[centreCode],letter:centre==="O/I"?"O/I":centreCode},
  ];
  return(
    <div className="dc-surf-wrap">
      <svg viewBox="0 0 100 100" width={104} height={104} role="group" aria-label="Affected surfaces">
        {zones.map(z=>(
          <g key={z.c}>
            <polygon className={`dc-surf-zone${has(z.c)?" on":""}`} points={z.pts}
              fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1.4} strokeLinejoin="round"
              role="checkbox" aria-checked={has(z.c)} aria-label={z.name} tabIndex={0}
              onClick={()=>toggle(z.c)}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle(z.c);}}}/>
            <text className={`dc-surf-letter${has(z.c)?" on":""}`} x={z.lx} y={z.ly}
              textAnchor="middle" dominantBaseline="middle"
              style={z.letter==="O/I"?{fontSize:10}:undefined}>{z.letter||z.c}</text>
          </g>
        ))}
      </svg>
      <div className="dc-surf-list">
        {value.length===0
          ? <span style={{color:"var(--dc-text3)"}}>Click the picture to mark surfaces.<br/>Leave empty for the whole tooth.</span>
          : zones.filter(z=>has(z.c)).map(z=><div key={z.c}><b>{z.letter||z.c}</b> — {z.name}</div>)}
      </div>
    </div>
  );
}

/* Pop-up windows are attached to <body>. Inside the page they sit under an
   animated card, and an animated/transformed parent makes "position: fixed"
   centre on that card instead of on the screen. */
const inBody = (node) => (typeof document !== "undefined" ? createPortal(node, document.body) : node);

function ConfirmDialog({title,body,confirmLabel="Delete",busy,onCancel,onConfirm}){
  const cancelRef=useRef(null);
  useEffect(()=>{cancelRef.current?.focus();},[]);
  useEffect(()=>{
    const onKey=e=>{if(e.key==="Escape"&&!busy)onCancel();};
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[busy]);
  return inBody(
    <div className="dc-overlay" style={{zIndex:9100}} onClick={()=>!busy&&onCancel()}>
      <div className="dc-modal dc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dc-confirm-title"
        onClick={e=>e.stopPropagation()}>
        <h4 id="dc-confirm-title">{title}</h4>
        <p>{body}</p>
        <div className="dc-actions">
          <button ref={cancelRef} type="button" className="dc-btn dc-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="dc-btn dc-btn-danger" disabled={busy} onClick={onConfirm}>
            {busy?"Deleting…":confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* One finding, as shown in the tooth window and in the log. */
function FindingRow({f,showTooth,disabled,busy,onEdit,onDelete,onOpenTooth}){
  const cm=f._cm;
  return(
    <div className="dc-frow">
      {showTooth&&(
        <button type="button" className="dc-tooth-badge" title={`Open tooth ${f.tooth_number}`}
          style={{borderColor:hexToRgbaSafe(cm.a,.45),color:cm.dark,background:cm.hi}}
          onClick={()=>onOpenTooth(f.tooth_number)}>{f.tooth_number}</button>
      )}
      <div className="dc-frow-main">
        <div className="dc-frow-line">
          {!showTooth&&<ConditionPill cm={cm} label={f._label} small/>}
          {f._surf.length>0&&<span className="dc-surf-tag" title={f._surf.map(s=>SURF_FULL[s]).join(", ")}>{f._surf.join("")}</span>}
          {f._surf.length===0&&f.surface&&<span className="dc-surf-tag">{f.surface}</span>}
          <SeverityTag value={f.severity}/>
          {showTooth&&f._surf.length===0&&!f.surface&&!f.severity&&!f.notes&&(
            <span style={{fontSize:11.5,color:"var(--dc-text3)"}}>Whole tooth</span>
          )}
          <span className="dc-date" style={{marginLeft:"auto"}}>{formatDate(f.created_at||f.updated_at)}</span>
        </div>
        {f.notes&&<div className="dc-frow-notes">“{f.notes}”</div>}
      </div>
      {!disabled&&(
        <div className="dc-frow-actions">
          <button type="button" className="dc-btn dc-btn-soft dc-btn-sm" disabled={busy}
            aria-label={`Edit ${f._label} on tooth ${f.tooth_number}`} onClick={()=>onEdit(f)}>Edit</button>
          <button type="button" className="dc-btn dc-btn-danger-soft dc-btn-sm" disabled={busy}
            aria-label={`Delete ${f._label} on tooth ${f.tooth_number}`} onClick={()=>onDelete(f)}>Delete</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FINDING FORM — "Add finding" or "Edit finding" for ONE tooth
═══════════════════════════════════════════════════════ */
function FindingForm({tooth,initial,othersOnTooth,saving,error,onSubmit,onCancel}){
  const isEdit=Boolean(initial);
  const centre=centerCode(tooth);
  // A stored name that is not on today's list (older data) opens as its
  // current equivalent, or as "Other" with the stored name as the text.
  const initCond=initial?(CMAP[initial.condition]?initial.condition:(knownCondition(initial.condition)||"Other")):"";
  const[condition,setCondition]=useState(initCond);
  const[otherText,setOtherText]=useState(
    !initial?"":initial.condition==="Other"?(initial.other_text||""):(initCond==="Other"?initial.condition:""));
  const[otherColor,setOtherColor]=useState(isHex(initial?.custom_color)?initial.custom_color:OTHER_PALETTE[8]);
  const[severity,setSeverity]=useState(initial?.severity||"");
  const[surfaces,setSurfaces]=useState(()=>
    (initial?._surf||[]).map(s=>(s==="O"||s==="I")?centre:s).filter((s,i,a)=>a.indexOf(s)===i));
  const[notes,setNotes]=useState(initial?.notes||"");
  const[localError,setLocalError]=useState("");

  const isOther=condition==="Other";
  const taken=useMemo(()=>new Set(othersOnTooth.map(f=>f._label.toLowerCase())),[othersOnTooth]);

  const pick=c=>{
    setCondition(c);setLocalError("");
    // Sensible starting surface, only when none has been chosen yet.
    const def=CMAP[c]?.surf;
    if(def&&surfaces.length===0&&!isEdit) setSurfaces(def.map(s=>(s==="O"||s==="I")?centre:s));
  };

  const submit=()=>{
    if(!condition){setLocalError("Choose a condition first.");return;}
    if(isOther&&!otherText.trim()){setLocalError("Type a description for “Other”.");return;}
    const label=(isOther?otherText.trim():condition).toLowerCase();
    if(taken.has(label)){
      setLocalError(`Tooth ${tooth} already has “${isOther?otherText.trim():condition}”. Edit that entry instead of adding it twice.`);
      return;
    }
    onSubmit({
      condition,severity,
      surface:SURF_ORDER.filter(s=>surfaces.includes(s)).join(","),
      notes:notes.trim(),
      other_text:isOther?otherText.trim():"",
      custom_color:isOther?otherColor:"",
    });
  };

  const shown=localError||error;
  return(
    <div className={`dc-form ${isEdit?"dc-form-edit":"dc-form-add"}`} role="group"
      aria-label={isEdit?"Edit finding":"Add finding"}>
      <p className="dc-form-title">{isEdit?`Edit finding — ${initial._label}`:"Add finding"}</p>
      <p className="dc-form-hint">
        {isEdit
          ? "Only this finding is changed. The tooth's other findings stay as they are."
          : `Adds a new finding to tooth ${tooth}. Findings already on the tooth are kept.`}
      </p>

      <div className="dc-field-group">
        <span className="dc-field-label">Condition</span>
        <ConditionPicker value={condition} onPick={pick} taken={taken}/>
        {isOther&&<OtherFields text={otherText} color={otherColor} onText={v=>{setOtherText(v);setLocalError("");}} onColor={setOtherColor} autoFocus={!isEdit}/>}
      </div>

      <div className="dc-opt-grid" style={{marginTop:0,paddingTop:0,borderTop:"none"}}>
        <div>
          <span className="dc-field-label">Surfaces (optional)</span>
          <SurfacePicker value={surfaces} onChange={setSurfaces} centre={centre}/>
        </div>
        <div>
          <div className="dc-field-group">
            <span className="dc-field-label">Severity (optional)</span>
            <SeverityPicker value={severity} onChange={setSeverity}/>
          </div>
          <label className="dc-field-label" htmlFor="dc-notes">Clinical notes (optional)</label>
          <textarea id="dc-notes" className="dc-notes-ta" placeholder="Observations, plan, follow-up…"
            value={notes} onChange={e=>setNotes(e.target.value)}/>
        </div>
      </div>

      {shown&&<div className="dc-notice dc-notice-error" role="alert">{shown}</div>}

      <div className="dc-actions" style={{marginTop:14}}>
        <button type="button" className="dc-btn dc-btn-ghost" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="button" className={`dc-btn ${isEdit?"dc-btn-update":"dc-btn-primary"}`} disabled={saving} onClick={submit}>
          {saving?"Saving…":isEdit?"Update finding":"Add finding"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TOOTH WINDOW — everything recorded on one tooth
═══════════════════════════════════════════════════════ */
function ToothModal({tooth,findings,disabled,startEditId,saving,error,escEnabled,onSave,onAskDelete,onClearError,onClose}){
  // form = null (closed) | "new" | <finding id being edited>
  const[form,setForm]=useState(()=>startEditId||(findings.length===0&&!disabled?"new":null));
  const editing=form&&form!=="new"?findings.find(f=>f.id===form):null;

  useEffect(()=>{
    if(!escEnabled)return undefined;
    const onKey=e=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[escEnabled]);
  // The finding being edited was deleted (here or on another screen): close its form.
  useEffect(()=>{if(form&&form!=="new"&&!editing)setForm(null);},[form,editing]);

  const open=v=>{onClearError();setForm(v);};

  return inBody(
    <div className="dc-overlay" onClick={onClose}>
      <div className="dc-modal" role="dialog" aria-modal="true" aria-labelledby="dc-tooth-title" onClick={e=>e.stopPropagation()}>
        <div className="dc-modal-top">
          <div className="dc-modal-badge">{tooth}</div>
          <div>
            <div className="dc-modal-title" id="dc-tooth-title">Tooth {tooth}</div>
            <div className="dc-modal-sub">{toothName(tooth)} · {findings.length===0?"no findings":plural(findings.length,"finding","findings")}</div>
          </div>
          <button type="button" className="dc-close-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="dc-modal-scroll">
          <div className="dc-section-title">
            Findings on this tooth
            {!disabled&&form===null&&(
              <button type="button" className="dc-btn dc-btn-primary dc-btn-sm" style={{marginLeft:"auto"}} onClick={()=>open("new")}>
                + Add finding
              </button>
            )}
          </div>

          {findings.length===0&&form===null&&(
            <div className="dc-log-empty" style={{padding:"20px 12px"}}>Nothing recorded on this tooth.</div>
          )}

          {findings.map(f=>(
            form===f.id
              ? <FindingForm key={f.id} tooth={tooth} initial={f}
                  othersOnTooth={findings.filter(o=>o.id!==f.id)}
                  saving={saving} error={error}
                  onSubmit={fields=>onSave(tooth,f,fields,()=>setForm(null))}
                  onCancel={()=>open(null)}/>
              : <FindingRow key={f.id} f={f} disabled={disabled} busy={saving||form!==null}
                  onEdit={()=>open(f.id)} onDelete={onAskDelete}/>
          ))}

          {form==="new"&&(
            <FindingForm tooth={tooth} initial={null} othersOnTooth={findings}
              saving={saving} error={error}
              onSubmit={fields=>onSave(tooth,null,fields,()=>setForm(null))}
              onCancel={()=>findings.length===0?onClose():open(null)}/>
          )}

          {form===null&&(
            <div className="dc-actions" style={{marginTop:16}}>
              <button type="button" className="dc-btn dc-btn-ghost" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUICK MARK — one condition, many teeth
═══════════════════════════════════════════════════════ */
function QuickMarkBar({quick,setQuick,marked,notice,onUndo,onDone}){
  if(!quick) return null;

  // Step 1: choose the condition
  if(!quick.condition){
    return(
      <div className="dc-panel dc-mode">
        <div className="dc-mode-row" style={{marginBottom:12}}>
          <span className="dc-mode-hint"><b>Quick mark</b> — choose a condition, then click every tooth that has it.</span>
          <button type="button" className="dc-btn dc-btn-ghost dc-btn-sm" style={{marginLeft:"auto"}} onClick={onDone}>Cancel</button>
        </div>
        <ConditionPicker value="" autoFocus
          onPick={c=>setQuick(q=>({...q,condition:c,surfaces:CMAP[c]?.surf?[...CMAP[c].surf]:[]}))}/>
      </div>
    );
  }

  // Step 2: click teeth
  const isOther=quick.condition==="Other";
  const cm=resolveColor(quick.condition,isOther?quick.otherColor:null);
  const label=isOther?(quick.otherText.trim()||"Other"):quick.condition;
  const ready=!isOther||quick.otherText.trim().length>0;

  return(
    <div className="dc-panel dc-mode dc-mode-active" style={{"--dc-qm":cm.a}}>
      <div className="dc-mode-row">
        <ConditionPill cm={cm} label={label}/>
        <span className="dc-mode-hint">
          {ready
            ? <><b>Click teeth on the chart</b> to mark them. Each click is saved straight away.</>
            : <>Type a description below, then click teeth.</>}
        </span>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button type="button" className="dc-btn dc-btn-ghost dc-btn-sm"
            onClick={()=>setQuick(q=>({...q,condition:"",surfaces:[]}))}>Change condition</button>
          <button type="button" className="dc-btn dc-btn-primary dc-btn-sm" onClick={onDone}>Done</button>
        </div>
      </div>

      {isOther&&(
        <OtherFields text={quick.otherText} color={quick.otherColor} autoFocus
          onText={v=>setQuick(q=>({...q,otherText:v}))} onColor={v=>setQuick(q=>({...q,otherColor:v}))}/>
      )}

      <div className="dc-opt-grid">
        <div>
          <span className="dc-field-label">Surfaces for every tooth you click (optional)</span>
          <SurfacePicker value={quick.surfaces} centre="O/I" onChange={v=>setQuick(q=>({...q,surfaces:v}))}/>
        </div>
        <div>
          <div className="dc-field-group">
            <span className="dc-field-label">Severity (optional)</span>
            <SeverityPicker value={quick.severity} onChange={v=>setQuick(q=>({...q,severity:v}))}/>
          </div>
          <label className="dc-field-label" htmlFor="dc-quick-notes">Notes (optional)</label>
          <input id="dc-quick-notes" className="dc-input" placeholder="Same note for every tooth you click"
            value={quick.notes} onChange={e=>setQuick(q=>({...q,notes:e.target.value}))}/>
        </div>
      </div>

      {marked.length>0&&(
        <div className="dc-marked" aria-label="Teeth marked just now">
          <span className="dc-field-label" style={{margin:0}}>Marked just now:</span>
          {marked.map(m=>(
            <span key={m.tooth} className="dc-marked-chip">
              {m.tooth}
              {m.created&&m.id
                ? <button type="button" aria-label={`Undo tooth ${m.tooth}`} title="Undo" onClick={()=>onUndo(m)}>✕</button>
                : <span style={{width:6}}/>}
            </span>
          ))}
        </div>
      )}
      {notice&&<div className={`dc-notice dc-notice-${notice.kind}`} role="status">{notice.text}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FINDINGS LOG — by condition or by tooth
═══════════════════════════════════════════════════════ */
function FindingsLog({findings,disabled,busy,onEdit,onDelete,onOpenTooth,onQuick}){
  const[view,setView]=useState("condition");
  const teethCount=new Set(findings.map(f=>f.tooth_number)).size;

  const groups=[];
  const index={};
  findings.forEach(f=>{
    const key=view==="condition"?f._label.toLowerCase():String(f.tooth_number);
    if(index[key]===undefined){index[key]=groups.length;groups.push({key,rows:[]});}
    groups[index[key]].rows.push(f);
  });
  if(view==="tooth") groups.sort((a,b)=>Number(a.key)-Number(b.key));
  else groups.sort((a,b)=>byName(a.rows[0]._label,b.rows[0]._label));   // conditions A–Z
  groups.forEach(g=>g.rows.sort((a,b)=>view==="condition"?a.tooth_number-b.tooth_number:a._rank-b._rank));

  return(
    <div className="dc-panel" style={{marginBottom:0}}>
      <div className="dc-log-head">
        <span aria-hidden="true">📋</span>
        <span className="dc-log-title">Findings Log</span>
        <span className="dc-count-badge">{findings.length}</span>
        <span style={{fontSize:11.5,color:"var(--dc-text3)",fontWeight:500}}>
          {findings.length===0?"":`${plural(findings.length,"finding","findings")} on ${plural(teethCount,"tooth","teeth")}`}
        </span>
        <div className="dc-tab-group" style={{marginLeft:"auto"}} role="group" aria-label="Group the log">
          {[["condition","By condition"],["tooth","By tooth"]].map(([k,l])=>(
            <button key={k} type="button" className={`dc-tab${view===k?" active":""}`} aria-pressed={view===k}
              style={{padding:"5px 12px",fontSize:11.5}} onClick={()=>setView(k)}>{l}</button>
          ))}
        </div>
      </div>

      {groups.length===0?(
        <div className="dc-log-empty">
          <div style={{fontSize:24,marginBottom:6}} aria-hidden="true">🦷</div>
          No findings recorded yet.{!disabled&&<><br/>Click a tooth on the chart to start.</>}
        </div>
      ):(
        <div className="dc-log-body">
          {groups.map(g=>{
            const first=g.rows[0];
            if(view==="condition"){
              const cm=first._cm;
              return(
                <div key={g.key} className="dc-gcard" style={{borderColor:hexToRgbaSafe(cm.a,.28)}}>
                  <div className="dc-gcard-head">
                    <ConditionPill cm={cm} label={first._label}/>
                    <span className="dc-gcard-teeth">Teeth: <b style={{color:cm.dark}}>{g.rows.map(r=>r.tooth_number).join(", ")}</b></span>
                    {!disabled&&first.condition!=="Other"&&CMAP[first.condition]&&(
                      <button type="button" className="dc-btn dc-btn-ghost dc-btn-sm" style={{marginLeft:"auto"}}
                        onClick={()=>onQuick(first.condition)}>+ Mark more teeth</button>
                    )}
                  </div>
                  {g.rows.map(f=>(
                    <FindingRow key={f.id} f={f} showTooth disabled={disabled} busy={busy}
                      onEdit={onEdit} onDelete={onDelete} onOpenTooth={onOpenTooth}/>
                  ))}
                </div>
              );
            }
            return(
              <div key={g.key} className="dc-gcard">
                <div className="dc-gcard-head">
                  <button type="button" className="dc-tooth-badge" style={{borderColor:"#bcd0fb",color:"var(--dc-accent)",background:"var(--dc-accent-soft)"}}
                    onClick={()=>onOpenTooth(first.tooth_number)}>{first.tooth_number}</button>
                  <span className="dc-gcard-teeth">{toothName(first.tooth_number)}</span>
                  {!disabled&&(
                    <button type="button" className="dc-btn dc-btn-ghost dc-btn-sm" style={{marginLeft:"auto"}}
                      onClick={()=>onOpenTooth(first.tooth_number,"new")}>+ Add finding</button>
                  )}
                </div>
                {g.rows.map(f=>(
                  <FindingRow key={f.id} f={f} disabled={disabled} busy={busy} onEdit={onEdit} onDelete={onDelete}/>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════════════════ */
const EMPTY_QUICK = () => ({ condition:"", severity:"", surfaces:[], notes:"", otherText:"", otherColor:OTHER_PALETTE[8] });

export default function DentalChart({visitId,disabled=false,onRecordsChange,externalRecords}){
  const[records,setRecords]=useState([]);            // rows exactly as the server sent them
  const[chartType,setChartType]=useState("permanent");
  const[saving,setSaving]=useState(false);
  const[deleting,setDeleting]=useState(false);
  const[loadError,setLoadError]=useState("");

  // Tooth window
  const[modal,setModal]=useState(null);              // { tooth, startEditId? }
  const[modalError,setModalError]=useState("");

  // Quick mark
  const[quick,setQuick]=useState(null);              // null = off
  const[marked,setMarked]=useState([]);              // [{ tooth, id, created }]
  const[notice,setNotice]=useState(null);            // { kind, text }

  const[confirm,setConfirm]=useState(null);          // finding waiting for delete confirmation
  const[focus,setFocus]=useState("");                // legend filter (lower-case label)
  const[oldServer,setOldServer]=useState(false);     // backend still replaces instead of adding

  const loadSeq=useRef(0);
  const noticeTimer=useRef(null);
  const onRecordsChangeRef=useRef(onRecordsChange);
  onRecordsChangeRef.current=onRecordsChange;

  const publish=data=>{setRecords(data);if(onRecordsChangeRef.current)onRecordsChangeRef.current(data);};

  // When the doctor moves to a different visit, reset every piece of chart
  // state right away instead of waiting for the fetch, so the previous
  // visit's teeth never stay on screen. Nothing is deleted in the database:
  // chart rows are stored per visit.
  useEffect(()=>{
    setRecords([]);
    setModal(null);setModalError("");
    setQuick(null);setMarked([]);setNotice(null);
    setConfirm(null);setFocus("");setLoadError("");
    if(onRecordsChangeRef.current)onRecordsChangeRef.current([]);

    injectStyles();
    if(visitId)load();
    return()=>{clearTimeout(noticeTimer.current);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[visitId]);

  const load=async()=>{
    const seq=++loadSeq.current;
    try{
      const r=await api.get(`/visits/${visitId}/dental-chart`);
      const data=Array.isArray(r.data)?r.data:[];
      if(seq===loadSeq.current){publish(data);setLoadError("");}   // ignore answers that arrive out of order
      return data;
    }catch(e){
      console.error(e);
      if(seq===loadSeq.current)setLoadError("Could not load the dental chart. Check the connection and reopen the visit.");
      return null;
    }
  };

  // Keep this chart in step with records that were added/edited/deleted from
  // outside it — most importantly the Diagnosis panel's "+ Add", which writes
  // records through VisitPage. Compares content, not reference.
  useEffect(()=>{
    if(externalRecords===undefined)return;
    setRecords(prev=>JSON.stringify(prev)===JSON.stringify(externalRecords)?prev:externalRecords);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[JSON.stringify(externalRecords)]);

  const all=useMemo(()=>normalize(records),[records]);
  const findings=useMemo(()=>all.filter(f=>inChart(f.tooth_number,chartType)),[all,chartType]);
  const findingsOf=n=>all.filter(f=>f.tooth_number===n);

  const say=(kind,text)=>{
    setNotice({kind,text});
    clearTimeout(noticeTimer.current);
    noticeTimer.current=setTimeout(()=>setNotice(null),4500);
  };
  const errorText=(e,fallback)=>e?.response?.data?.error||fallback;

  /* After adding a finding: if the tooth's earlier findings vanished, the
     backend is still the old one that keeps a single entry per tooth. */
  const checkServerKeptOthers=(before,fresh,tooth)=>{
    if(!fresh||before.length===0)return;
    const now=normalize(fresh).filter(f=>f.tooth_number===tooth);
    if(before.some(b=>!now.some(n=>n.id===b.id&&sameFinding(n,b.condition,b.other_text))))setOldServer(true);
  };

  /* ── Tooth window: add / update ── */
  const handleModalSave=async(tooth,existing,fields,done)=>{
    setSaving(true);setModalError("");
    const before=findingsOf(tooth);
    try{
      if(existing){
        await api.put(`/visits/${visitId}/dental-chart/${existing.id}`,fields);          // UPDATE: this finding only
      }else{
        await api.post(`/visits/${visitId}/dental-chart`,{tooth_number:tooth,...fields}); // ADD: a new finding
      }
      const fresh=await load();
      if(!existing)checkServerKeptOthers(before,fresh,tooth);
      done();
    }catch(e){
      console.error(e);
      setModalError(errorText(e,"Could not save. Please try again."));
    }finally{setSaving(false);}
  };

  /* ── Quick mark: click a tooth ── */
  const markTooth=async n=>{
    const q=quick;
    const isOther=q.condition==="Other";
    if(isOther&&!q.otherText.trim()){say("warn","Type a description for “Other” before clicking teeth.");return;}
    const label=isOther?q.otherText.trim():q.condition;
    const before=findingsOf(n);
    const existing=before.find(f=>sameFinding(f,q.condition,q.otherText));
    const centre=centerCode(n);
    const surface=SURF_ORDER.filter(s=>q.surfaces.map(x=>(x==="O"||x==="I")?centre:x).includes(s)).join(",");
    const extras={};
    if(q.severity)extras.severity=q.severity;
    if(surface)extras.surface=surface;
    if(q.notes.trim())extras.notes=q.notes.trim();

    if(existing&&Object.keys(extras).length===0){
      say("info",`Tooth ${n} already has ${label}. Nothing was changed.`);
      return;
    }
    setSaving(true);
    try{
      if(existing){
        // Already marked: only the options chosen above are updated.
        await api.put(`/visits/${visitId}/dental-chart/${existing.id}`,extras);
        setMarked(m=>m.some(x=>x.tooth===n)?m:[...m,{tooth:n,id:existing.id,created:false}]);
        say("info",`Tooth ${n} already had ${label} — its details were updated.`);
      }else{
        const res=await api.post(`/visits/${visitId}/dental-chart`,{
          tooth_number:n,condition:q.condition,
          severity:q.severity||"",surface,notes:q.notes.trim(),
          other_text:isOther?q.otherText.trim():"",
          custom_color:isOther?q.otherColor:"",
        });
        setMarked(m=>[...m.filter(x=>x.tooth!==n),{tooth:n,id:res?.data?.id,created:true}]);
        setNotice(null);
      }
      const fresh=await load();
      if(!existing)checkServerKeptOthers(before,fresh,n);
    }catch(e){
      console.error(e);
      say("error",errorText(e,`Could not save tooth ${n}. Please try again.`));
    }finally{setSaving(false);}
  };

  const undoMark=async m=>{
    setDeleting(true);
    try{
      await api.delete(`/visits/${visitId}/dental-chart/${m.id}`);
      setMarked(list=>list.filter(x=>x.tooth!==m.tooth));
      await load();
    }catch(e){
      console.error(e);
      say("error",errorText(e,`Could not undo tooth ${m.tooth}.`));
    }finally{setDeleting(false);}
  };

  const handleToothClick=n=>{
    if(quick&&quick.condition&&!disabled){markTooth(n);return;}
    setModalError("");
    setModal({tooth:n});
  };

  const startQuick=condition=>{
    setModal(null);setMarked([]);setNotice(null);setFocus("");
    setQuick({...EMPTY_QUICK(),condition:condition||"",surfaces:condition&&CMAP[condition]?.surf?[...CMAP[condition].surf]:[]});
  };
  const endQuick=()=>{setQuick(null);setMarked([]);setNotice(null);};

  /* ── Delete (always asks first) ── */
  const confirmDelete=async()=>{
    const f=confirm;
    if(!f)return;
    setDeleting(true);
    try{
      await api.delete(`/visits/${visitId}/dental-chart/${f.id}`);
      setConfirm(null);
      setMarked(list=>list.filter(x=>x.id!==f.id));
      await load();
    }catch(e){
      console.error(e);
      if(e?.response?.status===404){setConfirm(null);await load();}   // already deleted elsewhere
      else alert(errorText(e,"Failed to delete."));
    }finally{setDeleting(false);}
  };

  /* ── Header numbers + legend ── */
  const teethCount=new Set(findings.map(f=>f.tooth_number)).size;
  const usedMap=new Map();
  findings.forEach(f=>{
    const key=f._label.toLowerCase();
    if(!usedMap.has(key))usedMap.set(key,{key,label:f._label,cm:f._cm,count:0});
    usedMap.get(key).count+=1;
  });
  const used=[...usedMap.values()].sort((a,b)=>byName(a.label,b.label));   // legend A–Z
  const topConds=[...used].sort((a,b)=>b.count-a.count).slice(0,3);
  const focusActive=focus&&usedMap.has(focus)?focus:"";

  const modalFindings=modal?findingsOf(modal.tooth):[];
  const busy=saving||deleting;

  return(
    <div className="dc-root">

      {/* ── HEADER ── */}
      <div className="dc-panel dc-header">
        <div className="dc-header-title">
          <div className="dc-header-title-icon" aria-hidden="true">🦷</div>
          Dental Chart
        </div>
        <div className="dc-tab-group" role="group" aria-label="Chart type">
          {[{key:"permanent",label:"Permanent (FDI)"},{key:"deciduous",label:"Deciduous"}].map(o=>(
            <button key={o.key} type="button" className={`dc-tab${chartType===o.key?" active":""}`} aria-pressed={chartType===o.key}
              onClick={()=>{setChartType(o.key);setMarked([]);setFocus("");}}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="dc-stats-row">
          <div className="dc-stat-chip"
            style={{background:findings.length>0?"#fef2f2":"var(--dc-surface2)",
              borderColor:findings.length>0?"#fecaca":"var(--dc-border)",
              color:findings.length>0?"#991b1b":"var(--dc-text3)"}}>
            <span className="dc-stat-dot" style={{background:findings.length>0?"#ef4444":"#cbd5e1"}}/>
            {findings.length===0?"No findings":`${plural(findings.length,"finding","findings")} · ${plural(teethCount,"tooth","teeth")}`}
          </div>
          {topConds.map(c=>(
            <div key={c.key} className="dc-stat-chip"
              style={{background:hexToRgbaSafe(c.cm.a,.08),borderColor:hexToRgbaSafe(c.cm.a,.27),color:c.cm.dark}}>
              <span className="dc-stat-dot" style={{background:c.cm.a}}/>
              {c.label}: {c.count}
            </div>
          ))}
          {saving&&<div className="dc-stat-chip" style={{color:"#1d4ed8",borderColor:"#bfdbfe",background:"#eff6ff"}} role="status">Saving…</div>}
        </div>
      </div>

      {loadError&&<div className="dc-notice dc-notice-error" role="alert" style={{margin:"0 0 14px"}}>{loadError}</div>}
      {oldServer&&(
        <div className="dc-notice dc-notice-warn" role="alert" style={{margin:"0 0 14px"}}>
          The server replaced the earlier finding on that tooth instead of adding to it. To record several findings on one
          tooth, replace <b>dental_chart.py</b> on the backend with the new version and restart the server.
        </div>
      )}

      {/* ── MODE BAR ── */}
      {!disabled&&!quick&&(
        <div className="dc-panel dc-mode">
          <div className="dc-mode-row">
            <span className="dc-mode-hint"><b>Click a tooth</b> to see, add or edit its findings.</span>
            <button type="button" className="dc-btn dc-btn-soft" style={{marginLeft:"auto"}} onClick={()=>startQuick("")}>
              ⚡ Quick mark several teeth
            </button>
          </div>
        </div>
      )}
      {!disabled&&(
        <QuickMarkBar quick={quick} setQuick={setQuick} marked={marked} notice={notice}
          onUndo={undoMark} onDone={endQuick}/>
      )}

      {/* ── CHART ── */}
      <div className="dc-panel">
        <DentalDiagram findings={findings} chartType={chartType}
          onToothClick={handleToothClick}
          selectedTooth={modal?modal.tooth:null}
          markedTeeth={new Set(marked.map(m=>m.tooth))}
          focus={focusActive}/>

        <div className="dc-legend-bar">
          <span className="dc-legend-cap">On this chart:</span>
          {used.length===0&&<span className="dc-legend-item static">
            <span className="dc-legend-dot" style={{background:"#fff",border:"1px solid #9aa6b8"}}/> All teeth healthy / not charted
          </span>}
          {used.map(u=>(
            <button key={u.key} type="button" className={`dc-legend-item${focusActive===u.key?" on":""}`}
              aria-pressed={focusActive===u.key} title="Show only the teeth with this finding"
              onClick={()=>setFocus(f=>f===u.key?"":u.key)}>
              <span className="dc-legend-dot" style={{background:u.cm.a}}/>
              {u.label} · {u.count}
            </button>
          ))}
          {focusActive&&(
            <button type="button" className="dc-legend-item" onClick={()=>setFocus("")}>✕ Show all</button>
          )}
          {used.length>0&&(
            <span className="dc-legend-key">
              Tooth colour = main finding · band = surface · dots = several findings
            </span>
          )}
        </div>
      </div>

      {/* ── FINDINGS LOG ── */}
      <FindingsLog findings={findings} disabled={disabled} busy={busy}
        onEdit={f=>{setModalError("");setModal({tooth:f.tooth_number,startEditId:f.id});}}
        onDelete={setConfirm}
        onOpenTooth={(n,mode)=>{setModalError("");setModal({tooth:n,startEditId:mode==="new"?"new":undefined});}}
        onQuick={startQuick}/>

      {/* ── TOOTH WINDOW ── */}
      {modal&&(
        <ToothModal key={`${modal.tooth}-${modal.startEditId||""}`}
          tooth={modal.tooth} findings={modalFindings} disabled={disabled}
          startEditId={modal.startEditId}
          saving={saving} error={modalError}
          escEnabled={!confirm}
          onSave={handleModalSave}
          onAskDelete={setConfirm}
          onClearError={()=>setModalError("")}
          onClose={()=>setModal(null)}/>
      )}

      {/* ── DELETE CONFIRMATION ── */}
      {confirm&&(
        <ConfirmDialog busy={deleting}
          title={`Delete “${confirm._label}” from tooth ${confirm.tooth_number}?`}
          body={`Only this finding is deleted.${findingsOf(confirm.tooth_number).length>1?" The tooth's other findings stay.":""}`}
          onCancel={()=>setConfirm(null)} onConfirm={confirmDelete}/>
      )}
    </div>
  );
}