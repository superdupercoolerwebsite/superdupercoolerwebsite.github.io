// The sand around the car as a real, changeable surface.
// A grid of numbers: "how many metres higher or lower than the untouched dune is the sand here".
// Wheels press it down and scrape it out, thrown grains land and raise it, steep sides slump.
// The car's physics drives on it and the sand shader draws it.
import * as THREE from 'three';

export const NF = 4096;                 // cells per side
export const CELL = 1 / 128;            // 7.8 mm
export const FIELD_SPAN = NF * CELL;    // 32 m; everything within 16 m of the car is kept
const MASK = NF - 1;
const TN = NF / 64, TM = TN - 1;         // the grid in squares of 64 cells, for sending changes to the graphics card
const REPOSE = 0.62 * CELL;             // steepest stable step between two cells (about 32 degrees)

export class SandField {
  constructor(renderer) {
    this.renderer = renderer;
    this.d = new Float32Array(NF * NF);
    this.tex = new THREE.DataTexture(this.d, NF, NF, THREE.RedFormat, THREE.FloatType);
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    const lin = !!renderer.extensions.get('OES_texture_float_linear');
    this.tex.minFilter = this.tex.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter;
    this.tex.generateMipmaps = false; this.tex.needsUpdate = true;
    renderer.initTexture(this.tex);
    this.ci = null; this.cj = null;
    this.rects = [];
    this.zones = [];           // places where sand is still settling
  }

  // ---- reading ----
  height(x, z) {
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, d = this.d;
    const r0 = (j & MASK) * NF, r1 = ((j + 1) & MASK) * NF, c0 = i & MASK, c1 = (i + 1) & MASK;
    return (d[r0 + c0] * (1 - u) + d[r0 + c1] * u) * (1 - v) + (d[r1 + c0] * (1 - u) + d[r1 + c1] * u) * v;
  }

  // What a wheel or the chassis feels: add the dug/piled sand to a ground sample `out` {h, nx, ny, nz, sink}.
  // A tyre is 11 cm across: it rides on the sand over its whole footprint and cannot feel a 1.5 cm step,
  // so the height is read over a 5 cm circle. `sink` = how far the spot sits below the sand around it (m).
  applyTo(x, z, out) {
    out.sink = 0;
    const c = this.height(x, z);
    const a = 0.028, b = 0.05;
    const r1 = this.height(x + a, z) + this.height(x - a, z) + this.height(x, z + a) + this.height(x, z - a);
    const r2 = this.height(x + b, z + b) + this.height(x - b, z + b) + this.height(x + b, z - b) + this.height(x - b, z - b);
    if (c === 0 && r1 === 0 && r2 === 0) return;
    const under = (c + r1) / 5, around = r2 / 4;
    out.h += 0.6 * under + 0.4 * around;
    out.sink = Math.max(0, around - under);
  }

