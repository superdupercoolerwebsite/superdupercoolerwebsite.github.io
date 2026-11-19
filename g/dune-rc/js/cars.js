// What the three cars look like. The buggy is a real 3D model; the sand rail and desert truck are simple
// stand-in shapes built here until proper models are dropped in.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { SCALE, COM_Y, COM_Z } from './vehicle.js';

const M = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, o));
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };
function tube(a, b, r, m) {                                     // a thin pipe between two points
  const d = new THREE.Vector3().subVectors(b, a), t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), m);
  t.position.copy(a).addScaledVector(d, 0.5); t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return t;
}
function wheel(r, half, paddles) {
  const g = new THREE.Group(), rubber = M(0x18181a, { roughness: 0.9 });
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, half * 2, 20), rubber); tyre.rotation.z = Math.PI / 2; g.add(tyre);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, half * 2.04, 12), M(0xd0d0d0, { roughness: 0.4 })); rim.rotation.z = Math.PI / 2; g.add(rim);
  for (let i = 0; i < (paddles ? 10 : 14); i++) {              // tread bars / sand paddles, so you can see it turning
    const a = i / (paddles ? 10 : 14) * Math.PI * 2, b = box(half * 1.9, paddles ? r * 0.16 : r * 0.07, r * 0.10, rubber, 0, Math.cos(a) * r, Math.sin(a) * r);
    b.rotation.x = a; g.add(b);
  }
  return g;
}

const ARM = M(0x2a2a2e, { roughness: 0.5 }), SPRING = M(0xe2b01c, { roughness: 0.5 });
export const LAMP = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 0 });
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), a_ = new THREE.Vector3(), b_ = new THREE.Vector3(), d_ = new THREE.Vector3();
function span(mesh, a, b, axis, comp) { d_.subVectors(b, a); const l = d_.length(); mesh.position.copy(a).addScaledVector(d_, 0.5); mesh.scale[comp] = l; mesh.quaternion.setFromUnitVectors(axis, d_.multiplyScalar(1 / l)); }
// each frame: the arms swing and the springs squash with the real suspension travel
export function updateSuspension(model, car) {
  const S = car.spec;
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i], s = model.susp[i], sg = Math.sign(w.x), hy = w.ay - (w.vlen === undefined ? w.len : w.vlen);
    a_.set(sg * 0.03, S.belly + 0.014, w.z); b_.set(w.x - sg * (w.half + 0.004), hy, w.z); span(s.arm, a_, b_, X, 'x');
    a_.set(sg * 0.03, S.belly + 0.014, w.z + (w.front ? 0.05 : -0.05)); span(s.arm2, a_, b_, X, 'x');
    // top of the shock stays inside the bodywork
    a_.set(sg * 0.045, Math.min(w.ay + 0.03, S.top * 0.55), w.z); b_.set(w.x * 0.72, hy + 0.004, w.z); span(s.shock, a_, b_, Y, 'y');
  }
}

