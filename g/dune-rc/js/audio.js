// Sound, made live from the physics: motor pitch follows the wheels, sand hiss follows wheel slip,
// wind follows speed and weather, knocks follow real impacts. Nothing is a recording.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }

  // browsers only allow sound after a key press or click
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.6; this.master.connect(c.destination);
    const noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const loop = (type, freq, q) => { const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { f, g }; };
    this.hiss = loop('bandpass', 3200, 0.7); this.wind = loop('lowpass', 380, 0.4); this.flap = loop('bandpass', 900, 1.2);
    // tyres rumbling over the sand, and thrown sand pattering on the bodywork
    this.rumble = loop('lowpass', 120, 0.5); this.patter = loop('highpass', 5200, 0.5);
    // electric motor: a low buzz plus the high whine of the gears
    const osc = (type) => { const o = c.createOscillator(); o.type = type; const g = c.createGain(); g.gain.value = 0; o.connect(g); return { o, g }; };
    this.m1 = osc('sawtooth'); this.m2 = osc('square'); this.m3 = osc('sine');
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(this.master);
    this.m1.g.connect(lp); this.m2.g.connect(lp); this.m3.g.connect(this.master);
    this.m1.o.start(); this.m2.o.start(); this.m3.o.start();
    // the steering servo: a short whirr whenever the wheels are turned
    this.servo = osc('triangle'); this.servo.g.connect(this.master); this.servo.o.start(); this.ps = 0;
  }

  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.6; }

  // every frame
  update(car, weather, dt) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, S = car.spec.sound;
    let om = 0, n = 0, slip = 0, on = 0;
    for (const w of car.wheels) { if (w.drive) { om += Math.abs(w.omega); n++; } if (w.on) { on++; slip += Math.abs(w.slip) + Math.abs(w.vs); } }
    om /= n || 1;
    const live = car.battery > 0 ? 1 : 0, load = Math.abs(car.thr) * live;
    const f = (38 + om * 0.95) * S.pitch;
    this.m1.o.frequency.setTargetAtTime(f, t, 0.03); this.m2.o.frequency.setTargetAtTime(f * 2.01, t, 0.03); this.m3.o.frequency.setTargetAtTime(f * 7.3, t, 0.03);
    this.m1.g.gain.setTargetAtTime((0.015 + 0.09 * load) * Math.min(1, 0.25 + om / 120) * live, t, 0.05);
    this.m2.g.gain.setTargetAtTime(0.03 * load * live, t, 0.05);
    this.m3.g.gain.setTargetAtTime(0.035 * S.whine * Math.min(1, om / 200) * (0.3 + 0.7 * load) * live, t, 0.05);
    const sp = car.vel.length();
    this.hiss.g.gain.setTargetAtTime(on ? Math.min(0.5, 0.012 * sp + 0.05 * slip / on) : 0, t, 0.04);
    this.hiss.f.frequency.setTargetAtTime(2200 + 120 * sp, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.7, 0.03 + 0.012 * sp + 0.03 * weather.speed), t, 0.2);
    this.wind.f.frequency.setTargetAtTime(260 + 18 * sp + 25 * weather.speed, t, 0.3);
    this.rumble.g.gain.setTargetAtTime(on ? Math.min(0.55, 0.022 * sp) : 0, t, 0.05);
    this.rumble.f.frequency.setTargetAtTime(90 + 9 * sp, t, 0.1);
    this.patter.g.gain.setTargetAtTime(on ? Math.min(0.22, 0.018 * slip / on) : 0, t, 0.03);
    const turn = Math.abs(car.steer - this.ps) / Math.max(dt, 1e-3); this.ps = car.steer;
    this.servo.o.frequency.setTargetAtTime(280 + 60 * Math.min(6, turn), t, 0.02);
    this.servo.g.gain.setTargetAtTime(Math.min(0.022, 0.006 * turn) * live, t, 0.02);
    const bag = car.bagDrag > 0 || car.wheels.some(w => w.jam > 0);
    this.flap.g.gain.setTargetAtTime(bag ? 0.12 * (0.5 + 0.5 * Math.sin(t * 60)) * Math.min(1, sp / 4 + 0.3) : 0, t, 0.02);
  }

  burst(type, freq, q, vol, len) {
    const c = this.ctx; if (!c || this.muted) return; const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + len + 0.02);
  }
  ping(freq, vol, len) {
    const c = this.ctx; if (!c || this.muted) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + len + 0.02);
  }
  // a wheel or the chassis slamming into sand: v = how hard, m/s
  thud(v) { if (v > 0.8) this.burst('lowpass', 160 + 40 * v, 0.7, Math.min(0.9, 0.12 * v), 0.16 + 0.03 * v); }
  // a hard landing: the suspension bottoms out and everything on the car rattles
  rattle(v) {
    this.burst('bandpass', 700 + Math.random() * 500, 3, Math.min(0.45, 0.05 * v), 0.07);
    setTimeout(() => this.burst('bandpass', 1500 + Math.random() * 900, 4, Math.min(0.3, 0.035 * v), 0.05), 45);
    this.burst('lowpass', 70, 0.7, Math.min(0.9, 0.1 * v), 0.3);
  }
  // hitting a piece of litter: the sound depends on what it is made of and how hard
  knock(kind, hard) {
    const v = Math.min(0.5, 0.25 * hard + 0.03);
    if (kind === 'can') { this.ping(2600 + Math.random() * 1500, v, 0.09); this.burst('bandpass', 5200, 3, v * 0.6, 0.06); }
    else if (kind === 'gbottle') { this.ping(4800 + Math.random() * 1200, v, 0.22); }
    else if (kind === 'pbottle' || kind === 'cup') this.burst('bandpass', 1500, 2, v, 0.07);
    else if (kind === 'box' || kind === 'flipflop') this.burst('lowpass', 420, 0.8, v, 0.12);
    else if (kind === 'trolley') { this.ping(1900, v, 0.3); this.burst('bandpass', 3800, 4, v, 0.25); }
    else this.burst('lowpass', 260, 0.8, Math.min(0.8, v * 1.6), 0.14);
  }
  chime(good) { if (good) { this.ping(880, 0.2, 0.25); setTimeout(() => this.ping(1320, 0.2, 0.35), 110); } else this.burst('lowpass', 200, 0.6, 0.5, 0.35); }
}
