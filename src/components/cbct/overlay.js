/* ═══════════════════════════════════════════════════════════════════════
   OVERLAYS — what is drawn on top of a slice: cross-hair, arch, cross-
   section line, nerve, implants (with safety zone), measurements, scale
   bar and orientation letters. Used by the screen and by the report.
   ═══════════════════════════════════════════════════════════════════════ */
import { toScreen, archAt, implantApex, implantNerveGap, add, mul, sub, norm, dot, cross } from "./geometry";
import { radiusAt, collarOf } from "./implantLibrary";

export const COLORS = {
  axial: "#38bdf8", coronal: "#34d399", sagittal: "#f472b6", pano: "#fbbf24", cross: "#a78bfa", "3d": "#c4b5fd",
  nerve: "#f97316", nerveWarn: "#ef4444", implant: "#60a5fa", implantSel: "#facc15", safe: "#22c55e", warn: "#ef4444",
  measure: "#facc15", arch: "#fbbf24",
};

const LETTERS = {
  axial: ["R", "L", "A", "P"], coronal: ["R", "L", "S", "I"], sagittal: ["A", "P", "S", "I"],
  pano: ["R", "L", "S", "I"], cross: ["B", "L", "S", "I"],
  tmjRs: ["A", "P", "S", "I"], tmjLs: ["A", "P", "S", "I"], tmjRc: ["R", "L", "S", "I"], tmjLc: ["R", "L", "S", "I"],
};

