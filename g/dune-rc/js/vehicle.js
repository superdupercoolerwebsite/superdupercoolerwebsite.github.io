// The RC car's physics: one rigid body, four sprung wheels, sand tyres. 1/10 scale, real units.
// Rule from the designer: real-life forces only. No steering help, no self-levelling, no downforce tricks.
import * as THREE from 'three';
import { SPECS } from './specs.js';

export const SPEEDS = [
  { name: 'Real RC fast', kmh: 60 },
  { name: 'Extreme RC', kmh: 110 },
  { name: 'Unreal rocket', kmh: 200 },
];

const G = 9.81;
// the buggy model's own numbers (used to fit the 3D model onto the physics)
export const SCALE = 0.14, COM_Y = 0.55, COM_Z = -0.229, TYRE_HALF = 0.023;
const K_BUMP = 2600;
const MU_LONG = 1.0;
const CS = 60;                              // how quickly sideways sliding turns into grip force
const I_WHEEL = 8e-5;                       // spin inertia of one wheel and tyre

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const A = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3(), f = new THREE.Vector3(), s = new THREE.Vector3();
const force = new THREE.Vector3(), torque = new THREE.Vector3();
const qi = new THREE.Quaternion();
const g = { h: 0, nx: 0, ny: 1, nz: 0, sink: 0 };

export class Car {
  constructor(ground, spec = SPECS[0]) {
    this.shock = 0;       // hardest knock since the game last looked (for damage)
    this.ground = ground;                       // (x, z, out) -> out.h, out.nx/ny/nz
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this.w = new THREE.Vector3();
    this.R = new THREE.Vector3(1, 0, 0); this.U = new THREE.Vector3(0, 1, 0); this.F = new THREE.Vector3(0, 0, -1);
    this.steer = 0; this.thr = 0; this.grounded = 0; this.bodyHits = 0; this.speedMode = 1;     // 110 km/h unless changed
    this.airTime = 0;
    this.bagDrag = 0;     // a plastic bag snagged on the car acts like a small parachute
    this.power = 0;       // watts the motor is drawing right now
    this.contacts = [];   // where the chassis is touching the sand this step
    this.touching = new Set(); this.now = new Set();
    this.setSpec(spec);
  }

  // become one of the three cars
  setSpec(spec) {
    this.spec = spec; this.mass = spec.mass;
    this.invI = new THREE.Vector3(1 / spec.inertia[0], 1 / spec.inertia[1], 1 / spec.inertia[2]);
    this.wheels = spec.wheels.map(w => Object.assign({}, w));
    for (const w of this.wheels) {
      w.len = spec.travel; w.spin = 0; w.on = false;
      w.omega = 0;          // how fast the wheel is turning, rad/s
      w.jam = 0; w.jamDir = 0;   // a plastic bag wound round this wheel (1 = tight) and which way it was wound
      w.slip = 0;           // tyre surface speed minus ground speed, m/s (wheelspin +, locked -)
      w.vf = 0; w.vs = 0; w.load = 0; w.hit = 0;
      w.berm = 0;           // sand piled against the side of this tyre from sliding sideways (0 none .. 1 a wall of it)
      w.c = new THREE.Vector3(); w.f = new THREE.Vector3(0, 0, -1); w.s = new THREE.Vector3(1, 0, 0); w.n = new THREE.Vector3(0, 1, 0);
      w.pv = new THREE.Vector3();   // velocity of the car at this wheel
    }
    // chassis points that can touch the sand: belly, roll cage / roof, nose and tail
    const B = this.body = [], S = spec;
    for (const x of [-S.halfW, S.halfW]) for (const z of [S.nose * 0.88, (S.nose + S.tail) / 2, S.tail * 0.72]) B.push(new THREE.Vector3(x, S.belly, z));
    for (const x of [-S.halfW, S.halfW]) for (const z of [S.nose * 0.33, S.tail * 0.45]) B.push(new THREE.Vector3(x, S.top, z));
    B.push(new THREE.Vector3(0, 0.02, S.nose), new THREE.Vector3(0, S.top * 0.6, S.tail));
    // tyre sidewalls: lying on its side a real car rests on these and the cage, and stays there
    this.sideFrom = B.length;
    for (const w of spec.wheels) {
      const x = w.x + Math.sign(w.x) * w.half, y = w.ay - spec.travel * 0.6, r = w.r * 0.85;
      B.push(new THREE.Vector3(x, y, w.z), new THREE.Vector3(x, y + r, w.z), new THREE.Vector3(x, y - r, w.z), new THREE.Vector3(x, y, w.z - r), new THREE.Vector3(x, y, w.z + r));
    }
    this.capacity = spec.batteryWh * 3600;      // joules in a full pack
    this.battery = this.capacity;
  }

