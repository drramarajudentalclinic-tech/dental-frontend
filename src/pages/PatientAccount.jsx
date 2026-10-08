import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/*
  <PatientAccount />  — a patient's billing account (inside Billing)
  ────────────────────────────────────────────────────────────────
  Everything Reception needs to bill one patient, on one screen:

    • At the top: total charges, discount, paid and the BALANCE DUE.
    • 💰 Treatments & balance — every treatment with its charge, discount,
      what has been paid and what is left (Not paid / Part paid / Paid).
      Add, change or delete treatments. Tick the treatments the patient is
      paying for now and press "Take payment".
    • Take payment — for each chosen treatment: pay all of it or part of it.
      Or type the amount received and it is shared out by itself. Shows,
      before saving, what stays to be paid on each treatment and the
      patient's total balance after this payment. A new treatment can be
      added and paid in the same go.
    • 🧾 Payments — every receipt of the patient: view (PDF), change, delete.
      Balances follow by themselves.
    • 🦷 Clinical record — the doctor's visits: diagnosis, treatment done,
      treatment plan, dental chart, prescriptions, X-rays and photos —
      read-only, to bill correctly.

  Server side: billing_receipts.py
    GET  /clinic-billing/patients/<id>/account
    POST /clinic-billing/patients/<id>/charges, PUT/DELETE /clinic-billing/charges/<id>
    POST/PUT /clinic-billing/receipts  with  allocations / new_charges
  Clinical record: GET /patients/<id>/complete-history (patients.py, unchanged).

  Used by BillingReceipts.jsx (same pages folder).
*/

const PAYMENT_METHODS = ["UPI", "Cheque", "A/C", "Card", "Cash"];
const FALLBACK_TREATMENTS = [
  "Scaling", "Polishing", "Filling (Composite)", "Filling (GIC)", "Extraction", "Surgical Extraction",
  "Root Canal Treatment", "Re-RCT", "Crown (Metal)", "Crown (PFM)", "Crown (Zirconia)", "Bridge",
  "Implant", "Implant + Crown", "Complete Denture (Upper)", "Complete Denture (Lower)", "Partial Denture",
  "Orthodontic Treatment", "Tooth Whitening", "X-Ray", "Consultation", "Follow-up Visit",
];
const CUSTOM = "__custom__";

