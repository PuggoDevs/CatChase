// Procedural canvas textures. Nothing is downloaded: wallpapers, woods,
// tiles, stone, fabrics and decals are all painted here at load time.
import * as THREE from 'three';
import { RNG, tileFbm2 } from '../core/rng.js';

const NOISE_N = 256;

/** Precomputed tileable noise field sampled with wrap + bilinear filtering. */
class NoiseField {
  constructor(seed, period = 8, octaves = 5) {
    this.n = NOISE_N;
    this.data = new Float32Array(this.n * this.n);
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        this.data[y * this.n + x] = tileFbm2((x / this.n) * period, (y / this.n) * period, period, octaves, seed);
      }
    }
  }
  /** u, v in "field units" (1.0 == one full tile) */
  sample(u, v) {
    const n = this.n;
    const x = u * n, y = v * n;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const d = this.data;
    const a = d[y0 * n + x0], b = d[y0 * n + x1], c = d[y1 * n + x0], e = d[y1 * n + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
  }
}

let N1, N2, N3;
function noises() {
  if (!N1) {
    N1 = new NoiseField(11, 8, 5);
    N2 = new NoiseField(23, 4, 4);
    N3 = new NoiseField(37, 16, 3);
  }
  return [N1, N2, N3];
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** Run a per-pixel shader into a canvas. fn(u, v, x, y) -> [r,g,b] or [r,g,b,a] */
function paint(size, fn, h = size) {
  const c = makeCanvas(size, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      out[3] = 255;
      const r = fn(x / size, y / h, x, y, out);
      const i = (y * size + x) * 4;
      const src = r || out;
      d[i] = clamp255(src[0]); d[i + 1] = clamp255(src[1]); d[i + 2] = clamp255(src[2]);
      d[i + 3] = src.length > 3 ? clamp255(src[3]) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Grayscale height canvas from fn(u,v) -> 0..1 */
function paintGray(size, fn) {
  return paint(size, (u, v, x, y, o) => {
    const g = fn(u, v, x, y) * 255;
    o[0] = g; o[1] = g; o[2] = g;
    return o;
  });
}

function hexRgb(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
const mix = (a, b, t) => a + (b - a) * t;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Aging overlay: blotchy stains + darkening. Applied to many surfaces.
function stainFactor(u, v, seed = 0, strength = 1) {
  const [n1, n2] = noises();
  const s = n2.sample(u * 0.5 + seed * 0.13, v * 0.5 + seed * 0.29);
  const blot = sat((s - 0.58) * 5) * 0.35 * strength;
  const fine = (n1.sample(u * 2 + seed, v * 2) - 0.5) * 0.12 * strength;
  return 1 - blot + fine;
}

// ------------------------------------------------------------------ woods
function planks(size, { base, dark, plankCount = 8, seed = 1, stagger = true, grainScale = 1, gapDark = 0.35, wear = 0.5 }) {
  const [n1, , n3] = noises();
  const rng = new RNG(seed);
  const plankInfo = [];
  for (let i = 0; i < plankCount; i++) {
    plankInfo.push({ shade: rng.float(0.78, 1.12), hue: rng.float(-0.05, 0.05), off: rng.float(0, 1), joint: rng.float(0.2, 0.9), joint2: rng.float(0, 1), gs: rng.float(0, 100) });
  }
  const b = hexRgb(base), dk = hexRgb(dark);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, o) => {
    const pf = v * plankCount;
    const pi = Math.floor(pf) % plankCount;
    const p = plankInfo[pi];
    const inP = pf - Math.floor(pf);
    // end joints (staggered)
    let seg = u + p.off;
    const jointPos = stagger ? p.joint : 2;
    const segF = seg * 1.0;
    const jd = Math.abs(((segF - jointPos) % 1 + 1) % 1);
    const jointDist = Math.min(jd, 1 - jd);
    const gap = inP < 0.035 || inP > 0.965 || jointDist < 0.004;
    // grain: stretched noise along u
    const g = n3.sample(u * 0.35 * grainScale + p.gs, v * 3 * grainScale + p.gs * 0.1);
    const rings = Math.sin((g * 18 + inP * 2.2) * Math.PI) * 0.5 + 0.5;
    const fine = n1.sample(u * 4 + p.gs, v * 0.5);
    let t = sat(0.35 + rings * 0.35 + (fine - 0.5) * 0.5);
    t *= p.shade;
    const st = stainFactor(u, v, seed, wear);
    let r = mix(dk[0], b[0], t) * st, gg = mix(dk[1], b[1], t) * st, bb = mix(dk[2], b[2], t) * st;
    r *= 1 + p.hue; bb *= 1 - p.hue;
    let h = 0.7 + (rings - 0.5) * 0.12;
    if (gap) { r *= gapDark; gg *= gapDark; bb *= gapDark; h = 0.1; }
    height[y * size + x] = h;
    o[0] = r; o[1] = gg; o[2] = bb;
    return o;
  });
  const bump = paintGray(size, (u, v, x, y) => height[y * size + x]);
  return { map, bump };
}

function parquet(size, { base, dark, seed = 5 }) {
  const [n1, , n3] = noises();
  const b = hexRgb(base), dk = hexRgb(dark);
  const blocks = 8; // herringbone blocks per tile edge
  const height = new Float32Array(size * size);
  const rng = new RNG(seed);
  const shades = Array.from({ length: 256 }, () => rng.float(0.75, 1.15));
  const map = paint(size, (u, v, x, y, o) => {
    const U = u * blocks, V = v * blocks;
    // herringbone: alternate diagonal orientation per 2x2 cell group
    const cx = Math.floor(U), cz = Math.floor(V);
    const orient = (cx + cz) & 1;
    const fu = U - cx, fv = V - cz;
    const along = orient ? fu : fv;
    const across = orient ? fv : fu;
    const strip = Math.floor(across * 3);
    const inS = across * 3 - strip;
    const id = ((cx * 7 + cz * 13 + strip * 3) & 255);
    const gap = inS < 0.06 || fu < 0.02 || fv < 0.02;
    const g = n3.sample((orient ? u : v) * 0.8 + id, (orient ? v : u) * 6 + id * 0.3);
    const rings = Math.sin((g * 14 + along) * Math.PI) * 0.5 + 0.5;
    let t = sat(0.4 + rings * 0.3 + (n1.sample(u * 3, v * 3) - 0.5) * 0.4) * shades[id];
    const st = stainFactor(u, v, seed, 0.6);
    let r = mix(dk[0], b[0], t) * st, gg = mix(dk[1], b[1], t) * st, bb = mix(dk[2], b[2], t) * st;
    let h = 0.7;
    if (gap) { r *= 0.4; gg *= 0.4; bb *= 0.4; h = 0.15; }
    height[y * size + x] = h;
    o[0] = r; o[1] = gg; o[2] = bb;
    return o;
  });
  return { map, bump: paintGray(size, (u, v, x, y) => height[y * size + x]) };
}

// ------------------------------------------------------------------ tiles
function tiles(size, { a, b = null, count = 6, grout = 0x3a3630, groutW = 0.05, seed = 3, rect = 1, offsetRows = false, wear = 0.8, glossVar = 0.1 }) {
  const [n1] = noises();
  const A = hexRgb(a), B = b != null ? hexRgb(b) : null, G = hexRgb(grout);
  const rng = new RNG(seed);
  const shade = Array.from({ length: 1024 }, () => rng.float(1 - glossVar, 1 + glossVar * 0.5));
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, o) => {
    const rows = count, cols = Math.round(count / rect);
    let V = v * rows;
    const row = Math.floor(V);
    let U = u * cols + (offsetRows && row & 1 ? 0.5 : 0);
    const col = Math.floor(U);
    const fu = U - col, fv = V - row;
    const g = fu < groutW || fv < groutW * rect;
    const id = ((col & 31) * 32 + (row & 31)) & 1023;
    const base = B && ((col + row) & 1) ? B : A;
    const s = shade[id] * stainFactor(u, v, seed, wear);
    const nn = (n1.sample(u * 3, v * 3) - 0.5) * 18;
    let h = 0.8;
    if (g) {
      o[0] = G[0] * s + nn; o[1] = G[1] * s + nn; o[2] = G[2] * s + nn; h = 0.2;
    } else {
      o[0] = base[0] * s + nn; o[1] = base[1] * s + nn; o[2] = base[2] * s + nn;
    }
    height[y * size + x] = h;
    return o;
  });
  return { map, bump: paintGray(size, (u, v, x, y) => height[y * size + x]) };
}

