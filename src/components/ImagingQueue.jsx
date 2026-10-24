import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";
import PortalSharePanel from "./PortalSharePanel";
import ImageUpload from "./ImageUpload";

/* ═══════════════════════════════════════════════════════════════════
   🩻 X-RAYS & SCANS  (Doctor dashboard)
   X-rays, OPGs, intra-oral photos and CBCT scans are added AFTER the
   visit. Every closed visit waits here until the doctor either
     ✓ marks it uploaded  (at least one file is there), or
     ✕ says no images are needed  (nothing uploaded)
   — both take it off the queue, and both can be undone.
   Open → the full upload screen (X-rays & photos + CBCT volumes).
   Search also finds older visits that were never in the queue.
   ═══════════════════════════════════════════════════════════════════ */

const CHANGED = "clinic:imaging-changed";
export function announceImagingChanged() {
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* ignore */ }
}

const errText = (e, fallback) => e?.response?.data?.error || e?.response?.data?.message || fallback;

const KINDS = [
  ["IOPA", "IOPA"], ["OPG", "OPG"], ["INTRAORAL", "Photo"], ["CBCT", "CBCT pic"], ["scans", "CBCT scan"],
];
function fileChips(counts, empty = "None yet") {
  const parts = KINDS.filter(([k]) => (counts?.[k] || 0) > 0)
    .map(([k, label]) => `${counts[k]} ${label}${counts[k] > 1 ? "s" : ""}`);
  return parts.length ? parts : [empty];
}
function waitingLabel(d) {
  if (d === null || d === undefined) return "";
  if (d <= 0) return "Today";
  if (d === 1) return "1 day";
  return `${d} days`;
}

