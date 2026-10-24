import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/* ═══════════════════════════════════════════════════════════════════
   🌐 PATIENT PORTAL — what this patient can see (Doctor only)
   Nothing is visible to the patient until it is shared here, and anything
   can be withdrawn again. Per visit: summary, each prescription, each
   picture, each CBCT scan; plus receipts. The portal itself is switched
   on per patient (the login is the patient's registered mobile number).
   ═══════════════════════════════════════════════════════════════════ */

const errText = (e, f) => e?.response?.data?.error || e?.response?.data?.message || f;
const key = (t, id) => `${t}:${id}`;

let stylesIn = false;
function injectStyles() {
  if (stylesIn || typeof document === "undefined") return;
  stylesIn = true;
  const el = document.createElement("style");
  el.textContent = `
  .psp-back { position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:1250; display:flex; justify-content:center; padding:16px; }
  .psp { background:#f6f9fd; width:100%; max-width:980px; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.3); font-family:'Plus Jakarta Sans',sans-serif; }
  .psp-hd { background:linear-gradient(120deg,#0b3b2e,#0f766e); color:#fff; padding:14px 20px; display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .psp-body { flex:1; overflow:auto; padding:16px 20px; display:grid; gap:12px; align-content:start; }
  .psp-ft { background:#fff; border-top:1px solid #e3ebf6; padding:12px 20px; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .psp-card { background:#fff; border:1px solid #e3ebf6; border-radius:12px; padding:12px 14px; }
  .psp-row { display:flex; align-items:center; gap:10px; padding:6px 0; border-top:1px dashed #edf2f9; flex-wrap:wrap; }
  .psp-row:first-of-type { border-top:none; }
  .psp-row label { display:flex; align-items:center; gap:8px; cursor:pointer; flex:1 1 260px; min-width:0; font-size:13px; color:#0f2a50; }
  .psp-row input[type=checkbox] { width:17px; height:17px; accent-color:#0f766e; flex-shrink:0; }
  .psp-tag { font:700 11px 'Plus Jakarta Sans',sans-serif; border-radius:999px; padding:2px 9px; border:1px solid; white-space:nowrap; }
  .psp-btn { border:1.5px solid #c9daee; background:#eef4fb; color:#1d4d7a; border-radius:8px; padding:8px 13px; font:700 12.5px 'Plus Jakarta Sans',sans-serif; cursor:pointer; white-space:nowrap; }
  .psp-btn:disabled { opacity:.45; cursor:not-allowed; }
  .psp-btn.go { background:linear-gradient(135deg,#0f766e,#14b8a6); color:#fff; border-color:transparent; }
  .psp-btn.warn { background:#fff; color:#b91c1c; border-color:#fecaca; }
  .psp-x { background:rgba(255,255,255,.15); color:#fff; border:none; border-radius:8px; width:34px; height:34px; font-size:18px; cursor:pointer; }
  .psp-switch { display:inline-flex; align-items:center; gap:8px; cursor:pointer; font:700 13px 'Plus Jakarta Sans',sans-serif; }
  .psp-switch input { width:38px; height:20px; accent-color:#14b8a6; }
  .psp-note { border-radius:10px; padding:9px 12px; font-size:12.5px; line-height:1.5; }
  .psp-vh { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:baseline; margin-bottom:4px; }
  .psp-vh b { color:#0f2a50; font-size:14px; }
  .psp-sub { font-size:11.5px; color:#8494b0; }
  .psp-link { background:none; border:none; color:#0f766e; font:700 12px 'Plus Jakarta Sans',sans-serif; cursor:pointer; padding:0; }
  .psp textarea { width:100%; box-sizing:border-box; border:1.5px solid #dbe5f4; border-radius:9px; padding:9px 10px; font:13px 'Plus Jakarta Sans',sans-serif; min-height:56px; }
  .psp-search { display:flex; gap:8px; }
  .psp-search input { flex:1; border:1.5px solid #dbe5f4; border-radius:9px; padding:10px 12px; font:14px 'Plus Jakarta Sans',sans-serif; }
  .psp-hit { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border:1px solid #e3ebf6; border-radius:10px; background:#fff; cursor:pointer; width:100%; text-align:left; font-family:inherit; }
  .psp-hit:hover { border-color:#14b8a6; }
  @media (max-width:560px) { .psp-back { padding:0; } .psp { border-radius:0; } .psp-body, .psp-ft, .psp-hd { padding-left:12px; padding-right:12px; } }
  `;
  document.head.appendChild(el);
}

