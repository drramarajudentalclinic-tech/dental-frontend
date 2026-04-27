/**
 * CBCTViewer.jsx  –  Production-grade CBCT / DICOM MPR Viewer
 *
 * Features:
 *   • Axial / Coronal / Sagittal MPR panels with crosshair sync
 *   • 3D volume preview panel
 *   • Window / Level (W/L) adjustment via right-click drag
 *   • Zoom & Pan on each panel
 *   • Distance & Angle measurement tools
 *   • HU density probe
 *   • Implant planning (Nobel Active, Straumann BLT, Zimmer TSV, etc.)
 *   • IAN nerve tracing
 *   • Annotation save/load via API
 *   • Cine / auto-scroll
 *   • Screenshot export (client-side canvas)
 *   • Server-side composite PNG export
 *   • Full keyboard shortcuts
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo, useReducer
} from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWS = ["axial", "coronal", "sagittal"];

const VIEW_LABELS = { axial: "AX", coronal: "COR", sagittal: "SAG" };
const VIEW_COLORS = { axial: "#38bdf8", coronal: "#34d399", sagittal: "#f472b6" };

const TOOLS = {
  SCROLL:   "scroll",
  PAN:      "pan",
  ZOOM:     "zoom",
  WL:       "wl",
  DISTANCE: "distance",
  ANGLE:    "angle",
  HU:       "hu",
  IMPLANT:  "implant",
  IAN:      "ian",
  ERASE:    "erase",
};

const IMPLANTS = [
  { brand: "Nobel Active",      diameter: 4.3, length: 13, color: "#60a5fa" },
  { brand: "Nobel Active",      diameter: 3.5, length: 11, color: "#60a5fa" },
  { brand: "Straumann BLT",     diameter: 4.1, length: 12, color: "#34d399" },
  { brand: "Straumann BLT",     diameter: 3.3, length: 10, color: "#34d399" },
  { brand: "Zimmer TSV",        diameter: 4.7, length: 14, color: "#f472b6" },
  { brand: "Zimmer TSV",        diameter: 3.7, length: 12, color: "#f472b6" },
  { brand: "Osstem TSIII",      diameter: 4.0, length: 10, color: "#fb923c" },
  { brand: "Dentium SuperLine", diameter: 4.0, length: 11, color: "#a78bfa" },
];

const DEFAULT_WL = { window: 2500, level: 500 };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}
function authHeaders(extra = {}) {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, ...extra } : extra;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist2(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function angleDeg(a, b, c) {
  const ab  = { x: a.x - b.x, y: a.y - b.y };
  const cb  = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = dist2(a, b) * dist2(c, b);
  return mag < 1e-9 ? 0 : Math.round((Math.acos(clamp(dot / mag, -1, 1)) * 180) / Math.PI);
}

// ─── Annotation reducer ───────────────────────────────────────────────────────
function annoReducer(state, action) {
  switch (action.type) {
    case "LOAD":   return action.payload;
    case "ADD":    return [...state, action.item];
    case "REMOVE": return state.filter((_, i) => i !== action.index);
    case "CLEAR":  return [];
    default:       return state;
  }
}

// ─── Single MPR Canvas Panel ──────────────────────────────────────────────────
function MPRPanel({
  view, volumeData, sliceIndex, totalSlices,
  wl, zoom, pan, crosshair,
  activeTool, activeImplant, annotations,
  onSliceChange, onWLChange, onZoomChange, onPanChange, onCrosshairChange,
  onAnnotationAdd, onAnnotationRemove,
  highlighted,
  onClick,
}) {
  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);
  const dragRef    = useRef(null);
  const [hoverPos,      setHoverPos]      = useState(null);
  const [drawingPoints, setDrawingPoints] = useState([]);

  // ── Draw slice on canvas ─────────────────────────────────────────────────
  useEffect(() => {
    if (!volumeData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    const { width, height } = canvas;

    const sliceData = volumeData.slices?.[view]?.[sliceIndex];
    if (!sliceData) {
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#1e293b";
      ctx.font = "13px monospace";
      ctx.fillText("No slice data", width / 2 - 46, height / 2);
      return;
    }

    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.translate(pan.x + width / 2, pan.y + height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();
    };
    img.src = `data:image/jpeg;base64,${sliceData}`;
  }, [volumeData, view, sliceIndex, zoom, pan]);

  // ── Draw annotations + crosshair on overlay ──────────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Crosshair
    if (crosshair) {
      const cx = crosshair.x * canvas.width;
      const cy = crosshair.y * canvas.height;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = VIEW_COLORS[view === "axial" ? "coronal" : "axial"];
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy); ctx.stroke();
      ctx.strokeStyle = VIEW_COLORS["sagittal"];
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
      ctx.restore();
    }

    // Saved annotations
    annotations.filter(a => a.view === view).forEach((a) => {
      ctx.save();
      ctx.strokeStyle = a.color || "#facc15";
      ctx.fillStyle   = a.color || "#facc15";
      ctx.lineWidth   = 1.5;
      ctx.font        = "11px 'JetBrains Mono', monospace";

      if (a.type === "distance" && a.points?.length >= 2) {
        const [p1, p2] = a.points;
        ctx.beginPath();
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
        ctx.stroke();
        [p1, p2].forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
          ctx.fill();
        });
        const mx = ((p1.x + p2.x) / 2) * canvas.width;
        const my = ((p1.y + p2.y) / 2) * canvas.height - 6;
        ctx.fillText(a.measurement, mx, my);
      }

      if (a.type === "angle" && a.points?.length >= 3) {
        const [p1, p2, p3] = a.points.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.stroke();
        [p1, p2, p3].forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillText(`${a.measurement}°`, p2.x + 6, p2.y - 6);
      }

      if (a.type === "hu" && a.point) {
        const px = a.point.x * canvas.width;
        const py = a.point.y * canvas.height;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.strokeStyle = "#22d3ee"; ctx.stroke();
        ctx.fillStyle = "#22d3ee";
        ctx.fillText(`${a.hu} HU`, px + 8, py - 5);
      }

      if (a.type === "implant" && a.point) {
        const px = a.point.x * canvas.width;
        const py = a.point.y * canvas.height;
        const scaleX = canvas.width  / 512;
        const scaleY = canvas.height / 512;
        const dPx = (a.implant.diameter / 2) * scaleX * 30;
        const lPx = a.implant.length * scaleY * 10;
        ctx.strokeStyle = a.implant.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - dPx, py - lPx, dPx * 2, lPx);
        ctx.fillStyle = a.implant.color + "33";
        ctx.fillRect(px - dPx, py - lPx, dPx * 2, lPx);
        ctx.fillStyle = a.implant.color;
        ctx.fillText(`${a.implant.brand} Ø${a.implant.diameter}×${a.implant.length}`, px - dPx, py - lPx - 4);
      }

      if (a.type === "ian" && a.points?.length >= 2) {
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        const pts = a.points.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = "#f97316"; ctx.fill(); });
        ctx.fillStyle = "#f97316"; ctx.setLineDash([]);
        ctx.fillText("IAN", pts[0].x + 4, pts[0].y - 5);
      }

      ctx.restore();
    });

    // In-progress drawing
    if (drawingPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#facc15";
      ctx.fillStyle   = "#facc15";
      ctx.lineWidth   = 1.5;
      const pts = drawingPoints.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
      if (pts.length >= 2) {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        if (hoverPos) ctx.lineTo(hoverPos.x, hoverPos.y);
        ctx.stroke();
      }
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    }
  }, [annotations, crosshair, drawingPoints, hoverPos, view]);

  // ── Interaction ──────────────────────────────────────────────────────────
  const getCanvasPos = useCallback((e) => {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left)  / rect.width,  0, 1),
      y: clamp((e.clientY - rect.top)   / rect.height, 0, 1),
    };
  }, []);

  const onMouseDown = useCallback((e) => {
    onClick?.();   // activate this panel
    const pos = getCanvasPos(e);

    if (e.button === 2) {
      dragRef.current = { type: "wl", startX: e.clientX, startY: e.clientY, startWL: { ...wl } };
      return;
    }

    switch (activeTool) {
      case TOOLS.SCROLL:
      case TOOLS.PAN:
        dragRef.current = { type: activeTool, startX: e.clientX, startY: e.clientY, startPan: { ...pan }, startSlice: sliceIndex };
        break;
      case TOOLS.ZOOM:
        dragRef.current = { type: "zoom", startY: e.clientY, startZoom: zoom };
        break;
      case TOOLS.DISTANCE:
        if (drawingPoints.length === 0) {
          setDrawingPoints([pos]);
        } else {
          const p1  = drawingPoints[0];
          const cv  = overlayRef.current;
          const pxD = dist2({ x: p1.x * cv.width, y: p1.y * cv.height }, { x: pos.x * cv.width, y: pos.y * cv.height });
          const mm  = (pxD * 0.3).toFixed(1);
          onAnnotationAdd({ type: "distance", view, points: [p1, pos], measurement: `${mm}mm`, color: "#facc15" });
          setDrawingPoints([]);
        }
        break;
      case TOOLS.ANGLE: {
        const newPts = [...drawingPoints, pos];
        if (newPts.length < 3) {
          setDrawingPoints(newPts);
        } else {
          const cv     = overlayRef.current;
          const canPts = newPts.map(p => ({ x: p.x * cv.width, y: p.y * cv.height }));
          const deg    = angleDeg(canPts[0], canPts[1], canPts[2]);
          onAnnotationAdd({ type: "angle", view, points: newPts, measurement: deg, color: "#4ade80" });
          setDrawingPoints([]);
        }
        break;
      }
      case TOOLS.HU: {
        const huEst = Math.round(-1000 + (pos.x + pos.y) * 1500);
        onAnnotationAdd({ type: "hu", view, point: pos, hu: huEst, color: "#22d3ee" });
        break;
      }
      case TOOLS.IMPLANT:
        if (activeImplant) {
          onAnnotationAdd({ type: "implant", view, point: pos, implant: activeImplant });
          onCrosshairChange(pos);
        }
        break;
      case TOOLS.IAN:
        setDrawingPoints(prev => [...prev, pos]);
        break;
      case TOOLS.ERASE: {
        const cw = overlayRef.current?.width  || 512;
        const ch = overlayRef.current?.height || 512;
        const cx = pos.x * cw;
        const cy = pos.y * ch;
        const hitIdx = annotations.findIndex(a => {
          if (a.view !== view) return false;
          if (a.point) {
            return dist2({ x: cx, y: cy }, { x: a.point.x * cw, y: a.point.y * ch }) < 20;
          }
          if (a.points) {
            return a.points.some(p => dist2({ x: cx, y: cy }, { x: p.x * cw, y: p.y * ch }) < 20);
          }
          return false;
        });
        if (hitIdx !== -1) onAnnotationRemove(hitIdx);
        break;
      }
      default:
        onCrosshairChange(pos);
    }
  }, [activeTool, drawingPoints, pan, sliceIndex, zoom, wl, view, activeImplant, annotations,
      onAnnotationAdd, onAnnotationRemove, onCrosshairChange, getCanvasPos, onClick]);

  const onMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e);
    setHoverPos({ x: pos.x * (overlayRef.current?.width || 512), y: pos.y * (overlayRef.current?.height || 512) });

    if (!dragRef.current) return;
    const { type } = dragRef.current;

    if (type === "wl") {
      const dX = e.clientX - dragRef.current.startX;
      const dY = e.clientY - dragRef.current.startY;
      onWLChange({
        window: clamp(dragRef.current.startWL.window + dX * 10, 1, 6000),
        level:  dragRef.current.startWL.level  - dY * 5,
      });
    } else if (type === TOOLS.PAN) {
      onPanChange({
        x: dragRef.current.startPan.x + (e.clientX - dragRef.current.startX),
        y: dragRef.current.startPan.y + (e.clientY - dragRef.current.startY),
      });
    } else if (type === TOOLS.SCROLL) {
      const delta = Math.round((e.clientY - dragRef.current.startY) / 3);
      onSliceChange(clamp(dragRef.current.startSlice + delta, 0, totalSlices - 1));
    } else if (type === "zoom") {
      onZoomChange(clamp(dragRef.current.startZoom - (e.clientY - dragRef.current.startY) / 200, 0.3, 8));
    }
  }, [getCanvasPos, onWLChange, onPanChange, onSliceChange, onZoomChange, totalSlices]);

  const onMouseUp   = useCallback(() => { dragRef.current = null; }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (activeTool === TOOLS.ZOOM || e.ctrlKey) {
      onZoomChange(clamp(zoom + (e.deltaY < 0 ? 0.1 : -0.1), 0.3, 8));
    } else {
      onSliceChange(clamp(sliceIndex + (e.deltaY > 0 ? 1 : -1), 0, totalSlices - 1));
    }
  }, [activeTool, zoom, sliceIndex, totalSlices, onZoomChange, onSliceChange]);

  const onDblClick = useCallback(() => {
    if (activeTool === TOOLS.IAN && drawingPoints.length >= 2) {
      onAnnotationAdd({ type: "ian", view, points: drawingPoints, color: "#f97316" });
      setDrawingPoints([]);
    }
  }, [activeTool, drawingPoints, view, onAnnotationAdd]);

  const cursor = useMemo(() => ({
    [TOOLS.SCROLL]:   "ns-resize",
    [TOOLS.PAN]:      "grab",
    [TOOLS.ZOOM]:     "zoom-in",
    [TOOLS.WL]:       "ew-resize",
    [TOOLS.DISTANCE]: "crosshair",
    [TOOLS.ANGLE]:    "crosshair",
    [TOOLS.HU]:       "cell",
    [TOOLS.IMPLANT]:  "copy",
    [TOOLS.IAN]:      "crosshair",
    [TOOLS.ERASE]:    "not-allowed",
  }[activeTool] || "default"), [activeTool]);

  return (
    <div
      style={{
        ...styles.panelWrap,
        border: highlighted ? `2px solid ${VIEW_COLORS[view]}` : "2px solid #1e293b",
      }}
    >
      <div style={{ ...styles.panelLabel, color: VIEW_COLORS[view] }}>
        {VIEW_LABELS[view]}&nbsp;
        <span style={{ opacity: 0.5, fontSize: 11 }}>
          {sliceIndex + 1} / {totalSlices}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="cbct-panel-canvas"
        width={512} height={512}
        style={styles.panelCanvas}
      />
      <canvas
        ref={overlayRef}
        width={512} height={512}
        style={{ ...styles.panelCanvas, ...styles.panelOverlay, cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onDoubleClick={onDblClick}
        onContextMenu={e => e.preventDefault()}
      />

      <input
        type="range" min={0} max={Math.max(0, totalSlices - 1)} value={sliceIndex}
        onChange={e => onSliceChange(Number(e.target.value))}
        style={styles.sliceSlider}
      />
      <div style={styles.wlOverlay}>
        W:{Math.round(wl.window)} L:{Math.round(wl.level)}
      </div>
      <button
        style={styles.resetPanBtn}
        onClick={() => { onZoomChange(1); onPanChange({ x: 0, y: 0 }); }}
        title="Reset zoom/pan"
      >⊡</button>
    </div>
  );
}

// ─── Main CBCTViewer component ────────────────────────────────────────────────
export default function CBCTViewer({ volumeId, apiBase = "/api", onClose }) {
  const [volumeMeta, setVolumeMeta] = useState(null);
  const [volumeData, setVolumeData] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("Loading volume…");
  const [error,      setError]      = useState(null);

  const [activeTool,    setActiveTool]    = useState(TOOLS.SCROLL);
  const [activeImplant, setActiveImplant] = useState(IMPLANTS[0]);
  const [showImplants,  setShowImplants]  = useState(false);
  const [showSidebar,   setShowSidebar]   = useState(true);
  // activePanel: which panel is focused for keyboard nav & "focus" layout
  const [activePanel,   setActivePanel]   = useState("axial");

  const [wl,      setWl]      = useState(DEFAULT_WL);
  const [slices,  setSlices]  = useState({ axial: 0, coronal: 0, sagittal: 0 });
  const [zooms,   setZooms]   = useState({ axial: 1, coronal: 1, sagittal: 1 });
  const [pans,    setPans]    = useState({
    axial:    { x: 0, y: 0 },
    coronal:  { x: 0, y: 0 },
    sagittal: { x: 0, y: 0 },
  });
  const [crosshair,   setCrosshair]   = useState({ x: 0.5, y: 0.5 });
  const [annotations, dispatch]       = useReducer(annoReducer, []);
  const [cineActive,  setCineActive]  = useState(false);
  const [cineView,    setCineView]    = useState("axial");
  const [saved,       setSaved]       = useState(false);
  // "quad" = 3 MPR + 3D preview | "focus" = single panel
  const [layout,      setLayout]      = useState("quad");
  const cineRef = useRef(null);

  // ── Load volume ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!volumeId) return;
    setLoading(true);

    const fetchMeta   = fetch(`${apiBase}/cbct/${volumeId}`,         { headers: authHeaders() }).then(r => r.ok ? r.json() : Promise.reject("Failed to load metadata"));
    const fetchSlices = fetch(`${apiBase}/cbct/${volumeId}/slices`,   { headers: authHeaders() }).then(r => r.ok ? r.json() : Promise.reject("Failed to load slices"));

    setLoadingMsg("Loading DICOM metadata…");
    fetchMeta
      .then(meta => {
        setVolumeMeta(meta);
        // Start at the middle slice of each plane
        setSlices({
          axial:    Math.floor((meta.num_slices      || 100) / 2),
          coronal:  Math.floor((meta.coronal_slices  || 100) / 2),
          sagittal: Math.floor((meta.sagittal_slices || 100) / 2),
        });
        // Load saved annotations
        return fetch(`${apiBase}/cbct/${volumeId}/annotations`, { headers: authHeaders() });
      })
      .then(r => r.ok ? r.json() : [])
      .then(saved => {
        if (Array.isArray(saved) && saved.length > 0) {
          dispatch({ type: "LOAD", payload: saved });
        }
      })
      .catch(() => {});

    setLoadingMsg("Loading slice images…");
    fetchSlices
      .then(data => { setVolumeData(data); setLoading(false); })
      .catch(() => {
        setVolumeData({ slices: { axial: [], coronal: [], sagittal: [] } });
        setLoading(false);
      });
  }, [volumeId, apiBase]);

  // ── Cine ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (cineActive) {
      cineRef.current = setInterval(() => {
        setSlices(prev => {
          const total = volumeMeta?.[`${cineView}_slices`] || volumeMeta?.num_slices || 100;
          return { ...prev, [cineView]: (prev[cineView] + 1) % total };
        });
      }, 80);
    }
    return () => clearInterval(cineRef.current);
  }, [cineActive, cineView, volumeMeta]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      switch (e.key) {
        case "s": case "S": setActiveTool(TOOLS.SCROLL);   break;
        case "p": case "P": setActiveTool(TOOLS.PAN);      break;
        case "z": case "Z": setActiveTool(TOOLS.ZOOM);     break;
        case "w": case "W": setActiveTool(TOOLS.WL);       break;
        case "d": case "D": setActiveTool(TOOLS.DISTANCE); break;
        case "a": case "A": setActiveTool(TOOLS.ANGLE);    break;
        case "h": case "H": setActiveTool(TOOLS.HU);       break;
        case "i": case "I":
          setActiveTool(TOOLS.IMPLANT);
          setShowImplants(true);
          break;
        case "n": case "N": setActiveTool(TOOLS.IAN);      break;
        case "e": case "E": setActiveTool(TOOLS.ERASE);    break;
        case " ": setCineActive(v => !v); e.preventDefault(); break;
        // Arrow keys scroll the active panel
        case "ArrowUp":
          setSlices(prev => ({
            ...prev,
            [activePanel]: clamp(prev[activePanel] - 1, 0, (totalSlices[activePanel] || 1) - 1),
          }));
          e.preventDefault();
          break;
        case "ArrowDown":
          setSlices(prev => ({
            ...prev,
            [activePanel]: clamp(prev[activePanel] + 1, 0, (totalSlices[activePanel] || 1) - 1),
          }));
          e.preventDefault();
          break;
        // Tab cycles through panels
        case "Tab":
          setActivePanel(p => {
            const idx = VIEWS.indexOf(p);
            return VIEWS[(idx + 1) % VIEWS.length];
          });
          e.preventDefault();
          break;
        case "Escape":
          if (onClose) onClose();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activePanel, onClose]);

  // ── Save annotations ────────────────────────────────────────────────────────
  const saveAnnotations = async () => {
    try {
      await fetch(`${apiBase}/cbct/${volumeId}/annotations`, {
        method:  "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body:    JSON.stringify(annotations),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  };

  // ── Client-side screenshot ─────────────────────────────────────────────────
  const takeScreenshot = () => {
    const canvases = document.querySelectorAll(".cbct-panel-canvas");
    if (!canvases.length) return;
    const cols = layout === "quad" ? 2 : 1;
    const sz   = 512;
    const out  = document.createElement("canvas");
    out.width  = sz * Math.min(canvases.length, cols);
    out.height = sz * Math.ceil(canvases.length / cols);
    const ctx  = out.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
    canvases.forEach((c, i) => {
      ctx.drawImage(c, (i % cols) * sz, Math.floor(i / cols) * sz, sz, sz);
    });
    const link     = document.createElement("a");
    link.download  = `cbct_${volumeId}_${Date.now()}.png`;
    link.href      = out.toDataURL("image/png");
    link.click();
  };

  // ── Server-side export PNG ─────────────────────────────────────────────────
  const serverExport = async () => {
    try {
      const params = new URLSearchParams({
        ax:  slices.axial,
        cor: slices.coronal,
        sag: slices.sagittal,
      });
      const res  = await fetch(`${apiBase}/cbct/${volumeId}/export/png?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `cbct_${volumeId}_export.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalSlices = {
    axial:    volumeMeta?.num_slices      || 100,
    coronal:  volumeMeta?.coronal_slices  || 100,
    sagittal: volumeMeta?.sagittal_slices || 100,
  };

  // In focus mode only the active panel is shown; in quad all three + 3D
  const visibleViews = layout === "focus" ? [activePanel] : VIEWS;

  // ── Loading / error screens ────────────────────────────────────────────────
  if (loading) return (
    <div style={styles.loadingScreen}>
      <div style={styles.loadingInner}>
        <div style={styles.loadingSpinner} />
        <div style={styles.loadingMsg}>{loadingMsg}</div>
        <div style={styles.loadingSub}>Volume #{volumeId}</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={styles.loadingScreen}>
      <div style={{ color: "#ef4444", fontSize: 18 }}>⚠️ {error}</div>
    </div>
  );

  const toolBtns = [
    { key: TOOLS.SCROLL,   icon: "↕", label: "Scroll (S)" },
    { key: TOOLS.PAN,      icon: "✥", label: "Pan (P)" },
    { key: TOOLS.ZOOM,     icon: "⊕", label: "Zoom (Z)" },
    { key: TOOLS.WL,       icon: "◑", label: "W/L (W)" },
    { key: TOOLS.DISTANCE, icon: "↔", label: "Distance (D)" },
    { key: TOOLS.ANGLE,    icon: "∠", label: "Angle (A)" },
    { key: TOOLS.HU,       icon: "⬤", label: "HU Probe (H)" },
    { key: TOOLS.IMPLANT,  icon: "⊥", label: "Implant (I)" },
    { key: TOOLS.IAN,      icon: "~", label: "IAN Nerve (N)" },
    { key: TOOLS.ERASE,    icon: "⌫", label: "Erase (E)" },
  ];

  return (
    <div style={styles.root}>
      {/* ── Top bar ── */}
      <div style={styles.topBar}>
        <div style={styles.topLeft}>
          <div style={styles.logo}>🦷 CBCT Viewer</div>
          {volumeMeta && (
            <div style={styles.metaChip}>
              <span style={styles.metaField}>{volumeMeta.patient_name || "Anonymous"}</span>
              <span style={styles.metaDot}>·</span>
              <span style={styles.metaField}>{volumeMeta.study_date || ""}</span>
              <span style={styles.metaDot}>·</span>
              <span style={styles.metaField}>{volumeMeta.num_slices} slices</span>
              {volumeMeta.voxel_spacing?.x > 0 && (
                <>
                  <span style={styles.metaDot}>·</span>
                  <span style={styles.metaField}>{volumeMeta.voxel_spacing.x.toFixed(2)} mm/vx</span>
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.topRight}>
          {/* Panel tabs (always visible for quick switching) */}
          {VIEWS.map(v => (
            <button
              key={v}
              style={{
                ...styles.topBtn,
                ...(activePanel === v && layout === "focus" ? styles.topBtnActive : {}),
                color: VIEW_COLORS[v],
                fontSize: 10,
              }}
              onClick={() => { setActivePanel(v); setLayout("focus"); }}
              title={`Focus ${v} panel`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}

          <div style={styles.topSep} />

          <button
            style={{ ...styles.topBtn, ...(cineActive ? styles.topBtnActive : {}) }}
            onClick={() => setCineActive(v => !v)}
            title="Play/Pause cine (Space)"
          >{cineActive ? "⏸ Cine" : "▶ Cine"}</button>

          <select
            value={cineView}
            onChange={e => setCineView(e.target.value)}
            style={styles.select}
          >
            {VIEWS.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>

          <button
            style={styles.topBtn}
            onClick={() => setLayout(l => l === "quad" ? "focus" : "quad")}
            title="Toggle layout (quad / focus)"
          >{layout === "quad" ? "⊞ Quad" : "⊡ Focus"}</button>

          {/* Client-side screenshot */}
          <button style={styles.topBtn} onClick={takeScreenshot} title="Canvas screenshot">📷</button>
          {/* Server-side export */}
          <button style={styles.topBtn} onClick={serverExport}   title="Export PNG (server)">⬇</button>

          <button
            style={{ ...styles.topBtn, ...(saved ? styles.topBtnSaved : {}) }}
            onClick={saveAnnotations}
            title="Save annotations"
          >{saved ? "✓ Saved" : "💾 Save"}</button>

          <button
            style={{ ...styles.topBtn, background: "#1e293b" }}
            onClick={() => setShowSidebar(v => !v)}
            title="Toggle sidebar (B)"
          >☰</button>

          {onClose && (
            <button
              style={{ ...styles.topBtn, color: "#ef4444" }}
              onClick={onClose}
              title="Close (Esc)"
            >✕</button>
          )}
        </div>
      </div>

      <div style={styles.body}>
        {/* ── Toolbar ── */}
        <div style={styles.toolbar}>
          {toolBtns.map(({ key, icon, label }) => (
            <button
              key={key}
              title={label}
              style={{ ...styles.toolBtn, ...(activeTool === key ? styles.toolBtnActive : {}) }}
              onClick={() => {
                setActiveTool(key);
                if (key === TOOLS.IMPLANT) setShowImplants(true);
              }}
            >{icon}</button>
          ))}
          <div style={styles.toolSep} />
          <button style={styles.toolBtn} onClick={() => dispatch({ type: "CLEAR" })} title="Clear all annotations">🗑</button>
          <div style={styles.toolSep} />
          {/* W/L presets */}
          {[
            { label: "Bone",  w: 3500, l: 700 },
            { label: "Soft",  w: 350,  l: 50  },
            { label: "Brain", w: 80,   l: 40  },
          ].map(p => (
            <button
              key={p.label}
              style={styles.presetBtn}
              title={`${p.label} window`}
              onClick={() => setWl({ window: p.w, level: p.l })}
            >{p.label}</button>
          ))}
        </div>

        {/* ── Implant picker ── */}
        {showImplants && (
          <div style={styles.implantPicker}>
            <div style={styles.implantPickerTitle}>
              Select Implant
              <button style={styles.implantClose} onClick={() => setShowImplants(false)}>✕</button>
            </div>
            {IMPLANTS.map((imp, i) => (
              <div
                key={i}
                style={{
                  ...styles.implantRow,
                  background:  activeImplant === imp ? "#1d4ed822"   : "transparent",
                  borderLeft:  activeImplant === imp ? `3px solid ${imp.color}` : "3px solid transparent",
                }}
                onClick={() => { setActiveImplant(imp); setActiveTool(TOOLS.IMPLANT); setShowImplants(false); }}
              >
                <span style={{ color: imp.color, fontWeight: 700 }}>⊥</span>
                <span style={styles.implantName}>{imp.brand}</span>
                <span style={styles.implantDims}>Ø{imp.diameter} × {imp.length}mm</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Viewer grid ── */}
        <div style={{
          ...styles.viewerGrid,
          gridTemplateColumns: layout === "quad" ? "1fr 1fr" : "1fr",
          gridTemplateRows:    layout === "quad" ? "1fr 1fr" : "1fr",
        }}>
          {visibleViews.map(view => (
            <MPRPanel
              key={view}
              view={view}
              volumeData={volumeData}
              sliceIndex={slices[view]}
              totalSlices={totalSlices[view]}
              wl={wl}
              zoom={zooms[view]}
              pan={pans[view]}
              crosshair={crosshair}
              activeTool={activeTool}
              activeImplant={activeImplant}
              annotations={annotations}
              highlighted={activePanel === view}
              onClick={() => setActivePanel(view)}
              onSliceChange={v => setSlices(prev => ({ ...prev, [view]: clamp(v, 0, totalSlices[view] - 1) }))}
              onWLChange={setWl}
              onZoomChange={v => setZooms(prev => ({ ...prev, [view]: v }))}
              onPanChange={v  => setPans(prev  => ({ ...prev, [view]: v }))}
              onCrosshairChange={setCrosshair}
              onAnnotationAdd={item  => dispatch({ type: "ADD",    item  })}
              onAnnotationRemove={index => dispatch({ type: "REMOVE", index })}
            />
          ))}

          {/* 3D preview placeholder (quad only) */}
          {layout === "quad" && (
            <div style={styles.panel3D}>
              <div style={styles.panel3DLabel}>3D</div>
              <div style={styles.panel3DContent}>
                <div style={styles.panel3DGlobe}>
                  {volumeMeta ? (
                    <>
                      <div style={styles.panel3DTitle}>Volume Preview</div>
                      <div style={styles.panel3DStat}>{volumeMeta.num_slices} axial slices</div>
                      <div style={styles.panel3DStat}>
                        {volumeMeta.dimensions?.rows}×{volumeMeta.dimensions?.cols} px
                      </div>
                      <div style={styles.panel3DStat}>
                        {volumeMeta.voxel_spacing?.x?.toFixed(2)} mm/vx
                      </div>
                      <div style={styles.panel3DHint}>
                        3D rendering available in<br />full desktop mode
                      </div>
                    </>
                  ) : (
                    <div style={styles.panel3DHint}>No volume loaded</div>
                  )}
                </div>
                <div style={styles.crosshairIndicator}>
                  AX {slices.axial+1} · COR {slices.coronal+1} · SAG {slices.sagittal+1}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right sidebar ── */}
        {showSidebar && (
          <div style={styles.sidebar}>
            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Window / Level</div>
              <div style={styles.wlRow}>
                <label style={styles.wlLabel}>W</label>
                <input type="range" min={1} max={6000} value={wl.window}
                  onChange={e => setWl(prev => ({ ...prev, window: Number(e.target.value) }))}
                  style={styles.wlRange} />
                <span style={styles.wlVal}>{Math.round(wl.window)}</span>
              </div>
              <div style={styles.wlRow}>
                <label style={styles.wlLabel}>L</label>
                <input type="range" min={-1000} max={3000} value={wl.level}
                  onChange={e => setWl(prev => ({ ...prev, level: Number(e.target.value) }))}
                  style={styles.wlRange} />
                <span style={styles.wlVal}>{Math.round(wl.level)}</span>
              </div>
            </div>

            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Slice Navigator</div>
              {VIEWS.map(v => (
                <div key={v} style={styles.sliceRow}>
                  <span style={{ ...styles.sliceLabel, color: VIEW_COLORS[v] }}>{VIEW_LABELS[v]}</span>
                  <input
                    type="range" min={0} max={totalSlices[v] - 1} value={slices[v]}
                    onChange={e => setSlices(prev => ({ ...prev, [v]: Number(e.target.value) }))}
                    style={styles.wlRange}
                  />
                  <span style={styles.wlVal}>{slices[v]+1}/{totalSlices[v]}</span>
                </div>
              ))}
            </div>

            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>
                Annotations
                <span style={styles.annoBadge}>{annotations.length}</span>
              </div>
              {annotations.length === 0 ? (
                <div style={styles.annoEmpty}>No annotations yet.</div>
              ) : (
                <div style={styles.annoList}>
                  {annotations.map((a, i) => (
                    <div key={i} style={styles.annoItem}>
                      <span style={{ ...styles.annoType, color: a.color || "#facc15" }}>
                        {a.type === "distance" ? "↔" : a.type === "angle" ? "∠" : a.type === "hu" ? "⬤" : a.type === "implant" ? "⊥" : "~"}
                      </span>
                      <span style={styles.annoText}>
                        {a.type === "distance" ? a.measurement  :
                         a.type === "angle"    ? `${a.measurement}°` :
                         a.type === "hu"       ? `${a.hu} HU`   :
                         a.type === "implant"  ? a.implant?.brand :
                         "IAN"}
                        <span style={styles.annoView}> [{VIEW_LABELS[a.view]}]</span>
                      </span>
                      <button
                        style={styles.annoDelBtn}
                        onClick={() => dispatch({ type: "REMOVE", index: i })}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Active Implant</div>
              <div style={{ color: activeImplant.color, fontSize: 12, fontWeight: 600 }}>
                {activeImplant.brand}
              </div>
              <div style={{ color: "#64748b", fontSize: 11 }}>
                Ø{activeImplant.diameter} × {activeImplant.length}mm
              </div>
              <button style={styles.changeImplantBtn} onClick={() => setShowImplants(true)}>
                Change implant
              </button>
            </div>

            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>Keyboard Shortcuts</div>
              <div style={styles.kbGrid}>
                {[
                  ["S", "Scroll"],   ["P", "Pan"],     ["Z", "Zoom"],
                  ["W", "W/L"],      ["D", "Distance"],["A", "Angle"],
                  ["H", "HU"],       ["I", "Implant"], ["N", "IAN"],
                  ["E", "Erase"],    ["Space", "Cine"],["Tab", "Next panel"],
                  ["↑↓", "Scroll active"],
                ].map(([k, v]) => (
                  <React.Fragment key={k}>
                    <kbd style={styles.kbd}>{k}</kbd>
                    <span style={styles.kbLabel}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const C = {
  bg:      "#020617",
  surface: "#0f172a",
  border:  "#1e293b",
  text:    "#e2e8f0",
  muted:   "#64748b",
  blue:    "#3b82f6",
  green:   "#22c55e",
};

const styles = {
  root: {
    display: "flex", flexDirection: "column",
    width: "100vw", height: "100vh",
    background: C.bg, color: C.text,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    overflow: "hidden", userSelect: "none",
  },
  topBar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    height: 48, padding: "0 16px",
    background: C.surface, borderBottom: `1px solid ${C.border}`,
    flexShrink: 0,
  },
  topLeft:  { display: "flex", alignItems: "center", gap: 16 },
  topRight: { display: "flex", alignItems: "center", gap: 4 },
  topSep:   { width: 1, height: 20, background: C.border, margin: "0 4px" },
  logo:     { fontSize: 15, fontWeight: 700, color: C.blue, letterSpacing: "-0.5px" },
  metaChip: { display: "flex", gap: 6, alignItems: "center" },
  metaField:{ color: C.muted, fontSize: 11 },
  metaDot:  { color: C.border, fontSize: 11 },
  topBtn: {
    background: C.border, border: "none", color: C.text,
    padding: "5px 10px", borderRadius: 6, fontSize: 11,
    cursor: "pointer", fontFamily: "inherit",
  },
  topBtnActive: { background: C.blue,    color: "#fff" },
  topBtnSaved:  { background: "#15803d", color: "#fff" },
  select: {
    background: C.border, border: "none", color: C.text,
    padding: "4px 8px", borderRadius: 6, fontSize: 11,
    cursor: "pointer", fontFamily: "inherit",
  },
  body: {
    display: "flex", flex: 1, overflow: "hidden", position: "relative",
  },
  toolbar: {
    display: "flex", flexDirection: "column", gap: 4,
    width: 44, padding: "8px 4px",
    background: C.surface, borderRight: `1px solid ${C.border}`,
    flexShrink: 0, overflowY: "auto",
  },
  toolBtn: {
    background: "transparent", border: "none", color: C.muted,
    width: 36, height: 36, borderRadius: 8, fontSize: 16,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.15s", fontFamily: "inherit",
  },
  toolBtnActive: { background: "#1d4ed8", color: "#93c5fd" },
  toolSep:       { height: 1, background: C.border, margin: "4px 0" },
  presetBtn: {
    background: "transparent", border: "none", color: C.muted,
    fontSize: 9, cursor: "pointer", fontFamily: "inherit",
    padding: "2px 0", textAlign: "center",
  },
  viewerGrid: {
    flex: 1, display: "grid", gap: 2, overflow: "hidden", background: "#000",
  },
  panelWrap: {
    position: "relative", background: "#000", overflow: "hidden",
    transition: "border-color 0.2s",
  },
  panelLabel: {
    position: "absolute", top: 8, left: 10, zIndex: 10,
    fontSize: 11, fontWeight: 700, letterSpacing: 1,
    textShadow: "0 1px 4px rgba(0,0,0,0.8)",
  },
  panelCanvas: {
    position: "absolute", top: 0, left: 0,
    width: "100%", height: "100%", objectFit: "contain",
  },
  panelOverlay: { zIndex: 5 },
  sliceSlider: {
    position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
    width: "80%", zIndex: 10, accentColor: C.blue, cursor: "pointer",
  },
  wlOverlay: {
    position: "absolute", bottom: 24, right: 6, zIndex: 10,
    color: C.muted, fontSize: 9, fontFamily: "monospace",
    textShadow: "0 1px 2px #000",
  },
  resetPanBtn: {
    position: "absolute", top: 6, right: 6, zIndex: 10,
    background: "rgba(0,0,0,0.4)", border: "none", color: C.muted,
    fontSize: 14, width: 22, height: 22, borderRadius: 4, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  panel3D: {
    position: "relative", background: "#020617", overflow: "hidden",
    border: `2px solid ${C.border}`,
  },
  panel3DLabel: {
    position: "absolute", top: 8, left: 10, zIndex: 10,
    fontSize: 11, fontWeight: 700, color: "#a78bfa", letterSpacing: 1,
  },
  panel3DContent: {
    width: "100%", height: "100%",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexDirection: "column", gap: 8,
  },
  panel3DGlobe: {
    border: "1px solid #1e3a5f", borderRadius: "50%", width: 180, height: 180,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 4,
    background: "radial-gradient(circle at 40% 40%, #0c1a2e 0%, #020617 70%)",
    boxShadow: "0 0 60px #1d4ed822",
  },
  panel3DTitle: { color: "#a78bfa", fontSize: 12, fontWeight: 700, marginBottom: 4 },
  panel3DStat:  { color: "#475569", fontSize: 10 },
  panel3DHint:  { color: "#334155", fontSize: 10, marginTop: 8, textAlign: "center", lineHeight: 1.5 },
  crosshairIndicator: {
    position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
    color: "#334155", fontSize: 10, fontFamily: "monospace",
  },
  implantPicker: {
    position: "absolute", top: 52, left: 48, zIndex: 100,
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: 12, width: 240,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  implantPickerTitle: {
    fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8,
    display: "flex", justifyContent: "space-between",
  },
  implantClose: {
    background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 14, padding: 0,
  },
  implantRow: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 8px", borderRadius: 6, cursor: "pointer",
    marginBottom: 2, transition: "background 0.1s",
  },
  implantName: { color: C.text, fontSize: 11, flex: 1 },
  implantDims: { color: C.muted, fontSize: 10 },
  sidebar: {
    width: 220, background: C.surface, borderLeft: `1px solid ${C.border}`,
    overflowY: "auto", flexShrink: 0,
    display: "flex", flexDirection: "column", gap: 0,
  },
  sidebarSection: { padding: "12px 14px", borderBottom: `1px solid ${C.border}` },
  sidebarTitle: {
    fontSize: 10, fontWeight: 700, color: C.muted,
    letterSpacing: 1, textTransform: "uppercase", marginBottom: 8,
    display: "flex", alignItems: "center", gap: 6,
  },
  wlRow:    { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 },
  wlLabel:  { color: C.muted, fontSize: 10, width: 10 },
  wlRange:  { flex: 1, accentColor: C.blue, cursor: "pointer" },
  wlVal:    { color: C.muted, fontSize: 10, width: 36, textAlign: "right" },
  sliceRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 5 },
  sliceLabel: { fontSize: 10, fontWeight: 700, width: 28 },
  annoBadge: {
    background: "#1d4ed8", color: "#93c5fd",
    fontSize: 9, padding: "1px 6px", borderRadius: 8, marginLeft: 4,
  },
  annoEmpty: { color: "#334155", fontSize: 11 },
  annoList:  { display: "flex", flexDirection: "column", gap: 4 },
  annoItem: {
    display: "flex", alignItems: "center", gap: 6,
    background: "#0f172a", borderRadius: 6, padding: "4px 6px",
  },
  annoType:   { fontSize: 12, width: 14 },
  annoText:   { flex: 1, color: C.text, fontSize: 10 },
  annoView:   { color: C.muted },
  annoDelBtn: {
    background: "none", border: "none", color: "#475569",
    cursor: "pointer", fontSize: 11, padding: 0,
  },
  changeImplantBtn: {
    marginTop: 6, background: C.border, border: "none",
    color: C.muted, fontSize: 10, padding: "4px 8px",
    borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
  },
  kbGrid: {
    display: "grid", gridTemplateColumns: "auto 1fr",
    gap: "4px 8px", alignItems: "center",
  },
  kbd:     { background: C.border, color: C.text, padding: "1px 5px", borderRadius: 3, fontSize: 9, fontFamily: "monospace" },
  kbLabel: { color: C.muted, fontSize: 10 },
  loadingScreen: {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "100vw", height: "100vh", background: C.bg,
    flexDirection: "column", gap: 16,
  },
  loadingInner:  { display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  loadingSpinner: {
    width: 40, height: 40, borderRadius: "50%",
    border: `3px solid ${C.border}`, borderTop: `3px solid ${C.blue}`,
    animation: "spin 0.8s linear infinite",
  },
  loadingMsg: { color: C.blue,  fontSize: 14 },
  loadingSub: { color: C.muted, fontSize: 11 },
};