export function drawOverlay(ctx, view, cam, W, H, S, opts = {}) {
  const { vol, plan, cursor, selectedId, temp, tool, showCross = true, dpr = 1, report = false } = S;
  const f = dpr;                                     // line widths / fonts follow the screen density
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const P = (p) => toScreen(view, cam, W, H, p);
  const near = (d, tol) => Math.abs(d) <= tol;
  const slabTol = view.kind === "pano" ? Math.max(2, (S.panoSlab || 10) / 2) : view.kind === "cross" ? Math.max(1, (S.crossSlab || 1) / 2 + 0.5) : 0.75;
  const font = (px, w = 600) => `${w} ${px * f}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const label = (txt, x, y, color, bg = "rgba(2,6,23,.72)", size = 11) => {
    ctx.font = font(size); const w = ctx.measureText(txt).width;
    ctx.fillStyle = bg; ctx.fillRect(x - 3 * f, y - (size + 2) * f, w + 6 * f, (size + 6) * f);
    ctx.fillStyle = color; ctx.fillText(txt, x, y);
  };

  /* ── cross-hair (MPR): the other two planes, in their colours; round handles rotate them ── */
  if (showCross && cursor && ["axial", "coronal", "sagittal"].includes(view.kind) && !report) {
    const lines = crossLines(view, cam, W, H, S);
    const gap = 14 * f;
    ctx.lineWidth = 1.4 * f; ctx.globalAlpha = 0.9;
    for (const L of lines) {
      ctx.strokeStyle = COLORS[L.other];
      ctx.beginPath();
      ctx.moveTo(L.c.x - L.dx * 4000, L.c.y - L.dy * 4000); ctx.lineTo(L.c.x - L.dx * gap, L.c.y - L.dy * gap);
      ctx.moveTo(L.c.x + L.dx * gap, L.c.y + L.dy * gap); ctx.lineTo(L.c.x + L.dx * 4000, L.c.y + L.dy * 4000);
      ctx.stroke();
      if (S.tool === "nav" && S.rotatable) {
        for (const h of L.handles) {
          ctx.beginPath(); ctx.arc(h.x, h.y, 6 * f, 0, 7);
          ctx.fillStyle = "rgba(2,6,23,.6)"; ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ── arch + cross-section line on the axial view ── */
  if (S.arch && view.kind === "axial") {
    const a = S.arch;
    ctx.strokeStyle = COLORS.arch; ctx.lineWidth = 2 * f; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let k = 0; k < a.n; k += 2) { const s = P([a.xs[k], a.ys[k], cursor[2]]); k ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // pano thickness band
    ctx.setLineDash([3 * f, 4 * f]); ctx.lineWidth = 1 * f; ctx.strokeStyle = "rgba(251,191,36,.45)";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let k = 0; k < a.n; k += 3) {
        const off = side * (S.panoSlab || 10) / 2;
        const s = P([a.xs[k] + a.nxs[k] * off, a.ys[k] + a.nys[k] * off, cursor[2]]);
        k ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!report) {
      const c = archAt(a, S.crossS ?? plan.crossS), half = (S.crossWidth || plan.crossWidth || 40) / 2;
      const p1 = P([c.x + c.nx * half, c.y + c.ny * half, cursor[2]]), p2 = P([c.x - c.nx * half, c.y - c.ny * half, cursor[2]]);
      ctx.strokeStyle = COLORS.cross; ctx.lineWidth = 2.5 * f; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      ctx.fillStyle = COLORS.cross; ctx.font = font(10, 700); ctx.fillText("B", p1.x + 4 * f, p1.y);
    }
  }
  /* arch points while drawing */
  if (temp?.kind === "arch" && view.kind === "axial") {
    ctx.fillStyle = COLORS.arch; ctx.strokeStyle = COLORS.arch; ctx.lineWidth = 1.5 * f;
    ctx.beginPath();
    temp.points.forEach((p, i) => { const s = P([p[0], p[1], cursor[2]]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.stroke();
    temp.points.forEach((p) => { const s = P([p[0], p[1], cursor[2]]); ctx.beginPath(); ctx.arc(s.x, s.y, 4 * f, 0, 7); ctx.fill(); });
  }

  /* ── cross-section position on the panoramic ── */
  if (view.kind === "pano" && !report) {
    const x = W / 2 + cam.panX + (S.crossS - view.a0) * cam.scale;
    ctx.strokeStyle = COLORS.cross; ctx.lineWidth = 2 * f; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.globalAlpha = 1;
  }
  /* axial level line on pano / cross */
  if ((view.kind === "pano" || view.kind === "cross") && cursor && !report) {
    const y = H / 2 + cam.panY + ((cursor[2] - vol.zTop) * view.V[2] - view.b0) * cam.scale;
    ctx.strokeStyle = COLORS.axial; ctx.setLineDash([4 * f, 6 * f]); ctx.lineWidth = 1 * f; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  /* ── nerves ── */
  for (const n of [...(plan.nerves || []), ...(temp?.kind === "nerve" ? [{ id: "_t", points: temp.points, diameter: temp.diameter || 2, side: temp.side }] : [])]) {
    if (!n.points.length) continue;
    const r = (n.diameter || 2) / 2;
    const sel = selectedId === n.id;
    const pts = n.points.map(P);
    if (view.kind === "pano" || view.kind === "coronal" || view.kind === "sagittal" || n.id === "_t") {
      // the canal: a smooth red tube (only where it is in this slice / slab)
      const tol = slabTol + r;
      const vis = (k) => near(pts[k].d, tol) || (k + 1 < pts.length && pts[k].d * pts[k + 1].d < 0) || (k > 0 && pts[k].d * pts[k - 1].d < 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const path = () => {
            ctx.beginPath(); ctx.moveTo(run[0].x, run[0].y);
            for (let k = 0; k + 1 < run.length; k++) {           // Catmull-Rom → smooth curve
              const p0 = run[Math.max(0, k - 1)], p1 = run[k], p2 = run[k + 1], p3 = run[Math.min(run.length - 1, k + 2)];
              ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
            }
          };
          const wpx = Math.max(4 * f, r * 2 * cam.scale);
          path(); ctx.strokeStyle = "rgba(127,0,0,.55)"; ctx.lineWidth = wpx + 2 * f; ctx.stroke();
          path(); ctx.strokeStyle = sel ? "rgba(255,70,70,.95)" : "rgba(232,28,36,.88)"; ctx.lineWidth = wpx; ctx.stroke();
          path(); ctx.strokeStyle = "rgba(255,160,150,.35)"; ctx.lineWidth = Math.max(1, wpx * 0.25); ctx.stroke();
        }
        run = [];
      };
      pts.forEach((p, k) => { if (view.kind === "pano" || n.id === "_t" || vis(k)) run.push(p); else flush(); });
      flush();
    }
    // where the nerve passes through this slice: a circle of its size
    if (view.planar) {
      ctx.strokeStyle = "rgba(127,0,0,.9)"; ctx.lineWidth = 1.5 * f; ctx.fillStyle = "rgba(232,28,36,.75)";
      for (let k = 0; k + 1 < n.points.length; k++) {
        const d0 = pts[k].d, d1 = pts[k + 1].d;
        if (d0 === d1 || d0 * d1 > 0) continue;
        const t = d0 / (d0 - d1);
        const x = pts[k].x + (pts[k + 1].x - pts[k].x) * t, y = pts[k].y + (pts[k + 1].y - pts[k].y) * t;
        ctx.beginPath(); ctx.arc(x, y, Math.max(3 * f, r * cam.scale), 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    // the tapped points: only while editing (selected nerve, nerve tool, or being traced)
    if ((sel || tool === "nerve" || n.id === "_t") && !report) {
      ctx.fillStyle = "#fde68a"; ctx.strokeStyle = "#7f1d1d"; ctx.lineWidth = 1.2 * f;
      pts.forEach((s) => {
        if (Math.abs(s.d) > slabTol + r + 1 && view.kind !== "pano") return;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3.5 * f, 0, 7); ctx.fill(); ctx.stroke();
      });
    }
  }

  /* ── implants ── */
  for (const im of plan.implants || []) drawImplant(ctx, view, cam, W, H, im, im.id === selectedId, S, f, slabTol);

  /* ── measurements ── */
  const all = [...(plan.measures || []), ...(temp && ["dist", "angle"].includes(temp.kind) ? [{ id: "_t", type: temp.kind, points: temp.points }] : [])];
  for (const m of all) {
    const pts = m.points.map(P);
    const show = view.kind === m.view || pts.every((s) => Math.abs(s.d) < slabTol + 0.5) || m.id === "_t";
    if (!show) continue;
    const sel = selectedId === m.id;
    ctx.strokeStyle = sel ? COLORS.implantSel : m.type === "hu" ? "#22d3ee" : COLORS.measure;
    ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.8 * f;
    if (m.type === "hu") {
      const s = pts[0]; ctx.beginPath(); ctx.arc(s.x, s.y, 5 * f, 0, 7); ctx.stroke();
      label(`${m.value} HU`, s.x + 8 * f, s.y - 6 * f, "#22d3ee"); continue;
    }
    ctx.beginPath(); pts.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y))); ctx.stroke();
    pts.forEach((s) => { ctx.beginPath(); ctx.arc(s.x, s.y, 3 * f, 0, 7); ctx.fill(); });
    if (m.value != null) {
      const anchor = m.type === "angle" ? pts[1] : { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
      label(m.type === "angle" ? `${m.value}°` : `${m.value} mm`, anchor.x + 6 * f, anchor.y - 6 * f, ctx.strokeStyle);
    }
  }
  if (temp && ["dist", "angle"].includes(temp.kind)) { /* drawn above */ }

  /* ── 3-D landmarks (3D Ceph): dots on the slices close to them; lines between pairs ── */
  if (S.points3d && S.points3d.length) {
    const tol = view.kind === "pano" ? 6 : 2.5;
    for (const ln of S.lines3d || []) {
      const a = S.points3d.find((q) => q.key === ln[0]), b = S.points3d.find((q) => q.key === ln[1]);
      if (!a || !b) continue;
      const A = P(a.p), B = P(b.p);
      if (!near(A.d, tol * 3) && !near(B.d, tol * 3)) continue;
      ctx.strokeStyle = hexA(ln[2] || "#34d399", 0.55); ctx.lineWidth = 1.2 * f; ctx.setLineDash([5 * f, 4 * f]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const q of S.points3d) {
      const s = P(q.p);
      if (!near(s.d, tol)) continue;
      const on = q.active;
      ctx.fillStyle = on ? "#facc15" : "#34d399"; ctx.strokeStyle = "#022c22"; ctx.lineWidth = 1.5 * f;
      ctx.beginPath(); ctx.arc(s.x, s.y, (on ? 5.5 : 4.5) * f, 0, 7); ctx.fill(); ctx.stroke();
      label(q.key, s.x + 7 * f, s.y - 5 * f, on ? "#facc15" : "#a7f3d0");
    }
  }

  /* ── scan information in the corners, and the mm ruler under the panoramic ── */
  if (!opts.noScale && !report && S.info && W > 330 * f) {
    ctx.font = `500 ${10.5 * f}px system-ui, sans-serif`; ctx.fillStyle = "rgba(226,232,240,.82)";
    const L1 = [S.info.id ? `ID: ${S.info.id}` : "", S.info.name || "", S.info.date || ""].filter(Boolean);
    L1.forEach((t, i) => ctx.fillText(t, 8 * f, 14 * f + i * 13 * f));
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(147,197,253,.85)";
    const slabMm = view.kind === "pano" ? S.panoSlab : view.kind === "cross" ? S.crossSlab : S.slab;
    [view.kind === "pano" ? "Panoramic" : view.kind === "cross" ? "Cross-section" : "MPR", slabMm ? `TH: ${slabMm} mm` : "", S.boneHu != null ? `Threshold: ${S.boneHu}` : ""].filter(Boolean)
      .forEach((t, i) => ctx.fillText(t, W - 8 * f, 14 * f + i * 13 * f));
    if (S.wlInfo) {
      ctx.fillStyle = "rgba(226,232,240,.82)";
      const yb = H - (view.kind === "pano" ? 30 : 8) * f;
      ctx.fillText(`WL: ${Math.round(S.wlInfo.l)}  WW: ${Math.round(S.wlInfo.w)}`, W - 8 * f, yb - 13 * f);
      ctx.fillText(`Pixel ${(f / cam.scale).toFixed(3)} mm`, W - 8 * f, yb);
    }
    ctx.textAlign = "left";
  }
  if (view.kind === "pano" && !opts.noScale && !report) {
    const yb = H - 2 * f, hb = 20 * f;
    ctx.fillStyle = "rgba(10,14,22,.82)"; ctx.fillRect(0, yb - hb, W, hb);
    const a0 = view.a0 - (W / 2 + cam.panX) / cam.scale, a1 = view.a0 + (W / 2 - cam.panX) / cam.scale;
    const step = cam.scale > 6 ? 1 : 2, every = cam.scale > 2.5 ? 5 : 10;
    ctx.strokeStyle = "rgba(250,204,21,.85)"; ctx.fillStyle = "#facc15"; ctx.font = `600 ${9.5 * f}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = 1 * f;
    for (let mm = Math.max(0, Math.ceil(a0 / step) * step); mm <= Math.min(view.arch.length, a1); mm += step) {
      const x = W / 2 + cam.panX + (mm - view.a0) * cam.scale, big = mm % every === 0;
      ctx.beginPath(); ctx.moveTo(x, yb - hb); ctx.lineTo(x, yb - hb + (big ? 6 : 3) * f); ctx.stroke();
      if (big) ctx.fillText(String(mm), x, yb - 3 * f);
    }
    ctx.textAlign = "left";
  }

  /* ── scale bar + letters ── */
  if (!opts.noScale) {
    const mm = cam.scale >= 12 ? 5 : cam.scale >= 4 ? 10 : 20;
    const bw = mm * cam.scale, x0 = 12 * f, y0 = H - (view.kind === "pano" && !report ? 32 : 14) * f;
    ctx.strokeStyle = "rgba(226,232,240,.85)"; ctx.lineWidth = 2 * f;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + bw, y0); ctx.moveTo(x0, y0 - 4 * f); ctx.lineTo(x0, y0 + 4 * f); ctx.moveTo(x0 + bw, y0 - 4 * f); ctx.lineTo(x0 + bw, y0 + 4 * f); ctx.stroke();
    ctx.fillStyle = "rgba(226,232,240,.9)"; ctx.font = font(10); ctx.fillText(`${mm} mm`, x0 + bw + 6 * f, y0 + 4 * f);
    const L = LETTERS[view.kind];
    if (L) {
      ctx.font = font(12, 800); ctx.fillStyle = "rgba(148,163,184,.85)";
      ctx.fillText(L[0], 8 * f, H / 2); ctx.fillText(L[1], W - 16 * f, H / 2);
      ctx.fillText(L[2], W / 2 - 4 * f, 18 * f + (report ? 0 : 14 * f)); ctx.fillText(L[3], W / 2 - 4 * f, H - (view.kind === "pano" && !report ? 27 : 8) * f);
    }
  }
  ctx.restore();
}

