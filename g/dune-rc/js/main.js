// Dune RC: the whole game wired together.
import * as THREE from 'three';
import { height, duneWeights, DUNE_NAMES, sandColor } from './world.js';
import { Terrain } from './terrain.js';
import { U, updateSky, makeSky, makeSand } from './sky.js';
import { Post } from './post.js';
import { Car, SPEEDS } from './vehicle.js';
import { SPECS } from './specs.js';
import { buildCar, updateSuspension, LAMP } from './cars.js';
import { Plants } from './plants.js';
import { SandField } from './sandfield.js';
import { Sand } from './particles.js';
import { Litter, FINDS } from './litter.js';
import { Critters, loadCritterModels } from './critters.js';
import { Weather } from './weather.js';
import { Stunts } from './stunts.js';
import { Sound } from './audio.js';
import { Base } from './base.js';
import { fitBalls } from './shape.js';
import { CAR_INFO } from './progression.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';

const $ = id => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 9000);
camera.rotation.order = 'YXZ';
const post = new Post(renderer, camera);
post.uniforms.uMode.value = 1;                       // thin and subtle outline (your pick)

const sky = makeSky(); scene.add(sky);
const sandFar = makeSand(false), sandNear = makeSand(true);   // near the car the sand can be dug
const terrain = new Terrain(scene, sandFar);
const sun = new THREE.DirectionalLight(); scene.add(sun);     // lights for ordinary objects (the sand has its own shader)
const hemi = new THREE.HemisphereLight(); scene.add(hemi);

const field = new SandField(renderer);
U.uField.value = field.tex; U.uProj.value = camera.projectionMatrix;
// the ground everything feels = the dune + whatever has been dug out or piled up on it
function ground(x, z, out) { terrain.sample(x, z, out); field.applyTo(x, z, out); }
const groundH = (x, z) => terrain.heightFast(x, z) + field.height(x, z);

// ---- the three cars ----
const car = new Car(ground, SPECS[0]);
let play = null;
const models = SPECS.map(s => { const m = buildCar(s); m.grp.visible = false; scene.add(m.grp); return m; });
let carIdx = 0, model = models[0]; model.grp.visible = true;
// put the player in one of the cars (by its id)
function useCar(id) {
  const yaw = Math.atan2(-car.F.x, -car.F.z);
  model.grp.visible = false; carIdx = Math.max(0, SPECS.findIndex(s => s.id === id)); model = models[carIdx]; model.grp.visible = true;
  car.setSpec(SPECS[carIdx]);
  car.topKmh = (CAR_INFO[SPECS[carIdx].id] || { top: 60 }).top;
  car.place(car.pos.x, car.pos.z, yaw);
}
// G: the next car. Every car is yours.
function switchCar() { useCar(SPECS[(carIdx + 1) % SPECS.length].id); stunts.reset(); }
// The car's collision shape is fitted to the model that is on screen: its body, and each wheel on its own.
// (Checked now and then, because a model arrives a moment after the game starts and changes when you change car.)
let fitKey = '', shKey = '', shPick = [];
function fitCar() {
  let n = 0; model.grp.traverse(o => { if (o.isMesh && o.visible) n++; });
  const key = 'car' + carIdx + ':' + n;
  if (key === fitKey && car.body.fitted) return;
  fitKey = key;
  const pivots = model.wheels.map(w => w.pivot), arms = model.susp.flatMap(s => [s.arm, s.arm2, s.shock]);
  const body = fitBalls(model.grp, { frame: model.grp, skip: [...pivots, ...arms], max: 90, key });
  if (!body.balls.length) return;
  const wheels = pivots.map((p, i) => { const s = fitBalls(p, { frame: p, max: 12, key: key + 'w' + i }); return s.balls.length ? s.balls : [[0, 0, 0, car.wheels[i].r * 0.9]]; });
  litter.setCarShape(body.balls, wheels, pivots); car.setBody(body.balls); car.body.fitted = true;
}

const sand = new Sand(scene, groundH, field);
const litter = new Litter(scene, groundH, ground, height, field);
sand.obstacles = litter.obstacles;
const critters = new Critters(scene, groundH, field);
const weather = new Weather(scene, groundH, U);
litter.wind = weather.wind;
const plants = new Plants(scene, height);
const stunts = new Stunts();
// headlights: on by themselves when it gets dark, or switched by hand with L
let lightMode = 'auto';
const headlamp = new THREE.SpotLight(0xfff0d0, 0, 12, 0.5, 0.6, 1.5); scene.add(headlamp, headlamp.target);
const cloudDrift = new THREE.Vector2();
const sound = new Sound();
let base = null;