  place(x, z, yaw = 0) {
    this.ground(x, z, g);
    this.pos.set(x, g.h + this.spec.restY, z); this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.q.setFromAxisAngle(v1.set(0, 1, 0), yaw);
    for (const w of this.wheels) { w.omega = 0; w.on = false; w.jam = 0; w.berm = 0; }
    this.bagDrag = 0;
    this.axes();
  }

  axes() {
    this.R.set(1, 0, 0).applyQuaternion(this.q);
    this.U.set(0, 1, 0).applyQuaternion(this.q);
    this.F.set(0, 0, -1).applyQuaternion(this.q);
  }

  // how easily the car is moved by a push along n at a world point (1/kg, counting that it also turns)
  kAt(at, n) {
    v4.subVectors(at, this.pos).cross(n);
    qi.copy(this.q).invert(); v4.applyQuaternion(qi);
    return 1 / this.mass + v4.x * v4.x * this.invI.x + v4.y * v4.y * this.invI.y + v4.z * v4.z * this.invI.z;
  }

  // The chassis points that can touch the sand, taken from the model itself: the outermost balls of its shape in every direction.
  setBody(balls) {
    const pick = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue; const l = Math.hypot(dx, dy, dz); let best = -1e9, bi = -1;
      balls.forEach((b, i) => { const s = (b[0] * dx + b[1] * dy + b[2] * dz) / l + b[3]; if (s > best) { best = s; bi = i; } });
      if (bi >= 0) pick.add(bi);
    }
    const side = this.body.slice(this.sideFrom), B = this.body = [];
    for (const i of pick) { const b = balls[i], p = new THREE.Vector3(b[0], b[1], b[2]); p.r = b[3]; B.push(p); }
    this.sideFrom = B.length; for (const p of side) B.push(p);
    this.touching.clear(); this.now.clear();
  }

  // a knock from something the car hit (J in newton-seconds, at a world point)
  applyImpulse(J, at) {
    this.vel.addScaledVector(J, 1 / this.mass);
    v4.subVectors(at, this.pos).cross(J);
    qi.copy(this.q).invert(); v4.applyQuaternion(qi);
    v4.set(v4.x * this.invI.x, v4.y * this.invI.y, v4.z * this.invI.z).applyQuaternion(this.q);
    this.w.add(v4);
  }

  addForce(F_, at) { force.add(F_); torque.add(v4.subVectors(at, this.pos).cross(F_)); }

  // input: thr -1..1, steer -1..1 (right positive), hb true/false
  step(dt, input) {
    const top = (this.topKmh || SPEEDS[this.speedMode].kmh) / 3.6;
    const S = this.spec, TRAVEL = S.travel, MASS = this.mass, INV_I = this.invI, BODY = this.body;
    // a nearly flat pack sags: below 15% charge the motor gets weaker, and at empty it cuts out (steering and brakes still work)
    const charge = this.battery / this.capacity, sag = charge <= 0 ? 0 : Math.min(1, charge / 0.15);
    const fmax = Math.max(S.push, S.push + 1.1 * (top - 16.7)) * sag * (this.pushMul === undefined ? 1 : this.pushMul);   // motor push at the tyres, newtons
    // how nose-up the car is pointing (0 below about 5 degrees nose-up, 1 from about 13 degrees), and what it takes to lift the front:
    // the rear axle's distance behind the centre of weight, over the height of that centre above the sand
    const wheelieUp = Math.max(0, Math.min(1, (this.F.y - 0.09) / 0.13));
    let rearZ = 0.1; for (const w of this.wheels) if (!w.front) rearZ = Math.max(0.05, w.z);
    const need = rearZ / (S.restY * 0.83), digGain = Math.max(0, 1.1 * need / (MU_LONG * (this.gripMul || 1)) - 1);
    let watts = 4 + (this.lights ? 3 : 0);                        // radio, servo and speed controller are always on; LED lights take 3 W more
    this.axes();
    const { R, U, F, pos, vel, w } = this;
    force.set(0, -MASS * G, 0); torque.set(0, 0, 0);
    const vFwd = vel.dot(F);

    // the steering servo swings to where the key says; a key is all-or-nothing, so it takes ~0.3 s to reach full lock
    const rate = input.steer === 0 ? 14 : 7;                     // a fast steering servo: full lock in about 0.15 s
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, input.steer - this.steer));
    // same for the trigger finger: about a fifth of a second to squeeze to full throttle
    const tr = Math.abs(input.thr) > Math.abs(this.thr) || input.thr * this.thr < 0 ? 16 : 30;   // throttle answers within a sixteenth of a second
    this.thr += Math.max(-tr * dt, Math.min(tr * dt, input.thr - this.thr));
    const thr = this.thr;
    const ang = Math.max(-1, Math.min(1, this.steer + (this.steerBias || 0))) * S.lock * (this.lockMul || 1);

    let grounded = 0;
    for (const wh of this.wheels) {
      A.set(wh.x, wh.ay, wh.z).applyQuaternion(this.q).add(pos);
      this.ground(A.x, A.z, g);
      n.set(g.nx, g.ny, g.nz);
      const up = U.dot(n);
      const t = up > 0.25 ? (A.y - g.h) * g.ny / up : 1e9;
      const len = t - wh.r;
      const was = wh.on;
      wh.on = len < TRAVEL;
      wh.hit = 0;
      const o0 = wh.omega;
      if (wh.jam > 0) {
        // straining the motor against the bag slowly tears it; turning the wheel the other way unwinds it quickly
        if (wh.drive) wh.jam -= dt * (thr * wh.jamDir < -0.1 ? 1.4 : 0.22 * Math.abs(thr));
        else wh.jam -= dt * 0.05 * Math.abs(vFwd);
      }
      const stuck = wh.jam > 0;
      if (!wh.on) {
        // wheel in the air: the motor spins it up or the brake stops it almost instantly
        wh.len = TRAVEL; wh.load = 0; wh.slip = 0; wh.berm = 0;
        let target = wh.omega, a = 400;
        if ((input.hb && !wh.front) || stuck) { target = 0; a = 6000; }
        else if (thr > 0 && wh.drive) { target = thr * top / wh.r; a = 3000; }
        else if (thr < 0) { target = wh.omega > 8 || !wh.drive ? 0 : thr * 0.3 * top / wh.r; a = wh.omega > 8 ? 6000 : 3000; }
        else { target = 0; a = 25; }
        wh.omega += Math.max(-a * dt, Math.min(a * dt, target - wh.omega));
        // and the car twists the other way: this is the only air control a real RC car has
        torque.addScaledVector(R, 0.45 * (S.wheelI || I_WHEEL) * (wh.omega - o0) / dt);
        wh.spin += wh.omega * dt;
        continue;
      }
      grounded++;
      wh.len = Math.max(0, len);
      const x = TRAVEL - len;
      C.copy(A).addScaledVector(U, -t);
      v1.subVectors(C, pos); v2.crossVectors(w, v1).add(vel);    // velocity of the contact patch
      const vn = v2.dot(n);
      // the shock resists being squashed fast far more than it resists springing back, and the spring stiffens as it nears the end:
      // that is what soaks up a hard landing instead of bouncing the car back into the air
      const ks = S.spring * (this.springMul || 1), k2 = x > TRAVEL * 0.55 ? ks * 2.2 * (x - TRAVEL * 0.55) : 0;
      const Fn = Math.max(0, ks * x + k2 + K_BUMP * Math.max(0, x - TRAVEL) - S.damp * (this.dampMul === undefined ? 1 : this.dampMul) * (vn < 0 ? 2.6 : 1) * vn);
      if (!was) { wh.hit = -vn; if (wh.hit * 0.55 > this.shock) this.shock = wh.hit * 0.55; }   // just landed: how hard
      this.addForce(v3.copy(n).multiplyScalar(Fn), C);

      // wheel directions on the sand
      const a = wh.front ? ang : 0;
      f.copy(F).multiplyScalar(Math.cos(a)).addScaledVector(R, Math.sin(a));
      f.addScaledVector(n, -f.dot(n)).normalize();
      s.crossVectors(f, n);
      const vf = v2.dot(f), vs = v2.dot(s);

      // sideways grip
      // A tyre sliding sideways ploughs sand into a pile against its own sidewall. The pile pushes back far harder than
      // a clean tyre grips, and it pushes low down, at the sand: that is what trips a car over and sends it tumbling
      // down a slope. Rolling forward leaves the pile behind.
      // (only a tyre going mostly sideways builds a pile; one that is cornering while rolling does not)
      const side = Math.abs(vs) / (Math.abs(vs) + Math.abs(vf) + 0.01);
      wh.berm = Math.max(0, Math.min(1, wh.berm + (Math.abs(vs) > 0.6 ? Math.abs(vs) * 1.3 * side * side * side : -3) * dt - Math.abs(vf) * 0.5 * dt));
      // on the flat the pile only slows the slide; on a slope the sand is already avalanching toward the tyre and it digs in hard
      const steep = Math.min(1, Math.sqrt(Math.max(0, 1 - g.ny * g.ny)) / 0.4);
      const mu = (wh.front ? S.muFront : S.muRear) * (1 + (0.12 + 1.2 * steep) * wh.berm);
      let Fl = Math.max(-mu * Fn, Math.min(mu * Fn, -vs * CS));

      // push, brake, reverse. Loose sand on a steep face shears away under the tyre.
      const slope = Math.sqrt(Math.max(0, 1 - g.ny * g.ny));
      // Wheelies. Pointing uphill under power, the driven rear tyres dig back into the slope: the sand piles up behind
      // their paddles, so they can push much harder than on the flat, and the motor is let off its leash to use it.
      // With enough push the nose comes up, and it stays up for as long as you hold the throttle (hold it too long
      // and the car goes over backwards). `need` is the push, as a share of the car's weight, that lifts the front.
      // (Only at low speed, below about 25 km/h and strongest under 11: a tyre already flying over the sand does not dig.)
      const dig = thr > 0 && wh.drive && !wh.front ? wheelieUp * Math.max(0, Math.min(1, (7 - vf) / 4)) : 0;
      const hold = (MU_LONG * (this.gripMul || 1) * (1 + dig * digGain) - 0.6 * slope * (1 - dig)) * Fn + 1e-3;
      let Fd = 0, locked = false;
      if (thr > 0) {
        const fade = Math.max(0, 1 - Math.pow(Math.max(0, vf) / top, 4));
        Fd = Math.min(S.slipper, thr * fmax * fade) * wh.drive;
        if (dig > 0) Fd += dig * Math.max(0, thr * fade * 1.03 * need * MASS * 9.81 / 2 - Fd);
      }
      else if (thr < 0) {
        if (vFwd > 0.6) Fd = thr * 30 * 0.25;                // braking
        else Fd = thr * fmax * wh.drive * 0.6 * Math.max(0, 1 + vf / (0.3 * top));
      }
      if ((!wh.front && input.hb) || stuck) { Fd = -vf * CS; locked = true; }  // handbrake (or a wound-up bag) locks the wheel
      // more push asked than the sand can hold: the tyre spins (or locks) and scrapes sand away
      const over = Math.max(0, Math.min(1, (Math.abs(Fd) - hold) / hold));
      Fd = Math.max(-hold, Math.min(hold, Fd));
      let surf;                                                   // tyre surface speed
      if (locked) surf = 0;
      else if (thr > 0 && wh.drive) surf = vf + over * Math.max(0, top - vf) + thr * (0.4 + 0.13 * Math.abs(vf));   // paddle tyres always slip a bit under power
      else if (thr < 0 && vFwd > 0.6) surf = vf * (1 - over);
      else if (thr < 0 && wh.drive) surf = vf - over * 0.3 * top;
      else surf = vf;
      wh.omega += (surf / wh.r - wh.omega) * Math.min(1, dt * 60);
      wh.slip = wh.omega * wh.r - vf;
      // one budget of grip shared between pushing and holding sideways
      const lim = Math.max(mu * Fn, dig > 0 ? hold : 0), used = Math.hypot(Fd, Fl);
      if (locked) {                                               // a locked tyre just drags: friction straight against its motion
        const sp = Math.hypot(vf, vs), k = sp > 0.05 ? -0.8 * Fn / sp : -CS * 0.3;
        Fd = vf * k; Fl = vs * k;
      } else if (used > lim) { Fd *= lim / used; Fl *= lim / used; }
      if (wh.drive && !locked && thr !== 0 && !(thr < 0 && vFwd > 0.6)) watts += Math.abs(Fd * wh.omega * wh.r) / 0.8;   // motor is about 80% efficient
      // sand drag: a tyre sunk below the sand around it has to keep climbing out of its own rut or hole
      Fd -= Math.max(-1, Math.min(1, vf * 8)) * (0.02 + Math.min(0.7, 22 * (this.sinkMul || 1) * (g.sink || 0))) * Fn;
      v3.copy(f).multiplyScalar(Fd).addScaledVector(s, Fl);
      wh.c.copy(C); wh.f.copy(f); wh.s.copy(s); wh.n.copy(n); wh.vf = vf; wh.vs = vs; wh.load = Fn; wh.pv.copy(v2);
      this.addForce(v3, C);
      wh.spin += wh.omega * dt;
    }
    this.grounded = grounded;
    if (grounded === 0 && this.bodyHits === 0) {
      // in the air: W and S tip the nose, steering rolls the car
      let om = 0; for (const wh of this.wheels) om += Math.abs(wh.omega); om = Math.min(1, 0.35 + om / 4 / 150);
      // (the driver asked for it this way round: S lifts the nose, W drops it)
      torque.addScaledVector(R, -thr * 0.15);
      torque.addScaledVector(F, this.steer * 0.28 * om);
    }
    // air drag
    const spd = vel.length();
    force.addScaledVector(vel, -(0.005 + this.bagDrag + (this.dragExtra || 0)) * spd);

    // chassis and roof against the sand
    let hits = 0;
    const tipped = U.y < 0.5;
    this.contacts.length = 0;
    for (let bi = 0; bi < BODY.length; bi++) {
      if (bi >= this.sideFrom && !tipped) break;                      // upright, the tyres themselves do this job
      const b = BODY[bi];
      A.copy(b).applyQuaternion(this.q).add(pos);
      this.ground(A.x, A.z, g);
      const pen = (g.h + (b.r || 0) - A.y) * g.ny;
      if (pen <= 0) continue;
      hits++;
      n.set(g.nx, g.ny, g.nz);
      v1.subVectors(A, pos); v2.crossVectors(w, v1).add(vel);
      const vn = v2.dot(n);
      const Fn = Math.max(0, 3500 * pen - (vn < 0 ? 70 : 12) * vn);        // sand does not bounce: it takes the hit and gives almost nothing back
      v3.copy(v2).addScaledVector(n, -vn);                        // sliding velocity
      const sl = v3.length();
      { const hl = Math.hypot(v3.x, v3.z) || 1; const was = this.touching.has(bi); const hv = was ? 0 : Math.max(0, -vn); if (hv > this.shock) this.shock = hv; this.contacts.push({ x: A.x, y: A.y, z: A.z, Fn, sl, sx: v3.x / hl, sz: v3.z / hl, hit: hv }); this.now.add(bi); }
      v3.multiplyScalar(sl > 1e-4 ? -Math.min(0.6 * Fn, sl * 40) / sl : 0).addScaledVector(n, Fn);
      this.addForce(v3, A);
    }
    this.bodyHits = hits;
    // a body ploughing into sand loses its tumble quickly: the sand grabs it
    if (hits > 0) { const k = Math.min(1, (2.5 + 1.2 * hits) * dt); w.multiplyScalar(1 - k); vel.multiplyScalar(1 - Math.min(1, 0.5 * hits * dt)); }
    { const t = this.touching; this.touching = this.now; this.now = t; t.clear(); }
    if (grounded === 0 && hits === 0) { this.airTime += dt; w.multiplyScalar(1 - 0.08 * dt); } else this.airTime = 0;

    this.power = watts; this.battery = Math.max(0, this.battery - watts * dt);

    // integrate
    vel.addScaledVector(force, dt / MASS);
    qi.copy(this.q).invert();
    v1.copy(torque).applyQuaternion(qi); v2.copy(w).applyQuaternion(qi);
    v2.x += v1.x * INV_I.x * dt; v2.y += v1.y * INV_I.y * dt; v2.z += v1.z * INV_I.z * dt;
    w.copy(v2).applyQuaternion(this.q);
    const wl = w.length(); if (wl > 40) w.multiplyScalar(40 / wl);
    pos.addScaledVector(vel, dt);
    qi.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.q);
    this.q.set(this.q.x + qi.x, this.q.y + qi.y, this.q.z + qi.z, this.q.w + qi.w).normalize();
    // hard floor: at very high speed a step can carry the car further than its own height; it must never end up under the sand
    this.ground(pos.x, pos.z, g);
    if (pos.y < g.h + 0.025) { pos.y = g.h + 0.025; const vn = vel.x * g.nx + vel.y * g.ny + vel.z * g.nz; if (vn < 0) { vel.x -= vn * g.nx; vel.y -= vn * g.ny; vel.z -= vn * g.nz; } }
  }
}
