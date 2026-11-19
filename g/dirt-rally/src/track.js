// Stage generator: seeded centreline, road height, ground function, pacenotes.
// Convention everywhere: +Y up, car forward = local +Z, car left = local +X.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

export const DS = 2;          // metres between centreline samples
export const HALF_W = 3.0;    // road half width
export const VERGE = 2.5;     // ditch / shoulder width
const BLEND = 28;             // metres over which terrain returns to natural height
const CELL = 40;

export function buildTrack(seed = 7, o = {}) {
  const R = rng(seed * 7919 + 13);

  // --- control points -------------------------------------------------------
  const cps = [];
  let h = 0, x = 0, z = 0;
  cps.push([-80, 0], [0, 0]);
  x = 0; z = 0;
  const nSeg = o.nSeg || 36, twist = o.twist || 1.5, hair = o.hairpin === undefined ? 0.2 : o.hairpin;
  for (let i = 0; i < nSeg; i++) {
    const len = i < 2 ? 70 : 55 + R() * 55;
    let turn = (R() - 0.5) * twist;
    if (i > 2 && R() < hair) turn = (R() < 0.5 ? -1 : 1) * (1.1 + R() * 0.8);
    if (i < 2) turn = 0;
    if (h + turn > 1.25) turn = -Math.abs(turn);
    if (h + turn < -1.25) turn = Math.abs(turn);
    h += turn;
    x += Math.cos(h) * len; z += Math.sin(h) * len;
    cps.push([x, z]);
  }
  cps.push([x + Math.cos(h) * 80, z + Math.sin(h) * 80]);

  // --- Catmull-Rom, then uniform resample ----------------------------------
  const dense = [];
  for (let i = 1; i < cps.length - 2; i++) {
    const p0 = cps[i - 1], p1 = cps[i], p2 = cps[i + 1], p3 = cps[i + 2];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const px = [], pz = [];
  let acc = 0; px.push(dense[0][0]); pz.push(dense[0][1]);
  for (let i = 1; i < dense.length; i++) {
    let ax = dense[i - 1][0], az = dense[i - 1][1];
    const bx = dense[i][0], bz = dense[i][1];
    let seg = Math.hypot(bx - ax, bz - az);
    while (acc + seg >= DS) {
      const t = (DS - acc) / seg;
      ax += (bx - ax) * t; az += (bz - az) * t;
      px.push(ax); pz.push(az);
      seg = Math.hypot(bx - ax, bz - az); acc = 0;
    }
    acc += seg;
  }
  const n = px.length;

  // --- tangents, curvature --------------------------------------------------
  const tx = new Float32Array(n), tz = new Float32Array(n), curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  for (let i = 2; i < n - 2; i++) {
    // signed curvature, positive = turning left (towards +left vector)
    const cr = tz[i - 2] * tx[i + 2] - tx[i - 2] * tz[i + 2];
    curv[i] = Math.asin(Math.max(-1, Math.min(1, cr))) / (4 * DS);
  }

  // --- natural terrain + smoothed road height ------------------------------
  const base = (X, Z) =>
    34 * noise2(X / 300, Z / 300, seed) + 9 * noise2(X / 85, Z / 85, seed + 1) + 2.2 * noise2(X / 24, Z / 24, seed + 2);
  let py = new Float32Array(n);
  for (let i = 0; i < n; i++) py[i] = base(px[i], pz[i]);
  for (let pass = 0; pass < 3; pass++) {
    const o = new Float32Array(n), w = 10;
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -w; k <= w; k++) { const j = Math.min(n - 1, Math.max(0, i + k)); s += py[j]; c++; }
      o[i] = s / c;
    }
    py = o;
  }

  // --- spatial hash ----------------------------------------------------------
  const cells = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(px[i] / CELL), Math.floor(pz[i] / CELL));
    let a = cells.get(k); if (!a) cells.set(k, a = []);
    a.push(i);
  }

  const T = {
    seed, n, px, pz, py, tx, tz, curv, base,
    startI: 45, finishI: n - 50,
    // results of the last query
    qi: 0, qf: 0, qd: 0, qy: 0, qa: 1e9,
  };
  T.length = (T.finishI - T.startI) * DS;

  // Finds nearest centreline point. Returns false when far from the road.
  T.nearest = (X, Z, hint = -1) => {
    let best = -1, bd = 1e18;
    if (hint >= 0) {
      const lo = Math.max(0, hint - 14), hi = Math.min(n - 1, hint + 14);
      for (let i = lo; i <= hi; i++) {
        const dx = X - px[i], dz = Z - pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      if (bd > 3600) best = -1, bd = 1e18;
    }
    if (best < 0) {
      const cx = Math.floor(X / CELL), cz = Math.floor(Z / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = cells.get(key(cx + a, cz + b)); if (!arr) continue;
        for (let q = 0; q < arr.length; q++) {
          const i = arr[q], dx = X - px[i], dz = Z - pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best < 0) { T.qa = 1e9; return false; }
    }
    let i = best;
    let u = ((X - px[i]) * tx[i] + (Z - pz[i]) * tz[i]) / DS;
    if (u < 0 && i > 0) { i--; u += 1; }
    if (i >= n - 1) { i = n - 2; u = 1; }
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cxp = px[i] + (px[i + 1] - px[i]) * u, czp = pz[i] + (pz[i + 1] - pz[i]) * u;
    const ttx = tx[i] + (tx[i + 1] - tx[i]) * u, ttz = tz[i] + (tz[i + 1] - tz[i]) * u;
    // left vector = (tz, -tx)
    T.qd = (X - cxp) * ttz - (Z - czp) * ttx;
    T.qa = Math.hypot(X - cxp, Z - czp);
    T.qy = py[i] + (py[i + 1] - py[i]) * u;
    T.qi = i; T.qf = u;
    return true;
  };

  // Ground height. Sets T.qa (distance from centreline) and T.qi as a side effect.
  T.ground = (X, Z, hint = -1) => {
    if (!T.nearest(X, Z, hint)) return base(X, Z);
    const a = T.qa, ry = T.qy;
    if (a <= HALF_W) return ry - 0.012 * a * a * 0.3;
    if (a <= HALF_W + VERGE) return ry - 0.04 - 0.38 * smooth((a - HALF_W) / VERGE);
    const k = smooth((a - HALF_W - VERGE) / BLEND);
    const rough = 0.16 * (noise2(X / 1.9, Z / 1.9, seed + 5) - 0.5) * Math.min(1, (a - HALF_W - VERGE) / 3);
    return (ry - 0.42) * (1 - k) + base(X, Z) * k + rough;
  };

  // Surface grip info at last query: 0 = road, 1 = fully off-road
  T.offroad = () => smooth((T.qa - HALF_W + 0.3) / 1.2);

  // --- pacenotes -------------------------------------------------------------
  const notes = [];
  const sev = (r) => r < 16 ? 1 : r < 26 ? 2 : r < 40 ? 3 : r < 62 ? 4 : r < 95 ? 5 : 6;
  let i = T.startI;
  while (i < T.finishI) {
    if (Math.abs(curv[i]) > 1 / 170) {
      const dir = Math.sign(curv[i]); let j = i, mx = 0;
      while (j < T.finishI && Math.sign(curv[j]) === dir && Math.abs(curv[j]) > 1 / 230) { mx = Math.max(mx, Math.abs(curv[j])); j++; }
      const len = (j - i) * DS;
      if (len > 8) notes.push({ i, end: j, dir, sev: sev(1 / mx), long: len > 70 });
      i = j + 1;
    } else i++;
  }
  T.notes = notes;
  T.noteText = (nt) => {
    const d = nt.dir > 0 ? 'left' : 'right';
    const s = nt.sev === 1 ? 'hairpin ' + d : d + ' ' + nt.sev;
    return s + (nt.long ? ' long' : '');
  };
  return T;
}