// ---- what the car does to the sand, every physics step ----
let sandStep = 0;
const bodyPart = { c: new THREE.Vector3(), s: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 1, 0) };
function carOnSand(dt) {
  sandStep++;
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i];
    if (!w.on || w.load < 0.3) { w.had = false; continue; }
    const lf = Math.min(1.6, w.load / 5.5), c = w.c;
    if (!w.had || Math.hypot(c.x - w.lx, c.z - w.lz) > 0.6) { w.lx = c.x; w.lz = c.z; w.trav = w.trav || 0; }
    const lx = w.lx, lz = w.lz;
    // rolling over it packs it down, more under more weight
    field.press(lx, lz, c.x, c.z, w.half, 0.004 + 0.004 * lf, w.trav);
    w.trav += Math.hypot(c.x - lx, c.z - lz) + Math.abs(w.slip) * dt;
    // spinning (or locked and dragging) scrapes sand out from under the tyre and throws it
    const sl = Math.abs(w.slip);
    if (sl > 0.25) {
      const vol = field.scoop(lx, lz, c.x, c.z, w.half, 0.012 * sl / (1 + sl / 4) * dt * Math.min(1, lf));
      const dir = w.slip > 0 ? -1 : 1;
      sand.fling(i, w, vol, w.f.x * dir, w.f.y * dir, w.f.z * dir, sl);
    }
    // sliding sideways shoves a ridge of sand out the side and sprays some
    const vs = Math.abs(w.vs);
    if (vs > 0.4) {
      const d = Math.sign(w.vs), dz = 0.0016 * vs * dt * lf;
      field.scoop(lx, lz, c.x, c.z, w.half, dz * 0.6, w.s.x * d, w.s.z * d);
      sand.fling(i, w, field.scoop(lx, lz, c.x, c.z, w.half, dz * 0.4), w.s.x * d, w.s.y * d, w.s.z * d, vs * 0.8);
    }
    // landing punches a dent and squirts sand out
    if (w.hit > 1) { sand.burst(w, field.crater(c.x, c.z, Math.min(0.09, w.half + 0.012 * w.hit), Math.min(0.035, w.hit * 0.005)), w.hit); sound.thud(w.hit); landed(c.x, c.y, c.z, w.hit); }
    field.slump(c.x, c.z, 0.11, -w.n.x / w.n.y, -w.n.z / w.n.y);
    w.lx = c.x; w.lz = c.z; w.had = true;
  }
  // the rest of the car moves sand too: belly, nose, roll cage, tyre sidewalls. Whatever touches presses a dent;
  // whatever slides ploughs a groove, shoves a ridge ahead of itself and throws some.
  for (const b of car.contacts) {
    const lf = Math.min(2, b.Fn / 6);
    field.press(b.x, b.z, b.x, b.z, 0.022, Math.min(0.03, 0.003 + 0.004 * lf), 0);
    if (b.hit > 1.2) {
      // the body slamming into sand: a real crater, sized by how hard it hit, with sand thrown out of it
      bodyPart.c.set(b.x, b.y, b.z);
      sand.burst(bodyPart, field.crater(b.x, b.z, Math.min(0.16, 0.04 + 0.02 * b.hit), Math.min(0.07, 0.009 * b.hit)), b.hit);
      sound.thud(b.hit * 0.8); landed(b.x, b.y, b.z, b.hit);
    }
    if (b.sl > 0.3) {
      const dz = 0.003 * b.sl * dt * Math.min(1, lf);
      field.scoop(b.x, b.z, b.x, b.z, 0.022, dz * 0.6, b.sx, b.sz);
      bodyPart.c.set(b.x, b.y, b.z);
      sand.fling(4, bodyPart, field.scoop(b.x, b.z, b.x, b.z, 0.022, dz * 0.4), b.sx, 0, b.sz, b.sl * 0.6);
    }
    if ((sandStep & 3) === 0) { terrain.sample(b.x, b.z, gs); field.slump(b.x, b.z, 0.09, -gs.nx / gs.ny, -gs.nz / gs.ny); }
  }
}

