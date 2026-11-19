// The stage list. Each is a seeded road; `custom(n)` builds one from any number.
export const STAGES = [
  { id: 'gate', name: 'Blackfir Gate', seed: 7, blurb: 'Quick spruce-lined gravel. A good first run.' },
  { id: 'ravens', name: "Raven's Cut", seed: 3, blurb: 'Flowing bends that tighten without warning.' },
  { id: 'tarn', name: 'Tarn Hollow', seed: 11, nSeg: 40, twist: 1.6, hairpin: 0.15, blurb: 'Rolling ground and blind crests down to the water.' },
  { id: 'stone', name: 'Stonewater', seed: 19, nSeg: 38, twist: 1.4, hairpin: 0.25, blurb: 'Fast straights broken up by hard stops.' },
  { id: 'cinder', name: 'Cinder Hairpins', seed: 23, nSeg: 44, twist: 1.8, hairpin: 0.4, blurb: 'Hairpin after hairpin. Bring the handbrake.' },
  { id: 'north', name: 'Northline', seed: 31, nSeg: 56, twist: 1.3, hairpin: 0.12, blurb: 'The long one. Concentration is the hard part.' },
];
export const custom = (n) => ({ id: 'custom' + n, name: 'Custom ' + n, seed: 1000 + (n | 0), nSeg: 30 + ((n * 7) % 24), twist: 1.2 + ((n * 13) % 7) / 10, hairpin: 0.1 + ((n * 5) % 4) / 10, blurb: 'A road built from the number ' + n + '.' });
export const CAR = { name: 'Varg 4X', spec: 'AWD · 165 kW · 1250 kg' };
