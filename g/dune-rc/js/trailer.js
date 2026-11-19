// The trailer as a real body: it has its own weight, its own two tyres on the sand, and it is joined to the car
// only at the coupling. The car pulls and pushes it there, and it pulls and pushes the car back.
// That is what makes it jack-knife when you reverse, shove the car's tail when you brake in a turn,
// and slide wide when you take a corner too fast with a heavy load.
// It stands on its two tyres separately: each one carries its own share of the weight, so the trailer leans on a
// side slope, rocks over bumps, lifts a wheel in a hard corner and can go right over onto its side.
// Simplification, said plainly: it is three linked motions (sliding and turning on the ground, height, and lean)
// rather than one full 3D body like the car. Its nose-up / nose-down angle simply follows the tow bar.
const G = 9.81, MU = 1.15;

export class Trailer {
  constructor() {
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0; this.th = 0; this.w = 0; this.live = false; this.ax = 0; this.az = 0; this.slide = 0;
    this.y = 0; this.vy = 0; this.roll = 0; this.rw = 0; this.m = 1; this.I = 1; this.Ir = 1;
    this.NL = 0; this.NR = 0; this.Nb = 0; this.Fl = 0; this.vlong = 0; this.vlat = 0; this.air = false;
    const t = this;
    // so that litter can shove it about exactly as it shoves the car
    this.pos = { addScaledVector(n, s) { t.x += n.x * s; t.z += n.z * s; t.y += n.y * s; } };
  }
  get mass() { return this.m; }
  kAt() { return 1 / this.m; }

