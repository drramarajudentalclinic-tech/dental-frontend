import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/*
  <PatientCompleteHistory />  — the patient's complete record, read-only
  ────────────────────────────────────────────────────────────────
  Used by Reception (Search → History) and by the Doctor (View Complete
  Treatment History). Everything about the patient, in one place, each
  thing shown ONCE:

    • Header      – name, case no, age, gender, mobile, blood group; allergy alert
    • Summary     – visits (first … last), treatments, prescriptions,
                    X-rays & photos, and the billing balance
    • Tabs
        🗓 Visits        – every visit, newest first: complaint, diagnosis,
                           treatment done, plan, advice, follow-up, doctor's
                           billing note, dental chart, findings, prescriptions,
                           X-rays & photos and the bills of that visit.
                           The same text saved on the visit, the consultation
                           and the prescription is shown only once.
        🦷 Treatments    – every treatment done, visit by visit, with the teeth,
                           diagnosis and doctor; the treatment plans
        🩻 X-rays & photos – all pictures of all visits, grouped (IOPA, OPG,
                           intra-oral …), opened in a viewer
        💊 Prescriptions – every prescription (a prescription saved twice is
                           shown once), with its medicines
        📅 Appointments  – upcoming and past appointments (Supabase, the same list
                           as the Appointments app; hidden when not connected)
        🧾 Bills         – treatments charged, discount, paid, balance; every
                           receipt (opens the PDF)
        📋 Medical       – demographics, medical history, allergies, habits,
                           women's history, current medicines, family doctor,
                           consent

  Data: GET /patients/<id>/complete-history   (patients.py)
        GET /patients/<id>/medical-history    (allergies; optional)
        GET /clinic-billing/patients/<id>/account   (bills; optional — the tab
            is hidden when billing is not installed)
  Pictures and receipt PDFs are loaded with the login (no plain links).

  Props (same as before):
    patientId     (number, required)
    onBack        (fn, required)
    onCreateVisit (fn, optional)  called with patientId when there is no active visit
    onOpenVisit   (fn, optional)  called with visitId when there is an active visit
    readOnlyLabel (string, optional)
*/

