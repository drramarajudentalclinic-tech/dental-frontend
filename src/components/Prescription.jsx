import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/* ─── helpers ──────────────────────────────────────────────── */
function todayStr() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d) {
  if (!d) return "";
  const p = String(d).split("T")[0].split("-");
  if (p.length !== 3) return d;
  return `${p[2]}/${p[1]}/${p[0]}`;
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? "PM" : "AM";
  return `${hr % 12 || 12}:${m} ${ampm}`;
}
// Text typed by people goes into the print page as text, never as HTML.
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function saveError(err, fallback) {
  const fromServer = err?.response?.data?.error;
  if (fromServer) return fromServer;
  if (!err?.response) return `${fallback} The server could not be reached — please check the connection and try again.`;
  return `${fallback} Please try again.`;
}

/* ─── Medicine catalogue ───────────────────────────────────── */
const MEDICINES = [
  { name: "Amoxicillin 500mg",       times: "3 times/day", days: 5, cat: "Antibiotics" },
  { name: "Metronidazole 400mg",     times: "3 times/day", days: 5, cat: "Antibiotics" },
  { name: "Ibuprofen 400mg",         times: "3 times/day", days: 3, cat: "Painkillers", when: "After food" },
  { name: "Paracetamol 500mg",       times: "3 times/day", days: 3, cat: "Painkillers" },
  { name: "Diclofenac 50mg",         times: "2 times/day", days: 3, cat: "Painkillers", when: "After food" },
  { name: "Omeprazole 20mg",         times: "1 time/day",  days: 5, cat: "Antacids", when: "Before food" },
  { name: "Chlorhexidine Mouthwash", times: "2 times/day", days: 7, cat: "Mouthwash & gels" },
  { name: "Betadine Mouthwash",      times: "3 times/day", days: 5, cat: "Mouthwash & gels" },
  { name: "Clindamycin 300mg",       times: "3 times/day", days: 5, cat: "Antibiotics" },
  { name: "Augmentin 625mg",         times: "2 times/day", days: 5, cat: "Antibiotics", when: "After food" },
  { name: "Aceclofenac 100mg",       times: "2 times/day", days: 3, cat: "Painkillers", when: "After food" },
  { name: "Serratiopeptidase 10mg",  times: "2 times/day", days: 5, cat: "Painkillers" },
  { name: "Pantoprazole 40mg",       times: "1 time/day",  days: 5, cat: "Antacids", when: "Before food" },
  { name: "Tetanus Toxoid",          times: "1 time/day",  days: 1, cat: "Vitamins & others" },
  { name: "Vitamin C 500mg",         times: "1 time/day",  days: 7, cat: "Vitamins & others" },
  // more common dental medicines
  { name: "Azithromycin 500mg",      times: "1 time/day",  days: 3, cat: "Antibiotics" },
  { name: "Cefixime 200mg",          times: "2 times/day", days: 5, cat: "Antibiotics" },
  { name: "Ofloxacin + Ornidazole",  times: "2 times/day", days: 5, cat: "Antibiotics", when: "After food" },
  { name: "Paracetamol 650mg",       times: "3 times/day", days: 3, cat: "Painkillers" },
  { name: "Aceclofenac + Paracetamol", times: "2 times/day", days: 3, cat: "Painkillers", when: "After food" },
  { name: "Ketorolac 10mg",          times: "2 times/day", days: 3, cat: "Painkillers", when: "After food" },
  { name: "Etoricoxib 90mg",         times: "1 time/day",  days: 3, cat: "Painkillers", when: "After food" },
  { name: "Rabeprazole 20mg",        times: "1 time/day",  days: 5, cat: "Antacids", when: "Before food" },
  { name: "Benzydamine Mouthwash",   times: "3 times/day", days: 5, cat: "Mouthwash & gels" },
  { name: "Chlorhexidine Gel",       times: "2 times/day", days: 7, cat: "Mouthwash & gels" },
  { name: "Lignocaine Gel 2%",       times: "When needed (SOS)", days: 3, cat: "Mouthwash & gels" },
  { name: "Clotrimazole Mouth Paint", times: "3 times/day", days: 7, cat: "Mouthwash & gels" },
  { name: "Desensitizing Toothpaste", times: "2 times/day", days: 30, cat: "Mouthwash & gels" },
  { name: "B-Complex",               times: "1 time/day",  days: 15, cat: "Vitamins & others", when: "After food" },
  { name: "Multivitamin",            times: "1 time/day",  days: 15, cat: "Vitamins & others", when: "After food" },
  { name: "Fluconazole 150mg",       times: "1 time/day",  days: 1, cat: "Vitamins & others" },
];
// Shown alphabetically on screen.
const MEDICINES_AZ = [...MEDICINES].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
const MED_CATEGORIES = ["Antibiotics", "Painkillers", "Antacids", "Mouthwash & gels", "Vitamins & others"];
const MY_CATEGORY = "Custom medicines";
const groupOf = (m) => (!m.category || m.category === "My medicines" ? MY_CATEGORY : m.category);   // "My medicines" = the earlier name

/* ─── Custom medicines: the clinic's own list, saved on the server ────
   GET/POST/PUT/DELETE /prescription-medicines (prescription.py). Loaded once
   and shared by every medicine editor on the page.                         */
const catalogue = { custom: [], usage: {}, loaded: false, error: "", listeners: new Set(), loading: null };
function notifyCatalogue() { catalogue.listeners.forEach(fn => fn({ ...catalogue })); }
function loadCatalogue(force = false) {
  if (catalogue.loading && !force) return catalogue.loading;
  catalogue.loading = api.get("/prescription-medicines")
    .then(res => {
      catalogue.custom = Array.isArray(res.data?.medicines) ? res.data.medicines : [];
      catalogue.usage = res.data?.usage || {};
      catalogue.error = "";
    })
    .catch(err => {
      catalogue.error = err?.response?.status === 404 && !err?.response?.data?.error
        ? "Custom medicines needs the new prescription.py on the server."
        : (err?.response?.data?.error || "Custom medicines could not be loaded.");
    })
    .finally(() => { catalogue.loaded = true; notifyCatalogue(); });
  return catalogue.loading;
}
function useCatalogue() {
  const [state, setState] = useState({ ...catalogue });
  useEffect(() => {
    catalogue.listeners.add(setState);
    if (!catalogue.loading) loadCatalogue();
    else setState({ ...catalogue });
    return () => { catalogue.listeners.delete(setState); };
  }, []);
  return state;
}

const FREQUENCY_OPTIONS = ["1 time/day", "2 times/day", "3 times/day", "4 times/day", "At night", "When needed (SOS)"];
const WHEN_OPTIONS      = ["After food", "Before food", "With food", "At bedtime"];
const DEFAULT_CUSTOM    = { times: "2 times/day", days: 3 };

/* A medicine on a prescription is stored exactly as before —
     { name, times, days }
   with two optional extras that older screens simply ignore:
     when : "After food" / "Before food" / …
     note : any instruction for the patient                                   */
function cleanMedicine(m) {
  const days = m?.days === "" || m?.days === null || m?.days === undefined ? "" : Number(m.days);
  return {
    name:  String(m?.name ?? "").trim(),
    times: String(m?.times ?? "").trim(),
    days:  Number.isFinite(days) ? days : "",
    when:  String(m?.when ?? "").trim(),
    note:  String(m?.note ?? "").trim(),
  };
}
function parseMedicines(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw || "[]"); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.filter(m => m && typeof m === "object").map(cleanMedicine).filter(m => m.name);
}
// What is saved: the same shape as always; the extras only when they are filled in.
function medicinesForSave(list) {
  return parseMedicines(list).map(m => {
    const out = { name: m.name, times: m.times, days: m.days === "" ? "" : m.days };
    if (m.when) out.when = m.when;
    if (m.note) out.note = m.note;
    return out;
  });
}
function medInstructions(m) { return [m.when, m.note].filter(Boolean).join(" · "); }
function medDuration(m) {
  if (m.days === "" || m.days === null || m.days === undefined || Number(m.days) <= 0) return "—";
  return `${m.days} day${Number(m.days) !== 1 ? "s" : ""}`;
}

/* ─── Allergy check ────────────────────────────────────────────
   The patient's recorded allergies, medical conditions (and pregnancy) and the
   medicines they already take (Medical History) are always shown above the
   medicines. On top of that, a medicine is flagged when its name matches a
   recorded allergy directly, or belongs to the same well-known family
   (penicillins; NSAID painkillers). This is a reminder to double-check — it is
   NOT a complete drug-interaction check, and no flag never means "safe".      */
const DRUG_FAMILIES = [
  { label: "penicillin group",
    words: ["penicillin", "amoxicillin", "amoxycillin", "ampicillin", "cloxacillin", "augmentin", "amoxiclav", "amoxyclav"] },
  { label: "NSAID painkiller group",
    words: ["nsaid", "nsaids", "painkiller", "painkillers", "aspirin", "ibuprofen", "brufen", "combiflam", "diclofenac", "voveran", "aceclofenac", "zerodol",
            "ketorolac", "naproxen", "nimesulide", "piroxicam", "mefenamic"] },
];
function wordsOf(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^a-z]+/).filter(w => w.length >= 4);
  const joined = lower.replace(/[^a-z]/g, "");               // "Pain killers" → "painkillers"
  if (joined.length >= 4 && !words.includes(joined)) words.push(joined);
  return words;
}
function allergyMatches(medName, allergies) {
  const medWords = wordsOf(medName);
  if (medWords.length === 0) return [];
  const hits = [];
  (allergies || []).forEach(a => {
    const allergenWords = wordsOf(a.allergen);
    if (allergenWords.length === 0) return;
    const direct = allergenWords.some(w => medWords.includes(w));
    const family = DRUG_FAMILIES.find(f => allergenWords.some(w => f.words.includes(w)) && medWords.some(w => f.words.includes(w)));
    if (direct) hits.push(`recorded allergy to ${a.allergen}`);
    else if (family) hits.push(`recorded allergy to ${a.allergen} (${family.label})`);
  });
  return hits;
}

/* ─── Updated clinic timings ────────────────────────────────── */
const CLINIC_TIMINGS = "Consultation by Appointment, Timings : Mon to Sat 11.00am to 7.00pm, Sunday Closed";

/* Doctor signature image, embedded as a data URI so it always renders */
const DOCTOR_SIGNATURE_IMG = "data:image/png;base64,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";

/* Clinic logo, embedded as a data URI so it always renders (on screen and in print).
   It used to be pasted into this file twice; it is the same picture, now kept once. */
const CLINIC_LOGO_IMG = "data:image/jpeg;base64,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AEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAZ990l+qXgv3jn/vDSJ3SX6peC/eOf+8NIua/Ttx/EnHgi+l7Vn8K1/wD2R1ZNVs4Ivpe1Z/Ctf/2R1ZNdCON+hERSQEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQGffdJfql4L945/wC8NIndJfql4L945/7w0i5r9O3H8SceCL6XtWfwrX/9kdWTVbOCL6XtWfwrX/8AZHVk10I436ERFJAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEXzyJDERon5LwNNt03GZnsEVxGQa6aO42B+3OqOMRiHvVapc2nHaV/mwKpKG9EpN+HfooZ/6X3Dl/rWgf/DSP/KT/AKYHDj/rUgf/AA0n/wApRyX9LcK/hMyKGf8ApgcOP+tSB/8ADSf/ACk/6YHDj/rUgf8Aw0n/AMpOS/o4V/CZkUM/9MDhx/1qQP8A4aT/AOUn/TA4cf8AWpA/+Gk/+UnJf0cK/hMyKGf+mBw4/wCtSB/8NJ/8pdJYtc9HMpHbYtT8Yk1cpyBqtyZac/szLd+qnJMjhX2iQkX4MvNvtjIYMSaPrgQeOv3UlQiIpAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAZ990l+qXgv3jn/ALw0id0l+qXgv3jn/vDSLmv07cfxJx4Ivpe1Z/Ctf/2R1ZNVs4Ivpe1Z/Ctf/wBkdWTXQjjfoREUkBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEXGZtqnp1ptF9kZ3m1qtFaDQ6MvyBq+56LVOuVPRFV1z3uiWnNmqcXAsXuuRvD3qS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byDHdN7RGuDNPeHiZJ0mz8O4d+7aXnCpQRESS8DbfoREUkBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQETXThe0EvVxfuU7S2zVkyT6R8gEmqbvKoAV2roME0i030yOU9gmIQbM9M2hIcj0qROgPZAiOve7S7lFXiizun02ERFYqEREAREQBERAEREAREQGffdJfql4L945/wC8NIndJfql4L945/7w0i5r9O3H8SceCL6XtWfwrX/9kdWTVbOCL6XtWfwrX/8AZHVk10I436ERFJAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAZ990l+qXgv3jn/vDSJ3SX6peC/eOf8AvDSLmv07cfxJx4Ivpe1Z/Ctf/wBkdWTVbOCL6XtWfwrX/wDZHVk10I436ERFJAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAZ990l+qXgv3jn/vDSJ3SX6peC/eOf+8NIua/Ttx/EnHgi+l7Vn8K1/8A2R1ZNUR0H4m9OdC5OpuKZ7DyMJ03US93Nn2HaXXwqwZtgNedOVKV3NEpV90H4f8A7FzH9H3fnW6aOZw9lmUVZvdB+H/7FzH9H3fnT3Qfh/8AsXMf0fd+dOSI4UWZRVm90H4f/sXMf0fd+dPdB+H/AOxcx/R93505IcKLMoqze6D8P/2LmP6Pu/Onug/D/wDYuY/o+786ckOFFmUVZvdB+H/7FzH9H3fnT3Qfh/8AsXMf0fd+dOSHCizKKs3ug/D/APYuY/o+786e6D8P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";

