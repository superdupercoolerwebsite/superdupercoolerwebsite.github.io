// Living things, real size, so they are tiny next to the dunes and big next to the car:
// beetles that plod along leaving tracks, lizards that bolt, scorpions that stand their ground, birds circling overhead.
// (Simple stand-in shapes; these are the first things worth swapping for proper models.)
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { clone as cloneRigged } from '../lib/SkeletonUtils.js';

// Real models where we have them (see assets/CREDITS.txt); anything missing falls back to the simple built-in shape.
const MODELS = {};
export async function loadCritterModels() {
  const L = new GLTFLoader(), get = u => new Promise(r => L.load(u, r, undefined, () => r(null)));
  const [sc, sn, cm] = await Promise.all([get('./assets/models/scorpion/scene.gltf'), get('./assets/models/snake.glb'), get('./assets/models/camel.glb')]);
  if (sc) MODELS.scorpion = sc; if (cm) MODELS.camel = cm;
  if (sn) {                                         // the snake model is a straight stick: keep its points so we can bend it as it moves
    sn.scene.updateMatrixWorld(true); let best = null;
    const zlen = o => { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); return b.max.z - b.min.z; };
    sn.scene.traverse(o => { if (o.isMesh && (!best || zlen(o) > zlen(best))) best = o; });      // the body is the longest piece (the others are its eyes)
    const g = best.geometry.clone().applyMatrix4(best.matrixWorld); g.computeBoundingBox();
    MODELS.snake = { geo: g, mat: best.material, box: g.boundingBox };
  }
}
const SX = new Float32Array(16), SY = new Float32Array(16), SZ = new Float32Array(16);

