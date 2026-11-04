/* ═══════════════════════════════════════════════════════════════════════
   FUSION — before / after comparison of two scans of the same patient
   (like OnDemand's Fusion module).
   • automatic alignment on the bone surfaces (ICP: iterative closest point),
     optionally using only the stable upper skull, plus fine manual nudges
   • overlay slices: colour (before = magenta, after = green), blend, checker
   • a "change map": distance from the first scan's bone surface, used to
     colour the second scan's bone in 3-D (green = same … red = 5 mm or more)
   Transform T maps a point of scan A (mm) to the same point in scan B (mm):
   q = R·p + t, with R a 3×3 rotation (row-major).
   ═══════════════════════════════════════════════════════════════════════ */

export const IDENT = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
export function applyT(T, p) {
  const R = T.R;
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + T.t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + T.t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + T.t[2]];
}
export function invertT(T) {
  const R = T.R, Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const t = applyT({ R: Rt, t: [0, 0, 0] }, T.t);
  return { R: Rt, t: [-t[0], -t[1], -t[2]] };
}
/* A ∘ B: first B, then A */
export function composeT(A, B) {
  const a = A.R, b = B.R, R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return { R, t: applyT(A, B.t) };
}
function rotAxis(axis, ang) {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
/* a small manual correction of scan B (in A's frame, about the centre c): turn about an axis and/or move */
export function nudgeT(T, { axis = null, deg = 0, move = [0, 0, 0], centre = [0, 0, 0] }) {
  // X = T⁻¹ maps B → A. Correct X: X' = M ∘ X, with M a turn about `centre` plus a move.
  const X = invertT(T);
  let M = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: move.slice() };
  if (axis && deg) {
    const R = rotAxis(axis, (deg * Math.PI) / 180);
    const rc = applyT({ R, t: [0, 0, 0] }, centre);
    M = { R, t: [centre[0] - rc[0] + move[0], centre[1] - rc[1] + move[1], centre[2] - rc[2] + move[2]] };
  }
  return invertT(composeT(M, X));
}

/* bone surface points (mm) of a scan: bone voxels next to non-bone, evenly thinned */
export function surfacePoints(vol, thrHu = 500, { maxPts = 6000, zFrom = 0, zTo = 1 } = {}) {
  const { nx, ny, nz, nxy, data, sx, sy, sz } = vol;
  const thr = vol.valueOfHu(thrHu);
  const step = Math.max(1, Math.round(Math.cbrt((nx * ny * nz) / 4.0e6)));
  const z0 = Math.floor(Math.min(zFrom, zTo) * nz), z1 = Math.ceil(Math.max(zFrom, zTo) * nz);
  const pts = [];
  for (let z = Math.max(step, z0); z < Math.min(nz - step, z1); z += step)
    for (let y = step; y < ny - step; y += step)
      for (let x = step; x < nx - step; x += step) {
        const i = z * nxy + y * nx + x;
        if (data[i] < thr) continue;
        if (data[i - step] < thr || data[i + step] < thr || data[i - step * nx] < thr || data[i + step * nx] < thr || data[i - step * nxy] < thr || data[i + step * nxy] < thr)
          pts.push([(x + 0.5) * sx, (y + 0.5) * sy, (z + 0.5) * sz]);
      }
  if (pts.length <= maxPts) return pts;
  const out = [], k = pts.length / maxPts;
  for (let i = 0; i < maxPts; i++) out.push(pts[Math.floor(i * k)]);
  return out;
}
/* "superior part of the scan" in 0..1 of the z range, whichever way z points */
export function upperRange(vol, frac) { return vol.zUp ? [1 - frac, 1] : [0, frac]; }

