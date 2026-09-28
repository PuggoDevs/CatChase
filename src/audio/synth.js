// Offline sound synthesis. Every sound in the game is generated here as an
// AudioBuffer at startup - creaks, footsteps, slams, glass, a distorted
// laugh, whispers, meows, purring, hisses, heartbeats, stingers...
// Raw DSP in JS (biquads, envelopes, noise), no files.

const SR = 44100;

function buf(ctx, seconds, channels = 1) {
  return ctx.createBuffer(channels, Math.max(1, Math.floor(seconds * SR)), SR);
}

// ---------------------------------------------------------------- DSP bits
class Biquad {
  constructor(type, freq, q = 0.707, gainDb = 0) { this.set(type, freq, q, gainDb); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, freq, q = 0.707, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w), sin = Math.sin(w), alpha = sin / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'peak': b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
      default: b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

let seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const noise = () => rnd() * 2 - 1;

function normalize(data, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < data.length; i++) data[i] *= k; }
  return data;
}

function fadeEdges(data, fadeIn = 0.003, fadeOut = 0.02) {
  const fi = Math.floor(fadeIn * SR), fo = Math.floor(fadeOut * SR);
  for (let i = 0; i < fi && i < data.length; i++) data[i] *= i / fi;
  for (let i = 0; i < fo && i < data.length; i++) data[data.length - 1 - i] *= i / fo;
  return data;
}

// Formant table for vowel-ish sounds (F1, F2, F3)
const VOWELS = { a: [800, 1150, 2900], e: [400, 2000, 2550], i: [300, 2300, 3000], o: [450, 800, 2830], u: [325, 700, 2530], ah: [700, 1220, 2600] };

/** Glottal-ish source through formant filters. pitch(t), vowel(t)->[f1,f2,f3], amp(t) */
function voice(len, pitch, vowelFn, amp, { breath = 0.08, rough = 0 } = {}) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  const f = [new Biquad('bandpass', 700, 6), new Biquad('bandpass', 1200, 8), new Biquad('bandpass', 2600, 10)];
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = pitch(t) * (1 + (rough ? noise() * rough * 0.02 : 0));
    ph += p / SR;
    if (ph > 1) ph -= 1;
    // band-limited-ish sawtooth pulse + breath noise
    let src = (2 * ph - 1) * 0.6 + (ph < 0.08 ? 0.8 : 0) + noise() * breath;
    if (i % 64 === 0) {
      const v = vowelFn(t);
      f[0].set('bandpass', v[0], 5); f[1].set('bandpass', v[1], 7); f[2].set('bandpass', v[2], 9);
    }
    const y = f[0].p(src) * 1.0 + f[1].p(src) * 0.6 + f[2].p(src) * 0.25;
    out[i] = y * amp(t);
  }
  return out;
}

function distort(data, drive = 3) {
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * drive);
  return data;
}

/** Resample (pitch shift by speed) - used to make things slower and wrong. */
function resample(data, speed) {
  const n = Math.floor(data.length / speed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * speed, i0 = Math.floor(x), fr = x - i0;
    out[i] = (data[i0] || 0) * (1 - fr) + (data[i0 + 1] || 0) * fr;
  }
  return out;
}

function toBuffer(ctx, data) {
  const b = buf(ctx, data.length / SR);
  b.copyToChannel(data, 0);
  return b;
}

