// Litter in the desert: real-size rubbish the RC car can hit, push, roll, climb and get stuck on.
// Each piece is its own rigid body with real weight. Plastic bags are real cloth (cloth.js). Fishing nets tangle wheels.
// Also here: the eight lost things to find, and spare battery packs.
import * as THREE from 'three';
import { Cloth } from './cloth.js';
import { fitBalls } from './shape.js';
import { SOLIDS } from './base.js';

const G = 9.81;
const CELLSZ = 40, LOAD_R = 3;                 // world is cut into 40 m squares; squares within 3 of the car are loaded
const ACTIVE_R = 30;                           // pieces this close to the car are simulated; the rest just lie there

function hash(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- what each kind is: weight m (kg), bounce e, friction mu, air drag, how the wind catches it (wind),
//      the balls that make up its shape [x, y, z, radius], how often it turns up (weight), clean-up points (pts),
//      and its longest real dimension in metres (size, used to scale a dropped-in 3D model) ----
const row = (n, a, b, r, ax = 'y') => Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0 : a + (b - a) * i / (n - 1); return ax === 'y' ? [0, t, 0, r] : [t, 0, 0, r]; });
const ring = (n, R, r) => Array.from({ length: n }, (_, i) => [Math.cos(i * 6.2832 / n) * R, 0, Math.sin(i * 6.2832 / n) * R, r]);
const corners = (x, y, z, r) => [-1, 1].flatMap(a => [-1, 1].flatMap(b => [-1, 1].map(c => [a * x, b * y, c * z, r])));
export const TYPES = {
  can: { m: 0.015, e: 0.3, mu: 0.45, drag: 0.5, wind: 0.16, lie: 'side', lift: 0.033, balls: row(3, -0.042, 0.042, 0.033), weight: 20, pts: 10, size: 0.12, label: 'drink can' },
  pbottle: { m: 0.025, e: 0.35, mu: 0.4, drag: 0.6, wind: 0.17, lie: 'side', lift: 0.034, balls: [...row(3, -0.075, 0.045, 0.034), [0, 0.095, 0, 0.016]], weight: 18, pts: 10, size: 0.22, label: 'plastic bottle' },
  gbottle: { m: 0.45, e: 0.1, mu: 0.5, drag: 0.02, wind: 0, lie: 'side', lift: 0.037, balls: [...row(3, -0.10, 0.02, 0.037), [0, 0.12, 0, 0.017]], weight: 9, pts: 20, size: 0.29, label: 'glass bottle' },
  cup: { m: 0.008, e: 0.2, mu: 0.5, drag: 1.2, wind: 0.30, lie: 'side', lift: 0.04, balls: [[0, -0.03, 0, 0.033], [0, 0.03, 0, 0.042]], weight: 9, pts: 5, size: 0.11, label: 'paper cup' },
  box: { m: 0.18, e: 0.1, mu: 0.6, drag: 0.5, wind: 0.10, lie: 'up', lift: 0.10, balls: corners(0.12, 0.07, 0.08, 0.03), weight: 7, pts: 15, size: 0.30, label: 'cardboard box' },
  brick: { m: 2.3, e: 0.05, mu: 0.7, drag: 0, wind: 0, lie: 'up', lift: 0.0325, balls: [[-0.075, 0, -0.02, 0.0325], [0.075, 0, -0.02, 0.0325], [-0.075, 0, 0.02, 0.0325], [0.075, 0, 0.02, 0.0325]], weight: 3, pts: 60, size: 0.215, label: 'brick' },
  tyre: { m: 9, e: 0.3, mu: 0.8, drag: 0, wind: 0, lie: 'up', lift: 0.10, balls: ring(10, 0.225, 0.10), weight: 3, pts: 200, size: 0.65, label: 'car tyre' },
  plank: { m: 3, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.02, balls: [-1, 1].flatMap(z => row(6, -0.56, 0.56, 0.02, 'x').map(b => [b[0], 0, z * 0.055, b[3]])), weight: 3, pts: 80, size: 1.2, label: 'plank' },
  flipflop: { m: 0.04, e: 0.3, mu: 0.6, drag: 0.4, wind: 0.10, lie: 'up', lift: 0.015, balls: row(3, -0.10, 0.10, 0.015, 'x'), weight: 4, pts: 10, size: 0.27, label: 'flip-flop' },
  sunglasses: { m: 0.03, e: 0.2, mu: 0.5, drag: 0.3, wind: 0.05, lie: 'up', lift: 0.018, balls: [[-0.045, 0, 0, 0.018], [0.045, 0, 0, 0.018]], weight: 2, pts: 10, size: 0.14, label: 'sunglasses' },
  phone: { m: 0.18, e: 0.1, mu: 0.5, drag: 0, wind: 0, lie: 'up', lift: 0.008, balls: [[-0.06, 0, -0.025, 0.008], [0.06, 0, -0.025, 0.008], [-0.06, 0, 0.025, 0.008], [0.06, 0, 0.025, 0.008]], weight: 1, pts: 30, size: 0.15, label: 'phone' },
  butt: { m: 0.001, e: 0.1, mu: 0.6, drag: 2, wind: 0.10, lie: 'side', lift: 0.005, balls: [[0, 0, 0, 0.005]], weight: 8, pts: 2, size: 0.03, label: 'cigarette butt' },
  rope: { m: 0.3, e: 0.05, mu: 0.8, drag: 0.1, wind: 0, lie: 'up', lift: 0.02, balls: ring(6, 0.12, 0.02), weight: 2, pts: 25, size: 0.28, label: 'coil of rope' },
  trolley: { m: 15, e: 0.2, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.31, balls: [...corners(0.24, 0.26, 0.40, 0.05), [0, -0.26, 0, 0.05], [0, 0.26, 0, 0.05]], weight: 1, pts: 500, size: 0.95, label: 'shopping trolley' },
  battery: { m: 0.3, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.0125, balls: [[-0.045, 0, 0, 0.0125], [0.045, 0, 0, 0.0125]], weight: 2, pts: 0, size: 0.14, label: 'spare battery pack' },
  // not litter: stones. Pebbles scatter when hit, a fist-size stone knocks the car, a rock stops it dead.
  pebble: { m: 0.02, e: 0.3, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.011, balls: [[0, 0, 0, 0.011]], weight: 10, size: 0.025, label: 'pebble' },
  stone: { m: 0.7, e: 0.2, mu: 0.7, drag: 0, wind: 0, lie: 'up', lift: 0.04, balls: [[0, 0, 0, 0.04]], weight: 5, size: 0.09, label: 'stone' },
  rock: { m: 220, e: 0.25, mu: 0.8, drag: 0, wind: 0, lie: 'up', lift: 0.16, fixed: true, balls: [[0, 0, 0, 0.26], [0.17, -0.05, 0.05, 0.17], [-0.12, -0.04, -0.14, 0.18]], weight: 2, size: 0.7, label: 'rock' },
  bag: { m: 0.006, weight: 14, pts: 10, label: 'plastic bag' },
  net: { m: 1, weight: 2, pts: 0, label: 'fishing net' },
  // the eight lost things (never placed at random)
  keys: { m: 0.05, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.012, balls: [[0, 0, 0, 0.012], [0.03, 0, 0.01, 0.008]], weight: 0, size: 0.09, label: 'car keys' },
  wallet: { m: 0.1, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.011, balls: [[-0.035, 0, 0, 0.011], [0.035, 0, 0, 0.011]], weight: 0, size: 0.11, label: 'wallet' },
  watch: { m: 0.08, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.012, balls: ring(4, 0.025, 0.012), weight: 0, size: 0.08, label: 'wristwatch' },
  camera: { m: 0.4, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.035, balls: [[-0.03, 0, 0, 0.035], [0.03, 0, 0, 0.035], [0, 0, -0.05, 0.028]], weight: 0, size: 0.13, label: 'camera' },
  headphones: { m: 0.25, e: 0.1, mu: 0.6, drag: 0, wind: 0, lie: 'up', lift: 0.03, balls: [[-0.08, 0, 0, 0.03], [0.08, 0, 0, 0.03], [0, 0, -0.07, 0.015]], weight: 0, size: 0.19, label: 'headphones' },
  teddy: { m: 0.2, e: 0.2, mu: 0.7, drag: 0.3, wind: 0.03, lie: 'up', lift: 0.07, balls: [[0, 0, 0, 0.07], [0, 0.10, 0, 0.05], [0.07, -0.04, 0.03, 0.03], [-0.07, -0.04, 0.03, 0.03]], weight: 0, size: 0.25, label: 'teddy bear' },
  football: { m: 0.43, e: 0.6, mu: 0.5, drag: 0.15, wind: 0.04, lie: 'up', lift: 0.11, balls: [[0, 0, 0, 0.11]], weight: 0, size: 0.22, label: 'football' },
  drone: { m: 0.9, e: 0.1, mu: 0.6, drag: 0.1, wind: 0, lie: 'up', lift: 0.035, balls: [[0, 0, 0, 0.035], [0.12, 0, 0.12, 0.03], [-0.12, 0, 0.12, 0.03], [0.12, 0, -0.12, 0.03], [-0.12, 0, -0.12, 0.03]], weight: 0, size: 0.34, label: 'crashed drone' },
};
export const FINDS = ['keys', 'wallet', 'watch', 'camera', 'headphones', 'teddy', 'football', 'drone'];
const NAMES = Object.keys(TYPES).filter(n => TYPES[n].weight > 0);
const TOTAL = NAMES.reduce((a, n) => a + TYPES[n].weight, 0);
for (const n in TYPES) { const t = TYPES[n]; if (t.balls) { let r2 = 0; for (const b of t.balls) r2 = Math.max(r2, b[0] * b[0] + b[1] * b[1] + b[2] * b[2]); t.I = 0.4 * t.m * Math.max(r2, 0.0012); t.reach = Math.sqrt(r2) + 0.11; } }

