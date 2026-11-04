/* ═══════════════════════════════════════════════════════════════════════
   IMPLANT LIBRARY — manufacturers, implant lines and their sizes, and the
   true outline of each implant (tapered, parallel or tissue level) used in
   the slices, the 3-D view, the report and the STL.

   Sizes follow the manufacturers' public catalogues; ranges change, so the
   library always also offers "Custom" sizes and every size can be typed in.
   To add a line: add an entry to CATALOG — the planner picks it up.
   ═══════════════════════════════════════════════════════════════════════ */

const T = "tapered", P = "parallel", TL = "tissue";
const L_STD = [8, 10, 11.5, 13, 15];

export const CATALOG = [
  { maker: "Straumann", lines: [
    { name: "BLT (Bone Level Tapered)", shape: T, d: [2.9, 3.3, 4.1, 4.8], l: [8, 10, 12, 14, 16] },
    { name: "BL (Bone Level)", shape: P, d: [3.3, 4.1, 4.8], l: [8, 10, 12, 14] },
    { name: "TL Standard Plus", shape: TL, collar: 1.8, d: [3.3, 4.1, 4.8], l: [6, 8, 10, 12, 14] },
    { name: "BLX", shape: T, d: [3.5, 3.75, 4.0, 4.5, 5.0, 5.5, 6.5], l: [6, 8, 10, 12, 14, 16, 18] },
  ] },
  { maker: "Nobel Biocare", lines: [
    { name: "NobelActive", shape: T, d: [3.0, 3.5, 4.3, 5.0], l: [8.5, 10, 11.5, 13, 15] },
    { name: "NobelParallel CC", shape: P, d: [3.75, 4.3, 5.0, 5.5], l: [7, 8.5, 10, 11.5, 13, 15, 18] },
    { name: "NobelReplace CC", shape: T, d: [3.5, 4.3, 5.0, 6.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "Osstem", lines: [
    { name: "TSIII SA", shape: T, d: [3.5, 4.0, 4.5, 5.0, 6.0, 7.0], l: [7, 8.5, 10, 11.5, 13, 15] },
    { name: "SSIII (tissue level)", shape: TL, collar: 1.8, d: [4.0, 4.5, 5.0], l: [7, 8.5, 10, 11.5, 13] },
  ] },
  { maker: "Dentium", lines: [
    { name: "SuperLine", shape: T, d: [3.6, 4.0, 4.5, 5.0, 6.0, 7.0], l: [7, 8, 10, 12, 14] },
    { name: "Implantium", shape: P, d: [3.4, 3.8, 4.3, 4.8], l: [8, 10, 12, 14] },
  ] },
  { maker: "MegaGen", lines: [
    { name: "AnyRidge", shape: T, d: [3.5, 4.0, 4.5, 5.0, 5.5], l: [7, 8.5, 10, 11.5, 13, 15] },
    { name: "AnyOne", shape: T, d: [3.5, 4.0, 4.5, 5.0, 6.0], l: [7, 8.5, 10, 11.5, 13, 15] },
  ] },
  { maker: "MIS", lines: [
    { name: "C1", shape: T, d: [3.3, 3.75, 4.2, 5.0], l: [8, 10, 11.5, 13, 16] },
    { name: "V3", shape: T, d: [3.3, 3.9, 4.3, 5.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "Neodent", lines: [
    { name: "Grand Morse Helix", shape: T, d: [3.5, 3.75, 4.0, 4.3, 5.0, 6.0], l: [8, 10, 11.5, 13, 16, 18] },
    { name: "Grand Morse Drive", shape: T, d: [3.5, 4.0, 4.3, 5.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "DIO", lines: [
    { name: "UF II", shape: T, d: [3.8, 4.0, 4.5, 5.0, 5.5], l: [7, 8.5, 10, 11.5, 13] },
  ] },
  { maker: "Adin", lines: [
    { name: "Touareg-S", shape: T, d: [3.5, 3.75, 4.2, 5.0, 6.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "Alpha-Bio", lines: [
    { name: "NeO", shape: T, d: [3.2, 3.5, 3.75, 4.2, 5.0], l: [8, 10, 11.5, 13, 16] },
    { name: "SPI", shape: T, d: [3.5, 3.75, 4.2, 5.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "Zimmer Biomet", lines: [
    { name: "Tapered Screw-Vent", shape: T, d: [3.7, 4.1, 4.7, 6.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "Neo Biotech", lines: [
    { name: "IS-III active", shape: T, d: [3.5, 4.0, 4.5, 5.0], l: [7, 8.5, 10, 11.5, 13] },
  ] },
  { maker: "Noris", lines: [
    { name: "Tuff", shape: T, d: [3.3, 3.75, 4.2, 5.0], l: [8, 10, 11.5, 13, 16] },
  ] },
  { maker: "Generic", lines: [
    { name: "Tapered", shape: T, d: [3.0, 3.3, 3.5, 3.75, 4.0, 4.2, 4.5, 5.0, 5.5, 6.0], l: [6, 7, 8, 8.5, 10, 11.5, 12, 13, 14, 15, 16] },
    { name: "Parallel", shape: P, d: [3.0, 3.3, 3.5, 3.75, 4.0, 4.2, 4.5, 5.0, 5.5, 6.0], l: [6, 7, 8, 8.5, 10, 11.5, 12, 13, 14, 15, 16] },
    { name: "Short (wide)", shape: P, d: [4.5, 5.0, 5.5, 6.0, 7.0], l: [4, 5, 6, 7] },
    { name: "Narrow / mini", shape: T, d: [2.4, 2.7, 2.9, 3.0], l: [10, 11.5, 13, 15] },
  ] },
];
export const DEFAULT_PICK = { maker: "Straumann", line: "BLT (Bone Level Tapered)", diameter: 4.1, length: 10 };

export function findLine(maker, line) {
  const m = CATALOG.find((x) => x.maker === maker);
  return m ? m.lines.find((x) => x.name === line) || null : null;
}
export function lineOf(im) { return findLine(im.maker, im.line); }
export function shapeOf(im) { return im.shape || lineOf(im)?.shape || T; }
export function systemName(maker, line) { return maker === "Generic" ? `${line} implant` : `${maker} ${line}`; }
/* older plans saved only "system" (e.g. "Straumann"): keep them working */
export function normaliseImplant(im) {
  if (im.maker) return im;
  const m = CATALOG.find((x) => (im.system || "").toLowerCase().startsWith(x.maker.toLowerCase()));
  return { ...im, maker: m ? m.maker : "Generic", line: m ? m.lines[0].name : "Tapered", shape: m ? m.lines[0].shape : T };
}

/* the outline from the top (t = 0) to the apex (t = 1): radius in mm at each t */
export function radiusAt(im, t) {
  const R = im.diameter / 2, sh = shapeOf(im);
  if (sh === P || sh === TL) {
    if (t < 0.86) return R;
    const k = (t - 0.86) / 0.14;
    return R * (1 - 0.38 * k * k);
  }
  if (t < 0.3) return R;
  const k = (t - 0.3) / 0.7;
  return R * (1 - 0.3 * k - 0.22 * Math.pow(k, 6));
}
/* pieces of the outline as simple cones [t0, t1, r0, r1] (for 3-D and STL) */
export function bodyCones(im) {
  const out = [], n = 6;
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; out.push([a, b, radiusAt(im, a), radiusAt(im, b)]); }
  return out;
}
export function collarOf(im) { return shapeOf(im) === TL ? (lineOf(im)?.collar ?? 1.8) : 0; }
export const SHAPE_LABEL = { tapered: "Tapered", parallel: "Parallel walls", tissue: "Tissue level (polished collar)" };

/* a small drawing of the implant for the library (SVG markup) */
export function implantSVG(im, { w = 90, h = 200 } = {}) {
  const L = im.length, collar = collarOf(im), abut = 0;
  const total = L + collar + abut;
  const k = Math.min((h - 16) / total, (w - 20) / (im.diameter * 1.3));
  const cx = w / 2, y0 = 8 + collar * k;
  const pts = [];
  const N = 60, pitch = im.diameter <= 3.3 ? 0.7 : 0.9, depth = Math.min(0.35, im.diameter * 0.08);
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = radiusAt(im, t), y = y0 + t * L * k;
    const ph = (t * L) / pitch, thr = t > 0.04 && t < 0.97 ? depth * Math.abs(((ph % 1) + 1) % 1 - 0.5) * 2 : 0;
    pts.push([cx + (r - thr) * k, y]);
  }
  const right = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const left = pts.slice().reverse().map(([x, y]) => `${(2 * cx - x).toFixed(1)},${y.toFixed(1)}`).join(" ");
  const R = im.diameter / 2;
  const col = collar ? `<path d="M${cx - R * k},${y0} L${cx - (R + 0.35) * k},${8} L${cx + (R + 0.35) * k},${8} L${cx + R * k},${y0} Z" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <defs><linearGradient id="ti" x1="0" x2="1"><stop offset="0" stop-color="#64748b"/><stop offset=".45" stop-color="#e2e8f0"/><stop offset="1" stop-color="#475569"/></linearGradient></defs>
    ${col}<polygon points="${right} ${left}" fill="url(#ti)" stroke="#334155" stroke-width="1"/>
  </svg>`;
}