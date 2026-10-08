import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/*
  <OtherExpenses />  — everything the clinic pays out that is not a patient bill
  ────────────────────────────────────────────────────────────────
    • List      – this month / last month / this financial year / any dates,
                  category filter and search; total, count and a by-category
                  breakdown for what is shown; add, view, edit, delete
    • Add/Edit  – date, category, paid to (Doctor / Company / Person) and name
                  (names used before are suggested), amount, paid by
                  (Cash, UPI, Card, Cheque, Bank transfer) and a description
    • Summary   – a financial year month by month and by category; each
                  month's Excel sheet; "Save Excel files again"
    • Excel files – like Billing's Receipt Files: choose the financial year
                  and month; the saved Excel sheet shown as a table (both
                  sheets), and downloaded
    • Deleted   – the deletion log: every deleted expense with the reason,
                  who deleted it and when

  Server side: other_expenses.py (routes folder). Files go into the same
  Financial-year folders as the receipts:
     receipts/Financial year 2026-2027/Oct2026/other expenses/Other Exp Oct2026.xlsx

  Used by ReceptionDashboard.jsx:  <OtherExpenses onBack={…} startAdding={bool} />
*/

const FALLBACK_CATEGORIES = ["Doctor fee", "Lab charges", "Dental materials", "Medicines", "Salary", "Rent", "Electricity",
  "Water", "Internet / Phone", "Maintenance / Repairs", "Equipment", "Cleaning / Housekeeping", "Stationery / Printing",
  "Transport", "Tea / Snacks", "Marketing", "Other"];
