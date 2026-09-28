// Dynamic score, synthesised live:
//  - calm: low drone + sparse "ghost piano" notes
//  - unease: high dissonant string cluster with tremolo
//  - danger: heartbeat (driven by fear) and swelling strings
//  - chase: pounding drums, brass stabs, an endless Shepard-tone riser and
//    distortion on the whole score
export class Music {
  constructor(audio) {
    this.audio = audio;
    const ctx = (this.ctx = audio.ctx);
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    // distortion stage for chases
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeCurve(3);
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.out.connect(this.dry).connect(audio.musicBus);
    this.out.connect(this.shaper).connect(this.wet).connect(audio.musicBus);
    this._buildDrone();
    this._buildStrings();
    this._buildShepard();
    this.nextBeat = 0;
    this.beatIndex = 0;
    this.heartT = 0;
    this.pianoT = 6;
    this.intensity = 0;
    this.chase = 0;
    this.silent = 0;
  }

  _osc(type, freq, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start();
    return o;
  }

  _buildDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 3;
    this.droneFilter = lp;
    for (const [f, d] of [[55, 0], [55, 7], [82.4, -5], [58.3, 3]]) this._osc('sawtooth', f, d).connect(lp);
    lp.connect(this.droneGain).connect(this.out);
    // slow filter wobble
    const lfo = this._osc('sine', 0.07);
    const lg = ctx.createGain();
    lg.gain.value = 80;
    lfo.connect(lg).connect(lp.frequency);
  }

  _buildStrings() {
    const ctx = this.ctx;
    this.strGain = ctx.createGain();
    this.strGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.8;
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    for (const [f, d] of [[622.3, 0], [659.3, 4], [932.3, -6], [987.8, 9], [1318.5, -3]]) this._osc('sawtooth', f, d).connect(bp);
    bp.connect(trem).connect(this.strGain).connect(this.out);
    const lfo = this._osc('sine', 7.5);
    const lg = ctx.createGain();
    lg.gain.value = 0.4;
    lfo.connect(lg).connect(trem.gain);
    this.strFilter = bp;
  }

  _buildShepard() {
    // six octave-spaced sines gliding upward forever; amplitude follows a
    // bell curve over log-frequency so the rise never "arrives"
    const ctx = this.ctx;
    this.shepGain = ctx.createGain();
    this.shepGain.gain.value = 0;
    this.shep = [];
    for (let i = 0; i < 6; i++) {
      const o = this._osc('triangle', 100);
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.shepGain);
      this.shep.push({ o, g, k: i / 6 });
    }
    this.shepGain.connect(this.out);
  }

  /** state: { tension 0..1, chase bool, fear 0..1, silent bool, outage bool } */
  update(dt, state) {
    const t = this.ctx.currentTime;
    const tension = state.tension || 0;
    const chase = state.chase ? 1 : 0;
    this.chase += (chase - this.chase) * Math.min(1, dt * (chase ? 2.5 : 0.5));
    this.intensity += (tension - this.intensity) * Math.min(1, dt * 1.2);
    const silentK = state.silent ? 0 : 1;
    // drone always there, louder in the dark
    this.droneGain.gain.setTargetAtTime((0.07 + this.intensity * 0.06 + (state.outage ? 0.04 : 0)) * silentK, t, 0.4);
    this.droneFilter.frequency.setTargetAtTime(150 + this.intensity * 400 + this.chase * 500, t, 0.3);
    // strings rise with unease
    const s = Math.max(0, this.intensity - 0.25) * 0.09 + this.chase * 0.05;
    this.strGain.gain.setTargetAtTime(s * silentK, t, 0.35);
    this.strFilter.frequency.setTargetAtTime(900 + this.intensity * 1600, t, 0.5);
    // chase layers
    this.wet.gain.setTargetAtTime(this.chase * 0.35, t, 0.2);
    this.dry.gain.setTargetAtTime(1 - this.chase * 0.3, t, 0.2);
    this.shepGain.gain.setTargetAtTime(this.chase * 0.08 * silentK, t, 0.3);
    if (this.chase > 0.02) {
      const period = 9;
      for (const sh of this.shep) {
        const u = ((t / period) + sh.k) % 1;
        const f = 80 * Math.pow(2, u * 6);
        sh.o.frequency.setTargetAtTime(f, t, 0.05);
        const a = Math.exp(-Math.pow((u - 0.5) * 3.2, 2));
        sh.g.gain.setTargetAtTime(a, t, 0.05);
      }
      this._drums(t, silentK);
    } else {
      this.nextBeat = t;
    }
    // heartbeat
    const fear = state.fear || 0;
    if (fear > 0.15 && !state.silent) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        const bpm = 60 + fear * 95;
        this.heartT = 60 / bpm;
        this.audio.heartbeat(fear);
      }
    }
    // ghost piano when calm
    if (this.intensity < 0.35 && !state.silent) {
      this.pianoT -= dt;
      if (this.pianoT <= 0) {
        this.pianoT = 7 + Math.random() * 16;
        const cam = this.audio.game.camera.position;
        const p = { x: cam.x + (Math.random() - 0.5) * 12, y: cam.y, z: cam.z + (Math.random() - 0.5) * 12 };
        this.audio.ghostPiano(this.audio.game.camera.position.clone().set(p.x, p.y, p.z));
      }
    }
  }

  _drums(t, k) {
    const bpm = 152;
    const beat = 60 / bpm / 2; // eighth notes
    const pattern = [1, 0, 0.5, 0, 1, 0.6, 0, 0.4, 1, 0, 0.5, 0.3, 1, 0.6, 0.8, 0.9];
    while (this.nextBeat < t + 0.12) {
      const i = this.beatIndex % pattern.length;
      const v = pattern[i] * this.chase * k;
      if (v > 0.05) this._drum(this.nextBeat, v);
      if (i % 8 === 0 && this.chase > 0.5) this._stab(this.nextBeat, 0.5 * this.chase * k);
      this.nextBeat += beat;
      this.beatIndex++;
    }
  }

  _drum(when, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.18);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.55 * v, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.45);
    o.connect(g).connect(this.out);
    o.start(when);
    o.stop(when + 0.5);
  }

  _stab(when, v) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, when);
    lp.frequency.exponentialRampToValueAtTime(2400, when + 0.08);
    lp.frequency.exponentialRampToValueAtTime(400, when + 0.6);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.18 * v, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.8);
    for (const f of [110, 116.5, 164.8, 174.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(when);
      o.stop(when + 0.85);
    }
    lp.connect(g).connect(this.out);
  }
}

function makeCurve(k) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}
