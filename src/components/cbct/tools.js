/* ═══════════════════════════════════════════════════════════════════════
   CEPH · AIRWAY · STL — the extra modules of the planner
   ═══════════════════════════════════════════════════════════════════════ */
import { implantApex, norm, cross, add, mul, sub } from "./geometry";
import { radiusAt } from "./implantLibrary";

/* ── CEPH: a radiograph made from the scan (sum through the head) ────────
   lateral: looking from the side (sum over x) · pa: from the front (sum over y) */
export function cephProjection(vol, kind = "lat") {
  const { nx, ny, nz, data, nxy } = vol;
  const W = kind === "lat" ? ny : nx, H = nz;
  const out = new Float32Array(W * H);
  if (kind === "lat") {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      let s = 0; const o = z * nxy + y * nx;
      for (let x = 0; x < nx; x++) s += data[o + x];
      out[z * W + y] = s / nx;
    }
  } else {
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let s = 0; const o = z * nxy + x;
      for (let y = 0; y < ny; y++) s += data[o + y * nx];
      out[z * W + x] = s / ny;
    }
  }
  // contrast range from the image itself
  const sorted = Float32Array.from(out).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.998)];
  return { kind, W, H, data: out, lo, hi, mmW: kind === "lat" ? vol.Y : vol.X, mmH: vol.Z, zUp: vol.zUp };
}
/* the projection as a picture: lateral faces right (front of the face on the right), head up */
export function cephImage(proj, { contrast = 1, bright = 0, invert = false } = {}) {
  const { W, H, data, lo, hi, kind, zUp } = proj;
  const img = new ImageData(W, H);
  const span = (hi - lo) / contrast, base = lo - bright * (hi - lo) * 0.5;
  for (let r = 0; r < H; r++) {
    const z = zUp ? H - 1 - r : r;
    for (let c = 0; c < W; c++) {
      const src = kind === "lat" ? W - 1 - c : c;           // lateral: front (small y) on the right
      let g = ((data[z * W + src] - base) / span);
      g = Math.max(0, Math.min(1, g)); g = Math.pow(g, 0.85) * 255;
      if (invert) g = 255 - g;
      const p = (r * W + c) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = g; img.data[p + 3] = 255;
    }
  }
  return img;
}

