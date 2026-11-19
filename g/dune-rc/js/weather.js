// Wind. It is light most of the time, gusts now and then, and every several minutes builds into a sandstorm.
// Wind slowly fills ruts back in, streams sand along the ground, pushes light litter, and in a storm pushes the car.
import * as THREE from 'three';
import { WIND_ANGLE } from './world.js';
import { NF, CELL } from './sandfield.js';

const MASK = NF - 1;
const N = 2600;                                   // grains of blowing sand drawn around the camera

export class Weather {
  constructor(scene, groundHeight, U) {
    this.t = 0; this.dir = new THREE.Vector3(Math.cos(WIND_ANGLE), 0, Math.sin(WIND_ANGLE));
    this.speed = 1; this.storm = 0; this.force = -1;      // force: seconds of storm left when triggered by hand
    this.wind = new THREE.Vector3();
    this.gh = groundHeight; this.U = U; this.baseFog = U.uFog.value;
    this.row = 0;
    this.p = new Float32Array(N * 3); this.h = new Float32Array(N); this.par = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { this.p[i * 3] = (Math.random() - 0.5) * 30; this.p[i * 3 + 2] = (Math.random() - 0.5) * 30; this.h[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('par', new THREE.BufferAttribute(this.par, 2).setUsage(THREE.DynamicDrawUsage));
    this.col = new THREE.Color(0.8, 0.5, 0.2);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: this.col }, uPx: { value: 1000 }, uLightCol: U.uLightCol, uZenith: U.uZenith, uHorizon: U.uHorizon },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: `attribute vec2 par; uniform float uPx; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(par.x * uPx / max(0.05, -mv.z), 1.0, 14.0); vA = par.y; }`,
      fragmentShader: `uniform vec3 uCol, uLightCol, uZenith, uHorizon; varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
          gl_FragColor = vec4(uCol * (uLightCol * 0.6 + mix(uHorizon, uZenith, 0.5) * 0.6), vA * (1.0 - r * r)); }`,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 4;
    scene.add(this.points); this.geo = geo;
  }

  startStorm(secs = 75) { this.force = this.len = secs; }

  update(dt, cam, pxScale) {
    this.t += dt; const t = this.t;
    // Sandstorms come now and then: the first a few minutes in, then one every 6 to 15 minutes, each lasting about a minute or two.
    if (this.next === undefined) this.next = 150 + Math.random() * 240;
    if (this.force <= 0 && t > this.next) { this.startStorm(60 + Math.random() * 60); this.next = t + this.len + 360 + Math.random() * 540; }
    if (this.force > 0) this.force -= dt;
    const target = this.force > 0 ? Math.min(1, this.force / 8, (this.len - this.force) / 8 + 0.05) : 0;      // builds over 8 s, dies over 8 s
    this.storm += (target - this.storm) * Math.min(1, dt * 0.4);
    const gust = Math.max(0, Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1)) + 0.4 * Math.max(0, Math.sin(t * 1.3) * Math.sin(t * 0.23));
    this.speed = 1.0 + 2.2 * gust + 15 * this.storm * (0.8 + 0.2 * Math.sin(t * 0.9));     // m/s near the ground
    this.wind.copy(this.dir).multiplyScalar(this.speed);
    this.U.uFog.value = this.baseFog * (1 + 28 * this.storm * this.storm);
    this.U.uStorm.value = this.storm; this.U.uDust.value.copy(this.col);

    // Sand streaming along the ground, always in the direction of the wind. It travels in long ribbons that lie
    // along the wind (thick here, thin a metre to the side), the way real blowing sand snakes over a dune.
    const amt = Math.min(1, 0.3 + Math.max(0, this.speed - 1) / 6 * 0.5 + this.storm), top = 0.05 + 0.1 * Math.min(1, this.speed / 6) + 1.8 * this.storm;
    const { p, h, par } = this, vx = this.wind.x * 0.75, vz = this.wind.z * 0.75, dx = this.dir.x, dz = this.dir.z;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      let x = p[o] + vx * dt, z = p[o + 2] + vz * dt;
      const rx = x - cam.x, rz = z - cam.z;
      if (rx > 15) x -= 30; else if (rx < -15) x += 30; if (rz > 15) z -= 30; else if (rz < -15) z += 30;
      p[o] = x; p[o + 2] = z;
      p[o + 1] = this.gh(x, z) + 0.006 + h[i] * h[i] * top;
      const across = -x * dz + z * dx, along = x * dx + z * dz;
      const ribbon = 0.5 + 0.5 * Math.sin(across * 1.7 + 2.2 * Math.sin(along * 0.11 - t * this.speed * 0.05) + 1.3 * Math.sin(across * 0.31));
      par[i * 2] = 0.010 + 0.014 * this.storm * h[i];
      par[i * 2 + 1] = i < N * (0.35 + 0.65 * amt) ? (0.2 + 0.5 * amt) * (this.storm > 0.5 ? 1 : ribbon * ribbon) : 0;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.par.needsUpdate = true;
    this.mat.uniforms.uPx.value = pxScale;
  }

  // Wind moves the loose sand: it creeps downwind, so a rut fills from its upwind edge and a heap drifts and flattens.
  // A few rows of the sand grid each frame.
  fill(field, dt) {
    if (field.cj === null) return;
    const rows = 32, pass = NF / rows / 60;                 // seconds for one full sweep at 60 fps
    const tau = 300 / (1 + 14 * this.storm + 0.6 * Math.max(0, this.speed - 1.5));   // seconds for a mark to fade to about a third
    const keep = Math.max(0, 1 - pass / tau), d = field.d;
    const creep = Math.min(0.5, 0.004 * this.speed * this.speed);                     // share of a cell the sand moves downwind per sweep
    const ux = this.dir.x >= 0 ? -1 : 1, uz = this.dir.z >= 0 ? -1 : 1, ax = Math.abs(this.dir.x) / (Math.abs(this.dir.x) + Math.abs(this.dir.z)), az = 1 - ax;
    const j0 = field.cj - NF / 2 + this.row; let any = false;
    for (let j = j0; j < j0 + rows; j++) {
      const r = (j & MASK) * NF, ru = ((j + uz) & MASK) * NF;
      for (let i = 0; i < NF; i++) {
        const v = d[r + i], up = ax * d[r + ((i + ux) & MASK)] + az * d[ru + i];      // the sand just upwind of here
        if (v === 0 && up === 0) continue;
        const nv = (v + creep * (up - v)) * keep; d[r + i] = Math.abs(nv) < 2e-5 ? 0 : nv; any = true;
      }
    }
    if (any) field.mark(field.ci - NF / 2, j0, field.ci + NF / 2 - 1, j0 + rows - 1);
    this.row = (this.row + rows) % NF;
  }
}