// ---- where things start ----
function findRegion(fn, idx, x0, z0) {
  for (let r = 300; r < 20000; r += 300) for (let a = 0; a < 16; a++) {
    const x = x0 + Math.cos(a * 0.3927 + r) * r, z = z0 + Math.sin(a * 0.3927 + r) * r;
    if (fn(x, z)[idx] > 0.97) return [x, z];
  }
  return [x0, z0];
}
// Where you were (and which car you were in) is kept in the browser, so a reload puts you back there.
let saved = null;
try { saved = JSON.parse(localStorage.getItem('dunerc.pos') || 'null'); } catch (e) { /* nothing saved */ }
if (saved && !(isFinite(saved.x) && isFinite(saved.z) && isFinite(saved.yaw))) saved = null;
function savePos(now) {
  if (!now && car.U.y < 0.3) return;
  try { localStorage.setItem('dunerc.pos', JSON.stringify({ x: +car.pos.x.toFixed(2), z: +car.pos.z.toFixed(2), yaw: +Math.atan2(-car.F.x, -car.F.z).toFixed(3), car: SPECS[carIdx].id })); } catch (e) { /* cannot save here */ }
}
// the very first time: start among the giant dunes
const [sx, sz] = saved ? [saved.x, saved.z] : findRegion(duneWeights, 0, 0, 0);
function spawn(x, z) {
  const yaw = saved ? saved.yaw : 0.4;
  car.place(x, z, yaw);
  camPos.set(x + Math.sin(yaw) * 1.8, car.pos.y + 0.6, z + Math.cos(yaw) * 1.8); camYaw = yaw;
}

