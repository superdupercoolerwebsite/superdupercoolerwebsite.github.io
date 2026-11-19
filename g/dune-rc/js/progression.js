// The progression game: start with the dune buggy, collect litter, sell it at camp, buy your way up.
// Everything you own is saved in the browser, so closing the page loses nothing.
import { TYPES, FINDS } from './litter.js';

// how much room each kind of litter takes in the cargo space (in "slots"), and whether a metal detector hears it
const ROOM = { can: 1, pbottle: 1, gbottle: 1, cup: 1, bag: 1, butt: 0.2, flipflop: 1, sunglasses: 0.5, phone: 0.5, rope: 2, box: 5, brick: 2, battery: 1,
  plank: 10, tyre: 24, trolley: 40, keys: 0.3, wallet: 0.5, watch: 0.3, camera: 1, headphones: 1, teddy: 2, football: 3, drone: 3 };
const METAL = new Set(['can', 'phone', 'keys', 'watch', 'camera', 'drone', 'battery', 'trolley']);
const HEAVY = new Set(['plank', 'tyre', 'trolley']);                      // too big to lift in: these need the tow hook
const WORTH = t => FINDS.includes(t) ? 150 : (TYPES[t].pts || 0);         // what a piece pays at camp

export const ZONES = [
  { name: 'Home dunes', radius: 160, need: 0 },
  { name: 'The far ridges', radius: 380, need: 15 },
  { name: 'Deep desert', radius: 800, need: 50 },
  { name: 'The empty quarter', radius: 1e9, need: 120 },
];
// the cars and what each brings: top speed with the stock motor, cargo slots, price
export const CAR_INFO = { toy: { top: 25, cargo: 3, price: 0 }, buggy: { top: 60, cargo: 6, price: 0 }, rail: { top: 70, cargo: 4, price: 900 }, truck: { top: 55, cargo: 12, price: 1500 } };

// everything in the shop. levels = price of each step. `say` explains what the next step gives.
export const SHOP = [
  { group: 'Carrying', id: 'bed', name: 'Cargo bed', levels: [40, 110, 260], say: l => '+' + [3, 5, 8][l] + ' cargo slots' },
  { group: 'Carrying', id: 'trailer', name: 'Trailer', levels: [150, 380, 800], say: l => ['small', 'medium', 'large'][l] + ': +' + [10, 20, 40][l] + ' slots. A real towed trailer: heavy when full, and it jack-knifes if you reverse carelessly' },
  { group: 'Carrying', id: 'net', name: 'Cargo net', levels: [60], say: () => 'cargo no longer spills in crashes or blows out in storms' },
  { group: 'Carrying', id: 'scoop', name: 'Front scoop', levels: [120], say: () => 'small litter loads itself when you drive over it slowly' },
  { group: 'Carrying', id: 'tow', name: 'Tow hook and winch', levels: [220], say: () => 'lets you haul planks, tyres and trolleys' },
  { group: 'Range', id: 'battery', name: 'Battery pack', levels: [50, 140, 320], say: l => '+' + [40, 90, 160][l] + '% capacity' },
  { group: 'Range', id: 'spare', name: 'Spare battery', levels: [90], say: () => 'one swap in the field per trip (X)' },
  { group: 'Range', id: 'solar', name: 'Solar panel', levels: [130], say: () => 'slowly charges while parked in daylight' },
  { group: 'Range', id: 'antenna', name: 'Radio antenna', levels: [70, 180, 400], say: l => '+' + [80, 160, 260][l] + ' m signal range from every camp' },
  { group: 'Range', id: 'outpost', name: 'Outpost kit', levels: [200, 350, 600], say: () => 'a camp you place anywhere (O): sells cargo, swaps batteries, extends signal' },
  { group: 'Driving', id: 'motor', name: 'Motor', levels: [80, 220, 500], say: l => '+' + [30, 60, 100][l] + '% power and top speed' },
  { group: 'Driving', id: 'tyres', name: 'Paddle tyres', levels: [90, 240], say: l => l ? 'wide paddles: a loaded car sinks far less' : 'more bite in soft sand and on climbs' },
  { group: 'Driving', id: 'susp', name: 'Suspension', levels: [70, 190], say: () => 'stiffer springs so a full load does not bottom out' },
  { group: 'Driving', id: 'armour', name: 'Armour', levels: [100, 280], say: l => 'crashes do ' + [35, 60][l] + '% less damage' },
  { group: 'Finding', id: 'lights', name: 'Light bar', levels: [60], say: () => 'much brighter headlights' },
  { group: 'Finding', id: 'detector', name: 'Metal detector', levels: [140], say: () => 'points to buried cans and lost metal things within 25 m' },
];

