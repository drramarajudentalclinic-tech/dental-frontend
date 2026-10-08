import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/api";

// Medical Conditions, Allergy Records, Current Medications, Personal Habits
// and Women's Health: one shared component, the same records the Doctor sees.
import MedicalHistoryManager from "../components/MedicalHistoryManager";

export default function EditPatient() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [patient, setPatient] = useState({});

  useEffect(() => {
    loadPatient();
  }, []);

  const loadPatient = async () => {
    try {
      const res = await api.get(`/patients/${id}`);
      setPatient(res.data.patient);
      // Medical history is loaded by <MedicalHistoryManager> itself.
    } catch {
      alert("Failed to load patient");
    }
  };

  const updatePatient = async () => {
    try {
      await api.put(`/patients/${id}`, patient);

      // Medical history is not re-sent from here. Every condition, allergy,
      // medication, habit and women's-health entry is its own record and is
      // saved by its own Add / Update / Delete button in the section below,
      // so saving this page can never overwrite what the Doctor entered.

      alert("Patient updated successfully");
      navigate("/reception");
    } catch {
      alert("Update failed");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Edit Patient</h2>

      {Object.keys(patient).map(k =>
        k !== "gender" ? (
          <input
            key={k}
            value={patient[k] || ""}
            placeholder={k.replace("_", " ").toUpperCase()}
            onChange={e => setPatient({ ...patient, [k]: e.target.value })}
          />
        ) : (
          <select
            key="gender"
            value={patient.gender || ""}
            onChange={e => setPatient({ ...patient, gender: e.target.value })}
          >
            <option value="">Gender</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        )
      )}

      <textarea
        placeholder="Main Complaint"
        value={patient.complaint || ""}
        onChange={e => setPatient({ ...patient, complaint: e.target.value })}
      />

      <div style={{ margin: "20px 0" }}>
        <MedicalHistoryManager patientId={id} gender={patient.gender} />
      </div>

      <button onClick={updatePatient}>Update Patient</button>
      <button onClick={() => navigate(-1)}>Cancel</button>
    </div>
  );
}