// First-person car built from real models (see CREDITS.md):
//   rally_car.glb  - whole car + interior + co-driver (its own driver and wheel are removed)
//   wheel.glb      - the steering wheel
//   arms.glb       - rigged first-person arms; posed every frame onto the rim with IK + finger curl
//   driver.glb     - rigged racing driver: used twice, as the driver's legs and as the whole co-driver
// Local +Z forward, +X left, +Y up, origin = CG.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { clone as skClone } from '../vendor/addons/utils/SkeletonUtils.js';
import { SPEC } from './car.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CAR_S = 0.00773, CAR_OFF = V(0.034, -0.428, -0.18);          // model units -> metres, wheels onto the physics wheels
const toCar = (x, y, z) => V(x, y, z).multiplyScalar(CAR_S).add(CAR_OFF);
export const EYE = toCar(46.2, 138, -4);                            // the model driver's eyes
const WHEEL_AT = toCar(45.96, 102.6, 46), RIM = 0.166, RT = 0.016; // steering wheel centre, rim radius, grip thickness
const AV_S = 1.08, HIP_Y = -0.085, HIP_Z = -0.2;                  // crew avatar scale and where their hips sit
const ARM_S = 0.0105, HB_R = 0.0175, HB_Y = 0.47, HB_REST = -0.2, HB_PULL = -0.2;   // handbrake grip radius / height on the lever, lean, extra lean when pulled

let assets = null;
export async function loadAssets(onProgress) {
  if (assets) return assets;
  const L = new GLTFLoader(), load = (u) => new Promise((res, rej) => L.load(u, res, undefined, rej));
  const names = ['rally_car', 'wheel', 'arms', 'driver'], out = {};
  for (let i = 0; i < names.length; i++) {
    if (onProgress) onProgress(i, names.length);
    const g = await load('./models/' + names[i] + '.glb'); out[names[i]] = g.scene;
    // older spec/gloss materials: the loader no longer reads them, so take their colour textures by hand
    const mats = g.parser.json.materials || [], todo = [];
    g.scene.traverse((m) => {
      if (!m.isMesh || m.material.map) return;
      const as = g.parser.associations.get(m.material), ext = as && mats[as.materials] && mats[as.materials].extensions && mats[as.materials].extensions.KHR_materials_pbrSpecularGlossiness;
      if (!ext) return;
      m.material.metalness = 0; m.material.roughness = 0.75;
      if (ext.diffuseFactor) m.material.color.setRGB(ext.diffuseFactor[0], ext.diffuseFactor[1], ext.diffuseFactor[2]);
      if (ext.diffuseTexture) todo.push(g.parser.getDependency('texture', ext.diffuseTexture.index).then((t) => { t.colorSpace = THREE.SRGBColorSpace; m.material.map = t; m.material.needsUpdate = true; }));
    });
    await Promise.all(todo);
  }
  return (assets = out);
}