// ---- input ----
const keys = {};
const CAMS = ['chase behind', 'low close chase', 'onboard'];
let mode = 'drive', camMode = 0, showHelp = false, showCredit = false;
addEventListener('keydown', e => {
  const first = !e.repeat; keys[e.code] = true; sound.start();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!first) return;
  if (play && play.key(e.code)) return;
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyL') { lightMode = lightMode === 'auto' ? 'on' : lightMode === 'on' ? 'off' : 'auto'; toast('Headlights: ' + (lightMode === 'auto' ? 'automatic (on when dark)' : lightMode), 2.5); }
  // R: pick the car up and set it back on its wheels where it lies (the jump in progress does not count)
  if (e.code === 'KeyR') { stunts.reset(); car.place(car.pos.x, car.pos.z, Math.atan2(-car.F.x, -car.F.z)); }
  if (e.code === 'KeyG') switchCar();
  if (e.code === 'KeyM') { sound.toggleMute(); toast(sound.muted ? 'Sound off' : 'Sound on', 2); }
  if (e.code === 'KeyH') { showHelp = !showHelp; $('help').style.display = showHelp ? 'grid' : 'none'; }
  if (e.code === 'KeyK') { showCredit = !showCredit; $('credit').style.display = showCredit ? 'block' : 'none'; }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function driveInput() {
  if (mode === 'fly') return { thr: 0, steer: 0, hb: false };
  const inp = {
    thr: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    steer: (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
    hb: !!keys.Space,
  };
  return play ? play.gate(inp) : inp;
}
let toastText = '', toastT = 0;
function toast(s, secs = 3) { toastText = s; toastT = secs; }

// ---- cameras ----
const fly = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 6 };
let dragging = false;
canvas.addEventListener('mousedown', () => { dragging = true; sound.start(); });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (mode !== 'fly' || !dragging) return;
  fly.yaw -= e.movementX * 0.004;
  fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch - e.movementY * 0.004));
});
addEventListener('wheel', e => { fly.speed = Math.max(0.5, Math.min(60, fly.speed * (e.deltaY < 0 ? 1.25 : 0.8))); });
function moveFly(dt) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const u = (keys.KeyE || keys.Space ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  const v = fly.speed * (keys.ShiftLeft || keys.ShiftRight ? 10 : 1) * dt;
  const sy = Math.sin(fly.yaw), cy = Math.cos(fly.yaw), cp = Math.cos(fly.pitch), sp = Math.sin(fly.pitch);
  fly.x += (-sy * cp * f + cy * s) * v; fly.z += (-cy * cp * f - sy * s) * v; fly.y += (sp * f + u) * v;
  fly.y = Math.max(fly.y, height(fly.x, fly.z) + 0.12);
  camera.position.set(fly.x, fly.y, fly.z); camera.rotation.set(fly.pitch, fly.yaw, 0);
  camera.fov = 70; camera.updateProjectionMatrix();
}
const camPos = new THREE.Vector3(); let camYaw = 0, camFov = 70;
const tmp = new THREE.Vector3(), look = new THREE.Vector3(), gs = { h: 0, nx: 0, ny: 1, nz: 0 }, tmp2 = new THREE.Vector2();
function chase(dt) {
  const hv = Math.hypot(car.vel.x, car.vel.z);
  if (camMode === 2) {
    // onboard: a little camera bolted to the roll cage. It sees exactly what the car does, tumbles included.
    const S = car.spec;
    camera.position.copy(car.pos).addScaledVector(car.U, S.top + 0.035).addScaledVector(car.F, -S.nose * 0.15);
    look.copy(camera.position).add(car.F); camera.up.copy(car.U); camera.lookAt(look); camera.up.set(0, 1, 0);
    terrain.sample(camera.position.x, camera.position.z, gs);
    if (camera.position.y < gs.h + field.height(camera.position.x, camera.position.z) + 0.04) camera.position.y = gs.h + field.height(camera.position.x, camera.position.z) + 0.04;   // the lens never goes under the sand
    camPos.copy(camera.position); camYaw = Math.atan2(-car.F.x, -car.F.z);
    camFov += (100 - camFov) * Math.min(1, dt * 3);
  } else {
    // aim along where the car is going, or where it points when slow
    const low = camMode === 1;
    const k = Math.min(1, hv / 4) * (car.vel.dot(car.F) > -1 ? 1 : 0);
    const dx = car.vel.x / (hv + 1e-6) * k * 0.65 + car.F.x * (1 - k * 0.65), dz = car.vel.z / (hv + 1e-6) * k * 0.65 + car.F.z * (1 - k * 0.65);
    let d = Math.atan2(-dx, -dz) - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    camYaw += d * Math.min(1, dt * (car.grounded ? 5 : 2));
    const dist = (low ? 0.75 : 1.45) + hv * (low ? 0.012 : 0.02), up = low ? 0.13 : 0.5;
    tmp.set(car.pos.x + Math.sin(camYaw) * dist, car.pos.y + up, car.pos.z + Math.cos(camYaw) * dist);
    camPos.lerp(tmp, Math.min(1, dt * 12));
    terrain.sample(camPos.x, camPos.z, gs);
    if (camPos.y < gs.h + 0.06) camPos.y = gs.h + 0.06;
    camera.position.copy(camPos);
    look.set(car.pos.x - Math.sin(camYaw) * 0.6, car.pos.y + (low ? 0.08 : 0.12), car.pos.z - Math.cos(camYaw) * 0.6);
    camera.lookAt(look);
    camFov += ((low ? 82 : 68) + Math.min(22, hv * 0.5) - camFov) * Math.min(1, dt * 3);
  }
  // The camera is a real one: it shakes with speed over rough sand, takes a knock when the car lands hard,
  // and (following behind) leans a little with the car, so the horizon tilts.
  camT += dt; jolt *= Math.exp(-dt * 7);
  const amp = Math.min(0.011, hv * 0.00042) * (car.grounded ? 1 : 0.25) + jolt;
  const n1 = Math.sin(camT * 31.7) * 0.6 + Math.sin(camT * 53.1 + 1.3) * 0.4, n2 = Math.sin(camT * 27.3 + 2.1) * 0.6 + Math.sin(camT * 61.7) * 0.4;
  if (camMode !== 2) {
    const want = Math.sin(Math.atan2(car.R.y, car.U.y)) * 0.28 * (car.U.y > 0 ? 1 : 0);
    camRoll += (want - camRoll) * Math.min(1, dt * 4);
    camera.rotateZ(camRoll + n1 * amp * 0.6); camera.rotateX(n2 * amp);
  } else { camera.rotateZ(n1 * amp * 0.5); camera.rotateX(n2 * amp * 0.8); }
  post.uniforms.uBlur.value = Math.max(0, Math.min(1, (hv - 7) / 20));
  camera.fov = camFov; camera.updateProjectionMatrix();
}
let camT = 0, jolt = 0, camRoll = 0;

// a hard landing: the camera is knocked, a cloud of dust rolls out, the car rattles, and it gets dirtier
function landed(x, y, z, hard) {
  jolt = Math.min(0.045, Math.max(jolt, hard * 0.006));
  const n = Math.min(7, Math.floor(hard * 1.2));
  for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, sp = 0.4 + hard * 0.16; sand.add(1, x, y + 0.03, z, Math.cos(a) * sp, 0.2 + Math.random() * 0.35, Math.sin(a) * sp, 0.3 + 0.3 * Math.random(), 1.4 + Math.random()); }
  if (hard > 2.2) sound.rattle(hard);
  dirt = Math.min(1, dirt + 0.006 * hard);
}

