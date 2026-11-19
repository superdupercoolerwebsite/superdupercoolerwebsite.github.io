// Conifers built from needle-textured bough cards (alpha-tested) around a bark trunk.
// Unit height = 1; instances scale them. One atlas: bough on the left 75%, bark on the right.
import * as THREE from 'three';
import { rng } from './track.js';

const BU = 0.75;

function atlas() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), R = rng(4242);
  const W = S * BU, cx = W / 2;
  g.lineCap = 'round';
  const twigs = [];
  const N = 27;
  for (let k = 0; k < N; k++) {
    const t = 0.03 + k / N * 0.95;
    const prof = Math.min(t / 0.22 + 0.3, 1) * (1 - 0.86 * Math.max(0, (t - 0.28) / 0.72));
    const y = S - 6 - t * (S - 26);
    for (const side of [-1, 1]) {
      const len = prof * W * 0.47 * (0.8 + R() * 0.3), a = 0.95 + (R() - 0.5) * 0.35 - t * 0.25;
      const y0 = y + (R() - 0.5) * 8;
      twigs.push({ x0: cx, y0, x1: cx + side * len * Math.sin(a), y1: y0 - len * Math.cos(a) + len * 0.12, len, side });
    }
  }
  // dense dark under-mass so distant mips keep their coverage
  g.strokeStyle = '#0c2113';
  for (const t of twigs) { g.lineWidth = 4 + t.len * 0.035; g.beginPath(); g.moveTo(t.x0, t.y0); g.lineTo(t.x1, t.y1); g.stroke(); }
  // needles
  for (const t of twigs) {
    const dx = (t.x1 - t.x0) / t.len, dy = (t.y1 - t.y0) / t.len, nx = -dy, ny = dx;
    for (let s = 3; s < t.len; s += 3.2) {
      const f = s / t.len, px = t.x0 + dx * s, py = t.y0 + dy * s;
      for (const q of [-1, 1]) {
        const L = (9 + R() * 9) * (1 - f * 0.4), lean = 0.6 + R() * 0.6;
        const lt = 0.55 + f * 0.55 + R() * 0.35;
        g.strokeStyle = `rgb(${Math.round(38 * lt + R() * 16)},${Math.round(84 * lt + R() * 24)},${Math.round(44 * lt + R() * 12)})`;
        g.lineWidth = 1.3 + R() * 0.9;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + (nx * q + dx * lean) * L, py + (ny * q + dy * lean) * L); g.stroke();
      }
    }
  }
  // woody stems
  g.strokeStyle = '#3a2a1c'; g.lineWidth = 1.6;
  for (const t of twigs) { g.beginPath(); g.moveTo(t.x0, t.y0); g.lineTo(t.x0 + (t.x1 - t.x0) * 0.6, t.y0 + (t.y1 - t.y0) * 0.6); g.stroke(); }
  g.lineWidth = 4.5; g.beginPath(); g.moveTo(cx, S - 2); g.lineTo(cx, 40); g.stroke();
  // bark strip
  const bx = Math.floor(S * 0.79);
  g.fillStyle = '#8d8279'; g.fillRect(bx, 0, S - bx, S);
  for (let k = 0; k < 900; k++) {
    const x = bx + R() * (S - bx), y = R() * S, h = 10 + R() * 70, v = R();
    g.fillStyle = v < 0.55 ? `rgba(30,22,18,${0.25 + R() * 0.4})` : `rgba(215,200,185,${0.12 + R() * 0.2})`;
    g.fillRect(x, y, 1 + R() * 3, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function treeMaterial() {
  const m = new THREE.MeshStandardMaterial({
    map: atlas(), vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.32, alphaToCoverage: true,
  });
  // foliage is lit by its soft outward normal on both faces, not flipped per face
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
  };
  return m;
}

class TB {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u, v, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return g;
  }
}

function trunk(B, rings, sides = 7) {
  // rings: [y, radius, colour, xOffset]
  const idx = [];
  rings.forEach(([y, r, c, ox = 0]) => {
    const row = [];
    for (let k = 0; k <= sides; k++) {
      const t = k / sides * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
      row.push(B.v(cs * r + ox, y, sn * r, cs, 0.15, sn, 0.815 + 0.165 * (k / sides), y * 7, c));
    }
    idx.push(row);
  });
  for (let r = 0; r < idx.length - 1; r++) for (let k = 0; k < sides; k++) {
    const a = idx[r][k], b = idx[r][k + 1], c = idx[r + 1][k], d = idx[r + 1][k + 1];
    B.i.push(a, c, b, b, c, d);
  }
}

