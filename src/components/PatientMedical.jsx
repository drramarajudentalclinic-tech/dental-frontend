export default function PatientMedical({ data = {}, setData }) {
  const MEDICAL_FIELDS = [
    { key: "AIDS", label: "AIDS" },
    { key: "Asthma", label: "Asthma" },
    { key: "Arthritis_Rheumatism", label: "Arthritis / Rheumatism" },
    { key: "Blood_Disease", label: "Blood Disease" },
    { key: "Blood_Pressure_High", label: "High Blood Pressure" },
    { key: "Blood_Pressure_Low", label: "Low Blood Pressure" },
    { key: "Corticosteroid_Treatment", label: "Corticosteroid Treatment" },
    { key: "Cancer", label: "Cancer" },
    { key: "Diabetes", label: "Diabetes" },
    { key: "Epilepsy", label: "Epilepsy" },
    { key: "Heart_Problems", label: "Heart Problems" },
    { key: "Hepatitis", label: "Hepatitis" },
    { key: "Herpes", label: "Herpes" },
    { key: "Jaundice", label: "Jaundice" },
    { key: "Liver_Disease", label: "Liver Disease" },
    { key: "Kidney_Disease", label: "Kidney Disease" },
    { key: "Psychiatric_Treatment", label: "Psychiatric Treatment" },
    { key: "Radiation_Treatment", label: "Radiation Treatment" },
    { key: "Respiratory_Disease", label: "Respiratory Disease" },
    { key: "Rheumatic_Fever", label: "Rheumatic Fever" },
    { key: "TB", label: "Tuberculosis (TB)" },
    { key: "Thyroid_Problems", label: "Thyroid Problems" },
    { key: "Ulcer", label: "Ulcer" },
    { key: "Venereal_Disease", label: "Venereal Disease" }
  ];

  const toggle = (key) => {
    // If a condition is being ticked, clear "No Known Conditions"
    const newData = {
      ...data,
      [key]: data[key] === "YES" ? "NO" : "YES",
      No_Known_Conditions: false,
    };
    setData(newData);
  };

  const handleNoKnownConditions = () => {
    // Tick "No Known Conditions" → uncheck all conditions and clear Other
    const cleared = {};
    MEDICAL_FIELDS.forEach((f) => { cleared[f.key] = "NO"; });
    setData({
      ...data,
      ...cleared,
      Other: "",
      No_Known_Conditions: !data.No_Known_Conditions,
    });
  };

  const hasMedicalRisk = MEDICAL_FIELDS.some((item) => data[item.key] === "YES");
  const hasOtherRisk   = data.Other && data.Other.trim() !== "";
  const showRiskAlert  = hasMedicalRisk || hasOtherRisk;

  // Mandatory: either a condition is selected, "No Known" is checked, or Other has text
  const isAcknowledged = hasMedicalRisk || hasOtherRisk || data.No_Known_Conditions;

  return (
    <fieldset
      style={{
        border: showRiskAlert
          ? "2px solid #dc2626"
          : !isAcknowledged
          ? "2px solid #f59e0b"
          : "1.5px solid #e2e8f4",
        padding: "16px 18px",
        borderRadius: 10,
      }}
    >
      {/* ── Legend with mandatory marker ── */}
      <legend style={{ padding: "0 6px" }}>
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: 11.5,
            fontWeight: 700,
            color: showRiskAlert ? "#dc2626" : "#64748b",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          Medical History
          <span style={{ color: "#e03e3e", marginLeft: 2 }}>*</span>
        </span>
      </legend>

      {/* ── Mandatory notice ── */}
      {!isAcknowledged && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            padding: "8px 12px",
            marginBottom: 14,
            borderRadius: 8,
            color: "#92400e",
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          ⚠️ Please select any applicable conditions, or confirm "No Known Medical Conditions" below.
        </div>
      )}

      {/* ── Risk alert ── */}
      {showRiskAlert && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#fff0f0",
            border: "1px solid #fca5a5",
            padding: "8px 12px",
            marginBottom: 14,
            borderRadius: 8,
            color: "#dc2626",
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          🚨 MEDICAL RISK DETECTED – Please Review Carefully
        </div>
      )}

      {/* ── Condition checkboxes ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "10px 14px",
          opacity: data.No_Known_Conditions ? 0.4 : 1,
          pointerEvents: data.No_Known_Conditions ? "none" : "auto",
        }}
      >
        {MEDICAL_FIELDS.map((item) => (
          <label
            key={item.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: 13,
              color: data[item.key] === "YES" ? "#dc2626" : "#2d3a55",
              fontWeight: data[item.key] === "YES" ? 600 : 400,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={data[item.key] === "YES"}
              onChange={() => toggle(item.key)}
              style={{ accentColor: "#dc2626", width: 14, height: 14 }}
            />
            {item.label}
          </label>
        ))}
      </div>

      {/* ── Other textarea ── */}
      <textarea
        placeholder="Other medical conditions…"
        value={data.Other || ""}
        disabled={!!data.No_Known_Conditions}
        onChange={(e) =>
          setData({ ...data, Other: e.target.value, No_Known_Conditions: false })
        }
        style={{
          marginTop: 14,
          width: "100%",
          minHeight: 60,
          padding: "9px 12px",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: 13,
          color: "#1a1f36",
          border: hasOtherRisk ? "1.5px solid #dc2626" : "1.5px solid #e2e8f4",
          borderRadius: 8,
          outline: "none",
          resize: "vertical",
          opacity: data.No_Known_Conditions ? 0.4 : 1,
          background: data.No_Known_Conditions ? "#f8faff" : "#fff",
        }}
      />

      {/* ── No Known Medical Conditions (mandatory fallback) ── */}
      <label
        onClick={handleNoKnownConditions}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          marginTop: 14,
          padding: "10px 16px",
          background: data.No_Known_Conditions ? "#f0fdf4" : "#f8faff",
          border: data.No_Known_Conditions
            ? "1.5px solid #22c55e"
            : "1.5px dashed #94a3b8",
          borderRadius: 9,
          cursor: "pointer",
          transition: "all 0.2s",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: data.No_Known_Conditions ? "#15803d" : "#475569",
          userSelect: "none",
          width: "100%",
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            minWidth: 18,
            border: data.No_Known_Conditions ? "2px solid #22c55e" : "2px solid #94a3b8",
            borderRadius: 4,
            background: data.No_Known_Conditions ? "#22c55e" : "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
          }}
        >
          {data.No_Known_Conditions && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </span>
        No Known Medical Conditions
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            padding: "2px 8px",
            borderRadius: 20,
            background: data.No_Known_Conditions ? "#dcfce7" : "#fef9c3",
            color: data.No_Known_Conditions ? "#15803d" : "#92400e",
          }}
        >
          {data.No_Known_Conditions ? "Confirmed" : "Required if none selected"}
        </span>
      </label>
    </fieldset>
  );
}