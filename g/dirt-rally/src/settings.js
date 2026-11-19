// Player settings: schema (drives the settings screen), stored values, change listeners.
const pct = (v) => Math.round(v * 100) + '%';
const lvl = (v) => (v === 0 ? 'Off' : String(v));
const QUALITY = ['Very low', 'Low', 'Medium', 'High', 'Very high', 'Ultra'];

export const SCHEMA = [
  { tab: 'Camera', items: [
    { k: 'pushBack', label: 'Push back when accelerating', hint: 'How far the camera drops back as you speed up. 0% turns it off', min: 0, max: 2, step: 0.05, def: 1, fmt: pct },
    { k: 'pushFwd', label: 'Push forward when braking', hint: 'How far the camera comes forward as you slow down. 0% turns it off', min: 0, max: 2, step: 0.05, def: 1, fmt: pct },
    { k: 'shake', label: 'Camera shake', hint: 'Rumble over rough gravel, bumps off the road, and jolts from landings and impacts', def: true },
    { k: 'fov', label: 'Field of view', hint: 'Wider shows more of the road', min: -15, max: 15, step: 1, def: 0, fmt: (v) => 76 + v + '°' },
    { k: 'speedFov', label: 'Speed widens the view', hint: 'The view opens out as you go faster', def: true },
    { k: 'lookCorners', label: 'Look into corners', hint: 'In the cockpit, your head turns toward where the car is heading', def: true },
    { k: 'windscreen', label: 'Seat height', hint: 'Raises or lowers your eyes in the cockpit', min: -0.14, max: 0.1, step: 0.01, def: 0, fmt: (v) => (Math.abs(v) < 0.005 ? 'Standard' : (v > 0 ? '+' : '') + Math.round(v * 100) + ' cm') },
  ] },
  { tab: 'Controls', items: [
    { k: 'steerSens', label: 'Steering sensitivity', hint: 'Keyboard: how fast the wheel turns. Controller stick: how much it turns for a small push. A full push still reaches full lock', min: 0.5, max: 2, step: 0.05, def: 1, fmt: pct },
  ] },
  { tab: 'Graphics', items: [
    { k: 'autoQuality', label: 'Auto quality', hint: 'Lowers the resolution while you drive when the game falls under the target frame rate, and raises it again when there is time to spare', def: false },
    { k: 'targetFps', label: 'Target frame rate', hint: 'Auto quality only steps in when the game runs under this', min: 20, max: 60, step: 5, def: 60, fmt: (v) => v + ' fps' },
    { k: 'quality', label: 'Graphics quality', hint: 'Shadows, tree detail, grass, glow and edge smoothing. Takes effect on the next stage', min: 0, max: 5, step: 1, def: 3, fmt: (v) => QUALITY[v] },
    { k: 'enhance', label: 'Enhance colors', hint: 'Clearer air, richer colour and deeper contrast. A matter of taste', def: true },
    { k: 'fullRes', label: 'Always full resolution', hint: 'On: always draws at full resolution, even if the frame rate drops', def: false },
    { k: 'showFps', label: 'Show frame rate', hint: 'Frames per second in the corner of the driving screen', def: true },
  ] },
  { tab: 'Optimization', items: [
    { k: 'optRes', label: 'Lower resolution', hint: 'Draws fewer pixels, so the picture is a little softer. Saves about 20%', def: false },
    { k: 'optGrass', label: 'Less grass', hint: 'Grass and ferns not as thick. Saves about 5 to 10%. Takes effect on the next stage', def: false },
    { k: 'optTrees', label: 'Detailed trees closer in', hint: 'Full trees only near the road, with the simpler distant trees taking over sooner. Saves about 10%. Takes effect on the next stage', def: false },
    { k: 'optShadows', label: 'Lighter shadows', hint: 'Shadows drawn at half the detail, so their edges are softer. Saves about 5 to 9%. Takes effect on the next stage', def: false },
    { k: 'optGlow', label: 'No glow', hint: 'No glow round the sun and bright lights. Saves about 3%', def: false },
    { k: 'optAA', label: 'No edge smoothing', hint: 'Edges look more jagged. Saves about 3%', def: false },
  ] },
  { tab: 'Audio', items: [
    { k: 'sound', label: 'Sound', hint: 'M switches it on and off while driving', def: true },
    { k: 'master', label: 'Master volume', hint: '', min: 0, max: 1, step: 0.05, def: 1, fmt: pct },
    { k: 'engine', label: 'Engine volume', hint: 'Your car, relative to everything else', min: 0, max: 1.5, step: 0.05, def: 1, fmt: pct },
  ] },
  { tab: 'Co-driver', items: [
    { k: 'spoken', label: 'Spoken callouts', hint: 'The co-driver reads each note out loud', def: true },
    { k: 'slips', label: 'Callout slips', hint: "Each note also appears as a slip on the driver's screen", def: true },
    { k: 'map', label: 'Practice map', hint: "A route map on the driver's screen", def: false },
  ] },
  { tab: 'Assists', items: [
    { k: 'abs', label: 'Anti-lock brakes', hint: 'Stops the wheels locking under heavy braking. 0 is off, 5 is strongest', min: 0, max: 5, step: 1, def: 2, fmt: lvl },
    { k: 'tcs', label: 'Traction control', hint: 'Cuts power when the wheels spin up. 0 is off. Rally drivers leave it off: wheelspin is how you steer on gravel', min: 0, max: 5, step: 1, def: 0, fmt: lvl },
    { k: 'gearbox', label: 'Transmission', hint: 'Manual sequential: X shifts up, Z shifts down (controller: B / X)', def: 'auto', options: [['auto', 'Automatic'], ['manual', 'Manual sequential']] },
  ] },
  { tab: 'Car setup', items: [
    { k: 'brakeBias', label: 'Brake bias', hint: 'Share of braking on the front wheels. Further back makes the tail step out when you brake into a corner', min: 0.45, max: 0.75, step: 0.01, def: 0.57, fmt: (v) => Math.round(v * 100) + '% front' },
    { k: 'brakeForce', label: 'Braking force', hint: 'Overall brake pressure', min: 0.6, max: 1.3, step: 0.05, def: 1, fmt: pct },
    { k: 'split', label: 'Centre differential', hint: 'Share of engine torque sent to the front wheels. More to the rear makes the car rotate on the throttle; more to the front pulls it straight', min: 0.25, max: 0.7, step: 0.01, def: 0.47, fmt: (v) => Math.round(v * 100) + ' / ' + Math.round((1 - v) * 100) },
    { k: 'diffF', label: 'Front differential lock', hint: 'How strongly the front wheels are tied together. More lock pulls harder out of corners but pushes wide on the way in', min: 0, max: 1, step: 0.05, def: 0.3, fmt: pct },
    { k: 'diffR', label: 'Rear differential lock', hint: 'How strongly the rear wheels are tied together. More lock makes slides easier to hold on the throttle', min: 0, max: 1, step: 0.05, def: 0.45, fmt: pct },
    { k: 'springF', label: 'Front springs', hint: 'Stiffer fronts make the car push; softer fronts give more front grip', min: 0.6, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'springR', label: 'Rear springs', hint: 'Stiffer rears make the tail looser', min: 0.6, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'damp', label: 'Dampers', hint: 'How firmly the suspension is held over bumps and jumps', min: 0.6, max: 1.6, step: 0.05, def: 1, fmt: pct },
    { k: 'arbF', label: 'Front anti-roll bar', hint: 'Stiffer front bar means less roll and more understeer', min: 0, max: 2, step: 0.05, def: 1, fmt: pct },
    { k: 'arbR', label: 'Rear anti-roll bar', hint: 'Stiffer rear bar means more oversteer', min: 0, max: 2, step: 0.05, def: 1, fmt: pct },
    { k: 'ride', label: 'Ride height', hint: 'Higher clears rocks and ruts but rolls more', min: -0.04, max: 0.05, step: 0.005, def: 0, fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v * 1000) + ' mm' },
    { k: 'final', label: 'Final drive', hint: 'Shorter gearing accelerates harder with a lower top speed', min: 0.85, max: 1.2, step: 0.01, def: 1, fmt: (v) => (v > 1.005 ? 'Short ' : v < 0.995 ? 'Long ' : 'Standard ') + Math.round(v * 100) + '%' },
  ] },
  { tab: 'Handling', items: [
    { k: 'grip', label: 'Grip', hint: 'How hard the tyres hold on gravel', min: 0.5, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'downforce', label: 'Downforce', hint: 'Extra grip that builds with speed', min: 0, max: 3, step: 0.05, def: 1, fmt: pct },
    { k: 'steerLock', label: 'Steering lock', hint: 'How hard the car can turn', min: 0.5, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'steerSpeed', label: 'Steering at speed', hint: 'How much of that steering is kept at high speed', min: 0.5, max: 2.5, step: 0.05, def: 1, fmt: pct },
    { k: 'brakes', label: 'Brakes', hint: 'Braking power', min: 0.5, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'stability', label: 'Stability assist', hint: 'Holds the car in line. At 0% nothing stops it sliding', min: 0, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'hbSwing', label: 'Handbrake swing', hint: 'How far and fast the handbrake throws the tail out', min: 0.3, max: 1.5, step: 0.05, def: 1, fmt: pct },
    { k: 'hbStyle', label: 'Handbrake style', hint: 'Classic is the default', def: 'classic', options: [['classic', 'Classic drift: swings the tail out, up to about 90°'], ['spin', 'Full spin: keeps turning while held, up to 180°']] },
    { k: 'hbGrip', label: 'Handbrake grip', hint: 'How hard the tyres hold while the handbrake is pulled. Raise it if tight handbrake turns slide wide', min: 0.5, max: 3, step: 0.05, def: 1, fmt: pct },
    { k: 'carve', label: 'Drift carve', hint: 'Arcade aid: how tightly a held drift pulls round the corner. 0% is pure physics', min: 0, max: 2, step: 0.05, def: 0.4, fmt: pct },
  ] },
];