const fresh = () => ({ money: 0, car: 'buggy', owned: ['buggy'], up: {}, sold: 0, zone: 0, outposts: [], dmg: { arm: 0, motor: 0, susp: 0, body: 0 }, armSide: 1, spareUsed: false, outpostsLeft: 0, earned: 0 });

export class Game {
  constructor() {
    this.s = fresh(); this.cargo = []; this.msg = ''; this.msgT = 0; this.signal = 1; this.held = null; this.events = [];
    // everyone starts with the buggy (older saves that began in the toy car are given it too)
    try {
      const raw = localStorage.getItem('dunerc.save'); if (raw) this.s = Object.assign(fresh(), JSON.parse(raw));
      if (!this.s.owned.includes('buggy')) { this.s.owned.unshift('buggy'); if (this.s.car === 'toy') this.s.car = 'buggy'; }
    } catch (e) { /* no saved game */ }
    if (this.s.up.map) { this.s.money += 50; delete this.s.up.map; }      // the map was removed from the game: anyone who bought it gets the $50 back
    this.cargo = this.s.cargo = this.s.cargo || [];          // what is in the car is saved with everything else
  }
  save() { try { localStorage.setItem('dunerc.save', JSON.stringify(this.s)); } catch (e) { /* cannot save here */ } }
  restart() { this.s = fresh(); this.cargo = this.s.cargo = []; this.save(); try { localStorage.removeItem('dunerc.world'); localStorage.removeItem('dunerc.found'); } catch (e) { /* nothing saved */ } }
  lvl(id) { return this.s.up[id] || 0; }
  say(t, secs = 3.5) { this.msg = t; this.msgT = secs; }

  // ---- what the car can carry ----
  capacity() { return CAR_INFO[this.s.car].cargo + [0, 3, 8, 16][this.lvl('bed')] + [0, 10, 30, 70][this.lvl('trailer')]; }
  used() { let u = 0; for (const c of this.cargo) u += ROOM[c] || 1; return u; }
  load() { let m = 0; for (const c of this.cargo) m += TYPES[c].m; return m; }
  // can this piece go in? returns '' if yes, or the reason why not
  whyNot(type) {
    if (!(type in ROOM)) return 'That is not litter.';
    if (HEAVY.has(type) && !this.lvl('tow')) return 'Too big to lift. You need the tow hook and winch.';
    if (this.used() + ROOM[type] > this.capacity() + 1e-6) return 'No room: ' + this.used().toFixed(0) + ' of ' + this.capacity() + ' slots are full.';
    return '';
  }
  add(type) { this.cargo.push(type); this.events.push('load'); this.save(); }

  // ---- numbers the car's physics reads every frame ----
  apply(car) {
    const L = id => this.lvl(id), d = this.s.dmg, tr = L('trailer');
    car.topKmh = CAR_INFO[this.s.car].top * [1, 1.3, 1.6, 2][L('motor')];
    car.pushMul = [1, 1.3, 1.6, 2][L('motor')] * (1 - 0.6 * d.motor);
    car.mass = car.spec.mass + (tr ? 0 : this.load());                                // cargo is real weight: in the car, or in the trailer if you have one
    car.gripMul = [1, 1.15, 1.25][L('tyres')];
    car.sinkMul = (1 + 0.35 * Math.min(3, (tr ? 0 : this.load()) / car.spec.mass)) * (L('tyres') > 1 ? 0.55 : 1);   // a heavy car ruts deeper
    car.springMul = [1, 1.35, 1.8][L('susp')];
    car.dampMul = 1 - 0.6 * d.susp;
    car.steerBias = d.arm * 0.22 * this.s.armSide;                                    // a bent arm pulls to one side
    car.lockMul = 1; car.dragExtra = 0;                                               // (the trailer is a real towed body now: it needs no stand-in numbers)
    car.capacity = car.spec.batteryWh * 3600 * [1, 1.4, 1.9, 2.6][L('battery')];
    if (car.battery > car.capacity) car.battery = car.capacity;
    car.lightPower = L('lights') ? 1.7 : 0.45;
  }

