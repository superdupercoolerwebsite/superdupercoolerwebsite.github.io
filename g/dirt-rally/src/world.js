// Visual world: textured gravel road, terrain, forest, undergrowth, sky, lights, gates.
import * as THREE from 'three';
import { DS, HALF_W, VERGE, noise2, rng } from './track.js';
import { spruceGeometry, pineGeometry, treeMaterial, fernGeometry, grassGeometry, leafMaterial } from './trees.js';

// lighting / weather presets (linear colours)
export const COND = {
  dusk: { name: 'Dusk', fog: [0.30, 0.245, 0.33], fogD: 0.0088, sunDir: [-0.62, 0.44, -0.55], sunCol: 0xffa066, sunI: 5.5, hemiSky: 0xb4abd8, hemiGround: 0x4a3d32, hemiI: 3.4,
    zen: [0.07, 0.085, 0.24], mid: [0.36, 0.25, 0.50], hor: [0.50, 0.33, 0.46], horSun: [1.5, 0.66, 0.34], cloudA: [0.20, 0.15, 0.28], cloudB: [1.25, 0.55, 0.40], stars: 0.25,
    head: 160, cabin: 0.45, dust: 0.5, env: 0.55, exposure: 1.3 },
  day: { name: 'Day', fog: [0.58, 0.66, 0.74], fogD: 0.0042, sunDir: [-0.4, 0.8, -0.35], sunCol: 0xfff0dc, sunI: 6.5, hemiSky: 0xbcd4ff, hemiGround: 0x5c5244, hemiI: 2.6,
    zen: [0.13, 0.28, 0.66], mid: [0.36, 0.52, 0.82], hor: [0.70, 0.77, 0.84], horSun: [1.1, 1.05, 0.95], cloudA: [0.75, 0.78, 0.82], cloudB: [1.2, 1.15, 1.1], stars: 0,
    head: 0, cabin: 0.3, dust: 0.42, env: 0.6, exposure: 1.1 },
  foggy: { name: 'Foggy', fog: [0.50, 0.52, 0.53], fogD: 0.021, sunDir: [-0.3, 0.7, -0.5], sunCol: 0xe6ebee, sunI: 1.1, hemiSky: 0xc9ced3, hemiGround: 0x5a554e, hemiI: 3.6,
    zen: [0.46, 0.48, 0.5], mid: [0.5, 0.52, 0.53], hor: [0.5, 0.52, 0.53], horSun: [0.6, 0.6, 0.58], cloudA: [0.44, 0.46, 0.47], cloudB: [0.56, 0.57, 0.57], stars: 0,
    head: 260, cabin: 0.35, dust: 0.5, env: 0.55, exposure: 1.1 },
  night: { name: 'Night', fog: [0.010, 0.013, 0.024], fogD: 0.008, sunDir: [0.3, 0.8, 0.4], sunCol: 0x8ea4d6, sunI: 0.8, hemiSky: 0x2c3558, hemiGround: 0x0b0a09, hemiI: 1.5,
    zen: [0.004, 0.006, 0.018], mid: [0.012, 0.016, 0.04], hor: [0.025, 0.03, 0.06], horSun: [0.03, 0.035, 0.07], cloudA: [0.01, 0.012, 0.025], cloudB: [0.04, 0.045, 0.07], stars: 1.6,
    head: 5200, cabin: 0.16, dust: 0.22, env: 0.4, exposure: 1.3 },
};

// ---------- tileable noise for textures ----------
function th(ix, iy, p, s) {
  ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p;
  let h = (ix * 374761393 + iy * 668265263 + s * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tn(x, y, p, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = th(ix, iy, p, s), b = th(ix + 1, iy, p, s), c = th(ix, iy + 1, p, s), d = th(ix + 1, iy + 1, p, s);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
const tfbm = (u, v, p, s) => 0.5 * tn(u * p, v * p, p, s) + 0.3 * tn(u * p * 2, v * p * 2, p * 2, s + 1) + 0.2 * tn(u * p * 4, v * p * 4, p * 4, s + 2);

function makeTex(size, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const b = document.createElement('canvas'); b.width = b.height = size;
  const g = c.getContext('2d'), gb = b.getContext('2d');
  const img = g.createImageData(size, size), bmp = gb.createImageData(size, size);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, x, y, out);
    const k = (y * size + x) * 4;
    img.data[k] = out[0] * 255; img.data[k + 1] = out[1] * 255; img.data[k + 2] = out[2] * 255; img.data[k + 3] = 255;
    const h = Math.max(0, Math.min(1, out[3])) * 255;
    bmp.data[k] = bmp.data[k + 1] = bmp.data[k + 2] = h; bmp.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0); gb.putImageData(bmp, 0, 0);
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(b);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bump };
}