/* ── helpers ── */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
  if (!d) return "—";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(t) {
  if (!t) return "";
  const [h, mm] = String(t).split(":").map(Number);
  if (Number.isNaN(h)) return String(t);
  return `${((h + 11) % 12) + 1}:${String(mm || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (v) => String(v ?? "").trim();
const norm = (v) => clean(v).toLowerCase().replace(/[\s.,;:]+/g, " ").trim();
const formatLabel = (k) => String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** distinct non-empty texts (same text in different places shown once) */
function distinct(...values) {
  const seen = new Set();
  const out = [];
  values.flat().forEach((v) => {
    const t = clean(v);
    if (!t) return;
    const k = norm(t);
    if ([...seen].some((s) => s === k || s.includes(k))) return;      // already said (or said in a longer note)
    // a longer note that contains an earlier one replaces it
    for (let i = out.length - 1; i >= 0; i--) if (k.includes(norm(out[i]))) { seen.delete(norm(out[i])); out.splice(i, 1); }
    seen.add(k);
    out.push(t);
  });
  return out;
}

function parseMeds(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw || "[]"); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m && typeof m === "object" && clean(m.name));
}
const medDays = (m) => (m.days && Number(m.days) > 0 ? `${m.days} day${Number(m.days) !== 1 ? "s" : ""}` : "");

const IMAGE_GROUPS = [
  { key: "IOPA", short: "IOPA", label: "IOPA X-rays", match: (t) => /iopa|x-?ray|rvg/.test(t) },
  { key: "OPG", short: "OPG", label: "OPGs", match: (t) => /opg|panoram/.test(t) },
  { key: "INTRAORAL", short: "Intra-oral", label: "Intra-oral photos", match: (t) => /intra|photo/.test(t) },
  { key: "CBCT", short: "CBCT", label: "CBCT", match: (t) => /cbct/.test(t) },
];
const groupOfImage = (img) => (IMAGE_GROUPS.find((g) => g.match(String(img.image_type || "").toLowerCase())) || { key: "OTHER", label: "Other images" });

/* the dental chart entry's condition text */
const toothCondition = (d) => (d.condition === "Other" ? clean(d.other_text) || "Other" : clean(d.condition));

/* ── allergies (one row per allergy; very old yes/no boxes still understood) ── */
const OLD_ALLERGY_BOXES = [["drug_allergy", "Drug"], ["food_allergy", "Food"], ["latex_allergy", "Latex"], ["iodine_allergy", "Iodine"], ["anesthesia_allergy", "Anesthesia"], ["other_allergy", "Other"]];
function collectAllergies(history, fromComplete) {
  let rows = null;
  if (Array.isArray(history?.allergies)) rows = history.allergies;
  else if (Array.isArray(fromComplete?.rows)) rows = fromComplete.rows;
  else if (Array.isArray(fromComplete)) rows = fromComplete;
  if (rows) {
    return rows.filter((r) => r && (r.allergen || r.type || r.allergy_type)).map((r) => ({
      type: r.type || r.allergy_type || "", allergen: r.allergen || "", reaction: r.reaction || "",
      severity: r.severity || "", status: r.status || "Active", notes: r.notes || "",
    }));
  }
  const old = fromComplete || {};
  return OLD_ALLERGY_BOXES.filter(([k]) => old[k]).map(([k, type]) => ({
    type, allergen: typeof old[k] === "string" ? old[k] : `${type} allergy`, reaction: "", severity: "", status: "Active", notes: "",
  }));
}
const isResolved = (a) => clean(a.status).toLowerCase() === "resolved";
const allergyLabel = (a) => { const n = a.allergen || `${a.type} allergy`; return a.severity ? `${n} (${a.severity})` : n; };

/* ── one visit, with everything said once ── */
function buildVisit(v, billing) {
  const consultations = Array.isArray(v.consultations) ? v.consultations : [];
  const prescriptionsRaw = Array.isArray(v.prescriptions) ? v.prescriptions : [];
  // a prescription saved twice (same date, same medicines, same notes) is one prescription
  const prescMap = new Map();
  prescriptionsRaw.forEach((p) => {
    const meds = parseMeds(p.medicines);
    const key = [clean(p.date).slice(0, 10), norm(p.diagnosis), norm(p.advice),
      meds.map((m) => [norm(m.name), norm(m.times), m.days, norm(m.when), norm(m.note)].join("|")).join("~"),
      (p.investigations || []).map((i) => `${norm(i.name)}:${norm(i.note)}`).join("~")].join("#");
    if (prescMap.has(key)) prescMap.get(key).copies += 1;
    else prescMap.set(key, { ...p, meds, copies: 1 });
  });
  const prescriptions = [...prescMap.values()];

  const diagnosis = distinct(v.diagnosis, consultations.map((c) => c.diagnosis), prescriptions.map((p) => p.diagnosis));
  const treatmentDone = distinct(v.treatment_done, consultations.map((c) => c.treatment_done_today), prescriptions.map((p) => p.treatment_done || p.treatment_done_today));
  const plan = distinct(v.treatment_plan, consultations.map((c) => c.treatment_plan));
  const advice = distinct(v.advice, consultations.map((c) => c.advice), prescriptions.map((p) => p.advice)).filter((a) => !plan.some((x) => norm(x) === norm(a)));
  // plan and advice shown together: "Dmls Crown" and "Dmls Crown IRT 47" become one line
  const planAdvice = distinct(plan, advice);
  const followUps = distinct(
    v.next_appointment ? fmtDate(v.next_appointment) : "",
    consultations.map((c) => (c.follow_up_date ? `${fmtDate(c.follow_up_date)}${c.follow_up_time ? ` at ${fmtTime(c.follow_up_time)}` : ""}` : "")),
    prescriptions.map((p) => (p.follow_up_date ? `${fmtDate(p.follow_up_date)}${p.follow_up_time ? ` at ${fmtTime(p.follow_up_time)}` : ""}` : "")),
  );
  const doctors = distinct(v.assigned_doctor, consultations.map((c) => c.doctor), prescriptions.map((p) => p.doctor));

  const chartSeen = new Set();
  const chart = (Array.isArray(v.dental_chart) ? v.dental_chart : []).filter((d) => {
    const k = [d.tooth_number, norm(toothCondition(d)), norm(d.surface), norm(d.severity)].join("|");
    if (chartSeen.has(k)) return false;
    chartSeen.add(k);
    return true;
  }).sort((a, b) => String(a.tooth_number).localeCompare(String(b.tooth_number), undefined, { numeric: true }));

  const findSeen = new Set();
  const findings = (Array.isArray(v.other_findings) ? v.other_findings : []).filter((f) => {
    const k = [norm(f.finding_type), norm(f.value), norm(f.notes)].join("|");
    if (findSeen.has(k)) return false;
    findSeen.add(k);
    return true;
  });

  const images = Array.isArray(v.images) ? v.images : [];
  const cbct = Array.isArray(v.cbct_scans) ? v.cbct_scans : [];
  const receipts = (billing?.receipts || []).filter((r) => r.visit_id === v.visit_id);
  const charges = (billing?.charges || []).filter((c) => c.visit_id === v.visit_id);
  return {
    id: v.visit_id, date: v.visit_date, status: clean(v.status), complaint: clean(v.chief_complaint),
    followupTreatment: clean(v.followup_treatment), billingNote: clean(v.billing_note),
    diagnosis, treatmentDone, plan, advice, planAdvice, followUps, doctors, chart, findings, prescriptions, images, cbct, receipts, charges,
  };
}

/* ── pictures and PDFs: loaded with the login ── */
const imagePath = (img) => String(img.url || `/api/images/${img.id}/data`).replace(/^\/api(?=\/)/, "");
function useBlobUrl(path, enabled = true) {
  const [state, setState] = useState({ url: "", blob: null, error: "" });
  useEffect(() => {
    if (!path || !enabled) return undefined;
    let made = "", cancelled = false;
    setState({ url: "", blob: null, error: "" });
    api.get(path, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        if (typeof URL.createObjectURL === "function") made = URL.createObjectURL(res.data);
        setState({ url: made, blob: res.data, error: "" });
      })
      .catch(() => { if (!cancelled) setState({ url: "", blob: null, error: "Could not be loaded" }); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [path, enabled]);
  return state;
}

function Thumb({ img, onOpen, showDate }) {
  const { url, error } = useBlobUrl(imagePath(img));
  const g = groupOfImage(img);
  const isPdf = String(img.mime_type || "").includes("pdf");
  return (
    <button type="button" className="pch-thumb" onClick={onOpen} title={img.description || g.label} data-image={img.id}>
      {url && !isPdf ? <img src={url} alt={`${img.image_type || "Image"} ${fmtDate(img.image_date)}`} />
        : <div className="pch-thumb-ph">{error ? "⚠️" : isPdf ? "📄" : "…"}</div>}
      <span className="pch-thumb-tag">{img.image_type || g.label}</span>
      {showDate && <span className="pch-thumb-date">{fmtDate(img.image_date || img.visit_date)}</span>}
    </button>
  );
}

function Viewer({ items, index, onIndex, onClose }) {
  const item = items[index];
  const isPdf = item.kind === "pdf" || String(item.mime_type || "").includes("pdf");
  const { url, blob, error } = useBlobUrl(item.path);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = url; a.download = item.fileName || `${item.title || "file"}${isPdf ? ".pdf" : ".jpg"}`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  return createPortal(
    <div className="pch-viewer" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="pch-viewer-bar">
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{item.title}</div>
          {item.sub && <div style={{ fontSize: 12, opacity: 0.75 }}>{item.sub}</div>}
        </div>
        {items.length > 1 && <span style={{ fontSize: 12.5, opacity: 0.8 }}>{index + 1} of {items.length}</span>}
        {items.length > 1 && <button type="button" className="pch-vbtn" disabled={index === 0} onClick={() => onIndex(index - 1)}>◀ Previous</button>}
        {items.length > 1 && <button type="button" className="pch-vbtn" disabled={index === items.length - 1} onClick={() => onIndex(index + 1)}>Next ▶</button>}
        <button type="button" className="pch-vbtn" disabled={!blob} onClick={save}>⬇ Download</button>
        <button type="button" className="pch-vbtn" disabled={!url} onClick={() => window.open(url, "_blank")}>↗ Full size</button>
        <button type="button" className="pch-vbtn pch-vbtn-close" onClick={onClose} autoFocus>✕ Close</button>
      </div>
      <div className="pch-viewer-stage" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {error ? <div style={{ color: "#fecaca" }}>⚠️ This file could not be loaded.</div>
          : !url ? <div style={{ color: "#cbd5e1" }}>{blob ? "Ready — use Download." : "Loading…"}</div>
          : isPdf ? <iframe title={item.title} src={url} style={{ width: "100%", height: "100%", border: 0, borderRadius: 10, background: "#fff" }} />
          : <img src={url} alt={item.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />}
      </div>
    </div>,
    document.body
  );
}

/* ── small building blocks ── */
const Empty = ({ children }) => <div className="pch-empty">{children}</div>;
function Fields({ rows }) {
  const filled = rows.filter(([, v]) => (Array.isArray(v) ? v.length : clean(v)));
  if (!filled.length) return null;
  return (
    <dl className="pch-fields">
      {filled.map(([label, value]) => (
        <div key={label} className="pch-field">
          <dt>{label}</dt>
          <dd>{Array.isArray(value)
            ? (value.length === 1 ? value[0] : <ul>{value.map((x) => <li key={x}>{x}</li>)}</ul>)
            : value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Table({ headers, rows, align = {} }) {
  const has = (c) => c !== null && c !== undefined && c !== "";
  const kept = rows.filter((r) => r.some(has));
  if (!kept.length) return null;
  // a column that is empty in every row is left out (no columns full of "—")
  const cols = headers.map((h, j) => j).filter((j) => j === 0 || !headers[j] || kept.some((r) => has(r[j])));
  return (
    <div className="pch-table-wrap">
      <table className="pch-table">
        <thead><tr>{cols.map((j) => <th key={j} style={{ textAlign: align[headers[j]] || "left" }}>{headers[j]}</th>)}</tr></thead>
        <tbody>{kept.map((r, i) => <tr key={i}>{cols.map((j) => <td key={j} style={{ textAlign: align[headers[j]] || "left" }}>{has(r[j]) ? r[j] : "—"}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function Block({ title, icon, children, right }) {
  return (
    <section className="pch-block">
      <div className="pch-block-h"><h4>{icon && <span aria-hidden="true">{icon}</span>} {title}</h4>{right}</div>
      {children}
    </section>
  );
}
function InvestigationList({ items }) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && clean(i.name));
  if (!list.length) return null;
  return (
    <div className="pch-inv">
      <div className="pch-inv-h">🔬 Investigations advised</div>
      <ul>{list.map((i, k) => <li key={k}><b>{i.name}</b>{i.group ? <span className="pch-muted"> · {i.group === "Radiograph" ? "X-ray / scan" : i.group}</span> : null}{i.note ? ` — ${i.note}` : ""}</li>)}</ul>
    </div>
  );
}
function MedTable({ meds }) {
  return (
    <Table headers={["Medicine", "Frequency", "Days", "Instructions"]}
      rows={meds.map((m) => [<strong key="n">{m.name}</strong>, m.times, medDays(m), [clean(m.when), clean(m.note)].filter(Boolean).join(" — ")])} />
  );
}

/* ══════════════════════════════════════════════════════════════════
   The screen
══════════════════════════════════════════════════════════════════ */
export default function PatientCompleteHistory({ patientId, onBack, onCreateVisit, onOpenVisit, readOnlyLabel = "Read Only" }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [billing, setBilling] = useState(null);          // null = not loaded / not available
  const [billingState, setBillingState] = useState("loading"); // loading | ok | none
  const [appts, setAppts] = useState(null);            // {upcoming, past} from Supabase; null = not available
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("visits");
  const [open, setOpen] = useState(() => new Set());
  const [viewer, setViewer] = useState(null);           // { items, index }
  const [imgFilter, setImgFilter] = useState("ALL");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setHistory(null); setBilling(null); setBillingState("loading"); setAppts(null);
    (async () => {
      try {
        const [res, mh] = await Promise.all([
          api.get(`/patients/${patientId}/complete-history`),
          api.get(`/patients/${patientId}/medical-history`).catch(() => null),
        ]);
        if (cancelled) return;
        setHistory(mh?.data || null);
        // investigations advised are kept with each prescription (prescription addresses)
        const anyVisit = res.data?.visits?.[0]?.visit_id;
        if (anyVisit && (res.data.visits || []).some((v) => (v.prescriptions || []).length)) {
          try {
            const rx = await api.get(`/visits/${anyVisit}/prescriptions/history`);
            const inv = new Map((Array.isArray(rx.data) ? rx.data : []).map((p) => [p.id, p.investigations || []]));
            res.data.visits.forEach((v) => (v.prescriptions || []).forEach((p) => { if (inv.has(p.id)) p.investigations = inv.get(p.id); }));
          } catch { /* shown without the investigations */ }
          if (cancelled) return;
        }
        setData(res.data);
        // the latest visit is opened; when that is today's visit still in progress, the one before it too
        const vs = res.data?.visits || [];
        const done = (v) => /^(closed|completed)$/i.test(String(v?.status || ""));
        setOpen(new Set(vs.slice(0, vs[0] && !done(vs[0]) ? 2 : 1).map((v) => v.visit_id)));
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("The patient's history could not be loaded. Please check the connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    api.get(`/clinic-billing/patients/${patientId}/account`)
      .then((res) => { if (!cancelled) { setBilling(res.data); setBillingState("ok"); } })
      .catch(() => { if (!cancelled) setBillingState("none"); });
    api.get(`/patients/${patientId}/appointments`)
      .then((res) => { if (!cancelled && res.data && Array.isArray(res.data.upcoming)) setAppts(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => {
    const key = (e) => { if (e.key === "Escape" && !viewer) onBack(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [viewer, onBack]);

  const visits = useMemo(() => (data?.visits || []).map((v) => buildVisit(v, billing)), [data, billing]);
  const allImages = useMemo(() => visits.flatMap((v) => v.images.map((img) => ({ ...img, visit_date: v.date, visit_id: v.id }))), [visits]);
  const allPrescriptions = useMemo(() => visits.flatMap((v) => v.prescriptions.map((p) => ({ ...p, visit: v }))), [visits]);

  const handleCreateVisit = async () => {
    if (!onCreateVisit) return;
    setCreating(true);
    try { await onCreateVisit(patientId); } finally { setCreating(false); }
  };

  if (loading || error || !data) {
    return (
      <div className="pch-overlay"><Styles />
        <div className="pch-panel">
          <div className="pch-loading">
            {loading ? "Loading the complete patient history…" : (error || "No data found.")}
            {!loading && <div style={{ marginTop: 14 }}><button type="button" className="pch-btn" onClick={onBack}>← Back</button></div>}
          </div>
        </div>
      </div>
    );
  }

  const { patient = {}, medical_history, woman_history, allergies, habits = [], medications = [], family_doctor, consent,
    has_active_visit, active_visit_id } = data;
  const allergyRows = collectAllergies(history, allergies);
  const activeAllergies = allergyRows.filter((a) => !isResolved(a));
  const noneKnownAllergies = Boolean(history?.none_known?.allergies || allergies?.no_known_allergies);
  const conditions = medical_history ? Object.entries(medical_history).filter(([k, v]) => v === true && k !== "no_known_conditions") : [];

  const firstVisit = visits[visits.length - 1]?.date;
  const lastVisit = visits[0]?.date;
  const treatmentVisits = visits.filter((v) => v.treatmentDone.length);
  const t = billing?.totals;

  const toggle = (id) => setOpen((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const openImages = (list, img) => setViewer({
    items: list.map((x) => ({ path: imagePath(x), mime_type: x.mime_type, title: `${x.image_type || groupOfImage(x).label} — ${fmtDate(x.image_date || x.visit_date)}`, sub: clean(x.description), fileName: `${patient.name || "patient"} ${x.image_type || "image"} ${clean(x.image_date || "").slice(0, 10)}` })),
    index: Math.max(0, list.findIndex((x) => x.id === img.id)),
  });
  const openReceipt = (r, list) => setViewer({
    items: list.map((x) => ({ path: `/clinic-billing/receipts/${x.id}/pdf`, kind: "pdf", title: `Receipt #${x.receipt_no} — ${fmtDate(x.date)}`, sub: `${inr(x.amount_paid)}${x.payment_methods?.length ? ` · ${x.payment_methods.join(", ")}` : ""}`, fileName: x.pdf_name || `Receipt ${x.receipt_no}.pdf` })),
    index: Math.max(0, list.findIndex((x) => x.id === r.id)),
  });

  const tabs = [
    ["visits", "🗓 Visits", visits.length],
    ["treatments", "🦷 Treatments", treatmentVisits.length],
    ["images", "🩻 X-rays & photos", allImages.length],
    ["prescriptions", "💊 Prescriptions", allPrescriptions.length],
    ...(billingState === "ok" ? [["bills", "🧾 Bills", billing?.receipts?.length || 0]] : []),
    ...(appts ? [["appointments", "📅 Appointments", appts.upcoming.length + appts.past.length]] : []),
    ["medical", "📋 Medical", null],
  ];

  const visitActions = has_active_visit
    ? onOpenVisit && <button type="button" className="pch-btn pch-btn-main" onClick={() => onOpenVisit(active_visit_id)}>Open Current Visit →</button>
    : onCreateVisit && <button type="button" className="pch-btn pch-btn-main" onClick={handleCreateVisit} disabled={creating}>{creating ? "Creating…" : "+ Create Visit"}</button>;

  return (
    <div className="pch-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <Styles />
      <div className="pch-panel" role="dialog" aria-modal="true" aria-label={`Complete history — ${patient.name}`}>
        {/* header */}
        <header className="pch-head">
          <div className="pch-id">
            <div className="pch-avatar">{clean(patient.name).charAt(0).toUpperCase() || "?"}</div>
            <div style={{ minWidth: 0 }}>
              <div className="pch-badge">{readOnlyLabel}</div>
              <h2>{patient.name}</h2>
              <div className="pch-meta">
                {patient.case_number && <span>Case <b>{patient.case_number}</b></span>}
                {patient.age && <span>{patient.age} yrs</span>}
                {patient.gender && <span>{patient.gender}</span>}
                {patient.mobile && <span>📱 {patient.mobile}</span>}
                {patient.blood_group && <span>🩸 {patient.blood_group}</span>}
              </div>
            </div>
          </div>
          <div className="pch-head-actions">
            {visitActions}
            <button type="button" className="pch-btn" onClick={onBack}>← Back</button>
          </div>
        </header>

        {activeAllergies.length > 0 && (
          <div className="pch-allergy" role="alert">
            <span aria-hidden="true">⚠️</span>
            <div><b>{activeAllergies.length === 1 ? "Allergy" : `Allergies (${activeAllergies.length})`}:</b> {activeAllergies.map(allergyLabel).join("  ·  ")}</div>
          </div>
        )}

        {/* summary */}
        <div className="pch-summary" aria-label="Summary">
          <div className="pch-stat"><span>Visits</span><b>{visits.length}</b><small>{visits.length ? (visits.length === 1 ? fmtDate(lastVisit) : `${fmtDate(firstVisit)} → ${fmtDate(lastVisit)}`) : "none yet"}</small></div>
          <div className="pch-stat"><span>Treatments done</span><b>{treatmentVisits.length}</b><small>{treatmentVisits[0] ? `last: ${fmtDate(treatmentVisits[0].date)}` : ""}</small></div>
          <div className="pch-stat"><span>X-rays &amp; photos</span><b>{allImages.length}</b><small>{IMAGE_GROUPS.map((g) => [g.short, allImages.filter((i) => groupOfImage(i).key === g.key).length]).filter(([, n]) => n).map(([l, n]) => `${n} ${l}`).join(" · ")}</small></div>
          <div className="pch-stat"><span>Prescriptions</span><b>{allPrescriptions.length}</b><small>{allPrescriptions[0] ? `last: ${fmtDate(allPrescriptions[0].date || allPrescriptions[0].visit.date)}` : ""}</small></div>
          {appts && (
            <div className="pch-stat"><span>Next appointment</span><b>{appts.upcoming[0] ? fmtDate(appts.upcoming[0].date) : "—"}</b>
              <small>{appts.upcoming[0] ? [fmtTime(appts.upcoming[0].time), appts.upcoming[0].treatment].filter(Boolean).join(" · ") : "none booked"}</small></div>
          )}
          {billingState === "ok" && t && (
            <div className={`pch-stat ${t.balance > 0.004 ? "pch-stat-due" : ""}`}><span>Balance due</span><b>{t.balance > 0.004 ? inr(t.balance) : "Nil"}</b><small>paid {inr(t.received ?? t.paid)}</small></div>
          )}
        </div>

        {/* tabs */}
        <div className="pch-tabs" role="tablist">
          {tabs.map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className="pch-tab" onClick={() => setTab(key)}>
              {label}{n !== null && <span className="pch-n">{n}</span>}
            </button>
          ))}
        </div>

        <div className="pch-body">
          {/* ───── VISITS ───── */}
          {tab === "visits" && (
            visits.length === 0 ? <Empty>No visits yet.</Empty> : (
              <>
                <div className="pch-toolbar">
                  <button type="button" className="pch-link" onClick={() => setOpen(new Set(visits.map((v) => v.id)))}>Open all</button>
                  <button type="button" className="pch-link" onClick={() => setOpen(new Set())}>Close all</button>
                </div>
                <div className="pch-reg-head" aria-hidden="true">
                  <span>Date</span><span>Teeth</span><span>Diagnosis</span><span>Treatment done</span><span>Records</span>
                </div>
                <ol className="pch-register">
                  {visits.map((v) => {
                    const isOpen = open.has(v.id);
                    const paid = v.receipts.reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
                    const statusLc = v.status.toLowerCase();
                    const closed = statusLc === "closed" || statusLc === "completed";
                    const teeth = [...new Set(v.chart.map((d) => String(d.tooth_number)))];
                    const doctors = v.doctors.map((d) => (/^dr\.?\s/i.test(d) ? d : `Dr. ${d}`));
                    let n = 0;
                    const step = (title, body, cls = "") => (
                      <div className={`pch-step ${cls}`}>
                        <div className="pch-step-n">{++n}</div>
                        <div className="pch-step-c"><div className="pch-step-t">{title}</div>{body}</div>
                      </div>
                    );
                    const lines = (arr) => (arr.length === 1 ? <div className="pch-step-v">{arr[0]}</div>
                      : <ul className="pch-step-list">{arr.map((x) => <li key={x}>{x}</li>)}</ul>);
                    const nothing = !v.complaint && !v.followupTreatment && !v.diagnosis.length && !v.treatmentDone.length && !v.planAdvice.length
                      && !v.chart.length && !v.findings.length && !v.prescriptions.length && !v.images.length && !v.cbct.length;
                    return (
                      <li key={v.id} className={`pch-visit ${isOpen ? "is-open" : ""}`} data-visit={v.id}>
                        <button type="button" className="pch-row" aria-expanded={isOpen} onClick={() => toggle(v.id)}>
                          <span className="pch-c-date">
                            <b>{fmtDate(v.date)}</b>
                            <span className={`pch-status ${closed ? "" : "pch-status-live"}`}>{closed ? "Closed" : statusLc === "in_progress" ? "With doctor" : statusLc === "created" ? "Waiting" : v.status || "—"}</span>
                          </span>
                          <span className="pch-c-teeth" data-label="Teeth">{teeth.length ? teeth.map((t) => <span key={t} className="pch-tooth">{t}</span>) : <span className="pch-muted pch-none">—</span>}</span>
                          <span className="pch-c-text" data-label="Diagnosis">{v.diagnosis.join("; ") || <span className="pch-muted">{v.complaint || "—"}</span>}</span>
                          <span className="pch-c-text pch-c-done" data-label="Treatment done">{v.treatmentDone.join("; ") || <span className="pch-muted">—</span>}</span>
                          <span className="pch-c-rec">
                            {v.prescriptions.length > 0 && <span title="Prescription">💊</span>}
                            {v.images.length > 0 && <span title="X-rays & photos">🩻 {v.images.length}</span>}
                            {v.receipts.length > 0 && <span title="Paid at this visit">₹{Math.round(paid).toLocaleString("en-IN")}</span>}
                            <span className={`pch-chev ${isOpen ? "open" : ""}`} aria-hidden="true">▾</span>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="pch-sheet">
                            {nothing && <Empty>Nothing was recorded for this visit.</Empty>}
                            {(v.complaint || v.followupTreatment) && step("Complaint", (
                              <>
                                {v.complaint && <div className="pch-step-v">{v.complaint}</div>}
                                {v.followupTreatment && <div className="pch-step-v"><span className="pch-k">Follow-up of:</span> <span>{v.followupTreatment}</span></div>}
                              </>
                            ))}
                            {(v.chart.length > 0 || v.findings.length > 0) && step("Examination", (
                              <>
                                {v.chart.length > 0 && (
                                  <div className="pch-exam">
                                    {v.chart.map((d, i) => (
                                      <div key={i} className="pch-exam-row">
                                        <span className="pch-tooth pch-tooth-lg">{d.tooth_number}</span>
                                        <span><b>{toothCondition(d)}</b>{[d.surface && `surface ${d.surface}`, d.severity, d.notes].filter(Boolean).map((x) => <span key={x} className="pch-muted"> · {x}</span>)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {v.findings.length > 0 && (
                                  <ul className="pch-step-list">{v.findings.map((f, i) => <li key={i}><b>{f.finding_type}</b>{f.value ? `: ${f.value}` : ""}{f.notes ? <span className="pch-muted"> · {f.notes}</span> : null}</li>)}</ul>
                                )}
                              </>
                            ))}
                            {v.diagnosis.length > 0 && step("Diagnosis", lines(v.diagnosis))}
                            {(v.planAdvice.length > 0 || v.followUps.length > 0) && step("Advice & plan", (
                              <>
                                {v.planAdvice.length > 0 && lines(v.planAdvice)}
                                {v.followUps.length > 0 && <div className="pch-step-v"><span className="pch-k">Next appointment:</span> <span>{v.followUps.join(", ")}</span></div>}
                              </>
                            ))}
                            {v.treatmentDone.length > 0 && step("Treatment done", lines(v.treatmentDone), "pch-step-done")}
                            {v.prescriptions.length > 0 && step("Prescription", v.prescriptions.map((p) => (
                              <div key={p.id} className="pch-rx">
                                {p.meds.length ? <MedTable meds={p.meds} /> : !(p.investigations || []).length && <div className="pch-muted">No medicines — advice only.</div>}
                <InvestigationList items={p.investigations} />
                              </div>
                            )))}
                            {(v.images.length > 0 || v.cbct.length > 0) && step("X-rays & photos", (
                              <>
                                {v.images.length > 0 && <div className="pch-thumbs">{v.images.map((img) => <Thumb key={img.id} img={img} onOpen={() => openImages(v.images, img)} />)}</div>}
                                {v.cbct.length > 0 && (
                                  <>
                                    <Table headers={["CBCT study date", "Modality", "Institution", "Slices", "Notes"]} rows={v.cbct.map((c) => [c.study_date, c.modality, c.institution, c.num_slices, c.notes])} />
                                    <div className="pch-muted">Open the CBCT viewer from the visit to see the slices.</div>
                                  </>
                                )}
                              </>
                            ))}
                            {(v.billingNote || v.charges.length > 0 || v.receipts.length > 0) && step("Billing", (
                              <>
                                {v.billingNote && <div className="pch-step-v"><span className="pch-k">Doctor's instructions:</span> <span>{v.billingNote}</span></div>}
                                {v.charges.length > 0 && (
                                  <Table headers={["Treatment", "Charge", "Discount", "Paid", "Balance"]} align={{ Charge: "right", Discount: "right", Paid: "right", Balance: "right" }}
                                    rows={v.charges.map((c) => [<span key="n"><b>{c.treatment}</b>{c.description ? ` (${c.description})` : ""}</span>, inr(c.fee), c.discount ? inr(c.discount) : "", inr(c.paid), c.balance > 0.004 ? <b key="b" style={{ color: "#b91c1c" }}>{inr(c.balance)}</b> : "Nil"])} />
                                )}
                                {v.receipts.length > 0 && (
                                  <div className="pch-receipts">
                                    {v.receipts.map((r) => (
                                      <button key={r.id} type="button" className="pch-receipt" onClick={() => openReceipt(r, v.receipts)}>
                                        🧾 Receipt #{r.receipt_no} · {fmtDate(r.date)} · <b>{inr(r.amount_paid)}</b>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            ))}
                            {doctors.length > 0 && <div className="pch-sheet-foot">Treated by {doctors.join(", ")}</div>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            )
          )}

          {/* ───── TREATMENTS ───── */}
          {tab === "treatments" && (
            <>
              <Block title="Treatment history" icon="🦷">
                {visits.length === 0 ? <Empty>No visits yet.</Empty> : (
                  <Table headers={["Date", "Treatment done", "Teeth", "Diagnosis", "Doctor"]}
                    rows={visits.filter((v) => v.treatmentDone.length || v.diagnosis.length || v.chart.length).map((v) => [
                      <span key="d" style={{ whiteSpace: "nowrap" }}>{fmtDate(v.date)}</span>,
                      v.treatmentDone.length ? v.treatmentDone.join("; ") : <span key="n" className="pch-muted">—</span>,
                      [...new Set(v.chart.map((d) => d.tooth_number))].join(", "),
                      v.diagnosis.join("; "),
                      v.doctors.join(", "),
                    ])} />
                )}
                {visits.length > 0 && !visits.some((v) => v.treatmentDone.length || v.diagnosis.length || v.chart.length) && <Empty>No treatment recorded yet.</Empty>}
              </Block>
              {visits.some((v) => v.plan.length) && (
                <Block title="Treatment plans" icon="🗒">
                  <Table headers={["Date", "Plan"]} rows={visits.filter((v) => v.plan.length).map((v) => [<span key="d" style={{ whiteSpace: "nowrap" }}>{fmtDate(v.date)}</span>, v.plan.join("; ")])} />
                </Block>
              )}
            </>
          )}

          {/* ───── X-RAYS & PHOTOS ───── */}
          {tab === "images" && (
            allImages.length === 0 ? <Empty>No X-rays or photos uploaded yet.</Empty> : (
              <>
                <div className="pch-chips" role="group" aria-label="Show">
                  {[["ALL", "All", allImages.length], ...[...IMAGE_GROUPS, { key: "OTHER", label: "Other images" }].map((g) => [g.key, g.label, allImages.filter((i) => groupOfImage(i).key === g.key).length]).filter(([, , n]) => n)].map(([k, l, n]) => (
                    <button key={k} type="button" className="pch-chip" aria-pressed={imgFilter === k} onClick={() => setImgFilter(k)}>{l} <span>{n}</span></button>
                  ))}
                </div>
                {visits.filter((v) => v.images.some((i) => imgFilter === "ALL" || groupOfImage(i).key === imgFilter)).map((v) => {
                  const list = v.images.filter((i) => imgFilter === "ALL" || groupOfImage(i).key === imgFilter).map((i) => ({ ...i, visit_date: v.date }));
                  return (
                    <Block key={v.id} title={`Visit of ${fmtDate(v.date)}`} icon="🗓" right={<span className="pch-muted">{v.treatmentDone[0] || v.diagnosis[0] || ""}</span>}>
                      <div className="pch-thumbs">{list.map((img) => <Thumb key={img.id} img={img} showDate onOpen={() => openImages(list, img)} />)}</div>
                    </Block>
                  );
                })}
              </>
            )
          )}

          {/* ───── PRESCRIPTIONS ───── */}
          {tab === "prescriptions" && (
            allPrescriptions.length === 0 ? <Empty>No prescriptions yet.</Empty> : allPrescriptions.map((p) => (
              <Block key={p.id} title={fmtDate(p.date || p.visit.date)} icon="💊"
                right={<span className="pch-muted">{p.doctor ? (/^dr\.?\s/i.test(p.doctor) ? p.doctor : `Dr. ${p.doctor}`) : ""}</span>}>
                <Fields rows={[["Diagnosis", clean(p.diagnosis)], ["Advice", clean(p.advice)],
                  ["Follow-up", p.follow_up_date ? `${fmtDate(p.follow_up_date)}${p.follow_up_time ? ` at ${fmtTime(p.follow_up_time)}` : ""}` : ""]]} />
                {p.meds.length ? <MedTable meds={p.meds} /> : !(p.investigations || []).length && <div className="pch-muted">No medicines — advice only.</div>}
                <InvestigationList items={p.investigations} />
              </Block>
            ))
          )}

          {/* ───── BILLS ───── */}
          {tab === "bills" && billingState === "ok" && billing && (
            <>
              <div className="pch-summary pch-summary-in">
                <div className="pch-stat"><span>Treatment charges</span><b>{inr(t?.fee)}</b></div>
                <div className="pch-stat"><span>Discount</span><b>{inr(t?.discount)}</b></div>
                <div className="pch-stat"><span>Paid</span><b>{inr(t?.received ?? t?.paid)}</b></div>
                <div className={`pch-stat ${t?.balance > 0.004 ? "pch-stat-due" : ""}`}><span>Balance due</span><b>{t?.balance > 0.004 ? inr(t.balance) : "Nil"}</b></div>
              </div>
              {billing.charges?.length > 0 && (
                <Block title="Treatments" icon="🦷">
                  <Table headers={["Date", "Treatment", "Charge", "Discount", "Paid", "Balance", "Status"]} align={{ Charge: "right", Discount: "right", Paid: "right", Balance: "right" }}
                    rows={[...billing.charges].sort((x, y) => String(y.date).localeCompare(String(x.date))).map((c) => [<span key="d" style={{ whiteSpace: "nowrap" }}>{fmtDate(c.date)}</span>, <span key="n"><b>{c.treatment}</b>{c.description ? ` (${c.description})` : ""}</span>, inr(c.fee), c.discount ? inr(c.discount) : "", inr(c.paid), c.balance > 0.004 ? inr(c.balance) : "Nil", c.status])} />
                </Block>
              )}
              <Block title="Payments (receipts)" icon="🧾">
                {!billing.receipts?.length ? <Empty>No receipts yet.</Empty> : (
                  <Table headers={["Date", "Receipt", "For", "Paid by", "Amount", ""]} align={{ Amount: "right" }}
                    rows={billing.receipts.map((r) => [
                      <span key="d" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</span>, `#${r.receipt_no}`,
                      (r.treatments || []).map((x) => x.name).join(", "), (r.payment_methods || []).join(", "),
                      <b key="a">{inr(r.amount_paid)}</b>,
                      <button key="v" type="button" className="pch-btn pch-btn-sm" onClick={() => openReceipt(r, billing.receipts)}>View PDF</button>,
                    ])} />
                )}
              </Block>
            </>
          )}

          {/* ───── APPOINTMENTS (Supabase — shared with the Appointments app) ───── */}
          {tab === "appointments" && appts && (() => {
            const STATE = { SCHEDULED: "Scheduled", COMPLETED: "Completed", CANCELLED: "Cancelled" };
            const n = new Date(); const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
            const row = (a) => [
              <span key="d" style={{ whiteSpace: "nowrap" }}><b>{fmtDate(a.date)}</b></span>,
              fmtTime(a.time),
              a.treatment,
              a.doctor_name,
              <span key="s" className={`pch-ap pch-ap-${a.state === "SCHEDULED" && a.date < today ? "missed" : a.state.toLowerCase()}`}>{a.state === "SCHEDULED" && a.date < today ? "Not attended" : STATE[a.state] || a.state}</span>,
              a.notes,
            ];
            return (
              <>
                <Block title={`Upcoming (${appts.upcoming.length})`} icon="📅">
                  {appts.upcoming.length ? <Table headers={["Date", "Time", "Treatment", "Doctor", "Status", "Notes"]} rows={appts.upcoming.map(row)} />
                    : <div className="pch-muted">No upcoming appointment.</div>}
                </Block>
                <Block title={`Past (${appts.past.length})`} icon="🗂">
                  {appts.past.length ? <Table headers={["Date", "Time", "Treatment", "Doctor", "Status", "Notes"]} rows={appts.past.map(row)} />
                    : <div className="pch-muted">No past appointments.</div>}
                </Block>
              </>
            );
          })()}

          {/* ───── MEDICAL ───── */}
          {tab === "medical" && (
            <>
              <Block title="Patient details" icon="👤">
                <Fields rows={[["Address", patient.address], ["Profession", patient.profession], ["Marital status", patient.marital_status], ["Email", patient.email],
                  ["Referred by", patient.referred_by], ["Registered", patient.date ? fmtDate(patient.date) : ""], ["First complaint", patient.chief_complaint]]} />
              </Block>
              <Block title="Medical history" icon="🩺">
                {medical_history?.no_known_conditions || history?.none_known?.conditions ? <div className="pch-ok">✓ Confirmed: No known medical conditions</div>
                  : conditions.length === 0 && !medical_history?.other ? <div className="pch-muted">No conditions recorded.</div>
                  : <div className="pch-chips">{conditions.map(([k]) => <span key={k} className="pch-chip pch-chip-warn">{formatLabel(k)}</span>)}</div>}
                {medical_history?.other && <div className="pch-note">Other: {medical_history.other}</div>}
              </Block>
              <Block title={`Allergies${allergyRows.length ? ` (${allergyRows.length})` : ""}`} icon="⚠️">
                {allergyRows.length === 0 ? (noneKnownAllergies ? <div className="pch-ok">✓ Confirmed: No known allergies</div> : <div className="pch-muted">No allergies recorded.</div>)
                  : <Table headers={["Type", "Allergic to", "Reaction", "Severity", "Status", "Notes"]} rows={allergyRows.map((a) => [a.type, <b key="a">{a.allergen}</b>, a.reaction, a.severity, a.status, a.notes])} />}
              </Block>
              <Block title="Current medicines" icon="💊">
                {medications.length === 0 ? <div className="pch-muted">No current medicines recorded.</div>
                  : <Table headers={["Medicine", "Dosage", "Frequency", "Duration", "Purpose", "Prescribed by"]} rows={medications.map((m) => [m.medicine_name, m.dosage, m.frequency, m.duration, m.purpose, m.prescribed_by])} />}
              </Block>
              {(() => {
                const HABITS = ["smoking", "alcohol", "tobacco", "pan_chewing", "spicy_foods"];
                const rows = habits.flatMap((h) => HABITS.filter((f) => h[f]).map((f) => [formatLabel(f), h[f] === true ? "Yes" : String(h[f])]));
                return <Block title="Habits" icon="🚬">{rows.length ? <Fields rows={rows} /> : <div className="pch-muted">No habits recorded.</div>}</Block>;
              })()}
              {woman_history && (
                <Block title="Women's history" icon="🤰">
                  <Fields rows={[["Pregnant", woman_history.pregnant ? "Yes" : "No"], ["Due date", woman_history.due_date ? fmtDate(woman_history.due_date) : ""], ["Nursing a child", woman_history.nursing_child ? "Yes" : "No"]]} />
                </Block>
              )}
              <Block title="Family doctor & consent" icon="📝">
                <Fields rows={[["Family doctor", family_doctor?.doctor_name], ["Doctor's phone", family_doctor?.doctor_phone],
                  ["Consent signed", consent ? (consent.agreed ? "Yes" : "No") : ""], ["Consent date", consent?.consent_date ? fmtDate(consent.consent_date) : ""]]} />
                {!family_doctor?.doctor_name && !consent && <div className="pch-muted">Nothing recorded.</div>}
              </Block>
            </>
          )}
        </div>
      </div>
      {viewer && <Viewer items={viewer.items} index={viewer.index} onIndex={(i) => setViewer((v) => ({ ...v, index: i }))} onClose={() => setViewer(null)} />}
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .pch-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(10,20,40,0.55); display: flex; justify-content: flex-end;
        font-family: 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif; color: #0f172a; }
      .pch-overlay *, .pch-viewer * { box-sizing: border-box; }
      .pch-panel { width: min(1080px, 100%); height: 100%; background: #f4f6fa; display: flex; flex-direction: column; box-shadow: -10px 0 40px rgba(0,0,0,0.25); }
      .pch-loading { padding: 70px 20px; text-align: center; color: #64748b; font-size: 14px; }
      .pch-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 18px 26px; background: #fff; border-bottom: 1px solid #e5e9f0; flex-wrap: wrap; }
      .pch-id { display: flex; gap: 14px; align-items: center; min-width: 0; }
      .pch-avatar { width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, #1d4d7a, #1d6fa4); color: #fff; font-size: 22px; font-weight: 800;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .pch-badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: #0e7490; background: #ecfeff; border: 1px solid #a5f3fc; padding: 2px 9px; border-radius: 20px; }
      .pch-head h2 { margin: 4px 0 0; font-size: 21px; font-weight: 800; color: #0b2d4e; overflow-wrap: anywhere; }
      .pch-meta { display: flex; gap: 6px 14px; flex-wrap: wrap; font-size: 13px; color: #64748b; margin-top: 3px; }
      .pch-meta b { color: #0f172a; }
      .pch-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .pch-btn { font-family: inherit; font-size: 13px; font-weight: 700; border-radius: 9px; padding: 9px 16px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #334155; }
      .pch-btn:hover { background: #f8fafc; }
      .pch-btn:disabled { opacity: .55; cursor: not-allowed; }
      .pch-btn-main { background: #1e4f8a; border-color: #1e4f8a; color: #fff; }
      .pch-btn-main:hover { background: #173f6f; }
      .pch-btn-sm { font-size: 12px; padding: 5px 10px; border-radius: 7px; }
      .pch-allergy { display: flex; gap: 10px; align-items: flex-start; padding: 10px 26px; background: #fef2f2; border-bottom: 2px solid #fca5a5; color: #7f1d1d; font-size: 14px; }
      .pch-allergy b { color: #991b1b; }
      .pch-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); background: #fff; border-bottom: 1px solid #e5e9f0; }
      .pch-summary-in { border: 1px solid #e5e9f0; border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
      .pch-stat { padding: 12px 18px; border-right: 1px solid #eef1f5; display: flex; flex-direction: column; min-width: 0; }
      .pch-stat:last-child { border-right: 0; }
      .pch-stat span { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #64748b; }
      .pch-stat b { font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 2px; white-space: nowrap; }
      .pch-stat small { font-size: 11.5px; color: #94a3b8; margin-top: 1px; min-height: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pch-stat-due b { color: #b91c1c; }
      .pch-tabs { display: flex; gap: 2px; padding: 0 18px; background: #fff; border-bottom: 1px solid #e5e9f0; overflow-x: auto; scrollbar-width: none; flex-shrink: 0; }
      .pch-tabs::-webkit-scrollbar { display: none; }
      .pch-tab { font-family: inherit; font-size: 13.5px; font-weight: 700; color: #64748b; background: none; border: 0; border-bottom: 3px solid transparent; padding: 12px 12px 10px; cursor: pointer; white-space: nowrap; }
      .pch-tab:hover { color: #0f172a; }
      .pch-tab[aria-selected="true"] { color: #1e4f8a; border-bottom-color: #1e4f8a; }
      .pch-n { margin-left: 6px; font-size: 11px; font-weight: 800; background: #eef2f7; color: #475569; border-radius: 10px; padding: 1px 7px; }
      .pch-tab[aria-selected="true"] .pch-n { background: #e0ecfa; color: #1e4f8a; }
      .pch-body { flex: 1; overflow-y: auto; padding: 18px 26px 30px; }
      .pch-toolbar { display: flex; justify-content: flex-end; gap: 14px; margin: -4px 0 8px; }
      .pch-link { background: none; border: 0; padding: 0; font: inherit; font-size: 12.5px; font-weight: 700; color: #1e4f8a; cursor: pointer; }
      .pch-link:hover { text-decoration: underline; }
      .pch-reg-head, .pch-row { display: grid; grid-template-columns: 128px 104px minmax(0, 1fr) minmax(0, 1.2fr) 150px; gap: 14px; align-items: center; }
      .pch-reg-head { padding: 0 16px 6px; font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748b; }
      .pch-reg-head span:last-child { text-align: right; }
      .pch-register { list-style: none; margin: 0; padding: 0; }
      .pch-visit { background: #fff; border: 1px solid #e5e9f0; border-radius: 12px; margin-bottom: 8px; overflow: hidden; }
      .pch-visit.is-open { border-color: #b9cde6; box-shadow: 0 2px 10px rgba(30,79,138,.08); }
      .pch-row { width: 100%; padding: 12px 16px; background: none; border: 0; cursor: pointer; font: inherit; color: inherit; text-align: left; }
      .pch-row:hover { background: #fafbfd; }
      .pch-visit.is-open .pch-row { background: #f3f7fc; border-bottom: 1px solid #e3eaf3; }
      .pch-c-date { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
      .pch-c-date .pch-status { align-self: flex-start; }
      .pch-c-date b { font-size: 14px; font-weight: 800; color: #0b2d4e; white-space: nowrap; }
      .pch-c-teeth { display: flex; gap: 4px; flex-wrap: wrap; }
      .pch-tooth { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 24px; padding: 0 6px; border-radius: 7px; background: #eef4fb; border: 1px solid #c9daee; color: #1e4f8a; font-size: 12.5px; font-weight: 800; }
      .pch-tooth-lg { min-width: 38px; height: 28px; font-size: 13.5px; }
      .pch-c-text { font-size: 13px; color: #1e293b; overflow-wrap: anywhere; }
      .pch-c-done { font-weight: 700; color: #14532d; }
      .pch-c-rec { display: flex; gap: 10px; align-items: center; justify-content: flex-end; font-size: 12px; color: #475569; font-weight: 700; white-space: nowrap; }
      .pch-status { font-size: 10.5px; font-weight: 700; padding: 1px 8px; border-radius: 6px; background: #f1f5f9; color: #475569; }
      .pch-status-live { background: #dcfce7; color: #166534; }
      .pch-chev { font-size: 14px; color: #94a3b8; transition: transform .15s; }
      .pch-chev.open { transform: rotate(180deg); }
      .pch-sheet { padding: 6px 18px 14px; }
      .pch-step { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-bottom: 1px dashed #e3e9f1; }
      .pch-step:last-of-type { border-bottom: 0; }
      .pch-step-n { width: 26px; height: 26px; border-radius: 50%; background: #e8eff8; color: #1e4f8a; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      .pch-step-t { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #5b6b8c; margin: 3px 0 6px; }
      .pch-step-v { font-size: 14px; color: #0f172a; white-space: pre-wrap; overflow-wrap: anywhere; }
      .pch-step-v + .pch-step-v, .pch-step-list + .pch-step-v { margin-top: 5px; }
      .pch-step-list { margin: 0; padding-left: 18px; font-size: 14px; color: #0f172a; }
      .pch-step-list li + li { margin-top: 3px; }
      .pch-step-done .pch-step-n { background: #dcfce7; color: #166534; }
      .pch-step-done .pch-step-v, .pch-step-done .pch-step-list { font-weight: 700; color: #14532d; }
      .pch-k { font-size: 12.5px; font-weight: 700; color: #64748b; }
      .pch-exam { display: flex; flex-direction: column; gap: 6px; }
      .pch-exam-row { display: flex; align-items: center; gap: 10px; font-size: 14px; }
      .pch-exam + .pch-step-list { margin-top: 8px; }
      .pch-step .pch-table-wrap + .pch-receipts, .pch-step-v + .pch-table-wrap { margin-top: 8px; }
      .pch-sheet-foot { margin-top: 6px; padding-top: 10px; border-top: 1px solid #eef2f7; font-size: 12.5px; color: #64748b; text-align: right; }
      .pch-fields { margin: 10px 0 0; display: grid; grid-template-columns: 170px minmax(0, 1fr); border: 1px solid #edf1f6; border-radius: 10px; overflow: hidden; }
      .pch-field { display: contents; }
      .pch-field dt { background: #f7f9fc; padding: 8px 12px; font-size: 11.5px; font-weight: 700; color: #5b6b8c; text-transform: uppercase; letter-spacing: .03em; border-bottom: 1px solid #edf1f6; }
      .pch-field dd { margin: 0; padding: 8px 12px; font-size: 13.5px; color: #0f172a; border-bottom: 1px solid #edf1f6; white-space: pre-wrap; overflow-wrap: anywhere; }
      .pch-field dd ul { margin: 0; padding-left: 18px; }
      .pch-field:last-child dt, .pch-field:last-child dd { border-bottom: 0; }
      .pch-block { background: #fff; border: 1px solid #e5e9f0; border-radius: 12px; padding: 12px 14px; margin-top: 12px; }
      .pch-body > .pch-block:first-child, .pch-body > .pch-chips + .pch-block, .pch-body > .pch-summary-in + .pch-block { margin-top: 0; }
      .pch-block-h { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
      .pch-block-h h4 { margin: 0; font-size: 13px; font-weight: 800; color: #0b2d4e; text-transform: uppercase; letter-spacing: .04em; }
      .pch-table-wrap { overflow-x: auto; border: 1px solid #e7edf5; border-radius: 9px; }
      .pch-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .pch-table th { background: #f1f5fa; color: #334155; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; padding: 8px 12px; white-space: nowrap; }
      .pch-table td { padding: 8px 12px; border-top: 1px solid #eef2f7; vertical-align: top; color: #1e293b; }
      .pch-rx + .pch-rx { margin-top: 10px; }
      .pch-inv { margin-top: 8px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 9px; padding: 8px 12px; }
      .pch-inv-h { font-size: 11.5px; font-weight: 800; color: #6d28d9; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
      .pch-inv ul { margin: 0; padding-left: 18px; font-size: 13.5px; color: #0f172a; }
      .pch-muted { font-size: 12.5px; color: #94a3b8; }
      .pch-ok { display: inline-block; font-size: 12.5px; font-weight: 700; color: #166534; background: #dcfce7; padding: 5px 11px; border-radius: 20px; }
      .pch-note { font-size: 13px; color: #475569; margin-top: 8px; background: #f7f9fc; padding: 8px 10px; border-radius: 8px; }
      .pch-empty { text-align: center; color: #94a3b8; font-size: 13.5px; padding: 30px 10px; background: #fff; border: 1px dashed #dbe3ee; border-radius: 12px; }
      .pch-sheet .pch-empty { margin-top: 10px; padding: 14px; }
      .pch-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .pch-chip { font-family: inherit; font-size: 12.5px; font-weight: 700; padding: 5px 12px; border-radius: 20px; background: #fff; color: #334155; border: 1px solid #dbe3ee; cursor: pointer; }
      .pch-chip span { color: #94a3b8; margin-left: 3px; }
      .pch-chip[aria-pressed="true"] { background: #1e4f8a; border-color: #1e4f8a; color: #fff; }
      .pch-chip[aria-pressed="true"] span { color: rgba(255,255,255,.75); }
      .pch-chip-warn { background: #fee2e2; border-color: #fecaca; color: #991b1b; cursor: default; }
      .pch-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
      .pch-thumb { position: relative; padding: 0; border: 1px solid #dbe3ee; border-radius: 10px; overflow: hidden; background: #0f172a; cursor: zoom-in; font: inherit; aspect-ratio: 4 / 3; }
      .pch-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .pch-thumb-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 24px; background: #f1f5f9; }
      .pch-thumb-tag { position: absolute; left: 6px; top: 6px; font-size: 10.5px; font-weight: 800; color: #fff; background: rgba(15,23,42,.72); border-radius: 5px; padding: 1px 6px; }
      .pch-thumb-date { position: absolute; left: 6px; bottom: 6px; font-size: 10.5px; font-weight: 700; color: #fff; background: rgba(15,23,42,.6); border-radius: 5px; padding: 1px 6px; }
      .pch-receipts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .pch-receipt { font-family: inherit; font-size: 12.5px; padding: 6px 11px; border-radius: 8px; border: 1px solid #a7f3d0; background: #ecfdf5; color: #065f46; cursor: pointer; }
      .pch-receipt:hover { background: #d1fae5; }
      .pch-ap { font-size: 11.5px; font-weight: 800; border-radius: 20px; padding: 2px 9px; white-space: nowrap; }
      .pch-ap-scheduled { background: #eff6ff; color: #1d4ed8; }
      .pch-ap-completed { background: #dcfce7; color: #166534; }
      .pch-ap-cancelled { background: #fee2e2; color: #991b1b; }
      .pch-ap-missed { background: #fef3c7; color: #92400e; }
      .pch-viewer { position: fixed; inset: 0; z-index: 3000; background: rgba(2,6,23,.9); display: flex; flex-direction: column; padding: 14px; color: #fff;
        font-family: 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif; }
      .pch-viewer-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
      .pch-vbtn { font-family: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(255,255,255,.12); color: #fff; cursor: pointer; }
      .pch-vbtn:disabled { opacity: .4; cursor: not-allowed; }
      .pch-vbtn-close { background: #fff; color: #0f172a; }
      .pch-viewer-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
      @media (max-width: 700px) {
        .pch-head { padding: 14px 16px; }
        .pch-avatar { width: 42px; height: 42px; font-size: 18px; }
        .pch-head h2 { font-size: 18px; }
        .pch-allergy { padding: 10px 16px; }
        .pch-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pch-stat { border-bottom: 1px solid #eef1f5; padding: 10px 14px; }
        .pch-stat b { font-size: 17px; }
        .pch-body { padding: 14px 12px 24px; }
        .pch-fields { grid-template-columns: minmax(0, 1fr); }
        .pch-field dt { border-bottom: 0; padding-bottom: 2px; }
        .pch-reg-head { display: none; }
        .pch-row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; }
        .pch-c-date { flex-direction: row; align-items: center; gap: 8px; }
        .pch-c-rec { grid-column: 2; grid-row: 1; }
        .pch-c-teeth, .pch-c-text { grid-column: 1 / -1; }
        .pch-c-teeth:has(.pch-none) { display: none; }
        .pch-sheet { padding: 4px 12px 12px; }
      }
    `}</style>
  );
}