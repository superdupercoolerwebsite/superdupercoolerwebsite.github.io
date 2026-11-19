// Thrown sand. Every grain here is its own little body: it is launched by the tyre that scraped it up,
// flies under gravity and air drag, bounces off the car, and where it lands it becomes part of the sand surface again.
// (A real handful of sand is millions of grains; each one here stands for a small clump, about 5 mm across.)
import * as THREE from 'three';
import { U } from './sky.js';
const TYRE_HALF = 0.023;

const MAX = 120000;
const VG = 7.5e-9;                        // m^3 of sand in one grain-clump
const DIAM = Math.cbrt(6 * VG / Math.PI);
let BOX = { x: 0.095, y0: -0.028, y1: 0.12, z: 0.20 };   // the car body, for grains that hit it (set from the car each frame)

export class Sand {
  constructor(scene, groundHeight, field) {
    this.groundHeight = groundHeight; this.field = field;
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); this.max = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);       // 0 grain, 1 dust (dust is only something to see)
    this.size = new Float32Array(MAX);
    this.par = new Float32Array(MAX * 2);  // size, alpha
    this.next = 0; this.alive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('par', new THREE.BufferAttribute(this.par, 2).setUsage(THREE.DynamicDrawUsage));
    this.color = new THREE.Color(0.74, 0.39, 0.11);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: this.color }, uPx: { value: 1000 }, uLightCol: U.uLightCol, uLightDir: U.uLightDir, uZenith: U.uZenith, uHorizon: U.uHorizon },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,     // leave the outline mask alone
      vertexShader: `attribute vec2 par; uniform float uPx; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(par.x * uPx / max(0.02, -mv.z), 1.5, par.y > 0.5 ? 40.0 : 260.0); vA = par.y; }`,
      fragmentShader: `uniform vec3 uCol, uLightCol, uLightDir, uZenith, uHorizon; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float soft = vA < 0.5 ? 1.0 - r * r : 1.0 - smoothstep(0.7, 1.0, r);
          vec3 light = uLightCol * (0.35 + 0.45 * max(uLightDir.y, 0.0)) + mix(uHorizon, uZenith, 0.5) * 0.6;
          gl_FragColor = vec4(uCol * light * (1.0 - 0.35 * c.y), vA * soft); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
    this.acc = [0, 0, 0, 0, 0]; this.dustAcc = 0;      // four wheels, and one for the chassis
    this.obstacles = [];                  // balls of nearby litter, filled in by the litter system each frame
  }

  add(kind, x, y, z, vx, vy, vz, size, life) {
    const i = this.next; this.next = (i + 1) % MAX;
    if (this.life[i] > 0 && this.kind[i] === 0) this.field.deposit(this.p[i * 3], this.p[i * 3 + 2], VG);   // recycled early: its sand still lands
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.kind[i] = kind; this.size[i] = size; this.life[i] = life; this.max[i] = life;
  }

  // `vol` m^3 of sand scraped from under wheel number `wi`, flung along the ground direction (dx,dy,dz) at up to `speed` m/s.
  // Each grain leaves from its own spot across the tyre at its own release angle, which is why they fan out.
  fling(wi, w, vol, dx, dy, dz, speed) {
    this.acc[wi] += vol;
    while (this.acc[wi] >= VG) {
      this.acc[wi] -= VG;
      const across = Math.random() * 2 - 1;                       // where across the tyre it sat
      const ang = 0.15 + 0.95 * Math.random();                    // how far round the tyre it was carried before letting go
      const k = 0.35 + 0.6 * Math.random() * (1 - 0.4 * ang);     // deeper sand is dragged along slower
      const sp = speed * k, ca = Math.cos(ang) * sp, sa = Math.sin(ang) * sp, sd = across * 0.14 * sp;
      this.add(0, w.c.x + w.s.x * across * (w.half || TYRE_HALF) - dx * 0.02, w.c.y + 0.006 + 0.02 * ang, w.c.z + w.s.z * across * (w.half || TYRE_HALF) - dz * 0.02,
        dx * ca + w.n.x * sa + w.s.x * sd, dy * ca + w.n.y * sa + w.s.y * sd, dz * ca + w.n.z * sa + w.s.z * sd, DIAM, 6);
    }
    this.dustAcc += vol;
    if (this.dustAcc > 9e-7) {
      this.dustAcc = 0;
      this.add(1, w.c.x, w.c.y + 0.04, w.c.z, dx * speed * 0.12, 0.2 + Math.random() * 0.3, dz * speed * 0.12, 0.18 + 0.2 * Math.random(), 1.5 + Math.random());
    }
  }

  // a landing: sand squirts out in a ring
  burst(w, vol, hard) {
    const cnt = Math.min(3000, Math.floor(vol / VG));
    for (let k = 0; k < cnt; k++) {
      const a = Math.random() * 6.283, sp = (0.3 + 0.7 * Math.random()) * hard * 0.6;
      this.add(0, w.c.x + Math.cos(a) * 0.03, w.c.y + 0.008, w.c.z + Math.sin(a) * 0.03, Math.cos(a) * sp, sp * (0.5 + 0.7 * Math.random()), Math.sin(a) * sp, DIAM, 6);
    }
    for (let k = 0; k < 2; k++) this.add(1, w.c.x, w.c.y + 0.05, w.c.z, (Math.random() - 0.5), 0.3 + Math.random() * 0.3, (Math.random() - 0.5), 0.25 + 0.2 * Math.random(), 1.5 + Math.random());
  }

  update(dt, pxScale, car, wind) {
    const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
    { const S = car.spec; BOX.x = S.halfW + 0.01; BOX.y0 = S.belly; BOX.y1 = S.top * 0.75; BOX.z = Math.max(-S.nose, S.tail) - 0.02; }
    const { p, v, life, par } = this, obs = this.obstacles, GM = VG * 1600;   // one clump of dry sand weighs about a tenth of a gram
    const cx = car.pos.x, cy = car.pos.y, cz = car.pos.z, R = car.R, Uc = car.U, F = car.F, cv = car.vel;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) { par[i * 2 + 1] = 0; continue; }
      life[i] -= dt; alive++;
      const o = i * 3;
      if (this.kind[i] === 0) {
        // gravity and air drag (a clump this size falls at about 12 m/s flat out)
        // air drag is on its speed through the air, and the air is moving: wind bends every grain's flight downwind
        const ax = v[o] - wx, az = v[o + 2] - wz, sp = Math.hypot(ax, v[o + 1], az), dr = 0.068 * sp * dt;
        v[o] -= ax * dr; v[o + 1] -= v[o + 1] * dr + 9.81 * dt; v[o + 2] -= az * dr;
        p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
        // hits the car body? bounce off it (sand barely bounces)
        const rx = p[o] - cx, ry = p[o + 1] - cy, rz = p[o + 2] - cz;
        if (rx * rx + ry * ry + rz * rz < 0.09) {
          const lx = rx * R.x + ry * R.y + rz * R.z, ly = rx * Uc.x + ry * Uc.y + rz * Uc.z, lz = -(rx * F.x + ry * F.y + rz * F.z);
          if (Math.abs(lx) < BOX.x && ly > BOX.y0 && ly < BOX.y1 && Math.abs(lz) < BOX.z) {
            const ex = BOX.x - Math.abs(lx), ey = Math.min(ly - BOX.y0, BOX.y1 - ly), ez = BOX.z - Math.abs(lz);
            let nx, ny, nz, push;
            if (ex < ey && ex < ez) { const sg = Math.sign(lx); nx = R.x * sg; ny = R.y * sg; nz = R.z * sg; push = ex; }
            else if (ey < ez) { const sg = ly - BOX.y0 < BOX.y1 - ly ? -1 : 1; nx = Uc.x * sg; ny = Uc.y * sg; nz = Uc.z * sg; push = ey; }
            else { const sg = -Math.sign(lz); nx = F.x * sg; ny = F.y * sg; nz = F.z * sg; push = ez; }
            p[o] += nx * push; p[o + 1] += ny * push; p[o + 2] += nz * push;
            const rel = (v[o] - cv.x) * nx + (v[o + 1] - cv.y) * ny + (v[o + 2] - cv.z) * nz;
            if (rel < 0) { v[o] -= 1.15 * rel * nx; v[o + 1] -= 1.15 * rel * ny; v[o + 2] -= 1.15 * rel * nz; }
          }
        }
        // hits a piece of litter? it bounces off, and gives the piece a tiny shove (a whole roost can roll a can)
        for (let k = 0; k < obs.length; k++) {
          const ob = obs[k], dx = p[o] - ob.x, dy = p[o + 1] - ob.y, dz = p[o + 2] - ob.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= ob.r * ob.r || d2 < 1e-10) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, bv = ob.o.vel;
          p[o] = ob.x + nx * ob.r; p[o + 1] = ob.y + ny * ob.r; p[o + 2] = ob.z + nz * ob.r;
          const rel = (v[o] - bv.x) * nx + (v[o + 1] - bv.y) * ny + (v[o + 2] - bv.z) * nz;
          if (rel < 0) {
            v[o] -= 1.15 * rel * nx; v[o + 1] -= 1.15 * rel * ny; v[o + 2] -= 1.15 * rel * nz;
            const j = 1.15 * rel * GM / ob.o.T.m;
            bv.x += nx * j; bv.y += ny * j; bv.z += nz * j;
            if (ob.o.T.m < 0.5) { ob.o.asleep = false; ob.o.still = 0; }
          }
          break;
        }
        // lands: it is sand on the ground again, and the surface there gets a little higher
        if (p[o + 1] <= this.groundHeight(p[o], p[o + 2]) || life[i] <= 0) { this.field.deposit(p[o], p[o + 2], VG); life[i] = 0; par[i * 2 + 1] = 0; continue; }
        par[i * 2] = this.size[i]; par[i * 2 + 1] = 0.97;
      } else {
        const dr = Math.min(1, 2.2 * dt); v[o] += (wx - v[o]) * dr; v[o + 1] -= v[o + 1] * dr; v[o + 2] += (wz - v[o + 2]) * dr;      // dust goes where the air goes
        p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
        const t = 1 - life[i] / this.max[i];
        par[i * 2] = this.size[i] * (1 + 2.2 * t);
        par[i * 2 + 1] = Math.max(0, 0.06 * Math.min(1, t * 8) * (1 - t));
      }
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.par.needsUpdate = true;
    this.mat.uniforms.uPx.value = pxScale;
  }
}
