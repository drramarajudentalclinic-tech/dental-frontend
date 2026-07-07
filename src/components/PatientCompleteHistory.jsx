import { useEffect, useState } from "react";
import api from "../api/api";

/*
  <PatientCompleteHistory />
  ────────────────────────────────────────────────────────────────
  Read-only "View Complete Patient History" screen.
  Used by BOTH:
    • Doctor Dashboard   → Search Existing Patient → View Complete History
    • Reception Dashboard → Search Patient → View Complete Patient History

  Data source: GET /api/patients/<patient_id>/complete-history
  (implemented in patients.py — returns demographics, medical history,
  allergies, habits, women's history, medications, family doctor, consent,
  and every visit with dental chart, findings, consultations,
  prescriptions, images, and payments.)

  Props:
    patientId     (number, required)  — patient to load
    onBack        (fn, required)      — called when "Back" is clicked
    onCreateVisit (fn, optional)      — called with patientId when
                                         "Create Visit" is clicked and the
                                         patient has NO active visit
    onOpenVisit   (fn, optional)      — called with visitId when the
                                         patient DOES have an active visit
                                         and the user wants to open it
                                         (mainly used by the Doctor view)
    readOnlyLabel (string, optional)  — small badge text, e.g.
                                         "Reception — Read Only"
*/
export default function PatientCompleteHistory({
  patientId,
  onBack,
  onCreateVisit,
  onOpenVisit,
  readOnlyLabel = "Read Only",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [expandedVisit, setExpandedVisit] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/patients/${patientId}/complete-history`);
        if (!cancelled) {
          setData(res.data);
          if (res.data?.visits?.length) {
            setExpandedVisit(res.data.visits[0].visit_id);
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Failed to load patient history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  const handleCreateVisit = async () => {
    if (!onCreateVisit) return;
    setCreating(true);
    try {
      await onCreateVisit(patientId);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div style={s.overlay}>
        <div style={s.panel}>
          <div style={s.loadingBox}>Loading complete patient history…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={s.overlay}>
        <div style={s.panel}>
          <div style={s.loadingBox}>{error || "No data found."}</div>
          <button style={s.backBtn} onClick={onBack}>← Back</button>
        </div>
      </div>
    );
  }

  const {
    patient, medical_history, woman_history, allergies,
    habits = [], medications = [], family_doctor, consent,
    has_active_visit, active_visit_id, visits = [],
  } = data;

  const activeConditions = medical_history
    ? Object.entries(medical_history).filter(([k, v]) => v === true && k !== "no_known_conditions")
    : [];

  return (
    <div style={s.overlay}>
      <div style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={s.badge}>{readOnlyLabel}</div>
            <h2 style={s.name}>{patient.name}</h2>
            <div style={s.metaRow}>
              <span>Case #{patient.case_number}</span>
              <span>{patient.age} yrs</span>
              <span>{patient.gender}</span>
              {patient.mobile && <span>📱 {patient.mobile}</span>}
              {patient.blood_group && <span>🩸 {patient.blood_group}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {has_active_visit ? (
              onOpenVisit && (
                <button style={s.primaryBtn} onClick={() => onOpenVisit(active_visit_id)}>
                  Open Current Visit →
                </button>
              )
            ) : (
              onCreateVisit && (
                <button style={s.primaryBtn} onClick={handleCreateVisit} disabled={creating}>
                  {creating ? "Creating…" : "+ Create Visit"}
                </button>
              )
            )}
            <button style={s.backBtn} onClick={onBack}>← Back</button>
          </div>
        </div>

        <div style={s.body}>

          {/* Demographics */}
          <Section title="Demographics">
            <Grid>
              <Cell label="Address" value={patient.address} />
              <Cell label="Profession" value={patient.profession} />
              <Cell label="Marital Status" value={patient.marital_status} />
              <Cell label="Email" value={patient.email} />
              <Cell label="Referred By" value={patient.referred_by} />
              <Cell label="Chief Complaint" value={patient.chief_complaint} />
            </Grid>
          </Section>

          {/* Medical History */}
          <Section title="Medical History">
            {!medical_history || medical_history.no_known_conditions ? (
              <EmptyPill text="No known medical conditions" />
            ) : activeConditions.length === 0 ? (
              <EmptyPill text="No conditions recorded" />
            ) : (
              <div style={s.chipRow}>
                {activeConditions.map(([k]) => (
                  <span key={k} style={s.chipWarn}>{formatLabel(k)}</span>
                ))}
              </div>
            )}
            {medical_history?.other && (
              <div style={s.note}>Other: {medical_history.other}</div>
            )}
          </Section>

          {/* Allergies */}
          <Section title="Allergies">
            {!allergies || (!allergies.drug_allergy && !allergies.food_allergy && !allergies.latex_allergy &&
              !allergies.iodine_allergy && !allergies.anesthesia_allergy && !allergies.other_allergy) ? (
              <EmptyPill text={allergies?.no_known_allergies ? "Confirmed: No known allergies" : "No known allergies"} />
            ) : (
              <div style={s.chipRow}>
                {allergies.drug_allergy && <span style={s.chipWarn}>💊 Drug Allergy</span>}
                {allergies.food_allergy && <span style={s.chipWarn}>🍽️ Food Allergy</span>}
                {allergies.latex_allergy && <span style={s.chipWarn}>🧤 Latex Allergy</span>}
                {allergies.iodine_allergy && <span style={s.chipWarn}>🧪 Iodine Allergy</span>}
                {allergies.anesthesia_allergy && <span style={s.chipWarn}>💉 Anesthesia Allergy</span>}
                {allergies.other_allergy && <span style={s.chipWarn}>❗ {allergies.other_allergy}</span>}
              </div>
            )}
          </Section>

          {/* Habits */}
          <Section title="Habits">
            {habits.length === 0 || habits.every(h => h.no_habits) ? (
              <EmptyPill text="No habits recorded" />
            ) : (
              <Grid>
                {habits.map((h, i) => (
                  <div key={i} style={{ gridColumn: "1 / -1" }}>
                    {["smoking", "alcohol", "tobacco", "pan_chewing", "spicy_foods"]
                      .filter(f => h[f])
                      .map(f => (
                        <Cell key={f} label={formatLabel(f)} value={h[f]} />
                      ))}
                  </div>
                ))}
              </Grid>
            )}
          </Section>

          {/* Women's History */}
          {woman_history && (
            <Section title="Women's History">
              <Grid>
                <Cell label="Pregnant" value={woman_history.pregnant ? "Yes" : "No"} />
                <Cell label="Due Date" value={woman_history.due_date} />
                <Cell label="Nursing Child" value={woman_history.nursing_child ? "Yes" : "No"} />
              </Grid>
            </Section>
          )}

          {/* Current Medications */}
          <Section title="Current Medications">
            {medications.length === 0 ? (
              <EmptyPill text="No current medications" />
            ) : (
              <Table
                headers={["Medicine", "Dosage", "Frequency", "Duration", "Purpose", "Prescribed By"]}
                rows={medications.map(m => [m.medicine_name, m.dosage, m.frequency, m.duration, m.purpose, m.prescribed_by])}
              />
            )}
          </Section>

          {/* Family Doctor + Consent */}
          <Section title="Family Doctor & Consent">
            <Grid>
              <Cell label="Family Doctor" value={family_doctor?.doctor_name} />
              <Cell label="Doctor Phone" value={family_doctor?.doctor_phone} />
              <Cell label="Consent Signed" value={consent?.agreed ? "Yes" : "No"} />
              <Cell label="Consent Date" value={consent?.consent_date} />
            </Grid>
          </Section>

          {/* Visit History */}
          <Section title={`Visit History (${visits.length})`}>
            {visits.length === 0 ? (
              <EmptyPill text="No previous visits" />
            ) : (
              visits.map(v => (
                <VisitBlock
                  key={v.visit_id}
                  visit={v}
                  expanded={expandedVisit === v.visit_id}
                  onToggle={() =>
                    setExpandedVisit(expandedVisit === v.visit_id ? null : v.visit_id)
                  }
                />
              ))
            )}
          </Section>

        </div>

        <div style={s.footer}>
          {has_active_visit
            ? onOpenVisit && (
                <button style={s.primaryBtn} onClick={() => onOpenVisit(active_visit_id)}>
                  Open Current Visit →
                </button>
              )
            : onCreateVisit && (
                <button style={s.primaryBtn} onClick={handleCreateVisit} disabled={creating}>
                  {creating ? "Creating…" : "+ Create Visit"}
                </button>
              )}
          <button style={s.backBtn} onClick={onBack}>← Back</button>
        </div>
      </div>
    </div>
  );
}

/* ── Visit block ── */
function VisitBlock({ visit, expanded, onToggle }) {
  return (
    <div style={s.visitCard}>
      <div style={s.visitHeader} onClick={onToggle}>
        <div>
          <strong>{visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : "—"}</strong>
          <span style={s.statusPill}>{visit.status}</span>
        </div>
        <span>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={s.visitBody}>
          <Grid>
            <Cell label="Chief Complaint" value={visit.chief_complaint} />
            <Cell label="Diagnosis" value={visit.diagnosis} />
            <Cell label="Treatment Plan" value={visit.treatment_plan} />
            <Cell label="Treatment Done" value={visit.treatment_done} />
            <Cell label="Advice" value={visit.advice} />
            <Cell label="Doctor" value={visit.assigned_doctor} />
            <Cell label="Next Appointment" value={visit.next_appointment} />
            <Cell label="Billing Note" value={visit.billing_note} />
          </Grid>

          {visit.dental_chart?.length > 0 && (
            <SubSection title="Dental Chart">
              <Table
                headers={["Tooth", "Condition", "Severity", "Surface", "Notes"]}
                rows={visit.dental_chart.map(d => [d.tooth_number, d.condition, d.severity, d.surface, d.notes])}
              />
            </SubSection>
          )}

          {visit.other_findings?.length > 0 && (
            <SubSection title="Other Findings">
              <Table
                headers={["Type", "Value", "Notes"]}
                rows={visit.other_findings.map(f => [f.finding_type, f.value, f.notes])}
              />
            </SubSection>
          )}

          {visit.consultations?.length > 0 && (
            <SubSection title="Consultation">
              {visit.consultations.map(c => (
                <div key={c.id} style={s.note}>
                  <Grid>
                    <Cell label="Diagnosis" value={c.diagnosis} />
                    <Cell label="Treatment Today" value={c.treatment_done_today} />
                    <Cell label="Treatment Plan" value={c.treatment_plan} />
                    <Cell label="Advice" value={c.advice} />
                  </Grid>
                </div>
              ))}
            </SubSection>
          )}

          {visit.prescriptions?.length > 0 && (
            <SubSection title="Prescriptions">
              {visit.prescriptions.map(p => (
                <div key={p.id} style={s.note}>
                  Diagnosis: {p.diagnosis || "—"} | Advice: {p.advice || "—"}
                </div>
              ))}
            </SubSection>
          )}

          {visit.images?.length > 0 && (
            <SubSection title="X-Ray / Intra-Oral Images">
              <div style={s.imgGrid}>
                {visit.images.map(img => (
                  <a key={img.id} href={img.image_path} target="_blank" rel="noreferrer" style={s.imgThumbLink}>
                    <img src={img.image_path} alt={img.image_type} style={s.imgThumb} />
                    <span>{img.image_type}</span>
                  </a>
                ))}
              </div>
            </SubSection>
          )}

          {visit.payments?.length > 0 && (
            <SubSection title="Payments">
              <Table
                headers={["Fee", "Discount", "Paid", "Balance", "Method", "Receipt #"]}
                rows={visit.payments.map(p => [p.fee, p.discount, p.paid_amount, p.balance, p.payment_method, p.receipt_number])}
              />
            </SubSection>
          )}
        </div>
      )}
    </div>
  );
}

/* ── small presentational helpers ── */
const Section = ({ title, children }) => (
  <div style={s.section}>
    <div style={s.sectionTitle}>{title}</div>
    {children}
  </div>
);
const SubSection = ({ title, children }) => (
  <div style={{ marginTop: 14 }}>
    <div style={s.subTitle}>{title}</div>
    {children}
  </div>
);
const Grid = ({ children }) => <div style={s.grid}>{children}</div>;
const Cell = ({ label, value }) => (
  !value ? null : (
    <div style={s.cell}>
      <div style={s.cellLabel}>{label}</div>
      <div style={s.cellValue}>{String(value)}</div>
    </div>
  )
);
const EmptyPill = ({ text }) => <div style={s.emptyPill}>✓ {text}</div>;
const Table = ({ headers, rows }) => (
  <div style={s.tableWrap}>
    <table style={s.table}>
      <thead>
        <tr>{headers.map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => <td key={j} style={s.td}>{c || "—"}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
const formatLabel = (k) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/* ── styles ── */
const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(10,20,40,0.55)", zIndex: 1000, display: "flex", justifyContent: "flex-end" },
  panel: { width: "min(880px, 100%)", height: "100%", background: "#f7f9fe", display: "flex", flexDirection: "column", boxShadow: "-8px 0 30px rgba(0,0,0,0.2)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "22px 28px", background: "#fff", borderBottom: "1px solid #e6ecf7" },
  badge: { display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#0e7490", background: "#ecfeff", border: "1px solid #a5f3fc", padding: "3px 10px", borderRadius: 20, marginBottom: 8 },
  name: { margin: 0, fontSize: 22, color: "#0b2d4e" },
  metaRow: { display: "flex", gap: 14, fontSize: 13, color: "#64748b", marginTop: 6, flexWrap: "wrap" },
  primaryBtn: { background: "#2563eb", color: "#fff", border: "none", padding: "10px 18px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  backBtn: { background: "#fff", color: "#334155", border: "1px solid #cbd5e1", padding: "10px 18px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  body: { flex: 1, overflowY: "auto", padding: "20px 28px" },
  footer: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 28px", background: "#fff", borderTop: "1px solid #e6ecf7" },
  loadingBox: { padding: 60, textAlign: "center", color: "#64748b" },
  section: { background: "#fff", borderRadius: 14, border: "1px solid #e6ecf7", padding: "18px 20px", marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 800, color: "#0b2d4e", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  subTitle: { fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  cell: { background: "#f7f9fe", border: "1px solid #edf1fa", borderRadius: 10, padding: "10px 12px" },
  cellLabel: { fontSize: 10, fontWeight: 700, color: "#8899bb", textTransform: "uppercase", marginBottom: 3 },
  cellValue: { fontSize: 13, fontWeight: 600, color: "#1a2540" },
  emptyPill: { display: "inline-block", fontSize: 12, fontWeight: 600, color: "#166534", background: "#dcfce7", padding: "6px 12px", borderRadius: 20 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  chipWarn: { fontSize: 12, fontWeight: 700, color: "#991b1b", background: "#fee2e2", padding: "5px 12px", borderRadius: 20 },
  note: { fontSize: 12.5, color: "#475569", marginTop: 8, background: "#f7f9fe", padding: 10, borderRadius: 8 },
  tableWrap: { borderRadius: 10, overflow: "hidden", border: "1px solid #e4ecfb" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "8px 12px", textAlign: "left", fontSize: 10.5, fontWeight: 700, background: "#1e3a6e", color: "#fff", textTransform: "uppercase" },
  td: { padding: "8px 12px", fontSize: 12.5, color: "#2d3a55", borderBottom: "1px solid #f0f3fb" },
  visitCard: { border: "1px solid #e4ecfb", borderRadius: 12, marginBottom: 10, overflow: "hidden" },
  visitHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f0f4fc", cursor: "pointer", fontSize: 13 },
  statusPill: { marginLeft: 10, fontSize: 10.5, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: "#dbeafe", color: "#1e40af" },
  visitBody: { padding: "16px" },
  imgGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 },
  imgThumbLink: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 10, color: "#475569", textDecoration: "none" },
  imgThumb: { width: "100%", height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid #e4ecfb" },
};