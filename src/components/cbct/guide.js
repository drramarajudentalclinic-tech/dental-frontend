/* ═══════════════════════════════════════════════════════════════════════
   SURGICAL GUIDE — designed from the scan and the implant plan
   (like OnDemand's In2Guide), exported as an STL for 3-D printing.

   How it is made (all in millimetres, on a fine grid around the arch):
   1. The support (teeth, or bone for a bone-supported guide) is found in the
      scan. Seen from the insertion direction (the biting side), everything
      under the first support surface is filled — so undercuts never lock
      the guide and it can be seated straight down.
   2. The guide is the layer at  gap … gap + thickness  above that surface,
      inside a band along the arch, reaching `cover` mm down the sides.
   3. Each implant gets a sleeve: a ring at the planned height on the implant
      axis, joined down to the guide, with the drilling hole cut through.
   4. Small loose bits are removed, and the surface is turned into a smooth
      triangle mesh (STL).
   ═══════════════════════════════════════════════════════════════════════ */
import { archNearest, archAt } from "./geometry";

export const GUIDE_DEFAULTS = {
  support: "teeth", thrHu: null, gap: 0.15, thick: 2.5, cover: 4, band: 16, from: 0, to: null,
  sleeveD: 5.0, sleeveWall: 1.5, sleeveH: 5, sleeveTop: 9, res: 0.35, above: 6,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function buildGuide(vol, plan, arch, opt = {}, onStep = null) {
  const o = { ...GUIDE_DEFAULTS, ...opt };
  if (!arch) throw new Error("Draw the arch first (Implant tab).");
  const thrHu = o.thrHu ?? (o.support === "teeth" ? 1100 : 400);
  const thrV = vol.valueOfHu(thrHu);
  const up = plan.jaw === "upper" ? -vol.zSign : vol.zSign;          // insertion side: towards the biting surface
  const archZ = plan.archZ ?? vol.Z / 2;
  const sFrom = Math.max(0, o.from ?? 0), sTo = Math.min(arch.length, o.to ?? arch.length);

  // ── 1. grid around the chosen part of the arch ──
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let s = sFrom; s <= sTo; s += 1) {
    const p = archAt(arch, s);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const pad = o.band / 2 + 4;
  x0 = Math.max(0, x0 - pad); x1 = Math.min(vol.X, x1 + pad); y0 = Math.max(0, y0 - pad); y1 = Math.min(vol.Y, y1 + pad);
  // only this jaw: from the roots up to `above` mm past the arch line on the biting side
  // (stops the guide landing on the opposite teeth when the mouth is closed)
  const za = archZ - up * 24, zb = archZ + up * (o.above + o.thick + 2);
  const z0 = Math.max(0, Math.min(za, zb)), z1 = Math.min(vol.Z, Math.max(za, zb));
  let h = o.res;
  while (((x1 - x0) / h) * ((y1 - y0) / h) * ((z1 - z0) / h) > 10e6) h *= 1.15;
  const nx = Math.ceil((x1 - x0) / h), ny = Math.ceil((y1 - y0) / h), nz = Math.ceil((z1 - z0) / h), nxy = nx * ny, N = nxy * nz;
  const X = (i) => x0 + (i + 0.5) * h, Y = (j) => y0 + (j + 0.5) * h, Z = (k) => z0 + (k + 0.5) * h;
  // "level" along the insertion direction: larger = nearer the biting side
  const lev = (k) => (up > 0 ? k : nz - 1 - k);
  const kOfLev = (L) => (up > 0 ? L : nz - 1 - L);

  // ── 2. which columns are in the band along the arch ──
  onStep?.(0.05, "Finding the arch…"); await tick();
  const inBand = new Uint8Array(nxy);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const { s, off } = archNearest(arch, X(i), Y(j));
    if (s >= sFrom - 1 && s <= sTo + 1 && Math.abs(off) <= o.band / 2) inBand[j * nx + i] = 1;
  }

  // ── 3. support surface seen from the insertion side → filled "hull" ──
  onStep?.(0.15, "Finding the teeth / bone surface…"); await tick();
  const top = new Int16Array(nxy).fill(-1);                 // level of the first support voxel from the biting side
  const hull = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    let prev = false;
    for (let L = nz - 1; L >= 0; L--) {
      const k = kOfLev(L);
      const on = vol.sample(X(i), Y(j), Z(k)) >= thrV;
      if (Math.abs(Z(k) - archZ) > o.above && (Z(k) - archZ) * up > 0) { prev = false; continue; }   // above this jaw's teeth
      if (on && prev) { top[c] = L + 1; break; }           // two in a row: not noise
      prev = on;
    }
    if (top[c] >= 0) for (let L = top[c]; L >= 0; L--) hull[kOfLev(L) * nxy + c] = 1;
  }

  // ── 4. distance (mm) from the hull, outside it ──
  onStep?.(0.3, "Measuring the fitting gap…"); await tick();
  const d = chamfer(hull, nx, ny, nz, h);

  // highest support level nearby (for the skirt down the sides)
  const R = Math.max(1, Math.round(4 / h));
  const topMax = maxFilter2D(top, nx, ny, R);

  // ── 5. the shell ──
  onStep?.(0.5, "Building the guide shell…"); await tick();
  const g = new Uint8Array(N);
  const coverL = o.cover / h, lo = o.gap, hi = o.gap + o.thick;
  for (let k = 0; k < nz; k++) {
    const L = lev(k);
    for (let c = 0; c < nxy; c++) {
      if (!inBand[c] || topMax[c] < 0) continue;
      const i = k * nxy + c;
      if (hull[i]) continue;
      const dv = d[i];
      if (dv >= lo && dv <= hi && L >= topMax[c] - coverL) g[i] = 1;
    }
  }

  // ── 6. sleeves and drilling holes ──
  onStep?.(0.65, "Adding the sleeves…"); await tick();
  const rHole = o.sleeveD / 2, rOut = rHole + o.sleeveWall;
  const sleeves = [];
  for (const im of plan.implants || []) {
    const a = im.axis, T = im.top;
    const uTop = -o.sleeveTop, uBot = -(o.sleeveTop - o.sleeveH);   // along the axis from the implant top (negative = towards the crown)
    sleeves.push({ id: im.id, tooth: im.tooth, top: add3(T, mul3(a, uTop)), bottom: add3(T, mul3(a, uBot)), d: o.sleeveD, h: o.sleeveH });
    const ext = o.sleeveTop + 2 + rOut;
    const bx0 = Math.max(0, Math.floor((Math.min(T[0], T[0] + a[0] * uTop) - ext - x0) / h)), bx1 = Math.min(nx - 1, Math.ceil((Math.max(T[0], T[0] + a[0] * uTop) + ext - x0) / h));
    const by0 = Math.max(0, Math.floor((Math.min(T[1], T[1] + a[1] * uTop) - ext - y0) / h)), by1 = Math.min(ny - 1, Math.ceil((Math.max(T[1], T[1] + a[1] * uTop) + ext - y0) / h));
    for (let k = 0; k < nz; k++) for (let j = by0; j <= by1; j++) for (let i = bx0; i <= bx1; i++) {
      const px = X(i) - T[0], py = Y(j) - T[1], pz = Z(k) - T[2];
      const u = px * a[0] + py * a[1] + pz * a[2];
      const rx = px - a[0] * u, ry = py - a[1] * u, rz = pz - a[2] * u, r = Math.sqrt(rx * rx + ry * ry + rz * rz);
      const idx = k * nxy + j * nx + i;
      if (r <= rHole) { g[idx] = 0; continue; }                       // the drilling hole, all the way through
      if (r <= rOut && u >= uTop && u <= 0 && !hull[idx] && d[idx] >= lo) g[idx] = 1;   // ring + its joint down to the guide
    }
  }

  // nothing on the outer border of the grid (keeps the mesh closed)
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    if (i < 2 || j < 2 || k < 2 || i >= nx - 2 || j >= ny - 2 || k >= nz - 2) g[k * nxy + j * nx + i] = 0;

  // ── 7. keep the guide in one piece (drop loose bits) ──
  onStep?.(0.75, "Cleaning up…"); await tick();
  const kept = keepBig(g, nx, ny, nz);
  let count = 0; for (let i = 0; i < N; i++) count += g[i];
  if (!count) throw new Error("No guide could be made — check the support type, its level, and that the arch covers the teeth.");
  return {
    grid: { x0, y0, z0, h, nx, ny, nz }, mask: g, sleeves, opt: o, thrHu,
    stats: { cc: (count * h * h * h) / 1000, pieces: kept, size: [x1 - x0, y1 - y0, z1 - z0] },
  };
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/* 3-D chamfer distance (mm) to the nearest set voxel */
function chamfer(mask, nx, ny, nz, h) {
  const nxy = nx * ny, N = nxy * nz, INF = 1e9, d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = mask[i] ? 0 : INF;
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    if (dx || dy || dz) nb.push([dx, dy, dz, h * Math.hypot(dx, dy, dz), dz * nxy + dy * nx + dx]);
  const fwd = nb.filter(([dx, dy, dz]) => dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))));
  const bwd = nb.filter((n) => !fwd.includes(n));
  const run = (list, dir) => {
    for (let zz = 0; zz < nz; zz++) { const z = dir > 0 ? zz : nz - 1 - zz;
      for (let yy = 0; yy < ny; yy++) { const y = dir > 0 ? yy : ny - 1 - yy;
        for (let xx = 0; xx < nx; xx++) { const x = dir > 0 ? xx : nx - 1 - xx;
          const i = z * nxy + y * nx + x; let v = d[i]; if (v === 0) continue;
          for (let q = 0; q < list.length; q++) {
            const n = list[q], X = x + n[0], Y = y + n[1], Z = z + n[2];
            if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
            const c = d[i + n[4]] + n[3]; if (c < v) v = c;
          }
          d[i] = v;
        } } }
  };
  run(fwd, 1); run(bwd, -1);
  return d;
}
function maxFilter2D(a, nx, ny, R) {
  const t = new Int16Array(a.length), out = new Int16Array(a.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let m = -1; for (let k = Math.max(0, i - R); k <= Math.min(nx - 1, i + R); k++) m = Math.max(m, a[j * nx + k]); t[j * nx + i] = m; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let m = -1; for (let k = Math.max(0, j - R); k <= Math.min(ny - 1, j + R); k++) m = Math.max(m, t[k * nx + i]); out[j * nx + i] = m; }
  return out;
}
/* keep pieces at least 5 % the size of the biggest (6-connected) */
function keepBig(g, nx, ny, nz) {
  const nxy = nx * ny, N = g.length, lab = new Int32Array(N), sizes = [0];
  const st = new Int32Array(N);
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (!g[i] || lab[i]) continue;
    n++; let sp = 0, size = 0; st[sp++] = i; lab[i] = n;
    while (sp) {
      const v = st[--sp]; size++;
      const x = v % nx, y = ((v / nx) | 0) % ny, z = (v / nxy) | 0;
      const tryP = (w) => { if (g[w] && !lab[w]) { lab[w] = n; st[sp++] = w; } };
      if (x > 0) tryP(v - 1); if (x < nx - 1) tryP(v + 1);
      if (y > 0) tryP(v - nx); if (y < ny - 1) tryP(v + nx);
      if (z > 0) tryP(v - nxy); if (z < nz - 1) tryP(v + nxy);
    }
    sizes.push(size);
  }
  const big = Math.max(0, ...sizes), keep = sizes.map((s) => s >= big * 0.05);
  let kept = 0; keep.forEach((k, i) => { if (i && k) kept++; });
  for (let i = 0; i < N; i++) if (g[i] && !keep[lab[i]]) g[i] = 0;
  return kept;
}

