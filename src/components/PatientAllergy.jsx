import { useEffect, useState } from "react";
import api from "../api/api";

/**
 * PatientAllergy
 * ---------------
 * Props:
 *  - patientId (number)  ✅ REQUIRED
 *  - readOnly (boolean)  optional (doctor view)
 *
 * NOTE: This component was rewritten to match the actual backend shape.
 * AllergyRecord is a per-row model (patient_id, type, allergen, reaction,
 * severity, notes) — a patient can have MANY allergy rows, not a fixed
 * set of Yes/No flags. GET /allergies/<patient_id> returns
 * { rows: [...] } and PUT /allergies/<patient_id> replaces the full set
 * of rows (see save_allergies() in allergies.py, which deletes existing
 * rows and re-inserts). Because of that, this component now manages its
 * own local `rows` state instead of relying on a parent-owned
 * allergy/setAllergy object shaped around boolean flags.
 */

const ALLERGY_TYPES = ["Food", "Drug", "Latex", "Iodine", "Anesthesia", "Other"];
const SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe"];

const emptyRow = () => ({
  id: null, // null = not yet saved to backend
  type: "",
  allergen: "",
  reaction: "",
  severity: "",
  notes: "",
});

export default function PatientAllergy({
  patientId,
  allergy,
  setAllergy,
  readOnly = false,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    setLoading(true);
    api
      .get(`/allergies/${patientId}`)
      .then((res) => {
        const data = res.data || {};
        const fetched = (data.rows || []).map((r) => ({
  id: r.id,
  type: r.type || "",
  allergen: r.allergen || "",
  reaction: r.reaction || "",
  severity: r.severity || "",
  notes: r.notes || "",
}));

setRows(fetched);

if (setAllergy) {
  setAllergy({ rows: fetched });
}
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patientId]);

  const updateRow = (index, field, value) => {
    if (readOnly) return;
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const addRow = () => {
    if (readOnly) return;
    setRows((prev) => [...prev, emptyRow()]);
  };

  const removeRow = (index) => {
    if (readOnly) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const saveAllergies = async () => {
    if (!patientId) return;
    setSaving(true);
    try {
      // Mirrors backend: rows with an empty allergen are dropped
      // (save_allergies() skips them too, but filtering client-side
      // avoids a confusing "vanishing row" after save).
      const payload = {
        rows: rows
          .map((r) => ({
            type: r.type,
            allergen: (r.allergen || "").trim(),
            reaction: r.reaction,
            severity: r.severity,
            notes: r.notes,
          }))
          .filter((r) => r.allergen !== ""),
      };
      const res = await api.put(`/allergies/${patientId}`, payload);
      const saved = (res.data?.rows || []).map((r) => ({
        id: r.id,
        type: r.type || "",
        allergen: r.allergen || "",
        reaction: r.reaction || "",
        severity: r.severity || "",
        notes: r.notes || "",
      }));
      setRows(saved);
      alert("Allergy details saved");
    } catch (err) {
      console.error("Allergy save failed", err);
      alert(err?.response?.data?.error || "Failed to save allergy details");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.section}>
      <div style={styles.subHeading}>
        <span style={styles.subHeadingBar} />
        Allergy Information
      </div>

      {loading && <div style={styles.emptyState}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div style={styles.emptyState}>
          No known allergies recorded.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={styles.rowsWrap}>
          {rows.map((row, i) => (
            <div key={row.id ?? `new-${i}`} style={styles.rowCard}>
              <div style={styles.rowGrid}>
                <div style={styles.fieldCol}>
                  <label style={styles.label}>Type</label>
                  {readOnly ? (
                    <span style={styles.readOnlyText}>{row.type || "—"}</span>
                  ) : (
                    <select
                      style={styles.input}
                      value={row.type}
                      onChange={(e) => updateRow(i, "type", e.target.value)}
                    >
                      <option value="">Select…</option>
                      {ALLERGY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={styles.fieldCol}>
                  <label style={styles.label}>
                    Allergen<span style={styles.required}>*</span>
                  </label>
                  {readOnly ? (
                    <span style={styles.readOnlyText}>{row.allergen || "—"}</span>
                  ) : (
                    <input
                      style={styles.input}
                      placeholder="e.g. Penicillin"
                      value={row.allergen}
                      onChange={(e) => updateRow(i, "allergen", e.target.value)}
                    />
                  )}
                </div>

                <div style={styles.fieldCol}>
                  <label style={styles.label}>Reaction</label>
                  {readOnly ? (
                    <span style={styles.readOnlyText}>{row.reaction || "—"}</span>
                  ) : (
                    <input
                      style={styles.input}
                      placeholder="e.g. Rash, swelling"
                      value={row.reaction}
                      onChange={(e) => updateRow(i, "reaction", e.target.value)}
                    />
                  )}
                </div>

                <div style={styles.fieldCol}>
                  <label style={styles.label}>Severity</label>
                  {readOnly ? (
                    <span style={styles.readOnlyText}>{row.severity || "—"}</span>
                  ) : (
                    <select
                      style={styles.input}
                      value={row.severity}
                      onChange={(e) => updateRow(i, "severity", e.target.value)}
                    >
                      <option value="">Select…</option>
                      {SEVERITY_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div style={styles.fieldCol}>
                <label style={styles.label}>Notes</label>
                {readOnly ? (
                  <span style={styles.readOnlyText}>{row.notes || "—"}</span>
                ) : (
                  <textarea
                    style={{ ...styles.input, ...styles.textarea }}
                    placeholder="Additional notes…"
                    value={row.notes}
                    onChange={(e) => updateRow(i, "notes", e.target.value)}
                  />
                )}
              </div>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  style={styles.removeBtn}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div style={styles.actionsRow}>
          <button type="button" onClick={addRow} style={styles.addBtn}>
            + Add Allergy
          </button>
          <button
            type="button"
            onClick={saveAllergies}
            disabled={saving}
            style={styles.saveBtn}
          >
            {saving ? "Saving…" : "Save Allergy"}
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  section: { display: "flex", flexDirection: "column", gap: 6 },
  subHeading: {
    display: "flex", alignItems: "center", gap: 9,
    fontSize: 13, fontWeight: 700, color: "#1a1f36",
    marginBottom: 14,
  },
  subHeadingBar: {
    display: "block", width: 3, height: 16,
    background: "linear-gradient(180deg, #2563eb, #60a5fa)",
    borderRadius: 2, flexShrink: 0,
  },
  emptyState: {
    fontSize: 13, color: "#64748b", fontStyle: "italic",
    padding: "10px 2px",
  },
  rowsWrap: {
    display: "flex", flexDirection: "column", gap: 12,
  },
  rowCard: {
    background: "#f8faff",
    border: "1.5px solid #e8edf8",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex", flexDirection: "column", gap: 10,
  },
  rowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
  },
  fieldCol: { display: "flex", flexDirection: "column", gap: 5 },
  label: {
    fontSize: 11, fontWeight: 700, color: "#475569",
    letterSpacing: "0.4px", textTransform: "uppercase",
  },
  required: { color: "#e03e3e", marginLeft: 2 },
  input: {
    width: "100%", padding: "8px 11px",
    border: "1.5px solid #dde8fb", borderRadius: 8,
    fontFamily: "inherit", fontSize: 13, color: "#1a1f36",
    background: "#fff", outline: "none",
    transition: "border-color 0.18s",
    boxSizing: "border-box",
  },
  textarea: {
    minHeight: 54, resize: "vertical",
  },
  readOnlyText: {
    fontSize: 13, color: "#334155",
  },
  removeBtn: {
    alignSelf: "flex-start",
    padding: "5px 12px",
    background: "#fff0f0",
    border: "1.5px solid #f87171",
    color: "#991b1b",
    borderRadius: 8,
    fontFamily: "inherit", fontSize: 12, fontWeight: 600,
    cursor: "pointer",
  },
  actionsRow: {
    marginTop: 14, display: "flex", gap: 10,
  },
  addBtn: {
    padding: "10px 20px",
    background: "#fff",
    color: "#2563eb",
    border: "1.5px solid #2563eb",
    borderRadius: 10,
    fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer",
  },
  saveBtn: {
    padding: "10px 28px",
    background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
    color: "#fff",
    border: "none", borderRadius: 10,
    fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(37,99,235,0.32)",
    transition: "opacity 0.15s",
  },
};