let stylesIn = false;
function injectStyles() {
  if (stylesIn || typeof document === "undefined") return;
  stylesIn = true;
  const el = document.createElement("style");
  el.setAttribute("data-imaging-queue", "1");
  el.textContent = `
  .iq-head-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .iq-tabs { display:flex; gap:6px; padding:12px 26px 0; flex-wrap:wrap; }
  .iq-tab { border:1.5px solid #dbe5f4; background:#fff; color:#475569; border-radius:999px; padding:6px 14px;
    font:600 12.5px 'Plus Jakarta Sans',sans-serif; cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
  .iq-tab.on { background:#0f2a50; color:#fff; border-color:#0f2a50; }
  .iq-tab b { background:#e0ecff; color:#1d4ed8; border-radius:999px; padding:0 8px; font-size:11px; }
  .iq-tab.on b { background:#1d4ed8; color:#fff; }
  .iq-sum { display:flex; gap:8px; flex-wrap:wrap; padding:10px 26px 0; }
  .iq-pill { font:600 11.5px 'Plus Jakarta Sans',sans-serif; border-radius:999px; padding:4px 10px; border:1px solid; }
  .iq-search { display:flex; align-items:center; gap:8px; border:1.5px solid #dbe5f4; border-radius:10px; padding:7px 11px; background:#f8fbff; }
  .iq-search input { border:none; outline:none; background:transparent; font:13px 'Plus Jakarta Sans',sans-serif; width:220px; color:#0f2a50; }
  .iq-list { padding:14px 26px 20px; display:grid; gap:10px; }
  .iq-row { display:grid; grid-template-columns:minmax(180px,1.3fr) minmax(170px,1.2fr) minmax(130px,.9fr) minmax(150px,1fr) auto;
    gap:14px; align-items:center; border:1px solid #e6eef9; border-radius:12px; padding:12px 14px; background:#fff; }
  .iq-row.overdue { border-color:#fecaca; background:#fffafa; }
  .iq-name { font:700 13.5px 'Plus Jakarta Sans',sans-serif; color:#0f2a50; overflow-wrap:anywhere; }
  .iq-sub { font-size:11.5px; color:#8494b0; margin-top:2px; overflow-wrap:anywhere; }
  .iq-treat { font-size:12.5px; color:#92400e; font-weight:600; overflow-wrap:anywhere; }
  .iq-chip { display:inline-block; font:600 11px 'Plus Jakarta Sans',sans-serif; border-radius:999px; padding:2px 9px; margin:2px 4px 2px 0; border:1px solid; white-space:nowrap; }
  .iq-actions { display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap; }
  .iq-btn { border:1.5px solid #c9daee; background:#eef4fb; color:#1d4d7a; border-radius:8px; padding:7px 12px;
    font:700 12px 'Plus Jakarta Sans',sans-serif; cursor:pointer; white-space:nowrap; }
  .iq-btn:disabled { opacity:.45; cursor:not-allowed; }
  .iq-btn.main { background:linear-gradient(135deg,#1d4d7a,#1d6fa4); color:#fff; border-color:transparent; }
  .iq-btn.ok { background:#ecfdf5; color:#047857; border-color:#a7f3d0; }
  .iq-btn.none { background:#fff; color:#64748b; border-color:#dbe3ee; }
  .iq-empty { text-align:center; color:#94a3b8; font-size:13px; padding:26px 10px; }
  .iq-note { margin:0 26px 10px; border-radius:10px; padding:9px 12px; font-size:13px; }
  .iq-more-h { font:700 11px 'Plus Jakarta Sans',sans-serif; color:#8494b0; letter-spacing:.6px; text-transform:uppercase; margin:6px 0 2px; }
  .iq-drawer-back { position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:1200; display:flex; justify-content:center; align-items:stretch; padding:16px; }
  .iq-drawer { background:#f6f9fd; width:100%; max-width:1100px; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.3); }
  .iq-drawer-hd { background:linear-gradient(120deg,#0f2a50,#1d4d7a); color:#fff; padding:14px 20px; display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .iq-drawer-body { flex:1; overflow:auto; padding:18px 20px; }
  .iq-drawer-ft { background:#fff; border-top:1px solid #e3ebf6; padding:12px 20px; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .iq-x { background:rgba(255,255,255,.14); color:#fff; border:none; border-radius:8px; width:34px; height:34px; font-size:18px; cursor:pointer; }
  .iq-dlg-back { position:fixed; inset:0; background:rgba(15,23,42,.45); z-index:1300; display:flex; align-items:center; justify-content:center; padding:16px; }
  .iq-dlg { background:#fff; border-radius:14px; width:100%; max-width:420px; padding:18px 20px; box-shadow:0 20px 50px rgba(0,0,0,.25); }
  .iq-dlg textarea { width:100%; box-sizing:border-box; border:1.5px solid #dbe5f4; border-radius:9px; padding:9px 10px; font:13px 'Plus Jakarta Sans',sans-serif; min-height:64px; margin-top:8px; }
  @media (max-width: 900px) {
    .iq-row { grid-template-columns:1fr 1fr; }
    .iq-actions { grid-column:1 / -1; justify-content:flex-start; }
  }
  @media (max-width: 560px) {
    .iq-row { grid-template-columns:1fr; }
    .iq-list, .iq-tabs, .iq-sum { padding-left:14px; padding-right:14px; }
    .iq-search input { width:100%; }
    .iq-drawer-back { padding:0; }
    .iq-drawer { border-radius:0; }
  }`;
  document.head.appendChild(el);
}

function StatusChip({ it }) {
  if (it.status === "uploaded") return <span className="iq-chip" style={{ background:"#ecfdf5", color:"#047857", borderColor:"#a7f3d0" }}>✓ Uploaded</span>;
  if (it.status === "none") return <span className="iq-chip" style={{ background:"#f1f5f9", color:"#475569", borderColor:"#dbe3ee" }}>No images needed</span>;
  if (it.status === "pending") return <span className="iq-chip" style={{ background:"#fff7ed", color:"#c2410c", borderColor:"#fed7aa" }}>Waiting</span>;
  return <span className="iq-chip" style={{ background:"#f8fafc", color:"#64748b", borderColor:"#e2e8f0" }}>Not in the queue</span>;
}

