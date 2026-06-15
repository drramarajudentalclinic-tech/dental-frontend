export default function PatientHabits({ data = {}, setData }) {
  const toggle = (field, val) => {
    setData({
      ...data,
      [field]: val,
      // clear detail text when switching to No
      ...(val === "No" ? { [`${field}_detail`]: "" } : {}),
    });
  };

  const YesNoField = ({ field, label, detailPlaceholder }) => {
    const val = data[field];
    const hasDetail = val === "Yes";
    const isAnswered = val === "Yes" || val === "No";

    return (
      <div style={styles.fieldRow}>
        <div style={styles.labelRow}>
          <span style={styles.label}>
            {label}
            <span style={styles.required}>*</span>
          </span>
          <div style={styles.toggleGroup}>
            <button
              type="button"
              onClick={() => toggle(field, "Yes")}
              style={{
                ...styles.toggleBtn,
                ...(val === "Yes" ? styles.toggleBtnYes : {}),
              }}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => toggle(field, "No")}
              style={{
                ...styles.toggleBtn,
                ...(val === "No" ? styles.toggleBtnNo : {}),
              }}
            >
              No
            </button>
          </div>
          {!isAnswered && <span style={styles.errorMsg}>⚠ Required</span>}
        </div>
        {hasDetail && (
          <input
            style={styles.detailInput}
            placeholder={detailPlaceholder}
            value={data[`${field}_detail`] || ""}
            onChange={(e) =>
              setData({ ...data, [`${field}_detail`]: e.target.value })
            }
          />
        )}
      </div>
    );
  };

  return (
    <div style={styles.section}>
      <div style={styles.subHeading}>
        <span style={styles.subHeadingBar} />
        Habits
      </div>
      <div style={styles.grid}>
        <YesNoField
          field="smoking"
          label="Smoking"
          detailPlaceholder="e.g. 5 years, 10 cigarettes/day"
        />
        <YesNoField
          field="alcohol"
          label="Alcohol"
          detailPlaceholder="e.g. Occasional, 2–3 drinks/week"
        />
        <YesNoField
          field="tobacco"
          label="Tobacco"
          detailPlaceholder="e.g. Chewing / Smoking"
        />
      </div>
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
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 14,
  },
  fieldRow: {
    background: "#f8faff",
    border: "1.5px solid #e8edf8",
    borderRadius: 10,
    padding: "12px 14px",
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
    background: "#ecfdf5", borderColor: "#10b981",
    color: "#065f46",
  },
  toggleBtnNo: {
    background: "#fff0f0", borderColor: "#f87171",
    color: "#991b1b",
  },
  errorMsg: {
    fontSize: 11, color: "#e03e3e", fontWeight: 600,
  },
  detailInput: {
    width: "100%", padding: "8px 11px",
    border: "1.5px solid #dde8fb", borderRadius: 8,
    fontFamily: "inherit", fontSize: 13, color: "#1a1f36",
    background: "#fff", outline: "none",
    transition: "border-color 0.18s",
    boxSizing: "border-box",
  },
};