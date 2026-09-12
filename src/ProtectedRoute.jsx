import { Navigate, useLocation } from "react-router-dom";

/**
 * Wrap a route element with this to restrict it to specific roles.
 *
 * Usage:
 *   <Route
 *     path="/reception/patient/new"
 *     element={
 *       <ProtectedRoute allowedRoles={["reception", "admin"]}>
 *         <ReceptionPatientForm />
 *       </ProtectedRoute>
 *     }
 *   />
 *
 * - No token / not logged in  -> redirect to /login
 * - Logged in, wrong role     -> redirect to that role's own dashboard
 * - Logged in, right role     -> render the page
 */
export default function ProtectedRoute({ allowedRoles, children }) {
  const location = useLocation();
  const role = (localStorage.getItem("role") || "").toLowerCase();
  const token = localStorage.getItem("token");

  // Not logged in at all
  if (!token || !role) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Logged in, but this role isn't allowed on this route.
  // "admin" is always allowed everywhere, matching the backend's
  // require_role() behavior.
  const allowed = allowedRoles.map((r) => r.toLowerCase());
  if (!allowed.includes(role) && role !== "admin") {
    // Send them back to wherever *their* role actually belongs,
    // instead of just bouncing to /login (they're still logged in).
    const fallback =
      role === "doctor" ? "/doctor/dashboard" : "/reception/dashboard";
    return <Navigate to={fallback} replace />;
  }

  return children;
}