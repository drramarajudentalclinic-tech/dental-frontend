/* ═══════════════════════════════════════════════════════════════════════
   3-D VIEW — the scan rendered on the graphics card (WebGL 2), so it turns
   smoothly on phones, tablets and computers.
   Modes: "bone" (surface of bone and teeth, shaded), "mip" (brightest
   point, like an X-ray), "soft" (see-through).
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
uniform int mode;          // 0 bone, 1 mip, 2 soft, 3 colour (VR)
uniform float softLo;
uniform float thr;         // threshold (0..1 of the value range)
uniform float steps;
uniform vec3 clipLo; uniform vec3 clipHi;
uniform vec3 texel;
uniform float flipZ;
float val(vec3 t){ return texture(vol, t).r; }
void main(){
  vec4 nearP = invVP * vec4(uv * 2.0 - 1.0, -1.0, 1.0); nearP /= nearP.w;
  vec4 farP  = invVP * vec4(uv * 2.0 - 1.0,  1.0, 1.0); farP /= farP.w;
  vec3 ro = nearP.xyz, rd = normalize(farP.xyz - nearP.xyz);
  vec3 lo = -boxSize * 0.5 + clipLo * boxSize, hi = -boxSize * 0.5 + clipHi * boxSize;
  vec3 inv = 1.0 / rd;
  vec3 t0 = (lo - ro) * inv, t1 = (hi - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z), tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tf <= max(tn, 0.0)) { color = vec4(0.03, 0.05, 0.09, 1.0); return; }
  tn = max(tn, 0.0);
  float dt = length(boxSize) / steps;
  vec3 acc = vec3(0.0); float a = 0.0; float mx = 0.0;
  for (float t = tn; t < tf; t += dt) {
    vec3 pos = ro + rd * t;
    vec3 tc = pos / boxSize + 0.5;
    if (flipZ > 0.5) tc.z = 1.0 - tc.z;
    float v = val(tc);
    if (mode == 1) { mx = max(mx, v); continue; }
    if (mode == 3) {
      // colour volume rendering: faint soft tissue, orange → ivory bone and teeth, lit
      float soft = smoothstep(softLo, softLo + 0.03, v) * (1.0 - smoothstep(thr - 0.03, thr, v));
      float bone = smoothstep(thr - 0.02, thr + 0.08, v);
      float o = soft * 0.006 + bone * 0.30;
      if (o > 0.002) {
        vec3 g = vec3(val(tc + vec3(texel.x,0,0)) - val(tc - vec3(texel.x,0,0)),
                      val(tc + vec3(0,texel.y,0)) - val(tc - vec3(0,texel.y,0)),
                      val(tc + vec3(0,0,texel.z)) - val(tc - vec3(0,0,texel.z)));
        if (flipZ > 0.5) g.z = -g.z;
        vec3 n = normalize(-g + 1e-6);
        vec3 l = normalize(-rd + vec3(0.25, 0.45, 0.5));
        float lit = 0.32 + 0.8 * abs(dot(n, l));
        float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 20.0) * 0.18 * bone;
        vec3 c = bone > 0.02
          ? mix(vec3(0.80, 0.42, 0.16), vec3(1.0, 0.94, 0.80), clamp((v - thr) * 3.2, 0.0, 1.0))
          : vec3(0.85, 0.42, 0.36);
        c = c * lit + spec;
        acc += (1.0 - a) * o * c; a += (1.0 - a) * o;
        if (a > 0.97) break;
      }
      continue;
    }
    if (mode == 0) {
      if (v > thr) {
        // refine and shade
        vec3 g = vec3(val(tc + vec3(texel.x,0,0)) - val(tc - vec3(texel.x,0,0)),
                      val(tc + vec3(0,texel.y,0)) - val(tc - vec3(0,texel.y,0)),
                      val(tc + vec3(0,0,texel.z)) - val(tc - vec3(0,0,texel.z)));
        if (flipZ > 0.5) g.z = -g.z;
        vec3 n = normalize(-g + 1e-6);
        vec3 l = normalize(-rd + vec3(0.3, 0.5, 0.4));
        float diff = max(dot(n, l), 0.0), amb = 0.25;
        float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 24.0) * 0.25;
        float dens = clamp((v - thr) * 4.0, 0.0, 1.0);
        vec3 base = mix(vec3(0.93, 0.86, 0.72), vec3(1.0, 0.98, 0.93), dens);
        color = vec4(base * (amb + diff * 0.85) + spec, 1.0);
        return;
      }
    } else {
      float o = clamp((v - thr) * 3.0, 0.0, 1.0) * 0.08;
      vec3 c = mix(vec3(0.9, 0.55, 0.45), vec3(1.0, 0.97, 0.9), clamp((v - thr) * 2.0, 0.0, 1.0));
      acc += (1.0 - a) * o * c; a += (1.0 - a) * o;
      if (a > 0.97) break;
    }
  }
  if (mode == 1) { float g = clamp((mx - thr) / max(1.0 - thr, 0.01), 0.0, 1.0); color = vec4(vec3(g), 1.0); return; }
  if (mode == 0) { color = vec4(0.03, 0.05, 0.09, 1.0); return; }
  if (mode == 3) { color = vec4(acc + (1.0 - a) * vec3(0.02, 0.03, 0.06), 1.0); return; }
  color = vec4(acc + (1.0 - a) * vec3(0.03, 0.05, 0.09), 1.0);
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
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, vol.nx, vol.ny, vol.nz, 0, gl.RED, gl.UNSIGNED_BYTE, vol.data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    const m = Math.max(vol.X, vol.Y, vol.Z);
    this.box = [vol.X / m, vol.Y / m, vol.Z / m];
    this.mm = m;
    this.u = Object.fromEntries(["vol", "invVP", "boxSize", "mode", "thr", "steps", "clipLo", "clipHi", "texel", "flipZ", "softLo"].map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.yaw = 0; this.pitch = 0.15; this.zoom = 1;
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
    return { vp, inv: mat4Inv(vp) };
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
    const { inv } = this.matrices(W, H);
    gl.uniformMatrix4fv(this.u.invVP, false, inv);
    gl.uniform3fv(this.u.boxSize, this.box);
    gl.uniform1i(this.u.mode, mode === "mip" ? 1 : mode === "soft" ? 2 : mode === "color" ? 3 : 0);
    gl.uniform1f(this.u.softLo, Math.max(0, Math.min(1, vol.valueOfHu(-200) / 255)));
    gl.uniform1f(this.u.thr, Math.max(0, Math.min(1, vol.valueOfHu(thresholdHu) / 255)));
    gl.uniform1f(this.u.steps, quick ? 180 : mode === "color" ? 520 : 420);
    gl.uniform3fv(this.u.clipLo, clip ? clip.lo : [0, 0, 0]);
    gl.uniform3fv(this.u.clipHi, clip ? clip.hi : [1, 1, 1]);
    gl.uniform3fv(this.u.texel, [1 / vol.nx, 1 / vol.ny, 1 / vol.nz]);
    gl.uniform1f(this.u.flipZ, vol.zUp ? 0 : 1);
    gl.uniform1i(this.u.vol, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  dispose() { try { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ } }
}