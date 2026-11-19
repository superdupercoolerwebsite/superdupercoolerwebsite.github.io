import * as THREE from 'three';
import { buildTrack, DS } from './track.js';
import { Car, SPEC } from './car.js';
import { buildWorld, COND } from './world.js';
import { leafUniforms } from './trees.js';
import { buildCarModel, loadAssets, EYE } from './carmodel.js';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { autopilot } from './autopilot.js';
import { S, onChange, setSetting, gfx, applyCar } from './settings.js';
import { STAGES, custom } from './stages.js';
import { createAudio } from './audio.js';
import { initUI, fmtTime } from './ui.js';

const params = new URLSearchParams(location.search);
const AUTO = params.get('auto') === '1';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- renderer ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, 1, 0.03, 2500);
const pmrem = new THREE.PMREMGenerator(renderer);
let G = gfx(), composer = null, bloom = null, grade = null, dynScale = 1, envRT = null;

function buildComposer() {
  if (composer) composer.dispose();
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: G.samples }));
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.3, 0.6, 1.0); bloom.enabled = G.bloom; composer.addPass(bloom);
  grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, enh: { value: S.enhance ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, enh; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126,0.7152,0.0722));
        c = mix(vec3(l), c, mix(0.9, 1.14, enh));                                              // richer colour
        c = pow(max(c, 0.0), vec3(1.0 + 0.07 * enh));                                          // deeper contrast
        c = mix(c * vec3(0.94,0.97,1.08), c * vec3(1.05,1.0,0.94), smoothstep(0.0,0.6,l));     // cool shadows, warm highlights
        vec2 q = vUv - 0.5; c *= 1.0 - 0.3 * smoothstep(0.3, 1.0, length(q * vec2(1.0, 1.15)));
        c += (h(vUv * 913.0) - 0.5) * 0.028 * (0.25 + l);
        gl_FragColor = vec4(max(c, 0.0), 1.0); }`,
  });
  composer.addPass(grade); composer.addPass(new OutputPass());
  resize();
}
function resize() {
  const pr = Math.min(window.devicePixelRatio, 2) * G.res * (S.fullRes ? 1 : dynScale);
  renderer.setPixelRatio(pr); renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(pr); composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  $('res').textContent = Math.round(G.res * (S.fullRes ? 1 : dynScale) * 100) + '%';
}
window.addEventListener('resize', resize);
buildComposer();

// ---------- world / car ----------
let T = null, world = null, car = null, stage = null, condKey = 'dusk', cond = COND.dusk;
$('loading').style.display = 'flex'; $('loadTxt').textContent = 'Loading car';
await loadAssets();
const model = buildCarModel(); scene.add(model.group);
const audio = createAudio();

function loadStage(st, ck) {
  if (world) world.dispose();
  stage = st; condKey = COND[ck] ? ck : 'dusk'; cond = COND[condKey]; G = gfx();
  T = buildTrack(st.seed, st);
  world = buildWorld(scene, T, cond, G);
  renderer.toneMappingExposure = cond.exposure; renderer.setClearColor(world.fog);
  // reflections and soft fill come from the stage's own sky
  const tmp = new THREE.Scene(), par = world.sky.parent; world.sky.position.set(0, 0, 0); tmp.add(world.sky);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(tmp, 0, 1, 3000); par.add(world.sky);
  scene.environment = envRT.texture; scene.environmentIntensity = cond.env;
  car = new Car({ h: (x, z, hint) => T.ground(x, z, hint), T }); car.trees = world.trees; applyCar(car);
  model.setLight(cond); builtGfx = JSON.stringify(G);
  placeAt(T.startI); menuI = T.startI + 20;
}

// ---------- input ----------
const keys = {};
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT/.test(e.target.tagName)) { if (e.code === 'Escape') e.target.blur(); else return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true; audio.init();
  if (e.code === 'Escape') {
    if (state === 'menu') ui.back();
    else if (ui.inSettingsFromPause) ui.back();
    else if (state === 'run' || state === 'countdown') setPaused(!paused);
  }
  if (e.code === 'KeyM') { setSetting('sound', !S.sound); flash(S.sound ? 'Sound on' : 'Sound off'); }
  if (paused || state === 'menu') return;
  if (e.code === 'KeyR') resetCar(true);
  if (e.code === 'KeyX') shiftReq = 1;
  if (e.code === 'KeyZ') shiftReq = -1;
  if (e.code === 'Enter' && state === 'finish') startRun();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
window.addEventListener('pointerdown', () => audio.init());

let padPrev = {}, shiftReq = 0;
function readInput() {
  const k = (a, b) => (keys[a] || keys[b] ? 1 : 0);
  const inp = { steer: k('KeyA', 'ArrowLeft') - k('KeyD', 'ArrowRight'), throttle: k('KeyW', 'ArrowUp'), brake: k('KeyS', 'ArrowDown'), hand: keys.Space ? 1 : 0, analog: false,
    look: (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0), beams: !!keys.KeyF };
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0), dz = (v) => (Math.abs(v) > 0.08 ? v : 0);
    const ax = dz(p.axes[0]) || (b(14) ? -1 : b(15) ? 1 : 0), rx = dz(p.axes[2] || 0);
    if (ax || b(7) > 0.03 || b(6) > 0.03 || b(0) || b(5) || rx) {
      inp.steer = -Math.sign(ax) * Math.pow(Math.abs(ax), 1.6 / S.steerSens); inp.analog = true;
      inp.throttle = Math.max(inp.throttle, b(7)); inp.brake = Math.max(inp.brake, b(6));
      if (b(0) || b(5)) inp.hand = 1;
      if (rx) inp.look = -rx;
    }
    if (b(4)) inp.beams = true;
    if (b(1) && !padPrev[1]) shiftReq = 1;
    if (b(2) && !padPrev[2]) shiftReq = -1;
    if (b(8) && !padPrev[8] && state === 'run' && !paused) resetCar(true);
    if (b(9) && !padPrev[9] && (state === 'run' || state === 'countdown')) setPaused(!paused);
    padPrev = { 1: b(1), 2: b(2), 8: b(8), 9: b(9) };
    break;
  }
  inp.shift = shiftReq; shiftReq = 0;
  return inp;
}

// ---------- game state ----------
let builtGfx = '';
let state = 'menu', paused = false, clock = 0, stageTime = 0, penalty = 0, trackI = 0, nextNote = 0, noteShow = 0, flashT = 0, menuI = 0, lit = -1, noteText = '';
const bestKey = (id, ck) => 'bf.best.' + id;
const bestOf = (id) => parseFloat(localStorage.getItem(bestKey(id)) || '0');
function placeAt(i) { car.place(T.px[i], T.py[i] + 0.55, T.pz[i], Math.atan2(T.tx[i], T.tz[i])); trackI = i; prevVel.set(0, 0, 0); accS.set(0, 0, 0); headOff.set(0, 0, 0); }
function setHud(on) { $('hud').style.display = on ? 'block' : 'none'; }
function startRun() {
  state = 'countdown'; paused = false; clock = 0; stageTime = 0; penalty = 0; nextNote = 0; lit = -1; car.damage = 0; applyCar(car);
  for (const n of T.notes) n.called = false;
  placeAt(T.startI); camQ.copy(car.quat); lookYaw = 0;
  model.group.visible = true; setHud(true); ui.show(null); ui.showFinish(null); ui.showPause(false);
  $('lights').style.display = 'flex'; $('lights').className = 'hud';
  $('sub').textContent = 'Get ready'; $('note').style.opacity = 0;
  $('pmap').style.display = S.map ? 'block' : 'none'; $('fpsWrap').style.display = S.showFps ? 'inline' : 'none';
  audio.init();
}
function toMenu(screen) {
  state = 'menu'; paused = false; model.group.visible = false; setHud(false); ui.showFinish(null); ui.showPause(false); ui.show(screen);
  if (window.speechSynthesis) speechSynthesis.cancel();
}
function setPaused(p) { paused = p; ui.showPause(p); if (p && window.speechSynthesis) speechSynthesis.cancel(); }
function resetCar(pen) {
  if (state === 'finish' || state === 'menu') return;
  T.nearest(car.pos.x, car.pos.z, trackI);
  placeAt(Math.max(T.startI, T.qi - 3));
  if (pen && state === 'run') { penalty += 5; flash('Reset +5 s'); }
}
function flash(t) { $('msg').textContent = t; $('msg').style.opacity = 1; flashT = 1.6; }
function say(text) {
  if (!S.spoken || !S.sound || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.55; u.pitch = 0.9; u.volume = clamp(S.master, 0, 1);
  if (speechSynthesis.speaking && speechSynthesis.pending) speechSynthesis.cancel();   // never fall more than one call behind
  speechSynthesis.speak(u);
}
function withLoading(fn) { ui.setLoading(true); setTimeout(() => { fn(); ui.setLoading(false); }, 30); }

const ui = initUI({
  track: (st) => buildTrack(st.seed, st),
  best: bestOf,
  preview: (st, ck) => { if (st !== stage || ck !== condKey) withLoading(() => loadStage(st, ck)); },
  start: (st, ck) => { if (st !== stage || ck !== condKey || gfxChanged()) withLoading(() => { loadStage(st, ck); startRun(); }); else startRun(); },
  resume: () => setPaused(false),
  restart: () => startRun(),
  quit: (screen) => toMenu(screen),
});
const gfxChanged = () => JSON.stringify(gfx()) !== builtGfx;

onChange((k) => {
  if (['quality', 'optAA', 'optGlow', 'optRes'].includes(k)) { G = gfx(); buildComposer(); }
  if (k === 'enhance') grade.uniforms.enh.value = S.enhance ? 1 : 0;
  if (k === 'fullRes' || k === 'autoQuality') { if (!S.autoQuality) dynScale = 1; resize(); }
  if (['sound', 'master', 'engine'].includes(k)) audio.setVolumes(S.sound, S.master, S.engine);
  if (k === 'map') $('pmap').style.display = S.map && state !== 'menu' ? 'block' : 'none';
  if (k === 'showFps') $('fpsWrap').style.display = S.showFps ? 'inline' : 'none';
  if (car) applyCar(car);
});
audio.setVolumes(S.sound, S.master, S.engine);

// ---------- camera: the driver's head ----------
const camQ = new THREE.Quaternion(), lookQ = new THREE.Quaternion(), pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.16), rollQ = new THREE.Quaternion(), qInv = new THREE.Quaternion();
const YAX = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1), bob = new THREE.Vector3(), prevVel = new THREE.Vector3(), accS = new THREE.Vector3(), headOff = new THREE.Vector3(), va = new THREE.Vector3(), vb = new THREE.Vector3();
let lookYaw = 0, roll = 0;
function updateCamera(dt, input) {
  // the head lags the car: thrown back under power, forward under brakes, outward in bends
  qInv.copy(car.quat).invert();
  va.copy(car.vel).sub(prevVel).multiplyScalar(1 / Math.max(dt, 1e-3)).applyQuaternion(qInv).clampLength(0, 25); prevVel.copy(car.vel);
  accS.lerp(va, Math.min(1, dt * 5));
  const tz = accS.z > 0 ? -Math.min(0.06, accS.z * 0.0055) * S.pushBack : Math.min(0.07, -accS.z * 0.005) * S.pushFwd;
  headOff.lerp(vb.set(clamp(-accS.x * 0.0035, -0.04, 0.04), clamp(-accS.y * 0.002, -0.025, 0.025), tz), Math.min(1, dt * 7));
  roll += (clamp(accS.x * 0.0035, -0.045, 0.045) - roll) * Math.min(1, dt * 5);
  camQ.slerp(car.quat, Math.min(1, dt * 22));
  let want = 0;
  if (S.lookCorners && car.speed > 3) {
    va.copy(car.vel).applyQuaternion(qInv);
    want = clamp(Math.atan2(va.x, Math.max(1, va.z)) * 0.6 + car.steer * 0.42 + car.angVel.y * 0.08, -0.45, 0.45);
  }
  if (input.look) want = input.look * 1.25;
  lookYaw += (want - lookYaw) * Math.min(1, dt * (input.look || Math.abs(lookYaw) > 0.5 ? 8 : 4));
  lookQ.setFromAxisAngle(YAX, Math.PI + lookYaw); rollQ.setFromAxisAngle(ZAX, roll);
  camera.quaternion.copy(camQ).multiply(lookQ).multiply(pitchQ).multiply(rollQ);
  bob.set(0, 0, 0);
  if (S.shake) { const a = Math.min(1, car.speed / 35) * (0.0022 + 0.007 * car.offroad) + car.impact * 0.012; bob.set(Math.sin(clock * 31) * a, Math.sin(clock * 47 + 1) * a + Math.sin(clock * 19) * a * 0.5, 0); }
  bob.y += S.windscreen * 0.6;                                   // seat height
  camera.position.copy(EYE).add(headOff).add(bob).applyQuaternion(car.quat).add(car.pos);
  setFov(76 + S.fov + (S.speedFov ? Math.min(9, car.speed * 0.22) : 0), dt);
}
function setFov(f, dt) { if (Math.abs(f - camera.fov) > 0.05) { camera.fov += (f - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); } }
function menuCamera(dt) {
  menuI += dt * 2.6; if (menuI > T.finishI - 30) menuI = T.startI + 20;
  const i = Math.floor(menuI), f = menuI - i, j = Math.min(T.n - 1, i + 9);
  const lx = T.tz[i], lz = -T.tx[i];
  camera.position.set(T.px[i] + (T.px[i + 1] - T.px[i]) * f + lx * 0.7, T.py[i] + (T.py[i + 1] - T.py[i]) * f + 1.55, T.pz[i] + (T.pz[i + 1] - T.pz[i]) * f + lz * 0.7);
  va.set(T.px[j], T.py[j] + 1.2, T.pz[j]); camera.lookAt(va); setFov(62, dt);
}

// ---------- loop ----------
const DT = 1 / 240;
let acc = 0, last = performance.now(), fpsT = 0, fpsN = 0, mapT = 0, slowT = 0, fastT = 0;
const lightsEl = [...$('lights').children];

function tick(now) {
  requestAnimationFrame(tick);
  let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1;
  frame(dt);
}
function frame(dt) {
  if (!T) return;
  leafUniforms.uTime.value += dt; leafUniforms.uCar.value.set(0, -999, 0);
  if (state === 'menu') { menuCamera(dt); world.update(camera.position, camera.position); audio.update(dt, car, false); render(dt); return; }
  if (paused) { audio.update(dt, car, false); render(0); return; }
  clock += dt;
  let input = readInput();
  if (AUTO) Object.assign(input, autopilot(car, T, trackI));
  if (state === 'countdown') {
    const n = Math.floor(clock / 0.7);
    if (n !== lit && n >= 1 && n <= 5) { lit = n; audio.beep(520); }
    lightsEl.forEach((e, i) => e.classList.toggle('on', i < n));
    input = { ...input, throttle: 0, brake: 0.45, hand: 1 };
    if (clock > 0.7 * 5 + 0.6) {
      state = 'run'; $('lights').className = 'hud go'; $('sub').textContent = `${stage.name} · ${(T.length / 1000).toFixed(1)} km`; audio.beep(1040, 0.4); say('go');
    }
  }
  if (state === 'finish') input = { ...input, steer: 0, throttle: 0, brake: car.speed > 2 ? 0.6 : 0, hand: 1 };

  acc += dt;
  while (acc >= DT) { car.step(DT, input); acc -= DT; }
  if (state === 'run') { stageTime += dt; if (stageTime > 0.9 && stageTime < 1.2) $('lights').style.display = 'none'; }

  if (T.nearest(car.pos.x, car.pos.z, trackI)) trackI = T.qi;
  if (state === 'run' && trackI >= T.finishI) {
    state = 'finish';
    const total = stageTime + penalty, best = bestOf(stage.id), isBest = !best || total < best;
    if (isBest) localStorage.setItem(bestKey(stage.id), String(total));
    ui.showFinish({ time: total, best, isBest, penalty });
  }
  if (car.pos.y < T.ground(car.pos.x, car.pos.z, trackI) - 6 || !isFinite(car.pos.y)) resetCar(false);
  while (nextNote < T.notes.length && T.notes[nextNote].end < trackI) nextNote++;   // a note stays current until you are out of its corner
  // Calls are tied to where the car is: the note for the corner ahead is read about 4 s before it, and the one
  // after that only once you are inside the current corner and it is close behind.
  const horizon = Math.max(60, car.speed * 4.2);
  if (state !== 'finish') {
    const nt = T.notes[nextNote], nx = T.notes[nextNote + 1];
    if (nt) {
      const dist = (nt.i - trackI) * DS, inside = dist <= 0;
      if (!nt.called && dist < horizon) { nt.called = true; say(T.noteText(nt)); }
      if (nx && !nx.called && inside && (nx.i - trackI) * DS < horizon * 0.8) { nx.called = true; say(T.noteText(nx)); }
      if (dist < horizon) {
        noteText = T.noteText(nt);
        $('noteArrow').textContent = nt.dir > 0 ? '←' : '→'; $('noteTxt').textContent = noteText;
        $('noteDist').textContent = (inside ? 'now' : Math.max(10, Math.round(dist / 10) * 10) + ' m') + (nx && nx.called ? ' · then ' + T.noteText(nx) : '');
        noteShow = 0.5;
      }
    }
  }
  noteShow -= dt; $('note').style.opacity = S.slips && noteShow > 0 ? 1 : 0;
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) $('msg').style.opacity = 0; }

  model.group.position.copy(car.pos); model.group.quaternion.copy(car.quat);
  model.update(car, { T, i: trackI, nextNote, input, note: noteShow > 0 ? noteText : '', time: fmtTime(stageTime + penalty) }, dt);
  model.spot.intensity = cond.head * (input.beams ? 2.4 : 1) + (input.beams ? 500 : 0);

  updateCamera(dt, input);
  leafUniforms.uCar.value.copy(car.pos);
  world.update(camera.position, car.pos);
  audio.update(dt, car, true);

  $('time').textContent = fmtTime(stageTime + penalty);
  $('kmh').textContent = Math.round(car.speed * 3.6);
  $('gear').textContent = car.gear === -1 ? 'R' : car.gear;
  $('rpmBar').style.width = Math.min(100, car.rpm / SPEC.redline * 100) + '%';
  $('rpmBar').style.background = car.rpm > 6500 ? 'var(--bad)' : 'var(--ink)';
  $('dmg').textContent = Math.round(car.damage) + '%';
  const pr = clamp((trackI - T.startI) / (T.finishI - T.startI), 0, 1);
  $('progBar').style.width = pr * 100 + '%';
  $('progLbl').textContent = `${(pr * T.length / 1000).toFixed(2)} / ${(T.length / 1000).toFixed(2)} km`;
  mapT -= dt;
  if (S.map && mapT <= 0) {
    mapT = 0.15; const cv = $('pmap'); ui.drawMap(cv, T, 14);
    const g = cv.getContext('2d'); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = T.startI; i <= T.finishI; i += 3) { x0 = Math.min(x0, T.px[i]); x1 = Math.max(x1, T.px[i]); z0 = Math.min(z0, T.pz[i]); z1 = Math.max(z1, T.pz[i]); }
    const sc = Math.min(162 / (x1 - x0), 162 / (z1 - z0 || 1));
    g.fillStyle = '#ff5030'; g.beginPath(); g.arc(14 + (car.pos.x - x0) * sc + (162 - (x1 - x0) * sc) / 2, 14 + (car.pos.z - z0) * sc + (162 - (z1 - z0) * sc) / 2, 5, 0, 7); g.fill();
  }
  render(dt);
}
function render(dt) {
  if (dt > 0) {
    fpsT += dt; fpsN++;
    if (fpsT > 0.5) {
      const fps = fpsN / fpsT; $('fps').textContent = Math.round(fps) + ' fps'; fpsT = 0; fpsN = 0;
      if (S.autoQuality && !S.fullRes && state !== 'menu') {
        if (fps < S.targetFps * 0.9) { slowT++; fastT = 0; } else { fastT++; slowT = 0; }
        if (slowT >= 3 && dynScale > 0.5) { dynScale = Math.max(0.5, dynScale - 0.1); slowT = 0; resize(); }
        if (fastT >= 8 && dynScale < 1) { dynScale = Math.min(1, dynScale + 0.05); fastT = 0; resize(); }
      }
    }
    grade.uniforms.time.value = (grade.uniforms.time.value + dt) % 10;
  }
  composer.render();
}

// ---------- boot ----------
const startStage = STAGES.find((s) => s.id === params.get('stage')) || (params.get('seed') ? custom(parseInt(params.get('seed'), 10)) : STAGES[0]);
loadStage(startStage, params.get('cond') || localStorage.getItem('bf.cond') || 'dusk');
builtGfx = JSON.stringify(G);
$('loading').style.display = 'none';
if (AUTO || params.get('stage') || params.get('drive')) startRun(); else toMenu('main');
requestAnimationFrame(tick);
window.__game = {
  get car() { return car; }, get T() { return T; }, get world() { return world; }, get state() { return state; }, get trackI() { return trackI; }, get model() { return model; },
  renderer, scene, camera, ui, audio, S, setSetting,
  advance: (sec) => { for (let i = 0; i < sec * 60; i++) frame(1 / 60); },
  start: (id, ck) => { loadStage(STAGES.find((s) => s.id === id) || STAGES[0], ck || 'dusk'); startRun(); },
};