// ---- what each kind looks like (simple hand-built shapes; a file dropped into assets/litter/ replaces one) ----
const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, o));
const bx = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };
const cyl = (r1, r2, h, m, seg = 16, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg, 1, open), m);
const ball = (r, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); b.position.set(x, y, z); return b; };
function lathe(pts, m, seg = 20) { return new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg), m); }
function label(bg, band, text, fg) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 128); g.fillStyle = band; g.fillRect(0, 42, 256, 44);
  g.fillStyle = fg; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText(text, 64, 75); g.fillText(text, 192, 75);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const CAN_LABELS = [['#c8161d', '#f4f1ea', 'SODA', '#c8161d'], ['#1d4fa8', '#e9eef7', 'FIZZ', '#1d4fa8'], ['#1f7a3a', '#f3f0d8', 'LIME', '#1f7a3a'], ['#111', '#e2b01c', 'BOLT', '#111']];
let SHARED = null;
function shared() {
  return SHARED || (SHARED = {
    canMats: CAN_LABELS.map(l => mat(0xffffff, { map: label(...l), roughness: 0.35, metalness: 0.2 })),
    metal: mat(0xb9bcc0, { roughness: 0.4, metalness: 0.2 }), black: mat(0x18181b, { roughness: 0.5 }), white: mat(0xf2efe8, { roughness: 0.8 }),
    pet: mat(0xcfe8f5, { transparent: true, opacity: 0.45, roughness: 0.15 }), blue: mat(0x2a63c9), wrap: mat(0x2aa0d8),
    glassG: mat(0x2f6b3a, { transparent: true, opacity: 0.8, roughness: 0.1 }), glassB: mat(0x6b4a1e, { transparent: true, opacity: 0.8, roughness: 0.1 }),
    card: mat(0xa9824f, { roughness: 0.9 }), tape: mat(0xcbb893, { roughness: 0.7 }), red: mat(0xc7372c, { roughness: 0.8 }),
    brick: mat(0x9a4a32, { roughness: 0.95 }), rubber: mat(0x1b1b1d, { roughness: 0.9 }), wood: mat(0x9b7a52, { roughness: 0.85 }),
    foam: mat(0x18a7c9, { roughness: 0.9 }), filter: mat(0xd9a45a), rope: mat(0xcdb98a, { roughness: 1 }), yellow: mat(0xe8c21a), leather: mat(0x5b3a22, { roughness: 0.8 }),
    rockA: mat(0x8f7c66, { roughness: 1, flatShading: true }), rockB: mat(0x6f6258, { roughness: 1, flatShading: true }),
    fur: mat(0x9a6a3a, { roughness: 1 }), net: new THREE.MeshStandardMaterial({ color: 0x2f8a6a, wireframe: true, roughness: 1 }), screen: mat(0x2a3440, { roughness: 0.2 }),
  });
}
const DROPIN = {};                                  // real 3D models by kind (each a list of look-alikes to choose between)
// which object in which downloaded pack stands for which kind of litter (credits in assets/CREDITS.txt)
const PACKS = [
  { url: './assets/models/trash_debris/scene.gltf', picks: { can: ['Can_2', 'Can_3', 'Can_4', 'Can_5', 'Can_6', 'Can_7', 'Can_8', 'Can_2_Crushed', 'Can_5_Crushed'], brick: ['Brick_1', 'Brick_2'], box: ['CardboardBox_1', 'CardboardBox_2'],
      cup: ['Coffee_Cup', 'Soda_Cup', 'Coffee_Cup_WithLid', 'Coffee_Cup_Crushed'], gbottle: ['GlassBottle_1', 'GlassBottle_2', 'GlassBottle_3', 'GlassBottle_4'], tyre: ['Wheel_1'], plank: ['Wooden_Plank_1', 'Wooden_Plank_2', 'Wooden_Plank_3'], pbottle: ['WaterBottle'] } },
  { url: './assets/models/bottles.glb', picks: { pbottle: ['Plastic_Bottle_01_GEO', 'Plastic_Bottle_02_GEO', 'Plastic_Bottle_03_GEO'] } },
  { url: './assets/models/trash_pack.glb', picks: { gbottle: ['STZ_Wine_bottle_CR01.001_17'] } },
];
const plain = s => s.replace(/[.\s_]/g, '').toLowerCase();
// take one object out of a pack: stand it the way the physics expects, centre it, and scale it to its real size
function fit(node, kind) {
  const T = TYPES[kind], c = node.clone(), g1 = new THREE.Group(), g2 = new THREE.Group(), holder = new THREE.Group();
  node.updateWorldMatrix(true, false); c.matrix.copy(node.matrixWorld); c.matrix.decompose(c.position, c.quaternion, c.scale);
  g1.add(c); g2.add(g1); holder.add(g2);
  let sz = new THREE.Box3().setFromObject(g1).getSize(new THREE.Vector3()), d = [sz.x, sz.y, sz.z];
  const tall = T.lie === 'side', pick = tall ? d.indexOf(Math.max(...d)) : d.indexOf(Math.min(...d));   // cans and bottles: long axis up. Flat things: thin axis up.
  if (pick === 0) g1.rotation.z = Math.PI / 2; else if (pick === 2) g1.rotation.x = Math.PI / 2;
  g1.updateMatrixWorld(true); sz = new THREE.Box3().setFromObject(g1).getSize(new THREE.Vector3());
  if (!tall && sz.z > sz.x) g2.rotation.y = Math.PI / 2;                                                 // longest side along x
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g2), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3()), k = T.size / Math.max(size.x, size.y, size.z);
  g2.scale.setScalar(k); g2.position.copy(ctr).multiplyScalar(-k);
  return holder;
}
function build(type, seed) {
  if (DROPIN[type]) { const i = Math.floor(seed * 97) % DROPIN[type].length, m = DROPIN[type][i].clone(); m.userData.sk = type + '#' + i; return m; }
  const S = shared(), g = new THREE.Group();
  if (type === 'can') {
    const top = cyl(0.027, 0.033, 0.008, S.metal, 24); top.position.y = 0.059; const bot = cyl(0.033, 0.026, 0.008, S.metal, 24); bot.position.y = -0.059;
    g.add(cyl(0.033, 0.033, 0.110, S.canMats[Math.floor(seed * 4) % 4], 24, true), top, bot);
  } else if (type === 'pbottle') {
    g.add(lathe([[0, -0.105], [0.030, -0.105], [0.034, -0.095], [0.034, 0.03], [0.030, 0.06], [0.014, 0.09], [0.014, 0.105], [0, 0.105]], S.pet));
    const cap = cyl(0.016, 0.016, 0.016, S.blue); cap.position.y = 0.108; const wr = cyl(0.0345, 0.0345, 0.05, S.wrap, 20, true); wr.position.y = -0.02; g.add(cap, wr);
  } else if (type === 'gbottle') g.add(lathe([[0, -0.14], [0.035, -0.14], [0.037, -0.13], [0.037, 0.02], [0.030, 0.06], [0.014, 0.10], [0.014, 0.14], [0.016, 0.145], [0, 0.145]], seed > 0.5 ? S.glassG : S.glassB));
  else if (type === 'cup') { g.add(lathe([[0, -0.055], [0.030, -0.055], [0.042, 0.055], [0.040, 0.055], [0.029, -0.05], [0, -0.05]], S.white)); const band = cyl(0.0395, 0.0355, 0.035, S.red, 20, true); band.position.y = 0.01; g.add(band); }
  else if (type === 'box') g.add(bx(0.30, 0.20, 0.22, S.card), bx(0.302, 0.004, 0.05, S.tape, 0, 0.1, 0));
  else if (type === 'brick') g.add(bx(0.215, 0.065, 0.1025, S.brick));
  else if (type === 'tyre') { const t = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.10, 12, 28), S.rubber); t.rotation.x = Math.PI / 2; g.add(t); }
  else if (type === 'plank') g.add(bx(1.2, 0.035, 0.15, S.wood));
  else if (type === 'flipflop') { const s = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 6, 12, Math.PI), S.black); s.position.set(0.05, 0.012, 0); s.rotation.y = Math.PI / 2; g.add(bx(0.27, 0.022, 0.10, S.foam), s); }
  else if (type === 'sunglasses') g.add(bx(0.055, 0.04, 0.004, S.black, -0.034, 0, 0), bx(0.055, 0.04, 0.004, S.black, 0.034, 0, 0), bx(0.02, 0.006, 0.004, S.black, 0, 0.012, 0), bx(0.004, 0.006, 0.12, S.black, -0.064, 0.012, 0.06), bx(0.004, 0.006, 0.12, S.black, 0.064, 0.012, 0.06));
  else if (type === 'phone') g.add(bx(0.15, 0.009, 0.072, S.black), bx(0.138, 0.002, 0.064, S.screen, 0, 0.0055, 0));
  else if (type === 'butt') { const f = cyl(0.004, 0.004, 0.012, S.filter, 8); f.position.y = -0.009; g.add(cyl(0.004, 0.004, 0.018, S.white, 8), f); }
  else if (type === 'rope') for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.12 - i * 0.012, 0.011, 6, 22), S.rope); t.rotation.x = Math.PI / 2; t.position.y = (i - 1.5) * 0.012; g.add(t); }
  else if (type === 'trolley') {
    const w = 0.012; for (const x of [-0.24, 0.24]) for (const y of [-0.26, 0.26]) g.add(bx(w, w, 0.80, S.metal, x, y, 0));
    for (const x of [-0.24, 0.24]) for (const z of [-0.4, 0, 0.4]) g.add(bx(w, 0.52, w, S.metal, x, 0, z));
    for (const y of [-0.26, 0.26]) for (const z of [-0.4, -0.13, 0.13, 0.4]) g.add(bx(0.48, w, w, S.metal, 0, y, z));
    g.add(bx(0.50, 0.03, 0.03, S.red, 0, 0.30, 0.43)); for (const x of [-0.2, 0.2]) for (const z of [-0.36, 0.36]) { const c = cyl(0.05, 0.05, 0.03, S.rubber); c.position.set(x, -0.31, z); c.rotation.z = Math.PI / 2; g.add(c); }
  } else if (type === 'battery') g.add(bx(0.14, 0.025, 0.046, S.blue), bx(0.08, 0.026, 0.047, S.yellow), bx(0.02, 0.008, 0.008, S.red, 0.078, 0, 0.01), bx(0.02, 0.008, 0.008, S.black, 0.078, 0, -0.01));
  else if (type === 'net') { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3, 14, 14), S.net); p.rotation.x = -Math.PI / 2; g.add(p); }
  else if (type === 'pebble' || type === 'stone' || type === 'rock') {
    const R = TYPES[type].balls[0][3] * (type === 'rock' ? 1.25 : 1), geo = new THREE.IcosahedronGeometry(R, type === 'rock' ? 2 : 1), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.78 + 0.4 * hash(Math.round(x / R * 9), Math.round(y / R * 9), Math.round(z / R * 9 + seed * 500)); p.setXYZ(i, x * k * (type === 'rock' ? 1.25 : 1), y * k * 0.75, z * k); }
    geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, seed > 0.5 ? S.rockA : S.rockB));
  }
  else if (type === 'keys') { const r = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0015, 6, 14), S.metal); r.rotation.x = Math.PI / 2; g.add(r, bx(0.045, 0.003, 0.008, S.metal, 0.03, 0, 0.004), bx(0.03, 0.012, 0.02, S.black, 0.035, 0, -0.012)); }
  else if (type === 'wallet') g.add(bx(0.11, 0.022, 0.09, S.leather));
  else if (type === 'watch') { const r = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 18), S.black); r.rotation.x = Math.PI / 2; const f = cyl(0.02, 0.02, 0.01, S.metal); f.position.set(0.03, 0.005, 0); g.add(r, f); }
  else if (type === 'camera') { const l = cyl(0.028, 0.028, 0.05, S.black); l.rotation.x = Math.PI / 2; l.position.z = -0.045; g.add(bx(0.13, 0.075, 0.05, S.black), l, bx(0.03, 0.012, 0.03, S.metal, -0.035, 0.043, 0)); }
  else if (type === 'headphones') { const b = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.007, 6, 18, Math.PI), S.black); b.rotation.x = -Math.PI / 2; const a = cyl(0.035, 0.035, 0.03, S.red), c = cyl(0.035, 0.035, 0.03, S.red); a.position.x = -0.08; c.position.x = 0.08; a.rotation.z = c.rotation.z = Math.PI / 2; g.add(b, a, c); }
  else if (type === 'teddy') g.add(ball(0.07, S.fur), ball(0.05, S.fur, 0, 0.10, 0), ball(0.018, S.fur, 0.035, 0.145, 0), ball(0.018, S.fur, -0.035, 0.145, 0), ball(0.03, S.fur, 0.07, -0.04, 0.03), ball(0.03, S.fur, -0.07, -0.04, 0.03), ball(0.028, S.fur, 0.07, 0.03, 0.02), ball(0.028, S.fur, -0.07, 0.03, 0.02), ball(0.007, S.black, 0.018, 0.11, 0.044), ball(0.007, S.black, -0.018, 0.11, 0.044));
  else if (type === 'football') { g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 2), S.white)); for (let i = 0; i < 12; i++) { const v = new THREE.Vector3().setFromSphericalCoords(0.105, Math.acos(1 - 2 * (i + 0.5) / 12), i * 2.4); g.add(ball(0.026, S.black, v.x, v.y, v.z)); } }
  else if (type === 'drone') { g.add(bx(0.09, 0.03, 0.12, S.white)); for (const x of [-1, 1]) for (const z of [-1, 1]) { const a = bx(0.17, 0.012, 0.014, S.white, x * 0.06, 0, z * 0.06); a.rotation.y = -x * z * 0.785; const p = cyl(0.055, 0.055, 0.003, S.black); p.position.set(x * 0.12, 0.018, z * 0.12); g.add(a, p); } }
  return g;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), nrm = new THREE.Vector3(), rc = new THREE.Vector3(), P = new THREE.Vector3();