/* the guide on the scan's own grid (for the slices and the 3-D view): 1 = guide */
export function guideToVolume(vol, G) {
  const { x0, y0, z0, h, nx, ny, nz } = G.grid, nxy = nx * ny;
  const out = new Uint8Array(vol.nx * vol.ny * vol.nz);
  const i0 = Math.max(0, Math.floor(x0 / vol.sx)), i1 = Math.min(vol.nx - 1, Math.ceil((x0 + nx * h) / vol.sx));
  const j0 = Math.max(0, Math.floor(y0 / vol.sy)), j1 = Math.min(vol.ny - 1, Math.ceil((y0 + ny * h) / vol.sy));
  const k0 = Math.max(0, Math.floor(z0 / vol.sz)), k1 = Math.min(vol.nz - 1, Math.ceil((z0 + nz * h) / vol.sz));
  // a voxel is "guide" when a fair share of the fine cells inside it are guide
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let on = 0, tot = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const gx = Math.floor(((i + 0.25 + a * 0.5) * vol.sx - x0) / h), gy = Math.floor(((j + 0.25 + b * 0.5) * vol.sy - y0) / h), gz = Math.floor(((k + 0.25 + c * 0.5) * vol.sz - z0) / h);
      if (gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz) continue;
      tot++; on += G.mask[gz * nxy + gy * nx + gx];
    }
    if (tot && on * 2 >= tot) out[k * vol.nxy + j * vol.nx + i] = 1;
  }
  return out;
}

