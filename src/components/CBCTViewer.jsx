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
import { buildReportHTML, openReport, reportPNG, planFile, downloadBlob, implantRows, REPORT_SECTIONS } from "./cbct/report";
import { cephProjection, cephImage, CEPH_POINTS, cephAnalysis, computeAirway, implantsSTL, CEPH3D_POINTS, CEPH3D_LINES, ceph3dAnalysis } from "./cbct/tools";
import { autoAlign, renderFusion, nudgeT, distanceField } from "./cbct/fusion";
import { exportDicomZip } from "./cbct/dicomExport";
import ScanBrowser, { DBM_CSS } from "./cbct/ScanBrowser";
import { buildGuide, guideToVolume, guideSTL, GUIDE_DEFAULTS } from "./cbct/guide";
import { CATALOG, DEFAULT_PICK, findLine, systemName, normaliseImplant, implantSVG, SHAPE_LABEL, shapeOf } from "./cbct/implantLibrary";

/* ── constants ─────────────────────────────────────────────────────────── */
const TABS = [
  ["mpr", "MPR"], ["implant", "Implant"], ["guide", "Guide"], ["3d", "3D"], ["lightbox", "Lightbox"], ["ceph", "Ceph"], ["tmj", "TMJ"], ["airway", "Airway"], ["fusion", "Fusion"], ["report", "Report"],
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
  jaw: "lower", archPoints: [], crossS: 0, crossWidth: 40, crossStep: 1, crossSlab: 1, panoSlab: 20, panoOffset: 0,
  nerves: [], implants: [], measures: [], safety: 2, showSafety: false, showProsthetic: false,
  ceph: { points: {} }, tmj: { R: null, L: null, fov: 36 }, airway: { seed: null, zLo: null, zHi: null, thr: -400 },
  guide: {}, report: { show: {}, notes: {} },
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
          const F = scene.fusion && (kind === "axial" || kind === "coronal" || kind === "sagittal") ? scene.fusion : null;
          const img = F ? renderFusion(v, vol, F.volB, F.T, c2, hw, hh, scene.lut, F.lutB, { mode: F.mode, mix: F.mix, quick: true, img: imgCache.current[`q${i}`] })
            : renderView(v, vol, c2, hw, hh, scene.lut, { slab, mip: scene.mip && kind !== "cross", quick: true, img: imgCache.current[`q${i}`], mask: scene.mask, maskColor: scene.maskColor });
          imgCache.current[`q${i}`] = img;
          const tmp = imgCache.current[`t${i}`] || document.createElement("canvas");
          tmp.width = hw; tmp.height = hh; tmp.getContext("2d").putImageData(img, 0, 0); imgCache.current[`t${i}`] = tmp;
          ctx.drawImage(tmp, x0, 0, subW, H);
        } else {
          const F = scene.fusion && (kind === "axial" || kind === "coronal" || kind === "sagittal") ? scene.fusion : null;
          const img = F ? renderFusion(v, vol, F.volB, F.T, camNow, subW, H, scene.lut, F.lutB, { mode: F.mode, mix: F.mix, img: imgCache.current[key] })
            : renderView(v, vol, camNow, subW, H, scene.lut, { slab, mip: scene.mip && kind !== "cross", img: imgCache.current[key], mask: scene.mask, maskColor: scene.maskColor });
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
  }, [W, H, views, camNow, quick, scene.lut, scene.plan, scene.temp, scene.selectedId, scene.slab, scene.mip, scene.cursor, scene.arch, scene.mask, scene.tool, scene.rotatable, scene.sharp, scene.fusion, scene.points3d, f, kind, vol]); // eslint-disable-line react-hooks/exhaustive-deps

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
    R.boneSee = settings.see ?? 0.6;
    R.setAirway(scene.airMask || null);
    R.setGuide(scene.guideMask || null);
    const F3 = scene.fusion3d;
    R.setFusion(F3 ? { volB: F3.volB, T: F3.T, dist: F3.dist, mode: F3.mode } : null);
    if (F3) R.setObjects({});
    else R.setObjects({ implants: scene.plan.implants || [], nerves: scene.plan.nerves || [], selectedId: scene.selectedId, showProsthetic: scene.plan.showProsthetic === true,
      points: scene.points3d || [],
      dangerIds: (scene.plan.implants || []).filter((im) => { const g = implantNerveGap(im, scene.plan.nerves); return g && g.gap < scene.plan.safety; }).map((im) => im.id) });
    R.draw({ mode: F3 ? "bone" : settings.mode, thresholdHu: F3 ? Math.min(settings.thr, 900) : settings.thr, quick: moving, clip: { lo: [settings.clipRight || 0, settings.clipFront, settings.clipBottom], hi: [1 - (settings.clipLeft || 0), 1, settings.clipTop] } });
    const g = o.getContext("2d"); g.clearRect(0, 0, W, H);
    const f = W / size.w;
    for (const im of scene.plan.implants || []) {                // tooth number next to each implant
      if (!im.tooth) continue;
      const b = R.project(implantApex(im), W, H);
      g.font = `700 ${11 * f}px system-ui`; const tw = g.measureText(`#${im.tooth}`).width;
      g.fillStyle = "rgba(2,6,23,.7)"; g.fillRect(b.x + 4 * f, b.y - 11 * f, tw + 6 * f, 15 * f);
      g.fillStyle = "#e0f2fe"; g.fillText(`#${im.tooth}`, b.x + 7 * f, b.y);
    }
    for (const q of (F3 ? [] : scene.points3d || [])) {           // 3-D ceph landmark names
      const b = R.project(q.p, W, H);
      g.font = `700 ${10.5 * f}px system-ui`; g.fillStyle = q.active ? "#facc15" : "#a7f3d0"; g.fillText(q.key, b.x + 6 * f, b.y - 5 * f);
    }
    if (F3) {
      g.font = `600 ${11 * f}px system-ui`;
      if (F3.mode === "change") {
        const x0 = 12 * f, y0 = H - 22 * f, w = 160 * f;
        const gr = g.createLinearGradient(x0, 0, x0 + w, 0); gr.addColorStop(0, "#33c766"); gr.addColorStop(0.5, "#fad62e"); gr.addColorStop(1, "#f04038");
        g.fillStyle = gr; g.fillRect(x0, y0, w, 8 * f);
        g.fillStyle = "#e2e8f0"; g.fillText("0", x0, y0 - 4 * f); g.fillText("2.5", x0 + w / 2 - 8 * f, y0 - 4 * f); g.fillText("≥5 mm change", x0 + w - 30 * f, y0 - 4 * f);
      } else {
        g.fillStyle = "#f1e6cc"; g.fillText("■ first scan", 12 * f, H - 30 * f); g.fillStyle = "#73a8ff"; g.fillText("■ second scan", 12 * f, H - 14 * f);
      }
    }
  }, [W, H, settings, tick, moving, scene.plan, scene.selectedId, scene.airMask, scene.fusion3d, scene.points3d, scene.guideMask]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <label>Implants<input type="range" min={0} max={1} step={0.05} value={settings.see ?? 0.6} onChange={(e) => setSettings((s) => ({ ...s, see: Number(e.target.value) }))} title="How much implants and the nerve show through bone" /></label>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   Lightbox: a grid of evenly spaced slices (like OnDemand's Dynamic LightBox)
   ═════════════════════════════════════════════════════════════════════════ */
function LightboxPane({ scene, lb, setLb, setCursor, setPlan, arch }) {
  const wrap = useRef(null), cv = useRef(null);
  const size = useSize(wrap);
  const raf = useRef(0);
  const { vol } = scene;
  const kind = lb.kind === "cross" && !arch ? "axial" : lb.kind;
  const n = lb.cols * lb.rows;
  const dpr = Math.min(window.devicePixelRatio || 1, scene.phone ? 2 : 1.5);
  let W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
  const maxPx = 2.2e6; if (W * H > maxPx) { const k = Math.sqrt(maxPx / (W * H)); W = Math.round(W * k); H = Math.round(H * k); }
  const f = W / size.w, cw = Math.floor(W / lb.cols), ch = Math.floor(H / lb.rows);
  const centre = makeView(kind, vol, { cursor: scene.cursor, arch, crossS: scene.plan.crossS, crossWidth: scene.plan.crossWidth, frame: IDENTITY_FRAME });
  const cellState = (i) => {
    const off = (i - Math.floor((n - 1) / 2)) * lb.gap;
    if (kind === "cross") return { off, st: { cursor: scene.cursor, arch, crossS: clamp(scene.plan.crossS + off, 0, arch.length), crossWidth: scene.plan.crossWidth } };
    const dir = kind === "axial" ? -vol.zSign : 1;
    return { off, st: { cursor: add(scene.cursor, mul(centre.N, off * dir)), frame: IDENTITY_FRAME } };
  };
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = cv.current; if (!c) return;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < n; i++) {
        const { off, st } = cellState(i);
        const v = makeView(kind, vol, st); if (!v) continue;
        let cam = { scale: fitScale(v, vol, cw, ch), panX: 0, panY: 0 };
        if (kind === "cross") cam = { scale: Math.min(cw / scene.plan.crossWidth, ch / (scene.plan.crossWidth * 1.25)), panX: 0, panY: 0 };
        const img = renderView(v, vol, cam, cw, ch, scene.lut, { slab: kind === "cross" ? scene.plan.crossSlab : 0 });
        if (scene.sharp) sharpenImage(img, 0.75);
        const x0 = (i % lb.cols) * cw, y0 = Math.floor(i / lb.cols) * ch;
        g.putImageData(img, x0, y0);
        g.save(); g.beginPath(); g.rect(x0, y0, cw, ch); g.clip(); g.translate(x0, y0);
        drawOverlay(g, v, cam, cw, ch, { ...scene, cursor: st.cursor, crossS: st.crossS ?? scene.plan.crossS, crossWidth: scene.plan.crossWidth, dpr: f * 0.8, report: true, tool: "none" }, { noScale: i > 0 });
        g.fillStyle = off === 0 ? "#facc15" : "#e2e8f0"; g.font = `700 ${11 * f}px system-ui`;
        g.fillText(kind === "cross" ? `${r1(st.crossS)} mm` : `${off > 0 ? "+" : ""}${r1(off)} mm`, 6 * f, 15 * f);
        g.restore();
        g.strokeStyle = off === 0 ? "#facc15" : "#1e293b"; g.lineWidth = (off === 0 ? 2 : 1) * f; g.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
      }
    });
    return () => cancelAnimationFrame(raf.current);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const shift = (d) => {
    if (kind === "cross") setPlan((p) => ({ ...p, crossS: clamp(p.crossS + d * lb.gap, 0, arch.length) }), { record: false });
    else setCursor((c) => add(c, mul(centre.N, d * lb.gap * (kind === "axial" ? -vol.zSign : 1))));
  };
  useEffect(() => {
    const el = cv.current; if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); shift(Math.sign(e.deltaY)); };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  });
  const cellAt = (e) => { const r = cv.current.getBoundingClientRect(); const x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
    return Math.min(n - 1, Math.floor(y / ch) * lb.cols + Math.floor(x / cw)); };
  const pick = (e) => {
    const { st } = cellState(cellAt(e));
    if (kind === "cross") setPlan((p) => ({ ...p, crossS: st.crossS }), { record: false }); else setCursor(st.cursor);
  };
  const title = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal", cross: "Cross-sections" }[kind];
  return (
    <div className="cv-pane active" style={{ "--vc": KIND_COLOR(kind) }}>
      <div className="cv-pane-head"><span className="cv-pane-title" style={{ color: KIND_COLOR(kind) }}>Lightbox · {title}</span>
        <span className="cv-pane-pos">{n} slices · every {lb.gap} mm</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" className="cv-mini" onClick={() => shift(-1)} title="Back">◀</button>
          <button type="button" className="cv-mini" onClick={() => shift(1)} title="Forward">▶</button>
          <button type="button" className="cv-mini" onClick={() => setLb((s) => ({ ...s, gap: Math.max(0.5, s.gap - 0.5) }))} title="Closer">−</button>
          <button type="button" className="cv-mini" onClick={() => setLb((s) => ({ ...s, gap: Math.min(10, s.gap + 0.5) }))} title="Further apart">+</button>
        </span></div>
      <div ref={wrap} className="cv-pane-body">
        <canvas ref={cv} className="cv-canvas cv-over" style={{ cursor: "pointer" }} onClick={pick} />
      </div>
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
  const [lb, setLb] = useState({ kind: "axial", cols: 4, rows: 3, gap: 2 });
  const [ceph3Active, setCeph3Active] = useState("S");
  const [guide, setGuide] = useState(null);               // { G, vmask, tris }
  const [repEdit, setRepEdit] = useState(false);          // typing straight into the report preview
  const [repDirty, setRepDirty] = useState(false);        // the preview has typed changes
  const repFrame = useRef(null);
  const repCache = useRef(null);                          // pictures for the report (made once per visit to the tab)
  const [browser, setBrowser] = useState(null);           // null | "browse" | "compare"
  const [fus, setFus] = useState({ volB: null, metaB: null, idB: null, T: null, rms: null, mode2d: "colour", mix: 0.5, mode3d: "colours", region: "upper", dist: null });
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
          setPlanRaw({ ...EMPTY_PLAN, ...saved.plan, implants: (saved.plan.implants || []).map(normaliseImplant), ceph: { ...EMPTY_PLAN.ceph, ...(saved.plan.ceph || {}) }, tmj: { ...EMPTY_PLAN.tmj, ...(saved.plan.tmj || {}) }, airway: { ...EMPTY_PLAN.airway, ...(saved.plan.airway || {}) }, guide: { ...(saved.plan.guide || {}) }, report: { show: {}, notes: {}, ...(saved.plan.report || {}) } });
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
  const lutB = useMemo(() => (fus.volB ? makeLut(fus.volB, wl.w, wl.l, invert) : null), [fus.volB, wl, invert]);
  const boneHu = autoWl ? clamp(Math.round(autoWl.l - autoWl.w * 0.1), 250, 1200) : 500;   // bone level used for alignment
  useEffect(() => {
    if (vol && plan.airway.zLo == null) setPlanRaw((p) => ({ ...p, airway: { ...p.airway, zLo: Math.round(vol.Z * 0.35), zHi: Math.round(vol.Z * 0.75) } }));
  }, [vol, plan.airway.zLo]);
  useEffect(() => {
    if (!vol || !plan.airway.seed) { setAirway(null); return undefined; }
    const t = setTimeout(() => setAirway(computeAirway(vol, plan.airway.seed, { thrHu: plan.airway.thr, zLo: plan.airway.zLo, zHi: plan.airway.zHi })), 60);
    return () => clearTimeout(t);
  }, [vol, plan.airway.seed, plan.airway.thr, plan.airway.zLo, plan.airway.zHi]);

  const tmjViews = ["tmjRs", "tmjRc", "tmjLs", "tmjLc"].filter((k) => plan.tmj[k[3]]);
  const views = tab === "implant" || tab === "guide" ? ["axial", crossMode === "strip" ? "strip" : "cross", "pano", "3d"]
    : tab === "ceph" && cephKind === "3d" ? ["sagittal", "coronal", "axial", "3d"]
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
  const lastImplant = () => { const d = lsGet("cbct-last-implant", null); return d && d.maker && findLine(d.maker, d.line) ? d : DEFAULT_PICK; };
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
      if (tab === "ceph" && cephKind === "3d" && tool === "nav" && ceph3Active && isMPR(kind) && world) {
        setPlan((p) => ({ ...p, ceph: { ...p.ceph, p3: { ...(p.ceph.p3 || {}), [ceph3Active]: world } } }));
        setCursor(world);
        const done = { ...(plan.ceph.p3 || {}), [ceph3Active]: world };
        setCeph3Active(CEPH3D_POINTS.map(([k]) => k).find((k) => !done[k]) || null);
        return;
      }
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
        const im = { id: uid(), tooth: arch ? guessTooth(arch, s, plan.jaw) : "", maker: d.maker, line: d.line, shape: findLine(d.maker, d.line)?.shape, system: systemName(d.maker, d.line), diameter: d.diameter, length: d.length, top: world, axis: apexDir(), note: "", abutment: 4, crown: true };
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

  /* ── Fusion: a second scan of the same patient, aligned on the bone ── */
  const runAlign = async (volB, region, start = null) => {
    setBusy("Aligning the two scans on the bone… 0%");
    try {
      const r = await autoAlign(vol, volB, { thrHu: boneHu, region, start, onStep: (k) => setBusy(`Aligning the two scans on the bone… ${Math.round(k * 100)}%`) });
      return r;
    } finally { setBusy(""); }
  };
  const loadFusion = async (scan, savedT = null, region = fus.region) => {
    try {
      setBusy("Opening the second scan…");
      const m = await fetch(`${apiBase}/cbct/${scan.id}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("The second scan could not be found."))));
      const vB = await loadVolume(apiBase, scan.id, m, (pp, msg) => setBusy(`Second scan: ${msg} ${Math.round(pp * 100)}%`));
      let T = savedT, rms = null;
      if (!T) { const r = await runAlign(vB, region); T = r.T; rms = r.rms; }
      setFus((f) => ({ ...f, volB: vB, metaB: m, idB: scan.id, T, rms, dist: null, region }));
      setPlan((p) => ({ ...p, fusion: { id: scan.id, T, region, rms } }));
      setTab("fusion");
      say(rms != null ? `Scans aligned — average bone distance ${r1(rms)} mm. Check the overlay and fine-tune if needed.` : "Second scan opened with the saved alignment.");
    } catch (e) { console.error(e); say(e.message || "The second scan could not be opened.", "err"); }
    finally { setBusy(""); }
  };
  const realign = async (region) => {
    if (!fus.volB) return;
    try {
      const r = await runAlign(fus.volB, region);
      setFus((f) => ({ ...f, T: r.T, rms: r.rms, region }));
      setPlan((p) => ({ ...p, fusion: { ...(p.fusion || {}), T: r.T, region, rms: r.rms } }));
      say(`Aligned again — average bone distance ${r1(r.rms)} mm.`);
    } catch (e) { say(e.message, "err"); }
  };
  const nudge = (opt) => {
    if (!fus.T) return;
    const T = nudgeT(fus.T, { ...opt, centre: cursor });
    setFus((f) => ({ ...f, T }));
    setPlan((p) => ({ ...p, fusion: { ...(p.fusion || {}), T } }), { record: false });
  };
  useEffect(() => {                                       // change map needs the distance from the first scan's bone
    if (tab !== "fusion" || !fus.volB || fus.mode3d !== "change" || fus.dist || !vol) return;
    setBusy("Measuring the change… (a few seconds)");
    const t = setTimeout(() => { try { const d = distanceField(vol, boneHu); setFus((f) => ({ ...f, dist: d })); } finally { setBusy(""); } }, 40);
    return () => clearTimeout(t);
  }, [tab, fus.volB, fus.mode3d, fus.dist, vol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                       // reopen a saved comparison
    if (tab === "fusion" && vol && !fus.volB && plan.fusion?.id && !busy) loadFusion({ id: plan.fusion.id }, plan.fusion.T, plan.fusion.region || "upper");
  }, [tab, vol]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportSeries = async () => {
    try {
      setBusy("Making the DICOM series… 0%");
      const blob = await exportDicomZip(vol, { patientName: meta?.patient_name, patientId: meta?.patient_id, studyDate: meta?.study_date }, (k) => setBusy(`Making the DICOM series… ${Math.round(k * 100)}%`));
      downloadBlob(blob, `cbct-${volumeId}-dicom-series.zip`);
    } catch (e) { console.error(e); say("The DICOM series could not be made.", "err"); } finally { setBusy(""); }
  };
  const openScan = (s) => {
    if (dirty && !window.confirm("The plan has changes that are not saved. Open the other scan anyway?")) return;
    const u = new URL(window.location.href); u.searchParams.set("volumeId", s.id); if (u.searchParams.has("id")) u.searchParams.set("id", s.id);
    window.location.href = u.toString();
  };

  /* ── surgical guide ── */
  const gopt = { ...GUIDE_DEFAULTS, thrHu: null, ...(plan.guide || {}) };
  const supportHu = gopt.thrHu ?? (gopt.support === "teeth" ? Math.max(900, boneHu + 500) : boneHu);
  const setG = (patch) => setPlan((p) => ({ ...p, guide: { ...(p.guide || {}), ...patch } }), { record: false });
  const makeGuide = async () => {
    if (!arch) { say("Draw the arch first (Implant tab).", "warn"); return; }
    if (!plan.implants.length) { say("Plan the implants first — the guide needs their positions for the sleeves.", "warn"); return; }
    try {
      setBusy("Designing the guide… 0%");
      const G = await buildGuide(vol, plan, arch, { ...gopt, thrHu: supportHu }, (k, msg) => setBusy(`${msg} ${Math.round(k * 100)}%`));
      setBusy("Showing the guide… 85%"); await new Promise((r) => setTimeout(r, 0));
      const vmask = guideToVolume(vol, G);
      setGuide({ G, vmask, tris: null });
      say(`Guide made — ${r1(G.stats.cc)} cc, ${G.sleeves.length} sleeve${G.sleeves.length === 1 ? "" : "s"}. Check the fit on the cross-sections, then download the STL.`);
    } catch (e) { console.error(e); say(e.message || "The guide could not be made.", "err"); }
    finally { setBusy(""); }
  };
  const downloadGuide = async () => {
    if (!guide) return;
    setBusy("Making the guide STL…"); await new Promise((r) => setTimeout(r, 30));
    try {
      const { blob, triangles } = guideSTL(guide.G, `guide_${volumeId}`);
      setGuide((g) => ({ ...g, tris: triangles }));
      downloadBlob(blob, `surgical-guide-${volumeId}.stl`);
    } catch (e) { console.error(e); say("The STL could not be made.", "err"); } finally { setBusy(""); }
  };
  useEffect(() => { setGuide(null); }, [plan.implants, plan.archPoints]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const X = {};
    let html = "";
    const rows = cephAnalysis(plan.ceph.points || {}).filter((r) => r.value != null);
    if (rows.length) {
      const img = cephSnapshot();
      html += `<h2>Cephalometric analysis (lateral, made from the scan)</h2>${img ? `<img src="${img}" alt="" style="max-width:520px">` : ""}
      <table><thead><tr><th>Measurement</th><th>Value</th><th>Normal</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="${r.flag !== "ok" ? "bad" : ""}">${r.value}°</td><td>${r.norm} ± ${r.sd}°</td><td>${esc(r.flag === "ok" ? "within normal" : r.flag === "high" ? "above normal" : "below normal")}</td></tr>`).join("")}
      </tbody></table>`;
    }
    X.ceph = html; html = "";
    const rows3 = ceph3dAnalysis(plan.ceph.p3 || {}).filter((r) => r.value != null);
    if (rows3.length) {
      html += `<h2>3D cephalometric analysis</h2><table><thead><tr><th></th><th>Measurement</th><th>Value</th><th>Normal</th></tr></thead><tbody>
      ${rows3.map((r) => `<tr><td>${esc(r.group)}</td><td>${esc(r.name)}</td><td class="${r.flag && r.flag !== "ok" ? "bad" : ""}">${r.value} ${esc(r.unit)}</td><td>${r.norm != null ? `${r.norm} ± ${r.sd} ${esc(r.unit)}` : ""}</td></tr>`).join("")}
      </tbody></table>`;
    }
    X.ceph3d = html; html = "";
    if (fus.volB && fus.T) {
      const pics = ["sagittal", "coronal"].map((k) => {
        const v = makeView(k, vol, { cursor, frame: IDENTITY_FRAME }); const W = 520, H = 440;
        const cam = { scale: fitScale(v, vol, W, H), panX: 0, panY: 0 };
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        c.getContext("2d").putImageData(renderFusion(v, vol, fus.volB, fus.T, cam, W, H, makeLut(vol, wl.w, wl.l, false), makeLut(fus.volB, wl.w, wl.l, false), { mode: "colour" }), 0, 0);
        return `<figure><img src="${c.toDataURL("image/jpeg", 0.88)}" alt=""><figcaption>${k === "sagittal" ? "Sagittal" : "Coronal"} overlay — magenta: this scan, green: scan #${fus.idB}, white: unchanged</figcaption></figure>`;
      });
      html += `<h2>Before / after comparison</h2><p>Compared with scan #${esc(fus.idB)}${fus.metaB?.study_date ? ` (${esc(fus.metaB.study_date)})` : ""}. Aligned on the bone${fus.region === "upper" ? " of the upper skull" : fus.region === "lower" ? " of the lower jaw" : ""}${fus.rms != null ? `; average bone distance after alignment ${r1(fus.rms)} mm` : ""}.</p><div class="pair">${pics.join("")}</div>`;
    }
    X.fusion = html; html = "";
    if (airway && !airway.error) {
      const sag = snapshot("sagittal", { W: 700, H: 600, st: { cursor: plan.airway.seed }, mask: airway.mask });
      html += `<h2>Airway</h2><p>Volume <b>${r1(airway.cc)} cc</b> between the chosen levels · narrowest cross-section <b>${airway.min ? Math.round(airway.min.mm2) : "—"} mm²</b>${airway.min ? ` at ${r1(airway.min.z)} mm` : ""} · threshold ${airway.thrHu} HU.</p>${sag ? `<img src="${sag}" alt="" style="max-width:520px">` : ""}`;
    }
    X.airway = html; html = "";
    if (plan.tmj.R || plan.tmj.L) {
      html += `<h2>TMJ</h2><div class="pair">`;
      for (const k of ["tmjRs", "tmjRc", "tmjLs", "tmjLc"]) { if (!plan.tmj[k[3]]) continue; const im = snapshot(k, { W: 500, H: 500 }); if (im) html += `<figure><img src="${im}" alt=""><figcaption>${esc(VIEW_TITLE[k])}</figcaption></figure>`; }
      html += `</div>`;
    }
    X.tmj = html;
    if (guide) {
      const G = guide.G, o = G.opt;
      X.guide = `<h2>Surgical guide</h2><p>${o.support === "teeth" ? "Tooth" : "Bone"}-supported guide designed on this scan · fitting gap ${o.gap} mm · thickness ${o.thick} mm · ${r1(G.stats.cc)} cc.</p>
      <table><thead><tr><th>Implant (tooth)</th><th>Sleeve Ø (hole)</th><th>Sleeve height</th><th>Sleeve top above implant</th><th>Drill depth from sleeve top</th></tr></thead><tbody>
      ${G.sleeves.map((sv) => { const im = plan.implants.find((x) => x.id === sv.id); return `<tr><td>${esc(sv.tooth || "—")}</td><td>${sv.d} mm</td><td>${sv.h} mm</td><td>${o.sleeveTop} mm</td><td><b>${im ? r1(o.sleeveTop + im.length) : "—"} mm</b></td></tr>`; }).join("")}
      </tbody></table>`;
    }
    return X;
  };
  const makeReport = ({ cached = false } = {}) => {
    const images = cached && repCache.current ? repCache.current.images : reportImages();
    const extras = cached && repCache.current ? repCache.current.extras : extraSections();
    repCache.current = { images, extras };
    const html = buildReportHTML({ meta, plan, vol, images, extras, show: plan.report?.show || {}, notes: plan.report?.notes || {} });
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
    if (kind === "series") { exportSeries(); return; }
    const pre = kind === "pdf" ? window.open("", "_blank") : null;
    if (pre) pre.document.write("<p style='font-family:system-ui;padding:20px'>Making the report…</p>");
    setBusy("Making the report…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (kind === "pdf") openReport(makeReport().html, pre);
      else if (kind === "png") { const blob = await reportPNG({ meta, plan, vol, images: reportImages() }); downloadBlob(blob, `implant-plan-${volumeId}.png`); }
      else if (kind === "json") {
        const data = { ...planFile({ meta, plan, vol, volumeId }), ceph: cephAnalysis(plan.ceph.points || {}), ceph3d: { points: plan.ceph.p3 || {}, analysis: ceph3dAnalysis(plan.ceph.p3 || {}) }, fusion: plan.fusion ? { with_scan: plan.fusion.id, transform_A_to_B: plan.fusion.T, average_bone_distance_mm: plan.fusion.rms } : null, airway: airway && !airway.error ? { cc: airway.cc, narrowest_mm2: airway.min?.mm2, at_mm: airway.min?.z } : null, tmj: plan.tmj };
        downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `implant-plan-${volumeId}.json`);
      }
    } catch (e) { console.error(e); say("The report could not be made.", "err"); }
    finally { setBusy(""); }
  };
  const previewHtml = (cached) => makeReport({ cached }).html.replace('<div class="bar">', '<div class="bar" style="display:none">');
  useEffect(() => {
    if (tab !== "report" || !vol) return undefined;
    setBusy("Making the report…"); setRepEdit(false); setRepDirty(false);
    const t = setTimeout(() => { try { setReportHtml(previewHtml(false)); } catch (e) { console.error(e); } finally { setBusy(""); } }, 80);
    return () => clearTimeout(t);
  }, [tab, vol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                       // sections / notes changed: update the preview (unless the doctor typed in it)
    if (tab !== "report" || !repCache.current || repDirty) return undefined;
    const t = setTimeout(() => { try { setReportHtml(previewHtml(true)); } catch (e) { console.error(e); } }, 350);
    return () => clearTimeout(t);
  }, [plan.report]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                       // typing straight into the preview
    const f = repFrame.current; if (!f) return undefined;
    const apply = () => { try { const d = f.contentDocument; if (!d) return; d.designMode = repEdit ? "on" : "off"; d.body.oninput = () => setRepDirty(true); } catch { /* ignore */ } };
    apply(); f.addEventListener("load", apply); return () => f.removeEventListener("load", apply);
  }, [repEdit, reportHtml]);
  const printPreview = () => { try { repFrame.current.contentWindow.focus(); repFrame.current.contentWindow.print(); } catch { doExport("pdf"); } };
  const setRep = (patch) => setPlan((p) => ({ ...p, report: { show: {}, notes: {}, ...(p.report || {}), ...patch } }), { record: false });

  useEffect(() => { try { document.querySelector(".cv-tabs button.on")?.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch { /* old browsers */ } }, [tab]);

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
    vol, plan, arch, cursor, lut, slab, mip, sharp, selectedId, temp, tool, phone: screen.phone,
    info: meta ? { id: meta.patient_id, name: String(meta.patient_name || "").replace(/\^/g, " ").trim(), date: meta.study_date } : null,
    wlInfo: wl, boneHu: three.thr, frame: mprFrame, tmjOffset, rotatable,
    mask: tab === "airway" && airway && !airway.error ? airway.mask : tab === "guide" && guide ? guide.vmask : null,
    maskColor: tab === "guide" ? [45, 212, 191] : undefined,
    guideMask: guide && (tab === "guide" || tab === "3d") ? guide.vmask : null,
    airMask: airway && !airway.error && (tab === "airway" || tab === "3d") ? airway.mask : null,
    fusion: tab === "fusion" && fus.volB && fus.T ? { volB: fus.volB, T: fus.T, lutB, mode: fus.mode2d, mix: fus.mix } : null,
    fusion3d: tab === "fusion" && fus.volB && fus.T && (fus.mode3d !== "change" || fus.dist) ? { volB: fus.volB, T: fus.T, dist: fus.dist, mode: fus.mode3d === "change" ? "change" : "colours" } : null,
    points3d: tab === "ceph" && cephKind === "3d" ? Object.entries(plan.ceph.p3 || {}).map(([key, p]) => ({ key, p, active: key === ceph3Active })) : null,
    lines3d: CEPH3D_LINES,
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
  const cephFlat = tab === "ceph" && cephKind !== "3d";
  const gridClass = cephFlat || tab === "report" || tab === "lightbox" || shown.length === 1 ? "one" : shown.length === 2 ? "two" : shown.length === 3 ? "three" : "quad";
  const sel = plan.implants.find((i) => i.id === selectedId);
  const selNerve = plan.nerves.find((n) => n.id === selectedId);
  const toolList = Object.entries(TOOLS).filter(([, v]) => !v.tabs || v.tabs.includes(tab));
  const showTools = !cephFlat && tab !== "report" && tab !== "3d" && tab !== "lightbox";

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
    airway, cephKind, setCephKind, cephActive, setCephActive, cephLook, setCephLook, doExport, setTmjOffset, lb, setLb,
    ceph3Active, setCeph3Active, fus, setFus, setBrowser, realign, nudge, autoWl, volumeId,
    gopt, setG, supportHu, makeGuide, downloadGuide, guide, setRep, repDirty, setRepDirty, setReportHtml, previewHtml, printPreview };

  const openTab = (k) => {
    setTab(k); setTemp(null);
    if (k === "guide" && (!arch || !plan.implants.length)) say("Plan the arch and the implants in the Implant tab first; then make the guide here.", "warn");
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
          <button type="button" className="cv-btn ghost" onClick={() => setBrowser("browse")} title="All scans (open, compare, DICOM)">📂{screen.phone ? "" : " Scans"}</button>
          <Menu label={`⬇${screen.phone ? "" : " Export"}`} items={[
            ["📄 Report — Print / Save as PDF", () => doExport("pdf")], ["🖼 Report as picture (PNG)", () => doExport("png")],
            ["📐 Plan file (positions, ceph, airway)", () => doExport("json")], ["🧊 Implants as STL (guide lab)", () => doExport("stl")],
            ["🗂 Original DICOM (ZIP)", () => doExport("dicom")], ["💾 DICOM series from the planner (ZIP)", () => doExport("series")], ["📷 Picture of the screen", () => doExport("screen")],
          ]} />
          {!screen.desktop && <button type="button" className={`cv-btn ${panelOpen ? "primary" : "ghost"}`} onClick={() => setPanelOpen((v) => !v)} aria-label="Tools and settings">☰</button>}
          {onClose && <button type="button" className="cv-btn ghost" onClick={() => { if (!dirty || window.confirm("The plan has changes that are not saved. Close anyway?")) onClose(); }} title="Close">✕</button>}
        </div>
      </div>

      {screen.phone && views.length > 1 && !cephFlat && tab !== "report" && tab !== "lightbox" && (
        <div className="cv-viewtabs">
          {views.map((v) => <button key={v} type="button" className={curView === v ? "on" : ""} style={{ "--vc": KIND_COLOR(v) }} onClick={() => setActiveView(v)}>{VIEW_TITLE[v].replace(" · ", " ")}</button>)}
        </div>
      )}

      <div className="cv-body">
        <div className={`cv-grid ${gridClass}`}>
          {tab === "lightbox" ? <LightboxPane scene={scene} lb={lb} setLb={setLb} setCursor={setCursor} setPlan={setPlan} arch={arch} />
            : cephFlat ? <CephPane vol={vol} plan={plan} setPlan={setPlan} cephKind={cephKind} active={cephActive} setActive={setCephActive} look={cephLook} />
            : tab === "report" ? (
              <div className="cv-pane active" style={{ "--vc": "#e2e8f0" }}>
                <div className="cv-pane-head"><span className="cv-pane-title">Report{repEdit ? " — typing on" : ""}</span>
                  {repDirty && <span className="cv-pane-pos">your typed changes are kept for printing</span>}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button type="button" className={`cv-btn sm ${repEdit ? "primary" : "ghost"}`} onClick={() => setRepEdit((v) => !v)} title="Type straight into the report">✏️ {repEdit ? "Done" : "Edit text"}</button>
                    <button type="button" className="cv-btn primary sm" onClick={printPreview}>📄 Print / PDF</button>
                    <button type="button" className="cv-btn ghost sm" onClick={() => doExport("png")}>🖼 PNG</button></span></div>
                <div className="cv-pane-body" style={{ background: "#fff" }}><iframe ref={repFrame} title="Report" className="cv-report" srcDoc={reportHtml} /></div>
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
        ) : <span>{tab === "ceph" && cephKind === "3d" ? `3D Ceph: ${ceph3Active ? `tap ${ceph3Active} on any slice (sagittal is easiest) — scroll to find the right level first` : "all landmarks placed; choose one in the panel to move it"}.`
          : tab === "guide" ? (guide ? "The guide is shown in teal. Check that it sits evenly on the teeth / bone on the cross-sections, then download the STL." : "Set up the guide in the panel and press “Make the guide”.")
          : tab === "fusion" ? (fus.volB ? "Magenta = this scan, green = the second scan, white = the same in both. Fine-tune with the arrows in the panel." : "Choose the second scan of this patient in the panel to compare before / after.")
          : tab === "ceph" ? "Choose a landmark in the panel, then tap it on the cephalogram. Points can be dragged." : tab === "report" ? "Write your notes and choose the sections in the panel. ✏️ Edit text lets you type straight into the report; Print / PDF prints what you see." : tab === "3d" ? "Drag to turn · two fingers or wheel to zoom · cut away with the sliders in the panel." : tab === "lightbox" ? "Lightbox: a series of evenly spaced slices. Scroll to move the series, tap a slice to centre it." : TOOLS[tool]?.hint}</span>}
      </div>
      {browser && (
        <ScanBrowser apiBase={apiBase} currentId={Number(volumeId)} mode={browser} onClose={() => setBrowser(null)}
          onOpen={(s) => { setBrowser(null); openScan(s); }} onExport={() => { setBrowser(null); exportSeries(); }}
          onCompare={(s) => { setBrowser(null); loadFusion(s); }} />
      )}
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
    airway, cephKind, setCephKind, cephActive, setCephActive, cephLook, setCephLook, doExport, setTmjOffset, lb, setLb,
    ceph3Active, setCeph3Active, fus, setFus, setBrowser, realign, nudge,
    gopt, setG, supportHu, makeGuide, downloadGuide, guide, setRep, repDirty, setRepDirty, setReportHtml, previewHtml, printPreview } = P;
  const upd = (id, patch) => setPlan((p) => ({ ...p, implants: p.implants.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const rows = useMemo(() => (tab === "implant" ? implantRows(plan, vol) : []), [tab, plan, vol]);
  const tiltBy = (im, dir, a) => {
    const c = arch ? archAt(arch, archNearest(arch, im.top[0], im.top[1]).s) : null;
    const k = dir === "bl" ? (c ? [c.tx, c.ty, 0] : [1, 0, 0]) : (c ? [c.nx, c.ny, 0] : [0, 1, 0]);
    upd(im.id, { axis: norm(rotate(im.axis, norm(k), rad(a))) });
  };
  const saveDefault = (im) => lsSet("cbct-last-implant", { maker: im.maker, line: im.line, diameter: im.diameter, length: im.length });
  const [libOpen, setLibOpen] = useState(false);
  const selLine = sel ? findLine(sel.maker, sel.line) : null;
  const dList = sel ? [...new Set([...(selLine?.d || []), sel.diameter])].sort((a, b) => a - b) : [];
  const lList = sel ? [...new Set([...(selLine?.l || []), sel.length])].sort((a, b) => a - b) : [];
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
            <label className="cv-check"><input type="checkbox" checked={plan.showSafety === true} onChange={(e) => setPlan((p) => ({ ...p, showSafety: e.target.checked }), { record: false })} /> Safety zone around implants</label>
            <label className="cv-check"><input type="checkbox" checked={plan.showProsthetic === true} onChange={(e) => setPlan((p) => ({ ...p, showProsthetic: e.target.checked }), { record: false })} /> Show abutment and crown</label>
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
                  <button type="button" className="cv-btn ghost sm grow cv-libbtn" onClick={() => setLibOpen(true)} title="Choose from the implant library">📚 {sel.system}</button>
                </div>
                <div className="cv-row">
                  <span className="cv-lbl">Ø</span>
                  <select className="cv-sel" value={sel.diameter} onChange={(e) => { const d = Number(e.target.value); upd(sel.id, { diameter: d }); saveDefault({ ...sel, diameter: d }); }}>{dList.map((d) => <option key={d} value={d}>{d} mm</option>)}</select>
                  <span className="cv-lbl">L</span>
                  <select className="cv-sel" value={sel.length} onChange={(e) => { const l = Number(e.target.value); upd(sel.id, { length: l }); saveDefault({ ...sel, length: l }); }}>{lList.map((d) => <option key={d} value={d}>{d} mm</option>)}</select>
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
          {libOpen && sel && (
            <ImplantLibrary current={sel} onClose={() => setLibOpen(false)}
              onPick={(pk) => { const ln = findLine(pk.maker, pk.line); const patch = { maker: pk.maker, line: pk.line, shape: ln?.shape, system: systemName(pk.maker, pk.line), diameter: pk.diameter, length: pk.length };
                upd(sel.id, patch); saveDefault(patch); setLibOpen(false); }} />
          )}
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
          <Range label="Implants and nerve seen through bone" unit="%" min={0} max={100} step={5} value={Math.round((three.see ?? 0.6) * 100)} set={(v) => setThree((s) => ({ ...s, see: v / 100 }))} />
          <button type="button" className="cv-btn ghost sm" onClick={() => setThree((s) => ({ ...s, clipTop: 1, clipBottom: 0, clipFront: 0, clipLeft: 0, clipRight: 0 }))}>Reset cuts</button>
        </Sec>
      )}

      {tab === "ceph" && (
        <>
          <Sec title="Cephalogram">
            <div className="cv-seg sm">{[["lat", "Lateral"], ["pa", "PA"], ["3d", "3D"]].map(([k, l]) => <button key={k} type="button" className={cephKind === k ? "on" : ""} onClick={() => setCephKind(k)}>{l}</button>)}</div>
            {cephKind !== "3d" && <>
            <Range label="Contrast" min={0.5} max={3} step={0.05} value={cephLook.contrast} set={(v) => setCephLook((s) => ({ ...s, contrast: v }))} />
            <Range label="Brightness" min={-1} max={1} step={0.05} value={cephLook.bright} set={(v) => setCephLook((s) => ({ ...s, bright: v }))} />
            <label className="cv-check"><input type="checkbox" checked={cephLook.invert} onChange={(e) => setCephLook((s) => ({ ...s, invert: e.target.checked }))} /> Invert</label>
            </>}
            {cephKind === "3d" && <p className="cv-help">3D Ceph: landmarks are placed in the scan itself (both sides of the face), so the analysis includes symmetry. Choose a landmark, find it on the slices and tap it.</p>}
          </Sec>
          {cephKind === "3d" && (
            <Sec title={`3D landmarks (${Object.keys(plan.ceph.p3 || {}).length}/${CEPH3D_POINTS.length})`}>
              <div className="cv-lmgrid">
                {CEPH3D_POINTS.map(([k, d]) => (
                  <button key={k} type="button" title={d} className={`cv-lm ${ceph3Active === k ? "on" : ""} ${plan.ceph.p3?.[k] ? "done" : ""}`}
                    onClick={() => { setCeph3Active(k); if (plan.ceph.p3?.[k]) setCursor(plan.ceph.p3[k]); }}>{k}</button>
                ))}
              </div>
              {ceph3Active && <p className="cv-help">{CEPH3D_POINTS.find(([k]) => k === ceph3Active)?.[1]}{plan.ceph.p3?.[ceph3Active] ? " — placed; tap again on a slice to move it." : ""}</p>}
              <div className="cv-row wrap">
                {ceph3Active && plan.ceph.p3?.[ceph3Active] && <button type="button" className="cv-btn ghost sm" onClick={() => setPlan((p) => { const q = { ...(p.ceph.p3 || {}) }; delete q[ceph3Active]; return { ...p, ceph: { ...p.ceph, p3: q } }; })}>Remove {ceph3Active}</button>}
                <button type="button" className="cv-btn ghost sm" onClick={() => { if (window.confirm("Remove all 3D landmarks?")) { setPlan((p) => ({ ...p, ceph: { ...p.ceph, p3: {} } })); setCeph3Active("S"); } }}>Clear all</button>
              </div>
            </Sec>
          )}
          {cephKind === "3d" && (
            <Sec title="3D analysis">
              <table className="cv-table"><tbody>
                {ceph3dAnalysis(plan.ceph.p3 || {}).map((r, i, arr) => (
                  <React.Fragment key={r.name}>
                    {(i === 0 || arr[i - 1].group !== r.group) && <tr><td colSpan={3} className="cv-small" style={{ paddingTop: 8, fontWeight: 800, color: "#cbd5e1" }}>{r.group}</td></tr>}
                    <tr title={r.note}><td>{r.name}</td><td className={r.flag === "ok" ? "ok" : r.flag ? "bad" : ""}>{r.value == null ? "—" : `${r.value}\u00a0${r.unit}`}</td><td className="cv-small">{r.norm != null ? `${r.norm}±${r.sd}` : ""}</td></tr>
                  </React.Fragment>
                ))}
              </tbody></table>
              <p className="cv-help">Angles and distances are measured in 3-D. Symmetry uses the mid-sagittal plane through S and N, upright to Frankfort.</p>
            </Sec>
          )}
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

      {tab === "guide" && (
        <>
          <Sec title="1 · Support" done={!!guide}>
            <div className="cv-seg sm">{[["teeth", "Tooth-supported"], ["bone", "Bone-supported"]].map(([k, l]) => <button key={k} type="button" className={gopt.support === k ? "on" : ""} onClick={() => setG({ support: k, thrHu: null })}>{l}</button>)}</div>
            <Range label="Support level (density)" unit="HU" min={150} max={2500} step={25} value={supportHu} set={(v) => setG({ thrHu: v })} />
            <p className="cv-help">{gopt.support === "teeth" ? "The guide rests on the teeth of the jaw set in the Implant tab (only up to “Teeth reach above the arch line”, so it never touches the opposite teeth). Lower the level if teeth look incomplete in teal, raise it if it sits on soft tissue." : "For edentulous jaws after a flap: the guide rests on the bone."}</p>
          </Sec>
          <Sec title="2 · Shape">
            <Range label="Fitting gap" unit="mm" min={0} max={0.5} step={0.05} value={gopt.gap} set={(v) => setG({ gap: v })} />
            <Range label="Thickness" unit="mm" min={1.5} max={4} step={0.25} value={gopt.thick} set={(v) => setG({ thick: v })} />
            <Range label="Teeth reach above the arch line" unit="mm" min={1} max={15} step={0.5} value={gopt.above} set={(v) => setG({ above: v })} />
            <Range label="Cover down the sides" unit="mm" min={1} max={10} step={0.5} value={gopt.cover} set={(v) => setG({ cover: v })} />
            <Range label="Width across the arch" unit="mm" min={8} max={30} step={1} value={gopt.band} set={(v) => setG({ band: v })} />
            {arch && <>
              <Range label="Starts at (along the arch)" unit="mm" min={0} max={Math.round(arch.length)} step={1} value={Math.round(gopt.from ?? 0)} set={(v) => setG({ from: Math.min(v, (gopt.to ?? arch.length) - 10) })} />
              <Range label="Ends at" unit="mm" min={0} max={Math.round(arch.length)} step={1} value={Math.round(gopt.to ?? arch.length)} set={(v) => setG({ to: Math.max(v, (gopt.from ?? 0) + 10) })} />
            </>}
          </Sec>
          <Sec title="3 · Sleeves">
            <Range label="Sleeve hole Ø" unit="mm" min={3} max={7} step={0.1} value={gopt.sleeveD} set={(v) => setG({ sleeveD: v })} />
            <Range label="Sleeve wall" unit="mm" min={1} max={3} step={0.25} value={gopt.sleeveWall} set={(v) => setG({ sleeveWall: v })} />
            <Range label="Sleeve height" unit="mm" min={3} max={8} step={0.5} value={gopt.sleeveH} set={(v) => setG({ sleeveH: v })} />
            <Range label="Sleeve top above the implant" unit="mm" min={5} max={14} step={0.5} value={gopt.sleeveTop} set={(v) => setG({ sleeveTop: v })} />
            <p className="cv-help">Match these to your guided-surgery kit (sleeve outer Ø and offset). Drill depth from the sleeve top = offset + implant length.</p>
            {plan.implants.length > 0 && (
              <table className="cv-table"><tbody>
                <tr><td className="cv-small">Implant</td><td className="cv-small">Length</td><td className="cv-small">Drill depth</td></tr>
                {plan.implants.map((im) => <tr key={im.id}><td>#{im.tooth || "?"}</td><td>{im.length} mm</td><td className="ok">{r1(gopt.sleeveTop + im.length)} mm</td></tr>)}
              </tbody></table>
            )}
          </Sec>
          <Sec title="4 · Make and download">
            <button type="button" className="cv-btn primary" onClick={makeGuide}>🛠 {guide ? "Make the guide again" : "Make the guide"}</button>
            {guide && (
              <>
                <div className="cv-stats">
                  <div><small>Volume</small><b>{r1(guide.G.stats.cc)} cc</b></div>
                  <div><small>Sleeves</small><b>{guide.G.sleeves.length}</b></div>
                  <div><small>Size</small><b>{guide.G.stats.size.map((v) => Math.round(v)).join("×")} mm</b></div>
                  <div><small>Grid</small><b>{guide.G.grid.h.toFixed(2)} mm</b></div>
                </div>
                <button type="button" className="cv-btn primary" onClick={downloadGuide}>⬇ Guide STL (for 3-D printing)</button>
                <button type="button" className="cv-btn ghost" onClick={() => doExport("stl")}>⬇ Implants STL</button>
                {guide.tris && <p className="cv-help">Last STL: {guide.tris.toLocaleString()} triangles.</p>}
              </>
            )}
            <p className="cv-help">Check the guide on every cross-section before printing. A guide made from CBCT alone fits less exactly than one made with an intraoral scan (metal fillings cause streaks) — confirm the fit on the model or in the mouth before drilling.</p>
          </Sec>
        </>
      )}

      {tab === "fusion" && (
        <>
          <Sec title="Compare two scans">
            {!fus.volB ? (
              <>
                <p className="cv-help">Compare this scan with another scan of the same patient (before / after surgery, orthodontics or grafting). The two are aligned automatically on the bone.</p>
                <div className="cv-row"><span className="cv-lbl">Align using</span>
                  <div className="cv-seg sm">{[["upper", "Upper skull"], ["all", "Whole scan"], ["lower", "Lower jaw"]].map(([k, l]) => <button key={k} type="button" className={fus.region === k ? "on" : ""} onClick={() => setFus((f) => ({ ...f, region: k }))}>{l}</button>)}</div></div>
                <button type="button" className="cv-btn primary" onClick={() => setBrowser("compare")}>🔀 Choose the second scan</button>
                <p className="cv-help">Upper skull (default) keeps the stable skull base fixed, so jaw and teeth changes show clearly.</p>
              </>
            ) : (
              <>
                <div className="cv-stats">
                  <div><small>This scan</small><b>#{P.volumeId}</b></div>
                  <div><small>Second scan</small><b>#{fus.idB}{fus.metaB?.study_date ? ` · ${fus.metaB.study_date}` : ""}</b></div>
                  <div><small>Bone distance after alignment</small><b>{fus.rms != null ? `${r1(fus.rms)} mm` : "saved"}</b></div>
                  <div><small>Aligned on</small><b>{fus.region === "upper" ? "Upper skull" : fus.region === "lower" ? "Lower jaw" : "Whole scan"}</b></div>
                </div>
                <div className="cv-row wrap">
                  {[["upper", "Upper skull"], ["all", "Whole"], ["lower", "Lower jaw"]].map(([k, l]) => <button key={k} type="button" className="cv-btn ghost sm" onClick={() => realign(k)}>↻ Align on {l}</button>)}
                  <button type="button" className="cv-btn ghost sm" onClick={() => setBrowser("compare")}>Change scan</button>
                  <button type="button" className="cv-btn ghost sm" onClick={() => { setFus((f) => ({ ...f, volB: null, T: null, dist: null, idB: null })); setPlan((p) => { const q = { ...p }; delete q.fusion; return q; }); }}>Stop comparing</button>
                </div>
              </>
            )}
          </Sec>
          {fus.volB && (
            <>
              <Sec title="Slices">
                <div className="cv-seg sm">{[["colour", "Colour"], ["blend", "Blend"], ["checker", "Checker"], ["split", "Split"]].map(([k, l]) => <button key={k} type="button" className={fus.mode2d === k ? "on" : ""} onClick={() => setFus((f) => ({ ...f, mode2d: k }))}>{l}</button>)}</div>
                {(fus.mode2d === "blend" || fus.mode2d === "split") && <Range label={fus.mode2d === "split" ? "Split position" : "Second scan"} unit="%" min={0} max={100} step={5} value={Math.round(fus.mix * 100)} set={(v) => setFus((f) => ({ ...f, mix: v / 100 }))} />}
                <p className="cv-help">{fus.mode2d === "colour" ? "Magenta: only in this scan · green: only in the second scan · white: the same in both." : fus.mode2d === "checker" ? "Squares alternate between the two scans — edges that line up are unchanged." : fus.mode2d === "split" ? "Left: this scan · right: the second scan." : "Fade between the two scans."}</p>
              </Sec>
              <Sec title="3-D">
                <div className="cv-seg sm">{[["colours", "Two colours"], ["change", "Change map"]].map(([k, l]) => <button key={k} type="button" className={fus.mode3d === k ? "on" : ""} onClick={() => setFus((f) => ({ ...f, mode3d: k }))}>{l}</button>)}</div>
                <p className="cv-help">{fus.mode3d === "change" ? "The second scan's bone, coloured by how far it is from this scan's bone: green = same, yellow ≈ 2.5 mm, red = 5 mm or more." : "Ivory: this scan · blue: the second scan."}</p>
              </Sec>
              <Sec title="Fine-tune the alignment">
                <p className="cv-help">Moves the second scan by 0.5 mm, or turns it by 0.5° about the cross-hair.</p>
                <div className="cv-nudge">
                  <span /><span className="cv-small">Move</span><span className="cv-small">Turn</span>
                  {[["Left–right", [1, 0, 0]], ["Front–back", [0, 1, 0]], ["Up–down", [0, 0, 1]]].map(([l, ax]) => (
                    <React.Fragment key={l}>
                      <span className="cv-lbl">{l}</span>
                      <span className="cv-row"><button type="button" className="cv-btn ghost sm" title="−0.5 mm" onClick={() => nudge({ move: ax.map((v) => -v * 0.5) })}>−</button><button type="button" className="cv-btn ghost sm" title="+0.5 mm" onClick={() => nudge({ move: ax.map((v) => v * 0.5) })}>+</button></span>
                      <span className="cv-row"><button type="button" className="cv-btn ghost sm" title="−0.5°" onClick={() => nudge({ axis: ax, deg: -0.5 })}>↶</button><button type="button" className="cv-btn ghost sm" title="+0.5°" onClick={() => nudge({ axis: ax, deg: 0.5 })}>↷</button></span>
                    </React.Fragment>
                  ))}
                </div>
              </Sec>
            </>
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

      {tab === "lightbox" && (
        <Sec title="Lightbox">
          <div className="cv-seg sm">{[["axial", "Axial"], ["coronal", "Coronal"], ["sagittal", "Sagittal"], ["cross", "Cross-section"]].map(([k, l]) => (
            <button key={k} type="button" className={lb.kind === k ? "on" : ""} disabled={k === "cross" && !arch} onClick={() => setLb((s) => ({ ...s, kind: k }))}>{l}</button>))}</div>
          <div className="cv-row wrap"><span className="cv-lbl">Layout</span>
            {[[2, 2], [3, 2], [3, 3], [4, 3], [5, 4], [6, 4]].map(([c, r]) => <button key={`${c}x${r}`} type="button" className={`cv-chip ${lb.cols === c && lb.rows === r ? "on" : ""}`} onClick={() => setLb((s) => ({ ...s, cols: c, rows: r }))}>{c}×{r}</button>)}</div>
          <Range label="Distance between slices" unit="mm" min={0.5} max={10} step={0.5} value={lb.gap} set={(v) => setLb((s) => ({ ...s, gap: v }))} />
          <p className="cv-help">Scroll, or use ◀ ▶ at the top, to move the whole series; − and + change the spacing. Tap a slice to make it the centre of the series (the MPR and Implant views follow).</p>
          {lb.kind === "cross" && !arch && <p className="cv-help">Draw the arch in the Implant tab first.</p>}
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
              <div className="cv-ramp"><span>narrow</span><i /><span>wide</span></div>
              {airway.min && <button type="button" className="cv-btn ghost sm" onClick={() => setCursor((c) => [c[0], c[1], airway.min.z])}>Go to the narrowest level</button>}
            </>
          )}
          <p className="cv-help">The airway shows in colour in the views. Values depend on the levels and threshold you set.</p>
        </Sec>
      )}

      {tab === "report" && (
        <>
          <Sec title="Doctor's notes">
            {[["findings", "Findings"], ["diagnosis", "Diagnosis"], ["plan", "Treatment plan"], ["remarks", "Remarks"]].map(([k, l]) => (
              <label key={k} className="cv-range" style={{ display: "block" }}><span>{l}</span>
                <textarea className="cv-in" rows={k === "plan" ? 4 : 2} value={plan.report?.notes?.[k] || ""} onChange={(e) => setRep({ notes: { ...(plan.report?.notes || {}), [k]: e.target.value } })} /></label>
            ))}
            <p className="cv-help">Saved with the plan. The preview updates as you type.</p>
          </Sec>
          <Sec title="Sections">
            <div className="cv-secgrid">
              {REPORT_SECTIONS.map(([k, l]) => (
                <label key={k} className="cv-check"><input type="checkbox" checked={plan.report?.show?.[k] !== false} onChange={(e) => setRep({ show: { ...(plan.report?.show || {}), [k]: e.target.checked } })} /> {l}</label>
              ))}
            </div>
            <p className="cv-help">Sections with nothing to show (e.g. no airway measured) are left out by themselves.</p>
          </Sec>
          <Sec title="Edit and print">
            <p className="cv-help">Press ✏️ Edit text above the report to type straight into it (correct wording, add lines). “Print / PDF” prints exactly what you see.</p>
            {repDirty && <button type="button" className="cv-btn ghost sm" onClick={() => { if (window.confirm("Rebuild the report? Your typed changes in the preview will be lost (the notes in the panel are kept).")) { setRepDirty(false); setReportHtml(previewHtml(true)); } }}>↻ Rebuild the preview</button>}
          </Sec>
        <Sec title="Export">
          {[["pdf", "📄 Report — Print / Save as PDF"], ["png", "🖼 Report as picture (PNG)"], ["json", "📐 Plan file (positions, ceph, airway)"], ["stl", "🧊 Implants as STL (guide lab)"], ["dicom", "🗂 Original DICOM (ZIP)"]].map(([k, l]) => (
            <button key={k} type="button" className="cv-btn ghost" style={{ textAlign: "left" }} onClick={() => doExport(k)}>{l}</button>
          ))}
          <p className="cv-help">The Export menu makes a fresh report with your notes and sections (typed changes in the preview are printed only from the preview).</p>
        </Sec>
        </>
      )}

      {!(tab === "ceph" && cephKind !== "3d") && tab !== "report" && tab !== "3d" && tab !== "lightbox" && tab !== "fusion" && measures}
      {!(tab === "ceph" && cephKind !== "3d") && tab !== "report" && tab !== "3d" && display}
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

/* ═════════════════════════════════════════════════════════════════════════
   Implant library: manufacturer → line → diameter × length, with a drawing
   ═════════════════════════════════════════════════════════════════════════ */
function ImplantLibrary({ current, onPick, onClose }) {
  const [maker, setMaker] = useState(current.maker || DEFAULT_PICK.maker);
  const [line, setLine] = useState(current.line || DEFAULT_PICK.line);
  const [d, setD] = useState(current.diameter);
  const [l, setL] = useState(current.length);
  const [q, setQ] = useState("");
  const recent = lsGet("cbct-recent-implants", []);
  const ln = findLine(maker, line);
  const makers = CATALOG.filter((m) => !q || m.maker.toLowerCase().includes(q.toLowerCase()) || m.lines.some((x) => x.name.toLowerCase().includes(q.toLowerCase())));
  const mk = CATALOG.find((m) => m.maker === maker);
  const chooseLine = (m, x) => { setMaker(m); setLine(x.name); if (!x.d.includes(d)) setD(x.d.reduce((a, b) => (Math.abs(b - 4.1) < Math.abs(a - 4.1) ? b : a))); if (!x.l.includes(l)) setL(x.l.reduce((a, b) => (Math.abs(b - 10) < Math.abs(a - 10) ? b : a))); };
  const preview = { maker, line, shape: ln?.shape, diameter: Number(d) || 4, length: Number(l) || 10 };
  const use = (pk = preview) => {
    const r = [pk, ...recent.filter((x) => !(x.maker === pk.maker && x.line === pk.line && x.diameter === pk.diameter && x.length === pk.length))].slice(0, 6);
    lsSet("cbct-recent-implants", r); onPick(pk);
  };
  return (
    <div className="cv-modal" role="dialog" aria-label="Implant library" onClick={onClose}>
      <div className="cv-modal-in cv-lib" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-h"><b>📚 Implant library</b>
          <input className="cv-in" style={{ maxWidth: 220 }} placeholder="Search maker or line…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="cv-btn ghost sm" onClick={onClose}>Close</button></div>
        {recent.length > 0 && (
          <div className="cv-lib-recent"><span className="cv-lbl">Recent:</span>
            {recent.map((r, i) => <button key={i} type="button" className="cv-btn ghost sm" onClick={() => use(r)}>{systemName(r.maker, r.line)} Ø{r.diameter}×{r.length}</button>)}
          </div>
        )}
        <div className="cv-lib-cols">
          <div className="cv-lib-col">
            <div className="cv-lib-t">Manufacturer</div>
            {makers.map((m) => <button key={m.maker} type="button" className={`cv-lib-i ${m.maker === maker ? "on" : ""}`} onClick={() => chooseLine(m.maker, m.lines[0])}>{m.maker}<small>{m.lines.length}</small></button>)}
          </div>
          <div className="cv-lib-col">
            <div className="cv-lib-t">Implant line</div>
            {(mk?.lines || []).map((x) => <button key={x.name} type="button" className={`cv-lib-i ${x.name === line ? "on" : ""}`} onClick={() => chooseLine(maker, x)}>{x.name}<small>{SHAPE_LABEL[x.shape]}</small></button>)}
          </div>
          <div className="cv-lib-col wide">
            <div className="cv-lib-t">Size</div>
            <div className="cv-lbl">Diameter (mm)</div>
            <div className="cv-row wrap">{(ln?.d || []).map((x) => <button key={x} type="button" className={`cv-chip ${x === d ? "on" : ""}`} onClick={() => setD(x)}>{x}</button>)}</div>
            <div className="cv-lbl" style={{ marginTop: 6 }}>Length (mm)</div>
            <div className="cv-row wrap">{(ln?.l || []).map((x) => <button key={x} type="button" className={`cv-chip ${x === l ? "on" : ""}`} onClick={() => setL(x)}>{x}</button>)}</div>
            <div className="cv-row" style={{ marginTop: 6 }}><span className="cv-lbl">Custom</span>
              <input className="cv-in" style={{ width: 70 }} type="number" step="0.1" min="2" max="9" value={d} onChange={(e) => setD(Number(e.target.value))} aria-label="Diameter" />×
              <input className="cv-in" style={{ width: 70 }} type="number" step="0.5" min="4" max="25" value={l} onChange={(e) => setL(Number(e.target.value))} aria-label="Length" /> mm</div>
            <div className="cv-lib-prev">
              <span dangerouslySetInnerHTML={{ __html: implantSVG(preview, { w: 96, h: 210 }) }} />
              <div>
                <b>{systemName(maker, line)}</b>
                <div className="cv-small">Ø {preview.diameter} mm × {preview.length} mm</div>
                <div className="cv-small">{SHAPE_LABEL[shapeOf(preview)]}</div>
                <button type="button" className="cv-btn primary" style={{ marginTop: 10 }} onClick={() => use()}>Use this implant</button>
              </div>
            </div>
            <p className="cv-help">Sizes follow the makers' published ranges — confirm with your supplier's current catalogue.</p>
          </div>
        </div>
      </div>
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
.cv-modal{position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:80;display:flex;align-items:center;justify-content:center;padding:12px}
.cv-modal-in{background:#0b1120;border:1px solid #334155;border-radius:14px;width:min(920px,100%);max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.cv-modal-h{display:flex;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#0b1120;z-index:1}
.cv-modal-h b{flex:1}
.cv-lib-recent{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-bottom:1px solid #1e293b}
.cv-lib-cols{display:grid;grid-template-columns:200px 230px 1fr;min-height:360px}
.cv-lib-col{border-right:1px solid #1e293b;padding:8px;display:flex;flex-direction:column;gap:3px;overflow:auto;max-height:70vh}
.cv-lib-col.wide{border-right:none;gap:6px}
.cv-lib-t{font:800 11px system-ui;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.cv-lib-i{display:flex;flex-direction:column;align-items:flex-start;text-align:left;border:1px solid transparent;background:none;color:#cbd5e1;padding:7px 9px;border-radius:8px;font:600 13px system-ui;cursor:pointer}
.cv-lib-i small{color:#64748b;font-weight:500;font-size:11px}
.cv-lib-i:hover{background:#111827}.cv-lib-i.on{background:#1d4ed8;color:#fff;border-color:#3b82f6}.cv-lib-i.on small{color:#bfdbfe}
.cv-chip{border:1px solid #334155;background:#0f172a;color:#cbd5e1;border-radius:7px;padding:5px 9px;font:700 12.5px system-ui;cursor:pointer;min-width:42px}
.cv-chip.on{background:#2563eb;border-color:#3b82f6;color:#fff}
.cv-lib-prev{display:flex;gap:14px;align-items:center;background:#020617;border-radius:10px;padding:10px;margin-top:6px}
.cv-libbtn{text-align:left;overflow:hidden;text-overflow:ellipsis}
.cv-root.phone .cv-lib-cols{grid-template-columns:1fr}
.cv-root.phone .cv-lib-col{border-right:none;border-bottom:1px solid #1e293b;max-height:none;flex-direction:row;flex-wrap:wrap}
.cv-root.phone .cv-lib-col.wide{flex-direction:column}
.cv-ramp{display:flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8}
.cv-ramp i{flex:1;height:8px;border-radius:4px;background:linear-gradient(90deg,#ef4444,#facc15,#22c55e,#3b82f6)}
${DBM_CSS}
.cv-nudge{display:grid;grid-template-columns:auto auto auto;gap:6px 12px;align-items:center}
.cv-nudge .cv-btn{min-width:34px}
.cv-secgrid{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px}
textarea.cv-in{resize:vertical;font:inherit;font-size:12.5px;margin-top:3px}
.cv-root.phone .cv-hide-phone{display:none}
.cv-root.phone .cv-top{gap:4px;padding:0 4px}
.cv-root.phone .cv-tabs button{padding:9px 9px 10px;font-size:12.5px}
.cv-root.phone .cv-btn{padding:7px 9px}
.cv-root.phone .cv-grid{padding:0}
.cv-root.phone .cv-panel.sheet{left:0;right:0;top:auto;bottom:0;width:auto;max-height:64%;border-radius:14px 14px 0 0;border-left:none;border-top:1px solid #334155}
.cv-root.phone .cv-hint{font-size:11.5px;flex-wrap:wrap}
`;