// ---- the car gets dusty: the further you drive and the more you roll it, the more sand sticks to it (wheels first) ----
let dirt = 0, dirtT = 0, dirtDone = -1;
const SAND_TINT = new THREE.Color(0.60, 0.44, 0.26);
function applyDirt() {
  const pivots = model.wheels.map(w => w.pivot);
  model.grp.traverse(o => {
    const m = o.material; if (!o.isMesh || !m || !m.color || m === LAMP) return;
    if (!m.userData.c0) { m.userData.c0 = m.color.clone(); m.userData.r0 = m.roughness === undefined ? 0.6 : m.roughness; }
    let wheel = false; for (let p = o; p; p = p.parent) if (pivots.includes(p)) wheel = true;
    const d = Math.min(1, dirt * (wheel ? 2.2 : 1));
    m.color.copy(m.userData.c0).lerp(SAND_TINT, 0.62 * d);
    if (m.roughness !== undefined) m.roughness = m.userData.r0 + (1 - m.userData.r0) * 0.8 * d;
  });
}

// ---- sand that moves on its own: streamers blowing off sharp crests, and loose sand sliding where you cross a slip face ----
function ambientSand(dt) {
  const ws = weather.speed;
  if (ws > 1.2) {
    const wx = weather.wind.x / ws, wz = weather.wind.z / ws;
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * 6.283, d = 3 + Math.random() * 30, x = car.pos.x + Math.cos(a) * d, z = car.pos.z + Math.sin(a) * d;
      // a crest: higher than the sand a step upwind and a step downwind of it
      const h = height(x, z), crest = h - 0.5 * (height(x - wx, z - wz) + height(x + wx, z + wz));
      if (crest < 0.06 || Math.random() > Math.min(1, ws / 7)) continue;
      for (let n = 0; n < 3; n++) sand.add(1, x + (Math.random() - 0.5) * 0.8, h + 0.02 + Math.random() * 0.05, z + (Math.random() - 0.5) * 0.8,
        wx * ws * (0.5 + 0.4 * Math.random()), 0.1 + Math.random() * 0.3, wz * ws * (0.5 + 0.4 * Math.random()), 0.22 + 0.3 * Math.random(), 1.0 + Math.random());
    }
  }
  slideT -= dt;
  for (const w of car.wheels) {
    if (!w.on || w.n.y > 0.9) continue;
    // on a face steeper than about 26 degrees the sand lets go under the tyre and runs downhill
    const l = Math.hypot(w.n.x, w.n.z) || 1, dx = w.n.x / l, dz = w.n.z / l;
    if (slideT <= 0) field.zones.push({ x: w.c.x + dx * 0.15, z: w.c.z + dz * 0.15, r: 0.3, ttl: 1.2 });
    if (Math.random() < dt * 40) sand.add(0, w.c.x + (Math.random() - 0.5) * 0.08, w.c.y + 0.01, w.c.z + (Math.random() - 0.5) * 0.08, dx * (0.5 + Math.random()), 0.05, dz * (0.5 + Math.random()), 0.0024, 3);
  }
  if (slideT <= 0) slideT = 0.25;
}
let slideT = 0;

// ---- the body moves on its springs: it squats under power, dives on the brakes and leans out of a corner ----
const pvel = new THREE.Vector3(), acc3 = new THREE.Vector3(), qLean = new THREE.Quaternion(), qLeanInv = new THREE.Quaternion(), eLean = new THREE.Euler(), YAX = new THREE.Vector3(0, 1, 0);
let leanRoll = 0, leanPitch = 0;
function bodyLean(dt) {
  acc3.subVectors(car.vel, pvel).multiplyScalar(1 / Math.max(dt, 1e-3)); pvel.copy(car.vel);
  const ok = car.grounded >= 2 && car.U.y > 0.5;
  const wantR = ok ? Math.max(-0.075, Math.min(0.075, acc3.dot(car.R) * 0.0065)) : 0, wantP = ok ? Math.max(-0.06, Math.min(0.06, acc3.dot(car.F) * 0.0065)) : 0;
  leanRoll += (wantR - leanRoll) * Math.min(1, dt * 7); leanPitch += (wantP - leanPitch) * Math.min(1, dt * 7);
}

