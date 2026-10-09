import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/*
  <AppointmentsBoard />  — appointments from Supabase (the same list the
  Appointments app uses), linked to this clinic's patients.
  ────────────────────────────────────────────────────────────────
  Used by: Reception dashboard (today, compact), the Appointments page
  (/reception/appointments) and the Doctor dashboard (📅 Appointments).

  Shows        Today · Tomorrow · Upcoming · Past · any date
  Each row     time, patient (case no.), treatment, who booked it, status
               (Scheduled / Visit open / Completed / Cancelled)
  Actions      Create visit · Open visit · History · Change date/time ·
               Completed · Cancel · Link to patient (bookings from the
               Appointments app that could not be matched automatically)
  New          ＋ New appointment — choose the patient (or type a name for
               someone not registered yet)

  Kept in step by the server: on the appointment day every booking gets its
  visit (at the booked time) on the Doctor's and Reception's lists; a visit
  created here appears in the Appointments app; the doctor's follow-up dates
  are booked automatically; closing a visit marks the appointment Completed. The list refreshes itself every minute, so bookings made in
  the Appointments app appear here on their own.

  Props
    role           "reception" | "doctor"
    compact        today only, short list (dashboard card)
    onOpenHistory  (patientId)            optional
    onCreateVisit  (patient)              optional (reception) — without it a small
                                          "Create visit" window is used
    onOpenVisit    (visitId)              optional
    onOpenAll      ()                     optional — "All appointments" link in compact mode
*/

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return isoDay(d); };
const today = () => isoDay(new Date());
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(s) {
  if (!s) return "—";
  if (s === today()) return "Today";
  if (s === addDays(1)) return "Tomorrow";
  if (s === addDays(-1)) return "Yesterday";
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]}, ${d} ${MON[m - 1]} ${y}`;
}
function fmtTime(t) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m || 0)} ${h >= 12 ? "PM" : "AM"}`;
}
const errText = (e, fb) => e?.response?.data?.error || e?.response?.data?.message || fb;

function stateOf(a) {
  if (a.state === "CANCELLED") return { key: "cancelled", label: "Cancelled" };
  if (a.state === "COMPLETED") return { key: "completed", label: "Completed" };
  if (a.in_clinic_visit_id) return { key: "inclinic", label: "Visit open" };
  if (a.date < today()) return { key: "missed", label: "Not attended" };
  return { key: "scheduled", label: "Scheduled" };
}
function sourceLabel(a) {
  if (a.source === "appointments-app" || (!a.source && !a.visit_id)) return "Appointments app";
  if (["consultation", "prescription", "visit", "follow-up"].includes(a.source)) return "Doctor's follow-up";
  return "Booked here";
}

/* ── patient picker (search existing patients) ── */
function PatientPicker({ onPick, autoFocus, onState }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setList([]); return undefined; }
    let stop = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await api.get("/patients", { params: { search: s } });
        if (!stop) setList((Array.isArray(res.data) ? res.data : res.data?.patients || []).slice(0, 8));
      } catch { if (!stop) setList([]); }
      finally { if (!stop) setBusy(false); }
    }, 250);
    return () => { stop = true; clearTimeout(t); };
  }, [q]);
  useEffect(() => { if (onState) onState({ q: q.trim(), count: list.length, busy }); }, [q, list.length, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <input className="apb-in" placeholder="Search patient by name, case no. or mobile…" value={q} autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)} aria-label="Search patient" />
      {busy && <div className="apb-hint">Searching…</div>}
      {list.length > 0 && (
        <ul className="apb-picks" role="listbox" aria-label="Patients found">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p)}>
                <b>{p.name}</b> <span>#{p.case_number}{p.age ? ` · ${p.age} yrs` : ""}{p.mobile ? ` · ${p.mobile}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!busy && q.trim().length >= 2 && list.length === 0 && !onState && <div className="apb-hint">No patient found.</div>}
    </div>
  );
}

