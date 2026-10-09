import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/api";
import PatientCompleteHistory from "./PatientCompleteHistory";
import AppointmentsBoard from "../components/AppointmentsBoard";

/* ─── inject styles once ─── */
const injectStyles = () => {
  if (document.getElementById("dd-styles")) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap";
  document.head.appendChild(link);

  const s = document.createElement("style");
  s.id = "dd-styles";
  s.textContent = `
    .dd-root {
      min-height: 100vh;
      background: linear-gradient(150deg,#eef2fb 0%,#e6ecf8 55%,#dde8f5 100%);
      font-family: 'Plus Jakarta Sans', sans-serif;
      padding: 0 0 60px;
    }

    /* header */
    .dd-header {
      background: linear-gradient(135deg,#0b2d4e 0%,#0f4270 50%,#1059a0 100%);
      padding: 20px 36px;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 4px 20px rgba(11,45,78,0.25);
    }
    .dd-header-logo {
      width: 40px; height: 40px; border-radius: 10px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .dd-header-clinic {
      font-family: 'Cormorant Garamond', serif;
      font-size: 18px; font-weight: 700; color: #fff; line-height: 1.2;
    }
    .dd-header-sub { font-size: 11.5px; color: rgba(255,255,255,0.65); margin-top: 2px; }
    .dd-header-right { display: flex; align-items: center; gap: 12px; }
    .dd-header-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.22);
      color: #e2eaf8; font-size: 12px; font-weight: 600;
      padding: 7px 16px; border-radius: 20px;
    }
    .dd-header-badge span {
      width: 7px; height: 7px; border-radius: 50%;
      background: #4ade80; display: inline-block;
      box-shadow: 0 0 0 2px rgba(74,222,128,0.3);
    }

    /* unified search bar in header */
    .dd-search-bar-wrap {
      position: relative; display: flex; align-items: center;
      background: rgba(255,255,255,0.13);
      border: 1.5px solid rgba(255,255,255,0.25);
      border-radius: 10px; overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .dd-search-bar-wrap:focus-within {
      border-color: rgba(255,255,255,0.55);
      box-shadow: 0 0 0 3px rgba(255,255,255,0.1);
    }
    .dd-search-bar-icon {
      padding: 0 10px 0 13px; color: rgba(255,255,255,0.55); font-size: 14px; pointer-events: none;
    }
    .dd-search-bar {
      padding: 9px 14px 9px 0;
      border: none; outline: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px; color: #fff; background: transparent; width: 240px;
    }
    .dd-search-bar::placeholder { color: rgba(255,255,255,0.45); }

    /* body */
    .dd-body { max-width: 1180px; margin: 36px auto 0; padding: 0 24px; }

    /* stats */
    .dd-stats { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 16px; margin-bottom: 28px; }
    .dd-stat-card {
      background: #fff; border-radius: 14px;
      border: 1px solid rgba(220,230,245,0.9);
      box-shadow: 0 2px 8px rgba(15,50,100,0.05);
      padding: 20px 22px; animation: dd-in 0.4s both;
    }
    .dd-stat-label { font-size: 10.5px; font-weight: 700; color: #8899bb; letter-spacing: 0.9px; text-transform: uppercase; margin-bottom: 8px; }
    .dd-stat-value { font-size: 28px; font-weight: 800; color: #0f2a50; line-height: 1; }
    .dd-stat-sub   { font-size: 11.5px; color: #94a3b8; margin-top: 4px; }

    /* table card */
    .dd-card {
      background: #fff; border-radius: 16px;
      border: 1px solid rgba(220,230,245,0.9);
      box-shadow: 0 2px 8px rgba(15,50,100,0.05), 0 8px 28px rgba(15,50,100,0.06);
      overflow: hidden; animation: dd-in 0.45s 0.1s both;
      margin-bottom: 28px;
    }
    .dd-card-header {
      padding: 20px 26px 18px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid #f0f4fb;
    }
    .dd-card-title {
      display: flex; align-items: center; gap: 10px;
      font-size: 13px; font-weight: 700; color: #1a2540;
    }
    .dd-card-title::before {
      content: ''; width: 3px; height: 16px; border-radius: 2px;
      background: linear-gradient(180deg,#2563eb,#60a5fa); flex-shrink: 0;
    }
    .dd-refresh-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 8px;
      background: #eff4ff; color: #2563eb;
      border: 1.5px solid #c7d9fc;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background 0.18s, border-color 0.18s;
    }
    .dd-refresh-btn:hover { background: #ddeaff; border-color: #2563eb; }

    /* table */
    .dd-table { width: 100%; border-collapse: collapse; }
    .dd-table thead tr { background: linear-gradient(90deg,#1e3a6e 0%,#2563eb 100%); }
    .dd-table thead th {
      padding: 11px 14px; text-align: left;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.7px;
      text-transform: uppercase; color: rgba(255,255,255,0.9);
    }
    .dd-table tbody tr {
      border-bottom: 1px solid #f0f4fb;
      transition: background 0.15s; animation: dd-row 0.35s both;
    }
    .dd-table tbody tr:last-child { border-bottom: none; }
    .dd-table tbody tr:hover { background: #f4f8ff; }
    .dd-table tbody td { padding: 13px 14px; font-size: 13px; color: #2d3a55; vertical-align: middle; }

    /* avatar */
    .dd-avatar {
      width: 34px; height: 34px; border-radius: 9px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0;
    }
    .dd-name-cell { display: flex; align-items: center; gap: 10px; }
    .dd-name      { font-size: 13.5px; font-weight: 700; color: #0f2a50; }
    .dd-case      { font-size: 11px; color: #94a3b8; margin-top: 1px; }
    .dd-chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
    }

    /* open btn */
    .dd-open-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 7px 14px; border-radius: 9px;
      background: linear-gradient(135deg,#1d4ed8,#2563eb);
      color: #fff; border: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px; font-weight: 700; cursor: pointer;
      box-shadow: 0 3px 10px rgba(37,99,235,0.28);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .dd-open-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(37,99,235,0.36); }
    .dd-open-btn:active { transform: translateY(0); }

    /* complete btn */
    .dd-complete-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 7px 13px; border-radius: 9px;
      background: #f0fdf4; color: #166534;
      border: 1.5px solid #86efac;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px; font-weight: 700; cursor: pointer;
      transition: all 0.18s;
    }
    .dd-complete-btn:hover {
      background: #dcfce7; border-color: #22c55e; color: #14532d;
      transform: translateY(-1px); box-shadow: 0 4px 10px rgba(34,197,94,0.2);
    }
    .dd-complete-btn:active { transform: translateY(0); }
    .dd-complete-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

    /* action cell */
    .dd-action-cell { display: flex; align-items: center; gap: 8px; }

    /* empty state */
    .dd-empty { padding: 60px 0; text-align: center; color: #94a3b8; font-size: 14px; }
    .dd-empty-icon { font-size: 40px; margin-bottom: 14px; opacity: 0.5; }

    /* loading */
    .dd-loading {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; font-size: 14px; color: #64748b;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .dd-spinner {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2.5px solid #dde8f8; border-top-color: #2563eb;
      animation: spin 0.7s linear infinite; margin-right: 10px;
    }

    /* confirm overlay */
    .dd-overlay {
      position: fixed; inset: 0;
      background: rgba(10,25,55,0.45);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000; animation: dd-in 0.2s both;
    }
    .dd-confirm-box {
      background: #fff; border-radius: 18px;
      padding: 32px 36px; max-width: 420px; width: 90%;
      box-shadow: 0 20px 60px rgba(10,25,55,0.25);
      animation: dd-up 0.25s cubic-bezier(.22,.68,0,1.2) both;
    }
    @keyframes dd-up {
      from { opacity:0; transform:translateY(20px) scale(0.97); }
      to   { opacity:1; transform:none; }
    }
    .dd-confirm-icon {
      width: 52px; height: 52px; border-radius: 14px;
      background: linear-gradient(135deg,#f0fdf4,#dcfce7);
      border: 1.5px solid #86efac;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; margin-bottom: 18px;
    }
    .dd-confirm-title { font-size: 18px; font-weight: 800; color: #0f2a50; margin-bottom: 8px; }
    .dd-confirm-sub   { font-size: 13.5px; color: #64748b; line-height: 1.6; margin-bottom: 26px; }
    .dd-confirm-name  { font-weight: 700; color: #0f2a50; }
    .dd-confirm-btns  { display: flex; gap: 10px; }
    .dd-confirm-yes {
      flex: 1; padding: 12px; border-radius: 10px;
      background: linear-gradient(135deg,#16a34a,#22c55e);
      color: #fff; border: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px; font-weight: 700; cursor: pointer;
      box-shadow: 0 4px 12px rgba(22,163,74,0.3);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .dd-confirm-yes:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(22,163,74,0.38); }
    .dd-confirm-yes:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .dd-confirm-no {
      flex: 1; padding: 12px; border-radius: 10px;
      background: transparent; color: #64748b;
      border: 1.5px solid #e2e8f4;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px; font-weight: 600; cursor: pointer;
      transition: all 0.18s;
    }
    .dd-confirm-no:hover { background: #f5f7fc; color: #1a2540; border-color: #c8d3ea; }

    /* animations */
    @keyframes dd-in  { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
    @keyframes dd-row { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:translateX(0); } }

    /* ══════════════════════════════════════════
       PATIENT LOOKUP DRAWER
    ══════════════════════════════════════════ */
    .pld-backdrop {
      position: fixed; inset: 0;
      background: rgba(8,20,50,0.52);
      backdrop-filter: blur(6px);
      z-index: 900;
      animation: pld-fade-in 0.22s both;
    }
    @keyframes pld-fade-in { from { opacity:0; } to { opacity:1; } }

    .pld-drawer {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: min(680px, 100vw);
      background: #fff;
      box-shadow: -8px 0 48px rgba(8,20,50,0.18);
      z-index: 910;
      display: flex; flex-direction: column;
      animation: pld-slide-in 0.28s cubic-bezier(.22,.68,0,1.1) both;
    }
    @keyframes pld-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    .pld-drawer.closing {
      animation: pld-slide-out 0.22s cubic-bezier(.4,0,.6,1) both;
    }
    @keyframes pld-slide-out {
      from { transform: translateX(0); opacity:1; }
      to   { transform: translateX(100%); opacity:0; }
    }

    /* drawer top bar */
    .pld-topbar {
      background: linear-gradient(135deg,#0b2d4e 0%,#1059a0 100%);
      padding: 20px 26px;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .pld-topbar-left { display: flex; align-items: center; gap: 12px; }
    .pld-topbar-icon {
      width: 38px; height: 38px; border-radius: 10px;
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.22);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .pld-topbar-title { font-size: 15px; font-weight: 800; color: #fff; }
    .pld-topbar-sub   { font-size: 11.5px; color: rgba(255,255,255,0.6); margin-top: 1px; }
    .pld-close-btn {
      width: 32px; height: 32px; border-radius: 8px;
      background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2);
      color: #fff; font-size: 17px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    .pld-close-btn:hover { background: rgba(255,255,255,0.22); }

    /* search section */
    .pld-search-section {
      padding: 20px 26px 16px;
      border-bottom: 1px solid #f0f4fb;
      flex-shrink: 0;
    }
    .pld-search-label {
      font-size: 10.5px; font-weight: 700; color: #8899bb;
      letter-spacing: 0.9px; text-transform: uppercase; margin-bottom: 10px;
    }
    .pld-search-row { display: flex; gap: 10px; }
    .pld-input-wrap { position: relative; flex: 1; }
    .pld-input {
      width: 100%; padding: 11px 14px 11px 40px;
      border: 1.5px solid #e2e8f4; border-radius: 10px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13.5px; color: #1a2540; outline: none;
      background: #f7f9fe; box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .pld-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.10); background: #fff; }
    .pld-input::placeholder { color: #b0bad0; }
    .pld-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 15px; color: #b0bad0; pointer-events: none; }
    .pld-search-go {
      padding: 11px 20px; border-radius: 10px;
      background: linear-gradient(135deg,#1d4ed8,#2563eb);
      color: #fff; border: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px; font-weight: 700; cursor: pointer;
      box-shadow: 0 3px 10px rgba(37,99,235,0.28);
      transition: transform 0.15s, box-shadow 0.15s; white-space: nowrap;
      display: flex; align-items: center; gap: 6px;
    }
    .pld-search-go:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(37,99,235,0.36); }
    .pld-search-go:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .pld-hint { font-size: 11.5px; color: #b0bad0; margin-top: 8px; }

    /* results scroll area */
    .pld-results { flex: 1; overflow-y: auto; padding: 16px 26px 24px; }

    /* result patient card */
    .pld-patient-card {
      border: 1.5px solid #e8eef8; border-radius: 14px;
      margin-bottom: 14px; overflow: hidden;
      transition: box-shadow 0.18s, border-color 0.18s;
    }
    .pld-patient-card:hover { border-color: #c7d9fc; box-shadow: 0 4px 16px rgba(37,99,235,0.08); }
    .pld-patient-header {
      padding: 14px 18px;
      display: flex; align-items: center; justify-content: space-between;
      background: linear-gradient(90deg,#f7f9fe,#f0f4ff);
      cursor: pointer; user-select: none;
    }
    .pld-patient-info { display: flex; align-items: center; gap: 12px; }
    .pld-avatar-lg {
      width: 42px; height: 42px; border-radius: 11px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0;
    }
    .pld-p-name  { font-size: 14.5px; font-weight: 800; color: #0f2a50; }
    .pld-p-meta  { font-size: 11.5px; color: #64748b; margin-top: 2px; display: flex; gap: 12px; }
    .pld-p-meta span { display: flex; align-items: center; gap: 4px; }
    .pld-expand-icon {
      font-size: 18px; color: #94a3b8;
      transition: transform 0.22s;
    }
    .pld-expand-icon.open { transform: rotate(90deg); }

    /* visit history */
    .pld-history {
      padding: 0 18px 16px;
      border-top: 1px solid #f0f4fb;
      background: #fff;
    }
    .pld-history-title {
      font-size: 10.5px; font-weight: 700; color: #8899bb;
      letter-spacing: 0.9px; text-transform: uppercase;
      padding: 12px 0 10px;
    }

    /* visit history item */
    .pld-visit-item {
      border: 1px solid #edf2fb; border-radius: 11px;
      margin-bottom: 10px; overflow: hidden;
      background: #fafbff;
    }
    .pld-visit-top {
      padding: 11px 14px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid #f0f4fb; flex-wrap: wrap; gap: 8px;
    }
    .pld-visit-date {
      font-size: 12px; font-weight: 700; color: #1a2540;
      display: flex; align-items: center; gap: 6px;
    }
    .pld-visit-status {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 700;
    }
    .pld-visit-status.open   { background: #f0fdf4; color: #166634; border: 1px solid #86efac; }
    .pld-visit-status.closed { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

    /* dental fields grid */
    .pld-fields {
      padding: 12px 14px;
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    @media (max-width: 500px) { .pld-fields { grid-template-columns: 1fr; } }
    .pld-field { }
    .pld-field-label {
      font-size: 10px; font-weight: 700; color: #94a3b8;
      text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 3px;
    }
    .pld-field-value {
      font-size: 12.5px; color: #1a2540; font-weight: 500; line-height: 1.5;
    }
    .pld-field-empty { color: #c0cce0; font-style: italic; font-size: 12px; }

    /* full-width field */
    .pld-field.full { grid-column: 1 / -1; }

    /* tooth chart badge row */
    .pld-teeth-row {
      display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px;
    }
    .pld-tooth-badge {
      padding: 2px 8px; border-radius: 6px;
      background: #eff4ff; color: #1d4ed8;
      font-size: 11px; font-weight: 700;
      border: 1px solid #c7d9fc;
    }
    .pld-tooth-badge.carious { background: #fef9ee; color: #b45309; border-color: #fde68a; }
    .pld-tooth-badge.missing { background: #fef2f2; color: #991b1b; border-color: #fca5a5; }
    .pld-tooth-badge.filled  { background: #f0fdf4; color: #166534; border-color: #86efac; }

    /* no history */
    .pld-no-history {
      text-align: center; padding: 28px 0;
      color: #b0bad0; font-size: 13px;
    }
    .pld-no-history-icon { font-size: 30px; margin-bottom: 8px; opacity: 0.4; }

    /* spinner inline */
    .pld-spin {
      display: flex; align-items: center; justify-content: center;
      padding: 40px; color: #64748b; gap: 10px; font-size: 13px;
    }

    /* no results */
    .pld-no-results {
      text-align: center; padding: 50px 0;
      color: #94a3b8; font-size: 14px;
    }
    .pld-no-results-icon { font-size: 38px; margin-bottom: 12px; opacity: 0.4; }

    /* view visit link btn */
    .pld-view-visit-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 12px; border-radius: 7px;
      background: linear-gradient(135deg,#1d4ed8,#2563eb);
      color: #fff; border: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 11.5px; font-weight: 700; cursor: pointer;
      box-shadow: 0 2px 6px rgba(37,99,235,0.2);
      transition: transform 0.12s, box-shadow 0.12s;
      margin-top: 4px;
    }
    .pld-view-visit-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(37,99,235,0.3); }
/* ══════════════════════════════════════════
       APPOINTMENTS DIARY
    ══════════════════════════════════════════ */
    .appt-tab {
      padding: 10px 20px; border: none; background: transparent;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px; font-weight: 600; color: #94a3b8;
      cursor: pointer; border-bottom: 2.5px solid transparent;
      margin-bottom: -2px; transition: all 0.18s;
      border-radius: 6px 6px 0 0;
    }
    .appt-tab:hover { color: #1d6fa4; background: #f0f8ff; }
    .appt-tab.active { color: #1d4d7a; border-bottom-color: #1d6fa4; background: #f0f8ff; }
    .appt-card {
      border: 1.5px solid #e8eef8; border-radius: 12px;
      padding: 14px 18px; background: #fff;
      transition: box-shadow 0.18s, border-color 0.18s;
      position: relative; overflow: hidden;
    }
    .appt-card:hover { border-color: #c7d9fc; box-shadow: 0 4px 16px rgba(29,77,122,0.08); }
    .appt-card.completed { background: #f8fffe; border-color: #a7f3d0; opacity: 0.82; }
    .appt-card.completed::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:#10b981; border-radius:3px 0 0 3px; }
    .appt-card.pending::before   { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:#f59e0b; border-radius:3px 0 0 3px; }
    .appt-input {
      width: 100%; padding: 10px 14px;
      border: 1.5px solid #e2e8f4; border-radius: 9px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px; color: #1a1f36; background: #f7f9fe;
      outline: none; transition: border-color 0.2s, box-shadow 0.2s;
      box-sizing: border-box;
    }
    .appt-input:focus { border-color: #1d6fa4; box-shadow: 0 0 0 3px rgba(29,111,164,0.10); background: #fff; }
    .appt-input::placeholder { color: #b0bad0; }
    .appt-input-label {
      font-size: 10.5px; font-weight: 700; color: #8899bb;
      letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 5px; display: block;
    }
    .appt-icon-btn {
      width: 30px; height: 30px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1.5px solid #e2e8f4; background: #f7f9fe;
      cursor: pointer; font-size: 13px; transition: all 0.15s;
    }
    .appt-icon-btn:hover { background: #eff4ff; border-color: #c7d9fc; }
    .appt-icon-btn.danger:hover { background: #fff1f2; border-color: #fca5a5; }
    .appt-icon-btn.success:hover { background: #f0fdf4; border-color: #86efac; }
    .appt-filter-select {
      padding: 8px 12px; border: 1.5px solid #e2e8f4; border-radius: 9px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12.5px; color: #1a1f36; background: #f7f9fe;
      outline: none; cursor: pointer;
    }
    .appt-overlay {
      position: fixed; inset: 0;
      background: rgba(10,25,55,0.45); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000; animation: dd-in 0.2s both;
    }
    .appt-modal {
      background: #fff; border-radius: 18px;
      padding: 32px 36px; max-width: 500px; width: 92%;
      box-shadow: 0 20px 60px rgba(10,25,55,0.22);
      animation: appt-modal-in 0.25s cubic-bezier(.22,.68,0,1.2) both;
    }
    .visit-modal {
      background: #fff; border-radius: 18px;
      padding: 32px 36px; max-width: 520px; width: 94%;
      max-height: 90vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(10,25,55,0.22);
      animation: appt-modal-in 0.25s cubic-bezier(.22,.68,0,1.2) both;
    }
    @keyframes appt-modal-in {
      from { opacity:0; transform:translateY(20px) scale(0.97); }
      to   { opacity:1; transform:none; }
    }
    .appt-status-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
    }
    .appt-status-badge.pending   { background:#fef9ee; color:#b45309; border:1px solid #fde68a; }
    .appt-status-badge.completed { background:#f0fdf4; color:#166534; border:1px solid #86efac; }
    .appt-empty { text-align:center; padding:48px 20px; color:#94a3b8; font-size:13.5px; }
    .appt-empty-icon { font-size:42px; margin-bottom:12px; opacity:0.4; }
    .appt-date-group-header {
      font-size:11px; font-weight:700; color:#8899bb;
      letter-spacing:1px; text-transform:uppercase;
      padding:12px 4px 8px;
      display:flex; align-items:center; gap:10px;
    }
    .appt-date-group-header::after { content:''; flex:1; height:1px; background:#f0f4fb; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .appt-rdb-spinner {
      width:16px; height:16px; border-radius:50%;
      border:2px solid #dde8f8; border-top-color:#1d6fa4;
      animation:spin 0.7s linear infinite; display:inline-block;
    }

    .dd-appt-nav-btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 18px; border-radius: 10px;
      background: rgba(255,255,255,0.15);
      border: 1.5px solid rgba(255,255,255,0.3);
      color: #fff;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px; font-weight: 700; cursor: pointer;
      transition: background 0.18s, border-color 0.18s, transform 0.15s;
    }
    .dd-appt-nav-btn:hover {
      background: rgba(255,255,255,0.25);
      border-color: rgba(255,255,255,0.5);
      transform: translateY(-1px);
    }
    .dd-appt-nav-btn:active { transform: translateY(0); }

    /* ── API Debug banner ── */
    @keyframes appt-float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-7px); }
    }
    .dd-appt-cs-title {
      font-size: 17px; font-weight: 800; color: #3b0764;
      margin-bottom: 8px; text-align: center;
    }
    .dd-appt-cs-desc {
      font-size: 13px; color: #6d28d9; line-height: 1.65;
      text-align: center; max-width: 480px; margin-bottom: 26px; opacity: 0.75;
    }
    .dd-appt-features {
      display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 28px;
    }
    .dd-appt-feature-pill {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 16px; border-radius: 30px;
      background: rgba(124,58,237,0.08);
      border: 1.5px solid rgba(124,58,237,0.18);
      color: #5b21b6; font-size: 12px; font-weight: 600;
    }
    .dd-appt-feature-pill-icon { font-size: 14px; }
    .dd-appt-cs-progress { width: 100%; max-width: 340px; }
    .dd-appt-cs-progress-label {
      display: flex; justify-content: space-between;
      font-size: 11px; font-weight: 700; color: #7c3aed; margin-bottom: 8px; opacity: 0.7;
    }
    .dd-appt-cs-progress-track {
      height: 6px; background: rgba(124,58,237,0.12); border-radius: 999px; overflow: hidden;
    }
    .dd-appt-cs-progress-fill {
      height: 100%; width: 45%; border-radius: 999px;
      background: linear-gradient(90deg,#7c3aed,#a78bfa);
      animation: progress-shimmer 2.5s ease-in-out infinite;
    }
    @keyframes progress-shimmer {
      0%   { opacity: 0.7; }
      50%  { opacity: 1; }
      100% { opacity: 0.7; }
    }

    /* ── API Debug banner ── */
    .dd-debug-banner {
      background: linear-gradient(135deg,#fffbeb,#fef9c3);
      border: 1.5px solid #fde68a;
      border-radius: 12px;
      padding: 14px 20px;
      margin-bottom: 20px;
      font-size: 12px;
      color: #78350f;
      line-height: 1.7;
    }
    .dd-debug-banner strong { color: #92400e; }
    .dd-debug-close {
      float: right; background: none; border: none;
      cursor: pointer; color: #b45309; font-size: 16px; line-height: 1;
    }
  `;
  document.head.appendChild(s);
};

