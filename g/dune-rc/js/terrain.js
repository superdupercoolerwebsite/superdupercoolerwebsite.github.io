// Endless terrain: rings of square tiles around the camera, finest in the middle.
import * as THREE from 'three';
import { height, sandColor } from './world.js';

export const N = 48;          // squares per tile edge
export const T0 = 32;         // metres, finest tile
export const LEVELS = 7;      // each level doubles the tile size
const V = N + 1, G = N + 3, M = N / 2 + 1;
const NV = V * V + 4 * V;

// perimeter walk (for the skirts that hide cracks between detail levels)
const PERIM = [];
for (let i = 0; i <= N; i++) PERIM.push(i);
for (let j = 0; j <= N; j++) PERIM.push(j * V + N);
for (let i = N; i >= 0; i--) PERIM.push(N * V + i);
for (let j = N; j >= 0; j--) PERIM.push(j * V);

const INDEX = (() => {
  const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const P = PERIM.length;
  for (let s = 0; s < P; s++) {
    const s2 = (s + 1) % P;
    const a = PERIM[s], b = PERIM[s2], c = V * V + s, d = V * V + s2;
    idx.push(a, c, b, b, c, d);
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
})();

const coarse = new Float32Array(M * M);

function cr(a, b, c, d, t) { return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a))); }
function cubic(hs, fx, fz) {
  const i = Math.max(0, Math.min(N - 1, Math.floor(fx))), j = Math.max(0, Math.min(N - 1, Math.floor(fz)));
  const u = fx - i, v = fz - j, g = j * G + i;        // (i-1, j-1) in the bordered grid
  return cr(cr(hs[g], hs[g + 1], hs[g + 2], hs[g + 3], u), cr(hs[g + G], hs[g + G + 1], hs[g + G + 2], hs[g + G + 3], u),
    cr(hs[g + 2 * G], hs[g + 2 * G + 1], hs[g + 2 * G + 2], hs[g + 2 * G + 3], u), cr(hs[g + 3 * G], hs[g + 3 * G + 1], hs[g + 3 * G + 2], hs[g + 3 * G + 3], u), v);
}

export class Terrain {
  constructor(scene, material) {
    this.scene = scene; this.material = material;
    this.tiles = new Map();        // key -> tile
    this.target = new Set();
    this.targetSig = '';
    this.swapped = true;
    this.light = new THREE.Vector3(0, 1, 0);
    this.stale = [];
  }

  wanted(cx, cz) {
    const keys = [];
    let sig = '';
    for (let k = 0; k < LEVELS; k++) {
      const T = T0 * (1 << k);
      const px = Math.floor(cx / (2 * T)), pz = Math.floor(cz / (2 * T));
      const qx = Math.floor(cx / T), qz = Math.floor(cz / T);
      sig += px + ',' + pz + ';';
      for (let j = 2 * pz - 2; j <= 2 * pz + 3; j++) for (let i = 2 * px - 2; i <= 2 * px + 3; i++) {
        if (k > 0 && i >= qx - 1 && i <= qx + 1 && j >= qz - 1 && j <= qz + 1) continue;
        keys.push([k, i, j]);
      }
    }
    return { keys, sig };
  }