function card(B, R, y, t, L, wid, droop, shade, ox = 0) {
  const dx = Math.cos(t), dz = Math.sin(t), wx = -dz, wz = dx;
  const roll = (R() - 0.5) * 0.7, hw = wid / 2, flip = R() < 0.5;
  const nl = 1 / Math.hypot(0.55, 0.85);
  const base = B.p.length / 3;
  const yo = [0, -droop * L * 0.6, -droop * L * 0.92], sc = [0.5, 0.8, 1.05];
  for (let r = 0; r < 3; r++) {
    const s = r / 2, cxp = ox + dx * L * s, cz = dz * L * s, cy = y + yo[r], k = shade * sc[r];
    for (const q of [-1, 1]) {
      const u = (q < 0) !== flip ? 0.012 : BU - 0.012;
      B.v(cxp + wx * hw * q, cy + roll * hw * q, cz + wz * hw * q, dx * 0.55 * nl, 0.85 * nl, dz * 0.55 * nl, u, 0.012 + s * 0.976, [k, k, k]);
    }
  }
  for (let r = 0; r < 2; r++) { const a = base + r * 2; B.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}

export function spruceGeometry(seed, lod) {
  const R = rng(seed), B = new TB();
  trunk(B, [[0, 0.024, [0.30, 0.23, 0.18]], [0.03, 0.016, [0.32, 0.25, 0.2]], [0.5, 0.010, [0.26, 0.2, 0.16]], [0.98, 0.003, [0.2, 0.16, 0.13]]], lod ? 5 : 7);
  const n = lod ? 10 : 19, per = lod ? 4 : 6;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1), y = 0.15 + f * 0.8;
    const L = (0.17 * Math.pow(1 - f, 0.8) + 0.035) * (0.85 + R() * 0.3), rot = R() * 6.28;
    for (let j = 0; j < per; j++)
      card(B, R, y + (R() - 0.5) * 0.02, rot + j / per * 6.28 + (R() - 0.5) * 0.5, L * (0.8 + R() * 0.4), L * (lod ? 1.1 : 0.8),
        0.5 + 0.3 * (1 - f) + R() * 0.15, 0.72 + R() * 0.4);
  }
  for (let j = 0; j < 3; j++) card(B, R, 0.93, j * 2.09 + R(), 0.075, 0.06, -1.1, 1);
  return B.done();
}

export function pineGeometry(seed, lod) {
  const R = rng(seed), B = new TB();
  const lean = 0.012 + R() * 0.012;
  trunk(B, [[0, 0.021, [0.36, 0.28, 0.23]], [0.03, 0.014, [0.40, 0.30, 0.24]], [0.45, 0.011, [0.62, 0.36, 0.2], lean * 0.4], [0.93, 0.005, [0.8, 0.42, 0.2], lean]], lod ? 5 : 7);
  const n = lod ? 5 : 8, per = lod ? 4 : 5;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1), y = 0.6 + f * 0.36;
    const L = (0.06 + 0.085 * Math.sin((0.2 + f * 0.8) * Math.PI)) * (0.8 + R() * 0.4), rot = R() * 6.28;
    for (let j = 0; j < per; j++)
      card(B, R, y + (R() - 0.5) * 0.03, rot + j / per * 6.28 + (R() - 0.5) * 0.7, L * (0.8 + R() * 0.4), L * (lod ? 1.3 : 1.05),
        0.25 - f * 0.5 + (R() - 0.5) * 0.3, 0.8 + R() * 0.4, lean * (0.4 + f * 0.6));
  }
  // dead lower stubs
  if (!lod) for (let k = 0; k < 5; k++) {
    const t = R() * 6.28, y = 0.25 + R() * 0.3, L = 0.03 + R() * 0.05, c = [0.3, 0.24, 0.2];
    const a = B.v(0, y, 0, 0, 1, 0, 0.85, 0.1, c), b = B.v(0, y + 0.006, 0, 0, 1, 0, 0.9, 0.1, c), d = B.v(Math.cos(t) * L, y - 0.012, Math.sin(t) * L, 0, 1, 0, 0.87, 0.3, c);
    B.i.push(a, b, d);
  }
  return B.done();
}

