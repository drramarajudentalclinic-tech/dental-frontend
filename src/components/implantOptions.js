/* ═══════════════════════════════════════════════════════════════════
   🔩 IMPLANT DETAILS — one list used by
     • Consultation → "Treatment Done Today" (when "Implant Done" is chosen)
     • Image Upload → "Implant" pictures (box / sticker / label photo)
   To add a system or a size, add it here; both screens update.
   ═══════════════════════════════════════════════════════════════════ */

export const IMPLANT_SYSTEMS = [
  "Straumann",
  "Nobel Biocare – NobelActive",
  "Nobel Biocare – NobelReplace",
  "Osstem",
  "DIO",
  "Neo Biotech",
  "Noris",
  "Adin",
  "Alpha-Bio",
  "Other",
];

// Diameter (mm) and length (mm) of the fixture
export const IMPLANT_DIAMETERS = ["3.0", "3.3", "3.5", "3.75", "4.0", "4.1", "4.2", "4.3", "4.5", "4.8", "5.0", "5.5", "6.0", "6.5", "7.0"];
export const IMPLANT_LENGTHS   = ["5", "6", "7", "8", "8.5", "10", "11", "11.5", "12", "13", "14", "15", "16", "18"];
// Insertion torque (Ncm)
export const IMPLANT_TORQUES   = ["< 15", "15", "20", "25", "30", "35", "40", "45", "50", "55", "60", "70"];

export const EMPTY_IMPLANT = { system: "", systemOther: "", diameter: "", length: "", torque: "" };

export function implantSystemName(d) {
  if (!d) return "";
  return d.system === "Other" ? (d.systemOther || "").trim() : (d.system || "");
}

/* "Straumann Ø4.1 × 10 mm, 35 Ncm" — the parts that are filled in */
export function formatImplant(d) {
  if (!d) return "";
  const sys = implantSystemName(d);
  const size = d.diameter && d.length ? `Ø${d.diameter} × ${d.length} mm`
    : d.diameter ? `Ø${d.diameter} mm` : d.length ? `L ${d.length} mm` : "";
  const head = [sys, size].filter(Boolean).join(" ");
  const torque = d.torque ? `${d.torque} Ncm` : "";
  return [head, torque].filter(Boolean).join(", ");
}

/* An implant needs at least the system (and its name when "Other"). */
export function implantReady(d) {
  return !!implantSystemName(d);
}

/* Read the details back from saved text ("Implant Done — Straumann Ø4.1 × 10 mm, 35 Ncm · note IRT 36"). */
export function parseImplant(text) {
  const t = String(text || "");
  const d = { ...EMPTY_IMPLANT };
  const known = IMPLANT_SYSTEMS.filter((s) => s !== "Other").sort((a, b) => b.length - a.length);
  const body = t.replace(/^Implant Done\s*—\s*/i, "");
  const sys = known.find((s) => body.toLowerCase().startsWith(s.toLowerCase()));
  if (sys) d.system = sys;
  else {
    const m = body.match(/^(.+?)\s+(Ø|L\s\d)/);
    if (m) { d.system = "Other"; d.systemOther = m[1].trim(); }
  }
  let m = body.match(/Ø\s?(\d+(?:\.\d+)?)/);
  if (m) d.diameter = m[1];
  m = body.match(/×\s?(\d+(?:\.\d+)?)\s?mm/) || body.match(/\bL\s(\d+(?:\.\d+)?)\s?mm/);
  if (m) d.length = m[1];
  m = body.match(/(<\s?15|\d+)\s?Ncm/);
  if (m) d.torque = m[1].replace(/<\s?/, "< ");
  return d;
}

/* Implant entries in a consultation's "treatment done today" text:
   [{ teeth: [36], details: {...}, text: "Straumann Ø4.1 × 10 mm, 35 Ncm" }] */
export function implantsFromTreatmentText(treatmentText) {
  return String(treatmentText || "")
    .split(/;\s+/)
    .map((s) => s.trim())
    .filter((s) => /^Implant Done/i.test(s))
    .map((s) => {
      const irt = s.match(/\sIRT\s+([\d,\s]+)$/);
      const teeth = irt ? irt[1].split(",").map((x) => Number(x.trim())).filter(Boolean) : [];
      const main = (irt ? s.slice(0, irt.index) : s).replace(/^Implant Done\s*—?\s*/i, "");
      const details = parseImplant(main.split(" · ")[0]);
      return { teeth, details, text: formatImplant(details) };
    })
    .filter((x) => x.text);
}