// ---- time of day: real clock, with a test offset ----
let timeOffset = 0;   // minutes
function gameDate() { return new Date(Date.now() + timeOffset * 60000); }
function applySky() {
  const s = updateSky(gameDate());
  terrain.setLight(U.uLightDir.value);
  sun.position.copy(U.uLightDir.value);
  sun.color.copy(U.uLightCol.value); sun.intensity = Math.PI * (1 - 0.7 * weather.storm);
  hemi.color.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.5).multiplyScalar(0.6);
  hemi.groundColor.copy(U.uLightCol.value).multiplyScalar(0.06 * Math.max(U.uLightDir.value.y, 0));
  hemi.intensity = Math.PI;
  if (weather.storm > 0.01) U.uLightCol.value.multiplyScalar(1 - 0.7 * weather.storm);      // the storm dims the sun
  post.uniforms.uExposure.value = 0.52 + 1.5 * U.uNight.value;
  return s;
}

function syncModel() {
  qLean.setFromEuler(eLean.set(leanPitch, 0, leanRoll)); qLeanInv.copy(qLean).invert();
  model.grp.position.copy(car.pos); model.grp.quaternion.copy(car.q).multiply(qLean);
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i], m = model.wheels[i];
    w.vlen = w.vlen === undefined ? w.len : w.vlen + (w.len - w.vlen) * 0.35;
    m.pivot.position.set(w.x, w.ay - w.vlen, w.z).applyQuaternion(qLeanInv);
    m.pivot.quaternion.setFromAxisAngle(YAX, w.front ? -car.steer * car.spec.lock : 0).premultiply(qLeanInv);
    m.spin.rotation.x = -w.spin;
  }
  updateSuspension(model, car);
}

function afterCamera() {
  const c = camera.position;
  sky.position.copy(c);
  U.uCamFrac.value.set(((c.x % 64) + 64) % 64, ((c.z % 64) + 64) % 64);
  U.uCamFine.value.set(c.x - Math.floor(c.x), c.z - Math.floor(c.z));
  U.uFieldOff.value.set(((c.x % 32) + 32) % 32, ((c.z % 32) + 32) % 32);
  U.uCarRel.value.subVectors(car.pos, c);
  U.uCarR.value.copy(car.R); U.uCarU.value.copy(car.U); U.uCarF.value.copy(car.F);
  // what casts the car's shadow: its four wheels and the sixteen biggest balls of its body shape
  {
    const B = litter.cols[0].balls, A = U.uShBall.value, key = fitKey + ':' + B.length;
    if (shKey !== key) { shKey = key; shPick = B.map((b, i) => i).filter(i => B[i].wheel < 0).sort((p, q) => B[q].r - B[p].r).slice(0, 16); }
    let k = 0;
    for (const w of car.wheels) { tmp.set(w.x, w.ay - (w.vlen === undefined ? w.len : w.vlen), w.z).applyQuaternion(car.q).add(car.pos); A[k++].set(tmp.x - c.x, tmp.y - c.y, tmp.z - c.z, w.r * 0.92); }
    for (const i of shPick) { const b = B[i]; A[k++].set(b.c.x - c.x, b.c.y - c.y, b.c.z - c.z, b.r); }
    for (; k < 20; k++) A[k].w = 0;
  }
  // headlights: lamps on the nose, aimed a little down the road
  const on = lightMode === 'on' || (lightMode === 'auto' && U.uNight.value > 0.2), live = on && car.battery > 0;
  car.lights = on; LAMP.emissiveIntensity = live ? 3 : 0; U.uHead.value = live ? (car.lightPower || 1) : 0;
  tmp.copy(car.pos).addScaledVector(car.F, -car.spec.nose).addScaledVector(car.U, 0.022);
  U.uHeadRel.value.subVectors(tmp, c); U.uHeadDir.value.copy(car.F).addScaledVector(car.U, -0.12).normalize();
  headlamp.position.copy(tmp); headlamp.target.position.copy(tmp).add(U.uHeadDir.value); headlamp.intensity = live ? 2.5 : 0;
  // clouds drift with the wind (faster up high) and thicken and thin over the minutes
  U.uCloudOff.value.set((((c.x / 700 + cloudDrift.x) % 256) + 256) % 256, (((c.z / 700 + cloudDrift.y) % 256) + 256) % 256);
  U.uCloud.value = Math.min(1, 0.45 + 0.35 * Math.sin(weather.t / 170 + 1) + 0.8 * weather.storm);
}

