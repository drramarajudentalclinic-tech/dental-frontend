export default function PatientWomen({ data = {}, setData }) {
  const toggle = (field, val) => {
    setData({
      ...data,
      [field]: val === "Yes",
      ...(field === "pregnant" && val === "No" ? { due_date: "" } : {}),
    });
  };

  const getVal = (field) => {
    if (data[field] === true)  return "Yes";
    if (data[field] === false) return "No";
    return null; // unanswered
  };

  const YesNoField = ({ field, label, children }) => {
    const val = getVal(field);
    const isAnswered = val !== null;

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
        {val === "Yes" && children}
      </div>
    );
  };

  return (
    <div style={styles.section}>
      <div style={styles.subHeading}>
        <span style={styles.subHeadingBar} />
        Women's Health History
      </div>
      <div style={styles.grid}>
        <YesNoField field="pregnant" label="Are you pregnant?">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={styles.detailLabel}>Expected Due Date</label>
            <input
              type="date"
              style={styles.detailInput}
              value={data.due_date || ""}
              onChange={(e) => setData({ ...data, due_date: e.target.value })}
            />
          </div>
        </YesNoField>

        <YesNoField field="nursing_child" label="Are you nursing a child?" />
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
    background: "linear-gradient(180deg, #0891b2, #67e8f9)",
    borderRadius: 2, flexShrink: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 14,
  },
  fieldRow: {
    background: "#f0fdff",
    border: "1.5px solid #a5e8f3",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex", flexDirection: "column", gap: 8,
  },
  labelRow: {
    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  },
  label: {
    fontSize: 12, fontWeight: 700, color: "#0e7490",
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
  detailLabel: {
    fontSize: 11, fontWeight: 700, color: "#6b7a99",
    letterSpacing: "0.3px", textTransform: "uppercase",
  },
  detailInput: {
    width: "100%", padding: "8px 11px",
    border: "1.5px solid #a5e8f3", borderRadius: 8,
    fontFamily: "inherit", fontSize: 13, color: "#1a1f36",
    background: "#fff", outline: "none",
    transition: "border-color 0.18s",
    boxSizing: "border-box",
  },
};