// ---------- undergrowth: fern fronds and grass tufts as alpha cards ----------
function leafAtlas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), R = rng(909);
  // fern frond in the left half
  for (let k = 0; k < 46; k++) {
    const t = k / 46, y = 250 - t * 240, len = 60 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)), 0.6) * (1 - 0.35 * t) + 3;
    for (const sd of [-1, 1]) {
      const lt = 0.7 + R() * 0.6;
      g.fillStyle = `rgb(${Math.round(52 * lt)},${Math.round(104 * lt)},${Math.round(38 * lt)})`;
      g.beginPath(); g.moveTo(64, y + 3.2); g.lineTo(64 + sd * len, y - len * 0.28 + (R() - 0.5) * 3); g.lineTo(64, y - 3.2); g.fill();
    }
  }
  g.strokeStyle = '#3c5a22'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(64, 256); g.lineTo(64, 8); g.stroke();
  // grass blades in the right half
  for (let k = 0; k < 46; k++) {
    const x0 = 136 + R() * 112, h = 90 + R() * 160, bend = (R() - 0.5) * 60, w = 3.5 + R() * 3.5, lt = 0.65 + R() * 0.7, dry = R() < 0.25;
    g.fillStyle = dry ? `rgb(${Math.round(150 * lt)},${Math.round(136 * lt)},${Math.round(70 * lt)})` : `rgb(${Math.round(70 * lt)},${Math.round(112 * lt)},${Math.round(42 * lt)})`;
    g.beginPath(); g.moveTo(x0 - w, 256); g.quadraticCurveTo(x0 + bend * 0.3, 256 - h * 0.6, Math.max(130, Math.min(254, x0 + bend)), 256 - h); g.quadraticCurveTo(x0 + bend * 0.3 + w, 256 - h * 0.6, x0 + w, 256); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export const leafUniforms = { uCar: { value: new THREE.Vector3(0, -999, 0) }, uTime: { value: 0 } };
export function leafMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: leafAtlas(), vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
    // blades are pushed over by the car and sway in the wind; the root (uv.y = 0) stays planted
    sh.uniforms.uCar = leafUniforms.uCar; sh.uniforms.uTime = leafUniforms.uTime;
    sh.vertexShader = 'uniform vec3 uCar; uniform float uTime;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 wPos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wPos = instanceMatrix * wPos;
      #endif
      wPos = modelMatrix * wPos;
      float hF = uv.y;
      vec2 dd = wPos.xz - uCar.xz; float dist = length(dd);
      float push = (1.0 - smoothstep(1.0, 2.4, dist)) * hF * step(abs(wPos.y - uCar.y), 2.5);
      wPos.xz += dd / max(dist, 0.05) * push * 0.55; wPos.y -= push * 0.3;
      wPos.x += sin(uTime * 1.8 + wPos.x * 0.7 + wPos.z * 0.5) * 0.035 * hF;
      wPos.z += cos(uTime * 1.3 + wPos.x * 0.4) * 0.02 * hF;
      vec4 mvPosition = viewMatrix * wPos;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return m;
}
export function fernGeometry() {
  const R = rng(5), B = new TB();
  for (let k = 0; k < 9; k++) {
    const t = k / 9 * 6.28 + R() * 0.5, L = 0.55 + R() * 0.4, hw = 0.15, dx = Math.cos(t), dz = Math.sin(t), wx = -dz, wz = dx, base = B.p.length / 3;
    const ys = [0.02, 0.3 + R() * 0.12, 0.2 + R() * 0.12], sh = [0.6, 0.95, 1.15];
    for (let r = 0; r < 3; r++) for (const q of [-1, 1])
      B.v(dx * L * r / 2 + wx * hw * q, ys[r], dz * L * r / 2 + wz * hw * q, dx * 0.3, 0.95, dz * 0.3, q < 0 ? 0.01 : 0.49, 0.01 + r * 0.49, [sh[r], sh[r], sh[r]]);
    for (let r = 0; r < 2; r++) { const a = base + r * 2; B.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  return B.done();
}
export function grassGeometry() {
  const B = new TB();
  for (let k = 0; k < 3; k++) {
    const t = k / 3 * Math.PI + 0.3, dx = Math.cos(t) * 0.26, dz = Math.sin(t) * 0.26, base = B.p.length / 3;
    B.v(-dx, 0, -dz, 0, 1, 0, 0.52, 0.01, [0.55, 0.55, 0.55]); B.v(dx, 0, dz, 0, 1, 0, 0.99, 0.01, [0.55, 0.55, 0.55]);
    B.v(-dx, 0.44, -dz, 0, 1, 0, 0.52, 0.99, [1.1, 1.1, 1.1]); B.v(dx, 0.44, dz, 0, 1, 0, 0.99, 0.99, [1.1, 1.1, 1.1]);
    B.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return B.done();
}