// ---- one physics step for everything (240 times a second) ----
const H = 1 / 240, wimp = new THREE.Vector3(), sc = [0, 0, 0];
function tick(inp) {
  car.step(H, inp);
  // sandbox: the pack never runs down
  car.battery = car.capacity;
  // wind on the car: nothing you would notice on a calm day, a real shove in a storm
  { wimp.copy(weather.wind).sub(car.vel); wimp.y = 0; wimp.multiplyScalar(0.02 * wimp.length() * H); car.applyImpulse(wimp, car.pos); }
  carOnSand(H);
  litter.step(H, car);
  plants.step(H, car, litter);
  stunts.step(car, H);
}
const slopeAt = (x, z) => { terrain.sample(x, z, gs); return gs; };
let stormOn = false, stormBig = false;
addEventListener('beforeunload', () => { if (ready) savePos(true); });
// ---- once per drawn frame ----
let fitT = 0, saveT = 0, ready = false;
function perFrame(dt) {
  if (ready && (saveT -= dt) < 0) { saveT = 1; savePos(); }
  if ((fitT -= dt) < 0) { fitT = 0.5; fitCar(); }
  // sandbox: the desert is empty. No litter, no stones, no plants, no animals: only sand.
  plants.update(dt, weather);
  cloudDrift.x += weather.wind.x * 2.5 * dt / 700; cloudDrift.y += weather.wind.z * 2.5 * dt / 700;
  litter.draw(car);
  for (const [what, kind, hard] of litter.events) { if (what === 'knock') sound.knock(kind, hard); else if (what === 'find' || what === 'battery') sound.chime(true); else sound.knock('pbottle', 0.5); }
  litter.events.length = 0;
  if (stunts.event) { sound.chime(stunts.event === 'score'); stunts.event = null; }
  if (play && base) play.frame(dt);
  litter.persist(dt);
  // storms: a warning as one builds, and when it has blown over there is new litter within reach of camp
  if (weather.storm > 0.15 && !stormOn) { stormOn = true; toast('A sandstorm is rolling in.', 5); }
  if (weather.storm > 0.6) stormBig = true;
  if (stormOn && weather.storm < 0.1) { stormOn = false; if (stormBig && base) { stormBig = false; const n = litter.stormDrop(base.x, base.z, 14 + Math.floor(Math.random() * 8)); if (n) toast('The storm has passed. It uncovered ' + n + ' new pieces of litter around camp.', 7); } }
  const px = renderer.getDrawingBufferSize(tmp2).y / (2 * Math.tan(camera.fov * Math.PI / 360));
  weather.update(dt, camera.position, px);
  weather.fill(field, dt);
  for (const t of terrain.tiles.values()) if (t.k === 0) t.mesh.material = Math.abs(car.pos.x - t.ox - 16) < 32 && Math.abs(car.pos.z - t.oz - 16) < 32 ? sandNear : sandFar;
  sandColor(car.pos.x, car.pos.z, sc, 0); sand.color.setRGB(sc[0] * 1.08, sc[1] * 1.08, sc[2] * 1.08); weather.col.copy(sand.color);
  field.settle(dt, slopeAt);
  sand.update(dt, px, car, weather.wind);
  field.flush();
  ambientSand(dt); bodyLean(dt);
  // dust on the car: from driving, more from sliding and rolling
  { const hv = car.vel.length(); dirt = Math.min(1, dirt + dt * (car.grounded ? 0.0011 * hv : 0) + dt * 0.03 * Math.min(3, car.bodyHits)); }
  if ((dirtT -= dt) < 0 || dirtDone !== carIdx) { dirtT = 1; dirtDone = carIdx; applyDirt(); }
  post.uniforms.uTime.value = weather.t % 1000; post.uniforms.uHeat.value = U.uHeat.value * (1 - weather.storm);
  sound.update(car, weather, dt);
  toastT -= dt;
}