const CELLSZ = 40, LOAD_R = 2;
function hash(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mat = (c, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const part = (geo, m, x = 0, y = 0, z = 0) => { const p = new THREE.Mesh(geo, m); p.position.set(x, y, z); return p; };
const KIND = {
  beetle: { len: 0.03, speed: 0.06, r: 0.012, weight: 5 },
  lizard: { len: 0.16, speed: 2.6, r: 0.02, weight: 3 },
  scorpion: { len: 0.08, speed: 0.25, r: 0.02, weight: 2 },
  snake: { len: 0.55, speed: 0.45, r: 0.018, weight: 1 },
  ants: { len: 0.006, speed: 0.03, r: 0, weight: 1 },
};
function build(kind) {
  const g = new THREE.Group(), legs = [];
  if (kind === 'scorpion' && MODELS.scorpion) {      // rigged model, 8 cm long, with its own walking animation
    const m = cloneRigged(MODELS.scorpion.scene); m.scale.setScalar(0.08 / 7.72); m.rotation.y = Math.PI; m.traverse(o => { o.frustumCulled = false; });
    g.add(m); g.userData.mixer = new THREE.AnimationMixer(m); g.userData.mixer.clipAction(MODELS.scorpion.animations[0]).play();
    g.userData.tail = new THREE.Group(); g.userData.legs = legs; return g;
  }
  if (kind === 'snake' && MODELS.snake) {
    const m = new THREE.Mesh(MODELS.snake.geo.clone(), MODELS.snake.mat); m.frustumCulled = false; m.visible = false; g.add(m);
    g.userData.skin = m; g.userData.base = MODELS.snake.geo.attributes.position.array; g.userData.segs = []; g.userData.legs = legs; return g;
  }
  if (kind === 'snake') {                          // a sidewinder: a chain of beads that we bend into moving curves
    const m = mat(0xc9ad7a, 0.8), segs = [];
    for (let i = 0; i < 16; i++) { const r = i === 0 ? 0.016 : 0.014 * (1 - i / 22); const s = part(new THREE.SphereGeometry(r, 8, 6), i % 3 === 1 ? mat(0x8a6a44, 0.8) : m); g.add(s); segs.push(s); }
    g.userData.segs = segs; g.userData.legs = legs; return g;
  }
  if (kind === 'ants') {                           // a column of ants marching between two points
    const m = mat(0x1a1210, 0.5), ants = [];
    for (let i = 0; i < 22; i++) { const a = part(new THREE.BoxGeometry(0.0022, 0.0018, 0.006), m); g.add(a); ants.push(a); }
    g.userData.ants = ants; g.userData.legs = legs; return g;
  }
  const leg = (x, z, l, m) => { const p = new THREE.Group(); p.position.set(x, 0, z); const b = part(new THREE.BoxGeometry(l, 0.0015, 0.002), m, Math.sign(x) * l / 2, -0.003, 0); p.add(b); g.add(p); legs.push(p); };
  if (kind === 'beetle') {
    const m = mat(0x15151a, 0.25), b = part(new THREE.SphereGeometry(0.011, 10, 8), m, 0, 0.007, 0.004); b.scale.set(0.85, 0.6, 1.25);
    g.add(b, part(new THREE.SphereGeometry(0.005, 8, 6), m, 0, 0.006, -0.013));
    for (const z of [-0.008, 0, 0.008]) for (const x of [-0.008, 0.008]) leg(x, z, 0.012, m);
  } else if (kind === 'lizard') {
    const m = mat(0xb39a6a, 0.9), b = part(new THREE.CapsuleGeometry(0.011, 0.05, 3, 8), m, 0, 0.012, 0); b.rotation.x = Math.PI / 2;
    const t = part(new THREE.ConeGeometry(0.008, 0.08, 6), m, 0, 0.01, 0.075); t.rotation.x = Math.PI / 2;
    g.add(b, t, part(new THREE.SphereGeometry(0.011, 8, 6), m, 0, 0.015, -0.042));
    for (const z of [-0.02, 0.022]) for (const x of [-0.011, 0.011]) leg(x, z, 0.022, m);
  } else {
    const m = mat(0x6a4a22, 0.5), b = part(new THREE.SphereGeometry(0.014, 10, 8), m, 0, 0.008, 0); b.scale.set(0.8, 0.5, 1.5);
    g.add(b);
    const tail = new THREE.Group(); tail.position.set(0, 0.01, 0.018);
    for (let i = 0; i < 5; i++) tail.add(part(new THREE.SphereGeometry(0.004, 6, 5), m, 0, Math.sin(i * 0.5) * 0.02 + i * 0.004, Math.cos(i * 0.5) * 0.012 * (i < 3 ? 1 : -0.5) + 0.006 * Math.min(i, 2)));
    g.add(tail); g.userData.tail = tail;
    for (const x of [-1, 1]) { const c = part(new THREE.BoxGeometry(0.004, 0.003, 0.02), m, x * 0.012, 0.007, -0.026); c.rotation.y = x * 0.5; g.add(c, part(new THREE.SphereGeometry(0.005, 6, 5), m, x * 0.017, 0.007, -0.037)); }
    for (const z of [-0.01, -0.003, 0.004, 0.011]) for (const x of [-0.011, 0.011]) leg(x, z, 0.014, m);
  }
  g.userData.legs = legs;
  return g;
}

export class Critters {
  constructor(scene, groundHeight, field) {
    this.scene = scene; this.gh = groundHeight; this.field = field; this.cells = new Map(); this.list = []; this.t = 0;
    this.birds = [];                    // (the hand-built birds are gone: only downloaded models are used for animals)
  }

  make(kind, x, z, seed) {
    const c = { kind, K: KIND[kind], x, z, yaw: seed * 6.283, seed, mode: 'walk', timer: seed * 5, mesh: build(kind), walk: 0, lx: x, lz: z };
    this.scene.add(c.mesh); this.list.push(c); return c;
  }
  seedNear(x, z) {
    if (MODELS.scorpion) [[2.8, -6.4], [-3.4, -9.0]].forEach((l, i) => this.make('scorpion', x + l[0], z + l[1], hash(i, 3, 9)));
    // a camel, real size, walking a wide circle a few hundred metres out: something to see on the skyline
    if (MODELS.camel) {                              // rigged model, real size, with its own walk
      const g = cloneRigged(MODELS.camel.scene); g.traverse(o => { o.frustumCulled = false; });
      const mixer = new THREE.AnimationMixer(g), clip = MODELS.camel.animations.find(a => /walk/i.test(a.name)) || MODELS.camel.animations[0];
      mixer.clipAction(clip).play(); this.scene.add(g); this.camel = { g, legs: [], cx: x, cz: z, R: 330, a: 1.0, mixer };
      return;
    }
  }

  loadCells(cx, cz) {
    const ci = Math.floor(cx / CELLSZ), cj = Math.floor(cz / CELLSZ);
    if (ci === this.ci && cj === this.cj) return; this.ci = ci; this.cj = cj;
    for (let j = cj - LOAD_R; j <= cj + LOAD_R; j++) for (let i = ci - LOAD_R; i <= ci + LOAD_R; i++) {
      const key = i + '_' + j; if (this.cells.has(key)) continue;
      const list = []; this.cells.set(key, list);
      // animals use downloaded models only, so for now that means scorpions (about one square in three)
      if (MODELS.scorpion && hash(i, j, 61) > 0.66) list.push(this.make('scorpion', (i + hash(i, j, 70)) * CELLSZ, (j + hash(i, j, 80)) * CELLSZ, hash(i, j, 90)));
    }
    for (const [key, list] of this.cells) {
      const [i, j] = key.split('_').map(Number);
      if (Math.abs(i - ci) <= LOAD_R + 1 && Math.abs(j - cj) <= LOAD_R + 1) continue;
      for (const c of list) { this.scene.remove(c.mesh); this.list.splice(this.list.indexOf(c), 1); }
      this.cells.delete(key);
    }
  }

  // once per drawn frame; balls = the car's collision balls from the litter system
  update(dt, car, balls) {
    this.t += dt; const t = this.t;
    for (const c of this.list) {
      const dx = c.x - car.pos.x, dz = c.z - car.pos.z, d = Math.hypot(dx, dz);
      if (d > 45) continue;
      const K = c.K, carSp = car.vel.length(); let sp = 0;
      c.timer -= dt;
      if (c.kind === 'ants') {                         // each ant keeps its place in the column; they do not notice the car
        const ants = c.mesh.userData.ants, ca = Math.cos(c.yaw), sa = Math.sin(c.yaw); c.walk += K.speed * dt;
        c.mesh.position.set(0, 0, 0); c.mesh.rotation.y = 0;
        for (let i = 0; i < ants.length; i++) {
          const u = ((i / ants.length + c.walk / 3.2) % 1) * 3.2 - 1.6, wob = 0.012 * Math.sin(u * 23 + i * 2.1);
          const ax = c.x + ca * u - sa * wob, az = c.z + sa * u + ca * wob;
          ants[i].position.set(ax, this.gh(ax, az) + 0.0012, az); ants[i].rotation.y = -c.yaw + Math.PI / 2;
        }
        continue;
      }
      if (c.kind === 'snake') {                        // sidewinds: travels at an angle to the way it points, leaving separate slanted marks
        const flee = d < 2.2 && carSp > 0.3; if (flee) { c.yaw = Math.atan2(dx, dz) + 2.2; }
        else if (c.timer < 0) { c.timer = 5 + 6 * c.seed; c.yaw += (hash(Math.floor(t), 8, Math.floor(c.seed * 999)) - 0.5) * 1.5; c.mode = c.mode === 'walk' ? 'still' : 'walk'; }
        sp = flee ? K.speed * 3 : c.mode === 'walk' ? K.speed : 0;
        const ta = c.yaw + 0.9;                        // direction of travel, 50 degrees off the body line
        c.x += Math.sin(ta) * sp * dt; c.z += Math.cos(ta) * sp * dt; c.walk += sp * dt;
        const segs = c.mesh.userData.segs, by = Math.sin(c.yaw), bz = Math.cos(c.yaw);
        c.mesh.position.set(0, 0, 0); c.mesh.rotation.y = 0;
        if (c.mesh.userData.skin) {
          for (let i = 0; i < 16; i++) {
            const along = (i - 7) * 0.036, side = 0.05 * Math.sin(i * 0.75 - c.walk * 14) * (sp > 0 ? 1 : 0.5);
            SX[i] = c.x - by * along + bz * side; SZ[i] = c.z - bz * along - by * side;
            SY[i] = this.gh(SX[i], SZ[i]) + (sp > 0 ? 0.008 * Math.max(0, Math.sin(i * 0.75 - c.walk * 14 + 1.2)) : 0);
          }
          const base = c.mesh.userData.base, P = c.mesh.userData.skin.geometry.attributes.position, A = P.array, bb = MODELS.snake.box, zl = bb.max.z - bb.min.z, sc2 = K.len / zl;
          for (let k = 0; k < A.length; k += 3) {
            const f = Math.min(14.999, (bb.max.z - base[k + 2]) / zl * 15), i0 = Math.floor(f), fr = f - i0, ox = base[k] * sc2;
            A[k] = SX[i0] + (SX[i0 + 1] - SX[i0]) * fr + bz * ox; A[k + 2] = SZ[i0] + (SZ[i0 + 1] - SZ[i0]) * fr - by * ox;
            A[k + 1] = SY[i0] + (SY[i0 + 1] - SY[i0]) * fr + (base[k + 1] - bb.min.y) * sc2;
          }
          P.needsUpdate = true; c.mesh.userData.skin.visible = true;
        }
        for (let i = 0; i < segs.length; i++) {
          const along = (i - 7) * 0.036, side = 0.05 * Math.sin(i * 0.75 - c.walk * 14) * (sp > 0 ? 1 : 0.5);
          const sx2 = c.x - by * along + bz * side, sz2 = c.z - bz * along - by * side;
          segs[i].position.set(sx2, this.gh(sx2, sz2) + 0.012 + (sp > 0 ? 0.008 * Math.max(0, Math.sin(i * 0.75 - c.walk * 14 + 1.2)) : 0), sz2);
        }
        if (d < 14 && c.walk - (c.lw || 0) > 0.13) { c.lw = c.walk; this.field.press(c.x - by * 0.2, c.z - bz * 0.2, c.x + by * 0.2, c.z + bz * 0.2, 0.014, 0.003, 0); }   // one mark per body-length shuffle
        continue;
      }
      if (c.kind === 'beetle') {                       // plods on, turning now and then; does not notice the car until it is hit
        if (c.timer < 0) { c.timer = 3 + 5 * hash(Math.floor(t), 1, Math.floor(c.seed * 999)); c.turn = (hash(Math.floor(t * 7), 2, Math.floor(c.seed * 999)) - 0.5) * 1.2; }
        c.yaw += (c.turn || 0) * dt * 0.4; sp = K.speed;
      } else if (c.kind === 'lizard') {                // freezes, then bolts away from anything that comes close
        if (c.mode !== 'run' && d < 1.8 && carSp > 0.3) { c.mode = 'run'; c.timer = 0.8 + c.seed; c.yaw = Math.atan2(-dx, -dz) + Math.PI + (c.seed - 0.5); }
        if (c.mode === 'run') { sp = K.speed; if (c.timer < 0) { c.mode = 'still'; c.timer = 2 + 4 * c.seed; } }
        else if (c.timer < 0) { c.mode = c.mode === 'still' ? 'walk' : 'still'; c.timer = 1 + 3 * hash(Math.floor(t), 5, Math.floor(c.seed * 999)); c.yaw += (hash(Math.floor(t), 6, Math.floor(c.seed * 999)) - 0.5) * 2; }
        if (c.mode === 'walk') sp = 0.25;
      } else {                                         // scorpion: turns to face the car and raises its tail; otherwise creeps
        if (d < 1.5) { const want = Math.atan2(-(-dx), -(-dz)); let e = want - c.yaw; e = Math.atan2(Math.sin(e), Math.cos(e)); c.yaw += e * Math.min(1, dt * 4); c.mesh.userData.tail.rotation.x = -0.6; }
        else { c.mesh.userData.tail.rotation.x = 0; if (c.timer < 0) { c.timer = 4 + 6 * c.seed; c.mode = c.mode === 'walk' ? 'still' : 'walk'; c.yaw += (c.seed - 0.5) * 2; } if (c.mode === 'walk') sp = K.speed; }
      }
      c.x += -Math.sin(c.yaw) * sp * dt; c.z += -Math.cos(c.yaw) * sp * dt;
      // shoved aside by the car
      if (d < 0.6) for (const b of balls) {
        const bx = c.x - b.c.x, bz = c.z - b.c.z, by = this.gh(c.x, c.z) + K.r - b.c.y, dd = Math.hypot(bx, by, bz);
        if (dd < b.r + K.r && dd > 1e-5) { const h = Math.hypot(bx, bz) || 1e-5, push = (b.r + K.r - dd); c.x += bx / h * push; c.z += bz / h * push; }
      }
      const y = this.gh(c.x, c.z);
      c.walk += sp * dt;
      // footprints: tiny, but real marks in the sand
      if (d < 14 && Math.hypot(c.x - c.lx, c.z - c.lz) > K.len * 0.6) { this.field.press(c.lx, c.lz, c.x, c.z, Math.max(0.008, K.r * 0.6), c.kind === 'lizard' ? 0.0012 : 0.0006, 0); c.lx = c.x; c.lz = c.z; }
      c.mesh.position.set(c.x, y + 0.004, c.z); c.mesh.rotation.y = c.yaw;
      if (c.mesh.userData.mixer) c.mesh.userData.mixer.update(dt * (sp > 0 ? 1.5 : 0.25));
      const legs = c.mesh.userData.legs, ph = c.walk / K.len * 9;
      for (let i = 0; i < legs.length; i++) legs[i].rotation.y = Math.sin(ph + (i % 2 ? Math.PI : 0) + Math.floor(i / 2)) * 0.5 * (sp > 0 ? 1 : 0);
    }
    if (this.camel) {
      const cm = this.camel; cm.a += 1.1 / cm.R * dt;                       // 1.1 m/s, a camel's amble
      const x = cm.cx + Math.cos(cm.a) * cm.R, z = cm.cz + Math.sin(cm.a) * cm.R;
      cm.g.position.set(x, this.gh(x, z) - 0.05, z); cm.g.rotation.y = -cm.a + Math.PI;
      for (let i = 0; i < cm.legs.length; i++) cm.legs[i].rotation.x = Math.sin(t * 2.4 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.35;
      if (cm.mixer) cm.mixer.update(dt);
    }
    for (const b of this.birds) {
      const a = t * b.sp + b.ph, x = car.pos.x + Math.cos(a) * b.R, z = car.pos.z + Math.sin(a) * b.R;
      b.g.position.set(x, this.gh(car.pos.x, car.pos.z) + b.h + Math.sin(t * 0.3 + b.ph) * 3, z);
      b.g.rotation.y = -a; const fl = Math.sin(t * 2.2 + b.ph) > 0.6 ? Math.sin(t * 9) * 0.5 : 0.12;      // mostly glides, flaps now and then
      b.wings[0].rotation.z = -fl; b.wings[1].rotation.z = fl;
    }
  }
}