  build(k, ti, tj) {
    const T = T0 * (1 << k), step = T / N, ox = ti * T, oz = tj * T;
    const hs = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++)
      hs[j * G + i] = height(ox + (i - 1) * step, oz + (j - 1) * step);
    const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), col = new Float32Array(NV * 3);
    let lo = 1e9, hi = -1e9;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const o = (j * V + i) * 3, g = (j + 1) * G + i + 1;
      const h = hs[g];
      if (h < lo) lo = h; if (h > hi) hi = h;
      pos[o] = i * step; pos[o + 1] = h; pos[o + 2] = j * step;
      // The slope here is measured across this point's own neighbours in the mesh, so the shading always agrees with
      // the shape that is drawn. (Measuring it over a much shorter distance made far-off sharp crests shade like a
      // comb: each point picked up one side of the knife edge or the other.)
      const nx = hs[g - 1] - hs[g + 1], nz = hs[g - G] - hs[g + G], ny = 2 * step;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nor[o] = nx * l; nor[o + 1] = ny * l; nor[o + 2] = nz * l;
      sandColor(ox + i * step, oz + j * step, col, o);
    }
    const drop = T * 0.1;
    for (let s = 0; s < PERIM.length; s++) {
      const a = PERIM[s] * 3, o = (V * V + s) * 3;
      pos[o] = pos[a]; pos[o + 1] = pos[a + 1] - drop; pos[o + 2] = pos[a + 2];
      nor[o] = nor[a]; nor[o + 1] = nor[a + 1]; nor[o + 2] = nor[a + 2];
      col[o] = col[a]; col[o + 1] = col[a + 1]; col[o + 2] = col[a + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('acol', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('shadow', new THREE.BufferAttribute(new Float32Array(NV), 1));
    // split each square along the diagonal that follows the sand best (keeps crests clean, not saw-toothed)
    const idx = new Uint16Array(INDEX.array);
    let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      if (Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]) > Math.abs(pos[b * 3 + 1] - pos[c * 3 + 1])) {
        idx[q] = a; idx[q + 1] = c; idx[q + 2] = b; idx[q + 3] = b; idx[q + 4] = c; idx[q + 5] = d;
      } else {
        idx[q] = a; idx[q + 1] = c; idx[q + 2] = d; idx[q + 3] = a; idx[q + 4] = d; idx[q + 5] = b;
      }
      q += 6;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(T / 2, (lo + hi) / 2 - drop / 2, T / 2),
      Math.hypot(T * 0.7072, (hi - lo + drop) / 2));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    const tile = { k, ox, oz, step, hs, mesh, geo };
    this.bake(tile);
    return tile;
  }

  // Dune-on-dune shadows: walk from each point toward the light and see if sand is in the way.
  bake(tile) {
    const L = this.light, sh = tile.geo.attributes.shadow.array;
    if (L.y <= 0.01) { sh.fill(1); tile.geo.attributes.shadow.needsUpdate = true; return; }
    const hl = Math.hypot(L.x, L.z) || 1e-6;
    const hx = L.x / hl, hz = L.z / hl, slope = L.y / hl;
    const { ox, oz, step, hs } = tile;
    const t0 = Math.max(0.7, step);
    for (let b = 0; b < M; b++) for (let a = 0; a < M; a++) {
      const px = ox + a * 2 * step, pz = oz + b * 2 * step;
      const h0 = hs[(b * 2 + 1) * G + a * 2 + 1] + 0.05;
      let s = 1, t = t0;
      // Closely spaced looks along the ray (a sharp crest is thin: widely spaced looks let some rays step right over
      // it while their neighbours hit it, which drew the shadow's edge as a row of scallops), and a soft edge.
      for (let n = 0; n < 26; n++) {
        const d = (h0 + (slope + 0.01) * t - height(px + hx * t, pz + hz * t)) / t;
        if (d * 2.6 < s) { s = d * 2.6; if (s <= 0) { s = 0; break; } }
        t *= 1.28;
      }
      coarse[b * M + a] = s;
    }
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const a0 = i >> 1, a1 = (i + 1) >> 1, b0 = j >> 1, b1 = (j + 1) >> 1;
      sh[j * V + i] = 0.25 * (coarse[b0 * M + a0] + coarse[b0 * M + a1] + coarse[b1 * M + a0] + coarse[b1 * M + a1]);
    }
    for (let s = 0; s < PERIM.length; s++) sh[V * V + s] = sh[PERIM[s]];
    tile.geo.attributes.shadow.needsUpdate = true;
  }

  setLight(dir) {
    if (dir.dot(this.light) > 0.99996) return;        // moved less than about half a degree
    this.light.copy(dir);
    this.stale = [...this.tiles.values()];
  }

  // Call every frame. Does at most `budget` ms of building. Returns tiles still missing.
  update(cx, cz, budget = 6) {
    const t0 = performance.now();
    const { keys, sig } = this.wanted(cx, cz);
    if (sig !== this.targetSig) {
      this.targetSig = sig; this.swapped = false;
      this.target = new Set(keys.map(k => k.join('_')));
      this.queue = keys.filter(k => !this.tiles.has(k.join('_')));
      for (const [key, t] of this.tiles) if (!this.target.has(key) && !t.mesh.visible) this.drop(key, t);
    }
    while (this.queue && this.queue.length && performance.now() - t0 < budget) {
      const [k, i, j] = this.queue.shift();
      this.tiles.set(k + '_' + i + '_' + j, this.build(k, i, j));
    }
    const missing = this.queue ? this.queue.length : 0;
    if (!missing && !this.swapped) {
      for (const [key, t] of this.tiles) {
        if (this.target.has(key)) t.mesh.visible = true; else this.drop(key, t);
      }
      this.swapped = true;
    }
    while (!missing && this.stale.length && performance.now() - t0 < budget) {
      const t = this.stale.pop();
      if (this.tiles.get(t.k + '_' + Math.round(t.ox / (T0 * (1 << t.k))) + '_' + Math.round(t.oz / (T0 * (1 << t.k)))) === t) this.bake(t);
    }
    return missing;
  }

  // Height and slope of the drawn sand at x,z (falls back to the pure maths far from the camera).
  sample(x, z, out) {
    const ti = Math.floor(x / T0), tj = Math.floor(z / T0);
    const t = this.tiles.get('0_' + ti + '_' + tj);
    if (!t) {
      const e = 0.3, h = height(x, z), hx = height(x + e, z) - h, hz = height(x, z + e) - h;
      const l = 1 / Math.hypot(hx, e, hz);
      out.h = h; out.nx = -hx * l; out.ny = e * l; out.nz = -hz * l; return;
    }
    // smooth curve through the grid points (no hard kinks between squares to bounce the car)
    const st = t.step, hs = t.hs;
    const h = cubic(hs, (x - t.ox) / st, (z - t.oz) / st);
    const e = 0.06;
    const dx = cubic(hs, (x + e - t.ox) / st, (z - t.oz) / st) - h, dz = cubic(hs, (x - t.ox) / st, (z + e - t.oz) / st) - h;
    const l = 1 / Math.hypot(dx, e, dz);
    out.h = h; out.nx = -dx * l; out.ny = e * l; out.nz = -dz * l;
  }

  // quick height of the drawn sand (for thousands of grains per frame)
  heightFast(x, z) {
    const t = this.tiles.get('0_' + Math.floor(x / T0) + '_' + Math.floor(z / T0));
    if (!t) return height(x, z);
    const fx = (x - t.ox) / t.step, fz = (z - t.oz) / t.step;
    const i = Math.min(N - 1, Math.floor(fx)), j = Math.min(N - 1, Math.floor(fz)), u = fx - i, v = fz - j, g = (j + 1) * G + i + 1, hs = t.hs;
    return (hs[g] * (1 - u) + hs[g + 1] * u) * (1 - v) + (hs[g + G] * (1 - u) + hs[g + G + 1] * u) * v;
  }

  drop(key, t) {
    this.scene.remove(t.mesh); t.geo.dispose(); this.tiles.delete(key);
  }
}
