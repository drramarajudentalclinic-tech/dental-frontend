/**
 * CBCTViewer.jsx — CBCT viewer and implant planner
 *
 * Works on phones, tablets, laptops and desktops (touch, pen, mouse).
 *
 *  MPR mode        Axial · Coronal · Sagittal · 3-D, linked cross-hair,
 *                  thick slab / MIP, window–level presets, zoom / pan.
 *  Implant mode    1 Draw the arch on the axial view
 *                  2 Panoramic view + cross-sections along the arch
 *                  3 Trace the nerve (inferior alveolar canal) — shown in every view
 *                  4 Place implants from the clinic's systems and sizes; move / tilt
 *                    them in any view; distance to the nerve and to the next implant,
 *                    bone density around each implant, safety-zone warnings
 *  Measurements    distance, angle, density (HU) — in true millimetres
 *  Download        planning report (Print / Save as PDF), report picture,
 *                  plan file, picture of the screen; plan saved with the scan
 *
 * Props are unchanged: <CBCTViewer volumeId apiBase onClose />
 * Saved plans use the existing /cbct/<id>/annotations address; older
 * annotations are kept as they are.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadVolume, authHeaders, budgetForDevice } from "./cbct/volume";
import {
  makeView, renderView, makeLut, toScreen, toWorld, fitScale, buildArch, archAt, archNearest,
  implantApex, implantNerveGap, implantDensity, implantTilt, implantGap, guessTooth,
  add, sub, mul, norm, dot, dist, rotate, rad, deg, clamp,
} from "./cbct/geometry";
import { drawOverlay, hitTest, COLORS } from "./cbct/overlay";
import { Renderer3D, webgl2Supported } from "./cbct/render3d";
import { buildReportHTML, openReport, reportPNG, planFile, downloadBlob, implantRows } from "./cbct/report";
import { IMPLANT_SYSTEMS, IMPLANT_DIAMETERS, IMPLANT_LENGTHS } from "./implantOptions";

/* ── constants ─────────────────────────────────────────────────────────── */
const VIEW_TITLE = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal", pano: "Panoramic", cross: "Cross-section", "3d": "3-D" };
const PRESETS = [
  { name: "Dental", w: 4000, l: 1200 }, { name: "Bone", w: 2500, l: 700 }, { name: "Teeth", w: 2200, l: 1600 }, { name: "Soft", w: 700, l: 100 },
];
const FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const EMPTY_PLAN = {
  jaw: "lower", archPoints: [], crossS: 0, crossWidth: 40, crossStep: 1, crossSlab: 1, panoSlab: 10, panoOffset: 0,
  nerves: [], implants: [], measures: [], safety: 2, showSafety: true,
};
const TOOLS = {
  nav: { icon: "✛", label: "Navigate", key: "V", hint: "Tap a view to move the cross-hair. Tap an implant to select it; drag its yellow dot to move, orange dot to tilt." },
  pan: { icon: "✋", label: "Move", key: "P", hint: "Drag to move the picture. Two fingers also move and zoom." },
  zoom: { icon: "🔍", label: "Zoom", key: "Z", hint: "Drag up / down to zoom. Mouse wheel + Ctrl also zooms." },
  wl: { icon: "◐", label: "Contrast", key: "W", hint: "Drag left / right for contrast, up / down for brightness. Right mouse button works with any tool." },
  dist: { icon: "📏", label: "Distance", key: "D", hint: "Tap two points." },
  angle: { icon: "∠", label: "Angle", key: "A", hint: "Tap three points; the middle one is the corner." },
  hu: { icon: "◉", label: "Density", key: "H", hint: "Tap a point to read its density (HU)." },
  arch: { icon: "〰", label: "Arch", key: "R", hint: "On the AXIAL view, tap along the middle of the jaw from one end to the other (6–10 taps), then press Done.", implant: true },
  nerve: { icon: "⟿", label: "Nerve", key: "N", hint: "On the PANORAMIC view, tap along the canal from the mental foramen back to the ramus, then press Done. Check it in the cross-sections.", implant: true },
  implant: { icon: "🔩", label: "Implant", key: "I", hint: "Tap the crest of the bone on the CROSS-SECTION or PANORAMIC view to place an implant. Drag its dots to move or tilt it.", implant: true },
  erase: { icon: "⌫", label: "Erase", key: "E", hint: "Tap a measurement, nerve point or implant to remove it." },
};
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

function useScreen() {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [s, set] = useState(get);
  useEffect(() => { const f = () => set(get()); window.addEventListener("resize", f); window.addEventListener("orientationchange", f);
    return () => { window.removeEventListener("resize", f); window.removeEventListener("orientationchange", f); }; }, []);
  return { ...s, phone: s.w < 760, tablet: s.w >= 760 && s.w < 1180, desktop: s.w >= 1180 };
}

/* ═════════════════════════════════════════════════════════════════════════
   One 2-D view
   ═════════════════════════════════════════════════════════════════════════ */
