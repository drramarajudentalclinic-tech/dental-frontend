import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/api";

/* ─────────────────────────────────────────────────────────────────────
   Staff login (Doctor / Reception)
   • same login as before: role, username, password
   • a temporary password must be changed at first login
   • "Forgot password?" → reset link by e-mail
   • /login?invite=…  or  /login?reset=…  → set your password from a link
   • if the doctor switches an account off (or the login ends), any screen
     brings the person back here with a message (session guard below)
   ───────────────────────────────────────────────────────────────────── */

const NOTICE_KEY = "login_notice";
const errOf = (e, f) => e?.response?.data?.error && e.response.data.error !== "Unauthorized"
  ? e.response.data.error : (e?.response?.data?.message || f);

function endSession(message) {
  try {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("username");
    if (message) sessionStorage.setItem(NOTICE_KEY, message);
  } catch { /* storage blocked */ }
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) window.location.assign("/login");
}

/* Session guard: installed once when the app starts (this file is loaded with the app). */
let guardInstalled = false;
export function installSessionGuard() {
  if (guardInstalled || !api?.interceptors?.response?.use) return;
  guardInstalled = true;
  api.interceptors.response.use((r) => r, (err) => {
    const status = err?.response?.status;
    const d = err?.response?.data || {};
    const url = String(err?.config?.url || "");
    const isLoginCall = /\/auth\/(login|link|set-password|forgot|change-password)/.test(url);
    if (!isLoginCall) {
      const text = String(d.message || d.msg || "");
      if (status === 401 && (d.code === "SESSION_ENDED" || /token|expired|signature|jwt/i.test(text))) {
        endSession(d.code === "SESSION_ENDED" ? text : "Your login has ended. Please log in again.");
      } else if (status === 403 && d.code === "PASSWORD_CHANGE_REQUIRED") {
        endSession("Please log in and set a new password.");
      }
    }
    return Promise.reject(err);
  });
}
installSessionGuard();

function goHome(navigate, role) {
  navigate(role === "doctor" ? "/doctor/dashboard" : "/reception/dashboard");
}

function saveLogin(d) {
  sessionStorage.setItem("token", d.access_token);
  sessionStorage.setItem("role", d.role);
  sessionStorage.setItem("username", d.username);
}

