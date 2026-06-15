import { useEffect, useState } from "react";
import api from "../api/api";

/**
 * PatientAllergy
 * ---------------
 * Props:
 *  - patientId (number)  ✅ REQUIRED
 *  - readOnly (boolean)  optional (doctor view)
 */
export default function PatientAllergy({ patientId, readOnly = false }) {
  const [loading, setLoading] = useState(false);

  // null = unanswered, true = Yes, false = No
  const [allergy, setAllergy] = useState({
    drug_allergy:       null,
    food_allergy:       null,
    latex_allergy:      null,
    iodine_allergy:     null,
    anesthesia_allergy: null,
    other_allergy:      null,
    other_allergy_detail: "",
  });

  useEffect(() => {
    if (!patientId) return;
    api
      .get(`/allergies/${patientId}`)
      .then((res) => {
        if (res.data) setAllergy({ ...allergy, ...res.data });
      })
      .catch(() => {});
  }, [patientId]);

  const toggle = (field, val) => {
    if (readOnly) return;
    setAllergy((prev) => ({
      ...prev,
      [field]: val,
      ...(field === "other_allergy" && !val ? { other_allergy_detail: "" } : {}),
    }));
  };

  const saveAllergy = async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      await api.put(`/allergies/${patientId}`, allergy);
      alert("Allergy details saved");
    } catch (err) {
      console.error("Allergy save failed", err);
      alert("Failed to save allergy details");
    } finally {
      setLoading(false);
    }
  };

  const FIELDS = [
    { key: "drug_allergy",       label: "Drug Allergy" },
    { key: "food_allergy",       label: "Food Allergy" },
    { key: "latex_allergy",      label: "Latex Allergy" },
    { key: "iodine_allergy",     label: "Iodine Allergy" },
    { key: "anesthesia_allergy", label: "Anesthesia Allergy" },
    { key: "other_allergy",      label: "Other Allergy" },
  ];

  const YesNoField = ({ fieldKey, label }) => {
    const val = allergy[fieldKey]; // null | true | false
    const isAnswered = val !== null && val !== undefined;
    const isYes = val === true;

    return (
      <div style={styles.fieldRow}>
        <div style={styles.labelRow}>
          <span style={styles.label}>
            {label}
            <span style={styles.required}>*</span>
          </span>
          {!readOnly && (
            <div style={styles.toggleGroup}>
              <button
                type="button"
                onClick={() => toggle(fieldKey, true)}
                style={{
                  ...styles.toggleBtn,
                  ...(isYes ? styles.toggleBtnYes : {}),
                }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => toggle(fieldKey, false)}
                style={{
                  ...styles.toggleBtn,
                  ...(!isYes && isAnswered ? styles.toggleBtnNo : {}),
                }}
              >
                No
              </button>
            </div>
          )}
          {readOnly && (
            <span style={{
              ...styles.readOnlyBadge,
              ...(isYes ? styles.badgeYes : styles.badgeNo),
            }}>
              {isYes ? "Yes" : isAnswered ? "No" : "—"}
            </span>
          )}
          {!readOnly && !isAnswered && (
            <span style={styles.errorMsg}>⚠ Required</span>
          )}
        </div>
        {isYes && fieldKey === "other_allergy" && !readOnly && (
          <input
            style={styles.detailInput}
            placeholder="Please specify allergy…"
            value={allergy.other_allergy_detail || ""}
            onChange={(e) =>
              setAllergy((prev) => ({ ...prev, other_allergy_detail: e.target.value }))
            }
          />
        )}
        {isYes && fieldKey === "other_allergy" && readOnly && allergy.other_allergy_detail && (
          <span style={styles.detailText}>{allergy.other_allergy_detail}</span>
        )}
      </div>
    );
  };

  return (
    <div style={styles.section}>
      <div style={styles.subHeading}>
        <span style={styles.subHeadingBar} />
        Allergy Information
      </div>
      <div style={styles.grid}>
        {FIELDS.map(({ key, label }) => (
          <YesNoField key={key} fieldKey={key} label={label} />
        ))}
      </div>

      {!readOnly && (
        <button
          onClick={saveAllergy}
          disabled={loading}
          style={styles.saveBtn}
        >
          {loading ? "Saving…" : "Save Allergy"}
        </button>
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
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  },
  fieldRow: {
    background: "#f8faff",
    border: "1.5px solid #e8edf8",
    borderRadius: 10,
    padding: "11px 14px",
    display: "flex", flexDirection: "column", gap: 8,
  },
  labelRow: {
    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  },
  label: {
    fontSize: 12, fontWeight: 700, color: "#475569",
    letterSpacing: "0.4px", textTransform: "uppercase",
    flex: 1,
  },
  required: { color: "#e03e3e", marginLeft: 2 },
  toggleGroup: { display: "flex", gap: 5 },
  toggleBtn: {
    padding: "4px 14px",
    borderRadius: 20,
    border: "1.5px solid #d1d9ef",
    background: "#fff",
    color: "#6b7a99",
    fontSize: 12, fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "inherit",
  },
  toggleBtnYes: {
    background: "#ecfdf5", borderColor: "#10b981", color: "#065f46",
  },
  toggleBtnNo: {
    background: "#fff0f0", borderColor: "#f87171", color: "#991b1b",
  },
  errorMsg: {
    fontSize: 11, color: "#e03e3e", fontWeight: 600,
  },
  readOnlyBadge: {
    fontSize: 11.5, fontWeight: 700, padding: "3px 10px",
    borderRadius: 20, border: "1.5px solid transparent",
  },
  badgeYes: {
    background: "#ecfdf5", borderColor: "#10b981", color: "#065f46",
  },
  badgeNo: {
    background: "#f1f5f9", borderColor: "#cbd5e1", color: "#64748b",
  },
  detailInput: {
    width: "100%", padding: "8px 11px",
    border: "1.5px solid #dde8fb", borderRadius: 8,
    fontFamily: "inherit", fontSize: 13, color: "#1a1f36",
    background: "#fff", outline: "none",
    transition: "border-color 0.18s",
    boxSizing: "border-box",
  },
  detailText: {
    fontSize: 13, color: "#334155", fontStyle: "italic",
  },
  saveBtn: {
    marginTop: 14,
    padding: "10px 28px",
    background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
    color: "#fff",
    border: "none", borderRadius: 10,
    fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(37,99,235,0.32)",
    transition: "opacity 0.15s",
    alignSelf: "flex-start",
  },
};