function marble(size, { base = 0xd8d4cc, vein = 0x6a6660, seed = 9 }) {
  const [n1, n2, n3] = noises();
  const B = hexRgb(base), Vn = hexRgb(vein);
  const count = 2;
  const map = paint(size, (u, v, x, y, o) => {
    const turb = n1.sample(u * 1.5 + seed, v * 1.5) * 6 + n3.sample(u, v) * 2;
    const veinV = Math.pow(Math.abs(Math.sin((u * 3 + v * 2 + turb) * Math.PI)), 0.15);
    const t = sat(veinV) * 0.85 + n2.sample(u * 2, v * 2) * 0.15;
    const st = stainFactor(u, v, seed, 0.7);
    // tile seams
    const su = (u * count) % 1, sv = (v * count) % 1;
    const seam = su < 0.006 || sv < 0.006 ? 0.55 : 1;
    o[0] = mix(Vn[0], B[0], t) * st * seam; o[1] = mix(Vn[1], B[1], t) * st * seam; o[2] = mix(Vn[2], B[2], t) * st * seam;
    return o;
  });
  return { map, bump: null };
}

// ------------------------------------------------------------------ masonry
function bricks(size, { base = 0x7a3a2a, mortar = 0x5a5448, rows = 8, cols = 4, seed = 4, wear = 1 }) {
  const [n1, n2] = noises();
  const B = hexRgb(base), M = hexRgb(mortar);
  const rng = new RNG(seed);
  const shade = Array.from({ length: 512 }, () => [rng.float(0.7, 1.15), rng.float(-0.08, 0.08)]);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, o) => {
    const V = v * rows, row = Math.floor(V), fv = V - row;
    const U = u * cols + (row & 1 ? 0.5 : 0), col = Math.floor(U), fu = U - col;
    const m = fv < 0.1 || fu < 0.05;
    const id = ((row * 17 + col * 31) & 511);
    const [s, hue] = shade[id];
    const rough = (n1.sample(u * 4, v * 4) - 0.5) * 30;
    const soot = stainFactor(u, v, seed, wear);
    let h;
    if (m) {
      const mm = n2.sample(u * 6, v * 6) * 20;
      o[0] = (M[0] + mm) * soot; o[1] = (M[1] + mm) * soot; o[2] = (M[2] + mm) * soot; h = 0.15;
    } else {
      o[0] = (B[0] * s * (1 + hue) + rough) * soot; o[1] = (B[1] * s + rough) * soot; o[2] = (B[2] * s * (1 - hue) + rough) * soot;
      h = 0.75 + (n1.sample(u * 8, v * 8) - 0.5) * 0.3;
    }
    height[y * size + x] = h;
    return o;
  });
  return { map, bump: paintGray(size, (u, v, x, y) => height[y * size + x]) };
}