class Grid {
  constructor(pts, cell) {
    this.cell = cell; this.pts = pts; this.map = new Map();
    pts.forEach((p, i) => { const k = this.key(p); let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(i); });
  }
  key(p) { const c = this.cell; return `${Math.floor(p[0] / c)},${Math.floor(p[1] / c)},${Math.floor(p[2] / c)}`; }
  nearest(p, maxD) {
    const c = this.cell, cx = Math.floor(p[0] / c), cy = Math.floor(p[1] / c), cz = Math.floor(p[2] / c);
    let best = -1, bd = maxD * maxD;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
      for (const i of a) { const q = this.pts[i]; const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  }
}
/* best rotation + move mapping points m → a (Horn's quaternion method) */
function horn(M, A) {
  const n = M.length, cm = [0, 0, 0], ca = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cm[k] += M[i][k] / n; ca[k] += A[i][k] / n; }
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += (M[i][r] - cm[r]) * (A[i][c] - ca[c]);
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const shift = S.reduce((s, v) => s + Math.abs(v), 0) + 1e-9;
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 80; it++) {
    const nq = [0, 1, 2, 3].map((r) => N[r][0] * q[0] + N[r][1] * q[1] + N[r][2] * q[2] + N[r][3] * q[3] + shift * q[r]);
    const l = Math.hypot(...nq) || 1; q = nq.map((v) => v / l);
  }
  const [w, x, y, z] = q;
  const R = [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (y * x + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (z * x - w * y), 2 * (z * y + w * x), w * w - x * x - y * y + z * z];
  const rc = applyT({ R, t: [0, 0, 0] }, cm);
  return { R, t: [ca[0] - rc[0], ca[1] - rc[1], ca[2] - rc[2]] };
}
/* automatic alignment. Returns { T, rms, used } — T maps A → B. onStep(progress 0..1) */
export async function autoAlign(volA, volB, { thrHu = 500, region = "all", start = null, onStep = null } = {}) {
  const r = region === "upper" ? 0.5 : region === "lower" ? -0.55 : 0;
  const rangeA = r > 0 ? upperRange(volA, r) : r < 0 ? (volA.zUp ? [0, -r] : [1 + r, 1]) : [0, 1];
  const rangeB = r > 0 ? upperRange(volB, r) : r < 0 ? (volB.zUp ? [0, -r] : [1 + r, 1]) : [0, 1];
  const A = surfacePoints(volA, thrHu, { maxPts: 20000, zFrom: rangeA[0], zTo: rangeA[1] });
  const B = surfacePoints(volB, thrHu, { maxPts: 3500, zFrom: rangeB[0], zTo: rangeB[1] });
  if (A.length < 50 || B.length < 50) throw new Error("Not enough bone found to align the scans.");
  const mean = (P) => P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);
  // X maps B → A. Start: the given alignment, or match the centres
  let X;
  if (start) X = invertT(start);
  else { const ca = mean(A), cb = mean(B); X = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]] }; }
  const stages = [[10, 14], [5, 12], [2.5, 12], [1.2, 10]];
  let rms = 0, used = 0, it = 0, total = stages.reduce((s, x) => s + x[1], 0);
  for (const [cell, iters] of stages) {
    const grid = new Grid(A, cell);
    for (let k = 0; k < iters; k++, it++) {
      const M = [], T = [];
      let se = 0;
      for (const p of B) {
        const q = applyT(X, p), nn = grid.nearest(q, cell);
        if (!nn) continue;
        M.push(p); T.push(A[nn.i]); se += nn.d * nn.d;
      }
      if (M.length < 30) break;
      // drop the worst 10 % (changed areas: surgery, new bone, teeth moved)
      const ds = M.map((p, i) => { const q = applyT(X, p); return Math.hypot(q[0] - T[i][0], q[1] - T[i][1], q[2] - T[i][2]); });
      const cut = [...ds].sort((a, b) => a - b)[Math.floor(ds.length * 0.9)];
      const M2 = [], T2 = [];
      ds.forEach((d, i) => { if (d <= cut) { M2.push(M[i]); T2.push(T[i]); } });
      X = horn(M2, T2);
      rms = Math.sqrt(se / M.length); used = M.length;
      if (onStep && k % 3 === 0) { onStep(it / total); await new Promise((res) => setTimeout(res, 0)); }
    }
  }
  return { T: invertT(X), rms, used, nA: A.length, nB: B.length };
}