const ROAD_W = 2 * (HALF_W + VERGE);

const memo = {};
function roadTextures() {
  const size = 1024;
  return memo.road || (memo.road = makeTex(size, (u, v, x, y, o) => {
    const lat = (u - 0.5) * ROAD_W, al = Math.abs(lat);
    const n1 = tfbm(u, v, 6, 3), n2 = tfbm(u, v, 24, 9), n3 = tn(u * 160, v * 160, 160, 15), px = th(x, y, size, 21);
    const edge = HALF_W - 0.45 + (n1 - 0.5) * 1.1 + (n2 - 0.5) * 0.5;
    const stone = th(x >> 1, y >> 1, size >> 1, 33), big = th(x >> 2, y >> 2, size >> 2, 37);
    // gravel
    const rut = Math.exp(-Math.pow((al - 0.82) / 0.36, 2));
    const crown = Math.exp(-Math.pow(al / 0.38, 2));
    let l = 0.50 + 0.10 * (n2 - 0.5) + 0.07 * (n3 - 0.5) + 0.04 * (px - 0.5) - 0.10 * rut + 0.07 * crown;
    let h = 0.5 + 0.25 * (n3 - 0.5) + 0.06 * (px - 0.5) - 0.18 * rut;
    const loose = 1 - rut;
    if (stone > 0.90) { l += 0.08 * loose + 0.02; h += 0.3 * loose; }
    if (big > 0.975) { l += 0.2 * (th(x >> 2, y >> 2, size, 5) - 0.35); h += 0.45; }
    if (stone < 0.05) { l -= 0.05; h -= 0.2; }
    let r = l * 1.05, g = l * 0.98, b = l * 0.88;
    // damp darker patches
    const damp = Math.max(0, n1 - 0.58) * 1.6; r *= 1 - damp * 0.45; g *= 1 - damp * 0.42; b *= 1 - damp * 0.36;
    // verge: moss, grass, dead needles
    const t = Math.max(0, Math.min(1, (al - edge) / 0.45));
    if (t > 0) {
      const m = tfbm(u, v, 48, 51);
      const vr = 0.13 + 0.10 * m + 0.06 * (px - 0.5), vg = 0.22 + 0.10 * (1 - m) + 0.08 * (px - 0.5) + 0.05 * n3, vb = 0.08 + 0.03 * m;
      const k = t * t * (3 - 2 * t);
      r += (vr - r) * k; g += (vg - g) * k; b += (vb - b) * k;
      h += (0.62 + 0.3 * (px - 0.5) - h) * k;
    }
    o[0] = r; o[1] = g; o[2] = b; o[3] = h;
  }));
}

function groundTextures() {
  const size = 512;
  return memo.ground || (memo.ground = makeTex(size, (u, v, x, y, o) => {
    const m = tfbm(u, v, 5, 61), n = tfbm(u, v, 20, 67), px = th(x, y, size, 71), f = tn(u * 90, v * 90, 90, 73);
    const twig = th(x >> 1, y, size, 79) > 0.985 ? 0.1 : 0;
    o[0] = 0.13 + 0.10 * m + 0.06 * (px - 0.5) + twig;
    o[1] = 0.22 + 0.10 * (1 - m) + 0.08 * n + 0.07 * (px - 0.5) + twig * 0.7;
    o[2] = 0.08 + 0.03 * m + 0.03 * (px - 0.5) + twig * 0.4;
    const lit = Math.max(0, Math.min(1, (tfbm(u, v, 9, 83) - 0.46) / 0.14));
    o[0] += (0.25 + 0.05 * (px - 0.5) + twig - o[0]) * lit; o[1] += (0.19 + 0.04 * (px - 0.5) + twig * 0.7 - o[1]) * lit; o[2] += (0.12 + 0.02 * (px - 0.5) - o[2]) * lit;
    o[3] = 0.5 + 0.3 * (f - 0.5) + 0.25 * (px - 0.5);
  }));
}

