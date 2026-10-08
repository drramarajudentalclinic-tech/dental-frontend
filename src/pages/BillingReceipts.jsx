import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";
import PatientAccount, { ChoosePatient, DeleteReceiptDialog } from "./PatientAccount";

/*
  <BillingReceipts />
  ────────────────────────────────────────────────────────────────
  The clinic's billing — the old stand-alone billing software rebuilt
  inside the clinic system. Same screens and the same receipt:

    • Patient account     – (PatientAccount.jsx) "+ Add Payment" first asks for the
                            patient, then shows the patient's treatments with
                            charges, discounts, paid and balance; full or part
                            payments towards the chosen treatments; payments;
                            the clinical record with X-rays and photos.
    • Payment Dashboard   – latest receipts, search, View / Edit / Delete / PDF
                            (Delete asks why; the reason, who and when are kept)
    • Deleted receipts    – the deletion log: every deleted receipt in full, with
                            the reason, who deleted it and when
    • Doctor's Instructions – visits the doctor has closed, with the doctor's
                            billing instructions (inside Billing, button at the top).
                            "Make Receipt" opens that patient's account;
                            saving moves the visit to Billed by itself.
    • Add Payment         – date, receipt no, name, case no, mobile, treatments
                            (list + custom), total, payment methods, notes,
                            linked to the patient's record, "Save & Generate PDF"
    • Edit Payment        – the same form, "Save & Regenerate PDF"
    • View                – the receipt's details and the PDF itself
    • Receipt Files       – a month's Excel sheet shown as a table, and the
                            receipt PDFs opened in a viewer — inside the app
    • Excel & files       – Excel for any dates; the receipt files, kept by
                            themselves in financial-year folders
                              receipts/Financial year 2026-2027/Sep2026/pdf/Name.0001.pdf
                              receipts/Financial year 2026-2027/Sep2026/excel/Sep2026.xlsx
                            (on the server, or in object storage with the images),
                            listed by month for downloading; "Save files again"
    • Import              – bring over the old software's receipts (payments.db)

  Server side: billing_receipts.py (routes folder), loaded through visits.py;
  Doctor's Instructions use GET /visits/closed and PUT /visits/<id>/billing-done.

  Used by the Reception dashboard:
    <BillingReceipts
       onBack={…}                     back to the dashboard
       initialView="payments"         or "instructions" (opens Doctor's Instructions)
       highlightVisitId={id}          a just-closed visit to point out in Doctor's Instructions
       onChanged={…}                  called when receipts or billed visits change
    />
*/

const PAYMENT_METHODS = ["UPI", "Cheque", "A/C", "Card", "Cash"];

// Used only until the server's own list arrives (it is the same list).
const FALLBACK_TREATMENTS = [
  "Scaling", "Polishing", "Filling (Composite)", "Filling (GIC)", "Extraction", "Surgical Extraction",
  "Root Canal Treatment", "Re-RCT", "Crown (Metal)", "Crown (PFM)", "Crown (Zirconia)", "Bridge",
  "Implant", "Implant + Crown", "Complete Denture (Upper)", "Complete Denture (Lower)", "Partial Denture",
  "Orthodontic Treatment", "Tooth Whitening", "X-Ray", "Consultation", "Follow-up Visit",
];

const CUSTOM = "__custom__";

/* ── small helpers ── */
const money = (n) => (Number(n) || 0).toFixed(2);
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDay(new Date());
const firstOfMonth = (d = new Date()) => isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
const lastOfMonth = (d = new Date()) => isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));

function errorText(err, fallback) {
  const status = err?.response?.status;
  if (status === 404 && !err?.response?.data?.error) {
    return "Billing needs its server files. Copy billing_receipts.py and visits.py into the backend's routes folder and restart the backend.";
  }
  if (status === 401) return "Your login has ended. Please log in again.";
  return err?.response?.data?.error || fallback;
}

// Works for both real server answers and blobs that carry an error message.
async function blobErrorText(err, fallback) {
  const data = err?.response?.data;
  if (data && typeof data.text === "function") {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.error) return parsed.error;
    } catch { /* not a message */ }
  }
  return errorText(err, fallback);
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// What the server wrote to the monthly folders after a save / edit / delete.
function FilesReport({ files, compact = false }) {
  if (!files || !files.enabled) return null;
  const written = files.written || [];
  const problems = files.problems || [];
  if (!written.length && !problems.length) return null;
  return (
    <div data-testid="files-report" style={{ marginTop: compact ? 6 : 0, marginBottom: compact ? 0 : 14 }}>
      {written.length > 0 && (
        <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.6 }}>
          📁 Saved in the monthly folder: {written.map((w, i) => (
            <span key={w}>{i > 0 && " · "}<code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 4, fontSize: 12, overflowWrap: "anywhere" }}>{w}</code></span>
          ))}
        </div>
      )}
      {problems.map((p) => (
        <div key={p} role="alert" className="br-note" style={{ background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", margin: "8px 0 0", fontWeight: 600 }}>
          <span>⚠️ {p}</span>
        </div>
      ))}
    </div>
  );
}

