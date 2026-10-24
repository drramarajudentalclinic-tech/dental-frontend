import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/* ═══════════════════════════════════════════════════════════════════
   👥 STAFF ACCOUNTS (Doctor only)
   Add a receptionist / doctor, send a set-password link (e-mail or copy
   it to WhatsApp) or give a temporary password, reset a password, switch
   an account off (they are logged out at their next click), unlock, and
   see the login log. Also "Change my password" for the doctor.
   ═══════════════════════════════════════════════════════════════════ */

const errText = (e, f) => e?.response?.data?.error || e?.response?.data?.message || f;

let stylesIn = false;
function injectStyles() {
  if (stylesIn || typeof document === "undefined") return;
  stylesIn = true;
  const el = document.createElement("style");
  el.textContent = `
  .stf-back { position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:1250; display:flex; justify-content:center; padding:16px; }
  .stf { background:#f6f9fd; width:100%; max-width:1000px; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.3); font-family:'Plus Jakarta Sans',sans-serif; }
  .stf-hd { background:linear-gradient(120deg,#0f2a50,#1d4d7a); color:#fff; padding:14px 20px; display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .stf-body { flex:1; overflow:auto; padding:16px 20px; display:grid; gap:14px; align-content:start; }
  .stf-card { background:#fff; border:1px solid #e3ebf6; border-radius:12px; padding:14px 16px; }
  .stf-tabs { display:flex; gap:6px; flex-wrap:wrap; }
  .stf-tab { border:1.5px solid #c9daee; background:#fff; color:#1d4d7a; border-radius:999px; padding:7px 14px; font:700 13px 'Plus Jakarta Sans',sans-serif; cursor:pointer; }
  .stf-tab[aria-selected=true] { background:#1d4d7a; color:#fff; border-color:#1d4d7a; }
  .stf-row { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) auto; gap:12px; align-items:center; padding:12px 0; border-top:1px solid #edf2f9; }
  .stf-row:first-child { border-top:none; }
  .stf-name { font-weight:800; color:#0f2a50; font-size:14.5px; }
  .stf-sub { font-size:12px; color:#7486a3; }
  .stf-tag { font:700 11px 'Plus Jakarta Sans',sans-serif; border-radius:999px; padding:2px 9px; border:1px solid; white-space:nowrap; display:inline-block; margin:2px 4px 2px 0; }
  .stf-acts { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
  .stf-btn { border:1.5px solid #c9daee; background:#eef4fb; color:#1d4d7a; border-radius:8px; padding:7px 11px; font:700 12px 'Plus Jakarta Sans',sans-serif; cursor:pointer; white-space:nowrap; }
  .stf-btn:disabled { opacity:.45; cursor:not-allowed; }
  .stf-btn.go { background:linear-gradient(135deg,#1d4d7a,#2563eb); color:#fff; border-color:transparent; }
  .stf-btn.warn { background:#fff; color:#b91c1c; border-color:#fecaca; }
  .stf-btn.ok { background:#fff; color:#047857; border-color:#a7f3d0; }
  .stf-x { background:rgba(255,255,255,.15); color:#fff; border:none; border-radius:8px; width:34px; height:34px; font-size:18px; cursor:pointer; }
  .stf-note { border-radius:10px; padding:9px 12px; font-size:12.5px; line-height:1.5; }
  .stf-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 14px; }
  .stf-form label { display:grid; gap:4px; font-size:12px; font-weight:700; color:#334155; }
  .stf-form input, .stf-form select { border:1.5px solid #dbe5f4; border-radius:8px; padding:9px 10px; font:14px 'Plus Jakarta Sans',sans-serif; min-width:0; }
  .stf-linkbox { display:flex; gap:8px; align-items:center; background:#f8fafc; border:1px dashed #94a3b8; border-radius:8px; padding:8px 10px; margin-top:8px; }
  .stf-linkbox code { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  .stf-log { display:grid; grid-template-columns:150px 110px 1fr; gap:4px 12px; font-size:12.5px; }
  @media (max-width:720px) { .stf-row { grid-template-columns:1fr; } .stf-acts { justify-content:flex-start; } .stf-form { grid-template-columns:1fr; } .stf-log { grid-template-columns:1fr; } .stf-back { padding:0; } .stf { border-radius:0; } }
  `;
  document.head.appendChild(el);
}