function buildRoad(T) {
  const O = HALF_W + VERGE;
  const offs = [-(O + 1.4), -O, -HALF_W, -HALF_W * 0.5, 0, HALF_W * 0.5, HALF_W, O, O + 1.4];
  const prof = (a) => a <= HALF_W ? -0.0036 * a * a : a <= O ? -0.42 : -1.2;
  const m = offs.length, n = T.n;
  const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2);
  for (let i = 0; i < n; i++) {
    const lx = T.tz[i], lz = -T.tx[i];
    for (let j = 0; j < m; j++) {
      const o = offs[j], k = i * m + j;
      pos[k * 3] = T.px[i] + lx * o; pos[k * 3 + 1] = T.py[i] + prof(Math.abs(o)); pos[k * 3 + 2] = T.pz[i] + lz * o;
      uv[k * 2] = Math.max(0.002, Math.min(0.998, (o + O) / ROAD_W)); uv[k * 2 + 1] = i * DS / ROAD_W;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d);   // wound to face up
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const tx = roadTextures();
  const mat = new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 0.22, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  return mesh;
}

function buildTerrain(T) {
  const CELL = 4, REACH = 150;
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < T.n; i++) { minx = Math.min(minx, T.px[i]); maxx = Math.max(maxx, T.px[i]); minz = Math.min(minz, T.pz[i]); maxz = Math.max(maxz, T.pz[i]); }
  minx -= REACH + 8; minz -= REACH + 8; maxx += REACH + 8; maxz += REACH + 8;
  const nx = Math.ceil((maxx - minx) / CELL) + 1, nz = Math.ceil((maxz - minz) / CELL) + 1;
  const mask = new Uint8Array(nx * nz), rc = Math.ceil(REACH / CELL);
  for (let i = 0; i < T.n; i += 8) {
    const cx = Math.round((T.px[i] - minx) / CELL), cz = Math.round((T.pz[i] - minz) / CELL);
    for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
      if (a * a + b * b > rc * rc) continue;
      const X = cx + a, Z = cz + b;
      if (X >= 0 && Z >= 0 && X < nx && Z < nz) mask[Z * nx + X] = 1;
    }
  }
  const remap = new Int32Array(nx * nz).fill(-1);
  const pos = [], col = [], uv = [], idx = [];
  const vert = (X, Z) => {
    const k = Z * nx + X;
    if (remap[k] >= 0) return remap[k];
    const x = minx + X * CELL, z = minz + Z * CELL;
    let y = T.ground(x, z);
    if (T.qa < HALF_W + VERGE + 0.6) y = T.qy - 1.0;
    const n1 = noise2(x / 22, z / 22, 41), s = 0.72 + 0.5 * n1;
    remap[k] = pos.length / 3; pos.push(x, y, z); col.push(s, s * (0.95 + 0.1 * noise2(x / 9, z / 9, 43)), s * 0.95); uv.push(x / 6, z / 6);
    return remap[k];
  };
  for (let Z = 0; Z < nz - 1; Z++) for (let X = 0; X < nx - 1; X++) {
    if (!(mask[Z * nx + X] || mask[Z * nx + X + 1] || mask[(Z + 1) * nx + X] || mask[(Z + 1) * nx + X + 1])) continue;
    const a = vert(X, Z), b = vert(X + 1, Z), c = vert(X, Z + 1), d = vert(X + 1, Z + 1);
    if ((X + Z) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const tx = groundTextures();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.map, bumpMap: tx.bump, bumpScale: 2, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  return { mesh, minx, minz, nx, nz, mask, CELL };
}

// ---------- geometry helpers ----------
class Builder {
  constructor() { this.p = []; this.c = []; this.i = []; }
  v(x, y, z, c) { this.p.push(x, y, z); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeVertexNormals();
    return g;
  }
}
function trunk(B, r0, r1, h, c0, c1, sides = 6, bend = 0) {
  const a = [], b = [];
  for (let k = 0; k < sides; k++) {
    const t = k / sides * Math.PI * 2;
    a.push(B.v(Math.cos(t) * r0, 0, Math.sin(t) * r0, c0)); b.push(B.v(Math.cos(t) * r1 + bend, h, Math.sin(t) * r1, c1));
  }
  for (let k = 0; k < sides; k++) { const n = (k + 1) % sides; B.tri(a[k], b[k], a[n]); B.tri(a[n], b[k], b[n]); }
}
// one drooping, jagged branch skirt
function skirt(B, R, y, r, rise, droop, pts, rot, cIn, cOut, ox = 0, oz = 0) {
  const apex = B.v(ox, y + rise, oz, cIn), ring = [];
  for (let k = 0; k < pts; k++) {
    const t = rot + k / pts * Math.PI * 2, rr = r * (k & 1 ? 0.62 + R() * 0.15 : 0.9 + R() * 0.2);
    const sh = 0.8 + R() * 0.4;
    ring.push(B.v(ox + Math.cos(t) * rr, y - droop * (k & 1 ? 0.3 : 1) * (0.7 + R() * 0.6), oz + Math.sin(t) * rr, [cOut[0] * sh, cOut[1] * sh, cOut[2] * sh]));
  }
  for (let k = 0; k < pts; k++) B.tri(apex, ring[(k + 1) % pts], ring[k]);
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, R = rng(12);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.72 + R() * 0.5);
    const s = seen.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.6, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

// instanced meshes bucketed into cells so frustum + shadow culling work
function scatter(scene, geo, mat, items, cell, cast, out) {
  const buckets = new Map();
  for (const t of items) {
    const k = Math.floor(t.x / cell) * 73856093 ^ Math.floor(t.z / cell) * 19349663;
    let a = buckets.get(k); if (!a) buckets.set(k, a = []); a.push(t);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), e = new THREE.Euler();
  for (const arr of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((t, i) => {
      if (t.tilt) q.setFromEuler(e.set(t.tilt, t.rot, t.tilt * 0.6)); else q.setFromAxisAngle(up, t.rot);
      p.set(t.x, t.y, t.z); s.set(t.sx, t.sy, t.sx);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
      mesh.setColorAt(i, c.setRGB(t.tint, t.tint, t.tint));
    });
    mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    scene.add(mesh); if (out) out.push(mesh);
  }
}

function buildForest(scene, T, terr, gfx, solid) {
  const R = rng(T.seed * 31 + 5), STEP = 4.6;
  const { minx, minz, nx, nz, mask, CELL } = terr;
  const w = (nx - 1) * CELL, d = (nz - 1) * CELL;
  const inMask = (X, Z) => mask[Math.min(nz - 1, Math.max(0, Math.round((Z - minz) / CELL))) * nx + Math.min(nx - 1, Math.max(0, Math.round((X - minx) / CELL)))];
  const spruce = [[], [], [], []], pine = [[], [], [], []], col = solid.slice(), cull = [], cullNear = [];
  for (let z = 0; z < d; z += STEP) for (let x = 0; x < w; x += STEP) {
    const jx = R(), jz = R(), pr = R(), sz = R(), rot = R(), tint = R(), kind = R(), var_ = R();
    const X = minx + x + jx * STEP, Z = minz + z + jz * STEP;
    if (!inMask(X, Z)) continue;
    const y = T.ground(X, Z), a = T.qa;
    if (a < HALF_W + VERGE + 1.6) continue;
    let p = a < 40 ? 0.6 : a < 85 ? 0.34 : 0.17;
    if (noise2(X / 70, Z / 70, 77) < 0.28 && a > 16) p *= 0.15;
    if (pr > p * gfx.trees) continue;
    const isPine = kind < 0.28 + 0.4 * noise2(X / 110, Z / 110, 91) - 0.2;
    const h = (isPine ? 15 : 10) + sz * sz * 13 + (a < 12 ? 3 : 0);
    const it = { x: X, y: y - 0.3, z: Z, sx: h * (isPine ? 0.9 : 0.85 + var_ * 0.3), sy: h, rot: rot * 6.28, tint: 0.7 + tint * 0.6 };
    (isPine ? pine : spruce)[Math.floor(var_ * 2) + (a < gfx.nearTree ? 0 : 2)].push(it);
    col.push([X, Z, (isPine ? 0.017 : 0.02) * h * 0.8 + 0.08]);
  }
  const mat = memo.tree || (memo.tree = treeMaterial());
  spruce.forEach((l, i) => scatter(scene, spruceGeometry(100 + i, i > 1), mat, l, 72, true, cull));
  pine.forEach((l, i) => scatter(scene, pineGeometry(200 + i, i > 1), mat, l, 72, true, cull));

  // undergrowth
  const R2 = rng(T.seed * 17 + 3), ferns = [], grass = [], rocks = [];
  for (let i = 0; i < T.n; i++) {
    const lx = T.tz[i], lz = -T.tx[i];
    for (let k = 0; k < 14; k++) {
      const side = R2() < 0.5 ? -1 : 1, r1 = R2(), r2 = R2(), r3 = R2(), r4 = R2(), r5 = R2();
      const along = (r5 - 0.5) * DS;
      if (k < 12 && r5 > gfx.grass) continue;
      if (k < 9) {
        const o = side * (HALF_W - 0.3 + r1 * r1 * (VERGE + 9));
        const X = T.px[i] + lx * o + T.tx[i] * along, Z = T.pz[i] + lz * o + T.tz[i] * along;
        const s = 0.5 + r2 * 0.6;
        grass.push({ x: X, y: T.ground(X, Z, i) - 0.02, z: Z, sx: s, sy: s * (0.7 + r3 * 0.8), rot: r4 * 6.28, tint: 0.7 + r3 * 0.6 });
      } else if (k < 12) {
        const o = side * (HALF_W + 1.4 + r1 * r1 * 22);
        const X = T.px[i] + lx * o + T.tx[i] * along, Z = T.pz[i] + lz * o + T.tz[i] * along;
        if (noise2(X / 9, Z / 9, 55) < 0.42) continue;
        const s = 0.8 + r2 * 1.1;
        ferns.push({ x: X, y: T.ground(X, Z, i) - 0.03, z: Z, sx: s, sy: s, rot: r4 * 6.28, tint: 0.65 + r3 * 0.7 });
      } else if (r3 < 0.09) {
        const o = side * (HALF_W + 1.9 + r1 * 14);
        const X = T.px[i] + lx * o, Z = T.pz[i] + lz * o;
        const s = 0.18 + r2 * r2 * 0.75;
        rocks.push({ x: X, y: T.ground(X, Z, i) + s * 0.1, z: Z, sx: s, sy: s, rot: r4 * 6.28, tint: 0.6 + r5 * 0.6, tilt: (r1 - 0.5) * 0.6 });
        if (s > 0.3) col.push([X, Z, s * 0.7 - 0.45]);              // anything bigger than a football stops the car
      }
    }
  }
  const leaf = memo.leaf || (memo.leaf = leafMaterial());
  // a real grass field: thick along the verges, thinning out under the trees
  const R3 = rng(T.seed * 29 + 11), per = Math.round(64 * gfx.grass);
  for (let i = 0; i < T.n; i++) {
    const lx = T.tz[i], lz = -T.tx[i];
    for (let k = 0; k < per; k++) {
      const r1 = R3(), r2 = R3(), r3 = R3(), r4 = R3(), o = (k & 1 ? 1 : -1) * (HALF_W - 0.1 + r1 * r1 * 27), al = (r2 - 0.5) * DS;
      const X = T.px[i] + lx * o + T.tx[i] * al, Z = T.pz[i] + lz * o + T.tz[i] * al, sc = 0.6 + r3 * 0.8;
      grass.push({ x: X, y: T.ground(X, Z, i) - 0.03, z: Z, sx: sc * 1.3, sy: sc * (0.55 + r4 * 0.9), rot: r4 * 6.28, tint: 0.62 + r3 * 0.6 });
    }
  }
  scatter(scene, fernGeometry(), leaf, ferns, 40, false, cullNear);
  scatter(scene, grassGeometry(), leaf, grass, 32, false, cullNear);
  scatter(scene, rockGeometry(), new THREE.MeshStandardMaterial({ color: 0x55524f, roughness: 0.95, flatShading: true }), rocks, 60, true);

  const hash = new Map(), HC = 6, key = (a, b) => a * 73856093 ^ b * 19349663;
  for (const e of col)
    for (let a = Math.floor((e[0] - 2.5) / HC); a <= Math.floor((e[0] + 2.5) / HC); a++)
      for (let b = Math.floor((e[1] - 2.5) / HC); b <= Math.floor((e[1] + 2.5) / HC); b++) {
        const k = key(a, b); let arr = hash.get(k); if (!arr) hash.set(k, arr = []); arr.push(e);
      }
  const empty = [];
  return { query: (x, z) => hash.get(key(Math.floor(x / HC), Math.floor(z / HC))) || empty, count: col.length, cull, cullNear };
}

function signTexture(draw, w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const wood = new THREE.MeshStandardMaterial({ color: 0x3d2c1e, roughness: 1 });

function gate(T, i, label, color) {
  const g = new THREE.Group();
  const tex = signTexture((x, w, h) => {
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    x.fillStyle = '#14110f'; x.font = '700 92px "Barlow Condensed", "Arial Narrow", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, w / 2, h / 2 + 6);
  });
  const span = HALF_W * 2 + 2.6, face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 5.4, 7), wood);
    post.position.set(s * span / 2, 2.3, 0); post.castShadow = true; g.add(post);
  }
  const ban = new THREE.Mesh(new THREE.BoxGeometry(span + 0.3, 1.2, 0.1), [wood, wood, wood, wood, face, face]);
  ban.position.set(0, 4.35, 0); ban.castShadow = true; g.add(ban);
  g.position.set(T.px[i], T.py[i] - 0.3, T.pz[i]);
  g.rotation.y = Math.atan2(T.tx[i], T.tz[i]) + Math.PI;
  return g;
}

