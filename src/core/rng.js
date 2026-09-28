// Deterministic random numbers. Every playthrough is driven by a seed so key
// locations, patrols and events are reproducible (and shareable).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  next() { return this._next(); }
  float(min = 0, max = 1) { return min + (max - min) * this._next(); }
  int(min, max) { return Math.floor(this.float(min, max + 1)); }
  chance(p) { return this._next() < p; }
  pick(arr) { return arr.length ? arr[Math.floor(this._next() * arr.length)] : undefined; }
  sign() { return this._next() < 0.5 ? -1 : 1; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  weighted(items, weightFn) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it));
    if (total <= 0) return this.pick(items);
    let r = this._next() * total;
    for (const it of items) {
      r -= Math.max(0, weightFn(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  /** Derive an independent stream (e.g. one for items, one for events). */
  fork(label) { return new RNG((this.seed ^ hashString(String(label))) >>> 0); }
}

// ---------------------------------------------------------------- noise
// Small value-noise helpers for procedural textures and camera shake.
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable value noise with period (px, py). */
export function tileNoise2(x, y, px, py, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const m = (v, p) => ((v % p) + p) % p;
  const a = hash2(m(xi, px), m(yi, py), seed), b = hash2(m(xi + 1, px), m(yi, py), seed);
  const c = hash2(m(xi, px), m(yi + 1, py), seed), d = hash2(m(xi + 1, px), m(yi + 1, py), seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x, y, octaves = 4, seed = 0) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise2(x * f, y * f, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return v / norm;
}

export function tileFbm2(x, y, period, octaves = 4, seed = 0) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += tileNoise2(x * f, y * f, period * f, period * f, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return v / norm;
}

export function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const a = hash2(i, 0, seed), b = hash2(i + 1, 0, seed);
  return a + (b - a) * smooth(f);
}
