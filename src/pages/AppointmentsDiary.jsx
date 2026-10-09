import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppointmentsBoard from "../components/AppointmentsBoard";
import PatientCompleteHistory from "./PatientCompleteHistory";

/* ═══════════════════════════════════════════
   APPOINTMENTS PAGE — route /reception/appointments
   The old Appointments Diary (kept in this app's own database) is gone.
   Appointments now live in Supabase — the same list as the Appointments
   app — and every booking is linked to the patient.
═══════════════════════════════════════════ */
export default function AppointmentsPage() {
  const navigate = useNavigate();
  const [historyId, setHistoryId] = useState(null);

  const nav = [
    ["🏠", "Dashboard", () => navigate("/reception/dashboard")],
    ["👤", "New Patient", () => navigate("/reception/patient/new")],
    ["🔍", "Find Patient", () => navigate("/reception/dashboard")],
    ["📅", "Appointments", null],
    ["💊", "Prescriptions", () => navigate("/reception/dashboard?section=prescriptions")],
    ["🩺", "Doctor View", () => navigate("/doctor/dashboard")],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#f0f5fb 0%,#e8eff8 50%,#dde8f5 100%)", fontFamily: "'Plus Jakarta Sans','DM Sans',system-ui,sans-serif" }}>
      <style>{`
        .apg-hero { background: linear-gradient(135deg,#0b2d4e 0%,#0f4270 45%,#1059a0 100%); padding: 22px 20px; color: #fff; }
        .apg-hero h1 { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 25px; font-weight: 700; }
        .apg-hero p { margin: 2px 0 0; font-size: 13px; color: rgba(255,255,255,.75); }
        .apg-nav { background: linear-gradient(90deg,#0a2540,#0f3d6e); position: sticky; top: 0; z-index: 200; }
        .apg-nav-in { max-width: 1100px; margin: 0 auto; padding: 0 12px; display: flex; overflow-x: auto; scrollbar-width: none; }
        .apg-nav-in::-webkit-scrollbar { display: none; }
        .apg-nav button { display: inline-flex; gap: 6px; align-items: center; height: 46px; padding: 0 14px; border: 0; border-bottom: 2.5px solid transparent;
          background: transparent; color: rgba(255,255,255,.6); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .apg-nav button:hover { color: #fff; }
        .apg-nav button.on { color: #fff; border-bottom-color: #38bdf8; background: rgba(56,189,248,.09); }
        .apg-card { max-width: 1100px; margin: 22px auto 0; padding: 0 14px 50px; }
        .apg-card > div { background: #fff; border-radius: 16px; border: 1px solid rgba(226,232,244,.9); box-shadow: 0 8px 24px rgba(29,77,122,.07); padding: 20px 22px; }
        @media (max-width: 600px) { .apg-card > div { padding: 14px 12px; } }
      `}</style>
      <div className="apg-hero">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h1>Sri Satya Sai Oral Health Center</h1>
          <p>&amp; Dental Clinic · Appointments</p>
        </div>
      </div>
      <nav className="apg-nav">
        <div className="apg-nav-in">
          {nav.map(([icon, label, go]) => (
            <button key={label} type="button" className={go ? "" : "on"} onClick={go || undefined} aria-current={go ? undefined : "page"}>
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="apg-card">
        <div>
          <AppointmentsBoard
            role="reception"
            onOpenHistory={(pid) => setHistoryId(pid)}
            onOpenVisit={(vid) => navigate(`/doctor/visit/${vid}`)}
          />
        </div>
      </div>
      {historyId && (
        <PatientCompleteHistory patientId={historyId} readOnlyLabel="Reception — Read Only" onBack={() => setHistoryId(null)} />
      )}
    </div>
  );
}