const QUICK_CATEGORIES = ["Doctor fee", "Lab charges", "Dental materials", "Salary", "Rent", "Electricity", "Maintenance / Repairs", "Other"];
const METHODS = ["Cash", "UPI", "Card", "Cheque", "Bank transfer"];
const PAID_TO = [["Dr", "🩺 Doctor"], ["Company", "🏢 Company"], ["Other", "👤 Person"]];
const CAT_ICON = {
  "Doctor fee": "🩺", "Lab charges": "🧪", "Dental materials": "🦷", "Medicines": "💊", "Salary": "👥", "Rent": "🏠",
  "Electricity": "⚡", "Water": "💧", "Internet / Phone": "📶", "Maintenance / Repairs": "🔧", "Equipment": "🛠",
  "Cleaning / Housekeeping": "🧹", "Stationery / Printing": "🖨", "Transport": "🚗", "Tea / Snacks": "☕", "Marketing": "📣", "Other": "📦",
};
const CAT_COLOR = ["#b45309", "#0f766e", "#1d4ed8", "#7c3aed", "#be185d", "#15803d", "#c2410c", "#0369a1", "#4d7c0f", "#9333ea"];
const DELETE_REASONS = ["Entered by mistake", "Entered twice", "Wrong amount", "Wrong date / month", "Payment cancelled"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── helpers ── */
const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr0 = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
function fmtDate(d) {
  if (!d) return "—";
  const p = String(d).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]} ${MONTHS[Number(p[1]) - 1] || p[1]} ${p[0]}` : d;
}
const fyOf = (d = new Date()) => { const s = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${s}-${s + 1}`; };
function periodRange(mode, custom) {
  const now = new Date();
  if (mode === "month") return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (mode === "last") return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (mode === "fy") { const s = Number(fyOf(now).slice(0, 4)); return [`${s}-04-01`, `${s + 1}-03-31`]; }
  if (mode === "custom") return [custom.from || "", custom.to || ""];
  return ["", ""];
}
function errorText(err, fallback) {
  const status = err?.response?.status;
  if (status === 404 && !err?.response?.data?.error) return "Other Expenses needs the new other_expenses.py on the server. Copy it into the backend's routes folder and restart the backend.";
  if (status === 401) return "Your login has ended. Please log in again.";
  return err?.response?.data?.error || fallback;
}
async function blobError(err, fallback) {
  const data = err?.response?.data;
  if (data && typeof data.text === "function") {
    try { const j = JSON.parse(await data.text()); if (j?.error) return j.error; } catch { /* not a message */ }
  }
  return errorText(err, fallback);
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const typeLabel = (t) => (t === "Dr" ? "Doctor" : t === "Company" ? "Company" : "Person");
const catColor = (name, list) => CAT_COLOR[Math.max(0, list.indexOf(name)) % CAT_COLOR.length];

function Styles() {
  return (
    <style>{`
      .ox { font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; color: #1e293b; }
      .ox-card { background: #fff; border-radius: 16px; border: 1px solid rgba(226,232,244,0.9); overflow: hidden;
        box-shadow: 0 2px 8px rgba(29,77,122,0.05), 0 8px 24px rgba(29,77,122,0.07); margin-bottom: 20px; }
      .ox-head { background: linear-gradient(120deg, #7c2d12, #b45309 55%, #d97706); color: #fff; padding: 18px 24px;
        display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
      .ox-head h2 { margin: 0; font-size: 18px; font-weight: 800; }
      .ox-head p { margin: 2px 0 0; font-size: 12.5px; opacity: .9; }
      .ox-body { padding: 18px 24px 24px; }
      .ox-btn { font-family: inherit; font-size: 13px; font-weight: 700; border-radius: 9px; padding: 8px 15px; cursor: pointer; line-height: 1.2;
        border: 1.5px solid transparent; display: inline-flex; align-items: center; gap: 6px; transition: background .15s, opacity .15s; }
      .ox-btn:disabled { opacity: .5; cursor: not-allowed; }
      .ox-main { background: #b45309; color: #fff; border-color: #b45309; } .ox-main:hover:not(:disabled) { background: #92400e; }
      .ox-white { background: #fff; color: #92400e; }
      .ox-ghost { background: rgba(255,255,255,0.15); color: #fff; border-color: rgba(255,255,255,0.45); }
      .ox-ghost[aria-pressed="true"] { background: #fff; color: #92400e; }
      .ox-plain { background: #f8fafc; color: #334155; border-color: #e2e8f0; } .ox-plain:hover:not(:disabled) { background: #eef2f7; }
      .ox-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
      .ox-sm { font-size: 12px; padding: 5px 10px; border-radius: 7px; }
      .ox-view { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
      .ox-edit { background: #fde68a; color: #713f12; }
      .ox-del { background: #fecaca; color: #991b1b; }
      .ox-input { font-family: inherit; font-size: 14px; color: #1e293b; background: #fff; border: 1.5px solid #cbd5e1; border-radius: 9px;
        padding: 9px 12px; width: 100%; box-sizing: border-box; outline: none; }
      .ox-input:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,0.18); }
      .ox-label { display: block; font-size: 12.5px; font-weight: 700; color: #334155; margin-bottom: 5px; }
      .ox-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .ox-chip { font-family: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 12px; border-radius: 20px; cursor: pointer;
        background: #f8fafc; color: #334155; border: 1.5px solid #e2e8f0; }
      .ox-chip[aria-pressed="true"] { background: #b45309; color: #fff; border-color: #b45309; }
      .ox-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
      .ox-tile { border-radius: 12px; padding: 12px 14px; background: #fffbeb; border: 1px solid #fde68a; }
      .ox-tile-l { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #92400e; }
      .ox-tile-v { font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ox-tile-s { font-size: 12px; color: #78716c; margin-top: 1px; }
      .ox-bars { display: grid; gap: 7px; }
      .ox-bar { display: grid; grid-template-columns: minmax(120px, 190px) minmax(0, 1fr) 110px; gap: 10px; align-items: center; font-size: 13px; }
      .ox-bar-track { height: 12px; background: #f1f5f9; border-radius: 6px; overflow: hidden; }
      .ox-bar-fill { height: 100%; border-radius: 6px; }
      .ox-bar button { background: none; border: 0; padding: 0; font: inherit; text-align: left; cursor: pointer; color: #1e293b; font-weight: 700;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ox-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; }
      .ox-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 820px; }
      .ox-table th { background: #fff7ed; color: #7c2d12; font-weight: 800; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em;
        padding: 10px 12px; text-align: left; border-bottom: 1px solid #fed7aa; white-space: nowrap; }
      .ox-table td { padding: 10px 12px; border-top: 1px solid #f1f5f9; vertical-align: middle; }
      .ox-table tbody tr:hover { background: #fffbf5; }
      .ox-table tfoot td { font-weight: 800; background: #fff7ed; border-top: 2px solid #fed7aa; }
      .ox-cat { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
      .ox-note { border-radius: 10px; padding: 10px 14px; font-size: 13.5px; font-weight: 600; margin-bottom: 14px;
        display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
      .ox-ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
      .ox-bad { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
      .ox-warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
      .ox-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(15,23,42,0.6); display: flex; align-items: flex-start; justify-content: center;
        padding: 24px 12px; overflow-y: auto; }
      .ox-sheet { background: #fff; border-radius: 16px; width: min(680px, 100%); box-shadow: 0 25px 60px rgba(0,0,0,0.35); overflow: hidden;
        font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif; color: #1e293b; }
      .ox-sheet-head { background: linear-gradient(120deg, #7c2d12, #b45309); color: #fff; padding: 16px 22px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .ox-sheet-head h3 { margin: 0; font-size: 17px; font-weight: 800; }
      .ox-sheet-body { padding: 18px 22px 22px; display: grid; gap: 15px; }
      .ox-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .ox-seg { display: inline-flex; border: 1.5px solid #e2e8f0; border-radius: 10px; overflow: hidden; flex-wrap: wrap; }
      .ox-seg button { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border: 0; background: #fff; cursor: pointer; color: #334155; }
      .ox-seg button[aria-pressed="true"] { background: #b45309; color: #fff; }
      .ox-big { font-size: 26px; font-weight: 800; color: #92400e; }
      .ox-months { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px; align-items: end; height: 170px; padding: 6px 2px 0; }
      .ox-month { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%; cursor: pointer;
        background: none; border: 0; font: inherit; padding: 0; }
      .ox-month-bar { width: 70%; min-height: 3px; border-radius: 6px 6px 2px 2px; background: linear-gradient(180deg, #f59e0b, #b45309); }
      .ox-month[aria-current="true"] .ox-month-bar { background: linear-gradient(180deg, #0f766e, #134e4a); }
      .ox-month small { font-size: 11px; color: #64748b; font-weight: 700; }
      .ox-month b { font-size: 10.5px; color: #334155; white-space: nowrap; }
      .ox-cards { display: none; }
      @media (max-width: 760px) {
        .ox-head { padding: 16px; } .ox-body { padding: 14px 16px 18px; }
        .ox-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ox-tile-v { font-size: 17px; }
        .ox-grid2 { grid-template-columns: minmax(0, 1fr); }
        .ox-bar { grid-template-columns: minmax(90px, 120px) minmax(0, 1fr) 84px; font-size: 12px; }
        .ox-table-wrap.ox-has-cards { display: none; }
        .ox-search { flex-wrap: wrap; }
        .ox-search select { max-width: none !important; width: 100% !important; flex: 1 1 100%; }
        .ox-search input { flex: 1 1 0; min-width: 0; }
        .ox-cards { display: grid; gap: 8px; }
        .ox-months b { display: none; }
        .ox-sheet-body { padding: 14px; }
      }
      .ox-mcard { border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; background: #fff; display: grid; gap: 6px; }
    `}</style>
  );
}

function CatPill({ name, list }) {
  const color = catColor(name, list);
  return <span className="ox-cat" style={{ background: `${color}14`, color, border: `1px solid ${color}33` }}>{CAT_ICON[name] || "📦"} {name}</span>;
}

/* ══════════════════════════════════════════════════════════════════
   Add / Edit
══════════════════════════════════════════════════════════════════ */
function ExpenseForm({ expense, meta, onClose, onSaved }) {
  const editing = Boolean(expense?.id);
  const categories = meta?.categories?.length ? meta.categories : FALLBACK_CATEGORIES;
  const parties = meta?.parties || [];
  const [date, setDate] = useState(expense?.date || meta?.today || todayIso());
  const [category, setCategory] = useState(expense?.category || "");
  const [customCat, setCustomCat] = useState(expense?.category && !categories.includes(expense.category) ? expense.category : "");
  const [type, setType] = useState(expense?.type || "Company");
  const [name, setName] = useState(expense?.party_name || "");
  const [amount, setAmount] = useState(expense?.amount != null ? String(expense.amount) : "");
  const [method, setMethod] = useState(expense?.payment_method || "Cash");
  const [description, setDescription] = useState(expense?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isCustom = category === "__custom__";
  const finalCategory = isCustom ? customCat.trim() : category;
  const amountN = parseFloat(String(amount).replace(/,/g, ""));
  const problem = !date ? "Please enter the date."
    : !finalCategory ? "Please choose the category."
    : !name.trim() ? "Please enter whom it was paid to."
    : !(amountN > 0) ? "Please enter the amount (more than ₹0)."
    : "";

  // A name used before brings its category and Doctor/Company/Person with it.
  const chooseName = (value) => {
    setName(value);
    const known = parties.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
    if (known && !editing) {
      if (known.type) setType(known.type);
      if (known.category && !category) setCategory(categories.includes(known.category) ? known.category : "__custom__");
      if (known.category && !categories.includes(known.category)) setCustomCat(known.category);
    }
  };

  const save = async () => {
    if (saving) return;
    if (problem) { setError(problem); return; }
    setSaving(true); setError("");
    const body = { date, category: finalCategory, type, party_name: name.trim(), amount: Math.round(amountN * 100) / 100,
      payment_method: method, description: description.trim() };
    let saved;
    try {
      const res = editing ? await api.put(`/other-expenses/${expense.id}`, body) : await api.post("/other-expenses", body);
      saved = res.data;
    } catch (err) {
      setError(errorText(err, "Not saved — please check the connection and try again."));
      setSaving(false);
      return;
    }
    const warnings = [...(saved.files?.problems || [])];
    onSaved(saved, editing, warnings);
  };

  const quick = QUICK_CATEGORIES.filter((c) => categories.includes(c));
  return createPortal(
    <div className="ox-overlay" role="dialog" aria-modal="true" aria-label={editing ? "Edit expense" : "Add expense"}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !saving) onClose(); }}>
      <div className="ox-sheet">
        <Styles />
        <div className="ox-sheet-head">
          <div>
            <h3>{editing ? "✏️ Edit expense" : "💸 Add expense"}</h3>
            <div style={{ fontSize: 12, opacity: .85 }}>{editing ? `Saved ${fmtDate(expense.date)}${expense.created_by ? ` by ${expense.created_by}` : ""}` : "Money paid out by the clinic"}</div>
          </div>
          <button type="button" className="ox-btn ox-ghost ox-sm" onClick={onClose} disabled={saving}>✕ Close</button>
        </div>
        <div className="ox-sheet-body">
          {error && <div className="ox-note ox-bad" role="alert" style={{ margin: 0 }}><span>⚠️ {error}</span></div>}

          <div className="ox-grid2">
            <div>
              <label className="ox-label" htmlFor="ox-date">Date</label>
              <input id="ox-date" type="date" className="ox-input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="ox-label" htmlFor="ox-amount">Amount (₹)</label>
              <input id="ox-amount" className="ox-input" type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 2500"
                value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontSize: 18, fontWeight: 800 }} autoFocus={!editing} />
            </div>
          </div>

          <div>
            <span className="ox-label">Category</span>
            <div className="ox-chips" role="group" aria-label="Common categories" style={{ marginBottom: 8 }}>
              {quick.map((c) => (
                <button key={c} type="button" className="ox-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{CAT_ICON[c]} {c}</button>
              ))}
            </div>
            <select className="ox-input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— choose the category —</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">+ Another category…</option>
            </select>
            {isCustom && <input className="ox-input" style={{ marginTop: 6 }} aria-label="New category" maxLength={60} placeholder="Type the category"
              value={customCat} onChange={(e) => setCustomCat(e.target.value)} />}
          </div>

          <div>
            <span className="ox-label">Paid to</span>
            <div className="ox-seg" role="group" aria-label="Paid to" style={{ marginBottom: 8 }}>
              {PAID_TO.map(([v, l]) => <button key={v} type="button" aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>)}
            </div>
            <input className="ox-input" aria-label="Name" list="ox-parties" maxLength={200} value={name} onChange={(e) => chooseName(e.target.value)}
              placeholder={type === "Dr" ? "e.g. Dr. Ramesh Kumar" : type === "Company" ? "e.g. Sri Dental Supplies" : "e.g. Electrician Ravi"} />
            <datalist id="ox-parties">{parties.map((p) => <option key={p.name} value={p.name}>{p.category}</option>)}</datalist>
          </div>

          <div>
            <span className="ox-label">Paid by</span>
            <div className="ox-chips" role="group" aria-label="Paid by">
              {METHODS.map((m) => <button key={m} type="button" className="ox-chip" aria-pressed={method === m} onClick={() => setMethod(m)}>{m}</button>)}
            </div>
          </div>

          <div>
            <label className="ox-label" htmlFor="ox-desc">Description <span style={{ fontWeight: 500, color: "#94a3b8" }}>(optional)</span></label>
            <textarea id="ox-desc" className="ox-input" rows={2} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Composite kit ×2, invoice no. 4521" style={{ resize: "vertical" }} />
          </div>

          {!problem && (
            <div className="ox-note ox-warn" style={{ margin: 0, display: "block", fontWeight: 500 }}>
              <strong>{inr(amountN)}</strong> to <strong>{type === "Dr" && !/^dr\.?\s/i.test(name.trim()) ? "Dr. " : ""}{name.trim()}</strong> · {finalCategory} · {method} · {fmtDate(date)}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="ox-btn ox-main" style={{ fontSize: 15, padding: "11px 22px" }} disabled={saving} onClick={save}>
              {saving ? "Saving…" : editing ? "💾 Save changes" : "💾 Save expense"}
            </button>
            <button type="button" className="ox-btn ox-plain" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ExpenseView({ expense, categories, onClose, onEdit, onDelete }) {
  const row = (label, value) => (
    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 10, fontSize: 14, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
      <span style={{ color: "#92400e", fontWeight: 700 }}>{label}</span><span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{value || "—"}</span>
    </div>
  );
  return createPortal(
    <div className="ox-overlay" role="dialog" aria-modal="true" aria-label="Expense"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="ox-sheet">
        <Styles />
        <div className="ox-sheet-head">
          <div><h3>{CAT_ICON[expense.category] || "💸"} {expense.party_name}</h3><div style={{ fontSize: 12, opacity: .85 }}>{fmtDate(expense.date)}</div></div>
          <button type="button" className="ox-btn ox-ghost ox-sm" onClick={onClose} autoFocus>✕ Close</button>
        </div>
        <div className="ox-sheet-body">
          <div className="ox-big">{inr(expense.amount)}</div>
          <div>
            {row("Category", <CatPill name={expense.category} list={categories} />)}
            {row("Paid to", `${typeLabel(expense.type)} — ${expense.party_name}`)}
            {row("Paid by", expense.payment_method)}
            {row("Description", expense.description)}
            {row("Saved", [expense.created_at && fmtDate(expense.created_at), expense.created_by && `by ${expense.created_by}`].filter(Boolean).join(" "))}
            {expense.updated_by && row("Last changed", `${fmtDate(expense.updated_at)} by ${expense.updated_by}`)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="ox-btn ox-edit" onClick={onEdit}>✏️ Edit</button>
            <button type="button" className="ox-btn ox-del" onClick={onDelete}>🗑 Delete</button>
            <button type="button" className="ox-btn ox-plain" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DeleteDialog({ expense, onCancel, onDeleted }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = reason.trim().length >= 3;
  const go = async () => {
    if (busy || !ready) return;
    setBusy(true); setError("");
    try {
      const res = await api.delete(`/other-expenses/${expense.id}`, { data: { reason: reason.trim() }, params: { reason: reason.trim() } });
      onDeleted(res.data || {}, reason.trim());
    } catch (err) {
      setError(errorText(err, "Not deleted — please check the connection and try again."));
      setBusy(false);
    }
  };
  return createPortal(
    <div className="ox-overlay" role="dialog" aria-modal="true" aria-label="Delete expense" style={{ alignItems: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel(); }}>
      <div className="ox-sheet" style={{ width: "min(500px, 100%)" }}>
        <Styles />
        <div className="ox-sheet-body">
          <div style={{ fontSize: 17, fontWeight: 800 }}>🗑 Delete this expense?</div>
          <div style={{ fontSize: 14, color: "#334155" }}>{fmtDate(expense.date)} — {expense.party_name}, <strong>{inr(expense.amount)}</strong> ({expense.category}).</div>
          <div>
            <label className="ox-label" htmlFor="ox-del-reason">Why is it being deleted? <span style={{ color: "#b91c1c" }}>*</span></label>
            <div className="ox-chips" style={{ marginBottom: 8 }}>
              {DELETE_REASONS.map((r) => <button key={r} type="button" className="ox-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
            </div>
            <textarea id="ox-del-reason" className="ox-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose above or type the reason…" />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>A full copy, this reason, your name and the time are kept in <strong>Deleted expenses</strong>.</div>
          </div>
          {error && <div className="ox-note ox-bad" role="alert" style={{ margin: 0 }}><span>⚠️ {error}</span></div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="ox-btn ox-plain" disabled={busy} onClick={onCancel}>Cancel</button>
            <button type="button" className="ox-btn ox-danger" disabled={busy || !ready} onClick={go}>{busy ? "Deleting…" : "Delete expense"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════
   Summary: a financial year month by month and by category
══════════════════════════════════════════════════════════════════ */
function Summary({ meta, onOpenMonth }) {
  const [fy, setFy] = useState(fyOf());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState("");
  const categories = meta?.categories || FALLBACK_CATEGORIES;

  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    api.get("/other-expenses/summary", { params: { fy } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(errorText(err, "The summary could not be loaded.")); });
    return () => { cancelled = true; };
  }, [fy]);

  const nowValue = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`;
  const max = data ? Math.max(1, ...data.months.map((m) => m.total)) : 1;
  const catMax = data?.categories?.length ? data.categories[0].total : 1;
  const used = data ? data.months.filter((m) => m.count > 0) : [];
  const average = used.length ? data.total / used.length : 0;

  const download = async (m) => {
    setBusy(m.value); setNote(null);
    try {
      const res = await api.get("/other-expenses/excel", { params: { month: m.value }, responseType: "blob" });
      saveBlob(res.data, `Other Exp ${m.label.replace(" ", "")}.xlsx`);
    } catch (err) { setNote({ ok: false, text: await blobError(err, "The Excel sheet could not be made.") }); }
    finally { setBusy(""); }
  };
  const regenerate = async () => {
    setBusy("all"); setNote(null);
    try {
      const res = await api.post("/other-expenses/files/regenerate", { fy });
      const r = res.data;
      setNote(r.problems?.length ? { ok: false, text: r.problems.join(" ") } : { ok: true, text: `${r.written.length} monthly Excel sheet${r.written.length !== 1 ? "s" : ""} saved again for ${fy}.` });
    } catch (err) { setNote({ ok: false, text: errorText(err, "The files could not be saved.") }); }
    finally { setBusy(""); }
  };

  return (
    <div data-testid="ox-summary">
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div>
          <label className="ox-label" htmlFor="ox-fy">Financial year</label>
          <select id="ox-fy" className="ox-input" style={{ width: "auto" }} value={fy} onChange={(e) => setFy(e.target.value)}>
            {(data?.years || [fy]).map((y) => <option key={y} value={y}>{y} (Apr–Mar)</option>)}
          </select>
        </div>
        <button type="button" className="ox-btn ox-plain" disabled={busy === "all"} onClick={regenerate}>{busy === "all" ? "Saving…" : "💾 Save Excel files again"}</button>
      </div>
      {note && <div className={`ox-note ${note.ok ? "ox-ok" : "ox-bad"}`} role={note.ok ? "status" : "alert"} style={{ marginTop: 12 }}><span>{note.ok ? "✓" : "⚠️"} {note.text}</span></div>}
      {error && <div className="ox-note ox-bad" role="alert" style={{ marginTop: 12 }}><span>⚠️ {error}</span></div>}
      {!data && !error && <div style={{ padding: 20, color: "#94a3b8" }}>Loading…</div>}
      {data && (
        <>
          <div className="ox-tiles">
            <div className="ox-tile"><div className="ox-tile-l">Spent in {data.fy}</div><div className="ox-tile-v" data-testid="fy-total">{inr0(data.total)}</div><div className="ox-tile-s">{data.count} expense{data.count !== 1 ? "s" : ""}</div></div>
            <div className="ox-tile"><div className="ox-tile-l">Monthly average</div><div className="ox-tile-v">{inr0(average)}</div><div className="ox-tile-s">over {used.length} month{used.length !== 1 ? "s" : ""}</div></div>
            <div className="ox-tile"><div className="ox-tile-l">Biggest category</div><div className="ox-tile-v">{data.categories[0]?.name || "—"}</div><div className="ox-tile-s">{data.categories[0] ? inr0(data.categories[0].total) : ""}</div></div>
            <div className="ox-tile"><div className="ox-tile-l">Highest month</div><div className="ox-tile-v">{used.length ? inr0(Math.max(...used.map((m) => m.total))) : "—"}</div><div className="ox-tile-s">{used.length ? [...used].sort((x, y) => y.total - x.total)[0].label : ""}</div></div>
          </div>

          <div className="ox-label" style={{ marginTop: 6 }}>Month by month <span style={{ fontWeight: 500, color: "#94a3b8" }}>(click a month to see its expenses)</span></div>
          <div className="ox-months" role="list" aria-label="Months">
            {data.months.map((m) => (
              <button key={m.value} type="button" role="listitem" className="ox-month" aria-current={m.value === nowValue} onClick={() => onOpenMonth(m.value)}
                title={`${m.label}: ${inr(m.total)} · ${m.count} expense${m.count !== 1 ? "s" : ""}`}>
                <b>{m.total ? inr0(m.total) : ""}</b>
                <div className="ox-month-bar" style={{ height: `${Math.max(2, (m.total / max) * 120)}px`, opacity: m.total ? 1 : 0.25 }} />
                <small>{m.label.slice(0, 3)}</small>
              </button>
            ))}
          </div>

          <div className="ox-label" style={{ marginTop: 18 }}>By category</div>
          {data.categories.length === 0 ? <div style={{ fontSize: 13, color: "#94a3b8" }}>No expenses in this year yet.</div> : (
            <div className="ox-bars">
              {data.categories.map((c) => (
                <div className="ox-bar" key={c.name}>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{CAT_ICON[c.name] || "📦"} {c.name}</span>
                  <div className="ox-bar-track"><div className="ox-bar-fill" style={{ width: `${(c.total / catMax) * 100}%`, background: catColor(c.name, categories) }} /></div>
                  <span style={{ textAlign: "right", fontWeight: 700 }}>{inr0(c.total)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="ox-label" style={{ marginTop: 18 }}>Monthly Excel sheets</div>
          <div className="ox-table-wrap">
            <table className="ox-table" style={{ minWidth: 520 }}>
              <thead><tr><th>Month</th><th>Expenses</th><th style={{ textAlign: "right" }}>Total</th><th>Excel</th></tr></thead>
              <tbody>
                {used.length === 0 ? <tr><td colSpan={4} style={{ color: "#94a3b8" }}>Nothing yet.</td></tr> : used.map((m) => (
                  <tr key={m.value}>
                    <td><button type="button" className="ox-btn ox-plain ox-sm" onClick={() => onOpenMonth(m.value)}>{m.label}</button></td>
                    <td>{m.count}</td>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{inr(m.total)}</td>
                    <td><button type="button" className="ox-btn ox-view ox-sm" disabled={busy === m.value} onClick={() => download(m)}>{busy === m.value ? "…" : `⬇ Other Exp ${m.label.replace(" ", "")}.xlsx`}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta?.files && (
            <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 10, lineHeight: 1.6, overflowWrap: "anywhere" }}>
              {meta.files.enabled
                ? <>📁 Each month's Excel sheet is saved by itself {meta.files.where?.startsWith("object") ? "in " : "on the server in "}<code>{meta.files.where}</code> — e.g. <code>{meta.files.example}</code></>
                : meta.files.problem ? <>⚠️ {meta.files.problem}</> : "Saving files is switched off on the server."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Excel files — the files saved in a month's "other expenses" folder
   (like Billing → Receipt Files)
══════════════════════════════════════════════════════════════════ */
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

function ExpenseFiles() {
  const [years, setYears] = useState(null);
  const [where, setWhere] = useState("");
  const [fy, setFy] = useState("");
  const [month, setMonth] = useState("");
  const [listing, setListing] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [busy, setBusy] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.get("/other-expenses/files/months")
      .then((res) => {
        const ys = res.data?.years || [];
        setYears(ys); setWhere(res.data?.where || res.data?.problem || "");
        if (ys.length) { setFy(ys[0].fy); setMonth(ys[0].months[0].value); }
      })
      .catch((err) => { setYears([]); setError(errorText(err, "The months could not be loaded.")); });
  }, []);

  useEffect(() => {
    if (!month) return undefined;
    let cancelled = false;
    setListing(null); setSheet(null); setSheetError(""); setError(""); setSheetIdx(0);
    api.get("/other-expenses/files", { params: { month } })
      .then((res) => {
        if (cancelled) return;
        setListing(res.data);
        if (res.data?.excel) {
          api.get("/other-expenses/files/sheet", { params: { key: res.data.excel.key } })
            .then((r) => { if (!cancelled) setSheet(r.data); })
            .catch((err) => { if (!cancelled) setSheetError(errorText(err, "The sheet could not be read.")); });
        }
      })
      .catch((err) => { if (!cancelled) setError(errorText(err, "The files of this month could not be listed.")); });
    return () => { cancelled = true; };
  }, [month, version]);

  const fyEntry = (years || []).find((y) => y.fy === fy);
  const download = async (key, name) => {
    setBusy(key);
    try {
      const res = await api.get("/other-expenses/files/download", { params: { key }, responseType: "blob" });
      saveBlob(res.data, name);
    } catch (err) { setError(await blobError(err, "The file could not be downloaded.")); }
    finally { setBusy(""); }
  };
  const saveAgain = async () => {
    setBusy("regen"); setError("");
    try {
      const res = await api.post("/other-expenses/files/regenerate", { fy });
      if (res.data?.problems?.length) setError(res.data.problems.join(" "));
      setVersion((v) => v + 1);
    } catch (err) { setError(errorText(err, "The files could not be saved.")); }
    finally { setBusy(""); }
  };
  const money = (v, col) => (typeof v === "number" && /Amount/.test(col) ? v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v);

  if (years === null) return <div style={{ padding: 20, color: "#94a3b8" }}>Loading…</div>;
  if (!years.length) return <div className="ox-note ox-warn"><span>No expenses yet — the monthly Excel sheets appear here once expenses are added.</span></div>;
  const sh = sheet?.sheets?.[sheetIdx];

  return (
    <div data-testid="ox-files">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div>
          <label className="ox-label" htmlFor="ox-files-fy">Financial year</label>
          <select id="ox-files-fy" className="ox-input" style={{ width: "auto" }} value={fy}
            onChange={(e) => { const y = years.find((x) => x.fy === e.target.value); setFy(e.target.value); setMonth(y?.months[0]?.value || ""); }}>
            {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy} (Apr–Mar)</option>)}
          </select>
        </div>
        <button type="button" className="ox-btn ox-plain" disabled={busy === "regen"} onClick={saveAgain}>{busy === "regen" ? "Saving…" : `💾 Save Excel files again for ${fy}`}</button>
      </div>
      <div className="ox-chips" role="group" aria-label="Month" style={{ marginTop: 12 }}>
        {(fyEntry?.months || []).map((m) => (
          <button key={m.value} type="button" className="ox-chip" aria-pressed={month === m.value} onClick={() => setMonth(m.value)}>{m.label}</button>
        ))}
      </div>
      {listing && <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 10, overflowWrap: "anywhere" }}>📁 <code>{listing.folder}/{listing.expected_name}</code>{where ? <> — {where.startsWith("object") ? "in " : "on the server in "}<code>{where}</code></> : null}</div>}
      {error && <div className="ox-note ox-bad" role="alert" style={{ marginTop: 12 }}><span>⚠️ {error}</span></div>}

      <div style={{ marginTop: 16 }}>
        {!listing ? <div style={{ padding: 16, color: "#94a3b8" }}>Loading…</div>
          : !listing.excel ? (
            <div className="ox-note ox-warn" style={{ display: "block" }}>
              <div>{listing.expected_name} is not saved in the folder yet{listing.expenses ? ` (this month has ${listing.expenses} expense${listing.expenses !== 1 ? "s" : ""})` : ""}.</div>
              <button type="button" className="ox-btn ox-main ox-sm" style={{ marginTop: 8 }} disabled={busy === "regen"} onClick={saveAgain}>💾 Save it now</button>
            </div>
          ) : sheetError ? <div className="ox-note ox-bad" role="alert"><span>⚠️ {sheetError}</span></div>
          : !sheet ? <div style={{ padding: 16, color: "#94a3b8" }}>Opening the sheet…</div> : (
            <div data-testid="ox-sheet">
              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ fontSize: 13.5 }}>📊 <strong>{listing.excel.name}</strong> · <strong>{sheet.count}</strong> expense{sheet.count !== 1 ? "s" : ""} · total <strong>{inr(sheet.total_amount)}</strong>
                  <span style={{ color: "#94a3b8" }}> · saved {listing.excel.modified} · {fmtSize(listing.excel.size)}</span></div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <div className="ox-seg" role="group" aria-label="Sheet">
                    {sheet.sheets.map((x, i) => <button key={x.name} type="button" aria-pressed={sheetIdx === i} onClick={() => setSheetIdx(i)}>{x.name}</button>)}
                  </div>
                  <button type="button" className="ox-btn ox-main ox-sm" disabled={busy === listing.excel.key} onClick={() => download(listing.excel.key, listing.excel.name)}>⬇ Download {listing.excel.name}</button>
                </div>
              </div>
              {sh?.title && <div style={{ textAlign: "center", fontWeight: 800, color: "#78350f", background: "#fff7ed", border: "1px solid #fed7aa", borderBottom: 0, borderRadius: "12px 12px 0 0", padding: "8px 10px" }}>{sh.title}</div>}
              <div className="ox-table-wrap" style={sh?.title ? { borderRadius: "0 0 12px 12px" } : undefined}>
                <table className="ox-table" style={{ minWidth: sh?.columns.length > 4 ? 860 : 420 }}>
                  <thead><tr>{sh.columns.map((c) => <th key={c} style={{ textAlign: /Amount|Expenses/.test(c) ? "right" : "left" }}>{c}</th>)}</tr></thead>
                  <tbody>
                    {sh.rows.length === 0 ? <tr><td colSpan={sh.columns.length} style={{ color: "#94a3b8" }}>No rows.</td></tr> : sh.rows.map((r, i) => (
                      <tr key={i}>{r.map((v, j) => (
                        <td key={j} style={{ textAlign: typeof v === "number" ? "right" : "left", fontWeight: /Amount/.test(sh.columns[j]) ? 700 : 400, whiteSpace: j === 1 ? "nowrap" : undefined }}>{money(v, sh.columns[j])}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                  {sh.footer && <tfoot><tr>{sh.footer.map((v, j) => <td key={j} style={{ textAlign: typeof v === "number" ? "right" : "left" }}>{money(v, sh.columns[j])}</td>)}</tr></tfoot>}
                </table>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Deleted expenses (log)
══════════════════════════════════════════════════════════════════ */
function DeletedLog() {
  const [rows, setRows] = useState(null);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    api.get("/other-expenses/deleted", query ? { params: { q: query } } : undefined)
      .then((res) => { if (!cancelled) setRows(res.data?.deleted || []); })
      .catch((err) => { if (!cancelled) { setRows([]); setError(errorText(err, "The deletion log could not be loaded.")); } });
    return () => { cancelled = true; };
  }, [query]);
  return (
    <div data-testid="ox-deleted">
      <form role="search" onSubmit={(e) => { e.preventDefault(); setQuery(typed.trim()); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input className="ox-input" style={{ flex: "1 1 240px", width: "auto" }} aria-label="Search deleted expenses" placeholder="Search by name, category, reason or who deleted"
          value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" className="ox-btn ox-main">Search</button>
        {query && <button type="button" className="ox-btn ox-plain" onClick={() => { setTyped(""); setQuery(""); }}>Show all</button>}
      </form>
      {error && <div className="ox-note ox-bad" role="alert"><span>⚠️ {error}</span></div>}
      <div className="ox-table-wrap">
        <table className="ox-table">
          <thead><tr><th>Deleted on</th><th>By</th><th>Expense date</th><th>Paid to</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={8} style={{ color: "#94a3b8" }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} style={{ color: "#64748b" }}>{query ? "Nothing found." : "No expense has been deleted."}</td></tr>
              : rows.map((d) => (
                <FragRow key={d.id} d={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function FragRow({ d, open, onToggle }) {
  return (
    <>
      <tr data-deleted-expense={d.expense_id}>
        <td style={{ whiteSpace: "nowrap" }}>{d.deleted_display}</td>
        <td>{d.deleted_by || "—"}</td>
        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(d.date)}</td>
        <td>{d.party_name}</td>
        <td>{d.category}</td>
        <td style={{ textAlign: "right", fontWeight: 800 }}><s style={{ color: "#991b1b" }}>{inr(d.amount)}</s></td>
        <td style={{ fontWeight: 700, color: "#7c2d12" }}>{d.reason}</td>
        <td><button type="button" className="ox-btn ox-plain ox-sm" aria-expanded={open} onClick={onToggle}>{open ? "Hide" : "Details"}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={8} style={{ background: "#fffbeb" }}>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div><strong>Paid to:</strong> {typeLabel(d.expense?.type)} — {d.party_name} · <strong>Paid by:</strong> {d.expense?.payment_method || "—"}</div>
            {d.expense?.description && <div><strong>Description:</strong> {d.expense.description}</div>}
            {d.expense?.created_by && <div style={{ color: "#64748b" }}>Saved by {d.expense.created_by}{d.expense.created_at ? ` on ${fmtDate(d.expense.created_at)}` : ""}</div>}
          </div>
        </td></tr>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   The screen
══════════════════════════════════════════════════════════════════ */
export default function OtherExpenses({ onBack, startAdding = false }) {
  const [view, setView] = useState("list");                // list | summary | files | deleted
  const [meta, setMeta] = useState(null);
  const [mode, setMode] = useState("month");               // month | last | fy | custom | all
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [category, setCategory] = useState("");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(null);
  const [form, setForm] = useState(startAdding ? {} : null); // {} add | {expense} edit
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [version, setVersion] = useState(0);

  const loadMeta = () => api.get("/other-expenses/meta").then((res) => setMeta(res.data)).catch(() => {});
  useEffect(() => { loadMeta(); }, []);
  const [from, to] = periodRange(mode, custom);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (category) params.category = category;
    if (q) params.q = q;
    api.get("/other-expenses", { params })
      .then((res) => { if (!cancelled) setRows(Array.isArray(res.data) ? res.data : []); })
      .catch((err) => { if (!cancelled) { setRows([]); setError(errorText(err, "The expenses could not be loaded. Please check the connection and try again.")); } });
    return () => { cancelled = true; };
  }, [from, to, category, q, version]);

  const categories = meta?.categories?.length ? meta.categories : FALLBACK_CATEGORIES;
  const list = rows || [];
  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const byCat = useMemo(() => {
    const m = {};
    list.forEach((r) => { m[r.category] = (m[r.category] || 0) + (Number(r.amount) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const byMethod = useMemo(() => {
    const m = {};
    list.forEach((r) => { const k = r.payment_method || "—"; m[k] = (m[k] || 0) + (Number(r.amount) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodText = mode === "month" ? "This month" : mode === "last" ? "Last month" : mode === "fy" ? `This financial year (${fyOf()})`
    : mode === "custom" ? `${from ? fmtDate(from) : "…"} – ${to ? fmtDate(to) : "…"}` : "All expenses";

  const saved = (exp, editing, warnings) => {
    setForm(null);
    loadMeta();
    setVersion((v) => v + 1);
    setNote({ ok: !warnings.length, text: `${editing ? "Updated" : "Saved"}: ${inr(exp.amount)} to ${exp.party_name} (${exp.category}).${warnings.length ? " " + warnings.join(" ") : ""}` });
  };

  const openMonth = (value) => {
    const [y, m] = value.split("-").map(Number);
    setCustom({ from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) });
    setMode("custom"); setCategory(""); setQ(""); setTyped(""); setView("list");
  };

  return (
    <div className="ox rdb-fade rdb-fade-1">
      <Styles />
      <div className="ox-card">
        <div className="ox-head">
          <div>
            <h2>💸 Other Expenses</h2>
            <p>Doctor fees, lab, materials, salary, rent and every other payment by the clinic</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onBack && <button type="button" className="ox-btn ox-ghost" onClick={onBack}>← Dashboard</button>}
            <button type="button" className="ox-btn ox-ghost" aria-pressed={view === "list"} onClick={() => setView("list")}>📋 Expenses</button>
            <button type="button" className="ox-btn ox-ghost" aria-pressed={view === "summary"} onClick={() => setView("summary")}>📊 Summary &amp; Excel</button>
            <button type="button" className="ox-btn ox-ghost" aria-pressed={view === "files"} onClick={() => setView("files")}>📁 Excel files</button>
            <button type="button" className="ox-btn ox-ghost" aria-pressed={view === "deleted"} onClick={() => setView("deleted")}>🗑 Deleted</button>
            <button type="button" className="ox-btn ox-white" onClick={() => { setNote(null); setForm({}); }}>+ Add Expense</button>
          </div>
        </div>

        <div className="ox-body">
          {note && (
            <div className={`ox-note ${note.ok ? "ox-ok" : "ox-warn"}`} role={note.ok ? "status" : "alert"}>
              <span>{note.ok ? "✓" : "⚠️"} {note.text}</span>
              <button type="button" className="ox-btn ox-plain ox-sm" onClick={() => setNote(null)}>Close</button>
            </div>
          )}

          {view === "summary" && <Summary meta={meta} onOpenMonth={openMonth} />}
          {view === "files" && <ExpenseFiles />}
          {view === "deleted" && <DeletedLog />}

          {view === "list" && (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div className="ox-chips" role="group" aria-label="Period">
                  {[["month", "This month"], ["last", "Last month"], ["fy", "This FY"], ["all", "All"], ["custom", "Dates…"]].map(([v, l]) => (
                    <button key={v} type="button" className="ox-chip" aria-pressed={mode === v} onClick={() => setMode(v)}>{l}</button>
                  ))}
                </div>
                <form role="search" className="ox-search" onSubmit={(e) => { e.preventDefault(); setQ(typed.trim()); }} style={{ display: "flex", gap: 6, flex: "1 1 280px", maxWidth: 520 }}>
                  <select className="ox-input" style={{ width: "auto", maxWidth: 190 }} aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All categories</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="ox-input" aria-label="Search expenses" placeholder="Search name, description…" value={typed} onChange={(e) => setTyped(e.target.value)} />
                  <button type="submit" className="ox-btn ox-main">🔍</button>
                </form>
              </div>
              {mode === "custom" && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <div><label className="ox-label" htmlFor="ox-from">From</label><input id="ox-from" type="date" className="ox-input" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></div>
                  <div><label className="ox-label" htmlFor="ox-to">To</label><input id="ox-to" type="date" className="ox-input" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></div>
                </div>
              )}
              {(q || category) && (
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 8 }}>
                  Showing {category ? <strong>{category}</strong> : "all categories"}{q ? <> matching “<strong>{q}</strong>”</> : null}.{" "}
                  <button type="button" className="ox-btn ox-plain ox-sm" onClick={() => { setQ(""); setTyped(""); setCategory(""); }}>Clear</button>
                </div>
              )}

              <div className="ox-tiles" data-testid="ox-tiles">
                <div className="ox-tile"><div className="ox-tile-l">{periodText}</div><div className="ox-tile-v" data-testid="ox-total">{inr(total)}</div><div className="ox-tile-s">{list.length} expense{list.length !== 1 ? "s" : ""}</div></div>
                <div className="ox-tile"><div className="ox-tile-l">Biggest category</div><div className="ox-tile-v">{byCat[0] ? `${CAT_ICON[byCat[0][0]] || ""} ${byCat[0][0]}` : "—"}</div><div className="ox-tile-s">{byCat[0] ? inr0(byCat[0][1]) : ""}</div></div>
                <div className="ox-tile"><div className="ox-tile-l">Largest payment</div><div className="ox-tile-v">{list.length ? inr0(Math.max(...list.map((r) => Number(r.amount) || 0))) : "—"}</div><div className="ox-tile-s">{list.length ? [...list].sort((a, b) => b.amount - a.amount)[0].party_name : ""}</div></div>
                <div className="ox-tile"><div className="ox-tile-l">Paid by</div><div className="ox-tile-v">{byMethod[0] ? byMethod[0][0] : "—"}</div><div className="ox-tile-s">{byMethod.length ? byMethod.slice(0, 3).map(([k, v]) => `${k} ${inr0(v)}`).join(" · ") : ""}</div></div>
              </div>

              {byCat.length > 1 && (
                <div className="ox-bars" style={{ marginBottom: 16 }} aria-label="By category">
                  {byCat.slice(0, 6).map(([name, amount]) => (
                    <div className="ox-bar" key={name}>
                      <button type="button" title={`Show only ${name}`} onClick={() => setCategory(name)}>{CAT_ICON[name] || "📦"} {name}</button>
                      <div className="ox-bar-track"><div className="ox-bar-fill" style={{ width: `${(amount / byCat[0][1]) * 100}%`, background: catColor(name, categories) }} /></div>
                      <span style={{ textAlign: "right", fontWeight: 700 }}>{inr0(amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="ox-note ox-bad" role="alert"><span>⚠️ {error}</span><button type="button" className="ox-btn ox-plain ox-sm" onClick={() => setVersion((v) => v + 1)}>Try again</button></div>}

              <div className="ox-table-wrap ox-has-cards">
                <table className="ox-table">
                  <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Paid by</th><th style={{ textAlign: "right" }}>Amount</th><th>Actions</th></tr></thead>
                  <tbody>
                    {rows === null ? <tr><td colSpan={6} style={{ color: "#94a3b8", padding: 20 }}>Loading expenses…</td></tr>
                      : list.length === 0 ? (
                        <tr><td colSpan={6} style={{ padding: 26, textAlign: "center", color: "#64748b" }}>
                          No expenses for {periodText.toLowerCase()}{category ? ` in ${category}` : ""}.{" "}
                          <button type="button" className="ox-btn ox-main ox-sm" onClick={() => setForm({})}>+ Add an expense</button>
                        </td></tr>
                      ) : list.map((r) => (
                        <tr key={r.id} data-expense={r.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                          <td><CatPill name={r.category} list={categories} /></td>
                          <td style={{ maxWidth: 280 }}>
                            <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{r.party_name}</div>
                            <div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>{typeLabel(r.type)}{r.description ? ` · ${r.description}` : ""}</div>
                          </td>
                          <td>{r.payment_method || "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{inr(r.amount)}</td>
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="button" className="ox-btn ox-view ox-sm" onClick={() => setViewing(r)}>View</button>
                              <button type="button" className="ox-btn ox-edit ox-sm" onClick={() => { setNote(null); setForm({ expense: r }); }}>Edit</button>
                              <button type="button" className="ox-btn ox-del ox-sm" onClick={() => setDeleting(r)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  {list.length > 0 && <tfoot><tr><td colSpan={4}>Total — {list.length} expense{list.length !== 1 ? "s" : ""}</td><td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{inr(total)}</td><td /></tr></tfoot>}
                </table>
              </div>

              <div className="ox-cards">
                {list.map((r) => (
                  <div className="ox-mcard" key={r.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ overflowWrap: "anywhere" }}>{r.party_name}</strong><strong style={{ whiteSpace: "nowrap" }}>{inr(r.amount)}</strong>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "#64748b" }}>
                      <CatPill name={r.category} list={categories} /> {fmtDate(r.date)} · {r.payment_method || "—"}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="ox-btn ox-view ox-sm" onClick={() => setViewing(r)}>View</button>
                      <button type="button" className="ox-btn ox-edit ox-sm" onClick={() => setForm({ expense: r })}>Edit</button>
                      <button type="button" className="ox-btn ox-del ox-sm" onClick={() => setDeleting(r)}>Delete</button>
                    </div>
                  </div>
                ))}
                {list.length > 0 && <div style={{ textAlign: "right", fontWeight: 800 }}>Total {inr(total)}</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {form && <ExpenseForm expense={form.expense} meta={meta} onClose={() => setForm(null)} onSaved={saved} />}
      {viewing && (
        <ExpenseView expense={viewing} categories={categories} onClose={() => setViewing(null)}
          onEdit={() => { setForm({ expense: viewing }); setViewing(null); }}
          onDelete={() => { setDeleting(viewing); setViewing(null); }} />
      )}
      {deleting && (
        <DeleteDialog expense={deleting} onCancel={() => setDeleting(null)}
          onDeleted={(res, why) => {
            const d = deleting;
            setDeleting(null);
            setVersion((v) => v + 1);
            setNote({ ok: true, text: `Deleted: ${inr(d.amount)} to ${d.party_name}. Reason: ${why}. It is kept in 🗑 Deleted.` });
          }} />
      )}
    </div>
  );
}