  // ---- crashes ----
  crash(hard, car) {
    if (hard < 2.2) return;
    const k = (hard - 2.2) * 0.022 * [1, 0.65, 0.4][this.lvl('armour')], d = this.s.dmg, pick = Math.floor(hard * 7.3) % 4;
    const part = ['arm', 'motor', 'susp', 'body'][pick]; const was = d[part];
    d[part] = Math.min(1, d[part] + k * (part === 'body' ? 1.5 : 1));
    if (part === 'arm' && was < 0.05) this.s.armSide = Math.floor(hard * 31) % 2 ? 1 : -1;
    if (d[part] - was > 0.04) this.say(['Bent a suspension arm: the car pulls to one side.', 'The motor took a knock: less power.', 'A shock is leaking: the ride is bouncy.', 'Cracked the body.'][pick] + ' Repair it at camp.', 4);
    // without a net, a hard enough crash throws cargo out
    if (!this.lvl('net') && this.cargo.length && (hard > 4 || car.U.y < 0.3)) { const n = Math.min(this.cargo.length, 1 + Math.floor(hard / 3)); this.spill = this.cargo.splice(this.cargo.length - n, n); this.say('Cargo spilled!', 3); }
  }
  damage() { const d = this.s.dmg; return (d.arm + d.motor + d.susp + d.body) / 4; }
  repairCost() { const d = this.s.dmg; return Math.ceil((d.arm + d.motor + d.susp + d.body) * 45 * (1 + this.s.owned.length * 0.5)); }
  repair() { const c = this.repairCost(); if (!c || this.s.money < c) return false; this.s.money -= c; this.s.dmg = { arm: 0, motor: 0, susp: 0, body: 0 }; this.save(); return true; }

  // ---- at a camp ----
  sellAll() {
    if (!this.cargo.length) return 0;
    let pay = 0, n = 0; for (const c of this.cargo) { pay += WORTH(c); n += FINDS.includes(c) ? 0 : 1; }
    this.cargo.length = 0; this.s.money += pay; this.s.earned += pay; this.s.sold += n; this.s.spareUsed = false;
    this.checkZone(); this.save(); this.events.push('sell');
    this.say('Sold your load for $' + pay + '.  Total cleaned: ' + this.s.sold + ' pieces.', 4);
    return pay;
  }
  payFor(type) { const p = WORTH(type); this.s.money += p; this.s.earned += p; if (!FINDS.includes(type)) this.s.sold++; this.checkZone(); this.save(); return p; }
  checkZone() {
    while (this.s.zone < ZONES.length - 1 && this.s.sold >= ZONES[this.s.zone + 1].need) { this.s.zone++; this.say('NEW ZONE OPEN: ' + ZONES[this.s.zone].name + '. Your radio licence now covers it.', 6); this.events.push('zone'); }
  }
  price(item) { const l = this.lvl(item.id); return l < item.levels.length ? item.levels[l] : null; }
  buy(item) {
    const p = this.price(item); if (p === null || this.s.money < p) return false;
    this.s.money -= p; this.s.up[item.id] = this.lvl(item.id) + 1; if (item.id === 'outpost') this.s.outpostsLeft++;
    this.save(); this.events.push('buy'); return true;
  }
  buyCar(id) {
    if (this.s.owned.includes(id)) { this.s.car = id; this.save(); return true; }
    if (this.s.money < CAR_INFO[id].price) return false;
    this.s.money -= CAR_INFO[id].price; this.s.owned.push(id); this.s.car = id; this.save(); this.events.push('buy'); return true;
  }

  // ---- radio: how far you can drive ----
  // camps = [{x, z}], home first. Returns signal 0..1 and sets this.why when it is weak.
  radio(car, camps) {
    const range = 120 + [0, 80, 240, 500][this.lvl('antenna')];
    let best = 1e9; for (const c of camps) best = Math.min(best, Math.hypot(car.pos.x - c.x, car.pos.z - c.z));
    const home = Math.hypot(car.pos.x - camps[0].x, car.pos.z - camps[0].z), zr = ZONES[this.s.zone].radius;
    const a = Math.max(0, Math.min(1, (range - best) / 25)), b = Math.max(0, Math.min(1, (zr - home) / 25));
    this.signal = Math.min(a, b); this.range = range; this.nearest = best;
    this.why = b < a ? 'Edge of your licence: sell ' + Math.max(0, ZONES[Math.min(ZONES.length - 1, this.s.zone + 1)].need - this.s.sold) + ' more pieces to open ' + ZONES[Math.min(ZONES.length - 1, this.s.zone + 1)].name + '.'
      : 'Radio signal fading: ' + Math.round(best) + ' m from camp, range ' + range + ' m. Buy an antenna or place an outpost.';
    return this.signal;
  }

  // the nearest piece a metal detector would hear
  detect(car, items) {
    let best = null, bd = 25;
    for (const o of items) { if (!METAL.has(o.type)) continue; const d = Math.hypot(o.pos.x - car.pos.x, o.pos.z - car.pos.z); if (d < bd && d > 0.4) { bd = d; best = o; } }
    return best ? { d: bd, o: best } : null;
  }
}
export { ROOM, HEAVY, WORTH };
