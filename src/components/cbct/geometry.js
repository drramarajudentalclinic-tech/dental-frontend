/* ═══════════════════════════════════════════════════════════════════════
   GEOMETRY — vectors, the dental arch curve, the views and the reslicer.
   Every view maps a screen pixel to a point in the scan (mm) and back,
   so measurements, implants and the nerve stay in true millimetres.
   ═══════════════════════════════════════════════════════════════════════ */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a, b) => len(sub(a, b));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/* rotate vector v around unit axis k by angle a (radians) — Rodrigues */
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

/* closest distance between segments p1-q1 and p2-q2 */
export function segSegDist(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return len(r);
  if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  return len(sub(add(p1, mul(d1, s)), add(p2, mul(d2, t))));
}
export function pointSegDist(p, a, b) {
  const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
  return dist(p, add(a, mul(ab, t)));
}

/* ── dental arch: smooth curve through the tapped points (axial plane) ── */
export function buildArch(points, step = 0.25) {
  if (!points || points.length < 2) return null;
  let pts = points.map((p) => [p[0], p[1]]);
  if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.reverse();     // start on the patient's right (screen left)
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1].map((i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
  };
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.2));
    for (let k = 0; k < n; k++) dense.push(cr(p0, p1, p2, p3, k / n));
  }
  dense.push(pts[pts.length - 1]);
  // equal steps along the curve
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.floor(L / step) + 1);
  const xs = new Float32Array(n), ys = new Float32Array(n), nxs = new Float32Array(n), nys = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * L;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    xs[k] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
    ys[k] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
  }
  // normals in the axial plane, pointing to the cheek / lip side (away from the arch centre)
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2);
    let tx = xs[b] - xs[a], ty = ys[b] - ys[a];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let nx = -ty, ny = tx;
    if ((xs[k] - cx) * nx + (ys[k] - cy) * ny < 0) { nx = -nx; ny = -ny; }
    nxs[k] = nx; nys[k] = ny;
  }
  return { points: pts, step: L / (n - 1), length: L, n, xs, ys, nxs, nys };
}
export function archAt(arch, s) {
  const f = clamp(s / arch.step, 0, arch.n - 1), i = Math.floor(f), j = Math.min(arch.n - 1, i + 1), t = f - i;
  const x = arch.xs[i] + (arch.xs[j] - arch.xs[i]) * t, y = arch.ys[i] + (arch.ys[j] - arch.ys[i]) * t;
  let nx = arch.nxs[i] + (arch.nxs[j] - arch.nxs[i]) * t, ny = arch.nys[i] + (arch.nys[j] - arch.nys[i]) * t;
  const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
  return { x, y, nx, ny, tx: ny, ty: -nx };
}
/* nearest place on the arch to an (x, y) point: { s, off } off = mm towards the cheek */
export function archNearest(arch, x, y) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < arch.n; k += 2) {
    const d = (arch.xs[k] - x) ** 2 + (arch.ys[k] - y) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  for (let k = Math.max(0, best - 3); k <= Math.min(arch.n - 1, best + 3); k++) {
    const d = (arch.xs[k] - x) ** 2 + (arch.ys[k] - y) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  const off = (x - arch.xs[best]) * arch.nxs[best] + (y - arch.ys[best]) * arch.nys[best];
  return { s: best * arch.step, off };
}

/* ═════ VIEWS ═════
   A view = how screen pixels map to the scan. cam = { scale: screen px per mm,
   panX, panY } and the view's own centre in its plane (a0, b0). */
export const IDENTITY_FRAME = { ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };
const projU = (b, N, alt) => {
  let u = sub(b, mul(N, dot(b, N)));
  if (len(u) < 1e-3) u = sub(alt, mul(N, dot(alt, N)));
  return norm(u);
};
/* a plane through point C with normal N; U follows `ub` (screen right), V points like `vb` (screen down) */
function mprPlane(kind, vol, C, N, ub, vb) {
  N = norm(N);
  const U = projU(ub, N, vb);
  let V = norm(cross(N, U));
  if (dot(V, vb) < 0) V = mul(V, -1);
  const Vc = [vol.X / 2, vol.Y / 2, vol.Z / 2];
  const ext = (d) => Math.abs(d[0]) * vol.X + Math.abs(d[1]) * vol.Y + Math.abs(d[2]) * vol.Z;
  const a0 = ext(U) / 2, b0 = ext(V) / 2;
  const Q = add(Vc, mul(N, dot(sub(C, Vc), N)));
  const O = sub(sub(Q, mul(U, a0)), mul(V, b0));
  const v = planar(kind, O, U, V, a0, b0, N);
  v.C = C; v.depthRange = ext(N) / 2; v.Vc = Vc;
  v.plane = (p) => { const d = sub(p, O); return [dot(d, U), dot(d, V), dot(sub(p, C), N)]; };
  return v;
}
export function makeView(kind, vol, st) {
  const up = [0, 0, -vol.zSign];                   // moving DOWN the screen = towards the feet
  const zTop = vol.zTop;
  const F = st.frame || IDENTITY_FRAME;
  const C = st.cursor;
  if (kind === "axial") return mprPlane(kind, vol, C, F.ez, [1, 0, 0], [0, 1, 0]);
  if (kind === "coronal") return mprPlane(kind, vol, C, F.ey, [1, 0, 0], up);
  if (kind === "sagittal") return mprPlane(kind, vol, C, F.ex, [0, 1, 0], up);
  if (kind.startsWith("tmj") && st.condyles) {
    // TMJ: close-up sagittal (s) and coronal (c) through each condyle (R / L)
    const side = kind[3], K = st.condyles[side];
    if (!K) return null;
    const fov = st.tmjFov || 36, off = (st.tmjOffset && st.tmjOffset[kind]) || 0;
    const sag = kind[4] === "s";
    const N = sag ? [1, 0, 0] : [0, 1, 0], U = sag ? [0, 1, 0] : [1, 0, 0];
    const c = add(K, mul(N, off));
    const O = sub(sub(c, mul(U, fov / 2)), mul(up, fov / 2));
    const v = planar(kind, O, U, up, fov / 2, fov / 2, N);
    v.centre = c;
    return v;
  }
  if (kind === "cross" && st.arch) {
    const c = archAt(st.arch, st.crossS);
    const U = [-c.nx, -c.ny, 0];                  // lingual on the right, cheek / lip on the left
    const half = st.crossWidth / 2;
    const v = planar(kind, [c.x + c.nx * half, c.y + c.ny * half, zTop], U, up, half, vol.Z / 2, [c.tx, c.ty, 0]);
    v.crossCentre = [c.x, c.y];
    return v;
  }
  if (kind === "pano" && st.arch) return panoView(vol, st.arch, st.panoOffset || 0, up, zTop);
  return null;
}

function planar(kind, O, U, V, a0, b0, N) {
  return {
    kind, O, U, V, N: norm(N), a0, b0, planar: true,
    world(a, b) { return [O[0] + U[0] * a + V[0] * b, O[1] + U[1] * a + V[1] * b, O[2] + U[2] * a + V[2] * b]; },
    plane(p) { const d = sub(p, O); return [dot(d, U), dot(d, V), dot(sub(p, O), this.N)]; },
  };
}

function panoView(vol, arch, offset, up, zTop) {
  return {
    kind: "pano", arch, offset, a0: arch.length / 2, b0: vol.Z / 2, planar: false, V: up,
    world(a, b) {
      const c = archAt(arch, a);
      return [c.x + c.nx * offset, c.y + c.ny * offset, zTop + up[2] * b];
    },
    plane(p) {
      const { s, off } = archNearest(arch, p[0], p[1]);
      return [s, (p[2] - zTop) * up[2], off - offset];
    },
  };
}

/* screen ⇄ plane */
export function toScreen(view, cam, W, H, p) {
  const [a, b, d] = view.plane(p);
  return { x: W / 2 + cam.panX + (a - view.a0) * cam.scale, y: H / 2 + cam.panY + (b - view.b0) * cam.scale, d };
}
export function toWorld(view, cam, W, H, sx, sy) {
  const a = (sx - W / 2 - cam.panX) / cam.scale + view.a0, b = (sy - H / 2 - cam.panY) / cam.scale + view.b0;
  return view.world(a, b);
}
export function fitScale(view, vol, W, H) {
  const wa = view.kind === "pano" ? view.arch.length : view.a0 * 2;
  const hb = view.kind === "pano" ? vol.Z : view.b0 * 2;
  return Math.min(W / wa, H / hb) * 0.96;
}
/* rotate the MPR frame about one view's normal (the other two planes turn) */
export function rotateFrame(F, axis, a) {
  const k = norm(axis);
  return { ex: norm(rotate(F.ex, k, a)), ey: norm(rotate(F.ey, k, a)), ez: norm(rotate(F.ez, k, a)) };
}

/* ═════ RENDER a view into ImageData ═════
   lut: 256 grey levels for the window / level. slab: thickness in mm
   (averaged, or brightest when mip). quick: nearest-neighbour while dragging. */
/* colour ramp for the airway: narrow = red → yellow → green → wide = blue (index 2..255) */
export const AREA_RAMP = Array.from({ length: 256 }, (_, i) => {
  const t = Math.max(0, Math.min(1, (i - 2) / 253));
  const stops = [[0, [239, 68, 68]], [0.33, [250, 204, 21]], [0.66, [34, 197, 94]], [1, [59, 130, 246]]];
  for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) {
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k], u = (t - t0) / (t1 - t0);
    return c0.map((c, j) => Math.round(c + (c1[j] - c) * u));
  }
  return stops[3][1];
});
export function renderView(view, vol, cam, W, H, lut, { slab = 0, mip = false, quick = false, img, mask = null, maskColor = [34, 211, 238] } = {}) {
  const out = img && img.width === W && img.height === H ? img : new ImageData(W, H);
  const px = out.data;
  const isx = 1 / vol.sx, isy = 1 / vol.sy, isz = 1 / vol.sz;
  const samp = quick ? vol.sampleNearest.bind(vol) : vol.sampleVox.bind(vol);
  const inv = 1 / cam.scale;
  const nS = slab > 0 ? Math.max(2, Math.min(quick ? 6 : 24, Math.round(slab / Math.min(vol.sx, vol.sy, vol.sz)))) : 1;
  if (view.planar) {
    const a0 = (0 - W / 2 - cam.panX) * inv + view.a0, b0 = (0 - H / 2 - cam.panY) * inv + view.b0;
    const O = view.world(a0, b0);
    const du = mul(view.U, inv), dv = mul(view.V, inv);
    const N = view.N;
    // in voxel units
    const ox = O[0] * isx - 0.5, oy = O[1] * isy - 0.5, oz = O[2] * isz - 0.5;
    const ux = du[0] * isx, uy = du[1] * isy, uz = du[2] * isz;
    const vx = dv[0] * isx, vy = dv[1] * isy, vz = dv[2] * isz;
    const offs = [];
    for (let k = 0; k < nS; k++) offs.push(nS === 1 ? 0 : -slab / 2 + (slab * k) / (nS - 1));
    const nxv = N[0] * isx, nyv = N[1] * isy, nzv = N[2] * isz;
    let p = 0;
    for (let j = 0; j < H; j++) {
      let fx = ox + vx * j, fy = oy + vy * j, fz = oz + vz * j;
      for (let i = 0; i < W; i++) {
        let v;
        if (nS === 1) v = samp(fx, fy, fz);
        else {
          let acc = 0, cnt = 0, mx = -1;
          for (let k = 0; k < nS; k++) {
            const s = samp(fx + nxv * offs[k], fy + nyv * offs[k], fz + nzv * offs[k]);
            if (s >= 0) { acc += s; cnt++; if (s > mx) mx = s; }
          }
          v = cnt ? (mip ? mx : acc / cnt) : -1;
        }
        if (v < 0) { px[p] = px[p + 1] = px[p + 2] = 0; }
        else {
          const g = lut[v | 0];
          if (mask) {
            const ix = (fx + 0.5) | 0, iy = (fy + 0.5) | 0, iz = (fz + 0.5) | 0;
            const mv = ix >= 0 && iy >= 0 && iz >= 0 && ix < vol.nx && iy < vol.ny && iz < vol.nz ? mask[iz * vol.nxy + iy * vol.nx + ix] : 0;
            if (mv) {
              const mc = mv > 1 ? AREA_RAMP[mv] : maskColor;   // > 1: coloured by the airway's cross-section area
              px[p] = (g * 0.35 + mc[0] * 0.65) | 0; px[p + 1] = (g * 0.35 + mc[1] * 0.65) | 0; px[p + 2] = (g * 0.35 + mc[2] * 0.65) | 0;
            } else px[p] = px[p + 1] = px[p + 2] = g;
          } else px[p] = px[p + 1] = px[p + 2] = g;
        }
        px[p + 3] = 255; p += 4;
        fx += ux; fy += uy; fz += uz;
      }
    }
    return out;
  }
  // panoramic: one column per place along the arch
  const arch = view.arch, up = view.V[2];
  const zTop = vol.zTop;
  let p = 0;
  const cols = new Array(W);
  for (let i = 0; i < W; i++) {
    const s = (i - W / 2 - cam.panX) * inv + view.a0;
    cols[i] = s < 0 || s > arch.length ? null : archAt(arch, s);
  }
  const offs = [];
  for (let k = 0; k < nS; k++) offs.push((nS === 1 ? 0 : -slab / 2 + (slab * k) / (nS - 1)) + view.offset);
  for (let j = 0; j < H; j++) {
    const b = (j - H / 2 - cam.panY) * inv + view.b0;
    const fz = (zTop + up * b) * isz - 0.5;
    for (let i = 0; i < W; i++) {
      const c = cols[i];
      let v = -1;
      if (c) {
        let acc = 0, cnt = 0, mx = -1;
        for (let k = 0; k < nS; k++) {
          const s = samp((c.x + c.nx * offs[k]) * isx - 0.5, (c.y + c.ny * offs[k]) * isy - 0.5, fz);
          if (s >= 0) { acc += s; cnt++; if (s > mx) mx = s; }
        }
        v = cnt ? (mip ? mx : acc / cnt) : -1;
      }
      if (v < 0) { px[p] = px[p + 1] = px[p + 2] = 0; }
      else { const g = lut[v | 0]; px[p] = px[p + 1] = px[p + 2] = g; }
      px[p + 3] = 255; p += 4;
    }
  }
  return out;
}