const KEY = 'bf.settings.v3';
export const S = {};
const defs = {};
for (const t of SCHEMA) for (const it of t.items) defs[it.k] = it.def;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
for (const k in defs) S[k] = typeof saved[k] === typeof defs[k] ? saved[k] : defs[k];

const subs = [];
export function onChange(fn) { subs.push(fn); }
export function setSetting(k, v) {
  S[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  for (const f of subs) f(k, v);
}
export function resetTab(tab) { for (const it of SCHEMA.find((t) => t.tab === tab).items) setSetting(it.k, it.def); }
export const isDefault = (it) => S[it.k] === it.def;

// what the quality slider and the optimization switches mean for the renderer and world
export function gfx() {
  const q = S.quality;
  return {
    shadow: [0, 1024, 2048, 2048, 4096, 4096][q] >> (S.optShadows ? 1 : 0),
    nearTree: S.optTrees ? 22 : [14, 22, 32, 42, 55, 70][q],
    grass: (S.optGrass ? 0.4 : 1) * [0.25, 0.5, 0.75, 1, 1, 1][q],
    trees: [0.55, 0.7, 0.85, 1, 1, 1][q],
    bloom: !S.optGlow && q >= 2,
    samples: S.optAA ? 0 : [0, 0, 2, 4, 4, 4][q],
    res: (S.optRes ? 0.8 : 1) * [0.6, 0.75, 0.9, 1, 1, 1][q],
  };
}
export function tune() {
  return { grip: S.grip, downforce: S.downforce, steerLock: S.steerLock, steerSpeed: S.steerSpeed, brakes: S.brakes, stability: S.stability,
    hbSwing: S.hbSwing, hbStyle: S.hbStyle, hbGrip: S.hbGrip, carve: S.carve, steerSens: S.steerSens };
}
export function applyCar(car) {
  car.tune = tune();
  car.setup = { brakeBias: S.brakeBias, brakeForce: S.brakeForce, split: S.split, diffF: S.diffF, diffR: S.diffR, springF: S.springF, springR: S.springR, damp: S.damp, arbF: S.arbF, arbR: S.arbR, ride: S.ride, final: S.final };
  car.assist = { abs: S.abs, tcs: S.tcs, auto: S.gearbox !== 'manual' };
}
