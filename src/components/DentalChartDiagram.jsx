import "./DentalChartDiagram.css";

/* Simple read-only tooth grid.
   Colours match the main Dental Chart (DentalChart.jsx → CMAP). A tooth can
   now have several findings: the square takes the colour of the most
   important one, a small number shows how many there are, and the tooltip
   lists them all. */
const CONDITION_COLORS = {
  // Caries
  "Caries": "#dc2626", "Deep Caries": "#991b1b", "Proximal Caries": "#e11d48",
  "Occlusal Pits": "#9f1239", "Root Caries": "#b91c1c", "Secondary Caries": "#f43f5e",
  // Deposits & stains
  "Calculus": "#a16207", "Stains": "#78350f",
  // Wear & defects
  "Attrition": "#065f46", "Cervical Abrasion": "#0891b2", "Erosion": "#0f766e", "Fracture": "#d97706",
  "Fluorosis": "#65a30d", "Hypoplasia": "#4d7c0f", "Sensitive Tooth": "#0d9488",
  // Gums & support
  "Gingivitis": "#db2777", "Gum Recession": "#be185d", "Pockets": "#7e22ce", "Furcation": "#9333ea",
  "Mobility I": "#d97706", "Mobility II": "#ea580c", "Mobility III": "#dc2626", "Food Impaction": "#ca8a04",
  // Pulp & root
  "Pulpitis": "#c026d3", "Periapical Pathology": "#a21caf", "Abscess": "#86198f",
  "RC Treated": "#7c3aed", "Root Stump": "#57534e",
  // Restorations
  "Restored": "#0369a1", "Faulty Restoration": "#0284c7", "Crown": "#b45309", "Bridge": "#c2410c",
  "Veneer": "#0ea5e9", "Implant": "#1d4ed8",
  // Tooth status
  "Missing": "#475569", "Impacted": "#9d174d", "Partially Erupted": "#64748b",
  "Retained Deciduous": "#525252", "Supernumerary": "#3f3f46", "Malposed": "#4338ca",
  "Other": "#6366f1",
  // Names used by older records
  "RCT": "#7c3aed", "Impaction": "#9d174d",
};

// Most important first: decides the colour when a tooth has several findings.
const PRIORITY = [
  "Missing", "Root Stump", "Impacted", "Impaction", "Implant", "Bridge", "Crown", "Veneer", "RC Treated", "RCT",
  "Periapical Pathology", "Abscess", "Fracture", "Deep Caries", "Pulpitis", "Caries", "Proximal Caries",
  "Root Caries", "Secondary Caries", "Occlusal Pits", "Faulty Restoration", "Restored",
  "Mobility III", "Mobility II", "Mobility I", "Furcation", "Pockets", "Gum Recession", "Gingivitis",
  "Cervical Abrasion", "Attrition", "Erosion", "Hypoplasia", "Fluorosis", "Sensitive Tooth",
  "Partially Erupted", "Retained Deciduous", "Supernumerary", "Malposed", "Food Impaction",
  "Calculus", "Stains", "Other",
];
const rank = (c) => { const i = PRIORITY.indexOf(c); return i < 0 ? PRIORITY.length : i; };

// Both rows are drawn as the dentist sees the patient: the patient's RIGHT
// side is on the left of the screen. (The lower row used to be drawn the
// other way round, which put tooth 38 under tooth 18.)
const UPPER_RIGHT = [18,17,16,15,14,13,12,11];
const UPPER_LEFT  = [21,22,23,24,25,26,27,28];
const LOWER_RIGHT = [48,47,46,45,44,43,42,41];
const LOWER_LEFT  = [31,32,33,34,35,36,37,38];

const labelOf = (r) => (r.condition === "Other" && r.other_text ? r.other_text : r.condition || "—");
const colorOf = (r) =>
  (r.condition === "Other" && /^#[0-9a-fA-F]{6}$/.test(r.custom_color || "") ? r.custom_color : null) ||
  CONDITION_COLORS[r.condition] || CONDITION_COLORS.Other;

export default function DentalChartDiagram({
  records = [],          // ✅ DEFAULT EMPTY ARRAY
  onToothClick = () => {} // ✅ SAFE DEFAULT
}) {

  // All findings of one tooth, most important first.
  // (The server sends tooth numbers as text, so compare as numbers.)
  const getRecords = (tooth) => {
    if (!Array.isArray(records)) return [];
    return records
      .filter(r => r && Number(r.tooth_number) === tooth)
      .sort((a, b) => rank(a.condition) - rank(b.condition));
  };

  const Tooth = ({ number }) => {
    const recs = getRecords(number);
    const main = recs[0] || null;

    const surfaces = [...new Set(
      recs.flatMap(r => (typeof r.surface === "string" ? r.surface.split(",") : []))
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
    )];

    const bg = main ? colorOf(main) : "#ffffff";

    const tooltip = recs.length
      ? `Tooth ${number}\n` + recs.map(r => {
          const s = typeof r.surface === "string" && r.surface ? ` (${r.surface.replace(/,/g, "")})` : "";
          return `• ${labelOf(r)}${s}`;
        }).join("\n")
      : `Tooth ${number} – No findings`;

    return (
      <div
        className={`tooth${main ? " has-finding" : ""}`}
        style={{ backgroundColor: bg }}
        onClick={() => onToothClick(number)}
        title={tooltip}
      >
        {/* SURFACE OVERLAYS */}
        <div className={`surface top ${surfaces.includes("B") ? "active" : ""}`} />
        <div className={`surface left ${surfaces.includes("M") ? "active" : ""}`} />
        <div className={`surface center ${surfaces.includes("O") || surfaces.includes("I") ? "active" : ""}`} />
        <div className={`surface right ${surfaces.includes("D") ? "active" : ""}`} />
        <div className={`surface bottom ${surfaces.includes("L") ? "active" : ""}`} />

        {recs.length > 1 && <span className="tooth-count">{recs.length}</span>}
        <span className="tooth-number">{number}</span>
      </div>
    );
  };

  // Legend: only what is actually on this chart.
  const present = [];
  (Array.isArray(records) ? records : []).forEach(r => {
    if (!r) return;
    const label = labelOf(r);
    if (!present.some(p => p.label === label)) present.push({ label, color: colorOf(r), order: rank(r.condition) });
  });
  present.sort((a, b) => a.order - b.order);

  return (
    <div className="chart-wrapper">
      <h3>🦷 Dental Chart</h3>

      <div className="arch">
        {UPPER_RIGHT.map(n => (
          <Tooth key={n} number={n} />
        ))}
        {UPPER_LEFT.map(n => (
          <Tooth key={n} number={n} />
        ))}
      </div>

      <div className="arch">
        {LOWER_RIGHT.map(n => (
          <Tooth key={n} number={n} />
        ))}
        {LOWER_LEFT.map(n => (
          <Tooth key={n} number={n} />
        ))}
      </div>

      {present.length > 0 && (
        <div className="legend">
          {present.map(p => (
            <div key={p.label} className="legend-item">
              <span className="legend-color" style={{ backgroundColor: p.color }} />
              {p.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}