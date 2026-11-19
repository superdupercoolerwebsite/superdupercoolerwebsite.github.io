// Rigid-body rally car: 4 independent suspension rays, combined-slip tyres,
// wheel spin dynamics, AWD drivetrain with gearbox. Written from scratch.
// Local axes: +Z forward, +X left, +Y up. Origin = centre of gravity.
import { Vector3, Quaternion } from 'three';

const G = 9.81;
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3();
const qt = new Quaternion();

export const SPEC = {
  mass: 1250,
  inertia: [2000, 2150, 520],          // about local X (pitch), Y (yaw), Z (roll)
  wheelR: 0.33,
  mounts: [[0.78, 0.05, 1.28], [-0.78, 0.05, 1.28], [0.78, 0.05, -1.27], [-0.78, 0.05, -1.27]],
  restLen: 0.30, maxComp: 0.19,
  springK: [40000, 40000, 37000, 37000],
  dampBump: 3000, dampReb: 4200,
  arb: [7000, 7500],                    // stiff rear bar: the tail rotates on turn-in
  muF: 1.01, muR: 0.99,
  gears: [3.25, 2.1, 1.52, 1.16, 0.93], reverse: -3.0, final: 4.3,
  idle: 1100, redline: 7300,
  brakeTotal: 2550, handbrake: 4500,   // brake torque per axle side, split by setup.brakeBias
  maxSteer: 0.6,
  cdA: 0.78,
  body: [[0.8, -0.22, 1.95], [-0.8, -0.22, 1.95], [0.8, -0.22, -1.95], [-0.8, -0.22, -1.95],
         [0.6, 0.86, 0.5], [-0.6, 0.86, 0.5], [0.6, 0.86, -0.9], [-0.6, 0.86, -0.9]],
};

function engineTorque(rpm) {
  // broad turbo-ish curve, peak ~430 Nm around 4500
  const x = rpm / 1000;
  const t = 180 + 250 * Math.exp(-((x - 4.5) * (x - 4.5)) / 7.5);
  return rpm > SPEC.redline ? 0 : t;
}

// normalised combined-slip curve, peak 1 at s = 1, falls to ~0.72 when sliding
const TC = 1.36, TB = Math.tan(Math.PI / (2 * TC));
const slipCurve = (s) => Math.sin(TC * Math.atan(TB * s));

export class Car {
  constructor(ground) {
    this.ground = ground;               // (x, z, hint) -> { via ground.h(...) } see setGround
    this.pos = new Vector3(); this.quat = new Quaternion();
    this.vel = new Vector3(); this.angVel = new Vector3();
    this.wheels = [0, 1, 2, 3].map((i) => ({
      omega: 0, comp: 0.08, prevComp: 0.08, contact: false, spin: 0, hint: -1,
      slip: 0, load: 0, front: i < 2, wpos: new Vector3(),
    }));
    this.steer = 0; this.gear = 1; this.rpm = SPEC.idle; this.shiftT = 0;
    this.throttle = 0; this.brake = 0; this.hand = 0;
    this.speed = 0; this.damage = 0; this.bodyHint = -1; this.offroad = 0;
    this.impact = 0;
    this.trees = null;                  // optional (x,z) -> array of [x,z,r]
    this.hbYaw = 0;
    // handling options, all 1 = default (see settings.js)
    // garage setup + driver assists (see settings.js): 1 = standard part, levels 0..5 for assists
    this.setup = { brakeBias: 0.57, brakeForce: 1, split: 0.47, diffF: 0.3, diffR: 0.45, springF: 1, springR: 1, damp: 1, arbF: 1, arbR: 1, ride: 0, final: 1 };
    this.assist = { abs: 0, tcs: 0, auto: true };
    this.maxK = 0;
    this.tune = { grip: 1, downforce: 1, steerLock: 1, steerSpeed: 1, brakes: 1, stability: 1, hbSwing: 1, hbStyle: 'classic', hbGrip: 1, carve: 1, steerSens: 1 };
  }