  // The outline of the model seen from behind (how far out sideways, how far up, how round): these are the points that
  // can touch the sand. Taken from the outermost balls of its shape, all round. (Model units; the box and wheels only:
  // the front of the tow bar is carried by the car.)
  setShape(balls) {
    const pick = new Set(), use = balls.filter(b => Math.abs(b[2]) < 1.5 && !(Math.abs(b[0]) < 0.6 && b[1] - b[3] < -0.3));
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * 6.2832, cx = Math.cos(a), cy = Math.sin(a); let best = -1e9, bi = null;
      for (const b of use) { const s = b[0] * cx + b[1] * cy + b[3]; if (s > best) { best = s; bi = b; } }
      if (bi) pick.add(bi);
    }
    // where the two tyres really are, either side of the centre line (for their tracks)
    for (const sd of [1, -1]) { let sum = 0, n = 0; for (const b of balls) if (b[0] * sd > 0.5 && b[1] - b[3] < -0.3 && Math.abs(b[2]) < 0.6) { sum += b[0]; n++; } if (n) this[sd > 0 ? 'wR' : 'wL'] = sum / n; }
    this.pts = [...pick].map(b => [b[0], b[1], b[3], b[1] - b[3] < -0.2 ? (b[0] > 0 ? 1 : 2) : 0]);
  }

  // a knock at a point (from a piece of litter)
  applyImpulse(J, at) {
    const m = this.m, px = at.x - this.x, pz = at.z - this.z, sx = Math.sin(this.th), sz = Math.cos(this.th);
    this.vx += J.x / m; this.vz += J.z / m; this.vy += J.y / m;
    this.w += (pz * J.x - px * J.z) / this.I;
    this.rw += J.y * ((at.x - this.ax) * sz - (at.z - this.az) * sx) / this.Ir;
  }

  // dt, the car, L = coupling-to-axle length (m), m = trailer + load (kg), H = the tow ball (world), sink = extra sand drag (0..1)
  // gh(x, z) = height of the ground, k = the trailer's scale (wheel radius 0.42 k, wheels 1.0 k either side of centre)
  step(dt, car, L, m, H, sink, gh, k) {
    const c = 0.18 * L, lh = L - c;
    this.m = m; this.I = m * L * L / 5; this.Ir = m * 0.36 * k * k;
    const rx = H.x - car.pos.x, ry = H.y - car.pos.y, rz = H.z - car.pos.z;
    const hvx = car.vel.x + car.w.y * rz - car.w.z * ry, hvz = car.vel.z + car.w.x * ry - car.w.y * rx;
    if (!this.live || Math.hypot(H.x - (this.x + Math.sin(this.th) * lh), H.z - (this.z + Math.cos(this.th) * lh)) > 0.4) {
      // just hitched, or the car was picked up and put down somewhere else: stand it straight behind, on its wheels
      const fl = Math.hypot(car.F.x, car.F.z) || 1, sx = car.F.x / fl, sz = car.F.z / fl;
      this.th = Math.atan2(sx, sz); this.x = H.x - sx * lh; this.z = H.z - sz * lh; this.vx = hvx; this.vz = hvz; this.w = 0; this.live = true;
      this.ax = this.x - sx * c; this.az = this.z - sz * c;
      const a = gh(this.ax + sz * k, this.az - sx * k), b = gh(this.ax - sz * k, this.az + sx * k);
      this.y = (a + b) / 2 + 0.42 * k; this.vy = 0; this.roll = Math.atan2(a - b, 2 * k); this.rw = 0; this.Fl = 0;
    }
    this.stand(dt, car, L, m, H, gh, k);
    for (let i = 0; i < 4; i++) this.sub(dt / 4, car, L, m, H, sink, hvx, hvz);
  }

  // Height and lean. Each tyre is a stiff spring on the sand under it; the top edges of the box touch down if it goes over.
  stand(dt, car, L, m, H, gh, k) {
    const sx = Math.sin(this.th), sz = Math.cos(this.th), r = 0.42 * k, b = k, hc = 0.2 * k;
    const ks = m * G / 2 / 0.005, cs = 1.8 * Math.sqrt(ks * m / 2);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const hR = gh(this.ax + sz * b, this.az - sx * b), hL = gh(this.ax - sz * b, this.az + sx * b);
    // its weight sits above the axle, so once it leans far enough the weight pulls it the rest of the way over
    let fy = -m * G, tq = m * G * hc * sr;
    this.NL = this.NR = this.Nb = 0;
    // until the model has loaded: two wheels and the two top edges of the box
    const pts = this.pts || [[1, 0, 0.42, 1], [-1, 0, 0.42, 2], [0.8, 0.8, 0, 0], [-0.8, 0.8, 0, 0]];
    for (const p of pts) {
      const l = p[0] * k, u = p[1] * k, rad = p[2] * k;
      const lever = l * cr - u * sr, y = this.y + l * sr + u * cr, pen = (lever > 0 ? hR : hL) + rad - y;
      if (pen <= 0) continue;
      const N = Math.min(8 * m * G, Math.max(0, ks * pen - cs * (this.vy + lever * this.rw)));
      fy += N; tq += N * lever;
      if (p[3] === 1) this.NR += N; else if (p[3] === 2) this.NL += N; else this.Nb += N;
    }
    // the sideways grip of the tyres acts down at the sand, below its weight: that is what rolls it outward in a corner
    tq += this.Fl * (r + hc) * cr;
    tq -= this.rw * this.Ir * 0.6;
    this.vy += fy / m * dt; this.y += this.vy * dt;
    this.rw += tq / this.Ir * dt; this.roll += this.rw * dt;
    if (this.roll > Math.PI) this.roll -= 2 * Math.PI; else if (this.roll < -Math.PI) this.roll += 2 * Math.PI;
    // the tow bar can only tilt about 30 degrees on the ball: when the car leaves the ground the coupling lifts the
    // trailer after it, and it flies behind and lands with the car
    const hy = H.y + 0.09 * k, lo = hy - 0.5 * L, hi = hy + 0.5 * L;
    if (this.y < lo) { this.y = lo; this.vy = Math.max(this.vy, car.vel.y); }
    if (this.y > hi) { this.y = hi; this.vy = Math.min(this.vy, car.vel.y); }
    this.air = this.NL + this.NR + this.Nb < 0.02 * m * G;
  }

  sub(dt, car, L, m, H, sink, hvx, hvz) {
    // its weight sits a little ahead of the axle, so some rests on the tow ball
    const c = 0.18 * L, lh = L - c, I = this.I;
    // which way the tow bar points (axle -> coupling)
    const sx = Math.sin(this.th), sz = Math.cos(this.th);
    let fx = 0, fz = 0, tq = 0;
    // a force at a point (px, pz) from its centre
    const push = (px, pz, Fx, Fz) => { fx += Fx; fz += Fz; tq += pz * Fx - px * Fz; };

    // 1. the coupling: a stiff joint between the tow ball and the front of the tow bar
    const cx = sx * lh, cz = sz * lh;
    const ex = H.x - (this.x + cx), ez = H.z - (this.z + cz);
    const cvx = this.vx + this.w * cz, cvz = this.vz - this.w * cx;
    const Fx = 7000 * ex + 95 * (hvx - cvx), Fz = 7000 * ez + 95 * (hvz - cvz);
    push(cx, cz, Fx, Fz);
    this.pull = Math.hypot(Fx, Fz);
    // the same force back on the car, plus the weight on the ball
    car.applyImpulse(V.set(-Fx * dt, -(this.air ? 0.35 : 0.1) * m * G * dt, -Fz * dt), H);

    // 2. the tyres: they roll freely along the trailer but resist going sideways, up to what the sand under them can hold.
    //    A knobbly tyre pushed sideways digs in and piles sand against itself, so it holds more than its weight alone would.
    const axx = -sx * c, axz = -sz * c, N = this.NL + this.NR;
    const avx = this.vx + this.w * axz, avz = this.vz - this.w * axx;
    const vlat = avx * sz - avz * sx, vlong = avx * sx + avz * sz;
    const Fl = Math.max(-MU * N, Math.min(MU * N, -vlat * (40 + 28 * N)));
    const Fr = -Math.max(-1, Math.min(1, vlong * 8)) * (0.06 + 0.25 * sink) * N;
    push(axx, axz, Fl * sz + Fr * sx, -Fl * sx + Fr * sz);
    this.Fl = Fl; this.vlong = vlong; this.vlat = vlat;
    this.slide = N > 0 ? Math.abs(vlat) : 0;

    // 2b. lying on its side, the box drags on the sand
    if (this.Nb > 0) { const v = Math.hypot(avx, avz), f = -0.7 * this.Nb / (v + 0.05); push(axx, axz, avx * f, avz * f); tq -= this.w * this.Nb * 0.02; }

    // 3. the tow bar hits the corner of the car at about 70 degrees: past that the two shove each other apart (a jack-knife)
    let phi = this.th - Math.atan2(car.F.x, car.F.z); phi = Math.atan2(Math.sin(phi), Math.cos(phi));
    if (Math.abs(phi) > 1.22) {
      // metal on metal: it stops hard
      const t = -Math.sign(phi) * (Math.abs(phi) - 1.22) * 45 - this.w * 0.25;
      tq += t; car.w.y -= t * car.invI.y * dt;
    }

    this.vx += fx / m * dt; this.vz += fz / m * dt; this.w += tq / I * dt;
    this.x += this.vx * dt; this.z += this.vz * dt; this.th += this.w * dt;
    // where the axle is now
    this.ax = this.x - Math.sin(this.th) * c; this.az = this.z - Math.cos(this.th) * c;
  }
}
const V = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
