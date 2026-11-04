/* ═══════════════════════════════════════════════════════════════════════
   3-D VIEW — the scan rendered on the graphics card (WebGL 2), so it turns
   smoothly on phones, tablets and computers.
   Modes: "bone" (ivory bone and teeth surface, lit like a photo), "skin"
   (skin over the bone), "color" (volume rendering), "xray" (a radiograph
   made through the head), "mip" (brightest point), "soft" (see-through).
   The scan is lightly smoothed for 3-D only, so grain does not show as dots.
   Implants and the nerve are drawn on top in their true positions.
   ═══════════════════════════════════════════════════════════════════════ */

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler3D vol;
uniform mat4 invVP;
uniform vec3 boxSize;      // physical size, largest side = 1
uniform int mode;          // 0 bone surface, 1 MIP, 2 see-through, 3 colour VR, 4 skin + bone, 5 X-ray (ray sum)
uniform float softLo;      // soft tissue / skin level (0..1)
uniform float thr;         // bone level (0..1)
uniform float toothLo;     // enamel / dentine level (0..1)
uniform float airV;        // air level (0..1)
uniform float steps;
uniform vec3 clipLo; uniform vec3 clipHi;
uniform vec3 texel;
uniform float flipZ;
uniform vec3 camR; uniform vec3 camU;