// 2026-10-07 → 07/10/2026
function fmtDate(d) {
  if (!d) return "—";
  const p = String(d).split("T")[0].split("-");
  if (p.length !== 3) return d;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

/* ═══════════════════════════════════════════
   DOCTOR'S INSTRUCTIONS  (inside Billing)
   The hand-over from the Doctor: every visit the doctor has closed, what
   was done, and the doctor's billing instructions. "Make Receipt" opens
   Add Payment with the patient filled in; when the receipt is saved the
   visit moves to "Billed" by itself. "Mark as Billed" is for visits that
   need no receipt.
   (Server side: GET /visits/closed and PUT /visits/<id>/billing-done in visits.py.)
═══════════════════════════════════════════ */
const instrToday = () => new Date().toISOString().split("T")[0];

// Plain text for the Copy button — ready to paste into the billing software.
function instructionsText(v) {
  const lines = [
    `Patient: ${v.name || "—"}${v.case_number ? ` (Case ${v.case_number})` : ""}${v.mobile ? ` · ${v.mobile}` : ""}`,
    `Visit closed: ${v.closed_display || "—"}${v.closed_by ? ` by ${v.closed_by}` : ""}`,
    `Doctor's billing instructions: ${v.billing_note || "None"}`,
  ];
  if (v.treatment_done) lines.push(`Treatment done: ${v.treatment_done}`);
  if (v.diagnosis)      lines.push(`Diagnosis: ${v.diagnosis}`);
  if (v.advice || v.treatment_plan) lines.push(`Advice / plan: ${v.advice || v.treatment_plan}`);
  if (v.next_appointment) lines.push(`Next appointment: ${fmtDate(v.next_appointment)}`);
  return lines.join("\n");
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the older way */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

const DoctorInstructions = ({ onBack, highlightVisitId = null, onChanged, onMakeReceipt }) => {
  const [tab,      setTab]      = useState("pending");     // "pending" | "done" | "all"
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [query,    setQuery]    = useState("");
  const [day,      setDay]      = useState("");            // "" = any day
  const [busyId,   setBusyId]   = useState(null);
  const [rowError, setRowError] = useState({ id: null, text: "" });
  const [copiedId, setCopiedId] = useState(null);

  const load = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const params = { status: tab };
      if (query.trim()) params.q = query.trim();
      if (day) { params.date_from = day; params.date_to = day; }
      const res = await api.get("/visits/closed", { params });
      setRows(Array.isArray(res.data) ? res.data : []);
      setError("");
    } catch (err) {
      console.error("Could not load closed visits:", err);
      if (showSpinner) setRows([]);
      setError(err?.response?.status === 404
        ? "This list needs the updated server file. Please replace visits.py in the backend routes folder and restart the backend."
        : "Could not load the closed visits. Please check the connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // Reload when the tab / day changes, shortly after typing stops, and quietly every 30 seconds
  // so a visit the doctor has just closed appears without refreshing the page. Also reload when
  // Reception comes back to this window, so what was changed meanwhile shows straight away.
  useEffect(() => {
    const first = setTimeout(() => load(true), query ? 300 : 0);
    const timer = setInterval(() => load(false), 30000);
    const onFocus = () => { load(false); if (onChanged) onChanged(); };
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [tab, day, query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving from a just-closed visit: bring it into view.
  useEffect(() => {
    if (!highlightVisitId || loading) return;
    const el = document.querySelector(`[data-closed-visit="${highlightVisitId}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightVisitId, loading]);

  const setDone = async (v, done) => {
    if (busyId) return;
    setBusyId(v.visit_id); setRowError({ id: null, text: "" });
    try {
      const res = await api.put(`/visits/${v.visit_id}/billing-done`, { done });
      const updated = res.data && res.data.visit_id ? res.data : { ...v, done };
      // In "Pending" / "Billed" the visit moves to the other list; in "All" it just changes its badge.
      setRows(prev => tab === "all"
        ? prev.map(r => r.visit_id === v.visit_id ? updated : r)
        : prev.filter(r => r.visit_id !== v.visit_id));
      if (onChanged) onChanged();
    } catch (err) {
      console.error("Could not update visit:", err);
      setRowError({ id: v.visit_id, text: err?.response?.data?.error || "Not saved — please check the connection and try again." });
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (v) => {
    const ok = await copyText(instructionsText(v));
    setCopiedId(ok ? v.visit_id : null);
    if (!ok) setRowError({ id: v.visit_id, text: "Could not copy automatically — please select the text and copy it." });
    else setTimeout(() => setCopiedId(id => (id === v.visit_id ? null : id)), 2000);
  };

  const tabBtn = (key, label) => (
    <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key} style={{
      padding:"8px 18px", borderRadius:9, cursor:"pointer",
      fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, fontWeight:700,
      background: tab === key ? "#065f46" : "#f8fafc",
      color:      tab === key ? "#fff"    : "#475569",
      border:     `1.5px solid ${tab === key ? "#065f46" : "#e2e8f0"}`,
    }}>{label}</button>
  );
  const lbl = { fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.8px", color:"#64748b", marginBottom:3 };
  const emptyText = error ? "" : tab === "pending"
    ? (query || day ? "No pending visits match." : "Nothing waiting — every closed visit has been billed.")
    : tab === "done" ? "No billed visits found." : "No closed visits found.";

  return (
    <div style={{
      background:"#fff", borderRadius:16,
      border:"1px solid rgba(226,232,244,0.9)",
      boxShadow:"0 2px 8px rgba(29,77,122,0.05), 0 8px 24px rgba(29,77,122,0.07)",
      marginBottom:22, overflow:"hidden", fontFamily:"'Plus Jakarta Sans',sans-serif",
    }}>
      {/* Section header */}
      <div style={{
        background:"linear-gradient(135deg,#064e3b,#047857)",
        padding:"20px 28px",
        display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{
            width:42, height:42, borderRadius:11,
            background:"rgba(255,255,255,0.18)", border:"1px solid rgba(255,255,255,0.28)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
          }}>📝</div>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:"#fff" }}>Doctor's Instructions</div>
            <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.78)", marginTop:1 }}>
              Visits closed by the doctor, with the billing instructions — press Make Receipt to bill them
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button type="button" onClick={onBack} style={{
            padding:"7px 16px", borderRadius:9,
            background:"rgba(255,255,255,0.12)", border:"1.5px solid rgba(255,255,255,0.22)",
            color:"rgba(255,255,255,0.9)", fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:12.5, fontWeight:600, cursor:"pointer",
          }}>← Payments</button>
          <button type="button" onClick={() => load(true)} style={{
            padding:"7px 16px", borderRadius:9,
            background:"rgba(255,255,255,0.22)", border:"1.5px solid rgba(255,255,255,0.4)",
            color:"#fff", fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:12.5, fontWeight:700, cursor:"pointer",
          }}>↻ Refresh</button>
        </div>
      </div>

      {/* Tabs + search */}
      <div style={{ padding:"16px 24px", borderBottom:"1px solid #f0f4fb", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }} role="group" aria-label="Which visits to show">
          {tabBtn("pending", "⏳ Pending")}
          {tabBtn("done", "✓ Billed")}
          {tabBtn("all", "All")}
        </div>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search name, case number or mobile…" aria-label="Search closed visits"
          style={{ flex:"1 1 220px", minWidth:0, padding:"9px 12px", border:"1.5px solid #e2e8f0", borderRadius:9,
            fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, color:"#1e293b", background:"#f8fafc", outline:"none" }} />
        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>Closed on</span>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} aria-label="Closed on date"
            style={{ padding:"8px 10px", border:"1.5px solid #e2e8f0", borderRadius:9, fontFamily:"'DM Mono',monospace",
              fontSize:12.5, color:"#1e293b", background:"#f8fafc", outline:"none" }} />
          <button type="button" onClick={() => setDay(day === instrToday() ? "" : instrToday())} style={{
            padding:"8px 12px", borderRadius:9, cursor:"pointer", fontSize:12, fontWeight:700,
            fontFamily:"'Plus Jakarta Sans',sans-serif",
            background: day === instrToday() ? "#dcfce7" : "#f8fafc", color: day === instrToday() ? "#15803d" : "#475569",
            border:`1.5px solid ${day === instrToday() ? "#16a34a" : "#e2e8f0"}`,
          }}>Today</button>
          {day && <button type="button" onClick={() => setDay("")} style={{ background:"none", border:"none", color:"#64748b", fontSize:12, cursor:"pointer", textDecoration:"underline" }}>Any day</button>}
        </div>
      </div>

      <div style={{ padding:"18px 24px 24px" }}>
        {error && (
          <div role="alert" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap",
            background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, padding:"10px 14px",
            color:"#b91c1c", fontSize:13, fontWeight:600, marginBottom:14 }}>
            <span>⚠️ {error}</span>
            <button type="button" onClick={() => load(true)} style={{ background:"#fff", border:"1px solid currentColor", color:"inherit",
              borderRadius:7, padding:"4px 12px", fontSize:12, fontWeight:700, cursor:"pointer" }}>Try again</button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign:"center", padding:"28px 0", color:"#94a3b8", fontSize:13 }}>Loading closed visits…</div>
        ) : rows.length === 0 ? (
          emptyText && (
            <div style={{ textAlign:"center", padding:"30px 16px", color:"#64748b", fontSize:13.5,
              background:"#f8fafc", border:"1.5px dashed #cbd5e1", borderRadius:12 }}>
              <div style={{ fontSize:30, marginBottom:8 }}>{tab === "pending" ? "✅" : "📭"}</div>
              {emptyText}
            </div>
          )
        ) : (
          <>
            <div style={{ fontSize:11.5, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:10 }}>
              {rows.length} visit{rows.length !== 1 ? "s" : ""}
            </div>
            {onMakeReceipt && rows.some(r => !r.done) && (
              <div style={{ fontSize:12, color:"#64748b", marginTop:-4, marginBottom:12, lineHeight:1.5 }}>
                🧾 <strong>Make Receipt</strong> opens Add Payment with the patient filled in. The visit moves to Billed by itself when the receipt is saved.
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {rows.map(v => {
                const isBusy = busyId === v.visit_id;
                const isNew  = highlightVisitId && String(highlightVisitId) === String(v.visit_id);
                return (
                  <div key={v.visit_id} data-closed-visit={v.visit_id} style={{
                    border:`1.5px solid ${isNew ? "#34d399" : v.done ? "#e2e8f0" : "#fde68a"}`,
                    borderLeft:`5px solid ${v.done ? "#94a3b8" : "#f59e0b"}`,
                    borderRadius:12, padding:"14px 18px", background: v.done ? "#fafbfc" : "#fff",
                    boxShadow: isNew ? "0 0 0 3px rgba(52,211,153,0.25)" : "none",
                  }}>
                    {/* who + when */}
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
                      <div style={{ minWidth:0, flex:"1 1 260px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                          <span style={{ fontSize:15, fontWeight:800, color:"#0b2d4e" }}>{v.name || "—"}</span>
                          {v.case_number && <span style={{ fontSize:11, fontWeight:700, background:"#f1f5f9", color:"#475569", border:"1px solid #e2e8f0", borderRadius:5, padding:"1px 8px" }}>Case: {v.case_number}</span>}
                          <span style={{ fontSize:10.5, fontWeight:800, borderRadius:20, padding:"2px 10px",
                            background: v.done ? "#f1f5f9" : "#fffbeb", color: v.done ? "#475569" : "#92400e",
                            border:`1px solid ${v.done ? "#cbd5e1" : "#fde68a"}` }}>
                            {v.done ? "✓ Billed" : "⏳ Pending"}
                          </span>
                          {isNew && <span style={{ fontSize:10.5, fontWeight:800, borderRadius:20, padding:"2px 10px", background:"#dcfce7", color:"#166534", border:"1px solid #86efac" }}>Just closed</span>}
                        </div>
                        <div style={{ display:"flex", gap:"4px 14px", flexWrap:"wrap", fontSize:12, color:"#64748b", marginTop:4 }}>
                          {v.mobile && <span>📞 {v.mobile}</span>}
                          {(v.age || v.gender) && <span>{[v.age ? `${v.age} yrs` : "", v.gender].filter(Boolean).join(" · ")}</span>}
                          <span>🔒 Closed {v.closed_display || "—"}{v.closed_by ? ` · ${v.closed_by}` : ""}</span>
                          {v.done && v.done_display && <span>✓ Billed {v.done_display}</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:7, flexWrap:"wrap", maxWidth:"100%" }}>
                        <button type="button" className="oe-action-btn" onClick={() => handleCopy(v)} style={{
                          background:"#eff4ff", color:"#1d4ed8", border:"1.5px solid #c7d9fc",
                        }}>{copiedId === v.visit_id ? "✓ Copied" : "📋 Copy"}</button>
                        {!v.done && onMakeReceipt && (
                          <button type="button" className="oe-action-btn" onClick={() => onMakeReceipt(v)}
                            title="Opens Billing with this patient filled in"
                            style={{ background:"#0e7490", color:"#fff", border:"1.5px solid #0e7490" }}>🧾 Make Receipt</button>
                        )}
                        {v.done ? (
                          <button type="button" className="oe-action-btn" disabled={isBusy} onClick={() => setDone(v, false)} style={{
                            background:"#f8fafc", color:"#475569", border:"1.5px solid #cbd5e1", opacity:isBusy ? 0.6 : 1,
                          }}>{isBusy ? "Saving…" : "↩ Move back to Pending"}</button>
                        ) : (
                          <button type="button" className="oe-action-btn" disabled={isBusy} onClick={() => setDone(v, true)} style={{
                            background:"#065f46", color:"#fff", border:"1.5px solid #065f46", opacity:isBusy ? 0.6 : 1,
                          }}>{isBusy ? "Saving…" : "✓ Mark as Billed"}</button>
                        )}
                      </div>
                    </div>

                    {/* the doctor's billing instructions */}
                    <div style={{
                      marginTop:12, padding:"10px 14px", borderRadius:10,
                      background: v.billing_note ? "#fffbeb" : "#f8fafc",
                      border:`1.5px solid ${v.billing_note ? "#fcd34d" : "#e2e8f0"}`,
                    }}>
                      <div style={{ ...lbl, color: v.billing_note ? "#92400e" : "#64748b" }}>📝 Doctor's billing instructions</div>
                      <div style={{ fontSize:14, fontWeight: v.billing_note ? 600 : 400, color: v.billing_note ? "#78350f" : "#94a3b8",
                        fontStyle: v.billing_note ? "normal" : "italic", whiteSpace:"pre-wrap", overflowWrap:"anywhere", lineHeight:1.55 }}>
                        {v.billing_note || "No special instructions from the doctor."}
                      </div>
                    </div>

                    {/* what was done */}
                    {(v.treatment_done || v.diagnosis || v.advice || v.treatment_plan || v.next_appointment) && (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:"10px 18px", marginTop:12 }}>
                        {v.treatment_done && <div><div style={lbl}>🦷 Treatment done</div><div style={{ fontSize:13, color:"#1e293b", overflowWrap:"anywhere", lineHeight:1.5 }}>{v.treatment_done}</div></div>}
                        {v.diagnosis && <div><div style={lbl}>📋 Diagnosis</div><div style={{ fontSize:13, color:"#1e293b", overflowWrap:"anywhere", lineHeight:1.5 }}>{v.diagnosis}</div></div>}
                        {(v.advice || v.treatment_plan) && <div><div style={lbl}>💊 Advice / plan</div><div style={{ fontSize:13, color:"#1e293b", overflowWrap:"anywhere", lineHeight:1.5 }}>{v.advice || v.treatment_plan}</div></div>}
                        {v.next_appointment && <div><div style={lbl}>📅 Next appointment</div><div style={{ fontSize:13, color:"#1e293b" }}>{fmtDate(v.next_appointment)}</div></div>}
                      </div>
                    )}

                    {rowError.id === v.visit_id && rowError.text && (
                      <div role="alert" style={{ marginTop:10, fontSize:12.5, fontWeight:600, color:"#b91c1c" }}>⚠️ {rowError.text}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};


let rowSeq = 0;
const newRow = (name = "", amount = "", description = "") => ({ key: ++rowSeq, name, amount: amount === "" ? "" : String(amount), description });

/* ── styles (kept in this file, like the other screens) ── */
function BillingStyles() {
  return (
    <style>{`
      .br-wrap { font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; color: #1e293b; scroll-margin-top: 70px; }
      .br-card { background: #fff; border-radius: 16px; border: 1px solid rgba(226,232,244,0.9);
        box-shadow: 0 2px 8px rgba(29,77,122,0.05), 0 8px 24px rgba(29,77,122,0.07); margin-bottom: 22px; overflow: hidden; }
      .br-head { background: linear-gradient(90deg, #2f9e75, #3fb6c9); color: #fff; padding: 18px 26px;
        display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .br-head h2 { margin: 0; font-size: 17px; font-weight: 800; }
      .br-head p { margin: 2px 0 0; font-size: 12px; color: rgba(255,255,255,0.9); }
      .br-body { padding: 20px 26px 26px; }
      .br-btn { font-family: inherit; font-size: 13px; font-weight: 700; border-radius: 9px; padding: 8px 16px; cursor: pointer;
        border: 1.5px solid transparent; transition: opacity .15s, background .15s; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; line-height: 1.2; }
      .br-btn:disabled { opacity: .55; cursor: not-allowed; }
      .br-btn-main { background: #0f766e; color: #fff; border-color: #0f766e; }
      .br-btn-main:hover:not(:disabled) { background: #0d655e; }
      .br-btn-white { background: #fff; color: #0f766e; border-color: #fff; }
      .br-btn-ghost { background: rgba(255,255,255,0.16); color: #fff; border-color: rgba(255,255,255,0.45); }
      .br-btn-plain { background: #f8fafc; color: #334155; border-color: #e2e8f0; }
      .br-btn-plain:hover:not(:disabled) { background: #eef2f7; }
      .br-btn-sm { font-size: 12px; padding: 5px 11px; border-radius: 7px; }
      .br-btn-view { background: #0f766e; color: #fff; }
      .br-btn-edit { background: #fde68a; color: #713f12; }
      .br-btn-del  { background: #fecaca; color: #991b1b; }
      .br-btn-pdf  { background: #bae6fd; color: #0c4a6e; }
      .br-btn-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
      .br-input { font-family: inherit; font-size: 14px; color: #1e293b; background: #fff; border: 1.5px solid #cbd5e1;
        border-radius: 9px; padding: 9px 12px; width: 100%; box-sizing: border-box; outline: none; }
      .br-input:focus { border-color: #2f9e75; box-shadow: 0 0 0 3px rgba(47,158,117,0.18); }
      .br-input[readonly] { background: #f1f5f9; color: #475569; }
      .br-label { display: block; font-size: 12.5px; font-weight: 700; color: #334155; margin-bottom: 5px; }
      .br-grid { display: grid; gap: 14px; grid-template-columns: repeat(12, minmax(0, 1fr)); }
      .br-c2 { grid-column: span 2; } .br-c4 { grid-column: span 4; }
      .br-treat { display: grid; gap: 10px; grid-template-columns: minmax(0, 4fr) minmax(0, 3fr) minmax(0, 4fr) auto;
        align-items: start; background: #f3fbf8; border: 1px solid #cfeee2; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
      .br-t-del { align-self: start; margin-top: 5px; }
      .oe-action-btn { padding: 6px 14px; border-radius: 8px; font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.18s; }
      .br-pending { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
        background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px;
        color: #78350f; font-size: 13.5px; font-weight: 600; }
      .br-count { display: inline-flex; align-items: center; justify-content: center; min-width: 19px; height: 19px; padding: 0 6px;
        border-radius: 10px; background: #f59e0b; color: #fff; font-size: 11px; font-weight: 800; margin-left: 4px; }
      .br-patient { border: 1px dashed #9fd9c4; background: #f3fbf8; border-radius: 10px; padding: 10px 14px; margin-top: 14px; position: relative; }
      .br-picks { position: absolute; left: 14px; right: 14px; top: 100%; z-index: 20; background: #fff; border: 1px solid #cbd5e1;
        border-radius: 10px; box-shadow: 0 10px 24px rgba(15,23,42,0.15); max-height: 280px; overflow-y: auto; margin-top: -6px; }
      .br-pick { display: block; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid #f1f5f9;
        padding: 9px 12px; font-family: inherit; font-size: 13.5px; cursor: pointer; color: #1e293b; }
      .br-pick:hover, .br-pick:focus { background: #ecfdf5; outline: none; }
      .br-files { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
      .br-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .br-chip { font-family: inherit; font-size: 13px; font-weight: 700; padding: 6px 13px; border-radius: 20px; cursor: pointer;
        background: #f8fafc; color: #334155; border: 1.5px solid #e2e8f0; }
      .br-chip[aria-pressed="true"] { background: #0f766e; color: #fff; border-color: #0f766e; }
      .br-tabs { display: flex; gap: 6px; border-bottom: 2px solid #e2e8f0; margin: 18px 0 14px; flex-wrap: wrap; }
      .br-tab { font-family: inherit; font-size: 14px; font-weight: 700; padding: 9px 16px; cursor: pointer; background: none;
        border: 0; border-bottom: 3px solid transparent; margin-bottom: -2px; color: #64748b; }
      .br-tab[aria-selected="true"] { color: #0f766e; border-bottom-color: #0f766e; }
      .br-sheet { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 860px; }
      .br-sheet th { background: #e8f5ef; color: #134e4a; font-weight: 700; padding: 8px 10px; text-align: left; border: 1px solid #cfe7dc; white-space: nowrap; }
      .br-sheet td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
      .br-sheet tbody tr { cursor: pointer; }
      .br-sheet tbody tr:hover { background: #f0fbf6; }
      .br-sheet tfoot td { font-weight: 800; background: #f8fafc; }
      .br-pdf-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px;
        border: 1px solid #e2e8f0; border-radius: 9px; margin-bottom: 6px; background: #fff; flex-wrap: wrap; }
      .br-viewer { position: fixed; inset: 0; z-index: 3000; background: rgba(15,23,42,0.75); display: flex; flex-direction: column; padding: 14px; }
      .br-viewer-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: #fff; margin-bottom: 10px;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; }
      .br-viewer-frame { flex: 1; width: 100%; border: 0; border-radius: 10px; background: #fff; }
      .br-files td, .br-files th { padding: 7px 10px; border-top: 1px solid #e2e8f0; text-align: left; }
      .br-files th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-top: 0; }
      .br-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; }
      .br-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 760px; }
      .br-table th { background: linear-gradient(90deg, #2f9e75, #3fb6c9); color: #fff; font-weight: 700; padding: 10px 12px; text-align: center; white-space: nowrap; }
      .br-table td { padding: 9px 12px; text-align: center; border-top: 1px solid #eef2f7; vertical-align: middle; }
      .br-table tbody tr:nth-child(odd) { background: #f8fdfb; }
      .br-table tbody tr:hover { background: #e8f7f1; }
      .br-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
      .br-note { border-radius: 10px; padding: 10px 14px; font-size: 13.5px; font-weight: 600; margin-bottom: 14px; display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
      .br-note-ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
      .br-note-bad { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
      .br-note-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; font-weight: 500; }
      .br-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
      .br-visit { border: 1px solid #f3d27a; border-left: 6px solid #f59e0b; border-radius: 10px; background: #fffbeb; padding: 14px 18px; margin-bottom: 18px; }
      .br-visit-title { font-weight: 800; color: #5c4300; margin-bottom: 6px; font-size: 14px; }
      .br-visit-label { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #8a6d1a; margin-top: 8px; }
      .br-visit-instr { font-size: 15.5px; font-weight: 700; color: #78350f; white-space: pre-wrap; overflow-wrap: anywhere; }
      .br-visit-none { font-size: 14px; font-style: italic; color: #7b8a91; }
      .br-visit-text { font-size: 14px; color: #1e293b; white-space: pre-wrap; overflow-wrap: anywhere; }
      .br-pdf { width: 100%; height: 720px; border: 1px solid #cbd5e1; border-radius: 10px; background: #f1f5f9; }
      .br-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 16px; }
      .br-dialog { background: #fff; border-radius: 14px; padding: 22px 24px; width: min(440px, 100%); box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; color: #1e293b; }
      @media (max-width: 760px) {
        .br-head { padding: 16px; } .br-body { padding: 16px; }
        .br-c2, .br-c4 { grid-column: span 12; }
        .br-treat { grid-template-columns: minmax(0, 1fr) auto; }
        .br-treat > .br-t-name { grid-column: 1 / -1; grid-row: 1; }
        .br-treat > .br-t-amt  { grid-column: 1; grid-row: 2; }
        .br-treat > .br-t-del  { grid-column: 2; grid-row: 2; }
        .br-treat > .br-t-desc { grid-column: 1 / -1; grid-row: 3; }
        .br-pdf { height: 480px; }
      }
    `}</style>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Add Payment / Edit Payment
══════════════════════════════════════════════════════════════════ */
// Link a receipt to the patient's record (search by name, case number or mobile).
function PatientLink({ patient, fromVisit, onPick, onClear }) {
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = typed.trim();
    if (q.length < 2) { setFound([]); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.get("/clinic-billing/patients", { params: { q } })
        .then((res) => { if (!cancelled) { setFound(Array.isArray(res.data) ? res.data : []); setOpen(true); } })
        .catch(() => { if (!cancelled) setFound([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [typed]);

  if (patient) {
    return (
      <div className="br-patient" data-testid="patient-link">
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5 }}>
            🔗 <strong>Patient record:</strong> {patient.name}{patient.case_number ? ` · Case ${patient.case_number}` : ""}{patient.mobile ? ` · ${patient.mobile}` : ""}
            {fromVisit && <span style={{ color: "#64748b" }}> (from the doctor's visit)</span>}
          </div>
          {!fromVisit && (
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={onClear}>Change / unlink</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="br-patient" data-testid="patient-link">
      <label className="br-label" htmlFor="br-patient-search">Patient record <span style={{ fontWeight: 500, color: "#64748b" }}>(links this receipt to the patient — recommended)</span></label>
      <input id="br-patient-search" className="br-input" value={typed} autoComplete="off"
        placeholder="Search patient by name, case no. or mobile…"
        onChange={(e) => setTyped(e.target.value)} onFocus={() => found.length && setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {searching && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Searching…</div>}
      {open && typed.trim().length >= 2 && !searching && (
        <div className="br-picks" role="listbox" aria-label="Matching patients">
          {found.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "#64748b" }}>No patient found. The receipt can still be saved without a link.</div>
          ) : found.map((p) => (
            <button key={p.patient_id} type="button" role="option" aria-selected="false" className="br-pick"
              onClick={() => { onPick(p); setTyped(""); setFound([]); setOpen(false); }}>
              <strong>{p.name}</strong>
              <span style={{ color: "#64748b" }}>{p.case_number ? ` · Case ${p.case_number}` : ""}{p.mobile ? ` · ${p.mobile}` : ""}{p.age ? ` · ${p.age} yrs` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiptForm({ receipt, visit, onCancel, onSaved }) {
  const editing = Boolean(receipt);
  const [treatmentList, setTreatmentList] = useState(FALLBACK_TREATMENTS);
  const [nextNo, setNextNo] = useState(null);
  const [date, setDate] = useState(receipt?.date || todayIso());
  const [name, setName] = useState(receipt?.name ?? visit?.name ?? "");
  const [caseNo, setCaseNo] = useState(receipt?.case_no ?? visit?.case_number ?? "");
  const [mobile, setMobile] = useState(receipt?.mobile ?? visit?.mobile ?? "");
  // The patient's record: from the visit, from the saved receipt, or chosen here.
  const visitPatient = visit?.patient_id ? { patient_id: visit.patient_id, name: visit.name, case_number: visit.case_number, mobile: visit.mobile } : null;
  const [patient, setPatient] = useState(receipt?.patient || visitPatient);
  const lockedPatient = Boolean(visitPatient || receipt?.visit_id);
  const [rows, setRows] = useState(() =>
    receipt?.treatments?.length ? receipt.treatments.map((t) => newRow(t.name, t.amount, t.description)) : [newRow()]);
  // Rows whose treatment is typed in by hand ("+ Custom")
  const [customKeys, setCustomKeys] = useState(() => new Set());
  const [total, setTotal] = useState(receipt ? money(receipt.amount_paid) : "0.00");
  const [methods, setMethods] = useState(() => new Set(receipt?.payment_methods || []));
  const [notes, setNotes] = useState(receipt?.notes || "");
  const [visitReceipts, setVisitReceipts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Treatment list, next receipt number and today's date come from the server.
  useEffect(() => {
    let cancelled = false;
    api.get("/clinic-billing/receipts/new")
      .then((res) => {
        if (cancelled || !res.data) return;
        if (Array.isArray(res.data.treatments) && res.data.treatments.length) setTreatmentList(res.data.treatments);
        if (!editing) {
          setNextNo(res.data.receipt_no);
          if (res.data.date) setDate(res.data.date);
        }
      })
      .catch((err) => { if (!cancelled) setError(errorText(err, "")); });
    return () => { cancelled = true; };
  }, [editing]);

  // Opened for a clinic visit: does it already have a receipt?
  useEffect(() => {
    if (!visit?.visit_id) return undefined;
    let cancelled = false;
    api.get("/clinic-billing/receipts", { params: { visit_id: visit.visit_id } })
      .then((res) => { if (!cancelled) setVisitReceipts(res.data?.receipts || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visit?.visit_id]);

  // A treatment that is not in the list is a custom one (matters when editing).
  useEffect(() => {
    setCustomKeys((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => { if (r.name && !treatmentList.includes(r.name)) next.add(r.key); });
      return next;
    });
  }, [treatmentList]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = useMemo(() => rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [rows]);

  // The total follows the treatment amounts (as in the old software). When editing,
  // the saved total is shown first and follows only once an amount is changed.
  const lastSum = useRef(sum);
  useEffect(() => {
    if (lastSum.current === sum) return;
    lastSum.current = sum;
    setTotal(money(sum));
  }, [sum]);

  const changeRow = (key, patch) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => setRows((prev) => prev.filter((r) => r.key !== key));
  const pickTreatment = (row, value) => {
    setCustomKeys((prev) => {
      const next = new Set(prev);
      if (value === CUSTOM) next.add(row.key); else next.delete(row.key);
      return next;
    });
    changeRow(row.key, { name: value === CUSTOM ? "" : value });
  };
  const toggleMethod = (m) => setMethods((prev) => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) { setError("Please enter the patient's name."); return; }
    const badRow = rows.find((r) => r.name.trim() && r.amount !== "" && !(parseFloat(r.amount) >= 0));
    if (badRow) { setError(`Please check the amount for “${badRow.name.trim()}”.`); return; }

    const body = {
      date,
      name: name.trim(),
      case_no: caseNo.trim(),
      mobile: mobile.trim(),
      treatments: rows.filter((r) => r.name.trim()).map((r) => ({
        name: r.name.trim(), amount: parseFloat(r.amount) || 0, description: r.description.trim(),
      })),
      amount_paid: total,
      payment_methods: PAYMENT_METHODS.filter((m) => methods.has(m)),
      notes: notes.trim(),
    };
    if (!editing && visit?.visit_id) body.visit_id = visit.visit_id;
    body.patient_id = patient?.patient_id ?? null;

    setSaving(true); setError("");
    try {
      const res = editing
        ? await api.put(`/clinic-billing/receipts/${receipt.id}`, body)
        : await api.post("/clinic-billing/receipts", body);
      onSaved(res.data, editing);
    } catch (err) {
      setError(errorText(err, "The receipt was not saved. Please check the connection and try again."));
      setSaving(false);
    }
  };

  return (
    <div className="br-card">
      <div className="br-head">
        <div>
          <h2>{editing ? `✏️ Edit Payment - #${receipt.receipt_no}` : "💰 Add Payment"}</h2>
          {editing && <p>{receipt.name}</p>}
        </div>
        <button type="button" className="br-btn br-btn-ghost" onClick={onCancel}>← Back to Payments</button>
      </div>

      <div className="br-body">
        {visit && !editing && (
          <>
            {visitReceipts.length > 0 && (
              <div className="br-note br-note-bad" role="alert" style={{ color: "#92400e", background: "#fffbeb", borderColor: "#fcd34d" }}>
                <span>
                  This visit already has {visitReceipts.map((r) => `receipt #${r.receipt_no} (₹${money(r.amount_paid)})`).join(", ")}.
                  Save another one only if this is a further payment for the same visit.
                </span>
              </div>
            )}
            <div className="br-visit" data-testid="visit-box">
              <div className="br-visit-title">
                🦷 Sent by the Doctor{visit.closed_display ? ` · visit closed ${visit.closed_display}` : ""}{visit.closed_by ? ` by ${visit.closed_by}` : ""}
              </div>
              <span className="br-visit-label">Doctor's billing instructions</span>
              {visit.billing_note
                ? <div className="br-visit-instr">{visit.billing_note}</div>
                : <div className="br-visit-none">No special instructions from the doctor.</div>}
              {visit.treatment_done && (<><span className="br-visit-label">Treatment done</span><div className="br-visit-text">{visit.treatment_done}</div></>)}
              {visit.next_appointment && (<><span className="br-visit-label">Next appointment</span><div className="br-visit-text">{visit.next_appointment}</div></>)}
              <div style={{ fontSize: 12, color: "#7b6a3a", marginTop: 8 }}>When this receipt is saved, the visit moves to Billed in Doctor's Instructions.</div>
            </div>
          </>
        )}

        {error && <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>}

        <form onSubmit={submit} noValidate aria-label={editing ? "Edit payment" : "Add payment"}>
          <div className="br-grid">
            <div className="br-c2">
              <label className="br-label" htmlFor="br-date">Date</label>
              <input id="br-date" type="date" className="br-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="br-c2">
              <label className="br-label" htmlFor="br-no">Receipt No</label>
              <input id="br-no" className="br-input" readOnly value={editing ? receipt.receipt_no : (nextNo ?? "")}
                title={editing ? "The receipt number never changes" : "Given when the receipt is saved"} />
            </div>
            <div className="br-c4">
              <label className="br-label" htmlFor="br-name">Name</label>
              <input id="br-name" className="br-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
            </div>
            <div className="br-c2">
              <label className="br-label" htmlFor="br-case">Case No</label>
              <input id="br-case" className="br-input" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} maxLength={100} />
            </div>
            <div className="br-c2">
              <label className="br-label" htmlFor="br-mobile">Mobile</label>
              <input id="br-mobile" className="br-input" value={mobile} onChange={(e) => setMobile(e.target.value)} maxLength={30} inputMode="tel" />
            </div>
          </div>

          <PatientLink
            patient={patient}
            fromVisit={lockedPatient}
            onPick={(p) => { setPatient(p); setName(p.name || ""); setCaseNo(p.case_number || ""); setMobile(p.mobile || ""); }}
            onClear={() => setPatient(null)}
          />

          <hr style={{ border: 0, borderTop: "1px solid #d7efe6", margin: "20px 0 14px" }} />
          <h3 style={{ margin: "0 0 10px", fontSize: 15.5, fontWeight: 800, color: "#17313b" }}>Treatments</h3>

          {rows.map((row, index) => {
            const isCustom = customKeys.has(row.key);
            return (
              <div className="br-treat" key={row.key} data-testid="treatment-row">
                <div className="br-t-name">
                  <select className="br-input" aria-label={`Treatment ${index + 1}`}
                    value={isCustom ? CUSTOM : row.name} onChange={(e) => pickTreatment(row, e.target.value)}>
                    <option value="">-- Select Treatment --</option>
                    {treatmentList.map((t) => <option key={t} value={t}>{t}</option>)}
                    <option value={CUSTOM}>+ Custom</option>
                  </select>
                  {isCustom && (
                    <input className="br-input" style={{ marginTop: 6 }} placeholder="Enter custom treatment" maxLength={200}
                      aria-label={`Custom treatment ${index + 1}`} value={row.name} onChange={(e) => changeRow(row.key, { name: e.target.value })} />
                  )}
                </div>
                <input className="br-input br-t-amt" type="number" min="0" step="any" inputMode="decimal" placeholder="Amount"
                  aria-label={`Amount ${index + 1}`} value={row.amount} onChange={(e) => changeRow(row.key, { amount: e.target.value })} />
                <input className="br-input br-t-desc" placeholder="Description" maxLength={500}
                  aria-label={`Description ${index + 1}`} value={row.description} onChange={(e) => changeRow(row.key, { description: e.target.value })} />
                <button type="button" className="br-btn br-btn-sm br-btn-danger br-t-del" aria-label={`Remove treatment ${index + 1}`}
                  onClick={() => removeRow(row.key)}>×</button>
              </div>
            );
          })}
          <button type="button" className="br-btn br-btn-sm br-btn-plain" style={{ color: "#0f766e", borderColor: "#2f9e75" }}
            onClick={() => setRows((prev) => [...prev, newRow()])}>+ Add Treatment</button>

          <div style={{ marginTop: 18 }}>
            <label className="br-label" htmlFor="br-total">Total Amount</label>
            <input id="br-total" className="br-input" value={total} readOnly={!editing} inputMode="decimal"
              onChange={(e) => setTotal(e.target.value)} />
            {editing && Math.abs((parseFloat(total) || 0) - sum) > 0.004 && (
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 4 }}>
                The treatments add up to ₹{money(sum)}; the receipt will show ₹{money(total)}.
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} role="group" aria-label="Payment methods">
            <span className="br-label">Payment Method(s)</span>
            <div style={{ display: "flex", gap: "8px 18px", flexWrap: "wrap" }}>
              {PAYMENT_METHODS.map((m) => (
                <label key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={methods.has(m)} onChange={() => toggleMethod(m)} style={{ width: 16, height: 16 }} /> {m}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label className="br-label" htmlFor="br-notes">Treatment Description / Notes</label>
            <textarea id="br-notes" className="br-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} style={{ resize: "vertical" }} />
          </div>

          <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="submit" className="br-btn br-btn-main" disabled={saving}>
              {saving ? "Saving…" : editing ? "💾 Save & Regenerate PDF" : "💾 Save & Generate PDF"}
            </button>
            <button type="button" className="br-btn br-btn-plain" onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   One receipt: details + the PDF
══════════════════════════════════════════════════════════════════ */
function ReceiptView({ receipt, message, files, onBack, onEdit, backLabel = "← Back to Payments", onAccount, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBlob, setPdfBlob] = useState(null);
  const [pdfError, setPdfError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let made = "";
    setPdfUrl(""); setPdfBlob(null); setPdfError("");
    api.get(`/clinic-billing/receipts/${receipt.id}/pdf`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        setPdfBlob(res.data);
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          made = URL.createObjectURL(res.data);
          setPdfUrl(made);
        }
      })
      .catch(async (err) => { if (!cancelled) setPdfError(await blobErrorText(err, "The PDF could not be made. Please try again.")); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [receipt.id, receipt.amount_paid, receipt.name, receipt.date, receipt.notes]);

  const field = (label, value) => (
    <p style={{ margin: "0 0 8px", fontSize: 14 }}><strong style={{ color: "#0f766e" }}>{label}:</strong> {value}</p>
  );

  return (
    <div className="br-card">
      <div className="br-head">
        <div>
          <h2>Receipt #{receipt.receipt_no}</h2>
          <p>{receipt.name}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onAccount && <button type="button" className="br-btn br-btn-ghost" onClick={onAccount}>👤 Patient account</button>}
          <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>{backLabel}</button>
        </div>
      </div>
      <div className="br-body">
        {message && <div className="br-note br-note-ok" role="status"><span>✓ {message}</span></div>}
        <FilesReport files={files} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 24px" }}>
          <div>{field("Date", receipt.date)}{field("Case No", receipt.case_no || "—")}</div>
          <div>{field("Mobile", receipt.mobile || "—")}{field("Amount", `₹${money(receipt.amount_paid)}`)}</div>
        </div>
        {field("Payment Method(s)", receipt.payment_methods.length ? receipt.payment_methods.join(", ") : "—")}
        {receipt.notes && field("Notes", receipt.notes)}
        {field("Patient record", receipt.patient
          ? `${receipt.patient.name}${receipt.patient.case_number ? ` · Case ${receipt.patient.case_number}` : ""}`
          : "Not linked — Edit to link it to the patient")}
        {receipt.visit_id && field("Clinic visit", `#${receipt.visit_id}`)}
        {receipt.from_old_software && <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#64748b" }}>Brought over from the old billing software.</p>}

        <h3 style={{ margin: "14px 0 8px", fontSize: 15, fontWeight: 800, color: "#17313b" }}>Treatments</h3>
        {receipt.treatments.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "#64748b", margin: 0 }}>No treatments on this receipt.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {receipt.treatments.map((t, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start",
                border: "1px solid #e2e8f0", borderLeft: "5px solid #3fb6c9", borderRadius: 8, padding: "9px 12px", marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{t.name}</strong>
                  {t.description && <div style={{ fontSize: 12.5, color: "#64748b", overflowWrap: "anywhere" }}>{t.description}</div>}
                  {t.charge_id && (
                    <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>
                      Charge ₹{money(t.charge_net)}{t.charge_discount > 0 ? ` (after ₹${money(t.charge_discount)} discount)` : ""}
                      {t.paid_before > 0 ? ` · paid earlier ₹${money(t.paid_before)}` : ""}
                      {" · "}{t.balance_after > 0.004
                        ? <strong style={{ color: "#b45309" }}>balance ₹{money(t.balance_after)}</strong>
                        : <strong style={{ color: "#047857" }}>fully paid</strong>}
                    </div>
                  )}
                </div>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>₹{money(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {receipt.balance_after != null && (
          <div className={`br-note ${receipt.balance_after > 0.004 ? "br-note-bad" : "br-note-ok"}`} style={{ marginTop: 10 }} data-testid="receipt-balance">
            <span>{receipt.balance_after > 0.004
              ? `Patient's total balance due after this payment: ₹${money(receipt.balance_after)}`
              : "✓ Nothing is due from the patient after this payment."}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "18px 0" }}>
          <button type="button" className="br-btn br-btn-main" disabled={!pdfBlob} onClick={() => saveBlob(pdfBlob, receipt.pdf_name)}>⬇ Download PDF</button>
          <button type="button" className="br-btn br-btn-plain" disabled={!pdfUrl} onClick={() => window.open(pdfUrl, "_blank")}>🖨 Open to Print</button>
          <button type="button" className="br-btn br-btn-edit" onClick={onEdit}>✏️ Edit</button>
          {onDeleted && <button type="button" className="br-btn br-btn-del" onClick={() => setDeleting(true)}>🗑 Delete</button>}
          {onAccount && <button type="button" className="br-btn br-btn-plain" onClick={onAccount}>👤 Patient account</button>}
          <button type="button" className="br-btn br-btn-plain" onClick={onBack}>← Back</button>
        </div>

        {pdfError
          ? <div className="br-note br-note-bad" role="alert"><span>⚠️ {pdfError}</span></div>
          : pdfUrl
            ? <iframe className="br-pdf" title={`Receipt ${receipt.receipt_no}`} src={pdfUrl} />
            : <div style={{ fontSize: 13, color: "#64748b" }}>{pdfBlob ? "The PDF is ready — use Download PDF." : "Preparing the PDF…"}</div>}
      </div>
      {deleting && (
        <DeleteReceiptDialog receipt={receipt} onCancel={() => setDeleting(false)}
          onDeleted={(res, why) => { setDeleting(false); onDeleted(res, why); }} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Deleted receipts — the deletion log (read-only)
══════════════════════════════════════════════════════════════════ */
function DeletedReceipts({ onBack }) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    api.get("/clinic-billing/deleted", query ? { params: { q: query } } : undefined)
      .then((res) => { if (!cancelled) { setRows(res.data?.deleted || []); setTotal(res.data?.total_amount || 0); } })
      .catch((err) => { if (!cancelled) { setRows([]); setError(errorText(err, "The deletion log could not be loaded. Please try again.")); } });
    return () => { cancelled = true; };
  }, [query]);

  return (
    <div className="br-card">
      <div className="br-head" style={{ background: "linear-gradient(90deg, #7f1d1d, #b45309)" }}>
        <div>
          <h2>🗑 Deleted receipts</h2>
          <p>Every deleted receipt in full — with the reason, who deleted it and when. Nothing here can be changed.</p>
        </div>
        <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>← Back to Payments</button>
      </div>
      <div className="br-body">
        <form onSubmit={(e) => { e.preventDefault(); setQuery(typed.trim()); }} role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input className="br-input" style={{ flex: "1 1 260px", width: "auto" }} value={typed} onChange={(e) => setTyped(e.target.value)}
            placeholder="Search by name, receipt no, case no, reason or who deleted" aria-label="Search deleted receipts" />
          <button type="submit" className="br-btn br-btn-main">Search</button>
          {query && <button type="button" className="br-btn br-btn-plain" onClick={() => { setTyped(""); setQuery(""); }}>Show all</button>}
        </form>
        {error && <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>}
        <div className="br-table-wrap">
          <table className="br-table" style={{ minWidth: 900 }}>
            <thead><tr><th>Deleted on</th><th>By</th><th>Receipt No</th><th>Receipt date</th><th>Name</th><th>Amount (₹)</th><th style={{ textAlign: "left" }}>Reason</th><th></th></tr></thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={8} style={{ color: "#94a3b8", padding: 22 }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} style={{ color: "#64748b", padding: 22 }}>{query ? "Nothing found." : "No receipt has been deleted."}</td></tr>
              ) : rows.map((d) => (
                <FragmentRow key={d.id} d={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />
              ))}
            </tbody>
          </table>
        </div>
        {rows && rows.length > 0 && (
          <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 8 }}>
            {rows.length} deleted receipt{rows.length !== 1 ? "s" : ""}{query ? ` for “${query}”` : ""} · ₹{money(total)} in all.
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ d, open, onToggle }) {
  const r = d.receipt || {};
  return (
    <>
      <tr data-deleted={d.receipt_no}>
        <td style={{ whiteSpace: "nowrap" }}>{d.deleted_display}</td>
        <td>{d.deleted_by || "—"}</td>
        <td>
          <s style={{ color: "#991b1b" }}>#{d.receipt_no}</s>
          {d.number_now_used_by && <div style={{ fontSize: 11, color: "#0f766e", fontWeight: 700 }} title="This number was given to a new receipt after the deletion">♻ now {d.number_now_used_by.name}</div>}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>{d.date}</td>
        <td style={{ overflowWrap: "anywhere" }}>{d.name}</td>
        <td><strong>{money(d.amount_paid)}</strong></td>
        <td style={{ textAlign: "left", fontWeight: 700, color: "#7c2d12", overflowWrap: "anywhere" }}>{d.reason}</td>
        <td><button type="button" className="br-btn br-btn-sm br-btn-plain" aria-expanded={open} onClick={onToggle}>{open ? "Hide" : "Details"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ textAlign: "left", background: "#fffbeb" }}>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div><strong>Case No:</strong> {d.case_no || "—"} · <strong>Mobile:</strong> {d.mobile || "—"} · <strong>Paid by:</strong> {(r.payment_methods || []).join(", ") || "—"}
                {d.visit_id ? <> · <strong>Visit:</strong> #{d.visit_id}</> : null}</div>
              {(r.treatments || []).map((t, i) => (
                <div key={i}>• {t.name}{t.description ? ` (${t.description})` : ""} — ₹{money(t.amount)}</div>
              ))}
              {r.notes && <div><strong>Notes:</strong> {r.notes}</div>}
              {d.number_now_used_by && (
                <div style={{ color: "#0f766e", fontWeight: 700 }}>
                  ♻ Number #{d.receipt_no} was given again — it is now the receipt of {d.number_now_used_by.name}, {d.number_now_used_by.date}, ₹{money(d.number_now_used_by.amount_paid)}.
                </div>
              )}
              {r.created_by && <div style={{ color: "#64748b" }}>Made by {r.created_by}{r.created_at ? ` on ${String(r.created_at).replace("T", " ").slice(0, 16)}` : ""}</div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Payment Dashboard (list)
══════════════════════════════════════════════════════════════════ */
function ReceiptList({ onBack, onAdd, onView, onEdit, onChanged, flash, clearFlash, pending, onInstructions, onFiles, onAccount, onDeletedLog }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [toDelete, setToDelete] = useState(null);         // asks for the reason, then deletes
  const [busyPdf, setBusyPdf] = useState(null);
  const [note, setNote] = useState(null);                 // { ok, text, files }
  const [panel, setPanel] = useState("");                 // "" | "excel" | "import"
  const [excelFrom, setExcelFrom] = useState(firstOfMonth());
  const [excelTo, setExcelTo] = useState(todayIso());
  const [excelBusy, setExcelBusy] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [folder, setFolder] = useState(null);             // { enabled, folder, writable }
  const [withPdfs, setWithPdfs] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenResult, setRegenResult] = useState(null);

  useEffect(() => {
    if (panel !== "excel" || folder) return;
    api.get("/clinic-billing/files/status").then((res) => setFolder(res.data)).catch(() => setFolder({ unknown: true }));
  }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps

  const regenerate = async () => {
    if (regenBusy) return;
    if (!excelFrom || !excelTo) { setRegenResult({ ok: false, text: "Please choose both dates." }); return; }
    if (excelTo < excelFrom) { setRegenResult({ ok: false, text: "The To date is before the From date." }); return; }
    setRegenBusy(true); setRegenResult(null);
    try {
      const res = await api.post("/clinic-billing/files/regenerate", { date_from: excelFrom, date_to: excelTo, include_pdfs: withPdfs });
      setRegenResult({ ok: true, data: res.data });
    } catch (err) {
      setRegenResult({ ok: false, text: errorText(err, "The files could not be saved. Please try again.") });
    } finally {
      setRegenBusy(false);
    }
  };

  const load = async (q = query) => {
    setLoading(true);
    try {
      const res = await api.get("/clinic-billing/receipts", q ? { params: { q } } : undefined);
      setRows(res.data?.receipts || []);
      setTotal(res.data?.total || 0);
      setAllCount(res.data?.all_receipts ?? res.data?.total ?? 0);
      setError("");
    } catch (err) {
      setRows([]);
      setError(errorText(err, "The receipts could not be loaded. Please check the connection and try again."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(query); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (e) => { e.preventDefault(); clearFlash(); setNote(null); setQuery(typed.trim()); };
  const clearSearch = () => { setTyped(""); setQuery(""); };

  const downloadPdf = async (r) => {
    if (busyPdf) return;
    setBusyPdf(r.id); setNote(null);
    try {
      const res = await api.get(`/clinic-billing/receipts/${r.id}/pdf`, { responseType: "blob" });
      saveBlob(res.data, r.pdf_name);
    } catch (err) {
      setNote({ ok: false, text: await blobErrorText(err, "The PDF could not be made. Please try again.") });
    } finally {
      setBusyPdf(null);
    }
  };

  const downloadExcel = async () => {
    if (excelBusy) return;
    if (!excelFrom || !excelTo) { setNote({ ok: false, text: "Please choose both dates." }); return; }
    if (excelTo < excelFrom) { setNote({ ok: false, text: "The To date is before the From date." }); return; }
    setExcelBusy(true); setNote(null);
    try {
      const res = await api.get("/clinic-billing/excel", { params: { date_from: excelFrom, date_to: excelTo }, responseType: "blob" });
      const from = new Date(`${excelFrom}T00:00:00`), to = new Date(`${excelTo}T00:00:00`);
      const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      saveBlob(res.data, sameMonth ? `${months[from.getMonth()]}${from.getFullYear()}.xlsx` : `Receipts_${excelFrom}_to_${excelTo}.xlsx`);
    } catch (err) {
      setNote({ ok: false, text: await blobErrorText(err, "The Excel sheet could not be made. Please try again.") });
    } finally {
      setExcelBusy(false);
    }
  };

  const runImport = async () => {
    if (!importFile || importBusy) return;
    setImportBusy(true); setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await api.post("/clinic-billing/import-old", form, { headers: { "Content-Type": "multipart/form-data" } });
      setImportResult({ ok: true, data: res.data });
      setImportFile(null);
      await load(query);
    } catch (err) {
      setImportResult({ ok: false, text: errorText(err, "The file could not be imported. Please check the connection and try again.") });
    } finally {
      setImportBusy(false);
    }
  };

  const lastMonth = () => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    setExcelFrom(firstOfMonth(d)); setExcelTo(lastOfMonth(d));
  };

  const shownNote = note || flash || null;
  const nothingAtAll = !loading && !error && !query && allCount === 0;

  return (
    <div className="br-card">
      <div className="br-head">
        <div>
          <h2>💳 Payment Dashboard</h2>
          <p>Receipts — the clinic's billing</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onBack && <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>← Dashboard</button>}
          <button type="button" className="br-btn br-btn-ghost" onClick={onInstructions}>
            📝 Doctor's Instructions{pending > 0 && <span className="br-count" title={`${pending} waiting to be billed`}>{pending}</span>}
          </button>
          <button type="button" className="br-btn br-btn-ghost" onClick={onFiles}>📁 Receipt Files</button>
          <button type="button" className="br-btn br-btn-ghost" onClick={onDeletedLog}>🗑 Deleted receipts</button>
          <button type="button" className="br-btn br-btn-white" onClick={() => onAdd()}>+ Add Payment</button>
        </div>
      </div>

      <div className="br-body">
        {shownNote && (
          <div className={`br-note ${shownNote.ok ? "br-note-ok" : "br-note-bad"}`} role={shownNote.ok ? "status" : "alert"}>
            <span>{shownNote.ok ? "✓" : "⚠️"} {shownNote.text}</span>
            <button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={() => { setNote(null); clearFlash(); }}>Close</button>
          </div>
        )}
        {shownNote?.files && <FilesReport files={{ ...shownNote.files, written: [] }} />}

        {pending > 0 && (
          <div className="br-pending" role="note" aria-label="Waiting for billing">
            <span>📝 {pending} visit{pending !== 1 ? "s" : ""} closed by the doctor {pending !== 1 ? "are" : "is"} waiting for billing.</span>
            <button type="button" className="br-btn br-btn-sm br-btn-main" onClick={onInstructions}>Open Doctor's Instructions</button>
          </div>
        )}

        <form onSubmit={search} role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input className="br-input" style={{ flex: "1 1 260px", width: "auto" }} value={typed} onChange={(e) => setTyped(e.target.value)}
            placeholder="Search by case no, receipt no, name, or mobile" aria-label="Search receipts" />
          <button type="submit" className="br-btn br-btn-main">Search</button>
          {query && <button type="button" className="br-btn br-btn-plain" onClick={clearSearch}>Show all</button>}
          <button type="button" className="br-btn br-btn-plain" aria-expanded={panel === "excel"} onClick={() => setPanel(panel === "excel" ? "" : "excel")}>📊 Excel &amp; files</button>
          <button type="button" className="br-btn br-btn-plain" aria-expanded={panel === "import"} onClick={() => setPanel(panel === "import" ? "" : "import")}>⬆ Import old receipts</button>
        </form>

        {panel === "excel" && (
          <div className="br-panel" role="region" aria-label="Excel">
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 14 }}>📊 Excel sheets and receipt files</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div><label className="br-label" htmlFor="br-xfrom">From</label><input id="br-xfrom" type="date" className="br-input" value={excelFrom} onChange={(e) => setExcelFrom(e.target.value)} /></div>
              <div><label className="br-label" htmlFor="br-xto">To</label><input id="br-xto" type="date" className="br-input" value={excelTo} onChange={(e) => setExcelTo(e.target.value)} /></div>
              <button type="button" className="br-btn br-btn-plain" onClick={() => { setExcelFrom(firstOfMonth()); setExcelTo(todayIso()); }}>This month</button>
              <button type="button" className="br-btn br-btn-plain" onClick={lastMonth}>Last month</button>
              <button type="button" className="br-btn br-btn-main" disabled={excelBusy} onClick={downloadExcel}>{excelBusy ? "Preparing…" : "⬇ Download Excel"}</button>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
              Same columns as the old monthly sheet. It is made fresh from the saved receipts each time, so it is always up to date.
            </div>

            <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 14, paddingTop: 12 }} data-testid="folder-box">
              {!folder ? (
                <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Checking where the receipt files are kept…</div>
              ) : folder.unknown ? (
                <div style={{ fontSize: 12.5, color: "#b45309" }}>⚠️ Could not ask the server about the receipt files.</div>
              ) : !folder.enabled ? (
                <div style={{ fontSize: 12.5, color: "#64748b" }}>Saving receipt files is switched off on the server.</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.6 }}>
                    📁 Every receipt's PDF and each month's Excel sheet are saved by themselves in financial-year folders
                    {folder.storage === "s3" ? " in " : " on the server in "}
                    <code style={{ background: "#eef2f7", padding: "1px 6px", borderRadius: 5, overflowWrap: "anywhere" }}>{folder.folder}</code>
                    <div style={{ fontSize: 12, color: "#64748b", overflowWrap: "anywhere" }}>For example: {folder.example}</div>
                  </div>
                  {!folder.writable && (
                    <div className="br-note br-note-bad" role="alert" style={{ marginTop: 8, marginBottom: 0 }}>
                      <span>⚠️ The receipt files cannot be saved there right now{folder.problem ? `: ${folder.problem}` : "."} Receipts are still saved.</span>
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="br-btn br-btn-main" onClick={onFiles}>📁 Open Receipt Files</button>
                    <span style={{ fontSize: 12.5, color: "#64748b", marginLeft: 10 }}>see each month's Excel sheet and receipt PDFs here in the app</span>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
                    <button type="button" className="br-btn br-btn-plain" disabled={regenBusy} onClick={regenerate}>
                      {regenBusy ? "Saving…" : "💾 Save files again for these dates"}
                    </button>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={withPdfs} onChange={(e) => setWithPdfs(e.target.checked)} /> also make every receipt's PDF again
                    </label>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                    Uses the From / To dates above. For files that were deleted, or could not be saved at the time (like “Regenerate Excel” in the old software).
                  </div>
                  {regenResult && !regenResult.ok && <div className="br-note br-note-bad" role="alert" style={{ marginTop: 10, marginBottom: 0 }}><span>⚠️ {regenResult.text}</span></div>}
                  {regenResult?.ok && (
                    <div className={`br-note ${regenResult.data.problems?.length ? "br-note-bad" : "br-note-ok"}`} role="status" style={{ marginTop: 10, marginBottom: 0, display: "block" }}>
                      <div>✓ {regenResult.data.excel_count} Excel sheet{regenResult.data.excel_count !== 1 ? "s" : ""}
                        {withPdfs || regenResult.data.pdf_count ? ` and ${regenResult.data.pdf_count} PDF${regenResult.data.pdf_count !== 1 ? "s" : ""}` : ""} saved.</div>
                      {(regenResult.data.problems || []).map((p) => <div key={p} style={{ marginTop: 6 }}>⚠️ {p}</div>)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {panel === "import" && (
          <div className="br-panel" role="region" aria-label="Import old receipts">
            <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 14 }}>⬆ Bring over the receipts of the old billing software</div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 1.55 }}>
              Choose the file <strong>payments.db</strong> from the old billing software's folder. Every old receipt is copied here with its
              own receipt number, and new receipts continue from the last number. Nothing here is overwritten, and the file itself is not changed.
              It is safe to do this more than once — receipts that are already here are skipped.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" aria-label="Old billing database file"
                onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }} />
              <button type="button" className="br-btn br-btn-main" disabled={!importFile || importBusy} onClick={runImport}>{importBusy ? "Importing…" : "Import"}</button>
            </div>
            {importResult && !importResult.ok && <div className="br-note br-note-bad" role="alert" style={{ marginTop: 12, marginBottom: 0 }}><span>⚠️ {importResult.text}</span></div>}
            {importResult?.ok && (
              <div className={`br-note ${importResult.data.number_clash_count ? "br-note-bad" : "br-note-ok"}`} role="status" style={{ marginTop: 12, marginBottom: 0, display: "block" }}>
                <div>✓ {importResult.data.imported} receipt{importResult.data.imported !== 1 ? "s" : ""} brought over
                  {importResult.data.already_here ? `, ${importResult.data.already_here} already here` : ""}
                  {importResult.data.unreadable ? `, ${importResult.data.unreadable} could not be read` : ""}.
                  The next receipt will be #{importResult.data.next_receipt_no}.</div>
                {importResult.data.linked_to_patients > 0 && (
                  <div style={{ marginTop: 6, fontWeight: 500 }}>🔗 {importResult.data.linked_to_patients} linked to their patient records by case number.</div>
                )}
                {importResult.data.files?.written?.length > 0 && (
                  <div style={{ marginTop: 6, fontWeight: 500 }}>📁 Monthly Excel sheets updated: {importResult.data.files.written.length}.</div>
                )}
                {(importResult.data.files?.problems || []).map((p) => <div key={p} style={{ marginTop: 6 }}>⚠️ {p}</div>)}
                {importResult.data.number_clash_count > 0 && (
                  <div style={{ marginTop: 6 }}>
                    ⚠️ {importResult.data.number_clash_count} old receipt{importResult.data.number_clash_count !== 1 ? "s were" : " was"} NOT brought over because
                    {" "}the same receipt number is already used by a different receipt here: #{importResult.data.number_clashes.join(", #")}
                    {importResult.data.number_clash_count > importResult.data.number_clashes.length ? " …" : ""}. Nothing was overwritten.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {nothingAtAll && panel !== "import" && (
          <div className="br-note br-note-info" role="note">
            <span>Moving from the old billing software? Press <strong>⬆ Import old receipts</strong> first, before making the first receipt here,
              so the receipt numbers continue from where the old software stopped.</span>
          </div>
        )}

        {error && (
          <div className="br-note br-note-bad" role="alert">
            <span>⚠️ {error}</span>
            <button type="button" className="br-btn br-btn-sm br-btn-plain" onClick={() => load(query)}>Try again</button>
          </div>
        )}

        <div className="br-table-wrap">
          <table className="br-table">
            <thead>
              <tr><th>Date</th><th>Receipt No</th><th>Name</th><th>Case No</th><th>Mobile</th><th>Amount (₹)</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={7} style={{ color: "#94a3b8", padding: 22 }}>Loading receipts…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ color: "#64748b", padding: 22 }}>{error ? "—" : "No records found."}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} data-receipt={r.receipt_no}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                  <td>{r.receipt_no}</td>
                  <td style={{ overflowWrap: "anywhere" }}>
                    {r.patient_id
                      ? <button type="button" className="pa-link" style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "#0f766e", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                          title="Open the patient's account" onClick={() => onAccount(r.patient_id)}>{r.name}</button>
                      : r.name}
                    {r.balance_after > 0.004 && <div style={{ fontSize: 11.5, color: "#b45309", fontWeight: 700 }}>balance ₹{money(r.balance_after)}</div>}
                  </td>
                  <td>{r.case_no}</td>
                  <td>{r.mobile}</td>
                  <td><strong>{money(r.amount_paid)}</strong></td>
                  <td>
                    <span className="br-actions">
                      <button type="button" className="br-btn br-btn-sm br-btn-view" onClick={() => onView(r)}>View</button>
                      <button type="button" className="br-btn br-btn-sm br-btn-edit" onClick={() => onEdit(r)}>Edit</button>
                      <button type="button" className="br-btn br-btn-sm br-btn-del" onClick={() => setToDelete(r)}>Delete</button>
                      <button type="button" className="br-btn br-btn-sm br-btn-pdf" disabled={busyPdf === r.id} onClick={() => downloadPdf(r)}>{busyPdf === r.id ? "…" : "PDF"}</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !error && rows.length > 0 && (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
            {query
              ? `${total} receipt${total !== 1 ? "s" : ""} found for “${query}”.`
              : total > rows.length
                ? `Showing the latest ${rows.length} of ${total} receipts — search to find older ones.`
                : `${total} receipt${total !== 1 ? "s" : ""}.`}
          </div>
        )}
      </div>

      {toDelete && (
        <DeleteReceiptDialog
          receipt={toDelete}
          onCancel={() => setToDelete(null)}
          onDeleted={async (res, why) => {
            const r = toDelete;
            setToDelete(null);
            setNote({ ok: true, text: `Receipt #${r.receipt_no} deleted. Reason: ${why}.${res.visit_back_to_pending ? " Its visit is back under Pending in Doctor's Instructions." : ""}`, files: res.files });
            clearFlash();
            if (onChanged) onChanged();
            await load(query);
          }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Receipt Files — a month's Excel sheet and receipt PDFs, inside the app
   (the same files that are saved in receipts/Financial year …/Sep2026/…)
══════════════════════════════════════════════════════════════════ */
const SHEET_HEADINGS = {
  date: "Date", receipt_no: "Receipt No", name: "Name", case_no: "Case No", mobile: "Mobile",
  treatment_summary: "Treatments", amount_paid: "Amount (₹)", payment_methods: "Payment",
  balance_due: "Balance due (₹)",
};

function PdfViewer({ files, index, onIndex, onClose }) {
  const file = files[index];
  const [url, setUrl] = useState("");
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false, made = "";
    setUrl(""); setBlob(null); setError("");
    api.get("/clinic-billing/files/download", { params: { key: file.key, inline: 1 }, responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        setBlob(res.data);
        if (typeof URL.createObjectURL === "function") { made = URL.createObjectURL(res.data); setUrl(made); }
      })
      .catch(async (err) => { if (!cancelled) setError(await blobErrorText(err, "This PDF could not be opened. Please try again.")); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [file.key]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="br-viewer" role="dialog" aria-modal="true" aria-label={`Receipt PDF ${file.name}`}>
      <div className="br-viewer-bar">
        <strong style={{ fontSize: 15, marginRight: 8, overflowWrap: "anywhere" }}>📄 {file.name}</strong>
        <span style={{ fontSize: 12.5, opacity: 0.8 }}>{index + 1} of {files.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="br-btn br-btn-sm br-btn-plain" disabled={index === 0} onClick={() => onIndex(index - 1)}>◀ Previous</button>
        <button type="button" className="br-btn br-btn-sm br-btn-plain" disabled={index === files.length - 1} onClick={() => onIndex(index + 1)}>Next ▶</button>
        <button type="button" className="br-btn br-btn-sm br-btn-plain" disabled={!url} onClick={() => window.open(url, "_blank")}>🖨 Open to Print</button>
        <button type="button" className="br-btn br-btn-sm br-btn-main" disabled={!blob} onClick={() => saveBlob(blob, file.name)}>⬇ Download</button>
        <button type="button" className="br-btn br-btn-sm br-btn-danger" onClick={onClose} aria-label="Close">✕ Close</button>
      </div>
      {error
        ? <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>
        : url
          ? <iframe className="br-viewer-frame" title={file.name} src={url} />
          : <div style={{ color: "#fff", fontSize: 14 }}>{blob ? "The PDF is ready — use Download." : "Opening the PDF…"}</div>}
    </div>,
    document.body
  );
}

function ReceiptFiles({ onBack }) {
  const [years, setYears] = useState(null);               // [{ fy, label, months: [{ value, label, month }] }]
  const [fy, setFy] = useState("");
  const [month, setMonth] = useState("");                 // "2026-09"
  const [listing, setListing] = useState(null);           // { folder, where, files }
  const [sheet, setSheet] = useState(null);               // { name, columns, rows, count, total_amount }
  const [tab, setTab] = useState("excel");
  const [filter, setFilter] = useState("");
  const [viewing, setViewing] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    api.get("/clinic-billing/files/months")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setYears(list);
        if (list.length) { setFy(list[0].fy); setMonth(list[0].months[0]?.value || ""); }
      })
      .catch((err) => { setYears([]); setError(errorText(err, "The months could not be loaded. Please try again.")); });
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    let cancelled = false;
    setLoading(true); setListing(null); setSheet(null); setError(""); setSheetError(""); setFilter("");
    (async () => {
      try {
        const res = await api.get("/clinic-billing/files", { params: { month } });
        if (cancelled) return;
        setListing(res.data);
        const excel = (res.data.files || []).find((f) => f.kind === "Excel");
        if (excel) {
          try {
            const sh = await api.get("/clinic-billing/files/sheet", { params: { key: excel.key } });
            if (!cancelled) setSheet(sh.data);
          } catch (err) {
            if (!cancelled) setSheetError(errorText(err, "The Excel sheet could not be shown. Please try again."));
          }
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err, "The files of this month could not be listed. Please try again."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month]);

  const pdfs = (listing?.files || []).filter((f) => f.kind === "Pdf")
    .sort((a, b) => (Number(a.name.match(/\.(\d+)\.pdf$/i)?.[1]) || 0) - (Number(b.name.match(/\.(\d+)\.pdf$/i)?.[1]) || 0) || a.name.localeCompare(b.name));
  const excel = (listing?.files || []).find((f) => f.kind === "Excel");
  const shown = filter.trim() ? pdfs.filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase())) : pdfs;
  const yearMonths = (years || []).find((y) => y.fy === fy)?.months || [];
  const monthLabel = yearMonths.find((m) => m.value === month)?.label || "";

  const download = async (f) => {
    if (busyKey) return;
    setBusyKey(f.key);
    try {
      const res = await api.get("/clinic-billing/files/download", { params: { key: f.key }, responseType: "blob" });
      saveBlob(res.data, f.name);
    } catch (err) {
      setError(await blobErrorText(err, "This file could not be downloaded. Please try again."));
    } finally {
      setBusyKey("");
    }
  };

  // A row of the Excel sheet opens that receipt's PDF (matched by receipt number).
  const openReceiptNo = (no) => {
    const tail = `.${String(no).padStart(4, "0")}.pdf`;
    const at = pdfs.findIndex((f) => f.name.endsWith(tail));
    if (at >= 0) { setFilter(""); setViewing(at); }
  };
  const col = sheet ? Object.fromEntries(sheet.columns.map((c, i) => [c, i])) : {};

  return (
    <div className="br-card">
      <div className="br-head">
        <div>
          <h2>📁 Receipt Files</h2>
          <p>{listing?.folder || "receipts / Financial year / month — Excel sheet and receipt PDFs"}</p>
        </div>
        <button type="button" className="br-btn br-btn-ghost" onClick={onBack}>← Back to Payments</button>
      </div>
      <div className="br-body">
        {years === null ? (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Loading…</div>
        ) : years.length === 0 ? (
          error ? <div className="br-note br-note-bad" role="alert"><span>⚠️ {error}</span></div>
                : <div className="br-note br-note-info" role="note"><span>No receipts yet — the folders appear with the first receipt.</span></div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label className="br-label" htmlFor="br-fy">Financial year</label>
                <select id="br-fy" className="br-input" style={{ width: "auto", minWidth: 210 }} value={fy}
                  onChange={(e) => { const y = years.find((x) => x.fy === e.target.value); setFy(e.target.value); setMonth(y?.months[0]?.value || ""); }}>
                  {years.map((y) => <option key={y.fy} value={y.fy}>{y.label}</option>)}
                </select>
              </div>
              <div role="group" aria-label="Month" className="br-chips" style={{ paddingBottom: 4 }}>
                {yearMonths.map((m) => (
                  <button key={m.value} type="button" className="br-chip" aria-pressed={m.value === month} onClick={() => setMonth(m.value)}>{m.label}</button>
                ))}
              </div>
            </div>

            {error && <div className="br-note br-note-bad" role="alert" style={{ marginTop: 14 }}><span>⚠️ {error}</span></div>}

            <div className="br-tabs" role="tablist" aria-label="Files">
              <button type="button" role="tab" className="br-tab" aria-selected={tab === "excel"} onClick={() => setTab("excel")}>
                📊 Excel sheet{excel ? ` — ${excel.name}` : ""}
              </button>
              <button type="button" role="tab" className="br-tab" aria-selected={tab === "pdf"} onClick={() => setTab("pdf")}>
                📄 Receipt PDFs ({pdfs.length})
              </button>
            </div>

            {loading ? (
              <div style={{ fontSize: 13, color: "#94a3b8" }}>Loading {monthLabel}…</div>
            ) : tab === "excel" ? (
              !excel ? (
                <div className="br-note br-note-info" role="note"><span>No Excel sheet is saved for {monthLabel} yet. Use “💾 Save files again” in 📊 Excel &amp; files to make it.</span></div>
              ) : sheetError ? (
                <div className="br-note br-note-bad" role="alert"><span>⚠️ {sheetError}</span></div>
              ) : !sheet ? (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>Opening the sheet…</div>
              ) : (
                <div data-testid="sheet-view">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                    <div style={{ fontSize: 14 }}>
                      <strong>{sheet.count}</strong> receipt{sheet.count !== 1 ? "s" : ""} · Total <strong>₹{money(sheet.total_amount)}</strong>
                      <span style={{ color: "#64748b", fontSize: 12.5 }}> — click a row to open its PDF</span>
                    </div>
                    <button type="button" className="br-btn br-btn-sm br-btn-main" disabled={busyKey === excel.key} onClick={() => download(excel)}>⬇ Download {excel.name}</button>
                  </div>
                  <div className="br-table-wrap">
                    <table className="br-sheet" aria-label={`Excel sheet ${excel.name}`}>
                      <thead><tr>{sheet.columns.map((c) => <th key={c}>{SHEET_HEADINGS[c] || c}</th>)}</tr></thead>
                      <tbody>
                        {sheet.rows.length === 0 ? (
                          <tr><td colSpan={sheet.columns.length} style={{ color: "#64748b" }}>No receipts in this month.</td></tr>
                        ) : sheet.rows.map((r, i) => (
                          <tr key={i} onClick={() => col.receipt_no !== undefined && openReceiptNo(r[col.receipt_no])} title="Open this receipt's PDF">
                            {r.map((v, j) => (
                              <td key={j} style={{
                                whiteSpace: sheet.columns[j] === "treatment_summary" ? "pre-wrap" : "nowrap",
                                textAlign: sheet.columns[j] === "amount_paid" ? "right" : "left",
                              }}>{sheet.columns[j] === "amount_paid" && v !== "" ? money(v) : String(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {sheet.rows.length > 0 && col.amount_paid !== undefined && (
                        <tfoot><tr>
                          {sheet.columns.map((c, j) => (
                            <td key={c} style={{ textAlign: c === "amount_paid" ? "right" : "left" }}>
                              {j === 0 ? "Total" : c === "amount_paid" ? money(sheet.total_amount) : ""}
                            </td>
                          ))}
                        </tr></tfoot>
                      )}
                    </table>
                  </div>
                </div>
              )
            ) : (
              <div data-testid="pdf-list">
                {pdfs.length === 0 ? (
                  <div className="br-note br-note-info" role="note"><span>No receipt PDFs are saved for {monthLabel} yet. Use “💾 Save files again” (tick “also make every receipt's PDF again”) in 📊 Excel &amp; files.</span></div>
                ) : (
                  <>
                    <input className="br-input" style={{ maxWidth: 360, marginBottom: 10 }} value={filter} onChange={(e) => setFilter(e.target.value)}
                      placeholder="Find by name or receipt number…" aria-label="Find a receipt PDF" />
                    {shown.map((f) => (
                      <div className="br-pdf-row" key={f.key}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>📄 {f.name}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{fmtSize(f.size)} · saved {f.modified}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="br-btn br-btn-sm br-btn-view" onClick={() => setViewing(pdfs.indexOf(f))} aria-label={`View ${f.name}`}>👁 View</button>
                          <button type="button" className="br-btn br-btn-sm br-btn-plain" disabled={busyKey === f.key} onClick={() => download(f)} aria-label={`Download ${f.name}`}>⬇</button>
                        </div>
                      </div>
                    ))}
                    {shown.length === 0 && <div style={{ fontSize: 13, color: "#64748b" }}>No PDF matches “{filter}”.</div>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {viewing >= 0 && pdfs[viewing] && (
        <PdfViewer files={pdfs} index={viewing} onIndex={setViewing} onClose={() => setViewing(-1)} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   The section
══════════════════════════════════════════════════════════════════ */
export default function BillingReceipts({ onBack, initialView = "payments", highlightVisitId = null, onChanged }) {
  // { mode: "list" } | { mode: "instructions" } | { mode: "files" } | { mode: "add", visit, from } | { mode: "edit", receipt, back }
  // | { mode: "view", receipt, message, files, back } | { mode: "choose" }
  // | { mode: "account", patientId, visit, editReceipt, message, from }      (back: the account to return to, if any)
  const [screen, setScreen] = useState(initialView === "instructions" ? { mode: "instructions" } : { mode: "list" });
  const [flash, setFlash] = useState(null);                // { ok, text } shown above the list
  const [listVersion, setListVersion] = useState(0);       // bumped to make the list load afresh
  const [pending, setPending] = useState(0);               // visits waiting for billing

  const refreshPending = () => {
    api.get("/visits/closed", { params: { status: "pending" } })
      .then((res) => setPending(Array.isArray(res.data) ? res.data.length : 0))
      .catch(() => {});                                    // only a convenience — never an error for it
  };
  const changed = () => { refreshPending(); if (onChanged) onChanged(); };
  useEffect(() => {
    refreshPending();
    const timer = setInterval(refreshPending, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (screen.mode === "list") refreshPending(); }, [screen.mode]);

  const toList = () => setScreen({ mode: "list" });

  // The patient's account; "back" remembers it so View / Edit return there.
  const openAccount = (patientId, extra = {}) => { setFlash(null); setScreen({ mode: "account", patientId, from: "list", ...extra }); };
  const accountBack = (acc) => (acc ? { mode: "account", patientId: acc.patientId, visit: acc.visit, from: acc.from } : null);
  const backFrom = (back) => setScreen(back || { mode: "list" });

  // When the screen changes, bring its top into view, so a form opened from
  // far down a long page is not left off-screen.
  const wrapRef = useRef(null);
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) { firstScreen.current = false; return; }
    const el = wrapRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [screen.mode, screen.receipt?.id]);

  const openReceipt = async (receipt, then, back = null) => {
    // Always work on the saved copy, never on a row that may be out of date.
    try {
      const res = await api.get(`/clinic-billing/receipts/${receipt.id}`);
      if (then === "edit" && res.data.has_allocations && res.data.patient_id) {
        // paid towards treatments in the patient's account: changed there
        setScreen({ mode: "account", patientId: res.data.patient_id, editReceipt: res.data, from: back ? back.from : "list", visit: back?.visit || null });
        return;
      }
      setScreen({ mode: then, receipt: res.data, back });
    } catch (err) {
      setFlash({ ok: false, text: errorText(err, "This receipt could not be opened. Please try again.") });
      setScreen({ mode: "list" });
      setListVersion((v) => v + 1);          // e.g. it was deleted meanwhile: show the list as it is now
    }
  };

  return (
    <div className="br-wrap rdb-fade rdb-fade-1" ref={wrapRef}>
      <BillingStyles />
      {screen.mode === "list" && (
        <ReceiptList
          key={listVersion}
          onBack={onBack}
          onAdd={() => { setFlash(null); setScreen({ mode: "choose" }); }}
          onAccount={(pid) => openAccount(pid)}
          onView={(r) => openReceipt(r, "view")}
          onEdit={(r) => openReceipt(r, "edit")}
          onChanged={changed}
          flash={flash}
          clearFlash={() => setFlash(null)}
          pending={pending}
          onInstructions={() => { setFlash(null); setScreen({ mode: "instructions" }); }}
          onFiles={() => { setFlash(null); setScreen({ mode: "files" }); }}
          onDeletedLog={() => { setFlash(null); setScreen({ mode: "deleted" }); }}
        />
      )}
      {screen.mode === "files" && <ReceiptFiles onBack={toList} />}
      {screen.mode === "deleted" && <DeletedReceipts onBack={toList} />}
      {screen.mode === "instructions" && (
        <DoctorInstructions
          onBack={toList}
          highlightVisitId={highlightVisitId}
          onChanged={changed}
          onMakeReceipt={(visit) => (visit?.patient_id
            ? setScreen({ mode: "account", patientId: visit.patient_id, visit, from: "instructions" })
            : setScreen({ mode: "add", visit, from: "instructions" }))}
        />
      )}
      {screen.mode === "choose" && (
        <ChoosePatient
          onBack={toList}
          onPick={(p) => openAccount(p.patient_id)}
          onWalkIn={() => setScreen({ mode: "add", visit: null })}
        />
      )}
      {screen.mode === "account" && (
        <PatientAccount
          key={`acc-${screen.patientId}-${screen.editReceipt?.id || ""}-${screen.stamp || ""}`}
          patientId={screen.patientId}
          visit={screen.visit || null}
          editReceipt={screen.editReceipt || null}
          message={screen.message || ""}
          backLabel={screen.from === "instructions" ? "← Doctor's Instructions" : "← Back to Payments"}
          onBack={() => setScreen(screen.from === "instructions" ? { mode: "instructions" } : { mode: "list" })}
          onChanged={changed}
          onViewReceipt={(r) => openReceipt(r, "view", accountBack(screen))}
          onEditSimple={(r) => openReceipt(r, "edit", accountBack(screen))}
          onReceiptSaved={(saved, editing) => {
            changed();
            setScreen({ mode: "view", receipt: saved, files: saved.files, back: accountBack(screen),
              message: editing ? `Payment #${saved.receipt_no} updated.` : `Saved receipt #${saved.receipt_no} — ₹${money(saved.amount_paid)} received.` });
          }}
        />
      )}
      {screen.mode === "add" && (
        <ReceiptForm
          key={`add-${screen.visit?.visit_id || "plain"}`}
          visit={screen.visit}
          onCancel={() => setScreen(screen.from === "instructions" ? { mode: "instructions" } : { mode: "list" })}
          onSaved={(saved) => {
            changed();
            setScreen({ mode: "view", receipt: saved, message: `Saved receipt #${saved.receipt_no}`, files: saved.files });
          }}
        />
      )}
      {screen.mode === "edit" && (
        <ReceiptForm
          key={`edit-${screen.receipt.id}`}
          receipt={screen.receipt}
          onCancel={() => backFrom(screen.back)}
          onSaved={(saved) => setScreen({ mode: "view", receipt: saved, message: "Updated.", files: saved.files, back: screen.back })}
        />
      )}
      {screen.mode === "view" && (
        <ReceiptView
          receipt={screen.receipt}
          message={screen.message}
          files={screen.files}
          backLabel={screen.back ? "← Patient account" : "← Back to Payments"}
          onBack={() => (screen.back ? setScreen({ ...screen.back, stamp: Date.now() }) : toList())}
          onAccount={!screen.back && screen.receipt.patient_id ? () => openAccount(screen.receipt.patient_id) : null}
          onDeleted={(res, why) => {
            changed();
            const text = `Receipt #${screen.receipt.receipt_no} deleted. Reason: ${why}.${res.visit_back_to_pending ? " Its visit is back under Pending in Doctor's Instructions." : ""}`;
            if (screen.back) setScreen({ ...screen.back, message: text, stamp: Date.now() });
            else { setFlash({ ok: true, text }); setListVersion((v) => v + 1); setScreen({ mode: "list" }); }
          }}
          onEdit={() => (screen.receipt.has_allocations && screen.receipt.patient_id
            ? setScreen({ mode: "account", patientId: screen.receipt.patient_id, editReceipt: screen.receipt, from: screen.back?.from || "list", visit: screen.back?.visit || null })
            : setScreen({ mode: "edit", receipt: screen.receipt, back: screen.back }))}
        />
      )}
    </div>
  );
}