let acc = 0, last = performance.now(), hudT = 0, fps = 60;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  // (no keys to change the time, call storms, fly the camera or jump across the map: those were testing tools, and cheats in a real game)
  const inp = driveInput();
  field.recenter(car.pos.x, car.pos.z);
  acc = Math.min(acc + dt, 0.05);
  while (acc >= H) { tick(inp); acc -= H; }
  syncModel();
  if (mode === 'fly') moveFly(dt); else chase(dt);
  perFrame(dt);
  applySky(); afterCamera();
  terrain.update(car.pos.x, car.pos.z, 6);
  post.render(scene);

  requestAnimationFrame(frame);
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
function hud() {
  // sandbox: nothing is drawn over the picture
  if (!play) return;
  const d = gameDate(), dw = duneWeights(car.pos.x, car.pos.z);
  const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('kmh').textContent = Math.round(car.vel.length() * 3.6);
  $('carname').textContent = car.spec.name;
  $('camname').textContent = mode === 'fly' ? 'free fly' : CAMS[camMode];
  const pct = car.battery / car.capacity;
  $('batfill').style.width = Math.round(pct * 100) + '%';
  $('batfill').style.background = pct > 0.3 ? '#7fd66b' : pct > 0.15 ? '#e6b566' : '#e2553d';
  $('bat').textContent = Math.round(pct * 100) + '%  ·  ' + Math.round(car.power) + ' W' + (pct <= 0 ? '  ·  flat' : pct < 0.15 ? '  ·  low' : '');
  const gameMsg = play && base ? play.hud() : ''; if (play && base) play.map();
  $('score').textContent = stunts.total + (stunts.best ? '  (best jump ' + stunts.best + ')' : '');
  $('found').textContent = litter.found.size + ' of ' + FINDS.length;
  $('time').textContent = hh + (Math.round(timeOffset) ? ' test' : '') + (weather.storm > 0.3 ? ' · sandstorm' : ' · wind ' + weather.speed.toFixed(0) + ' m/s');
  $('region').textContent = DUNE_NAMES[dw.indexOf(Math.max(...dw))];
  $('air').textContent = stunts.show > 0 ? stunts.text : '';
  $('notice').textContent = toastT > 0 ? toastText : gameMsg || litter.toast || litter.notice;
  $('fps').textContent = Math.round(fps) + ' fps';
}

function fit() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  post.resize();
}
addEventListener('resize', fit);
new ResizeObserver(fit).observe(document.documentElement);

// hooks for automated checks
window.DUNE = {
  car, terrain, post, U, height, keys, spawn, field, sand, litter, critters, weather, stunts, sound, switchCar, SPECS, plants, useCar,
  get play() { return play; },
  set lights(v) { lightMode = v; },
  get base() { return base; }, get fps() { return fps; },
  set cam(v) { camMode = v; },
  setTime(h) { const d = new Date(); timeOffset = (h - d.getHours() - d.getMinutes() / 60) * 60; },
  // advance the game by `secs` with fixed inputs, then draw one frame
  run(secs, inp = { thr: 0, steer: 0, hb: false }) {
    let minUp = 1, air = 0;
    for (let i = 0; i < secs * 60; i++) {
      field.recenter(car.pos.x, car.pos.z);
      for (let k = 0; k < 4; k++) { tick(inp); if (car.U.y < minUp) minUp = car.U.y; if (!car.grounded) air += H; }
      syncModel(); chase(1 / 60); perFrame(1 / 60); terrain.update(car.pos.x, car.pos.z, 50);
    }
    applySky(); afterCamera(); const missing = terrain.update(car.pos.x, car.pos.z, 300); post.render(scene); hud();
    return { kmh: Math.round(car.vel.length() * 3.6), up: +car.U.y.toFixed(2), minUp: +minUp.toFixed(2), air: +air.toFixed(2), grounded: car.grounded, y: +car.pos.y.toFixed(2), bat: +(100 * car.battery / car.capacity).toFixed(1), missing };
  },
};

// build the first set of tiles with a progress bar, then start
(async () => {
  spawn(sx, sz);
  applySky(); camera.position.copy(camPos); afterCamera();
  const total = terrain.wanted(sx, sz).keys.length;
  const dropped = Promise.all([litter.loadModels(GLTFLoader), loadCritterModels()]);
  for (;;) {
    const missing = terrain.update(sx, sz, 14);
    $('bar').style.width = Math.round(100 * (1 - missing / total)) + '%';
    if (!missing) break;
    await new Promise(r => setTimeout(r, 0));
  }
  terrain.update(sx, sz, 1);
  await dropped;
  spawn(sx, sz);                                    // now sit on the drawn surface
  useCar(saved && SPECS.some(s => s.id === saved.car) ? saved.car : 'buggy');
  ready = true;
  $('loading').style.display = 'none';
  last = performance.now();
  requestAnimationFrame(frame);
})();
