/* ═══════════════════════════════════════════════════════════════════════
   DICOM EXPORT — the planner's 3-D scan saved as a standard CT DICOM series
   (one file per axial slice) in a ZIP, readable by OnDemand3D, Blue Sky
   Plan, 3D Slicer, RadiAnt and other DICOM viewers.
   Note: this is the planner's working copy (its resolution and 256 grey
   levels). For the full original, use "Original DICOM (ZIP)".
   ═══════════════════════════════════════════════════════════════════════ */

const enc = new TextEncoder();
function uid() {
  const b = new Uint8Array(16); (globalThis.crypto || window.crypto).getRandomValues(b);
  let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
  return `2.25.${n.toString()}`;
}
function pad(bytes, padByte) { if (bytes.length % 2) { const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = padByte; return o; } return bytes; }
const LONG = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);
function element(group, elem, vr, value) {
  let body;
  if (value instanceof Uint8Array) body = pad(value, 0);
  else if (vr === "US") { body = new Uint8Array(2); new DataView(body.buffer).setUint16(0, value, true); }
  else if (vr === "UL") { body = new Uint8Array(4); new DataView(body.buffer).setUint32(0, value, true); }
  else body = pad(enc.encode(String(value)), vr === "UI" ? 0 : 0x20);
  const head = new Uint8Array(LONG.has(vr) ? 12 : 8), dv = new DataView(head.buffer);
  dv.setUint16(0, group, true); dv.setUint16(2, elem, true); head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
  if (LONG.has(vr)) dv.setUint32(8, body.length, true); else dv.setUint16(6, body.length, true);
  const out = new Uint8Array(head.length + body.length); out.set(head); out.set(body, head.length);
  return out;
}
const cat = (parts) => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const fmt = (x) => { const s = Number(x).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); return s.length > 16 ? Number(x).toPrecision(8) : s; };
const asciiName = (s) => String(s || "").normalize("NFKD").replace(/[^\x20-\x7e]/g, "").slice(0, 60);

function sliceFile({ vol, k, ids, meta }) {
  const { nx, ny, nz, sx, sy, sz } = vol;
  const zmm = vol.zUp ? (k + 0.5) * sz : vol.Z - (k + 0.5) * sz;
  const sop = uid();
  const pixels = new Int16Array(nx * ny), off = k * nx * ny;
  for (let i = 0; i < nx * ny; i++) pixels[i] = Math.round(vol.hu(vol.data[off + i]));
  const metaEls = [
    element(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
    element(0x0002, 0x0002, "UI", "1.2.840.10008.5.1.4.1.1.2"),
    element(0x0002, 0x0003, "UI", sop),
    element(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"),
    element(0x0002, 0x0012, "UI", "2.25.329800735698586629295641978511506172918"),
    element(0x0002, 0x0013, "SH", "CLINIC_PLANNER_1"),
  ];
  const metaBody = cat(metaEls);
  const ds = [
    element(0x0008, 0x0008, "CS", "DERIVED\\SECONDARY\\AXIAL"),
    element(0x0008, 0x0016, "UI", "1.2.840.10008.5.1.4.1.1.2"),
    element(0x0008, 0x0018, "UI", sop),
    element(0x0008, 0x0020, "DA", meta.studyDate || ""),
    element(0x0008, 0x0060, "CS", "CT"),
    element(0x0008, 0x0070, "LO", "Clinic CBCT planner export"),
    element(0x0008, 0x103e, "LO", "CBCT (exported from planner)"),
    element(0x0010, 0x0010, "PN", asciiName(meta.patientName)),
    element(0x0010, 0x0020, "LO", asciiName(meta.patientId)),
    element(0x0018, 0x0050, "DS", fmt(sz)),
    element(0x0020, 0x000d, "UI", ids.study),
    element(0x0020, 0x000e, "UI", ids.series),
    element(0x0020, 0x0011, "IS", "901"),
    element(0x0020, 0x0013, "IS", String(k + 1)),
    element(0x0020, 0x0032, "DS", `${fmt(sx / 2)}\\${fmt(sy / 2)}\\${fmt(zmm)}`),
    element(0x0020, 0x0037, "DS", "1\\0\\0\\0\\1\\0"),
    element(0x0020, 0x0052, "UI", ids.frame),
    element(0x0020, 0x1041, "DS", fmt(zmm)),
    element(0x0028, 0x0002, "US", 1),
    element(0x0028, 0x0004, "CS", "MONOCHROME2"),
    element(0x0028, 0x0010, "US", ny),
    element(0x0028, 0x0011, "US", nx),
    element(0x0028, 0x0030, "DS", `${fmt(sy)}\\${fmt(sx)}`),
    element(0x0028, 0x0100, "US", 16),
    element(0x0028, 0x0101, "US", 16),
    element(0x0028, 0x0102, "US", 15),
    element(0x0028, 0x0103, "US", 1),
    element(0x0028, 0x1050, "DS", "1000"),
    element(0x0028, 0x1051, "DS", "4000"),
    element(0x0028, 0x1052, "DS", "0"),
    element(0x0028, 0x1053, "DS", "1"),
    element(0x7fe0, 0x0010, "OW", new Uint8Array(pixels.buffer)),
  ];
  return cat([new Uint8Array(128), enc.encode("DICM"), element(0x0002, 0x0000, "UL", metaBody.length), metaBody, ...ds]);
}

/* a ZIP without compression (DICOM pixels hardly compress anyway) */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of files) {
    const nm = enc.encode(name), crc = crc32(data);
    const h = new Uint8Array(30 + nm.length), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nm.length, true); h.set(nm, 30);
    const c = new Uint8Array(46 + nm.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nm.length, true); cv.setUint32(42, offset, true); c.set(nm, 46);
    parts.push(h, data); central.push(c); offset += h.length + data.length;
  }
  const cen = cat(central), e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cen.length, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, cen, e], { type: "application/zip" });
}

export async function exportDicomZip(vol, meta = {}, onProgress) {
  const ids = { study: uid(), series: uid(), frame: uid() };
  const files = [];
  for (let k = 0; k < vol.nz; k++) {
    files.push({ name: `DICOM/IM${String(k + 1).padStart(5, "0")}.dcm`, data: sliceFile({ vol, k, ids, meta }) });
    if (k % 16 === 0) { onProgress?.(k / vol.nz); await new Promise((r) => setTimeout(r, 0)); }
  }
  return zip(files);
}