/* ── small helpers ── */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function fmtDate(d) {
  if (!d) return "—";
  const p = String(d).split("T")[0].split("-");
  if (p.length !== 3) return d;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${p[2]} ${months[Number(p[1]) - 1] || p[1]} ${p[0]}`;
}
function errorText(err, fallback) {
  const status = err?.response?.status;
  if (status === 404 && !err?.response?.data?.error) {
    return "This needs the new billing_receipts.py on the server. Copy it into the backend's routes folder and restart the backend.";
  }
  if (status === 401) return "Your login has ended. Please log in again.";
  return err?.response?.data?.error || fallback;
}
let keySeq = 0;
const nextKey = () => ++keySeq;

const STATUS_STYLE = {
  "Paid":      { bg: "#dcfce7", fg: "#166534", bar: "#22c55e" },
  "Part paid": { bg: "#fef3c7", fg: "#92400e", bar: "#f59e0b" },
  "Not paid":  { bg: "#fee2e2", fg: "#991b1b", bar: "#ef4444" },
  "No charge": { bg: "#f1f5f9", fg: "#475569", bar: "#94a3b8" },
};
const StatusPill = ({ status }) => {
  const st = STATUS_STYLE[status] || STATUS_STYLE["No charge"];
  return <span className="pa-pill" style={{ background: st.bg, color: st.fg }}>{status === "Paid" ? "✓ " : ""}{status}</span>;
};

function AccountStyles() {
  return (
    <style>{`
      .pa-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
      .pa-tile { border-radius: 12px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
      .pa-tile-l { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748b; }
      .pa-tile-v { font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 2px; white-space: nowrap; }
      .pa-tile-due { background: #fef2f2; border-color: #fecaca; } .pa-tile-due .pa-tile-v { color: #b91c1c; }
      .pa-tile-clear { background: #ecfdf5; border-color: #a7f3d0; } .pa-tile-clear .pa-tile-v { color: #047857; }
      .pa-pill { display: inline-block; font-size: 11.5px; font-weight: 800; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
      .pa-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .pa-row { display: grid; grid-template-columns: 30px minmax(0, 3.2fr) minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.6fr) auto;
        gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 8px; background: #fff;
        transition: border-color .15s, background .15s; }
      .pa-row:hover { border-color: #9fd9c4; }
      .pa-row[data-selected="true"] { border-color: #0f766e; background: #f0fdf9; box-shadow: 0 0 0 2px rgba(15,118,110,0.12); }
      .pa-row[data-done="true"] { background: #fbfdfc; }
      .pa-row input[type=checkbox] { width: 19px; height: 19px; cursor: pointer; accent-color: #0f766e; }
      .pa-name { font-weight: 800; font-size: 14.5px; color: #0f172a; overflow-wrap: anywhere; }
      .pa-sub { font-size: 12.5px; color: #64748b; overflow-wrap: anywhere; }
      .pa-k { font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #94a3b8; }
      .pa-amt { font-size: 13.5px; font-weight: 700; color: #1e293b; white-space: nowrap; }
      .pa-bar { height: 6px; border-radius: 4px; background: #e2e8f0; overflow: hidden; margin-top: 5px; }
      .pa-bar > span { display: block; height: 100%; border-radius: 4px; }
      .pa-bal { font-size: 15px; font-weight: 800; white-space: nowrap; }
      .pa-acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .pa-payments { grid-column: 2 / -1; font-size: 12.5px; color: #475569; display: flex; gap: 6px; flex-wrap: wrap; }
      .pa-link { background: none; border: 0; padding: 0; font: inherit; color: #0f766e; font-weight: 700; cursor: pointer; text-decoration: underline; }
      .pa-sticky { position: sticky; bottom: 10px; z-index: 30; margin-top: 14px; display: flex; gap: 12px; align-items: center; justify-content: space-between;
        flex-wrap: wrap; background: #0f172a; color: #fff; border-radius: 14px; padding: 12px 16px; box-shadow: 0 12px 30px rgba(15,23,42,0.35); }
      .pa-sticky strong { font-size: 16px; }
      .pa-big { position: fixed; inset: 0; z-index: 3000; background: rgba(15,23,42,0.6); display: flex; align-items: flex-start; justify-content: center;
        padding: 24px 12px; overflow-y: auto; }
      .pa-sheet { background: #fff; border-radius: 16px; width: min(860px, 100%); box-shadow: 0 25px 60px rgba(0,0,0,0.35);
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; color: #1e293b; overflow: hidden; }
      .pa-sheet-head { background: linear-gradient(90deg, #2f9e75, #3fb6c9); color: #fff; padding: 16px 22px; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
      .pa-sheet-head h3 { margin: 0; font-size: 17px; font-weight: 800; }
      .pa-sheet-body { padding: 18px 22px 22px; }
      .pa-pay { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2.4fr) minmax(130px, 1.6fr) minmax(0, 1.5fr) auto; gap: 10px; align-items: center;
        border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
      .pa-pay[data-bad="true"] { border-color: #f87171; background: #fef2f2; }
      .pa-pay-new { background: #f3fbf8; border-style: dashed; border-color: #9fd9c4; display: block; }
      .pa-quick { display: flex; gap: 4px; margin-top: 4px; }
      .pa-quick button { font: inherit; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; color: #0f766e; }
      .pa-quick button:hover { background: #ecfdf5; }
      .pa-sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
      .pa-sum > div { border-radius: 12px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; }
      .pa-sum .pa-now { background: #0f766e; border-color: #0f766e; color: #fff; }
      .pa-sum .pa-now .pa-k { color: rgba(255,255,255,0.8); }
      .pa-sum-v { font-size: 19px; font-weight: 800; white-space: nowrap; }
      .pa-err { color: #b91c1c; font-size: 12px; font-weight: 700; margin-top: 3px; }
      .pa-visit { border: 1px solid #f3d27a; border-left: 6px solid #f59e0b; border-radius: 12px; background: #fffbeb; padding: 12px 16px; margin-bottom: 16px; }
      .pa-clin { border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
      .pa-clin-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
      .pa-clin-body { padding: 12px 14px; display: grid; gap: 10px; }
      .pa-field { font-size: 13.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .pa-imgs { display: flex; gap: 10px; flex-wrap: wrap; }
      .pa-img { width: 120px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #f1f5f9; cursor: zoom-in; padding: 0; font: inherit; text-align: left; }
      .pa-img img, .pa-img .pa-img-ph { width: 120px; height: 90px; object-fit: cover; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #94a3b8; }
      .pa-img span { display: block; font-size: 11px; padding: 4px 6px; color: #334155; font-weight: 700; }
      .pa-mini { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .pa-mini th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
      .pa-mini td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
      .pa-seg { display: inline-flex; border: 1.5px solid #cbd5e1; border-radius: 9px; overflow: hidden; }
      .pa-seg button { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 12px; border: 0; background: #fff; cursor: pointer; color: #334155; }
      .pa-seg button[aria-pressed="true"] { background: #0f766e; color: #fff; }
      @media (max-width: 760px) {
        .pa-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pa-tile-v { font-size: 17px; }
        .pa-row { grid-template-columns: 26px minmax(0, 1fr) auto; }
        .pa-row > .pa-c-money, .pa-row > .pa-c-paid { grid-column: 2 / 3; }
        .pa-row > .pa-c-bal { grid-column: 3; grid-row: 1; text-align: right; }
        .pa-row > .pa-acts { grid-column: 2 / -1; justify-content: flex-start; }
        .pa-pay { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .pa-pay > .pa-p-name { grid-column: 1 / -1; }
        .pa-sum { grid-template-columns: minmax(0, 1fr); }
        .pa-sheet-body { padding: 14px; }
      }
    `}</style>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Delete a receipt — only with a reason, which is kept in the deletion log
   (also used by BillingReceipts.jsx)
══════════════════════════════════════════════════════════════════ */
const DELETE_REASONS = ["Created by mistake", "Duplicate receipt", "Wrong patient", "Wrong amount / treatment", "Patient cancelled / refunded"];

export function DeleteReceiptDialog({ receipt, onCancel, onDeleted }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef(null);
  const ready = reason.trim().length >= 3;

  const go = async () => {
    if (busy) return;
    if (!ready) { setError("Please write why this receipt is being deleted."); if (boxRef.current) boxRef.current.focus(); return; }
    setBusy(true); setError("");
    try {
      const res = await api.delete(`/clinic-billing/receipts/${receipt.id}`, { data: { reason: reason.trim() }, params: { reason: reason.trim() } });
      onDeleted(res.data || {}, reason.trim());
    } catch (err) {
      setError(errorText(err, "Not deleted — please check the connection and try again."));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="br-overlay" role="dialog" aria-modal="true" aria-label="Delete receipt"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel(); }}>
      <div className="br-dialog" style={{ width: "min(500px, 100%)" }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>🗑 Delete this receipt?</div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: "#334155" }}>
          Receipt <strong>#{receipt.receipt_no}</strong> — {receipt.name}, ₹{(Number(receipt.amount_paid) || 0).toFixed(2)}, {receipt.date}.
          {receipt.has_allocations && <><br />The treatments it paid for will show their balance again.</>}
          {receipt.visit_id ? <><br />If it is the only receipt of its visit, the visit goes back to Pending.</> : null}
        </div>
        <label className="br-label" htmlFor="br-del-reason" style={{ marginTop: 14 }}>Why is it being deleted? <span style={{ color: "#b91c1c" }}>*</span></label>
        <div className="br-chips" style={{ marginBottom: 8 }}>
          {DELETE_REASONS.map((r) => (
            <button key={r} type="button" className="br-chip" style={{ fontSize: 12, padding: "4px 10px" }} aria-pressed={reason === r} onClick={() => { setReason(r); setError(""); }}>{r}</button>
          ))}
        </div>
        <textarea id="br-del-reason" ref={boxRef} className="br-input" rows={2} maxLength={500} value={reason} autoFocus
          placeholder="Choose above or type the reason…" onChange={(e) => { setReason(e.target.value); setError(""); }} style={{ resize: "vertical" }} />
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
          A full copy of the receipt, this reason, your name and the time are kept in <strong>Deleted receipts</strong>.
          {" "}If it is the latest receipt, the next receipt gets its number (#{receipt.receipt_no}) again.
        </div>
        {error && <div className="br-note br-note-bad" role="alert" style={{ marginTop: 12, marginBottom: 0 }}><span>⚠️ {error}</span></div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className="br-btn br-btn-plain" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="br-btn br-btn-danger" disabled={busy || !ready} onClick={go}>{busy ? "Deleting…" : "Delete receipt"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════
   Choose the patient (first step of "+ Add Payment")
══════════════════════════════════════════════════════════════════ */
export function ChoosePatient({ onPick, onWalkIn, onBack }) {
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  useEffect(() => {
    const q = typed.trim();
    if (q.length < 2) { setFound([]); setSearched(false); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.get("/clinic-billing/patients", { params: { q } })
        .then((res) => { if (!cancelled) setFound(Array.isArray(res.data) ? res.data : []); })
        .catch(() => { if (!cancelled) setFound([]); })
        .finally(() => { if (!cancelled) { setSearching(false); setSearched(true); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [typed]);

  return (
    <div className="br-card">
      <AccountStyles />
      <div className="br-head">
        <div>
          <h2>💰 Add Payment — choose the patient</h2>
          <p>Opens the patient's account: treatments, balance, X-rays and photos</p>
        </div>
        <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>← Back to Payments</button>
      </div>
      <div className="br-body">
        <label className="br-label" htmlFor="pa-find">Patient</label>
        <input id="pa-find" ref={inputRef} className="br-input" style={{ fontSize: 16, padding: "12px 14px" }} value={typed} autoComplete="off"
          placeholder="Type the name, case number or mobile…" onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && found.length) onPick(found[0]); }} />
        <div style={{ minHeight: 24, fontSize: 12.5, color: "#94a3b8", marginTop: 6 }}>
          {typed.trim().length < 2 ? "Type at least 2 letters." : searching ? "Searching…" : ""}
        </div>
        <div role="listbox" aria-label="Matching patients" style={{ display: "grid", gap: 8 }}>
          {found.map((p) => (
            <button key={p.patient_id} type="button" role="option" aria-selected="false" className="br-pick"
              style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" }} onClick={() => onPick(p)}>
              <strong style={{ fontSize: 15 }}>{p.name}</strong>
              <span style={{ color: "#64748b" }}>{p.case_number ? ` · Case ${p.case_number}` : ""}{p.mobile ? ` · ${p.mobile}` : ""}{p.age ? ` · ${p.age} yrs` : ""}</span>
              <span style={{ float: "right", color: "#0f766e", fontWeight: 700 }}>Open account →</span>
            </button>
          ))}
          {searched && !searching && found.length === 0 && (
            <div className="br-note br-note-info" style={{ marginBottom: 0 }}><span>No patient found for “{typed.trim()}”.</span></div>
          )}
        </div>
        <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 20, paddingTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="br-btn br-btn-plain" onClick={onWalkIn}>🧾 Simple receipt (walk-in, not registered)</button>
          <span style={{ fontSize: 12.5, color: "#64748b" }}>The old-style receipt form — no account or balance.</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Add / change a treatment (charge + discount)
══════════════════════════════════════════════════════════════════ */
function ChargeDialog({ patientId, charge, preset, visits, treatmentList, onClose, onSaved }) {
  const editing = Boolean(charge);
  const start = charge || preset || {};
  const knownName = !start.treatment || treatmentList.includes(start.treatment);
  const [pick, setPick] = useState(start.treatment ? (knownName ? start.treatment : CUSTOM) : "");
  const [custom, setCustom] = useState(knownName ? "" : start.treatment || "");
  const [description, setDescription] = useState(start.description || "");
  const [visitId, setVisitId] = useState(start.visit_id ? String(start.visit_id) : "");
  const [date, setDate] = useState(start.date || todayIso());
  const [fee, setFee] = useState(start.fee != null ? String(start.fee) : "");
  const [discMode, setDiscMode] = useState("rs");
  const [disc, setDisc] = useState(start.discount ? String(start.discount) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const name = pick === CUSTOM ? custom.trim() : pick;
  const feeN = num(fee);
  const discN = discMode === "pc" ? r2(feeN * num(disc) / 100) : num(disc);
  const net = r2(feeN - discN);
  const paid = charge?.paid || 0;
  const problem = !name ? "Choose or type the treatment."
    : fee === "" ? "Enter the charge."
    : feeN < 0 ? "The charge cannot be negative."
    : discN < 0 ? "The discount cannot be negative."
    : discMode === "pc" && num(disc) > 100 ? "The discount cannot be more than 100%."
    : discN > feeN + 0.004 ? "The discount is more than the charge."
    : net + 0.004 < paid ? `${inr(paid)} is already paid towards this treatment — the charge after discount cannot be less.`
    : "";

  const save = async (andPay) => {
    if (saving) return;
    if (problem) { setError(problem); return; }
    const body = { treatment: name, description: description.trim(), visit_id: visitId ? Number(visitId) : null, date, fee: feeN };
    if (discMode === "pc") body.discount_percent = num(disc); else body.discount = discN;
    setSaving(true); setError("");
    try {
      const res = editing
        ? await api.put(`/clinic-billing/charges/${charge.charge_id}`, body)
        : await api.post(`/clinic-billing/patients/${patientId}/charges`, body);
      onSaved(res.data, andPay);
    } catch (err) {
      setError(errorText(err, "Not saved — please check the connection and try again."));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="pa-big" role="dialog" aria-modal="true" aria-label={editing ? "Change treatment" : "Add treatment"}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !saving) onClose(); }}>
      <div className="pa-sheet" style={{ width: "min(620px, 100%)" }}>
        <AccountStyles />
        <div className="pa-sheet-head">
          <h3>{editing ? "✏️ Change treatment" : "➕ Add treatment"}</h3>
          <button type="button" className="br-btn br-btn-ghost br-btn-sm" onClick={onClose} disabled={saving}>✕ Close</button>
        </div>
        <div className="pa-sheet-body">
          {error && <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>}
          <div className="br-grid">
            <div style={{ gridColumn: "span 12" }}>
              <label className="br-label" htmlFor="pa-c-treat">Treatment</label>
              <select id="pa-c-treat" className="br-input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">-- Select Treatment --</option>
                {treatmentList.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value={CUSTOM}>+ Custom</option>
              </select>
              {pick === CUSTOM && (
                <input className="br-input" style={{ marginTop: 6 }} aria-label="Custom treatment" placeholder="Type the treatment" maxLength={200}
                  value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />
              )}
            </div>
            <div style={{ gridColumn: "span 12" }}>
              <label className="br-label" htmlFor="pa-c-desc">Tooth / notes <span style={{ fontWeight: 500, color: "#64748b" }}>(printed on the receipt)</span></label>
              <input id="pa-c-desc" className="br-input" maxLength={500} placeholder="e.g. Tooth 36, 3 sittings" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label className="br-label" htmlFor="pa-c-date">Date</label>
              <input id="pa-c-date" type="date" className="br-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label className="br-label" htmlFor="pa-c-visit">Visit</label>
              <select id="pa-c-visit" className="br-input" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
                <option value="">— not linked to a visit —</option>
                {visits.map((v) => <option key={v.visit_id} value={v.visit_id}>{fmtDate(v.date)}{v.treatment_done ? ` · ${v.treatment_done.slice(0, 40)}` : ""}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label className="br-label" htmlFor="pa-c-fee">Charge (₹)</label>
              <input id="pa-c-fee" className="br-input" type="number" min="0" step="any" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label className="br-label" htmlFor="pa-c-disc">Discount</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input id="pa-c-disc" className="br-input" type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                  value={disc} onChange={(e) => setDisc(e.target.value)} />
                <div className="pa-seg" role="group" aria-label="Discount in">
                  <button type="button" aria-pressed={discMode === "rs"} onClick={() => setDiscMode("rs")}>₹</button>
                  <button type="button" aria-pressed={discMode === "pc"} onClick={() => setDiscMode("pc")}>%</button>
                </div>
              </div>
            </div>
          </div>
          <div className="pa-sum" style={{ gridTemplateColumns: editing ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))" }}>
            <div><div className="pa-k">Discount</div><div className="pa-sum-v">{inr(discN)}</div></div>
            <div className="pa-now"><div className="pa-k">To be paid</div><div className="pa-sum-v" data-testid="charge-net">{inr(net)}</div></div>
            {editing && <div><div className="pa-k">Already paid</div><div className="pa-sum-v">{inr(paid)}</div></div>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="br-btn br-btn-main" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : editing ? "💾 Save changes" : "💾 Add treatment"}</button>
            {!editing && <button type="button" className="br-btn br-btn-plain" style={{ color: "#0f766e", borderColor: "#2f9e75" }} disabled={saving} onClick={() => save(true)}>💳 Add &amp; take payment</button>}
            <button type="button" className="br-btn br-btn-plain" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════
   Take payment / change a payment
══════════════════════════════════════════════════════════════════ */
function PaymentDialog({ account, chosen, receipt, visit, treatmentList, onClose, onSaved }) {
  const editing = Boolean(receipt);
  const charges = account.charges;
  const byId = useMemo(() => Object.fromEntries(charges.map((c) => [c.charge_id, c])), [charges]);
  // What this payment already holds per treatment (when changing it): that much is "available" again.
  const ownPaid = useMemo(() => {
    const own = {};
    (receipt?.treatments || []).forEach((t) => { if (t.charge_id) own[t.charge_id] = r2((own[t.charge_id] || 0) + num(t.amount)); });
    return own;
  }, [receipt]);
  const plainLines = useMemo(() => (receipt?.treatments || []).filter((t) => !t.charge_id), [receipt]);
  const available = (cid) => r2((byId[cid]?.balance || 0) + (ownPaid[cid] || 0));

  const [lines, setLines] = useState(() => {
    if (editing) return Object.keys(ownPaid).map((cid) => ({ charge_id: Number(cid), pay: String(ownPaid[cid]) }));
    return chosen.map((cid) => ({ charge_id: cid, pay: String(available(cid)) }));
  });
  const [newLines, setNewLines] = useState([]);
  const [received, setReceived] = useState("");
  const [date, setDate] = useState(receipt?.date || todayIso());
  const [methods, setMethods] = useState(() => new Set(receipt?.payment_methods || []));
  const [notes, setNotes] = useState(receipt?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const others = charges.filter((c) => available(c.charge_id) > 0.004 && !lines.some((l) => l.charge_id === c.charge_id));

  const lineProblem = (l) => {
    const pay = num(l.pay);
    if (l.pay !== "" && !(parseFloat(l.pay) >= 0)) return "Enter a valid amount.";
    if (pay > available(l.charge_id) + 0.004) return `Only ${inr(available(l.charge_id))} is left to pay.`;
    return "";
  };
  const newNet = (n) => r2(num(n.fee) - (n.discMode === "pc" ? r2(num(n.fee) * num(n.disc) / 100) : num(n.disc)));
  const newProblem = (n) => {
    const name = n.pick === CUSTOM ? n.custom.trim() : n.pick;
    if (!name) return "Choose or type the treatment.";
    if (n.fee === "" || num(n.fee) < 0) return "Enter the charge.";
    if (newNet(n) < -0.004) return "The discount is more than the charge.";
    if (num(n.pay) < 0) return "Enter a valid amount.";
    if (num(n.pay) > newNet(n) + 0.004) return `Only ${inr(newNet(n))} is to be paid for it.`;
    return "";
  };

  const payExisting = r2(lines.reduce((s, l) => s + num(l.pay), 0));
  const payNew = r2(newLines.reduce((s, n) => s + num(n.pay), 0));
  const plainTotal = r2(plainLines.reduce((s, t) => s + num(t.amount), 0));
  const payNow = r2(payExisting + payNew + plainTotal);
  const leftOnThese = r2(lines.reduce((s, l) => s + Math.max(available(l.charge_id) - num(l.pay), 0), 0)
    + newLines.reduce((s, n) => s + Math.max(newNet(n) - num(n.pay), 0), 0));
  const ownTotal = r2(Object.values(ownPaid).reduce((s, v) => s + v, 0));
  const balanceAfter = r2(account.totals.balance + ownTotal - payExisting + newLines.reduce((s, n) => s + Math.max(newNet(n), 0) - num(n.pay), 0));
  const anyProblem = lines.some(lineProblem) || newLines.some(newProblem);
  const extra = received !== "" ? r2(num(received) - (payExisting + payNew)) : 0;

  const setPay = (cid, value) => { setReceived(""); setLines((prev) => prev.map((l) => (l.charge_id === cid ? { ...l, pay: value } : l))); };
  const changeNew = (key, patch) => { if ("pay" in patch) setReceived(""); setNewLines((prev) => prev.map((n) => (n.key === key ? { ...n, ...patch } : n))); };

  // "Amount received": shared out over the chosen treatments, oldest first.
  const shareOut = (value) => {
    setReceived(value);
    let left = num(value);
    setLines((prev) => prev.map((l) => {
      const take = r2(Math.min(Math.max(left, 0), available(l.charge_id)));
      left = r2(left - take);
      return { ...l, pay: String(take) };
    }));
    setNewLines((prev) => prev.map((n) => {
      const take = r2(Math.min(Math.max(left, 0), Math.max(newNet(n), 0)));
      left = r2(left - take);
      return { ...n, pay: String(take) };
    }));
  };
  const payAllInFull = () => {
    setReceived("");
    setLines((prev) => prev.map((l) => ({ ...l, pay: String(available(l.charge_id)) })));
    setNewLines((prev) => prev.map((n) => ({ ...n, pay: String(Math.max(newNet(n), 0)) })));
  };

  const toggleMethod = (m) => setMethods((prev) => { const s = new Set(prev); if (s.has(m)) s.delete(m); else s.add(m); return s; });

  const save = async () => {
    if (saving) return;
    if (anyProblem) { setError("Please correct the amounts marked in red."); return; }
    if (payNow <= 0) { setError("Enter how much is being paid now for at least one treatment."); return; }
    const p = account.patient;
    const body = {
      patient_id: p.patient_id,
      name: editing ? receipt.name : p.name,
      case_no: editing ? receipt.case_no : (p.case_number || ""),
      mobile: editing ? receipt.mobile : (p.mobile || ""),
      date,
      payment_methods: PAYMENT_METHODS.filter((m) => methods.has(m)),
      notes: notes.trim(),
      treatments: plainLines.map((t) => ({ name: t.name, amount: t.amount, description: t.description })),
      allocations: lines.filter((l) => num(l.pay) > 0).map((l) => ({ charge_id: l.charge_id, amount: r2(num(l.pay)) })),
      new_charges: newLines.map((n) => {
        const c = { treatment: n.pick === CUSTOM ? n.custom.trim() : n.pick, description: n.description.trim(), fee: num(n.fee), pay: r2(num(n.pay)) };
        if (n.discMode === "pc") c.discount_percent = num(n.disc); else c.discount = num(n.disc);
        if (visit?.visit_id) c.visit_id = visit.visit_id;
        return c;
      }),
    };
    if (!editing && visit?.visit_id) body.visit_id = visit.visit_id;
    setSaving(true); setError("");
    try {
      const res = editing
        ? await api.put(`/clinic-billing/receipts/${receipt.id}`, body)
        : await api.post("/clinic-billing/receipts", body);
      onSaved(res.data, editing);
    } catch (err) {
      setError(errorText(err, "The payment was not saved. Please check the connection and try again."));
      setSaving(false);
    }
  };

  const addNew = () => setNewLines((prev) => [...prev, { key: nextKey(), pick: "", custom: "", description: "", fee: "", disc: "", discMode: "rs", pay: "" }]);

  return createPortal(
    <div className="pa-big" role="dialog" aria-modal="true" aria-label={editing ? "Change payment" : "Take payment"}
      onKeyDown={(e) => { if (e.key === "Escape" && !saving) onClose(); }}>
      <div className="pa-sheet">
        <AccountStyles />
        <div className="pa-sheet-head">
          <div>
            <h3>{editing ? `✏️ Change payment — receipt #${receipt.receipt_no}` : "💳 Take payment"}</h3>
            <div style={{ fontSize: 12.5, opacity: 0.92 }}>{account.patient.name}{account.patient.case_number ? ` · Case ${account.patient.case_number}` : ""}</div>
          </div>
          <button type="button" className="br-btn br-btn-ghost br-btn-sm" onClick={onClose} disabled={saving}>✕ Close</button>
        </div>
        <div className="pa-sheet-body">
          {error && <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>}

          {(lines.length + newLines.length) > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label className="br-label" htmlFor="pa-received">Amount received from the patient <span style={{ fontWeight: 500, color: "#64748b" }}>(optional — shared out by itself)</span></label>
                <input id="pa-received" className="br-input" type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 5000"
                  value={received} onChange={(e) => shareOut(e.target.value)} />
              </div>
              <button type="button" className="br-btn br-btn-plain" onClick={payAllInFull}>Pay all in full</button>
            </div>
          )}
          {extra > 0.004 && (
            <div className="br-note" role="alert" style={{ background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e" }}>
              <span>⚠️ {inr(extra)} more than the balance of the chosen treatments. Add another treatment below, or take only {inr(payExisting + payNew)}.</span>
            </div>
          )}

          <div className="pa-k" style={{ marginBottom: 6 }}>Paying for</div>
          {lines.length === 0 && newLines.length === 0 && plainLines.length === 0 && (
            <div className="br-note br-note-info"><span>Choose a treatment below, or add a new one.</span></div>
          )}
          {lines.map((l) => {
            const c = byId[l.charge_id] || {};
            const avail = available(l.charge_id);
            const prob = lineProblem(l);
            const after = r2(avail - num(l.pay));
            return (
              <div className="pa-pay" key={l.charge_id} data-bad={prob ? "true" : "false"} data-testid="pay-line">
                <div className="pa-p-name">
                  <div className="pa-name">{c.treatment}</div>
                  <div className="pa-sub">{c.description ? `${c.description} · ` : ""}{fmtDate(c.date)}</div>
                </div>
                <div className="pa-sub" style={{ lineHeight: 1.5 }}>
                  To pay {inr(c.net)}{c.discount > 0 ? ` (after ${inr(c.discount)} off)` : ""}<br />
                  Paid before {inr(r2((c.paid || 0) - (ownPaid[l.charge_id] || 0)))} · <strong style={{ color: "#b91c1c" }}>left {inr(avail)}</strong>
                </div>
                <div>
                  <input className="br-input" type="number" min="0" step="any" inputMode="decimal" aria-label={`Pay now for ${c.treatment}`}
                    value={l.pay} onChange={(e) => setPay(l.charge_id, e.target.value)} style={{ fontWeight: 800 }} />
                  <div className="pa-quick">
                    <button type="button" onClick={() => setPay(l.charge_id, String(avail))}>Full</button>
                    <button type="button" onClick={() => setPay(l.charge_id, String(r2(avail / 2)))}>Half</button>
                  </div>
                  {prob && <div className="pa-err">{prob}</div>}
                </div>
                <div className="pa-sub">
                  <div className="pa-k">Balance after</div>
                  <strong style={{ color: after <= 0.004 ? "#047857" : "#b45309", fontSize: 14 }}>{after <= 0.004 ? "✓ Fully paid" : inr(after)}</strong>
                </div>
                <button type="button" className="br-btn br-btn-sm br-btn-plain" style={{ justifySelf: "end" }} aria-label={`Remove ${c.treatment} from this payment`}
                  onClick={() => { setReceived(""); setLines((prev) => prev.filter((x) => x.charge_id !== l.charge_id)); }}>✕</button>
              </div>
            );
          })}

          {newLines.map((n, i) => {
            const prob = newProblem(n);
            return (
              <div className="pa-pay pa-pay-new" key={n.key} data-testid="new-line">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ color: "#0f766e" }}>➕ New treatment {newLines.length > 1 ? i + 1 : ""}</strong>
                  <button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={() => setNewLines((prev) => prev.filter((x) => x.key !== n.key))}>✕ Remove</button>
                </div>
                <div className="br-grid">
                  <div style={{ gridColumn: "span 6" }}>
                    <select className="br-input" aria-label="New treatment" value={n.pick} onChange={(e) => changeNew(n.key, { pick: e.target.value })}>
                      <option value="">-- Select Treatment --</option>
                      {treatmentList.map((t) => <option key={t} value={t}>{t}</option>)}
                      <option value={CUSTOM}>+ Custom</option>
                    </select>
                    {n.pick === CUSTOM && <input className="br-input" style={{ marginTop: 6 }} aria-label="New custom treatment" placeholder="Type the treatment"
                      value={n.custom} maxLength={200} onChange={(e) => changeNew(n.key, { custom: e.target.value })} />}
                  </div>
                  <div style={{ gridColumn: "span 6" }}>
                    <input className="br-input" aria-label="New treatment tooth / notes" placeholder="Tooth / notes" maxLength={500}
                      value={n.description} onChange={(e) => changeNew(n.key, { description: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: "span 4" }}>
                    <label className="br-label">Charge (₹)</label>
                    <input className="br-input" type="number" min="0" step="any" inputMode="decimal" aria-label="New treatment charge"
                      value={n.fee} onChange={(e) => { const fee = e.target.value; changeNew(n.key, { fee, pay: n.pay === "" || num(n.pay) === Math.max(newNet(n), 0) ? String(Math.max(r2(num(fee) - (n.discMode === "pc" ? num(fee) * num(n.disc) / 100 : num(n.disc))), 0)) : n.pay }); }} />
                  </div>
                  <div style={{ gridColumn: "span 4" }}>
                    <label className="br-label">Discount</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input className="br-input" type="number" min="0" step="any" inputMode="decimal" aria-label="New treatment discount" placeholder="0"
                        value={n.disc} onChange={(e) => changeNew(n.key, { disc: e.target.value })} />
                      <div className="pa-seg" role="group" aria-label="Discount in">
                        <button type="button" aria-pressed={n.discMode === "rs"} onClick={() => changeNew(n.key, { discMode: "rs" })}>₹</button>
                        <button type="button" aria-pressed={n.discMode === "pc"} onClick={() => changeNew(n.key, { discMode: "pc" })}>%</button>
                      </div>
                    </div>
                  </div>
                  <div style={{ gridColumn: "span 4" }}>
                    <label className="br-label">Pay now (₹) <span style={{ fontWeight: 500, color: "#64748b" }}>of {inr(Math.max(newNet(n), 0))}</span></label>
                    <input className="br-input" type="number" min="0" step="any" inputMode="decimal" aria-label="New treatment pay now" style={{ fontWeight: 800 }}
                      value={n.pay} onChange={(e) => changeNew(n.key, { pay: e.target.value })} />
                  </div>
                </div>
                {prob && <div className="pa-err">{prob}</div>}
              </div>
            );
          })}

          {plainLines.length > 0 && (
            <div className="pa-sub" style={{ margin: "4px 0 8px" }}>
              Also on this receipt (not in the account): {plainLines.map((t) => `${t.name} ${inr(t.amount)}`).join(", ")}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            {others.length > 0 && (
              <select className="br-input" style={{ width: "auto", flex: "1 1 260px" }} aria-label="Add another treatment to this payment" value=""
                onChange={(e) => { const cid = Number(e.target.value); if (cid) { setReceived(""); setLines((prev) => [...prev, { charge_id: cid, pay: String(available(cid)) }]); } }}>
                <option value="">+ Add another treatment with a balance…</option>
                {others.map((c) => <option key={c.charge_id} value={c.charge_id}>{c.treatment}{c.description ? ` (${c.description})` : ""} — left {inr(available(c.charge_id))}</option>)}
              </select>
            )}
            <button type="button" className="br-btn br-btn-sm br-btn-plain" style={{ color: "#0f766e", borderColor: "#2f9e75" }} onClick={addNew}>➕ New treatment &amp; pay</button>
          </div>

          <div className="pa-sum" data-testid="pay-summary">
            <div className="pa-now"><div className="pa-k">Paying now</div><div className="pa-sum-v" data-testid="pay-now">{inr(payNow)}</div></div>
            <div><div className="pa-k">Left on these treatments</div><div className="pa-sum-v" style={{ color: leftOnThese > 0.004 ? "#b45309" : "#047857" }} data-testid="left-these">{leftOnThese > 0.004 ? inr(leftOnThese) : "Nil ✓"}</div></div>
            <div><div className="pa-k">Patient's total balance after</div><div className="pa-sum-v" style={{ color: balanceAfter > 0.004 ? "#b91c1c" : "#047857" }} data-testid="balance-after">{inr(Math.max(balanceAfter, 0))}</div></div>
          </div>

          <div className="br-grid">
            <div style={{ gridColumn: "span 4" }}>
              <label className="br-label" htmlFor="pa-date">Date</label>
              <input id="pa-date" type="date" className="br-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 8" }} role="group" aria-label="Payment methods">
              <span className="br-label">Paid by</span>
              <div className="br-chips">
                {PAYMENT_METHODS.map((m) => (
                  <button type="button" key={m} className="br-chip" aria-pressed={methods.has(m)} onClick={() => toggleMethod(m)}>{m}</button>
                ))}
              </div>
            </div>
            <div style={{ gridColumn: "span 12" }}>
              <label className="br-label" htmlFor="pa-notes">Notes <span style={{ fontWeight: 500, color: "#64748b" }}>(printed on the receipt)</span></label>
              <input id="pa-notes" className="br-input" maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Second instalment" />
            </div>
          </div>
          {visit && !editing && <div className="pa-sub" style={{ marginTop: 8 }}>🦷 For the doctor's visit of {fmtDate(visit.visit_date || visit.date)} — it moves to Billed when saved.</div>}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button type="button" className="br-btn br-btn-main" style={{ fontSize: 15, padding: "11px 20px" }} disabled={saving || payNow <= 0} onClick={save}>
              {saving ? "Saving…" : editing ? `💾 Save changes (${inr(payNow)})` : `💾 Save payment ${inr(payNow)} & make receipt`}
            </button>
            <button type="button" className="br-btn br-btn-plain" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════
   Clinical record (read-only): visits, chart, prescriptions, X-rays, photos
══════════════════════════════════════════════════════════════════ */
function SecureImage({ img, onOpen }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made = ""; let cancelled = false;
    const path = String(img.url || "").replace(/^\/api(?=\/)/, "");
    api.get(path, { responseType: "blob" })
      .then((res) => { if (!cancelled && typeof URL.createObjectURL === "function") { made = URL.createObjectURL(res.data); setSrc(made); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [img.url]);
  return (
    <button type="button" className="pa-img" onClick={() => src && onOpen({ src, img })} title={img.description || img.image_type}>
      {src ? <img src={src} alt={img.image_type || "image"} /> : <div className="pa-img-ph">{failed ? "Could not load" : "Loading…"}</div>}
      <span>{img.image_type || "Image"}{img.image_date ? ` · ${fmtDate(img.image_date)}` : ""}</span>
    </button>
  );
}

function ClinicalRecord({ patientId, onAddFromVisit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [big, setBig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/patients/${patientId}/complete-history`)
      .then((res) => { if (!cancelled) setData(res.data || {}); })
      .catch((err) => { if (!cancelled) setError(errorText(err, "The clinical record could not be loaded.")); });
    return () => { cancelled = true; };
  }, [patientId]);

  if (error) return <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>;
  if (!data) return <div className="pa-sub" style={{ padding: 16 }}>Loading the clinical record…</div>;
  const visits = data.visits || [];
  const rawAllergies = Array.isArray(data.allergies) ? data.allergies : (data.allergies?.rows || []);
  const allergies = rawAllergies.filter((a) => a && a.allergen && String(a.status || "Active").toLowerCase() !== "inactive")
    .map((a) => `${a.allergen}${a.reaction ? ` (${a.reaction})` : ""}`).join(", ");
  return (
    <div data-testid="clinical">
      {allergies && (
        <div className="br-note br-note-bad" style={{ fontWeight: 700 }}><span>⚠️ Allergies: {allergies}</span></div>
      )}
      {visits.length === 0 && <div className="br-note br-note-info"><span>No visits recorded yet.</span></div>}
      {visits.map((v) => {
        const field = (label, value) => value && String(value).trim()
          ? <div><div className="pa-k">{label}</div><div className="pa-field">{value}</div></div> : null;
        const images = v.images || [];
        return (
          <div className="pa-clin" key={v.visit_id}>
            <div className="pa-clin-head">
              <strong>🗓 {fmtDate(v.visit_date)} <span className="pa-sub" style={{ fontWeight: 600 }}>· {v.status || ""}{v.assigned_doctor ? ` · Dr. ${v.assigned_doctor}` : ""}</span></strong>
              <button type="button" className="br-btn br-btn-sm br-btn-main" onClick={() => onAddFromVisit(v)}>➕ Bill a treatment from this visit</button>
            </div>
            <div className="pa-clin-body">
              {v.billing_note && <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 10px" }}>
                <div className="pa-k" style={{ color: "#8a6d1a" }}>Doctor's billing instructions</div><div className="pa-field" style={{ fontWeight: 700, color: "#78350f" }}>{v.billing_note}</div></div>}
              {field("Chief complaint", v.chief_complaint)}
              {field("Diagnosis", v.diagnosis)}
              {field("Treatment done", v.treatment_done)}
              {field("Treatment plan", v.treatment_plan)}
              {field("Advice", v.advice)}
              {(v.consultations || []).map((c, i) => (
                <div key={c.id || i} style={{ borderLeft: "3px solid #3fb6c9", paddingLeft: 10, display: "grid", gap: 6 }}>
                  <div className="pa-k">Consultation{c.doctor ? ` · Dr. ${c.doctor}` : ""}</div>
                  {field("Diagnosis", c.diagnosis !== v.diagnosis ? c.diagnosis : "")}
                  {field("Treatment done", c.treatment_done_today !== v.treatment_done ? c.treatment_done_today : "")}
                  {field("Treatment plan", c.treatment_plan !== v.treatment_plan ? c.treatment_plan : "")}
                  {field("Advice", c.advice !== v.advice ? c.advice : "")}
                </div>
              ))}
              {(v.dental_chart || []).length > 0 && (
                <div><div className="pa-k">Dental chart</div>
                  <div style={{ overflowX: "auto" }}><table className="pa-mini"><thead><tr><th>Tooth</th><th>Condition</th><th>Surface</th><th>Notes</th></tr></thead>
                    <tbody>{v.dental_chart.map((d, i) => <tr key={d.id || i}><td><strong>{d.tooth_number}</strong></td><td>{d.condition}</td><td>{d.surface}</td><td>{d.notes}</td></tr>)}</tbody></table></div></div>
              )}
              {(v.prescriptions || []).length > 0 && (
                <div><div className="pa-k">Prescriptions</div>
                  {v.prescriptions.map((p, i) => {
                    let meds = [];
                    try { meds = JSON.parse(p.medicines || "[]"); } catch { meds = []; }
                    if (!Array.isArray(meds)) meds = [];
                    return <div key={p.id || i} className="pa-field" style={{ fontSize: 13 }}>💊 {meds.length ? meds.map((m) => [m.name, m.times, m.days ? `${m.days} days` : ""].filter(Boolean).join(" ")).join(" · ") : (p.diagnosis || "Prescription")}</div>;
                  })}
                </div>
              )}
              {images.length > 0 && (
                <div><div className="pa-k" style={{ marginBottom: 4 }}>X-rays &amp; photos ({images.length})</div>
                  <div className="pa-imgs">{images.map((img) => <SecureImage key={img.id} img={img} onOpen={setBig} />)}</div></div>
              )}
              {(v.cbct_scans || []).length > 0 && <div className="pa-sub">🧊 {v.cbct_scans.length} CBCT scan{v.cbct_scans.length !== 1 ? "s" : ""} (open from the doctor's screen)</div>}
            </div>
          </div>
        );
      })}
      {big && createPortal(
        <div className="br-viewer" role="dialog" aria-modal="true" aria-label="Image" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") setBig(null); }} tabIndex={-1}>
          <div className="br-viewer-bar">
            <strong style={{ flex: 1 }}>{big.img.image_type}{big.img.description ? ` — ${big.img.description}` : ""}</strong>
            <button type="button" className="br-btn br-btn-white br-btn-sm" onClick={() => setBig(null)} autoFocus>✕ Close</button>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(null); }}>
            <img src={big.src} alt={big.img.image_type} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8, background: "#000" }} />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   The account
══════════════════════════════════════════════════════════════════ */
export default function PatientAccount({ patientId, visit = null, editReceipt = null, message = "", onBack, backLabel = "← Back to Payments",
  onViewReceipt, onEditSimple, onReceiptSaved, onChanged }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("treatments");
  const [filter, setFilter] = useState("all");            // all | due | paid
  const [selected, setSelected] = useState(() => new Set());
  const [chargeDialog, setChargeDialog] = useState(null);  // { charge } | { preset } | {}
  const [payDialog, setPayDialog] = useState(null);        // { chosen } | { receipt }
  const [confirm, setConfirm] = useState(null);            // { kind: "charge", item } — deleting a treatment
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [deleteReceipt, setDeleteReceipt] = useState(null); // receipt being deleted (asks for the reason)
  const [note, setNote] = useState(message ? { ok: true, text: message } : null);
  const [treatmentList, setTreatmentList] = useState(FALLBACK_TREATMENTS);
  const openedEdit = useRef(false);

  const load = async () => {
    try {
      const res = await api.get(`/clinic-billing/patients/${patientId}/account`);
      setAccount(res.data);
      setError("");
      setSelected((prev) => new Set([...prev].filter((cid) => res.data.charges.some((c) => c.charge_id === cid && c.balance > 0.004))));
      return res.data;
    } catch (err) {
      setError(errorText(err, "The patient's account could not be loaded. Please check the connection and try again."));
      return null;
    }
  };
  useEffect(() => { load(); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get("/clinic-billing/receipts/new")
      .then((res) => { if (Array.isArray(res.data?.treatments) && res.data.treatments.length) setTreatmentList(res.data.treatments); })
      .catch(() => {});
  }, []);
  // Opened to change a payment: open the payment editor once the account is here.
  useEffect(() => {
    if (account && editReceipt && !openedEdit.current) { openedEdit.current = true; setPayDialog({ receipt: editReceipt }); }
  }, [account, editReceipt]);

  const charges = account?.charges || [];
  const shown = charges.filter((c) => filter === "all" || (filter === "due" ? c.balance > 0.004 : c.balance <= 0.004));
  const due = charges.filter((c) => c.balance > 0.004);
  const selectedDue = r2(charges.filter((c) => selected.has(c.charge_id)).reduce((s, c) => s + c.balance, 0));
  const toggle = (cid) => setSelected((prev) => { const s = new Set(prev); if (s.has(cid)) s.delete(cid); else s.add(cid); return s; });
  const visitRow = visit ? (account?.visits || []).find((v) => v.visit_id === visit.visit_id) : null;
  const visitReceipts = visit ? (account?.receipts || []).filter((r) => r.visit_id === visit.visit_id) : [];
  const receiptsById = useMemo(() => Object.fromEntries((account?.receipts || []).map((r) => [r.id, r])), [account]);

  const afterChange = async (text) => {
    await load();                       // the message shows together with the new figures
    setNote(text ? { ok: true, text } : null);
    if (onChanged) onChanged();
  };

  const doDelete = async () => {
    if (!confirm || busy) return;
    setBusy(true); setConfirmError("");
    try {
      await api.delete(`/clinic-billing/charges/${confirm.item.charge_id}`);
      await afterChange(`Treatment “${confirm.item.treatment}” deleted.`);
      setConfirm(null);
    } catch (err) {
      setConfirmError(errorText(err, "Not deleted — please check the connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  const startPayment = (ids) => {
    setNote(null);
    setPayDialog({ chosen: ids });
  };

  if (!account) {
    return (
      <div className="br-card">
        <AccountStyles />
        <div className="br-head"><div><h2>👤 Patient account</h2></div>
          <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>{backLabel}</button></div>
        <div className="br-body">
          {error
            ? <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span><button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={load}>Try again</button></div>
            : <div className="pa-sub">Loading the patient's account…</div>}
        </div>
      </div>
    );
  }

  const p = account.patient;
  const t = account.totals;
  return (
    <div className="br-card" data-testid="patient-account">
      <AccountStyles />
      <div className="br-head">
        <div>
          <h2>👤 {p.name}</h2>
          <p>{[p.case_number && `Case ${p.case_number}`, p.mobile, p.age && `${p.age} yrs`, p.gender].filter(Boolean).join(" · ")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>{backLabel}</button>
          <button type="button" className="br-btn br-btn-white" disabled={due.length === 0} onClick={() => startPayment(due.map((c) => c.charge_id))}
            title={due.length ? "Pay towards the treatments with a balance" : "Nothing is due"}>💳 Take payment</button>
        </div>
      </div>

      <div className="br-body">
        {note && (
          <div className={`br-note ${note.ok ? "br-note-ok" : "br-note-bad"}`} role={note.ok ? "status" : "alert"}>
            <span>{note.ok ? "✓" : "⚠️"} {note.text}</span>
            <button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={() => setNote(null)}>Close</button>
          </div>
        )}

        <div className="pa-tiles" data-testid="account-totals">
          <div className="pa-tile"><div className="pa-tile-l">Treatment charges</div><div className="pa-tile-v">{inr(t.fee)}</div></div>
          <div className="pa-tile"><div className="pa-tile-l">Discount given</div><div className="pa-tile-v">{inr(t.discount)}</div></div>
          <div className="pa-tile"><div className="pa-tile-l">Paid</div><div className="pa-tile-v">{inr(t.paid)}</div></div>
          <div className={`pa-tile ${t.balance > 0.004 ? "pa-tile-due" : "pa-tile-clear"}`}>
            <div className="pa-tile-l">Balance due</div>
            <div className="pa-tile-v" data-testid="balance-due">{t.balance > 0.004 ? inr(t.balance) : "Nil ✓"}</div>
          </div>
        </div>

        {visit && (
          <div className="pa-visit" data-testid="visit-box">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: "1 1 300px" }}>
                <div style={{ fontWeight: 800, color: "#5c4300", marginBottom: 4 }}>
                  🦷 Sent by the Doctor{visit.closed_display ? ` · ${visit.closed_display}` : ""}{(visitRow?.billed || visit.billed) ? " · already billed" : ""}
                </div>
                <div className="pa-k" style={{ color: "#8a6d1a" }}>Doctor's billing instructions</div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: "#78350f", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {visit.billing_note || <span style={{ fontStyle: "italic", fontWeight: 500, color: "#7b8a91" }}>No special instructions.</span>}
                </div>
                {visit.treatment_done && <><div className="pa-k" style={{ color: "#8a6d1a", marginTop: 6 }}>Treatment done</div><div className="pa-field">{visit.treatment_done}</div></>}
              </div>
              <button type="button" className="br-btn br-btn-main" onClick={() => setChargeDialog({ preset: { visit_id: visit.visit_id, description: "" } })}>➕ Add treatment for this visit</button>
            </div>
            {visitReceipts.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#92400e" }} role="note">
                This visit already has {visitReceipts.map((r) => `receipt #${r.receipt_no} (₹${(Number(r.amount_paid) || 0).toFixed(2)})`).join(", ")}.
                Take another payment only if this is a further payment.
              </div>
            )}
            <div className="pa-sub" style={{ marginTop: 6 }}>Payments taken here are linked to this visit; it moves to Billed by itself.</div>
          </div>
        )}

        <div className="br-tabs" role="tablist">
          <button type="button" role="tab" className="br-tab" aria-selected={tab === "treatments"} onClick={() => setTab("treatments")}>
            💰 Treatments &amp; balance{due.length ? <span className="br-count">{due.length}</span> : null}
          </button>
          <button type="button" role="tab" className="br-tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>🧾 Payments ({account.receipts.length})</button>
          <button type="button" role="tab" className="br-tab" aria-selected={tab === "clinical"} onClick={() => setTab("clinical")}>🦷 Clinical record, X-rays &amp; photos</button>
        </div>

        {tab === "treatments" && (
          <div role="tabpanel" aria-label="Treatments">
            <div className="pa-toolbar">
              <div className="br-chips" role="group" aria-label="Show">
                <button type="button" className="br-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All ({charges.length})</button>
                <button type="button" className="br-chip" aria-pressed={filter === "due"} onClick={() => setFilter("due")}>Balance due ({due.length})</button>
                <button type="button" className="br-chip" aria-pressed={filter === "paid"} onClick={() => setFilter("paid")}>Paid ({charges.length - due.length})</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {due.length > 1 && <button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={() => setSelected(selected.size === due.length ? new Set() : new Set(due.map((c) => c.charge_id)))}>
                  {selected.size === due.length ? "Unselect all" : "Select all with balance"}</button>}
                <button type="button" className="br-btn br-btn-main" onClick={() => { setNote(null); setChargeDialog({}); }}>➕ Add treatment</button>
              </div>
            </div>

            {charges.length === 0 && (
              <div className="br-note br-note-info" style={{ display: "block" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No treatments in this account yet.</div>
                Press <strong>➕ Add treatment</strong> to enter a treatment with its charge and any discount — then take full or part payments towards it.
                {account.receipts.length > 0 && " Earlier receipts are under 🧾 Payments."}
              </div>
            )}
            {charges.length > 0 && shown.length === 0 && <div className="pa-sub" style={{ padding: 10 }}>Nothing to show here.</div>}

            {shown.map((c) => {
              const open = c.balance > 0.004;
              const st = STATUS_STYLE[c.status] || STATUS_STYLE["No charge"];
              const pct = c.net > 0 ? Math.min(100, Math.round((c.paid / c.net) * 100)) : 100;
              return (
                <div className="pa-row" key={c.charge_id} data-selected={selected.has(c.charge_id) ? "true" : "false"} data-done={open ? "false" : "true"} data-testid="charge-row">
                  <div>{open
                    ? <input type="checkbox" checked={selected.has(c.charge_id)} onChange={() => toggle(c.charge_id)} aria-label={`Select ${c.treatment} for payment`} />
                    : <span style={{ color: "#22c55e", fontSize: 18 }}>✓</span>}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="pa-name">{c.treatment}</div>
                    <div className="pa-sub">{c.description ? `${c.description} · ` : ""}{fmtDate(c.date)}</div>
                  </div>
                  <div className="pa-c-money">
                    <div className="pa-k">Charge{c.discount > 0 ? " − discount" : ""}</div>
                    <div className="pa-amt">{c.discount > 0 ? <><s style={{ color: "#94a3b8", fontWeight: 600 }}>{inr(c.fee)}</s> {inr(c.net)}</> : inr(c.net)}</div>
                    {c.discount > 0 && <div className="pa-sub" style={{ color: "#047857" }}>{inr(c.discount)} off</div>}
                  </div>
                  <div className="pa-c-paid">
                    <div className="pa-k">Paid</div>
                    <div className="pa-amt">{inr(c.paid)}</div>
                    <div className="pa-bar" aria-hidden="true"><span style={{ width: `${pct}%`, background: st.bar }} /></div>
                  </div>
                  <div className="pa-c-bal">
                    <div className="pa-k">Balance</div>
                    <div className="pa-bal" style={{ color: open ? "#b91c1c" : "#047857" }}>{open ? inr(c.balance) : "Nil"}</div>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="pa-acts">
                    {open && <button type="button" className="br-btn br-btn-sm br-btn-view" onClick={() => startPayment([c.charge_id])}>💳 Pay</button>}
                    <button type="button" className="br-btn br-btn-sm br-btn-edit" onClick={() => { setNote(null); setChargeDialog({ charge: c }); }}>Edit</button>
                    <button type="button" className="br-btn br-btn-sm br-btn-del" disabled={c.paid > 0}
                      title={c.paid > 0 ? "Payments were made towards it — change or delete those payments first" : "Delete this treatment"}
                      onClick={() => { setConfirmError(""); setConfirm({ kind: "charge", item: c }); }}>Delete</button>
                  </div>
                  {c.payments.length > 0 && (
                    <div className="pa-payments">
                      <span>Payments:</span>
                      {c.payments.map((pm) => (
                        <button key={`${pm.receipt_id}`} type="button" className="pa-link" onClick={() => receiptsById[pm.receipt_id] && onViewReceipt(receiptsById[pm.receipt_id])}>
                          #{pm.receipt_no} · {fmtDate(pm.date)} · {inr(pm.amount)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {charges.length > 0 && (
              <div className="pa-sub" style={{ display: "flex", justifyContent: "flex-end", gap: 18, flexWrap: "wrap", padding: "6px 4px", fontSize: 13 }}>
                <span>To be paid (after discount): <strong>{inr(t.net)}</strong></span>
                <span>Paid: <strong>{inr(t.paid)}</strong></span>
                <span>Balance: <strong style={{ color: t.balance > 0.004 ? "#b91c1c" : "#047857" }}>{inr(t.balance)}</strong></span>
              </div>
            )}

            {selected.size > 0 && (
              <div className="pa-sticky" role="region" aria-label="Selected for payment">
                <span>{selected.size} treatment{selected.size !== 1 ? "s" : ""} selected · balance <strong>{inr(selectedDue)}</strong></span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="br-btn br-btn-sm br-btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
                  <button type="button" className="br-btn br-btn-white" onClick={() => startPayment(charges.filter((c) => selected.has(c.charge_id)).map((c) => c.charge_id))}>💳 Take payment for these →</button>
                </span>
              </div>
            )}
          </div>
        )}

        {tab === "payments" && (
          <div role="tabpanel" aria-label="Payments">
            {account.receipts.length === 0 ? (
              <div className="br-note br-note-info"><span>No payments yet.</span></div>
            ) : (
              <div className="br-table-wrap">
                <table className="br-table">
                  <thead><tr><th>Date</th><th>Receipt</th><th style={{ textAlign: "left" }}>For</th><th>Paid (₹)</th><th>By</th><th>Balance after</th><th>Actions</th></tr></thead>
                  <tbody>
                    {account.receipts.map((r) => (
                      <tr key={r.id} data-receipt={r.receipt_no}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                        <td>#{r.receipt_no}</td>
                        <td style={{ textAlign: "left", overflowWrap: "anywhere" }}>{r.treatments.map((x) => x.name).join(", ") || "—"}</td>
                        <td><strong>{(Number(r.amount_paid) || 0).toFixed(2)}</strong></td>
                        <td>{r.payment_methods.join(", ") || "—"}</td>
                        <td>{r.balance_after == null ? "—" : r.balance_after > 0.004 ? inr(r.balance_after) : "Nil"}</td>
                        <td>
                          <span className="br-actions">
                            <button type="button" className="br-btn br-btn-sm br-btn-view" onClick={() => onViewReceipt(r)}>View</button>
                            <button type="button" className="br-btn br-btn-sm br-btn-edit" onClick={() => (r.has_allocations ? setPayDialog({ receipt: r }) : onEditSimple(r))}>Edit</button>
                            <button type="button" className="br-btn br-btn-sm br-btn-del" onClick={() => setDeleteReceipt(r)}>Delete</button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pa-sub" style={{ marginTop: 8 }}>Total received from this patient: <strong>{inr(t.received)}</strong></div>
          </div>
        )}

        {tab === "clinical" && (
          <div role="tabpanel" aria-label="Clinical record">
            <ClinicalRecord patientId={patientId}
              onAddFromVisit={(v) => { setTab("treatments"); setChargeDialog({ preset: { visit_id: v.visit_id, description: "" } }); }} />
          </div>
        )}
      </div>

      {chargeDialog && (
        <ChargeDialog
          patientId={patientId}
          charge={chargeDialog.charge}
          preset={chargeDialog.preset}
          visits={account.visits}
          treatmentList={treatmentList}
          onClose={() => setChargeDialog(null)}
          onSaved={async (saved, andPay) => {
            const editing = Boolean(chargeDialog.charge);
            setChargeDialog(null);
            await afterChange(editing ? `“${saved.treatment}” updated.` : `“${saved.treatment}” added — ${inr(saved.net)} to be paid.`);
            if (andPay) startPayment([saved.charge_id]);
          }}
        />
      )}

      {payDialog && (
        <PaymentDialog
          account={account}
          chosen={payDialog.chosen || []}
          receipt={payDialog.receipt}
          visit={visit}
          treatmentList={treatmentList}
          onClose={() => setPayDialog(null)}
          onSaved={(saved, editing) => {
            setPayDialog(null);
            setSelected(new Set());
            load();
            if (onChanged) onChanged();
            onReceiptSaved(saved, editing);
          }}
        />
      )}

      {deleteReceipt && (
        <DeleteReceiptDialog
          receipt={deleteReceipt}
          onCancel={() => setDeleteReceipt(null)}
          onDeleted={async (res, why) => {
            const r = deleteReceipt;
            setDeleteReceipt(null);
            await afterChange(`Receipt #${r.receipt_no} deleted (${why}) — the balances are back as they were.${res.visit_back_to_pending ? " Its visit is back under Pending in Doctor's Instructions." : ""}`);
          }}
        />
      )}

      {confirm && createPortal(
        <div className="br-overlay" role="dialog" aria-modal="true" aria-label={confirm.kind === "charge" ? "Delete treatment" : "Delete receipt"}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setConfirm(null); }}>
          <div className="br-dialog">
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{confirm.kind === "charge" ? "Delete this treatment?" : "Delete this payment?"}</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: "#334155" }}>
              {confirm.kind === "charge"
                ? <><strong>{confirm.item.treatment}</strong>{confirm.item.description ? ` (${confirm.item.description})` : ""} — {inr(confirm.item.net)}.</>
                : <>Receipt <strong>#{confirm.item.receipt_no}</strong> — {inr(confirm.item.amount_paid)}, {fmtDate(confirm.item.date)}.
                  <br />The treatments it paid for will show their balance again.</>}
              <br />This cannot be undone.
            </div>
            {confirmError && <div className="br-note br-note-bad" role="alert" style={{ marginTop: 12, marginBottom: 0 }}><span>⚠️ {confirmError}</span></div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className="br-btn br-btn-plain" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="br-btn br-btn-danger" disabled={busy} onClick={doDelete}>{busy ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}