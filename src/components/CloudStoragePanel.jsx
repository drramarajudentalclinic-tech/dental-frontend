import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/* ═══════════════════════════════════════════════════════════════════
   ☁️ CLOUD STORAGE (Cloudflare R2) — Doctor only
   • where new X-rays, photos, CBCT scans, receipts and Excel sheets go
   • Check connection  (saves, reads back and removes a tiny test file)
   • Move older pictures & CBCT scans to the cloud (checked byte for byte;
     the old copy is freed only after that)
   • Save receipts & Excel sheets to the cloud (made again from the database)
   No key is ever shown here — keys live only in Render.
   ═══════════════════════════════════════════════════════════════════ */

const errText = (e, fallback) => e?.response?.data?.error || e?.response?.data?.message || fallback;
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const p2 = (n) => String(n).padStart(2, "0");

const S = {
  back: { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" },
  card: { background: "#fff", borderRadius: 14, width: "100%", maxWidth: 620, boxShadow: "0 20px 50px rgba(0,0,0,.25)", fontFamily: "inherit" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" },
  title: { fontSize: 17, fontWeight: 700, color: "#0f172a" },
  body: { padding: "16px 20px", display: "grid", gap: 14 },
  box: { border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px" },
  h: { fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".03em" },
  row: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, padding: "3px 0", color: "#0f172a" },
  quiet: { fontSize: 13, color: "#64748b", lineHeight: 1.45 },
  btn: { padding: "9px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 },
  main: { padding: "9px 14px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 },
  ok: { background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 },
  bad: { background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 },
  warn: { background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 },
  x: { border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: "#64748b" },
};

function Line({ label, value }) {
  return <div style={S.row}><span>{label}</span><b>{value}</b></div>;
}

export default function CloudStoragePanel({ onClose }) {
  const [pics, setPics] = useState(null);
  const [scans, setScans] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [cors, setCors] = useState(null);       // true / false once checked
  const [moveMsg, setMoveMsg] = useState("");
  const [files, setFiles] = useState({ busy: false, text: "", problems: [] });
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api.get("/images/storage/status"),
        api.get("/cbct/storage/status").catch(() => ({ data: null })),
      ]);
      setPics(a.data); setScans(b.data); setLoadErr("");
      return (a.data?.move?.running) || (b.data?.move?.running);
    } catch (e) {
      setLoadErr(errText(e, "The storage status could not be loaded."));
      return false;
    }
  }, []);

  const poll = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { if (await load()) poll(); }, 2000);
  }, [load]);

  useEffect(() => { load().then((running) => { if (running) poll(); }); return () => clearTimeout(timer.current); }, [load, poll]);

  const runCheck = async () => {
    setChecking(true); setCheck(null); setCors(null);
    try {
      const c = (await api.get("/images/storage/check")).data;
      setCheck(c);
      if (c.ok) {
        // can this website read straight from the bucket? (the bucket's CORS rule — needed for CBCT)
        let readable = false;
        try {
          const b = (await api.get("/images/storage/browser-check")).data;
          if (b?.url) readable = (await (await fetch(b.url)).text()).trim() === "ok";
        } catch { readable = false; }
        setCors(readable);
      }
    }
    catch (e) { setCheck({ ok: false, error: errText(e, "The check could not run.") }); }
    finally { setChecking(false); }
  };

  const move = async () => {
    setMoveMsg("");
    const out = [];
    try { await api.post("/images/storage/move-to-cloud", {}); out.push("pictures"); }
    catch (e) { setMoveMsg(errText(e, "The pictures could not be moved.")); return; }
    try { await api.post("/cbct/storage/move-to-cloud", {}); out.push("CBCT scans"); }
    catch (e) { if (e?.response?.status !== 404) setMoveMsg(errText(e, "The CBCT scans could not be moved.")); }
    if (out.length) setMoveMsg(`Moving ${out.join(" and ")} in the background — you can keep working.`);
    await load(); poll();
  };

  const saveFiles = async () => {
    setFiles({ busy: true, text: "Finding the months that have receipts…", problems: [] });
    const problems = [];
    let pdfs = 0, sheets = 0;
    try {
      const years = (await api.get("/clinic-billing/files/months")).data || [];
      const months = years.flatMap((y) => y.months.map((m) => m.value)).sort();
      for (let i = 0; i < months.length; i += 1) {
        const [y, m] = months[i].split("-").map(Number);
        setFiles({ busy: true, text: `Receipts: month ${i + 1} of ${months.length} (${months[i]})…`, problems });
        try {
          const r = (await api.post("/clinic-billing/files/regenerate", {
            date_from: `${y}-${p2(m)}-01`, date_to: `${y}-${p2(m)}-${p2(lastDay(y, m))}`, include_pdfs: true,
          })).data;
          pdfs += r.pdf_count || 0; sheets += r.excel_count || 0;
          (r.problems || []).forEach((p) => problems.push(p));
        } catch (e) { problems.push(`${months[i]}: ${errText(e, "could not be saved")}`); }
      }
      let expYears = [];
      try { expYears = (await api.get("/other-expenses/files/months")).data?.years || []; } catch { expYears = []; }
      for (let i = 0; i < expYears.length; i += 1) {
        setFiles({ busy: true, text: `Other expenses: year ${i + 1} of ${expYears.length}…`, problems });
        try {
          const r = (await api.post("/other-expenses/files/regenerate", { fy: expYears[i].fy })).data;
          sheets += r.months || 0;
          (r.problems || []).forEach((p) => problems.push(p));
        } catch (e) { problems.push(`Expenses ${expYears[i].fy}: ${errText(e, "could not be saved")}`); }
      }
      setFiles({ busy: false, text: `Done: ${pdfs} receipt PDF${pdfs === 1 ? "" : "s"} and ${sheets} Excel sheet${sheets === 1 ? "" : "s"} saved.`, problems });
    } catch (e) {
      setFiles({ busy: false, text: "", problems: [errText(e, "The receipt months could not be loaded.")] });
    }
  };

  const cloud = pics?.cloud || {};
  const on = !!cloud.switched_on;
  const pm = pics?.move || {};
  const cm = scans?.move || {};
  const moving = pm.running || cm.running;
  const leftPics = pics ? (pics.in_local_folder || 0) : 0;
  const leftScans = scans ? (scans.in_database || 0) : 0;

  return createPortal(
    <div style={S.back} onClick={onClose}>
      <div style={S.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cloud storage">
        <div style={S.head}>
          <div style={S.title}>☁️ Cloud storage</div>
          <button type="button" style={S.x} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={S.body}>
          {loadErr && <div style={S.bad}>{loadErr}</div>}

          <div style={S.box}>
            <div style={S.h}>Where new files go</div>
            {pics && (on
              ? <div style={S.ok}>Cloud — Cloudflare R2, bucket <b>{cloud.bucket}</b>{cloud.prefix ? ` / ${cloud.prefix}` : ""}. X-rays, photos, CBCT scans, receipts and Excel sheets are kept permanently, one folder per patient.</div>
              : <div style={S.warn}>The server disk — <b>not permanent</b>: files there are wiped when the app is updated. Add the R2 settings in Render (Environment) and set <b>IMAGE_STORAGE=s3</b>.</div>)}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" style={S.btn} onClick={runCheck} disabled={checking}>{checking ? "Checking…" : "🔌 Check connection"}</button>
              {check && <span style={{ fontSize: 13.5, color: check.ok ? "#065f46" : "#991b1b" }}>{check.ok ? `✅ ${check.message}` : `❌ ${check.error}`}</span>}
            </div>
            {cors === true && <div style={{ ...S.ok, marginTop: 8 }}>✅ The website can read files straight from the cloud (CBCT scans open from there).</div>}
            {cors === false && (
              <div style={{ ...S.warn, marginTop: 8 }}>
                ⚠️ The website cannot read files straight from the cloud yet, so CBCT scans load through the server (slower).
                In Cloudflare → R2 → the bucket → <b>Settings → CORS policy</b>, add the rule from the setup notes with this website's address.
              </div>
            )}
          </div>

          <div style={S.box}>
            <div style={S.h}>X-rays, photos and CBCT scans</div>
            {pics && <>
              <Line label="Pictures in the cloud" value={pics.in_object_storage} />
              <Line label="Pictures not in the cloud yet (or lost from the server disk)" value={leftPics} />
              <Line label="Pictures with an old copy inside the database" value={pics.still_holding_base64} />
            </>}
            {scans && <>
              <Line label="CBCT scans in the cloud" value={scans.in_cloud} />
              <Line label="CBCT scans inside the database" value={scans.in_database} />
            </>}
            {moving && (
              <div style={{ ...S.warn, marginTop: 8 }}>
                Moving… pictures {pm.done || 0} of {pm.total || 0}{cm.running || cm.total ? ` · scans ${cm.done || 0} of ${cm.total || 0}` : ""}
              </div>
            )}
            {!moving && (pm.finished_at || cm.total > 0) && (
              <div style={{ ...((pm.failed || cm.failed) ? S.warn : S.ok), marginTop: 8 }}>
                Last move: {pm.moved || 0} picture{pm.moved === 1 ? "" : "s"}{cm.total ? `, ${cm.moved || 0} scan${cm.moved === 1 ? "" : "s"}` : ""} moved
                {pm.missing ? ` · ${pm.missing} picture${pm.missing === 1 ? " was" : "s were"} already lost from the server disk (nothing to move)` : ""}
                {(pm.failed || cm.failed) ? ` · ${(pm.failed || 0) + (cm.failed || 0)} could not be moved — press the button again later` : ""}
                {(pm.last_problem || cm.last_problem) && <div style={{ marginTop: 4 }}>{pm.last_problem || cm.last_problem}</div>}
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" style={S.main} onClick={move} disabled={!on || moving || (!leftPics && !leftScans && !pics?.still_holding_base64)}>
                ☁️ Move older pictures &amp; scans to the cloud
              </button>
              {moveMsg && (moving || !/background/.test(moveMsg)) && <span style={{ fontSize: 13.5, color: "#334155" }}>{moveMsg}</span>}
            </div>
            <div style={{ ...S.quiet, marginTop: 6 }}>Each file is copied, read back and compared byte for byte before the old copy is removed. Safe to press again.</div>
          </div>

          <div style={S.box}>
            <div style={S.h}>Receipts and Excel sheets</div>
            <div style={S.quiet}>Receipt PDFs, the monthly receipt sheets and the Other Expenses sheets are made again from the database and saved where new files go (receipts / Financial year / month).</div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={S.main} onClick={saveFiles} disabled={!on || files.busy}>{files.busy ? "Saving…" : "🧾 Save all receipts & Excel to the cloud"}</button>
              {files.text && <span style={{ fontSize: 13.5, color: "#334155" }}>{files.text}</span>}
            </div>
            {files.problems.length > 0 && (
              <div style={{ ...S.bad, marginTop: 8 }}>
                {files.problems.slice(0, 5).map((p, i) => <div key={i}>{p}</div>)}
                {files.problems.length > 5 && <div>…and {files.problems.length - 5} more</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}