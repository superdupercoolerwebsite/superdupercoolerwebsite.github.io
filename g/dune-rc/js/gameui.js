// Everything the player does in the progression game: dragging litter into the car, selling at camp,
// the shop, outposts, radio range, damage, the map. The rules and prices live in progression.js.
import * as THREE from 'three';
import { Game, SHOP, CAR_INFO, ZONES, ROOM, HEAVY, WORTH } from './progression.js';
import { FINDS, TYPES, buildLitter } from './litter.js';
import { Base, MAT_HALF } from './base.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { Trailer } from './trailer.js';
import { fitBalls } from './shape.js';

const $ = id => document.getElementById(id);
const eul = new THREE.Euler(), tq = new THREE.Quaternion();
const v = new THREE.Vector3(), ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), m2 = new THREE.Vector2();
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

export class Play {
  // ctx: scene, camera, canvas, car, litter, weather, sound, height, toast, useCar(id), SPECS, isDriving()
  constructor(ctx) {
    Object.assign(this, ctx);
    this.game = new Game(); this.camps = []; this.shopOpen = false; this.held = null; this.t = 0; this.stormT = 0; this.detT = 0;
    // The trailer: "Trailer" by svartfilin (Sketchfab, CC-BY-4.0): an open box trailer, the kind you would fill with rubbish.
    // It adds real weight and drag and limits how tightly you can turn. What you load is shown lying in it.
    this.trailer = new THREE.Group();
    new GLTFLoader().load('./assets/models/trailer.glb', g => {
      g.scene.traverse(o => { if (o.isMesh) { o.material.metalness = Math.min(o.material.metalness, 0.1); o.material.metalnessMap = null; } if (o.name.replace(/[._]/g, '') === 'Cylinder022') o.visible = false; });
      // turn the model so its tow bar points along +z and its axle sits at the centre of the group
      // (lined up on the coupling, which sits a little off the model's centre line)
      const inner = new THREE.Group(); inner.rotation.y = -Math.PI / 2; inner.position.set(-2.79, -0.42, 2.18); inner.add(g.scene); this.trailer.add(inner);
      g.scene.updateMatrixWorld(true);
      const pivot = new THREE.Group(), parts = [];
      pivot.position.set(-2.185, 0.415, 0); g.scene.add(pivot); pivot.updateMatrixWorld(true);
      g.scene.traverse(o => { if (['TyreFrontlow001', 'TyreFrontlow002', 'TyreFrontlow004', 'Plane011', 'Cylinder025'].includes(o.name.replace(/[._]/g, ''))) parts.push(o); });
      for (const o of parts) pivot.attach(o);
      this.wheelPivot = pivot; this.wheelParts = parts.length;
      // its collision shape, from the model (what you carry in it is not part of it)
      this.trShape = fitBalls(this.trailer, { frame: this.trailer, skip: [this.load], max: 110 });
      this.tr.setShape(this.trShape.balls);
      const C = this.litter.cols[1]; C.balls.length = 0;
      for (const l of this.trShape.balls) C.balls.push({ c: new THREE.Vector3(), r: 0, v: new THREE.Vector3(), wheel: -1, l, bar: l[2] > 1.5 });
    });
    this.load = new THREE.Group(); this.trailer.add(this.load); this.loadKey = '';
    this.tr = new Trailer(); this.hitch = new THREE.Vector3(); this.axle = new THREE.Vector3(); this.spin = 0;
    this.tw = [{ x: 0, z: 0, on: false }, { x: 0, z: 0, on: false }];
    this.gh = (x, z) => this.groundH(x, z);
    this.trailer.visible = false; this.scene.add(this.trailer);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4 })); this.ball.visible = false; this.scene.add(this.ball);   // the tow ball

    const c = this.canvas;
    c.addEventListener('mousedown', e => this.grab(e));
    addEventListener('mousemove', e => this.drag(e));
    addEventListener('mouseup', e => this.drop(e));
    $('shop').addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.click(b.dataset); });
  }

  start(home) {
    this.camps = [home];
    for (const o of this.game.s.outposts) this.camps.push(new Base(this.scene, o.x, o.z, this.height, true));
    this.useCar(this.game.s.car);
    this.game.apply(this.car); this.car.battery = this.car.capacity;
    if (!this.game.s.earned) this.toast('Drive up to litter, then click it and drag it onto your car. Bring it back to the backpack to sell.', 9);
  }

  // ---------- keys ----------
  key(code) {
    const g = this.game, car = this.car;
    if (code === 'Enter') { if (this.shopOpen) this.closeShop(); else if (this.atCamp() && car.vel.length() < 1.5) this.openShop(); else this.toast('The shop is at camp: park by the backpack and press Enter.', 3); return true; }
    if (code === 'Escape' && this.shopOpen) { this.closeShop(); return true; }
    if (this.shopOpen) return true;
    if (code === 'KeyG') { const own = g.s.owned, i = own.indexOf(g.s.car); if (!this.atCamp()) this.toast('You can only change cars at a camp.', 3); else if (own.length < 2) this.toast('You only own one car. Buy more at camp.', 3); else { g.s.car = own[(i + 1) % own.length]; g.save(); this.swapCar(); } return true; }
    if (code === 'KeyX') {
      if (!g.lvl('spare')) this.toast('No spare battery. Buy one at camp.', 3); else if (g.s.spareUsed) this.toast('The spare is already used. It is refilled when you sell a load at camp.', 3.5);
      else { g.s.spareUsed = true; car.battery = car.capacity; g.save(); this.toast('Spare battery fitted: 100%', 3); this.sound.chime(true); }
      return true;
    }
    if (code === 'KeyO') {
      if (g.s.outpostsLeft < 1) this.toast('No outpost kit. Buy one at camp.', 3); else if (g.signal < 0.3) this.toast('Too little signal to set up here.', 3);
      else if (this.nearestCamp().d < 40) this.toast('Too close to another camp: go at least 40 m out.', 3);
      else { const x = car.pos.x - car.F.x * 1.5, z = car.pos.z - car.F.z * 1.5; g.s.outposts.push({ x, z }); g.s.outpostsLeft--; g.save(); this.camps.push(new Base(this.scene, x, z, this.height, true)); this.toast('Outpost set up. It sells cargo, swaps batteries and carries your radio signal.', 5); this.sound.chime(true); }
      return true;
    }
    if (code === 'KeyR') {
      // Only for a car that really is stuck: on its roof or side, flat battery, or out of radio range.
      // Next to camp you just walk over and set it on its wheels. Far out it has to be carried back, and that costs.
      const n = this.nearestCamp(), over = this.tr.live && Math.abs(this.tr.roll) > 1.0, stuck = car.U.y < 0.5 || car.battery <= 0 || g.signal <= 0 || over;
      if (!stuck) { this.toast('The car is on its wheels and working: nothing to rescue.', 2.5); return true; }
      if (n.d > 15) {
        const fee = Math.min(g.s.money, Math.round(10 + n.d * 0.08));
        g.s.money -= fee; g.save(); car.place(n.c.x + 1.2, n.c.z + 0.3, 0); car.battery = Math.max(car.battery, car.capacity * 0.25);
        this.toast('Carried back to camp. Recovery fee: $' + fee, 4);
      } else car.place(car.pos.x, car.pos.z, Math.atan2(-car.F.x, -car.F.z));
      this.tr.live = false;
      return false;                                       // main also cancels the jump in progress
    }
    return false;
  }
  swapCar() { const car = this.car, charge = car.battery / car.capacity; this.useCar(this.game.s.car); this.game.apply(car); car.battery = car.capacity * charge; this.toast(car.spec.name + ': ' + car.spec.blurb, 4); }

  // stop the car answering when there is no radio signal, or while the shop is open
  gate(inp) {
    if (this.shopOpen) { inp.thr = 0; inp.steer = 0; inp.hb = true; return inp; }
    if (this.game.signal <= 0) { inp.thr = 0; inp.steer = 0; }
    else if (this.game.signal < 0.5 && Math.sin(this.t * 37) > this.game.signal * 2 - 0.2) inp.thr = 0;      // a weak signal cuts in and out
    return inp;
  }

  nearestCamp() { let d = 1e9, c = this.camps[0]; for (const k of this.camps) { const q = Math.hypot(this.car.pos.x - k.x, this.car.pos.z - k.z); if (q < d) { d = q; c = k; } } return { d, c }; }
  atCamp() { return this.nearestCamp().d < 3.2; }

  // ---------- loading by hand: click a piece near the car and drag it onto the car ----------
  pick(e) {
    const car = this.car, r = this.canvas.getBoundingClientRect(); let best = null, bd = 46;
    for (const o of this.litter.items) {
      if (!(o.type in ROOM) || o.gone) continue;
      if (Math.hypot(o.pos.x - car.pos.x, o.pos.z - car.pos.z) > 1.7) continue;
      v.copy(o.pos).project(this.camera); if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * r.width + r.left, py = (-v.y * 0.5 + 0.5) * r.height + r.top, d = Math.hypot(px - e.clientX, py - e.clientY);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  grab(e) {
    if (!this.isDriving() || this.shopOpen) return;
    const o = this.pick(e);
    if (!o) {
      // not a piece of litter: is it the skip? Holding the button on it for a second dumps the load.
      const r = this.canvas.getBoundingClientRect(); m2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(m2, this.camera);
      for (const c of this.camps) if (c.bin && ray.intersectObject(c.bin, true).length) {
        if (Math.hypot(this.car.pos.x - c.x, this.car.pos.z - c.z) > 5) this.toast('Bring the car up to the skip first.', 2.5);
        else if (!this.game.cargo.length) this.toast('Your cargo space is empty.', 2.5);
        else { this.dump = { t: 0 }; this.mx = e.clientX; this.my = e.clientY; }
        return;
      }
      return;
    }
    if (this.car.vel.length() > 1.5) { this.toast('Stop the car to load litter.', 2.5); return; }
    const why = this.game.whyNot(o.type); if (why) { this.toast(why, 3.5); return; }
    if (o.cloth) { this.take(o); return; }                 // a bag is just stuffed in
    this.held = o; o.held = true; o.asleep = true; o.vel.set(0, 0, 0); o.w.set(0, 0, 0); this.canvas.style.cursor = 'grabbing';
  }
  drag(e) {
    const r = this.canvas.getBoundingClientRect(); this.mx = e.clientX; this.my = e.clientY;
    if (!this.held) { if (this.isDriving() && !this.shopOpen) this.canvas.style.cursor = this.pick(e) ? 'grab' : ''; return; }
    m2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(m2, this.camera); plane.constant = -(this.car.pos.y + 0.06);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    v.subVectors(hit, this.car.pos); v.y = 0; if (v.length() > 1.8) hit.copy(this.car.pos).addScaledVector(v.normalize(), 1.8).setY(this.car.pos.y + 0.06);
    const o = this.held; o.pos.copy(hit); o.mesh.position.copy(hit);
  }
  drop() {
    this.dump = null; $('hold').style.display = 'none';
    const o = this.held; if (!o) return; this.held = null; o.held = false; this.canvas.style.cursor = '';
    if (Math.hypot(o.pos.x - this.car.pos.x, o.pos.z - this.car.pos.z) < 0.42) this.take(o);
    else { o.asleep = false; o.still = 0; }                // let go short of the car: it drops back on the sand
  }
  take(o) {
    this.litter.remove(o); this.game.add(o.type); this.sound.knock(o.type, 0.4);
    this.toast('Loaded: ' + o.T.label + '  ($' + WORTH(o.type) + ')   ' + this.game.used().toFixed(0) + ' / ' + this.game.capacity() + ' slots', 2.5);
  }

  // ---------- every physics step ----------
  physics(dt) {
    const g = this.game, car = this.car, tl = g.lvl('trailer');
    if (!tl) { this.tr.live = false; this.litter.cols[1].n = 0; return; }
    const S = car.spec; this.tk = [0, 0.14, 0.18, 0.23][tl];
    this.hitch.copy(car.pos).addScaledVector(car.F, -(S.tail + 0.012)).addScaledVector(car.U, S.belly + 0.03);     // the tow ball on the back of the car
    const load = g.load(), k = this.tk, L = 2.68 * k, H = this.hitch;
    const T = this.tr;
    T.step(dt, car, L, [0.35, 0.6, 1.1][tl - 1] + load, H, Math.min(1, load / 4), this.gh, k);
    const sx = Math.sin(T.th), sz = Math.cos(T.th), cr = Math.cos(T.roll), sr = Math.sin(T.roll), lf = Math.min(1.6, T.m * 9.81 / 2 / 5.5);
    // the two tyres pack the sand they roll over, and shove it aside when they slide
    for (let i = 0; i < 2; i++) {
      const w = this.tw[i], sd = i ? (T.wL || -1) : (T.wR || 1), N = i ? T.NL : T.NR, px = T.ax + sz * sd * k * cr, pz = T.az - sx * sd * k * cr;
      if (N < 0.05 * T.m) { w.on = false; continue; }
      if (!w.on || Math.hypot(px - w.x, pz - w.z) > 0.6) { w.x = px; w.z = pz; w.on = true; }
      const nf = Math.min(1.6, N / 5.5);
      this.field.press(w.x, w.z, px, pz, 0.17 * k, 0.003 + 0.005 * nf, 0);
      const vs = Math.abs(T.vlat);
      if (vs > 0.4) { const d = Math.sign(T.vlat); this.field.scoop(w.x, w.z, px, pz, 0.17 * k, 0.0016 * vs * dt * nf, sz * d, -sx * d); }
      w.x = px; w.z = pz;
    }
    // on its side, the box scrapes a groove
    if (T.Nb > 0.2 * T.m) this.field.press(T.ax, T.az, T.ax, T.az, 0.5 * k, Math.min(0.02, 0.004 + 0.004 * lf), 0);
    // where every ball of its shape is right now, for everything that can run into it
    const C = this.litter.cols[1], rise = H.y - (T.y - 0.09 * k), pitch = Math.atan2(rise, Math.sqrt(Math.max(1e-6, L * L - rise * rise)));
    eul.set(-pitch, T.th, T.roll, 'YXZ'); tq.setFromEuler(eul);
    C.c.set(T.ax, T.y, T.az); C.body = T; C.n = C.balls.length; C.reach = (this.trShape ? this.trShape.reach : 0) * k;
    for (const q of C.balls) {
      q.c.set(q.l[0] * k, q.l[1] * k, q.l[2] * k).applyQuaternion(tq).add(C.c); q.r = q.l[3] * k;
      const ox = q.c.x - T.x, oz = q.c.z - T.z;
      q.v.set(T.vx + T.w * oz, T.vy, T.vz - T.w * ox);
    }
    // if it goes over, what was in it falls out (unless it is under a cargo net)
    if (Math.abs(T.roll) > 1.1 && !g.lvl('net') && g.cargo.length && !g.spill) { g.spill = g.cargo.splice(0); g.say('The trailer went over: your cargo spilled!', 4); g.save(); }
  }

  // ---------- every drawn frame ----------
  frame(dt) {
    const g = this.game, car = this.car, L = this.litter; this.t += dt; g.msgT -= dt;
    g.apply(car);
    g.radio(car, this.camps);
    // crashes hurt the car (and can throw cargo out)
    if (car.shock > 0) { g.crash(car.shock, car); car.shock = 0; }
    if (g.spill) { g.spill.forEach((t, i) => { const o = L.make(t, car.pos.x + Math.cos(i * 2.4) * 0.3, car.pos.z + Math.sin(i * 2.4) * 0.3, (i * 0.37) % 1, i); if (!o.cloth) { o.pos.y = car.pos.y + 0.15; o.vel.set(car.vel.x * 0.5 + Math.cos(i * 2.4), 1.5, car.vel.z * 0.5 + Math.sin(i * 2.4)); o.asleep = false; o.settled = true; } }); g.spill = null; }
    // a storm blows light things out of an open bed
    if (this.weather.storm > 0.6 && !g.lvl('net') && g.cargo.length && (this.stormT += dt) > 5) { this.stormT = 0; const i = g.cargo.findIndex(t => TYPES[t].m < 0.05); if (i >= 0) { g.spill = g.cargo.splice(i, 1); g.say('The storm blew a ' + TYPES[g.spill[0]].label + ' out of the bed!', 3); } }
    // the front scoop: small things load themselves at walking pace
    if (g.lvl('scoop') && car.grounded && car.vel.length() < 6) {
      v.copy(car.pos).addScaledVector(car.F, -car.spec.nose + 0.03);
      for (const o of L.near) if (!o.gone && (ROOM[o.type] || 9) <= 1 && Math.hypot(o.pos.x - v.x, o.pos.z - v.z) < 0.16 && !g.whyNot(o.type)) { this.take(o); break; }
    }
    const n3 = this.nearestCamp().d;
    // camps: swap the battery; anything pushed onto a tarp is sold
    for (const c of this.camps) {
      c.update(dt, car, L, this.t);
      if (c.justSwapped) { this.toast('Fresh battery pack fitted: 100%', 3); this.sound.chime(true); }
      const d = Math.hypot(car.pos.x - c.x, car.pos.z - c.z);
      if ((c.sellT = (c.sellT || 0) - dt) < 0) {
        c.sellT = 0.7;
        for (const o of L.items) {
          if (o.gone || o === this.held || !(o.type in ROOM) || Math.abs(o.pos.x - c.tx) > MAT_HALF || Math.abs(o.pos.z - c.tz) > MAT_HALF) continue;
          if (o.cloth ? !o.cloth.asleep : !o.asleep) continue;
          const p = g.payFor(o.type); L.remove(o); g.say('Sold from the tarp: ' + o.T.label + '  +$' + p, 2.5); g.events.push('sell'); break;
        }
      }
    }
    // holding the mouse on the skip: a ring fills for one second, then the whole load goes in and you are paid
    if (this.dump) {
      this.dump.t += dt; const h = $('hold'); h.style.display = 'block'; h.style.left = this.mx + 'px'; h.style.top = this.my + 'px'; h.style.setProperty('--p', Math.min(1, this.dump.t));
      if (this.dump.t >= 1) { this.dump = null; h.style.display = 'none'; g.sellAll(); this.sound.knock('box', 0.8); }
    }
    if (!this.dump && g.cargo.length && n3 < 5 && g.msgT <= 0) g.say('Hold the mouse button on the skip for a second to dump your load.', 0.5);
    // solar panel: a real 5 W trickle while parked in daylight
    if (g.lvl('solar') && car.vel.length() < 0.2 && this.U.uLightDir.value.y > 0.15 && this.U.uNight.value < 0.3) car.battery = Math.min(car.capacity, car.battery + 5 * (1 - 0.8 * this.weather.storm) * dt);
    for (const ev of g.events) { if (ev === 'sell' || ev === 'buy' || ev === 'zone') this.sound.chime(true); } g.events.length = 0;
    // trailer follows behind, swinging round a little late like a real hitch
    const tl = g.lvl('trailer'); this.trailer.visible = tl > 0;
    if (tl) {
      // The trailer is its own body (trailer.js). Here it is only drawn: axle where the physics has it, tow bar on the ball.
      // (Seen from its own centre, the axle: the coupling is 2.68 ahead and 0.09 down, the wheels are 0.42 in radius. k shrinks it to RC size.)
      const k = this.tk || 0.18, L = 2.68 * k, H = this.hitch, A = this.axle;
      if (!this.tr.live) this.physics(1 / 240);
      A.x = this.tr.ax; A.z = this.tr.az;
      let dx = H.x - A.x, dz = H.z - A.z; const d = Math.hypot(dx, dz) || 1e-6; dx /= d; dz /= d;
      A.y = this.tr.y;
      const rise = H.y - (A.y - 0.09 * k), run = Math.sqrt(Math.max(1e-6, L * L - rise * rise)), pitch = Math.atan2(rise, run);
      const psi = Math.atan2(dx, dz);
      const roll = this.tr.roll;
      // the wheels turn at the speed the sand passes under them, and coast on in the air
      this.spin = this.tr.air ? this.spin * Math.exp(-dt * 0.8) : this.tr.vlong / (0.42 * k);
      if (this.wheelPivot) this.wheelPivot.rotation.z -= this.spin * dt;
      this.trailer.rotation.order = 'YXZ'; this.trailer.rotation.set(-pitch, psi, roll); this.trailer.scale.setScalar(k);
      this.trailer.position.copy(A);
      // What you are carrying is shown lying in the trailer's box. The pieces are shrunk to fit (a real cardboard box
      // would not go in an RC trailer), laid in rows across the floor and then heaped in layers.
      const key = k + '|' + g.cargo.join(',');
      if (key !== this.loadKey) {
        this.loadKey = key; this.load.clear(); this.load.scale.setScalar(1 / k);
        const w = 0.54 * k, z0 = -1.02 * k, z1 = 1.18 * k, floor = 0.35 * k, cell = Math.max(0.035, w * 2 / 5);
        const cols = Math.max(2, Math.floor(w * 2 / cell)), rows = Math.max(2, Math.floor((z1 - z0) / cell)), per = cols * rows; let i = 0;
        for (const t of g.cargo.slice(0, 120)) {
          const m = t === 'bag' ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5, flatShading: true })) : buildLitter(t, (i * 0.37) % 1);
          const size = TYPES[t].size || 0.12, f = Math.min(1, cell * 0.95 / size);                       // shrink it to one cell of the grid
          const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(i * 78.233) * 12543.123) % 1, n = i % per, layer = Math.floor(i / per);
          m.scale.setScalar(f);
          m.position.set(-w + cell * ((n % cols) + 0.5) + (r1 - 0.5) * cell * 0.25, floor + cell * 0.3 + layer * cell * 0.55, z0 + cell * (Math.floor(n / cols) + 0.5) + (r2 - 0.5) * cell * 0.25);
          m.rotation.set((r1 - 0.5) * 0.5, r2 * 6.283, (TYPES[t].lie === 'side' ? Math.PI / 2 : 0) + (r1 - 0.5) * 0.5);
          this.load.add(m); i++;
        }
      }
      this.ball.visible = true; this.ball.position.copy(H);
    } else if (this.ball) this.ball.visible = false;
    if (this.shopOpen && (!this.atCamp())) this.closeShop();
  }

  // ---------- the shop ----------
  openShop() { this.shopOpen = true; $('shop').style.display = 'block'; this.draw(); }
  closeShop() { this.shopOpen = false; $('shop').style.display = 'none'; }
  click(d) {
    const g = this.game; let ok = true;
    if (d.buy) ok = g.buy(SHOP.find(i => i.id === d.buy));
    else if (d.car) { ok = g.buyCar(d.car); if (ok) this.swapCar(); }
    else if (d.act === 'repair') ok = g.repair();
    else if (d.act === 'close') { this.closeShop(); return; }
    else if (d.act === 'restart') { if (this.sure) { g.restart(); location.reload(); } else { this.sure = true; this.draw('Press "Wipe save" again to erase everything.'); return; } }
    this.sound[ok ? 'chime' : 'thud'](ok ? true : 3);
    this.draw(ok ? '' : 'Not enough money.');
  }
  draw(note = '') {
    const g = this.game, rc = g.repairCost(), m = g.s.money, btn = (attr, price, label) => `<button ${attr} class="${price > m ? 'cant' : ''}">${label}</button>`;
    let h = `<div class="shead"><b>Camp shop</b><span>$${m.toLocaleString('en-US')}</span><button class="ghost" data-act="close">Close · Enter</button></div>`;
    if (note) h += `<div class="snote">${note}</div>`;
    h += '<div class="sgroup">Workshop</div><div class="sgrid">';
    h += `<div class="srow"><div><b>Repairs</b><small>${rc ? 'Arm ' + Math.round(g.s.dmg.arm * 100) + '% · motor ' + Math.round(g.s.dmg.motor * 100) + '% · shocks ' + Math.round(g.s.dmg.susp * 100) + '% · body ' + Math.round(g.s.dmg.body * 100) + '%' : 'Nothing to fix'}</small></div>${rc ? btn('data-act="repair"', rc, 'Repair $' + rc) : '<i>good</i>'}</div></div>`;
    h += '<div class="sgroup">Cars</div><div class="sgrid">';
    for (const s of this.SPECS) { const info = CAR_INFO[s.id], own = g.s.owned.includes(s.id), cur = g.s.car === s.id; if (s.id === 'toy' && !own) continue;
      h += `<div class="srow"><div><b>${s.name}</b><small>${info.top} km/h · ${info.cargo} cargo slots · ${s.blurb}</small></div>${cur ? '<i>driving</i>' : own ? `<button class="ghost" data-car="${s.id}">Drive</button>` : btn(`data-car="${s.id}"`, info.price, '$' + info.price)}</div>`; }
    h += '</div>';
    let grp = '';
    for (const it of SHOP) { if (it.group !== grp) { h += (grp ? '</div>' : '') + `<div class="sgroup">${it.group}</div><div class="sgrid">`; grp = it.group; }
      const l = g.lvl(it.id), p = g.price(it), extra = it.id === 'outpost' && g.s.outpostsLeft ? ` · ${g.s.outpostsLeft} to place (O)` : '';
      h += `<div class="srow"><div><b>${it.name}${it.levels.length > 1 ? '  ' + '●'.repeat(l) + '○'.repeat(it.levels.length - l) : ''}</b><small>${p === null ? 'Fully upgraded' : it.say(l)}${extra}</small></div>${p === null ? '<i>owned</i>' : btn(`data-buy="${it.id}"`, p, '$' + p)}</div>`; }
    h += `</div><div class="sgroup">Save</div><div class="sgrid"><div class="srow"><div><b>Start over</b><small>Earned $${g.s.earned} · ${g.s.sold} pieces cleaned · ${ZONES[g.s.zone].name}</small></div><button class="ghost" data-act="restart">Wipe save</button></div></div>`;
    $('shop').innerHTML = h;
  }

  // ---------- the panel and the map ----------
  hud() {
    const g = this.game, car = this.car, n = this.nearestCamp();
    $('money').textContent = '$' + g.s.money.toLocaleString('en-US');
    // cargo: one square per slot (a row of dots beyond 60), filled as you load
    const cap = g.capacity(), used = g.used(), shown = Math.min(cap, 60), key = shown + ':' + Math.round(used / cap * shown);
    if (key !== this.pipKey) { this.pipKey = key; let h = ''; const on = Math.round(used / cap * shown); for (let i = 0; i < shown; i++) h += i < on ? '<i class="on"></i>' : '<i></i>'; $('pips').innerHTML = h; }
    const kg = g.load();
    $('cargo').textContent = Math.round(used) + ' / ' + cap + (g.cargo.length ? '  ·  ' + (kg < 1 ? Math.round(kg * 1000) + ' g' : kg.toFixed(1) + ' kg') + '  ·  $' + g.cargo.reduce((a, t) => a + WORTH(t), 0) : '  ·  empty');
    $('top').textContent = Math.round(car.topKmh) + ' km/h';
    const sig = g.signal, bars = Math.ceil(sig * 5 - 1e-6), sb = $('sigbars').children;
    for (let i = 0; i < 5; i++) sb[i].className = i < bars ? 'on' : '';
    $('signal').textContent = sig <= 0 ? 'no signal' : sig < 1 ? 'weak signal' : Math.round(g.nearest) + ' / ' + g.range + ' m';
    $('signal').style.color = sig >= 1 ? '' : sig > 0 ? 'var(--warn)' : 'var(--bad)';
    const dm = Math.round(g.damage() * 100); $('dmgrow').className = dm ? '' : 'ok';
    $('dmg').textContent = dm + '%  ·  repair $' + g.repairCost(); $('dmg').style.color = dm > 40 ? 'var(--bad)' : 'var(--warn)';
    const nz = ZONES[g.s.zone + 1], z0 = ZONES[g.s.zone].need;
    $('zname').textContent = ZONES[g.s.zone].name;
    $('zonefill').style.width = (nz ? Math.min(100, (g.s.sold - z0) / (nz.need - z0) * 100) : 100) + '%';
    $('clean').textContent = g.s.sold + ' cleaned' + (nz ? '  ·  ' + Math.max(0, nz.need - g.s.sold) + ' more opens ' + nz.name : '  ·  whole desert open');
    let rel = Math.atan2(n.c.x - car.pos.x, -(n.c.z - car.pos.z)) - Math.atan2(-car.F.x, -car.F.z) + Math.PI; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    $('base').innerHTML = '<small>' + (n.d < 3.2 ? 'Enter = shop' : 'Camp') + '</small>' + Math.round(n.d) + ' m ' + ARROWS[((Math.round(-rel / 0.7854 + 4) % 8) + 8) % 8];
    let det = '';
    if (g.lvl('detector')) { const f = g.detect(car, this.litter.items); if (f) { let a = Math.atan2(f.o.pos.x - car.pos.x, -(f.o.pos.z - car.pos.z)) - Math.atan2(-car.F.x, -car.F.z) + Math.PI; a = Math.atan2(Math.sin(a), Math.cos(a)); det = 'Metal ' + f.d.toFixed(1) + ' m ' + ARROWS[((Math.round(-a / 0.7854 + 4) % 8) + 8) % 8]; if ((this.detT -= 0.1) < 0) { this.detT = 0.15 + f.d * 0.08; this.sound.ping(1400, 0.06, 0.05); } } }
    $('detector').textContent = det;
    return g.msgT > 0 ? g.msg : g.signal < 1 ? g.why : '';
  }
  map() {
    return;                                             // the map has been removed from the game
    const cv = $('map'), g = this.game;
    const c = cv.getContext('2d'), W = cv.width, home = this.camps[0], car = this.car, span = Math.min(900, ZONES[g.s.zone].radius * 1.25), k = W / 2 / span;
    c.clearRect(0, 0, W, W); c.fillStyle = 'rgba(18,14,10,.7)'; c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, 7); c.fill();
    const P = (x, z) => [W / 2 + (x - home.x) * k, W / 2 + (z - home.z) * k];
    ZONES.forEach((z, i) => { if (z.radius > 1e8) return; c.strokeStyle = i <= g.s.zone ? 'rgba(127,214,107,.55)' : 'rgba(226,85,61,.5)'; c.setLineDash(i < g.s.zone ? [] : [4, 4]); c.beginPath(); c.arc(W / 2, W / 2, z.radius * k, 0, 7); c.stroke(); });
    c.setLineDash([]);
    for (const cp of this.camps) { const [x, y] = P(cp.x, cp.z); c.strokeStyle = 'rgba(120,180,255,.35)'; c.beginPath(); c.arc(x, y, g.range * k, 0, 7); c.stroke(); c.fillStyle = '#ff8a3a'; c.fillRect(x - 3, y - 3, 6, 6); }
    c.fillStyle = '#ffe2a8'; for (const o of this.litter.items) if (o.find && this.litter.found.has(o.type)) { const [x, y] = P(o.pos.x, o.pos.z); c.beginPath(); c.arc(x, y, 2.5, 0, 7); c.fill(); }
    const [cx, cy] = P(car.pos.x, car.pos.z), a = Math.atan2(car.F.x, car.F.z);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(cx + Math.sin(a) * 7, cy + Math.cos(a) * 7); c.lineTo(cx + Math.sin(a + 2.5) * 5, cy + Math.cos(a + 2.5) * 5); c.lineTo(cx + Math.sin(a - 2.5) * 5, cy + Math.cos(a - 2.5) * 5); c.fill();
  }
}