  // ---- keeping the window centred on the car: sand that scrolls out of range is forgotten ----
  recenter(x, z) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    if (this.ci === null) { this.ci = ci; this.cj = cj; return; }
    const di = ci - this.ci, dj = cj - this.cj;
    if (Math.abs(di) >= NF || Math.abs(dj) >= NF) { this.d.fill(0); this.mark(ci - NF / 2, cj - NF / 2, ci + NF / 2 - 1, cj + NF / 2 - 1); }
    else {
      if (di > 0) this.clear(this.ci + NF / 2, cj - NF / 2, ci + NF / 2 - 1, cj + NF / 2 - 1);
      if (di < 0) this.clear(ci - NF / 2, cj - NF / 2, this.ci - NF / 2 - 1, cj + NF / 2 - 1);
      if (dj > 0) this.clear(ci - NF / 2, this.cj + NF / 2, ci + NF / 2 - 1, cj + NF / 2 - 1);
      if (dj < 0) this.clear(ci - NF / 2, cj - NF / 2, ci + NF / 2 - 1, this.cj - NF / 2 - 1);
    }
    this.ci = ci; this.cj = cj;
  }
  clear(i0, j0, i1, j1) {
    for (let j = j0; j <= j1; j++) { const r = (j & MASK) * NF; for (let i = i0; i <= i1; i++) this.d[r + (i & MASK)] = 0; }
    this.mark(i0, j0, i1, j1);
  }
  // Note which part of the grid changed. The grid is cut into squares of 64 x 64 cells; only squares that changed are
  // sent to the graphics card (a grain landing ten metres away must not make the whole area in between be sent again).
  mark(i0, j0, i1, j1) {
    const T = this.dirty || (this.dirty = new Uint8Array(TN * TN));
    if (i1 - i0 >= NF - 1) { i0 = 0; i1 = NF - 1; } if (j1 - j0 >= NF - 1) { j0 = 0; j1 = NF - 1; }
    const a0 = i0 >> 6, a1 = i1 >> 6, b0 = j0 >> 6, b1 = j1 >> 6;
    for (let b = b0; b <= b1; b++) { const r = (b & TM) * TN; for (let a = a0; a <= a1; a++) T[r + (a & TM)] = 1; }
    this.any = true;
  }

  // ---- changing ----
  // A tyre rolling from (x0,z0) to (x1,z1): packs the sand under it down to `depth` (deeper stays deeper),
  // squeezing some out into a low ridge on each side. `trav` = distance rolled so far, for the tread bars.
  press(x0, z0, x1, z1, half, depth, trav) {
    let dx = x1 - x0, dz = z1 - z0; const L = Math.hypot(dx, dz);
    if (L > 1e-6) { dx /= L; dz /= L; } else { dx = 1; dz = 0; }
    const reach = half + 3 * CELL;
    const i0 = Math.floor((Math.min(x0, x1) - reach) / CELL), i1 = Math.floor((Math.max(x0, x1) + reach) / CELL);
    const j0 = Math.floor((Math.min(z0, z1) - reach) / CELL), j1 = Math.floor((Math.max(z0, z1) + reach) / CELL);
    const d = this.d; let vol = 0, nb = 0;
    for (let pass = 0; pass < 2; pass++) {
      const add = pass && nb ? vol * 0.45 / nb : 0;               // the rest is packed tighter, not moved
      if (pass && !add) break;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * CELL - x0, pz = (j + 0.5) * CELL - z0;
        const a = px * dx + pz * dz, b = Math.abs(-px * dz + pz * dx);
        if (a < -0.012 || a > L + 0.012) continue;
        const k = (j & MASK) * NF + (i & MASK);
        if (b < half) {
          if (pass) continue;
          const edge = Math.min(1, (half - b) / CELL + 0.35);     // tyre shoulders are rounded
          const want = -depth * edge * (0.72 + 0.56 * ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 100) / 100);   // sand packs unevenly
          if (d[k] > want) { vol += d[k] - want; d[k] = want; }
        } else if (b < half + 2.2 * CELL) { if (pass) d[k] += add; else nb++; }
      }
    }
    this.mark(i0, j0, i1, j1);
  }

  // A spinning or sliding tyre scraping sand away along (x0,z0)-(x1,z1). Takes `dz` metres off the patch
  // (spread along the path) and returns the volume removed in m^3.
  // If (sx,sz) is given the sand is shoved that way into a ridge instead, and 0 is returned.
  scoop(x0, z0, x1, z1, half, dz, sx, sz) {
    let dx = x1 - x0, dzz = z1 - z0; const L = Math.hypot(dx, dzz);
    if (L > 1e-6) { dx /= L; dzz /= L; } else { dx = 1; dzz = 0; }
    const cut = dz * (2 * half) / (L + 2 * half);                 // same sand removed, spread over a longer strip
    const i0 = Math.floor((Math.min(x0, x1) - half) / CELL), i1 = Math.floor((Math.max(x0, x1) + half) / CELL);
    const j0 = Math.floor((Math.min(z0, z1) - half) / CELL), j1 = Math.floor((Math.max(z0, z1) + half) / CELL);
    const d = this.d; let cells = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * CELL - x0, pz = (j + 0.5) * CELL - z0;
      const a = px * dx + pz * dzz, b = Math.abs(-px * dzz + pz * dx);
      if (b > half || a < -half || a > L + half) continue;
      d[(j & MASK) * NF + (i & MASK)] -= cut; cells++;
    }
    const vol = cells * cut * CELL * CELL;
    let m0 = i0, m1 = i1, n0 = j0, n1 = j1;
    if (sx !== undefined && cells) {
      const side = Math.sign(-sx * dzz + sz * dx) || 1, w = 3 * CELL;      // which side of the path the sand is shoved to
      m0 = Math.floor((Math.min(x0, x1) - half - w) / CELL); m1 = Math.floor((Math.max(x0, x1) + half + w) / CELL);
      n0 = Math.floor((Math.min(z0, z1) - half - w) / CELL); n1 = Math.floor((Math.max(z0, z1) + half + w) / CELL);
      let nb = 0;
      for (let pass = 0; pass < 2; pass++) {
        const add = pass ? vol / (CELL * CELL) / nb : 0;
        if (pass && !nb) break;
        for (let j = n0; j <= n1; j++) for (let i = m0; i <= m1; i++) {
          const px = (i + 0.5) * CELL - x0, pz = (j + 0.5) * CELL - z0;
          const a = px * dx + pz * dzz, b = (-px * dzz + pz * dx) * side;
          if (b <= half || b > half + w || a < -half || a > L + half) continue;
          if (pass) d[(j & MASK) * NF + (i & MASK)] += add; else nb++;
        }
      }
    }
    this.mark(m0, n0, m1, n1);
    return sx !== undefined ? 0 : vol;
  }

  // a grain (or clump) of volume `vol` coming to rest here
  deposit(x, z, vol) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    this.d[(j & MASK) * NF + (i & MASK)] += vol / (CELL * CELL);
    this.mark(i, j, i, j);
  }

  // Sand cannot stand steeper than its angle of repose: anything steeper slides until it can.
  // (gx, gz) is how the untouched dune itself slopes here, so on a dune face the sand above a hole runs down into it.
  // It also rounds off sharp edges a little each time, the way loose sand never keeps a crisp corner.
  slump(x, z, r, gx = 0, gz = 0) {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    const d = this.d, cap = REPOSE * 0.97;                      // an untouched face, however steep, never flows by itself
    const bx = Math.max(-cap, Math.min(cap, gx * CELL)), bz = Math.max(-cap, Math.min(cap, gz * CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = (j & MASK) * NF + (i & MASK), kr = (j & MASK) * NF + ((i + 1) & MASK), kd = ((j + 1) & MASK) * NF + (i & MASK);
      let e = d[k] - d[kr] - bx;                                 // how much higher this cell's sand stands than its neighbour's
      if (e > REPOSE) { e = (e - REPOSE) * 0.3; d[k] -= e; d[kr] += e; } else if (e < -REPOSE) { e = (e + REPOSE) * 0.3; d[k] -= e; d[kr] += e; }
      e = d[k] - d[kd] - bz;
      if (e > REPOSE) { e = (e - REPOSE) * 0.3; d[k] -= e; d[kd] += e; } else if (e < -REPOSE) { e = (e + REPOSE) * 0.3; d[k] -= e; d[kd] += e; }
      const kl = (j & MASK) * NF + ((i - 1) & MASK), ku = ((j - 1) & MASK) * NF + (i & MASK);
      if (d[k] !== 0 || d[kr] !== 0 || d[kl] !== 0 || d[kd] !== 0 || d[ku] !== 0) d[k] += 0.05 * ((d[kr] + d[kl] + d[kd] + d[ku]) * 0.25 - d[k]);
    }
    this.mark(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }

  // Something hit the sand hard: a bowl is punched out, some of the sand is heaped into a rim, the rest is thrown.
  // Returns the volume thrown (m^3).
  crater(x, z, R, depth) {
    const R2 = R * 1.4, i0 = Math.floor((x - R2) / CELL), i1 = Math.floor((x + R2) / CELL), j0 = Math.floor((z - R2) / CELL), j1 = Math.floor((z + R2) / CELL);
    const d = this.d; let vol = 0, rim = 0;
    for (let pass = 0; pass < 2; pass++) {
      const add = pass && rim ? vol * 0.4 / rim : 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * CELL - x, pz = (j + 0.5) * CELL - z, q = Math.hypot(px, pz) / R, k = (j & MASK) * NF + (i & MASK);
        if (q < 1) { if (!pass) { const dig = depth * (1 - q * q) * (0.8 + 0.4 * (((i * 73856093) ^ (j * 19349663)) >>> 0) % 100 / 100); d[k] -= dig; vol += dig; } }
        else if (q < 1.4) { if (pass) d[k] += add * (1.4 - q) * 5; else rim += (1.4 - q) * 5; }
      }
    }
    this.mark(i0, j0, i1, j1);
    this.zones.push({ x, z, r: R * 2.2, ttl: 2.5 });              // sand keeps trickling into it for a couple of seconds
    return vol * 0.6 * CELL * CELL;
  }

  // every frame: let disturbed sand keep settling for a while (holes fill from above, heaps spread)
  settle(dt, slopeAt) {
    for (let n = this.zones.length - 1; n >= 0; n--) {
      const zn = this.zones[n]; const g = slopeAt(zn.x, zn.z);
      this.slump(zn.x, zn.z, zn.r, -g.nx / g.ny, -g.nz / g.ny);
      if ((zn.ttl -= dt) <= 0) this.zones.splice(n, 1);
    }
  }

  // ---- send what changed to the graphics card (once per frame) ----
  flush() {
    if (!this.any) return; this.any = false;
    const T = this.dirty, gl = this.renderer.getContext(), handle = this.renderer.properties.get(this.tex).__webglTexture;
    if (!handle) { this.tex.needsUpdate = true; T.fill(0); return; }
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    const d = this.d, buf = this.buf || (this.buf = new Float32Array(NF * 64));
    for (let b = 0; b < TN; b++) {
      const r = b * TN;
      for (let a = 0; a < TN; a++) {
        if (!T[r + a]) continue;
        // a run of changed squares side by side goes up in one piece
        let e = a; while (e + 1 < TN && T[r + e + 1]) e++;
        const x0 = a * 64, w = (e - a + 1) * 64, y0 = b * 64;
        for (let j = 0; j < 64; j++) buf.set(d.subarray((y0 + j) * NF + x0, (y0 + j) * NF + x0 + w), j * w);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, 64, gl.RED, gl.FLOAT, buf.subarray(0, w * 64));
        for (let k = a; k <= e; k++) T[r + k] = 0;
        a = e;
      }
    }
    this.renderer.resetState();
  }
}
