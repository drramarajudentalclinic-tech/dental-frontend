/* ═══════════════════════════════════════════════════════════════════════
   3-D VIEW — the scan rendered on the graphics card (WebGL 2), so it turns
   smoothly on phones, tablets and computers.
   Modes: "bone" (ivory bone and teeth surface, lit like a photo), "skin"
   (skin over the bone), "color" (volume rendering), "xray" (a radiograph
   made through the head), "mip" (brightest point), "soft" (see-through).
   The scan is lightly smoothed for 3-D only, so grain does not show as dots.
   Implants and the nerve are drawn on top in their true positions.
   ═══════════════════════════════════════════════════════════════════════ */

import { radiusAt, collarOf, shapeOf } from "./implantLibrary";

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
// implants (cones: body, collar, abutment) and nerve canals (capsules), in box units
#define MAXC 32
#define MAXS 40
uniform int nCone; uniform vec3 cA[MAXC]; uniform vec3 cB[MAXC]; uniform vec3 cP[MAXC];   // cP: top radius, apex radius, kind
uniform int nSeg; uniform vec4 sA[MAXS]; uniform vec4 sB[MAXS];                             // sA.w: radius, sB.w: colour
uniform float boneSee;
uniform sampler3D air; uniform int hasAir;   // airway, coloured by its cross-section area
// Fusion: a second scan (B) placed in this scan's frame, and the distance from this scan's bone surface
uniform int fuse;            // 0 off · 1 two colours · 2 change map
uniform sampler3D volB; uniform sampler3D distA;
uniform mat3 bM; uniform vec3 bC; uniform float thrB;
uniform sampler3D guideTex; uniform int hasGuide;   // the surgical guide (shown as teal resin)     // how much implants show through bone (0 = hidden)

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
float dot2(vec3 v){ return dot(v, v); }
/* ray / capped cone and ray / capsule (Inigo Quilez) */
vec4 coneHit(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float ra, float rb){
  vec3 ba = pb - pa, oa = ro - pa, ob = ro - pb;
  float m0 = dot(ba, ba), m1 = dot(oa, ba), m2 = dot(rd, ba), m3 = dot(rd, oa), m5 = dot(oa, oa), m9 = dot(ob, ba);
  if (m1 < 0.0) { if (dot2(oa * m2 - rd * m1) < ra * ra * m2 * m2) return vec4(-m1 / m2, -ba * inversesqrt(m0)); }
  else if (m9 > 0.0) { float t = -m9 / m2; if (dot2(ob + rd * t) < rb * rb) return vec4(t, ba * inversesqrt(m0)); }
  float rr = ra - rb, hy = m0 + rr * rr;
  float k2 = m0 * m0 - m2 * m2 * hy;
  float k1 = m0 * m0 * m3 - m1 * m2 * hy + m0 * ra * (rr * m2);
  float k0 = m0 * m0 * m5 - m1 * m1 * hy + m0 * ra * (rr * m1 * 2.0 - m0 * ra);
  float h = k1 * k1 - k2 * k0;
  if (h < 0.0) return vec4(-1.0);
  float t = (-k1 - sqrt(h)) / k2, y = m1 + t * m2;
  if (y < 0.0 || y > m0) return vec4(-1.0);
  return vec4(t, normalize(m0 * (m0 * (oa + t * rd) + rr * ba * ra) - ba * hy * y));
}
float capHit(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float ra){
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - ra * ra * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a, y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc); c = dot(oc, oc) - ra * ra; h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}
vec3 kindCol(float k){
  if (k < 0.5) return vec3(0.80, 0.70, 0.38);     // implant (gold titanium, like planning software)
  if (k < 1.5) return vec3(1.0, 0.90, 0.45);     // selected
  if (k < 2.5) return vec3(1.0, 0.32, 0.28);     // too close to the nerve
  if (k < 3.5) return vec3(0.78, 0.80, 0.84);    // abutment / collar
  if (k < 4.5) return vec3(1.0, 0.62, 0.16);     // nerve canal
  if (k < 5.5) return vec3(0.20, 0.83, 0.60);    // 3-D landmark
  return vec3(0.98, 0.80, 0.08);                 // active landmark
}
vec3 areaCol(float m){
  float t = clamp((m - 2.0) / 253.0, 0.0, 1.0);
  if (t < 0.33) return mix(vec3(0.94, 0.27, 0.27), vec3(0.98, 0.80, 0.08), t / 0.33);
  if (t < 0.66) return mix(vec3(0.98, 0.80, 0.08), vec3(0.13, 0.77, 0.37), (t - 0.33) / 0.33);
  return mix(vec3(0.13, 0.77, 0.37), vec3(0.23, 0.51, 0.96), (t - 0.66) / 0.34);
}
float valB(vec3 p){ vec3 t = bM * p + bC; if (any(lessThan(t, vec3(0.0))) || any(greaterThan(t, vec3(1.0)))) return 0.0; return texture(volB, t).r; }
vec3 gradB(vec3 p){
  vec3 h = texel * 1.25 * boxSize;
  return vec3(valB(p + vec3(h.x,0,0)) - valB(p - vec3(h.x,0,0)), valB(p + vec3(0,h.y,0)) - valB(p - vec3(0,h.y,0)), valB(p + vec3(0,0,h.z)) - valB(p - vec3(0,0,h.z)));
}
/* change map: 0 mm green → 2.5 mm yellow → 5 mm and more red */
vec3 changeCol(float mm){
  float t = clamp((mm - 0.6) / 4.4, 0.0, 1.0);          // up to ~0.6 mm counts as unchanged
  return t < 0.5 ? mix(vec3(0.20, 0.78, 0.40), vec3(0.98, 0.84, 0.18), t * 2.0) : mix(vec3(0.98, 0.84, 0.18), vec3(0.94, 0.25, 0.22), (t - 0.5) * 2.0);
}
float gv(vec3 t){ return texture(guideTex, t).r; }
vec3 gradG(vec3 t){
  vec3 h = texel * 1.0;
  vec3 g = vec3(gv(t + vec3(h.x,0,0)) - gv(t - vec3(h.x,0,0)), gv(t + vec3(0,h.y,0)) - gv(t - vec3(0,h.y,0)), gv(t + vec3(0,0,h.z)) - gv(t - vec3(0,0,h.z)));
  if (flipZ > 0.5) g.z = -g.z;
  return g / (h * boxSize);
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
  // nearest implant / nerve along this ray
  float objT = 1e9; vec3 objN = vec3(0.0); float objK = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= nCone) break;
    vec4 h = coneHit(ro, rd, cA[i], cB[i], cP[i].x, cP[i].y);
    if (h.x > 0.0 && h.x < objT) { objT = h.x; objN = h.yzw; objK = cP[i].z; }
  }
  for (int i = 0; i < MAXS; i++) {
    if (i >= nSeg) break;
    float th = capHit(ro, rd, sA[i].xyz, sB[i].xyz, sA[i].w);
    if (th > 0.0 && th < objT) {
      vec3 p = ro + rd * th, ba = sB[i].xyz - sA[i].xyz;
      float k = clamp(dot(p - sA[i].xyz, ba) / dot(ba, ba), 0.0, 1.0);
      objT = th; objN = normalize(p - (sA[i].xyz + ba * k)); objK = sB[i].w;
    }
  }
  bool hasObj = objT < 1e8;
  // airway along this ray (shown through the bone like the implants)
  vec3 airC = vec3(0.0); float airA = 0.0, tAir = 1e9;
  if (hasAir == 1 && (mode == 0 || mode == 4)) {
    float dt2 = dt * 1.5;
    for (int i = 0; i < 1600; i++) {
      float tt = tn + dt2 * (float(i) + hash(gl_FragCoord.yx));
      if (tt > tf) break;
      float m = texture(air, tcOf(ro + rd * tt)).r * 255.0;
      if (m > 1.5) { if (tAir > 1e8) tAir = tt; float o = 0.22; airC += (1.0 - airA) * o * areaCol(m); airA += (1.0 - airA) * o; if (airA > 0.95) break; }
    }
  }
  vec3 objC = hasObj ? shade(objN, rd, kindCol(objK), 0.55, 48.0) : vec3(0.0);
  float prevV = val(tcOf(ro + rd * tn)), prevT = tn;
  bool skinDone = false;
  bool gotG = false; float tG = 0.0; vec3 colG = vec3(0.0); float prevG = 0.0;
  bool gotA = false, gotB = false; float tA = 0.0, tB = 0.0, prevB = 0.0; vec3 colA = vec3(0.0), colB = vec3(0.0);
  if (fuse > 0) prevB = valB(ro + rd * tn);
  bool startInside = prevV > thr;                       // ray starts in bone at a cut face
  for (int i = 0; i < 2400; i++) {
    if (t > tf) break;
    if (hasObj && t > objT && mode != 1 && mode != 5) { vec3 oc = gotG ? mix(objC, colG, 0.55) : objC; acc += (1.0 - a) * oc; a = 1.0; break; }
    vec3 tc = tcOf(ro + rd * t);
    float v = val(tc);
    if (fuse > 0 && mode == 0) {
      vec3 pos = ro + rd * t;
      if (!gotA && v > thr && prevV <= thr) {
        float a0 = prevT, b0 = t;
        for (int k = 0; k < 6; k++) { float m = 0.5 * (a0 + b0); if (val(tcOf(ro + rd * m)) > thr) b0 = m; else a0 = m; }
        vec3 p = ro + rd * b0;
        colA = shade(normalize(-gradAt(tcOf(p)) + 1e-6), rd, boneCol(thr + 0.05), 0.18, 28.0); tA = b0; gotA = true;
      }
      float vb = valB(pos);
      if (!gotB && vb > thrB && prevB <= thrB) {
        float a0 = prevT, b0 = t;
        for (int k = 0; k < 6; k++) { float m = 0.5 * (a0 + b0); if (valB(ro + rd * m) > thrB) b0 = m; else a0 = m; }
        vec3 p = ro + rd * b0;
        vec3 nb = normalize(-gradB(p) + 1e-6);
        if (fuse == 1) colB = shade(nb, rd, vec3(0.45, 0.66, 1.0), 0.30, 30.0);
        else colB = shade(nb, rd, changeCol(texture(distA, tcOf(p)).r * 25.5), 0.18, 24.0);
        tB = b0; gotB = true;
      }
      prevB = vb; prevV = v; prevT = t; t += dt;
      if (gotA && gotB) break;
      if (fuse == 2 && gotB) break;
      continue;
    }
    if (hasGuide == 1 && !gotG && (mode == 0 || mode == 4)) {
      float gg = gv(tc);
      if (gg > 0.5 && prevG <= 0.5) {
        float a0 = prevT, b0 = t;
        for (int k = 0; k < 5; k++) { float m = 0.5 * (a0 + b0); if (gv(tcOf(ro + rd * m)) > 0.5) b0 = m; else a0 = m; }
        colG = shade(normalize(-gradG(tcOf(ro + rd * b0)) + 1e-6), rd, vec3(0.32, 0.84, 0.76), 0.38, 40.0); tG = b0; gotG = true;
      }
      prevG = gg;
    }
    if (hasAir == 1 && (mode == 2 || mode == 3)) {
      float m = texture(air, tc).r * 255.0;
      if (m > 1.5) { float o = 1.0 - pow(1.0 - 0.10, dt * 900.0 / diag); vec3 ac = areaCol(m) * 1.05; acc += (1.0 - a) * o * ac; a += (1.0 - a) * o; }
    }
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
        vec3 c; float hitT = t;
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
          hitT = b0;
        }
        if (hasObj) c = mix(c, objC, boneSee * (objK > 3.5 ? 0.85 : 1.0));   // implants / nerve seen through the bone
        if (airA > 0.01) c = mix(c, airC / airA, (tAir < hitT ? 1.0 : boneSee) * airA);
        if (gotG) c = mix(c, colG, 0.8);                                       // the guide sits on top
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
  if (fuse > 0 && mode == 0) {
    vec3 c = bg;
    if (fuse == 1) {
      if (gotA && gotB) c = tA <= tB ? mix(colA, colB, 0.42) : mix(colB, colA, 0.32);
      else if (gotA) c = colA; else if (gotB) c = colB;
    } else {
      if (gotB) c = (gotA && tA < tB - 0.004) ? mix(colB, colA, 0.30) : colB; else if (gotA) c = mix(bg, colA, 0.35);
    }
    color = vec4(c, 1.0); return;
  }
  if (mode == 1) { float g = clamp((mx - thr) / max(1.0 - thr, 0.01), 0.0, 1.0); vec3 c = vec3(pow(g, 1.15)); color = vec4(hasObj ? mix(c, objC, 0.8) : c, 1.0); return; }
  if (mode == 5) { float g = 1.0 - exp(-sum * 9.0 / diag); vec3 c = vec3(pow(g, 1.25)); color = vec4(hasObj ? mix(c, objC, 0.8) : c, 1.0); return; }
  if (gotG && a < 1.0) { acc += (1.0 - a) * 0.85 * colG; a += (1.0 - a) * 0.85; }
  if (airA > 0.01 && a < 1.0) { acc += (1.0 - a) * airC; a += (1.0 - a) * airA; }
  if (hasObj && a < 1.0) { acc += (1.0 - a) * objC; a = 1.0; }
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
/* the 3-D view does not need more than ~400 points per side: bigger (full-detail) scans are
   halved for the graphics card only (the slices keep every detail) */
