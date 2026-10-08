import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useEffect } from "react";
import ProtectedRoute from "./ProtectedRoute";
import ReceptionDashboard from "./pages/ReceptionDashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import VisitPage from "./pages/VisitPage";
import EditPatient from "./pages/EditPatient";
import DoctorPatientView from "./pages/DoctorPatientView";
import ReceptionPatientForm from "./pages/ReceptionPatientForm";
import AppointmentsDiary from "./pages/AppointmentsDiary.jsx";
import LoginPage from "./pages/LoginPage";
import CBCTViewerPage from "./components/CBCTViewerPage";

function NavTracer() {
  const location = useLocation();

  useEffect(() => {
    console.log("Navigated to:", location.pathname + location.search);
  }, [location]);

  return null;
}

// Billing was removed from this application (it is done in the clinic's
// separate billing software). Any old link or bookmark to /billing/<visit>
// now opens Reception's "Doctor's Instructions" list with that visit
// highlighted, instead of the old billing page.
function OldBillingLink() {
  const { visitId } = useParams();
  const id = /^\d+$/.test(visitId || "") ? visitId : "";
  return (
    <Navigate
      to={`/reception/dashboard?section=instructions${id ? `&visitId=${id}` : ""}`}
      replace
    />
  );
}

export default function App() {
  useEffect(() => {
    // Prefer VITE_API_URL from .env / .env.production (it includes "/api",
    // so strip that to get the server root for the /health endpoint).
    // Falls back to auto-detecting localhost vs. Render if the env var
    // isn't set, so this still works even without proper .env setup.
    const fromEnv = import.meta.env.VITE_API_URL;
    const backend = fromEnv
      ? fromEnv.replace(/\/$/, "").replace(/\/api$/, "")
      : window.location.hostname === "localhost"
        ? "http://localhost:5000"
        : "https://dental-backend-xojn.onrender.com";

    fetch(`${backend}/health`)
      .then(() => console.log("✅ Backend is reachable"))
      .catch((err) => {
        console.log("Backend wake-up request:", err.message);
      });
  }, []);

  return (
    <BrowserRouter>
      <NavTracer />

      <Routes>
        {/* Default */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Login */}
        <Route path="/login" element={<LoginPage />} />

        {/* Role redirects */}
        <Route
          path="/reception"
          element={<Navigate to="/reception/dashboard" replace />}
        />

        <Route
          path="/doctor"
          element={<Navigate to="/doctor/dashboard" replace />}
        />

        {/* Reception */}
        <Route
          path="/reception/dashboard"
          element={<ReceptionDashboard />}
        />

        <Route
          path="/reception/patient/new"
          element={<ReceptionPatientForm />}
        />

        <Route
          path="/reception/patient/:id"
          element={<ReceptionPatientForm />}
        />

        <Route
          path="/reception/appointments"
          element={<AppointmentsDiary />}
        />

        {/* Doctor */}
        <Route
          path="/doctor/dashboard"
          element={<DoctorDashboard />}
        />

        <Route
          path="/doctor/patient/:id"
          element={<DoctorPatientView />}
        />

        <Route
          path="/doctor/visit/:visitId"
          element={<VisitPage />}
        />

        {/* Common */}
        <Route
          path="/visit/:visitId"
          element={<VisitPage />}
        />

        {/* Old billing links → Reception's "Doctor's Instructions" */}
        <Route
          path="/billing/:visitId"
          element={<OldBillingLink />}
        />

        <Route
          path="/billing"
          element={<OldBillingLink />}
        />

        <Route
          path="/patients/edit/:id"
          element={<EditPatient />}
        />

        {/* CBCT Viewer */}
        <Route
          path="/cbct-viewer"
          element={<CBCTViewerPage />}
        />

        {/* Fallback */}
        <Route
          path="*"
          element={<Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}