  place(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.quat.setFromAxisAngle(v1.set(0, 1, 0), yaw);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.comp = w.prevComp = 0.08; w.hint = -1; }
    this.gear = 1; this.steer = 0; this.rpm = SPEC.idle; this.bodyHint = -1;
  }

  applyImpulse(J, r) {
    this.vel.addScaledVector(J, 1 / SPEC.mass);
    v4.copy(r).cross(J);
    qt.copy(this.quat).invert(); v4.applyQuaternion(qt);
    v4.set(v4.x / SPEC.inertia[0], v4.y / SPEC.inertia[1], v4.z / SPEC.inertia[2]).applyQuaternion(this.quat);
    this.angVel.add(v4);
  }

  // input: { steer -1..1 (+ = left), throttle 0..1, brake 0..1, hand 0..1 }
  step(dt, input) {
    const S = SPEC, q = this.quat, g = this.ground, tn = this.tune, su = this.setup, as = this.assist, rest = S.restLen + su.ride;
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(q);
    const left = new Vector3(1, 0, 0).applyQuaternion(q);
    const vF = this.vel.dot(fwd);
    this.speed = this.vel.length();

    // --- driver inputs: throttle/brake swap for reverse ----------------------
    let thr = input.throttle, brk = input.brake;
    if (!as.auto) {
      // manual sequential: one gear per pull, reverse sits below first
      if (input.shift && this.shiftT <= 0) {
        if (input.shift > 0) { if (this.gear === -1) this.gear = 1; else if (this.gear < S.gears.length) { this.gear++; this.shiftT = 0.12; } }
        else if (this.gear > 1) { this.gear--; this.shiftT = 0.12; } else if (this.gear === 1 && Math.abs(vF) < 2) this.gear = -1;
      }
      input.shift = 0;
    } else if (this.gear === -1) {
      if (input.throttle > 0.1 && vF > -1.5) { this.gear = 1; } else { thr = input.brake; brk = input.throttle; }
    } else if (input.brake > 0.5 && input.throttle < 0.1 && vF < 0.8 && this.gear === 1) {
      this.gear = -1; thr = input.brake; brk = 0;
    }
    this.throttle = thr; this.brake = brk; this.hand = input.hand;

    // --- steering: slower lock at speed --------------------------------------
    const keep = Math.min(1, 0.45 * tn.steerSpeed);
    const lock = S.maxSteer * tn.steerLock * (keep + (1 - keep) / (1 + Math.pow(Math.abs(vF) / 22, 2)));
    const target = input.steer * lock;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.2 : 2.1) * (input.analog ? 3 : 1) * tn.steerSens;
    const ds = target - this.steer, mx = rate * dt;
    this.steer += ds > mx ? mx : ds < -mx ? -mx : ds;

    // --- drivetrain -----------------------------------------------------------
    const ratio = (this.gear === -1 ? S.reverse : S.gears[this.gear - 1]) * S.final * su.final;
    let wAvg = 0; for (const w of this.wheels) wAvg += w.omega; wAvg /= 4;
    const rpmRaw = Math.abs(wAvg * ratio) * 60 / (2 * Math.PI);
    const rpm = Math.max(S.idle, rpmRaw);
    this.rpm += (rpm + (rpmRaw < S.idle ? thr * 1800 : 0) - this.rpm) * Math.min(1, dt * 18);
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (this.gear > 0 && as.auto) {
      if (rpmRaw > 6750 && this.gear < S.gears.length) { this.gear++; this.shiftT = 0.16; }
      else if (this.gear > 1 && rpmRaw * S.gears[this.gear - 2] / S.gears[this.gear - 1] < 5400 && (thr > 0.6 || rpmRaw < 3000)) { this.gear--; this.shiftT = 0.14; }
    }
    let engT = this.shiftT > 0 ? 0 : engineTorque(rpm) * thr;
    if (thr < 0.05 && rpmRaw > S.idle + 200) engT = -(25 + 55 * rpm / 7000);   // engine braking
    if (as.tcs > 0 && engT > 0) engT *= Math.max(0.15, Math.min(1, 1 - (this.maxK - (0.55 - 0.08 * as.tcs)) / 0.2));   // traction control
    const driveAll = engT * ratio * 0.9;
    let maxK = 0;
    const wheelI = 1.3 + 0.11 * ratio * ratio / 4;

    // --- forces ---------------------------------------------------------------
    const F = new Vector3(0, -S.mass * G, 0), Tq = new Vector3();
    const addForce = (f, at) => { F.add(f); Tq.add(v4.copy(at).sub(this.pos).cross(f)); };

    // suspension pass (need compressions before anti-roll bars)
    let off = 0, slipSum = 0;
    const N = [], C = [], comp = [];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], m = S.mounts[i];
      const M = new Vector3(m[0], m[1], m[2]).applyQuaternion(q).add(this.pos);
      const px = M.x - up.x * (rest + S.wheelR), pz = M.z - up.z * (rest + S.wheelR);
      const h = g.h(px, pz, w.hint); w.hint = g.T ? g.T.qi : -1;
      const or = g.T ? g.T.offroad() : 0;
      const hx = g.h(px + 0.35, pz, w.hint), hz = g.h(px, pz + 0.35, w.hint);
      const n = new Vector3(-(hx - h) / 0.35, 1, -(hz - h) / 0.35).normalize();
      const un = up.dot(n);
      w.contact = false; w.off = or; comp[i] = 0; N[i] = n;
      if (un > 0.25) {
        const t = (v1.set(M.x - px, M.y - h, M.z - pz).dot(n)) / un;
        let c = rest - (t - S.wheelR);
        if (c > 0) {
          w.contact = true;
          C[i] = M.clone().addScaledVector(up, -t);
          comp[i] = c;
        } else c = 0;
        w.comp = Math.min(c, S.maxComp + 0.03);
      } else w.comp = 0;
      w.wpos.set(m[0], m[1] - (rest - w.comp), m[2]);
    }

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const front = i < 2, steerA = front ? this.steer : 0;
      let Fx = 0, gSlope = 0, Fz = 0, mu = 0, f = null, vx = 0;
      // centre split, plus a limited-slip diff that drags the two wheels of an axle towards the same speed
      const lock = front ? su.diffF : su.diffR, dW = (this.wheels[i ^ 1].omega - w.omega) * 520 * lock;
      const driveT = driveAll * (front ? su.split : 1 - su.split) / 2 + Math.max(-750, Math.min(750, dW));
      let absF = 1;
      if (w.contact) {
        const n = N[i], c = comp[i];
        const cd = (c - w.prevComp) / dt;
        Fz = S.springK[i] * (front ? su.springF : su.springR) * c + (cd > 0 ? S.dampBump : S.dampReb) * su.damp * cd;
        if (c > S.maxComp) Fz += 220000 * (c - S.maxComp);
        const o = i ^ 1;
        Fz += S.arb[front ? 0 : 1] * (front ? su.arbF : su.arbR) * (c - comp[o]);
        if (Fz < 0) Fz = 0;
        if (Fz > 45000) Fz = 45000;
        w.load = Fz;

        // wheel frame on the ground plane
        f = v2.copy(fwd).applyAxisAngle(up, steerA);
        f.addScaledVector(n, -f.dot(n)).normalize();
        const s = v3.copy(n).cross(f);                      // points left
        const vc = v1.copy(C[i]).sub(this.pos); vc.crossVectors(this.angVel, vc).add(this.vel);
        vx = vc.dot(f); const vy = vc.dot(s);

        const or = w.off;
        mu = (0.98 - 0.26 * or) * (front ? S.muF : S.muR) * (1 - 0.07 * (Fz / 3100 - 1)) * tn.grip * (input.hand > 0.5 ? 0.85 + 0.15 * tn.hbGrip : 1);
        const aPeak = 0.21 + 0.05 * or, kPeak = 0.17;
        const vref = Math.max(Math.abs(vx), 2.2);
        const alpha = Math.atan2(vy, Math.max(Math.abs(vx), 1.2));
        const sy = alpha / aPeak;
        const tyre = (om) => {
          const sx = ((om * S.wheelR - vx) / vref) / kPeak;
          const sg = Math.hypot(sx, sy);
          if (sg < 1e-6) return [0, 0, 0];
          const Fm = mu * Fz * slipCurve(sg);
          return [Fm * sx / sg, -Fm * sy / sg, sg];
        };
        const kap = (w.omega * S.wheelR - vx) / vref;                  // slip ratio: + spinning, - locking
        if (kap > maxK) maxK = kap;
        if (as.abs > 0 && brk > 0.05 && vx > 2) absF = Math.max(0.08, Math.min(1, 1 - (-kap - (0.3 - 0.04 * as.abs)) / 0.12));   // anti-lock
        const t0 = tyre(w.omega), t1 = tyre(w.omega + 0.5);
        Fx = t0[0]; gSlope = Math.max(0, (t1[0] - t0[0]) / 0.5);
        w.slip = t0[2];
        slipSum += Math.min(2, t0[2]) * Math.min(1, Fz / 3000);
        off += or;

        // rolling resistance (soft ground drags hard)
        const rr = (0.018 + 0.09 * or) * Fz * Math.max(-1, Math.min(1, vx / 0.5));

        // integrate wheel spin semi-implicitly against the tyre force slope
        const den = 1 + dt * S.wheelR * gSlope / wheelI;
        let om = w.omega + (dt / wheelI) * (driveT - Fx * S.wheelR) / den;
        const bT = S.brakeTotal * (front ? su.brakeBias : 1 - su.brakeBias) * brk * tn.brakes * su.brakeForce * absF + (front ? 0 : S.handbrake * input.hand);
        const bd = bT * dt / wheelI / den;
        om = Math.abs(om) <= bd ? 0 : om - Math.sign(om) * bd;
        const FxUse = Fx + gSlope * (om - w.omega) * 1;
        w.omega = om;

        const force = v1.copy(n).multiplyScalar(Fz).addScaledVector(f, FxUse - rr).addScaledVector(s, t0[1]);
        addForce(force, C[i]);
        w.prevComp = c;
      } else {
        w.load = 0; w.slip = 0; w.prevComp = 0;
        let om = w.omega + (dt / wheelI) * driveT;
        const bT = S.brakeTotal * (front ? su.brakeBias : 1 - su.brakeBias) * brk * tn.brakes * su.brakeForce * absF + (front ? 0 : S.handbrake * input.hand);
        const bd = bT * dt / wheelI;
        om = Math.abs(om) <= bd ? 0 : om - Math.sign(om) * bd;
        w.omega = om * (1 - 0.2 * dt);
      }
      w.spin += w.omega * dt;
    }
    this.offroad = off / 4; this.slip = slipSum / 4; this.maxK = maxK;

    // --- aero -----------------------------------------------------------------
    F.addScaledVector(this.vel, -0.5 * 1.2 * S.cdA * this.speed);
    F.addScaledVector(up, -0.5 * 1.2 * (0.5 + 1.5 * tn.downforce) * vF * vF);     // downforce builds with speed

    // --- driver aids (scaled by the handling settings) ------------------------
    let nc = 0; for (const w of this.wheels) if (w.contact) nc++;
    const I1 = S.inertia[1], yawRate = this.angVel.dot(up);
    const beta = Math.atan2(this.vel.dot(left), Math.abs(vF) + 0.5);          // sideslip, + = sliding left
    if (input.hand > 0.5) {
      // handbrake throws the tail towards the steering, up to a quarter (classic) or half (spin) turn
      this.hbYaw += Math.abs(yawRate) * dt;
      const lim = (tn.hbStyle === 'spin' ? Math.PI : Math.PI / 2) * (0.6 + 0.4 * tn.hbSwing);
      if (nc >= 2 && this.speed > 5 && Math.abs(input.steer) > 0.2 && this.hbYaw < lim)
        Tq.addScaledVector(up, Math.sign(input.steer) * I1 * 2.4 * tn.hbSwing * Math.min(1, this.speed / 12));
    } else {
      this.hbYaw = 0;
      if (nc >= 2 && vF > 4 && tn.stability > 0) {
        // once the car is sliding, pull its yaw rate back to what the steering asks for
        const engage = Math.max(0, Math.min(1, (Math.abs(beta) - 0.3) / 0.3)), cap = 9 / Math.max(vF, 5);
        const want = Math.max(-cap, Math.min(cap, vF * Math.tan(this.steer) / 2.55));
        Tq.addScaledVector(up, -(yawRate - want) * I1 * 1.8 * tn.stability * engage);
      }
      if (nc >= 2 && vF > 4 && thr > 0.3 && Math.abs(beta) > 0.14 && tn.carve > 0)   // a held drift carves round the bend
        this.vel.applyAxisAngle(up, -Math.sign(beta) * 0.32 * tn.carve * thr * Math.min(0.8, Math.abs(beta)) * dt);
    }

    // --- body vs ground (bottoming out, rollovers) ----------------------------
    this.impact = Math.max(0, this.impact - dt * 3);
    for (const b of S.body) {
      const P = v1.set(b[0], b[1], b[2]).applyQuaternion(q).add(this.pos);
      const h = g.h(P.x, P.z, this.bodyHint); if (g.T) this.bodyHint = g.T.qi;
      const pen = h - P.y;
      if (pen > 0) {
        const r = v2.copy(P).sub(this.pos);
        const vp = v3.crossVectors(this.angVel, r).add(this.vel);
        let fn = 160000 * pen - 9000 * vp.y; if (fn < 0) fn = 0; if (fn > 90000) fn = 90000;
        const tvx = vp.x, tvz = vp.z, tl = Math.hypot(tvx, tvz);
        const fr = tl > 0.05 ? Math.min(0.55 * fn, tl * 6000) / tl : 0;
        const force = new Vector3(-tvx * fr, fn, -tvz * fr);
        addForce(force, P);
        if (-vp.y > 2.5) { this.damage = Math.min(100, this.damage + (-vp.y) * 0.02); this.impact = 1; }
      }
    }

    // --- integrate ------------------------------------------------------------
    this.vel.addScaledVector(F, dt / S.mass);
    qt.copy(q).invert();
    const wl = v1.copy(this.angVel).applyQuaternion(qt);
    const tl = v2.copy(Tq).applyQuaternion(qt);
    const I = S.inertia;
    const gx = (I[1] - I[2]) * wl.y * wl.z, gy = (I[2] - I[0]) * wl.z * wl.x, gz = (I[0] - I[1]) * wl.x * wl.y;
    wl.x += dt * (tl.x + gx) / I[0]; wl.y += dt * (tl.y + gy) / I[1]; wl.z += dt * (tl.z + gz) / I[2];
    wl.multiplyScalar(1 - 0.05 * dt);
    this.angVel.copy(wl).applyQuaternion(q);
    this.pos.addScaledVector(this.vel, dt);
    const wv = this.angVel, wm = wv.length();
    if (wm > 1e-8) {
      qt.setFromAxisAngle(v3.copy(wv).multiplyScalar(1 / wm), wm * dt);
      q.premultiply(qt).normalize();
    }

    // --- trees ----------------------------------------------------------------
    if (this.trees) {
      for (const oz of [1.25, -1.25]) {
        const r = v2.set(0, 0, oz).applyQuaternion(q);
        const cx = this.pos.x + r.x, cz = this.pos.z + r.z;
        const list = this.trees(cx, cz);
        for (let k = 0; k < list.length; k++) {
          const t = list[k], dx = cx - t[0], dz = cz - t[1], rr = t[2] + 0.85;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
            const vp = v3.crossVectors(this.angVel, r).add(this.vel);
            const vn = vp.x * nx + vp.z * nz;
            this.pos.x += nx * (rr - d); this.pos.z += nz * (rr - d);
            if (vn < 0) {
              const j = -(1.25) * vn * S.mass * 0.55;
              this.applyImpulse(new Vector3(nx * j, 0, nz * j), r.clone());
              this.vel.multiplyScalar(0.985);
              if (-vn > 2) { this.damage = Math.min(100, this.damage + (-vn) * 1.1); this.impact = 1; }
            }
          }
        }
      }
    }
  }
}
