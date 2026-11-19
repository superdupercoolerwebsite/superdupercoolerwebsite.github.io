// Simple test driver: follows the centreline. Used for headless checks and ?auto=1.
import { Vector3, Quaternion } from 'three';
import { DS } from './track.js';

const v = new Vector3(), q = new Quaternion();

export function autopilot(car, T, i, pace = 1) {
  const sp = car.speed;
  const la = Math.min(T.n - 1, i + Math.round((7 + sp * 0.5) / DS));
  v.set(T.px[la] - car.pos.x, 0, T.pz[la] - car.pos.z).applyQuaternion(q.copy(car.quat).invert());
  const ang = Math.atan2(v.x, v.z);
  let k = 0;
  const span = Math.round((12 + sp * 2.6) / DS);
  for (let j = i; j < Math.min(T.n, i + span); j++) k = Math.max(k, Math.abs(T.curv[j]));
  const vt = Math.min(44, Math.max(10, Math.sqrt(6.5 * pace / Math.max(k, 1e-4))));
  const e = vt - sp;
  return {
    steer: Math.max(-1, Math.min(1, ang * 2.4)), analog: true,
    throttle: e > 0 ? Math.min(1, 0.25 + e * 0.25) : 0,
    brake: e < -1.5 ? Math.min(1, -e * 0.2) : 0, hand: 0,
  };
}