/* an implant as seen in a view: body, threads, apex, safety zone, label */
export function drawImplant(ctx, view, cam, W, H, im, sel, S, f, slabTol) {
  const top = im.top, apex = implantApex(im), r = im.diameter / 2;
  const T = toScreen(view, cam, W, H, top), A = toScreen(view, cam, W, H, apex);
  const gapInfo = implantNerveGap(im, S.plan.nerves);
  const danger = gapInfo && gapInfo.gap < (S.plan.safety ?? 2);
  const col = danger ? COLORS.warn : sel ? COLORS.implantSel : (im.color || COLORS.implant);
  // is the implant cut by this slice?
  const cut = view.kind === "pano" || T.d * A.d <= 0 || Math.min(Math.abs(T.d), Math.abs(A.d)) <= r + slabTol;
  // far from this slice: leave it out (cross-sections / axial), or show faintly only when close
  if (!cut && (view.kind === "cross" || view.kind === "axial" || Math.min(Math.abs(T.d), Math.abs(A.d)) > r + 5)) return;
  const sx = A.x - T.x, sy = A.y - T.y, sl = Math.hypot(sx, sy);
  ctx.save();
  if (sl < r * cam.scale * 0.6) {
    // seen end-on (e.g. axial): a ring where the slice cuts it
    if (!cut) { ctx.restore(); return; }
    const t = T.d === A.d ? 0.5 : Math.max(0, Math.min(1, T.d / (T.d - A.d)));
    const cx = T.x + sx * t, cy = T.y + sy * t;
    const rg = ctx.createRadialGradient(cx - r * cam.scale * 0.3, cy - r * cam.scale * 0.3, 1, cx, cy, r * cam.scale);
    rg.addColorStop(0, danger ? "rgba(255,196,186,.7)" : "rgba(246,236,186,.7)"); rg.addColorStop(1, danger ? "rgba(110,30,26,.7)" : "rgba(120,100,40,.7)");
    ctx.fillStyle = rg; ctx.strokeStyle = sel ? "#fde047" : danger ? "#ef4444" : "rgba(96,82,34,.95)"; ctx.lineWidth = (sel ? 2 : 1.4) * f;
    ctx.beginPath(); ctx.arc(cx, cy, r * cam.scale, 0, 7); ctx.fill(); ctx.stroke();
    if (S.plan.showSafety === true || danger) {
      ctx.setLineDash([4 * f, 4 * f]); ctx.strokeStyle = hexA(col, 0.6);
      ctx.beginPath(); ctx.arc(cx, cy, (r + (S.plan.safety ?? 2)) * cam.scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    numBox(ctx, im.tooth || "?", cx, cy, f, sel, 1);
    ctx.restore(); return;
  }
  const ux = sx / sl, uy = sy / sl, px = -uy, py = ux;
  const sc = cam.scale, w = r * sc, wApex = radiusAt(im, 0.95) * sc;
  // colours of a titanium implant in planning software: gold, see-through so the bone shows
  const G = danger ? { base: [214, 84, 74], hi: [255, 196, 186], lo: [110, 30, 26], line: [255, 120, 110] }
    : sel ? { base: [222, 196, 104], hi: [255, 246, 196], lo: [120, 96, 30], line: [253, 224, 71] }
    : { base: [196, 176, 104], hi: [246, 236, 186], lo: [96, 82, 34], line: [214, 196, 120] };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const fade = cut ? 1 : 0.35;
  const ell = 0.24;                                         // how round the cylinder looks (ellipse of the cross-cut)
  // body outline from top to apex
  const N = 48, side = [];
  for (let i = 0; i <= N; i++) { const t = i / N; side.push([T.x + sx * t, T.y + sy * t, radiusAt(im, t) * sc]); }
  const outline = () => {
    ctx.beginPath();
    side.forEach(([x, y, rr], i) => (i ? ctx.lineTo(x + px * rr, y + py * rr) : ctx.moveTo(x + px * rr, y + py * rr)));
    const [ax, ay, ar] = side[N];                           // rounded apex
    ctx.ellipse(ax, ay, ar, ar * ell * 1.6, Math.atan2(py, px), 0, Math.PI, false);
    for (let i = N; i >= 0; i--) { const [x, y, rr] = side[i]; ctx.lineTo(x - px * rr, y - py * rr); }
    ctx.closePath();
  };
  // shading across the cylinder (dark edges, bright stripe) → looks round
  const grd = ctx.createLinearGradient(T.x + px * w, T.y + py * w, T.x - px * w, T.y - py * w);
  grd.addColorStop(0, rgba(G.lo, 0.72 * fade)); grd.addColorStop(0.3, rgba(G.hi, 0.62 * fade));
  grd.addColorStop(0.55, rgba(G.base, 0.5 * fade)); grd.addColorStop(1, rgba(G.lo, 0.72 * fade));
  outline(); ctx.fillStyle = grd; ctx.fill();
  ctx.strokeStyle = rgba(G.lo, 0.9 * fade); ctx.lineWidth = 1.1 * f; ctx.stroke();
  // threads: curved lines across the body (front half of each turn)
  const pitch = im.diameter <= 3.3 ? 0.7 : 0.85, ang = Math.atan2(py, px);
  for (let k = 1; k * pitch < im.length * 0.94; k++) {
    const t = (k * pitch) / im.length, rr = radiusAt(im, t) * sc * 0.98;
    if (t < 0.06) continue;
    const cx = T.x + sx * t, cy = T.y + sy * t;
    ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * ell, ang, 0, Math.PI, false);
    ctx.strokeStyle = rgba(G.lo, 0.75 * fade); ctx.lineWidth = Math.max(0.8, 1.1 * f); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx - ux * 0.9 * f, cy - uy * 0.9 * f, rr * 0.92, rr * ell * 0.92, ang, 0.25, Math.PI - 0.25, false);
    ctx.strokeStyle = rgba(G.hi, 0.45 * fade); ctx.lineWidth = Math.max(0.6, 0.8 * f); ctx.stroke();
  }
  // platform (top) with the inner connection
  ctx.beginPath(); ctx.ellipse(T.x, T.y, w, w * ell, ang, 0, Math.PI * 2);
  ctx.fillStyle = rgba(G.hi, 0.55 * fade); ctx.fill(); ctx.strokeStyle = rgba(G.lo, 0.9 * fade); ctx.lineWidth = 1 * f; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(T.x, T.y, w * 0.45, w * ell * 0.45, ang, 0, Math.PI * 2);
  ctx.fillStyle = rgba(G.lo, 0.55 * fade); ctx.fill();
  // tissue-level implants: the polished collar above the bone
  const collar = collarOf(im) * sc;
  if (collar > 0) {
    const cxp = T.x - ux * collar, cyp = T.y - uy * collar, cw = w + 0.35 * sc;
    ctx.beginPath(); ctx.moveTo(T.x + px * w, T.y + py * w); ctx.lineTo(cxp + px * cw, cyp + py * cw); ctx.lineTo(cxp - px * cw, cyp - py * cw); ctx.lineTo(T.x - px * w, T.y - py * w); ctx.closePath();
    const cg = ctx.createLinearGradient(cxp + px * cw, cyp + py * cw, cxp - px * cw, cyp - py * cw);
    cg.addColorStop(0, `rgba(120,130,140,${0.7 * fade})`); cg.addColorStop(0.35, `rgba(240,244,248,${0.7 * fade})`); cg.addColorStop(1, `rgba(120,130,140,${0.7 * fade})`);
    ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = `rgba(80,90,100,${0.9 * fade})`; ctx.stroke();
  }
  // abutment and crown above the implant (when switched on)
  if (S.plan.showProsthetic === true && cut) {
    const ah = (im.abutment ?? 4) * cam.scale, aw = w * 0.72, cl = collarOf(im) * cam.scale;
    const T0 = { x: T.x - ux * cl, y: T.y - uy * cl };
    const tx = T0.x - ux * ah, ty = T0.y - uy * ah;
    const ag = ctx.createLinearGradient(T0.x + px * aw, T0.y + py * aw, T0.x - px * aw, T0.y - py * aw);
    ag.addColorStop(0, "rgba(110,120,130,.7)"); ag.addColorStop(0.35, "rgba(235,240,245,.7)"); ag.addColorStop(1, "rgba(110,120,130,.7)");
    ctx.fillStyle = ag; ctx.strokeStyle = "rgba(70,80,90,.9)"; ctx.lineWidth = 1 * f;
    ctx.beginPath(); ctx.moveTo(T0.x + px * aw, T0.y + py * aw); ctx.lineTo(tx + px * aw * 0.8, ty + py * aw * 0.8);
    ctx.lineTo(tx - px * aw * 0.8, ty - py * aw * 0.8); ctx.lineTo(T0.x - px * aw, T0.y - py * aw); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (im.crown !== false) {
      const ch = (im.crownHeight ?? 8) * cam.scale, cw = Math.max(w * 1.9, ((im.crownWidth ?? 8) / 2) * cam.scale);
      const bx = tx + ux * 1.5 * cam.scale, by = ty + uy * 1.5 * cam.scale;
      const ex = bx - ux * ch, ey = by - uy * ch;
      ctx.fillStyle = "rgba(255,250,235,.16)"; ctx.strokeStyle = "rgba(255,250,235,.7)"; ctx.setLineDash([4 * f, 3 * f]);
      ctx.beginPath();
      ctx.moveTo(bx + px * aw, by + py * aw);
      ctx.quadraticCurveTo(bx + px * cw - ux * ch * 0.25, by + py * cw - uy * ch * 0.25, ex + px * cw * 0.85, ey + py * cw * 0.85);
      ctx.quadraticCurveTo(ex - ux * ch * 0.12, ey - uy * ch * 0.12, ex - px * cw * 0.85, ey - py * cw * 0.85);
      ctx.quadraticCurveTo(bx - px * cw - ux * ch * 0.25, by - py * cw - uy * ch * 0.25, bx - px * aw, by - py * aw);
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // the implant axis: a thin white line through the implant with an arrow, like planning software
  const ext = 15 * sc, below = 4 * sc;
  const ex = T.x - ux * ext, ey = T.y - uy * ext;
  ctx.strokeStyle = `rgba(235,240,245,${0.85 * fade})`; ctx.lineWidth = 1 * f;
  ctx.beginPath(); ctx.moveTo(A.x + ux * below, A.y + uy * below); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + ux * 6 * f + px * 3 * f, ey + uy * 6 * f + py * 3 * f); ctx.moveTo(ex, ey); ctx.lineTo(ex + ux * 6 * f - px * 3 * f, ey + uy * 6 * f - py * 3 * f); ctx.stroke();
  // diameter / length above the arrow
  ctx.font = `${sel ? 800 : 600} ${11 * f}px system-ui, sans-serif`; ctx.textAlign = "center";
  ctx.fillStyle = sel ? "#6ee7b7" : danger ? "#fca5a5" : "#67e8f9";
  const lx = ex - ux * 4 * f, ly = ey - uy * 4 * f - 16 * f;
  ctx.fillText(Number(im.diameter).toFixed(1), lx, ly); ctx.fillText(Number(im.length).toFixed(1), lx, ly + 13 * f);
  ctx.textAlign = "left";
  // safety zone (when switched on, or when too close to the nerve)
  if ((S.plan.showSafety === true || danger) && cut) {
    const m = (S.plan.safety ?? 2) * cam.scale;
    ctx.strokeStyle = hexA(danger ? COLORS.warn : COLORS.safe, 0.7);
    ctx.beginPath();
    ctx.moveTo(T.x + px * (w + m), T.y + py * (w + m)); ctx.lineTo(A.x + px * (wApex + m) + ux * m, A.y + py * (wApex + m) + uy * m);
    ctx.lineTo(A.x - px * (wApex + m) + ux * m, A.y - py * (wApex + m) + uy * m); ctx.lineTo(T.x - px * (w + m), T.y - py * (w + m));
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (sel && view.kind !== "axial" && !S.report) {
    // handles: move (top) and tilt (apex)
    ctx.fillStyle = COLORS.implantSel; ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1.5 * f;
    ctx.beginPath(); ctx.arc(T.x, T.y, 7 * f, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(A.x + ux * 4 * f, A.y + uy * 4 * f, 7 * f, 0, 7); ctx.fillStyle = "#fb923c"; ctx.fill(); ctx.stroke();
  }
  // tooth number in a small box in the middle of the implant
  numBox(ctx, im.tooth || "?", (T.x + A.x) / 2, (T.y + A.y) / 2, f, sel, fade);
  if (gapInfo && gapInfo.gap < (S.plan.safety ?? 2) && (sel || W > 900 * f || S.report)) {
    ctx.font = `800 ${10.5 * f}px system-ui, sans-serif`; ctx.fillStyle = "#fca5a5"; ctx.textAlign = "center";
    ctx.fillText(gapInfo.gap < 0 ? `INTO nerve ${(-gapInfo.gap).toFixed(1)} mm` : `${gapInfo.gap.toFixed(1)} mm to nerve`, A.x + ux * (below + 12 * f), A.y + uy * (below + 12 * f));
    ctx.textAlign = "left";
  }
  ctx.restore();
}
function numBox(ctx, txt, x, y, f, sel, fade) {
  ctx.font = `${sel ? 800 : 700} ${11 * f}px system-ui, sans-serif`;
  const w = ctx.measureText(String(txt)).width + 8 * f, h = 15 * f;
  ctx.globalAlpha = Math.max(0.5, fade);
  ctx.fillStyle = "rgba(15,40,48,.85)"; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = sel ? "#6ee7b7" : "rgba(103,232,249,.7)"; ctx.lineWidth = 1 * f; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = sel ? "#6ee7b7" : "#67e8f9"; ctx.textAlign = "center"; ctx.fillText(String(txt), x, y + 4 * f); ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}
function tag(ctx, im, x, y, col, f, gapInfo) {
  ctx.font = `700 ${11 * f}px system-ui, sans-serif`;
  const lines = [`${im.tooth ? "#" + im.tooth + " " : ""}Ø${im.diameter}×${im.length}`];
  if (gapInfo) lines.push(gapInfo.gap < 0 ? `INTO nerve ${(-gapInfo.gap).toFixed(1)} mm` : `nerve ${gapInfo.gap.toFixed(1)} mm`);
  lines.forEach((t, i) => {
    const w = ctx.measureText(t).width;
    ctx.fillStyle = "rgba(2,6,23,.75)"; ctx.fillRect(x - 3 * f, y - 12 * f + i * 15 * f, w + 6 * f, 15 * f);
    ctx.fillStyle = i === 1 && gapInfo && gapInfo.gap < 2 ? COLORS.warn : col; ctx.fillText(t, x, y + i * 15 * f);
  });
}
export function hexA(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* the reference lines of the other two MPR planes in this view */
const OTHERS = { axial: [["coronal", "ey"], ["sagittal", "ex"]], coronal: [["axial", "ez"], ["sagittal", "ex"]], sagittal: [["axial", "ez"], ["coronal", "ey"]] };
export function crossLines(view, cam, W, H, S) {
  const F = S.frame || { ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };
  const c = toScreen(view, cam, W, H, S.cursor);
  const R = Math.min(W, H) * 0.36;
  return (OTHERS[view.kind] || []).map(([other, ax]) => {
    const d = norm(cross(view.N, F[ax]));
    const q = toScreen(view, cam, W, H, add(S.cursor, mul(d, 10)));
    let dx = q.x - c.x, dy = q.y - c.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    return { other, ax, c, dx, dy, handles: [{ x: c.x + dx * R, y: c.y + dy * R }, { x: c.x - dx * R, y: c.y - dy * R }] };
  });
}

/* hit test: what is under the finger / mouse in this view? */
export function hitTest(view, cam, W, H, S, x, y, f = 1) {
  const R = 14 * f;
  if (S.rotatable && S.cursor && ["axial", "coronal", "sagittal"].includes(view.kind)) {
    for (const L of crossLines(view, cam, W, H, S)) for (const h of L.handles) if (Math.hypot(x - h.x, y - h.y) < R) return { type: "rotate", c: L.c };
  }
  for (const im of S.plan.implants || []) {
    const T = toScreen(view, cam, W, H, im.top), A = toScreen(view, cam, W, H, implantApex(im));
    if (im.id === S.selectedId) {
      const sx = A.x - T.x, sy = A.y - T.y, sl = Math.hypot(sx, sy) || 1;
      if (Math.hypot(x - (A.x + (sx / sl) * 4 * f), y - (A.y + (sy / sl) * 4 * f)) < R) return { type: "implant-apex", id: im.id };
      if (Math.hypot(x - T.x, y - T.y) < R) return { type: "implant-top", id: im.id };
    }
    // distance to the axis segment
    const sx = A.x - T.x, sy = A.y - T.y, l2 = sx * sx + sy * sy || 1;
    const t = Math.max(0, Math.min(1, ((x - T.x) * sx + (y - T.y) * sy) / l2));
    const d = Math.hypot(x - (T.x + sx * t), y - (T.y + sy * t));
    if (d < Math.max(R, (im.diameter / 2) * cam.scale + 4 * f)) {
      if (view.kind === "axial" && Math.min(Math.abs(T.d), Math.abs(A.d)) > im.diameter && T.d * A.d > 0) continue;
      return { type: "implant", id: im.id };
    }
  }
  for (const n of S.plan.nerves || []) {
    const pts = n.points.map((p) => toScreen(view, cam, W, H, p));
    for (let k = 0; k < pts.length; k++) if (Math.hypot(x - pts[k].x, y - pts[k].y) < R && (view.kind === "pano" || Math.abs(pts[k].d) < 3)) return { type: "nerve-point", id: n.id, index: k };
  }
  for (const m of S.plan.measures || []) {
    const pts = m.points.map((p) => toScreen(view, cam, W, H, p));
    if (pts.some((s) => Math.hypot(x - s.x, y - s.y) < R)) return { type: "measure", id: m.id };
  }
  return null;
}