// Real-time sun, moon and sky colours, plus the sand and sky shaders that use them.
import * as THREE from 'three';
import { WIND_ANGLE } from './world.js';

const RAD = Math.PI / 180;
export const LATITUDE = 45;

// Where is the sun for this clock time? (x = east, y = up, z = south)
export function sunPosition(date) {
  const y = date.getFullYear();
  const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
  const lon = -std / 60 * 15;
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const doy = (Date.UTC(y, date.getMonth(), date.getDate()) - Date.UTC(y, 0, 0)) / 864e5;
  const decl = -23.44 * RAD * Math.cos(2 * Math.PI * (doy + 10) / 365);
  const ha = ((utc + lon / 15) - 12) * 15 * RAD;
  const lat = LATITUDE * RAD;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  const c = Math.cos(el);
  return { dir: new THREE.Vector3(-c * Math.sin(az), sinEl, c * Math.cos(az)), el: el / RAD };
}

// colour keyframes by sun elevation (degrees), linear light
const KEYS = [
  { e: -14, zen: [0.002, 0.004, 0.012], hor: [0.008, 0.012, 0.028], sun: [0, 0, 0] },
  { e: -6, zen: [0.012, 0.02, 0.07], hor: [0.20, 0.11, 0.13], sun: [0, 0, 0] },
  { e: 0, zen: [0.05, 0.09, 0.28], hor: [0.80, 0.40, 0.18], sun: [1.5, 0.62, 0.25] },
  { e: 8, zen: [0.09, 0.24, 0.62], hor: [0.74, 0.68, 0.64], sun: [2.7, 1.9, 1.2] },
  { e: 30, zen: [0.10, 0.30, 0.75], hor: [0.55, 0.72, 0.92], sun: [3.2, 3.05, 2.85] },
];
function key(el, name, out) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  if (el <= a.e) b = a; else if (el >= b.e) a = b;
  else for (let i = 0; i < KEYS.length - 1; i++) if (el >= KEYS[i].e && el <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; }
  const t = a === b ? 0 : (el - a.e) / (b.e - a.e);
  return out.setRGB(a[name][0] + (b[name][0] - a[name][0]) * t, a[name][1] + (b[name][1] - a[name][1]) * t, a[name][2] + (b[name][2] - a[name][2]) * t);
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const U = {
  uSunPos: { value: new THREE.Vector3(0, 1, 0) },     // where the sun disc is
  uMoonPos: { value: new THREE.Vector3(0, -1, 0) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },   // what lights the sand (sun or moon)
  uLightCol: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uNight: { value: 0 },
  uCloudOff: { value: new THREE.Vector2() }, uCloud: { value: 0.4 },      // where the cloud pattern has drifted to, and how cloudy it is
  uHeadRel: { value: new THREE.Vector3() }, uHeadDir: { value: new THREE.Vector3(0, 0, -1) }, uHead: { value: 0 },   // the car's headlights
  uStorm: { value: 0 },                               // 0 clear air .. 1 full sandstorm
  uDust: { value: new THREE.Color(0.55, 0.36, 0.17) },
  uFog: { value: 1 / 4200 },
  uBleach: { value: 0 },                              // 0 low sun .. 1 high noon sun (sand looks pale and washed out)
  uHeat: { value: 0 },                                // 0 cool .. 1 hot midday air (haze and shimmer)
  uShBall: { value: Array.from({ length: 20 }, () => new THREE.Vector4()) },   // the balls that cast the car's shadow (from the camera; w = radius)
  uCamFrac: { value: new THREE.Vector2() },
  uCamFine: { value: new THREE.Vector2() },
  uField: { value: null }, uFieldOff: { value: new THREE.Vector2() },   // dug/piled sand heights + where the camera is inside that picture
  uProj: { value: new THREE.Matrix4() },
  uCarRel: { value: new THREE.Vector3(0, -999, 0) },   // car position relative to the camera
  uCarR: { value: new THREE.Vector3(1, 0, 0) }, uCarU: { value: new THREE.Vector3(0, 1, 0) }, uCarF: { value: new THREE.Vector3(0, 0, -1) },   // camera position modulo 1 m, for grain-size detail
};

