// Stunt scoring: watches each jump, counts real rotation, and only pays out if you land it on your wheels.
import * as THREE from 'three';

const wl = new THREE.Vector3(), qi = new THREE.Quaternion();

export class Stunts {
  constructor() { this.total = 0; this.best = 0; this.text = ''; this.show = 0; this.event = null; this.reset(); }
  reset() { this.air = 0; this.pitch = 0; this.roll = 0; this.yaw = 0; this.judging = 0; this.flying = false; }

  // call every physics step
  step(car, dt) {
    this.show -= dt;
    if (car.airTime > 0) {
      if (!this.flying) { this.reset(); this.flying = true; }
      this.air = Math.max(this.air, car.airTime); this.judging = 0;     // a bounce is still the same jump
      qi.copy(car.q).invert(); wl.copy(car.w).applyQuaternion(qi);     // how fast it is turning about its own axes
      this.pitch += wl.x * dt; this.yaw += wl.y * dt; this.roll += wl.z * dt;
    } else if (this.flying) {
      // touched down: give it half a second to show whether it stays on its wheels
      this.judging += dt;
      if (this.judging < 0.5) return;
      this.flying = false;
      const clean = car.U.y > 0.7 && car.grounded >= 3;
      const flips = Math.floor(Math.abs(this.pitch) / 6.283 + 0.2), rolls = Math.floor(Math.abs(this.roll) / 6.283 + 0.2), halfSpins = Math.floor(Math.abs(this.yaw) / 3.1416 + 0.15);
      if (this.air < 0.45 && !flips && !rolls && !halfSpins) return;   // a little hop is not a stunt
      if (flips > 6 || rolls > 6 || this.air > 12) return;             // that was a glitch, not a jump
      const names = []; let pts = 0;
      if (flips) { names.push((flips > 1 ? ['', '', 'DOUBLE ', 'TRIPLE '][Math.min(3, flips)] : '') + (this.pitch > 0 ? 'BACKFLIP' : 'FRONT FLIP')); pts += 500 * flips * flips; }
      if (rolls) { names.push((rolls > 1 ? 'DOUBLE ' : '') + 'BARREL ROLL'); pts += 400 * rolls * rolls; }
      if (halfSpins) { names.push(halfSpins * 180 + ' SPIN'); pts += 150 * halfSpins; }
      if (this.air >= 1.2) names.push('BIG AIR'); else if (!names.length) names.push('AIR');
      pts += Math.round(100 * this.air * this.air);
      if (clean) {
        this.total += pts; this.best = Math.max(this.best, pts);
        this.text = names.join(' + ') + '   ' + this.air.toFixed(1) + ' s   +' + pts; this.event = 'score';
      } else { this.text = 'CRASHED: ' + names.join(' + ') + '   no points'; this.event = 'crash'; }
      this.show = 3;
    }
  }
}
