/**
 * CBCTSection.jsx  –  CBCT management panel (embedded in visit page)
 *
 * Features:
 *   • ZIP upload with real progress animation
 *   • Volume list with metadata chips (aligned with _serialize_vol shape)
 *   • Opens CBCTViewer in a full-screen new tab via CBCTViewerPage
 *   • Delete with confirmation
 *   • Refresh
 *   • Export composite PNG download
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "/api";

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}
function authHeaders(extra = {}) {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, ...extra } : extra;
}

export default function CBCTSection({ visitId, apiBase = API }) {
  const [volumes,   setVolumes]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState("");
  const [error,     setError]     = useState(null);
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef = useRef(null);

  // ── Load volumes ─────────────────────────────────────────────────────────
  const loadVolumes = useCallback(() => {
    setLoading(true);
    fetch(`${apiBase}/visits/${visitId}/cbct`, { headers: authHeaders() })
      .then(r => {
        if (!r.ok) throw new Error(`Server ${r.status}`);
        return r.json();
      })
      .then(data => {
        // Backend returns { visit_id, cbct_files: [...] }
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data.cbct_files)
            ? data.cbct_files
            : [];
        setVolumes(list);
        setError(null);
      })
      .catch(e => setError(`Failed to load CBCT volumes: ${e.message}`))
      .finally(() => setLoading(false));
  }, [visitId, apiBase]);

  useEffect(() => { loadVolumes(); }, [loadVolumes]);

  // ── Open viewer in new tab ─────────────────────────────────────────────
  const openViewer = (volumeId) => {
    localStorage.setItem("cbct_viewer_params", JSON.stringify({ volumeId, apiBase }));
    window.open(
      `${window.location.origin}/cbct-viewer?volumeId=${volumeId}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // ── Export PNG ────────────────────────────────────────────────────────────
  const exportPng = async (volumeId) => {
    try {
      const res = await fetch(`${apiBase}/cbct/${volumeId}/export/png`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `cbct_${volumeId}_export.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e.message}`);
    }
  };

  // ── Upload ────────────────────────────────────────────────────────────────
  const STAGES = [
    "Reading DICOM headers…",
    "Building axial stack…",
    "Generating coronal MPR…",
    "Generating sagittal MPR…",
    "Applying HU calibration…",
    "Storing volume…",
  ];

  const doUpload = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Please select a .zip file containing DICOM files.");
      return;
    }
    setError(null);
    setUploading(true);
    setUploadPct(3);
    setUploadMsg(STAGES[0]);

    const form = new FormData();
    form.append("file", file);
    form.append("uploaded_by", "USER");

    let stage = 0;
    const interval = setInterval(() => {
      stage = Math.min(stage + 1, STAGES.length - 1);
      setUploadMsg(STAGES[stage]);
      setUploadPct(p => Math.min(p + (90 - p) * 0.25 + Math.random() * 4, 88));
    }, 900);

    try {
      const res = await fetch(`${apiBase}/visits/${visitId}/cbct`, {
        method:  "POST",
        headers: authHeaders(),
        body:    form,
      });
      clearInterval(interval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      // Backend returns { cbct: { ... }, num_slices: N }
      const numSlices = data.cbct?.num_slices ?? data.num_slices ?? "?";
      setUploadPct(100);
      setUploadMsg(`✓ Done — ${numSlices} axial slices ready`);

      setTimeout(() => {
        setUploading(false);
        setUploadPct(0);
        setUploadMsg("");
        loadVolumes();
        // Clear file input so the same file can be re-uploaded if needed
        if (fileRef.current) fileRef.current.value = "";
      }, 1800);
    } catch (e) {
      clearInterval(interval);
      setError(e.message);
      setUploading(false);
      setUploadPct(0);
    }
  }, [visitId, apiBase, loadVolumes]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteVolume = async (id) => {
    if (!window.confirm("Delete this CBCT volume and all annotations? This cannot be undone.")) return;
    try {
      const res = await fetch(`${apiBase}/cbct/${id}`, {
        method:  "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      loadVolumes();
    } catch (e) {
      setError(`Failed to delete volume: ${e.message}`);
    }
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmtDate = (d) => {
    if (!d) return null;
    // DICOM "20241105" → "05 Nov 2024"
    if (/^\d{8}$/.test(d)) {
      const dt = new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
      return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }
    return d;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>

      {/* ── Upload zone ── */}
      <div
        style={{ ...s.dropZone, ...(dragOver ? s.dropZoneActive : {}), ...(uploading ? s.dropZoneBusy : {}) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={e => doUpload(e.target.files[0])}
        />

        {uploading ? (
          <div style={s.uploadWrap}>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${uploadPct}%` }} />
            </div>
            <p style={s.uploadMsg}>{uploadMsg}</p>
            <p style={s.uploadPct}>{Math.round(uploadPct)}%</p>
          </div>
        ) : (
          <div style={s.dropContent}>
            <div style={s.dropIconWrap}>
              <span style={s.dropIcon}>🗜️</span>
              <span style={s.dropIconPulse} />
            </div>
            <p style={s.dropTitle}>Drop CBCT ZIP here</p>
            <p style={s.dropSub}>
              DICOM files inside a .zip archive · Auto-generates Axial · Coronal · Sagittal
            </p>
            <button style={s.browseBtn}>Browse file</button>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={s.errorBox}>
          <span>⚠️ {error}</span>
          <button style={s.clearBtn} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── Volume list header ── */}
      <div style={s.listHeader}>
        <div style={s.listTitle}>
          CBCT Volumes
          {volumes.length > 0 && (
            <span style={s.volumeCount}>{volumes.length}</span>
          )}
        </div>
        <button style={s.refreshBtn} onClick={loadVolumes} title="Refresh">
          ↺ Refresh
        </button>
      </div>

      {/* ── Volume list ── */}
      {loading ? (
        <div style={s.empty}>
          <div style={s.loadingDots}><span /><span /><span /></div>
        </div>
      ) : volumes.length === 0 ? (
        <div style={s.empty}>
          No CBCT volumes yet. Upload a .zip file above to get started.
        </div>
      ) : (
        <div style={s.list}>
          {volumes.map(vol => (
            <div key={vol.id} style={s.volCard}>
              <div style={s.volIconWrap}>
                <span style={s.volIcon}>🦷</span>
              </div>

              <div style={s.volInfo}>
                <div style={s.volNameRow}>
                  <span style={s.volName}>{vol.patient_name || "CBCT Volume"}</span>
                  {vol.num_slices > 0 && (
                    <span style={s.volBadge}>{vol.num_slices} sl</span>
                  )}
                  {vol.modality && (
                    <span style={s.volBadge2}>{vol.modality}</span>
                  )}
                </div>

                <div style={s.volMeta}>
                  {vol.study_date && (
                    <span style={s.metaChip}>📅 {fmtDate(vol.study_date)}</span>
                  )}
                  {/* dimensions comes from _serialize_vol as { depth, rows, cols } */}
                  {vol.dimensions?.rows > 0 && (
                    <span style={s.metaChip}>
                      {vol.dimensions.rows}×{vol.dimensions.cols}
                    </span>
                  )}
                  {/* voxel_spacing comes from _serialize_vol as { x, y, z } */}
                  {vol.voxel_spacing?.x > 0 && (
                    <span style={s.metaChip}>
                      {vol.voxel_spacing.x.toFixed(2)} mm/vx
                    </span>
                  )}
                  {vol.institution && (
                    <span style={s.metaChip}>🏥 {vol.institution}</span>
                  )}
                  {vol.uploaded_at && (
                    <span style={s.metaChip}>⬆ {vol.uploaded_at}</span>
                  )}
                </div>

                {vol.notes && (
                  <div style={s.volNotes}>📝 {vol.notes}</div>
                )}
              </div>

              <div style={s.volActions}>
                <button
                  style={s.openBtn}
                  onClick={() => openViewer(vol.id)}
                  title="Open full CBCT viewer in new tab"
                >
                  🖥 View CBCT
                </button>
                <button
                  style={s.exportBtn}
                  onClick={() => exportPng(vol.id)}
                  title="Export composite PNG"
                >
                  📷
                </button>
                <button
                  style={s.delBtn}
                  onClick={() => deleteVolume(vol.id)}
                  title="Delete volume"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Feature legend ── */}
      <div style={s.legend}>
        {[
          ["↕", "Scroll slices"],
          ["↔", "Distance measure"],
          ["∠", "Angle measure"],
          ["◑", "Window/Level"],
          ["⊥", "Implant planning"],
          ["~", "IAN nerve trace"],
          ["⬤", "HU density probe"],
          ["💾", "Save annotations"],
        ].map(([icon, label]) => (
          <div key={label} style={s.legendItem}>
            <span style={s.legendIcon}>{icon}</span>
            <span style={s.legendLabel}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const BLUE   = "#3b82f6";
const DARK   = "#0f172a";
const BORDER = "#1e293b";
const MUTED  = "#64748b";

const s = {
  root: {
    display: "flex", flexDirection: "column", gap: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },

  // Drop zone
  dropZone: {
    border: `2px dashed ${BORDER}`, borderRadius: 14,
    padding: "28px 20px", textAlign: "center", cursor: "pointer",
    background: "#f8fafc06", transition: "all 0.25s", userSelect: "none",
    position: "relative", overflow: "hidden",
  },
  dropZoneActive: { borderColor: BLUE, background: "#1d4ed80d" },
  dropZoneBusy:   { cursor: "wait", pointerEvents: "none" },
  dropContent:    { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  dropIconWrap:   { position: "relative", display: "inline-block" },
  dropIcon:       { fontSize: 36 },
  dropIconPulse: {
    position: "absolute", inset: -4, borderRadius: "50%",
    border: `1px solid ${BORDER}`, opacity: 0.4,
    animation: "pulse 2s ease-in-out infinite",
  },
  dropTitle: { fontSize: 14, fontWeight: 700, color: "#e2e8f0", margin: 0 },
  dropSub:   { fontSize: 11, color: MUTED, margin: 0, lineHeight: 1.6 },
  browseBtn: {
    marginTop: 4, background: BORDER, border: "none", color: "#94a3b8",
    padding: "5px 14px", borderRadius: 6, fontSize: 11, cursor: "pointer",
    fontFamily: "inherit",
  },

  // Upload progress
  uploadWrap:    { width: "100%", maxWidth: 400, margin: "0 auto", textAlign: "center" },
  progressTrack: { height: 5, background: BORDER, borderRadius: 10, overflow: "hidden", marginBottom: 10 },
  progressFill:  {
    height: "100%", background: `linear-gradient(90deg, #2563eb, ${BLUE})`,
    transition: "width 0.5s ease", borderRadius: 10,
  },
  uploadMsg: { color: "#60a5fa", fontSize: 12, margin: "0 0 4px", fontWeight: 600 },
  uploadPct: { color: MUTED, fontSize: 11, margin: 0 },

  // Error
  errorBox: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 8,
    padding: "10px 14px", color: "#fca5a5", fontSize: 12,
  },
  clearBtn: {
    background: "transparent", border: "none", color: "#fca5a5",
    cursor: "pointer", fontSize: 16, padding: 0,
  },

  // List header
  listHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  listTitle: {
    fontSize: 13, fontWeight: 700, color: "#e2e8f0",
    display: "flex", alignItems: "center", gap: 7,
  },
  volumeCount: {
    background: "#1d4ed8", color: "#93c5fd", fontSize: 10,
    padding: "1px 7px", borderRadius: 10,
  },
  refreshBtn: {
    background: "transparent", border: `1px solid ${BORDER}`,
    color: MUTED, padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
    fontFamily: "inherit",
  },

  // Empty / loading
  empty:       { color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" },
  loadingDots: { display: "flex", gap: 5, justifyContent: "center" },

  // Volume list
  list:    { display: "flex", flexDirection: "column", gap: 7 },
  volCard: {
    display: "flex", alignItems: "center", gap: 12,
    background: DARK, border: `1px solid ${BORDER}`,
    borderRadius: 11, padding: "13px 15px",
    transition: "border-color 0.15s",
  },
  volIconWrap: {
    width: 40, height: 40, borderRadius: 10, background: "#1e293b",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  volIcon:    { fontSize: 20 },
  volInfo:    { flex: 1, minWidth: 0 },
  volNameRow: { display: "flex", alignItems: "center", gap: 7, marginBottom: 5 },
  volName:    { fontSize: 13, fontWeight: 600, color: "#e2e8f0" },
  volBadge: {
    background: "#1d4ed8", color: "#93c5fd", fontSize: 9,
    padding: "2px 7px", borderRadius: 10, fontWeight: 600,
  },
  volBadge2: {
    background: "#1e3a8a22", color: "#60a5fa", fontSize: 9,
    padding: "2px 6px", borderRadius: 8, border: "1px solid #1d4ed844",
  },
  volMeta:  { display: "flex", gap: 5, flexWrap: "wrap" },
  metaChip: {
    color: MUTED, fontSize: 10, background: "#ffffff06",
    padding: "2px 6px", borderRadius: 5,
  },
  volNotes:   { color: "#475569", fontSize: 10, marginTop: 5, fontStyle: "italic" },
  volActions: { display: "flex", gap: 7, flexShrink: 0 },
  openBtn: {
    background: BLUE, color: "#fff", border: "none",
    borderRadius: 8, padding: "8px 14px", fontSize: 12,
    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: "inherit", transition: "opacity 0.15s",
  },
  exportBtn: {
    background: "transparent", border: `1px solid ${BORDER}`,
    color: MUTED, borderRadius: 8, padding: "8px 10px",
    fontSize: 14, cursor: "pointer", title: "Export PNG",
  },
  delBtn: {
    background: "transparent", border: `1px solid #7f1d1d`,
    color: "#ef4444", borderRadius: 8, padding: "8px 10px",
    fontSize: 14, cursor: "pointer",
  },

  // Legend
  legend: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5,
    padding: "12px 14px",
    background: "#ffffff03", border: `1px solid ${BORDER}`,
    borderRadius: 10,
  },
  legendItem:  { display: "flex", gap: 7, alignItems: "center" },
  legendIcon:  { color: BLUE, fontSize: 13, width: 16, textAlign: "center" },
  legendLabel: { color: "#334155", fontSize: 10 },
};