/**
 * CBCTViewer.jsx — CBCT viewer and dental planning suite (phones, tablets, laptops, desktops)
 *
 * Module tabs across the top, tools on the right (like desktop dental CBCT software):
 *   MPR      Axial · Sagittal · Coronal · 3-D with a rotating (oblique) cross-hair, thick slab / MIP
 *   Implant  Axial (arch) · Cross-section (single or a strip of 5) · Panoramic · 3-D
 *            arch → panoramic & cross-sections · nerve canal · implant library with abutment & crown
 *            · nerve / neighbour distance alerts · bone density (HU, D1–D5)
 *   3D       full-screen colour volume rendering, clipping, preset views
 *   Ceph     lateral / PA cephalogram made from the scan, landmarks, Steiner analysis
 *   TMJ      close-up sagittal and coronal views of both condyles
 *   Airway   air space volume (cc), narrowest cross-section and its level
 *   Report   the full report on screen; PDF / picture / plan file / implant STL / original DICOM / screen
 *
 * Props are unchanged: <CBCTViewer volumeId apiBase onClose />. Plans are saved with the scan
 * (the existing /cbct/<id>/annotations address); older annotations are kept.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadVolume, authHeaders, budgetForDevice } from "./cbct/volume";
import {
  makeView, renderView, makeLut, toWorld, fitScale, buildArch, archAt, archNearest, rotateFrame, IDENTITY_FRAME,
  implantApex, implantNerveGap, implantDensity, implantTilt, implantGap, guessTooth,
  add, sub, mul, norm, dot, cross, dist, rotate, rad, deg, clamp,
} from "./cbct/geometry";
import { drawOverlay, hitTest, COLORS } from "./cbct/overlay";
import { Renderer3D, webgl2Supported } from "./cbct/render3d";
import { buildReportHTML, openReport, reportPNG, planFile, downloadBlob, implantRows } from "./cbct/report";
import { cephProjection, cephImage, CEPH_POINTS, cephAnalysis, computeAirway, implantsSTL } from "./cbct/tools";
import { IMPLANT_SYSTEMS, IMPLANT_DIAMETERS, IMPLANT_LENGTHS } from "./implantOptions";

/* ── constants ─────────────────────────────────────────────────────────── */
const TABS = [
  ["mpr", "MPR"], ["implant", "Implant"], ["3d", "3D"], ["ceph", "Ceph"], ["tmj", "TMJ"], ["airway", "Airway"], ["report", "Report"],
];
const VIEW_TITLE = {
  axial: "Axial", coronal: "Coronal", sagittal: "Sagittal", pano: "Panoramic", cross: "Cross-section", strip: "Cross-sections",
  "3d": "3-D", tmjRs: "Right TMJ · sagittal", tmjRc: "Right TMJ · coronal", tmjLs: "Left TMJ · sagittal", tmjLc: "Left TMJ · coronal",
};
const KIND_COLOR = (k) => COLORS[k] || (k.startsWith("tmj") ? (k[3] === "R" ? "#38bdf8" : "#f472b6") : k === "strip" ? COLORS.cross : "#94a3b8");
const THREE_PRESETS = [
  ["bone", "Bone", 400], ["teeth", "Teeth", 1300], ["skin", "Skin + bone", 400], ["color", "Colour", 400],
  ["xray", "X-ray", 400], ["mip", "MIP", 300], ["soft", "See-through", 300],
];
/* contrast that suits this scan: from soft tissue to the brightest enamel (every machine's grey values differ) */
function autoWindow(vol) {
  const h = new Float64Array(256), d = vol.data, step = Math.max(1, Math.floor(d.length / 3e6));
  for (let i = 0; i < d.length; i += step) h[d[i]]++;
  const start = Math.max(1, Math.ceil(vol.valueOfHu(-400)));
  let tot = 0; for (let v = start; v < 256; v++) tot += h[v];
  if (!tot) return { w: 4000, l: 1200 };
  const pct = (q) => { let c = 0; for (let v = start; v < 256; v++) { c += h[v]; if (c >= tot * q) return v; } return 255; };
  const lo = vol.hu(pct(0.03)) - 450, hi = vol.hu(pct(0.9985));
  return { w: Math.max(400, Math.round((hi - lo) / 50) * 50), l: Math.round((hi + lo) / 2 / 25) * 25 };
}
/* unsharp mask on a rendered slice (OnDemand-style "Sharpen") */
function sharpenImage(img, amount = 0.7) {
  const { width: W, height: H, data } = img, src = new Uint8ClampedArray(data);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const k = i + c, blur = (src[k - 4] + src[k + 4] + src[k - W * 4] + src[k + W * 4]) * 0.25;
      data[k] = src[k] + (src[k] - blur) * amount;
    }
  }
  return img;
}
const PRESETS = [
  { name: "Dental", w: 4000, l: 1200 }, { name: "Bone", w: 2500, l: 700 }, { name: "Teeth", w: 2200, l: 1600 }, { name: "Soft", w: 700, l: 100 }, { name: "Airway", w: 1400, l: -300 },
];
const FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const EMPTY_PLAN = {
  jaw: "lower", archPoints: [], crossS: 0, crossWidth: 40, crossStep: 1, crossSlab: 1, panoSlab: 10, panoOffset: 0,
  nerves: [], implants: [], measures: [], safety: 2, showSafety: true, showProsthetic: true,
  ceph: { points: {} }, tmj: { R: null, L: null, fov: 36 }, airway: { seed: null, zLo: null, zHi: null, thr: -400 },
};
const TOOLS = {
  nav: { icon: "✛", label: "Navigate", key: "V", hint: "Tap to move the cross-hair. Drag the round handles on the lines to rotate the planes (MPR). Tap an implant to select it." },
  pan: { icon: "✋", label: "Move", key: "P", hint: "Drag to move the picture. Two fingers also move and zoom." },
  zoom: { icon: "🔍", label: "Zoom", key: "Z", hint: "Drag up / down to zoom. Ctrl + wheel also zooms." },
  wl: { icon: "◐", label: "Contrast", key: "W", hint: "Drag left / right for contrast, up / down for brightness. The right mouse button works with any tool." },
  dist: { icon: "📏", label: "Distance", key: "D", hint: "Tap two points." },
  angle: { icon: "∠", label: "Angle", key: "A", hint: "Tap three points; the middle one is the corner." },
  hu: { icon: "◉", label: "Density", key: "H", hint: "Tap a point to read its density (HU)." },
  arch: { icon: "〰", label: "Arch", key: "R", hint: "On the AXIAL view, tap along the middle of the jaw from one end to the other (6–10 taps), then press Done.", tabs: ["implant"] },
  nerve: { icon: "⟿", label: "Nerve", key: "N", hint: "On the PANORAMIC view, tap along the canal from the mental foramen back to the ramus, then press Done.", tabs: ["implant"] },
  implant: { icon: "🔩", label: "Implant", key: "I", hint: "Tap the bone crest on the CROSS-SECTION or PANORAMIC view. Drag the yellow dot to move, the orange dot to tilt.", tabs: ["implant"] },
  condyle: { icon: "⦿", label: "Condyle", key: "C", hint: "On the AXIAL view at the level of the condyles, tap the RIGHT condyle, then the LEFT.", tabs: ["tmj"] },
  airseed: { icon: "💨", label: "Airway", key: "Y", hint: "Set the top and bottom levels in the panel, then tap inside the dark airway (sagittal view is easiest).", tabs: ["airway"] },
  erase: { icon: "⌫", label: "Erase", key: "E", hint: "Tap a measurement, nerve point or implant to remove it." },
};
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function useScreen() {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [s, set] = useState(get);
  useEffect(() => { const f = () => set(get()); window.addEventListener("resize", f); window.addEventListener("orientationchange", f);
    return () => { window.removeEventListener("resize", f); window.removeEventListener("orientationchange", f); }; }, []);
  return { ...s, phone: s.w < 760, tablet: s.w >= 760 && s.w < 1180, desktop: s.w >= 1180 };
}
function useSize(ref) {
  const [size, setSize] = useState({ w: 300, h: 300 });
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(50, e.contentRect.width), h: Math.max(50, e.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* ═════════════════════════════════════════════════════════════════════════
   One 2-D view (also the strip of 5 cross-sections)
   ═════════════════════════════════════════════════════════════════════════ */
const STRIP_N = 5;
function Pane({ kind, scene, cam, setCam, act, quick, onMax, maxed, active, onActivate, sliderOf, extraHead }) {
  const wrap = useRef(null), base = useRef(null), over = useRef(null);
  const size = useSize(wrap);
  const ptrs = useRef(new Map());
  const pinch = useRef(null);
  const imgCache = useRef({});
  const raf = useRef(0);
  const stripIdx = useRef(0);
  const [hoverText, setHoverText] = useState("");
  const { vol } = scene;
  const strip = kind === "strip";

  const dpr = Math.min(window.devicePixelRatio || 1, scene.phone ? 2 : 1.5);
  let W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
  const maxPx = scene.phone ? 1.1e6 : 1.7e6;
  if (W * H > maxPx) { const k = Math.sqrt(maxPx / (W * H)); W = Math.round(W * k); H = Math.round(H * k); }
  const f = W / size.w;
  const subW = strip ? Math.floor(W / STRIP_N) : W;

  const st = useMemo(() => ({ cursor: scene.cursor, arch: scene.arch, crossS: scene.plan.crossS, crossWidth: scene.plan.crossWidth, panoOffset: scene.plan.panoOffset,
    frame: scene.frame, condyles: scene.plan.tmj, tmjFov: scene.plan.tmj?.fov, tmjOffset: scene.tmjOffset }),
  [scene.cursor, scene.arch, scene.plan.crossS, scene.plan.crossWidth, scene.plan.panoOffset, scene.frame, scene.plan.tmj, scene.tmjOffset]);
  const views = useMemo(() => {
    if (!strip) { const v = makeView(kind, vol, st); return v ? [v] : []; }
    if (!scene.arch) return [];
    return Array.from({ length: STRIP_N }, (_, i) => {
      const s = clamp(st.crossS + (i - (STRIP_N - 1) / 2) * scene.plan.crossStep * 2, 0, scene.arch.length);
      const v = makeView("cross", vol, { ...st, crossS: s }); v.stripS = s; v.stripI = i; return v;
    });
  }, [strip, kind, vol, st, scene.arch, scene.plan.crossStep]);
  const view = views[0] || null;
  // like OnDemand: cross-sections and the panoramic open zoomed on the jaw (at the level the arch was drawn)
  const jawZ = scene.plan.archZ != null ? scene.plan.archZ + (scene.plan.jaw === "upper" ? 1 : -1) * vol.zSign * (kind === "pano" ? 4 : 8) : vol.Z / 2;   // a little towards the roots
  const camNow = useMemo(() => {
    if (!view) return null;
    if (cam) return cam;
    let scale = fitScale(view, vol, subW, H), panY = 0;
    const focus = (sc) => { const b = view.plane([scene.cursor[0], scene.cursor[1], jawZ])[1]; panY = -(b - view.b0) * sc; };
    if (kind === "cross" || strip) { const w = scene.plan.crossWidth; scale = Math.min(subW / w, H / (w * 1.25)) * 0.98; focus(scale); }
    else if (kind === "pano" && scene.arch) { scale = Math.min(subW / scene.arch.length, H / Math.max(45, scene.arch.length * 0.5)) * 0.98; focus(scale); }
    return { scale, panX: 0, panY };
  }, [cam, view, vol, subW, H, kind, strip, jawZ, scene.plan.crossWidth, scene.arch, scene.plan.jaw]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const b = base.current, o = over.current; if (!b || !o) return;
      if (b.width !== W || b.height !== H) { b.width = W; b.height = H; o.width = W; o.height = H; }
      const ctx = b.getContext("2d"), octx = o.getContext("2d");
      octx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      if (!views.length) {
        ctx.fillStyle = "#94a3b8"; ctx.font = `600 ${13 * f}px system-ui, sans-serif`; ctx.textAlign = "center";
        const msg = kind.startsWith("tmj") ? ["Mark the condyles first:", "tool ⦿ Condyle → tap R then L", "on the Axial view"]
          : ["Draw the arch first:", "tool 〰 Arch → tap along the jaw", "on the Axial view → Done"];
        msg.forEach((m, i) => ctx.fillText(m, W / 2, H / 2 - 12 * f + i * 20 * f)); ctx.textAlign = "left";
        return;
      }
      const slab = kind === "pano" ? scene.plan.panoSlab : (kind === "cross" || strip) ? scene.plan.crossSlab : kind.startsWith("tmj") ? 0 : scene.slab;
      views.forEach((v, i) => {
        const x0 = strip ? i * subW : 0;
        const key = `f${i}`;
        if (quick) {
          const hw = Math.max(1, Math.round(subW / 2)), hh = Math.max(1, Math.round(H / 2));
          const c2 = { scale: camNow.scale / 2, panX: camNow.panX / 2, panY: camNow.panY / 2 };
          const img = renderView(v, vol, c2, hw, hh, scene.lut, { slab, mip: scene.mip && kind !== "cross", quick: true, img: imgCache.current[`q${i}`], mask: scene.mask });
          imgCache.current[`q${i}`] = img;
          const tmp = imgCache.current[`t${i}`] || document.createElement("canvas");
          tmp.width = hw; tmp.height = hh; tmp.getContext("2d").putImageData(img, 0, 0); imgCache.current[`t${i}`] = tmp;
          ctx.drawImage(tmp, x0, 0, subW, H);
        } else {
          const img = renderView(v, vol, camNow, subW, H, scene.lut, { slab, mip: scene.mip && kind !== "cross", img: imgCache.current[key], mask: scene.mask });
          if (scene.sharp) sharpenImage(img, 0.75);
          imgCache.current[key] = img;
          ctx.putImageData(img, x0, 0);
        }
        octx.save();
        if (strip) { octx.beginPath(); octx.rect(x0, 0, subW, H); octx.clip(); octx.translate(x0, 0); }
        drawOverlay(octx, v, camNow, subW, H, { ...scene, dpr: f, panoSlab: scene.plan.panoSlab, crossSlab: scene.plan.crossSlab, crossS: v.stripS ?? scene.plan.crossS, crossWidth: scene.plan.crossWidth },
          { noScale: strip && i > 0 });
        if (strip) {
          octx.fillStyle = Math.abs(v.stripS - scene.plan.crossS) < 0.01 ? COLORS.cross : "#94a3b8";
          octx.font = `700 ${11 * f}px system-ui`; octx.fillText(`${r1(v.stripS)} mm`, 6 * f, 16 * f);
          octx.strokeStyle = "#1e293b"; octx.lineWidth = 2 * f; octx.beginPath(); octx.moveTo(subW - 1, 0); octx.lineTo(subW - 1, H); octx.stroke();
        }
        octx.restore();
      });
    });
    return () => cancelAnimationFrame(raf.current);
  }, [W, H, views, camNow, quick, scene.lut, scene.plan, scene.temp, scene.selectedId, scene.slab, scene.mip, scene.cursor, scene.arch, scene.mask, scene.tool, scene.rotatable, scene.sharp, f, kind, vol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = over.current; if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      if (!view) return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
      if (e.ctrlKey || e.metaKey || scene.tool === "zoom") {
        const xs = strip ? x % subW : x;
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const s2 = clamp(camNow.scale * k, 0.3, 80);
        setCam(kind, { scale: s2, panX: xs - subW / 2 - ((xs - subW / 2 - camNow.panX) / camNow.scale) * s2, panY: y - H / 2 - ((y - H / 2 - camNow.panY) / camNow.scale) * s2 });
      } else act("wheel", { kind, view, dir: Math.sign(e.deltaY), shift: e.shiftKey });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const info = (e, lockStrip) => {
    const r = over.current.getBoundingClientRect();
    let x = (e.clientX - r.left) * (W / r.width); const y = (e.clientY - r.top) * (H / r.height);
    let v = view;
    if (strip) {
      const i = lockStrip ? stripIdx.current : clamp(Math.floor(x / subW), 0, STRIP_N - 1);
      stripIdx.current = i; v = views[i]; x -= i * subW;
    }
    return { kind: strip ? "cross" : kind, paneKind: kind, view: v, cam: camNow, W: subW, H, x, y, f, world: v ? toWorld(v, camNow, subW, H, x, y) : null, button: e.button, stripS: v?.stripS };
  };
  const onDown = (e) => {
    onActivate?.(kind);
    over.current.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && view) {
      act("cancel-drag");
      const [a, b] = [...ptrs.current.values()];
      const r = over.current.getBoundingClientRect();
      const mid = { x: (((a.x + b.x) / 2 - r.left) * (W / r.width)) % (strip ? subW : 1e9), y: ((a.y + b.y) / 2 - r.top) * (H / r.height) };
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: mid, cam0: { ...camNow } };
      return;
    }
    if (ptrs.current.size === 1 && view) act("down", { ...info(e), clientX: e.clientX, clientY: e.clientY });
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
      const mid = { x: (((a.x + b.x) / 2 - r.left) * (W / r.width)) % (strip ? subW : 1e9), y: ((a.y + b.y) / 2 - r.top) * (H / r.height) };
      const p = pinch.current, s2 = clamp(p.cam0.scale * (Math.hypot(a.x - b.x, a.y - b.y) / (p.d0 || 1)), 0.3, 80);
      setCam(kind, { scale: s2, panX: mid.x - subW / 2 - ((p.mid0.x - subW / 2 - p.cam0.panX) / p.cam0.scale) * s2, panY: mid.y - H / 2 - ((p.mid0.y - H / 2 - p.cam0.panY) / p.cam0.scale) * s2 });
      act("interacting");
      return;
    }
    if (view) act("move", { ...info(e, true), clientX: e.clientX, clientY: e.clientY });
  };
  const onUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size === 0 && view) act("up", info(e, true));
  };

  const sl = sliderOf(kind);
  const col = KIND_COLOR(kind);
  return (
    <div className={`cv-pane ${active ? "active" : ""}`} style={{ "--vc": col }}>
      <div className="cv-pane-head">
        <span className="cv-pane-title" style={{ color: col }}>{VIEW_TITLE[kind]}</span>
        {sl && <span className="cv-pane-pos">{sl.text}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {extraHead}
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
function Pane3D({ scene, settings, setSettings, onMax, maxed, rendererRef, active, onActivate, big }) {
  const wrap = useRef(null), cv = useRef(null), over = useRef(null);
  const size = useSize(wrap);
  const [err, setErr] = useState("");
  const ptrs = useRef(new Map()); const drag = useRef(null);
  const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState(false);
  const idle = useRef(0);
  const dpr = Math.min(window.devicePixelRatio || 1, scene.phone ? 1.5 : big ? 1.25 : 1.15);
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
    R.draw({ mode: settings.mode, thresholdHu: settings.thr, quick: moving, clip: { lo: [settings.clipRight || 0, settings.clipFront, settings.clipBottom], hi: [1 - (settings.clipLeft || 0), 1, settings.clipTop] } });
    const g = o.getContext("2d"); g.clearRect(0, 0, W, H);
    const f = W / size.w;
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
        <select className="cv-sel" value={settings.mode} onChange={(e) => { const pr = THREE_PRESETS.find(([k]) => k === e.target.value); setSettings((s) => ({ ...s, mode: pr[0], thr: pr[2] })); }} aria-label="3-D style">
          {THREE_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" className="cv-mini" title="Front" onClick={() => preset(0, 0.1)}>F</button>
          <button type="button" className="cv-mini" title="Patient's right" onClick={() => preset(-Math.PI / 2, 0.1)}>R</button>
          <button type="button" className="cv-mini" title="Patient's left" onClick={() => preset(Math.PI / 2, 0.1)}>L</button>
          <button type="button" className="cv-mini" title="Back" onClick={() => preset(Math.PI, 0.1)}>B</button>
          <button type="button" className="cv-mini" title="From above / below" onClick={() => preset(0, 1.45)}>⊙</button>
          {onMax && <button type="button" className="cv-mini" onClick={() => onMax("3d")} title={maxed ? "Back" : "Enlarge"}>{maxed ? "⤡" : "⤢"}</button>}
        </span>
      </div>
      <div ref={wrap} className="cv-pane-body">
        <canvas ref={cv} className="cv-canvas" />
        <canvas ref={over} className="cv-canvas cv-over" style={{ cursor: "grab" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {err && <div className="cv-3derr">{err}</div>}
      </div>
      {!big && (
        <div className="cv-3dbar">
          <label>Bone<input type="range" min={-300} max={2000} step={25} value={settings.thr} onChange={(e) => setSettings((s) => ({ ...s, thr: Number(e.target.value) }))} /></label>
          <label>Top<input type="range" min={0.05} max={1} step={0.01} value={settings.clipTop} onChange={(e) => setSettings((s) => ({ ...s, clipTop: Math.max(Number(e.target.value), s.clipBottom + 0.05) }))} /></label>
          <label>Bottom<input type="range" min={0} max={0.95} step={0.01} value={settings.clipBottom} onChange={(e) => setSettings((s) => ({ ...s, clipBottom: Math.min(Number(e.target.value), s.clipTop - 0.05) }))} /></label>
          <label>Front<input type="range" min={0} max={0.9} step={0.01} value={settings.clipFront} onChange={(e) => setSettings((s) => ({ ...s, clipFront: Number(e.target.value) }))} /></label>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   Ceph view: a radiograph made from the scan + landmarks
   ═════════════════════════════════════════════════════════════════════════ */
function CephPane({ vol, plan, setPlan, cephKind, active, setActive, look }) {
  const wrap = useRef(null), cv = useRef(null);
  const size = useSize(wrap);
  const [cam, setCam] = useState(null);
  const ptrs = useRef(new Map()); const drag = useRef(null);
  const proj = useMemo(() => cephProjection(vol, cephKind), [vol, cephKind]);
  const img = useMemo(() => { const c = document.createElement("canvas"); c.width = proj.W; c.height = proj.H; c.getContext("2d").putImageData(cephImage(proj, look), 0, 0); return c; }, [proj, look]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr), f = W / size.w;
  const fit = Math.min(W / proj.mmW, H / proj.mmH) * 0.95;
  const c = cam || { scale: fit, panX: 0, panY: 0 };
  const toS = (u, v) => ({ x: W / 2 + c.panX + (u - proj.mmW / 2) * c.scale, y: H / 2 + c.panY + (v - proj.mmH / 2) * c.scale });
  const toMM = (x, y) => [(x - W / 2 - c.panX) / c.scale + proj.mmW / 2, (y - H / 2 - c.panY) / c.scale + proj.mmH / 2];
  const pts = (cephKind === "lat" ? plan.ceph?.points : null) || {};
  useEffect(() => {
    const el = cv.current; if (!el) return;
    if (el.width !== W || el.height !== H) { el.width = W; el.height = H; }
    const g = el.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    const tl = toS(0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, tl.x, tl.y, proj.mmW * c.scale, proj.mmH * c.scale);
    const line = (a, b, col) => { if (!pts[a] || !pts[b]) return; const p = toS(...pts[a]), q = toS(...pts[b]); g.strokeStyle = col; g.lineWidth = 1.5 * f; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); };
    if (cephKind === "lat") {
      line("S", "N", "#38bdf8"); line("N", "A", "#a78bfa"); line("N", "B", "#a78bfa"); line("Po", "Or", "#34d399"); line("Go", "Me", "#fbbf24");
      line("U1", "U1a", "#f472b6"); line("L1", "L1a", "#f472b6"); line("ANS", "PNS", "#94a3b8");
    }
    for (const [k, p] of Object.entries(pts)) {
      const s = toS(...p);
      g.fillStyle = k === active ? "#facc15" : "#ef4444"; g.beginPath(); g.arc(s.x, s.y, 4 * f, 0, 7); g.fill();
      g.font = `700 ${11 * f}px system-ui`; g.fillStyle = "#fff"; g.fillText(k, s.x + 6 * f, s.y - 6 * f);
    }
    g.fillStyle = "#94a3b8"; g.font = `600 ${11 * f}px system-ui`;
    g.fillText(cephKind === "lat" ? "Lateral ceph (made from the scan) — face to the right" : "PA ceph (made from the scan)", 8 * f, 16 * f);
  });
  useEffect(() => {
    const el = cv.current; if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
      const s2 = clamp(c.scale * Math.exp(-e.deltaY * 0.0015), 0.5, 60); setCam({ scale: s2, panX: x - W / 2 - ((x - W / 2 - c.panX) / c.scale) * s2, panY: y - H / 2 - ((y - H / 2 - c.panY) / c.scale) * s2 }); };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  });
  const pos = (e) => { const r = cv.current.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  const onDown = (e) => {
    cv.current.setPointerCapture?.(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [x, y] = pos(e);
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; drag.current = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y), c0: { ...c } }; return; }
    const hit = Object.entries(pts).find(([, p]) => { const s = toS(...p); return Math.hypot(s.x - x, s.y - y) < 14 * f; });
    if (hit) { setActive(hit[0]); drag.current = { point: hit[0] }; return; }
    if (active && cephKind === "lat") {
      const mm = toMM(x, y);
      setPlan((p) => ({ ...p, ceph: { ...(p.ceph || {}), points: { ...(p.ceph?.points || {}), [active]: mm } } }));
      const next = CEPH_POINTS.map(([k]) => k).find((k) => k !== active && !(pts[k]));
      setActive(next || null);
      return;
    }
    drag.current = { pan: true, x, y, c0: { ...c } };
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current; if (!d) return;
    const [x, y] = pos(e);
    if (d.pinch && ptrs.current.size >= 2) { const [a, b] = [...ptrs.current.values()]; setCam({ ...d.c0, scale: clamp(d.c0.scale * Math.hypot(a.x - b.x, a.y - b.y) / d.d0, 0.5, 60) }); }
    else if (d.point) setPlan((p) => ({ ...p, ceph: { ...(p.ceph || {}), points: { ...(p.ceph?.points || {}), [d.point]: toMM(x, y) } } }), { record: false });
    else if (d.pan) setCam({ ...d.c0, panX: d.c0.panX + (x - d.x), panY: d.c0.panY + (y - d.y) });
  };
  const onUp = (e) => { ptrs.current.delete(e.pointerId); drag.current = null; };
  return (
    <div className="cv-pane active" style={{ "--vc": "#e2e8f0" }}>
      <div className="cv-pane-head"><span className="cv-pane-title">Cephalogram</span>
        <span className="cv-pane-pos">{active && cephKind === "lat" ? `Tap to place: ${active}` : "Drag a point to adjust · drag the picture to move"}</span>
        <span style={{ marginLeft: "auto" }}><button type="button" className="cv-mini" onClick={() => setCam(null)}>⊡</button></span></div>
      <div ref={wrap} className="cv-pane-body">
        <canvas ref={cv} className="cv-canvas cv-over" style={{ cursor: active ? "crosshair" : "grab" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
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
  const [tab, setTab] = useState("mpr");
  const [tool, setTool] = useState("nav");
  const [cursor, setCursor] = useState([0, 0, 0]);
  const [frame, setFrame] = useState(IDENTITY_FRAME);
  const [wl, setWl] = useState({ w: 4000, l: 1200 });
  const [invert, setInvert] = useState(false);
  const [sharp, setSharp] = useState(false);
  const [autoWl, setAutoWl] = useState(null);
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
  const [three, setThree] = useState({ mode: "bone", thr: 400, clipTop: 1, clipBottom: 0, clipFront: 0, clipLeft: 0, clipRight: 0 });
  const [busy, setBusy] = useState("");
  const [crossMode, setCrossMode] = useState("single");
  const [tmjOffset, setTmjOffset] = useState({});
  const [airway, setAirway] = useState(null);
  const [cephKind, setCephKind] = useState("lat");
  const [cephActive, setCephActive] = useState("S");
  const [cephLook, setCephLook] = useState({ contrast: 1, bright: 0, invert: false });
  const [reportHtml, setReportHtml] = useState("");
  const legacy = useRef([]);
  const hist = useRef({ past: [], future: [] });
  const drag = useRef(null);
  const quickTimer = useRef(0);
  const renderer3d = useRef(null);
  const toastTimer = useRef(0);

  const say = useCallback((text, kind = "info") => { setToast({ text, kind }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3800); }, []);
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
        const aw = autoWindow(v); setAutoWl(aw); setWl(aw);
        const ann = await fetch(`${apiBase}/cbct/${volumeId}/annotations`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
        if (!alive) return;
        const saved = (Array.isArray(ann) ? ann : []).find((a) => a && a.type === "plan" && a.version >= 2);
        legacy.current = (Array.isArray(ann) ? ann : []).filter((a) => a && a.type !== "plan");
        if (saved && saved.plan) {
          setPlanRaw({ ...EMPTY_PLAN, ...saved.plan, ceph: { ...EMPTY_PLAN.ceph, ...(saved.plan.ceph || {}) }, tmj: { ...EMPTY_PLAN.tmj, ...(saved.plan.tmj || {}) }, airway: { ...EMPTY_PLAN.airway, ...(saved.plan.airway || {}) } });
          if ((saved.plan.archPoints || []).length > 1 || (saved.plan.implants || []).length) setTab("implant");
        }
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
  useEffect(() => {
    if (vol && plan.airway.zLo == null) setPlanRaw((p) => ({ ...p, airway: { ...p.airway, zLo: Math.round(vol.Z * 0.35), zHi: Math.round(vol.Z * 0.75) } }));
  }, [vol, plan.airway.zLo]);
  useEffect(() => {
    if (!vol || !plan.airway.seed) { setAirway(null); return undefined; }
    const t = setTimeout(() => setAirway(computeAirway(vol, plan.airway.seed, { thrHu: plan.airway.thr, zLo: plan.airway.zLo, zHi: plan.airway.zHi })), 60);
    return () => clearTimeout(t);
  }, [vol, plan.airway.seed, plan.airway.thr, plan.airway.zLo, plan.airway.zHi]);

  const tmjViews = ["tmjRs", "tmjRc", "tmjLs", "tmjLc"].filter((k) => plan.tmj[k[3]]);
  const views = tab === "implant" ? ["axial", crossMode === "strip" ? "strip" : "cross", "pano", "3d"]
    : tab === "3d" ? ["3d"]
    : tab === "tmj" ? (tmjViews.length === 4 ? tmjViews : ["axial", ...tmjViews, ...(tmjViews.length ? [] : ["coronal"])])
    : ["axial", "sagittal", "coronal", "3d"];
  useEffect(() => {
    if (!views.includes(activeView)) setActiveView(views[0]);
    setMaxView(null);
    if (TOOLS[tool].tabs && !TOOLS[tool].tabs.includes(tab)) setTool("nav");
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const lastImplant = () => lsGet("cbct-last-implant", { system: "Straumann", diameter: 4.1, length: 10 });
  const apexDir = () => [0, 0, (plan.jaw === "upper" ? 1 : -1) * vol.zSign];
  const rotatable = tab === "mpr" || tab === "airway";
  const mprFrame = rotatable ? frame : IDENTITY_FRAME;
  const isMPR = (k) => k === "axial" || k === "coronal" || k === "sagittal";

  /* ── everything a tap / drag does ── */
  const act = (type, P = {}) => {
    if (!vol) return;
    if (type === "interacting") { bumpQuick(); return; }
    if (type === "cancel-drag") { drag.current = null; return; }
    const { kind, view, world } = P;
    if (type === "wheel") {
      bumpQuick();
      const d = P.dir;
      if (isMPR(kind) && view) { const step = Math.min(vol.sx, vol.sy, vol.sz) * (kind === "axial" ? -vol.zSign : 1); setCursor((c) => add(c, mul(view.N, d * step))); }
      else if ((kind === "cross" || kind === "strip") && arch) setPlan((p) => ({ ...p, crossS: clamp(p.crossS + d * p.crossStep, 0, arch.length) }), { record: false });
      else if (kind === "pano") setPlan((p) => ({ ...p, panoOffset: clamp(p.panoOffset + d * 0.5, -20, 20) }), { record: false });
      else if (kind.startsWith("tmj")) setTmjOffset((o) => ({ ...o, [kind]: clamp((o[kind] || 0) + d * 0.5, -15, 15) }));
      return;
    }
    if (type === "down") {
      const S = { vol, plan, arch, selectedId, cursor, tool, frame: mprFrame, rotatable, crossS: P.stripS ?? plan.crossS, crossWidth: plan.crossWidth, panoSlab: plan.panoSlab, crossSlab: plan.crossSlab };
      if (P.button === 2 || tool === "wl") { drag.current = { mode: "wl", x: P.clientX, y: P.clientY, wl0: wl }; return; }
      if (P.button === 1 || tool === "pan") { drag.current = { mode: "pan", x: P.x, y: P.y, cam0: { ...P.cam }, pane: P.paneKind }; return; }
      if (tool === "zoom") { drag.current = { mode: "zoom", y: P.y, x: P.x, cam0: { ...P.cam }, pane: P.paneKind }; return; }
      const hit = hitTest(view, P.cam, P.W, P.H, S, P.x, P.y, P.f);
      if (tool === "nav" && hit && hit.type === "rotate") {
        drag.current = { mode: "rotate", a0: Math.atan2(P.y - hit.c.y, P.x - hit.c.x), c: hit.c, F0: frame, N: view.N, sign: Math.sign(dot(cross(view.U, view.V), view.N)) || 1 };
        return;
      }
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
        drag.current = { mode: hit.type === "implant-apex" ? "tilt" : "move", id: hit.id, w0: world, im0: im, view, moved: false };
        return;
      }
      if (hit && tool === "nav" && hit.type === "nerve-point") { setSelectedId(hit.id); drag.current = { mode: "nerve-point", id: hit.id, index: hit.index, moved: false }; return; }
      if (hit && tool === "nav" && hit.type === "measure") { setSelectedId(hit.id); return; }
      if (tool === "arch") {
        if (kind !== "axial") { say("Draw the arch on the AXIAL view (a slice through the roots).", "warn"); return; }
        setTemp((t) => ({ kind: "arch", points: [...(t?.kind === "arch" ? t.points : []), [world[0], world[1]]] }));
        return;
      }
      if (tool === "nerve") { setTemp((t) => ({ kind: "nerve", side: t?.side || (world[0] > vol.X / 2 ? "L" : "R"), diameter: t?.diameter || 2, points: [...(t?.kind === "nerve" ? t.points : []), world] })); return; }
      if (tool === "condyle") {
        const side = !plan.tmj.R ? "R" : !plan.tmj.L ? "L" : (world[0] < vol.X / 2 ? "R" : "L");
        setPlan((p) => ({ ...p, tmj: { ...p.tmj, [side]: world } }));
        say(side === "R" && !plan.tmj.L ? "Right condyle marked. Now tap the LEFT condyle." : "Condyles marked — the TMJ close-ups are ready.");
        if (side === "L" || plan.tmj.L) setTool("nav");
        return;
      }
      if (tool === "airseed") {
        setPlan((p) => ({ ...p, airway: { ...p.airway, seed: world } }));
        setTool("nav");
        return;
      }
      if (tool === "implant") {
        const d = lastImplant();
        const s = arch ? archNearest(arch, world[0], world[1]).s : 0;
        const im = { id: uid(), tooth: arch ? guessTooth(arch, s, plan.jaw) : "", system: d.system, diameter: d.diameter, length: d.length, top: world, axis: apexDir(), note: "", abutment: 4, crown: true };
        setPlan((p) => ({ ...p, implants: [...p.implants, im], ...(arch && kind !== "cross" ? { crossS: s } : {}) }));
        setSelectedId(im.id); setTool("nav");
        say(`Implant placed${im.tooth ? ` at #${im.tooth}` : ""}. Drag the yellow dot to move it, the orange dot to tilt it.`);
        return;
      }
      if (tool === "dist" || tool === "angle") {
        const need = tool === "dist" ? 2 : 3;
        const pts = [...(temp?.kind === tool ? temp.points : []), world];
        if (pts.length >= need) {
          const value = tool === "dist" ? r1(dist(pts[0], pts[1])) : Math.round(deg(Math.acos(clamp(dot(norm(sub(pts[0], pts[1])), norm(sub(pts[2], pts[1]))), -1, 1))));
          setPlan((p) => ({ ...p, measures: [...p.measures, { id: uid(), type: tool, view: kind, points: pts, value }] }));
          setTemp(null);
        } else setTemp({ kind: tool, points: pts });
        return;
      }
      if (tool === "hu") { const v = vol.huAt(world); if (v != null) setPlan((p) => ({ ...p, measures: [...p.measures, { id: uid(), type: "hu", view: kind, points: [world], value: v }] })); return; }
      setSelectedId(null);
      if (P.stripS != null && Math.abs(P.stripS - plan.crossS) > 0.01) setPlan((p) => ({ ...p, crossS: P.stripS }), { record: false });
      drag.current = { mode: "cursor" };
      moveCursor(kind, view, world);
      return;
    }
    if (type === "move") {
      const d = drag.current; if (!d) return;
      bumpQuick();
      if (d.mode === "wl") setWl({ w: clamp(d.wl0.w + (P.clientX - d.x) * 10, 50, 8000), l: clamp(d.wl0.l - (P.clientY - d.y) * 6, -1000, 4000) });
      else if (d.mode === "pan") setCams((c) => ({ ...c, [d.pane]: { ...d.cam0, panX: d.cam0.panX + (P.x - d.x), panY: d.cam0.panY + (P.y - d.y) } }));
      else if (d.mode === "zoom") {
        const s2 = clamp(d.cam0.scale * Math.exp(-(P.y - d.y) * 0.005), 0.3, 80);
        setCams((c) => ({ ...c, [d.pane]: { scale: s2, panX: d.x - P.W / 2 - ((d.x - P.W / 2 - d.cam0.panX) / d.cam0.scale) * s2, panY: d.y - P.H / 2 - ((d.y - P.H / 2 - d.cam0.panY) / d.cam0.scale) * s2 } }));
      } else if (d.mode === "rotate") {
        const a = Math.atan2(P.y - d.c.y, P.x - d.c.x) - d.a0;
        setFrame(rotateFrame(d.F0, d.N, a * d.sign));
      } else if (d.mode === "cursor") moveCursor(kind, view, world);
      else if (d.mode === "move" && world && d.w0) {
        const top = add(d.im0.top, sub(world, d.w0));
        setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === d.id ? { ...i, top } : i)) }), { record: !d.moved }); d.moved = true;
      } else if (d.mode === "tilt" && world) {
        const im = d.im0, v = d.view;
        const dep = v.plane(implantApex(im))[2] - v.plane(world)[2];
        const target = v.planar ? add(world, mul(v.N, dep)) : world;
        const axis = norm(sub(target, im.top));
        if (dot(axis, im.axis) < 0.2) return;
        setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === d.id ? { ...i, axis } : i)) }), { record: !d.moved }); d.moved = true;
      } else if (d.mode === "nerve-point" && world) {
        setPlan((p) => ({ ...p, nerves: p.nerves.map((n) => (n.id === d.id ? { ...n, points: n.points.map((q, k) => (k === d.index ? world : q)) } : n)) }), { record: !d.moved }); d.moved = true;
      }
      return;
    }
    if (type === "up") { drag.current = null; setQuick(false); }
  };
  const moveCursor = (kind, view, world) => {
    if (!world) return;
    const cl = (p) => [clamp(p[0], 0, vol.X), clamp(p[1], 0, vol.Y), clamp(p[2], 0, vol.Z)];
    if (isMPR(kind) || kind.startsWith("tmj") || kind === "cross") setCursor(cl(world));
    else if (kind === "pano" && arch) { const a = view.plane(world)[0]; setPlan((p) => ({ ...p, crossS: clamp(a, 0, arch.length) }), { record: false }); setCursor(cl(world)); }
  };

  const finishArch = () => {
    if (!temp || temp.kind !== "arch" || temp.points.length < 3) { say("Tap at least 3 points along the jaw on the axial view.", "warn"); return; }
    const a = buildArch(temp.points);
    setPlan((p) => ({ ...p, archPoints: a.points, crossS: a.length / 2, archZ: cursor[2] }));
    setTemp(null); setTool("nav"); setCams((c) => ({ ...c, pano: null, cross: null, strip: null }));
    say("Arch ready — the panoramic and cross-section views are made from it.");
  };
  const finishNerve = () => {
    if (!temp || temp.kind !== "nerve" || temp.points.length < 2) { say("Tap at least 2 points along the canal.", "warn"); return; }
    const n = { id: uid(), side: temp.side, diameter: temp.diameter || 2, points: temp.points };
    setPlan((p) => ({ ...p, nerves: [...p.nerves, n] }));
    setTemp(null); setTool("nav"); setSelectedId(n.id);
    say("Nerve saved. It shows in every view; implants closer than the safety margin turn red.");
  };
  const removeSelected = () => {
    if (!selectedId) return;
    setPlan((p) => ({ ...p, implants: p.implants.filter((i) => i.id !== selectedId), nerves: p.nerves.filter((n) => n.id !== selectedId), measures: p.measures.filter((m) => m.id !== selectedId) }));
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (e.key === "Escape") { if (temp) setTemp(null); else if (maxView) setMaxView(null); else setSelectedId(null); return; }
      if (e.key === "Enter" && temp) { if (temp.kind === "arch") finishArch(); else if (temp.kind === "nerve") finishNerve(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { removeSelected(); return; }
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && vol && activeView !== "3d") {
        const v = makeView(activeView === "strip" ? "cross" : activeView, vol, { cursor, arch, crossS: plan.crossS, crossWidth: plan.crossWidth, panoOffset: plan.panoOffset, frame: mprFrame, condyles: plan.tmj, tmjOffset });
        act("wheel", { kind: activeView, view: v, dir: e.key === "ArrowUp" ? -1 : 1 }); e.preventDefault(); return;
      }
      const t = Object.entries(TOOLS).find(([, v]) => v.key.toLowerCase() === e.key.toLowerCase());
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey && (!t[1].tabs || t[1].tabs.includes(tab))) setTool(t[0]);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  /* ── save ── */
  const save = async () => {
    setSaveState("saving");
    try {
      const body = [...legacy.current, { type: "plan", view: "3d", version: 2, plan }];
      const r = await fetch(`${apiBase}/cbct/${volumeId}/annotations`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      setSaveState("saved"); setDirty(false); setTimeout(() => setSaveState(""), 2200);
    } catch { setSaveState("error"); say("The plan could not be saved. Check the internet and try again.", "err"); }
  };
  const rebuild = async () => {
    setBusy("Making the full-quality 3-D scan… (up to a minute)");
    try {
      const r = await fetch(`${apiBase}/cbct/${volumeId}/volume/rebuild`, { method: "POST", headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Server ${r.status}`);
      if (dirty) await save();
      window.location.reload();
    } catch (e) { say(e.message || "Could not rebuild.", "err"); } finally { setBusy(""); }
  };

  /* ── pictures for the report ── */
  const snapshot = (kind, { W = 900, H = 600, center = null, mm = null, st = {}, mask = null } = {}) => {
    const stt = { cursor: st.cursor || cursor, arch, crossS: st.crossS ?? plan.crossS, crossWidth: plan.crossWidth, panoOffset: plan.panoOffset, frame: IDENTITY_FRAME, condyles: plan.tmj, tmjFov: plan.tmj.fov, tmjOffset: {} };
    const view = makeView(kind, vol, stt);
    if (!view) return null;
    const cam = { scale: fitScale(view, vol, W, H), panX: 0, panY: 0 };
    if (mm) cam.scale = Math.min(W, H) / mm;
    if (center) { const [a, b] = view.plane(center); cam.panX = -(a - view.a0) * cam.scale; cam.panY = -(b - view.b0) * cam.scale; }
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.putImageData(renderView(view, vol, cam, W, H, makeLut(vol, wl.w, wl.l, false), { slab: kind === "pano" ? plan.panoSlab : kind === "cross" ? plan.crossSlab : 0, mask }), 0, 0);
    drawOverlay(g, view, cam, W, H, { vol, plan, arch, cursor: stt.cursor, selectedId: null, temp: null, report: true, crossS: stt.crossS, crossWidth: plan.crossWidth, panoSlab: plan.panoSlab, crossSlab: plan.crossSlab, dpr: 1.4 });
    return c.toDataURL("image/jpeg", 0.9);
  };
  const cephSnapshot = () => {
    const P = plan.ceph.points || {};
    if (!Object.keys(P).length) return null;
    const proj = cephProjection(vol, "lat");
    const k = 6, c = document.createElement("canvas"); c.width = Math.round(proj.mmW * k); c.height = Math.round(proj.mmH * k);
    const g = c.getContext("2d");
    const tmp = document.createElement("canvas"); tmp.width = proj.W; tmp.height = proj.H; tmp.getContext("2d").putImageData(cephImage(proj, cephLook), 0, 0);
    g.drawImage(tmp, 0, 0, c.width, c.height);
    const line = (a, b, col) => { if (!P[a] || !P[b]) return; g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(P[a][0] * k, P[a][1] * k); g.lineTo(P[b][0] * k, P[b][1] * k); g.stroke(); };
    line("S", "N", "#38bdf8"); line("N", "A", "#a78bfa"); line("N", "B", "#a78bfa"); line("Po", "Or", "#34d399"); line("Go", "Me", "#fbbf24"); line("U1", "U1a", "#f472b6"); line("L1", "L1a", "#f472b6");
    for (const [n, p] of Object.entries(P)) { g.fillStyle = "#ef4444"; g.beginPath(); g.arc(p[0] * k, p[1] * k, 6, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "700 20px system-ui"; g.fillText(n, p[0] * k + 8, p[1] * k - 8); }
    return c.toDataURL("image/jpeg", 0.88);
  };
  const reportImages = () => {
    const out = { implants: [] };
    if (arch) out.pano = snapshot("pano", { W: 1400, H: Math.round(clamp((1400 * vol.Z) / arch.length, 380, 760)) });
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
        R.draw({ mode: three.mode, thresholdHu: three.thr, clip: { lo: [three.clipRight || 0, three.clipFront, three.clipBottom], hi: [1 - (three.clipLeft || 0), 1, three.clipTop] } });
        const c = document.createElement("canvas"); c.width = R.canvas.width; c.height = R.canvas.height;
        const g = c.getContext("2d"); g.drawImage(R.canvas, 0, 0);
        const over = R.canvas.parentElement?.querySelector(".cv-over"); if (over) g.drawImage(over, 0, 0);
        out.three = c.toDataURL("image/jpeg", 0.88);
      } catch { /* 3-D not available */ }
    }
    return out;
  };
  const extraSections = () => {
    let html = "";
    const rows = cephAnalysis(plan.ceph.points || {}).filter((r) => r.value != null);
    if (rows.length) {
      const img = cephSnapshot();
      html += `<h2>Cephalometric analysis (lateral, made from the scan)</h2>${img ? `<img src="${img}" alt="" style="max-width:520px">` : ""}
      <table><thead><tr><th>Measurement</th><th>Value</th><th>Normal</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="${r.flag !== "ok" ? "bad" : ""}">${r.value}°</td><td>${r.norm} ± ${r.sd}°</td><td>${esc(r.flag === "ok" ? "within normal" : r.flag === "high" ? "above normal" : "below normal")}</td></tr>`).join("")}
      </tbody></table>`;
    }
    if (airway && !airway.error) {
      const sag = snapshot("sagittal", { W: 700, H: 600, st: { cursor: plan.airway.seed }, mask: airway.mask });
      html += `<h2>Airway</h2><p>Volume <b>${r1(airway.cc)} cc</b> between the chosen levels · narrowest cross-section <b>${airway.min ? Math.round(airway.min.mm2) : "—"} mm²</b>${airway.min ? ` at ${r1(airway.min.z)} mm` : ""} · threshold ${airway.thrHu} HU.</p>${sag ? `<img src="${sag}" alt="" style="max-width:520px">` : ""}`;
    }
    if (plan.tmj.R || plan.tmj.L) {
      html += `<h2>TMJ</h2><div class="pair">`;
      for (const k of ["tmjRs", "tmjRc", "tmjLs", "tmjLc"]) { if (!plan.tmj[k[3]]) continue; const im = snapshot(k, { W: 500, H: 500 }); if (im) html += `<figure><img src="${im}" alt=""><figcaption>${esc(VIEW_TITLE[k])}</figcaption></figure>`; }
      html += `</div>`;
    }
    return html;
  };
  const makeReport = () => {
    const images = reportImages();
    let html = buildReportHTML({ meta, plan, vol, images });
    const extra = extraSections();
    if (extra) html = html.replace('<p class="note">', `${extra}<p class="note">`);
    return { html, images };
  };
  const screenShot = () => {
    const panes = [...document.querySelectorAll(".cv-pane")];
    if (!panes.length) return;
    const rects = panes.map((p) => p.getBoundingClientRect());
    const x0 = Math.min(...rects.map((r) => r.left)), y0 = Math.min(...rects.map((r) => r.top));
    const x1 = Math.max(...rects.map((r) => r.right)), y1 = Math.max(...rects.map((r) => r.bottom));
    const k = 1.5, c = document.createElement("canvas"); c.width = (x1 - x0) * k; c.height = (y1 - y0) * k;
    const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    panes.forEach((p) => p.querySelectorAll("canvas").forEach((cv) => { const r = cv.getBoundingClientRect(); g.drawImage(cv, (r.left - x0) * k, (r.top - y0) * k, r.width * k, r.height * k); }));
    c.toBlob((b) => downloadBlob(b, `cbct-${volumeId}-screen.png`), "image/png");
  };
  const doExport = async (kind) => {
    if (!vol) return;
    if (kind === "dicom") {
      try {
        const r = await fetch(`${apiBase}/cbct/${volumeId}/original`, { headers: authHeaders() }); const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.url) throw new Error(j.error || "The original DICOM is not kept for this scan.");
        const a = document.createElement("a"); a.href = j.url; a.download = `cbct-${volumeId}-dicom.zip`; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { say(e.message, "err"); }
      return;
    }
    if (kind === "stl") {
      if (!plan.implants.length) { say("No implants planned yet.", "warn"); return; }
      downloadBlob(new Blob([implantsSTL(plan.implants, `implants_${volumeId}`)], { type: "model/stl" }), `implants-${volumeId}.stl`); return;
    }
    if (kind === "screen") { screenShot(); return; }
    const pre = kind === "pdf" ? window.open("", "_blank") : null;
    if (pre) pre.document.write("<p style='font-family:system-ui;padding:20px'>Making the report…</p>");
    setBusy("Making the report…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (kind === "pdf") openReport(makeReport().html, pre);
      else if (kind === "png") { const blob = await reportPNG({ meta, plan, vol, images: reportImages() }); downloadBlob(blob, `implant-plan-${volumeId}.png`); }
      else if (kind === "json") {
        const data = { ...planFile({ meta, plan, vol, volumeId }), ceph: cephAnalysis(plan.ceph.points || {}), airway: airway && !airway.error ? { cc: airway.cc, narrowest_mm2: airway.min?.mm2, at_mm: airway.min?.z } : null, tmj: plan.tmj };
        downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `implant-plan-${volumeId}.json`);
      }
    } catch (e) { console.error(e); say("The report could not be made.", "err"); }
    finally { setBusy(""); }
  };
  useEffect(() => {
    if (tab !== "report" || !vol) return undefined;
    setBusy("Making the report…");
    const t = setTimeout(() => { try { setReportHtml(makeReport().html.replace('<div class="bar">', '<div class="bar" style="display:none">')); } catch (e) { console.error(e); } finally { setBusy(""); } }, 80);
    return () => clearTimeout(t);
  }, [tab, vol]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const scene = {
    vol, plan, arch, cursor, lut, slab, mip, sharp, selectedId, temp, tool, phone: screen.phone, frame: mprFrame, tmjOffset, rotatable,
    mask: tab === "airway" && airway && !airway.error ? airway.mask : null,
    cursorCss: { nav: "crosshair", pan: "grab", zoom: "zoom-in", wl: "ew-resize", dist: "crosshair", angle: "crosshair", hu: "cell", arch: "copy", nerve: "copy", implant: "copy", condyle: "copy", airseed: "copy", erase: "not-allowed" }[tool],
  };
  const sliderOf = (kind) => {
    if (isMPR(kind)) {
      const v = makeView(kind, vol, { cursor, frame: mprFrame });
      const c = [vol.X / 2, vol.Y / 2, vol.Z / 2], val = dot(sub(cursor, c), v.N), half = v.depthRange;
      const sgn = kind === "axial" ? -vol.zSign : 1;
      return { min: -half, max: half, step: Math.min(vol.sx, vol.sy, vol.sz), value: clamp(val * sgn, -half, half), text: `${val * sgn >= 0 ? "+" : ""}${r1(val * sgn)} mm`,
        set: (x) => { bumpQuick(); setCursor((cur) => add(cur, mul(v.N, x * sgn - dot(sub(cur, c), v.N)))); } };
    }
    if ((kind === "cross" || kind === "strip") && arch) return { min: 0, max: arch.length, step: plan.crossStep, value: plan.crossS, text: `${r1(plan.crossS)} / ${r1(arch.length)} mm`, set: (v) => { bumpQuick(); setPlan((p) => ({ ...p, crossS: v }), { record: false }); } };
    if (kind === "pano" && arch) return { min: -20, max: 20, step: 0.5, value: plan.panoOffset, text: `curve ${plan.panoOffset > 0 ? "+" : ""}${plan.panoOffset} mm`, set: (v) => { bumpQuick(); setPlan((p) => ({ ...p, panoOffset: v }), { record: false }); } };
    if (kind.startsWith("tmj") && plan.tmj[kind[3]]) return { min: -15, max: 15, step: 0.5, value: tmjOffset[kind] || 0, text: `${(tmjOffset[kind] || 0) > 0 ? "+" : ""}${tmjOffset[kind] || 0} mm`, set: (v) => setTmjOffset((o) => ({ ...o, [kind]: v })) };
    return null;
  };
  const curView = views.includes(activeView) ? activeView : views[0];
  const shown = screen.phone ? [curView] : maxView && views.includes(maxView) ? [maxView] : views;
  const gridClass = tab === "ceph" || tab === "report" || shown.length === 1 ? "one" : shown.length === 2 ? "two" : shown.length === 3 ? "three" : "quad";
  const sel = plan.implants.find((i) => i.id === selectedId);
  const selNerve = plan.nerves.find((n) => n.id === selectedId);
  const toolList = Object.entries(TOOLS).filter(([, v]) => !v.tabs || v.tabs.includes(tab));
  const showTools = tab !== "ceph" && tab !== "report" && tab !== "3d";

  const crossToggle = (
    <span className="cv-seg xs">
      <button type="button" className={crossMode === "single" ? "on" : ""} onClick={() => setCrossMode("single")} title="One cross-section">1</button>
      <button type="button" className={crossMode === "strip" ? "on" : ""} onClick={() => setCrossMode("strip")} title="Five cross-sections side by side">5</button>
    </span>
  );

  const toolsGrid = showTools ? (
    <div className="cv-toolgrid" role="toolbar" aria-label="Tools">
      {toolList.map(([k, t]) => (
        <button key={k} type="button" className={`cv-tool ${tool === k ? "on" : ""}`} title={`${t.label} (${t.key}) — ${t.hint}`}
          onClick={() => { setTool(k); if (temp && temp.kind !== k) setTemp(null);
            if (screen.phone) { if (k === "arch" || k === "condyle") setActiveView("axial"); if (k === "nerve") setActiveView(arch ? "pano" : "axial"); if (k === "implant") setActiveView(arch ? (crossMode === "strip" ? "strip" : "cross") : "axial"); if (k === "airseed") setActiveView("sagittal"); } }}>
          <span className="cv-ti">{t.icon}</span><span className="cv-tl">{t.label}</span>
        </button>
      ))}
      <button type="button" className="cv-tool" title="Undo (Ctrl+Z)" onClick={undo} disabled={!hist.current.past.length}><span className="cv-ti">↶</span><span className="cv-tl">Undo</span></button>
      <button type="button" className="cv-tool" title="Redo (Ctrl+Y)" onClick={redo} disabled={!hist.current.future.length}><span className="cv-ti">↷</span><span className="cv-tl">Redo</span></button>
    </div>
  ) : null;

  const panelProps = { tab, plan, setPlan, arch, vol, tool, setTool, temp, setTemp, finishArch, finishNerve, sel, selNerve, selectImplant, setSelectedId, selectedId,
    wl, setWl, autoWl, invert, setInvert, sharp, setSharp, slab, setSlab, mip, setMip, removeSelected, setCursor, rebuild, frame, setFrame, three, setThree,
    airway, cephKind, setCephKind, cephActive, setCephActive, cephLook, setCephLook, doExport, setTmjOffset };

  const openTab = (k) => {
    setTab(k); setTemp(null);
    if (k === "implant" && !arch) { setTool("arch"); setActiveView("axial"); say("Step 1: draw the arch — tap along the jaw on the AXIAL view, then press Done."); }
    if (k === "tmj" && !(plan.tmj.R && plan.tmj.L)) { setTool("condyle"); setActiveView("axial"); say("Find the condyles on the axial view, then tap the RIGHT condyle and the LEFT condyle."); }
    if (k === "airway" && !plan.airway.seed) say("Set the top and bottom levels in the panel, then use 💨 Airway and tap inside the airway.");
  };

  return (
    <div className={`cv-root ${screen.phone ? "phone" : screen.tablet ? "tablet" : "desktop"}`}>
      <style>{CSS}</style>
      <div className="cv-top">
        <div className="cv-brand">🦷<span className="cv-hide-phone"> CBCT</span></div>
        <div className="cv-tabs" role="tablist" aria-label="Modules">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => openTab(k)}>{label}</button>
          ))}
        </div>
        {meta && !screen.phone && <div className="cv-meta">{meta.patient_name || "Patient"} · {meta.study_date || ""} · {vol.nx}×{vol.ny}×{vol.nz} · {r1(vol.sx)} mm</div>}
        <div className="cv-topr">
          <button type="button" className={`cv-btn ${saveState === "saved" ? "ok" : dirty ? "primary" : "ghost"}`} onClick={save} title="Save with this scan (Ctrl+S)">
            {saveState === "saving" ? "…" : saveState === "saved" ? "✓" : "💾"}{screen.phone ? "" : saveState === "saved" ? " Saved" : " Save"}
          </button>
          <Menu label={`⬇${screen.phone ? "" : " Export"}`} items={[
            ["📄 Report — Print / Save as PDF", () => doExport("pdf")], ["🖼 Report as picture (PNG)", () => doExport("png")],
            ["📐 Plan file (positions, ceph, airway)", () => doExport("json")], ["🧊 Implants as STL (guide lab)", () => doExport("stl")],
            ["🗂 Original DICOM (ZIP)", () => doExport("dicom")], ["📷 Picture of the screen", () => doExport("screen")],
          ]} />
          {!screen.desktop && <button type="button" className={`cv-btn ${panelOpen ? "primary" : "ghost"}`} onClick={() => setPanelOpen((v) => !v)} aria-label="Tools and settings">☰</button>}
          {onClose && <button type="button" className="cv-btn ghost" onClick={() => { if (!dirty || window.confirm("The plan has changes that are not saved. Close anyway?")) onClose(); }} title="Close">✕</button>}
        </div>
      </div>

      {screen.phone && views.length > 1 && tab !== "ceph" && tab !== "report" && (
        <div className="cv-viewtabs">
          {views.map((v) => <button key={v} type="button" className={curView === v ? "on" : ""} style={{ "--vc": KIND_COLOR(v) }} onClick={() => setActiveView(v)}>{VIEW_TITLE[v].replace(" · ", " ")}</button>)}
        </div>
      )}

      <div className="cv-body">
        <div className={`cv-grid ${gridClass}`}>
          {tab === "ceph" ? <CephPane vol={vol} plan={plan} setPlan={setPlan} cephKind={cephKind} active={cephActive} setActive={setCephActive} look={cephLook} />
            : tab === "report" ? (
              <div className="cv-pane active" style={{ "--vc": "#e2e8f0" }}>
                <div className="cv-pane-head"><span className="cv-pane-title">Report preview</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}><button type="button" className="cv-btn primary sm" onClick={() => doExport("pdf")}>📄 Print / PDF</button><button type="button" className="cv-btn ghost sm" onClick={() => doExport("png")}>🖼 PNG</button></span></div>
                <div className="cv-pane-body" style={{ background: "#fff" }}><iframe title="Report" className="cv-report" srcDoc={reportHtml} /></div>
              </div>
            )
            : shown.map((k) => (k === "3d"
              ? <Pane3D key={k} scene={scene} settings={three} setSettings={setThree} big={tab === "3d"} onMax={screen.phone || views.length === 1 ? null : (v) => setMaxView((m) => (m ? null : v))} maxed={!!maxView} rendererRef={renderer3d} active={activeView === k} onActivate={setActiveView} />
              : <Pane key={k} kind={k} scene={scene} cam={cams[k]} setCam={setCam} act={act} quick={quick} sliderOf={sliderOf} extraHead={(k === "cross" || k === "strip") ? crossToggle : null}
                  onMax={screen.phone ? null : (v) => setMaxView((m) => (m ? null : v))} maxed={!!maxView} active={activeView === k} onActivate={setActiveView} />))}
        </div>

        {(screen.desktop || panelOpen) && (
          <div className={`cv-panel ${screen.desktop ? "" : "sheet"}`}>
            {!screen.desktop && <div className="cv-sheet-head"><b>Tools &amp; settings</b><button type="button" className="cv-btn ghost" onClick={() => setPanelOpen(false)}>Close</button></div>}
            {!screen.phone && toolsGrid}
            <Panel {...panelProps} />
          </div>
        )}
      </div>
      {screen.phone && toolsGrid && <div className="cv-phonetools">{toolsGrid}</div>}

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
              <button type="button" className="cv-btn ghost sm" onClick={() => setTemp(null)}>Cancel</button>
            </span>
          </>
        ) : <span>{tab === "ceph" ? "Choose a landmark in the panel, then tap it on the cephalogram. Points can be dragged." : tab === "report" ? "The report is made fresh each time you open this tab." : tab === "3d" ? "Drag to turn · two fingers or wheel to zoom · cut away with the sliders in the panel." : TOOLS[tool]?.hint}</span>}
      </div>
      {toast && <div className={`cv-toast ${toast.kind}`} role="status">{toast.text}</div>}
      {busy && <div className="cv-busy"><div className="cv-spin" />{busy}</div>}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   Right panel: settings of the open module
   ═════════════════════════════════════════════════════════════════════════ */
