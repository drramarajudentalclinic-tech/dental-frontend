import { useState } from "react";
import api from "../api/api";

export default function PatientSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);

  const search = async () => {
    // NOTE: the axios client's baseURL already includes /api, and the
    // real backend route is GET /api/patients/search?q=... — the
    // previous "/api/patients/search" path doubled up to
    // "<baseURL>/api/api/patients/search", which 404s.
    const res = await api.get("/patients/search", { params: { q } });
    setResults(res.data || []);
  };

  return (
    <>
      <input onChange={e => setQ(e.target.value)} placeholder="Search patient" />
      <button onClick={search}>Search</button>

      <ul>
        {results.map(p => (
          // search_patients() returns patient_id, not id
          <li key={p.patient_id}>{p.name} ({p.case_number})</li>
        ))}
      </ul>
    </>
  );
}