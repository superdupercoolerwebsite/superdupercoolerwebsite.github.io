// The desert itself: pure maths, no graphics. Everything else (terrain meshes now,
// car physics later) asks this file "how high is the sand at x,z?".

// ---------- noise ----------
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------- wind ----------
export const WIND_ANGLE = 0.6;                 // radians; dunes march this way
const CW = Math.cos(WIND_ANGLE), SW = Math.sin(WIND_ANGLE);

// ---------- regions ----------
export const DUNE_NAMES = ['Giant rolling sea', 'Sharp crescents', 'Small and choppy', 'Flat hard pan'];
export const SAND_NAMES = ['golden', 'amber', 'light gold'];

let wA = 0, wB = 0, wC = 0, wP = 0;
function duneRegion(x, z) {
  const s = 1 / 1300, k = 0.07;
  let a = vnoise(x * s + 11.3, z * s + 4.1);
  let b = vnoise(x * s - 37.7, z * s + 19.9);
  let c = vnoise(x * s + 63.2, z * s - 51.4);
  const m = Math.max(a, b, c);
  a = Math.max(0, (a - m) / k + 1); b = Math.max(0, (b - m) / k + 1); c = Math.max(0, (c - m) / k + 1);
  a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b); c = c * c * (3 - 2 * c);
  const t = a + b + c;
  // flat hard pans: open floors where the dunes die away
  // (there are no flat pans any more: it is dunes everywhere)
  const p = 0;
  wP = p; wA = a / t * (1 - p); wB = b / t * (1 - p); wC = c / t * (1 - p);
}
export function duneWeights(x, z) { duneRegion(x, z); return [wA, wB, wC, wP]; }

export function sandWeights(x, z) {
  const s = 1 / 2100, k = 0.22;
  let a = vnoise(x * s + 91.7, z * s - 13.3);
  let b = vnoise(x * s - 5.9, z * s + 71.1);
  let c = vnoise(x * s + 27.4, z * s + 44.8);
  const m = Math.max(a, b, c);
  a = Math.max(0, (a - m) / k + 1); b = Math.max(0, (b - m) / k + 1); c = Math.max(0, (c - m) / k + 1);
  a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b); c = c * c * (3 - 2 * c);
  const t = a + b + c;
  return [a / t, b / t, c / t];
}

// One rich golden sand, with two close cousins (linear light): golden, amber, light gold
const PAL = [[0.74, 0.39, 0.11], [0.74, 0.32, 0.075], [0.80, 0.47, 0.17]];
export function sandColor(x, z, out, o) {
  const w = sandWeights(x, z);
  const v = 0.9 + 0.2 * vnoise(x * 0.013 + 7, z * 0.013 - 3);   // same sand colour on the pans as everywhere else
  out[o] = (PAL[0][0] * w[0] + PAL[1][0] * w[1] + PAL[2][0] * w[2]) * v;
  out[o + 1] = (PAL[0][1] * w[0] + PAL[1][1] * w[1] + PAL[2][1] * w[2]) * v;
  out[o + 2] = (PAL[0][2] * w[0] + PAL[1][2] * w[1] + PAL[2][2] * w[2]) * v;
}

// ---------- dune shapes ----------
// A real sand sea is not rows of one wave. Here it is built from several FAMILIES of dunes laid over each other,
// each family running its own way, so crests cross, fork into each other and face different directions:
//   - in every family the crest lines bend (a lot), bunch up and spread out, so no two gaps between dunes are alike;
//   - along a crest the height rises and dies away to nothing, so dunes begin and end instead of running for ever;
//   - each dune has the real cross-section: a long gentle side, a sharp crest, and a slip face at the angle dry sand
//     stands at (about 30 degrees), whatever the local spacing happens to be;
//   - where two families meet, the higher sand wins, which is what makes star dunes and Y-shaped junctions.