/* overlay slice: A in grey + B (moved into A's frame by T) */
export function renderFusion(view, volA, volB, T, cam, W, H, lutA, lutB, { mode = "colour", mix = 0.5, quick = false, img } = {}) {
  const out = img && img.width === W && img.height === H ? img : new ImageData(W, H);
  const px = out.data;
  const a0 = view.a0 - (W / 2 + cam.panX) / cam.scale, b0 = view.b0 - (H / 2 + cam.panY) / cam.scale, ds = 1 / cam.scale;
  const P0 = view.world(a0, b0), Pa = view.world(a0 + 1, b0), Pb = view.world(a0, b0 + 1);
  const du = [Pa[0] - P0[0], Pa[1] - P0[1], Pa[2] - P0[2]], dv = [Pb[0] - P0[0], Pb[1] - P0[1], Pb[2] - P0[2]];
  const Q0 = applyT(T, P0), Qa = applyT(T, Pa), Qb = applyT(T, Pb);
  const eu = [Qa[0] - Q0[0], Qa[1] - Q0[1], Qa[2] - Q0[2]], ev = [Qb[0] - Q0[0], Qb[1] - Q0[1], Qb[2] - Q0[2]];
  const samp = quick ? (v, x, y, z) => v.sampleNearest(x, y, z) : (v, x, y, z) => v.sample(x, y, z);
  const check = 8;                                         // checker squares (mm)
  const splitX = Math.round(W * mix);
  for (let j = 0; j < H; j++) {
    const bj = j * ds;
    for (let i = 0; i < W; i++) {
      const ai = i * ds;
      const x = P0[0] + du[0] * ai + dv[0] * bj, y = P0[1] + du[1] * ai + dv[1] * bj, z = P0[2] + du[2] * ai + dv[2] * bj;
      const qx = Q0[0] + eu[0] * ai + ev[0] * bj, qy = Q0[1] + eu[1] * ai + ev[1] * bj, qz = Q0[2] + eu[2] * ai + ev[2] * bj;
      const va = samp(volA, x, y, z), vb = samp(volB, qx, qy, qz);
      const ga = va < 0 ? 0 : lutA[va | 0], gb = vb < 0 ? 0 : lutB[vb | 0];
      const p = (j * W + i) * 4;
      if (mode === "colour") { px[p] = ga; px[p + 1] = gb; px[p + 2] = ga; }
      else if (mode === "blend") { const g = ga * (1 - mix) + gb * mix; px[p] = px[p + 1] = px[p + 2] = g; }
      else if (mode === "checker") { const c = (Math.floor((a0 + ai) / check) + Math.floor((b0 + bj) / check)) & 1; const g = c ? gb : ga; px[p] = px[p + 1] = px[p + 2] = g; }
      else { const g = i < splitX ? ga : gb; px[p] = px[p + 1] = px[p + 2] = g; }
      px[p + 3] = 255;
    }
  }
  if (mode === "split") for (let j = 0; j < H; j++) { const p = (j * W + splitX) * 4; px[p] = 250; px[p + 1] = 204; px[p + 2] = 21; }
  return out;
}

/* distance (mm) from A's bone surface, on a coarse grid covering A — for the 3-D change map.
   Stored as bytes: value / 10 = mm (0 … 25.5 mm). */
export function distanceField(volA, thrHu = 500, maxDim = 200) {
  const { nx, ny, nz, nxy, data } = volA;
  const f = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / maxDim));
  const gx = Math.ceil(nx / f), gy = Math.ceil(ny / f), gz = Math.ceil(nz / f), gxy = gx * gy;
  const thr = volA.valueOfHu(thrHu);
  const bone = new Uint8Array(gx * gy * gz);
  for (let z = 0; z < gz; z++) for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    const i = Math.min(nz - 1, z * f) * nxy + Math.min(ny - 1, y * f) * nx + Math.min(nx - 1, x * f);
    bone[z * gxy + y * gx + x] = data[i] >= thr ? 1 : 0;
  }
  const INF = 1e9, d = new Float32Array(gx * gy * gz).fill(INF);
  for (let z = 0; z < gz; z++) for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    const i = z * gxy + y * gx + x; if (!bone[i]) continue;
    if ((x > 0 && !bone[i - 1]) || (x < gx - 1 && !bone[i + 1]) || (y > 0 && !bone[i - gx]) || (y < gy - 1 && !bone[i + gx]) || (z > 0 && !bone[i - gxy]) || (z < gz - 1 && !bone[i + gxy])) d[i] = 0;
  }
  const hx = volA.sx * f, hy = volA.sy * f, hz = volA.sz * f;
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue;
    nb.push([dx, dy, dz, Math.hypot(dx * hx, dy * hy, dz * hz)]);
  }
  const fwd = nb.filter(([dx, dy, dz]) => dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))));
  const bwd = nb.filter((n) => !fwd.includes(n));
  const pass = (list, order) => {
    for (let zz = 0; zz < gz; zz++) { const z = order > 0 ? zz : gz - 1 - zz;
      for (let yy = 0; yy < gy; yy++) { const y = order > 0 ? yy : gy - 1 - yy;
        for (let xx = 0; xx < gx; xx++) { const x = order > 0 ? xx : gx - 1 - xx;
          const i = z * gxy + y * gx + x; let v = d[i];
          for (const [dx, dy, dz, w] of list) {
            const X = x + dx, Y = y + dy, Z = z + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= gx || Y >= gy || Z >= gz) continue;
            const c = d[Z * gxy + Y * gx + X] + w; if (c < v) v = c;
          }
          d[i] = v;
        } } }
  };
  pass(fwd, 1); pass(bwd, -1);
  const out = new Uint8Array(d.length);
  const bias = 0.5 * Math.min(hx, hy, hz);               // surfaces lie between grid points
  for (let i = 0; i < d.length; i++) out[i] = Math.min(255, Math.round(Math.max(0, d[i] - bias) * 10));
  return { data: out, gx, gy, gz };
}