// "Toyota Baja Trophy Truck 3D Model" by Superfamicom (Sketchfab, CC-BY-4.0), shrunk to RC size.
// The model comes as one piece, so the four wheels are cut out of it here to let them spin, steer and ride the suspension.
// Its white light beams and the white patches under it are removed.
function loadTruck(grp, wheels) {
  const k = 0.00105, CY = 17, CZ = 23;                         // model units -> metres, and where the weight sits in the model
  // each wheel in the model: centre x, y, z, radius, and how far in/out it reaches
  // (the model's bonnet is at its +z end and its left is +x, so it is turned half a turn to face the way the car drives)
  const W = [[104, -4.5, 185, 51, 69, 130], [-104, -4.5, 185, 51, 69, 130], [99, -6.5, -139, 49, 79, 121], [-99, -6.5, -139, 49, 79, 121]];
  new GLTFLoader().load('./assets/truck/scene.gltf', gltf => {
    const root = gltf.scene; root.updateMatrixWorld(true);
    const kill = []; let wm = null;
    root.traverse(o => {
      if (!o.isMesh) return;
      const n = o.material.name;
      if (n === 'object_2' || n === 'object_5') kill.push(o);                 // ground patches and the white beams
      else { o.material.metalness = Math.min(o.material.metalness, 0.15); o.material.metalnessMap = null; if (n === 'object_3') wm = o; }
    });
    kill.forEach(o => o.parent.remove(o));
    if (wm) {
      const geo = wm.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, idx = geo.index ? geo.index.array : null, n = idx ? idx.length : pos.count;
      const wp = new Float32Array(pos.count * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(wm.matrixWorld);
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(wm.matrixWorld); wp[i * 3] = v.x; wp[i * 3 + 1] = v.y; wp[i * 3 + 2] = v.z; }
      const which = i => { const x = wp[i * 3], y = wp[i * 3 + 1], z = wp[i * 3 + 2], ax = Math.abs(x);
        for (let q = 0; q < 4; q++) if (Math.sign(x) === Math.sign(W[q][0]) && ax >= W[q][4] && ax <= W[q][5] && Math.hypot(y - W[q][1], z - W[q][2]) <= W[q][3] + 2) return q; return -1; };
      const keep = [], parts = [[], [], [], []];
      for (let t = 0; t < n; t += 3) {
        const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2, q = which(a);
        if (q >= 0 && q === which(b) && q === which(c)) parts[q].push(a, b, c); else keep.push(a, b, c);
      }
      geo.setIndex(keep);
      parts.forEach((tri, q) => {
        // true axle centre = middle of the tyre tread (the outermost ring of points), so the wheel turns true instead of wobbling
        for (let pass = 0; pass < 3; pass++) {
          let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, x0 = 1e9, x1 = -1e9, rmax = 0;
          for (const vi of tri) rmax = Math.max(rmax, Math.hypot(wp[vi * 3 + 1] - W[q][1], wp[vi * 3 + 2] - W[q][2]));
          for (const vi of tri) { const y = wp[vi * 3 + 1], z = wp[vi * 3 + 2]; if (Math.hypot(y - W[q][1], z - W[q][2]) < rmax * 0.86) continue; y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); x0 = Math.min(x0, wp[vi * 3]); x1 = Math.max(x1, wp[vi * 3]); }
          if (y1 > y0) { W[q][1] = (y0 + y1) / 2; W[q][2] = (z0 + z1) / 2; W[q][0] = (x0 + x1) / 2; }
        }
        const P = new Float32Array(tri.length * 3), N = new Float32Array(tri.length * 3), T = new Float32Array(tri.length * 2);
        tri.forEach((vi, j) => {
          P[j * 3] = -(wp[vi * 3] - W[q][0]) * k; P[j * 3 + 1] = (wp[vi * 3 + 1] - W[q][1]) * k; P[j * 3 + 2] = -(wp[vi * 3 + 2] - W[q][2]) * k;
          if (nor) { v.fromBufferAttribute(nor, vi).applyMatrix3(nm).normalize(); N[j * 3] = -v.x; N[j * 3 + 1] = v.y; N[j * 3 + 2] = -v.z; }
          if (uv) { T[j * 2] = uv.getX(vi); T[j * 2 + 1] = uv.getY(vi); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(T, 2));
        wheels[q].spin.add(new THREE.Mesh(g, wm.material));
      });
    }
    root.rotation.y = Math.PI; root.scale.setScalar(k); root.position.set(0, -CY * k, CZ * k);
    grp.add(root);
  });
}

export function buildCar(spec) {
  const grp = new THREE.Group(), wheels = [], susp = [];
  for (let i = 0; i < 4; i++) {
    const s = { arm: new THREE.Mesh(new THREE.BoxGeometry(1, 0.006, 0.012), ARM), arm2: new THREE.Mesh(new THREE.BoxGeometry(1, 0.006, 0.012), ARM), shock: new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 1, 8), SPRING) };
    grp.add(s.arm, s.arm2, s.shock); susp.push(s);
  }
  for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), LAMP); l.position.set(sx * spec.halfW * 0.62, 0.022, spec.nose + 0.004); grp.add(l); }
  for (let i = 0; i < 4; i++) { const pivot = new THREE.Group(), spin = new THREE.Group(); pivot.add(spin); grp.add(pivot); wheels.push({ pivot, spin }); }
  const S = spec, V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (S.id === 'buggy') {
    // "HCR2 Buggy" by oakar258 (Sketchfab, CC-BY-4.0), shrunk to RC size
    new GLTFLoader().load('./assets/hcr2_buggy/scene.gltf', gltf => {
      const root = gltf.scene; root.updateMatrixWorld(true);
      root.traverse(o => { if (/Susp|Springs/.test(o.name)) o.visible = false; });      // the model's fixed suspension is replaced by arms that move
      root.traverse(o => { if (o.isMesh) { const m = o.material; m.metalness = Math.min(m.metalness, 0.15); m.metalnessMap = null; m.side = THREE.FrontSide; m.needsUpdate = true; } });
      ['FL_Wheel', 'FR_Wheel', 'RL_Wheel', 'RR_Wheel'].forEach((name, i) => {
        let node = null; root.traverse(o => { if (o.name.includes(name)) node = node || o; });
        if (!node) return;
        node.position.set(0, 0, 0); node.rotation.set(0, Math.PI, 0); node.scale.setScalar(SCALE);
        wheels[i].spin.add(node);
      });
      root.rotation.y = Math.PI; root.scale.setScalar(SCALE);
      root.position.set(0, -COM_Y * SCALE, COM_Z * SCALE);
      grp.add(root);
    });
    return { grp, wheels, susp };
  }
  if (S.id === 'truck') { loadTruck(grp, wheels); return { grp, wheels, susp }; }
  if (S.id === 'toy') {                                  // bright moulded plastic, a sticker, a little aerial
    const pl = M(0xe23b2e, { roughness: 0.35 }), blk = M(0x1a1a1c, { roughness: 0.6 }), y0 = S.belly;
    grp.add(box(0.10, 0.03, 0.26, pl, 0, y0 + 0.02, 0), box(0.085, 0.03, 0.11, pl, 0, y0 + 0.048, 0.01), box(0.07, 0.022, 0.07, blk, 0, y0 + 0.052, -0.005));
    grp.add(box(0.11, 0.012, 0.02, blk, 0, y0 + 0.012, S.nose + 0.008), box(0.10, 0.004, 0.035, pl, 0, y0 + 0.075, 0.115), box(0.004, 0.02, 0.01, blk, -0.035, y0 + 0.064, 0.115), box(0.004, 0.02, 0.01, blk, 0.035, y0 + 0.064, 0.115));
    grp.add(tube(new THREE.Vector3(0.03, y0 + 0.06, 0.05), new THREE.Vector3(0.03, y0 + 0.19, 0.07), 0.0012, blk));
  }
  S.wheels.forEach((w, i) => wheels[i].spin.add(wheel(w.r, w.half, !w.front)));
  if (S.id === 'rail') {
    const red = M(0xc8202a, { roughness: 0.4 }), dark = M(0x222226), y0 = S.belly + 0.008, y1 = S.top, hw = S.halfW;
    for (const sx of [-1, 1]) {
      grp.add(tube(V(sx * hw, y0, S.nose * 0.75), V(sx * hw, y0, S.tail * 0.9), 0.006, red));           // floor rails
      grp.add(tube(V(sx * hw, y0, S.nose * 0.75), V(0, y0 + 0.01, S.nose), 0.006, red));                 // pointed nose
      grp.add(tube(V(sx * hw, y0, -0.02), V(sx * hw * 0.8, y1, 0.0), 0.006, red));                       // front hoop legs
      grp.add(tube(V(sx * hw, y0, 0.11), V(sx * hw * 0.8, y1, 0.07), 0.006, red));                       // rear hoop legs
      grp.add(tube(V(sx * hw * 0.8, y1, 0.0), V(sx * hw * 0.8, y1, 0.07), 0.006, red));
      grp.add(tube(V(sx * hw * 0.8, y1, 0.0), V(sx * hw * 0.5, y0 + 0.03, S.nose * 0.7), 0.005, red));   // down bars to the nose
      grp.add(tube(V(sx * hw * 0.8, y1, 0.07), V(sx * hw, y0 + 0.02, S.tail * 0.9), 0.005, red));
    }
    grp.add(tube(V(-hw * 0.8, y1, 0.0), V(hw * 0.8, y1, 0.0), 0.006, red), tube(V(-hw * 0.8, y1, 0.07), V(hw * 0.8, y1, 0.07), 0.006, red));
    grp.add(box(hw * 1.7, 0.004, 0.36, dark, 0, y0, -0.02));                                             // floor pan
    grp.add(box(0.07, 0.07, 0.05, dark, 0, y0 + 0.05, 0.03));                                            // seat
    grp.add(box(0.09, 0.06, 0.08, M(0x8a8f96, { roughness: 0.35 }), 0, y0 + 0.04, 0.14));                // motor
    grp.add(box(0.20, 0.004, 0.05, red, 0, y1 + 0.02, 0.19), box(0.006, 0.05, 0.03, dark, -0.07, y1 - 0.005, 0.19), box(0.006, 0.05, 0.03, dark, 0.07, y1 - 0.005, 0.19));  // wing
  }
  return { grp, wheels, susp };
}