export function makeLut(vol, window, level, invert = false) {
  const lut = new Uint8ClampedArray(256);
  const lo = level - window / 2;
  for (let v = 0; v < 256; v++) {
    let g = ((vol.hu(v) - lo) / window) * 255;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    lut[v] = invert ? 255 - g : g;
  }
  return lut;
}

/* ═════ IMPLANTS ═════ */
export function implantApex(im) { return add(im.top, mul(im.axis, im.length)); }
export function implantNerveGap(im, nerves) {
  let best = Infinity, which = null;
  const A = implantApex(im);
  for (const n of nerves || []) {
    for (let k = 0; k + 1 < n.points.length; k++) {
      const d = segSegDist(im.top, A, n.points[k], n.points[k + 1]) - im.diameter / 2 - (n.diameter || 2) / 2;
      if (d < best) { best = d; which = n; }
    }
  }
  return best === Infinity ? null : { gap: best, nerve: which };
}
export function implantGap(a, b) {
  return segSegDist(a.top, implantApex(a), b.top, implantApex(b)) - a.diameter / 2 - b.diameter / 2;
}
/* density inside the implant (and a 0.5 mm ring around it): mean HU and the Misch class */
export function implantDensity(im, vol) {
  const A = implantApex(im);
  const ax = im.axis;
  let ref = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(ax, ref)), e2 = cross(ax, e1);
  let sum = 0, n = 0;
  const r = im.diameter / 2 + 0.5;
  for (let t = 0.05; t <= 1.0001; t += 0.1) {
    const c = add(im.top, mul(sub(A, im.top), t));
    for (const rr of [0, r * 0.5, r]) {
      const steps = rr === 0 ? 1 : 10;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const p = add(c, add(mul(e1, Math.cos(a) * rr), mul(e2, Math.sin(a) * rr)));
        const v = vol.sample(p[0], p[1], p[2]);
        if (v >= 0) { sum += vol.hu(v); n++; }
      }
    }
  }
  if (!n) return null;
  const hu = Math.round(sum / n);
  const cls = hu > 1250 ? "D1" : hu > 850 ? "D2" : hu > 350 ? "D3" : hu > 150 ? "D4" : "D5";
  return { hu, cls };
}
/* angle of the implant from the vertical (degrees) */
export function implantTilt(im) { return Math.round(deg(Math.acos(clamp(Math.abs(im.axis[2]), 0, 1)))); }

/* FDI tooth guess from the place along the arch */
export function guessTooth(arch, s, jaw) {
  if (!arch) return "";
  const f = clamp(s / arch.length, 0, 0.9999);
  const k = Math.floor(f * 16);                                // 16 positions, patient's right → left
  const pos = k < 8 ? 8 - k : k - 7;
  const q = jaw === "upper" ? (k < 8 ? 1 : 2) : (k < 8 ? 4 : 3);
  return String(q * 10 + pos);
}