// Base camp: where you (the person holding the controller) left your things.
// A backpack with spare battery packs, a tall flag so you can find it, and a tarp to push litter onto.
import * as THREE from 'three';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8 }, o));
const bx = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };
// every solid thing standing at a camp, for the collision system (litter.js fits a shape to each)
export const SOLIDS = [];
export const MAT_HALF = 1.25;                    // the tarp is 2.5 m square

export class Base {
  constructor(scene, x, z, ah) {
    this.x = x; this.z = z; this.tx = x + 3.2; this.tz = z;          // tarp sits beside the pack
    this.swap = 0; this.cleaned = 0; this.pieces = 0; this.timer = 0; this.justSwapped = false;
    const g = new THREE.Group(), y = ah(x, z);
    g.add(bx(0.32, 0.48, 0.20, mat(0x2f5f3a), 0, 0.24, 0), bx(0.26, 0.18, 0.06, mat(0x274d30), 0, 0.16, 0.13), bx(0.34, 0.06, 0.22, mat(0x1f3d26), 0, 0.50, 0));   // backpack
    g.add(bx(0.14, 0.025, 0.046, mat(0x2a63c9), 0.32, 0.013, 0.05), bx(0.14, 0.025, 0.046, mat(0x2a63c9), 0.34, 0.038, 0.06), bx(0.16, 0.05, 0.10, mat(0x222226), 0.33, 0.025, -0.12));   // spare packs and charger
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.4, 6), mat(0xd8d8d8)); pole.position.set(-0.3, 1.2, 0); g.add(pole);
    this.flag = bx(0.45, 0.28, 0.004, mat(0xff6a1a, { side: THREE.DoubleSide }), -0.07, 2.22, 0); g.add(this.flag);
    // the skip: a yellow builder's skip, the thing you throw your load into
    const sk = new THREE.Group(), yel = mat(0xf2b316, { roughness: 0.55, side: THREE.DoubleSide }), dark = mat(0x2a2620, { roughness: 0.9, side: THREE.DoubleSide });
    const bw = 0.42, bl = 0.26, tw = 0.66, tl = 0.38, h = 0.46;              // half sizes: bottom, top, and height
    const P = [[-bw, 0, -bl], [bw, 0, -bl], [bw, 0, bl], [-bw, 0, bl], [-tw, h, -tl], [tw, h, -tl], [tw, h, tl], [-tw, h, tl]];
    const quad = (a, b, c, d, m, uv) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([...P[a], ...P[b], ...P[c], ...P[a], ...P[c], ...P[d]], 3)); if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2)); geo.computeVertexNormals(); sk.add(new THREE.Mesh(geo, m)); };
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const c2 = cv.getContext('2d');
    c2.fillStyle = '#f2b316'; c2.fillRect(0, 0, 512, 256); c2.fillStyle = '#1d1a14'; for (let i = -1; i < 12; i++) { c2.beginPath(); c2.moveTo(i * 56, 256); c2.lineTo(i * 56 + 28, 256); c2.lineTo(i * 56 + 68, 214); c2.lineTo(i * 56 + 40, 214); c2.fill(); }
    c2.font = 'bold 92px Arial Narrow, Arial'; c2.textAlign = 'center'; c2.fillText('LITTER', 256, 150); c2.fillRect(40, 176, 432, 8);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = mat(0xffffff, { map: tex, roughness: 0.55, side: THREE.DoubleSide });
    quad(3, 2, 6, 7, sign, true); quad(1, 0, 4, 5, sign, true); quad(0, 3, 7, 4, yel); quad(2, 1, 5, 6, yel); quad(0, 1, 2, 3, dark);
    sk.add(bx(tw * 2 + 0.04, 0.03, 0.03, dark, 0, h, -tl), bx(tw * 2 + 0.04, 0.03, 0.03, dark, 0, h, tl), bx(0.03, 0.03, tl * 2 + 0.04, dark, -tw, h, 0), bx(0.03, 0.03, tl * 2 + 0.04, dark, tw, h, 0));   // rim
    for (const sx of [-1, 1]) for (const zz of [-0.12, 0.12]) { const lug = bx(0.05, 0.10, 0.03, dark, sx * (bw + (tw - bw) * 0.78), h * 0.78, zz); sk.add(lug); }                                            // lifting lugs
    sk.add(bx(tw * 1.9, 0.012, tl * 1.9, mat(0x6b5a3a, { roughness: 1 }), 0, h * 0.95, 0));                                                                                                                  // it is full to the brim with rubbish (so it is solid all the way up, as it looks)
    // stand it on the sand where it actually is (the camp sits on a slope): lowest corner sets the height, and it tilts with the ground
    const kx = x - 1.25, kz = z + 0.35, e2 = 0.5;
    const kn = new THREE.Vector3(ah(kx - e2, kz) - ah(kx + e2, kz), 2 * e2, ah(kx, kz - e2) - ah(kx, kz + e2)).normalize();
    sk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), kn).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35));
    sk.position.set(-1.25, ah(kx, kz) - y - 0.03, 0.35); g.add(sk); this.bin = sk;
    g.position.set(x, y, z); scene.add(g);
    // solid: the backpack, the spare packs and charger, the flag pole, the skip (the flag is cloth, and is not)
    this.flag.userData.noHit = true;
    const kids = g.children.filter(o => o !== sk && o !== pole && o !== this.flag);
    SOLIDS.push(kids.slice(0, 3), kids.slice(3), [pole], [sk]);
    // the tarp, laid along the slope
    const e = 1, n = new THREE.Vector3(ah(this.tx - e, this.tz) - ah(this.tx + e, this.tz), 2 * e, ah(this.tx, this.tz - e) - ah(this.tx, this.tz + e)).normalize();
    const tarp = new THREE.Mesh(new THREE.PlaneGeometry(MAT_HALF * 2, MAT_HALF * 2), mat(0x2b6fb0, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    tarp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); tarp.position.set(this.tx, ah(this.tx, this.tz) + 0.012, this.tz); scene.add(tarp);
  }

  // every frame
  update(dt, car, litter, t) {
    this.flag.rotation.y = Math.sin(t * 3) * 0.25;
    // park beside the pack for two seconds and you swap in a full battery
    const d = Math.hypot(car.pos.x - this.x, car.pos.z - this.z);
    this.justSwapped = false;
    if (d < 1.6 && car.vel.length() < 1.0 && car.battery < car.capacity * 0.98) { this.swap += dt; if (this.swap > 2) { car.battery = car.capacity; this.swap = 0; this.justSwapped = true; } } else this.swap = 0;
    this.dist = d; this.bearing = Math.atan2(this.x - car.pos.x, -(this.z - car.pos.z));
    // count what is lying on the tarp, once a second
    if ((this.timer -= dt) < 0) {
      this.timer = 1; let pts = 0, n = 0;
      for (const o of litter.items) if (o.T.pts && Math.abs(o.pos.x - this.tx) < MAT_HALF && Math.abs(o.pos.z - this.tz) < MAT_HALF) { pts += o.T.pts; n++; }
      this.cleaned = pts; this.pieces = n;
    }
  }
}
