/* ═══════════════════════════════════════════════════════════════════
   🦷 ROOT CANAL DETAILS — used by Consultation → "Treatment Done Today"
   when an endodontic step is chosen. Every field is optional; whatever
   is filled in is saved with the treatment, e.g.
     "Obturation Done — Canals MB, DB, P · WL MB 20, DB 19.5, P 21 mm ·
      ProTaper Gold 25 mm, MAF 25/.06 · Single cone, AH Plus · Core: Composite"
   To add a brand or a material, add it to the lists below.
   ═══════════════════════════════════════════════════════════════════ */

// treatment name → which step it is (decides which fields are shown)
export const RCT_STAGES = {
  "A/O Done": "ao",                                   // access opening
  "BMP / Cleaning & Shaping Done": "bmp",             // biomechanical preparation
  "Obturation Done": "obt",
  "Re-RCT Done": "retx",                              // retreatment
  "Pulpectomy": "pulp",                               // milk teeth
};
export const rctStage = (label) => RCT_STAGES[label] || null;

export const CANALS = ["MB", "MB2", "DB", "P", "M", "D", "ML", "DL", "B", "L", "Single", "Extra"];

export const PULP_DIAGNOSIS = [
  "Irreversible pulpitis", "Pulp necrosis", "Symptomatic apical periodontitis", "Asymptomatic apical periodontitis",
  "Acute apical abscess", "Chronic apical abscess", "Previously treated", "Previously initiated",
];
export const WL_METHOD = ["Apex locator", "RVG / IOPA", "Apex locator + RVG"];

// Rotary / reciprocating systems (brand and maker)
export const ROTARY_SYSTEMS = [
  "ProTaper Gold (Dentsply)",
  "ProTaper Next (Dentsply)",
  "ProTaper Ultimate (Dentsply)",
  "ProTaper Universal (Dentsply)",
  "WaveOne Gold (Dentsply) – reciprocating",
  "TruNatomy (Dentsply)",
  "Vortex Blue (Dentsply)",
  "Reciproc Blue (VDW) – reciprocating",
  "Reciproc (VDW) – reciprocating",
  "Mtwo (VDW)",
  "HyFlex CM (Coltene)",
  "HyFlex EDM (Coltene)",
  "HERO Gold (Micro-Mega)",
  "HERO Shaper (Micro-Mega)",
  "One Curve (Micro-Mega)",
  "2Shape (Micro-Mega)",
  "XP-endo Shaper (FKG)",
  "RaCe EVO (FKG)",
  "BioRaCe (FKG)",
  "Safe Endo",
  "Glin",
  "Neoendo Flex (Orikam)",
  "Neoendo Gold / Orodeka (Orikam)",
  "Plex-V (Orodeka)",
  "Endostar E3 (Poldent)",
  "Mani JIZAI",
  "Mani Silk",
  "K3XF (Kerr)",
  "EdgeFile X7 (EdgeEndo)",
  "Fanta AF Blue (Fanta)",
  "Waldent rotary",
  "None – hand files only",
  "Other",
];

// Glide path (before rotary shaping)
export const GLIDE_PATH = [
  "Hand K-files #10–#15", "ProGlider (Dentsply)", "WaveOne Gold Glider (Dentsply)", "PathFile (Dentsply)",
  "HyFlex EDM Glider (Coltene)", "One G (Micro-Mega)", "R-Pilot (VDW)", "Neoendo Pathfinder (Orikam)", "Other",
];