function Dialog({ title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="apb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="apb-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="apb-dialog-h"><h3>{title}</h3><button type="button" className="apb-x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="apb-dialog-b">{children}</div>
        {footer && <div className="apb-dialog-f">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ── new / change appointment ── */
function nextQuarter() {
  const d = new Date(); d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function ApptForm({ initial, onSaved, onClose }) {
  const editing = Boolean(initial?.id);
  const [patient, setPatient] = useState(initial?.patient || null);
  const [search, setSearch] = useState({ q: "", count: 0, busy: false });
  const [f, setF] = useState({
    date: initial?.date || today(), time: initial?.time || nextQuarter(), treatment: initial?.treatment || "", notes: initial?.notes || "",
    name: "", mobile: "", age: "",
  });
  const [typed, setTyped] = useState({ name: false, mobile: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // nobody found → the search text becomes the new person's name (or mobile, when it is a number)
  // "nobody found" is kept while a new search is running, so the boxes do not flicker
  const [settledNoMatch, setSettledNoMatch] = useState(false);
  useEffect(() => { if (!search.busy) setSettledNoMatch(search.q.length >= 2 && search.count === 0); }, [search]);
  const noMatch = !patient && search.q.length >= 2 && settledNoMatch;
  const isNumber = /^[+\d\s-]{6,}$/.test(search.q);
  const newName = typed.name ? f.name : (isNumber ? "" : search.q);
  const newMobile = typed.mobile ? f.mobile : (isNumber ? search.q.replace(/[^\d+]/g, "") : "");
  const why = editing ? (!f.date ? "Choose the date." : !f.time ? "Choose the time." : "")
    : patient || (noMatch && newName.trim()) ? (!f.date ? "Choose the date." : !f.time ? "Choose the time." : "")
    : search.count > 0 ? "Choose the patient from the list."
    : noMatch ? "Type the patient's name."
    : "Search the patient by name, case no. or mobile.";
  const ready = !why;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      let res;
      if (editing) {
        res = await api.put(`/appointments/${initial.id}`, { date: f.date, time: f.time, treatment: f.treatment, notes: f.notes });
      } else {
        res = await api.post("/appointments", {
          ...(patient ? { patient_id: patient.id } : { name: newName.trim(), mobile: newMobile.trim(), age: f.age }),
          date: f.date, time: f.time, treatment: f.treatment, notes: f.notes, source: "clinic",
        });
      }
      onSaved(res.data);
    } catch (e) { setErr(errText(e, "The appointment could not be saved. Please try again.")); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={editing ? `Change appointment — ${initial.name}` : "New appointment"} onClose={onClose}
      footer={<>
        {why && <span className="apb-why" role="status">{why}</span>}
        <button type="button" className="apb-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="apb-btn apb-main" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : editing ? "Save changes" : "Book appointment"}</button>
      </>}>
      {!editing && (
        patient ? (
          <div className="apb-chosen">
            <div><b>{patient.name}</b> <span>#{patient.case_number}{patient.mobile ? ` · ${patient.mobile}` : ""}</span></div>
            <button type="button" className="apb-link" onClick={() => setPatient(null)}>Change</button>
          </div>
        ) : (
          <>
            <label className="apb-f"><span>Patient *</span></label>
            <PatientPicker onPick={setPatient} autoFocus onState={setSearch} />
            {noMatch && (
              <div className="apb-newperson">
                <div className="apb-newperson-h">🆕 Not registered yet — book with name and mobile</div>
                <div className="apb-grid">
                  <label className="apb-f apb-wide"><span>Name *</span><input className="apb-in" value={newName}
                    onChange={(e) => { setTyped((t) => ({ ...t, name: true })); set("name", e.target.value); }} /></label>
                  <label className="apb-f"><span>Mobile</span><input className="apb-in" inputMode="tel" value={newMobile}
                    onChange={(e) => { setTyped((t) => ({ ...t, mobile: true })); set("mobile", e.target.value); }} /></label>
                  <label className="apb-f"><span>Age</span><input className="apb-in" inputMode="numeric" value={f.age} onChange={(e) => set("age", e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
                </div>
                <div className="apb-hint" style={{ marginTop: 6 }}>When the patient comes, register them — the booking is linked by mobile and gets the case number.</div>
              </div>
            )}
          </>
        )
      )}
      <div className="apb-grid" style={{ marginTop: 12 }}>
        <label className="apb-f"><span>Date *</span><input className="apb-in" type="date" min={editing ? undefined : today()} value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
        <label className="apb-f"><span>Time *</span><input className="apb-in" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} /></label>
        <label className="apb-f apb-wide"><span>Treatment</span><input className="apb-in" placeholder="e.g. RCT IRT 47 – 2nd sitting" value={f.treatment} onChange={(e) => set("treatment", e.target.value)} /></label>
        <label className="apb-f apb-wide"><span>Notes</span><input className="apb-in" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      </div>
      {err && <div className="apb-err" role="alert">{err}</div>}
    </Dialog>
  );
}

/* ── create the visit for a patient who has come (when the page has no visit screen of its own) ── */
function CreateVisitDialog({ appt, onDone, onClose }) {
  const [complaint, setComplaint] = useState("");
  const [followup, setFollowup] = useState(appt.treatment || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const res = await api.post("/visits", { patient_id: appt.patient_id, chief_complaint: complaint.trim(), followup_treatment: followup.trim(), visit_time: appt.time });
      onDone(res.data?.id || res.data?.visit_id || res.data?.visit?.id || null);
    } catch (e) { setErr(errText(e, "The visit could not be created. Please try again.")); setBusy(false); }
  };
  return (
    <Dialog title={`Create visit — ${appt.name}`} onClose={onClose} width={460}
      footer={<>
        <button type="button" className="apb-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="apb-btn apb-main" disabled={busy || !(complaint.trim() || followup.trim())} onClick={save}>{busy ? "Creating…" : "🩺 Create visit for doctor"}</button>
      </>}>
      <label className="apb-f"><span>Chief complaint</span><input className="apb-in" value={complaint} onChange={(e) => setComplaint(e.target.value)} autoFocus /></label>
      <label className="apb-f" style={{ marginTop: 10 }}><span>Follow-up treatment</span><input className="apb-in" value={followup} onChange={(e) => setFollowup(e.target.value)} /></label>
      {err && <div className="apb-err" role="alert">{err}</div>}
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
export default function AppointmentsBoard({ role = "reception", compact = false, onOpenHistory, onCreateVisit, onOpenVisit, onOpenAll }) {
  const [view, setView] = useState("today");
  const [pickDate, setPickDate] = useState(today());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [form, setForm] = useState(null);           // {} new | appointment to change
  const [linking, setLinking] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const [visitFor, setVisitFor] = useState(null);
  const loadSeq = useRef(0);

  const range = useMemo(() => {
    if (compact || view === "today") return { date: today() };
    if (view === "tomorrow") return { date: addDays(1) };
    if (view === "upcoming") return { from: addDays(1), to: addDays(60) };
    if (view === "past") return { from: addDays(-60), to: addDays(-1), order: "desc" };
    return { date: pickDate || today() };
  }, [view, pickDate, compact]);

  const load = useCallback(async (quiet = false) => {
    const n = ++loadSeq.current;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get("/appointments", { params: range });
      if (n !== loadSeq.current) return;
      setRows(Array.isArray(res.data) ? res.data : []);
      setError("");
    } catch (e) {
      if (n !== loadSeq.current) return;
      setError(e?.response?.status === 503 ? "Appointments are not connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render (Environment)."
        : errText(e, "Appointments could not be loaded. Please check the connection."));
    } finally { if (n === loadSeq.current) setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, 60000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((a) => (showCancelled || a.state !== "CANCELLED")
      && (!s || [a.name, a.case_number, a.mobile, a.treatment].some((x) => String(x || "").toLowerCase().includes(s))));
  }, [rows, q, showCancelled]);
  const groups = useMemo(() => {
    const m = new Map();
    shown.forEach((a) => { if (!m.has(a.date)) m.set(a.date, []); m.get(a.date).push(a); });
    return [...m.entries()];
  }, [shown]);
  const counts = useMemo(() => ({
    total: rows.filter((a) => a.state !== "CANCELLED").length,
    waiting: rows.filter((a) => stateOf(a).key === "scheduled").length,
    inclinic: rows.filter((a) => stateOf(a).key === "inclinic").length,
    done: rows.filter((a) => a.state === "COMPLETED").length,
    cancelled: rows.filter((a) => a.state === "CANCELLED").length,
  }), [rows]);

  const replace = (row) => setRows((list) => list.map((x) => (x.id === row.id ? { ...x, ...row } : x)));
  const act = async (a, fn, okText) => {
    setBusyId(a.id);
    try { const res = await fn(); if (res?.data?.id) replace(res.data); if (okText) setNotice(okText); }
    catch (e) { setNotice(errText(e, "That did not work. Please try again.")); }
    finally { setBusyId(null); }
  };
  const markDone = (a) => act(a, () => api.put(`/appointments/${a.id}`, { status: "completed" }), `${a.name}: marked completed.`);
  const reopen = (a) => act(a, () => api.put(`/appointments/${a.id}`, { status: "scheduled" }), `${a.name}: scheduled again.`);
  const doCancel = async () => {
    const a = cancelling;
    setCancelling(null);
    await act(a, () => api.delete(`/appointments/${a.id}`, { data: { reason }, params: { reason } }), `${a.name}: appointment cancelled.`);
    setReason("");
  };
  const doLink = (p) => {
    const a = linking;
    setLinking(null);
    act(a, () => api.post(`/appointments/${a.id}/link`, { patient_id: p.id }), `Linked to ${p.name} (#${p.case_number}).`);
  };
  const patientOf = (a) => ({ id: a.patient_id, name: a.name, case_number: a.case_number, mobile: a.mobile, age: a.age });

  const tabs = [["today", "Today"], ["tomorrow", "Tomorrow"], ["upcoming", "Upcoming"], ["past", "Past"], ["date", "Pick a date"]];

  return (
    <div className={`apb ${compact ? "apb-compact" : ""}`}>
      <Styles />
      <div className="apb-head">
        <div>
          <h3 className="apb-title">📅 {compact ? "Today's appointments" : "Appointments"}</h3>
          <div className="apb-sub">
            {loading ? "Loading…" : error ? "" : `${counts.total} booked · ${counts.waiting} to come · ${counts.inclinic} visit open · ${counts.done} completed`}
          </div>
        </div>
        <div className="apb-head-actions">
          <button type="button" className="apb-btn" onClick={() => load()} title="Refresh">↻</button>
          <button type="button" className="apb-btn apb-main" onClick={() => setForm({})}>＋ New appointment</button>
          {compact && onOpenAll && <button type="button" className="apb-btn" onClick={onOpenAll}>All appointments →</button>}
        </div>
      </div>

      {!compact && (
        <div className="apb-filters">
          <div className="apb-tabs" role="tablist">
            {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className="apb-tab" onClick={() => setView(k)}>{l}</button>)}
          </div>
          {view === "date" && <input className="apb-in apb-date" type="date" value={pickDate} onChange={(e) => setPickDate(e.target.value)} aria-label="Date" />}
          <input className="apb-in apb-search" placeholder="Search name, case no., mobile, treatment…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search appointments" />
          {counts.cancelled > 0 && (
            <label className="apb-check"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled ({counts.cancelled})</label>
          )}
        </div>
      )}

      {notice && <div className="apb-notice" role="status">{notice}</div>}
      {error ? <div className="apb-err" role="alert">{error}</div>
        : loading && rows.length === 0 ? <div className="apb-empty">Loading appointments…</div>
        : shown.length === 0 ? <div className="apb-empty">{compact || view === "today" ? "No appointments today." : "No appointments for this period."}</div>
        : groups.map(([day, list]) => (
          <div key={day} className="apb-day">
            {!(compact || range.date) && <div className="apb-day-h">{dayLabel(day)} <span>{list.length}</span></div>}
            <ul className="apb-list">
              {list.map((a) => {
                const st = stateOf(a);
                const busy = busyId === a.id;
                return (
                  <li key={a.id} className={`apb-row apb-${st.key}`} data-appt={a.id}>
                    <div className="apb-time">{fmtTime(a.time)}</div>
                    <div className="apb-who">
                      <div className="apb-name">
                        {a.linked && onOpenHistory
                          ? <button type="button" className="apb-name-btn" onClick={() => onOpenHistory(a.patient_id)} title="Open history">{a.name}</button>
                          : <span>{a.name}</span>}
                        {a.case_number && <span className="apb-case">#{a.case_number}</span>}
                        {!a.linked && <span className="apb-unlinked" title="Not matched to a registered patient">not linked</span>}
                      </div>
                      <div className="apb-meta">
                        {a.treatment && <span>🦷 {a.treatment}</span>}
                        {a.mobile && <span>📱 {a.mobile}</span>}
                        {a.doctor_name && <span>👨‍⚕️ {a.doctor_name}</span>}
                        <span className="apb-src">{sourceLabel(a)}</span>
                      </div>
                      {a.notes && <div className="apb-notes">{a.notes}</div>}
                    </div>
                    <div className="apb-status"><span className={`apb-chip apb-chip-${st.key}`}>{st.label}</span></div>
                    <div className="apb-actions">
                      {st.key === "scheduled" && a.date === today() && a.linked && role === "reception" && (
                        <button type="button" className="apb-btn apb-main apb-sm" disabled={busy} onClick={() => (onCreateVisit ? onCreateVisit(patientOf(a)) : setVisitFor(a))}>Create visit</button>
                      )}
                      {st.key === "inclinic" && onOpenVisit && (
                        <button type="button" className="apb-btn apb-sm" onClick={() => onOpenVisit(a.in_clinic_visit_id)}>Open visit</button>
                      )}
                      {!a.linked && <button type="button" className="apb-btn apb-sm" disabled={busy} onClick={() => setLinking(a)}>🔗 Link</button>}
                      {a.state === "SCHEDULED" && (
                        <>
                          <button type="button" className="apb-btn apb-sm" disabled={busy} onClick={() => setForm(a)}>Change</button>
                          <button type="button" className="apb-btn apb-sm" disabled={busy} onClick={() => markDone(a)}>✓ Done</button>
                          <button type="button" className="apb-btn apb-sm apb-danger" disabled={busy} onClick={() => { setReason(""); setCancelling(a); }}>Cancel</button>
                        </>
                      )}
                      {a.state !== "SCHEDULED" && a.date >= today() && (
                        <button type="button" className="apb-btn apb-sm" disabled={busy} onClick={() => reopen(a)}>Schedule again</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      {form && (
        <ApptForm initial={form.id ? form : null} onClose={() => setForm(null)}
          onSaved={(row) => {
            setForm(null);
            setNotice(form.id ? `${row.name}: appointment changed to ${dayLabel(row.date)}, ${fmtTime(row.time)}.` : `Booked: ${row.name} — ${dayLabel(row.date)}, ${fmtTime(row.time)}.`);
            load(true);
          }} />
      )}
      {visitFor && (
        <CreateVisitDialog appt={visitFor} onClose={() => setVisitFor(null)}
          onDone={() => { setNotice(`Visit created for ${visitFor.name} — now on the Doctor's dashboard.`); setVisitFor(null); load(true); }} />
      )}
      {linking && (
        <Dialog title={`Link “${linking.name}” to a registered patient`} onClose={() => setLinking(null)}>
          <div className="apb-hint" style={{ marginBottom: 8 }}>Booked for {dayLabel(linking.date)}, {fmtTime(linking.time)}{linking.mobile ? ` · 📱 ${linking.mobile}` : ""}. Choose the patient:</div>
          <PatientPicker onPick={doLink} autoFocus />
        </Dialog>
      )}
      {cancelling && (
        <Dialog title={`Cancel ${cancelling.name}'s appointment?`} onClose={() => setCancelling(null)} width={440}
          footer={<>
            <button type="button" className="apb-btn" onClick={() => setCancelling(null)}>Keep it</button>
            <button type="button" className="apb-btn apb-danger-main" onClick={doCancel}>Cancel appointment</button>
          </>}>
          <div className="apb-hint" style={{ marginBottom: 8 }}>{dayLabel(cancelling.date)}, {fmtTime(cancelling.time)}. It stays in the list as “Cancelled”.</div>
          <label className="apb-f"><span>Reason (optional)</span><input className="apb-in" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
        </Dialog>
      )}
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .apb { font-family: 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif; color: #0f172a; }
      .apb *, .apb-overlay * { box-sizing: border-box; }
      .apb-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
      .apb-title { margin: 0; font-size: 16px; font-weight: 800; color: #0b2d4e; }
      .apb-sub { font-size: 12.5px; color: #64748b; margin-top: 2px; min-height: 16px; }
      .apb-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .apb-btn { font-family: inherit; font-size: 13px; font-weight: 700; border-radius: 9px; padding: 8px 14px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #334155; white-space: nowrap; }
      .apb-btn:hover:not(:disabled) { background: #f8fafc; }
      .apb-btn:disabled { opacity: .5; cursor: not-allowed; }
      .apb-main { background: #1e4f8a; border-color: #1e4f8a; color: #fff; }
      .apb-main:hover:not(:disabled) { background: #173f6f; }
      .apb-sm { font-size: 12px; padding: 5px 10px; border-radius: 7px; }
      .apb-danger { color: #b91c1c; border-color: #fecaca; }
      .apb-danger:hover:not(:disabled) { background: #fef2f2; }
      .apb-danger-main { background: #dc2626; border-color: #dc2626; color: #fff; }
      .apb-link { background: none; border: 0; padding: 0; font: inherit; font-weight: 700; color: #1e4f8a; cursor: pointer; text-decoration: underline; }
      .apb-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
      .apb-tabs { display: flex; gap: 2px; background: #eef2f7; padding: 3px; border-radius: 10px; flex-wrap: wrap; }
      .apb-tab { font: inherit; font-size: 12.5px; font-weight: 700; color: #475569; background: none; border: 0; padding: 6px 12px; border-radius: 8px; cursor: pointer; }
      .apb-tab[aria-selected="true"] { background: #fff; color: #1e4f8a; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
      .apb-in { font-family: inherit; font-size: 13.5px; padding: 8px 11px; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; color: #0f172a; width: 100%; }
      .apb-in:focus { outline: 2px solid #93c5fd; border-color: #1e4f8a; }
      .apb-date { width: auto; }
      .apb-search { flex: 1 1 220px; width: auto; min-width: 0; }
      .apb-check { font-size: 12.5px; color: #475569; display: flex; gap: 6px; align-items: center; }
      .apb-notice { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 8px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 10px; }
      .apb-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 12px; border-radius: 9px; font-size: 13px; margin-top: 8px; }
      .apb-empty { text-align: center; color: #94a3b8; font-size: 13.5px; padding: 28px 10px; border: 1px dashed #dbe3ee; border-radius: 12px; background: #fff; }
      .apb-day { margin-bottom: 12px; }
      .apb-day-h { font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #64748b; margin: 4px 2px 6px; }
      .apb-day-h span { background: #eef2f7; border-radius: 10px; padding: 1px 7px; margin-left: 4px; }
      .apb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .apb-row { display: grid; grid-template-columns: 78px minmax(0, 1fr) 104px auto; gap: 12px; align-items: center; background: #fff; border: 1px solid #e5e9f0; border-left: 4px solid #93c5fd; border-radius: 10px; padding: 10px 12px; }
      .apb-inclinic { border-left-color: #16a34a; background: #f6fef9; }
      .apb-completed { border-left-color: #94a3b8; }
      .apb-completed .apb-name, .apb-cancelled .apb-name { color: #64748b; }
      .apb-cancelled { border-left-color: #fca5a5; opacity: .75; }
      .apb-missed { border-left-color: #f59e0b; }
      .apb-time { font-size: 14px; font-weight: 800; color: #0b2d4e; white-space: nowrap; }
      .apb-name { font-size: 14px; font-weight: 800; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: #0f172a; }
      .apb-name-btn { background: none; border: 0; padding: 0; font: inherit; color: #1e4f8a; cursor: pointer; text-align: left; }
      .apb-name-btn:hover { text-decoration: underline; }
      .apb-case { font-size: 12px; font-weight: 700; color: #64748b; }
      .apb-unlinked { font-size: 10.5px; font-weight: 800; color: #92400e; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 0 6px; }
      .apb-meta { display: flex; gap: 4px 12px; flex-wrap: wrap; font-size: 12.5px; color: #475569; margin-top: 2px; }
      .apb-src { color: #94a3b8; }
      .apb-notes { font-size: 12px; color: #64748b; margin-top: 3px; font-style: italic; overflow-wrap: anywhere; }
      .apb-chip { display: inline-block; font-size: 11px; font-weight: 800; border-radius: 20px; padding: 3px 10px; white-space: nowrap; }
      .apb-chip-scheduled { background: #eff6ff; color: #1d4ed8; }
      .apb-chip-inclinic { background: #dcfce7; color: #166534; }
      .apb-chip-completed { background: #f1f5f9; color: #475569; }
      .apb-chip-cancelled { background: #fee2e2; color: #991b1b; }
      .apb-chip-missed { background: #fef3c7; color: #92400e; }
      .apb-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .apb-compact .apb-row { grid-template-columns: 74px minmax(0, 1fr) 96px auto; }
      .apb-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(10,20,40,.5); display: flex; align-items: flex-start; justify-content: center; padding: 6vh 14px 14px; overflow-y: auto;
        font-family: 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif; }
      .apb-dialog { width: 100%; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
      .apb-dialog-h { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #eef2f7; }
      .apb-dialog-h h3 { margin: 0; font-size: 15.5px; font-weight: 800; color: #0b2d4e; }
      .apb-x { border: 0; background: #f1f5f9; border-radius: 8px; width: 30px; height: 30px; cursor: pointer; font-size: 14px; }
      .apb-dialog-b { padding: 16px 18px; }
      .apb-dialog-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid #eef2f7; flex-wrap: wrap; }
      .apb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
      .apb-wide { grid-column: 1 / -1; }
      .apb-f { display: flex; flex-direction: column; gap: 4px; }
      .apb-f > span { font-size: 11.5px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .04em; }
      .apb-hint { font-size: 12.5px; color: #64748b; }
      .apb-picks { list-style: none; margin: 6px 0 0; padding: 0; border: 1px solid #e5e9f0; border-radius: 9px; max-height: 260px; overflow-y: auto; }
      .apb-picks button { width: 100%; text-align: left; background: #fff; border: 0; border-bottom: 1px solid #f1f4f8; padding: 9px 12px; font: inherit; font-size: 13.5px; cursor: pointer; }
      .apb-picks button:hover { background: #f3f7fc; }
      .apb-picks span { color: #64748b; font-size: 12.5px; }
      .apb-why { margin-right: auto; align-self: center; font-size: 12.5px; color: #92400e; }
      .apb-newperson { margin-top: 10px; border: 1px dashed #fcd34d; background: #fffbeb; border-radius: 10px; padding: 10px 12px; }
      .apb-newperson-h { font-size: 12.5px; font-weight: 800; color: #92400e; margin-bottom: 8px; }
      .apb-chosen { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: #f3f7fc; border: 1px solid #c9daee; border-radius: 9px; padding: 9px 12px; font-size: 14px; }
      .apb-chosen span { color: #64748b; font-size: 12.5px; }
      @media (max-width: 680px) {
        .apb-row, .apb-compact .apb-row { grid-template-columns: 64px minmax(0, 1fr); }
        .apb-status { grid-column: 2; }
        .apb-actions { grid-column: 1 / -1; justify-content: flex-start; }
        .apb-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}