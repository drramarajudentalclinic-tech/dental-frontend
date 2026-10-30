/* ═══════════════════════════════════════════════════════════════════════
   DENTAL NORMALISER
   Turns what the doctor SAYS (or types quickly) into clean chart entries.

     "16 MOD deep caries, 36 RC treated, 48 impacted"
        → 16 Deep Caries (M,O,D) · 36 RC Treated · 48 Impacted
     "upper right first molar pocket buccal 5 4 6 bleeding, mobility grade 2"
        → 16 Pockets (B 5-4-6 mm, bleeding) · 16 Mobility II
     "access opening done 36 working length 21 mm, advise extraction 48"
        → Treatment done: A/O Done IRT 36 — working length 21 mm
          Advice: Extraction IRT 48
     "amoxicillin 500 three times a day after food 5 days"
        → Amoxicillin 500mg · 3 times/day · After food · 5 days

   Understands: tooth numbers (FDI "16", "one six", "upper right first
   molar", "UR6", "lower left E", ranges "11 to 13", groups "lower
   anteriors"), surfaces (MOD, mesial, palatal…), severity, perio values
   (pockets, bleeding, recession, mobility, furcation), treatments,
   advice, medicines, and common Telugu / Hindi words (pannu, puchu,
   daant, keeda, noppi, dard, masude, khoon, kudi/edama, upar/neeche…).

   Nothing here saves anything: it only proposes entries that the doctor
   checks on screen before saving. Pure JavaScript, no libraries.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Lists that must match the app ─────────────────────────────────────── */
export const CHART_CONDITIONS = [
  "Abscess", "Attrition", "Bridge", "Calculus", "Caries", "Cervical Abrasion", "Crown",
  "Deep Caries", "Erosion", "Faulty Restoration", "Fluorosis", "Food Impaction", "Fracture",
  "Furcation", "Gingivitis", "Gum Recession", "Hypoplasia", "Impacted", "Implant", "Malposed",
  "Missing", "Mobility I", "Mobility II", "Mobility III", "Occlusal Pits", "Partially Erupted",
  "Periapical Pathology", "Pockets", "Proximal Caries", "Pulpitis", "RC Treated", "Restored",
  "Retained Deciduous", "Root Caries", "Root Stump", "Secondary Caries", "Sensitive Tooth",
  "Stains", "Supernumerary", "Veneer", "Other",
];
export const TREATMENT_LABELS = [
  "A/O Done", "BMP / Cleaning & Shaping Done", "Obturation Done", "Re-RCT Done", "Implant Done",
  "Extraction", "Surgical Extraction", "Composite Restoration", "GIC Restoration",
  "Permanent Cementation", "Temporary Cementation", "Temporary Restoration", "Pulpectomy",
  "Space Maintainer", "Other",
];
export const ADVICE_LABELS = [
  "Rct & Crown", "Re-Rct", "Zirconia Crown", "Dmls Crown", "Bridge", "Implant", "Ortho Extraction",
  "Surgical Extraction", "Composite Restoration", "Gic Restoration", "Permanent Cementation",
  "Temporary Cementation", "Temporary Restoration", "Pulpectomy", "Space Maintainer", "Extraction", "Other",
];
export const FREQUENCY_OPTIONS = ["1 time/day", "2 times/day", "3 times/day", "4 times/day", "At night", "When needed (SOS)"];
export const WHEN_OPTIONS = ["After food", "Before food", "With food", "At bedtime"];
export const SEVERITIES = ["mild", "moderate", "severe", "critical"];
const SURF_ORDER = "MOIDBL";

/* ── Teeth ─────────────────────────────────────────────────────────────── */
const PERM = new Set([11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48]);
const DECI = new Set([51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]);
export const isTooth = (n) => PERM.has(n) || DECI.has(n);
export const isDeciduous = (n) => DECI.has(Number(n));
// left→right as the dentist looks at the patient
const ARCHES = [
  [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],
  [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38],
  [55,54,53,52,51,61,62,63,64,65],
  [85,84,83,82,81,71,72,73,74,75],
];
function toothRange(a, b) {
  for (const arch of ARCHES) {
    const i = arch.indexOf(a), j = arch.indexOf(b);
    if (i >= 0 && j >= 0) return i <= j ? arch.slice(i, j + 1) : arch.slice(j, i + 1).reverse();
  }
  return null;
}
const quadOf = (upper, right, deci) => (deci ? (upper ? (right ? 5 : 6) : (right ? 8 : 7)) : (upper ? (right ? 1 : 2) : (right ? 4 : 3)));
const ALL_PERM = [...PERM].sort((a, b) => a - b);
function group(name, side) {
  // side: {upper?, lower?, right?, left?}
  const pos = { anteriors: [1, 2, 3], incisors: [1, 2], canines: [3], premolars: [4, 5], molars: [6, 7, 8], posteriors: [4, 5, 6, 7, 8] }[name];
  if (!pos) return [];
  return ALL_PERM.filter((t) => {
    const q = Math.floor(t / 10), p = t % 10;
    if (!pos.includes(p)) return false;
    if (side.upper && q > 2) return false;
    if (side.lower && q < 3) return false;
    if (side.right && !(q === 1 || q === 4)) return false;
    if (side.left && !(q === 2 || q === 3)) return false;
    return true;
  });
}

/* ── Words from Telugu / Hindi (script and Latin spelling) ─────────────── */
const SCRIPT_WORDS = {
  // Telugu
  "పన్ను": "tooth", "పళ్ళు": "teeth", "పుచ్చు": "caries", "పుచ్చిన": "caries", "నొప్పి": "pain",
  "చిగుళ్ళు": "gums", "చిగురు": "gum", "రక్తం": "bleeding", "కదులుతుంది": "mobile", "కదులుతోంది": "mobile",
  "తీసేయాలి": "advise extraction", "తీసేశాం": "extraction done", "పైన": "upper", "కింద": "lower",
  "కుడి": "right", "ఎడమ": "left", "లేదు": "missing", "వాపు": "swelling", "చీము": "pus",
  "అయింది": "done", "చేశాం": "done", "చేయాలి": "advise",
  // Hindi
  "दांत": "tooth", "दाँत": "tooth", "कीड़ा": "caries", "कीड़े": "caries", "दर्द": "pain", "मसूड़े": "gums",
  "मसूड़ा": "gum", "खून": "bleeding", "हिलता": "mobile", "हिल": "mobile", "निकालना": "advise extraction",
  "निकाल": "extraction", "ऊपर": "upper", "नीचे": "lower", "दायां": "right", "दाएं": "right", "दाहिना": "right",
  "बायां": "left", "बाएं": "left", "सूजन": "swelling", "मवाद": "pus", "हो गया": "done", "करना है": "advise",
  // number words
  "సున్నా": "0", "ఒకటి": "1", "రెండు": "2", "మూడు": "3", "నాలుగు": "4", "ఐదు": "5", "ఆరు": "6", "ఏడు": "7",
  "ఎనిమిది": "8", "తొమ్మిది": "9", "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पांच": "5",
  "पाँच": "5", "छह": "6", "छः": "6", "सात": "7", "आठ": "8", "नौ": "9",
};
const LATIN_WORDS = {
  pannu: "tooth", pallu: "teeth", pandlu: "teeth", daant: "tooth", dant: "tooth", daat: "tooth", dath: "tooth",
  puchu: "caries", puchhu: "caries", pucchu: "caries", puchina: "caries", keeda: "caries", keede: "caries", kida: "caries",
  noppi: "pain", dard: "pain", chigurlu: "gums", chigullu: "gums", masude: "gums", masoode: "gums", masuda: "gums",
  raktam: "bleeding", khoon: "bleeding", khun: "bleeding", kadulutundi: "mobile", kadulutondi: "mobile", hilta: "mobile",
  hilte: "mobile", teeseyali: "advise extraction", tiseyali: "advise extraction", teesesam: "extraction done",
  nikalna: "advise extraction", nikalo: "advise extraction", paina: "upper", upar: "upper", kindha: "lower",
  neeche: "lower", niche: "lower", kudi: "right", edama: "left", daayan: "right", dayan: "right", daayein: "right",
  baayan: "left", bayan: "left", baayein: "left", vaapu: "swelling", vapu: "swelling", cheemu: "pus", ledu: "missing",
  ayyindi: "done", chesam: "done", cheyali: "advise", okati: "1", rendu: "2", moodu: "3", mudu: "3", naalugu: "4",
  nalugu: "4", aidu: "5", aaru: "6", enimidi: "8", tommidi: "9", chaar: "4", paanch: "5", saat: "7", aath: "8",
};

/* ── Numbers ───────────────────────────────────────────────────────────── */
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINAL = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5,
  sixth: 6, "6th": 6, seventh: 7, "7th": 7, eighth: 8, "8th": 8 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };

/* ── Preparing the text ────────────────────────────────────────────────── */
const NATIVE_DIGITS = /[౦-౯०-९]/g;
function nativeDigit(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 0x0C66 && c <= 0x0C6F) return String(c - 0x0C66);
  if (c >= 0x0966 && c <= 0x096F) return String(c - 0x0966);
  return ch;
}
export function prepare(raw) {
  let s = String(raw || "").normalize("NFC").replace(NATIVE_DIGITS, nativeDigit);
  for (const [k, v] of Object.entries(SCRIPT_WORDS).sort((a, b) => b[0].length - a[0].length)) s = s.split(k).join(` ${v} `);
  s = s.replace(/[’']/g, "")                    // RCT'd → RCTd
    .replace(/(\d)\s*-\s*(\d)\s*-\s*(\d)(?!\s*mm)/g, (m, a, b, c) => ` ${a}-${b}-${c} `)   // 1-0-1 kept together
    .replace(/#\s*/g, " tooth ")
    .replace(/(\d)(mm|mg|ml|ncm|g)\b/gi, "$1 $2")
    .replace(/\b(\d{2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/(\d)\.(\d)/g, "$1\u0000$2")
    .replace(/([.,;:!?()])/g, " $1 ")
    .replace(/\u0000/g, ".")
    .replace(/\s+/g, " ").trim();
  return s;
}
function wordsToDigits(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i], lw = w.toLowerCase();
    if (LATIN_WORDS[lw] && /^\d$/.test(LATIN_WORDS[lw])) { out.push(LATIN_WORDS[lw]); continue; }
    if (TENS[lw] !== undefined) {
      const next = (tokens[i + 1] || "").toLowerCase();
      if (ONES[next] !== undefined && ONES[next] < 10 && ONES[next] > 0) { out.push(String(TENS[lw] + ONES[next])); i++; continue; }
      out.push(String(TENS[lw])); continue;
    }
    if (ONES[lw] !== undefined) { out.push(String(ONES[lw])); continue; }
    out.push(w);
  }
  return out;
}

/* ── Dictionaries (phrase → meaning). Longest phrase wins. ─────────────── */
const C = (cond, extra = {}) => ({ t: "COND", c: cond, ...extra });
const CONDITION_PHRASES = [
  ["deep caries", C("Deep Caries")], ["deep cavity", C("Deep Caries")], ["deep decay", C("Deep Caries")],
  ["grossly decayed", C("Deep Caries", { sev: "severe", note: "grossly decayed" })], ["gross caries", C("Deep Caries", { sev: "severe" })],
  ["proximal caries", C("Proximal Caries")], ["interproximal caries", C("Proximal Caries")], ["class 2 caries", C("Proximal Caries")],
  ["occlusal pits", C("Occlusal Pits")], ["pits and fissures", C("Occlusal Pits")], ["deep pits", C("Occlusal Pits")], ["deep fissures", C("Occlusal Pits")],
  ["root caries", C("Root Caries")], ["secondary caries", C("Secondary Caries")], ["recurrent caries", C("Secondary Caries")],
  ["caries", C("Caries")], ["carious", C("Caries")], ["cavity", C("Caries")], ["cavities", C("Caries")], ["decay", C("Caries")],
  ["decayed", C("Caries")], ["car", C("Caries")],
  ["calculus", C("Calculus")], ["tartar", C("Calculus")], ["calc", C("Calculus")], ["deposits", C("Calculus")],
  ["stains", C("Stains")], ["stain", C("Stains")], ["stained", C("Stains")], ["tobacco stains", C("Stains", { note: "tobacco" })],
  ["attrition", C("Attrition")], ["worn", C("Attrition")], ["cervical abrasion", C("Cervical Abrasion")], ["abrasion", C("Cervical Abrasion")],
  ["erosion", C("Erosion")], ["fracture", C("Fracture")], ["fractured", C("Fracture")], ["broken", C("Fracture")],
  ["chipped", C("Fracture", { note: "chipped" })], ["cracked", C("Fracture", { note: "crack" })], ["crack", C("Fracture", { note: "crack" })],
  ["fx", C("Fracture")], ["fluorosis", C("Fluorosis")], ["hypoplasia", C("Hypoplasia")],
  ["sensitivity", C("Sensitive Tooth")], ["sensitive", C("Sensitive Tooth")],
  ["gingivitis", C("Gingivitis")], ["gum recession", C("Gum Recession")], ["recession", C("Gum Recession")], ["receding gum", C("Gum Recession")],
  ["periodontal pocket", C("Pockets")], ["pockets", C("Pockets")], ["pocket", C("Pockets")], ["probing depth", C("Pockets")], ["pd", C("Pockets")],
  ["furcation involvement", C("Furcation")], ["furcation", C("Furcation")],
  ["mobility", C("Mobility")], ["mobile", C("Mobility")], ["loose", C("Mobility")], ["shaking", C("Mobility")],
  ["food impaction", C("Food Impaction")], ["food lodgement", C("Food Impaction")], ["food lodgment", C("Food Impaction")],
  ["irreversible pulpitis", C("Pulpitis", { note: "irreversible" })], ["reversible pulpitis", C("Pulpitis", { note: "reversible" })],
  ["pulpitis", C("Pulpitis")],
  ["periapical lesion", C("Periapical Pathology")], ["periapical radiolucency", C("Periapical Pathology")],
  ["periapical abscess", C("Abscess", { note: "periapical" })], ["periapical", C("Periapical Pathology")],
  ["pa lesion", C("Periapical Pathology")], ["granuloma", C("Periapical Pathology", { note: "granuloma" })],
  ["abscess", C("Abscess")], ["sinus tract", C("Abscess", { note: "sinus tract" })], ["pus", C("Abscess", { note: "pus" })],
  ["root canal treated", C("RC Treated")], ["rc treated", C("RC Treated")], ["rct treated", C("RC Treated")], ["rctd", C("RC Treated")],
  ["endodontically treated", C("RC Treated")], ["previously rct", C("RC Treated")], ["old rct", C("RC Treated")], ["rct done previously", C("RC Treated")],
  ["root stump", C("Root Stump")], ["root stumps", C("Root Stump")], ["retained root", C("Root Stump")], ["root piece", C("Root Stump")], ["rr", C("Root Stump")],
  ["faulty restoration", C("Faulty Restoration")], ["defective restoration", C("Faulty Restoration")], ["leaking filling", C("Faulty Restoration")],
  ["broken filling", C("Faulty Restoration")], ["open margin", C("Faulty Restoration", { note: "open margin" })],
  ["restored", C("Restored")], ["restoration", C("Restored")], ["filled", C("Restored")], ["filling", C("Restored")],
  ["amalgam", C("Restored", { note: "amalgam" })],
  ["crown", C("Crown")], ["capped", C("Crown")], ["pfm crown", C("Crown", { note: "PFM" })], ["zirconia crown", C("Crown", { note: "zirconia" })],
  ["bridge", C("Bridge")], ["pontic", C("Bridge", { note: "pontic" })], ["abutment", C("Bridge", { note: "abutment" })],
  ["veneer", C("Veneer")], ["implant", C("Implant")],
  ["missing", C("Missing")], ["absent", C("Missing")], ["extracted", C("Missing")], ["edentulous", C("Missing")], ["mis", C("Missing")],
  ["impacted", C("Impacted")], ["impaction", C("Impacted")], ["imp", C("Impacted")],
  ["mesioangular", C("Impacted", { note: "mesioangular" })], ["distoangular", C("Impacted", { note: "distoangular" })],
  ["horizontal impaction", C("Impacted", { note: "horizontal" })], ["vertical impaction", C("Impacted", { note: "vertical" })],
  ["partially erupted", C("Partially Erupted")], ["erupting", C("Partially Erupted")],
  ["pericoronitis", C("Other", { other: "Pericoronitis" })], ["dry socket", C("Other", { other: "Dry socket" })],
  ["retained deciduous", C("Retained Deciduous")], ["over retained", C("Retained Deciduous")], ["retained primary", C("Retained Deciduous")],
  ["retained milk tooth", C("Retained Deciduous")], ["supernumerary", C("Supernumerary")], ["mesiodens", C("Supernumerary", { note: "mesiodens" })],
  ["malposed", C("Malposed")], ["rotated", C("Malposed", { note: "rotated" })], ["tilted", C("Malposed", { note: "tilted" })],
  ["proclined", C("Malposed", { note: "proclined" })], ["buccally placed", C("Malposed", { note: "buccally placed" })],
  ["palatally placed", C("Malposed", { note: "palatally placed" })], ["crowded", C("Malposed", { note: "crowded" })],
];
const T = (label, extra = {}) => ({ t: "TREAT", label, ...extra });
// past-tense words (`done:true`) make a clause "treatment done" even without "done"
const TREATMENT_PHRASES = [
  ["access opening", T("A/O Done")], ["a/o", T("A/O Done")], ["a o", T("A/O Done")], ["ao", T("A/O Done")], ["pulp extirpation", T("A/O Done")],
  ["biomechanical preparation", T("BMP / Cleaning & Shaping Done")], ["cleaning and shaping", T("BMP / Cleaning & Shaping Done")],
  ["cleaning & shaping", T("BMP / Cleaning & Shaping Done")], ["bmp", T("BMP / Cleaning & Shaping Done")], ["b m p", T("BMP / Cleaning & Shaping Done")],
  ["instrumentation", T("BMP / Cleaning & Shaping Done")],
  ["obturation", T("Obturation Done")], ["obturated", T("Obturation Done", { done: true })], ["root canal filling", T("Obturation Done")],
  ["re rct", T("Re-RCT Done", { adv: "Re-Rct" })], ["rerct", T("Re-RCT Done", { adv: "Re-Rct" })], ["retreatment", T("Re-RCT Done", { adv: "Re-Rct" })],
  ["re treatment", T("Re-RCT Done", { adv: "Re-Rct" })],
  ["rct and crown", T("Other", { text: "RCT & crown", adv: "Rct & Crown", planOnly: true })], ["rct with crown", T("Other", { text: "RCT & crown", adv: "Rct & Crown", planOnly: true })],
  ["root canal treatment", T("Other", { text: "RCT", adv: "Rct & Crown" })], ["root canal", T("Other", { text: "RCT", adv: "Rct & Crown" })], ["rct", T("Other", { text: "RCT", adv: "Rct & Crown" })],
  ["implant placed", T("Implant Done", { done: true })], ["implant placement", T("Implant Done", { adv: "Implant" })], ["implant", T("Implant Done", { adv: "Implant" })],
  ["surgical extraction", T("Surgical Extraction", { adv: "Surgical Extraction" })], ["surgical removal", T("Surgical Extraction", { adv: "Surgical Extraction" })],
  ["disimpaction", T("Surgical Extraction", { adv: "Surgical Extraction" })], ["odontectomy", T("Surgical Extraction", { adv: "Surgical Extraction" })],
  ["ortho extraction", T("Extraction", { adv: "Ortho Extraction" })], ["orthodontic extraction", T("Extraction", { adv: "Ortho Extraction" })],
  ["extraction", T("Extraction", { adv: "Extraction" })], ["extracted", T("Extraction", { done: true })], ["removed", T("Extraction", { done: true })],
  ["ext", T("Extraction", { adv: "Extraction" })], ["exo", T("Extraction", { adv: "Extraction" })],
  ["composite restoration", T("Composite Restoration", { adv: "Composite Restoration" })], ["composite filling", T("Composite Restoration", { adv: "Composite Restoration" })],
  ["composite", T("Composite Restoration", { adv: "Composite Restoration" })], ["tooth coloured filling", T("Composite Restoration", { adv: "Composite Restoration" })],
  ["tooth colored filling", T("Composite Restoration", { adv: "Composite Restoration" })],
  ["gic restoration", T("GIC Restoration", { adv: "Gic Restoration" })], ["gic filling", T("GIC Restoration", { adv: "Gic Restoration" })],
  ["gic", T("GIC Restoration", { adv: "Gic Restoration" })], ["g i c", T("GIC Restoration", { adv: "Gic Restoration" })],
  ["glass ionomer", T("GIC Restoration", { adv: "Gic Restoration" })],
  ["permanent cementation", T("Permanent Cementation", { adv: "Permanent Cementation" })], ["crown cemented", T("Permanent Cementation", { done: true })],
  ["temporary cementation", T("Temporary Cementation", { adv: "Temporary Cementation" })],
  ["temporary restoration", T("Temporary Restoration", { adv: "Temporary Restoration" })], ["temporary filling", T("Temporary Restoration", { adv: "Temporary Restoration" })],
  ["cavit", T("Temporary Restoration", { adv: "Temporary Restoration" })],
  ["pulpectomy", T("Pulpectomy", { adv: "Pulpectomy" })], ["pulpotomy", T("Other", { text: "Pulpotomy", adv: "Other" })],
  ["space maintainer", T("Space Maintainer", { adv: "Space Maintainer" })],
  ["zirconia crown", T("Other", { text: "Zirconia crown", adv: "Zirconia Crown" })], ["zirconia", T("Other", { text: "Zirconia crown", adv: "Zirconia Crown" })],
  ["dmls crown", T("Other", { text: "DMLS crown", adv: "Dmls Crown" })], ["dmls", T("Other", { text: "DMLS crown", adv: "Dmls Crown" })],
  ["metal ceramic crown", T("Other", { text: "Metal-ceramic crown", adv: "Dmls Crown" })], ["pfm", T("Other", { text: "PFM crown", adv: "Dmls Crown" })],
  ["crown preparation", T("Other", { text: "Crown preparation", adv: "Other" })], ["tooth preparation", T("Other", { text: "Tooth preparation", adv: "Other" })],
  ["crown", T("Other", { text: "Crown", adv: "Zirconia Crown" })], ["bridge", T("Other", { text: "Bridge", adv: "Bridge" })],
  ["scaling and polishing", T("Other", { text: "Scaling & polishing", adv: "Other" })], ["oral prophylaxis", T("Other", { text: "Oral prophylaxis", adv: "Other" })],
  ["scaling", T("Other", { text: "Scaling", adv: "Other" })], ["polishing", T("Other", { text: "Polishing", adv: "Other" })],
  ["root planing", T("Other", { text: "Root planing", adv: "Other" })], ["curettage", T("Other", { text: "Curettage", adv: "Other" })],
  ["flap surgery", T("Other", { text: "Flap surgery", adv: "Other" })], ["frenectomy", T("Other", { text: "Frenectomy", adv: "Other" })],
  ["gingivectomy", T("Other", { text: "Gingivectomy", adv: "Other" })], ["incision and drainage", T("Other", { text: "Incision & drainage", adv: "Other" })],
  ["i and d", T("Other", { text: "Incision & drainage", adv: "Other" })], ["biopsy", T("Other", { text: "Biopsy", adv: "Other" })],
  ["bleaching", T("Other", { text: "Bleaching", adv: "Other" })], ["veneer", T("Other", { text: "Veneer", adv: "Other" })],
  ["denture", T("Other", { text: "Denture", adv: "Other" })], ["inlay", T("Other", { text: "Inlay", adv: "Other" })], ["onlay", T("Other", { text: "Onlay", adv: "Other" })],
  ["pit and fissure sealant", T("Other", { text: "Pit & fissure sealant", adv: "Other" })], ["sealant", T("Other", { text: "Pit & fissure sealant", adv: "Other" })],
  ["fluoride application", T("Other", { text: "Fluoride application", adv: "Other" })], ["iopa", T("Other", { text: "IOPA X-ray", adv: "Other" })],
  ["opg", T("Other", { text: "OPG", adv: "Other" })], ["cbct", T("Other", { text: "CBCT", adv: "Other" })], ["splint", T("Other", { text: "Splint", adv: "Other" })],
  ["night guard", T("Other", { text: "Night guard", adv: "Other" })], ["braces", T("Other", { text: "Orthodontic treatment", adv: "Other" })],
  ["orthodontic treatment", T("Other", { text: "Orthodontic treatment", adv: "Other" })], ["aligners", T("Other", { text: "Aligners", adv: "Other" })],
  ["prf", T("Other", { text: "PRF placed", adv: "Other" })], ["bone graft", T("Other", { text: "Bone graft", adv: "Other" })],
  ["sutures removed", T("Other", { text: "Sutures removed", done: true })], ["suture removal", T("Other", { text: "Suture removal", adv: "Other" })],
  ["sutures placed", T("Other", { text: "Sutures placed", done: true })], ["dressing", T("Other", { text: "Dressing", adv: "Other" })],
];
const DONE_WORDS = ["done", "completed", "complete", "did", "performed", "finished", "today", "placed", "given", "cemented", "obturated"];
const PLAN_WORDS = ["advise", "advised", "advice", "plan", "planned", "planning", "needs", "need", "needed", "require", "required", "requires",
  "suggest", "suggested", "recommend", "recommended", "next", "later", "indicated", "tp", "scheduled"];
const SURF_WORDS = {
  mesial: "M", occlusal: "O", incisal: "I", distal: "D", buccal: "B", lingual: "L", palatal: "L", labial: "B", facial: "B",
  mesio: "M", disto: "D", bucco: "B", linguo: "L", occluso: "O", "mesio-occlusal": "MO", "disto-occlusal": "DO",
  "mesio-occluso-distal": "MOD", mo: "MO", od: "OD", mod: "MOD", modb: "MODB", modl: "MODL", mob: "MOB", dob: "DOB", modbl: "MODBL",
};
const SEV_WORDS = { mild: "mild", slight: "mild", minor: "mild", moderate: "moderate", medium: "moderate", severe: "severe",
  advanced: "severe", gross: "severe", heavy: "severe", critical: "critical", extensive: "severe" };
const SITE_WORDS = { buccal: "B", facial: "B", labial: "B", lingual: "L", palatal: "L", mesial: "M", distal: "D" };
const POS_WORDS = { central: 1, centrals: 1, lateral: 2, laterals: 2, canine: 3, canines: 3, cuspid: 3, "eye tooth": 3, wisdom: 8, "wisdom tooth": 8 };
const STOP = new Set(["the", "a", "an", "on", "in", "at", "of", "with", "is", "has", "have", "tooth", "teeth", "there", "and", "also", "irt",
  "wrt", "patient", "shows", "show", "seen", "present", "noted", "note", "region", "area", "side", "please", "mark", "add", "chart", "ok",
  "okay", "um", "uh", "hmm", "number", "no", "its", "it", "this", "that", "for", "to", "be", "was", "are", "done", "today", "found",
  "having", "showing", "w.r.t", "i.r.t", "with respect", "respect", "surface", "surfaces", "grade", "mm", "millimetre", "millimeter"]);

function compile(list) {
  const m = new Map();
  for (const [phrase, val] of list) {
    const toks = phrase.split(" ");
    const key = toks[0];
    if (!m.has(key)) m.set(key, []);
    m.get(key).push({ toks, val });
  }
  for (const arr of m.values()) arr.sort((a, b) => b.toks.length - a.toks.length);
  return m;
}
const CONDS = compile(CONDITION_PHRASES);
const TREATS = compile(TREATMENT_PHRASES);
function matchAt(dict, toks, i) {
  const cands = dict.get(toks[i]);
  if (!cands) return null;
  for (const c of cands) {
    let ok = true;
    for (let k = 0; k < c.toks.length; k++) if (toks[i + k] !== c.toks[k]) { ok = false; break; }
    if (ok) return { len: c.toks.length, val: c.val };
  }
  return null;
}

/* ── Tokens → atoms ────────────────────────────────────────────────────── */
function lexer(text, mode) {
  const rawToks = wordsToDigits(prepare(text).split(" ").filter(Boolean));
  const upperFlags = rawToks.map((w) => /^[A-Z]{2,5}$/.test(w));
  const toks = rawToks.map((w) => {
    const lw = w.toLowerCase();
    const mapped = LATIN_WORDS[lw];
    return mapped && !/^\d$/.test(mapped) ? mapped : lw;
  }).join(" ").split(" ");
  // LATIN_WORDS may expand to two words ("advise extraction"); keep upper flags roughly aligned
  const atoms = [];
  const isNum = (w) => /^\d+(\.\d+)?$/.test(w || "");
  let toothCue = false;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    const next = toks[i + 1], next2 = toks[i + 2];
    if ([".", ",", ";", ":", "!", "?", "next", "then", "also", "(", ")"].includes(w)) {
      if (w === "next" && (next === "visit" || next === "appointment")) { atoms.push({ t: "PLAN" }); i++; continue; }
      atoms.push({ t: "SEP" }); continue;
    }
    if (w === "and" || w === "&" || w === "plus") { atoms.push({ t: "AND" }); continue; }
    if (["tooth", "teeth", "number", "irt", "wrt", "i.r.t", "w.r.t"].includes(w)) { toothCue = true; continue; }
    if (["to", "till", "until", "through", "upto", "thru"].includes(w)) { atoms.push({ t: "TO" }); continue; }
    if (w === "with" && next === "respect" && next2 === "to") { toothCue = true; i += 2; continue; }
    // pattern 1-0-1 (prescriptions) / 5-4-6 (pockets)
    if (/^\d-\d-\d$/.test(w)) { atoms.push({ t: "TRIPLE", v: w.split("-").map(Number) }); continue; }
    // quadrant + position:  upper right 6 / UR6 / lower left first molar / upper right D
    const qd = readQuadrant(toks, i);
    if (qd) { atoms.push(...qd.atoms); i += qd.len - 1; toothCue = false; continue; }
    // groups: (upper|lower)? (right|left)? anteriors / molars …
    const gr = readGroup(toks, i);
    if (gr) { atoms.push({ t: "TEETH", teeth: gr.teeth, group: true }); i += gr.len - 1; continue; }
    if (["generalised", "generalized", "full", "all", "entire", "whole"].includes(w) && ["mouth", "teeth", "dentition", "arch"].includes(next)) {
      atoms.push({ t: "GEN" }); i++; continue;
    }
    if (w === "generalised" || w === "generalized" || w === "generally") { atoms.push({ t: "GEN" }); continue; }
    if (isNum(w)) {
      const n = Number(w);
      // "one six" → 16 (two single digits that make a tooth), not inside depth / dose context
      if (/^\d$/.test(w) && /^\d$/.test(next || "") && isTooth(n * 10 + Number(next))
          && (mode !== "perio" || toothCue || atoms.length === 0 || atoms[atoms.length - 1].t === "SEP")
          && !(atoms.length && ["DEPTHKW", "SITE"].includes(atoms[atoms.length - 1].t))) {
        atoms.push({ t: "TEETH", teeth: [n * 10 + Number(next)] }); i++; toothCue = false; continue;
      }
      const unit = next === "mm" || next === "millimetre" || next === "millimeter" ? "mm"
        : next === "ncm" || next === "newton" ? "Ncm" : next === "percent" || next === "%" ? "%"
        : next === "mg" || next === "ml" || next === "g" ? next : next === "days" || next === "day" ? "days" : null;
      if (!unit && Number.isInteger(n) && isTooth(n) && w.length === 2) {
        atoms.push({ t: "TEETH", teeth: [n] }); toothCue = false; continue;
      }
      atoms.push({ t: "NUM", n, unit, cue: toothCue }); if (unit) i++; toothCue = false; continue;
    }
    // surfaces as letters: "M O D" or "MOD"
    const sf = readSurfaces(toks, i, upperFlags);
    if (sf) { atoms.push({ t: "SURF", s: sf.s }); i += sf.len - 1; continue; }
    // perio words
    if (["bleeding", "bop", "bleeds"].includes(w)) { atoms.push({ t: "BOP" }); if (next === "on" && next2 === "probing") i += 2; continue; }
    if (["suppuration"].includes(w)) { atoms.push({ t: "WORD", w: "suppuration" }); continue; }
    if (w === "grade" || w === "class" || w === "degree") { atoms.push({ t: "GRADE" }); continue; }
    if (ROMAN[w] && atoms.length && ["GRADE", "COND"].includes(atoms[atoms.length - 1].t)) { atoms.push({ t: "NUM", n: ROMAN[w] }); continue; }
    if (SEV_WORDS[w]) { atoms.push({ t: "SEV", v: SEV_WORDS[w] }); continue; }
    if (DONE_WORDS.includes(w)) { atoms.push({ t: "DONE", w }); }
    if (PLAN_WORDS.includes(w)) { atoms.push({ t: "PLAN", w }); continue; }
    // conditions / treatments (both are recorded; the mode decides which one is used)
    const cm = matchAt(CONDS, toks, i);
    const tm = matchAt(TREATS, toks, i);
    if (cm || tm) {
      const len = Math.max(cm?.len || 0, tm?.len || 0);
      atoms.push({ t: "TERM", cond: cm && cm.len === len ? cm.val : null, treat: tm && tm.len === len ? tm.val : null, text: toks.slice(i, i + len).join(" ") });
      i += len - 1; continue;
    }
    if (SITE_WORDS[w]) { atoms.push({ t: "SITE", s: SITE_WORDS[w] }); continue; }
    if (SURF_WORDS[w]) { atoms.push({ t: "SURF", s: SURF_WORDS[w].split("") }); continue; }
    if (DONE_WORDS.includes(w)) continue;
    atoms.push({ t: "WORD", w });
  }
  return atoms;
}

function readQuadrant(toks, i) {
  // compact: ur6, ul8, lr4, ll6, ure (deciduous letter)
  const m = /^(ur|ul|lr|ll|q[1-4])([1-8a-e])?$/.exec(toks[i]);
  if (m) {
    let upper, right;
    if (m[1][0] === "q") { const q = Number(m[1][1]); upper = q <= 2; right = q === 1 || q === 4; }
    else { upper = m[1][0] === "u"; right = m[1][1] === "r"; }
    let pos = m[2], len = 1;
    if (!pos && /^[1-8]$/.test(toks[i + 1] || "")) { pos = toks[i + 1]; len = 2; }
    if (!pos && /^[a-e]$/.test(toks[i + 1] || "")) { pos = toks[i + 1]; len = 2; }
    if (!pos) return null;
    const deci = /[a-e]/.test(pos);
    const p = deci ? "abcde".indexOf(pos) + 1 : Number(pos);
    return { len, atoms: [{ t: "TEETH", teeth: [quadOf(upper, right, deci) * 10 + p] }] };
  }
  // words: (upper|lower|maxillary|mandibular) (right|left) …  or (right|left) (upper|lower)
  const UP = ["upper", "maxillary", "top"], LO = ["lower", "mandibular", "bottom"], R = ["right"], L = ["left"];
  let j = i, upper = null, right = null;
  for (let k = 0; k < 2; k++) {
    const w = toks[j];
    if (upper === null && UP.includes(w)) { upper = true; j++; continue; }
    if (upper === null && LO.includes(w)) { upper = false; j++; continue; }
    if (right === null && R.includes(w)) { right = true; j++; continue; }
    if (right === null && L.includes(w)) { right = false; j++; continue; }
    break;
  }
  if (upper === null || right === null) return null;
  // optional "side", "quadrant", "region"
  while (["side", "quadrant", "region", "back", "the"].includes(toks[j])) j++;
  let deci = false;
  if (["primary", "deciduous", "milk", "baby"].includes(toks[j])) { deci = true; j++; }
  const pos = readPosition(toks, j, deci);
  if (!pos) return null;
  return { len: pos.end - i, atoms: [{ t: "TEETH", teeth: [quadOf(upper, right, pos.deci) * 10 + pos.p] }] };
}
function readPosition(toks, j, deci) {
  const w = toks[j], n1 = toks[j + 1], n2 = toks[j + 2];
  if (/^[1-8]$/.test(w) && !deci) {
    // "upper right 6", "upper right 6th"
    return { p: Number(w), end: j + 1 + (["molar", "premolar", "tooth"].includes(n1) ? 1 : 0), deci: false };
  }
  if (/^[a-e]$/.test(w)) return { p: "abcde".indexOf(w) + 1, end: j + 1, deci: true };
  if (ORDINAL[w] !== undefined) {
    const ord = ORDINAL[w];
    if (n1 === "molar" || n1 === "molars") {
      if (deci || ord <= 2 && (n2 === "primary" || n2 === "deciduous")) return { p: 3 + ord, end: j + 2, deci: true };
      return { p: 5 + ord, end: j + 2, deci: false };
    }
    if (n1 === "premolar" || n1 === "bicuspid") return { p: 3 + ord, end: j + 2, deci: false };
    return null;
  }
  if (w === "third" && n1 === "molar") return { p: 8, end: j + 2, deci: false };
  if (w === "wisdom") return { p: 8, end: j + 1 + (n1 === "tooth" ? 1 : 0), deci: false };
  if (POS_WORDS[w] !== undefined) {
    let end = j + 1;
    if (["incisor", "incisors", "tooth"].includes(n1)) end++;
    return { p: POS_WORDS[w], end, deci };
  }
  return null;
}
function readGroup(toks, i) {
  const side = {};
  let j = i;
  for (let k = 0; k < 3; k++) {
    const w = toks[j];
    if (["upper", "maxillary"].includes(w) && !side.lower && !side.upper) { side.upper = true; j++; continue; }
    if (["lower", "mandibular"].includes(w) && !side.lower && !side.upper) { side.lower = true; j++; continue; }
    if (w === "right" && !side.right && !side.left) { side.right = true; j++; continue; }
    if (w === "left" && !side.right && !side.left) { side.left = true; j++; continue; }
    if (w === "all") { j++; continue; }
    break;
  }
  const map = { anterior: "anteriors", anteriors: "anteriors", incisors: "incisors", canines: "canines", premolars: "premolars",
    molars: "molars", posterior: "posteriors", posteriors: "posteriors", "front": "anteriors" };
  let g = map[toks[j]];
  if (toks[j] === "front" && toks[j + 1] === "teeth") { g = "anteriors"; j++; }
  if (!g) return null;
  if (toks[j] === "anterior" && toks[j + 1] === "teeth") j++;
  if (j === i && toks[j] !== "anteriors" && toks[j] !== "posteriors") return null;   // "molars" alone is too vague
  const teeth = group(g, side);
  return teeth.length ? { teeth, len: j - i + 1 } : null;
}
const SURF_LETTERS = new Set(["m", "o", "d", "b", "l", "i"]);
const LOWER_SURF_OK = new Set(["mod", "mo", "od", "modb", "modl", "mob", "dob", "modbl", "mol", "dol", "ob", "ol"]);
function readSurfaces(toks, i, upperFlags) {
  const w = toks[i];
  // spaced letters "m o d"
  if (w.length === 1 && SURF_LETTERS.has(w)) {
    let j = i; const s = [];
    while (j < toks.length && toks[j].length === 1 && SURF_LETTERS.has(toks[j])) { s.push(toks[j].toUpperCase()); j++; }
    if (s.length >= 2) return { s, len: j - i };
    return null;
  }
  if (/^[modbli]{2,5}$/.test(w) && (upperFlags[i] || LOWER_SURF_OK.has(w)) && !["do", "bi"].includes(w)) {
    return { s: w.toUpperCase().split(""), len: 1 };
  }
  return null;
}

/* ── Atoms → clauses → items ───────────────────────────────────────────── */
function clauses(atoms) {
  const out = [];
  let cur = null;
  const fresh = () => ({ atoms: [], teeth: [], first: null });
  const push = () => { if (cur && cur.atoms.length) out.push(cur); cur = fresh(); };
  cur = fresh();
  let last = null;
  for (let k = 0; k < atoms.length; k++) {
    const a = atoms[k];
    if (a.t === "SEP") { push(); last = null; continue; }
    const hasTeeth = cur.atoms.some((x) => x.t === "TEETH" || x.t === "GEN");
    const hasTerm = cur.atoms.some((x) => x.t === "TERM");
    if (a.t === "TEETH" || a.t === "GEN") {
      // a range "11 to 13" stays in the clause
      const startNew = hasTeeth && hasTerm && last && !["TEETH", "AND", "TO"].includes(last.t)
        && !(cur.first === "TERM" && ["TERM", "SURF", "SEV", "NUM", "WORD", "DONE", "PLAN"].includes(last.t) && !cur.atoms.slice(cur.atoms.findIndex((x) => x.t === "TEETH")).some((x) => x.t === "TERM"));
      if (startNew) push();
      if (!cur.first) cur.first = "TEETH";
    }
    if (a.t === "TERM") {
      if (cur.first === "TERM" && hasTeeth) {
        // "caries 16, calculus 31" style: a new term after teeth starts a new clause
        const lastTermIdx = cur.atoms.map((x) => x.t).lastIndexOf("TERM");
        const teethAfter = cur.atoms.slice(lastTermIdx + 1).some((x) => x.t === "TEETH");
        if (teethAfter) push();
      }
      if (!cur.first) cur.first = "TERM";
    }
    if ((a.t === "DONE" || a.t === "PLAN") && cur.atoms.some((x) => x.t === "TERM") && hasTeeth && last && last.t === "AND") {
      // "… done on 36 and advise extraction 48"
      push();
    }
    if (a.t === "AND" && hasTeeth && hasTerm) {
      // look ahead: "and" followed by a term or a plan word with no teeth in between → new clause
      const n = atoms[k + 1];
      if (n && (n.t === "PLAN" || n.t === "DONE" || (n.t === "TERM" && cur.first === "TEETH"))) { push(); last = a; continue; }
    }
    cur.atoms.push(a);
    last = a;
  }
  push();
  return out;
}
function teethOf(cl) {
  const list = [];
  const at = cl.atoms;
  for (let k = 0; k < at.length; k++) {
    const a = at[k];
    if (a.t !== "TEETH") continue;
    if (at[k + 1]?.t === "TO" && at[k + 2]?.t === "TEETH") {
      const r = toothRange(a.teeth[0], at[k + 2].teeth[0]);
      if (r) { list.push(...r); k += 2; continue; }
    }
    list.push(...a.teeth);
  }
  return [...new Set(list)];
}
const surfacesOf = (cl) => {
  const s = new Set();
  cl.atoms.filter((a) => a.t === "SURF").forEach((a) => a.s.forEach((x) => s.add(x)));
  cl.atoms.filter((a) => a.t === "SITE").forEach((a) => s.add(a.s));      // "mesial", "palatal" … also name surfaces
  return SURF_ORDER.split("").filter((x) => s.has(x));
};
const sevOf = (cl) => { const a = cl.atoms.find((x) => x.t === "SEV"); return a ? a.v : ""; };
const wordsOf = (cl) => cl.atoms.filter((a) => a.t === "WORD" && !STOP.has(a.w)).map((a) => a.w);
const gradeAfter = (at, k) => {
  for (let j = k + 1; j < Math.min(at.length, k + 4); j++) {
    if (at[j].t === "NUM" && at[j].n >= 1 && at[j].n <= 3) return at[j].n;
    if (at[j].t === "TEETH" || at[j].t === "TERM") break;
  }
  return null;
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pocketSeverity = (max) => (max >= 8 ? "critical" : max >= 6 ? "severe" : max >= 4 ? "moderate" : "mild");

/* Perio values in one clause: pockets per site, bleeding, recession mm, mobility / furcation grade */
function perioOf(cl, mode) {
  const at = cl.atoms;
  const sites = {}; let site = null; const loose = [];
  let recession = null, mobility = null, furcation = null, bleeding = false, inPocket = mode === "perio";
  for (let k = 0; k < at.length; k++) {
    const a = at[k];
    if (a.t === "BOP") bleeding = true;
    if (a.t === "SITE") { site = a.s; inPocket = true; continue; }
    if (a.t === "TERM" && a.cond) {
      const c = a.cond.c;
      if (c === "Pockets") { inPocket = true; site = null; continue; }
      if (c === "Gum Recession") {
        for (let j = k + 1; j < at.length && j < k + 4; j++) if (at[j].t === "NUM") { recession = at[j].n; break; }
        inPocket = false; continue;
      }
      if (c === "Mobility") { mobility = gradeAfter(at, k) || 1; inPocket = false; continue; }
      if (c === "Furcation") { furcation = gradeAfter(at, k) || 1; inPocket = false; continue; }
    }
    if (a.t === "TRIPLE" && inPocket) { (sites[site || (sites.B ? "L" : "B")] = a.v); continue; }
    if (a.t === "NUM" && inPocket && a.n > 0 && a.n <= 15 && (a.unit === "mm" || !a.unit)) {
      if (site) { (sites[site] = sites[site] || []).push(a.n); if (sites[site].length >= 3) site = null; }
      else loose.push(a.n);
    }
  }
  if (loose.length) {
    if (loose.length >= 6) { sites.B = sites.B || loose.slice(0, 3); sites.L = sites.L || loose.slice(3, 6); }
    else if (loose.length === 3) sites[sites.B ? "L" : "B"] = loose;
    else sites.X = loose;
  }
  return { sites, recession, mobility, furcation, bleeding };
}

/* ── MAIN: chart / perio ───────────────────────────────────────────────── */
export function parseChart(text, { mode = "chart", skipTreatment = false } = {}) {
  const atoms = lexer(text, mode);
  const items = [], problems = [];
  let carryTeeth = [], carryGen = false;
  for (const cl of clauses(atoms)) {
    // inside a consultation: sentences about treatment belong to Treatment / Advice, not the chart
    if (skipTreatment && cl.atoms.some((a) => a.t === "DONE" || a.t === "PLAN" || (a.t === "TERM" && a.treat && !a.cond))) {
      const t = teethOf(cl); if (t.length) carryTeeth = t;
      continue;
    }
    let teeth = teethOf(cl);
    let gen = cl.atoms.some((a) => a.t === "GEN");
    const terms = cl.atoms.filter((a) => a.t === "TERM" && a.cond);
    const p = perioOf(cl, mode);
    const hasPerio = Object.keys(p.sites).length || p.recession || p.mobility || p.furcation || p.bleeding;
    if (!teeth.length && !gen && (terms.length || hasPerio) && carryTeeth.length) teeth = carryTeeth;
    else if (!teeth.length && !gen && (terms.length || hasPerio) && carryGen) gen = true;
    carryGen = gen && !teeth.length;
    if (teeth.length && !terms.length && !hasPerio && !gen) { carryTeeth = teeth; continue; }   // teeth now, condition in the next clause
    const words = wordsOf(cl);
    const surfaces = surfacesOf(cl), sev = sevOf(cl);
    if (gen && !teeth.length) {
      // generalised findings → not on one tooth
      for (const t of terms) items.push({ kind: "general", label: generalLabel(t.cond), notes: [t.cond.note, ...words].filter(Boolean).join(" "), src: t.text });
      if (p.bleeding && !terms.length) items.push({ kind: "general", label: "Bleeding Gums", notes: "" });
      continue;
    }
    if (!teeth.length) {
      if (terms.length || words.length) problems.push(`No tooth number heard for: “${cl.atoms.map(atomText).filter(Boolean).join(" ")}”`);
      continue;
    }
    carryTeeth = teeth; carryGen = false;
    const perioDone = new Set();
    const pocketNote = () => {
      const parts = [];
      for (const k of ["B", "L", "M", "D", "X"]) if (p.sites[k]) parts.push(`${k === "X" ? "" : k + " "}${p.sites[k].join("-")}`.trim());
      return parts.length ? `${parts.join(" · ")} mm` : "";
    };
    for (const tooth of teeth) {
      const base = { kind: "finding", tooth };
      const all = Object.values(p.sites).flat();
      if (all.length) {
        const max = Math.max(...all);
        if (max >= 4 || mode === "perio") {
          items.push({ ...base, condition: "Pockets", surfaces: [], severity: max >= 4 ? pocketSeverity(max) : "mild",
            notes: [pocketNote(), p.bleeding ? "bleeding on probing" : "", ...words].filter(Boolean).join(" · ") });
          perioDone.add("Pockets");
        }
      }
      if (p.bleeding && !perioDone.has("Pockets") && !terms.some((t) => t.cond.c === "Gingivitis")) {
        items.push({ ...base, condition: "Gingivitis", surfaces: [], severity: "", notes: "bleeding on probing" });
      }
      if (p.recession) {
        items.push({ ...base, condition: "Gum Recession", surfaces: surfaces, severity: p.recession >= 5 ? "severe" : p.recession >= 3 ? "moderate" : "mild", notes: `${p.recession} mm` });
        perioDone.add("Gum Recession");
      }
      if (p.mobility) { items.push({ ...base, condition: `Mobility ${["I", "II", "III"][p.mobility - 1]}`, surfaces: [], severity: "", notes: "" }); perioDone.add("Mobility"); }
      if (p.furcation) { items.push({ ...base, condition: "Furcation", surfaces: [], severity: p.furcation >= 3 ? "severe" : p.furcation === 2 ? "moderate" : "mild", notes: `Grade ${["I", "II", "III"][p.furcation - 1]}` }); perioDone.add("Furcation"); }
      for (const t of terms) {
        const c = t.cond.c;
        if (perioDone.has(c) || c === "Mobility" && perioDone.has("Mobility")) continue;
        if (c === "Pockets" && perioDone.has("Pockets")) continue;
        if (c === "Mobility") { items.push({ ...base, condition: "Mobility I", surfaces: [], severity: "", notes: "" }); continue; }
        items.push({
          ...base,
          condition: c,
          other_text: c === "Other" ? t.cond.other || cap(t.text) : "",
          surfaces: ["Caries", "Deep Caries", "Proximal Caries", "Secondary Caries", "Restored", "Faulty Restoration", "Fracture", "Cervical Abrasion", "Root Caries", "Occlusal Pits"].includes(c) ? surfaces : [],
          severity: t.cond.sev || sev,
          notes: [t.cond.note, ...words].filter(Boolean).join(" "),
          src: t.text,
        });
      }
    }
  }
  return { items: dedupe(items), problems, text: prepare(text) };
}
function generalLabel(cond) {
  const map = { Calculus: "Calculus / Tartar", Stains: "Stains / Discoloration", Gingivitis: "Gingivitis", "Gum Recession": "Gingival Recession",
    "Sensitive Tooth": "Generalised Sensitivity", Fluorosis: "Fluorosis", Attrition: "Bruxism / Attrition", Pockets: "Periodontitis", Malposed: "Crowding" };
  return map[cond.c] || cond.other || cond.c;
}
function atomText(a) {
  if (a.t === "WORD") return a.w;
  if (a.t === "TERM") return a.text;
  if (a.t === "NUM") return String(a.n);
  if (a.t === "SURF") return a.s.join("");
  return "";
}
function dedupe(items) {
  const seen = new Map();
  for (const it of items) {
    const key = it.kind === "finding" ? `${it.tooth}|${it.condition}|${it.other_text || ""}` : JSON.stringify(it);
    if (seen.has(key)) {
      const old = seen.get(key);
      if (it.surfaces?.length) old.surfaces = [...new Set([...(old.surfaces || []), ...it.surfaces])];
      if (it.notes && !String(old.notes || "").includes(it.notes)) old.notes = [old.notes, it.notes].filter(Boolean).join(" · ");
      continue;
    }
    seen.set(key, { ...it });
  }
  return [...seen.values()];
}

/* ── MAIN: treatment done / advice ─────────────────────────────────────── */
export function parseConsult(text, { mode = "treatment" } = {}) {
  // mode: "treatment" (done today), "advice" (plan) or "both" (decided per sentence)
  const atoms = lexer(text, "chart");
  const items = [], problems = [];
  let carryTeeth = [];
  for (const cl of clauses(atoms)) {
    const terms = cl.atoms.filter((a) => a.t === "TERM" && a.treat);
    let teeth = teethOf(cl);
    if (!terms.length) {
      if (teeth.length) carryTeeth = teeth;
      const words = wordsOf(cl);
      if (words.length && items.length) {
        const last = items[items.length - 1];
        last.note = [last.note, words.join(" ")].filter(Boolean).join(" ");
      }
      continue;
    }
    if (!teeth.length && carryTeeth.length) teeth = carryTeeth;
    carryTeeth = teeth;
    const done = cl.atoms.some((a) => a.t === "DONE") || terms.some((t) => t.treat.done);
    const plan = cl.atoms.some((a) => a.t === "PLAN");
    let kind = mode === "advice" ? "advice" : mode === "treatment" ? "treatment" : null;
    if (!kind) kind = plan && !done ? "advice" : done ? "treatment" : terms.some((t) => t.treat.planOnly) ? "advice" : "advice";
    if (mode === "both" && plan && done) kind = cl.atoms.findIndex((a) => a.t === "PLAN") < cl.atoms.findIndex((a) => a.t === "DONE") ? "advice" : "treatment";
    const details = detailsOf(cl);
    const used = new Set();
    for (const t of terms) {
      const tr = t.treat;
      let label, text;
      if (kind === "advice") { label = tr.adv || "Other"; text = label === "Other" ? (tr.text || cap(t.text)) : label; }
      else {
        label = tr.label;
        text = label === "Other" ? (tr.text || cap(t.text)) : label;
      }
      // deciduous teeth: extraction / pulpectomy wording stays the same; pulpectomy only for milk teeth
      if (teeth.length && teeth.every(isDeciduous) && label === "A/O Done") { label = "Pulpectomy"; text = "Pulpectomy"; }
      const key = `${kind}|${text}`;
      if (used.has(key)) continue;
      used.add(key);
      items.push({ kind, label, text, teeth: [...teeth].sort((a, b) => a - b), note: details,
        chartType: teeth.length && teeth.every(isDeciduous) ? "deciduous" : "permanent", src: t.text });
    }
  }
  return { items, problems, text: prepare(text) };
}
// spoken extras worth keeping with a treatment: "working length 21 mm", "size 25", "35 Ncm", "4.1 by 10"
function detailsOf(cl) {
  const out = [];
  for (const a of cl.atoms) {
    if (a.t === "WORD" && !STOP.has(a.w) && !["on", "for", "a"].includes(a.w)) out.push(a.w);
    else if (a.t === "NUM" && !a.cue) out.push(`${a.n}${a.unit ? " " + a.unit : ""}`);
    else if (a.t === "SURF") out.push(a.s.join(""));
    else if (a.t === "SITE") out.push(Object.keys(SITE_WORDS).find((k) => SITE_WORDS[k] === a.s));
    else if (a.t === "TERM" || a.t === "TEETH") out.push("|");
  }
  return out.join(" ").split("|").map((x) => x.trim()).filter(Boolean).join(", ")
    .replace(/(\d+(?:\.\d+)?) (?:by|x|into) (\d+(?:\.\d+)?)( mm)?/g, "Ø$1 × $2 mm")
    .replace(/(\d+) (?:ncm|Ncm)\b/g, "$1 Ncm")
    .replace(/\b([a-z]\d{1,2})\b/g, (m) => m.toUpperCase())
    .replace(/\bwl\b/g, "working length")
    .replace(/\s+/g, " ").trim();
}

/* ── MAIN: prescriptions ───────────────────────────────────────────────── */
// name (as printed) + default strength + typical times/days; spoken names that sound alike
const MEDS = [
  ["Amoxicillin", "500mg", ["amoxicillin", "amoxycillin", "amoxil", "mox", "novamox"]],
  ["Augmentin", "625mg", ["augmentin", "amoxicillin clavulanate", "amoxyclav", "clavam", "moxclav"]],
  ["Metronidazole", "400mg", ["metronidazole", "metrogyl", "flagyl", "metro"]],
  ["Ibuprofen", "400mg", ["ibuprofen", "brufen", "ibugesic"]],
  ["Paracetamol", "500mg", ["paracetamol", "crocin", "calpol"]],
  ["Dolo", "650mg", ["dolo", "dolo 650"]],
  ["Diclofenac", "50mg", ["diclofenac", "voveran"]],
  ["Aceclofenac", "100mg", ["aceclofenac", "hifenac"]],
  ["Zerodol-P", "", ["zerodol p", "zerodol", "aceclofenac paracetamol"]],
  ["Zerodol-SP", "", ["zerodol sp", "aceclofenac serratiopeptidase"]],
  ["Combiflam", "", ["combiflam", "ibuprofen paracetamol"]],
  ["Ketorolac", "10mg", ["ketorolac", "ketorol", "ketorol dt"]],
  ["Tramadol", "50mg", ["tramadol", "ultracet"]],
  ["Clindamycin", "300mg", ["clindamycin", "dalacin"]],
  ["Azithromycin", "500mg", ["azithromycin", "azithral", "azee"]],
  ["Cefixime", "200mg", ["cefixime", "taxim o", "zifi"]],
  ["Ofloxacin + Ornidazole", "", ["ofloxacin ornidazole", "o2"]],
  ["Omeprazole", "20mg", ["omeprazole", "omez"]],
  ["Pantoprazole", "40mg", ["pantoprazole", "pan", "pan 40", "pantop"]],
  ["Pan-D", "", ["pan d", "pantoprazole domperidone"]],
  ["Rabeprazole", "20mg", ["rabeprazole", "rablet", "razo"]],
  ["Serratiopeptidase", "10mg", ["serratiopeptidase", "serratio"]],
  ["Chymoral Forte", "", ["chymoral forte", "chymoral"]],
  ["Chlorhexidine Mouthwash", "", ["chlorhexidine mouthwash", "chlorhexidine", "hexidine", "clohex", "orahex", "chx"]],
  ["Betadine Mouthwash", "", ["betadine mouthwash", "betadine gargle", "betadine"]],
  ["Vitamin C", "500mg", ["vitamin c", "celin", "limcee"]],
  ["B-Complex", "", ["b complex", "becosules", "becozinc"]],
  ["Mucopain Gel", "", ["mucopain gel", "mucopain"]],
  ["Dologel", "", ["dologel", "dolo gel"]],
  ["Metrohex Gel", "", ["metrohex gel", "metrohex"]],
  ["Candid Mouth Paint", "", ["candid mouth paint", "candid"]],
  ["Tetanus Toxoid", "", ["tetanus toxoid", "tt injection", "tetanus"]],
  ["Sensodyne Toothpaste", "", ["sensodyne"]],
];
const MED_INDEX = (() => {
  const list = [];
  for (const [name, str, aliases] of MEDS) for (const a of aliases) list.push({ toks: a.split(" "), name, str });
  return list.sort((a, b) => b.toks.length - a.toks.length);
})();
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function medAt(toks, i, catalogue) {
  for (const m of MED_INDEX) {
    let ok = true;
    for (let k = 0; k < m.toks.length; k++) {
      const a = toks[i + k], b = m.toks[k];
      if (!a || !(a === b || (b.length >= 6 && lev(a, b) <= (b.length >= 9 ? 2 : 1)))) { ok = false; break; }
    }
    if (ok) return { len: m.toks.length, name: m.name, str: m.str };
  }
  for (const c of catalogue || []) {          // the clinic's own list (e.g. "Amoxicillin 500mg")
    const base = String(c.name || "").toLowerCase().replace(/\d.*$/, "").trim();
    if (base && base.length >= 5 && (toks[i] === base || lev(toks[i] || "", base) <= 1)) return { len: 1, name: c.name.replace(/\s*\d.*$/, ""), str: (/\d+\s*mg/i.exec(c.name) || [""])[0].replace(/\s/g, "") };
  }
  return null;
}
export function parseMedicines(text, { catalogue = [] } = {}) {
  const toks = wordsToDigits(prepare(text).split(" ").filter(Boolean)).map((w) => w.toLowerCase());
  const segs = [];
  for (let i = 0; i < toks.length; i++) {
    const m = medAt(toks, i, catalogue);
    if (m) { segs.push({ med: m, toks: [] }); i += m.len - 1; continue; }
    if (segs.length) segs[segs.length - 1].toks.push(toks[i]);
  }
  const items = segs.map(({ med, toks: t }) => {
    const s = " " + t.join(" ") + " ";
    let strength = med.str;
    const sm = /^\s*(\d+(?:\.\d+)?)\s*(mg|g|ml)?\b/.exec(s) || / (\d{2,4})\s*(mg|ml)\b/.exec(s);
    if (sm && Number(sm[1]) >= 2 && !/^\s*\d+\s*(days?|times?)/.test(s)) strength = `${sm[1]}${sm[2] || "mg"}`;
    let times = "";
    const tri = /(\d)-(\d)-(\d)/.exec(s);
    if (tri) {
      const n = [tri[1], tri[2], tri[3]].reduce((x, y) => x + (Number(y) > 0 ? 1 : 0), 0);
      times = tri[1] === "0" && tri[2] === "0" && tri[3] !== "0" ? "At night" : n ? `${n} time${n > 1 ? "s" : ""}/day` : "";
    }
    if (!times) {
      if (/\b(sos|when needed|if needed|if pain|as needed|when required|only if)\b/.test(s)) times = "When needed (SOS)";
      else if (/\b(qid|q i d|4 times|four times)\b/.test(s)) times = "4 times/day";
      else if (/\b(tds|tid|t d s|t i d|thrice|3 times|three times)\b/.test(s)) times = "3 times/day";
      else if (/\b(bd|bid|b d|b i d|twice|2 times|two times)\b/.test(s)) times = "2 times/day";
      else if (/\b(od|o d|once|1 time|one time|daily once|once daily)\b/.test(s)) times = "1 time/day";
      else if (/\b(hs|h s|at night|night|bedtime|bed time)\b/.test(s)) times = "At night";
    }
    let days = "";
    const dm = /(\d+)\s*(days?|din|rojulu|roju)\b/.exec(s);
    if (dm) days = Number(dm[1]);
    else if (/\b(1|one) week\b/.test(s)) days = 7;
    else if (/\b(2|two) weeks?\b/.test(s)) days = 14;
    let when = "";
    if (/\b(after food|after meals?|after eating|khane ke baad|tinnaka)\b/.test(s)) when = "After food";
    else if (/\b(before food|before meals?|empty stomach|khali pet|ac)\b/.test(s)) when = "Before food";
    else if (/\b(with food|with meals?)\b/.test(s)) when = "With food";
    else if (/\b(at bedtime|bed time|bedtime)\b/.test(s) && times !== "At night") when = "At bedtime";
    const note = [];
    if (/\b(gargle|rinse)\b/.test(s)) note.push("rinse / gargle");
    if (/\b(apply|application|massage)\b/.test(s)) note.push("apply on the area");
    if (/\b(for pain)\b/.test(s)) note.push("for pain");
    if (/\bdilute|diluted|with water\b/.test(s)) note.push("dilute with water");
    return { kind: "medicine", name: `${med.name}${strength ? " " + strength : ""}`.trim(), times, days, when, note: note.join(", ") };
  });
  const problems = items.filter((m) => !m.times || !m.days).map((m) => `${m.name}: ${!m.times ? "how many times a day?" : ""}${!m.times && !m.days ? " · " : ""}${!m.days ? "how many days?" : ""}`);
  return { items, problems, text: prepare(text) };
}

/* ── Dictation into any text box ───────────────────────────────────────── */
const SPOKEN_PUNCT = [["full stop", "."], ["period", "."], ["comma", ","], ["question mark", "?"], ["colon", ":"], ["semicolon", ";"],
  ["new line", "\n"], ["next line", "\n"], ["new paragraph", "\n\n"], ["open bracket", "("], ["close bracket", ")"], ["hyphen", "-"], ["dash", "-"],
  ["slash", "/"], ["plus", "+"]];
const ABBR = { rct: "RCT", iopa: "IOPA", opg: "OPG", cbct: "CBCT", gic: "GIC", bmp: "BMP", pfm: "PFM", dmls: "DMLS", bop: "BOP", tmj: "TMJ",
  osmf: "OSMF", irt: "IRT", wrt: "WRT", prf: "PRF", mod: "MOD", lllt: "LLLT", ncm: "Ncm", mm: "mm", mg: "mg", ml: "ml", sos: "SOS", bd: "BD",
  tds: "TDS", od: "OD", hs: "HS", rvg: "RVG", ecg: "ECG", bp: "BP", hiv: "HIV", hbsag: "HBsAg", "a/o": "A/O", ao: "A/O", "re-rct": "Re-RCT" };
export function normalizeDictation(raw, { sentenceStart = true } = {}) {
  let s = String(raw || "").normalize("NFC").replace(NATIVE_DIGITS, nativeDigit);
  for (const [k, v] of SPOKEN_PUNCT) s = s.replace(new RegExp(`\\s*\\b${k}\\b\\s*`, "gi"), v === "\n" || v === "\n\n" ? v : `${v} `);
  // numbers only where they are clearly numbers: after tooth words, before units, "thirty six"
  const NW = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
  const num = (phrase) => wordsToDigits(phrase.trim().split(/\s+/)).join(" ");
  s = s.replace(new RegExp(`\\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\\s+(one|two|three|four|five|six|seven|eight|nine)\\b`, "gi"), (m) => num(m.toLowerCase()));
  s = s.replace(new RegExp(`\\b(tooth|teeth|irt|wrt|number)\\s+(${NW}|\\d)(\\s+(?:${NW}|\\d))?\\b`, "gi"), (m, w, a, b) => {
    const d = num(`${a}${b || ""}`.toLowerCase()).split(" ");
    return d.length === 2 && isTooth(Number(d[0] + d[1])) ? `${w} ${d[0]}${d[1]}` : `${w} ${d.join(" ")}`;
  });
  s = s.replace(new RegExp(`\\b(${NW})(\\s+)(mm|millimet(?:er|re)s?|mg|ml|days?|weeks?|months?|times|ncm|percent|years?)\\b`, "gi"), (m, a, sp, u) => `${num(a.toLowerCase())}${sp}${u}`);
  // spelled letters "r c t" → RCT, "m o d" → MOD
  s = s.replace(/\b([a-z])(?:\s+([a-z])){1,4}\b/gi, (m) => {
    const letters = m.split(/\s+/);
    if (letters.length < 2 || letters.some((l) => l.length !== 1)) return m;
    if (/^(a|i)$/i.test(letters[0]) && letters.length === 2) return m;
    return letters.join("").toUpperCase();
  });
  // quadrant words → FDI (upper right first molar → 16)
  s = s.replace(/\b(upper|lower)\s+(right|left)\s+(first|second|third)\s+(molar|premolar)\b/gi, (m, ul, rl, ord, kind) => {
    const q = quadOf(/upper/i.test(ul), /right/i.test(rl), false);
    const o = ORDINAL[ord.toLowerCase()];
    const p = /premolar/i.test(kind) ? 3 + o : 5 + o;
    return p <= 8 ? `${q}${p}` : m;
  });
  s = s.replace(/\b(upper|lower)\s+(right|left)\s+(central|lateral|canine|wisdom)( incisor| tooth)?\b/gi, (m, ul, rl, kind) => {
    const q = quadOf(/upper/i.test(ul), /right/i.test(rl), false);
    return `${q}${POS_WORDS[kind.toLowerCase()]}`;
  });
  s = s.replace(/\b([A-Za-z\/\-]+)\b/g, (w) => ABBR[w.toLowerCase()] || w);
  s = s.replace(/(\d)\s+(mm|mg|ml)\b/g, "$1 $2").replace(/ +([.,?;:)])/g, "$1").replace(/\( +/g, "(").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");
  // capital letter after a full stop and at the start
  s = s.replace(/([.?!]\s+|\n)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  if (sentenceStart) s = s.replace(/^\s*([a-z])/, (m, c) => c.toUpperCase());
  return s.trim();
}

/* One call for every screen */
export function parse(text, mode, opts = {}) {
  if (mode === "rx") return parseMedicines(text, opts);
  if (mode === "both") {
    // consultation: treatment done + advice, and chart findings said in the same breath ("26 deep caries")
    const c = parseConsult(text, { mode });
    const f = parseChart(text, { mode: "chart", skipTreatment: true });
    return { items: [...c.items, ...f.items], problems: c.items.length || f.items.length ? [] : [...c.problems, ...f.problems], text: c.text };
  }
  if (mode === "treatment" || mode === "advice") return parseConsult(text, { mode });
  return parseChart(text, { mode });
}