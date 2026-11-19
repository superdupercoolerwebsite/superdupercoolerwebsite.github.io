// Desert plants: dry grass tufts and small woody bushes, real size.
// They sway in the wind, bend flat when the car drives through and spring back, slow the car a little,
// and light litter that blows or rolls into a bush gets caught in it.
import * as THREE from 'three';

const CELLSZ = 40, LOAD_R = 2;
function hash(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const GRASS = new THREE.MeshStandardMaterial({ color: 0xb9a35c, roughness: 0.9, side: THREE.DoubleSide });
const TWIG = new THREE.MeshStandardMaterial({ color: 0x6d5536, roughness: 1 });
const LEAF = new THREE.MeshStandardMaterial({ color: 0x7c8750, roughness: 0.9 });
const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), q = new THREE.Quaternion();

function build(kind, seed) {
  const g = new THREE.Group(), stems = [];
  const rnd = k => hash(Math.floor(seed * 9973), k, 77);
  if (kind === 'grass') {
    for (let i = 0; i < 16; i++) {                                 // a tuft of blades, each hinged at the root
      const h = 0.10 + 0.16 * rnd(i), a = rnd(i + 50) * 6.283, lean = 0.15 + 0.5 * rnd(i + 100);
      const p = new THREE.Group(), b = new THREE.Mesh(new THREE.ConeGeometry(0.004, h, 3), GRASS); b.position.y = h / 2; p.add(b);
      p.position.set(Math.cos(a) * 0.025 * rnd(i + 9), 0, Math.sin(a) * 0.025 * rnd(i + 19));
      p.userData.rest = new THREE.Quaternion().setFromAxisAngle(v.set(Math.cos(a), 0, Math.sin(a)).normalize(), lean);
      p.quaternion.copy(p.userData.rest); g.add(p); stems.push(p);
    }
  } else {
    for (let i = 0; i < 9; i++) {                                  // woody stems with a few tufts of small leaves
      const h = 0.25 + 0.3 * rnd(i), a = rnd(i + 50) * 6.283, lean = 0.2 + 0.6 * rnd(i + 100);
      const p = new THREE.Group(), b = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.008, h, 5), TWIG); b.position.y = h / 2; p.add(b);
      for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03 + 0.025 * rnd(i * 7 + k), 0), LEAF); l.position.set((rnd(i + k * 3) - 0.5) * 0.08, h * (0.55 + 0.2 * k), (rnd(i + k * 5) - 0.5) * 0.08); p.add(l); }
      p.userData.rest = new THREE.Quaternion().setFromAxisAngle(v.set(Math.cos(a), 0, Math.sin(a)).normalize(), lean);
      p.quaternion.copy(p.userData.rest); g.add(p); stems.push(p);
    }
  }
  g.userData.stems = stems;
  return g;
}

export class Plants {
  constructor(scene, analyticHeight) { this.scene = scene; this.ah = analyticHeight; this.cells = new Map(); this.list = []; this.t = 0; }

  make(kind, x, z, seed) {
    const p = { kind, x, z, y: this.ah(x, z), seed, r: kind === 'grass' ? 0.09 : 0.24, h: kind === 'grass' ? 0.2 : 0.5, bend: 0, bx: 0, bz: 0, mesh: build(kind, seed), caught: 0 };
    p.mesh.position.set(x, p.y, z); p.mesh.rotation.y = seed * 6.283;
    this.scene.add(p.mesh); this.list.push(p); return p;
  }
  seedNear(x, z) { [['grass', 2.6, -1.0], ['grass', 3.0, -1.4], ['bush', -3.0, -3.0], ['grass', -1.2, -9.5], ['bush', 4.5, -6.0]].forEach((l, i) => this.make(l[0], x + l[1], z + l[2], hash(i, 4, 8))); }

