/* ═══════════════════════════════════════════════════════════════════════
   CBCT VOLUME — the whole scan as one 3-D block in the browser
   so every view (axial, coronal, sagittal, panoramic, cross-sections, 3-D)
   is made on the spot from the same data.

   Where it comes from (tried in this order):
     1. GET /cbct/<id>/volume  — made by the server from the DICOM files,
        with real density values (new uploads, or after "Rebuild").
     2. The axial slice pictures every scan already has (older scans) —
        decoded in the browser. Works for every scan, no server change.

   Each voxel is one byte. value → HU:  hu = value * huScale + huOffset
   Coordinates are in millimetres:  x → columns (patient right → left),
   y → rows (front → back), z → slice number.
   ═══════════════════════════════════════════════════════════════════════ */

export class Volume {
  constructor({ nx, ny, nz, sx, sy, sz, data, huScale = 16, huOffset = -1000, zUp = true, source = "server", meta = {} }) {
    Object.assign(this, { nx, ny, nz, sx, sy, sz, data, huScale, huOffset, zUp, source, meta });
    this.X = nx * sx; this.Y = ny * sy; this.Z = nz * sz;          // size in mm
    this.nxy = nx * ny;
  }
  hu(v) { return v * this.huScale + this.huOffset; }
  valueOfHu(h) { return (h - this.huOffset) / this.huScale; }
  /* value at a point in mm (trilinear); -1 outside the scan */
  sample(x, y, z) {
    const fx = x / this.sx - 0.5, fy = y / this.sy - 0.5, fz = z / this.sz - 0.5;
    return this.sampleVox(fx, fy, fz);
  }
  sampleVox(fx, fy, fz) {
    const { nx, ny, nz, data, nxy } = this;
    if (fx < -0.5 || fy < -0.5 || fz < -0.5 || fx > nx - 0.5 || fy > ny - 0.5 || fz > nz - 0.5) return -1;
    let x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    let tx = fx - x0, ty = fy - y0, tz = fz - z0;
    if (x0 < 0) { x0 = 0; tx = 0; } if (y0 < 0) { y0 = 0; ty = 0; } if (z0 < 0) { z0 = 0; tz = 0; }
    const x1 = x0 + 1 < nx ? x0 + 1 : x0, y1 = y0 + 1 < ny ? y0 + 1 : y0, z1 = z0 + 1 < nz ? z0 + 1 : z0;
    const a = z0 * nxy, b = z1 * nxy, r0 = y0 * nx, r1 = y1 * nx;
    const c000 = data[a + r0 + x0], c100 = data[a + r0 + x1], c010 = data[a + r1 + x0], c110 = data[a + r1 + x1];
    const c001 = data[b + r0 + x0], c101 = data[b + r0 + x1], c011 = data[b + r1 + x0], c111 = data[b + r1 + x1];
    const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }
  sampleNearest(fx, fy, fz) {
    const x = Math.round(fx), y = Math.round(fy), z = Math.round(fz);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return -1;
    return this.data[z * this.nxy + y * this.nx + x];
  }
  huAt(p) { const v = this.sample(p[0], p[1], p[2]); return v < 0 ? null : Math.round(this.hu(v)); }
  /* the top of the head (superior) as a z value */
  get zTop() { return this.zUp ? this.Z : 0; }
  get zSign() { return this.zUp ? 1 : -1; }      // +1: higher z is superior
}

function authHeaders(extra = {}) {
  let t = "";
  try { t = localStorage.getItem("token") || sessionStorage.getItem("token") || ""; } catch { /* private window */ }
  return t ? { Authorization: `Bearer ${t}`, ...extra } : extra;
}

/* How big the volume may be on this device (bytes) */
export function budgetForDevice() {
  const mem = (typeof navigator !== "undefined" && navigator.deviceMemory) || 4;
  const small = typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 700;
  if (small || mem <= 2) return { maxDim: 256, label: "phone" };
  if (mem <= 4) return { maxDim: 320, label: "tablet" };
  return { maxDim: 400, label: "desktop" };
}

