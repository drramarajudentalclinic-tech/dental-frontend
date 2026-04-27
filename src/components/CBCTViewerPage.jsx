/**
 * CBCTViewerPage.jsx
 *
 * Standalone full-screen page rendered when the user clicks "View CBCT".
 * Register this route in your App.jsx / router config:
 *
 *   import CBCTViewerPage from "./CBCTViewerPage";
 *   <Route path="/cbct-viewer" element={<CBCTViewerPage />} />
 *
 * The page reads `?volumeId=<n>` from the URL and `apiBase` from
 * localStorage (set by CBCTSection before opening the tab).
 */

import React, { useEffect, useState } from "react";
import CBCTViewer from "./CBCTViewer";

export default function CBCTViewerPage() {
  const [volumeId, setVolumeId] = useState(null);
  const [apiBase,  setApiBase]  = useState("/api");
  const [ready,    setReady]    = useState(false);

  useEffect(() => {
    // ── Parse URL query params ────────────────────────────────────────────
    const params = new URLSearchParams(window.location.search);
    const vid    = Number(params.get("volumeId"));
    setVolumeId(vid || null);

    // ── Retrieve apiBase stored by CBCTSection ────────────────────────────
    try {
      const stored = localStorage.getItem("cbct_viewer_params");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.apiBase) setApiBase(parsed.apiBase);
      }
    } catch (_) {
      // ignore malformed JSON
    }

    // ── Full-screen body styles ───────────────────────────────────────────
    document.body.style.margin     = "0";
    document.body.style.padding    = "0";
    document.body.style.overflow   = "hidden";
    document.body.style.background = "#020617";

    // ── Tab title ─────────────────────────────────────────────────────────
    document.title = vid ? `CBCT Viewer — Volume #${vid}` : "CBCT Viewer";

    setReady(true);

    return () => {
      document.body.style.overflow   = "";
      document.body.style.background = "";
    };
  }, []);

  if (!ready) return null;

  if (!volumeId) {
    return (
      <div style={errorWrapStyle}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ color: "#ef4444", fontSize: 16, fontWeight: 700 }}>
          No volume ID provided.
        </div>
        <div style={{ color: "#475569", fontSize: 12 }}>
          Please open this page via the CBCT section of a visit.
        </div>
        <button style={closeBtn} onClick={() => window.close()}>
          Close tab
        </button>
      </div>
    );
  }

  return (
    <CBCTViewer
      volumeId={volumeId}
      apiBase={apiBase}
      onClose={() => window.close()}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const errorWrapStyle = {
  display: "flex", alignItems: "center", justifyContent: "center",
  flexDirection: "column", gap: 16,
  height: "100vh", background: "#020617",
  fontFamily: "'JetBrains Mono', monospace",
};

const closeBtn = {
  marginTop: 8, background: "#1e293b", border: "none", color: "#94a3b8",
  padding: "8px 20px", borderRadius: 8, cursor: "pointer",
  fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
};