export default function PatientHabits({ data = {}, setData }) {
  const noKnown = !!data.no_known_habits;

  const toggleHabit = (field) => {
    if (noKnown) return; // disabled when No Known Habits is checked
    const isChecked = !!data[field];
    setData({
      ...data,
      [field]: !isChecked,
      ...(!isChecked ? {} : { [`${field}_detail`]: "" }),
    });
  };

  const toggleNoKnown = () => {
    if (noKnown) {
      // uncheck No Known Habits
      setData({ ...data, no_known_habits: false });
    } else {
      // check No Known Habits → clear all habits
      setData({
        ...data,
        no_known_habits: true,
        smoking: false, smoking_detail: "",
        alcohol: false, alcohol_detail: "",
        tobacco: false, tobacco_detail: "",
      });
    }
  };

  const anyHabitChecked = !!data.smoking || !!data.alcohol || !!data.tobacco;

  const HABITS = [
    { field: "smoking", label: "Smoking",  placeholder: "e.g. 5 years, 10 cigarettes/day" },
    { field: "alcohol", label: "Alcohol",  placeholder: "e.g. Occasional, 2–3 drinks/week" },
    { field: "tobacco", label: "Tobacco",  placeholder: "e.g. Chewing / Smoking" },
  ];

  return (
    <div style={styles.section}>
      <div style={styles.subHeading}>
        <span style={styles.subHeadingBar} />
        Habits
      </div>

      <div style={styles.grid}>
        {HABITS.map(({ field, label, placeholder }) => {
          const checked = !!data[field];
          const disabled = noKnown;
          return (
            <div
              key={field}
              style={{
                ...styles.fieldRow,
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
                borderColor: checked ? "#10b981" : styles.fieldRow.borderColor,
                background: checked ? "#f0fdf4" : styles.fieldRow.background,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer" }}>
                {/* Custom checkbox */}
                <div
                  onClick={() => toggleHabit(field)}
                  style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    border: `2px solid ${checked ? "#10b981" : "#c5d5ef"}`,
                    background: checked ? "#10b981" : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.18s",
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {checked && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.8 7L9 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span style={{
                  ...styles.label,
                  color: checked ? "#065f46" : styles.label.color,
                }}>
                  {label}
                </span>
              </label>

              {checked && (
                <textarea
                  rows={2}
                  style={styles.detailInput}
                  placeholder={placeholder}
                  value={data[`${field}_detail`] || ""}
                  onChange={(e) => setData({ ...data, [`${field}_detail`]: e.target.value })}
                />
              )}
            </div>
          );
        })}

        {/* No Known Habits */}
        <div
          style={{
            ...styles.fieldRow,
            opacity: anyHabitChecked ? 0.45 : 1,
            cursor: anyHabitChecked ? "not-allowed" : "pointer",
            borderColor: noKnown ? "#f59e0b" : styles.fieldRow.borderColor,
            background: noKnown ? "#fffbeb" : styles.fieldRow.background,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: anyHabitChecked ? "not-allowed" : "pointer" }}>
            <div
              onClick={anyHabitChecked ? undefined : toggleNoKnown}
              style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `2px solid ${noKnown ? "#f59e0b" : "#c5d5ef"}`,
                background: noKnown ? "#f59e0b" : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.18s",
                cursor: anyHabitChecked ? "not-allowed" : "pointer",
              }}
            >
              {noKnown && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.8 7L9 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{
              ...styles.label,
              color: noKnown ? "#92400e" : styles.label.color,
            }}>
              No Known Habits
            </span>
          </label>
          {anyHabitChecked && !noKnown && (
            <span style={styles.mutualNote}>Uncheck habits above to enable</span>
          )}
        </div>
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
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  fieldRow: {
    background: "#f8faff",
    border: "1.5px solid #e8edf8",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex", flexDirection: "column", gap: 8,
    transition: "all 0.18s",
  },
  label: {
    fontSize: 12, fontWeight: 700, color: "#475569",
    letterSpacing: "0.4px", textTransform: "uppercase",
    userSelect: "none",
  },
  detailInput: {
    width: "100%", padding: "8px 11px",
    border: "1.5px solid #6ee7b7", borderRadius: 8,
    fontFamily: "inherit", fontSize: 13, color: "#1a1f36",
    background: "#fff", outline: "none", resize: "vertical",
    transition: "border-color 0.18s",
    boxSizing: "border-box",
    lineHeight: 1.5,
  },
  mutualNote: {
    fontSize: 11, color: "#d97706", fontWeight: 600,
  },
};