// ---------------------------------------------------------------- generators
const GEN = {
  // footsteps per surface: short noise burst through a resonance + low thump
  step(variant) {
    const [surface, v] = variant.split(':');
    const len = 0.18;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const settings = {
      wood: { f: 420 + v * 60, q: 2.5, thump: 85, click: 0.2, decay: 38 },
      tile: { f: 2200 + v * 200, q: 3, thump: 70, click: 0.7, decay: 60 },
      carpet: { f: 300 + v * 30, q: 0.8, thump: 60, click: 0, decay: 45 },
      stone: { f: 1300 + v * 150, q: 2, thump: 75, click: 0.45, decay: 55 },
      grass: { f: 3000, q: 0.6, thump: 45, click: 0, decay: 30 },
    }[surface] || { f: 500, q: 2, thump: 80, click: 0.2, decay: 40 };
    const bp = new Biquad('bandpass', settings.f, settings.q);
    const lp = new Biquad('lowpass', 3500, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.exp(-t * settings.decay);
      const scuff = t < 0.06 ? noise() * (1 - t / 0.06) * 0.3 : 0;
      let s = bp.p(noise()) * env * 1.4 + Math.sin(2 * Math.PI * settings.thump * t) * Math.exp(-t * 55) * 0.9;
      if (t < 0.004) s += noise() * settings.click * 2;
      out[i] = lp.p(s + scuff * (surface === 'wood' ? 0.4 : 0.2));
    }
    return fadeEdges(normalize(out, 0.8));
  },

  // friction stick-slip: an impulse train of ringing resonances (doors, floors)
  creak(v) {
    const len = 0.5 + (v % 3) * 0.35;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const res = [new Biquad('bandpass', 480 + v * 37, 18), new Biquad('bandpass', 1120 + v * 53, 22), new Biquad('bandpass', 2380 + v * 90, 25)];
    let next = 0;
    const base = 22 + (v % 4) * 9;
    for (let i = 0; i < n; i++) {
      const t = i / SR, u = t / len;
      const rate = base + 60 * Math.sin(u * Math.PI) * (0.5 + 0.5 * Math.sin(u * 7 + v));
      let imp = 0;
      if (i >= next) { imp = 1; next = i + Math.floor(SR / Math.max(8, rate * (0.8 + rnd() * 0.4))); }
      const env = Math.sin(Math.min(1, u * 1.2) * Math.PI) ** 0.6;
      const x = imp + noise() * 0.02;
      out[i] = (res[0].p(x) * 1.2 + res[1].p(x) * 0.9 + res[2].p(x) * 0.5) * env;
    }
    return fadeEdges(normalize(out, 0.85), 0.01, 0.05);
  },

  slam() {
    const len = 1.2;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 900, 0.8);
    const body = new Biquad('bandpass', 180, 3);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const boom = Math.sin(2 * Math.PI * (70 - 30 * t) * t) * Math.exp(-t * 7);
      const crack = noise() * Math.exp(-t * 45);
      const rattle = t > 0.05 && t < 0.35 ? noise() * Math.exp(-(t - 0.05) * 18) * (Math.sin(t * 380) > 0.6 ? 1 : 0.2) * 0.4 : 0;
      out[i] = lp.p(crack * 1.5 + rattle) + boom * 1.1 + body.p(crack) * 1.5;
    }
    return fadeEdges(normalize(distort(out, 1.6), 0.95));
  },

  bang() {
    const len = 0.7;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 600, 1);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = Math.sin(2 * Math.PI * (55 - 15 * t) * t) * Math.exp(-t * 9) * 1.2 + lp.p(noise()) * Math.exp(-t * 20) * 1.4;
    }
    return fadeEdges(normalize(distort(out, 2), 0.95));
  },

  knock() {
    const len = 0.5;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 320, 4);
    for (const at of [0, 0.16]) {
      const o = Math.floor(at * SR);
      for (let i = 0; i < n - o; i++) {
        const t = i / SR;
        out[o + i] += bp.p(noise()) * Math.exp(-t * 60) + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 40) * 0.6;
      }
    }
    return fadeEdges(normalize(out, 0.8));
  },

  click() {
    const n = Math.floor(0.05 * SR);
    const out = new Float32Array(n);
    const hp = new Biquad('highpass', 1800, 1);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = hp.p(noise()) * Math.exp(-t * 250) + (i < 40 ? noise() : 0); }
    return fadeEdges(normalize(out, 0.7));
  },

  unlock() {
    const n = Math.floor(0.35 * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 2600, 6);
    for (const at of [0, 0.09, 0.22]) {
      const o = Math.floor(at * SR);
      for (let i = 0; i < 2000 && o + i < n; i++) out[o + i] += bp.p(noise()) * Math.exp(-i / 220) + Math.sin(i * 0.4) * Math.exp(-i / 300) * 0.3;
    }
    return fadeEdges(normalize(out, 0.7));
  },

  rattle() {
    const len = 0.9;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 1900, 5);
    const lp = new Biquad('lowpass', 500, 1);
    for (let k = 0; k < 9; k++) {
      const o = Math.floor((k * 0.085 + rnd() * 0.02) * SR);
      for (let i = 0; i < 1800 && o + i < n; i++) out[o + i] += bp.p(noise()) * Math.exp(-i / 260) * 0.9 + lp.p(noise()) * Math.exp(-i / 500) * 0.6;
    }
    return fadeEdges(normalize(out, 0.85));
  },

  glass() {
    const len = 1.0;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const hp = new Biquad('highpass', 2500, 0.7);
    const pings = Array.from({ length: 14 }, () => ({ f: 2500 + rnd() * 6000, at: rnd() * 0.25, d: 8 + rnd() * 20, a: 0.2 + rnd() * 0.5 }));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let s = hp.p(noise()) * Math.exp(-t * 16) * 1.3;
      for (const p of pings) if (t > p.at) s += Math.sin(2 * Math.PI * p.f * (t - p.at)) * Math.exp(-(t - p.at) * p.d) * p.a;
      out[i] = s + Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 30) * 0.4;
    }
    return fadeEdges(normalize(out, 0.9));
  },

  clatter() {
    const len = 0.8;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bps = [new Biquad('bandpass', 1800, 12), new Biquad('bandpass', 3100, 15), new Biquad('bandpass', 950, 10)];
    for (let k = 0; k < 6; k++) {
      const o = Math.floor((k * 0.1 * (1 + rnd())) * SR);
      const a = Math.exp(-k * 0.5);
      for (let i = 0; i < 6000 && o + i < n; i++) {
        const x = i < 30 ? noise() : 0;
        out[o + i] += (bps[0].p(x) + bps[1].p(x) * 0.7 + bps[2].p(x) * 0.5) * a;
      }
    }
    return fadeEdges(normalize(out, 0.8));
  },

  thud() {
    const len = 0.45;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 400, 1);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = lp.p(noise()) * Math.exp(-t * 25) * 1.5 + Math.sin(2 * Math.PI * 75 * t) * Math.exp(-t * 18); }
    return fadeEdges(normalize(out, 0.85));
  },

  squeak() {
    return fadeEdges(normalize(voice(0.35, (t) => 900 + Math.sin(t * 30) * 200, () => VOWELS.i, (t) => Math.sin(Math.PI * t / 0.35)), 0.6));
  },

  whoosh() {
    const len = 0.4;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 800, 1.2);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i % 128 === 0) bp.set('bandpass', 400 + 1600 * Math.sin(Math.PI * t / len), 1.5);
      out[i] = bp.p(noise()) * Math.sin(Math.PI * t / len);
    }
    return fadeEdges(normalize(out, 0.5));
  },

  hammer() {
    const len = 0.35;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 700, 3);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = bp.p(noise()) * Math.exp(-t * 30) * 1.3 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 35) * 0.5 + (i < 60 ? noise() : 0); }
    return fadeEdges(normalize(out, 0.9));
  },

  // --------------------------------------------------------- the cat
  catStepSoft(v) {
    const len = 0.15;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 260 + v * 30, 1);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = lp.p(noise()) * Math.exp(-t * 35) + Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 50) * 0.7; }
    return fadeEdges(normalize(out, 0.7));
  },

  catStepRun(v) {
    // heavy thump + claw clicks on wood
    const len = 0.22;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 300, 1);
    const hp = new Biquad('highpass', 3000, 2);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = lp.p(noise()) * Math.exp(-t * 28) * 1.3 + Math.sin(2 * Math.PI * (70 - 60 * t) * t) * Math.exp(-t * 30) * 1.2;
      for (const c of [0.004, 0.019, 0.031]) if (t > c && t < c + 0.006) out[i] += hp.p(noise()) * 1.2;
    }
    return fadeEdges(normalize(distort(out, 1.4), 0.95));
  },

  purr() {
    const len = 2.2;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 380, 1.5);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const inhale = Math.sin(Math.PI * ((t % 1.1) / 1.1));
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t % 1.1 < 0.6 ? 26 : 23) * t);
      out[i] = lp.p(noise()) * am * inhale;
    }
    return fadeEdges(normalize(out, 0.8), 0.05, 0.2);
  },

  hiss() {
    const len = 1.1;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const hp = new Biquad('highpass', 2600, 0.8);
    const pk = new Biquad('peak', 5200, 2, 8);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.06) * Math.exp(-Math.max(0, t - 0.5) * 6);
      out[i] = pk.p(hp.p(noise())) * env + (t < 0.08 ? Math.sin(2 * Math.PI * 180 * t) * 0.5 * (1 - t / 0.08) : 0);
    }
    return fadeEdges(normalize(out, 0.9));
  },

  growl() {
    const len = 1.6;
    const d = voice(len, (t) => 70 + Math.sin(t * 9) * 8 + Math.sin(t * 2) * 10, () => VOWELS.o, (t) => Math.min(1, t * 4) * Math.exp(-Math.max(0, t - 1) * 3), { breath: 0.35, rough: 3 });
    return fadeEdges(normalize(distort(d, 4), 0.95), 0.02, 0.2);
  },

  meow(v) {
    // stretched, slowed, detuned - a meow from the bottom of a well
    const len = 1.1;
    const d = voice(len, (t) => {
      const u = t / len;
      return (440 + v * 40) * (u < 0.3 ? 0.8 + u : 1.1 - (u - 0.3) * 0.9);
    }, (t) => {
      const u = t / len;
      const a = u < 0.35 ? VOWELS.i : u < 0.7 ? VOWELS.a : VOWELS.u;
      return a;
    }, (t) => Math.sin(Math.PI * Math.min(1, t / len)) ** 0.7, { breath: 0.12 });
    const slow = resample(d, 0.55 + v * 0.05);
    return fadeEdges(normalize(distort(slow, 2.2), 0.85), 0.02, 0.2);
  },

  laugh(v) {
    // "ha-ha-ha-ha" syllables, descending, then pitched down and dirtied
    const syl = 7;
    const len = 1.9;
    const d = voice(len, (t) => (310 - t * 70) * (1 + 0.06 * Math.sin(t * 40)), () => VOWELS.ah, (t) => {
      const k = (t / len) * syl;
      const ph = k - Math.floor(k);
      return (ph < 0.55 ? Math.sin(Math.PI * ph / 0.55) : 0) * (1 - t / len * 0.5);
    }, { breath: 0.35, rough: 2 });
    const slow = resample(d, 0.62 + v * 0.08);
    // add a second, detuned copy for a choir-of-one effect
    const other = resample(d, 0.66 + v * 0.08);
    for (let i = 0; i < slow.length; i++) slow[i] += (other[i] || 0) * 0.6;
    return fadeEdges(normalize(distort(slow, 3), 0.9), 0.02, 0.25);
  },

  whisper(v) {
    const len = 1.8;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const f = [new Biquad('bandpass', 700, 4), new Biquad('bandpass', 1500, 5), new Biquad('bandpass', 2600, 6)];
    const vowels = Object.values(VOWELS);
    let vi = v % vowels.length;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i % Math.floor(SR * 0.14) === 0) {
        vi = (vi + 1 + Math.floor(rnd() * 3)) % vowels.length;
        const vv = vowels[vi];
        f[0].set('bandpass', vv[0] * 1.3, 4); f[1].set('bandpass', vv[1] * 1.2, 5); f[2].set('bandpass', vv[2], 6);
      }
      const syl = Math.max(0, Math.sin(t * 2 * Math.PI * 3.3 + v));
      const s = noise();
      out[i] = (f[0].p(s) + f[1].p(s) * 0.8 + f[2].p(s) * 0.5) * syl * (t % 0.45 < 0.05 ? 1.8 : 1);
    }
    return fadeEdges(normalize(out, 0.8), 0.05, 0.3);
  },

  sniff() {
    const len = 0.9;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 1400, 1.5);
    for (let k = 0; k < 3; k++) {
      const o = Math.floor(k * 0.22 * SR);
      for (let i = 0; i < 0.14 * SR && o + i < n; i++) { const t = i / SR; out[o + i] += bp.p(noise()) * Math.sin(Math.PI * t / 0.14); }
    }
    return fadeEdges(normalize(out, 0.6));
  },

  scratch() {
    const len = 1.3;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const hp = new Biquad('highpass', 1500, 1);
    const bp = new Biquad('bandpass', 3500, 3);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const stroke = Math.max(0, Math.sin(t * 2 * Math.PI * 3.2));
      const grain = Math.sin(t * 2 * Math.PI * 90) > 0.3 ? 1 : 0.3;
      out[i] = (hp.p(noise()) * 0.6 + bp.p(noise())) * stroke * grain;
    }
    return fadeEdges(normalize(out, 0.75));
  },

  ventScratch(v) {
    const len = 0.35;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 900 + v * 200, 4);
    const lp = new Biquad('lowpass', 250, 1);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = bp.p(noise()) * Math.exp(-t * 12) * (Math.sin(t * 700) > 0 ? 1 : 0.4) + lp.p(noise()) * Math.exp(-t * 20) * 1.5;
    }
    return fadeEdges(normalize(out, 0.8));
  },

  // --------------------------------------------------------- player body
  breath(v) {
    const len = 1.2;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 1100 + v * 150, 1.2);
    const lp = new Biquad('lowpass', 2600, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const inh = t < 0.45 ? Math.sin(Math.PI * t / 0.45) * 0.7 : 0;
      const exh = t > 0.5 ? Math.sin(Math.PI * (t - 0.5) / 0.7) : 0;
      out[i] = lp.p(bp.p(noise()) * (inh + exh));
    }
    return fadeEdges(normalize(out, 0.6), 0.02, 0.1);
  },

  gasp() {
    const len = 0.7;
    const d = voice(len, (t) => 190 + t * 60, () => VOWELS.ah, (t) => Math.sin(Math.PI * Math.min(1, t / 0.5)) * (t < 0.5 ? 1 : 0), { breath: 0.9 });
    return fadeEdges(normalize(d, 0.7), 0.01, 0.15);
  },

  exhale() {
    const len = 0.8;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 900, 1);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = bp.p(noise()) * Math.sin(Math.PI * t / len) ** 1.5; }
    return fadeEdges(normalize(out, 0.45));
  },

  heartbeat() {
    const len = 0.6;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    for (const [at, a, f] of [[0, 1, 52], [0.2, 0.7, 64]]) {
      const o = Math.floor(at * SR);
      for (let i = 0; i < 0.2 * SR && o + i < n; i++) { const t = i / SR; out[o + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 22) * a; }
    }
    return fadeEdges(normalize(out, 0.95));
  },

  // --------------------------------------------------------- stingers & ambience
  stinger(v) {
    // a screech of detuned saws + noise burst + sub hit
    const len = 2.4;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const freqs = [587, 622, 831, 880, 1244, 1318].map((f) => f * (1 + v * 0.03));
    const ph = freqs.map(() => rnd());
    const hp = new Biquad('highpass', 1200, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 2.2);
      let s = 0;
      freqs.forEach((f, k) => {
        ph[k] += (f * (1 - t * 0.08)) / SR;
        s += (2 * (ph[k] % 1) - 1) * 0.3;
      });
      s += hp.p(noise()) * Math.exp(-t * 6) * 1.2;
      s += Math.sin(2 * Math.PI * (48 - t * 8) * t) * Math.exp(-t * 3) * 1.4;
      out[i] = s * env;
    }
    return fadeEdges(normalize(distort(out, 2.5), 0.98), 0.002, 0.3);
  },

  thunder(v) {
    const len = 5 + v;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 180, 0.7);
    const lp2 = new Biquad('lowpass', 900, 0.7);
    let b = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      b = b * 0.995 + noise() * 0.1;
      const crack = t < 0.35 ? lp2.p(noise()) * (1 - t / 0.35) * 0.8 : 0;
      const rumble = lp.p(b) * (Math.exp(-t * 0.6) * (1 + 0.5 * Math.sin(t * 3 + v)));
      out[i] = rumble * 4 + crack;
    }
    return fadeEdges(normalize(out, 0.95), 0.05, 1);
  },

  static() {
    const len = 2;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 3000, 0.6);
    for (let i = 0; i < n; i++) out[i] = bp.p(noise()) * (0.8 + 0.2 * Math.sin(i / SR * 50));
    return normalize(out, 0.6);
  },

  phoneRing() {
    const len = 2;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const on = t < 1.2 && Math.sin(2 * Math.PI * 20 * t) > 0;
      out[i] = on ? (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) * 0.4 : 0;
    }
    return fadeEdges(out);
  },

  pianoChord() {
    const len = 4;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const notes = [110, 116.5, 164.8, 233.1, 246.9];
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let s = 0;
      for (const f of notes) s += (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t * 1.002)) * Math.exp(-t * 1.2);
      out[i] = s * Math.min(1, t / 0.005);
    }
    return fadeEdges(normalize(out, 0.9));
  },

  bell(v) {
    // music box note (v = semitone offset)
    const f = 523.25 * Math.pow(2, v / 12);
    const len = 1.6;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 12)) * Math.exp(-t * 2.5) * Math.min(1, t / 0.002);
    }
    return fadeEdges(normalize(out, 0.5));
  },

  ghostPiano(v) {
    const f = 110 * Math.pow(2, v / 12);
    const len = 3.5;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * 2 * f * t * 1.001) + 0.15 * Math.sin(2 * Math.PI * 3 * f * t * 0.998)) * Math.exp(-t * 1.1) * Math.min(1, t / 0.004);
    }
    return fadeEdges(normalize(out, 0.6));
  },

  engine() {
    const len = 2;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 400, 1);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = 38 + Math.sin(t * 2) * 2;
      out[i] = lp.p((2 * ((f * t) % 1) - 1) + noise() * 0.3) * (0.8 + 0.2 * Math.sin(t * 50));
    }
    return normalize(out, 0.7);
  },

  cutting() {
    const len = 0.6;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const bp = new Biquad('bandpass', 1800, 4);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = bp.p(noise()) * Math.exp(-t * 8) + (t > 0.45 && t < 0.47 ? noise() * 2 : 0); }
    return fadeEdges(normalize(out, 0.9));
  },

  water() {
    const len = 3;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const lp = new Biquad('lowpass', 600, 1);
    const bp = new Biquad('bandpass', 900, 8);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = lp.p(noise()) * 0.8 + bp.p(noise() * (Math.sin(t * 17) > 0.8 ? 3 : 0.2)); }
    return normalize(out, 0.7);
  },

  drip(v) {
    const len = 0.4;
    const n = Math.floor(len * SR);
    const out = new Float32Array(n);
    const f0 = 1400 + v * 250;
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = Math.sin(2 * Math.PI * (f0 + 1200 * Math.exp(-t * 60)) * t) * Math.exp(-t * 25); }
    return fadeEdges(normalize(out, 0.5));
  },
};

