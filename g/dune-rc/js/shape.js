// Collision shapes taken from what you actually see.
// Every solid thing in the game (cars, wheels, trailer, each piece of litter, rocks, the camp) gets its collision shape
// from its own 3D model: the model is filled with little cubes, and the cubes are then covered with balls that sit
// INSIDE the visible surface and reach out to it. So nothing is hit where there is nothing to see, and there are no
// gaps to slip through.
// (The filling is done by looking at the model along its three axes, so a hole you can see through, like the middle
// of a tyre, stays a hole; a hollow you cannot see through, like the inside of a closed box, is solid.)
import * as THREE from 'three';

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), P = new THREE.Vector3(), M = new THREE.Matrix4(), INV = new THREE.Matrix4();
const cache = new Map();

// objects: one Object3D or a list of them. frame: the Object3D whose local space the balls are given in (null = world).
// skip: objects (and everything under them) to leave out. max: most balls allowed.
// Returns { balls: [[x, y, z, r], ...], reach, r2, min: [x,y,z], max: [x,y,z], missed }
export function fitBalls(objects, { frame = null, skip = [], max = 64, key = null, res = 32 } = {}) {
  if (key && cache.has(key)) return cache.get(key);
  const list = Array.isArray(objects) ? objects : [objects];
  if (frame) { frame.updateMatrixWorld(true); INV.copy(frame.matrixWorld).invert(); } else INV.identity();
  const tris = [];
  const skipped = o => { for (let p = o; p; p = p.parent) if (skip.includes(p)) return true; return false; };
  for (const root of list) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh || !o.visible || skipped(o) || o.userData.noHit) return;
      const g = o.geometry, p = g.attributes.position; if (!p) return;
      M.multiplyMatrices(INV, o.matrixWorld);
      const idx = g.index, n = idx ? idx.count : p.count;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) { const vi = idx ? idx.getX(i + k) : i + k; a.fromBufferAttribute(p, vi).applyMatrix4(M); tris.push(a.x, a.y, a.z); }
      }
    });
  }
  const out = { balls: [], reach: 0, r2: 0, min: [0, 0, 0], max: [0, 0, 0], missed: 0 };
  if (!tris.length) { if (key) cache.set(key, out); return out; }
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { const v = tris[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const dim = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map(d => Math.max(d, 1e-4));
  const longest = Math.max(...dim), thin = Math.min(...dim);
  // cube size: as thin as the thinnest part where that is practical, never coarser than 1/res (1/32 unless told) or finer than 1/40 of the length.
  // If that needs more balls than allowed, the cubes are made a little bigger and it is done again.
  let base = Math.min(longest / res, Math.max(thin, longest / 40));
  const tol = Math.min(0.25 * thin, 0.04 * longest);
  for (let tries = 0; tries < 10; tries++) { fill(base); if (out.missed < 0.005) break; base *= 1.2; }
  for (const q of out.balls) { const r = Math.hypot(q[0], q[1], q[2]); out.r2 = Math.max(out.r2, r * r); out.reach = Math.max(out.reach, r + q[3]); }
  out.min = lo; out.max = hi;
  if (key) cache.set(key, out);
  return out;

  function fill(size) {
    let nx, ny, nz;
    for (let tries = 0; tries < 8; tries++) {
      nx = Math.max(1, Math.round(dim[0] / size)); ny = Math.max(1, Math.round(dim[1] / size)); nz = Math.max(1, Math.round(dim[2] / size));
      if (nx * ny * nz <= 60000) break; size *= 1.3;
    }
    const cell = [dim[0] / nx, dim[1] / ny, dim[2] / nz];
    const cmin = Math.min(...cell), N = nx * ny * nz, at = (i, j, k) => (k * ny + j) * nx + i;
    // 1. which cubes does the surface pass through, and where in the cube it is
    const cnt = new Uint16Array(N), sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N);
    const mark = v => {
      const s = at(Math.min(nx - 1, Math.max(0, Math.floor((v.x - lo[0]) / cell[0]))), Math.min(ny - 1, Math.max(0, Math.floor((v.y - lo[1]) / cell[1]))), Math.min(nz - 1, Math.max(0, Math.floor((v.z - lo[2]) / cell[2]))));
      if (cnt[s] < 60000) { cnt[s]++; sx[s] += v.x; sy[s] += v.y; sz[s] += v.z; }
    };
    for (let i = 0; i < tris.length; i += 9) {
      a.set(tris[i], tris[i + 1], tris[i + 2]); b.set(tris[i + 3], tris[i + 4], tris[i + 5]); c.set(tris[i + 6], tris[i + 7], tris[i + 8]);
      const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), n = Math.min(160, Math.max(1, Math.ceil(e / (cmin * 0.5))));
      for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
        const fu = u / n, fv = v / n, fw = 1 - fu - fv;
        P.set(a.x * fw + b.x * fu + c.x * fv, a.y * fw + b.y * fu + c.y * fv, a.z * fw + b.z * fu + c.z * fv); mark(P);
      }
    }
    // 2. fill it in: a cube is solid if, looking along every axis, it lies between two bits of surface
    const solid = new Uint8Array(N).fill(1);
    const sweep = (na, nb, nc, idx) => {
      for (let q = 0; q < nb; q++) for (let r = 0; r < nc; r++) {
        let first = -1, last = -1;
        for (let p = 0; p < na; p++) if (cnt[idx(p, q, r)]) { if (first < 0) first = p; last = p; }
        for (let p = 0; p < na; p++) if (p < first || p > last) solid[idx(p, q, r)] = 0;
      }
    };
    sweep(nx, ny, nz, (p, q, r) => at(p, q, r)); sweep(ny, nx, nz, (p, q, r) => at(q, p, r)); sweep(nz, nx, ny, (p, q, r) => at(q, r, p));
    // the cubes of the outside skin: surface cubes with nothing beyond them on some side
    const open = (i, j, k) => i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz || !solid[at(i, j, k)];
    const skin = new Uint8Array(N);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const s = at(i, j, k); if (!solid[s] || !cnt[s]) continue;
      if (open(i - 1, j, k) || open(i + 1, j, k) || open(i, j - 1, k) || open(i, j + 1, k) || open(i, j, k - 1) || open(i, j, k + 1)) { skin[s] = 1; sx[s] /= cnt[s]; sy[s] /= cnt[s]; sz[s] /= cnt[s]; }
    }
    // 3. how deep inside is each solid cube (distance to the nearest empty one, or to the edge of the grid)
    const D = new Float32Array(N);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const s = at(i, j, k); D[s] = solid[s] ? Math.min((Math.min(i, nx - 1 - i) + 1) * cell[0], (Math.min(j, ny - 1 - j) + 1) * cell[1], (Math.min(k, nz - 1 - k) + 1) * cell[2]) : 0;
    }
    const pass = dir => {
      const i0 = dir > 0 ? 0 : nx - 1, j0 = dir > 0 ? 0 : ny - 1, k0 = dir > 0 ? 0 : nz - 1;
      for (let k = k0; k >= 0 && k < nz; k += dir) for (let j = j0; j >= 0 && j < ny; j += dir) for (let i = i0; i >= 0 && i < nx; i += dir) {
        const s = at(i, j, k); if (!solid[s]) continue; let d = D[s];
        for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if ((dk * 9 + dj * 3 + di) * dir >= 0) continue;
          const ii = i + di, jj = j + dj, kk = k + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          const nd = D[at(ii, jj, kk)] + Math.hypot(di * cell[0], dj * cell[1], dk * cell[2]); if (nd < d) d = nd;
        }
        D[s] = d;
      }
    };
    pass(1); pass(-1);
    // 4. cover the solid cubes with balls, biggest first. Each ball is grown until it just touches the real surface.
    const order = []; for (let s = 0; s < N; s++) if (solid[s]) order.push(s);
    order.sort((p, q) => D[q] - D[p]);
    const covered = new Uint8Array(N), balls = out.balls = [];
    for (const s of order) {
      if (covered[s]) continue; if (balls.length >= max) break;
      const i = s % nx, j = Math.floor(s / nx) % ny, k = Math.floor(s / (nx * ny));
      const x = lo[0] + (i + 0.5) * cell[0], y = lo[1] + (j + 0.5) * cell[1], z = lo[2] + (k + 0.5) * cell[2];
      // the true distance from here to the outside skin (also never past the edge of the model's own box)
      let R = Math.min(x - lo[0], hi[0] - x, y - lo[1], hi[1] - y, z - lo[2], hi[2] - z);
      const look = D[s] + cmin, li = Math.ceil(look / cell[0]), lj = Math.ceil(look / cell[1]), lk = Math.ceil(look / cell[2]);
      for (let dk = -lk; dk <= lk; dk++) for (let dj = -lj; dj <= lj; dj++) for (let di = -li; di <= li; di++) {
        const ii = i + di, jj = j + dj, kk = k + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
        const t = at(ii, jj, kk); if (!skin[t]) continue;
        const d = Math.hypot(sx[t] - x, sy[t] - y, sz[t] - z); if (d < R) R = d;
      }
      R = Math.max(R, 0.4 * cmin);
      balls.push([x, y, z, R]);
      const cover = R + cmin * 0.3 + tol, ri = Math.ceil(cover / cell[0]), rj = Math.ceil(cover / cell[1]), rk = Math.ceil(cover / cell[2]);
      for (let dk = -rk; dk <= rk; dk++) for (let dj = -rj; dj <= rj; dj++) for (let di = -ri; di <= ri; di++) {
        const ii = i + di, jj = j + dj, kk = k + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
        if (Math.hypot(di * cell[0], dj * cell[1], dk * cell[2]) <= cover) covered[at(ii, jj, kk)] = 1;
      }
    }
    let left = 0; for (const s of order) if (!covered[s]) left++;
    out.missed = order.length ? left / order.length : 0;
  }
}

// thin wire balls so a shape can be looked at (testing only; never shown in the game)
export function showBalls(shape, color = 0x00ff88) {
  const g = new THREE.Group(), geo = new THREE.SphereGeometry(1, 10, 8), m = new THREE.MeshBasicMaterial({ color, wireframe: true });
  for (const q of shape.balls) { const s = new THREE.Mesh(geo, m); s.position.set(q[0], q[1], q[2]); s.scale.setScalar(q[3]); s.userData.noHit = true; g.add(s); }
  return g;
}
