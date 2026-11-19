// A plastic bag as real cloth: a sheet of 49 linked points that folds, drapes, blows in the wind,
// gets dragged by a turning wheel until it winds round it, hooks under the car's nose, and can rip.
import * as THREE from 'three';

const N = 7, NN = N * N, SP = 0.045;              // 7 x 7 points, 4.5 cm apart: a 27 cm sheet weighing 6 grams
const KD = 6;                                      // how hard the air grabs it (it falls at about 1.6 m/s)
let MAT = null;
const tmp = new THREE.Vector3(), hub = new THREE.Vector3();

export class Cloth {
  constructor(seed, x, z, gh) {
    this.p = new Float32Array(NN * 3); this.o = new Float32Array(NN * 3);      // where each point is, and where it was a step ago
    this.pin = new Uint8Array(NN);                                               // 0 free, 1 wound on a wheel, 2 hooked under the nose
    this.pd = new Float32Array(NN * 3);                                          // where on the wheel / car a pinned point sits
    this.pos = new THREE.Vector3(x, 0, z);
    this.state = 'free'; this.wheel = -1; this.cool = 0; this.still = 0; this.asleep = false; this.notice = ''; this.seed = seed;
    const rnd = k => { const s = Math.sin(seed * 9301 + k * 49.297) * 233280; return s - Math.floor(s); };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 3, px = x + (i - 3) * SP * 0.7, pz = z + (j - 3) * SP * 0.7;
      this.p[k] = px; this.p[k + 2] = pz; this.p[k + 1] = gh(px, pz) + 0.006 + 0.035 * rnd(k);
    }
    this.o.set(this.p);
    // links: neighbours (keep its size), diagonals (keep its shape), and skip-one (make it a little stiff, so it crumples instead of collapsing flat)
    const A = [], B = [], L = [], T = [];
    const link = (a, b, t) => { A.push(a); B.push(b); L.push(SP * (t === 1 ? 1.414 : t === 2 ? 2 : 1)); T.push(t); };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * N + i;
      if (i < N - 1) link(a, a + 1, 0); if (j < N - 1) link(a, a + N, 0);
      if (i < N - 1 && j < N - 1) { link(a, a + N + 1, 1); link(a + 1, a + N, 1); }
      if (i < N - 2) link(a, a + 2, 2); if (j < N - 2) link(a, a + 2 * N, 2);
    }
    this.A = new Uint8Array(A); this.B = new Uint8Array(B); this.L = new Float32Array(L); this.T = new Uint8Array(T); this.alive = new Uint8Array(A.length).fill(1);
    if (!MAT) MAT = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, transparent: true, opacity: 0.82, roughness: 0.45, side: THREE.DoubleSide });
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NN * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.buildIndex();
    this.mesh = new THREE.Mesh(this.geo, MAT); this.mesh.frustumCulled = false;
    this.updateMesh();
  }

  buildIndex() {
    const idx = [], torn = (a, b) => { for (let c = 0; c < this.A.length; c++) if (!this.alive[c] && this.T[c] === 0 && ((this.A[c] === a && this.B[c] === b) || (this.A[c] === b && this.B[c] === a))) return true; return false; };
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      if (torn(a, b) || torn(a, c) || torn(b, d) || torn(c, d)) continue;       // a ripped square is a hole
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
  }

  // rip it: the links around these points snap
  rip(points) {
    let n = 0;
    for (let c = 0; c < this.A.length && n < 10; c++) if (this.alive[c] && (points.includes(this.A[c]) || points.includes(this.B[c])) && (c * 7 + this.A[c]) % 3 === 0) { this.alive[c] = 0; n++; }
    if (n) this.buildIndex();
  }

  updateMesh() {
    this.geo.attributes.position.array.set(this.p); this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  // env: { gh(x,z), balls, car, wind (Vector3), t }
  step(dt, env) {
    const { p, o, pin } = this, car = env.car, wind = env.wind;
    const cdx = this.pos.x - car.pos.x, cdz = this.pos.z - car.pos.z, cd2 = cdx * cdx + cdz * cdz, nearCar = cd2 < 1.2;
    const ws = wind.length();
    if (this.asleep) { if (!nearCar && ws < 2.6) return; this.asleep = false; this.still = 0; }
    this.cool = Math.max(0, this.cool - dt);
    const idt = 1 / dt, carSp = car.vel.length();
    let moved = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < NN; i++) {
      const k = i * 3;
      if (pin[i]) continue;
      let vx = (p[k] - o[k]) * idt, vy = (p[k + 1] - o[k + 1]) * idt, vz = (p[k + 2] - o[k + 2]) * idt;
      // the air it is in: the wind, the flutter in it, and the car's wake when the car is close
      let ax = wind.x, ay = 0, az = wind.z;
      const fl = 0.22 * (ws + Math.hypot(vx, vz));
      ax += Math.sin(env.t * 13 + i * 1.7) * fl; ay += Math.sin(env.t * 17 + i * 2.3) * fl * 0.6; az += Math.cos(env.t * 11 + i * 1.3) * fl;
      if (nearCar && carSp > 2) { const dx = p[k] - car.pos.x, dz = p[k + 2] - car.pos.z, w = Math.max(0, 1 - Math.hypot(dx, dz) / 0.55) * 0.6; ax += car.vel.x * w; az += car.vel.z * w; ay += carSp * 0.12 * w; }
      vx += (ax - vx) * KD * dt; vy += ((ay - vy) * KD - 9.81) * dt; vz += (az - vz) * KD * dt;
      o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2];
      p[k] += vx * dt; p[k + 1] += vy * dt; p[k + 2] += vz * dt;
    }
    // pinned points ride on the wheel or the nose
    if (this.state !== 'free') for (let i = 0; i < NN; i++) {
      if (!pin[i]) continue; const k = i * 3;
      if (pin[i] === 1) {
        const w = car.wheels[this.wheel], a = this.pd[k + 1] - (w.spin - this.spin0), r = this.pd[k];
        hub.set(w.x, w.ay - w.len, w.z).applyQuaternion(car.q).add(car.pos);
        tmp.copy(car.U).multiplyScalar(Math.cos(a) * r).addScaledVector(car.F, -Math.sin(a) * r).addScaledVector(car.R, this.pd[k + 2]).add(hub);
      } else tmp.set(this.pd[k], this.pd[k + 1], this.pd[k + 2]).applyQuaternion(car.q).add(car.pos);
      o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2]; p[k] = tmp.x; p[k + 1] = tmp.y; p[k + 2] = tmp.z;
    }
    // the links pull it back into a sheet
    const A = this.A, B = this.B, L = this.L, T = this.T, alive = this.alive;
    for (let it = 0; it < 3; it++) for (let c = 0; c < A.length; c++) {
      if (!alive[c]) continue;
      const a = A[c] * 3, b = B[c] * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      let e = (len - L[c]) / len;
      if (e < 0) e *= T[c] === 2 ? 0.04 : 0.25;                    // plastic film resists stretching far more than folding
      const pa = pin[A[c]], pb = pin[B[c]]; if (pa && pb) continue;
      const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
      p[a] += dx * e * wa; p[a + 1] += dy * e * wa; p[a + 2] += dz * e * wa;
      p[b] -= dx * e * wb; p[b + 1] -= dy * e * wb; p[b + 2] -= dz * e * wb;
    }
    // against the sand and the car
    let onWheel = 0, onNose = 0; const balls = env.balls, vf = car.vel.dot(car.F);
    for (let i = 0; i < NN; i++) {
      const k = i * 3;
      if (pin[i] === 1) onWheel++; else if (pin[i] === 2) onNose++;
      if (pin[i]) { cx += p[k]; cy += p[k + 1]; cz += p[k + 2]; continue; }
      const g = env.gh(p[k], p[k + 2]) + 0.004;
      if (p[k + 1] < g) { p[k + 1] = g; o[k] += (p[k] - o[k]) * 0.75; o[k + 2] += (p[k + 2] - o[k + 2]) * 0.75; if (o[k + 1] < g) o[k + 1] = g; }   // sand grips it
      if (nearCar) for (let bi = 0; bi < balls.length; bi++) {
        const bl = balls[bi], dx = p[k] - bl.c.x, dy = p[k + 1] - bl.c.y, dz = p[k + 2] - bl.c.z, rr = bl.r + 0.008, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-10) continue;
        const d = Math.sqrt(d2), s = rr / d;
        p[k] = bl.c.x + dx * s; p[k + 1] = bl.c.y + dy * s; p[k + 2] = bl.c.z + dz * s;
        // whatever it touches drags it along
        o[k] = p[k] - bl.v.x * dt * 0.7; o[k + 1] = p[k + 1] - bl.v.y * dt * 0.7; o[k + 2] = p[k + 2] - bl.v.z * dt * 0.7;
        if (this.cool > 0) continue;
        if (bl.wheel >= 0) {
          const w = car.wheels[bl.wheel];
          if (Math.abs(w.omega) > 8 && (this.state === 'free' || this.wheel === bl.wheel) && !(w.jam > 0 && this.state === 'free')) {
            // a turning tyre catches the film and pulls it round
            if (this.state === 'free') { this.state = 'wheel'; this.wheel = bl.wheel; this.spin0 = w.spin; this.dir = Math.sign(w.omega); }
            hub.set(w.x, w.ay - w.len, w.z).applyQuaternion(car.q).add(car.pos);
            tmp.set(p[k] - hub.x, p[k + 1] - hub.y, p[k + 2] - hub.z);
            const u = tmp.dot(car.U), f = -tmp.dot(car.F);
            this.pd[k] = Math.min(w.r * 0.9, Math.hypot(u, f)); this.pd[k + 1] = Math.atan2(f, u); this.pd[k + 2] = Math.max(-w.half, Math.min(w.half, tmp.dot(car.R)));
            pin[i] = 1; onWheel++;
          }
        } else if (bi === 4 && vf > 1.5 && this.state !== 'wheel' && onNose < 6) {
          // the first chassis ball is the nose: film hooks on the front arms
          tmp.set(p[k] - car.pos.x, p[k + 1] - car.pos.y, p[k + 2] - car.pos.z);
          this.pd[k] = tmp.dot(car.R); this.pd[k + 1] = tmp.dot(car.U); this.pd[k + 2] = -tmp.dot(car.F);
          pin[i] = 2; onNose++; this.state = 'nose';
        }
      }
      const mv = Math.abs(p[k] - o[k]) + Math.abs(p[k + 1] - o[k + 1]) + Math.abs(p[k + 2] - o[k + 2]); if (mv > moved) moved = mv;
      cx += p[k]; cy += p[k + 1]; cz += p[k + 2];
    }
    this.pos.set(cx / NN, cy / NN, cz / NN);
    // what being caught does to the car, and how it comes off
    if (this.state === 'wheel') {
      const w = car.wheels[this.wheel];
      if (!this.jammed && onWheel >= 5) { this.jammed = true; w.jam = 1; w.jamDir = this.dir; this.notice = 'Plastic bag wound round the ' + ['front-left', 'front-right', 'rear-left', 'rear-right'][this.wheel] + ' wheel. ' + (w.drive ? 'Drive the other way to unwind it.' : 'It will tear off as it drags.'); }
      if ((this.jammed && w.jam <= 0) || (!this.jammed && Math.abs(w.omega) < 2)) this.release(this.jammed && Math.abs(car.thr) > 0.5);
    } else if (this.state === 'nose') {
      car.bagDrag = 0.043 * Math.min(1, onNose / 4);
      this.notice = 'Plastic bag caught under the nose. Reverse, or go fast enough to rip it off.';
      const sp = car.vel.length();
      if (car.bagDrag * sp * sp > 9) this.release(true); else if (vf < -0.8) this.release(false);
    }
    if (moved < 0.0006 && this.state === 'free') { this.still += dt; if (this.still > 0.6) this.asleep = true; } else this.still = 0;
  }

  release(ripped) {
    const pts = [];
    for (let i = 0; i < NN; i++) if (this.pin[i]) { pts.push(i); this.pin[i] = 0; }
    if (ripped) this.rip(pts);
    this.state = 'free'; this.wheel = -1; this.jammed = false; this.cool = 1.5; this.notice = ''; this.released = true;
  }
}