function Pane({ kind, scene, cam, setCam, act, quick, onMax, maxed, active, onActivate, sliderOf }) {
  const wrap = useRef(null), base = useRef(null), over = useRef(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const ptrs = useRef(new Map());
  const pinch = useRef(null);
  const imgCache = useRef(null);
  const raf = useRef(0);
  const [hoverText, setHoverText] = useState("");
  const { vol } = scene;

  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const dpr = Math.min(window.devicePixelRatio || 1, scene.phone ? 2 : 1.5);
  let W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
  const maxPx = scene.phone ? 1.1e6 : 1.6e6;
  if (W * H > maxPx) { const k = Math.sqrt(maxPx / (W * H)); W = Math.round(W * k); H = Math.round(H * k); }
  const f = W / size.w;                                  // device px per css px

  const view = useMemo(() => makeView(kind, vol, { cursor: scene.cursor, arch: scene.arch, crossS: scene.plan.crossS, crossWidth: scene.plan.crossWidth, panoOffset: scene.plan.panoOffset }),
    [kind, vol, scene.cursor, scene.arch, scene.plan.crossS, scene.plan.crossWidth, scene.plan.panoOffset]);
  const camNow = useMemo(() => (view ? (cam || { scale: fitScale(view, vol, W, H), panX: 0, panY: 0 }) : null), [cam, view, vol, W, H]);

  // draw
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const b = base.current, o = over.current; if (!b || !o) return;
      if (b.width !== W || b.height !== H) { b.width = W; b.height = H; o.width = W; o.height = H; }
      const ctx = b.getContext("2d"), octx = o.getContext("2d");
      octx.clearRect(0, 0, W, H);
      if (!view) {
        ctx.fillStyle = "#020617"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#94a3b8"; ctx.font = `600 ${13 * f}px system-ui, sans-serif`; ctx.textAlign = "center";
        const msg = kind === "pano" || kind === "cross" ? ["Draw the arch first:", "tool 〰 Arch → tap along the jaw", "on the Axial view → Done"] : ["…"];
        msg.forEach((m, i) => ctx.fillText(m, W / 2, H / 2 - 12 * f + i * 20 * f)); ctx.textAlign = "left";
        return;
      }
      const slab = kind === "pano" ? scene.plan.panoSlab : kind === "cross" ? scene.plan.crossSlab : scene.slab;
      if (quick) {
        const hw = Math.max(1, Math.round(W / 2)), hh = Math.max(1, Math.round(H / 2));
        const c2 = { scale: camNow.scale / 2, panX: camNow.panX / 2, panY: camNow.panY / 2 };
        const img = renderView(view, vol, c2, hw, hh, scene.lut, { slab, mip: scene.mip && kind !== "cross", quick: true, img: imgCache.current?.q });
        imgCache.current = { ...(imgCache.current || {}), q: img };
        const tmp = imgCache.current.tc || document.createElement("canvas");
        tmp.width = hw; tmp.height = hh; tmp.getContext("2d").putImageData(img, 0, 0); imgCache.current.tc = tmp;
        ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, W, H);
      } else {
        const img = renderView(view, vol, camNow, W, H, scene.lut, { slab, mip: scene.mip && kind !== "cross", img: imgCache.current?.f });
        imgCache.current = { ...(imgCache.current || {}), f: img };
        ctx.putImageData(img, 0, 0);
      }
      drawOverlay(octx, view, camNow, W, H, { ...scene, dpr: f, panoSlab: scene.plan.panoSlab, crossSlab: scene.plan.crossSlab, crossS: scene.plan.crossS, crossWidth: scene.plan.crossWidth });
    });
    return () => cancelAnimationFrame(raf.current);
  }, [W, H, view, camNow, quick, scene.lut, scene.plan, scene.temp, scene.selectedId, scene.slab, scene.mip, scene.cursor, scene.arch, f, kind, vol]); // eslint-disable-line react-hooks/exhaustive-deps

  // wheel (needs a non-passive listener)
  useEffect(() => {
    const el = over.current; if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      if (!view) return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
      if (e.ctrlKey || e.metaKey || scene.tool === "zoom") {
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const s2 = clamp(camNow.scale * k, 0.3, 80);
        setCam(kind, { scale: s2, panX: x - W / 2 - ((x - W / 2 - camNow.panX) / camNow.scale) * s2, panY: y - H / 2 - ((y - H / 2 - camNow.panY) / camNow.scale) * s2 });
      } else act("wheel", { kind, view, dir: Math.sign(e.deltaY), shift: e.shiftKey });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const info = (e) => {
    const r = over.current.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
    return { kind, view, cam: camNow, W, H, x, y, f, world: view ? toWorld(view, camNow, W, H, x, y) : null, button: e.button, cssDX: 0 };
  };
  const onDown = (e) => {
    onActivate?.(kind);
    over.current.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && view) {
      act("cancel-drag");
      const [a, b] = [...ptrs.current.values()];
      const r = over.current.getBoundingClientRect();
      const mid = { x: ((a.x + b.x) / 2 - r.left) * (W / r.width), y: ((a.y + b.y) / 2 - r.top) * (H / r.height) };
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: mid, cam0: { ...camNow } };
      return;
    }
    if (ptrs.current.size === 1 && view) act("down", { ...info(e), clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType });
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) {
      if (view && e.pointerType === "mouse") { const w = info(e).world; const hu = w ? vol.huAt(w) : null; setHoverText(hu == null ? "" : `${hu} HU`); }
      return;
    }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const r = over.current.getBoundingClientRect();
      const mid = { x: ((a.x + b.x) / 2 - r.left) * (W / r.width), y: ((a.y + b.y) / 2 - r.top) * (H / r.height) };
      const p = pinch.current, s2 = clamp(p.cam0.scale * (Math.hypot(a.x - b.x, a.y - b.y) / (p.d0 || 1)), 0.3, 80);
      setCam(kind, {
        scale: s2,
        panX: mid.x - W / 2 - ((p.mid0.x - W / 2 - p.cam0.panX) / p.cam0.scale) * s2,
        panY: mid.y - H / 2 - ((p.mid0.y - H / 2 - p.cam0.panY) / p.cam0.scale) * s2,
      });
      act("interacting");
      return;
    }
    if (view) act("move", { ...info(e), clientX: e.clientX, clientY: e.clientY });
  };
  const onUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size === 0 && view) act("up", info(e));
  };

  const sl = sliderOf(kind, view);
  return (
    <div className={`cv-pane ${active ? "active" : ""}`} style={{ "--vc": COLORS[kind] }}>
      <div className="cv-pane-head">
        <span className="cv-pane-title" style={{ color: COLORS[kind] }}>{VIEW_TITLE[kind]}</span>
        {sl && <span className="cv-pane-pos">{sl.text}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" className="cv-mini" title="Fit to view" onClick={() => setCam(kind, null)}>⊡</button>
          {onMax && <button type="button" className="cv-mini" title={maxed ? "Back to all views" : "Enlarge this view"} onClick={() => onMax(kind)}>{maxed ? "⤡" : "⤢"}</button>}
        </span>
      </div>
      <div ref={wrap} className="cv-pane-body">
        <canvas ref={base} className="cv-canvas" />
        <canvas ref={over} className="cv-canvas cv-over" style={{ cursor: scene.cursorCss }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHoverText("")}
          onDoubleClick={() => onMax?.(kind)} onContextMenu={(e) => e.preventDefault()} />
        {hoverText && <div className="cv-hover">{hoverText}</div>}
      </div>
      {sl && (
        <input className="cv-slider" type="range" min={sl.min} max={sl.max} step={sl.step} value={sl.value}
          onChange={(e) => sl.set(Number(e.target.value))} aria-label={`${VIEW_TITLE[kind]} position`} />
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   3-D view
   ═════════════════════════════════════════════════════════════════════════ */
function Pane3D({ scene, settings, setSettings, onMax, maxed, rendererRef, active, onActivate }) {
  const wrap = useRef(null), cv = useRef(null), over = useRef(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [err, setErr] = useState("");
  const ptrs = useRef(new Map()); const drag = useRef(null);
  const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState(false);
  const idle = useRef(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(50, e.contentRect.width), h: Math.max(50, e.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const dpr = Math.min(window.devicePixelRatio || 1, scene.phone ? 1.5 : 1.25);
  const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
  useEffect(() => {
    if (!webgl2Supported()) { setErr("3-D needs a newer browser (WebGL 2). The other views work normally."); return undefined; }
    try { rendererRef.current = new Renderer3D(cv.current, scene.vol); setTick((t) => t + 1); }
    catch (e) { setErr("3-D could not start on this device. The other views work normally."); console.error(e); }
    return () => { rendererRef.current?.dispose(); rendererRef.current = null; };
  }, [scene.vol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const R = rendererRef.current; if (!R) return;
    const c = cv.current, o = over.current;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; o.width = W; o.height = H; }
    R.draw({ mode: settings.mode, thresholdHu: settings.thr, quick: moving, clip: { lo: [0, settings.clipFront, settings.clipBottom], hi: [1, 1, settings.clipTop] } });
    const g = o.getContext("2d"); g.clearRect(0, 0, W, H);
    const f = W / size.w;
    // nerves and implants on top
    for (const n of scene.plan.nerves || []) {
      if (n.points.length < 2) continue;
      g.strokeStyle = COLORS.nerve; g.lineWidth = 3 * f; g.beginPath();
      n.points.forEach((p, i) => { const s = R.project(p, W, H); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); }); g.stroke();
    }
    for (const im of scene.plan.implants || []) {
      const a = R.project(im.top, W, H), b = R.project(implantApex(im), W, H);
      const gap = implantNerveGap(im, scene.plan.nerves);
      g.strokeStyle = gap && gap.gap < scene.plan.safety ? COLORS.warn : im.id === scene.selectedId ? COLORS.implantSel : COLORS.implant;
      const wpx = Math.max(4 * f, (im.diameter / R.mm) * (W / (2.2 / R.zoom)) * 1.15);
      g.lineWidth = wpx; g.lineCap = "round"; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.fillStyle = "#fff"; g.font = `700 ${11 * f}px system-ui`; g.fillText(im.tooth ? `#${im.tooth}` : "", b.x + 6 * f, b.y);
    }
  }, [W, H, settings, tick, moving, scene.plan, scene.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const kick = () => { setMoving(true); clearTimeout(idle.current); idle.current = setTimeout(() => setMoving(false), 160); setTick((t) => t + 1); };
  useEffect(() => {
    const el = over.current; if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); const R = rendererRef.current; if (!R) return; R.zoom = clamp(R.zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 6); kick(); };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  });
  const onDown = (e) => { onActivate?.("3d"); over.current.setPointerCapture?.(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const R = rendererRef.current; if (!R) return;
    const v = [...ptrs.current.values()];
    drag.current = v.length === 2 ? { d0: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y), z0: R.zoom } : { x: e.clientX, y: e.clientY, yaw: R.yaw, pitch: R.pitch }; };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const R = rendererRef.current, d = drag.current; if (!R || !d) return;
    const v = [...ptrs.current.values()];
    if (v.length >= 2 && d.d0) R.zoom = clamp(d.z0 * Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) / d.d0, 0.4, 6);
    else if (d.yaw !== undefined) { R.yaw = d.yaw + (e.clientX - d.x) * 0.01; R.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.01, -1.5, 1.5); }
    kick();
  };
  const onUp = (e) => { ptrs.current.delete(e.pointerId); drag.current = null; kick(); };
  const preset = (yaw, pitch) => { const R = rendererRef.current; if (!R) return; R.yaw = yaw; R.pitch = pitch; kick(); };
  return (
    <div className={`cv-pane ${active ? "active" : ""}`} style={{ "--vc": COLORS["3d"] }}>
      <div className="cv-pane-head">
        <span className="cv-pane-title" style={{ color: COLORS["3d"] }}>3-D</span>
        <select className="cv-sel" value={settings.mode} onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value }))} aria-label="3-D style">
          <option value="bone">Bone surface</option><option value="mip">X-ray (MIP)</option><option value="soft">See-through</option>
        </select>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" className="cv-mini" title="Front" onClick={() => preset(0, 0.1)}>F</button>
          <button type="button" className="cv-mini" title="Patient's right" onClick={() => preset(-Math.PI / 2, 0.1)}>R</button>
          <button type="button" className="cv-mini" title="Patient's left" onClick={() => preset(Math.PI / 2, 0.1)}>L</button>
          <button type="button" className="cv-mini" title="From below / above" onClick={() => preset(0, 1.45)}>⊙</button>
          {onMax && <button type="button" className="cv-mini" onClick={() => onMax("3d")} title={maxed ? "Back" : "Enlarge"}>{maxed ? "⤡" : "⤢"}</button>}
        </span>
      </div>
      <div ref={wrap} className="cv-pane-body">
        <canvas ref={cv} className="cv-canvas" />
        <canvas ref={over} className="cv-canvas cv-over" style={{ cursor: "grab" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {err && <div className="cv-3derr">{err}</div>}
      </div>
      <div className="cv-3dbar">
        <label title="Which densities show as bone">Bone level<input type="range" min={-300} max={2000} step={25} value={settings.thr} onChange={(e) => setSettings((s) => ({ ...s, thr: Number(e.target.value) }))} /></label>
        <label title="Cut away from the top">Top<input type="range" min={0.05} max={1} step={0.01} value={settings.clipTop} onChange={(e) => setSettings((s) => ({ ...s, clipTop: Math.max(Number(e.target.value), s.clipBottom + 0.05) }))} /></label>
        <label title="Cut away from the bottom">Bottom<input type="range" min={0} max={0.95} step={0.01} value={settings.clipBottom} onChange={(e) => setSettings((s) => ({ ...s, clipBottom: Math.min(Number(e.target.value), s.clipTop - 0.05) }))} /></label>
        <label title="Cut away from the front">Front<input type="range" min={0} max={0.9} step={0.01} value={settings.clipFront} onChange={(e) => setSettings((s) => ({ ...s, clipFront: Number(e.target.value) }))} /></label>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   Main viewer
   ═════════════════════════════════════════════════════════════════════════ */
export default function CBCTViewer({ volumeId, apiBase = "/api", onClose }) {
  const screen = useScreen();
  const [meta, setMeta] = useState(null);
  const [vol, setVol] = useState(null);
  const [progress, setProgress] = useState({ p: 0, msg: "Opening the scan…" });
  const [error, setError] = useState("");
  const [mode, setMode] = useState("mpr");
  const [tool, setTool] = useState("nav");
  const [cursor, setCursor] = useState([0, 0, 0]);
  const [wl, setWl] = useState({ w: 4000, l: 1200 });
  const [invert, setInvert] = useState(false);
  const [slab, setSlab] = useState(0);
  const [mip, setMip] = useState(false);
  const [cams, setCams] = useState({});
  const [plan, setPlanRaw] = useState(EMPTY_PLAN);
  const [selectedId, setSelectedId] = useState(null);
  const [temp, setTemp] = useState(null);
  const [maxView, setMaxView] = useState(null);
  const [activeView, setActiveView] = useState("axial");
  const [panelOpen, setPanelOpen] = useState(false);
  const [quick, setQuick] = useState(false);
  const [toast, setToast] = useState(null);
  const [saveState, setSaveState] = useState("");
  const [dirty, setDirty] = useState(false);
  const [three, setThree] = useState({ mode: "bone", thr: 450, clipTop: 1, clipBottom: 0, clipFront: 0 });
  const [busy, setBusy] = useState("");
  const legacy = useRef([]);
  const hist = useRef({ past: [], future: [] });
  const drag = useRef(null);
  const quickTimer = useRef(0);
  const renderer3d = useRef(null);
  const toastTimer = useRef(0);

  const say = useCallback((text, kind = "info") => { setToast({ text, kind }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3800); }, []);

  /* plan changes with undo */
  const setPlan = useCallback((upd, { record = true } = {}) => {
    setPlanRaw((old) => {
      const next = typeof upd === "function" ? upd(old) : upd;
      if (record && next !== old) { hist.current.past.push(old); if (hist.current.past.length > 60) hist.current.past.shift(); hist.current.future = []; }
      return next;
    });
    setDirty(true);
  }, []);
  const undo = () => { const h = hist.current; if (!h.past.length) return; setPlanRaw((cur) => { h.future.push(cur); return h.past.pop(); }); setDirty(true); };
  const redo = () => { const h = hist.current; if (!h.future.length) return; setPlanRaw((cur) => { h.past.push(cur); return h.future.pop(); }); setDirty(true); };

  /* ── load ── */
  useEffect(() => {
    if (!volumeId) return undefined;
    let alive = true;
    (async () => {
      try {
        const m = await fetch(`${apiBase}/cbct/${volumeId}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "Please sign in again." : "This scan could not be found."))));
        if (!alive) return; setMeta(m);
        const v = await loadVolume(apiBase, volumeId, m, (p, msg) => alive && setProgress({ p, msg }));
        if (!alive) return;
        setVol(v);
        setCursor([v.X / 2, v.Y / 2, v.Z / 2]);
        if (v.source === "slices") setWl({ w: 2500, l: 500 });
        // saved plan + older annotations
        const ann = await fetch(`${apiBase}/cbct/${volumeId}/annotations`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
        if (!alive) return;
        const saved = (Array.isArray(ann) ? ann : []).find((a) => a && a.type === "plan" && a.version >= 2);
        legacy.current = (Array.isArray(ann) ? ann : []).filter((a) => a && a.type !== "plan");
        if (saved && saved.plan) { setPlanRaw({ ...EMPTY_PLAN, ...saved.plan }); if ((saved.plan.archPoints || []).length > 1 || (saved.plan.implants || []).length) setMode("implant"); }
      } catch (e) { if (alive) setError(e.message || "The scan could not be opened."); }
    })();
    return () => { alive = false; };
  }, [volumeId, apiBase]);

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const arch = useMemo(() => buildArch(plan.archPoints), [plan.archPoints]);
  const lut = useMemo(() => (vol ? makeLut(vol, wl.w, wl.l, invert) : null), [vol, wl, invert]);
  const views = mode === "implant" ? ["pano", "axial", "cross", "3d"] : ["axial", "coronal", "sagittal", "3d"];
  useEffect(() => { if (!views.includes(activeView)) setActiveView(views[0]); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const bumpQuick = () => { setQuick(true); clearTimeout(quickTimer.current); quickTimer.current = setTimeout(() => setQuick(false), 170); };
  const setCam = useCallback((kind, cam) => { setCams((c) => ({ ...c, [kind]: cam })); if (cam) bumpQuick(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const implantById = (id) => plan.implants.find((i) => i.id === id);
  const selectImplant = (id, focus = true) => {
    setSelectedId(id);
    const im = plan.implants.find((i) => i.id === id);
    if (im && focus) {
      const mid = add(im.top, mul(im.axis, im.length / 2));
      if (arch) { const { s } = archNearest(arch, mid[0], mid[1]); setPlan((p) => ({ ...p, crossS: s }), { record: false }); }
      setCursor(mid);
    }
  };

  /* default implant for a new placement */
  const lastImplant = () => lsGet("cbct-last-implant", { system: "Straumann", diameter: 4.1, length: 10 });
  const apexDir = () => [0, 0, (plan.jaw === "upper" ? 1 : -1) * vol.zSign];

  /* ── everything a tap / drag does ── */
  const act = (type, P = {}) => {
    if (!vol) return;
    if (type === "interacting") { bumpQuick(); return; }
    if (type === "cancel-drag") { drag.current = null; return; }
    const { kind, view, world } = P;
    if (type === "wheel") {
      bumpQuick();
      const d = P.dir;
      if (kind === "axial") setCursor((c) => [c[0], c[1], clamp(c[2] + d * vol.sz * vol.zSign * -1, 0, vol.Z)]);
      else if (kind === "coronal") setCursor((c) => [c[0], clamp(c[1] + d * vol.sy, 0, vol.Y), c[2]]);
      else if (kind === "sagittal") setCursor((c) => [clamp(c[0] + d * vol.sx, 0, vol.X), c[1], c[2]]);
      else if (kind === "cross" && arch) setPlan((p) => ({ ...p, crossS: clamp(p.crossS + d * p.crossStep, 0, arch.length) }), { record: false });
      else if (kind === "pano") setPlan((p) => ({ ...p, panoOffset: clamp(p.panoOffset + d * 0.5, -20, 20) }), { record: false });
      return;
    }
    if (type === "down") {
      const S = { plan, selectedId };
      if (P.button === 2 || tool === "wl") { drag.current = { mode: "wl", x: P.clientX, y: P.clientY, wl0: wl }; return; }
      if (P.button === 1 || tool === "pan") { drag.current = { mode: "pan", x: P.x, y: P.y, cam0: { ...P.cam } }; return; }
      if (tool === "zoom") { drag.current = { mode: "zoom", y: P.y, x: P.x, cam0: { ...P.cam } }; return; }
      const hit = hitTest(view, P.cam, P.W, P.H, S, P.x, P.y, P.f);
      if (tool === "erase") {
        if (!hit) return;
        if (hit.type.startsWith("implant")) { setPlan((p) => ({ ...p, implants: p.implants.filter((i) => i.id !== hit.id) })); say("Implant removed."); }
        else if (hit.type === "nerve-point") setPlan((p) => ({ ...p, nerves: p.nerves.map((n) => (n.id === hit.id ? { ...n, points: n.points.filter((_, k) => k !== hit.index) } : n)).filter((n) => n.points.length > 0) }));
        else if (hit.type === "measure") setPlan((p) => ({ ...p, measures: p.measures.filter((m) => m.id !== hit.id) }));
        return;
      }
      if (hit && (tool === "nav" || tool === "implant") && hit.type.startsWith("implant")) {
        const im = implantById(hit.id);
        if (hit.id !== selectedId) selectImplant(hit.id, kind !== "cross" && kind !== "pano");
        drag.current = { mode: hit.type === "implant-apex" ? "tilt" : "move", id: hit.id, w0: world, im0: im, kind, view, moved: false };
        return;
      }
      if (hit && tool === "nav" && hit.type === "nerve-point") {
        setSelectedId(hit.id);
        drag.current = { mode: "nerve-point", id: hit.id, index: hit.index, moved: false };
        return;
      }
      if (hit && tool === "nav" && hit.type === "measure") { setSelectedId(hit.id); return; }
      if (tool === "arch") {
        if (kind !== "axial") { say("Draw the arch on the AXIAL view (choose a slice through the roots).", "warn"); return; }
        setTemp((t) => ({ kind: "arch", points: [...(t?.kind === "arch" ? t.points : []), [world[0], world[1]]] }));
        return;
      }
      if (tool === "nerve") {
        setTemp((t) => ({ kind: "nerve", side: t?.side || (world[0] > vol.X / 2 ? "L" : "R"), diameter: t?.diameter || 2, points: [...(t?.kind === "nerve" ? t.points : []), world] }));
        return;
      }
      if (tool === "implant") {
        if (kind === "3d") return;
        const d = lastImplant();
        const s = arch ? archNearest(arch, world[0], world[1]).s : 0;
        const im = { id: uid(), tooth: arch ? guessTooth(arch, s, plan.jaw) : "", system: d.system, diameter: d.diameter, length: d.length, top: world, axis: apexDir(), note: "" };
        setPlan((p) => ({ ...p, implants: [...p.implants, im] }));
        setSelectedId(im.id);
        if (arch && kind !== "cross") setPlan((p) => ({ ...p, crossS: s }), { record: false });
        setTool("nav");
        say(`Implant placed${im.tooth ? ` at #${im.tooth}` : ""}. Drag the yellow dot to move it, the orange dot to tilt it.`);
        return;
      }
      if (tool === "dist" || tool === "angle") {
        const need = tool === "dist" ? 2 : 3;
        const pts = [...(temp?.kind === tool ? temp.points : []), world];
        if (pts.length >= need) {
          const value = tool === "dist" ? r1(dist(pts[0], pts[1]))
            : Math.round(deg(Math.acos(clamp(dot(norm(sub(pts[0], pts[1])), norm(sub(pts[2], pts[1]))), -1, 1))));
          setPlan((p) => ({ ...p, measures: [...p.measures, { id: uid(), type: tool, view: kind, points: pts, value }] }));
          setTemp(null);
        } else setTemp({ kind: tool, points: pts });
        return;
      }
      if (tool === "hu") {
        const v = vol.huAt(world);
        if (v != null) setPlan((p) => ({ ...p, measures: [...p.measures, { id: uid(), type: "hu", view: kind, points: [world], value: v }] }));
        return;
      }
      // navigate
      setSelectedId(null);
      drag.current = { mode: "cursor" };
      moveCursor(kind, view, world);
      return;
    }
    if (type === "move") {
      const d = drag.current; if (!d) return;
      bumpQuick();
      if (d.mode === "wl") {
        const dx = P.clientX - d.x, dy = P.clientY - d.y;
        setWl({ w: clamp(d.wl0.w + dx * 10, 50, 8000), l: clamp(d.wl0.l - dy * 6, -1000, 4000) });
      } else if (d.mode === "pan") setCams((c) => ({ ...c, [kind]: { ...d.cam0, panX: d.cam0.panX + (P.x - d.x), panY: d.cam0.panY + (P.y - d.y) } }));
      else if (d.mode === "zoom") {
        const s2 = clamp(d.cam0.scale * Math.exp(-(P.y - d.y) * 0.005), 0.3, 80);
        setCams((c) => ({ ...c, [kind]: { scale: s2, panX: d.x - P.W / 2 - ((d.x - P.W / 2 - d.cam0.panX) / d.cam0.scale) * s2, panY: d.y - P.H / 2 - ((d.y - P.H / 2 - d.cam0.panY) / d.cam0.scale) * s2 } }));
      } else if (d.mode === "cursor") moveCursor(kind, view, world);
      else if (d.mode === "move" && world && d.w0) {
        const delta = sub(world, d.w0);
        const top = add(d.im0.top, delta);
        setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === d.id ? { ...i, top } : i)) }), { record: !d.moved });
        d.moved = true;
      } else if (d.mode === "tilt" && world) {
        const im = d.im0;
        const apex0 = implantApex(im);
        const dep = view.plane(apex0)[2];
        const target = view.planar ? add(world, mul(view.N, dep)) : world;
        let axis = norm(sub(target, im.top));
        if (dot(axis, im.axis) < 0.2) return;                      // keep it sensible
        setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === d.id ? { ...i, axis } : i)) }), { record: !d.moved });
        d.moved = true;
      } else if (d.mode === "nerve-point" && world) {
        setPlan((p) => ({ ...p, nerves: p.nerves.map((n) => (n.id === d.id ? { ...n, points: n.points.map((q, k) => (k === d.index ? world : q)) } : n)) }), { record: !d.moved });
        d.moved = true;
      }
      return;
    }
    if (type === "up") { drag.current = null; setQuick(false); }
  };
  const moveCursor = (kind, view, world) => {
    if (!world) return;
    if (kind === "axial") setCursor((c) => [clamp(world[0], 0, vol.X), clamp(world[1], 0, vol.Y), c[2]]);
    else if (kind === "coronal") setCursor((c) => [clamp(world[0], 0, vol.X), c[1], clamp(world[2], 0, vol.Z)]);
    else if (kind === "sagittal") setCursor((c) => [c[0], clamp(world[1], 0, vol.Y), clamp(world[2], 0, vol.Z)]);
    else if (kind === "pano" && arch) { const a = view.plane(world)[0]; setPlan((p) => ({ ...p, crossS: clamp(a, 0, arch.length) }), { record: false }); setCursor([world[0], world[1], clamp(world[2], 0, vol.Z)]); }
    else if (kind === "cross") setCursor([world[0], world[1], clamp(world[2], 0, vol.Z)]);
  };

  /* finishing drawings */
  const finishArch = () => {
    if (!temp || temp.kind !== "arch" || temp.points.length < 3) { say("Tap at least 3 points along the jaw on the axial view.", "warn"); return; }
    const a = buildArch(temp.points);
    setPlan((p) => ({ ...p, archPoints: a.points, crossS: a.length / 2 }));
    setTemp(null); setTool("nav");
    setCams((c) => ({ ...c, pano: null, cross: null }));
    say("Arch ready — the panoramic and cross-section views are made from it.");
  };
  const finishNerve = () => {
    if (!temp || temp.kind !== "nerve" || temp.points.length < 2) { say("Tap at least 2 points along the canal.", "warn"); return; }
    const n = { id: uid(), side: temp.side, diameter: temp.diameter || 2, points: temp.points };
    setPlan((p) => ({ ...p, nerves: [...p.nerves, n] }));
    setTemp(null); setTool("nav"); setSelectedId(n.id);
    say("Nerve saved. It now shows in every view; implants closer than the safety margin turn red.");
  };
  const cancelTemp = () => { setTemp(null); };

  /* keyboard (computers) */
  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (e.key === "Escape") { if (temp) cancelTemp(); else if (maxView) setMaxView(null); else setSelectedId(null); return; }
      if (e.key === "Enter" && temp) { temp.kind === "arch" ? finishArch() : temp.kind === "nerve" ? finishNerve() : null; return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { removeSelected(); return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { act("wheel", { kind: activeView, dir: e.key === "ArrowUp" ? -1 : 1 }); e.preventDefault(); return; }
      const t = Object.entries(TOOLS).find(([, v]) => v.key.toLowerCase() === e.key.toLowerCase());
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!t[1].implant || mode === "implant") setTool(t[0]); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  const removeSelected = () => {
    if (!selectedId) return;
    setPlan((p) => ({ ...p, implants: p.implants.filter((i) => i.id !== selectedId), nerves: p.nerves.filter((n) => n.id !== selectedId), measures: p.measures.filter((m) => m.id !== selectedId) }));
    setSelectedId(null);
  };

  /* ── save ── */
  const save = async () => {
    setSaveState("saving");
    try {
      const body = [...legacy.current, { type: "plan", view: "3d", version: 2, plan: { ...plan, archPoints: plan.archPoints } }];
      const r = await fetch(`${apiBase}/cbct/${volumeId}/annotations`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      setSaveState("saved"); setDirty(false); setTimeout(() => setSaveState(""), 2200);
    } catch { setSaveState("error"); say("The plan could not be saved. Check the internet and try again.", "err"); }
  };

  /* older scans opened from the slice pictures: make the full-quality 3-D block on the server */
  const rebuild = async () => {
    setBusy("Making the full-quality 3-D scan… (up to a minute)");
    try {
      const r = await fetch(`${apiBase}/cbct/${volumeId}/volume/rebuild`, { method: "POST", headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Server ${r.status}`);
      if (dirty) await save();
      window.location.reload();
    } catch (e) { say(e.message || "Could not rebuild.", "err"); }
    finally { setBusy(""); }
  };

  /* ── pictures for the report ── */
  const snapshot = (kind, { W = 900, H = 600, center = null, mm = null, st = {} } = {}) => {
    const stt = { cursor: st.cursor || cursor, arch, crossS: st.crossS ?? plan.crossS, crossWidth: plan.crossWidth, panoOffset: plan.panoOffset };
    const view = makeView(kind, vol, stt);
    if (!view) return null;
    let cam = { scale: fitScale(view, vol, W, H), panX: 0, panY: 0 };
    if (mm) cam.scale = Math.min(W, H) / mm;
    if (center) { const [a, b] = view.plane(center); cam.panX = -(a - view.a0) * cam.scale; cam.panY = -(b - view.b0) * cam.scale; }
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const lutR = makeLut(vol, wl.w, wl.l, false);
    g.putImageData(renderView(view, vol, cam, W, H, lutR, { slab: kind === "pano" ? plan.panoSlab : kind === "cross" ? plan.crossSlab : 0 }), 0, 0);
    drawOverlay(g, view, cam, W, H, { vol, plan, arch, cursor: stt.cursor, selectedId: null, temp: null, report: true, crossS: stt.crossS, crossWidth: plan.crossWidth, panoSlab: plan.panoSlab, crossSlab: plan.crossSlab, dpr: 1.4 });
    return c.toDataURL("image/jpeg", 0.9);
  };
  const reportImages = () => {
    const out = { implants: [] };
    if (arch) {
      const W = 1400, H = Math.round(clamp((W * vol.Z) / arch.length, 380, 760));
      out.pano = snapshot("pano", { W, H });
    }
    for (const im of plan.implants) {
      const mid = add(im.top, mul(im.axis, im.length / 2));
      const s = arch ? archNearest(arch, mid[0], mid[1]).s : plan.crossS;
      out.implants.push({
        cross: arch ? snapshot("cross", { W: 600, H: 600, center: mid, mm: 34, st: { crossS: s, cursor: mid } }) : snapshot("coronal", { W: 600, H: 600, center: mid, mm: 40, st: { cursor: mid } }),
        axial: snapshot("axial", { W: 600, H: 600, center: mid, mm: 40, st: { cursor: mid } }),
      });
    }
    const R = renderer3d.current;
    if (R) {
      try {
        R.draw({ mode: three.mode, thresholdHu: three.thr, clip: { lo: [0, three.clipFront, three.clipBottom], hi: [1, 1, three.clipTop] } });
        const c = document.createElement("canvas"); c.width = R.canvas.width; c.height = R.canvas.height;
        const g = c.getContext("2d"); g.drawImage(R.canvas, 0, 0);
        const over = R.canvas.parentElement?.querySelector(".cv-over"); if (over) g.drawImage(over, 0, 0);
        out.three = c.toDataURL("image/jpeg", 0.88);
      } catch { /* 3-D not available */ }
    }
    return out;
  };
  const doReport = async (kind) => {
    if (!vol) return;
    const pre = kind === "pdf" ? window.open("", "_blank") : null;
    if (pre) pre.document.write("<p style='font-family:system-ui;padding:20px'>Making the report…</p>");
    setBusy("Making the report…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const images = reportImages();
      if (kind === "pdf") openReport(buildReportHTML({ meta, plan, vol, images }), pre);
      else if (kind === "png") { const blob = await reportPNG({ meta, plan, vol, images }); downloadBlob(blob, `implant-plan-${volumeId}.png`); }
      else if (kind === "json") downloadBlob(new Blob([JSON.stringify(planFile({ meta, plan, vol, volumeId }), null, 2)], { type: "application/json" }), `implant-plan-${volumeId}.json`);
    } catch (e) { console.error(e); say("The report could not be made.", "err"); }
    finally { setBusy(""); }
  };
  const screenShot = () => {
    const panes = [...document.querySelectorAll(".cv-pane")];
    if (!panes.length) return;
    const rects = panes.map((p) => p.getBoundingClientRect());
    const x0 = Math.min(...rects.map((r) => r.left)), y0 = Math.min(...rects.map((r) => r.top));
    const x1 = Math.max(...rects.map((r) => r.right)), y1 = Math.max(...rects.map((r) => r.bottom));
    const k = 1.5;
    const c = document.createElement("canvas"); c.width = (x1 - x0) * k; c.height = (y1 - y0) * k;
    const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    panes.forEach((p, i) => p.querySelectorAll("canvas").forEach((cv) => {
      const r = cv.getBoundingClientRect(); g.drawImage(cv, (r.left - x0) * k, (r.top - y0) * k, r.width * k, r.height * k);
    }));
    c.toBlob((b) => downloadBlob(b, `cbct-${volumeId}-screen.png`), "image/png");
  };

  /* ── loading / error ── */
  if (error) return (
    <div className="cv-full"><style>{CSS}</style>
      <div className="cv-center"><div style={{ fontSize: 40 }}>⚠️</div><div style={{ color: "#fca5a5", fontWeight: 700 }}>{error}</div>
        {onClose && <button className="cv-btn" onClick={onClose}>Close</button>}</div></div>
  );
  if (!vol) return (
    <div className="cv-full"><style>{CSS}</style>
      <div className="cv-center">
        <div className="cv-spin" />
        <div style={{ color: "#93c5fd", fontWeight: 700 }}>{progress.msg}</div>
        <div className="cv-prog"><i style={{ width: `${Math.round(progress.p * 100)}%` }} /></div>
        <div style={{ color: "#64748b", fontSize: 12 }}>Scan #{volumeId}{meta?.patient_name ? ` · ${meta.patient_name}` : ""} · {budgetForDevice().label} quality</div>
      </div>
    </div>
  );

  /* ── scene shared by the views ── */
  const scene = {
    vol, plan, arch, cursor, lut, slab, mip, selectedId, temp, tool, phone: screen.phone,
    cursorCss: { nav: "crosshair", pan: "grab", zoom: "zoom-in", wl: "ew-resize", dist: "crosshair", angle: "crosshair", hu: "cell", arch: "copy", nerve: "copy", implant: "copy", erase: "not-allowed" }[tool],
  };
  const sliderOf = (kind) => {
    if (kind === "axial") {
      const n = Math.round(vol.zUp ? cursor[2] / vol.sz : (vol.Z - cursor[2]) / vol.sz);
      return { min: 0, max: vol.Z, step: vol.sz, value: vol.zUp ? cursor[2] : vol.Z - cursor[2], text: `${n} / ${vol.nz}`, set: (v) => { bumpQuick(); setCursor((c) => [c[0], c[1], vol.zUp ? v : vol.Z - v]); } };
    }
    if (kind === "coronal") return { min: 0, max: vol.Y, step: vol.sy, value: cursor[1], text: `${Math.round(cursor[1] / vol.sy)} / ${vol.ny}`, set: (v) => { bumpQuick(); setCursor((c) => [c[0], v, c[2]]); } };
    if (kind === "sagittal") return { min: 0, max: vol.X, step: vol.sx, value: cursor[0], text: `${Math.round(cursor[0] / vol.sx)} / ${vol.nx}`, set: (v) => { bumpQuick(); setCursor((c) => [v, c[1], c[2]]); } };
    if (kind === "cross" && arch) return { min: 0, max: arch.length, step: plan.crossStep, value: plan.crossS, text: `${r1(plan.crossS)} / ${r1(arch.length)} mm`, set: (v) => { bumpQuick(); setPlan((p) => ({ ...p, crossS: v }), { record: false }); } };
    if (kind === "pano" && arch) return { min: -20, max: 20, step: 0.5, value: plan.panoOffset, text: `curve ${plan.panoOffset > 0 ? "+" : ""}${plan.panoOffset} mm`, set: (v) => { bumpQuick(); setPlan((p) => ({ ...p, panoOffset: v }), { record: false }); } };
    return null;
  };
  const shown = screen.phone ? [activeView] : maxView ? [maxView] : views;
  const gridClass = screen.phone || maxView ? "one" : mode === "implant" ? "implant" : "quad";
  const sel = plan.implants.find((i) => i.id === selectedId);
  const selNerve = plan.nerves.find((n) => n.id === selectedId);
  const toolList = Object.entries(TOOLS).filter(([, v]) => !v.implant || mode === "implant");

  const panel = (
    <Panel {...{ mode, plan, setPlan, arch, vol, tool, setTool, temp, setTemp, finishArch, finishNerve, cancelTemp, sel, selNerve, selectImplant, setSelectedId, selectedId,
      wl, setWl, invert, setInvert, slab, setSlab, mip, setMip, removeSelected, say, setCursor, legacyCount: legacy.current.length, rebuild }} />
  );

  return (
    <div className={`cv-root ${screen.phone ? "phone" : screen.tablet ? "tablet" : "desktop"}`}>
      <style>{CSS}</style>
      {/* top bar */}
      <div className="cv-top">
        <div className="cv-brand">🦷<span className="cv-hide-phone"> CBCT Planner</span></div>
        {meta && <div className="cv-meta cv-hide-phone">{meta.patient_name || "Patient"} · {meta.study_date || ""} · {vol.nx}×{vol.ny}×{vol.nz} · {r1(vol.sx)} mm{vol.source === "slices" ? " · from slices" : ""}</div>}
        <div className="cv-seg" role="tablist" aria-label="Mode">
          <button type="button" className={mode === "mpr" ? "on" : ""} onClick={() => { setMode("mpr"); setMaxView(null); if (TOOLS[tool].implant) setTool("nav"); }}>MPR</button>
          <button type="button" className={mode === "implant" ? "on" : ""} onClick={() => { setMode("implant"); setMaxView(null); if (!arch) { setActiveView("axial"); setTool("arch"); say("Step 1: draw the arch — tap along the jaw on the AXIAL view, then press Done."); } }}>{screen.phone ? "Implants" : "Implant planning"}</button>
        </div>
        <div className="cv-topr">
          {!screen.phone && <button type="button" className="cv-btn ghost" onClick={undo} title="Undo (Ctrl+Z)" disabled={!hist.current.past.length}>↶</button>}
          {!screen.phone && <button type="button" className="cv-btn ghost" onClick={redo} title="Redo (Ctrl+Y)" disabled={!hist.current.future.length}>↷</button>}
          <button type="button" className={`cv-btn ${saveState === "saved" ? "ok" : dirty ? "primary" : "ghost"}`} onClick={save} title="Save the plan with this scan (Ctrl+S)">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : `💾${screen.phone ? "" : " Save"}`}
          </button>
          <Menu label={`⬇${screen.phone ? "" : " Download"}`} items={[
            ["📄 Report — Print / Save as PDF", () => doReport("pdf")],
            ["🖼 Report as picture (PNG)", () => doReport("png")],
            ["📐 Plan file (implant positions)", () => doReport("json")],
            ["📷 Picture of the screen", screenShot],
          ]} />
          {(screen.phone || screen.tablet) && <button type="button" className={`cv-btn ${panelOpen ? "primary" : "ghost"}`} onClick={() => setPanelOpen((v) => !v)}>☰</button>}
          {onClose && <button type="button" className="cv-btn ghost" onClick={() => { if (!dirty || window.confirm("The plan has changes that are not saved. Close anyway?")) onClose(); }} title="Close">✕</button>}
        </div>
      </div>

      {screen.phone && (
        <div className="cv-viewtabs">
          {views.map((v) => <button key={v} type="button" className={activeView === v ? "on" : ""} style={{ "--vc": COLORS[v] }} onClick={() => setActiveView(v)}>{VIEW_TITLE[v]}</button>)}
        </div>
      )}

      <div className="cv-body">
        <div className="cv-tools" role="toolbar" aria-label="Tools">
          {toolList.map(([k, t]) => (
            <button key={k} type="button" className={`cv-tool ${tool === k ? "on" : ""}`} title={`${t.label} (${t.key}) — ${t.hint}`} onClick={() => { setTool(k); if (temp && temp.kind !== k) setTemp(null);
              if (k === "arch") { setActiveView("axial"); } if (k === "nerve" || k === "implant") { if (screen.phone) setActiveView(arch ? (k === "nerve" ? "pano" : "cross") : "axial"); } }}>
              <span className="cv-ti">{t.icon}</span><span className="cv-tl">{t.label}</span>
            </button>
          ))}
        </div>

        <div className={`cv-grid ${gridClass}`}>
          {shown.map((k) => (k === "3d"
            ? <Pane3D key={k} scene={scene} settings={three} setSettings={setThree} onMax={screen.phone ? null : (v) => setMaxView((m) => (m ? null : v))} maxed={!!maxView} rendererRef={renderer3d} active={activeView === k} onActivate={setActiveView} />
            : <Pane key={k} kind={k} scene={scene} cam={cams[k]} setCam={setCam} act={act} quick={quick} sliderOf={sliderOf}
                onMax={screen.phone ? null : (v) => setMaxView((m) => (m ? null : v))} maxed={!!maxView} active={activeView === k} onActivate={setActiveView} />))}
        </div>

        {(screen.desktop || panelOpen) && (
          <div className={`cv-panel ${screen.desktop ? "" : "sheet"}`}>
            {!screen.desktop && <div className="cv-sheet-head"><b>Plan &amp; settings</b><button type="button" className="cv-btn ghost" onClick={() => setPanelOpen(false)}>Close</button></div>}
            {panel}
          </div>
        )}
      </div>

      {/* hints / drawing controls */}
      <div className="cv-hint">
        {temp ? (
          <>
            <span>{temp.kind === "arch" ? `Arch: ${temp.points.length} point${temp.points.length === 1 ? "" : "s"} — keep tapping along the jaw on the Axial view.`
              : temp.kind === "nerve" ? `Nerve (${temp.side === "L" ? "left" : "right"}): ${temp.points.length} point${temp.points.length === 1 ? "" : "s"} — tap along the canal.`
              : `${TOOLS[temp.kind]?.label}: ${temp.points.length} point${temp.points.length === 1 ? "" : "s"}…`}</span>
            <span className="cv-hint-btns">
              <button type="button" className="cv-btn ghost sm" onClick={() => setTemp((t) => ({ ...t, points: t.points.slice(0, -1) }))} disabled={!temp.points.length}>Undo point</button>
              {temp.kind === "arch" && <button type="button" className="cv-btn primary sm" onClick={finishArch}>Done</button>}
              {temp.kind === "nerve" && <button type="button" className="cv-btn primary sm" onClick={finishNerve}>Done</button>}
              <button type="button" className="cv-btn ghost sm" onClick={cancelTemp}>Cancel</button>
            </span>
          </>
        ) : (
          <>
            <span>{TOOLS[tool]?.hint}{!screen.phone && " · Two fingers / wheel: zoom · Right-drag: contrast"}</span>
            {screen.phone && <span className="cv-hint-btns"><button type="button" className="cv-btn ghost sm" onClick={undo} disabled={!hist.current.past.length}>↶ Undo</button></span>}
          </>
        )}
      </div>
      {toast && <div className={`cv-toast ${toast.kind}`} role="status">{toast.text}</div>}
      {busy && <div className="cv-busy"><div className="cv-spin" />{busy}</div>}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   Side panel: arch, nerve, implants, measurements, display
   ═════════════════════════════════════════════════════════════════════════ */
function Panel(P) {
  const { mode, plan, setPlan, arch, vol, tool, setTool, temp, setTemp, finishArch, finishNerve, sel, selNerve, selectImplant, setSelectedId, selectedId,
    wl, setWl, invert, setInvert, slab, setSlab, mip, setMip, removeSelected, setCursor, rebuild } = P;
  const upd = (id, patch) => setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const rows = useMemo(() => (mode === "implant" ? implantRows(plan, vol) : []), [mode, plan, vol]);
  const tiltBy = (im, dir, a) => {
    let k;
    if (dir === "bl") { if (arch) { const { s } = archNearest(arch, im.top[0], im.top[1]); const c = archAt(arch, s); k = [c.tx, c.ty, 0]; } else k = [1, 0, 0]; }
    else { if (arch) { const { s } = archNearest(arch, im.top[0], im.top[1]); const c = archAt(arch, s); k = [c.nx, c.ny, 0]; } else k = [0, 1, 0]; }
    upd(im.id, { axis: norm(rotate(im.axis, norm(k), rad(a))) });
  };
  const saveDefault = (im) => lsSet("cbct-last-implant", { system: im.system, diameter: im.diameter, length: im.length });
  return (
    <div className="cv-panel-in">
      {mode === "implant" && (
        <>
          <Sec title="1 · Arch" done={!!arch}>
            <div className="cv-row">
              <span className="cv-lbl">Jaw</span>
              <div className="cv-seg sm">
                {["upper", "lower"].map((j) => <button key={j} type="button" className={plan.jaw === j ? "on" : ""} onClick={() => setPlan((p) => ({ ...p, jaw: j }))}>{j === "upper" ? "Upper" : "Lower"}</button>)}
              </div>
            </div>
            {temp?.kind === "arch" ? (
              <div className="cv-row"><button type="button" className="cv-btn primary" onClick={finishArch}>Done ({temp.points.length})</button><button type="button" className="cv-btn ghost" onClick={() => setTemp(null)}>Cancel</button></div>
            ) : (
              <div className="cv-row">
                <button type="button" className={`cv-btn ${arch ? "ghost" : "primary"}`} onClick={() => { setTool("arch"); setTemp({ kind: "arch", points: [] }); }}>{arch ? "Redraw arch" : "〰 Draw arch"}</button>
                {arch && <span className="cv-small">{r1(arch.length)} mm long</span>}
              </div>
            )}
            {!arch && <p className="cv-help">Choose an axial slice through the roots, then tap along the middle of the jaw from one end to the other.</p>}
            {arch && (
              <>
                <Range label="Panoramic thickness" unit="mm" min={0} max={30} step={1} value={plan.panoSlab} set={(v) => setPlan((p) => ({ ...p, panoSlab: v }), { record: false })} />
                <Range label="Cross-section width" unit="mm" min={20} max={70} step={5} value={plan.crossWidth} set={(v) => setPlan((p) => ({ ...p, crossWidth: v }), { record: false })} />
                <Range label="Cross-section thickness" unit="mm" min={0} max={5} step={0.5} value={plan.crossSlab} set={(v) => setPlan((p) => ({ ...p, crossSlab: v }), { record: false })} />
                <div className="cv-row">
                  <span className="cv-lbl">Step</span>
                  <div className="cv-seg sm">{[0.5, 1, 2, 5].map((s) => <button key={s} type="button" className={plan.crossStep === s ? "on" : ""} onClick={() => setPlan((p) => ({ ...p, crossStep: s }), { record: false })}>{s}</button>)}</div>
                  <button type="button" className="cv-btn ghost sm" onClick={() => setPlan((p) => ({ ...p, crossS: clamp(p.crossS - p.crossStep, 0, arch.length) }), { record: false })}>◀</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => setPlan((p) => ({ ...p, crossS: clamp(p.crossS + p.crossStep, 0, arch.length) }), { record: false })}>▶</button>
                </div>
              </>
            )}
          </Sec>

          <Sec title="2 · Nerve canal" done={plan.nerves.length > 0}>
            {temp?.kind === "nerve" ? (
              <div className="cv-row">
                <div className="cv-seg sm">{["R", "L"].map((s) => <button key={s} type="button" className={temp.side === s ? "on" : ""} onClick={() => setTemp((t) => ({ ...t, side: s }))}>{s === "R" ? "Right" : "Left"}</button>)}</div>
                <button type="button" className="cv-btn primary sm" onClick={finishNerve}>Done ({temp.points.length})</button>
                <button type="button" className="cv-btn ghost sm" onClick={() => setTemp(null)}>Cancel</button>
              </div>
            ) : (
              <div className="cv-row">
                <button type="button" className="cv-btn ghost" disabled={!arch} onClick={() => { setTool("nerve"); setTemp({ kind: "nerve", side: "R", diameter: 2, points: [] }); }}>⟿ Trace right</button>
                <button type="button" className="cv-btn ghost" disabled={!arch} onClick={() => { setTool("nerve"); setTemp({ kind: "nerve", side: "L", diameter: 2, points: [] }); }}>⟿ Trace left</button>
              </div>
            )}
            {plan.nerves.map((n) => (
              <div key={n.id} className={`cv-item ${selectedId === n.id ? "sel" : ""}`} onClick={() => setSelectedId(n.id)}>
                <span style={{ color: COLORS.nerve, fontWeight: 800 }}>⟿</span>
                <span className="cv-grow">{n.side === "L" ? "Left" : "Right"} nerve · {n.points.length} points</span>
                <select className="cv-sel" value={n.diameter || 2} onClick={(e) => e.stopPropagation()} onChange={(e) => setPlan((p) => ({ ...p, nerves: p.nerves.map((x) => (x.id === n.id ? { ...x, diameter: Number(e.target.value) } : x)) }))} aria-label="Canal diameter">
                  {[1.5, 2, 2.5, 3, 3.5].map((d) => <option key={d} value={d}>Ø {d} mm</option>)}
                </select>
                <button type="button" className="cv-x" onClick={(e) => { e.stopPropagation(); setPlan((p) => ({ ...p, nerves: p.nerves.filter((x) => x.id !== n.id) })); }} aria-label="Delete nerve">✕</button>
              </div>
            ))}
            {selNerve && <p className="cv-help">Drag the nerve's points (Navigate tool) in any view to correct it. Check it in the cross-sections.</p>}
            <Range label="Safety margin" unit="mm" min={0.5} max={5} step={0.5} value={plan.safety} set={(v) => setPlan((p) => ({ ...p, safety: v }))} />
            <label className="cv-check"><input type="checkbox" checked={plan.showSafety !== false} onChange={(e) => setPlan((p) => ({ ...p, showSafety: e.target.checked }), { record: false })} /> Show safety zone around implants</label>
          </Sec>

          <Sec title={`3 · Implants (${plan.implants.length})`} done={plan.implants.length > 0}>
            <div className="cv-row">
              <button type="button" className={`cv-btn ${tool === "implant" ? "primary" : "ghost"}`} disabled={!arch} onClick={() => setTool("implant")}>🔩 Place implant</button>
              {tool === "implant" && <span className="cv-small">Tap the bone crest on the cross-section</span>}
            </div>
            {rows.map((r, i) => {
              const im = plan.implants[i];
              return (
                <div key={im.id} className={`cv-item imp ${selectedId === im.id ? "sel" : ""} ${r.nerveWarn ? "bad" : ""}`} onClick={() => selectImplant(im.id)}>
                  <b>#{im.tooth || "?"}</b>
                  <span className="cv-grow">{im.system} Ø{im.diameter}×{im.length}</span>
                  <span className={r.nerveWarn ? "cv-badv" : "cv-okv"} title="Distance to the nerve">{r.nerve === "no nerve traced" ? "—" : r.nerve}</span>
                </div>
              );
            })}
            {sel && (
              <div className="cv-editor">
                <div className="cv-row">
                  <span className="cv-lbl">Tooth</span>
                  <select className="cv-sel" value={sel.tooth || ""} onChange={(e) => upd(sel.id, { tooth: e.target.value })}>
                    <option value="">—</option>{FDI.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select className="cv-sel grow" value={sel.system} onChange={(e) => { upd(sel.id, { system: e.target.value }); saveDefault({ ...sel, system: e.target.value }); }} aria-label="Implant system">
                    {IMPLANT_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="cv-row">
                  <span className="cv-lbl">Ø</span>
                  <select className="cv-sel" value={sel.diameter} onChange={(e) => { const d = Number(e.target.value); upd(sel.id, { diameter: d }); saveDefault({ ...sel, diameter: d }); }}>
                    {IMPLANT_DIAMETERS.map((d) => <option key={d} value={Number(d)}>{d} mm</option>)}
                  </select>
                  <span className="cv-lbl">L</span>
                  <select className="cv-sel" value={sel.length} onChange={(e) => { const l = Number(e.target.value); upd(sel.id, { length: l }); saveDefault({ ...sel, length: l }); }}>
                    {IMPLANT_LENGTHS.map((d) => <option key={d} value={Number(d)}>{d} mm</option>)}
                  </select>
                </div>
                <div className="cv-row wrap">
                  <span className="cv-lbl">Depth</span>
                  <button type="button" className="cv-btn ghost sm" onClick={() => upd(sel.id, { top: add(sel.top, mul(sel.axis, -0.5)) })}>▲ 0.5</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => upd(sel.id, { top: add(sel.top, mul(sel.axis, 0.5)) })}>▼ 0.5</button>
                  <span className="cv-lbl">Tilt</span>
                  <button type="button" className="cv-btn ghost sm" title="Towards the cheek / tongue" onClick={() => tiltBy(sel, "bl", -2)}>B ↶</button>
                  <button type="button" className="cv-btn ghost sm" title="Towards the cheek / tongue" onClick={() => tiltBy(sel, "bl", 2)}>↷ L</button>
                  <button type="button" className="cv-btn ghost sm" title="Towards the front / back" onClick={() => tiltBy(sel, "md", -2)}>M ↶</button>
                  <button type="button" className="cv-btn ghost sm" title="Towards the front / back" onClick={() => tiltBy(sel, "md", 2)}>↷ D</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => upd(sel.id, { axis: [0, 0, sel.axis[2] >= 0 ? 1 : -1] })}>Straight</button>
                </div>
                {(() => {
                  const g = implantNerveGap(sel, plan.nerves), dn = implantDensity(sel, vol);
                  const nb = plan.implants.filter((o) => o.id !== sel.id).map((o) => implantGap(sel, o));
                  const near = nb.length ? Math.min(...nb) : null;
                  return (
                    <div className="cv-stats">
                      <div className={g && g.gap < plan.safety ? "bad" : ""}><small>To nerve</small><b>{g ? (g.gap < 0 ? `INTO by ${r1(-g.gap)} mm` : `${r1(g.gap)} mm`) : "—"}</b></div>
                      <div className={near != null && near < 3 ? "bad" : ""}><small>Next implant</small><b>{near != null ? `${r1(near)} mm` : "—"}</b></div>
                      <div><small>Bone (approx.)</small><b>{dn ? `${dn.hu} HU · ${dn.cls}` : "—"}</b></div>
                      <div><small>Tilt</small><b>{implantTilt(sel)}°</b></div>
                    </div>
                  );
                })()}
                <input className="cv-in" placeholder="Note (e.g. bone graft, sinus lift)" value={sel.note || ""} onChange={(e) => upd(sel.id, { note: e.target.value })} />
                <div className="cv-row">
                  <button type="button" className="cv-btn ghost sm" onClick={() => { const c = { ...sel, id: uid(), top: add(sel.top, [7, 0, 0]) }; setPlan((p) => ({ ...p, implants: [...p.implants, c] })); setSelectedId(c.id); }}>Duplicate</button>
                  <button type="button" className="cv-btn danger sm" onClick={removeSelected}>Delete implant</button>
                </div>
              </div>
            )}
          </Sec>
        </>
      )}

      <Sec title={`Measurements (${plan.measures.length})`}>
        <div className="cv-row wrap">
          {["dist", "angle", "hu"].map((k) => <button key={k} type="button" className={`cv-btn ${tool === k ? "primary" : "ghost"} sm`} onClick={() => setTool(k)}>{TOOLS[k].icon} {TOOLS[k].label}</button>)}
        </div>
        {plan.measures.map((m) => (
          <div key={m.id} className={`cv-item ${selectedId === m.id ? "sel" : ""}`} onClick={() => { setSelectedId(m.id); setCursor(m.points[0]); }}>
            <span>{m.type === "hu" ? "◉" : m.type === "angle" ? "∠" : "📏"}</span>
            <span className="cv-grow">{m.type === "hu" ? `${m.value} HU` : m.type === "angle" ? `${m.value}°` : `${m.value} mm`}</span>
            <span className="cv-small">{VIEW_TITLE[m.view]}</span>
            <button type="button" className="cv-x" onClick={(e) => { e.stopPropagation(); setPlan((p) => ({ ...p, measures: p.measures.filter((x) => x.id !== m.id) })); }} aria-label="Delete">✕</button>
          </div>
        ))}
      </Sec>

      <Sec title="Display">
        <div className="cv-row wrap">{PRESETS.map((p) => <button key={p.name} type="button" className={`cv-btn sm ${wl.w === p.w && wl.l === p.l ? "primary" : "ghost"}`} onClick={() => setWl({ w: p.w, l: p.l })}>{p.name}</button>)}</div>
        <Range label="Contrast (window)" min={50} max={8000} step={50} value={wl.w} set={(v) => setWl((x) => ({ ...x, w: v }))} />
        <Range label="Brightness (level)" min={-1000} max={4000} step={25} value={wl.l} set={(v) => setWl((x) => ({ ...x, l: v }))} />
        <label className="cv-check"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Invert (black bone)</label>
        {mode === "mpr" && (
          <>
            <Range label="Slice thickness" unit="mm" min={0} max={20} step={1} value={slab} set={setSlab} />
            <label className="cv-check"><input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} /> Brightest point (MIP) in thick slices</label>
          </>
        )}
      </Sec>
      {vol.source === "slices" && (
        <div className="cv-sec" style={{ padding: 10 }}>
          <p className="cv-help">This older scan was opened from its slice pictures (density values are approximate). For full quality:</p>
          <button type="button" className="cv-btn ghost sm" style={{ marginTop: 6 }} onClick={rebuild}>Rebuild from the original DICOM</button>
        </div>
      )}
      <p className="cv-help" style={{ marginTop: 6 }}>Planning aid — confirm clinically. CBCT grey values (HU) are approximate.</p>
    </div>
  );
}

function Sec({ title, done, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="cv-sec">
      <button type="button" className="cv-sec-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{done ? "✅ " : ""}{title}</span><span>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="cv-sec-b">{children}</div>}
    </div>
  );
}
function Range({ label, unit = "", min, max, step, value, set }) {
  return (
    <label className="cv-range">
      <span>{label}</span><b>{value}{unit ? ` ${unit}` : ""}</b>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
}
function Menu({ label, items }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return undefined; const f = () => setOpen(false); setTimeout(() => window.addEventListener("click", f), 0); return () => window.removeEventListener("click", f); }, [open]);
  return (
    <span className="cv-menu">
      <button type="button" className="cv-btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label}</button>
      {open && <div className="cv-menu-list">{items.map(([t, fn]) => <button key={t} type="button" onClick={() => { setOpen(false); fn(); }}>{t}</button>)}</div>}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
const CSS = `
.cv-root,.cv-full{position:fixed;inset:0;display:flex;flex-direction:column;background:#020617;color:#e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.cv-center{margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:20px}
.cv-spin{width:36px;height:36px;border-radius:50%;border:3px solid #1e293b;border-top-color:#3b82f6;animation:cvspin .8s linear infinite}
@keyframes cvspin{to{transform:rotate(360deg)}}
.cv-prog{width:min(320px,80vw);height:6px;background:#1e293b;border-radius:6px;overflow:hidden}.cv-prog i{display:block;height:100%;background:linear-gradient(90deg,#2563eb,#38bdf8);transition:width .3s}
.cv-top{display:flex;align-items:center;gap:10px;padding:6px 10px;background:#0f172a;border-bottom:1px solid #1e293b;flex-shrink:0;min-height:46px}
.cv-brand{font-weight:800;color:#60a5fa;white-space:nowrap}
.cv-meta{font-size:11.5px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.cv-topr{display:flex;gap:6px;align-items:center;margin-left:auto}
.cv-seg{display:inline-flex;background:#1e293b;border-radius:9px;padding:2px}
.cv-seg button{border:none;background:none;color:#94a3b8;font:600 12.5px system-ui,sans-serif;padding:6px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}
.cv-seg button.on{background:#2563eb;color:#fff}
.cv-seg.sm button{padding:4px 9px;font-size:12px}
.cv-btn{border:1px solid transparent;border-radius:8px;padding:7px 12px;font:600 12.5px system-ui,sans-serif;cursor:pointer;background:#1e293b;color:#e2e8f0;white-space:nowrap;touch-action:manipulation}
.cv-btn.sm{padding:4px 9px;font-size:12px}
.cv-btn.ghost{background:#0f172a;border-color:#334155}
.cv-btn.primary{background:#2563eb;color:#fff}
.cv-btn.ok{background:#15803d;color:#fff}
.cv-btn.danger{background:#7f1d1d;color:#fecaca}
.cv-btn:disabled{opacity:.4;cursor:default}
.cv-menu{position:relative}
.cv-menu-list{position:absolute;right:0;top:calc(100% + 6px);background:#0f172a;border:1px solid #334155;border-radius:10px;padding:6px;z-index:50;min-width:260px;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.cv-menu-list button{display:block;width:100%;text-align:left;border:none;background:none;color:#e2e8f0;padding:9px 10px;border-radius:7px;font:500 13px system-ui,sans-serif;cursor:pointer}
.cv-menu-list button:hover{background:#1e293b}
.cv-body{flex:1;display:flex;min-height:0;position:relative}
.cv-tools{display:flex;flex-direction:column;gap:3px;padding:6px 4px;background:#0f172a;border-right:1px solid #1e293b;overflow-y:auto;flex-shrink:0;width:66px}
.cv-tool{display:flex;flex-direction:column;align-items:center;gap:1px;border:none;background:none;color:#94a3b8;border-radius:8px;padding:6px 2px;cursor:pointer;touch-action:manipulation}
.cv-tool .cv-ti{font-size:17px;line-height:1}.cv-tool .cv-tl{font-size:9.5px;font-weight:600}
.cv-tool.on{background:#1d4ed8;color:#fff}
.cv-grid{flex:1;display:grid;gap:3px;background:#000;min-width:0;min-height:0}
.cv-grid.quad{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.cv-grid.implant{grid-template-columns:1fr 1fr 1fr;grid-template-rows:44% 56%;grid-template-areas:"a a a" "b c d"}
.cv-grid.implant > :nth-child(1){grid-area:a}.cv-grid.implant > :nth-child(2){grid-area:b}.cv-grid.implant > :nth-child(3){grid-area:c}.cv-grid.implant > :nth-child(4){grid-area:d}
.cv-grid.one{grid-template-columns:1fr;grid-template-rows:1fr}
.cv-pane{position:relative;display:flex;flex-direction:column;background:#000;min-width:0;min-height:0;border:1.5px solid #111827}
.cv-pane.active{border-color:var(--vc)}
.cv-pane-head{display:flex;align-items:center;gap:8px;padding:3px 6px;background:rgba(15,23,42,.92);font-size:12px;flex-shrink:0}
.cv-pane-title{font-weight:800;letter-spacing:.03em}
.cv-pane-pos{color:#64748b;font-size:11px}
.cv-mini{border:none;background:#1e293b;color:#cbd5e1;border-radius:6px;min-width:24px;height:22px;font-size:12px;cursor:pointer;touch-action:manipulation}
.cv-sel{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:3px 5px;font-size:12px}
.cv-sel.grow{flex:1;min-width:0}
.cv-pane-body{position:relative;flex:1;min-height:0;overflow:hidden}
.cv-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.cv-over{touch-action:none}
.cv-hover{position:absolute;right:6px;top:6px;font-size:11px;color:#22d3ee;background:rgba(2,6,23,.7);padding:2px 6px;border-radius:5px;pointer-events:none}
.cv-slider{width:100%;margin:0;accent-color:var(--vc);height:22px;background:#0f172a;flex-shrink:0}
.cv-3dbar{display:flex;gap:10px;flex-wrap:wrap;padding:3px 8px;background:#0f172a;font-size:10.5px;color:#94a3b8;flex-shrink:0}
.cv-3dbar label{display:flex;align-items:center;gap:4px}.cv-3dbar input{width:80px;accent-color:#a78bfa}
.cv-3derr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#94a3b8;font-size:13px}
.cv-panel{width:320px;flex-shrink:0;background:#0b1222;border-left:1px solid #1e293b;overflow-y:auto}
.cv-panel.sheet{position:absolute;right:0;top:0;bottom:0;z-index:30;box-shadow:-10px 0 30px rgba(0,0,0,.5);width:min(360px,92vw)}
.cv-sheet-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#0b1222;z-index:2}
.cv-panel-in{padding:8px}
.cv-sec{border:1px solid #1e293b;border-radius:10px;margin-bottom:8px;overflow:hidden}
.cv-sec-h{display:flex;justify-content:space-between;width:100%;border:none;background:#0f172a;color:#e2e8f0;font:700 13px system-ui,sans-serif;padding:9px 10px;cursor:pointer}
.cv-sec-b{padding:8px 10px;display:flex;flex-direction:column;gap:7px}
.cv-row{display:flex;align-items:center;gap:6px}.cv-row.wrap{flex-wrap:wrap}
.cv-lbl{font-size:11.5px;color:#94a3b8;font-weight:600}
.cv-small{font-size:11.5px;color:#94a3b8}
.cv-help{font-size:11.5px;color:#94a3b8;margin:0;line-height:1.45}
.cv-check{display:flex;gap:6px;align-items:center;font-size:12.5px;color:#cbd5e1}
.cv-range{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-size:12px;color:#94a3b8}
.cv-range b{color:#e2e8f0;font-weight:700}.cv-range input{grid-column:1/-1;width:100%;accent-color:#3b82f6}
.cv-item{display:flex;align-items:center;gap:7px;padding:7px 8px;border-radius:8px;background:#0f172a;border:1px solid #1e293b;font-size:12.5px;cursor:pointer}
.cv-item.sel{border-color:#facc15}.cv-item.bad{border-color:#ef4444}
.cv-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cv-x{border:none;background:none;color:#64748b;cursor:pointer;font-size:13px}
.cv-okv{color:#4ade80;font-weight:700;font-size:12px}.cv-badv{color:#f87171;font-weight:800;font-size:12px}
.cv-editor{border:1px solid #facc15;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:7px;background:#0f172a}
.cv-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cv-stats div{background:#020617;border-radius:8px;padding:6px 8px;display:flex;flex-direction:column}
.cv-stats small{font-size:10.5px;color:#64748b}.cv-stats b{font-size:13px}.cv-stats .bad b{color:#f87171}
.cv-in{background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:7px 9px;font-size:12.5px;width:100%;box-sizing:border-box;user-select:text}
.cv-hint{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:6px 10px;background:#0f172a;border-top:1px solid #1e293b;font-size:12px;color:#94a3b8;flex-shrink:0;min-height:34px}
.cv-hint-btns{display:flex;gap:6px;flex-shrink:0}
.cv-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:#1e3a8a;color:#fff;padding:9px 14px;border-radius:10px;font-size:13px;z-index:60;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.cv-toast.warn{background:#92400e}.cv-toast.err{background:#991b1b}
.cv-busy{position:fixed;inset:0;background:rgba(2,6,23,.7);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:70;color:#bfdbfe}
.cv-viewtabs{display:flex;gap:4px;padding:4px 6px;background:#0f172a;border-bottom:1px solid #1e293b;overflow-x:auto;flex-shrink:0}
.cv-viewtabs button{flex:1;border:none;border-radius:8px;padding:7px 6px;background:#1e293b;color:#cbd5e1;font:700 12.5px system-ui,sans-serif;white-space:nowrap}
.cv-viewtabs button.on{background:var(--vc);color:#020617}
/* phones: tools along the bottom, one view at a time */
.cv-root.phone .cv-body{flex-direction:column}
.cv-root.phone .cv-tools{flex-direction:row;width:auto;order:2;border-right:none;border-top:1px solid #1e293b;overflow-x:auto;overflow-y:hidden;padding:4px}
.cv-root.phone .cv-tool{min-width:56px}
.cv-root.phone .cv-hide-phone{display:none}
.cv-root.phone .cv-top{gap:6px;padding:5px 6px}
.cv-root.phone .cv-seg button{padding:6px 8px;font-size:12px}
.cv-root.phone .cv-btn{padding:7px 9px}
.cv-root.phone .cv-panel.sheet{left:0;right:0;top:auto;bottom:0;width:auto;max-height:62%;border-radius:14px 14px 0 0;border-left:none;border-top:1px solid #334155}
.cv-root.phone .cv-hint{font-size:11.5px;flex-wrap:wrap}
.cv-root.tablet .cv-grid.implant{grid-template-columns:1fr 1fr;grid-template-rows:40% 60%;grid-template-areas:"a a" "b c"}
.cv-root.tablet .cv-grid.implant > :nth-child(4){display:none}
`;