/* ─── CSS injection ─────────────────────────────────────────── */
const injectStyles = () => {
  if (document.getElementById("presc-styles-v3")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap";
  document.head.appendChild(link);
  const s = document.createElement("style");
  s.id = "presc-styles-v3";
  s.textContent = `
    .presc-root { font-family: 'Plus Jakarta Sans', sans-serif; }
    .presc-root *, .presc-pop * { box-sizing: border-box; }
    .presc-pop { font-family: 'Plus Jakarta Sans', sans-serif; }
    .presc-root button:focus-visible, .presc-pop button:focus-visible,
    .presc-root input:focus-visible, .presc-pop input:focus-visible,
    .presc-root select:focus-visible, .presc-pop select:focus-visible,
    .presc-root textarea:focus-visible, .presc-pop textarea:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 1px; }
    .presc-med-row {
      display:flex; align-items:center; gap:10px; flex-wrap:wrap;
      padding:10px 12px; border-radius:10px;
      border:1.5px solid #e9eef4; background:#fff;
      transition:border-color 0.15s, box-shadow 0.15s;
    }
    .presc-med-row:hover { border-color:#c7d9fc; box-shadow:0 2px 8px rgba(29,77,122,0.06); }
    .presc-input {
      padding:7px 11px; border:1.5px solid #e2e8f4; border-radius:8px;
      font-family:'DM Mono',monospace; font-size:12.5px;
      color:#1e293b; background:#f8fafc; outline:none; transition:border-color 0.18s;
    }
    .presc-input:focus { border-color:#3b82f6; background:#fff; }

    /* ── Letterhead ── */
    .presc-lh {
      background:#fff; border:1px solid #bbb;
      font-family: Arial, Helvetica, sans-serif;
      box-shadow: 0 2px 16px rgba(0,0,0,0.10);
    }
    .presc-lh-footer {
      border-top:2px solid #999;
      padding:8px 20px; text-align:center;
      font-size:12px; color:#222; font-weight:600;
      font-family: Arial, Helvetica, sans-serif;
      letter-spacing:0.3px;
    }
    .presc-lh-lbl { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:1.1px; color:#888; display:block; margin-bottom:3px; }
    .presc-lh-val { font-size:13px; color:#111; line-height:1.55; }
    .presc-med-table { width:100%; border-collapse:collapse; }
    .presc-med-table th { font-size:10px; font-weight:700; color:#888; letter-spacing:0.8px; text-transform:uppercase; padding:7px 10px; border-bottom:1.5px solid #ddd; text-align:left; background:#f7f7f7; }
    .presc-med-table td { padding:9px 10px; border-bottom:1px solid #eee; font-size:12.5px; color:#111; vertical-align:top; }
    .presc-med-table tr:last-child td { border-bottom:none; }
    .presc-med-table tr:hover td { background:#fafafa; }
    .presc-filter-inp { width:100%; padding:8px 11px; border:1.5px solid #e2e8f0; border-radius:8px; font-family:'Plus Jakarta Sans',sans-serif; font-size:12.5px; color:#1e293b; background:#f8fafc; outline:none; box-sizing:border-box; transition:border-color 0.15s; }
    .presc-filter-inp:focus { border-color:#3b82f6; background:#fff; }
    @keyframes presc-fade { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;} }
    .presc-fade { animation:presc-fade 0.3s ease both; }
    @keyframes presc-slide { from{opacity:0;transform:translateX(-8px);}to{opacity:1;transform:none;} }
    .presc-med-item { animation:presc-slide 0.2s ease both; }
    @keyframes spin { to{transform:rotate(360deg);} }
    .presc-spin { width:15px; height:15px; border-radius:50%; border:2px solid #dde8f8; border-top-color:#1d6fa4; animation:spin 0.7s linear infinite; display:inline-block; vertical-align:middle; }

    /* ── v2: layout helpers ── */
    .presc-grid3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px 14px; }
    .presc-grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px 14px; }
    .presc-msg { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; border-radius:9px; padding:9px 12px; font-size:12.5px; font-weight:600; margin-bottom:12px; }
    .presc-msg.error  { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; }
    .presc-msg.warn   { background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
    .presc-msg.info   { background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; }
    .presc-msg.locked { background:#f1f5f9; border:1px solid #e2e8f0; color:#475569; }
    .presc-msg.ok     { background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; }
    .presc-msg button { background:#fff; border:1px solid currentColor; color:inherit; border-radius:6px; padding:4px 11px; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; }

    /* ── v2: allergy banner ── */
    .presc-allergy { border:1.5px solid #fca5a5; background:#fef2f2; border-radius:10px; padding:9px 12px; margin-bottom:10px; }
    .presc-allergy-title { font-size:12px; font-weight:800; color:#b91c1c; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px; }
    .presc-allergy-list { display:flex; flex-wrap:wrap; gap:6px; }
    .presc-allergy-chip { background:#fff; border:1px solid #fca5a5; color:#7f1d1d; border-radius:6px; padding:3px 9px; font-size:12.5px; font-weight:700; }
    .presc-allergy-chip span { font-weight:500; color:#991b1b; }
    .presc-cond { border-color:#fcd34d; background:#fffbeb; }
    .presc-cond .presc-allergy-title { color:#92400e; }
    .presc-cond-chip { border-color:#fcd34d !important; color:#78350f !important; }
    .presc-cond-chip span { color:#92400e !important; }
    .presc-meds { border-color:#bfdbfe; background:#eff6ff; }
    .presc-meds .presc-allergy-title { color:#1e40af; }
    .presc-meds-chip { border-color:#bfdbfe !important; color:#1e3a8a !important; }
    .presc-meds-chip span { color:#1e40af !important; }
    .presc-allergy-none { font-size:12px; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; margin-bottom:10px; }

    /* ── v2: medicine picker ── */
    .presc-inv { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr)); gap:12px; }
    .presc-inv-group { border:1.5px solid #e9eef4; border-radius:11px; padding:10px 12px; background:#fcfdff; }
    .presc-inv-title { font-size:12.5px; font-weight:800; color:#1e293b; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
    .presc-inv-n { font-size:10.5px; background:#1d6fa4; color:#fff; border-radius:10px; padding:0 7px; }
    .presc-inv-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
    .presc-inv-chip { font-family:inherit; font-size:12.5px; font-weight:700; padding:6px 11px; border-radius:20px; border:1.5px solid #cbd5e1; background:#fff; color:#334155; cursor:pointer; }
    .presc-inv-chip:hover { border-color:#60a5fa; }
    .presc-inv-more { font-family:inherit; font-size:12px; font-weight:700; padding:6px 11px; border-radius:20px; border:1.5px dashed #94a3b8; background:transparent; color:#475569; cursor:pointer; }
    .presc-inv-chip.on { background:#1d6fa4; border-color:#1d6fa4; color:#fff; }
    .presc-inv-other { display:flex; gap:6px; }
    .presc-inv-other input { flex:1; min-width:0; padding:7px 10px; border:1.5px solid #e2e8f0; border-radius:8px; font-family:inherit; font-size:12.5px; background:#f8fafc; }
    .presc-inv-other button { font-family:inherit; font-size:12.5px; font-weight:700; padding:7px 12px; border-radius:8px; border:1.5px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; cursor:pointer; white-space:nowrap; }
    .presc-inv-other button:disabled { opacity:.5; cursor:not-allowed; }
    .presc-inv-list { list-style:none; margin:10px 0 0; padding:0; display:flex; flex-direction:column; gap:8px; }
    .presc-inv-list li { background:#fff; border:1px solid #e2e8f0; border-left:3px solid #1d6fa4; border-radius:8px; padding:7px 9px; }
    .presc-inv-name { display:flex; align-items:center; gap:6px; font-size:12.5px; color:#0f172a; margin-bottom:5px; }
    .presc-inv-name span { color:#64748b; font-size:11.5px; flex:1; min-width:0; }
    .presc-inv-name button { margin-left:auto; border:0; background:#fee2e2; color:#b91c1c; border-radius:6px; width:22px; height:22px; cursor:pointer; font-size:11px; flex-shrink:0; }
    .presc-inv-list textarea { width:100%; box-sizing:border-box; min-height:32px; resize:vertical; padding:6px 9px; border:1.5px solid #e2e8f0; border-radius:7px; font-family:inherit; font-size:12.5px; background:#f8fafc; }
    .presc-chip-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(185px,1fr)); gap:6px; margin-bottom:10px; }
    .presc-chip { display:flex; align-items:center; gap:7px; min-width:0; padding:7px 10px; border-radius:8px; border:1.5px solid #e2e8f0; background:#f8fafc; font-family:inherit; font-size:12.5px; font-weight:500; color:#334155; text-align:left; cursor:pointer; }
    .presc-chip:hover { border-color:#60a5fa; background:#fff; }
    .presc-chip.on { background:#1d6fa4; border-color:#1d6fa4; color:#fff; font-weight:700; }
    .presc-chip.risk { border-color:#f87171; }
    .presc-chip.risk.on { background:#b91c1c; border-color:#b91c1c; }
    .presc-chip-box { flex-shrink:0; width:16px; height:16px; border-radius:4px; border:1.5px solid #cbd5e1; background:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; line-height:1; color:#1d6fa4; font-weight:800; }
    .presc-chip.on .presc-chip-box { border-color:#fff; }
    .presc-chip-lbl { min-width:0; overflow-wrap:anywhere; }
    .presc-add-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
    .presc-add-row input { flex:1 1 220px; min-width:0; }
    .presc-btn-add { padding:8px 16px; border-radius:8px; font-weight:700; font-size:13px; border:none; font-family:inherit; cursor:pointer; background:linear-gradient(135deg,#1d4d7a,#1d6fa4); color:#fff; white-space:nowrap; }
    .presc-btn-add:disabled { background:#e2e8f0; color:#94a3b8; cursor:not-allowed; }

    /* ── v2: one prescribed medicine ── */
    .presc-rx { border:1.5px solid #e9eef4; background:#fff; border-radius:10px; padding:10px 12px; animation:presc-slide 0.2s ease both; }
    .presc-rx.risk { border-color:#f87171; background:#fffafa; }
    .presc-rx-top { display:grid; grid-template-columns:26px minmax(160px,2.2fr) minmax(130px,1.3fr) minmax(120px,1.1fr) 78px 30px; gap:8px; align-items:end; }
    .presc-rx-num { align-self:center; width:24px; height:24px; border-radius:50%; background:#eff6ff; color:#1d4ed8; font-size:11.5px; font-weight:800; display:flex; align-items:center; justify-content:center; font-family:'DM Mono',monospace; }
    .presc-rx label { display:block; font-size:9.5px; font-weight:700; color:#8899bb; letter-spacing:0.6px; text-transform:uppercase; margin-bottom:3px; }
    .presc-rx input, .presc-rx select { width:100%; padding:7px 9px; border:1.5px solid #e2e8f0; border-radius:8px; font-family:inherit; font-size:13px; color:#1e293b; background:#f8fafc; outline:none; }
    .presc-rx input:focus, .presc-rx select:focus { border-color:#3b82f6; background:#fff; }
    .presc-rx-name input { font-weight:700; }
    .presc-rx-note { margin-top:8px; padding-left:34px; }
    .presc-rx-del { align-self:end; width:30px; height:34px; border-radius:7px; border:1.5px solid #fca5a5; background:#fff1f2; color:#ef4444; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; }
    .presc-rx-warn { margin-top:8px; margin-left:34px; font-size:12px; font-weight:700; color:#b91c1c; background:#fee2e2; border-radius:7px; padding:5px 9px; }
    @media (max-width:760px) {
      .presc-rx-top { grid-template-columns:26px minmax(0,1fr) 30px; }
      .presc-rx-top > .presc-rx-freq, .presc-rx-top > .presc-rx-when, .presc-rx-top > .presc-rx-days { grid-column:2 / 3; }
      .presc-rx-top > .presc-rx-del { grid-column:3; grid-row:1; }
    }

    /* ── v2: pop-up windows (drawn on the page body) ── */
    .presc-overlay { position:fixed; inset:0; z-index:9000; background:rgba(10,25,55,0.55); backdrop-filter:blur(5px); display:flex; align-items:center; justify-content:center; padding:20px; }
    .presc-window { background:#fff; border-radius:20px; width:100%; max-height:92vh; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 80px rgba(10,25,55,0.28); }
    .presc-window-head { padding:14px 22px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-shrink:0; }
    .presc-window-body { overflow-y:auto; flex:1 1 auto; min-height:0; padding:18px 22px; }
    .presc-window-foot { padding:12px 22px; border-top:1px solid #f0f0f0; display:flex; gap:10px; flex-shrink:0; }
    .presc-x { width:30px; height:30px; border-radius:7px; border:1.5px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.12); color:#fff; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    /* ── v3: medicine groups, Custom medicines ── */
    .presc-msg.success { background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; }
    .presc-btn-my { padding:8px 14px; border-radius:8px; font-weight:700; font-size:13px; font-family:inherit; cursor:pointer; background:#fffbeb; color:#92400e; border:1.5px solid #fcd34d; white-space:nowrap; }
    .presc-btn-my:hover { background:#fef3c7; }
    .presc-groups { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .presc-group { font-family:inherit; font-size:12px; font-weight:700; padding:5px 11px; border-radius:20px; cursor:pointer; background:#f8fafc; color:#475569; border:1.5px solid #e2e8f0; }
    .presc-group span { font-weight:600; color:#94a3b8; margin-left:2px; }
    .presc-group[aria-pressed="true"] { background:#1d6fa4; border-color:#1d6fa4; color:#fff; }
    .presc-group[aria-pressed="true"] span { color:rgba(255,255,255,0.75); }
    .presc-chip.mine { background:#fffbeb; border-color:#fde68a; }
    .presc-chip.mine.on { background:#1d6fa4; border-color:#1d6fa4; }
    .presc-chip-star { margin-left:auto; font-size:11px; }
    .presc-chip-uses { margin-left:auto; font-size:10.5px; font-weight:800; color:#64748b; background:#eef2f7; border-radius:10px; padding:0 6px; }
    .presc-chip.on .presc-chip-uses { background:rgba(255,255,255,0.2); color:#fff; }
    .presc-linkbtn { background:none; border:0; padding:0; font:inherit; color:#1d6fa4; font-weight:700; cursor:pointer; text-decoration:underline; }
    .presc-empty-meds { font-size:12.5px; color:#94a3b8; font-style:italic; padding:12px; border:1.5px dashed #e2e8f0; border-radius:10px; text-align:center; }
    .presc-rx-new { margin-top:8px; margin-left:34px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:7px; padding:5px 9px; }
    .presc-save-mine { border:1.5px solid #fcd34d; background:#fff; color:#92400e; }
    .presc-mm-form { background:#f8fafc; border:1px solid #e9eef4; border-radius:12px; padding:12px 14px; }
    .presc-mm-title { font-size:13px; font-weight:800; color:#1e293b; margin-bottom:8px; }
    .presc-mm-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .presc-mm-grid label { display:block; font-size:9.5px; font-weight:700; color:#8899bb; letter-spacing:0.6px; text-transform:uppercase; margin-bottom:3px; }
    .presc-mm-grid input, .presc-mm-grid select { width:100%; padding:7px 9px; border:1.5px solid #e2e8f0; border-radius:8px; font-family:inherit; font-size:13px; color:#1e293b; background:#fff; outline:none; }
    .presc-mm-grid input:focus, .presc-mm-grid select:focus { border-color:#3b82f6; }
    .presc-mm-hint { font-size:11.5px; color:#b45309; margin-top:3px; }
    .presc-mm-list { display:flex; flex-direction:column; gap:6px; }
    .presc-mm-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 12px; border:1px solid #fde68a; background:#fffdf5; border-radius:10px; flex-wrap:wrap; }
    @media (max-width:640px) { .presc-mm-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    .presc-rowbtn { padding:5px 11px; border-radius:7px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; white-space:nowrap; }
    @media (max-width:560px) { .presc-overlay { padding:8px; } .presc-window-head, .presc-window-body, .presc-window-foot { padding-left:14px; padding-right:14px; } }
  `;
  document.head.appendChild(s);
};

/* ═══════════════════════════════════════════════════════════════
   CLINIC LOGO — swap for <img src="/logo.png"> when ready
═══════════════════════════════════════════════════════════════ */
function ClinicLogo({ w = 100, h = 115 }) {
  return (
    <img src={CLINIC_LOGO_IMG} width={w} height={h} style={{objectFit:"contain"}} alt="Sri Sai Oral Health Center logo"/>
  );
}

function LetterheadHeader() {
  const F = "Arial, Helvetica, sans-serif";
  /* Slab/stencil heading — Georgia closest to printed letterhead look */
  const FH = "Georgia, 'Times New Roman', serif";
  const FB = "'Arial Black', Impact, Arial, sans-serif";
  return (
    <div style={{ fontFamily:F, background:"#fff" }}>

      {/* Ph : top right */}
      <div style={{ textAlign:"right", padding:"7px 16px 2px", fontSize:12, color:"#111", fontFamily:F }}>
        Ph : 9908894449
      </div>

      {/* ── MAIN HEADER ROW: Logo LEFT | Clinic block CENTER-RIGHT ── */}
      <div style={{ display:"flex", alignItems:"flex-start", padding:"0 12px 4px 8px", gap:10 }}>

        {/* Logo — tall, spans clinic name + address rows */}
        <div style={{ flexShrink:0 }}><ClinicLogo w={105} h={118} /></div>

        {/* Clinic block — centered text */}
        <div style={{ flex:1, textAlign:"center" }}>
          {/* Large slab-serif heading — red, matches scan */}
          <div style={{
            fontFamily: FH,
            fontSize: 20, fontWeight: 900, color: "#c0000a",
            textTransform: "uppercase", letterSpacing: "2px",
            lineHeight: 1.1, marginBottom: 6,
          }}>
            SRI SATYA SAI ORAL HEALTH CENTER
          </div>

          {/* DENTAL CLINIC — boxed, bold */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display:"inline-block", border:"3px solid #111", borderRadius:3, padding:"3px 34px 6px" }}>
              <span style={{ fontFamily:FB, fontSize:18, fontWeight:900, letterSpacing:"4px", color:"#111", textTransform:"uppercase" }}>
                DENTAL CLINIC
              </span>
            </div>
          </div>

          {/* Address — centered, own line */}
          <div style={{ fontSize:11.5, color:"#333", lineHeight:1.55, fontFamily:F }}>
            G- 15, Ground floor, Rajni Gandha Apartments, Chaitanyapuri, Hyderabad - 60
          </div>

          {/* Email — centered, OWN line below address */}
          <div style={{ fontSize:11.5, color:"#333", lineHeight:1.55, fontFamily:F }}>
            E-mail:dr_ramu@yahoo.com, web : www.droroscope.com
          </div>
        </div>
      </div>

      {/* ── DR NAME ROW — starts at left edge (same x as logo), below clinic block ── */}
      <div style={{ padding:"0 12px 7px 8px" }}>
        <div style={{ fontFamily:FB, fontSize:23, fontWeight:900, color:"#c0000a", lineHeight:1.2, marginBottom:1 }}>
          Dr.Rama Raju. D
        </div>
        <div style={{ fontSize:11, color:"#222", lineHeight:1.85, fontFamily:F }}>
          Reg.No. A-1096 &nbsp;&nbsp;&nbsp; MDS (OSM)<br/>
          <strong>Honorary professor</strong><br/>
          Oral Medicine &amp; Radiology<br/>
          SVS Institute of Dental Sciences<br/>
          CEO - Raamah Biocare Pvt. Ltd.
        </div>
      </div>

      {/* Thick bottom border */}
      <div style={{ borderTop:"2px solid #444" }} />
    </div>
  );
}