/** Generate every buffer. Returns Map<name, AudioBuffer[]> (variants). */
export async function synthesizeAll(ctx, onProgress) {
  const jobs = [
    ...['wood', 'tile', 'carpet', 'stone', 'grass'].flatMap((s) => [0, 1, 2, 3].map((v) => ['step', `${s}:${v}`, `step_${s}`])),
    ...[0, 1, 2, 3, 4, 5].map((v) => ['creak', v, 'creak']),
    ['slam', 0, 'slam'], ['bang', 0, 'bang'], ['knock', 0, 'knock'], ['click', 0, 'click'], ['unlock', 0, 'unlock'], ['rattle', 0, 'rattle'],
    ['glass', 0, 'glass'], ['clatter', 0, 'clatter'], ['thud', 0, 'thud'], ['squeak', 0, 'squeak'], ['whoosh', 0, 'whoosh'], ['hammer', 0, 'hammer'],
    ...[0, 1, 2].map((v) => ['catStepSoft', v, 'catStepSoft']),
    ...[0, 1].map((v) => ['catStepRun', v, 'catStepRun']),
    ['purr', 0, 'purr'], ['hiss', 0, 'hiss'], ['growl', 0, 'growl'],
    ...[0, 1, 2].map((v) => ['meow', v, 'meow']),
    ...[0, 1, 2].map((v) => ['laugh', v, 'laugh']),
    ...[0, 1, 2, 3].map((v) => ['whisper', v, 'whisper']),
    ['sniff', 0, 'sniff'], ['scratch', 0, 'scratch'],
    ...[0, 1, 2].map((v) => ['ventScratch', v, 'ventScratch']),
    ...[0, 1, 2].map((v) => ['breath', v, 'breath']),
    ['gasp', 0, 'gasp'], ['exhale', 0, 'exhale'], ['heartbeat', 0, 'heartbeat'],
    ...[0, 1, 2].map((v) => ['stinger', v, 'stinger']),
    ...[0, 1, 2].map((v) => ['thunder', v, 'thunder']),
    ['static', 0, 'static'], ['phoneRing', 0, 'phoneRing'], ['pianoChord', 0, 'pianoChord'],
    ...[0, 2, 3, 5, 7, 8, 10, 12, 14, 15].map((v) => ['bell', v, `bell${v}`]),
    ...[0, 1, 3, 6, 7, 10, 12, -2, 13].map((v) => ['ghostPiano', v, `ghost${v}`]),
    ['engine', 0, 'engine'], ['cutting', 0, 'cutting'], ['water', 0, 'water'],
    ...[0, 1, 2].map((v) => ['drip', v, 'drip']),
  ];
  const out = new Map();
  for (let i = 0; i < jobs.length; i++) {
    const [gen, v, name] = jobs[i];
    seed = 1000 + i * 77;
    const data = GEN[gen](v);
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(toBuffer(ctx, data));
    if (i % 6 === 5) {
      if (onProgress) onProgress((i + 1) / jobs.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}

/** Stereo impulse response for the convolution reverb. */
export function impulseResponse(ctx, seconds = 2.4, decay = 3, dark = 0.4) {
  const n = Math.floor(seconds * SR);
  const b = ctx.createBuffer(2, n, SR);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    const lp = new Biquad('lowpass', 4000 * (1 - dark) + 800, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = lp.p(noise()) * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
    }
  }
  return b;
}

export const SAMPLE_RATE = SR;