function Panel(P) {
  const { tab, plan, setPlan, arch, vol, tool, setTool, temp, setTemp, finishArch, finishNerve, sel, selNerve, selectImplant, setSelectedId, selectedId,
    wl, setWl, autoWl, invert, setInvert, sharp, setSharp, slab, setSlab, mip, setMip, removeSelected, setCursor, rebuild, frame, setFrame, three, setThree,
    airway, cephKind, setCephKind, cephActive, setCephActive, cephLook, setCephLook, doExport, setTmjOffset } = P;
  const upd = (id, patch) => setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const rows = useMemo(() => (tab === "implant" ? implantRows(plan, vol) : []), [tab, plan, vol]);
  const tiltBy = (im, dir, a) => {
    const c = arch ? archAt(arch, archNearest(arch, im.top[0], im.top[1]).s) : null;
    const k = dir === "bl" ? (c ? [c.tx, c.ty, 0] : [1, 0, 0]) : (c ? [c.nx, c.ny, 0] : [0, 1, 0]);
    upd(im.id, { axis: norm(rotate(im.axis, norm(k), rad(a))) });
  };
  const saveDefault = (im) => lsSet("cbct-last-implant", { system: im.system, diameter: im.diameter, length: im.length });
  const rotated = Math.abs(frame.ez[2] - 1) > 1e-4 || Math.abs(frame.ex[0] - 1) > 1e-4;
  const display = (
    <Sec title="Display">
      <div className="cv-row wrap">{[...(autoWl ? [{ name: "Auto", ...autoWl }] : []), ...PRESETS].map((p) => <button key={p.name} type="button" className={`cv-btn sm ${wl.w === p.w && wl.l === p.l ? "primary" : "ghost"}`} onClick={() => setWl({ w: p.w, l: p.l })}>{p.name}</button>)}</div>
      <Range label="Contrast (window)" min={50} max={8000} step={50} value={wl.w} set={(v) => setWl((x) => ({ ...x, w: v }))} />
      <Range label="Brightness (level)" min={-1000} max={4000} step={25} value={wl.l} set={(v) => setWl((x) => ({ ...x, l: v }))} />
      <label className="cv-check"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Invert (black bone)</label>
      <label className="cv-check"><input type="checkbox" checked={sharp} onChange={(e) => setSharp(e.target.checked)} /> Sharpen (crisper edges)</label>
      {(tab === "mpr" || tab === "airway") && (
        <>
          <Range label="Slab thickness" unit="mm" min={0} max={30} step={1} value={slab} set={setSlab} />
          <label className="cv-check"><input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} /> MIP (brightest point) in the slab</label>
        </>
      )}
    </Sec>
  );
  const measures = (
    <Sec title={`Measurements (${plan.measures.length})`}>
      {!plan.measures.length && <p className="cv-help">Use 📏 Distance, ∠ Angle or ◉ Density from the tools.</p>}
      {plan.measures.map((m) => (
        <div key={m.id} className={`cv-item ${selectedId === m.id ? "sel" : ""}`} onClick={() => { setSelectedId(m.id); setCursor(m.points[0]); }}>
          <span>{m.type === "hu" ? "◉" : m.type === "angle" ? "∠" : "📏"}</span>
          <span className="cv-grow">{m.type === "hu" ? `${m.value} HU` : m.type === "angle" ? `${m.value}°` : `${m.value} mm`}</span>
          <span className="cv-small">{VIEW_TITLE[m.view] || m.view}</span>
          <button type="button" className="cv-x" onClick={(e) => { e.stopPropagation(); setPlan((p) => ({ ...p, measures: p.measures.filter((x) => x.id !== m.id) })); }} aria-label="Delete">✕</button>
        </div>
      ))}
    </Sec>
  );
  return (
    <div className="cv-panel-in">
      {tab === "mpr" && (
        <Sec title="MPR">
          <p className="cv-help">Drag the round handles on the coloured lines to rotate the planes (oblique slices). Scroll or use the slider under each view to move through the scan.</p>
          <div className="cv-row wrap">
            <button type="button" className="cv-btn ghost sm" disabled={!rotated} onClick={() => setFrame(IDENTITY_FRAME)}>↺ Straighten planes</button>
            <button type="button" className="cv-btn ghost sm" onClick={() => setCursor([vol.X / 2, vol.Y / 2, vol.Z / 2])}>⌖ Centre</button>
          </div>
        </Sec>
      )}

      {tab === "implant" && (
        <>
          <Sec title="1 · Arch" done={!!arch}>
            <div className="cv-row"><span className="cv-lbl">Jaw</span>
              <div className="cv-seg sm">{["upper", "lower"].map((j) => <button key={j} type="button" className={plan.jaw === j ? "on" : ""} onClick={() => setPlan((p) => ({ ...p, jaw: j }))}>{j === "upper" ? "Upper" : "Lower"}</button>)}</div></div>
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
                <span className="cv-grow">{n.side === "L" ? "Left" : "Right"} nerve · {n.points.length} pts</span>
                <select className="cv-sel" value={n.diameter || 2} onClick={(e) => e.stopPropagation()} onChange={(e) => setPlan((p) => ({ ...p, nerves: p.nerves.map((x) => (x.id === n.id ? { ...x, diameter: Number(e.target.value) } : x)) }))} aria-label="Canal diameter">
                  {[1.5, 2, 2.5, 3, 3.5].map((d) => <option key={d} value={d}>Ø {d} mm</option>)}
                </select>
                <button type="button" className="cv-x" onClick={(e) => { e.stopPropagation(); setPlan((p) => ({ ...p, nerves: p.nerves.filter((x) => x.id !== n.id) })); }} aria-label="Delete nerve">✕</button>
              </div>
            ))}
            {selNerve && <p className="cv-help">Drag the nerve's points (Navigate) in any view to correct it.</p>}
            <Range label="Safety margin" unit="mm" min={0.5} max={5} step={0.5} value={plan.safety} set={(v) => setPlan((p) => ({ ...p, safety: v }))} />
            <label className="cv-check"><input type="checkbox" checked={plan.showSafety !== false} onChange={(e) => setPlan((p) => ({ ...p, showSafety: e.target.checked }), { record: false })} /> Safety zone around implants</label>
            <label className="cv-check"><input type="checkbox" checked={plan.showProsthetic !== false} onChange={(e) => setPlan((p) => ({ ...p, showProsthetic: e.target.checked }), { record: false })} /> Show abutment and crown</label>
          </Sec>
          <Sec title={`3 · Implants (${plan.implants.length})`} done={plan.implants.length > 0}>
            <div className="cv-row">
              <button type="button" className={`cv-btn ${tool === "implant" ? "primary" : "ghost"}`} disabled={!arch} onClick={() => setTool("implant")}>🔩 Place implant</button>
              {tool === "implant" && <span className="cv-small">Tap the bone crest</span>}
            </div>
            {rows.map((r, i) => {
              const im = plan.implants[i];
              return (
                <div key={im.id} className={`cv-item imp ${selectedId === im.id ? "sel" : ""} ${r.nerveWarn ? "bad" : ""}`} onClick={() => selectImplant(im.id)}>
                  <b>#{im.tooth || "?"}</b><span className="cv-grow">{im.system} Ø{im.diameter}×{im.length}</span>
                  <span className={r.nerveWarn ? "cv-badv" : "cv-okv"} title="Distance to the nerve">{r.nerve === "no nerve traced" ? "—" : r.nerve}</span>
                </div>
              );
            })}
            {sel && (
              <div className="cv-editor">
                <div className="cv-row">
                  <span className="cv-lbl">Tooth</span>
                  <select className="cv-sel" value={sel.tooth || ""} onChange={(e) => upd(sel.id, { tooth: e.target.value })}><option value="">—</option>{FDI.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <select className="cv-sel grow" value={sel.system} onChange={(e) => { upd(sel.id, { system: e.target.value }); saveDefault({ ...sel, system: e.target.value }); }} aria-label="Implant system">{IMPLANT_SYSTEMS.map((s) => <option key={s}>{s}</option>)}</select>
                </div>
                <div className="cv-row">
                  <span className="cv-lbl">Ø</span>
                  <select className="cv-sel" value={sel.diameter} onChange={(e) => { const d = Number(e.target.value); upd(sel.id, { diameter: d }); saveDefault({ ...sel, diameter: d }); }}>{IMPLANT_DIAMETERS.map((d) => <option key={d} value={Number(d)}>{d} mm</option>)}</select>
                  <span className="cv-lbl">L</span>
                  <select className="cv-sel" value={sel.length} onChange={(e) => { const l = Number(e.target.value); upd(sel.id, { length: l }); saveDefault({ ...sel, length: l }); }}>{IMPLANT_LENGTHS.map((d) => <option key={d} value={Number(d)}>{d} mm</option>)}</select>
                </div>
                <div className="cv-row">
                  <span className="cv-lbl">Abutment</span>
                  <select className="cv-sel" value={sel.abutment ?? 4} onChange={(e) => upd(sel.id, { abutment: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((h) => <option key={h} value={h}>{h} mm</option>)}</select>
                  <label className="cv-check"><input type="checkbox" checked={sel.crown !== false} onChange={(e) => upd(sel.id, { crown: e.target.checked })} /> Crown</label>
                </div>
                <div className="cv-row wrap">
                  <span className="cv-lbl">Depth</span>
                  <button type="button" className="cv-btn ghost sm" onClick={() => upd(sel.id, { top: add(sel.top, mul(sel.axis, -0.5)) })}>▲ 0.5</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => upd(sel.id, { top: add(sel.top, mul(sel.axis, 0.5)) })}>▼ 0.5</button>
                  <span className="cv-lbl">Tilt</span>
                  <button type="button" className="cv-btn ghost sm" onClick={() => tiltBy(sel, "bl", -2)}>B ↶</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => tiltBy(sel, "bl", 2)}>↷ L</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => tiltBy(sel, "md", -2)}>M ↶</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => tiltBy(sel, "md", 2)}>↷ D</button>
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

      {tab === "3d" && (
        <Sec title="3D">
          <div className="cv-row wrap">{THREE_PRESETS.map(([k, l, t]) => <button key={k} type="button" className={`cv-btn sm ${three.mode === k ? "primary" : "ghost"}`} onClick={() => setThree((s) => ({ ...s, mode: k, thr: t }))}>{l}</button>)}</div>
          <Range label="Bone level" unit="HU" min={-300} max={2000} step={25} value={three.thr} set={(v) => setThree((s) => ({ ...s, thr: v }))} />
          <Range label="Cut from top" unit="%" min={0} max={95} step={1} value={Math.round((1 - three.clipTop) * 100)} set={(v) => setThree((s) => ({ ...s, clipTop: Math.max(1 - v / 100, s.clipBottom + 0.05) }))} />
          <Range label="Cut from bottom" unit="%" min={0} max={95} step={1} value={Math.round(three.clipBottom * 100)} set={(v) => setThree((s) => ({ ...s, clipBottom: Math.min(v / 100, s.clipTop - 0.05) }))} />
          <Range label="Cut from front" unit="%" min={0} max={90} step={1} value={Math.round(three.clipFront * 100)} set={(v) => setThree((s) => ({ ...s, clipFront: v / 100 }))} />
          <Range label="Cut patient's right" unit="%" min={0} max={90} step={1} value={Math.round((three.clipRight || 0) * 100)} set={(v) => setThree((s) => ({ ...s, clipRight: v / 100 }))} />
          <Range label="Cut patient's left" unit="%" min={0} max={90} step={1} value={Math.round((three.clipLeft || 0) * 100)} set={(v) => setThree((s) => ({ ...s, clipLeft: v / 100 }))} />
          <button type="button" className="cv-btn ghost sm" onClick={() => setThree((s) => ({ ...s, clipTop: 1, clipBottom: 0, clipFront: 0, clipLeft: 0, clipRight: 0 }))}>Reset cuts</button>
        </Sec>
      )}

      {tab === "ceph" && (
        <>
          <Sec title="Cephalogram">
            <div className="cv-seg sm">{[["lat", "Lateral"], ["pa", "PA"]].map(([k, l]) => <button key={k} type="button" className={cephKind === k ? "on" : ""} onClick={() => setCephKind(k)}>{l}</button>)}</div>
            <Range label="Contrast" min={0.5} max={3} step={0.05} value={cephLook.contrast} set={(v) => setCephLook((s) => ({ ...s, contrast: v }))} />
            <Range label="Brightness" min={-1} max={1} step={0.05} value={cephLook.bright} set={(v) => setCephLook((s) => ({ ...s, bright: v }))} />
            <label className="cv-check"><input type="checkbox" checked={cephLook.invert} onChange={(e) => setCephLook((s) => ({ ...s, invert: e.target.checked }))} /> Invert</label>
          </Sec>
          {cephKind === "lat" && (
            <Sec title="Landmarks">
              <div className="cv-lmgrid">
                {CEPH_POINTS.map(([k, d]) => (
                  <button key={k} type="button" title={d} className={`cv-lm ${cephActive === k ? "on" : ""} ${plan.ceph.points?.[k] ? "done" : ""}`} onClick={() => setCephActive(k)}>{k}</button>
                ))}
              </div>
              {cephActive && <p className="cv-help">{CEPH_POINTS.find(([k]) => k === cephActive)?.[1]}</p>}
              <button type="button" className="cv-btn ghost sm" onClick={() => { setPlan((p) => ({ ...p, ceph: { ...p.ceph, points: {} } })); setCephActive("S"); }}>Clear all points</button>
            </Sec>
          )}
          {cephKind === "lat" && (
            <Sec title="Analysis (Steiner)">
              <table className="cv-table"><tbody>
                {cephAnalysis(plan.ceph.points || {}).map((r) => (
                  <tr key={r.name} title={r.note}><td>{r.name}</td><td className={r.flag === "ok" ? "ok" : r.flag ? "bad" : ""}>{r.value == null ? "—" : `${r.value}°`}</td><td className="cv-small">{r.norm}±{r.sd}</td></tr>
                ))}
              </tbody></table>
              <p className="cv-help">Made from the scan without magnification; compare with norms clinically.</p>
            </Sec>
          )}
        </>
      )}

      {tab === "tmj" && (
        <Sec title="TMJ">
          <div className="cv-row wrap">
            <button type="button" className={`cv-btn sm ${tool === "condyle" ? "primary" : "ghost"}`} onClick={() => { setPlan((p) => ({ ...p, tmj: { ...p.tmj, R: null, L: null } })); setTool("condyle"); }}>⦿ Mark condyles again</button>
          </div>
          <p className="cv-help">Right: {plan.tmj.R ? "marked ✓" : "not marked"} · Left: {plan.tmj.L ? "marked ✓" : "not marked"}. Each joint shows a sagittal and a coronal close-up; scroll or use the slider to move through the joint. Use 📏 Distance for joint spaces.</p>
          <Range label="Field of view" unit="mm" min={20} max={60} step={2} value={plan.tmj.fov || 36} set={(v) => setPlan((p) => ({ ...p, tmj: { ...p.tmj, fov: v } }), { record: false })} />
          <button type="button" className="cv-btn ghost sm" onClick={() => setTmjOffset({})}>Back to the condyle centres</button>
        </Sec>
      )}

      {tab === "airway" && (
        <Sec title="Airway">
          <Range label="Top level" unit="mm" min={0} max={Math.round(vol.Z)} step={0.5} value={plan.airway.zHi ?? Math.round(vol.Z * 0.75)} set={(v) => setPlan((p) => ({ ...p, airway: { ...p.airway, zHi: v } }), { record: false })} />
          <Range label="Bottom level" unit="mm" min={0} max={Math.round(vol.Z)} step={0.5} value={plan.airway.zLo ?? Math.round(vol.Z * 0.35)} set={(v) => setPlan((p) => ({ ...p, airway: { ...p.airway, zLo: v } }), { record: false })} />
          <Range label="Air threshold" unit="HU" min={-900} max={-150} step={25} value={plan.airway.thr} set={(v) => setPlan((p) => ({ ...p, airway: { ...p.airway, thr: v } }), { record: false })} />
          <div className="cv-row"><button type="button" className={`cv-btn sm ${tool === "airseed" ? "primary" : "ghost"}`} onClick={() => setTool("airseed")}>💨 Tap inside the airway</button>
            {plan.airway.seed && <button type="button" className="cv-btn ghost sm" onClick={() => setPlan((p) => ({ ...p, airway: { ...p.airway, seed: null } }))}>Clear</button>}</div>
          {airway?.error && <p className="cv-help" style={{ color: "#fca5a5" }}>{airway.error}</p>}
          {airway && !airway.error && (
            <>
              <div className="cv-stats">
                <div><small>Volume</small><b>{r1(airway.cc)} cc</b></div>
                <div><small>Narrowest</small><b>{airway.min ? `${Math.round(airway.min.mm2)} mm²` : "—"}</b></div>
                <div><small>At level</small><b>{airway.min ? `${r1(airway.min.z)} mm` : "—"}</b></div>
                <div><small>Length</small><b>{r1(Math.abs((plan.airway.zHi ?? 0) - (plan.airway.zLo ?? 0)))} mm</b></div>
              </div>
              <AreaChart areas={airway.areas} min={airway.min} />
              {airway.min && <button type="button" className="cv-btn ghost sm" onClick={() => setCursor((c) => [c[0], c[1], airway.min.z])}>Go to the narrowest level</button>}
            </>
          )}
          <p className="cv-help">The airway shows in colour in the views. Values depend on the levels and threshold you set.</p>
        </Sec>
      )}

      {tab === "report" && (
        <Sec title="Export">
          {[["pdf", "📄 Report — Print / Save as PDF"], ["png", "🖼 Report as picture (PNG)"], ["json", "📐 Plan file (positions, ceph, airway)"], ["stl", "🧊 Implants as STL (guide lab)"], ["dicom", "🗂 Original DICOM (ZIP)"]].map(([k, l]) => (
            <button key={k} type="button" className="cv-btn ghost" style={{ textAlign: "left" }} onClick={() => doExport(k)}>{l}</button>
          ))}
          <p className="cv-help">The report includes the implants, nerve, panoramic and cross-sections, and — when done — the ceph analysis, airway and TMJ views.</p>
        </Sec>
      )}

      {tab !== "ceph" && tab !== "report" && tab !== "3d" && measures}
      {tab !== "ceph" && tab !== "report" && tab !== "3d" && display}
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

function AreaChart({ areas, min }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !areas?.length) return;
    const W = (c.width = 560), H = (c.height = 140), g = c.getContext("2d");
    g.fillStyle = "#020617"; g.fillRect(0, 0, W, H);
    const mx = Math.max(...areas.map((a) => a.mm2)) || 1;
    g.strokeStyle = "#22d3ee"; g.lineWidth = 2; g.beginPath();
    areas.forEach((a, i) => { const x = (i / Math.max(1, areas.length - 1)) * (W - 10) + 5, y = H - 8 - (a.mm2 / mx) * (H - 24); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    if (min) { const i = areas.findIndex((a) => a.z === min.z); const x = (i / Math.max(1, areas.length - 1)) * (W - 10) + 5; g.strokeStyle = "#ef4444"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = "#94a3b8"; g.font = "600 16px system-ui"; g.fillText("Area by level (bottom → top)", 8, 18);
  }, [areas, min]);
  return <canvas ref={ref} style={{ width: "100%", borderRadius: 8 }} />;
}

function Sec({ title, done, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="cv-sec">
      <button type="button" className="cv-sec-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}><span>{done ? "✅ " : ""}{title}</span><span>{open ? "▾" : "▸"}</span></button>
      {open && <div className="cv-sec-b">{children}</div>}
    </div>
  );
}
function Range({ label, unit = "", min, max, step, value, set }) {
  return (
    <label className="cv-range"><span>{label}</span><b>{value}{unit ? ` ${unit}` : ""}</b>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} /></label>
  );
}
function Menu({ label, items }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return undefined; const f = () => setOpen(false); const t = setTimeout(() => window.addEventListener("click", f), 0); return () => { clearTimeout(t); window.removeEventListener("click", f); }; }, [open]);
  return (
    <span className="cv-menu">
      <button type="button" className="cv-btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label}</button>
      {open && <div className="cv-menu-list">{items.map(([t, fn]) => <button key={t} type="button" onClick={() => { setOpen(false); fn(); }}>{t}</button>)}</div>}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
const CSS = `
.cv-root,.cv-full{position:fixed;inset:0;display:flex;flex-direction:column;background:#05070d;color:#e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.cv-center{margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:20px}
.cv-spin{width:36px;height:36px;border-radius:50%;border:3px solid #1e293b;border-top-color:#3b82f6;animation:cvspin .8s linear infinite}
@keyframes cvspin{to{transform:rotate(360deg)}}
.cv-prog{width:min(320px,80vw);height:6px;background:#1e293b;border-radius:6px;overflow:hidden}.cv-prog i{display:block;height:100%;background:linear-gradient(90deg,#2563eb,#38bdf8);transition:width .3s}
.cv-top{display:flex;align-items:stretch;gap:10px;padding:0 8px;background:linear-gradient(180deg,#1b2433,#121925);border-bottom:1px solid #2b3648;flex-shrink:0;min-height:44px}
.cv-brand{font-weight:800;color:#60a5fa;white-space:nowrap;display:flex;align-items:center}
.cv-tabs{display:flex;align-items:flex-end;gap:2px;overflow-x:auto;scrollbar-width:none;min-width:0}
.cv-tabs::-webkit-scrollbar{display:none}
.cv-tabs button{border:1px solid transparent;border-bottom:none;background:none;color:#9fb0c8;font:700 13px system-ui,sans-serif;padding:9px 14px 10px;border-radius:8px 8px 0 0;cursor:pointer;white-space:nowrap}
.cv-tabs button:hover{color:#e2e8f0;background:rgba(255,255,255,.04)}
.cv-tabs button.on{background:#05070d;color:#fff;border-color:#2b3648;box-shadow:inset 0 2px 0 #3b82f6}
.cv-meta{font-size:11.5px;color:#7d8ba1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;display:flex;align-items:center}
.cv-topr{display:flex;gap:6px;align-items:center;margin-left:auto;flex-shrink:0}
.cv-seg{display:inline-flex;background:#1e293b;border-radius:9px;padding:2px}
.cv-seg button{border:none;background:none;color:#94a3b8;font:600 12.5px system-ui,sans-serif;padding:6px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}
.cv-seg button.on{background:#2563eb;color:#fff}
.cv-seg.sm button{padding:4px 9px;font-size:12px}.cv-seg.xs button{padding:1px 7px;font-size:11px}
.cv-btn{border:1px solid transparent;border-radius:8px;padding:7px 12px;font:600 12.5px system-ui,sans-serif;cursor:pointer;background:#1e293b;color:#e2e8f0;white-space:nowrap;touch-action:manipulation}
.cv-btn.sm{padding:4px 9px;font-size:12px}
.cv-btn.ghost{background:#0f172a;border-color:#334155}
.cv-btn.primary{background:#2563eb;color:#fff}.cv-btn.ok{background:#15803d;color:#fff}.cv-btn.danger{background:#7f1d1d;color:#fecaca}
.cv-btn:disabled{opacity:.4;cursor:default}
.cv-menu{position:relative}
.cv-menu-list{position:absolute;right:0;top:calc(100% + 6px);background:#0f172a;border:1px solid #334155;border-radius:10px;padding:6px;z-index:50;min-width:270px;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.cv-menu-list button{display:block;width:100%;text-align:left;border:none;background:none;color:#e2e8f0;padding:9px 10px;border-radius:7px;font:500 13px system-ui,sans-serif;cursor:pointer}
.cv-menu-list button:hover{background:#1e293b}
.cv-body{flex:1;display:flex;min-height:0;position:relative}
.cv-grid{flex:1;display:grid;gap:3px;background:#000;min-width:0;min-height:0;padding:3px}
.cv-grid.quad{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.cv-grid.three{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}.cv-grid.three > :first-child{grid-row:1/3}
.cv-grid.two{grid-template-columns:1fr 1fr;grid-template-rows:1fr}
.cv-grid.one{grid-template-columns:1fr;grid-template-rows:1fr}
.cv-pane{position:relative;display:flex;flex-direction:column;background:#000;min-width:0;min-height:0;border:1px solid #1f2937}
.cv-pane.active{border-color:var(--vc)}
.cv-pane-head{display:flex;align-items:center;gap:8px;padding:3px 6px;background:#0d1320;font-size:12px;flex-shrink:0;border-bottom:1px solid #1f2937}
.cv-pane-title{font-weight:800;letter-spacing:.03em;white-space:nowrap}
.cv-pane-pos{color:#64748b;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-mini{border:none;background:#1e293b;color:#cbd5e1;border-radius:6px;min-width:24px;height:22px;font-size:12px;cursor:pointer;touch-action:manipulation}
.cv-sel{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:3px 5px;font-size:12px}
.cv-sel.grow{flex:1;min-width:0}
.cv-pane-body{position:relative;flex:1;min-height:0;overflow:hidden}
.cv-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.cv-over{touch-action:none}
.cv-report{position:absolute;inset:0;width:100%;height:100%;border:none;background:#fff}
.cv-hover{position:absolute;right:6px;top:6px;font-size:11px;color:#22d3ee;background:rgba(2,6,23,.7);padding:2px 6px;border-radius:5px;pointer-events:none}
.cv-slider{width:100%;margin:0;accent-color:var(--vc);height:20px;background:#0d1320;flex-shrink:0}
.cv-3dbar{display:flex;gap:10px;flex-wrap:wrap;padding:3px 8px;background:#0d1320;font-size:10.5px;color:#94a3b8;flex-shrink:0}
.cv-3dbar label{display:flex;align-items:center;gap:4px}.cv-3dbar input{width:74px;accent-color:#a78bfa}
.cv-3derr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#94a3b8;font-size:13px}
.cv-panel{width:330px;flex-shrink:0;background:#0b1120;border-left:1px solid #1f2937;overflow-y:auto}
.cv-panel.sheet{position:absolute;right:0;top:0;bottom:0;z-index:30;box-shadow:-10px 0 30px rgba(0,0,0,.5);width:min(360px,92vw)}
.cv-sheet-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#0b1120;z-index:2}
.cv-toolgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;padding:8px;border-bottom:1px solid #1f2937;background:#0d1320}
.cv-tool{display:flex;flex-direction:column;align-items:center;gap:2px;border:1px solid #1f2937;background:#111827;color:#a5b4c8;border-radius:8px;padding:6px 2px;cursor:pointer;touch-action:manipulation}
.cv-tool .cv-ti{font-size:17px;line-height:1}.cv-tool .cv-tl{font-size:9.5px;font-weight:600}
.cv-tool.on{background:#1d4ed8;color:#fff;border-color:#3b82f6}
.cv-tool:disabled{opacity:.35}
.cv-panel-in{padding:8px}
.cv-sec{border:1px solid #1f2937;border-radius:10px;margin-bottom:8px;overflow:hidden}
.cv-sec-h{display:flex;justify-content:space-between;width:100%;border:none;background:#111827;color:#e2e8f0;font:700 13px system-ui,sans-serif;padding:9px 10px;cursor:pointer}
.cv-sec-b{padding:8px 10px;display:flex;flex-direction:column;gap:7px}
.cv-row{display:flex;align-items:center;gap:6px}.cv-row.wrap{flex-wrap:wrap}
.cv-lbl{font-size:11.5px;color:#94a3b8;font-weight:600}.cv-small{font-size:11.5px;color:#94a3b8}
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
.cv-lmgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.cv-lm{border:1px solid #334155;background:#0f172a;color:#cbd5e1;border-radius:7px;padding:6px 0;font:700 12px system-ui;cursor:pointer}
.cv-lm.done{border-color:#16a34a;color:#86efac}.cv-lm.on{background:#facc15;color:#111;border-color:#facc15}
.cv-table{width:100%;border-collapse:collapse;font-size:12.5px}.cv-table td{padding:5px 4px;border-bottom:1px solid #1e293b}
.cv-table td.ok{color:#4ade80;font-weight:700}.cv-table td.bad{color:#f87171;font-weight:800}
.cv-hint{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:6px 10px;background:#0d1320;border-top:1px solid #1f2937;font-size:12px;color:#94a3b8;flex-shrink:0;min-height:32px}
.cv-hint-btns{display:flex;gap:6px;flex-shrink:0}
.cv-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:#1e3a8a;color:#fff;padding:9px 14px;border-radius:10px;font-size:13px;z-index:60;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.cv-toast.warn{background:#92400e}.cv-toast.err{background:#991b1b}
.cv-busy{position:fixed;inset:0;background:rgba(2,6,23,.7);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:70;color:#bfdbfe}
.cv-viewtabs{display:flex;gap:4px;padding:4px 6px;background:#0d1320;border-bottom:1px solid #1f2937;overflow-x:auto;flex-shrink:0}
.cv-viewtabs button{flex:1;border:none;border-radius:8px;padding:7px 6px;background:#1e293b;color:#cbd5e1;font:700 12px system-ui,sans-serif;white-space:nowrap}
.cv-viewtabs button.on{background:var(--vc);color:#020617}
.cv-phonetools{flex-shrink:0;border-top:1px solid #1f2937;background:#0d1320;overflow-x:auto}
.cv-phonetools .cv-toolgrid{display:flex;gap:4px;padding:4px;border:none;background:none}
.cv-phonetools .cv-tool{min-width:56px}
.cv-root.phone .cv-hide-phone{display:none}
.cv-root.phone .cv-top{gap:4px;padding:0 4px}
.cv-root.phone .cv-tabs button{padding:9px 9px 10px;font-size:12.5px}
.cv-root.phone .cv-btn{padding:7px 9px}
.cv-root.phone .cv-grid{padding:0}
.cv-root.phone .cv-panel.sheet{left:0;right:0;top:auto;bottom:0;width:auto;max-height:64%;border-radius:14px 14px 0 0;border-left:none;border-top:1px solid #334155}
.cv-root.phone .cv-hint{font-size:11.5px;flex-wrap:wrap}
`;