export const CEPH_POINTS = [
  ["S", "Sella — centre of the sella turcica"], ["N", "Nasion — front of the fronto-nasal suture"],
  ["Or", "Orbitale — lowest point of the orbit"], ["Po", "Porion — top of the ear canal"],
  ["ANS", "Anterior nasal spine"], ["PNS", "Posterior nasal spine"],
  ["A", "Point A — deepest point of the upper jaw front"], ["B", "Point B — deepest point of the lower jaw front"],
  ["Pog", "Pogonion — most forward point of the chin"], ["Gn", "Gnathion"], ["Me", "Menton — lowest point of the chin"],
  ["Go", "Gonion — angle of the jaw"],
  ["U1", "Upper incisor tip"], ["U1a", "Upper incisor root apex"], ["L1", "Lower incisor tip"], ["L1a", "Lower incisor root apex"],
];
const ang3 = (a, v, b) => {
  const u = [a[0] - v[0], a[1] - v[1]], w = [b[0] - v[0], b[1] - v[1]];
  const c = (u[0] * w[0] + u[1] * w[1]) / ((Math.hypot(...u) * Math.hypot(...w)) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const angV = (u, w) => ang3([u[0], u[1]], [0, 0], [w[0], w[1]]);
const vec = (a, b) => [b[0] - a[0], b[1] - a[1]];
const acute = (d) => (d > 90 ? 180 - d : d);
/* Steiner and common measurements (angles in degrees) */
export function cephAnalysis(P) {
  const has = (...k) => k.every((x) => P[x]);
  const rows = [];
  const add2 = (name, val, norm_, sd, note) => rows.push({ name, value: val == null ? null : Math.round(val * 10) / 10, norm: norm_, sd, note,
    flag: val == null ? "" : val > norm_ + sd ? "high" : val < norm_ - sd ? "low" : "ok" });
  const SNA = has("S", "N", "A") ? ang3(P.S, P.N, P.A) : null;
  const SNB = has("S", "N", "B") ? ang3(P.S, P.N, P.B) : null;
  add2("SNA", SNA, 82, 3.5, "Upper jaw to the skull base");
  add2("SNB", SNB, 80, 3.5, "Lower jaw to the skull base");
  add2("ANB", SNA != null && SNB != null ? SNA - SNB : null, 2, 2.5, "Jaw relationship (>4 Class II, <0 Class III)");
  add2("SN–MP", has("S", "N", "Go", "Me") ? acute(angV(vec(P.S, P.N), vec(P.Go, P.Me))) : null, 32, 5, "Mandibular plane to SN");
  add2("FMA", has("Po", "Or", "Go", "Me") ? acute(angV(vec(P.Po, P.Or), vec(P.Go, P.Me))) : null, 25, 5, "Frankfort–mandibular plane angle");
  add2("U1–SN", has("U1", "U1a", "S", "N") ? angV(vec(P.U1a, P.U1), vec(P.N, P.S)) : null, 103, 6, "Upper incisor inclination");
  add2("IMPA", has("L1", "L1a", "Go", "Me") ? angV(vec(P.L1a, P.L1), vec(P.Me, P.Go)) : null, 90, 6, "Lower incisor to mandibular plane");
  add2("Interincisal", has("U1", "U1a", "L1", "L1a") ? angV(vec(P.U1, P.U1a), vec(P.L1, P.L1a)) : null, 130, 6, "Upper to lower incisor");
  return rows;
}

/* ── AIRWAY: the connected air space from a tapped point, between two levels ── */
export function computeAirway(vol, seed, { thrHu = -400, zLo, zHi, halfX = 22, halfY = 32, maxVox = 4e6 } = {}) {
  const { nx, ny, nz, nxy, data, sx, sy, sz } = vol;
  const thr = vol.valueOfHu(thrHu);
  const ix0 = Math.round(seed[0] / sx - 0.5), iy0 = Math.round(seed[1] / sy - 0.5), iz0 = Math.round(seed[2] / sz - 0.5);
  const xa = Math.max(0, Math.floor((seed[0] - halfX) / sx)), xb = Math.min(nx - 1, Math.ceil((seed[0] + halfX) / sx));
  const ya = Math.max(0, Math.floor((seed[1] - halfY) / sy)), yb = Math.min(ny - 1, Math.ceil((seed[1] + halfY) / sy));
  const za = Math.max(0, Math.floor(Math.min(zLo, zHi) / sz)), zb = Math.min(nz - 1, Math.ceil(Math.max(zLo, zHi) / sz));
  const mask = new Uint8Array(nx * ny * nz);
  if (ix0 < xa || ix0 > xb || iy0 < ya || iy0 > yb || iz0 < za || iz0 > zb) return { error: "The tapped point is outside the levels." };
  const start = iz0 * nxy + iy0 * nx + ix0;
  if (data[start] >= thr) return { error: "The tapped point is not air. Tap inside the dark airway." };
  const stack = [start]; mask[start] = 1; let count = 1;
  const perZ = new Uint32Array(nz);
  perZ[iz0] = 1;
  while (stack.length) {
    const i = stack.pop();
    const z = (i / nxy) | 0, r = i - z * nxy, y = (r / nx) | 0, x = r - y * nx;
    const nb = [x > xa ? i - 1 : -1, x < xb ? i + 1 : -1, y > ya ? i - nx : -1, y < yb ? i + nx : -1, z > za ? i - nxy : -1, z < zb ? i + nxy : -1];
    for (const j of nb) {
      if (j < 0 || mask[j] || data[j] >= thr) continue;
      mask[j] = 1; count++; perZ[(j / nxy) | 0]++;
      stack.push(j);
      if (count > maxVox) return { error: "The air space leaks out of the airway — set the levels closer, or lower the threshold." };
    }
  }
  const vox = sx * sy * sz;
  const areas = [];
  let min = null;
  for (let z = za; z <= zb; z++) {
    const a = perZ[z] * sx * sy;
    areas.push({ z: (z + 0.5) * sz, mm2: a });
    if (a > 0 && (!min || a < min.mm2)) min = { z: (z + 0.5) * sz, mm2: a };
  }
  // colour each level by its area (2 = narrowest … 255 = widest) for the colour map
  const maxA = Math.max(...areas.map((x) => x.mm2), 1), minA = min ? min.mm2 : 0;
  const lvl = new Uint8Array(nz);
  for (let z = za; z <= zb; z++) { const a = perZ[z] * sx * sy; lvl[z] = 2 + Math.round(253 * Math.max(0, Math.min(1, (a - minA) / Math.max(1, maxA - minA)))); }
  for (let i = 0; i < mask.length; i++) if (mask[i]) mask[i] = lvl[(i / nxy) | 0];
  return { mask, count, cc: (count * vox) / 1000, areas, min, max: maxA, thrHu, zLo, zHi };
}

/* ── STL of the planned implants (scan millimetres) — for a guide lab ── */
export function implantsSTL(implants, name = "implant-plan") {
  const lines = [`solid ${name}`];
  const tri = (a, b, c) => {
    const n = norm(cross(sub(b, a), sub(c, a)));
    lines.push(`facet normal ${n.map((v) => v.toFixed(5)).join(" ")}`, " outer loop",
      ...[a, b, c].map((p) => `  vertex ${p.map((v) => v.toFixed(4)).join(" ")}`), " endloop", "endfacet");
  };
  for (const im of implants) {
    const A = im.top, B = implantApex(im), ax = im.axis, r = im.diameter / 2, seg = 32;
    const ref = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(cross(ax, ref)), e2 = cross(ax, e1);
    const ring = (C, rr) => Array.from({ length: seg }, (_, k) => { const t = (k / seg) * Math.PI * 2; return add(C, add(mul(e1, Math.cos(t) * rr), mul(e2, Math.sin(t) * rr))); });
    // the real outline of the implant line (tapered / parallel), 12 rings from top to apex
    const rings = Array.from({ length: 13 }, (_, i) => ring(add(A, mul(ax, im.length * (i / 12))), radiusAt(im, i / 12)));
    for (let j = 0; j < 12; j++) for (let k = 0; k < seg; k++) {
      const k2 = (k + 1) % seg, a = rings[j], b = rings[j + 1];
      tri(a[k], b[k], b[k2]); tri(a[k], b[k2], a[k2]);
    }
    for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; tri(A, rings[0][k2], rings[0][k]); tri(B, rings[12][k], rings[12][k2]); }
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n");
}

/* ── 3D CEPH: landmarks placed in the scan itself (both sides), measured in 3-D ── */
export const CEPH3D_POINTS = [
  ["S", "Sella — centre of the sella turcica"], ["N", "Nasion — front of the fronto-nasal suture"],
  ["Or-R", "Orbitale right — lowest point of the right orbit"], ["Or-L", "Orbitale left"],
  ["Po-R", "Porion right — top of the right ear canal"], ["Po-L", "Porion left"],
  ["ANS", "Anterior nasal spine"], ["PNS", "Posterior nasal spine"],
  ["A", "Point A"], ["B", "Point B"], ["Pog", "Pogonion — most forward point of the chin"], ["Me", "Menton — lowest point of the chin"],
  ["Co-R", "Condylion right — top of the right condyle"], ["Co-L", "Condylion left"],
  ["Go-R", "Gonion right — angle of the jaw"], ["Go-L", "Gonion left"],
  ["U1", "Upper incisor tip (midline)"], ["L1", "Lower incisor tip (midline)"],
  ["U6-R", "Upper right first molar — mesiobuccal cusp"], ["U6-L", "Upper left first molar — mesiobuccal cusp"],
];
export const CEPH3D_LINES = [["S", "N", "#38bdf8"], ["N", "A", "#a78bfa"], ["N", "B", "#a78bfa"], ["Po-R", "Or-R", "#34d399"], ["Po-L", "Or-L", "#34d399"],
  ["Co-R", "Go-R", "#fbbf24"], ["Co-L", "Go-L", "#fbbf24"], ["Go-R", "Me", "#fbbf24"], ["Go-L", "Me", "#fbbf24"], ["ANS", "PNS", "#94a3b8"]];
const v3 = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
const d3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const x3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const l3 = (a) => Math.hypot(a[0], a[1], a[2]);
const n3 = (a) => { const l = l3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ang = (u, w) => (Math.acos(Math.max(-1, Math.min(1, d3(n3(u), n3(w))))) * 180) / Math.PI;
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export function ceph3dAnalysis(P) {
  const has = (...k) => k.every((x) => P[x]);
  const rows = [];
  const row = (group, name, val, unit, norm, sd, note, flagFn) => rows.push({ group, name, unit, norm, sd, note,
    value: val == null ? null : Math.round(val * 10) / 10,
    flag: val == null ? "" : flagFn ? flagFn(val) : norm == null ? "" : val > norm + sd ? "high" : val < norm - sd ? "low" : "ok" });
  const SNA = has("S", "N", "A") ? ang(v3(P.N, P.S), v3(P.N, P.A)) : null;
  const SNB = has("S", "N", "B") ? ang(v3(P.N, P.S), v3(P.N, P.B)) : null;
  row("Skeletal", "SNA", SNA, "°", 82, 3.5, "Upper jaw to the skull base");
  row("Skeletal", "SNB", SNB, "°", 80, 3.5, "Lower jaw to the skull base");
  row("Skeletal", "ANB", SNA != null && SNB != null ? SNA - SNB : null, "°", 2, 2.5, ">4 Class II, <0 Class III");
  // planes: Frankfort (porions + orbitales), mandibular (gonions + menton)
  const fhN = has("Po-R", "Po-L", "Or-R", "Or-L") ? n3(x3(v3(P["Po-R"], P["Po-L"]), v3(mid(P["Po-R"], P["Po-L"]), mid(P["Or-R"], P["Or-L"])))) : null;
  const mpN = has("Go-R", "Go-L", "Me") ? n3(x3(v3(P["Go-R"], P["Go-L"]), v3(mid(P["Go-R"], P["Go-L"]), P.Me))) : null;
  const planeAng = (a, b) => { const t = ang(a, b); return t > 90 ? 180 - t : t; };
  row("Skeletal", "FMA (FH–mandibular plane)", fhN && mpN ? planeAng(fhN, mpN) : null, "°", 25, 5, "Vertical pattern");
  row("Skeletal", "SN–mandibular plane", mpN && has("S", "N") ? 90 - planeAng(v3(P.S, P.N), mpN) : null, "°", 32, 5, "High = long face");
  row("Vertical", "N–Me (front face height)", has("N", "Me") ? l3(v3(P.N, P.Me)) : null, "mm", null, null, "");
  row("Vertical", "ANS–Me (lower face height)", has("ANS", "Me") ? l3(v3(P.ANS, P.Me)) : null, "mm", null, null, "");
  row("Vertical", "Lower / total face height", has("N", "Me", "ANS") ? (100 * l3(v3(P.ANS, P.Me))) / l3(v3(P.N, P.Me)) : null, "%", 55, 2, "");
  // symmetry: mid-sagittal plane through S and N, upright to Frankfort
  const msN = fhN && has("S", "N") ? n3(x3(v3(P.S, P.N), fhN)) : null;
  const side = (p) => (msN ? d3(v3(P.S, p), msN) : null);
  const asym = (lim) => (v) => (Math.abs(v) > lim ? "high" : "ok");
  row("Symmetry", "Chin (Me) off the midline", msN && P.Me ? side(P.Me) : null, "mm", 0, 2, "+ / − = towards one side", asym(2));
  row("Symmetry", "Upper midline (U1) off the midline", msN && P.U1 ? side(P.U1) : null, "mm", 0, 1.5, "", asym(1.5));
  row("Symmetry", "Lower midline (L1) off the midline", msN && P.L1 ? side(P.L1) : null, "mm", 0, 1.5, "", asym(1.5));
  const rh = (s) => (has(`Co-${s}`, `Go-${s}`) ? l3(v3(P[`Co-${s}`], P[`Go-${s}`])) : null);
  const bl = (s) => (has(`Go-${s}`, "Me") ? l3(v3(P[`Go-${s}`], P.Me)) : null);
  row("Symmetry", "Ramus height right (Co–Go)", rh("R"), "mm", null, null, "");
  row("Symmetry", "Ramus height left (Co–Go)", rh("L"), "mm", null, null, "");
  row("Symmetry", "Ramus height difference", rh("R") != null && rh("L") != null ? rh("R") - rh("L") : null, "mm", 0, 3, "", asym(3));
  row("Symmetry", "Mandible body right (Go–Me)", bl("R"), "mm", null, null, "");
  row("Symmetry", "Mandible body left (Go–Me)", bl("L"), "mm", null, null, "");
  row("Symmetry", "Body length difference", bl("R") != null && bl("L") != null ? bl("R") - bl("L") : null, "mm", 0, 3, "", asym(3));
  const cant = fhN && has("U6-R", "U6-L") ? d3(v3(P["U6-L"], P["U6-R"]), fhN) : null;
  row("Symmetry", "Occlusal cant (molar height R − L)", cant, "mm", 0, 2, "Tilt of the bite", asym(2));
  return rows;
}