/* ─── helpers ─── */
const avatarColor = (name = "") => {
  const colors = [
    ["#0f4270","#1d6fa4"], ["#7c3aed","#a855f7"],
    ["#0d6e4a","#10b981"], ["#be185d","#ec4899"],
    ["#92400e","#f59e0b"], ["#1e3a6e","#3b82f6"],
  ];
  const idx = (name.charCodeAt(0) || 0) % colors.length;
  return `linear-gradient(135deg,${colors[idx][0]},${colors[idx][1]})`;
};

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }); }
  catch { return d; }
};

/* ══════════════════════════════════════════
   FIX: Exhaustive chief complaint resolver
   Checks every possible field name the backend
   might use — both snake_case and camelCase.
══════════════════════════════════════════ */
const resolveComplaint = (v) =>
  v.chief_complaint?.trim()    ||
  v.chiefComplaint?.trim()     ||
  v.complaint?.trim()          ||
  v.chief_complaint_text?.trim() ||
  v.visit_complaint?.trim()    ||
  "";

/* ══════════════════════════════════════════
   FIX: Exhaustive followup resolver
══════════════════════════════════════════ */
const resolveFollowup = (v) =>
  v.followup_treatment?.trim() ||
  v.followupTreatment?.trim()  ||
  v.followup?.trim()           ||
  v.treatment_notes?.trim()    ||
  v.notes?.trim()              ||
  "";