function LetterheadCard({ data }) {
  const { patientName, patientAge, patientGender, caseNumber, date, diagnosis, advice, treatmentDone, medicines, followUpDate, followUpTime } = data;
  const medsArr = parseMedicines(medicines);
  const invArr = parseInvestigations(data.investigations);
  const showInstructions = medsArr.some(m => medInstructions(m));

  return (
    <div className="presc-lh">
      <LetterheadHeader />

      {/* Body */}
      <div style={{ padding:"14px 20px 24px" }}>
        {/* Case No + Date row */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, fontFamily:"Arial,sans-serif", fontSize:12, color:"#333" }}>
          <div><span style={{ fontSize:9.5, fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", color:"#888", marginRight:6 }}>Case No.:</span><span style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#111" }}>{caseNumber||"—"}</span></div>
          <div>Date :&nbsp;<span style={{ fontFamily:"'DM Mono',monospace" }}>{fmtDate(date)}</span></div>
        </div>

        {/* Patient info grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px 20px", background:"#f9f9f9", border:"1px solid #e5e5e5", borderRadius:4, padding:"10px 14px", marginBottom:16 }}>
          {[["Patient Name", patientName, true], ["Age", patientAge, false], ["Gender", patientGender, false]].map(([l,v,b]) => (
            <div key={l}>
              <span className="presc-lh-lbl">{l}</span>
              <div className="presc-lh-val" style={{ fontWeight:b?700:500 }}>{v||"—"}</div>
            </div>
          ))}
        </div>

        {/* 1. Diagnosis */}
        {diagnosis && <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
            <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.2px", color:"#b22222", borderBottom:"2px solid #b22222", paddingBottom:1 }}>1. Diagnosis</span>
          </div>
          {diagnosis.split(";").map((d,i) => (
            <div key={i} style={{ display:"flex", gap:7, marginBottom:3, fontSize:13, color:"#111" }}>
              <span style={{ color:"#b22222", fontWeight:700, flexShrink:0 }}>•</span>
              <span>{d.trim()}</span>
            </div>
          ))}
        </div>}

        {/* 2. Advice & Treatment Plan */}
        {advice && <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
            <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.2px", color:"#059669", borderBottom:"2px solid #059669", paddingBottom:1 }}>2. Advice &amp; Treatment Plan</span>
          </div>
          {advice.split(";").map((a,i) => (
            <div key={i} style={{ display:"flex", gap:7, marginBottom:3, fontSize:13, color:"#111" }}>
              <span style={{ color:"#059669", fontWeight:700, flexShrink:0 }}>•</span>
              <span>{a.trim()}</span>
            </div>
          ))}
        </div>}

        {/* 3. Treatment Done Today */}
        {treatmentDone && <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
            <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.2px", color:"#d97706", borderBottom:"2px solid #d97706", paddingBottom:1 }}>3. Treatment Done Today</span>
          </div>
          {treatmentDone.split(";").map((t,i) => (
            <div key={i} style={{ display:"flex", gap:7, marginBottom:3, fontSize:13, color:"#111" }}>
              <span style={{ color:"#d97706", fontWeight:700, flexShrink:0 }}>•</span>
              <span>{t.trim()}</span>
            </div>
          ))}
        </div>}

        {/* Medicines table */}
        {medsArr.length > 0 && <div style={{ marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}><span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.2px", color:"#1d4ed8", borderBottom:"2px solid #1d4ed8", paddingBottom:1 }}>4. Prescribed Medicines</span></div>
          <table className="presc-med-table" style={{ marginTop:4 }}>
            <thead>
              <tr><th style={{ width:28 }}>#</th><th>Medicine</th><th>Frequency</th><th>Duration</th>{showInstructions && <th>Instructions</th>}</tr>
            </thead>
            <tbody>
              {medsArr.map((m,i) => (
                <tr key={i}>
                  <td style={{ color:"#aaa", fontFamily:"'DM Mono',monospace" }}>{i+1}</td>
                  <td style={{ fontWeight:600 }}>{m.name}</td>
                  <td>{m.times}</td>
                  <td>{medDuration(m)}</td>
                  {showInstructions && <td>{medInstructions(m)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>}

        {/* Investigations advised */}
        {invArr.length > 0 && <div style={{ marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}><span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.2px", color:"#7c3aed", borderBottom:"2px solid #7c3aed", paddingBottom:1 }}>5. Investigations Advised</span></div>
          {["Radiograph", "Blood test", "Other"].map(gr => {
            const items = invArr.filter(i => (gr === "Other" ? !["Radiograph", "Blood test"].includes(i.group) : i.group === gr));
            if (!items.length) return null;
            return (
              <div key={gr} style={{ marginTop:4 }}>
                <div style={{ fontSize:10.5, fontWeight:700, color:"#6b7280", marginBottom:2 }}>{gr === "Radiograph" ? "X-rays / Scans" : gr === "Blood test" ? "Blood tests" : "Other"}</div>
                {items.map((i, k) => (
                  <div key={k} style={{ display:"flex", gap:7, marginBottom:3, fontSize:13, color:"#111" }}>
                    <span style={{ color:"#7c3aed", fontWeight:700, flexShrink:0 }}>•</span>
                    <span><strong>{i.name}</strong>{i.note ? <span style={{ color:"#374151" }}> — {i.note}</span> : null}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>}

        {/* Follow-up */}
        {followUpDate && (
          <div style={{ marginTop:14, padding:"10px 14px", background:"#f0fdf4", border:"1px solid #86efac", borderRadius:7 }}>
            <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.2px", color:"#166534", borderBottom:"2px solid #86efac", paddingBottom:4, marginBottom:8 }}>{invArr.length > 0 ? "6" : "5"}. Next Follow-up</div>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <div>
                <div style={{ fontSize:9.5, color:"#4ade80", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.8px" }}>Date</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:14, color:"#15803d", fontWeight:700 }}>{fmtDate(followUpDate)}</div>
              </div>
              {followUpTime && <div style={{ borderLeft:"1.5px solid #86efac", paddingLeft:14 }}>
                <div style={{ fontSize:9.5, color:"#4ade80", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.8px" }}>Time</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:14, color:"#15803d", fontWeight:700 }}>{fmtTime(followUpTime)}</div>
              </div>}
            </div>
          </div>
        )}

        {/* Doctor signature */}
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:30, paddingTop:12, borderTop:"1px dashed #ccc" }}>
          <div style={{ textAlign:"center" }}>
            <img
              src={DOCTOR_SIGNATURE_IMG}
              alt="Doctor's signature"
              style={{ width:130, height:"auto", display:"block", marginBottom:2 }}
            />
            <div style={{ width:130, borderBottom:"1.5px solid #111", marginBottom:5 }} />
            <div style={{ fontSize:12, fontWeight:700, color:"#111", fontFamily:"Arial,sans-serif" }}>Dr. Rama Raju. D</div>
            <div style={{ fontSize:10.5, color:"#555", fontFamily:"Arial,sans-serif" }}>MDS (OSM)</div>
          </div>
        </div>
      </div>

      {/* Footer — updated timings */}
      <div className="presc-lh-footer">
        {CLINIC_TIMINGS}
      </div>
    </div>
  );
}

/* ─── Print window ───────────────────────────────────────────── */
// The whole page as text. Everything a person typed goes through esc(), so a
// "<" or "&" in a diagnosis prints as written instead of breaking the page.
function buildPrintHtml(data) {
  const { patientName, patientAge, patientGender, caseNumber, date, diagnosis, advice, treatmentDone, medicines, followUpDate, followUpTime } = data;
  const meds = parseMedicines(medicines);
  const inv = parseInvestigations(data.investigations);
  const showInstructions = meds.some(m => medInstructions(m));
  const invHtml = !inv.length ? "" : `<div class="sblk"><span class="slbl" style="color:#7c3aed;border-bottom:2px solid #7c3aed">5. INVESTIGATIONS ADVISED</span>${
    [["Radiograph", "X-rays / Scans"], ["Blood test", "Blood tests"], ["Other", "Other"]].map(([gr, title]) => {
      const items = inv.filter(i => (gr === "Other" ? !["Radiograph", "Blood test"].includes(i.group) : i.group === gr));
      return items.length ? `<div style="font-size:10px;font-weight:700;color:#6b7280;margin:4px 0 2px">${title}</div>` +
        items.map(i => `<div class="bul"><span class="bdot" style="color:#7c3aed">•</span><span><strong>${esc(i.name)}</strong>${i.note ? ` — ${esc(i.note)}` : ""}</span></div>`).join("") : "";
    }).join("")}</div>`;
  const bullets = (text, color) => String(text).split(";").map(s => s.trim()).filter(Boolean)
    .map(s => `<div class="bul"><span class="bdot" style="color:${color}">•</span><span>${esc(s)}</span></div>`).join("");

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Prescription — ${esc(patientName||"Patient")}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111;}
      @page{size:A4;margin:8mm 12mm 8mm 12mm;}
      .page{width:100%;min-height:100vh;background:#fff;display:flex;flex-direction:column;}

      /* ══ HEADER ══ */
      .hdr{ background:#fff; }
      .ph{ text-align:right; padding:6px 16px 2px; font-size:12px; color:#111; font-family:Arial,sans-serif; }
      /* Row 1: Logo | Clinic info */
      .toprow{ display:flex; align-items:flex-start; padding:0 10px 0 8px; gap:8px; }
      .leftcol{ flex-shrink:0; }
      .logo{ width:95px; height:107px; }
      .clinicblock{ flex:1; padding-top:2px; text-align:center; }
      .clinicname{
        font-family:Georgia,"Times New Roman",serif;
        font-size:20px; font-weight:900; color:#c0000a;
        text-transform:uppercase; letter-spacing:2px; line-height:1.1; margin-bottom:6px;
      }
      .badgewrap{ margin-bottom:6px; }
      .badge{ display:inline-block; border:3px solid #111; border-radius:3px; padding:3px 32px 6px; }
      .badgetext{ font-family:"Arial Black",Arial,sans-serif; font-size:18px; font-weight:900; letter-spacing:4px; color:#111; text-transform:uppercase; }
      .addr{ font-size:11.5px; color:#333; line-height:1.55; font-family:Arial,sans-serif; text-align:center; }
      .emailline2{ font-size:11.5px; color:#333; line-height:1.55; font-family:Arial,sans-serif; text-align:center; }
      /* Dr row — left aligned below logo/clinic block */
      .drrow{ padding:2px 12px 6px 8px; }
      .drname{ font-family:"Arial Black",Impact,Arial,sans-serif; font-size:23px; font-weight:900; color:#c0000a; line-height:1.2; margin-bottom:1px; }
      .credrow{ font-size:11px; color:#222; line-height:1.85; font-family:Arial,sans-serif; }

      /* thick bottom border */
      .hdr-border{ border-top:1.5px solid #444; }

      /* ══ BODY ══ */
      .body{ padding:14px 18px 18px; flex:1; }
      .daterow{ text-align:right; font-size:12px; color:#333; margin-bottom:14px; font-family:Arial,sans-serif; }
      .pgrid{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px 16px; background:#f9f9f9; border:1px solid #e0e0e0; border-radius:4px; padding:9px 12px; margin-bottom:14px; }
      .plbl{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#888; display:block; margin-bottom:2px; }
      .pval{ font-size:12.5px; color:#111; font-weight:600; }
      .slbl{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#666; display:block; margin-bottom:5px; }
      .sblk{ margin-bottom:11px; }
      .bul{ display:flex; gap:7px; margin-bottom:2px; font-size:12.5px; }
      .bdot{ font-weight:700; flex-shrink:0; }
      table{ width:100%; border-collapse:collapse; margin-top:3px; }
      th{ font-size:9.5px; text-transform:uppercase; letter-spacing:0.8px; color:#666; padding:6px 9px; border-bottom:1.5px solid #ddd; text-align:left; background:#f5f5f5; }
      td{ padding:8px 9px; border-bottom:1px solid #eee; font-size:12px; vertical-align:top; }
      tr:last-child td{ border-bottom:none; }
      .fu{ background:#f0fff4; border:1px solid #86efac; border-radius:6px; padding:8px 12px; display:flex; align-items:center; gap:10px; margin-top:12px; }
      .sig{ display:flex; justify-content:flex-end; margin-top:28px; padding-top:10px; border-top:1px dashed #ccc; }
      .sigimg{ width:130px; height:auto; display:block; margin-bottom:2px; }
      .sigline{ width:130px; border-bottom:1.5px solid #111; margin-bottom:4px; }

      /* ══ FOOTER ══ */
      .ftr{ border-top:1.5px solid #888; padding:7px 20px; text-align:center; font-size:12px; color:#111; font-weight:600; letter-spacing:0.3px; font-family:Arial,sans-serif; }

      @media print{ body{margin:0;} }
    </style></head><body>
  <div class="page">
    <div class="hdr">

      <!-- Ph number top right -->
      <div class="ph">Ph : 9908894449</div>

      <!-- ROW 1: Logo (left) | Clinic name + badge + address (right, centered) -->
      <div class="toprow">
        <div class="leftcol">
          <img src="${CLINIC_LOGO_IMG}" style="width:95px;height:107px;object-fit:contain;" alt="logo"/>
        </div>
        <div class="clinicblock">
          <div class="clinicname">SRI SATYA SAI ORAL HEALTH CENTER</div>
          <div class="badgewrap">
            <div class="badge"><span class="badgetext">DENTAL CLINIC</span></div>
          </div>
          <div class="addr">G- 15, Ground floor, Rajni Gandha Apartments, Chaitanyapuri, Hyderabad - 60</div>
          <div class="emailline2">E-mail:dr_ramu@yahoo.com, web : www.droroscope.com</div>
        </div>
      </div>

      <!-- Dr name + credentials — left aligned -->
      <div class="drrow">
        <div class="drname">Dr.Rama Raju. D</div>
        <div class="credrow">
          Reg.No. A-1096 &nbsp;&nbsp;&nbsp; MDS (OSM)<br>
          <strong>Honorary professor</strong><br>
          Oral Medicine &amp; Radiology<br>
          SVS Institute of Dental Sciences<br>
          CEO - Raamah Biocare Pvt. Ltd.
        </div>
      </div>

      <!-- thick bottom border -->
      <div class="hdr-border"></div>
    </div>

    <div class="body">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;color:#333;">
        <div><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-right:6px;">Case No.:</span><span style="font-family:monospace;font-weight:700;color:#111;">${esc(caseNumber||"—")}</span></div>
        <div>Date :&nbsp;<span style="font-family:monospace;">${esc(fmtDate(date))}</span></div>
      </div>
      <div class="pgrid" style="grid-template-columns:1fr 1fr 1fr;">
        <div><span class="plbl">Patient Name</span><span class="pval">${esc(patientName||"—")}</span></div>
        <div><span class="plbl">Age</span><span class="pval">${esc(patientAge||"—")}</span></div>
        <div><span class="plbl">Gender</span><span class="pval">${esc(patientGender||"—")}</span></div>
      </div>
      ${diagnosis?`<div class="sblk"><span class="slbl" style="color:#b22222;border-bottom:2px solid #b22222">1. DIAGNOSIS</span>${bullets(diagnosis,"#b22222")}</div>`:""}
      ${advice?`<div class="sblk"><span class="slbl" style="color:#059669;border-bottom:2px solid #059669">2. ADVICE &amp; TREATMENT PLAN</span>${bullets(advice,"#059669")}</div>`:""}
      ${treatmentDone?`<div class="sblk"><span class="slbl" style="color:#d97706;border-bottom:2px solid #d97706">3. TREATMENT DONE TODAY</span>${bullets(treatmentDone,"#d97706")}</div>`:""}
      ${meds.length>0?`<div class="sblk"><span class="slbl" style="color:#1d4ed8;border-bottom:2px solid #1d4ed8">4. PRESCRIBED MEDICINES</span><table><thead><tr><th>#</th><th>Medicine</th><th>Frequency</th><th>Duration</th>${showInstructions?"<th>Instructions</th>":""}</tr></thead><tbody>${meds.map((m,i)=>`<tr><td style="color:#aaa">${i+1}</td><td style="font-weight:600">${esc(m.name)}</td><td>${esc(m.times)}</td><td>${esc(medDuration(m))}</td>${showInstructions?`<td>${esc(medInstructions(m))}</td>`:""}</tr>`).join("")}</tbody></table></div>`:""}
      ${invHtml}
      ${followUpDate?`<div class="fu" style="border-radius:7px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;margin-top:14px;"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:#166534;border-bottom:1.5px solid #86efac;padding-bottom:4px;margin-bottom:8px;">${inv.length ? "6" : "5"}. NEXT FOLLOW-UP</div><div style="display:flex;gap:20px;align-items:center;"><div><div style="font-size:8px;color:#4ade80;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">Date</div><div style="font-family:monospace;font-size:14px;font-weight:700;color:#15803d;">${esc(fmtDate(followUpDate))}</div></div>${followUpTime?`<div style="border-left:1.5px solid #86efac;padding-left:14px;"><div style="font-size:8px;color:#4ade80;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">Time</div><div style="font-family:monospace;font-size:14px;font-weight:700;color:#15803d;">${esc(fmtTime(followUpTime))}</div></div>`:""}</div></div>`:""}
      <div class="sig"><div style="text-align:center;"><img class="sigimg" src="${DOCTOR_SIGNATURE_IMG}" alt="Doctor's signature" /><div class="sigline"></div><div style="font-size:12px;font-weight:700">Dr. Rama Raju. D</div><div style="font-size:10px;color:#555">MDS (OSM)</div></div></div>
    </div>

    <div class="ftr">${esc(CLINIC_TIMINGS)}</div>
  </div></body></html>`;
}

function printPrescription(data) {
  const win = window.open("", "_blank", "width=820,height=1120");
  if (!win) {
    window.alert("The browser blocked the print window.\n\nPlease allow pop-ups for this site (the icon at the right end of the address bar) and press Print again.");
    return false;
  }
  win.document.write(buildPrintHtml(data));
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 600);
  return true;
}

// One saved prescription → what the letterhead and the print page expect
function toLetterData(p) {
  return {
    patientName: p.patient_name, patientAge: p.patient_age, patientGender: p.patient_gender || p.gender || "",
    caseNumber: p.case_number, date: p.date, diagnosis: p.diagnosis, advice: p.advice,
    treatmentDone: p.treatment_done || p.treatment_done_today, medicines: parseMedicines(p.medicines),
    followUpDate: p.follow_up_date, followUpTime: p.follow_up_time,
    investigations: parseInvestigations(p.investigations),
  };
}

/* ─── Follow-up appointment ───────────────────────────────────────
   Appointments live in Supabase (the same list as the Appointments app).
   Saving the prescription already books / moves / cancels the follow-up on the
   server (one booking per patient per day). This call only makes sure it is
   there and tells the doctor when the booking could not be made.
   Returns "none" | "kept" | "updated" | "moved" | "created" | "failed".          */
async function bookFollowUp({ visitId, name, mobile, caseNumber, date, time, diagnosis, treatment }) {
  if (!date) return "none";
  try {
    const res = await api.post(`/appointments`, {
      source:      "prescription",
      visit_id:    visitId || undefined,
      name:        name || "Patient",
      mobile:      mobile || "",
      case_number: caseNumber || "",
      date,
      time:        time || "11:00",
      treatment:   treatment || "Follow-up",
      notes:       diagnosis ? `Follow-up for: ${diagnosis}` : "Follow-up appointment",
      status:      "pending",
    });
    return res.data?.result || "created";
  } catch (apptErr) {
    console.warn("Could not create/update follow-up appointment:", apptErr);
    return "failed";
  }
}

/* ─── Pop-up window frame ────────────────────────────────────────
   Drawn on the page body, so it always covers the whole screen. (Inside the
   animated "Prescription" card it used to be trapped within the card.)        */
function PopWindow({ label, onClose, maxWidth = 680, busy = false, background = "#fff", children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return createPortal(
    <div className="presc-overlay presc-pop">
      <div className="presc-window" role="dialog" aria-modal="true" aria-label={label} style={{ maxWidth, background }}>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ─── Recorded allergies and medical conditions (always shown above the medicines) ───── */
const NOT_CURRENT = /^(resolved|past|stopped|completed|inactive|discontinued)$/i;
function healthFrom(data) {
  const live = (r) => r && !NOT_CURRENT.test(String(r.status || "").trim());
  return {
    conditions: (Array.isArray(data?.conditions) ? data.conditions : []).filter(live)
      .map(c => ({ id: c.id, name: c.condition_name || c.label || "", extra: [c.details, c.status && !/^current$/i.test(c.status) ? c.status : ""].filter(Boolean).join(", ") }))
      .filter(c => c.name),
    medications: (Array.isArray(data?.medications) ? data.medications : []).filter(m => live(m) && m.active !== false)
      .map(m => ({ id: m.id, name: m.medicine_name || m.label || "", extra: [m.dosage, m.frequency].filter(Boolean).join(" ") }))
      .filter(m => m.name),
    womens: data?.womens_health_applicable === false ? [] : (Array.isArray(data?.womens_health) ? data.womens_health : []).filter(live)
      .map(w => ({ id: w.id, name: w.label || w.record_type || "" })).filter(w => w.name),
    noneKnownConditions: !!data?.none_known?.conditions,
  };
}
function AllergyBanner({ allergies, noneKnown, health }) {
  const h = health || { conditions: [], medications: [], womens: [], noneKnownConditions: false };
  const chips = (list, cls) => (
    <div className="presc-allergy-list">
      {list.map(x => (
        <span key={x.id ?? x.name} className={`presc-allergy-chip ${cls || ""}`}>
          {x.name}{x.extra && <span> — {x.extra}</span>}
        </span>
      ))}
    </div>
  );
  const rows = [];
  if (allergies.length > 0) {
    rows.push(
      <div key="a" className="presc-allergy" role="alert">
        <div className="presc-allergy-title">⚠️ Allergies on record — check before prescribing</div>
        {chips(allergies.map(a => ({ id: a.id, name: a.allergen, extra: [a.reaction, a.severity].filter(Boolean).join(", ") })))}
      </div>
    );
  }
  if (h.conditions.length > 0 || h.womens.length > 0) {
    rows.push(
      <div key="c" className="presc-allergy presc-cond" role="note">
        <div className="presc-allergy-title">🩺 Medical conditions — consider before prescribing</div>
        {chips([...h.womens, ...h.conditions], "presc-cond-chip")}
      </div>
    );
  }
  if (h.medications.length > 0) {
    rows.push(
      <div key="m" className="presc-allergy presc-meds" role="note">
        <div className="presc-allergy-title">💊 Already taking — check for interactions</div>
        {chips(h.medications, "presc-meds-chip")}
      </div>
    );
  }
  const ok = [noneKnown && allergies.length === 0 && "no known allergies", h.noneKnownConditions && h.conditions.length === 0 && "no known medical conditions"].filter(Boolean);
  if (ok.length) rows.push(<div key="n" className="presc-allergy-none">✓ Medical history says: {ok.join(", ")}.</div>);
  return rows.length ? <>{rows}</> : null;
}

/* ═══════════════════════════════════════════════════════════════
   MEDICINE EDITOR — used when writing a prescription and when editing one
     · tick a common medicine, or type any name and press Add
     · every medicine: frequency, when to take, number of days, instructions
═══════════════════════════════════════════════════════════════ */
let editorSeq = 0;
const lower = (x) => String(x || "").trim().toLowerCase();

/* ── Custom medicines: add / change / remove (opened from the medicine editor) ── */
function CustomMedicinesWindow({ onClose, startWith = null }) {
  const cat = useCatalogue();
  const blank = { name: "", category: MY_CATEGORY, times: "2 times/day", when: "", days: 3, note: "" };
  const [form, setForm] = useState(startWith ? { ...blank, ...startWith } : blank);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [filter, setFilter] = useState("");
  const freqId = useRef(`presc-mm-freq-${++editorSeq}`).current;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inBuiltIn = MEDICINES.some(m => lower(m.name) === lower(form.name));

  const save = async () => {
    if (busy) return;
    if (!form.name.trim()) { setMsg({ ok: false, text: "Please enter the medicine's name (with strength)." }); return; }
    setBusy(true); setMsg(null);
    const body = { ...form, name: form.name.trim(), days: form.days === "" ? "" : Number(form.days) };
    try {
      if (editingId) await api.put(`/prescription-medicines/${editingId}`, body);
      else await api.post("/prescription-medicines", body);
      await loadCatalogue(true);
      setMsg({ ok: true, text: `${editingId ? "Updated" : "Added to Custom medicines"}: ${body.name}` });
      setForm(blank); setEditingId(null);
    } catch (err) {
      setMsg({ ok: false, text: saveError(err, "Not saved — please try again.") });
    } finally { setBusy(false); }
  };
  const remove = async (m) => {
    setBusy(true); setMsg(null);
    try {
      await api.delete(`/prescription-medicines/${m.id}`);
      await loadCatalogue(true);
      setMsg({ ok: true, text: `Removed from Custom medicines: ${m.name}. Prescriptions already written keep it.` });
      if (editingId === m.id) { setForm(blank); setEditingId(null); }
    } catch (err) {
      setMsg({ ok: false, text: saveError(err, "Not removed — please try again.") });
    } finally { setBusy(false); setConfirmId(null); }
  };
  const shown = cat.custom.filter(m => !filter.trim() || lower(m.name).includes(lower(filter)));

  return (
    <PopWindow label="Custom medicines" onClose={onClose} busy={busy} maxWidth={820}>
      <div className="presc-window-head" style={{ background: "linear-gradient(135deg,#1d4d7a,#1d6fa4)" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>⭐ Custom medicines</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>Medicines not in the built-in list — saved once, offered on every prescription</div>
        </div>
        <button type="button" className="presc-x" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
      </div>
      <div className="presc-window-body">
        <div className="presc-mm-form" role="group" aria-label={editingId ? "Change medicine" : "New medicine"}>
          <div className="presc-mm-title">{editingId ? "✏️ Change medicine" : "➕ New medicine"}</div>
          <div className="presc-mm-grid">
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Name with strength</label>
              <input value={form.name} onChange={e => set("name", e.target.value)} aria-label="New medicine name" placeholder="e.g. Doxycycline 100mg, Hexigel gum paint" autoFocus maxLength={200} />
              {inBuiltIn && !editingId && <div className="presc-mm-hint">“{form.name.trim()}” is already in the built-in list.</div>}
            </div>
            <div>
              <label>Group</label>
              <select value={form.category || MY_CATEGORY} onChange={e => set("category", e.target.value)} aria-label="Group">
                {[MY_CATEGORY, ...MED_CATEGORIES].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Usual frequency</label>
              <input value={form.times} list={freqId} onChange={e => set("times", e.target.value)} aria-label="Usual frequency" placeholder="e.g. 2 times/day" />
              <datalist id={freqId}>{FREQUENCY_OPTIONS.map(o => <option key={o} value={o} />)}</datalist>
            </div>
            <div>
              <label>When</label>
              <select value={form.when || ""} onChange={e => set("when", e.target.value)} aria-label="Usual time">
                <option value="">—</option>
                {WHEN_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label>Days</label>
              <input type="number" min={1} max={365} value={form.days} onChange={e => set("days", e.target.value)} aria-label="Usual days" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Usual instructions <span style={{ textTransform: "none", fontWeight: 500 }}>(optional)</span></label>
              <input value={form.note || ""} onChange={e => set("note", e.target.value)} aria-label="Usual instructions" placeholder="e.g. Apply on the gums after brushing" maxLength={300} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="presc-btn-add" disabled={busy || !form.name.trim()} onClick={save}>{busy ? "Saving…" : editingId ? "💾 Save changes" : "⭐ Add to Custom medicines"}</button>
            {editingId && <button type="button" className="presc-rowbtn" style={{ border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569" }} onClick={() => { setForm(blank); setEditingId(null); }}>Cancel</button>}
          </div>
        </div>
        {msg && <div className={`presc-msg ${msg.ok ? "success" : "error"}`} role={msg.ok ? "status" : "alert"} style={{ margin: "12px 0 0" }}>{msg.ok ? "✓" : "⚠️"} {msg.text}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, margin: "18px 0 8px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1e293b" }}>Saved ({cat.custom.length})</div>
          {cat.custom.length > 6 && <input className="presc-filter-inp" style={{ maxWidth: 260 }} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find…" aria-label="Find in Custom medicines" />}
        </div>
        {cat.error && <div className="presc-msg error" role="alert">⚠️ {cat.error}</div>}
        {!cat.loaded ? <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Loading…</div>
          : cat.custom.length === 0 ? <div style={{ fontSize: 12.5, color: "#94a3b8", fontStyle: "italic" }}>Nothing saved yet. Add a medicine above, or press “☆ Save to Custom medicines” on a medicine typed into a prescription.</div>
          : (
            <div className="presc-mm-list">
              {shown.map(m => (
                <div key={m.id} className="presc-mm-row" data-my-medicine={m.id}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5, overflowWrap: "anywhere" }}>⭐ {m.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {[groupOf(m), m.times, m.when, m.days !== "" && m.days != null ? `${m.days} day${Number(m.days) !== 1 ? "s" : ""}` : "", m.note].filter(Boolean).join(" · ")}
                      {cat.usage[lower(m.name)] ? ` · prescribed ${cat.usage[lower(m.name)]}×` : ""}
                    </div>
                  </div>
                  {confirmId === m.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>Remove?</span>
                      <button type="button" className="presc-rowbtn" style={{ border: "none", background: "#dc2626", color: "#fff" }} disabled={busy} onClick={() => remove(m)}>Remove</button>
                      <button type="button" className="presc-rowbtn" style={{ border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569" }} onClick={() => setConfirmId(null)}>Keep</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="presc-rowbtn" style={{ border: "1.5px solid #fde68a", background: "#fef9c3", color: "#713f12" }} aria-label={`Change ${m.name}`}
                        onClick={() => { setEditingId(m.id); setForm({ name: m.name, category: groupOf(m), times: m.times || "", when: m.when || "", days: m.days ?? "", note: m.note || "" }); setMsg(null); }}>Edit</button>
                      <button type="button" className="presc-rowbtn" style={{ border: "1.5px solid #fecaca", background: "#fff1f2", color: "#b91c1c" }} aria-label={`Remove ${m.name}`} onClick={() => setConfirmId(m.id)}>Remove</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
      <div className="presc-window-foot">
        <button type="button" onClick={onClose} disabled={busy} style={{ marginLeft: "auto", padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg,#1d4d7a,#1d6fa4)", color: "#fff", border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done</button>
      </div>
    </PopWindow>
  );
}

function MedicineEditor({ medicines, onChange, allergies = [] }) {
  const cat = useCatalogue();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");
  const [manager, setManager] = useState(null);         // null | { startWith }
  const [savingName, setSavingName] = useState("");
  const [saveNote, setSaveNote] = useState(null);
  const listId = useRef(`presc-freq-${++editorSeq}`).current;

  // everything that can be ticked: the built-in list + Custom medicines
  const all = useMemo(() => {
    const mine = cat.custom.map(m => ({ name: m.name, times: m.times || DEFAULT_CUSTOM.times, days: m.days === "" || m.days == null ? DEFAULT_CUSTOM.days : m.days,
      when: m.when || "", note: m.note || "", cat: groupOf(m), mine: true }));
    const mineNames = new Set(mine.map(m => lower(m.name)));
    return [...MEDICINES.filter(m => !mineNames.has(lower(m.name))), ...mine]
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }, [cat.custom]);
  const known = (name) => all.some(m => lower(m.name) === lower(name));
  const frequent = useMemo(() => Object.entries(cat.usage || {}).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([key, n]) => ({ ...(all.find(m => lower(m.name) === key) || { name: key.replace(/\b\w/g, c => c.toUpperCase()), ...DEFAULT_CUSTOM }), uses: n })), [cat.usage, all]);

  const has = name => medicines.some(m => lower(m.name) === lower(name));
  const q = lower(query);
  const pool = group === "All" ? all : group === "Frequently used" ? frequent : group === MY_CATEGORY ? all.filter(m => m.mine) : all.filter(m => m.cat === group);
  const shown = q ? all.filter(m => lower(m.name).includes(q)) : pool;
  const exact = all.find(m => lower(m.name) === q);

  const add = (m) => {
    if (has(m.name)) return;
    onChange([...medicines, { name: m.name, times: m.times, days: m.days, when: m.when || "", note: m.note || "" }]);
  };
  const toggle = (m) => {
    if (has(m.name)) onChange(medicines.filter(x => lower(x.name) !== lower(m.name)));
    else add(m);
    setQuery("");
  };
  const addTyped = () => {
    const name = query.trim().replace(/\s+/g, " ");
    if (!name || has(name)) return;
    add(exact || { name, ...DEFAULT_CUSTOM });
    setQuery("");
  };
  const update = (i, field, value) =>
    onChange(medicines.map((m, j) => j === i ? { ...m, [field]: field === "days" ? (value === "" ? "" : Number(value)) : value } : m));
  const remove = i => onChange(medicines.filter((_, j) => j !== i));
  const saveToList = async (m) => {
    setSavingName(m.name); setSaveNote(null);
    try {
      await api.post("/prescription-medicines", { name: m.name.trim(), category: MY_CATEGORY, times: m.times, when: m.when, days: m.days === "" ? "" : m.days, note: m.note });
      await loadCatalogue(true);
      setSaveNote({ ok: true, text: `⭐ “${m.name.trim()}” is saved in Custom medicines — it will be in the list next time.` });
    } catch (err) {
      setSaveNote({ ok: false, text: saveError(err, "Not saved — please try again.") });
    } finally { setSavingName(""); }
  };

  const groups = ["All", ...(Object.keys(cat.usage || {}).length ? ["Frequently used"] : []), MY_CATEGORY, ...MED_CATEGORIES];
  const countOf = g => g === "All" ? all.length : g === "Frequently used" ? frequent.length : g === MY_CATEGORY ? all.filter(m => m.mine).length : all.filter(m => m.cat === g).length;

  return (
    <div>
      {/* ── find / add ── */}
      <div className="presc-add-row">
        <input className="presc-filter-inp" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
          placeholder="Search the list, or type any medicine name (e.g. Doxycycline 100mg)…"
          aria-label="Medicine name" />
        <button type="button" className="presc-btn-add" onClick={addTyped} disabled={!query.trim() || has(query)}>
          {has(query) && query.trim() ? "Already added" : exact || !query.trim() ? "+ Add" : `+ Add “${query.trim()}”`}
        </button>
        <button type="button" className="presc-btn-my" onClick={() => setManager({ startWith: null })} title="Medicines you add yourself, saved for every prescription">
          ⭐ Custom medicines{cat.custom.length ? ` (${cat.custom.length})` : ""}
        </button>
      </div>

      {!q && (
        <div className="presc-groups" role="group" aria-label="Medicine groups">
          {groups.map(g => (
            <button key={g} type="button" className="presc-group" aria-pressed={group === g} onClick={() => setGroup(g)}>
              {g === MY_CATEGORY ? "⭐ " : g === "Frequently used" ? "🔁 " : ""}{g} <span>{countOf(g)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="presc-chip-grid" role="group" aria-label="Common medicines, A to Z">
        {shown.map(m => {
          const on = has(m.name);
          const risk = allergyMatches(m.name, allergies).length > 0;
          return (
            <button key={m.name} type="button" className={`presc-chip${on ? " on" : ""}${risk ? " risk" : ""}${m.mine ? " mine" : ""}`}
              aria-pressed={on} title={risk ? "Check: matches a recorded allergy" : m.mine ? "From Custom medicines" : undefined}
              onClick={() => toggle(m)}>
              <span className="presc-chip-box" aria-hidden="true">{on ? "✓" : ""}</span>
              <span className="presc-chip-lbl">{m.name}</span>
              {m.mine && <span className="presc-chip-star" aria-label="Custom medicine">⭐</span>}
              {m.uses ? <span className="presc-chip-uses" title={`Prescribed ${m.uses} times`}>{m.uses}×</span> : null}
              {risk && <span aria-hidden="true">⚠️</span>}
            </button>
          );
        })}
        {shown.length === 0 && (
          <div style={{ gridColumn:"1 / -1", fontSize:12.5, color:"#64748b", padding:"4px 2px" }}>
            {q ? <>Not in the list — press “+ Add” to prescribe “{query.trim()}”, or <button type="button" className="presc-linkbtn" onClick={() => setManager({ startWith: { name: query.trim() } })}>save it to Custom medicines</button> first.</>
              : group === MY_CATEGORY ? <>No medicines saved yet. <button type="button" className="presc-linkbtn" onClick={() => setManager({ startWith: null })}>Add one</button>.</>
              : "Nothing here yet."}
          </div>
        )}
      </div>

      <datalist id={listId}>{FREQUENCY_OPTIONS.map(o => <option key={o} value={o} />)}</datalist>
      {saveNote && <div className={`presc-msg ${saveNote.ok ? "success" : "error"}`} role={saveNote.ok ? "status" : "alert"} style={{ margin: "0 0 8px" }}>{saveNote.text}</div>}

      {/* ── prescribed ── */}
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {medicines.length === 0
          ? <div className="presc-empty-meds">No medicines added yet — tick them above, or type a name and press “+ Add”.</div>
          : medicines.map((m, i) => {
            const hits = allergyMatches(m.name, allergies);
            const isNew = m.name.trim() && !known(m.name);
            return (
              <div key={i} className={`presc-rx${hits.length ? " risk" : ""}`} role="group" aria-label={`Medicine ${i + 1}: ${m.name}`}>
                <div className="presc-rx-top">
                  <span className="presc-rx-num">{i + 1}</span>
                  <div className="presc-rx-name">
                    <label>Medicine</label>
                    <input value={m.name} onChange={e => update(i, "name", e.target.value)} aria-label="Medicine" />
                  </div>
                  <div className="presc-rx-freq">
                    <label>Frequency</label>
                    <input value={m.times} list={listId} onChange={e => update(i, "times", e.target.value)} aria-label="Frequency" placeholder="e.g. 2 times/day" />
                  </div>
                  <div className="presc-rx-when">
                    <label>When</label>
                    <select value={m.when || ""} onChange={e => update(i, "when", e.target.value)} aria-label="When to take">
                      <option value="">—</option>
                      {WHEN_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      {m.when && !WHEN_OPTIONS.includes(m.when) && <option value={m.when}>{m.when}</option>}
                    </select>
                  </div>
                  <div className="presc-rx-days">
                    <label>Days</label>
                    <input type="number" min={1} max={365} value={m.days} onChange={e => update(i, "days", e.target.value)} aria-label="Days" />
                  </div>
                  <button type="button" className="presc-rx-del" onClick={() => remove(i)} title="Remove this medicine" aria-label={`Remove ${m.name}`}>✕</button>
                </div>
                <div className="presc-rx-note">
                  <input value={m.note || ""} onChange={e => update(i, "note", e.target.value)}
                    aria-label="Instructions" placeholder="Instructions for the patient (optional)" />
                </div>
                {isNew && (
                  <div className="presc-rx-new">
                    <span>New medicine — not in your list yet.</span>
                    <button type="button" className="presc-rowbtn presc-save-mine" disabled={savingName === m.name} onClick={() => saveToList(m)}>
                      {savingName === m.name ? "Saving…" : "☆ Save to Custom medicines"}
                    </button>
                  </div>
                )}
                {hits.length > 0 && (
                  <div className="presc-rx-warn" role="alert">⚠️ Please check: {hits.join("; ")}.</div>
                )}
              </div>
            );
          })}
      </div>
      {manager && <CustomMedicinesWindow startWith={manager.startWith} onClose={() => setManager(null)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EDIT MODAL for previously saved prescriptions
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   INVESTIGATIONS ADVISED — X-rays / scans and blood tests, each with a note.
   Saved with the prescription as  investigations: [{group, code, name, note}]
   and printed as its own section on the prescription.
═══════════════════════════════════════════════════════════════ */
// "more: true" items stay under "More …" until opened (a chosen one is always shown).
const INVESTIGATION_GROUPS = [
  { group: "Radiograph", title: "🩻 X-rays & scans", other: "Other X-ray / scan",
    items: [
      { code: "IOPA", name: "IOPA",  full: "Intra-oral periapical X-ray", hint: "Tooth no. — e.g. 36, 46" },
      { code: "OPG",  name: "OPG",  full: "Orthopantomogram (panoramic X-ray)", hint: "e.g. full mouth / impacted 38, 48" },
      { code: "CBCT", name: "CBCT", full: "Cone-beam CT", hint: "Region & purpose — e.g. 36–37, implant planning" },
      { code: "TMJ",  name: "TMJ view", full: "TMJ radiograph", hint: "Right / Left / Both — open & closed mouth" },
      { code: "BW",   name: "Bitewing", full: "Bitewing X-ray (interproximal caries, bone level)", hint: "Right / Left / Both sides", more: true },
      { code: "OCCL", name: "Occlusal view", full: "Occlusal radiograph", hint: "Maxillary / Mandibular — e.g. submandibular stone", more: true },
      { code: "CEPH", name: "Lateral ceph", full: "Lateral cephalogram (orthodontics)", more: true },
      { code: "PA",   name: "PA skull / PA mandible", full: "Postero-anterior view", hint: "e.g. fracture mandible", more: true },
      { code: "PNS",  name: "PNS / Water's view", full: "Paranasal sinus view (occipitomental)", hint: "e.g. maxillary sinus", more: true },
      { code: "CTF",  name: "CT face", full: "Computed tomography — face / jaws", hint: "e.g. trauma, pathology extent", more: true },
      { code: "MRI",  name: "MRI TMJ", full: "Magnetic resonance imaging of TMJ", hint: "Disc position — open & closed mouth", more: true },
      { code: "USG",  name: "USG neck / salivary", full: "Ultrasound — neck nodes / salivary glands", more: true },
      { code: "SIAL", name: "Sialography", full: "Contrast study of salivary duct", hint: "Parotid / Submandibular", more: true },
      { code: "HW",   name: "Hand-wrist X-ray", full: "Skeletal age (orthodontics)", more: true },
      { code: "CXR",  name: "Chest X-ray", full: "Chest X-ray PA view", hint: "e.g. before general anaesthesia", more: true },
    ] },
  { group: "Blood test", title: "🩸 Blood tests", other: "Other blood / lab test",
    items: [
      { code: "CTBT",  name: "CT / BT", full: "Clotting time / Bleeding time", hint: "e.g. before extraction" },
      { code: "CBP",   name: "CBP", full: "Complete blood picture (Hb, WBC, platelets)" },
      { code: "HBA1C", name: "HbA1c", full: "Glycated haemoglobin (3-month sugar control)" },
      { code: "FBS",   name: "FBS",   full: "Fasting blood sugar", hint: "Fasting 8–10 hours" },
      { code: "FPG",   name: "FPG",   full: "Fasting plasma glucose", hint: "Fasting 8–10 hours" },
      { code: "PPBS",  name: "PPBS",  full: "Post-prandial blood sugar", hint: "2 hours after food" },
      { code: "PPBG",  name: "PPBG",  full: "Post-prandial blood glucose", hint: "2 hours after food" },
      { code: "RBS",   name: "RBS",   full: "Random blood sugar" },
      { code: "RPG",   name: "RPG",   full: "Random plasma glucose" },
      { code: "OGTT",  name: "OGTT",  full: "Oral glucose tolerance test", hint: "Fasting; 75 g glucose" },
      { code: "PTINR", name: "PT / INR", full: "Prothrombin time / INR", hint: "Patients on warfarin / anticoagulants", more: true },
      { code: "APTT",  name: "aPTT", full: "Activated partial thromboplastin time", more: true },
      { code: "PLT",   name: "Platelet count", full: "Platelet count", more: true },
      { code: "HB",    name: "Hb%", full: "Haemoglobin", more: true },
      { code: "ESR",   name: "ESR", full: "Erythrocyte sedimentation rate", hint: "e.g. infection / inflammation", more: true },
      { code: "CRP",   name: "CRP", full: "C-reactive protein", hint: "e.g. space infection", more: true },
      { code: "VIRAL", name: "HIV · HBsAg · HCV", full: "Viral markers (before surgery)", hint: "Before surgery / implants", more: true },
      { code: "BGRP",  name: "Blood group & Rh", full: "Blood grouping and Rh typing", more: true },
      { code: "CREAT", name: "Serum creatinine", full: "Kidney function", hint: "Before NSAIDs / antibiotics in kidney disease", more: true },
      { code: "LFT",   name: "LFT", full: "Liver function tests", more: true },
      { code: "TSH",   name: "Thyroid profile (T3, T4, TSH)", full: "Thyroid function", more: true },
      { code: "CA",    name: "Serum calcium", full: "Serum calcium (with phosphorus, ALP if needed)", hint: "e.g. bone lesions", more: true },
      { code: "VITD",  name: "Vitamin D", full: "25-OH Vitamin D", more: true },
      { code: "B12",   name: "Vitamin B12", full: "Serum Vitamin B12", hint: "e.g. burning mouth, glossitis, ulcers", more: true },
      { code: "IRON",  name: "Serum iron / ferritin", full: "Iron studies", hint: "e.g. pallor, angular cheilitis", more: true },
      { code: "URINE", name: "Urine routine", full: "Complete urine examination", more: true },
    ] },
];
const INV_INDEX = Object.fromEntries(INVESTIGATION_GROUPS.flatMap(g => g.items.map(i => [`${g.group}|${i.code}`, { ...i, group: g.group }])));

function parseInvestigations(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw || "[]"); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).filter(i => i && typeof i === "object" && String(i.name || "").trim())
    .map(i => ({ group: i.group || "Other", code: i.code || "", name: String(i.name).trim(), note: i.note || "" }));
}
const invKey = (i) => `${i.group}|${i.code || i.name.toLowerCase()}`;

function InvestigationsEditor({ value, onChange }) {
  const list = parseInvestigations(value);
  const [other, setOther] = useState({ Radiograph: "", "Blood test": "" });
  const [more, setMore] = useState({ Radiograph: false, "Blood test": false });
  const has = (group, code) => list.some(i => i.group === group && i.code === code);
  const toggle = (group, item) => {
    if (has(group, item.code)) onChange(list.filter(i => !(i.group === group && i.code === item.code)));
    else onChange([...list, { group, code: item.code, name: item.name, note: "" }]);
  };
  const addOther = (group) => {
    const name = other[group].trim();
    if (!name) return;
    if (!list.some(i => i.group === group && i.name.toLowerCase() === name.toLowerCase()))
      onChange([...list, { group, code: "", name, note: "" }]);
    setOther(o => ({ ...o, [group]: "" }));
  };
  const setNote = (k, note) => onChange(list.map(i => (invKey(i) === k ? { ...i, note } : i)));
  const remove = (k) => onChange(list.filter(i => invKey(i) !== k));

  return (
    <div className="presc-inv">
      {INVESTIGATION_GROUPS.map(g => {
        const chosen = list.filter(i => i.group === g.group);
        return (
          <div key={g.group} className="presc-inv-group" role="group" aria-label={g.title.replace(/^\S+\s/, "")}>
            <div className="presc-inv-title">{g.title}{chosen.length > 0 && <span className="presc-inv-n">{chosen.length}</span>}</div>
            <div className="presc-inv-chips">
              {g.items.filter(item => !item.more || more[g.group] || has(g.group, item.code)).map(item => (
                <button key={item.code} type="button" title={item.full} aria-pressed={has(g.group, item.code)}
                  className={`presc-inv-chip${has(g.group, item.code) ? " on" : ""}`} onClick={() => toggle(g.group, item)}>
                  {has(g.group, item.code) ? "✓ " : "+ "}{item.name}
                </button>
              ))}
              {g.items.some(i => i.more) && (
                <button type="button" className="presc-inv-more" aria-expanded={more[g.group]}
                  onClick={() => setMore(m => ({ ...m, [g.group]: !m[g.group] }))}>
                  {more[g.group] ? "▲ Fewer" : `▼ More (${g.items.filter(i => i.more).length})`}
                </button>
              )}
            </div>
            <div className="presc-inv-other">
              <input value={other[g.group]} placeholder={g.other} aria-label={`Other ${g.group.toLowerCase()}`}
                onChange={e => setOther(o => ({ ...o, [g.group]: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOther(g.group); } }} />
              <button type="button" onClick={() => addOther(g.group)} disabled={!other[g.group].trim()}>+ Add</button>
            </div>
            {chosen.length > 0 && (
              <ul className="presc-inv-list">
                {chosen.map(i => {
                  const meta = INV_INDEX[`${i.group}|${i.code}`];
                  const k = invKey(i);
                  return (
                    <li key={k}>
                      <div className="presc-inv-name">
                        <b>{i.name}</b>{meta?.full && <span> — {meta.full}</span>}
                        <button type="button" onClick={() => remove(k)} aria-label={`Remove ${i.name}`}>✕</button>
                      </div>
                      <textarea rows={1} value={i.note} placeholder={meta?.hint ? `Notes — ${meta.hint}` : "Notes (optional)"}
                        aria-label={`Notes for ${i.name}`} onChange={e => setNote(k, e.target.value)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditModal({ presc, onSave, onClose, saving, error = "", allergies = [], health = null }) {
  const [form, setForm] = useState({
    patient_name:   presc.patient_name  || "",
    patient_age:    presc.patient_age   || "",
    patient_gender: presc.patient_gender || presc.gender || "",
    case_number:    presc.case_number   || "",
    date:           presc.date ? presc.date.split("T")[0] : "",
    diagnosis:      presc.diagnosis     || "",
    advice:         presc.advice        || "",
    treatment_done: presc.treatment_done || presc.treatment_done_today || "",
    follow_up_date: presc.follow_up_date ? presc.follow_up_date.split("T")[0] : "",
    follow_up_time: presc.follow_up_time || "",
    medicines:      parseMedicines(presc._medsArr || presc.medicines),
    investigations: parseInvestigations(presc.investigations),
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const inp = { width:"100%", padding:"8px 11px", border:"1.5px solid #e2e8f0", borderRadius:8, fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, color:"#1e293b", background:"#f8fafc", outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:10.5, fontWeight:700, color:"#8899bb", letterSpacing:"0.7px", textTransform:"uppercase", marginBottom:5, display:"block" };
  const box = { background:"#f8fafc", border:"1px solid #e9eef4", borderRadius:10, padding:"12px 14px", marginBottom:12 };
  const canSave = !saving && form.patient_name.trim();

  const submit = () => onSave({
    patient_name:form.patient_name.trim(), patient_age:form.patient_age, patient_gender:form.patient_gender,
    case_number:form.case_number, date:form.date,
    diagnosis:form.diagnosis, advice:form.advice, treatment_done_today:form.treatment_done,
    follow_up_date:form.follow_up_date, follow_up_time:form.follow_up_time,
    medicines:JSON.stringify(medicinesForSave(form.medicines)),
    investigations: form.investigations.map(i => ({ ...i, note: i.note.trim() })),
  });

  return (
    <PopWindow label="Edit prescription" onClose={onClose} busy={saving} maxWidth={860}>
      <div className="presc-window-head" style={{ background:"linear-gradient(135deg,#1d4d7a,#1d6fa4)" }}>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:"#fff" }}>✏️ Edit Prescription</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)" }}>{presc.patient_name}</div>
        </div>
        <button type="button" className="presc-x" onClick={onClose} disabled={saving} aria-label="Close">✕</button>
      </div>
      <div className="presc-window-body">
        {/* Patient */}
        <div style={box}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:10 }}>👤 Patient Info</div>
          <div className="presc-grid3">
            <div><label style={lbl}>Name</label><input style={inp} value={form.patient_name} onChange={e=>set("patient_name",e.target.value)} aria-label="Patient name" /></div>
            <div><label style={lbl}>Age</label><input style={inp} value={form.patient_age} onChange={e=>set("patient_age",e.target.value)} aria-label="Age" /></div>
            <div>
              <label style={lbl}>Gender</label>
              <select style={{ ...inp, cursor:"pointer" }} value={form.patient_gender} onChange={e=>set("patient_gender",e.target.value)} aria-label="Gender">
                <option value="">— Select —</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                {form.patient_gender && !["Male","Female","Other"].includes(form.patient_gender) && <option value={form.patient_gender}>{form.patient_gender}</option>}
              </select>
            </div>
            <div><label style={lbl}>Case No.</label><input style={inp} value={form.case_number} onChange={e=>set("case_number",e.target.value)} aria-label="Case number" /></div>
            <div><label style={lbl}>Date</label><input type="date" style={inp} value={form.date} onChange={e=>set("date",e.target.value)} aria-label="Prescription date" /></div>
          </div>
        </div>
        {/* Clinical */}
        <div style={box}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:10 }}>📋 Clinical Notes</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div><label style={lbl}>Diagnosis</label><textarea style={{ ...inp, minHeight:52, resize:"vertical" }} value={form.diagnosis} onChange={e=>set("diagnosis",e.target.value)} aria-label="Diagnosis" /></div>
            <div><label style={lbl}>Advice</label><textarea style={{ ...inp, minHeight:52, resize:"vertical" }} value={form.advice} onChange={e=>set("advice",e.target.value)} aria-label="Advice" /></div>
            <div><label style={lbl}>Treatment Done</label><textarea style={{ ...inp, minHeight:52, resize:"vertical" }} value={form.treatment_done} onChange={e=>set("treatment_done",e.target.value)} aria-label="Treatment done" /></div>
          </div>
        </div>
        {/* Medicines */}
        <div style={box}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:10 }}>🧾 Medicines &amp; Investigations</div>
          <AllergyBanner allergies={allergies} noneKnown={false} health={health} />
          <MedicineEditor medicines={form.medicines} onChange={list=>set("medicines",list)} allergies={allergies} />
          <div style={{ marginTop:14, paddingTop:12, borderTop:"1.5px dashed #e2e8f0" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:10 }}>🔬 Investigations Advised</div>
            <InvestigationsEditor value={form.investigations} onChange={list=>set("investigations",list)} />
          </div>
        </div>
        {/* Follow-up */}
        <div style={{ ...box, marginBottom:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:10 }}>📅 Follow-up</div>
          <div className="presc-grid2">
            <div>
              <label style={lbl}>Date</label>
              <input type="date" style={inp} value={form.follow_up_date} onChange={e=>set("follow_up_date",e.target.value)} aria-label="Follow-up date" />
            </div>
            <div>
              <label style={lbl}>Time <span style={{ fontWeight:400, textTransform:"none", color:"#94a3b8" }}>(optional)</span></label>
              <input type="time" style={inp} value={form.follow_up_time} onChange={e=>set("follow_up_time",e.target.value)} aria-label="Follow-up time" />
            </div>
          </div>
        </div>
        {error && <div className="presc-msg error" role="alert" style={{ marginTop:12, marginBottom:0 }}>⚠️ {error}</div>}
      </div>
      <div className="presc-window-foot">
        <button type="button" onClick={onClose} disabled={saving} style={{ flex:1, padding:11, borderRadius:10, background:"transparent", color:"#64748b", border:"1.5px solid #e2e8f4", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:600, cursor:"pointer" }}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canSave} style={{ flex:2, padding:11, borderRadius:10, background:"linear-gradient(135deg,#0d6e4a,#10b981)", color:"#fff", border:"none", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:700, cursor:canSave?"pointer":"not-allowed", opacity:canSave?1:0.6 }}>{saving?"Saving…":"💾 Save Changes"}</button>
      </div>
    </PopWindow>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PREVIOUS PRESCRIPTIONS — every prescription of this patient
   (all visits), newest first: view · edit · delete · print · reuse medicines
═══════════════════════════════════════════════════════════════ */
function PreviousPrescriptions({
  visitId, refreshTrigger,
  patientName: defaultPatientName = "", caseNumber: defaultCaseNumber = "", patientMobile = "",
  disabled = false, allergies = [], health = null,
  onRows = null,            // told about the loaded list (used for the "already has a prescription" notice)
  editRequest = null,       // { id, n } → open the Edit window for that prescription
  onUseMedicines = null,    // (medicines) → copy them into the prescription being written
}) {
  const [all,        setAll]        = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState("");
  const [viewP,      setViewP]      = useState(null);
  const [editP,      setEditP]      = useState(null);
  const [delId,      setDelId]      = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [deling,     setDeling]     = useState(false);
  const [editError,  setEditError]  = useState("");
  const [delError,   setDelError]   = useState("");
  const [notice,     setNotice]     = useState("");
  const usedFallback = useRef(false);

  // Older servers have no "history" address: fall back to filtering the full list here.
  const loadFallback = async () => {
    const res = await api.get("/prescriptions");
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!visitId) return rows;
    const thisVisit = rows.filter(p => String(p.visit_id) === String(visitId));
    const caseNo = defaultCaseNumber || thisVisit[0]?.case_number || "";
    const name   = defaultPatientName || thisVisit[0]?.patient_name || "";
    return rows.filter(p =>
      String(p.visit_id) === String(visitId) ||
      (caseNo && p.case_number && p.case_number === caseNo) ||
      (!caseNo && name && !p.case_number && p.patient_name === name));
  };

  const load = async () => {
    setLoading(true); setLoadError("");
    try {
      let rows;
      if (visitId) {
        try {
          const res = await api.get(`/visits/${visitId}/prescriptions/history`);
          rows = Array.isArray(res.data) ? res.data : [];
        } catch (err) {
          if (err?.response?.status !== 404 && err?.response?.status !== 405) throw err;
          if (err?.response?.data?.error) throw err;          // the new server answered: this visit does not exist
          usedFallback.current = true;
          rows = await loadFallback();
        }
      } else {
        rows = await loadFallback();
      }
      setAll(rows);
    } catch (err) {
      console.error("Could not load prescriptions:", err);
      setAll([]);
      setLoadError("Could not load the past prescriptions.");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [visitId, refreshTrigger]);
  // Only an older server needs the case number to pick this patient's prescriptions; reload once it is known.
  useEffect(() => { if (usedFallback.current && defaultCaseNumber) load(); }, [defaultCaseNumber]);
  useEffect(() => { if (onRows) onRows(all); }, [all]);
  useEffect(() => {
    if (!editRequest?.id || disabled) return;
    const target = all.find(p => p.id === editRequest.id);
    if (target) { setEditError(""); setEditP(target); }
  }, [editRequest?.n]);

  const sorted = [...all].sort((a,b) => (b.id||0)-(a.id||0));

  const todayCount = all.filter(p => (p.date||"").startsWith(todayStr())).length;

  const doEditSave = async (payload) => {
    setSaving(true); setEditError("");
    try {
      const res = await api.put(`/prescriptions/${editP.id}`, payload);
      setAll(prev => prev.map(p => p.id===editP.id ? res.data : p));

      // Book/update appointment if follow-up date is set
      const booked = await bookFollowUp({
        visitId:    editP.visit_id,
        name:       payload.patient_name || editP.patient_name,
        mobile:     editP.patient_mobile || editP.mobile || patientMobile,
        caseNumber: payload.case_number || editP.case_number,
        date:       payload.follow_up_date,
        time:       payload.follow_up_time,
        diagnosis:  payload.diagnosis,
      });
      setNotice(booked === "failed" ? "Prescription updated, but the follow-up appointment could not be booked — please add it in Appointments." : "");
      setEditP(null);
    } catch (err) {
      console.error("Prescription update failed:", err);
      setEditError(saveError(err, "The changes were NOT saved."));
    }
    finally { setSaving(false); }
  };
  const doDelete = async () => {
    setDeling(true); setDelError("");
    try {
      await api.delete(`/prescriptions/${delId}`);
      setAll(prev => prev.filter(p => p.id !== delId));
      setDelId(null);
    } catch (err) {
      if (err?.response?.status === 404) { setAll(prev => prev.filter(p => p.id !== delId)); setDelId(null); }
      else { console.error("Prescription delete failed:", err); setDelError(saveError(err, "The prescription was NOT deleted.")); }
    }
    finally { setDeling(false); }
  };

  const S = cardStyles;
  const btn = (bg, color, border) => ({ background:bg, color, border:`1.5px solid ${border}` });
  return (
    <div style={{ ...S.card, border:"1.5px solid #e0e7ff", background:"#fafbff" }}>
      {/* Section header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" }}>
          <div style={{ ...S.cardTitle, fontSize:14, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:32, height:32, borderRadius:9, background:"linear-gradient(135deg,#6366f1,#818cf8)", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>📋</span>
            Past Prescriptions
          </div>
          <span style={{ fontSize:11, fontWeight:700, background:"#f5f3ff", color:"#7c3aed", border:"1px solid #ddd6fe", borderRadius:20, padding:"2px 10px" }}>{all.length} total</span>
          {todayCount > 0 && (
            <span style={{ fontSize:11, fontWeight:700, background:"#f0fdf4", color:"#166534", border:"1px solid #86efac", borderRadius:20, padding:"2px 10px" }}>
              {todayCount} today
            </span>
          )}
        </div>
        <button type="button" onClick={load} style={{ padding:"5px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#f8fafc", color:"#64748b", border:"1.5px solid #e2e8f0", cursor:"pointer" }}>↻ Refresh</button>
      </div>
      <div style={{ fontSize:11.5, color:"#64748b", fontStyle:"italic", margin:"-6px 0 12px" }}>
        Full history for this patient, all visits — {disabled ? "view or print any prescription" : "view, edit, delete or print any prescription"}
      </div>

      {notice && <div className="presc-msg warn" role="status">{notice}<button type="button" onClick={()=>setNotice("")}>OK</button></div>}
      {loadError && <div className="presc-msg error" role="alert"><span>⚠️ {loadError}</span><button type="button" onClick={load}>Try again</button></div>}

      {/* ── Results list ── */}
      {loading && sorted.length === 0 ? (
        <div style={{ textAlign:"center", padding:"26px 0", color:"#94a3b8" }}>
          <span className="presc-spin" style={{ marginRight:8 }}/>Loading…
        </div>
      ) : sorted.length === 0 ? (
        !loadError && (
          <div style={{ textAlign:"center", padding:"26px 0", color:"#94a3b8" }}>
            <div style={{ fontSize:32, marginBottom:8, opacity:0.35 }}>💊</div>
            <div style={{ fontWeight:700, color:"#475569", marginBottom:4 }}>
              No past prescriptions
            </div>
            <div style={{ fontSize:12 }}>
              Prescriptions confirmed for this patient will appear here.
            </div>
          </div>
        )
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {sorted.map(p => {
            const meds = parseMedicines(p.medicines);
            const isFromToday = (p.date||"").startsWith(todayStr());
            const isThisVisit = visitId && String(p.visit_id) === String(visitId);
            return (
              <div key={p.id} data-prescription-id={p.id}
                style={{ border:`1.5px solid ${isFromToday?"#86efac":"#e9eef4"}`, borderRadius:10, padding:"12px 14px", background: isFromToday?"#fafffe":"#fff", position:"relative", overflow:"hidden", transition:"border-color 0.15s,box-shadow 0.15s" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=isFromToday?"#4ade80":"#c7b8fc";e.currentTarget.style.boxShadow="0 3px 10px rgba(0,0,0,0.07)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=isFromToday?"#86efac":"#e9eef4";e.currentTarget.style.boxShadow="none";}}>
                {/* Left accent bar */}
                <div style={{ position:"absolute", left:0, top:0, bottom:0, width:3, background: isFromToday ? "linear-gradient(180deg,#22c55e,#16a34a)" : "linear-gradient(180deg,#b22222,#c0392b)", borderRadius:"3px 0 0 3px" }}/>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                  <div style={{ flex:"1 1 260px", minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                      <span style={{ fontSize:13.5, fontWeight:800, color:"#0b2d4e" }}>{p.patient_name||"—"}</span>
                      {p.case_number && (
                        <span style={{ fontSize:10.5, fontWeight:700, background:"#f1f5f9", color:"#475569", border:"1px solid #e2e8f0", borderRadius:5, padding:"1px 7px" }}>
                          Case: {p.case_number}
                        </span>
                      )}
                      {isFromToday && (
                        <span style={{ fontSize:10, fontWeight:700, background:"#dcfce7", color:"#16a34a", border:"1px solid #86efac", borderRadius:5, padding:"1px 7px" }}>
                          Today
                        </span>
                      )}
                      {isThisVisit && (
                        <span style={{ fontSize:10, fontWeight:700, background:"#eff6ff", color:"#1d4ed8", border:"1px solid #bfdbfe", borderRadius:5, padding:"1px 7px" }}>
                          This visit
                        </span>
                      )}
                    </div>
                    <div style={{ display:"flex", gap:"6px 14px", flexWrap:"wrap", fontSize:11.5, color:"#64748b" }}>
                      <span>📅 {fmtDate(p.date)}</span>
                      {p.patient_age && <span>Age: {p.patient_age}</span>}
                      {p.follow_up_date && (
                        <span style={{ color:"#16a34a", fontWeight:600 }}>
                          🔜 {fmtDate(p.follow_up_date)}{p.follow_up_time ? ` ${fmtTime(p.follow_up_time)}` : ""}
                        </span>
                      )}
                    </div>
                    {meds.length > 0 && (
                      <div style={{ marginTop:5, fontSize:12, color:"#334155", overflowWrap:"anywhere" }}>
                        💊 {meds.map(m => m.name).join(" · ")}
                      </div>
                    )}
                    {p.diagnosis && (
                      <div style={{ marginTop:5, fontSize:11.5, color:"#64748b", fontStyle:"italic", background:"#f8faff", borderRadius:5, padding:"3px 8px", display:"inline-block", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        📋 {p.diagnosis.length>80 ? p.diagnosis.slice(0,80)+"…" : p.diagnosis}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"flex", gap:6, maxWidth:"100%", alignItems:"center", flexWrap:"wrap" }}>
                    <button type="button" className="presc-rowbtn" onClick={()=>setViewP(p)} style={btn("#f0fdf4","#166534","#86efac")}>👁 View</button>
                    <button type="button" className="presc-rowbtn" onClick={()=>printPrescription(toLetterData(p))} style={btn("#f0f9ff","#0369a1","#bae6fd")}>🖨 Print</button>
                    {!disabled && onUseMedicines && meds.length > 0 && (
                      <button type="button" className="presc-rowbtn" onClick={()=>onUseMedicines(meds)} title="Copy these medicines into the prescription you are writing" style={btn("#fffbeb","#92400e","#fde68a")}>↺ Use medicines</button>
                    )}
                    {!disabled && <button type="button" className="presc-rowbtn" onClick={()=>{ setEditError(""); setEditP(p); }} style={btn("#eff4ff","#1d4ed8","#c7d9fc")}>✏️ Edit</button>}
                    {!disabled && <button type="button" className="presc-rowbtn" onClick={()=>{ setDelError(""); setDelId(p.id); }} aria-label="Delete prescription" title="Delete" style={btn("#fff1f2","#dc2626","#fca5a5")}>🗑</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── View modal ── */}
      {viewP && (() => {
        const vd = toLetterData(viewP);
        return (
          <PopWindow label="Prescription" onClose={()=>setViewP(null)} maxWidth={760} background="#e8e8e8">
            <div className="presc-window-head" style={{ background:"linear-gradient(135deg,#6b1a1a,#9b2226)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                <span style={{ fontSize:20 }}>💊</span>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:800, color:"#fff" }}>Prescription</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)" }}>{viewP.patient_name} · {fmtDate(viewP.date)}</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button type="button" onClick={()=>printPrescription(vd)} style={{ padding:"6px 16px", borderRadius:8, border:"none", background:"#10b981", color:"#fff", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:12.5, fontWeight:700, cursor:"pointer" }}>🖨 Print</button>
                <button type="button" className="presc-x" onClick={()=>setViewP(null)} aria-label="Close">✕</button>
              </div>
            </div>
            <div className="presc-window-body" style={{ padding:20 }}>
              <LetterheadCard data={vd} />
            </div>
          </PopWindow>
        );
      })()}

      {/* ── Edit modal ── */}
      {editP && <EditModal presc={editP} onSave={doEditSave} onClose={()=>setEditP(null)} saving={saving} error={editError} allergies={allergies} health={health} />}

      {/* ── Delete confirm ── */}
      {delId && (
        <PopWindow label="Delete prescription" onClose={()=>setDelId(null)} busy={deling} maxWidth={400}>
          <div style={{ padding:"28px 32px" }}>
            <div style={{ fontSize:34, marginBottom:12 }}>🗑️</div>
            <div style={{ fontSize:16, fontWeight:800, color:"#0b2d4e", marginBottom:8 }}>Delete Prescription?</div>
            <div style={{ fontSize:13, color:"#64748b", marginBottom:22, lineHeight:1.65 }}>This will permanently delete this prescription and cannot be undone.</div>
            {delError && <div className="presc-msg error" role="alert">⚠️ {delError}</div>}
            <div style={{ display:"flex", gap:10 }}>
              <button type="button" onClick={()=>setDelId(null)} disabled={deling} style={{ flex:1, padding:11, borderRadius:10, background:"transparent", color:"#64748b", border:"1.5px solid #e2e8f4", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:600, cursor:"pointer" }}>Cancel</button>
              <button type="button" onClick={doDelete} disabled={deling} style={{ flex:1, padding:11, borderRadius:10, background:"linear-gradient(135deg,#dc2626,#ef4444)", color:"#fff", border:"none", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:700, cursor:"pointer", opacity:deling?0.65:1 }}>{deling?"Deleting…":"🗑️ Delete"}</button>
            </div>
          </div>
        </PopWindow>
      )}
    </div>
  );
}

const cardStyles = {
  card:      { background:"#fff", borderRadius:12, padding:"14px 16px", border:"1.5px solid #e9eef4", marginBottom:12 },
  cardTitle: { fontSize:13, fontWeight:700, color:"#1e293b" },
  label:     { fontSize:10.5, fontWeight:700, color:"#8899bb", letterSpacing:"0.7px", textTransform:"uppercase", marginBottom:5, display:"block" },
};

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function Prescription({ visitId, patient = null, consultationData = null, disabled = false }) {
  useEffect(() => { injectStyles(); }, []);

  const [patientInfo,   setPatientInfo]   = useState(patient);
  const [patientName,   setPatientName]   = useState("");
  const [patientAge,    setPatientAge]    = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [caseNumber,    setCaseNumber]    = useState("");
  const [patientMobile, setPatientMobile] = useState("");
  const [date,          setDate]          = useState(todayStr());   // ← default today
  const [diagnosis,     setDiagnosis]     = useState("");
  const [advice,        setAdvice]        = useState("");
  const [treatmentDone, setTreatmentDone] = useState("");
  const [followUpDate,  setFollowUpDate]  = useState("");
  const [followUpTime,  setFollowUpTime]  = useState("");
  const [medicines,     setMedicines]     = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [showPreview,   setShowPreview]   = useState(false);
  const [confirming,    setConfirming]    = useState(false);
  const [confirmed,     setConfirmed]     = useState(false);
  const [savedId,       setSavedId]       = useState(null);
  const [savedData,     setSavedData]     = useState(null);
  const [saveProblem,   setSaveProblem]   = useState("");
  const [bookingNote,   setBookingNote]   = useState("");
  const [refreshKey,    setRefreshKey]    = useState(0);
  const [history,       setHistory]       = useState([]);
  const [editRequest,   setEditRequest]   = useState(null);
  const [copiedNote,    setCopiedNote]    = useState("");
  const [allergies,     setAllergies]     = useState([]);
  const [noneKnown,     setNoneKnown]     = useState(false);
  const [health,        setHealth]        = useState(null);

  useEffect(() => {
    if (patientInfo || !visitId) return;
    api.get(`/visits/${visitId}`).then(res => {
      const v = res.data || {};
      const p = { name:v.patient?.name||v.patient_name||v.name||"", age:v.patient?.age||v.age||"", case_number:v.patient?.case_number||v.case_number||"", gender:v.patient?.gender||v.gender||"", mobile:v.patient?.mobile||v.patient_mobile||v.mobile||"" };
      setPatientInfo(p); setPatientName(p.name); setPatientAge(String(p.age||"")); setPatientGender(p.gender||""); setCaseNumber(p.case_number||""); setPatientMobile(p.mobile||"");
    }).catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  useEffect(() => {
    if (!patient) return;
    setPatientName(patient.name||""); setPatientAge(String(patient.age||"")); setPatientGender(patient.gender||""); setCaseNumber(patient.case_number||""); setPatientMobile(patient.mobile||"");
  }, [patient]);

  // The patient's recorded allergies (Medical History), shown above the medicines.
  // If they cannot be fetched nothing is shown — exactly as before this existed.
  useEffect(() => {
    if (!visitId) return;
    let cancelled = false;
    api.get(`/visits/${visitId}`)
      .then(res => {
        const pid = res.data?.patient?.id || res.data?.visit?.patient_id || res.data?.patient_id;
        if (!pid) return null;
        return api.get(`/patients/${pid}/medical-history`);
      })
      .then(res => {
        if (cancelled || !res?.data) return;
        const list = Array.isArray(res.data.allergies) ? res.data.allergies : [];
        setAllergies(list.filter(a => a && a.allergen && String(a.status || "Active").toLowerCase() !== "resolved"));
        setNoneKnown(!!res.data.none_known?.allergies);
        setHealth(healthFrom(res.data));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visitId]);

  useEffect(() => {
    if (!consultationData) return;
    if (consultationData.diagnosis)            setDiagnosis(consultationData.diagnosis);
    if (consultationData.advice)               setAdvice(consultationData.advice);
    if (consultationData.treatment_done_today) setTreatmentDone(consultationData.treatment_done_today);
    if (consultationData.treatment_done)       setTreatmentDone(consultationData.treatment_done);
    const fud = consultationData.follow_up_date || "";
    if (fud) setFollowUpDate(fud);
    const cft = consultationData.follow_up_time || consultationData.followup_time || consultationData.followUpTime || "";
    if (cft) {
      setFollowUpTime(cft);
    } else if (fud && visitId) {
      // follow_up_time not in consultationData — look it up from appointments
      api.get(`/appointments`).then(res => {
        const appts = res.data || [];
        const match = appts.find(a =>
          a.date === fud &&
          a.source === "consultation" &&
          (String(a.visit_id) === String(visitId) ||
           a.case_number === (consultationData.case_number || caseNumber) ||
           a.name === (consultationData.patient_name || patientName))
        );
        if (match?.time) setFollowUpTime(match.time);
      }).catch(()=>{});
    }
  }, [consultationData]);

  useEffect(() => {
    if (!visitId) return;
    // Fetch consultations + appointments in parallel
    Promise.all([
      api.get(`/visits/${visitId}/consultations`).catch(()=>({data:[]})),
      api.get(`/appointments`).catch(()=>({data:[]})),
    ]).then(([consultRes, apptRes]) => {
      const rows  = consultRes.data || [];
      const appts = apptRes.data   || [];
      if (!rows.length) return;
      const today = todayStr();
      const tr = rows.filter(r => (r.created_at||"").split("T")[0]===today);
      const latest = tr.length>0 ? tr[tr.length-1] : rows[rows.length-1];

      // Fill clinical fields
      if (!consultationData?.diagnosis && latest.diagnosis)                      setDiagnosis(latest.diagnosis);
      if (!consultationData?.advice    && latest.advice)                          setAdvice(latest.advice);
      if (!consultationData?.treatment_done_today && latest.treatment_done_today) setTreatmentDone(latest.treatment_done_today);
      if (!consultationData?.treatment_done       && latest.treatment_done)       setTreatmentDone(latest.treatment_done);

      // Follow-up date
      const fud = latest.follow_up_date || "";
      if (fud) setFollowUpDate(fud);

      // Follow-up time — check consultation record first, then appointments
      const ftFromConsult = latest.follow_up_time || latest.followup_time || latest.followUpTime || "";
      if (ftFromConsult) {
        setFollowUpTime(ftFromConsult);
      } else if (fud && appts.length) {
        // Find matching appointment booked for this visit's follow-up date
        const match = appts.find(a =>
          a.date === fud &&
          a.source === "consultation" &&
          (String(a.visit_id) === String(visitId) ||
           a.case_number === (patientInfo?.case_number || caseNumber) ||
           a.name === (patientInfo?.name || patientName))
        );
        if (match?.time) setFollowUpTime(match.time);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  // Medicines copied from an earlier prescription are added to what is already there.
  const useMedicinesFrom = (list) => {
    const have = new Set(medicines.map(m => m.name.trim().toLowerCase()));
    const fresh = parseMedicines(list).filter(m => !have.has(m.name.toLowerCase()));
    setMedicines(prev => [...prev, ...fresh]);
    setCopiedNote(fresh.length === 0 ? "Those medicines are already on this prescription."
      : `${fresh.length} medicine${fresh.length !== 1 ? "s" : ""} copied — check the doses before saving.`);
    setShowPreview(false); setConfirmed(false);
  };

  const cleanMeds = useMemo(() => medicinesForSave(medicines), [medicines]);
  const hasText   = !!(diagnosis.trim() || advice.trim() || treatmentDone.trim() || investigations.length);
  const canPreview = !!patientName.trim() && (cleanMeds.length > 0 || hasText);
  const whyNot = !patientName.trim() ? "Enter the patient's name."
    : (cleanMeds.length === 0 && !hasText) ? "Add at least one medicine (or a diagnosis / advice / investigation)." : "";
  const unnamed = medicines.length - cleanMeds.length;
  const flagged = cleanMeds.filter(m => allergyMatches(m.name, allergies).length > 0);

  const cleanInv = investigations.map(i => ({ ...i, note: i.note.trim() }));
  const previewData = { patientName, patientAge, patientGender, caseNumber, date, diagnosis, advice, treatmentDone, medicines: cleanMeds, investigations: cleanInv, followUpDate, followUpTime };

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true); setSaveProblem("");
    try {
      const payload = {
        visit_id:visitId, patient_name:patientName.trim(), patient_age:patientAge, patient_gender:patientGender,
        case_number:caseNumber, date, diagnosis, advice,
        treatment_done_today:treatmentDone,
        follow_up_date:followUpDate, follow_up_time:followUpTime,
        medicines:JSON.stringify(cleanMeds), investigations: cleanInv, status:"confirmed"
      };
      const res = await api.post(`/visits/${visitId}/prescriptions`, payload);
      setSavedId(res.data?.id||res.data?.prescription_id||null);
      setSavedData(previewData);

      // Book appointment if follow-up date is set (re-uses the one Consultation booked)
      const booked = await bookFollowUp({ visitId, name: patientName.trim(), mobile: patientMobile, caseNumber, date: followUpDate, time: followUpTime, diagnosis });
      setBookingNote(booked === "failed" ? "The follow-up appointment could not be booked — please add it in Appointments." : "");

      setConfirmed(true); setShowPreview(false); setCopiedNote("");
      setRefreshKey(k=>k+1);
    } catch (err) {
      console.error("Prescription save failed:", err);
      setSaveProblem(saveError(err, "The prescription was NOT saved."));
    } finally { setConfirming(false); }
  };

  const S = styles;
  const thisVisitRx = history.filter(p => String(p.visit_id) === String(visitId)).sort((a,b) => (b.id||0)-(a.id||0));

  const pastList = (
    <PreviousPrescriptions visitId={visitId} refreshTrigger={refreshKey}
      patientName={patientName} caseNumber={caseNumber} patientMobile={patientMobile}
      disabled={disabled} allergies={allergies} health={health}
      onRows={setHistory} editRequest={editRequest}
      onUseMedicines={disabled ? null : useMedicinesFrom} />
  );

  /* ── CLOSED VISIT: look, print — nothing can be changed ── */
  if (disabled) return (
    <div className="presc-root" style={S.root}>
      <div style={S.header}>
        <span style={S.headerIcon}>💊</span>
        <div><div style={S.headerTitle}>Prescription</div><div style={S.headerSub}>This visit is closed</div></div>
      </div>
      <div className="presc-msg locked">🔒 This visit is closed — prescriptions can be viewed and printed, but not written or changed.</div>
      {pastList}
    </div>
  );

  /* ── CONFIRMED STATE ── */
  if (confirmed) return (
    <div className="presc-root presc-fade" style={S.root}>
      <div style={{ textAlign:"center", padding:"28px 24px 24px" }}>
        <div style={{ fontSize:50, marginBottom:12 }}>✅</div>
        <div style={{ fontSize:17, fontWeight:800, color:"#0b2d4e", marginBottom:6 }}>Prescription Confirmed!</div>
        <div style={{ fontSize:13, color:"#64748b", marginBottom:18 }}>Sent to Reception · Prescription #{savedId||"—"}</div>
        {bookingNote && <div className="presc-msg warn" role="status" style={{ textAlign:"left" }}>{bookingNote}</div>}
        <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
          {savedData && (
            <button type="button" onClick={()=>printPrescription(savedData)} style={{ padding:"10px 24px", borderRadius:10, fontSize:13, fontWeight:700, background:"#10b981", color:"#fff", border:"1.5px solid #10b981", cursor:"pointer", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>🖨 Print this prescription</button>
          )}
          <button type="button" onClick={()=>{setConfirmed(false);setMedicines([]);setInvestigations([]);setShowPreview(false);setSaveProblem("");}} style={{ padding:"10px 24px", borderRadius:10, fontSize:13, fontWeight:700, background:"#eff6ff", color:"#1d4ed8", border:"1.5px solid #bfdbfe", cursor:"pointer", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>+ Write Another Prescription</button>
        </div>
      </div>
      {pastList}
    </div>
  );

  /* ── PREVIEW STATE ── */
  if (showPreview) return (
    <div className="presc-root" style={S.root}>
      <div style={S.header}>
        <span style={S.headerIcon}>💊</span>
        <div><div style={S.headerTitle}>Prescription Preview</div><div style={S.headerSub}>Review before sending to reception</div></div>
        <button type="button" onClick={()=>printPrescription(previewData)} style={{ marginLeft:"auto", padding:"7px 16px", borderRadius:8, border:"none", background:"#10b981", color:"#fff", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:12.5, fontWeight:700, cursor:"pointer" }}>🖨 Print</button>
      </div>
      {flagged.length > 0 && (
        <div className="presc-msg error" role="alert">
          <span>⚠️ Please check before sending — {flagged.map(m => `${m.name}: ${allergyMatches(m.name, allergies).join("; ")}`).join(" · ")}.</span>
        </div>
      )}
      <div className="presc-fade" style={{ marginBottom:16 }}><LetterheadCard data={previewData} /></div>
      {saveProblem && <div className="presc-msg error" role="alert">⚠️ {saveProblem}</div>}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        <button type="button" onClick={()=>setShowPreview(false)} disabled={confirming} style={{ flex:"1 1 180px", padding:"11px 0", borderRadius:10, background:"#fff", color:"#1d4ed8", border:"1.5px solid #bfdbfe", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:600, cursor:"pointer" }}>✏️ Edit Prescription</button>
        <button type="button" onClick={handleConfirm} disabled={confirming} style={{ flex:"2 1 260px", padding:"11px 0", borderRadius:10, background:"linear-gradient(135deg,#0d6e4a,#10b981)", color:"#fff", border:"none", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 14px rgba(13,110,74,0.3)", opacity:confirming?0.6:1 }}>
          {confirming?"Sending…":"✅ Confirm & Send to Reception"}
        </button>
      </div>
    </div>
  );

  /* ── BUILDER STATE ── */
  return (
    <div className="presc-root" style={S.root}>
      <div style={S.header}>
        <span style={S.headerIcon}>💊</span>
        <div><div style={S.headerTitle}>Prescription</div><div style={S.headerSub}>Fill details, add medicines, then preview</div></div>
      </div>

      {thisVisitRx.length > 0 && (
        <div className="presc-msg info" role="status">
          <span>
            ℹ️ This visit already has {thisVisitRx.length === 1 ? "a prescription" : `${thisVisitRx.length} prescriptions`} (saved {fmtDate(thisVisitRx[0].date)}).
            To change it, edit it — writing a new one adds another.
          </span>
          <button type="button" onClick={()=>setEditRequest({ id: thisVisitRx[0].id, n: Date.now() })}>✏️ Edit that prescription</button>
        </div>
      )}

      {/* ── Patient Details ── */}
      <div style={S.card}>
        <div style={S.cardTitle}>🧑 Patient Details</div>
        <div className="presc-grid3">
          <div><label style={S.label}>Name</label><input style={S.input} value={patientName} onChange={e=>setPatientName(e.target.value)} placeholder="Patient name" aria-label="Patient name" /></div>
          <div><label style={S.label}>Age</label><input style={S.input} value={patientAge} onChange={e=>setPatientAge(e.target.value)} placeholder="e.g. 32" type="number" min={0} aria-label="Age" /></div>
          <div>
            <label style={S.label}>Gender</label>
            <select style={{...S.input, cursor:"pointer"}} value={patientGender} onChange={e=>setPatientGender(e.target.value)} aria-label="Gender">
              <option value="">— Select —</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
              {patientGender && !["Male","Female","Other"].includes(patientGender) && <option value={patientGender}>{patientGender}</option>}
            </select>
          </div>
        </div>
        {/* Case number shown as read-only info above date */}
        {caseNumber && <div style={{ marginTop:8, fontSize:12, color:"#475569" }}>
          <span style={{ fontSize:9.5, fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", color:"#888", marginRight:6 }}>Case No.:</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#111" }}>{caseNumber}</span>
        </div>}
        {/* Date — default today */}
        <div style={{ marginTop:10 }}>
          <label style={S.label}>Date</label>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <button type="button"
              onClick={()=>setDate(todayStr())}
              style={{ padding:"6px 12px", borderRadius:7, fontSize:12, fontWeight:700, border:date===todayStr()?"1.5px solid #16a34a":"1.5px solid #e2e8f0", background:date===todayStr()?"#dcfce7":"#f8fafc", color:date===todayStr()?"#15803d":"#64748b", cursor:"pointer", fontFamily:"'DM Mono',monospace" }}
            >
              📅 Today ({fmtDate(todayStr())})
            </button>
            <input type="date" value={date!==todayStr()?date:""} onChange={e=>setDate(e.target.value || todayStr())} aria-label="Prescription date" style={{ ...S.input, width:160, fontFamily:"'DM Mono',monospace", border:date!==todayStr()?"1.5px solid #3b82f6":"1.5px solid #e2e8f0" }} />
          </div>
        </div>
      </div>

      {/* ── Clinical Notes ── */}
      <div style={S.card}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          <div style={{ ...S.cardTitle, marginBottom:0 }}>📋 Clinical Notes</div>
          <span style={{ fontSize:10.5, background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0", borderRadius:5, padding:"1px 8px", fontWeight:700 }}>Auto-filled from Consultation</span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div><label style={S.label}>Diagnosis</label><textarea style={{ ...S.input, minHeight:60, resize:"vertical" }} value={diagnosis} onChange={e=>setDiagnosis(e.target.value)} placeholder="Auto-filled from consultation…" aria-label="Diagnosis" /></div>
          <div><label style={S.label}>Advice &amp; Treatment Plan</label><textarea style={{ ...S.input, minHeight:56, resize:"vertical" }} value={advice} onChange={e=>setAdvice(e.target.value)} placeholder="Auto-filled from consultation…" aria-label="Advice and treatment plan" /></div>
          <div><label style={S.label}>Treatment Done Today {treatmentDone && consultationData && <span style={{ fontWeight:700, textTransform:"none", letterSpacing:0, color:"#16a34a", fontSize:10 }}>✓ from consultation</span>}</label><textarea style={{ ...S.input, minHeight:56, resize:"vertical", borderColor: treatmentDone && consultationData ? "#86efac" : undefined, background: treatmentDone && consultationData ? "#f0fdf4" : undefined }} value={treatmentDone} onChange={e=>setTreatmentDone(e.target.value)} placeholder="Auto-filled from consultation or enter manually…" aria-label="Treatment done today" /></div>
        </div>
      </div>

      {/* ── Medicines ── */}
      <div style={S.card}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          <div style={{ ...S.cardTitle, marginBottom:0 }}>🧾 Prescribe Medicines &amp; Investigations</div>
          {cleanMeds.length > 0 && <span style={{ fontSize:11, fontWeight:700, background:"#eff6ff", color:"#1d4ed8", border:"1px solid #bfdbfe", borderRadius:20, padding:"1px 9px" }}>{cleanMeds.length} added</span>}
        </div>
        <AllergyBanner allergies={allergies} noneKnown={noneKnown} health={health} />
        {copiedNote && <div className="presc-msg ok" role="status">{copiedNote}<button type="button" onClick={()=>setCopiedNote("")}>OK</button></div>}
        <MedicineEditor medicines={medicines} onChange={list => { setMedicines(list); setCopiedNote(""); }} allergies={allergies} />
        {unnamed > 0 && <div style={{ fontSize:12, color:"#b45309", marginTop:8 }}>A medicine without a name will be left out.</div>}

        {/* Investigations advised — part of the same prescription, right under the medicines */}
        <div style={{ marginTop:16, paddingTop:14, borderTop:"1.5px dashed #e2e8f0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" }}>
            <div style={{ ...S.cardTitle, marginBottom:0 }}>🔬 Investigations Advised</div>
            {investigations.length > 0
              ? <span style={{ fontSize:11, fontWeight:700, background:"#f5f3ff", color:"#6d28d9", border:"1px solid #ddd6fe", borderRadius:20, padding:"1px 9px" }}>{investigations.length} advised</span>
              : <span style={{ fontSize:11.5, color:"#94a3b8" }}>optional — tap a test to add it, then write a note</span>}
          </div>
          <InvestigationsEditor value={investigations} onChange={setInvestigations} />
        </div>
      </div>

      {/* ── Follow-up (date + time) ── */}
      <div style={S.card}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          <div style={{ ...S.cardTitle, marginBottom:0 }}>📅 Next Follow-up</div>
          {(followUpDate || followUpTime) && consultationData && <span style={{ fontSize:10.5, background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0", borderRadius:5, padding:"1px 8px", fontWeight:700 }}>Auto-filled from Consultation</span>}
        </div>
        <div className="presc-grid2">
          <div>
            <label style={S.label}>Follow-up Date</label>
            <input type="date" value={followUpDate} onChange={e=>setFollowUpDate(e.target.value)} aria-label="Follow-up date" style={{ ...S.input, fontFamily:"'DM Mono',monospace" }} />
          </div>
          <div>
            <label style={S.label}>
              Follow-up Time&nbsp;
              {followUpTime && consultationData
                ? <span style={{ fontWeight:700, textTransform:"none", letterSpacing:0, color:"#16a34a", fontSize:10 }}>✓ from consultation</span>
                : <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, color:"#94a3b8" }}>(enter manually)</span>
              }
            </label>
            <input type="time" value={followUpTime} onChange={e=>setFollowUpTime(e.target.value)} aria-label="Follow-up time" style={{ ...S.input, fontFamily:"'DM Mono',monospace", borderColor: followUpTime && consultationData ? "#86efac" : undefined, background: followUpTime && consultationData ? "#f0fdf4" : undefined }} />
          </div>
        </div>
        {followUpDate && (
          <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:12.5, color:"#16a34a", fontWeight:700, background:"#f0fdf4", border:"1px solid #86efac", borderRadius:7, padding:"5px 12px" }}>
              📅 {fmtDate(followUpDate)}{followUpTime ? ` at ${fmtTime(followUpTime)}` : ""}
            </span>
            <button type="button" onClick={()=>{setFollowUpDate("");setFollowUpTime("");}} style={{ fontSize:11.5, color:"#64748b", background:"none", border:"none", cursor:"pointer" }}>✕ Clear</button>
          </div>
        )}
      </div>

      {/* ── Preview button ── */}
      <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:12, flexWrap:"wrap", marginTop:4 }}>
        {whyNot && <span style={{ fontSize:12, color:"#64748b" }}>{whyNot}</span>}
        <button type="button"
          onClick={()=>{ setSaveProblem(""); setShowPreview(true); }}
          disabled={!canPreview}
          style={{ padding:"12px 32px", borderRadius:10, background:canPreview?"linear-gradient(135deg,#1d4d7a,#1d6fa4)":"#e2e8f0", color:canPreview?"#fff":"#94a3b8", border:"none", fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:700, cursor:canPreview?"pointer":"not-allowed", boxShadow:canPreview?"0 4px 14px rgba(29,77,122,0.28)":"none", transition:"all 0.15s" }}
        >
          👁 Preview Prescription →
        </button>
      </div>

      {/* ── Past Prescriptions section (the heading is inside the list itself) ── */}
      <div style={{ marginTop:24, paddingTop:16, borderTop:"2px dashed #e0e7ff" }}>
        {pastList}
      </div>
    </div>
  );
}

/* ─── Styles ────────────────────────────────────────────────── */
const styles = {
  root:        { background:"#f8fafc", borderRadius:16, padding:20, border:"1px solid #e2e8f0", boxShadow:"0 1px 4px rgba(0,0,0,0.05)" },
  header:      { display:"flex", alignItems:"center", gap:12, marginBottom:18, paddingBottom:14, borderBottom:"1px solid #e9eef4" },
  headerIcon:  { width:38, height:38, borderRadius:10, fontSize:18, background:"linear-gradient(135deg,#dbeafe,#bfdbfe)", display:"flex", alignItems:"center", justifyContent:"center" },
  headerTitle: { fontSize:15, fontWeight:700, color:"#1e293b" },
  headerSub:   { fontSize:12, color:"#94a3b8" },
  card:        { background:"#fff", borderRadius:12, padding:"14px 16px", border:"1.5px solid #e9eef4", marginBottom:12 },
  cardTitle:   { fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:10 },
  label:       { fontSize:10.5, fontWeight:700, color:"#8899bb", letterSpacing:"0.7px", textTransform:"uppercase", marginBottom:5, display:"block" },
  input:       { width:"100%", padding:"8px 11px", border:"1.5px solid #e2e8f0", borderRadius:8, fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, color:"#1e293b", background:"#f8fafc", outline:"none", boxSizing:"border-box", transition:"border-color 0.15s" },
};