export function updateSky(date) {
  const s = sunPosition(date);
  U.uSunPos.value.copy(s.dir);
  U.uMoonPos.value.copy(s.dir).negate();
  key(s.el, 'zen', U.uZenith.value);
  key(s.el, 'hor', U.uHorizon.value);
  const night = sm(-3, -12, s.el);
  U.uNight.value = night;
  const sunUp = sm(-1.5, 3, s.el);
  if (s.el > -6) {
    U.uLightDir.value.copy(s.dir);
    key(s.el, 'sun', U.uLightCol.value).multiplyScalar(sunUp);
  } else {
    U.uLightDir.value.copy(U.uMoonPos.value);
    U.uLightCol.value.setRGB(0.13, 0.17, 0.27).multiplyScalar(sm(-6, -12, s.el));
  }
  // warm halo around the sun, strongest at sunrise and sunset
  const low = 1 - sm(2, 25, s.el);
  U.uGlow.value.setRGB(1.0, 0.55 - 0.2 * low, 0.25 - 0.15 * low).multiplyScalar((0.35 + 0.9 * low) * sm(-9, 1, s.el));
  // high sun bleaches the sand and heats the air; low sun leaves the colour rich
  U.uBleach.value = sm(14, 45, s.el);
  U.uHeat.value = sm(10, 36, s.el);
  return s;
}