const TEX_MAX = 420;
function halve(src, nx, ny, nz, pool = "mean") {
  const mx = Math.ceil(nx / 2), my = Math.ceil(ny / 2), mz = Math.ceil(nz / 2), out = new Uint8Array(mx * my * mz), nxy = nx * ny;
  for (let z = 0; z < mz; z++) for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) {
    let s = 0, n = 0, m = 0;
    for (let c = 0; c < 2; c++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const X = 2 * x + a, Y = 2 * y + b, Z = 2 * z + c; if (X >= nx || Y >= ny || Z >= nz) continue;
      const v = src[Z * nxy + Y * nx + X]; s += v; n++; if (v > m) m = v;
    }
    out[(z * my + y) * mx + x] = pool === "max" ? m : Math.round(s / n);
  }
  return { nx: mx, ny: my, nz: mz, data: out };
}
/* texture for a scan: halved when big (averaging also smooths), else lightly smoothed */
function texOf(vol) {
  if (Math.max(vol.nx, vol.ny, vol.nz) > TEX_MAX) return halve(vol.data, vol.nx, vol.ny, vol.nz);
  return { nx: vol.nx, ny: vol.ny, nz: vol.nz, data: smooth3(vol) };
}
function maskTex(vol, mask, smooth) {
  if (Math.max(vol.nx, vol.ny, vol.nz) > TEX_MAX) { const h = halve(mask, vol.nx, vol.ny, vol.nz, smooth ? "mean" : "max"); return h; }
  return { nx: vol.nx, ny: vol.ny, nz: vol.nz, data: smooth ? smooth3({ nx: vol.nx, ny: vol.ny, nz: vol.nz, data: mask }) : mask };
}
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
    const T0 = texOf(vol); this.tdim = [T0.nx, T0.ny, T0.nz];
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, T0.nx, T0.ny, T0.nz, 0, gl.RED, gl.UNSIGNED_BYTE, T0.data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    const m = Math.max(vol.X, vol.Y, vol.Z);
    this.box = [vol.X / m, vol.Y / m, vol.Z / m];
    this.mm = m;
    this.u = Object.fromEntries(["vol", "invVP", "boxSize", "mode", "thr", "steps", "clipLo", "clipHi", "texel", "flipZ", "softLo", "toothLo", "airV", "camR", "camU", "nCone", "cA", "cB", "cP", "nSeg", "sA", "sB", "boneSee", "air", "hasAir", "fuse", "volB", "distA", "bM", "bC", "thrB", "guideTex", "hasGuide"].map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.yaw = 0; this.pitch = 0.12; this.zoom = 1.35;
    this.objs = { nCone: 0, cA: new Float32Array(96), cB: new Float32Array(96), cP: new Float32Array(96), nSeg: 0, sA: new Float32Array(160), sB: new Float32Array(160) };
    this.boneSee = 0.6;
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
    const full = Math.min(1100, Math.round(Math.max(...this.tdim) * 2.4));
    gl.uniform1f(this.u.steps, quick ? Math.min(260, full) : full);
    gl.uniform3fv(this.u.clipLo, clip ? clip.lo : [0, 0, 0]);
    gl.uniform3fv(this.u.clipHi, clip ? clip.hi : [1, 1, 1]);
    gl.uniform3fv(this.u.texel, [1 / this.tdim[0], 1 / this.tdim[1], 1 / this.tdim[2]]);
    gl.uniform1f(this.u.flipZ, vol.zUp ? 0 : 1);
    gl.uniform3fv(this.u.camR, right); gl.uniform3fv(this.u.camU, up);
    const O = this.objs;
    gl.uniform1i(this.u.nCone, O.nCone); gl.uniform3fv(this.u.cA, O.cA); gl.uniform3fv(this.u.cB, O.cB); gl.uniform3fv(this.u.cP, O.cP);
    gl.uniform1i(this.u.nSeg, O.nSeg); gl.uniform4fv(this.u.sA, O.sA); gl.uniform4fv(this.u.sB, O.sB);
    gl.uniform1f(this.u.boneSee, this.boneSee);
    gl.uniform1i(this.u.air, 1); gl.uniform1i(this.u.hasAir, this.airTex && !this.fusion ? 1 : 0);
    const F = this.fusion;
    gl.uniform1i(this.u.fuse, F ? (F.mode === "change" ? 2 : 1) : 0);
    gl.uniform1i(this.u.volB, 2); gl.uniform1i(this.u.distA, 3);
    gl.uniform1i(this.u.guideTex, 4); gl.uniform1i(this.u.hasGuide, this.guideTex && !this.fusion ? 1 : 0);
    if (F) { gl.uniformMatrix3fv(this.u.bM, false, F.M); gl.uniform3fv(this.u.bC, F.C); gl.uniform1f(this.u.thrB, Math.max(0, Math.min(1, F.volB.valueOfHu(thresholdHu) / 255))); }
    gl.uniform1i(this.u.vol, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  /* Fusion: scan B (Volume), T (A mm → B mm), the distance field of A, mode "colours" | "change" — or null */
  setFusion(f) {
    const { gl } = this;
    if (!f) { this.fusion = null; return; }
    const tex3 = (unit, w, h, d, data, linear) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, w, h, d, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      const fl = linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, fl); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, fl);
      for (const w2 of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w2, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      return t;
    };
    const prev = this.fusion;
    if (!prev || prev.volB !== f.volB) { if (prev?.texB) gl.deleteTexture(prev.texB); const TB = texOf(f.volB); f.texB = tex3(2, TB.nx, TB.ny, TB.nz, TB.data, true); } else f.texB = prev.texB;
    if (f.dist && (!prev || prev.dist !== f.dist)) { if (prev?.texD) gl.deleteTexture(prev.texD); f.texD = tex3(3, f.dist.gx, f.dist.gy, f.dist.gz, f.dist.data, true); } else f.texD = prev?.texD;
    // box (A) → texture coordinates of B, as one affine map: tc = M·p + C
    const A = this.vol, B = f.volB, m = this.mm, T = f.T;
    const toTcB = (pb) => {
      const zb = (pb[2] + this.box[2] / 2) * m;
      const w = [(pb[0] + this.box[0] / 2) * m, (pb[1] + this.box[1] / 2) * m, A.zUp ? zb : A.Z - zb];
      const R = T.R, q = [R[0] * w[0] + R[1] * w[1] + R[2] * w[2] + T.t[0], R[3] * w[0] + R[4] * w[1] + R[5] * w[2] + T.t[1], R[6] * w[0] + R[7] * w[1] + R[8] * w[2] + T.t[2]];
      return [q[0] / B.X, q[1] / B.Y, q[2] / B.Z];
    };
    const c0 = toTcB([0, 0, 0]), cx = toTcB([1, 0, 0]), cy = toTcB([0, 1, 0]), cz = toTcB([0, 0, 1]);
    // column-major mat3: columns are the images of the unit vectors
    f.M = new Float32Array([cx[0] - c0[0], cx[1] - c0[1], cx[2] - c0[2], cy[0] - c0[0], cy[1] - c0[1], cy[2] - c0[2], cz[0] - c0[0], cz[1] - c0[1], cz[2] - c0[2]]);
    f.C = new Float32Array(c0);
    this.fusion = f;
  }
  /* the surgical guide on the scan's grid (1 = guide) — or null */
  setGuide(mask) {
    const { gl, vol } = this;
    if (mask === this.guideSrc) return;
    this.guideSrc = mask;
    if (this.guideTex) { gl.deleteTexture(this.guideTex); this.guideTex = null; }
    if (!mask) return;
    const v = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) v[i] = mask[i] ? 255 : 0;
    gl.activeTexture(gl.TEXTURE4);
    this.guideTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, this.guideTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const TG = maskTex(vol, v, true);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, TG.nx, TG.ny, TG.nz, 0, gl.RED, gl.UNSIGNED_BYTE, TG.data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }
  /* the airway mask (values 2..255 = area level) or null */
  setAirway(mask) {
    const { gl, vol } = this;
    if (mask === this.airSrc) return;
    this.airSrc = mask;
    if (this.airTex) { gl.deleteTexture(this.airTex); this.airTex = null; }
    if (!mask) return;
    gl.activeTexture(gl.TEXTURE1);
    this.airTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, this.airTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const TA = maskTex(vol, mask, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, TA.nx, TA.ny, TA.nz, 0, gl.RED, gl.UNSIGNED_BYTE, TA.data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }
  /* implants (true outline: body, collar, abutment) and nerve canals, drawn inside the bone */
  setObjects({ implants = [], nerves = [], selectedId = null, dangerIds = [], showProsthetic = true, points = [] } = {}) {
    const O = this.objs, m = this.mm;
    let c = 0, s = 0;
    const cone = (p0, p1, r0, r1, kind) => {
      if (c >= 32) return;
      const a = this.toBox(p0), b = this.toBox(p1);
      O.cA.set(a, c * 3); O.cB.set(b, c * 3); O.cP.set([r0 / m, r1 / m, kind], c * 3); c++;
    };
    for (const im of implants) {
      const kind = dangerIds.includes(im.id) ? 2 : im.id === selectedId ? 1 : 0;
      const at = (t) => [im.top[0] + im.axis[0] * im.length * t, im.top[1] + im.axis[1] * im.length * t, im.top[2] + im.axis[2] * im.length * t];
      const knee = shapeOf(im) === "tapered" ? 0.3 : 0.86;
      cone(at(0), at(knee), radiusAt(im, 0), radiusAt(im, knee), kind);
      cone(at(knee), at(0.999), radiusAt(im, knee), radiusAt(im, 0.999), kind);
      const cl = collarOf(im), R = im.diameter / 2;
      const up = (mm) => [im.top[0] - im.axis[0] * mm, im.top[1] - im.axis[1] * mm, im.top[2] - im.axis[2] * mm];
      if (cl > 0) cone(up(cl), up(0), R + 0.35, R, 3);
      if (showProsthetic) cone(up(cl + (im.abutment ?? 4)), up(cl), R * 0.58, R * 0.72, 3);
    }
    for (const n of nerves) {
      let pts = n.points;
      if (pts.length < 2) continue;
      const step = Math.max(1, Math.ceil((pts.length - 1) / 12));
      pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
      for (let i = 0; i + 1 < pts.length && s < 24; i++, s++) {
        const a = this.toBox(pts[i]), b = this.toBox(pts[i + 1]);
        O.sA.set([...a, (n.diameter || 2) / 2 / m], s * 4); O.sB.set([...b, 4], s * 4);
      }
    }
    for (const q of points) {                        // 3-D landmarks as small balls
      if (s >= 40) break;
      const a = this.toBox(q.p), b = this.toBox([q.p[0] + 0.01, q.p[1], q.p[2]]);
      O.sA.set([...a, (q.r || 1.6) / m], s * 4); O.sB.set([...b, q.active ? 6 : 5], s * 4); s++;
    }
    O.nCone = c; O.nSeg = s;
  }
  dispose() { try { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ } }
}