/* 1. server volume: "CBV1" + uint32 header length + JSON header + bytes */
async function fromServer(apiBase, id, maxDim, onProgress) {
  const res = await fetch(`${apiBase}/cbct/${id}/volume?max=${maxDim}`, { headers: authHeaders() });
  if (!res.ok) throw Object.assign(new Error(`volume ${res.status}`), { status: res.status });
  const total = Number(res.headers.get("content-length")) || 0;
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress?.(total ? Math.min(0.95, got / total) : Math.min(0.9, got / 3e7), `Downloading the scan… ${(got / 1048576).toFixed(1)} MB`);
    }
    buf = new Uint8Array(got); let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
  } else buf = new Uint8Array(await res.arrayBuffer());
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== "CBV1") throw new Error("not a volume");
  const hlen = buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hlen)));
  const data = buf.subarray(8 + hlen, 8 + hlen + head.nx * head.ny * head.nz);
  return new Volume({ ...head, data, source: "server" });
}

/* 2. from the axial slice pictures (any scan) */
async function fromSlices(apiBase, id, meta, maxDim, onProgress) {
  onProgress?.(0.05, "Downloading the slices…");
  const viaServer = () => fetch(`${apiBase}/cbct/${id}/slices`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`slices ${r.status}`))));
  let data = await fetch(`${apiBase}/cbct/${id}/link`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((link) => (link && link.url
      ? fetch(link.url).then((r) => (r.ok ? r.json() : Promise.reject(new Error("cloud")))).then((slices) => ({ slices })).catch(viaServer)
      : viaServer()));
  const axial = data?.slices?.axial || [];
  data = null;
  if (!axial.length) throw new Error("This scan has no slices.");
  // size of one picture
  const first = await decode(axial[0]);
  const W0 = first.width, H0 = first.height, N0 = axial.length;
  const f = Math.max(1, Math.ceil(Math.max(W0, H0, N0) / maxDim));
  const nx = Math.max(1, Math.floor(W0 / f)), ny = Math.max(1, Math.floor(H0 / f)), nz = Math.max(1, Math.floor(N0 / f));
  const out = new Uint8Array(nx * ny * nz);
  const acc = new Float32Array(nx * ny);
  const cv = document.createElement("canvas"); cv.width = nx; cv.height = ny;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  for (let k = 0; k < nz; k++) {
    acc.fill(0);
    for (let j = 0; j < f; j++) {
      const idx = k * f + j;
      const img = idx === 0 ? first : await decode(axial[idx]);
      ctx.drawImage(img, 0, 0, nx, ny);                   // the browser averages the pixels while shrinking
      const px = ctx.getImageData(0, 0, nx, ny).data;
      for (let i = 0, p = 0; i < acc.length; i++, p += 4) acc[i] += px[p];
      if (img.close) img.close();
    }
    const o = k * nx * ny;
    for (let i = 0; i < acc.length; i++) out[o + i] = acc[i] / f;
    if (k % 4 === 0) onProgress?.(0.2 + 0.75 * (k / nz), `Building the 3-D scan… ${Math.round((k / nz) * 100)}%`);
  }
  // slice pictures were made with window 2500 / level 500 → HU −750 … 1750
  const spx = (meta?.voxel_spacing?.x || 0.3), spy = (meta?.voxel_spacing?.y || spx), spz = (meta?.voxel_spacing?.z || spx);
  return new Volume({
    nx, ny, nz, sx: spx * (W0 / nx), sy: spy * (H0 / ny), sz: spz * (N0 / nz),
    data: out, huScale: 2500 / 255, huOffset: -750, zUp: false, source: "slices", meta,
  });
}

function decode(b64) {
  const src = b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
  if (typeof createImageBitmap === "function") {
    return fetch(src).then((r) => r.blob()).then((b) => createImageBitmap(b)).catch(() => decodeImg(src));
  }
  return decodeImg(src);
}
function decodeImg(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

export async function loadVolume(apiBase, id, meta, onProgress, { maxDim } = {}) {
  const dim = maxDim || budgetForDevice().maxDim;
  try {
    onProgress?.(0.02, "Opening the scan…");
    return await fromServer(apiBase, id, dim, onProgress);
  } catch (e) {
    if (e && e.status === 401) throw new Error("Please sign in again.");
    return fromSlices(apiBase, id, meta, dim, onProgress);
  }
}

export { authHeaders };