  loadCells(cx, cz) {
    const ci = Math.floor(cx / CELLSZ), cj = Math.floor(cz / CELLSZ);
    if (ci === this.ci && cj === this.cj) return; this.ci = ci; this.cj = cj;
    for (let j = cj - LOAD_R; j <= cj + LOAD_R; j++) for (let i = ci - LOAD_R; i <= ci + LOAD_R; i++) {
      const key = i + '_' + j; if (this.cells.has(key)) continue;
      const list = []; this.cells.set(key, list);
      // plants come in patches: most squares have none, some have a little clump
      const n = hash(i, j, 111) > 0.62 ? 2 + Math.floor(hash(i, j, 112) * 5) : 0;
      const px = (i + 0.15 + 0.7 * hash(i, j, 113)) * CELLSZ, pz = (j + 0.15 + 0.7 * hash(i, j, 114)) * CELLSZ;
      for (let k = 0; k < n; k++) list.push(this.make(hash(i, j, 120 + k) < 0.7 ? 'grass' : 'bush', px + (hash(i, j, 130 + k) - 0.5) * 6, pz + (hash(i, j, 140 + k) - 0.5) * 6, hash(i, j, 150 + k)));
    }
    for (const [key, list] of this.cells) {
      const [i, j] = key.split('_').map(Number);
      if (Math.abs(i - ci) <= LOAD_R + 1 && Math.abs(j - cj) <= LOAD_R + 1) continue;
      for (const p of list) { this.scene.remove(p.mesh); this.list.splice(this.list.indexOf(p), 1); }
      this.cells.delete(key);
    }
  }

  // every physics step: what plants do to the car and to light litter
  step(dt, car, litter) {
    for (const p of this.list) {
      const dx = car.pos.x - p.x, dz = car.pos.z - p.z, d2 = dx * dx + dz * dz, reach = p.r + 0.2;
      if (d2 < reach * reach && car.pos.y - p.y < p.h + 0.15) {
        // stems drag on the car as it pushes through: barely anything for grass, a real tug for a bush
        const sp = car.vel.length(), over = 1 - Math.sqrt(d2) / reach;
        if (sp > 0.05) { v.copy(car.vel).multiplyScalar(-(p.kind === 'grass' ? 0.25 : 1.6) * over * dt * (1 + 0.15 * sp)); car.applyImpulse(v, car.pos); }
        p.bend = Math.min(1, p.bend + dt * 8 * over); const l = Math.hypot(car.vel.x, car.vel.z) || 1; p.bx = car.vel.x / l; p.bz = car.vel.z / l;
      }
    }
    // a bush catches light litter: once in the twigs it loses its speed and stays
    for (const o of litter.near) {
      if (o.T.m > 0.1 || o.asleep) continue;
      for (const p of this.list) {
        if (p.kind !== 'bush') continue;
        const dx = o.pos.x - p.x, dz = o.pos.z - p.z; if (dx * dx + dz * dz > p.r * p.r || o.pos.y - p.y > p.h) continue;
        const k = 1 - Math.min(1, 9 * dt); o.vel.multiplyScalar(k); o.w.multiplyScalar(k); o.caught = p;
      }
    }
  }

  // every drawn frame: sway and bend
  update(dt, weather) {
    this.t += dt;
    for (const p of this.list) {
      p.bend = Math.max(0, p.bend - dt * (p.kind === 'grass' ? 1.2 : 2.5));           // springs back; grass is slower
      const stems = p.mesh.userData.stems, w = Math.min(1.2, weather.speed * 0.045), cy = Math.cos(-p.mesh.rotation.y), sy = Math.sin(-p.mesh.rotation.y);
      for (let i = 0; i < stems.length; i++) {
        const s = stems[i], sway = w * (0.6 + 0.4 * Math.sin(this.t * (2.2 + i * 0.13) + i * 1.7 + p.seed * 9));
        // lean with the wind, and flat along the car's path while it is being run over (in the plant's own frame)
        let lx = weather.dir.x * sway + p.bx * p.bend * 1.35, lz = weather.dir.z * sway + p.bz * p.bend * 1.35;
        const rx = lx * cy + lz * sy, rz = -lx * sy + lz * cy, a = Math.hypot(rx, rz);
        if (a < 1e-4) { s.quaternion.copy(s.userData.rest); continue; }
        q.setFromAxisAngle(v.set(rz / a, 0, -rx / a), Math.min(1.45, a));
        s.quaternion.copy(q).multiply(s.userData.rest);
      }
    }
  }
}