// One dune cross-section: long gentle windward ramp, sharp crest, steep slip face.
// s = where along the dune the crest is.
function prof(f, s) {
  if (f < s) { const t = f / s; return 0.5 * t * t * (3 - 2 * t) + 0.5 * t * t; }
  // nearly a straight ramp down: sand lies at one angle
  return Math.pow(1 - (f - s) / (1 - s), 1.15);
}

// One family of dunes. ang = which way its slip faces look (radians), L = usual gap between crests (m),
// amp = crest height (m), bend = how hard the crest lines bend, gaps = how much of each crest is missing (0..1).
function family(x, z, ang, L, amp, bend, gaps, seed) {
  const ca = Math.cos(ang), sa = Math.sin(ang), u = x * ca + z * sa, v = -x * sa + z * ca;
  const f1 = 0.55 / L, f2 = 2.1 / L;
  const warp = (uu) => u / L * 0 + uu / L
    + (vnoise(uu * f1 * 0.35 + seed, v * f1 * 0.35 - seed) - 0.5) * 3.2 * bend
    + (vnoise(uu * f1 + seed + 5.1, v * f1 + 9.7) - 0.5) * 1.3 * bend
    + (vnoise(uu * f2 + 2.2, v * f2 + seed + 8.8) - 0.5) * 0.22 * bend;
  const p = warp(u), e = L * 0.02, dp = (warp(u + e) - p) / e;
  // how tightly the dunes are packed just here (never allowed to fold back on themselves)
  const tight = Math.max(0.35 / L, dp);
  const f = p - Math.floor(p);
  // height along the crest: comes and goes, and whole stretches are missing
  let m = vnoise(u * 0.9 / L + seed * 1.7 + Math.floor(p) * 0.37, v * 1.6 / L + seed + 3.3);
  m = (m - gaps) / (1 - gaps); if (m <= 0) return 0; m = m * m * (3 - 2 * Math.min(1, m));
  const A = amp * Math.min(1.25, m);
  // the slip face is about 1.9 times as long as the dune is high, wherever it is
  const sCrest = Math.max(0.5, Math.min(0.96, 1 - 1.9 * A * tight));
  return A * prof(f, sCrest);
}
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k));

// ---------- the one function that matters ----------
export function height(x, z) {
  duneRegion(x, z);
  // broad swells under everything: the dunes climb over them
  let h = (vnoise(x * 0.0021 + 31, z * 0.0021 - 17) - 0.5) * 30 + (vnoise(x * 0.0007 - 8, z * 0.0007 + 44) - 0.5) * 40;
  // dunes are big in some places and small in others
  const env = 0.55 + 0.8 * vnoise(x * 0.0023 + 71, z * 0.0023 + 13);
  const W = WIND_ANGLE;
  let big = 0;
  // long ridges across the wind, with a second set cutting across them at an angle
  if (wA > 0.001) big += wA * smax(family(x, z, W, 210, 30 * env, 1.0, 0.12, 1), family(x, z, W + 0.75, 270, 22 * env, 1.2, 0.32, 2), 6);
  // great star dunes: three sets of arms running three ways
  if (wB > 0.001) big += wB * smax(smax(family(x, z, W - 0.2, 340, 46 * env, 0.9, 0.25, 3), family(x, z, W + 1.9, 320, 40 * env, 1.0, 0.3, 4), 10), family(x, z, W + 3.9, 380, 36 * env, 1.0, 0.35, 5), 10);
  // a maze of smaller dunes going two ways
  if (wC > 0.001) big += wC * smax(family(x, z, W - 0.45, 78, 10 * env, 1.1, 0.18, 6), family(x, z, W + 0.8, 105, 8.5 * env, 1.2, 0.3, 7), 2);
  h += big;
  // small dunes riding on everything, two sets, patchy
  h += smax(family(x, z, W + 0.3, 30, 2.6, 1.1, 0.22, 8), family(x, z, W - 0.7, 19, 1.5, 1.2, 0.32, 9), 0.05) - 0.11;
  h += (vnoise(x * 0.11, z * 0.11) - 0.5) * 0.12;
  return h;
}
