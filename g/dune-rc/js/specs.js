// The three RC cars as numbers: real 1/10-scale weights and sizes. Lengths in metres, weights in kg.
// Wheel order is always front-left, front-right, rear-left, rear-right.
// r = tyre radius, half = half the tyre width, ay = where its suspension hangs from (above the centre of weight),
// drive = that wheel's share of the motor.
const wheels = (fx, fz, fr, fh, fay, fd, rx, rz, rr, rh, ray, rd) => [
  { x: -fx, z: fz, r: fr, half: fh, ay: fay, front: true, drive: fd }, { x: fx, z: fz, r: fr, half: fh, ay: fay, front: true, drive: fd },
  { x: -rx, z: rz, r: rr, half: rh, ay: ray, front: false, drive: rd }, { x: rx, z: rz, r: rr, half: rh, ay: ray, front: false, drive: rd },
];

export const SPECS = [
  {
    id: 'buggy', name: 'Dune buggy', blurb: 'rear-wheel drive, all-rounder',
    mass: 2.5, inertia: [0.05, 0.06, 0.025],                 // pitch, yaw, roll
    wheels: wheels(0.133, -0.189, 0.054, 0.023, 0.060, 0, 0.129, 0.155, 0.066, 0.023, 0.065, 0.5),
    travel: 0.115, spring: 175, damp: 15,
    muFront: 0.90, muRear: 1.12, lock: 0.42, slipper: 17, push: 36,
    belly: -0.027, top: 0.165, halfW: 0.085, nose: -0.215, tail: 0.225, restY: 0.09,
    batteryWh: 37,                                            // 2S 5000 mAh pack
    sound: { pitch: 1.0, whine: 0.5 },
  },
  {
    id: 'rail', name: 'Sand rail', blurb: 'rear-wheel drive, lightest and fastest off the line, skinny front tyres',
    mass: 2.0, inertia: [0.04, 0.05, 0.02],
    wheels: wheels(0.120, -0.210, 0.050, 0.014, 0.074, 0, 0.140, 0.150, 0.070, 0.035, 0.081, 0.5),
    travel: 0.125, spring: 150, damp: 13,
    muFront: 0.85, muRear: 1.20, lock: 0.45, slipper: 18, push: 42,
    belly: -0.030, top: 0.130, halfW: 0.075, nose: -0.250, tail: 0.200, restY: 0.09,
    batteryWh: 30,
    sound: { pitch: 1.25, whine: 0.7 },
  },
  {
    id: 'truck', name: 'Desert truck', blurb: 'four-wheel drive, heavy, long suspension, climbs best',
    mass: 3.4, inertia: [0.095, 0.11, 0.045],
    wheels: wheels(0.109, -0.170, 0.0535, 0.024, 0.0895, 0.25, 0.104, 0.170, 0.0515, 0.019, 0.0875, 0.25),   // weight kept low (7.5 cm up) so it corners without rolling
    travel: 0.155, spring: 190, damp: 20,
    muFront: 0.92, muRear: 1.10, lock: 0.38, slipper: 26, push: 46,
    belly: -0.046, top: 0.131, halfW: 0.112, nose: -0.268, tail: 0.314, restY: 0.09,
    batteryWh: 50,
    sound: { pitch: 0.8, whine: 0.35 },
  },
  {
    // the car you start with: a cheap toy-shop RC car. Light, slow, tiny wheels, a few AA cells.
    id: 'toy', name: 'Toy car', blurb: 'cheap plastic toy: slow, tiny wheels, small battery',
    mass: 0.9, inertia: [0.008, 0.010, 0.004], wheelI: 1.2e-5,
    wheels: wheels(0.075, -0.095, 0.035, 0.014, 0.0095, 0, 0.075, 0.095, 0.035, 0.014, 0.0095, 0.5),
    travel: 0.03, spring: 210, damp: 5,
    muFront: 0.80, muRear: 0.95, lock: 0.40, slipper: 5, push: 6,
    belly: -0.012, top: 0.065, halfW: 0.05, nose: -0.14, tail: 0.14, restY: 0.05,
    batteryWh: 6,
    sound: { pitch: 1.6, whine: 0.9 },
  },
];