function stones(size, { base = 0x5a564e, seed = 7, cells = 6, wet = false }) {
  const [n1, n2] = noises();
  const rng = new RNG(seed);
  const B = hexRgb(base);
  // jittered voronoi
  const pts = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    pts.push([(i + rng.float(0.15, 0.85)) / cells, (j + rng.float(0.15, 0.85)) / cells, rng.float(0.75, 1.2)]);
  }
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, o) => {
    let d1 = 9, d2 = 9, shade = 1;
    for (const p of pts) {
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const dx = u - (p[0] + ox), dy = v - (p[1] + oy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; shade = p[2]; } else if (d < d2) d2 = d;
      }
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1);
    const mortar = edge < 0.012;
    const n = n1.sample(u * 5, v * 5);
    let t = shade * (0.8 + n * 0.4) * stainFactor(u, v, seed, 1);
    if (wet) t *= 0.7 + n2.sample(u * 2, v * 2) * 0.2;
    const h = mortar ? 0.1 : sat(0.5 + Math.min(edge * 8, 0.4) + (n - 0.5) * 0.2);
    height[y * size + x] = h;
    if (mortar) t *= 0.45;
    o[0] = B[0] * t; o[1] = B[1] * t; o[2] = B[2] * t;
    return o;
  });
  return { map, bump: paintGray(size, (u, v, x, y) => height[y * size + x]) };
}

