const HABIT_LABELS = {
  smoking: "Smoking",
  alcohol: "Alcohol",
  tobacco: "Tobacco",
  pan_chewing: "Pan Chewing",
  spicy_foods: "Spicy Foods",
};

export default function DoctorHabitsSummary({ data }) {
  if (!data) return null;

  // No habits selected
  if (data.no_habits) {
    return (
      <div
        style={{
          padding: 18,
          textAlign: "center",
          background: "#f8fafc",
          border: "1px dashed #cbd5e1",
          borderRadius: 10,
          color: "#64748b",
          fontWeight: 600,
        }}
      >
        ✅ No Habits
      </div>
    );
  }

  const habits = [];

  if (data.smoking)
    habits.push({
      label: HABIT_LABELS.smoking,
      detail: data.smoking_detail,
    });

  if (data.alcohol)
    habits.push({
      label: HABIT_LABELS.alcohol,
      detail: data.alcohol_detail,
    });

  if (data.tobacco)
    habits.push({
      label: HABIT_LABELS.tobacco,
      detail: data.tobacco_detail,
    });

  if (data.pan_chewing)
    habits.push({
      label: HABIT_LABELS.pan_chewing,
      detail: data.pan_chewing_detail,
    });

  if (data.spicy_foods)
    habits.push({
      label: HABIT_LABELS.spicy_foods,
      detail: data.spicy_foods_detail,
    });

  if (habits.length === 0) {
    return (
      <div
        style={{
          padding: 18,
          textAlign: "center",
          background: "#f8fafc",
          border: "1px dashed #cbd5e1",
          borderRadius: 10,
          color: "#94a3b8",
        }}
      >
        No habit information available.
      </div>
    );
  }

  return (
    <div className="dpv-info-grid">
      {habits.map((habit, index) => (
        <div key={index} className="dpv-info-cell">
          <div className="dpv-info-label">{habit.label}</div>
          <div className="dpv-info-value">
            Yes
            {habit.detail && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: "#64748b",
                  fontWeight: 500,
                }}
              >
                {habit.detail}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}