const ACTION_TEXT = {
  login: "Logged in", login_failed: "Wrong password / username", login_blocked: "Login refused", password_changed: "Changed own password",
  password_change_failed: "Password change failed", password_set_by_link: "Set password from link", reset_asked: "Asked for a reset link",
  staff_added: "Account added", staff_edited: "Account edited", staff_switched_off: "Account switched off", staff_switched_on: "Account switched on",
  staff_unlocked: "Account unlocked", staff_password_reset: "Password reset",
};

function LinkBox({ link, emailed, mail }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* not allowed */ } };
  return (
    <div>
      <div className="stf-sub" style={{ marginTop: 6 }}>
        {emailed ? "✉️ The link was e-mailed. You can also copy it and send it on WhatsApp:" :
          mail === "off" ? "E-mail is not set up yet — copy this link and send it on WhatsApp:" : "Copy this link and send it on WhatsApp:"}
      </div>
      <div className="stf-linkbox">
        <code title={link}>{link}</code>
        <button type="button" className="stf-btn" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
        <a className="stf-btn" href={`https://wa.me/?text=${encodeURIComponent("Set your clinic app password: " + link)}`} target="_blank" rel="noreferrer">WhatsApp</a>
      </div>
      <div className="stf-sub">Works once. Treat it like a password — send it only to that person.</div>
    </div>
  );
}

