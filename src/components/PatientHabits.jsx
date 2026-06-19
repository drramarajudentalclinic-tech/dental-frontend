export default function PatientHabits({ data = {}, setData }) {
  const noHabits = !!data.no_habits;

  const toggleHabit = (field) => {
    if (noHabits) return;

    const checked = !!data[field];

    setData({
      ...data,
      [field]: !checked,
      ...(!checked ? {} : { [`${field}_detail`]: "" }),
    });
  };

  const toggleNoHabits = () => {
    if (hasAnyHabit) return;

    setData({
      ...data,
      no_habits: !noHabits,

      smoking: false,
      smoking_detail: "",

      alcohol: false,
      alcohol_detail: "",

      tobacco: false,
      tobacco_detail: "",

      pan_chewing: false,
      pan_chewing_detail: "",

      spicy_foods: false,
      spicy_foods_detail: "",
    });
  };

  const hasAnyHabit =
    !!data.smoking ||
    !!data.alcohol ||
    !!data.tobacco ||
    !!data.pan_chewing ||
    !!data.spicy_foods;

  const HABITS = [
    {
      field: "smoking",
      label: "Smoking",
      placeholder:
        "How many cigarettes/day and since how many years?",
    },
    {
      field: "alcohol",
      label: "Alcohol",
      placeholder:
        "What type of alcohol and how frequently?",
    },
    {
      field: "tobacco",
      label: "Tobacco",
      placeholder:
        "How much tobacco/day and since how many years?",
    },
    {
      field: "pan_chewing",
      label: "Pan Chewing",
      placeholder:
        "How many per day and since how many years?",
    },
    {
      field: "spicy_foods",
      label: "Spicy Foods",
      placeholder:
        "Which spicy foods and how frequently?",
    },
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

          return (
            <div
              key={field}
              style={{
                ...styles.fieldRow,
                opacity: noHabits ? 0.45 : 1,
                borderColor: checked
                  ? "#10b981"
                  : styles.fieldRow.borderColor,
                background: checked
                  ? "#f0fdf4"
                  : styles.fieldRow.background,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: noHabits
                    ? "not-allowed"
                    : "pointer",
                }}
              >
                <div
                  onClick={() => toggleHabit(field)}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    border: `2px solid ${
                      checked ? "#10b981" : "#c5d5ef"
                    }`,
                    background: checked
                      ? "#10b981"
                      : "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {checked && (
                    <svg
                      width="10"
                      height="8"
                      viewBox="0 0 10 8"
                      fill="none"
                    >
                      <path
                        d="M1 4L3.8 7L9 1"
                        stroke="#fff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>

                <span
                  style={{
                    ...styles.label,
                    color: checked
                      ? "#065f46"
                      : styles.label.color,
                  }}
                >
                  {label}
                </span>
              </label>

              {checked && (
                <textarea
                  rows={3}
                  style={styles.detailInput}
                  placeholder={placeholder}
                  value={data[`${field}_detail`] || ""}
                  onChange={(e) =>
                    setData({
                      ...data,
                      [`${field}_detail`]: e.target.value,
                    })
                  }
                />
              )}
            </div>
          );
        })}

        {/* No Habits */}

        <div
          style={{
            ...styles.fieldRow,
            opacity: hasAnyHabit ? 0.45 : 1,
            borderColor: noHabits
              ? "#f59e0b"
              : styles.fieldRow.borderColor,
            background: noHabits
              ? "#fffbeb"
              : styles.fieldRow.background,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: hasAnyHabit
                ? "not-allowed"
                : "pointer",
            }}
          >
            <div
              onClick={toggleNoHabits}
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                border: `2px solid ${
                  noHabits ? "#f59e0b" : "#c5d5ef"
                }`,
                background: noHabits
                  ? "#f59e0b"
                  : "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {noHabits && (
                <svg
                  width="10"
                  height="8"
                  viewBox="0 0 10 8"
                  fill="none"
                >
                  <path
                    d="M1 4L3.8 7L9 1"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            <span
              style={{
                ...styles.label,
                color: noHabits
                  ? "#92400e"
                  : styles.label.color,
              }}
            >
              No Habits
            </span>
          </label>

          {hasAnyHabit && (
            <span style={styles.mutualNote}>
              Uncheck habits above to enable
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },

  subHeading: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    fontSize: 13,
    fontWeight: 700,
    color: "#1a1f36",
    marginBottom: 14,
  },

  subHeadingBar: {
    display: "block",
    width: 3,
    height: 16,
    background:
      "linear-gradient(180deg,#2563eb,#60a5fa)",
    borderRadius: 2,
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: 12,
  },

  fieldRow: {
    background: "#f8faff",
    border: "1.5px solid #e8edf8",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },

  label: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    letterSpacing: "0.4px",
    textTransform: "uppercase",
    userSelect: "none",
  },

  detailInput: {
    width: "100%",
    padding: "8px 11px",
    border: "1.5px solid #6ee7b7",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 13,
    background: "#fff",
    resize: "vertical",
    boxSizing: "border-box",
  },

  mutualNote: {
    fontSize: 11,
    color: "#d97706",
    fontWeight: 600,
  },
};