function concrete(size, { base = 0x6a6862, seed = 12, cracks = 4, wear = 1 }) {
  const [n1, n2, n3] = noises();
  const B = hexRgb(base);
  const c = paint(size, (u, v, x, y, o) => {
    const n = n1.sample(u * 2 + seed * 0.1, v * 2) * 0.6 + n3.sample(u * 3, v * 3) * 0.4;
    const speck = n3.sample(u * 11, v * 11) > 0.72 ? 0.85 : 1;
    const st = stainFactor(u, v, seed, wear) * (0.85 + n2.sample(u, v) * 0.3);
    const t = (0.78 + n * 0.35) * speck * st;
    o[0] = B[0] * t; o[1] = B[1] * t; o[2] = B[2] * t;
    return o;
  });
  // cracks: random walks
  const ctx = c.getContext('2d');
  const rng = new RNG(seed + 99);
  ctx.strokeStyle = 'rgba(20,18,16,0.55)';
  for (let i = 0; i < cracks; i++) {
    let x = rng.float(0, size), y = rng.float(0, size), a = rng.float(0, Math.PI * 2);
    ctx.lineWidth = rng.float(0.6, 1.6);
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = rng.int(20, 60);
    for (let s = 0; s < steps; s++) {
      a += rng.float(-0.6, 0.6); x += Math.cos(a) * 4; y += Math.sin(a) * 4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const bump = paintGray(size, (u, v) => 0.5 + (n3.sample(u * 6, v * 6) - 0.5) * 0.6);
  return { map: c, bump };
}

function dirt(size, { base = 0x3e3226, seed = 21 }) {
  const [n1, n2, n3] = noises();
  const B = hexRgb(base);
  const map = paint(size, (u, v, x, y, o) => {
    const n = n1.sample(u * 3, v * 3) * 0.5 + n2.sample(u * 2, v * 2) * 0.3 + n3.sample(u * 8, v * 8) * 0.2;
    const pebble = n3.sample(u * 14 + 3, v * 14) > 0.78 ? 1.35 : 1;
    const t = (0.6 + n * 0.7) * pebble;
    o[0] = B[0] * t; o[1] = B[1] * t; o[2] = B[2] * t;
    return o;
  });
  const bump = paintGray(size, (u, v) => n3.sample(u * 8, v * 8));
  return { map, bump };
}

// ------------------------------------------------------------------ plaster / paint
function plaster(size, { base = 0xcfc8b8, seed = 31, stains = 1, cracks = 2 }) {
  const [n1, n2] = noises();
  const B = hexRgb(base);
  const c = paint(size, (u, v, x, y, o) => {
    const n = n1.sample(u * 2 + seed * 0.01, v * 2) * 0.5 + n2.sample(u * 4, v * 4) * 0.5;
    // water-stain rings
    const w = n2.sample(u * 0.7 + seed * 0.07, v * 0.7);
    const ring = w > 0.7 && w < 0.712 ? 0.9 : w >= 0.712 ? 0.97 : 1;
    const st = stainFactor(u, v, seed, stains);
    const t = (0.9 + (n - 0.5) * 0.18) * st;
    o[0] = B[0] * t * ring; o[1] = B[1] * t * ring; o[2] = B[2] * t * (ring * 0.95);
    return o;
  });
  const ctx = c.getContext('2d');
  const rng = new RNG(seed);
  ctx.strokeStyle = 'rgba(40,34,28,0.35)';
  for (let i = 0; i < cracks; i++) {
    let x = rng.float(0, size), y = rng.float(0, size), a = rng.float(0, Math.PI * 2);
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 40; s++) { a += rng.float(-0.7, 0.7); x += Math.cos(a) * 3; y += Math.sin(a) * 3; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return { map: c, bump: paintGray(size, (u, v) => n1.sample(u * 6, v * 6)) };
}

// ------------------------------------------------------------------ carpets & fabric
function carpet(size, { base, accent, seed = 41, pattern = true }) {
  const [n1, , n3] = noises();
  const B = hexRgb(base), A = hexRgb(accent);
  const map = paint(size, (u, v, x, y, o) => {
    const fibre = n3.sample(u * 16, v * 16);
    let t = 0.8 + fibre * 0.35;
    let col = B;
    if (pattern) {
      // faded medallion / diamond lattice
      const du = Math.abs(((u * 4) % 1) - 0.5), dv = Math.abs(((v * 4) % 1) - 0.5);
      const diamond = du + dv;
      if (diamond > 0.42 && diamond < 0.48) col = A;
      if (diamond < 0.08) col = A;
    }
    const st = stainFactor(u, v, seed, 0.9) * (0.9 + n1.sample(u, v) * 0.2);
    o[0] = col[0] * t * st; o[1] = col[1] * t * st; o[2] = col[2] * t * st;
    return o;
  });
  return { map, bump: paintGray(size, (u, v) => n3.sample(u * 16, v * 16)) };
}

function fabric(size, { base, seed = 51, weave = 64, stripe = null }) {
  const [n1, , n3] = noises();
  const B = hexRgb(base);
  const S = stripe != null ? hexRgb(stripe) : null;
  const map = paint(size, (u, v, x, y, o) => {
    const wv = (Math.sin(u * weave * Math.PI * 2) * Math.sin(v * weave * Math.PI * 2)) * 0.06;
    const t = 0.85 + wv + (n3.sample(u * 8, v * 8) - 0.5) * 0.2;
    let col = B;
    if (S && Math.floor(u * 10) % 2 === 0) col = S;
    const st = stainFactor(u, v, seed, 0.7) * (0.92 + n1.sample(u, v) * 0.16);
    o[0] = col[0] * t * st; o[1] = col[1] * t * st; o[2] = col[2] * t * st;
    return o;
  });
  return { map, bump: null };
}

// ------------------------------------------------------------------ wallpapers
function wallpaper(size, { base, ink, seed = 61, motif = 'damask', stripes = false, stripeCol = null, fade = 0, peel = 0.6 }) {
  const [n1, n2] = noises();
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const B = hexRgb(base);
  ctx.fillStyle = `rgb(${B})`;
  ctx.fillRect(0, 0, size, size);
  if (stripes) {
    ctx.fillStyle = stripeCol || 'rgba(0,0,0,0.12)';
    const n = 6;
    for (let i = 0; i < n; i++) ctx.fillRect((i / n) * size, 0, size / n / 3, size);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < n; i++) ctx.fillRect((i / n) * size + size / n / 3, 0, 2, size);
  }
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  const drawMotif = (cx, cy, s) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    if (motif === 'damask') {
      for (const m of [1, -1]) {
        ctx.save(); ctx.scale(m, 1);
        ctx.beginPath();
        ctx.moveTo(0, -46);
        ctx.bezierCurveTo(14, -34, 26, -20, 12, -6);
        ctx.bezierCurveTo(32, -12, 36, 10, 18, 14);
        ctx.bezierCurveTo(30, 24, 18, 40, 4, 34);
        ctx.bezierCurveTo(6, 42, 3, 48, 0, 52);
        ctx.lineTo(0, -46);
        ctx.fill();
        ctx.beginPath(); ctx.arc(22, -26, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(28, 26, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    } else if (motif === 'floral') {
      for (let k = 0; k < 5; k++) {
        ctx.save(); ctx.rotate((k / 5) * Math.PI * 2);
        ctx.beginPath(); ctx.ellipse(0, -12, 7, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha *= 0.6;
      ctx.beginPath(); ctx.moveTo(0, 14); ctx.quadraticCurveTo(12, 34, 30, 30); ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(22, 26, 8, 4, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha /= 0.6;
    } else if (motif === 'fleur') {
      ctx.beginPath(); ctx.ellipse(0, -8, 5, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-10, 2, 4, 10, -0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(10, 2, 4, 10, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-9, 8, 18, 3);
    } else if (motif === 'child') {
      // stars, moons and little cats in tall hats
      const kind = Math.abs(Math.round(cx * 7 + cy * 3)) % 3;
      if (kind === 0) {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i & 1 ? 6 : 15, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.fill();
      } else if (kind === 1) {
        ctx.beginPath(); ctx.arc(0, 0, 14, 0.3, Math.PI * 2 - 0.3); ctx.arc(6, 0, 11, Math.PI * 2 - 0.5, 0.5, true); ctx.fill();
      } else {
        // cat face with a striped stovepipe hat
        ctx.beginPath(); ctx.arc(0, 6, 12, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-8, -12); ctx.lineTo(-3, -4); ctx.fill();
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(8, -12); ctx.lineTo(3, -4); ctx.fill();
        ctx.fillRect(-9, -26, 18, 20);
        ctx.fillRect(-14, -8, 28, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(-9, -20, 18, 4); ctx.fillRect(-9, -12, 18, 3);
        ctx.fillStyle = 'rgba(20,10,10,0.8)';
        ctx.beginPath(); ctx.arc(-4, 4, 2, 0, Math.PI * 2); ctx.arc(4, 4, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 9, 7, 0.15, Math.PI - 0.15); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = ink;
      }
    }
    ctx.restore();
  };
  const reps = motif === 'child' ? 4 : 3;
  const step = size / reps;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i <= reps; i++) {
    for (let j = 0; j <= reps; j++) {
      const s = (size / 512) * (motif === 'damask' ? 1.25 : 0.9);
      drawMotif(i * step, j * step, s);
      drawMotif(i * step + step / 2, j * step + step / 2, s * 0.55);
    }
  }
  ctx.globalAlpha = 1;
  // aging: stains, fading, seams, scratches
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const i = (y * size + x) * 4;
      const st = stainFactor(u, v, seed, 1.1);
      const yellow = sat((n2.sample(u * 0.6 + 0.3, v * 0.6) - 0.55) * 4) * 0.25;
      const fadeK = fade;
      const seam = x % (size / 2) < 2 ? 0.8 : 1;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const grey = (r + g + b) / 3;
      r = mix(r, grey, fadeK); g = mix(g, grey, fadeK); b = mix(b, grey, fadeK);
      d[i] = r * st * seam * (1 + yellow * 0.3);
      d[i + 1] = g * st * seam * (1 + yellow * 0.1);
      d[i + 2] = b * st * seam * (1 - yellow * 0.4);
      // peeling patches reveal plaster
      const pe = n1.sample(u * 1.3 + seed * 0.3, v * 1.3);
      if (pe > 1 - peel * 0.12) { d[i] = 150; d[i + 1] = 140; d[i + 2] = 120; }
    }
  }
  ctx.putImageData(img, 0, 0);
  const bump = paintGray(size / 2, (u, v) => 0.5 + (n1.sample(u * 5, v * 5) - 0.5) * 0.3);
  return { map: c, bump };
}

function woodPanel(size, { base, dark, seed = 71, raised = true }) {
  const [n1, , n3] = noises();
  const B = hexRgb(base), D = hexRgb(dark);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, o) => {
    // two panels per tile horizontally, one vertically
    const pu = (u * 2) % 1, pv = v;
    const frame = pu < 0.12 || pu > 0.88 || pv < 0.08 || pv > 0.92;
    const bevel = !frame && (pu < 0.16 || pu > 0.84 || pv < 0.12 || pv > 0.88);
    const g = n3.sample(u * (frame ? 6 : 0.6), v * (frame ? 0.5 : 5) + (frame ? 10 : 0));
    const rings = Math.sin(g * 20 * Math.PI) * 0.5 + 0.5;
    let t = sat(0.4 + rings * 0.3 + (n1.sample(u * 3, v * 3) - 0.5) * 0.3) * stainFactor(u, v, seed, 0.8);
    if (bevel && raised) t *= 0.7;
    height[y * size + x] = frame ? 0.8 : bevel ? 0.45 : 0.65;
    o[0] = mix(D[0], B[0], t); o[1] = mix(D[1], B[1], t); o[2] = mix(D[2], B[2], t);
    return o;
  });
  return { map, bump: paintGray(size, (u, v, x, y) => height[y * size + x]) };
}

function subwayTiles(size) {
  return tiles(size, { a: 0xd9d6cc, count: 10, rect: 0.5, grout: 0x8a857a, groutW: 0.04, offsetRows: true, seed: 81, wear: 1.2, glossVar: 0.06 });
}

function grass(size) {
  const [n1, n2, n3] = noises();
  return {
    map: paint(size, (u, v, x, y, o) => {
      const n = n1.sample(u * 4, v * 4) * 0.5 + n3.sample(u * 16, v * 16) * 0.5;
      const dry = n2.sample(u * 1.5, v * 1.5);
      o[0] = mix(30, 58, dry) * (0.6 + n * 0.6); o[1] = mix(42, 50, dry) * (0.6 + n * 0.6); o[2] = mix(24, 30, dry) * (0.6 + n * 0.6);
      return o;
    }),
    bump: paintGray(size, (u, v) => n3.sample(u * 16, v * 16)),
  };
}

function siding(size) {
  const [n1, n2] = noises();
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, o) => {
    const boards = 8;
    const f = (v * boards) % 1;
    const shadow = f > 0.9 ? 0.55 : 1 - f * 0.12;
    const peel = n1.sample(u * 2, v * 2) > 0.68;
    const base = peel ? [96, 90, 80] : [150, 150, 145];
    const t = shadow * (0.85 + n2.sample(u * 3, v * 6) * 0.3) * stainFactor(u, v, 5, 1.3);
    height[y * size + x] = 1 - f * 0.6;
    o[0] = base[0] * t; o[1] = base[1] * t; o[2] = base[2] * t * 1.02;
    return o;
  });
  return { map, bump: paintGray(size, (u, v, x, y) => height[y * size + x]) };
}

function shingles(size) {
  const [n1] = noises();
  const rng = new RNG(4);
  const shade = Array.from({ length: 256 }, () => rng.float(0.7, 1.2));
  return {
    map: paint(size, (u, v, x, y, o) => {
      const rows = 10, V = v * rows, row = Math.floor(V), fv = V - row;
      const U = u * 8 + (row & 1) * 0.5, col = Math.floor(U), fu = U - col;
      const s = shade[(row * 13 + col * 7) & 255] * (fv > 0.85 || fu < 0.04 ? 0.5 : 1);
      const n = 0.8 + n1.sample(u * 6, v * 6) * 0.4;
      o[0] = 48 * s * n; o[1] = 46 * s * n; o[2] = 50 * s * n;
      return o;
    }),
    bump: null,
  };
}

function metal(size, { base = 0x7a7d80, rust = 0.4, seed = 91 }) {
  const [n1, n2, n3] = noises();
  const B = hexRgb(base);
  return {
    map: paint(size, (u, v, x, y, o) => {
      const brushed = n3.sample(u * 0.2, v * 16) * 0.2;
      const r = sat((n2.sample(u * 1.3 + seed, v * 1.3) - (1 - rust * 0.6)) * 4);
      const t = 0.85 + brushed + (n1.sample(u * 4, v * 4) - 0.5) * 0.2;
      o[0] = mix(B[0] * t, 110, r); o[1] = mix(B[1] * t, 60, r); o[2] = mix(B[2] * t, 30, r);
      return o;
    }),
    bump: null,
  };
}

function paper(size) {
  const [n1, , n3] = noises();
  return {
    map: paint(size, (u, v, x, y, o) => {
      const n = 0.9 + n3.sample(u * 12, v * 12) * 0.1 - sat((n1.sample(u, v) - 0.6) * 3) * 0.2;
      o[0] = 214 * n; o[1] = 203 * n; o[2] = 176 * n;
      return o;
    }),
    bump: null,
  };
}

function cardboard(size) {
  const [n1, , n3] = noises();
  return {
    map: paint(size, (u, v, x, y, o) => {
      const n = 0.85 + n3.sample(u * 10, v * 2) * 0.2 - sat((n1.sample(u * 2, v * 2) - 0.62) * 3) * 0.25;
      o[0] = 150 * n; o[1] = 112 * n; o[2] = 72 * n;
      return o;
    }),
    bump: null,
  };
}

function fur(size) {
  const [n1, , n3] = noises();
  return {
    map: paint(size, (u, v, x, y, o) => {
      const strands = n3.sample(u * 3, v * 24) * 0.6 + n3.sample(u * 5 + 7, v * 30) * 0.4;
      const t = 0.55 + strands * 0.6 + (n1.sample(u * 2, v * 2) - 0.5) * 0.2;
      o[0] = 30 * t; o[1] = 28 * t; o[2] = 32 * t;
      return o;
    }),
    bump: paintGray(size, (u, v) => n3.sample(u * 3, v * 24)),
  };
}

function books(size) {
  // spines atlas used by bookshelves
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rng = new RNG(101);
  ctx.fillStyle = '#1a120c';
  ctx.fillRect(0, 0, size, size);
  const rows = 4;
  const rh = size / rows;
  const cols = ['#5a1a14', '#1d3a24', '#1c2846', '#4a3a1c', '#2a1e2e', '#6a5a3a', '#3a3a38', '#702a1a', '#243a3a'];
  for (let r = 0; r < rows; r++) {
    let x = 0;
    while (x < size) {
      const w = rng.float(size * 0.025, size * 0.06);
      const h = rh * rng.float(0.72, 0.97);
      const col = rng.pick(cols);
      ctx.fillStyle = col;
      ctx.fillRect(x, r * rh + (rh - h), w - 1, h);
      ctx.fillStyle = 'rgba(210,180,90,0.55)';
      ctx.fillRect(x + 1, r * rh + (rh - h) + h * 0.15, w - 3, 2);
      ctx.fillRect(x + 1, r * rh + (rh - h) + h * 0.8, w - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + w - 3, r * rh + (rh - h), 2, h);
      x += w;
    }
  }
  return { map: c, bump: null };
}

// ------------------------------------------------------------------ registry
// Each entry: generator, size, metres per texture repeat, PBR params.
export const TEXTURE_DEFS = {
  woodFloor: { gen: () => planks(512, { base: 0x8a5a36, dark: 0x3a2214, plankCount: 10, seed: 1 }), scale: 2, rough: 0.62 },
  woodDark: { gen: () => planks(512, { base: 0x5c3420, dark: 0x1e0f08, plankCount: 10, seed: 2 }), scale: 2, rough: 0.55 },
  woodPlain: { gen: () => planks(512, { base: 0xa88a62, dark: 0x5a4430, plankCount: 7, seed: 3, wear: 1 }), scale: 2, rough: 0.8 },
  woodParquet: { gen: () => parquet(512, { base: 0x9a6438, dark: 0x3a2010, seed: 5 }), scale: 1.6, rough: 0.5 },
  atticBoards: { gen: () => planks(512, { base: 0x7a6a58, dark: 0x2e261e, plankCount: 6, seed: 7, wear: 1.4 }), scale: 2.2, rough: 0.9 },
  woodPlanks: { gen: () => planks(512, { base: 0x6e5236, dark: 0x2a1c10, plankCount: 6, seed: 8, wear: 1.3 }), scale: 2, rough: 0.85 },
  tileChecker: { gen: () => tiles(512, { a: 0xd6d0c2, b: 0x1c1a18, count: 8, grout: 0x4a463e, groutW: 0.03, seed: 11 }), scale: 2.4, rough: 0.35 },
  tileWhite: { gen: () => tiles(512, { a: 0xd8d8d0, count: 12, grout: 0x807a70, groutW: 0.05, seed: 12, wear: 1.1 }), scale: 1.8, rough: 0.3 },
  tileTerracotta: { gen: () => tiles(512, { a: 0x9a5234, count: 6, grout: 0x4a3a2e, groutW: 0.04, seed: 13 }), scale: 2.4, rough: 0.7 },
  tileSlate: { gen: () => tiles(512, { a: 0x44474c, count: 5, grout: 0x222222, groutW: 0.03, seed: 14, glossVar: 0.25 }), scale: 2.4, rough: 0.6 },
  tileWall: { gen: () => subwayTiles(512), scale: 1.6, rough: 0.25 },
  marble: { gen: () => marble(512, {}), scale: 2.2, rough: 0.2 },
  concrete: { gen: () => concrete(512, { base: 0x6e6c66, seed: 15 }), scale: 3, rough: 0.9 },
  concreteWall: { gen: () => concrete(512, { base: 0x7a776e, seed: 16, cracks: 6 }), scale: 3, rough: 0.92 },
  concreteCeil: { gen: () => concrete(512, { base: 0x5a5852, seed: 17, cracks: 2 }), scale: 3, rough: 0.95 },
  brick: { gen: () => bricks(512, {}), scale: 1.6, rough: 0.88 },
  stoneWall: { gen: () => stones(512, { seed: 19 }), scale: 2, rough: 0.9 },
  stone: { gen: () => stones(512, { base: 0x4e4a44, seed: 20, cells: 8 }), scale: 2.5, rough: 0.85 },
  wetStone: { gen: () => stones(512, { base: 0x3a3a36, seed: 22, cells: 7, wet: true }), scale: 2, rough: 0.25 },
  dirt: { gen: () => dirt(256, {}), scale: 2, rough: 1 },
  carpetRed: { gen: () => carpet(256, { base: 0x5a1618, accent: 0x7a5a30, seed: 41 }), scale: 1.5, rough: 1 },
  carpetBlue: { gen: () => carpet(256, { base: 0x1e2a44, accent: 0x5a5a6a, seed: 42 }), scale: 1.5, rough: 1 },
  carpetPink: { gen: () => carpet(256, { base: 0x9a6a74, accent: 0xc8a0a8, seed: 43, pattern: false }), scale: 1.2, rough: 1 },
  plaster: { gen: () => plaster(512, { base: 0xbdb6a6, seed: 31, stains: 0.55, cracks: 3 }), scale: 3.5, rough: 0.95 },
  plasterWall: { gen: () => plaster(512, { base: 0xb2ab9a, seed: 32, stains: 0.8, cracks: 2 }), scale: 2.5, rough: 0.95 },
  plasterGreen: { gen: () => plaster(512, { base: 0x8a9a84, seed: 33, stains: 1.1 }), scale: 2.5, rough: 0.95 },
  wallpaperDamask: { gen: () => wallpaper(512, { base: 0x4a4028, ink: 'rgba(150,120,60,0.55)', seed: 61, motif: 'damask' }), scale: 1.2, rough: 0.9 },
  wallpaperRed: { gen: () => wallpaper(512, { base: 0x5a1a1c, ink: 'rgba(30,6,8,0.55)', seed: 62, motif: 'damask', stripes: true, stripeCol: 'rgba(0,0,0,0.12)' }), scale: 1.2, rough: 0.9 },
  wallpaperGreen: { gen: () => wallpaper(512, { base: 0x24382a, ink: 'rgba(120,140,90,0.35)', seed: 63, motif: 'fleur' }), scale: 1.1, rough: 0.9 },
  wallpaperBlue: { gen: () => wallpaper(512, { base: 0x2a3442, ink: 'rgba(150,160,180,0.3)', seed: 64, motif: 'fleur', stripes: true, stripeCol: 'rgba(255,255,255,0.05)' }), scale: 1.2, rough: 0.9 },
  wallpaperFloral: { gen: () => wallpaper(512, { base: 0x8a7a62, ink: 'rgba(120,40,50,0.5)', seed: 65, motif: 'floral', fade: 0.3 }), scale: 1.0, rough: 0.9 },
  wallpaperKitchen: { gen: () => wallpaper(512, { base: 0x9a9272, ink: 'rgba(60,90,70,0.35)', seed: 66, motif: 'fleur', stripes: true, stripeCol: 'rgba(40,80,60,0.15)' }), scale: 1.0, rough: 0.8 },
  wallpaperChild: { gen: () => wallpaper(512, { base: 0xb08a92, ink: 'rgba(80,60,90,0.5)', seed: 67, motif: 'child', fade: 0.15 }), scale: 1.1, rough: 0.9 },
  wallpaperChildFaded: { gen: () => wallpaper(512, { base: 0x7a6a66, ink: 'rgba(40,30,40,0.5)', seed: 68, motif: 'child', fade: 0.55, peel: 1.4 }), scale: 1.1, rough: 0.95 },
  woodPanel: { gen: () => woodPanel(512, { base: 0x6a4428, dark: 0x24140a, seed: 71 }), scale: 1.4, rough: 0.6 },
  woodPanelDark: { gen: () => woodPanel(512, { base: 0x3a261a, dark: 0x120a06, seed: 72, raised: false }), scale: 1.4, rough: 0.7 },
  woodBeams: { gen: () => planks(512, { base: 0x5a4632, dark: 0x1e160e, plankCount: 5, seed: 9, wear: 1.2 }), scale: 2.5, rough: 0.9 },
  grass: { gen: () => grass(512), scale: 4, rough: 1 },
  siding: { gen: () => siding(512), scale: 2, rough: 0.9 },
  shingles: { gen: () => shingles(512), scale: 3, rough: 0.9 },
  // furniture & props
  woodFurniture: { gen: () => planks(256, { base: 0x6a4024, dark: 0x2a160a, plankCount: 3, seed: 111, stagger: false, wear: 0.6 }), scale: 1.2, rough: 0.5 },
  woodFurnitureDark: { gen: () => planks(256, { base: 0x3e2414, dark: 0x120804, plankCount: 3, seed: 112, stagger: false, wear: 0.6 }), scale: 1.2, rough: 0.45 },
  woodPainted: { gen: () => plaster(256, { base: 0xc8c0ae, seed: 113, stains: 1.4, cracks: 1 }), scale: 1.5, rough: 0.7 },
  woodPaintedDark: { gen: () => plaster(256, { base: 0x2e3a36, seed: 114, stains: 1.2, cracks: 1 }), scale: 1.5, rough: 0.65 },
  fabricRed: { gen: () => fabric(256, { base: 0x6a1a1c, seed: 51 }), scale: 0.8, rough: 1 },
  fabricGreen: { gen: () => fabric(256, { base: 0x2a4030, seed: 52 }), scale: 0.8, rough: 1 },
  fabricBeige: { gen: () => fabric(256, { base: 0x9a8a70, seed: 53 }), scale: 0.8, rough: 1 },
  fabricBlue: { gen: () => fabric(256, { base: 0x2a3450, seed: 54 }), scale: 0.8, rough: 1 },
  fabricPink: { gen: () => fabric(256, { base: 0xb08090, seed: 55, stripe: 0xc8a0a8 }), scale: 0.8, rough: 1 },
  linen: { gen: () => fabric(256, { base: 0xbab2a0, seed: 56, weave: 90 }), scale: 1, rough: 1 },
  sheet: { gen: () => fabric(256, { base: 0x9e988a, seed: 57, weave: 50 }), scale: 1.5, rough: 1 },
  leather: { gen: () => fabric(256, { base: 0x3a1e12, seed: 58, weave: 10 }), scale: 0.8, rough: 0.55 },
  metal: { gen: () => metal(256, {}), scale: 1, rough: 0.45, metal: 0.7 },
  rust: { gen: () => metal(256, { base: 0x5a4a40, rust: 1.2, seed: 92 }), scale: 1, rough: 0.8, metal: 0.4 },
  paper: { gen: () => paper(256), scale: 0.5, rough: 0.9 },
  cardboard: { gen: () => cardboard(256), scale: 0.8, rough: 0.95 },
  books: { gen: () => books(512), scale: 1, rough: 0.8 },
  fur: { gen: () => fur(256), scale: 0.5, rough: 0.95 },
};

/**
 * Lazily builds THREE textures from the defs above. `await lib.preload(cb)`
 * generates them in slices so the loading bar keeps moving.
 */
export class TextureLib {
  constructor(renderer) {
    this.cache = new Map();
    this.aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  }

  async preload(onProgress) {
    const names = Object.keys(TEXTURE_DEFS);
    noises();
    for (let i = 0; i < names.length; i++) {
      this.get(names[i]);
      if (onProgress) onProgress((i + 1) / names.length, names[i]);
      if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
    }
  }

  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const def = TEXTURE_DEFS[name];
    if (!def) throw new Error('unknown texture ' + name);
    const res = def.gen();
    const map = new THREE.CanvasTexture(res.map);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.aniso;
    let bump = null;
    if (res.bump) {
      bump = new THREE.CanvasTexture(res.bump);
      bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
      bump.anisotropy = this.aniso;
    }
    const entry = { map, bump, def };
    this.cache.set(name, entry);
    return entry;
  }
}

// ------------------------------------------------------------------ one-off canvases
export { makeCanvas, paint, hexRgb };