function State({ it }) {
  if (!it.shared) return <span className="psp-tag" style={{ background:"#f8fafc", color:"#94a3b8", borderColor:"#e2e8f0" }}>Not shared</span>;
  return (
    <span className="psp-tag" style={{ background:"#ecfdf5", color:"#047857", borderColor:"#a7f3d0" }}>
      ✓ Shared{it.seen ? " · 👁 seen" : ""}
    </span>
  );
}

function Item({ t, it, label, sub, sel, toggle }) {
  return (
    <div className="psp-row">
      <label>
        <input type="checkbox" checked={sel.has(key(t, it.id))} onChange={() => toggle(t, it.id)} />
        <span style={{ minWidth:0 }}>
          <span style={{ fontWeight:600 }}>{label}</span>
          {sub && <span className="psp-sub"> · {sub}</span>}
        </span>
      </label>
      <State it={it} />
    </div>
  );
}

export default function PortalSharePanel({ patientId, onClose }) {
  useEffect(() => { injectStyles(); }, []);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sel, setSel] = useState(new Set());
  const [message, setMessage] = useState("");
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try { setD((await api.get(`/portal-admin/patients/${patientId}`)).data); setErr(""); }
    catch (e) { setErr(errText(e, "The patient's portal settings could not be loaded.")); }
  }, [patientId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    // capture phase + stop: Escape closes only this panel, not the screen behind it
    const k = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", k, true); };
  }, [onClose]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const all = useMemo(() => {
    const m = new Map();
    (d?.visits || []).forEach((v) => {
      m.set(key("visit_summary", v.visit_id), { t: "visit_summary", id: v.visit_id, ...v.summary });
      v.prescriptions.forEach((x) => m.set(key("prescription", x.id), { t: "prescription", ...x }));
      v.images.forEach((x) => m.set(key("image", x.id), { t: "image", ...x }));
      v.cbct.forEach((x) => m.set(key("cbct", x.id), { t: "cbct", ...x }));
    });
    (d?.receipts || []).forEach((x) => m.set(key("receipt", x.id), { t: "receipt", ...x }));
    return m;
  }, [d]);
  const toggle = (t, id) => setSel((s) => { const n = new Set(s); const k = key(t, id); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const visitKeys = (v) => [key("visit_summary", v.visit_id), ...v.prescriptions.map((x) => key("prescription", x.id)),
    ...v.images.map((x) => key("image", x.id)), ...v.cbct.map((x) => key("cbct", x.id))];
  const selectVisit = (v) => setSel((s) => { const n = new Set(s); const ks = visitKeys(v); const allOn = ks.every((k) => n.has(k)); ks.forEach((k) => (allOn ? n.delete(k) : n.add(k))); return n; });
  const chosen = [...sel].map((k) => all.get(k)).filter(Boolean);
  const toShare = chosen.filter((x) => !x.shared);
  const toWithdraw = chosen.filter((x) => x.shared);

  const post = async (path, body, okText) => {
    setBusy(true);
    try {
      setD((await api.post(`/portal-admin/patients/${patientId}/${path}`, body)).data);
      setNotice(okText); setSel(new Set()); setErr("");
    } catch (e) { setErr(errText(e, "That could not be saved. Please try again.")); }
    finally { setBusy(false); }
  };
  const share = () => post("share", { items: toShare.map((x) => ({ type: x.t, id: x.id })), message: message.trim() || undefined },
    `Shared ${toShare.length} item${toShare.length === 1 ? "" : "s"} with the patient.`);
  const withdraw = () => post("unshare", { items: toWithdraw.map((x) => ({ type: x.t, id: x.id })) },
    `Withdrew ${toWithdraw.length} item${toWithdraw.length === 1 ? "" : "s"} — the patient no longer sees ${toWithdraw.length === 1 ? "it" : "them"}.`);
  const setAccess = (ch, text) => post("access", ch, text);

  const p = d?.patient;
  const on = !!d?.access?.enabled;

  return createPortal(
    <div className="psp-back">
      <div className="psp" role="dialog" aria-label={`Patient portal — ${p?.name || ""}`}>
        <div className="psp-hd">
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:16 }}>🌐 Patient portal — {p?.name || "…"}</div>
            <div style={{ fontSize:12, opacity:.85, marginTop:2 }}>
              {p ? <>📁 {p.case_number} · 📱 login: {p.mobile || "no mobile"}</> : "Loading…"}
            </div>
          </div>
          <button type="button" className="psp-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="psp-body">
          {err && <div className="psp-note" role="alert" style={{ background:"#fef2f2", color:"#b91c1c", border:"1px solid #fecaca" }}>{err}</div>}
          {notice && <div className="psp-note" role="status" style={{ background:"#ecfdf5", color:"#047857", border:"1px solid #a7f3d0" }}>{notice}</div>}
          {d && (
            <>
              <div className="psp-card" style={{ display:"grid", gap:8 }}>
                <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"center", justifyContent:"space-between" }}>
                  <label className="psp-switch">
                    <input type="checkbox" checked={on} disabled={busy || (!on && !p.mobile_ok)}
                      onChange={(e) => setAccess({ enabled: e.target.checked }, e.target.checked ? "Portal switched on for this patient." : "Portal switched off — the patient can no longer log in to this record.")} />
                    {on ? "Portal ON — the patient can log in" : "Portal OFF"}
                  </label>
                  <label className="psp-switch" style={{ fontWeight:600 }}>
                    <input type="checkbox" checked={!!d.access.show_appointments} disabled={busy}
                      onChange={(e) => setAccess({ show_appointments: e.target.checked }, e.target.checked ? "Appointments are shown in the portal." : "Appointments are hidden in the portal.")} />
                    Show past &amp; upcoming appointments
                  </label>
                </div>
                {!p.mobile_ok && <div className="psp-note" style={{ background:"#fffbeb", color:"#92400e", border:"1px solid #fde68a" }}>The mobile number on file is not a valid 10-digit number — correct it in the patient's details before switching the portal on.</div>}
                {on && d.access.enabled_at && <div className="psp-sub">Switched on {d.access.enabled_at}{d.access.enabled_by ? ` by ${d.access.enabled_by}` : ""}. Login: mobile number + one-time SMS code.</div>}
                {d.family?.length > 0 && (
                  <div className="psp-sub">Same mobile number also used by: {d.family.map((f) => `${f.name} (#${f.case_number}) ${f.portal_on ? "— portal on" : "— portal off"}`).join(", ")}. Each person's portal is switched on separately.</div>
                )}
                {d.sms !== "http" && (
                  <div className="psp-note" style={{ background:"#eff6ff", color:"#1e40af", border:"1px solid #bfdbfe" }}>
                    {d.sms === "test" ? "SMS is in TEST mode: login codes are written to the server log, not sent to patients." : "SMS login is not switched on yet on the server — patients cannot log in until it is set up."}
                  </div>
                )}
              </div>

              <div className="psp-sub">Tick items, then <b>Share</b> (the patient will see them) or <b>Withdraw</b> (hide them again). Nothing is visible until shared.</div>

              {d.visits.length === 0 && <div className="psp-card psp-sub">No visits yet.</div>}
              {d.visits.map((v) => (
                <div key={v.visit_id} className="psp-card">
                  <div className="psp-vh">
                    <span><b>Visit {v.date}</b>{v.treatment ? <span className="psp-sub"> · {v.treatment}</span> : null}</span>
                    <button type="button" className="psp-link" onClick={() => selectVisit(v)}>Tick whole visit</button>
                  </div>
                  <Item t="visit_summary" it={{ id: v.visit_id, ...v.summary }} label="Visit summary" sub={[v.diagnosis, "complaint, diagnosis, treatment done, advice, next visit"].filter(Boolean).join(" · ")} sel={sel} toggle={toggle} />
                  {v.prescriptions.map((x) => <Item key={x.id} t="prescription" it={x} label={`💊 Prescription ${x.date || ""}`} sub={`${x.medicines} medicine${x.medicines === 1 ? "" : "s"}`} sel={sel} toggle={toggle} />)}
                  {v.images.map((x) => <Item key={x.id} t="image" it={x} label={`🩻 ${x.type === "INTRAORAL" ? "Intra-oral photo" : x.type}`} sub={[x.date, x.description].filter(Boolean).join(" · ")} sel={sel} toggle={toggle} />)}
                  {v.cbct.map((x) => <Item key={x.id} t="cbct" it={x} label="🔬 CBCT scan" sub={[x.date, x.slices ? `${x.slices} slices` : ""].filter(Boolean).join(" · ")} sel={sel} toggle={toggle} />)}
                </div>
              ))}

              {d.receipts.length > 0 && (
                <div className="psp-card">
                  <div className="psp-vh"><b>Receipts</b></div>
                  {d.receipts.map((x) => <Item key={x.id} t="receipt" it={x} label={`🧾 Receipt #${x.receipt_no}`} sub={`${x.date} · ₹${Number(x.amount || 0).toLocaleString("en-IN")}`} sel={sel} toggle={toggle} />)}
                </div>
              )}

              <div className="psp-card">
                <div className="psp-vh"><b>Message to the patient</b><span className="psp-sub">optional · shown with the visit summaries you share now</span></div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Your RCT is complete. Please come back in 7 days for the crown." />
              </div>

              <div className="psp-card">
                <button type="button" className="psp-link" onClick={() => setShowLog((x) => !x)}>{showLog ? "▾" : "▸"} Portal activity ({d.log.length})</button>
                {showLog && (d.log.length === 0 ? <div className="psp-sub" style={{ marginTop:6 }}>Nothing yet.</div> : (
                  <div style={{ marginTop:6, display:"grid", gap:3 }}>
                    {d.log.map((l, i) => <div key={i} className="psp-sub">{l.at} — {l.action.replace(/_/g, " ")}{l.detail ? ` (${l.detail})` : ""}</div>)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="psp-ft">
          <div className="psp-sub">{d ? `${d.shared_count} item${d.shared_count === 1 ? "" : "s"} shared with the patient${on ? "" : " (portal off — not visible now)"}` : ""}</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button type="button" className="psp-btn warn" disabled={busy || toWithdraw.length === 0} onClick={withdraw}>Withdraw ({toWithdraw.length})</button>
            <button type="button" className="psp-btn go" disabled={busy || toShare.length === 0} onClick={share}>{busy ? "Saving…" : `Share with patient (${toShare.length})`}</button>
            <button type="button" className="psp-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Dashboard entry: find a patient, then open their portal panel. */
export function PortalHub({ onClose }) {
  useEffect(() => { injectStyles(); }, []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState(null);
  const [overview, setOverview] = useState(null);
  useEffect(() => { api.get("/portal-admin/overview").then((r) => setOverview(r.data)).catch(() => {}); }, [pid]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return undefined; }
    const t = setTimeout(async () => {
      setBusy(true);
      try { setHits((await api.get("/patients/search", { params: { q: q.trim() } })).data || []); } catch { setHits([]); }
      finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  if (pid) return <PortalSharePanel patientId={pid} onClose={() => setPid(null)} />;
  return createPortal(
    <div className="psp-back">
      <div className="psp" role="dialog" aria-label="Patient portal" style={{ maxWidth:640, height:"fit-content", maxHeight:"92vh" }}>
        <div className="psp-hd">
          <div>
            <div style={{ fontWeight:800, fontSize:16 }}>🌐 Patient portal</div>
            <div style={{ fontSize:12, opacity:.85, marginTop:2 }}>Choose a patient, then decide what they can see.</div>
          </div>
          <button type="button" className="psp-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="psp-body">
          {overview && (
            <div className="psp-sub">
              {overview.patients_on} patient{overview.patients_on === 1 ? "" : "s"} with portal on · {overview.shared_7_days} item{overview.shared_7_days === 1 ? "" : "s"} shared in 7 days · {overview.logins_today} login{overview.logins_today === 1 ? "" : "s"} today
              {overview.sms !== "http" && <> · <b>{overview.sms === "test" ? "SMS test mode" : "SMS not set up"}</b></>}
            </div>
          )}
          <div className="psp-search">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient name, case no. or mobile" aria-label="Find patient" />
          </div>
          {busy && <div className="psp-sub">Searching…</div>}
          {hits.map((h) => (
            <button key={h.patient_id} type="button" className="psp-hit" onClick={() => setPid(h.patient_id)}>
              <span><b style={{ color:"#0f2a50" }}>{h.name}</b><span className="psp-sub"> · 📁 {h.case_number} · 📱 {h.mobile}</span></span>
              <span className="psp-tag" style={{ background:"#ecfeff", color:"#0f766e", borderColor:"#99f6e4" }}>Open ›</span>
            </button>
          ))}
          {!busy && q.trim().length >= 2 && hits.length === 0 && <div className="psp-sub">No patient found.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}