const Field = ({ label, value, full = false, children }) => (
  <div className={`pld-field${full ? " full" : ""}`}>
    <div className="pld-field-label">{label}</div>
    {children || (
      value
        ? <div className="pld-field-value">{value}</div>
        : <div className="pld-field-empty">Not recorded</div>
    )}
  </div>
);

/* parse comma/space-separated tooth numbers */
const parseTeeth = (str) =>
  str ? str.split(/[,\s]+/).map(t => t.trim()).filter(Boolean) : [];

/* ═══════════════════════════════════════════
   VISIT HISTORY ITEM
═══════════════════════════════════════════ */
const VisitHistoryItem = ({ visit, onOpenVisit }) => {
  const [open, setOpen] = useState(false);
  const isClosed = (visit.status || "").toLowerCase() === "closed" ||
                   (visit.status || "").toLowerCase() === "completed";

  const complaint = resolveComplaint(visit);
  const followup  = resolveFollowup(visit);

  return (
    <div className="pld-visit-item">
      {/* top bar — click to expand */}
      <div className="pld-visit-top" style={{ cursor:"pointer" }} onClick={() => setOpen(o => !o)}>
        <div className="pld-visit-date">
          📅 {formatDate(visit.visit_date)}
          {visit.case_number && <span style={{ fontWeight:500, color:"#64748b", fontSize:11 }}>· Case #{visit.case_number}</span>}
          {complaint && <span style={{ fontWeight:500, color:"#0e7490", fontSize:11 }}>· {complaint.slice(0,40)}{complaint.length>40?"…":""}</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className={`pld-visit-status ${isClosed ? "closed" : "open"}`}>
            {isClosed ? "✔ Closed" : "🟢 Open"}
          </span>
          <span style={{ fontSize:14, color:"#b0bad0", transition:"transform 0.2s", transform: open?"rotate(90deg)":"none", display:"inline-block" }}>›</span>
        </div>
      </div>

      {/* expandable dental fields */}
      {open && (
        <div className="pld-fields">
          {/* Chief Complaint */}
          <Field label="Chief Complaint" value={complaint || null} />
          {/* Followup Notes */}
          <Field label="Followup / Treatment Notes" value={followup || null} />

          <Field label="Diagnosis"         value={visit.diagnosis} />
          <Field label="Treatment Done"    value={visit.treatment_done || visit.treatment} />
          <Field label="Treatment Plan"    value={visit.treatment_plan} />

          <Field label="Teeth Involved" full>
            {visit.teeth_involved ? (
              <div className="pld-teeth-row">
                {parseTeeth(visit.teeth_involved).map(t => (
                  <span key={t} className="pld-tooth-badge">{t}</span>
                ))}
              </div>
            ) : (
              <div className="pld-field-empty">Not recorded</div>
            )}
          </Field>

          <Field label="Carious Teeth" full={false}>
            {visit.carious_teeth ? (
              <div className="pld-teeth-row">
                {parseTeeth(visit.carious_teeth).map(t => (
                  <span key={t} className="pld-tooth-badge carious">{t}</span>
                ))}
              </div>
            ) : (
              <div className="pld-field-empty">Not recorded</div>
            )}
          </Field>

          <Field label="Missing Teeth">
            {visit.missing_teeth ? (
              <div className="pld-teeth-row">
                {parseTeeth(visit.missing_teeth).map(t => (
                  <span key={t} className="pld-tooth-badge missing">{t}</span>
                ))}
              </div>
            ) : (
              <div className="pld-field-empty">Not recorded</div>
            )}
          </Field>

          <Field label="Filled Teeth">
            {visit.filled_teeth ? (
              <div className="pld-teeth-row">
                {parseTeeth(visit.filled_teeth).map(t => (
                  <span key={t} className="pld-tooth-badge filled">{t}</span>
                ))}
              </div>
            ) : (
              <div className="pld-field-empty">Not recorded</div>
            )}
          </Field>

          <Field label="Prosthesis"   value={visit.prosthesis} />
          <Field label="Medications Prescribed" full value={visit.medications || visit.prescription} />
          <Field label="X-Ray Findings"   value={visit.xray_findings} />
          <Field label="OPG Findings"     value={visit.opg_findings} />
          <Field label="Periodontal Status" value={visit.periodontal_status} />
          <Field label="Oral Hygiene"       value={visit.oral_hygiene_status || visit.oral_hygiene} />
          <Field label="Extraction Details" value={visit.extraction_details} />
          <Field label="Next Appointment"   value={visit.next_appointment ? formatDate(visit.next_appointment) : null} />
          <Field label="Doctor Notes" full value={visit.doctor_notes || visit.notes} />

          {!isClosed && (
            <div className="pld-field full" style={{ marginTop:4 }}>
              <button className="pld-view-visit-btn" onClick={() => onOpenVisit(visit.visit_id)}>
                Open Visit →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════
   PATIENT LOOKUP DRAWER
═══════════════════════════════════════════ */
const PatientLookupDrawer = ({ onClose, onOpenVisit }) => {
  const [query,    setQuery]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [results,  setResults]  = useState(null);
  const [expanded, setExpanded] = useState({});
  const [closing,  setClosing]  = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 300); }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 220);
  };

const [historyPatientId, setHistoryPatientId] = useState(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    setExpanded({});
    try {
      const res = await api.get("/patients/search", { params: { q: query.trim() } });
      setResults(res.data || []);
      if (res.data?.length === 1) {
        setExpanded({ [res.data[0].patient_id]: true });
      }
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const openPatient = (patientId) => setHistoryPatientId(patientId);

  // Called from PatientCompleteHistory's "Create Visit" button — creates a
  // new visit for a patient with no active visit, then jumps straight into it.
  const handleCreateVisitFromHistory = async (patientId) => {
    try {
      const res = await api.post(`/patients/${patientId}/create-visit`, {
        created_by: "Doctor",
      });
      const visitId = res.data?.visit_id;
      setHistoryPatientId(null);
      if (visitId) onOpenVisit(visitId);
    } catch (err) {
      console.error(err);
      alert("Failed to create visit. Please try again.");
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSearch(); };
  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <>
      <div className="pld-backdrop" onClick={handleClose} />
      <div className={`pld-drawer${closing ? " closing" : ""}`}>

        {/* top bar */}
        <div className="pld-topbar">
          <div className="pld-topbar-left">
            <div className="pld-topbar-icon">🔍</div>
            <div>
              <div className="pld-topbar-title">Patient Record Lookup</div>
              <div className="pld-topbar-sub">Search by name, mobile, or case number</div>
            </div>
          </div>
          <button className="pld-close-btn" onClick={handleClose}>✕</button>
        </div>

        {/* search */}
        <div className="pld-search-section">
          <div className="pld-search-label">🔎 &nbsp;Search Patient</div>
          <div className="pld-search-row">
            <div className="pld-input-wrap">
              <span className="pld-input-icon">👤</span>
              <input
                ref={inputRef}
                className="pld-input"
                placeholder="Name, mobile number, or case no…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            <button
              className="pld-search-go"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
            >
              {loading
                ? <><span className="dd-spinner" style={{ width:14, height:14, marginRight:0 }} /> Searching</>
                : <>Search</>
              }
            </button>
          </div>
          <div className="pld-hint">Tip: partial names work too — try "ram" or "9876"</div>
        </div>

        {/* results */}
        <div className="pld-results">
          {loading && (
            <div className="pld-spin">
              <div className="dd-spinner" style={{ width:20, height:20 }} />
              Searching patient records…
            </div>
          )}

          {!loading && results === null && (
            <div className="pld-no-results" style={{ paddingTop:60 }}>
              <div className="pld-no-results-icon">🦷</div>
              <div>Enter a patient name or mobile to view their dental history</div>
            </div>
          )}

          {!loading && results !== null && results.length === 0 && (
            <div className="pld-no-results">
              <div className="pld-no-results-icon">🔍</div>
              <div>No patients found for <strong>"{query}"</strong></div>
              <div style={{ fontSize:12, marginTop:8, color:"#b0bad0" }}>Try a different name or mobile number</div>
            </div>
          )}

          {!loading && results !== null && results.length > 0 && (
            <>
              <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:12 }}>
                {results.length} patient{results.length !== 1 ? "s" : ""} found
              </div>
              {results.map(p => (
                <div key={p.patient_id} className="pld-patient-card">
                  <div className="pld-patient-header" onClick={() => toggleExpand(p.patient_id)}>
                    <div className="pld-patient-info">
                      <div className="pld-avatar-lg" style={{ background: avatarColor(p.name) }}>
                        {(p.name || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="pld-p-name">{p.name}</div>
                        <div className="pld-p-meta">
                          {p.mobile && <span>📱 {p.mobile}</span>}
                          {p.age    && <span>🎂 {p.age} yrs</span>}
                          {p.gender && <span>⚧ {p.gender}</span>}
                          {p.blood_group && <span>🩸 {p.blood_group}</span>}
                        </div>
                        <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>
                          {p.visits?.length || 0} visit{(p.visits?.length||0) !== 1 ? "s" : ""} on record
                        </div>
                      </div>
                    </div>
                    <span className={`pld-expand-icon${expanded[p.patient_id] ? " open" : ""}`}>›</span>
                  </div>

                 {expanded[p.patient_id] && (
  <div className="pld-history">

    <button
      className="pld-search-go"
      style={{ marginBottom: 12 }}
      onClick={() => openPatient(p.patient_id)}
    >
      View Complete Patient History
    </button>

    <div className="pld-history-title">
      📋 &nbsp;Visit History
    </div>
                      {(!p.visits || p.visits.length === 0) ? (
                        <div className="pld-no-history">
                          <div className="pld-no-history-icon">📂</div>
                          No visits recorded for this patient
                        </div>
                      ) : (
                        [...p.visits]
                          .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date))
                          .map(v => (
                            <VisitHistoryItem
                              key={v.visit_id}
                              visit={v}
                              onOpenVisit={onOpenVisit}
                            />
                          ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── complete patient history (read-only) ── */}
      {historyPatientId && (
        <PatientCompleteHistory
          patientId={historyPatientId}
          readOnlyLabel="Doctor — Read Only"
          onBack={() => setHistoryPatientId(null)}
          onCreateVisit={handleCreateVisitFromHistory}
          onOpenVisit={(visitId) => { setHistoryPatientId(null); onOpenVisit(visitId); }}
        />
      )}
    </>
  );
};

/* ═══════════════════════════════════════════
   CONFIRM MODAL
═══════════════════════════════════════════ */
const ConfirmModal = ({ visit, onConfirm, onCancel, closing }) => (
  <div className="dd-overlay" onClick={onCancel}>
    <div className="dd-confirm-box" onClick={(e) => e.stopPropagation()}>
      <div className="dd-confirm-icon">✅</div>
      <div className="dd-confirm-title">Mark as Completed?</div>
      <div className="dd-confirm-sub">
        You are about to close the visit for{" "}
        <span className="dd-confirm-name">{visit.name}</span>
        {visit.case_number ? ` (Case: ${visit.case_number})` : ""}.
        <br />This will mark the visit as <strong>CLOSED</strong> and it will no longer appear in the active list.
      </div>
      {!visit.has_clinical_notes && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8,
          padding: "10px 12px", margin: "0 0 14px", fontSize: 12.5,
          color: "#92400e", fontWeight: 600, textAlign: "left",
        }}>
          ⚠️ No diagnosis or treatment has been recorded for this visit yet.
          Consider opening the visit to document it before completing.
        </div>
      )}
      <div className="dd-confirm-btns">
        <button className="dd-confirm-no" onClick={onCancel}>Cancel</button>
        <button className="dd-confirm-yes" onClick={onConfirm} disabled={closing}>
          {closing ? "Closing…" : "✔ Yes, Complete Visit"}
        </button>
      </div>
    </div>
  </div>
);
/* ══════════════════════════════════════════
   APPOINTMENTS — kept in Supabase, the same list as the Appointments app,
   each booking linked to the patient (the old diary of this app is gone).
══════════════════════════════════════════ */
const AppointmentsSection = (props) => <AppointmentsBoard role="doctor" {...props} />;

export default function DoctorDashboard() {
  const [visits,      setVisits]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [confirm,     setConfirm]     = useState(null);
  const [closing,     setClosing]     = useState(false);
  const [lookupOpen,  setLookupOpen]  = useState(false);
  const [apptOpen,    setApptOpen]    = useState(false);
  const [showDebug,   setShowDebug]   = useState(false);
  const [rawSample,   setRawSample]   = useState(null);
  const navigate = useNavigate();
  const [apptHistoryId, setApptHistoryId] = useState(null);   // history opened from Appointments

  useEffect(() => {
    injectStyles();
    loadOpenVisits();

    // ── Auto-refresh so a visit created from Reception shows up here ──
    // without a manual page reload. Two complementary triggers:
    //  1. Light polling (every 15s) — catches new/changed visits even if
    //     this tab is just sitting open and idle.
    //  2. Refetch on tab focus / visibility — near-instant update for the
    //     common case of switching back to this tab after creating a
    //     visit elsewhere, without waiting for the next poll tick.
    // Both call loadOpenVisits(true) — silent mode — so they update the
    // table in place instead of flashing the full-page loading spinner
    // every 15 seconds.
    const intervalId = setInterval(() => loadOpenVisits(true), 15000);

    const onFocus = () => { if (document.visibilityState === "visible") loadOpenVisits(true); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOpenVisits = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get("/doctor/visits");
      // Backend returns patient_name — normalize to `name` since the rest
      // of this component (avatar initials, search filter, confirm
      // dialog) reads v.name.
      const data = (res.data || []).map(v => ({ ...v, name: v.patient_name || v.name }));
      setVisits(data);

      /* ── FIX: Log first visit raw object to console so you can see
         exactly what field names the backend returns.
         Also store for the debug banner. ── */
      if (data.length > 0) {
        console.log("[DoctorDashboard] First visit raw object from API:", data[0]);
        console.log("[DoctorDashboard] All keys on first visit:", Object.keys(data[0]));
        setRawSample(data[0]);

        // Show debug banner if complaint is missing on ALL visits
        // Only warn about a broken backend when NEITHER field has data
        // anywhere — a visit legitimately having one but not the other
        // (e.g. a follow-up visit with a blank chief complaint, or a new
        // complaint with no follow-up notes yet) is normal, expected data,
        // not a sign the API is missing a field.
        const anyHasInfo = data.some(v => resolveComplaint(v) || resolveFollowup(v));
        if (!anyHasInfo) setShowDebug(true);
      }
    } catch (err) {
      console.error(err);
      if (!silent) alert("Failed to load visits");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!confirm) return;
    setClosing(true);
    try {
      await api.put(`/visits/${confirm.visit_id}/close`);
      setVisits((prev) => prev.filter((v) => v.visit_id !== confirm.visit_id));
      setConfirm(null);
      // Visit closed — receptionist will handle billing
    } catch (err) {
      console.error(err);
      alert("Failed to close visit. Please try again.");
    } finally {
      setClosing(false);
    }
  };

  // Workflow step 7: opening a visit must flip CREATED → IN_PROGRESS and
  // write an audit entry. start_visit() is idempotent (safe to call even
  // if the visit is already IN_PROGRESS or was just created), so we
  // always call it before navigating in.
  const handleOpenVisit = async (visitId) => {
    setLookupOpen(false);
    try {
      await api.post(`/doctor/visit/${visitId}/start`, { doctor_name: "Doctor" });
    } catch (err) {
      console.error("Failed to start visit:", err);
      // Non-fatal — still let the doctor into the visit view.
    }
    navigate(`/doctor/visit/${visitId}`);
  };

  if (loading) return (
    <div className="dd-loading">
      <div className="dd-spinner" />
      Loading patient visits…
    </div>
  );

  /* Unified search: filters by name, case number, mobile, or chief complaint */
  const filtered = visits.filter((v) => {
    const q = search.toLowerCase().trim();
    const complaint = resolveComplaint(v);
    return (
      !q ||
      (v.name        || "").toLowerCase().includes(q) ||
      (v.case_number || "").toLowerCase().includes(q) ||
      (v.mobile      || "").includes(q)               ||
      complaint.toLowerCase().includes(q)
    );
  });

  const todayStr   = new Date().toDateString();
  const todayCount = visits.filter(v => new Date(v.visit_date).toDateString() === todayStr).length;
  const noComplaintCount = visits.filter(v => !resolveComplaint(v)).length;

  return (
    <div className="dd-root">

      {/* ── confirm modal ── */}
      {confirm && (
        <ConfirmModal
          visit={confirm}
          onConfirm={handleComplete}
          onCancel={() => !closing && setConfirm(null)}
          closing={closing}
        />
      )}

      {/* ── patient lookup drawer ── */}
      {lookupOpen && (
        <PatientLookupDrawer
          onClose={() => setLookupOpen(false)}
          onOpenVisit={handleOpenVisit}
        />
      )}

      {/* ── appointments modal ── */}
      {apptOpen && (
        <div style={{
          position:"fixed", inset:0,
          background:"rgba(8,20,50,0.55)",
          backdropFilter:"blur(6px)",
          zIndex:800,
          display:"flex", alignItems:"flex-start", justifyContent:"center",
          overflowY:"auto",
          padding:"32px 16px 48px",
          animation:"dd-in 0.2s both"
        }}
          onClick={() => setApptOpen(false)}
        >
          <div
            style={{
              width:"100%", maxWidth:920,
              background:"#f0f4fb",
              borderRadius:20,
              boxShadow:"0 24px 80px rgba(8,20,50,0.28)",
              overflow:"hidden",
              animation:"dd-up 0.28s cubic-bezier(.22,.68,0,1.2) both"
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              background:"linear-gradient(135deg,#0b2d4e,#1059a0)",
              padding:"18px 28px",
              display:"flex", alignItems:"center", justifyContent:"space-between"
            }}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:38,height:38,borderRadius:10,background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📅</div>
                <div>
                  <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>Appointments</div>
                  <div style={{fontSize:11.5,color:"rgba(255,255,255,0.6)",marginTop:1}}>Same list as the Appointments app · linked to patients</div>
                </div>
              </div>
              <button
                onClick={() => setApptOpen(false)}
                style={{width:34,height:34,borderRadius:9,background:"rgba(255,255,255,0.12)",border:"1.5px solid rgba(255,255,255,0.25)",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}
              >✕</button>
            </div>
            <div style={{padding:"24px 28px 28px"}}>
              <AppointmentsSection
                onOpenVisit={(vid) => { setApptOpen(false); handleOpenVisit(vid); }}
                onOpenHistory={(pid) => setApptHistoryId(pid)}
              />
            </div>
          </div>
        </div>
      )}
      {apptHistoryId && (
        <PatientCompleteHistory
          patientId={apptHistoryId}
          readOnlyLabel="Doctor — Read Only"
          onBack={() => setApptHistoryId(null)}
        />
      )}

      {/* ══ HEADER ══ */}
      <div className="dd-header">
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div className="dd-header-logo">🦷</div>
          <div>
            <p className="dd-header-clinic">Sri Satya Sai Oral Health Center & Dental Clinic</p>
            <p className="dd-header-sub">Dr. Rama Raju · MDS &nbsp;|&nbsp; Doctor Dashboard</p>
          </div>
        </div>
        <div className="dd-header-right">
          <div className="dd-search-bar-wrap">
            <span className="dd-search-bar-icon">🔍</span>
            <input
              className="dd-search-bar"
              placeholder="Filter open visits by name, mobile, case no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="dd-appt-nav-btn"
            onClick={() => setLookupOpen(true)}
            title="Search all patients, including those with no active visit"
          >
            🔎 Patient Lookup
          </button>
          <button
            className="dd-appt-nav-btn"
            onClick={() => setApptOpen(true)}
            title="View appointments"
          >
            📅 Appointments
          </button>
          <div className="dd-header-badge">
            <span />
            {visits.length} Active Visit{visits.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="dd-body">

        {/* ══ DEBUG BANNER — shown only when NEITHER chief complaint NOR
             follow-up notes is found on ANY visit (real backend/field issue,
             not just today's visits legitimately having one field blank) ══ */}
        {showDebug && rawSample && (
          <div className="dd-debug-banner">
            <button className="dd-debug-close" onClick={() => setShowDebug(false)}>✕</button>
            <strong>⚠️ Chief Complaint / Followup Notes not found in API response.</strong>
            <br />
            Your backend <code>/doctor/visits</code> doesn't appear to be returning either field.
            Open <strong>DevTools → Console</strong> to see the exact field names being returned.
            <br />
            Fields available on first visit:{" "}
            <code style={{ background:"#fef08a", padding:"1px 5px", borderRadius:4, fontSize:11 }}>
              {Object.keys(rawSample).join(", ")}
            </code>
            <br />
            <span style={{ fontSize:11, color:"#92400e", marginTop:4, display:"block" }}>
              👉 Fix your backend to include <code>chief_complaint</code> and <code>followup_treatment</code> in the <code>GET /doctor/visits</code> response.
            </span>
          </div>
        )}

        {/* ══ STATS ══ */}
        <div className="dd-stats">
          {[
            { label:"Open Visits",    value:visits.length,    sub:"awaiting consultation",  icon:"🟢", delay:"0s"    },
            { label:"Today's Visits", value:todayCount,        sub:"registered today",        icon:"📅", delay:"0.06s" },
            { label:"Pending Review", value:noComplaintCount,  sub:"no complaint recorded",   icon:"⏳", delay:"0.12s" },
          ].map((s) => (
            <div className="dd-stat-card" key={s.label} style={{ animationDelay:s.delay }}>
              <div className="dd-stat-label">{s.icon}&nbsp; {s.label}</div>
              <div className="dd-stat-value">{s.value}</div>
              <div className="dd-stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ══ VISITS TABLE ══ */}
        <div className="dd-card">
          <div className="dd-card-header">
            <div className="dd-card-title">Open Patient Visits</div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {search && (
                <span style={{ fontSize:11.5, color:"#64748b", background:"#f0f4ff", border:"1px solid #c7d9fc", padding:"4px 10px", borderRadius:20, fontWeight:600 }}>
                  {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{search}"
                </span>
              )}
              <button className="dd-refresh-btn" onClick={() => loadOpenVisits()}>↻ Refresh</button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="dd-empty">
              <div className="dd-empty-icon">🦷</div>
              {search ? `No visits match "${search}".` : "No open visits at the moment."}
            </div>
          ) : (
            <table className="dd-table">
              <thead>
                <tr>
                  <th style={{ width:40 }}>#</th>
                  <th>Patient</th>
                  <th>Chief Complaint</th>
                  <th>Followup Notes</th>
                  <th>Visit Date</th>
                  <th>Status</th>
                  <th style={{ textAlign:"center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, idx) => {
                  const complaint = resolveComplaint(v);
                  const followup  = resolveFollowup(v);
                  return (
                    <tr key={v.visit_id} style={{ animationDelay:`${idx * 0.04}s` }}>
                      <td style={{ color:"#b0bad0", fontWeight:700, fontSize:12 }}>{idx + 1}</td>
                      <td>
                        <div className="dd-name-cell">
                          <div className="dd-avatar" style={{ background:avatarColor(v.name) }}>
                            {(v.name || "?")[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="dd-name">{v.name || "—"}</div>
                            <div className="dd-case">📁 {v.case_number || "No case no."}</div>
                          </div>
                        </div>
                      </td>

                      {/* ── Chief Complaint cell ── */}
                      <td style={{ maxWidth:180 }}>
                        {complaint
                          ? <span style={{ fontSize:12.5, display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:170, color:"#0e7490", fontWeight:600 }} title={complaint}>{complaint}</span>
                          : <span style={{ color:"#c0cce0", fontSize:12, fontStyle:"italic" }}>Not recorded</span>
                        }
                      </td>

                      {/* ── Followup Notes cell ── */}
                      <td style={{ maxWidth:180 }}>
                        {followup
                          ? <span style={{ fontSize:12.5, display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:170, color:"#92400e", fontWeight:600 }} title={followup}>{followup}</span>
                          : <span style={{ color:"#c0cce0", fontSize:12, fontStyle:"italic" }}>—</span>
                        }
                      </td>

                      <td style={{ fontWeight:600, color:"#1a2540" }}>{formatDate(v.visit_date)}</td>
                      <td>
                        <span className="dd-chip" style={{ background:"#f0fdf4", color:"#166534", border:"1px solid #86efac" }}>
                          🟢 Open
                        </span>
                      </td>
                      <td>
                        <div className="dd-action-cell" style={{ justifyContent:"center" }}>
                          <button className="dd-open-btn" onClick={() => handleOpenVisit(v.visit_id)}>
                            Open →
                          </button>
                          <button className="dd-complete-btn" onClick={() => setConfirm(v)}>
                            ✔ Complete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {filtered.length > 0 && (
            <div style={{ padding:"12px 20px", borderTop:"1px solid #f0f4fb", fontSize:11.5, color:"#94a3b8", textAlign:"right" }}>
              Showing {filtered.length} of {visits.length} visit{visits.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
/* ═══════════════════════════════════════════
   APPOINTMENTS PAGE
   Use this as the component for route /appointments
   e.g. <Route path="/appointments" element={<AppointmentsPage />} />
═══════════════════════════════════════════ */
export function AppointmentsPage() {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div className="dd-root">
      {/* ══ HEADER ══ */}
      <div className="dd-header">
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div className="dd-header-logo">🦷</div>
          <div>
            <p className="dd-header-clinic">Sri Satya Sai Oral Health Center &amp; Dental Clinic</p>
            <p className="dd-header-sub">Dr. Rama Raju · MDS &nbsp;|&nbsp; Appointments</p>
          </div>
        </div>
        <div className="dd-header-right">
          <button
            className="dd-appt-nav-btn"
            onClick={() => window.close()}
            title="Close this tab"
          >
            ✕ Close Tab
          </button>
        </div>
      </div>
      <div className="dd-body">
        <AppointmentsSection />
      </div>
    </div>
  );
}