function cornerBoards(scene, T) {
  const solid = [];
  const mk = (dir) => new THREE.MeshStandardMaterial({
    roughness: 0.8, map: signTexture((x, w, h) => {
      x.fillStyle = '#e8a01c'; x.fillRect(0, 0, w, h); x.fillStyle = '#15120f';
      for (let k = 0; k < 4; k++) {
        const cx = 64 + k * 128; x.beginPath();
        const s = dir;                      // texture x runs opposite to world when viewed from the front
        x.moveTo(cx - 34 * s, 14); x.lineTo(cx + 22 * s, h / 2); x.lineTo(cx - 34 * s, h - 14); x.lineTo(cx - 60 * s, h - 14); x.lineTo(cx - 4 * s, h / 2); x.lineTo(cx - 60 * s, 14); x.fill();
      }
    }),
  });
  const mats = { 1: mk(-1), [-1]: mk(1) };   // the board faces the driver, so the canvas reads left-to-right as the driver sees it
  for (const nt of T.notes) {
    if (nt.sev > 3) continue;
    const i = Math.min(T.n - 1, nt.i + Math.round((nt.end - nt.i) * 0.45)), out = -nt.dir, o = out * (HALF_W + VERGE + 1.2);
    const lx = T.tz[i], lz = -T.tx[i], X = T.px[i] + lx * o, Z = T.pz[i] + lz * o;
    const g = new THREE.Group(), face = mats[nt.dir];
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.06), [wood, wood, wood, wood, face, wood]);
    b.position.y = 1.15; b.castShadow = true; g.add(b);
    for (const s of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.6, 0.09), wood); p.position.set(s, 0.6, -0.06); g.add(p); }
    g.position.set(X, T.ground(X, Z, i), Z);
    // face back towards the approach, roughly along the incoming road
    const a = Math.max(0, nt.i - 6);
    g.rotation.y = Math.atan2(-T.tx[a], -T.tz[a]);
    scene.add(g); solid.push([X, Z, 0.35]);
  }
  return solid;
}