/* ── "No images needed" — ask once, with an optional reason ── */
function NoneDialog({ it, busy, onCancel, onConfirm }) {
  const [note, setNote] = useState("");
  return createPortal(
    <div className="iq-dlg-back" onClick={onCancel}>
      <div className="iq-dlg" role="dialog" aria-label="No images needed" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight:800, fontSize:15, color:"#0f2a50" }}>No images needed?</div>
        <div style={{ fontSize:13, color:"#475569", marginTop:6 }}>
          <b>{it.patient_name}</b> · visit {it.visit_date} — this takes the visit off the X-rays &amp; Scans list. You can bring it back later.
        </div>
        <textarea placeholder="Reason (optional) — e.g. not needed for scaling, patient brought OPG report"
          value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:12 }}>
          <button type="button" className="iq-btn none" onClick={onCancel}>Cancel</button>
          <button type="button" className="iq-btn main" disabled={busy} onClick={() => onConfirm(note)}>{busy ? "Saving…" : "Yes, no images needed"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── The upload screen for one visit ── */
function ImagingDrawer({ start, onClose, onDone }) {
  const [it, setIt] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [askNone, setAskNone] = useState(false);
  const refresh = useCallback(async () => {
    try { setIt((await api.get(`/imaging/${start.visit_id}`)).data); } catch { /* keep what we have */ }
  }, [start.visit_id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e) => { if (e.key === "Escape" && !document.querySelector(".imgup-viewer, .iq-dlg")) onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [onClose]);

  const [shareOpen, setShareOpen] = useState(false);   // 🌐 patient portal
  const total = it?.counts?.total || 0;
  const set = async (status, note) => {
    setBusy(true); setErr("");
    try {
      const res = await api.post(`/imaging/${it.visit_id}/status`, note !== undefined ? { status, note } : { status });
      announceImagingChanged();
      onDone(res.data, status);
    } catch (e) {
      setErr(errText(e, "That could not be saved. Please try again."));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="iq-drawer-back">
      <div className="iq-drawer" role="dialog" aria-label={`X-rays and scans — ${it.patient_name}`}>
        <div className="iq-drawer-hd">
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:16 }}>🩻 {it.patient_name}</div>
            <div style={{ fontSize:12, opacity:.8, marginTop:2 }}>
              📁 {it.case_number} · Visit {it.visit_date}{it.treatment ? ` · ${it.treatment}` : ""}{it.doctor ? ` · ${it.doctor}` : ""}
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <StatusChip it={it} />
            <button type="button" className="iq-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="iq-drawer-body">
          <ImageUpload visitId={it.visit_id} onChange={refresh} />
        </div>
        <div className="iq-drawer-ft">
          <div style={{ fontSize:13, color:"#334155" }}>
            <b>{total}</b> file{total === 1 ? "" : "s"} for this visit{total ? ": " : ""}{total ? fileChips(it.counts).join(" · ") : ""}
            {err && <div role="alert" style={{ color:"#b91c1c", marginTop:4, fontWeight:600 }}>{err}</div>}
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {it.status === "pending" || !it.status ? (
              <>
                <button type="button" className="iq-btn none" disabled={busy || total > 0}
                  title={total > 0 ? "Files are uploaded — use Mark as uploaded" : "Nothing is needed for this visit"}
                  onClick={() => setAskNone(true)}>✕ No images needed</button>
                <button type="button" className="iq-btn ok" disabled={busy || total === 0}
                  title={total === 0 ? "Upload at least one picture or scan first" : "Take this visit off the list"}
                  onClick={() => set("uploaded")}>✓ Mark as uploaded</button>
              </>
            ) : (
              <button type="button" className="iq-btn" disabled={busy} onClick={() => set("pending")}>↩ Back to the waiting list</button>
            )}
            {it.patient_id && (
              <button type="button" className="iq-btn" onClick={() => setShareOpen(true)}
                title="Choose which X-rays, scans and records this patient can see in the patient portal">🌐 Share with patient</button>
            )}
            <button type="button" className="iq-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
      {shareOpen && <PortalSharePanel patientId={it.patient_id} onClose={() => setShareOpen(false)} />}
      {askNone && <NoneDialog it={it} busy={busy} onCancel={() => setAskNone(false)} onConfirm={(note) => set("none", note)} />}
    </div>,
    document.body,
  );
}

function Row({ it, busy, onOpen, onUploaded, onNone, onBack, onHistory }) {
  const total = it.counts?.total || 0;
  return (
    <div className={`iq-row${it.overdue ? " overdue" : ""}`} data-visit={it.visit_id}>
      <div>
        <div className="iq-name">{it.patient_name}</div>
        <div className="iq-sub">📁 {it.case_number}{it.age ? ` · ${it.age} y` : ""}{it.gender ? ` · ${it.gender}` : ""}</div>
      </div>
      <div>
        <div className="iq-treat">{it.treatment || "—"}</div>
        <div className="iq-sub">Visit {it.visit_date}{it.doctor ? ` · ${it.doctor}` : ""}</div>
      </div>
      <div>
        {it.status === "pending" ? (
          <>
            <span className="iq-chip" style={it.overdue
              ? { background:"#fef2f2", color:"#b91c1c", borderColor:"#fecaca" }
              : { background:"#fff7ed", color:"#c2410c", borderColor:"#fed7aa" }}>
              ⏳ {waitingLabel(it.waiting_days)}
            </span>
            <div className="iq-sub">Closed {it.closed_at || it.queued_at || ""}</div>
          </>
        ) : (
          <>
            <StatusChip it={it} />
            <div className="iq-sub">{it.done_at ? `${it.done_at}${it.done_by ? ` · ${it.done_by}` : ""}` : it.closed_at ? `Closed ${it.closed_at}` : ""}</div>
            {it.note && <div className="iq-sub" style={{ fontStyle:"italic" }}>“{it.note}”</div>}
          </>
        )}
      </div>
      <div>
        {fileChips(it.counts).map((t) => (
          <span key={t} className="iq-chip" style={total
            ? { background:"#eff6ff", color:"#1d4ed8", borderColor:"#bfdbfe" }
            : { background:"#f8fafc", color:"#94a3b8", borderColor:"#e2e8f0" }}>{t}</span>
        ))}
      </div>
      <div className="iq-actions">
        <button type="button" className="iq-btn main" onClick={() => onOpen(it)}>Open</button>
        {it.status === "pending" && (
          <>
            <button type="button" className="iq-btn ok" disabled={busy || total === 0}
              title={total === 0 ? "Upload at least one picture or scan first" : "Take this visit off the list"}
              onClick={() => onUploaded(it)}>✓ Uploaded</button>
            <button type="button" className="iq-btn none" disabled={busy || total > 0}
              title={total > 0 ? "Files are uploaded — use ✓ Uploaded" : "Nothing is needed for this visit"}
              onClick={() => onNone(it)}>No images</button>
          </>
        )}
        {(it.status === "uploaded" || it.status === "none") && (
          <button type="button" className="iq-btn" disabled={busy} onClick={() => onBack(it)}>↩ Back to waiting</button>
        )}
        {onHistory && it.patient_id && (
          <button type="button" className="iq-btn none" onClick={() => onHistory(it.patient_id)} title="Complete history">📋</button>
        )}
      </div>
    </div>
  );
}

export default function ImagingQueue({ onSummary, onOpenHistory }) {
  useEffect(() => { injectStyles(); }, []);
  const [tab, setTab] = useState("pending");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ pending: 0, overdue: 0, done_today: 0 });
  const [q, setQ] = useState("");
  const [more, setMore] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [open, setOpen] = useState(null);
  const [askNone, setAskNone] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const n = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const params = { status: tab };
      if (q.trim()) params.q = q.trim();
      const res = await api.get("/imaging/queue", { params });
      if (n !== seq.current) return;
      setItems(res.data?.items || []);
      setSummary(res.data?.summary || { pending: 0, overdue: 0, done_today: 0 });
      setError("");
      if (q.trim().length >= 2) {
        const s = await api.get("/imaging/search", { params: { q: q.trim() } }).catch(() => ({ data: { items: [] } }));
        if (n !== seq.current) return;
        const shown = new Set((res.data?.items || []).map((x) => x.visit_id));
        setMore((s.data?.items || []).filter((x) => !shown.has(x.visit_id)));
      } else setMore([]);
    } catch (e) {
      if (n !== seq.current) return;
      setError(errText(e, "The X-rays & Scans list could not be loaded."));
    } finally { if (n === seq.current) setLoading(false); }
  }, [tab, q]);

  useEffect(() => { const t = setTimeout(() => load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden && !open) load(true); }, 30000);
    const again = () => load(true);
    window.addEventListener(CHANGED, again);
    return () => { clearInterval(t); window.removeEventListener(CHANGED, again); };
  }, [load, open]);
  useEffect(() => { if (onSummary) onSummary(summary); }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const setStatus = async (it, status, note) => {
    setBusyId(it.visit_id);
    try {
      await api.post(`/imaging/${it.visit_id}/status`, note !== undefined ? { status, note } : { status });
      setNotice(status === "uploaded" ? `✓ ${it.patient_name}: marked as uploaded.`
        : status === "none" ? `${it.patient_name}: no images needed.` : `${it.patient_name}: back on the waiting list.`);
      await load(true);
    } catch (e) {
      setNotice(errText(e, "That could not be saved. Please try again."));
    } finally { setBusyId(null); setAskNone(null); }
  };

  const doneOverdue = useMemo(() => items.filter((x) => x.overdue).length, [items]);

  return (
    <div className="dd-card" id="imaging-queue">
      <div className="dd-card-header" style={{ flexWrap:"wrap", gap:10 }}>
        <div className="dd-card-title">🩻 X-rays &amp; Scans — upload after the visit</div>
        <div className="iq-head-right">
          <label className="iq-search">
            <span aria-hidden>🔍</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient — older visits too" aria-label="Search X-rays and scans" />
          </label>
          <button type="button" className="dd-refresh-btn" onClick={() => load()}>↻ Refresh</button>
        </div>
      </div>

      <div className="iq-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "pending"} className={`iq-tab${tab === "pending" ? " on" : ""}`} onClick={() => setTab("pending")}>
          Waiting for upload <b>{summary.pending}</b>
        </button>
        <button type="button" role="tab" aria-selected={tab === "done"} className={`iq-tab${tab === "done" ? " on" : ""}`} onClick={() => setTab("done")}>
          Done
        </button>
      </div>
      <div className="iq-sum">
        {summary.overdue > 0 && <span className="iq-pill" style={{ background:"#fef2f2", color:"#b91c1c", borderColor:"#fecaca" }}>⚠️ {summary.overdue} waiting 2+ days</span>}
        <span className="iq-pill" style={{ background:"#ecfdf5", color:"#047857", borderColor:"#a7f3d0" }}>✓ {summary.done_today} done today</span>
        <span className="iq-pill" style={{ background:"#f8fafc", color:"#64748b", borderColor:"#e2e8f0" }}>Every closed visit comes here. Open → upload X-rays, OPG, photos or CBCT → ✓ Uploaded. Nothing needed → No images.</span>
      </div>

      {notice && <div className="iq-note" role="status" style={{ background:"#eff6ff", color:"#1e40af", border:"1px solid #bfdbfe" }}>{notice}</div>}
      {error && <div className="iq-note" role="alert" style={{ background:"#fef2f2", color:"#b91c1c", border:"1px solid #fecaca" }}>{error}</div>}

      <div className="iq-list">
        {loading && items.length === 0 ? <div className="iq-empty">Loading…</div>
          : items.length === 0 ? (
            <div className="iq-empty">
              {q ? "No visit in this list matches the search."
                : tab === "pending" ? "🎉 Nothing waiting — every closed visit has its X-rays & scans sorted."
                : "Nothing marked yet."}
            </div>
          ) : items.map((it) => (
            <Row key={it.visit_id} it={it} busy={busyId === it.visit_id}
              onOpen={setOpen} onUploaded={(x) => setStatus(x, "uploaded")} onNone={setAskNone}
              onBack={(x) => setStatus(x, "pending")} onHistory={onOpenHistory} />
          ))}
        {more.length > 0 && (
          <>
            <div className="iq-more-h">Other visits of matching patients</div>
            {more.map((it) => (
              <Row key={`m${it.visit_id}`} it={it} busy={busyId === it.visit_id}
                onOpen={setOpen} onUploaded={(x) => setStatus(x, "uploaded")} onNone={setAskNone}
                onBack={(x) => setStatus(x, "pending")} onHistory={onOpenHistory} />
            ))}
          </>
        )}
        {tab === "pending" && items.length > 1 && (
          <div className="iq-sub" style={{ textAlign:"right" }}>Oldest first{doneOverdue ? " · red = waiting 2+ days" : ""}</div>
        )}
      </div>

      {open && (
        <ImagingDrawer start={open} onClose={() => { setOpen(null); load(true); }}
          onDone={(it, status) => {
            setOpen(null);
            setNotice(status === "uploaded" ? `✓ ${it.patient_name}: marked as uploaded.`
              : status === "none" ? `${it.patient_name}: no images needed.` : `${it.patient_name}: back on the waiting list.`);
            load(true);
          }} />
      )}
      {askNone && <NoneDialog it={askNone} busy={busyId === askNone.visit_id} onCancel={() => setAskNone(null)} onConfirm={(note) => setStatus(askNone, "none", note)} />}
    </div>
  );
}