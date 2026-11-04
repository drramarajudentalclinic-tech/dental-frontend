/* ═══════════════════════════════════════════════════════════════════════
   SCAN BROWSER (like OnDemand's DBM) — every CBCT scan in the clinic with
   its patient: search, preview, open, compare (before / after) and export
   the original DICOM.
   ═══════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { authHeaders } from "./volume";

export default function ScanBrowser({ apiBase, currentId, onOpen, onCompare, onClose, onExport, mode = "browse" }) {
  const [q, setQ] = useState("");
  const [onlyPatient, setOnlyPatient] = useState(mode === "compare");
  const patientRef = useRef(null);                 // the patient of the scan that is open now
  const [currentPatient, setCurrentPatient] = useState(null);
  const [scans, setScans] = useState(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams();
        if (q.trim()) p.set("q", q.trim());
        const r = await fetch(`${apiBase}/cbct?${p}`, { headers: authHeaders() });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Server ${r.status}`);
        const me = (j.scans || []).find((x) => x.id === currentId);
        if (me && patientRef.current == null) { patientRef.current = me.patient || `d:${me.dicom_name}`; setCurrentPatient(patientRef.current); }
        if (alive) { setScans(j.scans || []); setErr(""); }
      } catch (e) { if (alive) setErr(e.message || "Could not load the scans."); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [apiBase, q, currentId]);

  const shown = useMemo(() => (scans || []).filter((s) => !onlyPatient || currentPatient == null || (s.patient || `d:${s.dicom_name}`) === currentPatient), [scans, onlyPatient, currentPatient]);
  const groups = useMemo(() => {
    const g = new Map();
    for (const s of shown) {
      const k = s.patient ? `p${s.patient}` : `d${s.dicom_name}`;
      if (!g.has(k)) g.set(k, { name: s.patient_display || "Unknown patient", case: s.case_number, items: [] });
      g.get(k).items.push(s);
    }
    return [...g.values()];
  }, [shown]);
  const sel = (scans || []).find((s) => s.id === pick) || null;
  const thumbN = sel ? Math.max(0, Math.floor((sel.dims?.[2] || 2) / 2)) : 0;

  const dicom = async (s) => {
    setBusy("Making the download link…");
    try {
      const r = await fetch(`${apiBase}/cbct/${s.id}/original`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || "The original DICOM is not kept for this scan.");
      const a = document.createElement("a"); a.href = j.url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };

  return (
    <div className="cv-modal" role="dialog" aria-label="Scan browser" onClick={onClose}>
      <div className="cv-modal-in cv-dbm" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-h">
          <b>{mode === "compare" ? "🔀 Choose the scan to compare with" : "📂 Scans"}</b>
          <input className="cv-in" style={{ maxWidth: 260 }} placeholder="Search name, case no., date…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {currentPatient != null && (
            <label className="cv-check"><input type="checkbox" checked={onlyPatient} onChange={(e) => setOnlyPatient(e.target.checked)} /> This patient only</label>
          )}
          <button type="button" className="cv-btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <div className="cv-dbm-body">
          <div className="cv-dbm-list">
            {err && <p className="cv-help" style={{ color: "#fca5a5", padding: 10 }}>{err}</p>}
            {!scans && !err && <p className="cv-help" style={{ padding: 10 }}>Loading…</p>}
            {scans && !shown.length && <p className="cv-help" style={{ padding: 10 }}>No scans found{onlyPatient ? " for this patient — untick “This patient only” to see all" : ""}.</p>}
            {groups.map((g, gi) => (
              <div key={gi} className="cv-dbm-g">
                <div className="cv-dbm-gh">{g.name}{g.case ? <small> · Case {g.case}</small> : null}<small> · {g.items.length} scan{g.items.length > 1 ? "s" : ""}</small></div>
                {g.items.map((s) => (
                  <button key={s.id} type="button" className={`cv-dbm-row ${pick === s.id ? "on" : ""} ${s.id === currentId ? "cur" : ""}`} onClick={() => setPick(s.id)} onDoubleClick={() => (mode === "compare" ? onCompare(s) : onOpen(s))}>
                    <span className="cv-dbm-id">#{s.id}</span>
                    <span className="cv-grow">
                      <b>{s.visit_date || s.uploaded_at || s.study_date}</b>
                      <small>{s.modality} · {s.dims?.join("×")} · {s.voxel ? `${Number(s.voxel).toFixed(2)} mm` : ""}{s.notes ? ` · ${s.notes}` : ""}</small>
                    </span>
                    {s.id === currentId && <span className="cv-dbm-tag">open now</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="cv-dbm-side">
            {!sel ? <p className="cv-help">Choose a scan to see its details.</p> : (
              <>
                <img className="cv-dbm-thumb" alt="" src={`${apiBase}/cbct/${sel.id}/slices/axial/${thumbN}`} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <div className="cv-dbm-facts">
                  <div><small>Patient</small><b>{sel.patient_display}</b></div>
                  {sel.case_number && <div><small>Case no.</small><b>{sel.case_number}</b></div>}
                  <div><small>Visit</small><b>{sel.visit_date || "—"}</b></div>
                  <div><small>Scan date (DICOM)</small><b>{sel.study_date || "—"}</b></div>
                  <div><small>Name in the DICOM</small><b>{sel.dicom_name || "—"}</b></div>
                  <div><small>Size</small><b>{sel.dims?.join(" × ")} · {sel.voxel ? `${Number(sel.voxel).toFixed(2)} mm` : ""}</b></div>
                  <div><small>Uploaded</small><b>{sel.uploaded_at}{sel.uploaded_by ? ` by ${sel.uploaded_by}` : ""}</b></div>
                </div>
                <div className="cv-row wrap">
                  {mode === "compare"
                    ? <button type="button" className="cv-btn primary" disabled={sel.id === currentId} onClick={() => onCompare(sel)}>🔀 Compare with this scan</button>
                    : <>
                        <button type="button" className="cv-btn primary" disabled={sel.id === currentId} onClick={() => onOpen(sel)}>Open</button>
                        {onCompare && <button type="button" className="cv-btn ghost" disabled={sel.id === currentId} onClick={() => onCompare(sel)}>🔀 Compare (before / after)</button>}
                      </>}
                  <button type="button" className="cv-btn ghost" disabled={!sel.cloud || !!busy} onClick={() => dicom(sel)} title={sel.cloud ? "Download the original DICOM (ZIP)" : "Only scans kept in cloud storage keep their original DICOM"}>🗂 Original DICOM</button>
                  {onExport && sel.id === currentId && <button type="button" className="cv-btn ghost" onClick={onExport} title="Save the open scan as a standard DICOM series (ZIP)">💾 DICOM series</button>}
                </div>
                {busy && <p className="cv-help">{busy}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const DBM_CSS = `
.cv-dbm{width:min(1040px,100%)}
.cv-dbm-body{display:grid;grid-template-columns:1fr 330px;min-height:420px}
.cv-dbm-list{border-right:1px solid #1e293b;overflow:auto;max-height:74vh;padding:6px}
.cv-dbm-g{margin-bottom:8px}
.cv-dbm-gh{font:700 13px system-ui;color:#e2e8f0;padding:6px 8px;border-bottom:1px solid #1e293b}
.cv-dbm-gh small{color:#64748b;font-weight:500}
.cv-dbm-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:1px solid transparent;background:none;color:#cbd5e1;padding:7px 8px;border-radius:8px;cursor:pointer}
.cv-dbm-row:hover{background:#111827}.cv-dbm-row.on{background:#1e3a8a;border-color:#3b82f6;color:#fff}
.cv-dbm-row b{display:block;font-size:13px}.cv-dbm-row small{display:block;font-size:11.5px;color:#94a3b8}
.cv-dbm-id{font:700 11px system-ui;color:#64748b;min-width:34px}
.cv-dbm-tag{font:700 10px system-ui;background:#14532d;color:#86efac;padding:2px 6px;border-radius:6px}
.cv-dbm-side{padding:10px;display:flex;flex-direction:column;gap:10px}
.cv-dbm-thumb{width:100%;aspect-ratio:1;object-fit:contain;background:#000;border-radius:8px}
.cv-dbm-facts{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cv-dbm-facts div{background:#020617;border-radius:8px;padding:6px 8px;display:flex;flex-direction:column}
.cv-dbm-facts small{font-size:10.5px;color:#64748b}.cv-dbm-facts b{font-size:12.5px;word-break:break-word}
.cv-root.phone .cv-dbm-body{grid-template-columns:1fr}
.cv-root.phone .cv-dbm-list{border-right:none;max-height:44vh}
`;