function buildSky(c, sunDir, fog) {
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: sunDir }, fogc: { value: fog }, zen: { value: v3(c.zen) }, mid: { value: v3(c.mid) }, hor0: { value: v3(c.hor) }, horSun: { value: v3(c.horSun) },
      cloudA: { value: v3(c.cloudA) }, cloudB: { value: v3(c.cloudB) }, stars: { value: c.stars } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 d; uniform vec3 sun, fogc, zen, mid, hor0, horSun, cloudA, cloudB; uniform float stars;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+7.1; a*=0.5; } return s; }
      void main(){ vec3 n = normalize(d); float h = clamp(n.y, -0.2, 1.0);
        float toward = max(0.0, dot(normalize(vec3(n.x,0.0,n.z)), normalize(vec3(sun.x,0.0,sun.z))));
        vec3 hor = mix(hor0, horSun, pow(toward,2.5));
        vec3 c = mix(hor, mid, smoothstep(0.0,0.20,h)); c = mix(c, zen, smoothstep(0.12,0.7,h));
        vec2 cp = n.xz/(max(h,0.0)+0.22)*1.3;
        float cl = smoothstep(0.48,0.78,fbm(cp+vec2(3.0,1.0)));
        vec3 cc = mix(cloudA, cloudB, pow(toward,1.5)*smoothstep(0.5,0.0,h));
        c = mix(c, cc, cl*0.75*smoothstep(0.02,0.12,h));
        vec2 sp = floor(n.xz/(n.y+0.4)*220.0); float st = step(0.9965,h21(sp))*smoothstep(0.25,0.6,h)*(1.0-cl);
        c += vec3(0.7,0.75,1.0)*st*stars;
        c = mix(fogc, c, smoothstep(-0.02,0.07,h));
        gl_FragColor = vec4(c,1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

export function buildWorld(scene, T, c, gfx) {
  const root = new THREE.Group(); scene.add(root);
  const fog = new THREE.Color(c.fog[0], c.fog[1], c.fog[2]), sunDir = new THREE.Vector3(c.sunDir[0], c.sunDir[1], c.sunDir[2]).normalize();
  scene.fog = new THREE.FogExp2(fog, c.fogD);
  scene.background = fog;
  const sky = buildSky(c, sunDir, fog); root.add(sky);
  root.add(buildRoad(T));
  const terr = buildTerrain(T); root.add(terr.mesh);
  root.add(gate(T, T.startI + 5, 'STAGE START', '#e8a01c'));
  root.add(gate(T, T.finishI, 'FLYING FINISH', '#c9402a'));
  const solid = cornerBoards(root, T);
  for (const gi of [T.startI + 5, T.finishI]) for (const sd of [-1, 1]) {
    const o = sd * (HALF_W + 1.3); solid.push([T.px[gi] + T.tz[gi] * o, T.pz[gi] - T.tx[gi] * o, 0.1]);      // gate posts
  }
  const forest = buildForest(root, T, terr, gfx, solid);

  root.add(new THREE.HemisphereLight(c.hemiSky, c.hemiGround, c.hemiI));
  const sun = new THREE.DirectionalLight(c.sunCol, c.sunI);
  if (gfx.shadow) {
    sun.castShadow = true; sun.shadow.mapSize.set(gfx.shadow, gfx.shadow);
    const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.07;
  }
  root.add(sun); root.add(sun.target);

  const update = (camPos, focus) => {
    sky.position.copy(camPos);
    const sx = Math.round(focus.x / 4) * 4, sz = Math.round(focus.z / 4) * 4;
    sun.target.position.set(sx, focus.y, sz);
    sun.position.set(sx, focus.y, sz).addScaledVector(sunDir, 150);
    for (const m of forest.cull) { const b = m.boundingSphere; m.visible = b.center.distanceTo(camPos) - b.radius < 340; }
    for (const m of forest.cullNear) { const b = m.boundingSphere; m.visible = b.center.distanceTo(camPos) - b.radius < 95; }
  };
  const dispose = () => {
    scene.remove(root);
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); if (o.shadow && o.shadow.map) o.shadow.map.dispose(); });
  };
  return { update, dispose, sky, fog, cond: c, trees: forest.query, treeCount: forest.count };
}