const gq = { h: 0, nx: 0, ny: 1, nz: 0 };
const PA = new THREE.Vector3(), PB = new THREE.Vector3(), ra = new THREE.Vector3(), rb = new THREE.Vector3(), ca = new THREE.Vector3(), cb2 = new THREE.Vector3(), J = new THREE.Vector3();

export { build as buildLitter };

export class Litter {
  // groundHeight(x,z) -> y ; groundSample(x,z,out) -> out.h + normal ; analyticHeight(x,z) for placing far pieces
  constructor(scene, groundHeight, groundSample, analyticHeight, field) {
    this.scene = scene; this.gh = groundHeight; this.gs = groundSample; this.ah = analyticHeight; this.field = field;
    this.cells = new Map(); this.items = []; this.near = []; this.obstacles = []; this.extra = [];
    // Everything solid that is not litter: [0] the car, [1] the trailer, then the things standing at each camp.
    // Each is a set of balls fitted to its model. body = what gets knocked (null = it does not move).
    const col = () => ({ balls: [], n: 0, c: new THREE.Vector3(), reach: 0, body: null });
    this.cols = [col(), col()]; this.balls = this.cols[0].balls; this.solidN = 0; this.carShape = null;
    this.notice = ''; this.toast = ''; this.toastT = 0; this.t = 0;
    this.wind = new THREE.Vector3();
    this.events = [];                 // things that just happened, for sound: [what, kind, how hard]
    this.found = new Set();
    try { for (const n of JSON.parse(localStorage.getItem('dunerc.found') || '[]')) this.found.add(n); } catch (e) { /* no storage: finds just are not remembered */ }
    // The state of the desert, kept between visits: which pieces have been taken away, where the ones you shoved now lie,
    // and the extra pieces that storms blew in or that fell out of your car.
    this.gone = new Set(); this.moved = {}; this.dyn = []; this.nid = 0; this.saveT = 0;
    try { const w = JSON.parse(localStorage.getItem('dunerc.world') || 'null'); if (w) { this.gone = new Set(w.gone); this.moved = w.moved || {}; this.dyn = w.dyn || []; this.nid = w.n || 0; } } catch (e) { /* start with a fresh desert */ }
  }

