// Fully synthesized sound: four-cylinder turbo engine, gravel roar, stones, tyre scrub,
// wind, turbo whistle and blow-off, shift pops, impacts, countdown beeps. No samples.
export function createAudio() {
  let ac = null, n = null, boost = 0, lastThr = 0, lastGear = 1, stoneT = 0, lastImpact = 0, vol = 1, engVol = 1, on = true;

  function noiseBuf(sec) {
    const len = ac.sampleRate * sec, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.6 + last * 6; }
    return b;
  }
  function loopNoise(buf) { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
  const filt = (type, f, q = 1) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const master = gain(0.7), comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.18;
      master.connect(comp); comp.connect(ac.destination);
      const engBus = gain(1), fxBus = gain(1); engBus.connect(master); fxBus.connect(master);

      // engine: one cycle = two crank turns; harmonic 4 is the firing order, 2 and 6 give the burble
      const H = 48, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
      for (let k = 1; k <= H; k++) {
        const order = k % 4 === 0 ? 1 : k % 2 === 0 ? 0.42 : 0.2;
        im[k] = order / Math.pow(k, 0.82) * (k % 3 === 0 ? -1 : 1); re[k] = order * 0.25 / Math.pow(k, 0.9) * (k % 5 === 0 ? -1 : 1);
      }
      const wave = ac.createPeriodicWave(re, im);
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), sub = ac.createOscillator();
      o1.setPeriodicWave(wave); o2.setPeriodicWave(wave); o2.detune.value = 7; sub.type = 'sine';
      const drive = ac.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6) * 0.9; }
      drive.curve = curve; drive.oversample = '2x';
      const pre = gain(0.5), lp = filt('lowpass', 900, 0.8), body = filt('peaking', 190, 1.4), bark = filt('peaking', 620, 1.1), eg = gain(0), sg = gain(0);
      body.gain.value = 7; bark.gain.value = 4;
      o1.connect(pre); o2.connect(pre); pre.connect(drive); drive.connect(lp); lp.connect(body); body.connect(bark); bark.connect(eg); eg.connect(engBus);
      sub.connect(sg); sg.connect(engBus);
      o1.start(); o2.start(); sub.start();
      // intake / exhaust rasp rides the throttle
      const nb = noiseBuf(2.5);
      const rasp = loopNoise(nb), rbp = filt('bandpass', 700, 1.2), rg = gain(0); rasp.connect(rbp); rbp.connect(rg); rg.connect(engBus);
      // turbo whistle
      const tw = ac.createOscillator(), tg = gain(0), tn = loopNoise(nb), tbp = filt('bandpass', 5000, 6), tng = gain(0);
      tw.type = 'sine'; tw.connect(tg); tg.connect(engBus); tn.connect(tbp); tbp.connect(tng); tng.connect(engBus); tw.start();
      // road, scrub, wind
      const road = loopNoise(nb), rlp = filt('lowpass', 420, 0.6), roadG = gain(0); road.connect(rlp); rlp.connect(roadG); roadG.connect(fxBus);
      const grit = loopNoise(nb), gbp = filt('bandpass', 2600, 0.7), gritG = gain(0); grit.playbackRate.value = 1.31; grit.connect(gbp); gbp.connect(gritG); gritG.connect(fxBus);
      const skid = loopNoise(nb), sbp = filt('bandpass', 1500, 1.6), skidG = gain(0); skid.playbackRate.value = 0.77; skid.connect(sbp); sbp.connect(skidG); skidG.connect(fxBus);
      const wind = loopNoise(nb), whp = filt('highpass', 1800, 0.5), windG = gain(0); wind.playbackRate.value = 1.13; wind.connect(whp); whp.connect(windG); windG.connect(fxBus);
      n = { master, engBus, fxBus, o1, o2, sub, lp, eg, sg, rbp, rg, tw, tg, tbp, tng, rlp, roadG, gbp, gritG, sbp, skidG, windG, nb };
      apply();
    } catch (e) { ac = null; n = null; }
  }

  function apply() { if (n) { n.master.gain.setTargetAtTime(on ? 0.7 * vol : 0, ac.currentTime, 0.05); n.engBus.gain.setTargetAtTime(engVol, ac.currentTime, 0.05); } }
  function setVolumes(sound, master, engine) { on = sound; vol = master; engVol = engine; apply(); }

  // short filtered noise burst
  function burst(freq, q, dur, level, type = 'bandpass', bus = 'fxBus') {
    if (!n || !on) return;
    const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = n.nb;
    const f = filt(type, freq, q), g = gain(0);
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(n[bus]); s.start(t, Math.random() * 2, dur + 0.05);
  }
  function beep(freq, dur = 0.13, level = 0.22) {
    if (!n || !on) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = gain(0);
    o.type = 'square'; o.frequency.value = freq; g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = filt('lowpass', 2400); o.connect(f); f.connect(g); g.connect(n.fxBus); o.start(t); o.stop(t + dur + 0.02);
  }

  function update(dt, car, active) {
    if (!n) return;
    const t = ac.currentTime, set = (p, v, tc = 0.04) => p.setTargetAtTime(v, t, tc);
    const thr = active ? car.throttle : 0, rpm = car.rpm, f0 = rpm / 120, sp = car.speed;
    set(n.o1.frequency, f0, 0.025); set(n.o2.frequency, f0 * 1.003, 0.025); set(n.sub.frequency, f0 * 2, 0.025);
    set(n.lp.frequency, 380 + rpm * 0.2 + thr * (700 + rpm * 0.28), 0.05);
    const load = 0.34 + 0.66 * thr;
    set(n.eg.gain, active ? 0.2 * load * (0.75 + rpm / 9000) : 0.05, 0.05);
    set(n.sg.gain, active ? 0.11 * load : 0.02, 0.05);
    set(n.rbp.frequency, 350 + rpm * 0.19, 0.05); set(n.rg.gain, active ? thr * 0.07 * (0.4 + rpm / 7000) : 0, 0.05);
    // turbo spool
    const target = thr * Math.max(0, Math.min(1, (rpm - 2400) / 2600));
    boost += (target - boost) * Math.min(1, dt * (target > boost ? 2.6 : 7));
    set(n.tw.frequency, 2600 + boost * 6200, 0.06); set(n.tg.gain, boost * boost * 0.012, 0.06);
    set(n.tbp.frequency, 3500 + boost * 5000, 0.06); set(n.tng.gain, boost * 0.02, 0.06);
    if (active) {
      if (lastThr > 0.6 && thr < 0.15 && boost > 0.45) { burst(3400, 1.4, 0.32, 0.16 * boost, 'bandpass', 'engBus'); burst(900, 0.8, 0.12, 0.1, 'bandpass', 'engBus'); boost *= 0.3; }
      if (car.gear !== lastGear) { burst(160, 1.2, 0.09, 0.4, 'lowpass', 'engBus'); if (car.gear < lastGear && rpm > 4500) burst(420, 2, 0.13, 0.22, 'bandpass', 'engBus'); }
    }
    lastThr = thr; lastGear = car.gear;
    // surface
    const v = Math.min(1, sp / 42), off = car.offroad || 0, slip = Math.min(1.6, car.slip || 0);
    set(n.rlp.frequency, 220 + sp * 9, 0.1); set(n.roadG.gain, v * (0.2 + 0.25 * off), 0.08);
    set(n.gbp.frequency, 1800 + sp * 40, 0.1); set(n.gritG.gain, v * (0.05 + 0.06 * off) + slip * 0.02, 0.08);
    set(n.sbp.frequency, 900 + sp * 22, 0.1); set(n.skidG.gain, Math.min(1, sp / 12) * Math.max(0, slip - 0.55) * 0.2, 0.06);
    set(n.windG.gain, v * v * 0.07, 0.15);
    stoneT -= dt;
    if (active && sp > 7 && stoneT <= 0) {
      stoneT = (0.035 + Math.random() * 0.2) * (42 / Math.max(8, sp)) / (1 + slip);
      burst(1500 + Math.random() * 3800, 5 + Math.random() * 8, 0.022 + Math.random() * 0.03, (0.04 + Math.random() * 0.1) * (0.5 + v));
    }
    if (car.impact > 0.9 && lastImpact <= 0.9) { burst(110, 0.9, 0.3, 0.9, 'lowpass'); burst(1700, 1, 0.12, 0.25); }
    lastImpact = car.impact;
  }

  return { init, update, beep, burst, setVolumes, get ready() { return !!n; } };
}