/* ── choose a new password (used for first login and for links) ── */
function NewPassword({ username, onSubmit, busy, button }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const rules = [
    [pw.length >= 8, "At least 8 characters"],
    [/[A-Za-z]/.test(pw) && /\d/.test(pw), "Letters and at least one number"],
    [!username || !pw.toLowerCase().includes(String(username).toLowerCase()), "Does not contain the username"],
  ];
  const go = async () => {
    setErr("");
    if (!rules.every(([ok]) => ok)) { setErr("The new password does not meet the rules below."); return; }
    if (pw !== pw2) { setErr("The two passwords are not the same."); return; }
    const e = await onSubmit(pw);
    if (e) setErr(e);
  };
  return (
    <>
      {err && <div style={styles.error} role="alert">{err}</div>}
      <input style={styles.input} type={show ? "text" : "password"} placeholder="New password" autoComplete="new-password"
        value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" />
      <input style={styles.input} type={show ? "text" : "password"} placeholder="New password again" autoComplete="new-password"
        value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} aria-label="New password again" />
      <label style={styles.show}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      <ul style={styles.rules}>
        {rules.map(([ok, t]) => <li key={t} style={{ color: ok ? "#15803d" : "#64748b" }}>{ok ? "✓" : "•"} {t}</li>)}
      </ul>
      <button style={styles.loginBtn} onClick={go} disabled={busy}>{busy ? "Saving..." : button}</button>
    </>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "", role: "reception" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  // view: login | change (temporary password) | forgot | link (invite / reset) | linkdone | linkbad
  const [view, setView] = useState("login");
  const [pending, setPending] = useState(null);     // login answer waiting for the password change
  const [link, setLink] = useState(null);           // { token, kind, username, full_name, role }
  const [forgotWho, setForgotWho] = useState("");

  useEffect(() => {
    try {
      const n = sessionStorage.getItem(NOTICE_KEY);
      if (n) { setInfo(n); sessionStorage.removeItem(NOTICE_KEY); }
    } catch { /* storage blocked */ }
    const q = new URLSearchParams(window.location.search);
    const token = q.get("invite") || q.get("reset");
    if (token) {
      window.history.replaceState(null, "", "/login");          // the link is not left in the address bar
      setView("link");
      api.get("/auth/link", { params: { token } })
        .then((r) => { setLink({ token, ...r.data }); setForm((f) => ({ ...f, username: r.data.username, role: r.data.role === "doctor" ? "doctor" : "reception" })); })
        .catch((e) => { setError(errOf(e, "This link has expired or was already used.")); setView("linkbad"); });
    }
  }, []);

  const handleSubmit = async () => {
    setError(""); setInfo("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { username: form.username, password: form.password });
      const d = res.data;
      // Validate role matches selection
      if (d.role !== form.role) {
        setError(`Invalid role. You are registered as ${d.role}.`);
        return;
      }
      saveLogin(d);
      if (d.must_change_password) { setPending(d); setView("change"); return; }
      goHome(navigate, d.role);
    } catch (err) {
      const d = err?.response?.data || {};
      if (d.code === "LOCKED" || d.code === "DISABLED") setError(d.error);
      else if (err?.response?.status === 429) setError(d.error || "Too many tries. Please wait and try again.");
      else if (typeof d.tries_left === "number" && d.tries_left <= 2)
        setError(`Invalid username or password. ${d.tries_left} more wrong ${d.tries_left === 1 ? "try" : "tries"} will lock this account for 15 minutes.`);
      else if (!err?.response) setError("Could not reach the server. Please check the internet and try again.");
      else setError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  };

  const changeTemporary = async (newPw) => {
    setLoading(true);
    try {
      const r = await api.post("/auth/change-password", { current_password: form.password, new_password: newPw });
      saveLogin({ ...pending, ...r.data });
      goHome(navigate, r.data.role);
      return null;
    } catch (e) { return errOf(e, "The password could not be changed. Please try again."); }
    finally { setLoading(false); }
  };

  const setFromLink = async (newPw) => {
    setLoading(true);
    try {
      await api.post("/auth/set-password", { token: link.token, password: newPw });
      setView("linkdone");
      setForm((f) => ({ ...f, password: "" }));
      return null;
    } catch (e) { return errOf(e, "The password could not be saved. Please try again."); }
    finally { setLoading(false); }
  };

  const sendForgot = async () => {
    setError(""); setInfo("");
    if (!forgotWho.trim()) { setError("Enter your username or e-mail."); return; }
    setLoading(true);
    try {
      const r = await api.post("/auth/forgot", { username: forgotWho.trim() });
      setInfo(r.data?.message || "If this account has an e-mail address, a reset link has been sent.");
    } catch (e) { setError(errOf(e, "Could not send the link. Please try again.")); }
    finally { setLoading(false); }
  };

  const backToLogin = () => { setView("login"); setError(""); setInfo(""); setPending(null); };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>🦷 Dental Clinic</h2>

        {view === "login" && (
          <>
            <p style={styles.subtitle}>Please login to continue</p>
            {info && <div style={styles.info} role="status">{info}</div>}
            {error && <div style={styles.error} role="alert">{error}</div>}

            <div style={styles.roleRow}>
              <button
                style={form.role === "reception" ? styles.roleActive : styles.roleBtn}
                onClick={() => setForm({ ...form, role: "reception" })}
              >
                👩‍💼 Reception
              </button>
              <button
                style={form.role === "doctor" ? styles.roleActive : styles.roleBtn}
                onClick={() => setForm({ ...form, role: "doctor" })}
              >
                👨‍⚕️ Doctor
              </button>
            </div>

            <input
              style={styles.input}
              placeholder="Username"
              autoComplete="username"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
            />

            <button style={styles.loginBtn} onClick={handleSubmit} disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </button>
            <button style={styles.linkBtn} onClick={() => { setView("forgot"); setForgotWho(form.username); setError(""); setInfo(""); }}>
              Forgot password?
            </button>
          </>
        )}

        {view === "change" && (
          <>
            <p style={styles.subtitle}>Welcome{pending?.full_name ? `, ${pending.full_name}` : ""}! Please set your own password to continue.</p>
            <NewPassword username={form.username} busy={loading} button="Save and continue" onSubmit={changeTemporary} />
            <button style={styles.linkBtn} onClick={() => { endSession(); backToLogin(); }}>Cancel</button>
          </>
        )}

        {view === "forgot" && (
          <>
            <p style={styles.subtitle}>Enter your username or e-mail. We'll send a link to choose a new password.</p>
            {info && <div style={styles.info} role="status">{info}</div>}
            {error && <div style={styles.error} role="alert">{error}</div>}
            <input style={styles.input} placeholder="Username or e-mail" value={forgotWho} autoFocus
              onChange={(e) => setForgotWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendForgot()} />
            <button style={styles.loginBtn} onClick={sendForgot} disabled={loading}>{loading ? "Sending..." : "Send reset link"}</button>
            <button style={styles.linkBtn} onClick={backToLogin}>← Back to login</button>
          </>
        )}

        {view === "link" && (
          <>
            {!link && !error && <p style={styles.subtitle}>Checking the link…</p>}
            {link && (
              <>
                <p style={styles.subtitle}>
                  {link.kind === "invite" ? `Welcome, ${link.full_name}! Set your password` : `Choose a new password for ${link.full_name}`}
                  <br /><span style={{ fontSize: 13 }}>Username: <b>{link.username}</b> · {link.role === "doctor" ? "Doctor" : "Reception"}</span>
                </p>
                <NewPassword username={link.username} busy={loading} button="Save password" onSubmit={setFromLink} />
              </>
            )}
          </>
        )}

        {view === "linkdone" && (
          <>
            <div style={styles.info} role="status">Password saved. You can log in now with username <b>{link?.username}</b>.</div>
            <button style={styles.loginBtn} onClick={backToLogin}>Go to login</button>
          </>
        )}

        {view === "linkbad" && (
          <>
            {error && <div style={styles.error} role="alert">{error}</div>}
            <button style={styles.loginBtn} onClick={backToLogin}>Go to login</button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8", padding: "16px", boxSizing: "border-box" },
  card: { background: "white", padding: "40px", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", width: "100%", maxWidth: "400px", boxSizing: "border-box" },
  title: { textAlign: "center", fontSize: "24px", marginBottom: "4px" },
  subtitle: { textAlign: "center", color: "#666", marginBottom: "24px", lineHeight: 1.5 },
  error: { background: "#fee", color: "#c00", padding: "10px", borderRadius: "6px", marginBottom: "16px", textAlign: "center" },
  info: { background: "#eff6ff", color: "#1e40af", padding: "10px", borderRadius: "6px", marginBottom: "16px", textAlign: "center", lineHeight: 1.5 },
  roleRow: { display: "flex", gap: "12px", marginBottom: "20px" },
  roleBtn: { flex: 1, padding: "10px", border: "2px solid #ddd", borderRadius: "8px", background: "white", cursor: "pointer", fontSize: "14px" },
  roleActive: { flex: 1, padding: "10px", border: "2px solid #2563eb", borderRadius: "8px", background: "#eff6ff", cursor: "pointer", fontSize: "14px", fontWeight: "bold", color: "#2563eb" },
  input: { width: "100%", padding: "12px", marginBottom: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" },
  loginBtn: { width: "100%", padding: "12px", background: "#2563eb", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" },
  linkBtn: { display: "block", margin: "14px auto 0", background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: "14px", textDecoration: "underline" },
  show: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#555", marginBottom: "8px" },
  rules: { listStyle: "none", padding: 0, margin: "0 0 16px", fontSize: "13px", lineHeight: 1.7 },
};