/* smooth triangle mesh of the guide (surface nets on a lightly blurred mask) → binary STL */
export function guideSTL(G, name = "surgical-guide") {
  const { x0, y0, z0, h, nx, ny, nz } = G.grid, nxy = nx * ny;
  // blur 1-2-1 in x, y, z → values 0..1
  const f = new Float32Array(nx * ny * nz), t = new Float32Array(nx * ny * nz);
  for (let i = 0; i < f.length; i++) f[i] = G.mask[i];
  const blur = (src, dst, step, n, coord) => {
    for (let i = 0; i < src.length; i++) {
      const c = coord(i);
      const a = c > 0 ? src[i - step] : 0, b = c < n - 1 ? src[i + step] : 0;
      dst[i] = (a + 2 * src[i] + b) * 0.25;
    }
  };
  blur(f, t, 1, nx, (i) => i % nx); blur(t, f, nx, ny, (i) => ((i / nx) | 0) % ny); blur(f, t, nxy, nz, (i) => (i / nxy) | 0);
  const F = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : t[z * nxy + y * nx + x]);
  const iso = 0.5;
  // one vertex per cell that the surface passes through
  const cx = nx + 1, cy = ny + 1, cz = nz + 1;
  const vid = new Int32Array(cx * cy * cz).fill(-1);
  const verts = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cornersOf = (x, y, z) => [F(x - 1, y - 1, z - 1), F(x, y - 1, z - 1), F(x - 1, y, z - 1), F(x, y, z - 1), F(x - 1, y - 1, z), F(x, y - 1, z), F(x - 1, y, z), F(x, y, z)];
  const off = [[-1, -1, -1], [0, -1, -1], [-1, 0, -1], [0, 0, -1], [-1, -1, 0], [0, -1, 0], [-1, 0, 0], [0, 0, 0]];
  for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    const c = cornersOf(x, y, z);
    let inside = 0; for (const v of c) if (v > iso) inside++;
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      const va = c[a], vb = c[b];
      if ((va > iso) === (vb > iso)) continue;
      const tt = (iso - va) / (vb - va);
      sx += off[a][0] + (off[b][0] - off[a][0]) * tt; sy += off[a][1] + (off[b][1] - off[a][1]) * tt; sz += off[a][2] + (off[b][2] - off[a][2]) * tt; n++;
    }
    vid[z * cx * cy + y * cx + x] = verts.length;
    // grid cell centres sit at (index + 0.5) h
    verts.push([x0 + (x + sx / n + 0.5) * h, y0 + (y + sy / n + 0.5) * h, z0 + (z + sz / n + 0.5) * h]);
  }
  const V = (x, y, z) => vid[z * cx * cy + y * cx + x];
  const tris = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) { tris.push([a, c, b], [a, d, c]); } else { tris.push([a, b, c], [a, c, d]); } };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const v0 = F(x, y, z) > iso;
    // edge to +x neighbour: shared by cells (x+1, y..y+1, z..z+1)
    if (x + 1 <= nx) { const v1 = F(x + 1, y, z) > iso; if (v0 !== v1) quad(V(x + 1, y, z), V(x + 1, y + 1, z), V(x + 1, y + 1, z + 1), V(x + 1, y, z + 1), v1); }
    if (y + 1 <= ny) { const v1 = F(x, y + 1, z) > iso; if (v0 !== v1) quad(V(x, y + 1, z), V(x, y + 1, z + 1), V(x + 1, y + 1, z + 1), V(x + 1, y + 1, z), v1); }
    if (z + 1 <= nz) { const v1 = F(x, y, z + 1) > iso; if (v0 !== v1) quad(V(x, y, z + 1), V(x + 1, y, z + 1), V(x + 1, y + 1, z + 1), V(x, y + 1, z + 1), v1); }
  }
  // binary STL
  const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  const head = `${name} - CBCT planner surgical guide (mm)`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  let p = 84;
  for (const [a, b, c] of tris) {
    const A = verts[a], B = verts[b], C = verts[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
    let nx_ = uy * wz - uz * wy, ny_ = uz * wx - ux * wz, nz_ = ux * wy - uy * wx; const l = Math.hypot(nx_, ny_, nz_) || 1;
    nx_ /= l; ny_ /= l; nz_ /= l;
    for (const v of [nx_, ny_, nz_, ...A, ...B, ...C]) { dv.setFloat32(p, v, true); p += 4; }
    dv.setUint16(p, 0, true); p += 2;
  }
  return { blob: new Blob([buf], { type: "model/stl" }), triangles: tris.length, vertices: verts.length };
}