export function buildCarModel() {
  const group = new THREE.Group();

  // ---------- the car ----------
  const carRoot = assets.rally_car; carRoot.scale.setScalar(CAR_S); carRoot.position.copy(CAR_OFF); group.add(carRoot);
  for (const n of ['driver', 'wheel', 'RFP', 'LFP']) { const o = carRoot.getObjectByName(n); if (o) o.visible = false; }
  const dash = (() => { const c = document.createElement('canvas'); c.width = 384; c.height = 192; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, g: c.getContext('2d'), t }; })();
  let glassMat = null;
  carRoot.traverse((m) => {
    if (!m.isMesh) return;
    const name = m.material.name;
    m.castShadow = name !== 'glass'; m.receiveShadow = name !== 'glass';
    if (name === 'glass') { glassMat = m.material; m.material.depthWrite = false; m.material.transparent = true; m.material.opacity = 0.16; m.material.roughness = 0.05; m.renderOrder = 5; }
    if (name === 'mirror') { m.material.metalness = 1; m.material.roughness = 0.05; }
    if (name === 'lcd_screen') {
      // our live dash drawn onto the car's own screen (its UVs use a sub-rectangle of the texture)
      const uv = m.geometry.attributes.uv; let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
      for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
      dash.t.repeat.set(1 / (u1 - u0), 1 / (v1 - v0)); dash.t.offset.set(-u0 / (u1 - u0), -v0 / (v1 - v0));
      m.material = new THREE.MeshBasicMaterial({ map: dash.t, toneMapped: false });
    }
  });

  // pedals: throttle (driver's right), brake, clutch. Each swings forward and down when pressed.
  group.updateMatrixWorld(true);
  const pedals = ['pedal', 'pedal001', 'pedal002'].map((n) => {
    const p = carRoot.getObjectByName(n); if (!p) return null;
    const o = p.parent.worldToLocal(V(0, 0, 0)), d = p.parent.worldToLocal(V(0, -0.018, 0.045)).sub(o);
    return { p, base: p.position.clone(), d, v: 0 };
  });
  // the pacenote book: a live page of the next calls, re-drawn as notes are passed
  const book = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 384; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return { c, g: c.getContext('2d'), t, key: '' }; })();
  carRoot.traverse((m) => {
    if (!m.isMesh || m.material.name !== 'notes') return;
    const uv = m.geometry.attributes.uv; let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
    book.t.repeat.set(1 / (u1 - u0), -1 / (v1 - v0)); book.t.offset.set(-u0 / (u1 - u0), v1 / (v1 - v0));   // the page UVs run bottom-to-top
    book.uv = [u0, u1, v0, v1];
    m.material = m.material.clone(); m.material.map = book.t; m.material.color.set(0xffffff);
  });
  const PER = 6;
  function drawBook(T, nextNote, flip) {
    // the book is two facing pages side by side in the texture: the next page on the left, the current one on the right
    const g = book.g, page = Math.floor(nextNote / PER);
    g.fillStyle = '#f2ecd9'; g.fillRect(0, 0, 256, 384);
    for (const [ox, pg] of [[0, page + 1], [128, page]]) {
      g.strokeStyle = '#9db4c8'; g.lineWidth = 1; for (let y = 62; y < 384; y += 53) { g.beginPath(); g.moveTo(ox + 5, y); g.lineTo(ox + 123, y); g.stroke(); }
      g.fillStyle = '#3a3a3a'; g.font = '700 13px Arial'; g.textAlign = 'left'; g.fillText('PAGE ' + (pg + 1), ox + 8, 22);
      for (let r = 0; r < PER; r++) {
        const j = pg * PER + r, n = T.notes[j]; if (!n) break;
        const y = 62 + r * 53, done = j < nextNote, cur = j === nextNote;
        if (cur) { g.fillStyle = '#ffe36a'; g.fillRect(ox + 3, y - 46, 122, 44); }
        g.fillStyle = done ? '#b3ad9c' : '#17233a'; g.strokeStyle = g.fillStyle; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
        // hand-drawn bend arrow: tighter corners curl further
        const sx = n.dir > 0 ? -1 : 1, bend = (7 - n.sev) / 6, x0 = ox + 24, y0 = y - 8;
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0, y0 - 26, x0 + sx * (5 + 14 * bend), y0 - 26 - 6 * (1 - bend) + 16 * bend * bend); g.stroke();
        g.font = '700 30px Arial'; g.textAlign = 'left'; g.fillText(n.sev === 1 ? 'H' : String(n.sev), ox + 46, y - 10);
        g.font = '700 15px Arial'; g.fillText((n.dir > 0 ? 'L' : 'R') + (n.long ? ' lg' : ''), ox + 70, y - 14);
        const nx = T.notes[j + 1];
        if (nx) { g.font = '600 12px Arial'; g.textAlign = 'right'; g.fillText(String(Math.max(10, Math.round((nx.i - n.end) * 2 / 10) * 10)), ox + 123, y - 30); }
        if (done) { g.lineWidth = 2; g.beginPath(); g.moveTo(ox + 14, y - 22); g.lineTo(ox + 100, y - 22); g.stroke(); }
      }
    }
    g.strokeStyle = '#8a8474'; g.lineWidth = 2; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 384); g.stroke();       // spine
    if (flip > 0) { g.fillStyle = `rgba(255,255,255,${flip * 0.85})`; g.fillRect(128 - 128 * flip, 0, 128 * flip + 128, 384); }   // the page being turned
    book.t.needsUpdate = true;
  }
  let bookPage = -1, bookNote = -1, flipT = 0;

  // ---------- steering wheel (own frame: x = driver's right, y up, z towards the driver) ----------
  const wheelG = new THREE.Group(); wheelG.position.copy(WHEEL_AT); group.add(wheelG);
  const axis = V(0, 0.16, -0.987).normalize(), upW = V(0, 0.987, 0.16).normalize();
  const qBase = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(-1, 0, 0), upW, axis));
  const wm = assets.wheel, wb = new THREE.Box3().setFromObject(wm), k = (RIM + RT) / ((wb.max.x - wb.min.x) / 2);
  const wHold = new THREE.Group(); wHold.add(wm); wm.scale.setScalar(k); wm.position.y = -wb.max.y * k + RT;   // rim plane at z = 0
  wHold.rotation.x = Math.PI / 2; wheelG.add(wHold);
  wm.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  // ---------- hydraulic handbrake: tall vertical lever beside the wheel, where the right hand lives ----------
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...extra });
  const alloy = std(0x9a9da2, { roughness: 0.3, metalness: 0.9 }), foam = std(0x101112, { roughness: 1 }), anod = std(0xb3261a, { roughness: 0.35, metalness: 0.6 });
  const hb = new THREE.Group(); hb.position.set(0.12, -0.06, 0.34); group.add(hb);
  const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; hb.add(m); return m; };
  part(new THREE.CylinderGeometry(0.0085, 0.0105, 0.56, 14), alloy, 0, 0.28, 0);
  part(new THREE.CylinderGeometry(HB_R, HB_R, 0.115, 20), foam, 0, HB_Y, 0);
  part(new THREE.SphereGeometry(0.02, 16, 12), anod, 0, HB_Y + 0.07, 0);
  part(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 16), anod, 0, HB_Y - 0.064, 0);
  const hbBase = new THREE.Group(); hbBase.position.copy(hb.position); group.add(hbBase);
  for (const [geo, mat, x, y, z, rx] of [[new THREE.BoxGeometry(0.05, 0.07, 0.1), std(0x202225, { roughness: 0.5, metalness: 0.7 }), 0, 0.01, 0, 0], [new THREE.CylinderGeometry(0.017, 0.017, 0.13, 14), alloy, 0, 0.03, 0.1, Math.PI / 2], [new THREE.CylinderGeometry(0.008, 0.008, 0.07, 10), anod, 0, 0.03, 0.02, Math.PI / 2]]) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; hbBase.add(m);
  }

  // ---------- arms ----------
  const armsRoot = assets.arms; armsRoot.scale.setScalar(ARM_S);
  armsRoot.position.set(EYE.x, 0.345, -0.045);                    // shoulders land just below and behind the eyes
  group.add(armsRoot);
  armsRoot.traverse((m) => { if (m.isMesh) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; } });
  group.updateMatrixWorld(true);                                  // group is still at the origin: "world" == car space here
  const bone = {}; armsRoot.traverse((b) => { if (b.isBone) bone[b.name.replace(/_\d+$/, '')] = b; });
  const wp = (b) => b.getWorldPosition(new THREE.Vector3()), wq = (b) => b.getWorldQuaternion(new THREE.Quaternion());
  const FING = { thumb: [8, 22, 26], point: [50, 66, 40], middle: [54, 70, 42], ring: [58, 72, 44], pink: [62, 74, 46] };
  const hands = ['R', 'L'].map((sd, hi) => {
    const s = hi === 0 ? 1 : -1;                                  // wheel-space side: the right hand sits at +x
    const arm = bone[sd + '_arm'], elbow = bone[sd + '_elbow'], wrist = bone[sd + '_wrist'];
    const pW = wp(wrist), fwd = wp(bone[sd + '_middle1']).sub(pW).normalize();
    const side0 = wp(bone[sd + '_point1']).sub(wp(bone[sd + '_pink1'])).normalize();
    const palm = (hi === 0 ? new THREE.Vector3().crossVectors(side0, fwd) : new THREE.Vector3().crossVectors(fwd, side0)).normalize();
    const side = (hi === 0 ? new THREE.Vector3().crossVectors(fwd, palm) : new THREE.Vector3().crossVectors(palm, fwd)).normalize();
    const curlAxis = new THREE.Vector3().crossVectors(fwd, palm).normalize();
    const palmPt = wp(bone[sd + '_middle1']).sub(pW).multiplyScalar(0.72).addScaledVector(palm, 0.016);   // offset from wrist to the gripping point
    const fingers = [];
    for (const f in FING) for (let j = 1; j <= 3; j++) {
      const b = bone[sd + '_' + f + j]; if (!b) continue;
      fingers.push({ b, f, j, bind: b.quaternion.clone(), wqB: wq(b), axis: curlAxis.clone().applyQuaternion(wq(b).invert()) });
    }
    return { s, off: 0, offCur: 0, arm, elbow, wrist, armBind: arm.quaternion.clone(), elbowBind: elbow.quaternion.clone(), wristBindW: wq(wrist),
      MbInv: new THREE.Matrix4().makeBasis(fwd, side, palm).transpose(), palmPt, fingers, fwd, side, palm,
      l1: wp(elbow).distanceTo(wp(arm)), l2: pW.distanceTo(wp(elbow)), pole: V(-s * 0.75, -0.66, 0).normalize() };
  });
  // Finger pose. Fingers flex about the knuckle line; each thumb joint takes degrees about the hand's own
  // [forward, knuckle-line, palm-normal] axes. Posed once; only wrists and arms move each frame.
  const D = Math.PI / 180, q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  function pose(hi, P) {
    const h = hands[hi];
    for (const f of h.fingers) {
      if (f.f !== 'thumb') { f.b.quaternion.copy(f.bind).multiply(q1.setFromAxisAngle(f.axis, P[f.f][f.j - 1] * D)); continue; }
      const t = P.thumb[f.j - 1];
      q1.setFromAxisAngle(h.fwd, t[0] * D).multiply(q2.setFromAxisAngle(h.side, t[1] * D)).multiply(q2.setFromAxisAngle(h.palm, t[2] * D));
      f.b.quaternion.copy(f.bind).multiply(q2.copy(f.wqB).invert()).multiply(q1).multiply(f.wqB);
    }
  }
  const POSE = [
    { thumb: [[50, 0, 0], [0, 0, 35], [0, 0, 35]], point: [46, 62, 38], middle: [50, 66, 40], ring: [54, 68, 42], pink: [58, 70, 44] },      // right hand
    { thumb: [[-50, 0, 0], [0, 0, -35], [0, 0, -35]], point: [46, 62, 38], middle: [50, 66, 40], ring: [54, 68, 42], pink: [58, 70, 44] },   // left hand
  ];
  pose(0, POSE[0]); pose(1, POSE[1]);

  // ---------- crew bodies (one rigged avatar, used twice) ----------
  const oldCo = carRoot.getObjectByName('co_driver'); if (oldCo) oldCo.visible = false;
  const X_AX = V(1, 0, 0), Z_AX = V(0, 0, 1);
  function seat(showOnly, x) {
    const root = skClone(assets.driver); root.scale.setScalar(AV_S); root.rotation.x = -0.24; group.add(root);
    const B = {};
    root.traverse((o) => {
      if (o.isBone) B[o.name.replace(/_\d+$/, '')] = o;
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; if (showOnly && !showOnly.includes(o.material.name)) o.visible = false; }
    });
    group.updateMatrixWorld(true);
    const hp = wp(B.Hips); root.position.set(x - hp.x, HIP_Y - hp.y, HIP_Z - hp.z); group.updateMatrixWorld(true);
    const bind = {}, wqB = {}; for (const k in B) { bind[k] = B[k].quaternion.clone(); wqB[k] = wq(B[k]); }
    const len = (a, b) => wp(B[a]).distanceTo(wp(B[b]));
    const limb = (a, b, c) => ({ A: B[a], Bn: B[b], C: B[c], bA: bind[a], bB: bind[b], l1: len(a, b), l2: len(b, c) });
    // rotate a bone about a car-space axis, on top of its bind pose
    const turn = (name, axis, ang) => { const o = B[name]; o.quaternion.copy(bind[name]).multiply(q2.copy(wqB[name]).invert()).multiply(q1.setFromAxisAngle(axis, ang)).multiply(wqB[name]); };
    return { root, B, turn, legL: limb('LeftUpLeg', 'LeftLeg', 'LeftFoot'), legR: limb('RightUpLeg', 'RightLeg', 'RightFoot'),
      armL: limb('LeftArm', 'LeftForeArm', 'LeftHand'), armR: limb('RightArm', 'RightForeArm', 'RightHand') };
  }
  const drv = seat(['Wolf3D_Outfit_Bottom', 'Wolf3D_Outfit_Footwear'], EYE.x);       // you only ever see your own legs
  const co = seat(null, toCar(-55.9, 0, 0).x);
  const pedalAt = pedals.map((pd) => (pd ? new THREE.Box3().setFromObject(pd.p).getCenter(new THREE.Vector3()) : V(0.3, -0.14, 0.82)));
  const restL = pedalAt[2].clone().add(V(0.11, -0.02, 0.0)), ANKLE = V(0, -0.1, -0.09);
  const coFeet = [V(co.root.position.x + 0.11, -0.16, 0.74), V(co.root.position.x - 0.11, -0.16, 0.74)];
  const bookAt = V(toCar(-56, 0, 0).x, 0.3, 0.165);

  // lights
  const glow = new THREE.PointLight(0xd8dcff, 0.5, 2.4, 2); glow.position.set(0.0, 0.62, -0.1); group.add(glow);
  const spot = new THREE.SpotLight(0xffe6bf, 160, 230, 0.72, 0.75, 1.35);
  spot.position.set(0, 0.25, 2.2); spot.target.position.set(0, -1.6, 40); group.add(spot, spot.target);

  const qz = new THREE.Quaternion(), qh = new THREE.Quaternion(), ZA = V(0, 0, 1), GRIP = 62 * Math.PI / 180, CLOCK = 24 * Math.PI / 180;   // hands at ten-to-two
  const Mt = new THREE.Matrix4(), Rw = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), gq = new THREE.Quaternion();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), W = new THREE.Vector3(), E = new THREE.Vector3(), d = new THREE.Vector3(), pp = new THREE.Vector3(), S0 = new THREE.Vector3(), cur = new THREE.Vector3();
  const T1 = new THREE.Vector3(), P1 = new THREE.Vector3();
  // two-bone IK in world space: A (hip / shoulder) -> Bn (knee / elbow) -> C (ankle / wrist) reaches `target`, bending towards `pole`
  function solve(L, target, pole) {
    L.A.quaternion.copy(L.bA); L.Bn.quaternion.copy(L.bB); L.A.updateMatrixWorld(true);
    L.A.getWorldPosition(S0); d.copy(target).sub(S0); const dist = Math.min(L.l1 + L.l2 - 0.002, d.length()); d.normalize();
    const al = (L.l1 * L.l1 - L.l2 * L.l2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, L.l1 * L.l1 - al * al));
    pp.copy(pole).applyQuaternion(gq); pp.addScaledVector(d, -pp.dot(d)).normalize();
    E.copy(S0).addScaledVector(d, al).addScaledVector(pp, hh);
    aim(L.A, L.Bn, E); aim(L.Bn, L.C, target);
  }
  const carPt = (v) => group.localToWorld(T1.copy(v));
  let footSide = 0, glance = 0, glanceT = 3, tAnim = 0, sway = 0;
  const lastV = new THREE.Vector3();
  // turn `bn` so that its child joint lies towards the world point `to`
  function aim(bn, child, to) {
    bn.getWorldPosition(a); child.getWorldPosition(cur).sub(a).normalize(); d.copy(to).sub(a).normalize();
    qa.setFromUnitVectors(cur, d); bn.getWorldQuaternion(qb).premultiply(qa);
    bn.quaternion.copy(bn.parent.getWorldQuaternion(qa).invert().multiply(qb)); bn.updateMatrixWorld(true);
  }
  let uiT = 0, pull = 0, grab = 0, lastGear = 1, clutchT = 0;
  const Rw2 = new THREE.Quaternion(), W2 = new THREE.Vector3();
  function update(car, info, dt) {
    const rot = Math.max(-2.9, Math.min(2.9, car.steer / SPEC.maxSteer * 2.9));   // about half a turn of wheel each way, like the real cars
    wheelG.quaternion.copy(qBase).multiply(qz.setFromAxisAngle(ZA, rot));
    group.updateMatrixWorld(true); group.getWorldQuaternion(gq);
    pull += ((car.hand > 0.5 && grab > 0.6 ? 1 : 0) - pull) * Math.min(1, dt * 14);
    hb.rotation.x = HB_REST + HB_PULL * pull;
    grab += ((car.hand > 0.5 ? 1 : 0) - grab) * Math.min(1, dt * 13);
    for (const h of hands) {
      const s = h.s, cs = Math.cos(GRIP), sn = Math.sin(GRIP);
      // Both hands live high on the rim and are carried round with it, crossing over the top in tight corners.
      // When a wrist runs out of travel the hand lets go and takes a fresh grip further round (hand over hand).
      const dev = s * (h.off + rot);
      if (dev > 2.3) h.off -= s * 2.0; else if (dev < -1.4) h.off += s * 2.0;
      h.offCur += (h.off - h.offCur) * Math.min(1, dt * 16);
      const lift = Math.min(1, Math.abs(h.off - h.offCur)) * 0.05;
      qh.copy(wheelG.quaternion).multiply(qz.setFromAxisAngle(ZA, s * CLOCK + h.offCur));
      a.set(s * sn, 0, -cs).applyQuaternion(qh); b.set(0, 1, 0).applyQuaternion(qh); c.set(-s * cs, 0, -sn).applyQuaternion(qh);
      W.set(s * (RIM + cs * (RT + 0.004)), 0, sn * (RT + 0.004) + lift).applyQuaternion(qh).add(wheelG.position);
      Rw.setFromRotationMatrix(Mt.makeBasis(a, b, c).multiply(h.MbInv));                       // bind hand -> gripping hand
      if (s > 0 && grab > 0.002) {
        // the right hand snaps across to the handbrake while it is pulled, then straight back to the wheel
        qh.copy(hb.quaternion);
        c.set(0.72, 0, 0.69).normalize(); b.set(0, 1, 0); a.crossVectors(c, b);
        W2.copy(c).multiplyScalar(-(HB_R + 0.004)); W2.y = HB_Y; W2.applyQuaternion(qh).add(hb.position);
        a.applyQuaternion(qh); b.applyQuaternion(qh); c.applyQuaternion(qh);
        Rw2.setFromRotationMatrix(Mt.makeBasis(a, b, c).multiply(h.MbInv));
        const g = grab * grab * (3 - 2 * grab);
        Rw.slerp(Rw2, g); W.lerp(W2, g); W.y += Math.sin(g * Math.PI) * 0.03;
      }
      W.sub(pp.copy(h.palmPt).applyQuaternion(Rw));                                            // wrist position, car space
      group.localToWorld(W);
      // two-bone IK: shoulder -> elbow -> wrist
      h.arm.quaternion.copy(h.armBind); h.elbow.quaternion.copy(h.elbowBind); h.arm.updateMatrixWorld(true);
      h.arm.getWorldPosition(S0); d.copy(W).sub(S0); const dist = Math.min(h.l1 + h.l2 - 0.002, d.length()); d.normalize();
      const al = (h.l1 * h.l1 - h.l2 * h.l2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, h.l1 * h.l1 - al * al));
      pp.copy(h.pole).applyQuaternion(gq); pp.addScaledVector(d, -pp.dot(d)).normalize();
      E.copy(S0).addScaledVector(d, al).addScaledVector(pp, hh);
      aim(h.arm, h.elbow, E); aim(h.elbow, h.wrist, W);
      qb.copy(gq).multiply(Rw).multiply(h.wristBindW);                                          // wrist orientation, world
      h.wrist.quaternion.copy(h.wrist.parent.getWorldQuaternion(qa).invert().multiply(qb));
    }
    // feet: throttle and brake follow the inputs; the clutch is dipped for an instant on each gear change
    if (car.gear !== lastGear) { lastGear = car.gear; clutchT = 0.16; }
    clutchT = Math.max(0, clutchT - dt);
    const want = [car.throttle, car.brake, clutchT > 0 ? 1 : 0];
    pedals.forEach((pd, i) => { if (!pd) return; pd.v += (want[i] - pd.v) * Math.min(1, dt * 22); pd.p.position.copy(pd.base).addScaledVector(pd.d, pd.v); });
    // --- your legs: right foot rolls between throttle and brake, left foot rests and stabs the clutch ---
    tAnim += dt;
    footSide += ((car.brake > 0.05 ? 1 : 0) - footSide) * Math.min(1, dt * 16);
    P1.copy(pedalAt[0]).lerp(pedalAt[1], footSide).add(ANKLE); P1.z += 0.045 * (footSide > 0.5 ? pedals[1].v : pedals[0].v); P1.y += Math.sin(footSide * Math.PI) * 0.03;
    solve(drv.legR, carPt(P1), V(-0.25, 1, 0.1));
    P1.copy(restL).lerp(pedalAt[2], pedals[2] ? pedals[2].v : 0).add(ANKLE); P1.z += 0.045 * (pedals[2] ? pedals[2].v : 0);
    solve(drv.legL, carPt(P1), V(0.25, 1, 0.1));
    // --- co-driver: braced feet, both hands on the book, head down reading with glances up the road ---
    solve(co.legL, carPt(coFeet[0]), V(0.2, 1, 0.1)); solve(co.legR, carPt(coFeet[1]), V(-0.2, 1, 0.1));
    const fl = flipT / 0.45, reach = Math.sin(fl * Math.PI);                       // page turn: the inside hand sweeps the page across
    P1.copy(bookAt); P1.x += 0.125 - reach * 0.17; P1.y += reach * 0.07; P1.z -= 0.02 + reach * 0.05; solve(co.armL, carPt(P1), V(0.6, -0.8, 0));
    P1.copy(bookAt); P1.x -= 0.125; P1.z -= 0.02; solve(co.armR, carPt(P1), V(-0.6, -0.8, 0));
    glanceT -= dt; if (glanceT < 0) { glanceT = 4 + Math.random() * 5; glance = 0.8; }
    glance = Math.max(0, glance - dt);
    const up = glance > 0 || car.speed < 1.5 ? 1 : 0; co.look = (co.look || 0) + (up - (co.look || 0)) * Math.min(1, dt * 7);
    const lat = (car.vel.x - lastV.x) * 0 + car.angVel.y * car.speed * 0.012; lastV.copy(car.vel);
    sway += (Math.max(-0.12, Math.min(0.12, lat)) - sway) * Math.min(1, dt * 4);
    co.turn('Neck', X_AX, 0.22 - co.look * 0.16); co.turn('Head', X_AX, 0.42 - co.look * 0.4 + Math.sin(tAnim * 9) * 0.012 * Math.min(1, car.speed / 20));
    co.turn('Spine1', Z_AX, sway); co.turn('Spine2', X_AX, 0.12);
    // notes book
    const pg = Math.floor(info.nextNote / PER);
    if (pg !== bookPage) { bookPage = pg; flipT = 0.45; }
    if (flipT > 0 || info.nextNote !== bookNote) { flipT = Math.max(0, flipT - dt); bookNote = info.nextNote; drawBook(info.T, info.nextNote, flipT / 0.45); }
    uiT -= dt; if (uiT > 0) return; uiT = 0.07;
    const rf = Math.min(1, car.rpm / SPEC.redline), g = dash.g;
    g.fillStyle = '#04060a'; g.fillRect(0, 0, 384, 192);
    for (let i = 0; i < 30; i++) { g.fillStyle = i / 30 < rf ? (i > 25 ? '#ff3b24' : i > 20 ? '#ffc020' : '#e9eef5') : '#161b22'; g.fillRect(10 + i * 12.2, 10, 9, 20); }
    g.fillStyle = '#48e070'; g.font = '700 128px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(car.gear === -1 ? 'R' : String(car.gear), 192, 158);
    g.fillStyle = '#e9eef5'; g.font = '700 56px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'left'; g.fillText(String(Math.round(car.speed * 3.6)), 14, 104);
    g.font = '500 20px "Barlow Condensed", Arial, sans-serif'; g.fillStyle = '#8b96a5'; g.fillText('KM/H', 14, 130);
    g.textAlign = 'right'; g.fillStyle = '#e9eef5'; g.font = '700 40px "Barlow Condensed", Arial, sans-serif'; g.fillText(String(Math.round(car.rpm / 10) * 10), 372, 96);
    g.font = '500 20px "Barlow Condensed", Arial, sans-serif'; g.fillStyle = '#8b96a5'; g.fillText('RPM', 372, 122);
    g.fillStyle = '#5ab0ff'; g.fillText(info.time, 372, 168);
    dash.t.needsUpdate = true;
  }
  function setLight(cnd) { spot.intensity = cnd.head; glow.intensity = cnd.cabin; }
  return { group, update, spot, setLight, glassMat, pose, POSE, book, dispose() {} };
}