float val(vec3 t){ return texture(vol, t).r; }
vec3 tcOf(vec3 p){ vec3 t = p / boxSize + 0.5; if (flipZ > 0.5) t.z = 1.0 - t.z; return t; }
vec3 gradAt(vec3 t){
  vec3 h = texel * 1.25;
  vec3 g = vec3(val(t + vec3(h.x,0,0)) - val(t - vec3(h.x,0,0)),
                val(t + vec3(0,h.y,0)) - val(t - vec3(0,h.y,0)),
                val(t + vec3(0,0,h.z)) - val(t - vec3(0,0,h.z)));
  if (flipZ > 0.5) g.z = -g.z;
  return g / (h * boxSize);              // per box unit (correct for unequal voxel sizes)
}
vec3 bgCol(){ return mix(vec3(0.010, 0.014, 0.024), vec3(0.105, 0.128, 0.170), uv.y); }
/* two lights that follow the camera (key from upper right, soft fill from lower left) + specular */
vec3 shade(vec3 n, vec3 rd, vec3 base, float specK, float shin){
  if (dot(n, rd) > 0.0) n = -n;
  vec3 L1 = normalize(-rd + 0.55 * camU + 0.40 * camR);
  vec3 L2 = normalize(-rd - 0.35 * camU - 0.55 * camR);
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  float sp = pow(max(dot(n, normalize(L1 - rd)), 0.0), shin) * specK;
  return base * (0.16 + 0.74 * d1 + 0.20 * d2) + vec3(sp) + base * rim * 0.06;
}
vec3 boneCol(float inside){
  float tooth = smoothstep(toothLo - 0.04, toothLo + 0.10, inside);
  return mix(vec3(0.93, 0.86, 0.73), vec3(0.98, 0.965, 0.92), tooth);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec4 nearP = invVP * vec4(uv * 2.0 - 1.0, -1.0, 1.0); nearP /= nearP.w;
  vec4 farP  = invVP * vec4(uv * 2.0 - 1.0,  1.0, 1.0); farP /= farP.w;
  vec3 ro = nearP.xyz, rd = normalize(farP.xyz - nearP.xyz);
  bool dark = (mode == 1 || mode == 5);
  vec3 bg = dark ? vec3(0.0) : bgCol();
  vec3 lo = -boxSize * 0.5 + clipLo * boxSize, hi = -boxSize * 0.5 + clipHi * boxSize;
  vec3 inv = 1.0 / rd;
  vec3 t0 = (lo - ro) * inv, t1 = (hi - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z), tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tf <= max(tn, 0.0)) { color = vec4(bg, 1.0); return; }
  tn = max(tn, 0.0);
  float dt = length(boxSize) / steps;
  float diag = length(boxSize);
  float t = tn + dt * hash(gl_FragCoord.xy);           // jitter: no wood-grain rings
  vec3 acc = vec3(0.0); float a = 0.0, mx = 0.0, sum = 0.0;
  float prevV = val(tcOf(ro + rd * tn)), prevT = tn;
  bool skinDone = false;
  bool startInside = prevV > thr;                       // ray starts in bone at a cut face
  for (int i = 0; i < 2400; i++) {
    if (t > tf) break;
    vec3 tc = tcOf(ro + rd * t);
    float v = val(tc);
    if (mode == 1) { mx = max(mx, v); }
    else if (mode == 5) { sum += max(v - airV, 0.0) * dt; }
    else if (mode == 0 || mode == 4) {
      if (mode == 4 && !skinDone && v > softLo && prevV <= softLo) {
        float a0 = prevT, b0 = t;
        for (int k = 0; k < 5; k++) { float m = 0.5 * (a0 + b0); if (val(tcOf(ro + rd * m)) > softLo) b0 = m; else a0 = m; }
        vec3 n = normalize(-gradAt(tcOf(ro + rd * b0)) + 1e-6);
        vec3 sc = shade(n, rd, vec3(0.86, 0.64, 0.54), 0.10, 18.0);
        float op = 0.42;
        acc += (1.0 - a) * op * sc; a += (1.0 - a) * op; skinDone = true;
      }
      if (v > thr) {
        vec3 c;
        if (startInside && i == 0) {
          c = boneCol(v) * 0.62;                         // flat cut face
        } else {
          float a0 = prevT, b0 = t;
          for (int k = 0; k < 6; k++) { float m = 0.5 * (a0 + b0); if (val(tcOf(ro + rd * m)) > thr) b0 = m; else a0 = m; }
          vec3 p = ro + rd * b0;
          vec3 n = normalize(-gradAt(tcOf(p)) + 1e-6);
          float inside = val(tcOf(p + rd * 1.6 * texel.x * boxSize.x));
          float tooth = smoothstep(toothLo - 0.04, toothLo + 0.10, inside);
          c = shade(n, rd, boneCol(inside), 0.18 + 0.30 * tooth, 28.0 + 30.0 * tooth);
          c *= mix(1.0, 0.72, clamp((b0 - tn) / diag, 0.0, 1.0));   // depth cue
        }
        acc += (1.0 - a) * c; a = 1.0; break;
      }
    } else {
      float o; vec3 base;
      if (mode == 3) {
        float soft = smoothstep(softLo, softLo + 0.04, v) * (1.0 - smoothstep(thr - 0.03, thr, v));
        float bone = smoothstep(thr - 0.02, thr + 0.07, v);
        o = soft * 0.010 + bone * 0.55;
        base = bone > 0.05 ? boneCol(v) : vec3(0.80, 0.42, 0.34);
      } else {
        o = clamp((v - thr) * 3.0, 0.0, 1.0) * 0.10;
        base = boneCol(v);
      }
      if (o > 0.001) {
        o = 1.0 - pow(1.0 - o, dt * 900.0 / diag);       // same look at any quality
        vec3 g = gradAt(tc);
        float gm = clamp(length(g) * 0.35, 0.0, 1.0);
        vec3 lit = shade(normalize(-g + 1e-6), rd, base, 0.15, 24.0);
        vec3 c = mix(base * 0.42, lit, gm);
        acc += (1.0 - a) * o * c; a += (1.0 - a) * o;
        if (a > 0.985) break;
      }
    }
    prevV = v; prevT = t; t += dt;
  }
  if (mode == 1) { float g = clamp((mx - thr) / max(1.0 - thr, 0.01), 0.0, 1.0); color = vec4(vec3(pow(g, 1.15)), 1.0); return; }
  if (mode == 5) { float g = 1.0 - exp(-sum * 9.0 / diag); color = vec4(vec3(pow(g, 1.25)), 1.0); return; }
  color = vec4(acc + (1.0 - a) * bg, 1.0);
}`;

/* small matrix helpers (column-major, like WebGL) */
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function mat4Inv(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, target, up) {
  const z = norm3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = norm3(cross3(up, z)), y = cross3(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1]);
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/* light [1 2 1] smoothing along x, y and z — for the 3-D view only (the slices stay sharp) */
function smooth3(vol) {
  const { nx, ny, nz, data } = vol, nxy = nx * ny;
  const a = new Uint8Array(data.length), b = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const x = i % nx;
    const l = x > 0 ? data[i - 1] : data[i], r = x < nx - 1 ? data[i + 1] : data[i];
    a[i] = (l + 2 * data[i] + r + 2) >> 2;
  }
  for (let i = 0; i < data.length; i++) {
    const y = ((i % nxy) / nx) | 0;
    const u = y > 0 ? a[i - nx] : a[i], d = y < ny - 1 ? a[i + nx] : a[i];
    b[i] = (u + 2 * a[i] + d + 2) >> 2;
  }
  for (let i = 0; i < data.length; i++) {
    const z = (i / nxy) | 0;
    const u = z > 0 ? b[i - nxy] : b[i], d = z < nz - 1 ? b[i + nxy] : b[i];
    a[i] = (u + 2 * b[i] + d + 2) >> 2;
  }
  return a;
}

export function webgl2Supported() {
  try { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2")); } catch { return false; }
}

export class Renderer3D {
  constructor(canvas, vol) {
    this.canvas = canvas; this.vol = vol;
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, vol.nx, vol.ny, vol.nz, 0, gl.RED, gl.UNSIGNED_BYTE, smooth3(vol));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    const m = Math.max(vol.X, vol.Y, vol.Z);
    this.box = [vol.X / m, vol.Y / m, vol.Z / m];
    this.mm = m;
    this.u = Object.fromEntries(["vol", "invVP", "boxSize", "mode", "thr", "steps", "clipLo", "clipHi", "texel", "flipZ", "softLo", "toothLo", "airV", "camR", "camU"].map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.yaw = 0; this.pitch = 0.12; this.zoom = 1.35;
  }
  /* box coordinates: x → right, y → front-to-back, z → head (flipped when the scan's z goes down) */
  toBox(p) {
    const v = this.vol, m = this.mm;
    const z = v.zUp ? p[2] : v.Z - p[2];          // box z always points to the head
    return [p[0] / m - this.box[0] / 2, p[1] / m - this.box[1] / 2, z / m - this.box[2] / 2];
  }
  matrices(W, H) {
    const r = 2.2 / this.zoom;
    // patient's head up on screen: up vector follows the scan's superior direction
    const sup = 1;
    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    // camera starts in front of the face (−y), looking back (+y)
    const eye = [r * Math.sin(this.yaw) * cy, -r * Math.cos(this.yaw) * cy, sup * r * sy];
    const view = lookAt(eye, [0, 0, 0], [0, 0, sup]);
    const proj = perspective(0.6, W / H, 0.05, 10);
    const vp = mat4Mul(proj, view);
    return { vp, inv: mat4Inv(vp), right: [view[0], view[4], view[8]], up: [view[1], view[5], view[9]] };
  }
  project(p, W, H) {
    const { vp } = this.matrices(W, H);
    const b = this.toBox(p);
    const x = vp[0] * b[0] + vp[4] * b[1] + vp[8] * b[2] + vp[12];
    const y = vp[1] * b[0] + vp[5] * b[1] + vp[9] * b[2] + vp[13];
    const w = vp[3] * b[0] + vp[7] * b[1] + vp[11] * b[2] + vp[15];
    return { x: (x / w * 0.5 + 0.5) * W, y: (1 - (y / w * 0.5 + 0.5)) * H };
  }
  draw({ mode = "bone", thresholdHu = 400, quick = false, clip = null } = {}) {
    const { gl, canvas, vol } = this;
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    const { inv, right, up } = this.matrices(W, H);
    const v01 = (hu) => Math.max(0, Math.min(1, vol.valueOfHu(hu) / 255));
    const MODES = { bone: 0, teeth: 0, mip: 1, soft: 2, color: 3, skin: 4, xray: 5 };
    gl.uniformMatrix4fv(this.u.invVP, false, inv);
    gl.uniform3fv(this.u.boxSize, this.box);
    gl.uniform1i(this.u.mode, MODES[mode] ?? 0);
    gl.uniform1f(this.u.softLo, v01(mode === "skin" ? -450 : -200));
    gl.uniform1f(this.u.thr, v01(thresholdHu));
    gl.uniform1f(this.u.toothLo, v01(Math.max(thresholdHu + 400, 1500)));
    gl.uniform1f(this.u.airV, v01(mode === "xray" ? -150 : -850));
    const full = Math.min(1100, Math.round(Math.max(vol.nx, vol.ny, vol.nz) * 2.4));
    gl.uniform1f(this.u.steps, quick ? Math.min(260, full) : full);
    gl.uniform3fv(this.u.clipLo, clip ? clip.lo : [0, 0, 0]);
    gl.uniform3fv(this.u.clipHi, clip ? clip.hi : [1, 1, 1]);
    gl.uniform3fv(this.u.texel, [1 / vol.nx, 1 / vol.ny, 1 / vol.nz]);
    gl.uniform1f(this.u.flipZ, vol.zUp ? 0 : 1);
    gl.uniform3fv(this.u.camR, right); gl.uniform3fv(this.u.camU, up);
    gl.uniform1i(this.u.vol, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  dispose() { try { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ } }
}