  // look in assets/litter/ for 3D model files named after a kind (can.glb, tyre.glb ...) and use them instead of the built-in shapes
  async loadModels(GLTFLoader) {
    try {
      const html = await (await fetch('./assets/litter/')).text();
      const files = [...html.matchAll(/href="([a-z]+)\.glb"/g)].map(m => m[1]).filter(n => TYPES[n] && TYPES[n].size);
      const loader = new GLTFLoader();
      await Promise.all(files.map(n => new Promise(res => loader.load('./assets/litter/' + n + '.glb', g => {
        const box = new THREE.Box3().setFromObject(g.scene), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const k = TYPES[n].size / Math.max(sz.x, sz.y, sz.z), holder = new THREE.Group();
        g.scene.position.copy(c).multiplyScalar(-k); g.scene.scale.setScalar(k); holder.add(g.scene);
        DROPIN[n] = [holder]; res();
      }, undefined, () => res()))));
      // then the downloaded packs (a single file dropped in assets/litter/ wins over these)
      await Promise.all(PACKS.map(pk => new Promise(res => loader.load(pk.url, g => {
        g.scene.updateMatrixWorld(true);
        for (const kind in pk.picks) {
          if (files.includes(kind)) continue;
          for (const name of pk.picks[kind]) { let node = null; g.scene.traverse(o => { if (!node && plain(o.name) === plain(name)) node = o; }); if (node) (DROPIN[kind] = DROPIN[kind] || []).push(fit(node, kind)); }
        }
        res();
      }, undefined, () => res()))));
      return Object.keys(DROPIN);
    } catch (e) { return []; }
  }