function AddForm({ busy, onAdd }) {
  const [f, setF] = useState({ full_name: "", username: "", email: "", role: "reception", how: "link", password: "" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="stf-card">
      <div style={{ fontWeight: 800, color: "#0f2a50", marginBottom: 10 }}>Add a staff member</div>
      <div className="stf-form">
        <label>Full name<input value={f.full_name} onChange={set("full_name")} placeholder="e.g. Lakshmi K" /></label>
        <label>Username (for login)<input value={f.username} onChange={set("username")} placeholder="e.g. lakshmi" autoComplete="off" /></label>
        <label>Role
          <select value={f.role} onChange={set("role")}><option value="reception">Reception</option><option value="doctor">Doctor</option></select>
        </label>
        <label>E-mail (optional)<input type="email" value={f.email} onChange={set("email")} placeholder="for the link and Forgot password" /></label>
        <label>Password
          <select value={f.how} onChange={set("how")}>
            <option value="link">They set it themselves (link)</option>
            <option value="temp">I give a temporary password</option>
          </select>
        </label>
        {f.how === "temp" && <label>Temporary password<input value={f.password} onChange={set("password")} placeholder="8+ letters and numbers" autoComplete="off" /></label>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span className="stf-sub">{f.how === "temp" ? "They must change it at their first login." : "They get a link to set their own password (e-mail, or you copy it)."}</span>
        <button type="button" className="stf-btn go" disabled={busy || !f.username.trim()}
          onClick={() => onAdd({ full_name: f.full_name, username: f.username, email: f.email, role: f.role, ...(f.how === "temp" ? { password: f.password } : {}) },
            () => setF({ full_name: "", username: "", email: "", role: "reception", how: "link", password: "" }))}>
          {busy ? "Saving…" : "Add account"}
        </button>
      </div>
    </div>
  );
}

function MyPassword() {
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    setMsg(null);
    if (n1 !== n2) { setMsg(["err", "The two new passwords are not the same."]); return; }
    setBusy(true);
    try {
      const r = await api.post("/auth/change-password", { current_password: cur, new_password: n1 });
      if (r.data?.access_token) sessionStorage.setItem("token", r.data.access_token);
      setCur(""); setN1(""); setN2("");
      setMsg(["ok", "Password changed. Any other computer or phone where you were logged in has been logged out."]);
    } catch (e) { setMsg(["err", errText(e, "The password could not be changed.")]); }
    finally { setBusy(false); }
  };
  return (
    <div className="stf-card">
      <div style={{ fontWeight: 800, color: "#0f2a50", marginBottom: 10 }}>Change my password</div>
      {msg && <div className="stf-note" role={msg[0] === "err" ? "alert" : "status"} style={msg[0] === "err" ? { background: "#fef2f2", color: "#b91c1c", marginBottom: 10 } : { background: "#ecfdf5", color: "#047857", marginBottom: 10 }}>{msg[1]}</div>}
      <div className="stf-form">
        <label>Current password<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>
        <span />
        <label>New password<input type="password" value={n1} onChange={(e) => setN1(e.target.value)} autoComplete="new-password" placeholder="8+ letters and numbers" /></label>
        <label>New password again<input type="password" value={n2} onChange={(e) => setN2(e.target.value)} autoComplete="new-password" /></label>
      </div>
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <button type="button" className="stf-btn go" disabled={busy || !cur || !n1} onClick={save}>{busy ? "Saving…" : "Change password"}</button>
      </div>
    </div>
  );
}

export default function StaffPanel({ onClose }) {
  useEffect(() => { injectStyles(); }, []);
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("staff");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(null);       // { text, link, emailed }
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const [tempFor, setTempFor] = useState(null);
  const [temp, setTemp] = useState("");
  const [edit, setEdit] = useState(null);

  const load = useCallback(async () => {
    try { setD((await api.get("/auth/staff")).data); setErr(""); }
    catch (e) { setErr(errText(e, "The staff list could not be loaded.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "log") api.get("/auth/staff/log").then((r) => setLog(r.data.log)).catch(() => setLog([])); }, [tab]);
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const k = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", k, true); };
  }, [onClose]);

  const act = async (fn, okText) => {
    setBusy(true); setErr(""); setNotice(null);
    try {
      const r = await fn();
      setNotice({ text: okText(r.data), link: r.data?.link, emailed: r.data?.emailed });
      await load();
      return true;
    } catch (e) { setErr(errText(e, "That could not be saved. Please try again.")); return false; }
    finally { setBusy(false); }
  };

  const add = (body, reset) => act(() => api.post("/auth/staff", body), (r) =>
    `${r.staff.username} added as ${r.staff.role === "doctor" ? "Doctor" : "Reception"}.${body.password ? " They must change the temporary password at first login." : ""}`)
    .then((ok) => ok && reset());
  const toggle = (s) => {
    if (s.active && !window.confirm(`Switch off ${s.full_name || s.username}? They will be logged out at their next click and cannot log in until you switch the account on again.`)) return;
    act(() => api.post(`/auth/staff/${s.user_id}/active`, { active: !s.active }),
      () => s.active ? `${s.username} is switched off and logged out.` : `${s.username} is switched on again.`);
  };
  const sendLink = (s) => act(() => api.post(`/auth/staff/${s.user_id}/reset`, {}),
    (r) => `New set-password link for ${s.username}${r.emailed ? " — e-mailed" : ""}. ${s.user_id === d.me ? "" : "They have been logged out."}`);
  const giveTemp = (s) => act(() => api.post(`/auth/staff/${s.user_id}/reset`, { temp_password: temp }),
    () => `${s.username} now has the temporary password you typed and has been logged out. They must change it at next login.`)
    .then((ok) => { if (ok) { setTempFor(null); setTemp(""); } });
  const unlock = (s) => act(() => api.post(`/auth/staff/${s.user_id}/unlock`, {}), () => `${s.username} is unlocked.`);
  const saveEdit = () => act(() => api.put(`/auth/staff/${edit.user_id}`, { full_name: edit.full_name, email: edit.email, role: edit.role }),
    () => `${edit.username} saved.`).then((ok) => ok && setEdit(null));

  return createPortal(
    <div className="stf-back">
      <div className="stf" role="dialog" aria-label="Staff accounts">
        <div className="stf-hd">
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>👥 Staff accounts</div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>Only you (Doctor) can add staff. Switched-off accounts are logged out at once.</div>
          </div>
          <button type="button" className="stf-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="stf-body">
          <div className="stf-tabs" role="tablist">
            {[["staff", "Staff"], ["add", "+ Add staff"], ["me", "My password"], ["log", "Login log"]].map(([k, t]) => (
              <button key={k} type="button" role="tab" className="stf-tab" aria-selected={tab === k} onClick={() => { setTab(k); setNotice(null); setErr(""); }}>{t}</button>
            ))}
          </div>
          {err && <div className="stf-note" role="alert" style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>{err}</div>}
          {notice && (
            <div className="stf-note" role="status" style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0" }}>
              {notice.text}
              <LinkBox link={notice.link} emailed={notice.emailed} mail={d?.mail} />
            </div>
          )}
          {d && d.mail === "test" && <div className="stf-note" style={{ background: "#eff6ff", color: "#1e40af" }}>E-mail is in TEST mode: e-mails are written to the server log, not sent.</div>}

          {tab === "add" && <AddForm busy={busy} onAdd={add} />}
          {tab === "me" && <MyPassword />}

          {tab === "log" && (
            <div className="stf-card">
              {!log ? <div className="stf-sub">Loading…</div> : log.length === 0 ? <div className="stf-sub">Nothing yet.</div> : (
                <div className="stf-log">
                  {log.map((l, i) => (
                    <div key={i} style={{ display: "contents" }}>
                      <span className="stf-sub">{l.at}</span>
                      <b style={{ color: "#0f2a50" }}>{l.username || "—"}</b>
                      <span style={{ color: /failed|blocked|off/.test(l.action) ? "#b91c1c" : "#334155" }}>{ACTION_TEXT[l.action] || l.action}{l.detail ? ` — ${l.detail}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "staff" && d && (
            <div className="stf-card">
              {d.staff.map((s) => (
                <div key={s.user_id} className="stf-row" style={s.active ? null : { opacity: .65 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="stf-name">{s.full_name || s.username}{s.user_id === d.me ? " (you)" : ""}</div>
                    <div className="stf-sub">Username: <b>{s.username}</b>{s.email ? ` · ${s.email}${s.email_verified ? " ✓" : ""}` : " · no e-mail"}</div>
                    <div className="stf-sub">Last login: {s.last_login || "never"}</div>
                  </div>
                  <div>
                    <span className="stf-tag" style={s.role === "doctor" ? { background: "#eef2ff", color: "#3730a3", borderColor: "#c7d2fe" } : { background: "#f0f9ff", color: "#075985", borderColor: "#bae6fd" }}>
                      {s.role === "doctor" ? "👨‍⚕️ Doctor" : s.role === "admin" ? "Admin" : "👩‍💼 Reception"}</span>
                    <span className="stf-tag" style={s.active ? { background: "#ecfdf5", color: "#047857", borderColor: "#a7f3d0" } : { background: "#f1f5f9", color: "#64748b", borderColor: "#cbd5e1" }}>{s.active ? "On" : "Switched off"}</span>
                    {s.locked && <span className="stf-tag" style={{ background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" }}>🔒 Locked</span>}
                    {s.must_change_password && <span className="stf-tag" style={{ background: "#fffbeb", color: "#92400e", borderColor: "#fde68a" }}>Must change password</span>}
                    {s.link_pending && <span className="stf-tag" style={{ background: "#fffbeb", color: "#92400e", borderColor: "#fde68a" }}>Link not used yet</span>}
                  </div>
                  <div className="stf-acts">
                    <button type="button" className="stf-btn" disabled={busy} onClick={() => setEdit({ ...s })}>Edit</button>
                    <button type="button" className="stf-btn" disabled={busy} onClick={() => sendLink(s)} title="A new link to set the password (old password stops working only when the new one is set)">Send link</button>
                    {s.user_id !== d.me && <button type="button" className="stf-btn" disabled={busy} onClick={() => { setTempFor(s.user_id); setTemp(""); }}>Temp. password</button>}
                    {s.locked && <button type="button" className="stf-btn ok" disabled={busy} onClick={() => unlock(s)}>Unlock</button>}
                    {s.user_id !== d.me && (
                      <button type="button" className={`stf-btn ${s.active ? "warn" : "ok"}`} disabled={busy} onClick={() => toggle(s)}>{s.active ? "Switch off" : "Switch on"}</button>
                    )}
                  </div>
                  {tempFor === s.user_id && (
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <input value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="Temporary password (8+ letters and numbers)" aria-label="Temporary password"
                        style={{ flex: "1 1 240px", border: "1.5px solid #dbe5f4", borderRadius: 8, padding: "8px 10px", font: "14px 'Plus Jakarta Sans',sans-serif" }} />
                      <button type="button" className="stf-btn go" disabled={busy || temp.length < 8} onClick={() => giveTemp(s)}>Set &amp; log them out</button>
                      <button type="button" className="stf-btn" onClick={() => setTempFor(null)}>Cancel</button>
                    </div>
                  )}
                  {edit?.user_id === s.user_id && (
                    <div style={{ gridColumn: "1 / -1" }} className="stf-form">
                      <label>Full name<input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></label>
                      <label>E-mail<input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
                      <label>Role
                        <select value={edit.role} disabled={s.user_id === d.me} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                          <option value="reception">Reception</option><option value="doctor">Doctor</option>
                        </select>
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "end", justifyContent: "flex-end" }}>
                        <button type="button" className="stf-btn" onClick={() => setEdit(null)}>Cancel</button>
                        <button type="button" className="stf-btn go" disabled={busy} onClick={saveEdit}>Save</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}