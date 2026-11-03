/* ═══════════════════════════════════════════════════════════════════════
   OVERLAYS — what is drawn on top of a slice: cross-hair, arch, cross-
   section line, nerve, implants (with safety zone), measurements, scale
   bar and orientation letters. Used by the screen and by the report.
   ═══════════════════════════════════════════════════════════════════════ */
import { toScreen, archAt, implantApex, implantNerveGap, add, mul, sub, norm, dot, cross } from "./geometry";

export const COLORS = {
  axial: "#38bdf8", coronal: "#34d399", sagittal: "#f472b6", pano: "#fbbf24", cross: "#a78bfa", "3d": "#c4b5fd",
  nerve: "#f97316", nerveWarn: "#ef4444", implant: "#60a5fa", implantSel: "#facc15", safe: "#22c55e", warn: "#ef4444",
  measure: "#facc15", arch: "#fbbf24",
};

const LETTERS = {
  axial: ["R", "L", "A", "P"], coronal: ["R", "L", "S", "I"], sagittal: ["A", "P", "S", "I"],
  pano: ["R", "L", "S", "I"], cross: ["B", "L", "S", "I"],
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

  /* ── cross-hair (MPR) ── */
  if (showCross && cursor && ["axial", "coronal", "sagittal"].includes(view.kind) && !report) {
    const c = P(cursor);
    ctx.setLineDash([5 * f, 5 * f]); ctx.lineWidth = 1 * f; ctx.globalAlpha = 0.75;
    const hcol = view.kind === "axial" ? COLORS.coronal : COLORS.axial;
    const vcol = view.kind === "sagittal" ? COLORS.coronal : COLORS.sagittal;
    ctx.strokeStyle = hcol; ctx.beginPath(); ctx.moveTo(0, c.y); ctx.lineTo(W, c.y); ctx.stroke();
    ctx.strokeStyle = vcol; ctx.beginPath(); ctx.moveTo(c.x, 0); ctx.lineTo(c.x, H); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
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
      // band along the nerve (only where it is in this slice / slab)
      ctx.lineWidth = Math.max(2 * f, r * 2 * cam.scale);
      ctx.strokeStyle = "rgba(249,115,22,.55)";
      for (let k = 0; k + 1 < pts.length; k++) {
        const tol = slabTol + r;
        if (!(near(pts[k].d, tol) || near(pts[k + 1].d, tol) || pts[k].d * pts[k + 1].d < 0)) continue;
        ctx.beginPath(); ctx.moveTo(pts[k].x, pts[k].y); ctx.lineTo(pts[k + 1].x, pts[k + 1].y); ctx.stroke();
      }
    }
    // where the nerve passes through this slice: a circle of its size
    if (view.planar) {
      ctx.strokeStyle = COLORS.nerve; ctx.lineWidth = 2 * f; ctx.fillStyle = "rgba(249,115,22,.35)";
      for (let k = 0; k + 1 < n.points.length; k++) {
        const d0 = pts[k].d, d1 = pts[k + 1].d;
        if (d0 === d1 || d0 * d1 > 0) continue;
        const t = d0 / (d0 - d1);
        const x = pts[k].x + (pts[k + 1].x - pts[k].x) * t, y = pts[k].y + (pts[k + 1].y - pts[k].y) * t;
        ctx.beginPath(); ctx.arc(x, y, Math.max(3 * f, r * cam.scale), 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    // the tapped points
    ctx.fillStyle = sel ? COLORS.implantSel : COLORS.nerve;
    pts.forEach((s, i) => {
      if (Math.abs(s.d) > slabTol + r + 1 && view.kind !== "pano") return;
      ctx.beginPath(); ctx.arc(s.x, s.y, (sel || n.id === "_t" ? 3.5 : 2.2) * f, 0, 7); ctx.fill();
    });
    const first = pts.find((s) => view.kind === "pano" || Math.abs(s.d) <= slabTol + r);
    if (first && n.id !== "_t") label(`Nerve ${n.side === "L" ? "L" : n.side === "R" ? "R" : ""}`.trim(), first.x + 6 * f, first.y - 6 * f, COLORS.nerve);
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

  /* ── scale bar + letters ── */
  if (!opts.noScale) {
    const mm = cam.scale >= 12 ? 5 : cam.scale >= 4 ? 10 : 20;
    const bw = mm * cam.scale, x0 = 12 * f, y0 = H - 14 * f;
    ctx.strokeStyle = "rgba(226,232,240,.85)"; ctx.lineWidth = 2 * f;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + bw, y0); ctx.moveTo(x0, y0 - 4 * f); ctx.lineTo(x0, y0 + 4 * f); ctx.moveTo(x0 + bw, y0 - 4 * f); ctx.lineTo(x0 + bw, y0 + 4 * f); ctx.stroke();
    ctx.fillStyle = "rgba(226,232,240,.9)"; ctx.font = font(10); ctx.fillText(`${mm} mm`, x0 + bw + 6 * f, y0 + 4 * f);
    const L = LETTERS[view.kind];
    if (L) {
      ctx.font = font(12, 800); ctx.fillStyle = "rgba(148,163,184,.85)";
      ctx.fillText(L[0], 8 * f, H / 2); ctx.fillText(L[1], W - 16 * f, H / 2);
      ctx.fillText(L[2], W / 2 - 4 * f, 18 * f + (report ? 0 : 14 * f)); ctx.fillText(L[3], W / 2 - 4 * f, H - 8 * f);
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
    ctx.fillStyle = hexA(col, 0.35); ctx.strokeStyle = col; ctx.lineWidth = 2 * f;
    ctx.beginPath(); ctx.arc(cx, cy, r * cam.scale, 0, 7); ctx.fill(); ctx.stroke();
    if (S.plan.showSafety !== false) {
      ctx.setLineDash([4 * f, 4 * f]); ctx.strokeStyle = hexA(col, 0.6);
      ctx.beginPath(); ctx.arc(cx, cy, (r + (S.plan.safety ?? 2)) * cam.scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    tag(ctx, im, cx + r * cam.scale + 4 * f, cy, col, f);
    ctx.restore(); return;
  }
  const ux = sx / sl, uy = sy / sl, px = -uy, py = ux;
  const w = r * cam.scale, wApex = w * 0.78;
  ctx.globalAlpha = cut ? 1 : 0.35;
  // body (tapered towards the apex)
  ctx.beginPath();
  ctx.moveTo(T.x + px * w, T.y + py * w); ctx.lineTo(A.x + px * wApex, A.y + py * wApex);
  ctx.quadraticCurveTo(A.x + ux * w * 0.5, A.y + uy * w * 0.5, A.x - px * wApex, A.y - py * wApex);
  ctx.lineTo(T.x - px * w, T.y - py * w); ctx.closePath();
  ctx.fillStyle = hexA(col, cut ? 0.3 : 0.12); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = (sel ? 2.4 : 1.8) * f; ctx.stroke();
  // threads
  ctx.lineWidth = 1 * f; ctx.strokeStyle = hexA(col, 0.8);
  const nT = Math.max(3, Math.floor(im.length / 1.0));
  for (let k = 1; k < nT; k++) {
    const t = k / nT, ww = w + (wApex - w) * t;
    const cx = T.x + sx * t, cy = T.y + sy * t;
    ctx.beginPath(); ctx.moveTo(cx + px * ww, cy + py * ww); ctx.lineTo(cx - px * ww + ux * 2 * f, cy - py * ww + uy * 2 * f); ctx.stroke();
  }
  // axis extension (where the abutment / drill would go)
  ctx.setLineDash([3 * f, 5 * f]); ctx.strokeStyle = hexA(col, 0.7);
  ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(T.x - ux * 8 * cam.scale, T.y - uy * 8 * cam.scale); ctx.stroke();
  // safety zone
  if (S.plan.showSafety !== false && cut) {
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
  tag(ctx, im, Math.max(T.x, A.x) + w + 6 * f, (T.y + A.y) / 2, col, f, gapInfo);
  ctx.restore();
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

/* hit test: what is under the finger / mouse in this view? */
export function hitTest(view, cam, W, H, S, x, y, f = 1) {
  const R = 14 * f;
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