// Hand files
export const HAND_FILE_BRANDS = ["Mani", "Dentsply Maillefer", "Dentsply ReadySteel", "Kerr", "VDW", "Coltene", "Neoendo (Orikam)", "Waldent", "Other"];
export const HAND_FILE_TYPES = ["K-file", "H-file (Hedström)", "K-Flexofile", "C+ file", "C-Pilot", "Reamer", "NiTi hand file", "ProTaper hand files", "Pathfinder", "Barbed broach"];
export const HAND_SIZES = ["06", "08", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55", "60", "70", "80"];   // ISO

export const PAEDIATRIC_FILES = ["Kedo-S (Reeganz)", "Kedo-SG Blue (Reeganz)", "Pro AF Baby Gold", "Hand files (K / H files)", "Other"];

export const FILE_LENGTHS = ["21", "25", "31"];                        // mm
export const MAF_SIZES = ["15", "17", "20", "25", "30", "35", "40", "45", "50", "55", "60", "70", "80"];   // ISO tip
export const TAPERS = [".02", ".04", ".06", ".08", "Variable"];

export const IRRIGANTS = ["NaOCl 1%", "NaOCl 2.5%", "NaOCl 3%", "NaOCl 5.25%", "EDTA 17%", "EDTA gel (RC-Prep / Glyde)", "Chlorhexidine 2%",
  "Saline", "Citric acid 10%", "QMix", "MTAD"];
export const ACTIVATION = [
  "None", "EndoActivator (Dentsply) – sonic", "Ultrasonic – passive (PUI)", "Irrisafe ultrasonic tip", "EDDY (VDW) – sonic",
  "XP-endo Finisher (FKG)", "Manual dynamic (GP cone)", "Negative pressure (EndoVac)", "Laser (PIPS / SWEEPS)", "GentleWave",
];

export const MEDICAMENTS = ["None", "Calcium hydroxide", "Triple antibiotic paste", "Ledermix", "Formocresol", "CMCP", "Odontopaste"];
export const TEMP_SEALS = ["Cavit", "IRM", "GIC", "Zinc oxide eugenol", "Composite", "Temp filling (other)"];

export const OBT_TECHNIQUES = [
  "Single cone", "Cold lateral condensation", "Warm vertical compaction", "Continuous wave (obturation pen)",
  "Thermoplasticised injectable (Cicada / gun)", "Carrier-based (Thermafil / GuttaCore)", "Bioceramic hydraulic (sealer-based)",
];
export const SEALERS = [
  // resin
  "AH Plus (Dentsply)", "AH Plus Jet (Dentsply)", "AH 26 (Dentsply)", "Adseal (Meta)", "Dia-ProSeal (DiaDent)",
  // bioceramic
  "Bioceramic RCS", "AH Plus Bioceramic (Dentsply)", "BioRoot RCS (Septodont)", "CeraSeal (Meta)", "TotalFill BC (FKG)",
  "EndoSequence BC (Brasseler)", "iRoot SP", "Well-Root ST (Vericom)", "Bio-C Sealer (Angelus)", "Endoseal MTA (Maruchi)",
  "MTA Fillapex (Angelus)", "Neo MTA", "GuttaFlow Bioseal (Coltene)",
  // calcium hydroxide / others
  "Sealapex (Kerr)", "Apexit Plus (Ivoclar)", "GuttaFlow 2 (Coltene)", "Tubli-Seal (Kerr)", "Pulp Canal Sealer (Kerr)",
  "Endomethasone", "Zinc oxide eugenol", "Other",
];
export const CORE_RESTORATIONS = ["Composite core", "GIC", "Fibre post + composite core", "Cast post & core", "Amalgam core", "Temporary restoration", "Crown prep same day"];

export const RETX_REMOVAL = ["ProTaper Retreatment D1–D3", "Mtwo R (VDW)", "Other retreatment rotary", "Solvent (GP solvent / eucalyptol)",
  "H-files", "Ultrasonic", "Heat (System B / pen)", "Post removed", "Separated file bypassed / removed"];

export const PULP_OBTURATION = ["Metapex", "Vitapex", "Zinc oxide eugenol", "Endoflas", "Calcium hydroxide + iodoform", "Other"];
export const PULP_RESTORATION = ["GIC", "Composite", "Stainless steel crown", "Zirconia crown", "Strip crown", "Temporary"];
export const PULP_IRRIGANTS = ["Saline", "NaOCl 1%", "NaOCl 2.5%", "Chlorhexidine 2%"];

export const EMPTY_RCT = {
  canals: [], wl: {}, wlMethod: "", diagnosis: "",
  system: "", systemOther: "", fileLength: "", maf: "", taper: "", glide: "", glideOther: "",
  handBrand: "", handBrandOther: "", handType: "", handLength: "", handFrom: "", handTo: "",
  irrigants: [], activation: "", medicament: "", tempSeal: "",
  technique: "", sealer: "", sealerOther: "", masterCone: "", core: "",
  removal: [], pulpMaterial: "", pulpMaterialOther: "", restoration: "",
};

/* which groups of fields each step shows */
export const STAGE_FIELDS = {
  ao:   ["canals", "wl", "diagnosis", "hand", "irrigation", "medicament", "tempSeal"],
  bmp:  ["canals", "wl", "hand", "glide", "files", "irrigation", "medicament", "tempSeal"],
  obt:  ["canals", "wl", "hand", "files", "irrigation", "obturation", "core"],
  retx: ["canals", "wl", "removal", "hand", "glide", "files", "irrigation", "obturation", "medicament", "core"],
  pulp: ["canals", "wl", "pfiles", "pirrigation", "pobturation", "prestoration"],
};

const join = (xs) => xs.filter(Boolean).join(", ");

/* The details as one line of text (only what was filled in). " · " separates parts,
   so it never splits like the "; " between treatments does. */
export function formatRct(d, stage) {
  if (!d || !stage) return "";
  const f = STAGE_FIELDS[stage] || [];
  const has = (k) => f.includes(k);
  const parts = [];
  if (has("canals") && d.canals?.length) parts.push(`Canals ${d.canals.join(", ")}`);
  if (has("wl")) {
    const wl = (d.canals?.length ? d.canals : Object.keys(d.wl || {}))
      .map((c) => (d.wl?.[c] ? `${c} ${d.wl[c]}` : "")).filter(Boolean);
    if (wl.length) parts.push(`WL ${wl.join(", ")} mm${d.wlMethod ? ` (${d.wlMethod})` : ""}`);
    else if (d.wlMethod) parts.push(`WL by ${d.wlMethod}`);
  }
  if (has("diagnosis") && d.diagnosis) parts.push(d.diagnosis);
  if (has("removal") && d.removal?.length) parts.push(`GP removed: ${join(d.removal)}`);
  if (has("hand")) {
    const brand = d.handBrand === "Other" ? (d.handBrandOther || "").trim() : d.handBrand;
    const range = d.handFrom && d.handTo ? `#${d.handFrom}–#${d.handTo}` : d.handFrom ? `#${d.handFrom}` : d.handTo ? `up to #${d.handTo}` : "";
    const line = [brand, d.handType, d.handLength ? `${d.handLength} mm` : "", range].filter(Boolean).join(" ");
    if (line) parts.push(`Hand files ${line}`);
  }
  if (has("glide") && d.glide) parts.push(`Glide path ${d.glide === "Other" ? (d.glideOther || "other").trim() : d.glide}`);
  if (has("files") || has("pfiles")) {
    const sys = d.system === "Other" ? (d.systemOther || "").trim() : d.system === "None – hand files only" ? "" : d.system;
    const maf = d.maf ? `MAF ${d.maf}${d.taper && d.taper !== "Variable" ? `/${d.taper}` : d.taper === "Variable" ? " (variable taper)" : ""}`
      : d.taper ? `taper ${d.taper}` : "";
    const line = join([[sys, d.fileLength ? `${d.fileLength} mm` : ""].filter(Boolean).join(" "), maf]);
    if (line) parts.push(line);
  }
  if ((has("irrigation") || has("pirrigation")) && (d.irrigants?.length || (d.activation && d.activation !== "None")))
    parts.push(`Irrigation ${join(d.irrigants || [])}${d.activation && d.activation !== "None" ? ` + ${d.activation}` : ""}`);
  if (has("obturation")) {
    const sealer = d.sealer === "Other" ? (d.sealerOther || "").trim() : d.sealer;
    const ob = join([d.technique, sealer, d.masterCone ? `GP ${d.masterCone}` : ""]);
    if (ob) parts.push(ob);
  }
  if (has("pobturation")) {
    const m = d.pulpMaterial === "Other" ? (d.pulpMaterialOther || "").trim() : d.pulpMaterial;
    if (m) parts.push(`Obturated with ${m}`);
  }
  if (has("medicament") && d.medicament && d.medicament !== "None") parts.push(`${d.medicament} dressing`);
  if (has("tempSeal") && d.tempSeal) parts.push(`Temp: ${d.tempSeal}`);
  if (has("core") && d.core) parts.push(`Core: ${d.core}`);
  if (has("prestoration") && d.restoration) parts.push(`Restored: ${d.restoration}`);
  return parts.join(" · ");
}