  // id names a piece for good (so the game can remember it). A piece made without one is new to the world: it is given an id and remembered.
  make(type, x, z, seed, yaw, id) {
    if (!TYPES[type]) return null;
    let dyn = null;
    if (!id) { id = 'x' + (this.nid++); dyn = { id, type, x, z, seed, yaw }; this.dyn.push(dyn); }
    else if (this.gone.has(id)) return null;
    const hx = x, hz = z; if (this.moved[id]) { x = this.moved[id][0]; z = this.moved[id][1]; }
    const T = TYPES[type];
    const o = { type, T, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), asleep: true, still: 0, settled: false, seed };
    if (type === 'bag') { o.cloth = new Cloth(seed, x, z, this.ah); o.mesh = o.cloth.mesh; o.pos.copy(o.cloth.pos); }
    else {
      o.mesh = build(type, seed);
      if (type !== 'net') this.shape(o, seed);
      o.pos.y = this.ah(x, z) + (type === 'net' ? 0.012 : T.lift);
      o.q.setFromAxisAngle(v1.set(0, 1, 0), yaw);
      if (type === 'net') {                                       // drape it along the slope
        const e = 0.5, n = v2.set(this.ah(x - e, z) - this.ah(x + e, z), 2 * e, this.ah(x, z - e) - this.ah(x, z + e)).normalize();
        o.q.premultiply(new THREE.Quaternion().setFromUnitVectors(v1.set(0, 1, 0), n)); o.cool = 0;
      } else if (T.lie === 'side') o.q.multiply(new THREE.Quaternion().setFromAxisAngle(v1.set(0, 0, 1), Math.PI / 2));
      // stand it on the sand on its own lowest point (rocks stay half buried)
      if (o.balls && !T.fixed) { let low = 1e9; for (const b of o.balls) { P.set(b[0], b[1], b[2]).applyQuaternion(o.q); low = Math.min(low, P.y - b[3]); } o.pos.y = this.ah(x, z) - low; }
      o.mesh.position.copy(o.pos); o.mesh.quaternion.copy(o.q);
    }
    o.id = id; o.hx = hx; o.hz = hz; o.dyn = dyn;
    this.scene.add(o.mesh); this.items.push(o);
    return o;
  }

  // The collision shape of a piece is taken from the model you see (shape.js), so the two always match.
  shape(o, seed) {
    const T = o.T, t = o.type;
    const key = o.mesh.userData.sk || (t + (t === 'pebble' ? ':' + Math.floor(seed * 6) : (t === 'stone' || t === 'rock') ? ':' + seed : ''));
    // small things need fewer balls; stones are each a different shape, so theirs are fitted more quickly
    const size = T.size || 0.1, stone = t === 'pebble' || t === 'stone' || t === 'rock';
    const sh = fitBalls(o.mesh, { frame: o.mesh, max: size < 0.05 ? 6 : size < 0.13 ? 16 : 28, res: stone ? 12 : 24, key });
    o.balls = sh.balls.length ? sh.balls : T.balls;
    let r2 = 0, reach = 0; for (const b of o.balls) { const r = Math.hypot(b[0], b[1], b[2]); r2 = Math.max(r2, r * r); reach = Math.max(reach, r + b[3]); }
    o.I = 0.4 * T.m * Math.max(r2, 0.0012); o.reach = reach;
  }

  remove(o) {
    if (o.dyn) { const k = this.dyn.indexOf(o.dyn); if (k >= 0) this.dyn.splice(k, 1); } else if (o.id) { this.gone.add(o.id); delete this.moved[o.id]; }
    this.saveT = 0;
    this.scene.remove(o.mesh); const i = this.items.indexOf(o); if (i >= 0) this.items.splice(i, 1);
    for (const list of this.cells.values()) { const k = list.indexOf(o); if (k >= 0) list.splice(k, 1); }
    o.gone = true;
  }

  // pieces by the start so there is something to hit straight away, the eight lost things, and two spare packs further out
  seedNear(x, z) {
    const lay = [['can', 0.9, -1.6], ['pbottle', -0.5, -2.4], ['bag', 0.1, -3.4], ['cup', 1.3, -2.9], ['gbottle', -1.2, -3.6], ['box', 0.9, -4.8], ['brick', -0.6, -5.4], ['bag', -1.6, -6.2], ['tyre', 1.8, -7.5], ['plank', -1.5, -8.5],
      ['flipflop', 2.4, -3.2], ['phone', -2.2, -2.2], ['sunglasses', 2.0, -5.6], ['rope', -2.6, -7.0], ['net', 3.6, -9.5], ['trolley', -3.5, -11], ['butt', 0.5, -1.2], ['butt', 0.2, -2.0], ['battery', -8, -22], ['battery', 60, -110]];
    lay.forEach((l, i) => { const o = this.make(l[0], x + l[1], z + l[2], hash(i, 7, 3), i * 1.3, 's' + i); if (o) this.extra.push(o); });
    // pieces remembered from earlier visits (blown in by storms, or spilled from the car)
    for (const d of this.dyn.slice()) { const o = this.make(d.type, d.x, d.z, d.seed, d.yaw, d.id); if (o) o.dyn = d; }
    FINDS.forEach((n, i) => {
      const a = i * 0.785 + 0.4, d = 110 + i * 90, o = this.make(n, x + Math.cos(a) * d, z + Math.sin(a) * d, hash(i, 9, 5), i * 2.1, 'f' + n);
      if (o) { o.find = true; o.keep = true; this.extra.push(o); }
    });
  }

  loadCells(cx, cz) {
    const ci = Math.floor(cx / CELLSZ), cj = Math.floor(cz / CELLSZ);
    if (ci === this.ci && cj === this.cj) return;
    this.ci = ci; this.cj = cj;
    for (let j = cj - LOAD_R; j <= cj + LOAD_R; j++) for (let i = ci - LOAD_R; i <= ci + LOAD_R; i++) {
      const key = i + '_' + j; if (this.cells.has(key)) continue;
      const list = []; this.cells.set(key, list);
      // litter is everywhere: a handful in every 40 m square, and a real dump heap in about one square in six
      const h = hash(i, j, 1), heap = hash(i, j, 2) > 0.84;
      const n = heap ? 9 + Math.floor(h * 6) : 3 + Math.floor(h * 6);
      const hx = (i + 0.2 + 0.6 * hash(i, j, 3)) * CELLSZ, hz = (j + 0.2 + 0.6 * hash(i, j, 4)) * CELLSZ;
      for (let k = 0; k < n; k++) {
        let pick = hash(i, j, 10 + k) * TOTAL, type = NAMES[0];
        for (const nm of NAMES) { pick -= TYPES[nm].weight; if (pick <= 0) { type = nm; break; } }
        const x = heap ? hx + (hash(i, j, 20 + k) - 0.5) * 7 : (i + hash(i, j, 20 + k)) * CELLSZ, z = heap ? hz + (hash(i, j, 30 + k) - 0.5) * 7 : (j + hash(i, j, 30 + k)) * CELLSZ;
        const keep = o => { if (o) list.push(o); }, id = 'c' + i + '_' + j + '_' + k;
        keep(this.make(type, x, z, hash(i, j, 40 + k), hash(i, j, 50 + k) * 6.283, id));
        if (type === 'pebble') for (let e = 0; e < 5; e++) keep(this.make('pebble', x + (hash(i, j, 200 + k * 9 + e) - 0.5) * 0.9, z + (hash(i, j, 300 + k * 9 + e) - 0.5) * 0.9, hash(i, j, 400 + k * 9 + e), 0, id + 'p' + e));   // pebbles lie in handfuls
      }
    }
    for (const [key, list] of this.cells) {
      const [i, j] = key.split('_').map(Number);
      if (Math.abs(i - ci) <= LOAD_R + 1 && Math.abs(j - cj) <= LOAD_R + 1) continue;
      for (const o of list) { this.scene.remove(o.mesh); const k = this.items.indexOf(o); if (k >= 0) this.items.splice(k, 1); }
      this.cells.delete(key);
    }
  }

  // A sandstorm strips sand away and blows rubbish in: new pieces turn up within reach of camp.
  stormDrop(hx, hz, n) {
    if (this.dyn.length > 400) return 0;
    const kinds = NAMES.filter(t => !['pebble', 'stone', 'rock', 'net', 'trolley'].includes(t)); let total = 0; for (const t of kinds) total += TYPES[t].weight;
    for (let k = 0; k < n; k++) {
      let pick = Math.random() * total, type = kinds[0]; for (const t of kinds) { pick -= TYPES[t].weight; if (pick <= 0) { type = t; break; } }
      const a = Math.random() * 6.283, d = 20 + Math.random() * 120;
      this.make(type, hx + Math.cos(a) * d, hz + Math.sin(a) * d, Math.random(), Math.random() * 6.283);
    }
    this.saveT = 0; return n;
  }

  // write the state of the desert to the browser every few seconds (and when the page closes)
  persist(dt, now) {
    if (!now && (this.saveT -= dt) > 0) return; this.saveT = 6;
    for (const o of this.items) {
      if (!o.id || o.held || o.gone) continue;
      const p = o.cloth ? o.cloth.pos : o.pos, still = o.cloth ? true : o.vel.lengthSq() < 0.25;      // anything not flying through the air
      if (o.dyn) { o.dyn.x = +p.x.toFixed(2); o.dyn.z = +p.z.toFixed(2); }
      else if (still && Math.hypot(p.x - o.hx, p.z - o.hz) > 0.3) this.moved[o.id] = [+p.x.toFixed(2), +p.z.toFixed(2)];
    }
    try { localStorage.setItem('dunerc.world', JSON.stringify({ gone: [...this.gone], moved: this.moved, dyn: this.dyn, n: this.nid })); } catch (e) { /* cannot save here */ }
  }

  // The car's shape: body balls in the car's own frame, and for each wheel its balls in the wheel's frame
  // (pivots = the four wheel holders of the model, which carry the suspension travel and the steering angle).
  setCarShape(body, wheels, pivots) {
    const B = this.cols[0].balls; B.length = 0;
    const add = (l, wheel) => B.push({ c: new THREE.Vector3(), r: l[3], v: new THREE.Vector3(), wheel, l });
    for (const l of body) add(l, -1);
    wheels.forEach((list, i) => { for (const l of list) add(l, i); });
    this.carShape = { pivots }; this.cols[0].n = B.length;
    let reach = 0; for (const b of B) reach = Math.max(reach, Math.hypot(b.l[0], b.l[1], b.l[2]) + b.r + (b.wheel >= 0 ? 0.25 : 0));
    this.cols[0].reach = reach;
  }

  // where the car's balls are right now, and how fast each is moving
  carBalls(car) {
    const C = this.cols[0], B = C.balls, S = car.spec;
    C.c.copy(car.pos); C.body = car;
    if (this.carShape) {
      const pv = this.carShape.pivots;
      for (const b of B) {
        b.c.set(b.l[0], b.l[1], b.l[2]);
        if (b.wheel >= 0) { const p = pv[b.wheel]; b.c.applyQuaternion(p.quaternion).add(p.position); }
        b.c.applyQuaternion(car.q).add(car.pos);
      }
    } else {
      // until the car's model has loaded: four wheels, four along the chassis, two for the roof
      if (B.length !== 10) { B.length = 0; for (let i = 0; i < 10; i++) B.push({ c: new THREE.Vector3(), r: 0, v: new THREE.Vector3(), wheel: -1 }); C.n = 10; C.reach = 0.45; }
      let k = 0;
      for (let i = 0; i < 4; i++) { const w = car.wheels[i], b = B[k++]; b.c.set(w.x, w.ay - w.len, w.z).applyQuaternion(car.q).add(car.pos); b.r = w.r; b.wheel = i; }
      const r = Math.max(0.06, S.halfW * 0.85), z0 = S.nose + r * 0.7, z1 = S.tail - r * 0.7;
      for (let i = 0; i < 4; i++) { const b = B[k++]; b.c.set(0, 0.005, z0 + (z1 - z0) * i / 3).applyQuaternion(car.q).add(car.pos); b.r = i === 0 ? r * 0.8 : r; b.wheel = -1; }
      for (const z of [S.nose * 0.2, S.tail * 0.4]) { const b = B[k++]; b.c.set(0, S.top - 0.06, z).applyQuaternion(car.q).add(car.pos); b.r = 0.065; b.wheel = -1; }
    }
    // vel + w x r
    for (const b of B) b.v.subVectors(b.c, car.pos).cross(car.w).negate().add(car.vel);
  }

  // things that stand still (the camp): fitted once, where they stand
  addSolids() {
    while (this.solidN < SOLIDS.length) {
      const sh = fitBalls(SOLIDS[this.solidN++], { max: 80 });
      if (!sh.balls.length) continue;
      const C = { balls: [], n: 0, c: new THREE.Vector3((sh.min[0] + sh.max[0]) / 2, (sh.min[1] + sh.max[1]) / 2, (sh.min[2] + sh.max[2]) / 2), reach: 0, body: null };
      for (const l of sh.balls) { const b = { c: new THREE.Vector3(l[0], l[1], l[2]), r: l[3], v: new THREE.Vector3(), wheel: -1 }; C.balls.push(b); C.reach = Math.max(C.reach, b.c.distanceTo(C.c) + b.r); }
      C.n = C.balls.length; this.cols.push(C);
    }
  }

  // Two solid things against each other (car and trailer, car and skip, trailer and backpack ...).
  // The deepest touching pair of balls is where they meet: they are knocked apart there and pushed out of each other.
  pair(A, B) {
    if (!A.n || !B.n || (!A.body && !B.body)) return;
    const R = A.reach + B.reach; if (A.c.distanceToSquared(B.c) > R * R) return;
    const towing = A === this.cols[0] && B === this.cols[1];
    let best = 0, ba = null, bb = null;
    for (let j = 0; j < B.n; j++) {
      const b = B.balls[j]; if (towing && b.bar) continue;
      const ra = A.reach + b.r; if (b.c.distanceToSquared(A.c) > ra * ra) continue;
      for (let i = 0; i < A.n; i++) {
        const a = A.balls[i], rr = a.r + b.r, d2 = a.c.distanceToSquared(b.c);
        if (d2 >= rr * rr) continue;
        const pen = rr - Math.sqrt(d2); if (pen > best) { best = pen; ba = a; bb = b; }
      }
    }
    if (!ba) return;
    nrm.subVectors(ba.c, bb.c); const d = nrm.length(); if (d < 1e-7) return; nrm.multiplyScalar(1 / d);
    P.copy(bb.c).addScaledVector(nrm, bb.r);
    const kA = A.body ? A.body.kAt(P, nrm) : 0, kB = B.body ? B.body.kAt(P, nrm) : 0;
    v1.subVectors(ba.v, bb.v); const vn = v1.dot(nrm);
    if (vn < 0) {
      const j = -1.15 * vn / (kA + kB);
      v3.copy(v1).addScaledVector(nrm, -vn); const vt = v3.length();
      const jt = vt > 1e-5 ? Math.min(0.5 * j, vt / (kA + kB)) / vt : 0;
      v3.multiplyScalar(-jt).addScaledVector(nrm, j);
      if (A.body) A.body.applyImpulse(v3, P);
      if (B.body) B.body.applyImpulse(v2.copy(v3).negate(), P);
      if (-vn > 0.8) {
        this.events.push(['knock', 'brick', Math.min(1, -vn / 5)]);
        for (const X of [A, B]) if (X.body && X.body.shock !== undefined && !towing) X.body.shock = Math.max(X.body.shock, -vn);
      }
    }
    const iA = A.body ? 1 / A.body.mass : 0, iB = B.body ? 1 / B.body.mass : 0, push = best * 0.9 / (iA + iB);
    if (A.body) A.body.pos.addScaledVector(nrm, push * iA);
    if (B.body) B.body.pos.addScaledVector(nrm, -push * iB);
  }

  step(dt, car) {
    this.t += dt;
    this.carBalls(car); this.addSolids();
    const cols = this.cols;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) this.pair(cols[i], cols[j]);
    const act = this.near; act.length = 0;
    const wsp = this.wind.length(), env = this.env || (this.env = { gh: this.gh, balls: this.balls, car, wind: this.wind, t: 0 });
    env.car = car; env.t = this.t;
    for (const o of this.items) {
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z, d2 = dx * dx + dz * dz;
      if (o.cloth) {
        if (d2 > ACTIVE_R * ACTIVE_R && o.cloth.state === 'free') continue;
        o.cloth.step(dt, env); o.pos.copy(o.cloth.pos);
        if (o.cloth.released) { o.cloth.released = false; car.bagDrag = 0; this.notice = ''; }
        else if (o.cloth.notice) this.notice = o.cloth.notice;
        continue;
      }
      if (o.held) continue;                                          // in the player's hand: it touches nothing until it is let go
      if (o.type === 'net') { if (d2 < 2) this.stepNet(o, dt, car); continue; }
      if (d2 > ACTIVE_R * ACTIVE_R) continue;
      act.push(o);
      if (o.find && !this.found.has(o.type) && d2 < 0.64) {       // drove right up to a lost thing: found it
        this.found.add(o.type); this.toast = 'Found: ' + o.T.label + '  (' + this.found.size + ' of ' + FINDS.length + ')'; this.toastT = 4; this.events.push(['find', o.type, 1]);
        try { localStorage.setItem('dunerc.found', JSON.stringify([...this.found])); } catch (e) { /* not remembered */ }
      }
      if (!o.settled && !o.T.fixed) { o.asleep = false; o.settled = true; }   // let it settle onto the real surface once (rocks are half buried and stay put)
      let near = false;
      for (const C of cols) { if (!C.n) continue; const R = o.reach + C.reach + 0.2; if (o.pos.distanceToSquared(C.c) < R * R) { near = true; break; } }
      if (o.asleep && o.T.wind * wsp * wsp > o.T.mu * G) { o.asleep = false; o.still = 0; }   // wind strong enough to shift it
      if (o.asleep && !near) continue;
      this.stepBody(o, dt, car, near);
      if (o.gone) act.pop();
    }
    // litter against litter: a rolling can stops against a brick, a box shoved into a heap moves the heap
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (a.asleep && b.asleep) continue;
      const r = a.reach + b.reach, dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
      if (dx * dx + dy * dy + dz * dz < r * r) this.collide(a, b);
    }
    this.toastT -= dt; if (this.toastT <= 0) this.toast = '';
  }

  // a fishing net lying on the sand: a turning wheel that runs over it gets tangled
  stepNet(o, dt, car) {
    o.cool = Math.max(0, o.cool - dt); if (o.cool > 0) return;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      v1.set(w.x, w.ay - w.len, w.z).applyQuaternion(car.q).add(car.pos).sub(o.pos); if (Math.abs(v1.x) > 0.62 || Math.abs(v1.z) > 0.62 || Math.abs(v1.y) > w.r + 0.05) continue;
      if (!w.on || Math.abs(w.omega) < 6 || w.jam > 0) continue;
      w.jam = 1; w.jamDir = Math.sign(w.omega); o.cool = 2.5;
      this.notice = 'Fishing net tangled round the ' + ['front-left', 'front-right', 'rear-left', 'rear-right'][i] + ' wheel. ' + (w.drive ? 'Drive the other way to work it free.' : 'It will pull free as it drags.');
      this.events.push(['snag', 'net', 1]); o.jamWheel = i; return;
    }
  }

  collide(a, b) {
    const Ta = a.T, Tb = b.T, ima = 1 / Ta.m, imb = 1 / Tb.m, iIa = 1 / a.I, iIb = 1 / b.I, e = Math.min(Ta.e, Tb.e);
    for (const ba of a.balls) for (const bb of b.balls) {
      PA.set(ba[0], ba[1], ba[2]).applyQuaternion(a.q).add(a.pos);
      PB.set(bb[0], bb[1], bb[2]).applyQuaternion(b.q).add(b.pos);
      nrm.subVectors(PA, PB); const d = nrm.length(), pen = ba[3] + bb[3] - d;
      if (pen <= 0 || d < 1e-6) continue;
      nrm.multiplyScalar(1 / d);
      ra.subVectors(PA, a.pos).addScaledVector(nrm, -ba[3]); rb.subVectors(PB, b.pos).addScaledVector(nrm, bb[3]);
      v1.crossVectors(a.w, ra).add(a.vel); v2.crossVectors(b.w, rb).add(b.vel); v1.sub(v2);
      const vn = v1.dot(nrm);
      ca.crossVectors(ra, nrm); cb2.crossVectors(rb, nrm);
      const meff = 1 / (ima + imb + ca.lengthSq() * iIa + cb2.lengthSq() * iIb);
      if (vn < -0.02) {
        a.asleep = b.asleep = false; a.still = b.still = 0;
        const j = -(1 + e) * vn * meff;
        if (-vn > 0.6) this.events.push(['knock', Ta.m < Tb.m ? a.type : b.type, Math.min(1, -vn / 4)]);
        v3.copy(v1).addScaledVector(nrm, -vn); const vt = v3.length();
        const jt = vt > 1e-5 ? Math.min(0.4 * j, vt * meff) / vt : 0;
        J.copy(v3).multiplyScalar(-jt).addScaledVector(nrm, j);
        a.vel.addScaledVector(J, ima); a.w.addScaledVector(v3.crossVectors(ra, J), iIa);
        b.vel.addScaledVector(J, -imb); b.w.addScaledVector(v3.crossVectors(rb, J), -iIb);
      }
      const share = Tb.m / (Ta.m + Tb.m);                                 // the lighter one gives way
      if (!a.asleep || !b.asleep) { a.pos.addScaledVector(nrm, pen * share * 0.8); b.pos.addScaledVector(nrm, -pen * (1 - share) * 0.8); }
    }
  }

  stepBody(o, dt, car, near) {
    const T = o.T, pos = o.pos, vel = o.vel, w = o.w, im = 1 / T.m, iI = 1 / o.I;
    if (!o.asleep) {
      vel.y -= G * dt;
      const sp = vel.length(); if (T.drag) vel.multiplyScalar(1 - Math.min(0.5, T.drag * sp * dt));
      if (T.wind) { v1.copy(this.wind).sub(vel); v1.y = 0; vel.addScaledVector(v1, T.wind * v1.length() * dt); }   // the wind on it
      pos.addScaledVector(vel, dt);
      v1.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5);
      const q = o.q, qx = v1.x * q.w + v1.y * q.z - v1.z * q.y, qy = v1.y * q.w + v1.z * q.x - v1.x * q.z, qz = v1.z * q.w + v1.x * q.y - v1.y * q.x, qw = -v1.x * q.x - v1.y * q.y - v1.z * q.z;
      q.set(q.x + qx, q.y + qy, q.z + qz, q.w + qw).normalize();
    }
    // against everything solid near it: the car, the trailer, the things at camp
    if (near) {
      let hit = false;
      for (const C of this.cols) {
        if (!C.n) continue;
        const R = o.reach + C.reach; if (pos.distanceToSquared(C.c) > R * R) continue;
        const body = C.body, imc = body ? 1 / body.mass : 0, CB = C.balls, n = C.n;
        for (const b of o.balls) {
          P.set(b[0], b[1], b[2]).applyQuaternion(o.q).add(pos);
          for (let ci = 0; ci < n; ci++) {
            const cb = CB[ci], rr = b[3] + cb.r;
            nrm.subVectors(P, cb.c); const d2 = nrm.lengthSq();
            if (d2 >= rr * rr || d2 < 1e-12) continue;
            const d = Math.sqrt(d2), pen = rr - d;
            nrm.multiplyScalar(1 / d); if (body === car) hit = true;
            o.asleep = false; o.still = 0;
            rc.subVectors(P, pos).addScaledVector(nrm, -b[3]);
            // how fast they are closing
            v1.crossVectors(w, rc).add(vel).sub(cb.v);
            const vn = v1.dot(nrm);
            v2.crossVectors(rc, nrm);
            const meff = 1 / (im + v2.lengthSq() * iI + imc);
            if (vn < 0) {
              const j = -(1 + T.e) * vn * meff;
              if (-vn > 0.7) this.events.push(['knock', o.type, Math.min(1, -vn / 6 * Math.min(1, T.m * 4 + 0.3))]);
              // sliding: friction drags it along
              v3.copy(v1).addScaledVector(nrm, -vn); const vt = v3.length();
              const jt = vt > 1e-5 ? Math.min(0.45 * j, vt * meff) / vt : 0;
              v3.multiplyScalar(-jt).addScaledVector(nrm, j);
              vel.addScaledVector(v3, im); w.addScaledVector(v2.crossVectors(rc, v3), iI);
              if (body) body.applyImpulse(v3.negate(), cb.c);
            }
            // the lighter one gets shoved out of the way
            const share = imc ? im / (im + imc) : 1;
            pos.addScaledVector(nrm, pen * share); if (body) body.pos.addScaledVector(nrm, -pen * (1 - share));
            P.addScaledVector(nrm, pen * share);
          }
        }
      }
      if (hit && o.type === 'battery' && car.battery < car.capacity * 0.98) {
        // a spare pack: swap it in
        car.battery = car.capacity; this.toast = 'Spare battery pack fitted: 100%'; this.toastT = 4; this.events.push(['battery', 'battery', 1]); this.remove(o); return;
      }
    }
    if (T.fixed) { o.asleep = true; vel.set(0, 0, 0); w.set(0, 0, 0); return; }
    if (o.asleep) return;
    // against the sand
    this.gs(pos.x, pos.z, gq); nrm.set(gq.nx, gq.ny, gq.nz);
    let maxPen = 0, touching = false;
    for (const b of o.balls) {
      P.set(b[0], b[1], b[2]).applyQuaternion(o.q).add(pos);
      const pen = (this.gh(P.x, P.z) + b[3] - P.y) * gq.ny;
      if (pen <= 0) continue;
      touching = true; if (pen > maxPen) maxPen = pen;
      rc.subVectors(P, pos).addScaledVector(nrm, -b[3]);
      v1.crossVectors(w, rc).add(vel);
      const vn = v1.dot(nrm);
      // it presses the sand: by its weight, and harder when it lands. A brick leaves a dent, a can leaves a faint trail.
      const dent = Math.min(0.02, 0.0012 * T.m * G / o.balls.length + (vn < -0.4 ? Math.min(0.015, -vn * T.m * 0.012) : 0));
      if (dent > 0.0003) this.field.press(P.x, P.z, P.x, P.z, b[3] * 0.75, dent, 0);
      v2.crossVectors(rc, nrm);
      const meff = 1 / (im + v2.lengthSq() * iI);
      const j = vn < 0 ? -(1 + (vn < -1 ? T.e : 0)) * vn * meff : 0;
      v3.copy(v1).addScaledVector(nrm, -vn); const vt = v3.length();
      const jt = vt > 1e-5 ? Math.min(T.mu * (j + T.m * G * dt / o.balls.length * 2), vt * meff) / vt : 0;
      v3.multiplyScalar(-jt).addScaledVector(nrm, j);
      vel.addScaledVector(v3, im); w.addScaledVector(v2.crossVectors(rc, v3), iI);
    }
    if (touching) {
      pos.addScaledVector(nrm, maxPen * 0.6);
      w.multiplyScalar(1 - Math.min(1, 2.5 * dt)); vel.multiplyScalar(1 - Math.min(1, 0.6 * dt));   // soft sand soaks up rolling
      if (vel.lengthSq() < 0.0016 && w.lengthSq() < 0.16) { o.still += dt; if (o.still > 0.4) { o.asleep = true; vel.set(0, 0, 0); w.set(0, 0, 0); } } else o.still = 0;
    }
  }

  // once per drawn frame
  draw(car) {
    const obs = this.obstacles; obs.length = 0;
    for (const o of this.near) {
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
      if (dx * dx + dz * dz > 9) continue;
      for (const b of o.balls) { P.set(b[0], b[1], b[2]).applyQuaternion(o.q).add(o.pos); obs.push({ x: P.x, y: P.y, z: P.z, r: b[3], o }); }
    }
    for (const o of this.items) {
      if (o.cloth) { if (!o.cloth.asleep) o.cloth.updateMesh(); }
      else if (!o.asleep) { o.mesh.position.copy(o.pos); o.mesh.quaternion.copy(o.q); }
    }
  }
}