const SKY_GLSL = /* glsl */`
uniform vec3 uSunPos, uMoonPos, uZenith, uHorizon, uGlow;
uniform float uNight, uStorm; uniform vec3 uDust;
uniform vec2 uCloudOff; uniform float uCloud;
float ch(vec2 c){ c = mod(c, 256.0); return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
float cn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ch(i), ch(i + vec2(1, 0)), f.x), mix(ch(i + vec2(0, 1)), ch(i + vec2(1, 1)), f.x), f.y); }
// how much cloud is overhead at this spot of the cloud layer (0 clear .. 1 solid)
float cloudCover(vec2 uv){ float n = (cn(uv) * 0.5 + cn(uv * 2.03 + 17.0) * 0.25 + cn(uv * 4.1 + 31.0) * 0.125 + cn(uv * 8.3 + 5.0) * 0.0625) / 0.9375; return smoothstep(0.66 - 0.32 * uCloud, 0.84 - 0.32 * uCloud, n); }
vec3 skyBase(vec3 d){
  float y = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(y, 0.45));
  float mu = max(dot(d, uSunPos), 0.0);
  c += uGlow * (pow(mu, 6.0) * 0.30 + pow(mu, 48.0) * 0.55);
  // blowing sand hides the sky: everything turns the colour of lit dust, thickest near the horizon
  vec3 dust = uDust * (dot(uHorizon, vec3(0.5)) + 0.25 * dot(uZenith, vec3(1.0)));
  c = mix(c, dust, uStorm * (0.95 - 0.35 * y));
  return c;
}`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      varying vec3 vDir;
      float h31(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyBase(d);
        float mu = dot(d, uSunPos);
        c += vec3(1.0, 0.85, 0.6) * 40.0 * smoothstep(0.99994, 0.99997, mu) * (1.0 - uNight);
        float mm = dot(d, uMoonPos);
        c += vec3(0.75, 0.82, 1.0) * (1.6 * smoothstep(0.99975, 0.99985, mm) + 0.05 * pow(max(mm, 0.0), 300.0)) * uNight;
        vec3 g = floor(d * 260.0);
        float st = h31(g);
        vec3 sp = (g + 0.5) / 260.0;
        float star = smoothstep(0.9975, 1.0, st) * smoothstep(0.0015, 0.0004, length(d - normalize(sp)));
        c += vec3(0.9, 0.95, 1.0) * star * 2.5 * uNight * smoothstep(0.0, 0.15, d.y);
        // clouds: a layer 1500 m up, drifting on the wind
        if (d.y > 0.015) {
          float cv = cloudCover(d.xz * (1500.0 / d.y) / 700.0 + uCloudOff) * smoothstep(0.015, 0.10, d.y) * (1.0 - uStorm);
          vec3 lit = uHorizon * 0.55 + uZenith * 0.25 + vec3(0.42) * (1.0 - uNight) + uGlow * 0.5 * pow(max(mu, 0.0), 3.0);
          c = mix(c, lit, cv * 0.92);
        }
        gl_FragColor = vec4(c, 0.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// Ripple wave vectors are whole multiples of 2*pi/64 so the pattern repeats every 64 m exactly;
// that lets the shader work in small camera-relative numbers no matter how far you travel.
const K = 2 * Math.PI / 64;
function wave(len, ang) { const n = 64 / len; return new THREE.Vector2(Math.round(n * Math.cos(ang)) * K, Math.round(n * Math.sin(ang)) * K); }

export function makeSand(deform = false) {
  return new THREE.ShaderMaterial({
    defines: deform ? { DEFORM: 1 } : {},
    side: THREE.DoubleSide,
    uniforms: Object.assign({
      uK1: { value: wave(0.09, WIND_ANGLE) },
      uK2: { value: wave(0.5, WIND_ANGLE + 0.12) },
    }, U),
    vertexShader: /* glsl */`
      attribute vec3 acol; attribute float shadow;
      varying vec3 vRel, vN, vC; varying float vS;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vRel = transpose(mat3(viewMatrix)) * mv.xyz;      // offset from the camera, world axes
        vN = normal; vC = acol; vS = shadow;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      uniform vec3 uLightDir, uLightCol; uniform vec2 uCamFrac, uCamFine, uK1, uK2; uniform vec3 uCarRel, uCarR, uCarU, uCarF; uniform sampler2D uField; uniform vec2 uFieldOff; uniform mat4 uProj; uniform vec3 uHeadRel, uHeadDir; uniform float uHead; uniform float uFog;
      varying vec3 vRel, vN, vC; varying float vS;
      uniform float uBleach, uHeat; uniform vec4 uShBall[20];
      float h21(vec2 c, float per){ c = mod(c, per); return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p, float per){
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i, per), h21(i + vec2(1, 0), per), f.x), mix(h21(i + vec2(0, 1), per), h21(i + vec2(1, 1), per), f.x), f.y);
      }
      void main(){
        vec3 N = normalize(vN);
        vec3 rel = vRel;
        float td = 0.0; vec2 tg = vec2(0.0);
        #ifdef DEFORM
        // Dug and piled sand. Walk along the line of sight to find where it really meets the changed surface,
        // so holes look like holes from any angle and the wheels sit down inside them.
        vec2 cxz = vRel.xz - uCarRel.xz;
        float inField = 1.0 - smoothstep(13.5, 15.0, max(abs(cxz.x), abs(cxz.y)));
        if (inField > 0.0) {
          vec3 rd = normalize(vRel);
          vec2 slope = vec2(-N.x, -N.z) / max(N.y, 0.2);                 // how the untouched surface tilts
          float fall = rd.y - dot(slope, rd.xz);                         // how fast the sight line drops toward that surface
          float f0 = texture2D(uField, (vRel.xz + uFieldOff) / 32.0).r;
          if (fall < -0.02) {
            float tA = clamp(0.035 / fall, -0.5, 0.0), tB = clamp(-0.14 / fall, 0.0, 0.7);
            float fA = texture2D(uField, (vRel.xz + rd.xz * tA + uFieldOff) / 32.0).r, fB = texture2D(uField, (vRel.xz + rd.xz * tB * 0.35 + uFieldOff) / 32.0).r;
            if (abs(f0) + abs(fA) + abs(fB) > 0.0004) {
              float t = tA, dtS = (tB - tA) / 22.0, prevGap = 1.0, prevT = tA; bool hit = false;
              for (int i = 0; i < 23; i++) {
                float gap = fall * t - texture2D(uField, (vRel.xz + rd.xz * t + uFieldOff) / 32.0).r;   // above (+) or below (-) the sand
                if (gap <= 0.0) { t = i == 0 ? t : mix(prevT, t, prevGap / (prevGap - gap)); hit = true; break; }
                prevGap = gap; prevT = t; t += dtS;
              }
              if (hit) rel = vRel + rd * t * inField;
            }
          }
          vec2 fu = (rel.xz + uFieldOff) / 32.0; float te = 1.0 / 4096.0;
          td = texture2D(uField, fu).r * inField;
          tg = vec2(texture2D(uField, fu + vec2(te, 0.0)).r - texture2D(uField, fu - vec2(te, 0.0)).r,
                    texture2D(uField, fu + vec2(0.0, te)).r - texture2D(uField, fu - vec2(0.0, te)).r) * (64.0 * inField);   // real slope of the dug sand
          vec4 clip = uProj * vec4(mat3(viewMatrix) * rel, 1.0);
          gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
        } else gl_FragDepth = gl_FragCoord.z;
        #endif
        vec2 q = rel.xz + uCamFrac;
        float dist = length(rel);
        vec3 Vd = -rel / dist;
        float pressed = clamp(-td * 90.0, 0.0, 1.0);                     // packed sand: smooth and a little darker

        // the car's shadow: follow the light from this grain of sand and see if the car is in the way
        float S = vS;
        // (the car is given as a set of balls: its four wheels and the biggest parts of its body, so the shadow has
        //  the car's own outline, with daylight between the wheels, and it goes soft as the car leaves the ground)
        vec3 cp = rel - uCarRel;
        if (dot(cp, cp) < 9.0 && uLightDir.y > 0.02) {
          float sh = 1.0;
          for (int i = 0; i < 20; i++) {
            vec4 bl = uShBall[i];
            if (bl.w <= 0.0) continue;
            vec3 dv = bl.xyz - rel; float tt = dot(dv, uLightDir);
            if (tt <= 0.0) continue;
            float miss = length(dv - uLightDir * tt), soft = bl.w * 0.22 + tt * 0.07;
            sh = min(sh, 0.16 + 0.84 * smoothstep(bl.w - soft * 0.4, bl.w + soft, miss) + min(0.5, tt * 0.12));
          }
          S *= min(1.0, sh);
        }

        // cloud shadows: is there cloud between this sand and the sun (or moon)?
        S *= 1.0 - 0.72 * cloudCover((rel.xz + uLightDir.xz * (1500.0 / max(uLightDir.y, 0.08))) / 700.0 + uCloudOff);

        // wind ripples (fine) and larger ripples, none on the steep slip faces or in the ruts
        float flat_ = smoothstep(0.80, 0.90, N.y) * (1.0 - pressed);
        float p1 = dot(q, uK1) + 5.0 * vn(q * 1.25, 80.0) + 1.5 * vn(q * 5.0, 320.0);
        float f1 = (1.0 - smoothstep(0.4, 1.5, fwidth(p1))) * flat_;
        float p2 = dot(q, uK2) + 5.0 * vn(q * 0.25, 16.0) + 4.0 * vn(q * 0.75 + 7.0, 48.0) + 1.6 * vn(q * 2.5 + 3.0, 160.0);   // the bigger ripples wander, fork and fade
        float f2 = (1.0 - smoothstep(0.4, 1.5, fwidth(p2))) * flat_;
        vec2 gr = cos(p1) * normalize(uK1) * 0.22 * f1 + cos(p2) * normalize(uK2) * 0.075 * f2 * (0.35 + 1.3 * vn(q * 0.5 + 11.0, 32.0));
        // grain: two sizes of tiny bumps and colour speckle, only close to the camera
        vec2 qf = rel.xz + uCamFine;                  // repeats every metre: fine for grains
        vec2 qa = qf * 150.0, qb = qf * 600.0, qc = qf * 1000.0;
        float gA = 1.0 - smoothstep(0.25, 0.9, fwidth(qa.x) + fwidth(qa.y));
        float gB = 1.0 - smoothstep(0.25, 0.9, fwidth(qb.x) + fwidth(qb.y));
        float gC = 1.0 - smoothstep(0.2, 0.7, fwidth(qc.x) + fwidth(qc.y));
        float a0 = vn(qa, 150.0), b0 = vn(qb, 600.0);
        vec2 gb = vec2(0.0);
        if (gA > 0.0) gb += vec2(vn(qa + vec2(0.4, 0.0), 150.0) - a0, vn(qa + vec2(0.0, 0.4), 150.0) - a0) * 0.55 * gA;
        if (gB > 0.0) gb += vec2(vn(qb + vec2(0.4, 0.0), 600.0) - b0, vn(qb + vec2(0.0, 0.4), 600.0) - b0) * 0.9 * gB;
        // sand that has been dug, piled or thrown is loose: rougher, lumpier, never a clean moulded shape
        float loose = clamp(abs(td) * 45.0 + length(tg) * 1.2, 0.0, 1.0);
        gb *= 1.0 + 3.0 * loose;
        vec2 lump = vec2(vn(qf * 38.0 + 3.1, 38.0) - 0.5, vn(qf * 38.0 + 17.7, 38.0) - 0.5) * 0.55 * loose;
        vec3 n = normalize(N - vec3(gr.x + gb.x + tg.x + lump.x, 0.0, gr.y + gb.y + tg.y + lump.y));
        float gr1 = h21(floor(qc), 1000.0);
        float dark = step(0.93, gr1) * gC, pale = step(gr1, 0.06) * gC;
        vec3 alb = vC * (1.0 + (a0 - 0.5) * 0.10 * gA + (b0 - 0.5) * 0.20 * gB + sin(p1) * 0.06 * f1) * (1.0 - 0.4 * dark) * (1.0 + 0.3 * pale) * (1.0 - 0.09 * pressed) * (1.0 + 0.10 * loose * (b0 - 0.5) * 4.0);

        // under a high sun, sand looks pale and washed out; early and late its colour is deep
        alb = mix(alb, (vec3(dot(alb, vec3(0.3, 0.55, 0.15))) * vec3(1.10, 1.03, 0.88) + 0.05), 0.42 * uBleach);
        float ndl = max(dot(n, uLightDir), 0.0);
        vec3 skyAmb = mix(uHorizon, uZenith, 0.5) * 0.6;
        vec3 bounce = vC * uLightCol * 0.10 * max(uLightDir.y, 0.0);
        vec3 col = alb * (uLightCol * ndl * S + mix(bounce, skyAmb, n.y * 0.5 + 0.5));

        // soft sheen toward the light, plus single glinting grains
        vec3 H = normalize(uLightDir + Vd);
        float ndh = max(dot(n, H), 0.0);
        col += uLightCol * S * pow(ndh, 40.0) * 0.06;
        vec2 gq = q * 170.0, gc = floor(gq);
        float r = h21(gc, 10880.0);
        if (r > 0.962) {
          vec3 gn = normalize(n + (vec3(h21(gc + 3.0, 10880.0), 0.5, h21(gc + 7.0, 10880.0)) - 0.5) * 1.3);
          float sf = 1.0 - smoothstep(0.3, 1.0, fwidth(gq.x) + fwidth(gq.y));
          float dot_ = 1.0 - smoothstep(0.15, 0.45, length(fract(gq) - 0.5));
          col += uLightCol * S * pow(max(dot(gn, H), 0.0), 90.0) * 2.4 * sf * dot_;
        }
        col += skyAmb * pow(1.0 - max(dot(n, Vd), 0.0), 5.0) * 0.5;

        // the car's headlights: a cone of warm light that falls off with distance
        if (uHead > 0.0) {
          vec3 hp = rel - uHeadRel; float hd = length(hp); vec3 hn = hp / hd;
          float cone = smoothstep(0.78, 0.96, dot(hn, uHeadDir));
          col += alb * vec3(1.0, 0.94, 0.82) * uHead * cone * max(dot(n, -hn), 0.0) * 1.6 / (1.0 + hd * hd * 0.3);
        }

        // haze into the sky colour
        float fog = 1.0 - exp(-dist * uFog * (1.0 + 1.6 * uHeat));
        vec3 fd = normalize(vec3(-Vd.x, 0.03, -Vd.z));
        col = mix(col, skyBase(fd), fog);
        gl_FragColor = vec4(col, 0.0);
      }`,
  });
}
