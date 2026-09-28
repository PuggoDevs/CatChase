// Procedurally painted imagery: oil portraits, crayon drawings, photos,
// paper notes and decals (blood, claw marks, writing on the walls).
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function grain(ctx, w, h, amt, rng) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function vignette(ctx, w, h, k = 0.75) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// A seated / standing figure in the old-master style.
function figure(ctx, x, y, s, { skin = '#b08a70', cloth = '#1e1a18', hair = '#2a1a10', eyes = 'normal', mustache = false, girl = false } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // shoulders
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(-60, 120); ctx.quadraticCurveTo(-58, 40, 0, 34); ctx.quadraticCurveTo(58, 40, 60, 120); ctx.fill();
  // collar
  ctx.fillStyle = girl ? '#d8d0c0' : '#c8c0b0';
  ctx.beginPath(); ctx.moveTo(-14, 36); ctx.lineTo(0, 56); ctx.lineTo(14, 36); ctx.fill();
  // neck + head
  ctx.fillStyle = skin;
  ctx.fillRect(-9, 18, 18, 22);
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = hair;
  ctx.beginPath();
  if (girl) {
    ctx.ellipse(0, -8, 28, 28, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(-28, -8, 10, 44); ctx.fillRect(18, -8, 10, 44);
    ctx.fillStyle = '#7a1414';
    ctx.beginPath(); ctx.ellipse(18, -26, 9, 5, 0.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.ellipse(0, -14, 25, 18, 0, Math.PI, 0); ctx.fill();
  }
  // face shading
  const g = ctx.createLinearGradient(-24, 0, 24, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2); ctx.fill();
  // eyes
  if (eyes === 'scratched') {
    ctx.strokeStyle = 'rgba(230,220,200,0.85)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.moveTo(-18 + i * 1.5, -10 + (i % 3) * 3); ctx.lineTo(18 - i, 4 - (i % 2) * 5); ctx.stroke();
    }
  } else if (eyes === 'hollow') {
    ctx.fillStyle = '#050303';
    ctx.beginPath(); ctx.ellipse(-9, -3, 5, 6, 0, 0, Math.PI * 2); ctx.ellipse(9, -3, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#1a120c';
    ctx.beginPath(); ctx.ellipse(-9, -3, 3, 2, 0, 0, Math.PI * 2); ctx.ellipse(9, -3, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,20,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-7, 14); ctx.lineTo(7, 14); ctx.stroke();
  }
  if (mustache) {
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.ellipse(-6, 10, 8, 3, 0.2, 0, Math.PI * 2); ctx.ellipse(6, 10, 8, 3, -0.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// The tall cat, as painted (or drawn) by someone who saw it.
function catSilhouette(ctx, x, y, s, { eyes = '#e8e060', grin = true, hat = true, body = '#050505' } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = body;
  // body
  ctx.beginPath(); ctx.moveTo(-26, 160); ctx.quadraticCurveTo(-34, 60, -18, 30); ctx.lineTo(18, 30); ctx.quadraticCurveTo(34, 60, 26, 160); ctx.fill();
  // long arms
  ctx.fillRect(-36, 40, 8, 110); ctx.fillRect(28, 40, 8, 110);
  // head + ears
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-28, -6); ctx.lineTo(-22, -40); ctx.lineTo(-8, -20); ctx.fill();
  ctx.beginPath(); ctx.moveTo(28, -6); ctx.lineTo(22, -40); ctx.lineTo(8, -20); ctx.fill();
  if (hat) {
    ctx.fillStyle = body;
    ctx.fillRect(-26, -22, 52, 6);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#e8e0d0' : '#a01010';
      ctx.fillRect(-16 + i * 0.6, -28 - i * 11, 32 - i * 1.2, 11);
    }
  }
  // bow tie
  ctx.fillStyle = '#a01010';
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(-14, 22); ctx.lineTo(-14, 38); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(14, 22); ctx.lineTo(14, 38); ctx.fill();
  // eyes
  ctx.fillStyle = eyes;
  ctx.shadowColor = eyes; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.ellipse(-11, -2, 6, 7, 0.1, 0, Math.PI * 2); ctx.ellipse(11, -2, 6, 7, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  ctx.fillRect(-12, -8, 2, 12); ctx.fillRect(10, -8, 2, 12);
  if (grin) {
    ctx.strokeStyle = '#f0ece0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-24, 8); ctx.quadraticCurveTo(0, 26, 24, 8); ctx.stroke();
    for (let i = -20; i <= 20; i += 4) { ctx.beginPath(); ctx.moveTo(i, 10 + (1 - (i / 24) ** 2) * 8); ctx.lineTo(i, 14 + (1 - (i / 24) ** 2) * 8); ctx.stroke(); }
  }
  ctx.restore();
}

function oilBackground(ctx, w, h, c1, c2) {
  const g = ctx.createRadialGradient(w * 0.45, h * 0.35, 10, w / 2, h / 2, h * 0.8);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function paintArt(kind, seed = 1) {
  const rng = new RNG(seed);
  const w = 256, h = 320;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  switch (kind) {
    case 'arthur':
      oilBackground(ctx, w, h, '#3a2e22', '#0c0806');
      figure(ctx, w / 2, 150, 1.5, { skin: '#9a7a62', cloth: '#14100e', hair: '#4a3a30', mustache: true });
      ctx.fillStyle = 'rgba(200,170,90,0.6)'; ctx.font = 'italic 14px serif'; ctx.fillText('A. Whitlock', 90, 300);
      break;
    case 'family':
      oilBackground(ctx, w, h, '#2e2a1e', '#0a0806');
      catSilhouette(ctx, w / 2 + 10, 80, 1.05, { eyes: '#d8d060' });
      figure(ctx, 70, 170, 0.9, { skin: '#9a7a62', cloth: '#1a1410', hair: '#3a2a20', mustache: true, eyes: 'scratched' });
      figure(ctx, 185, 175, 0.85, { skin: '#a88a72', cloth: '#2a1418', hair: '#2a1a14', eyes: 'scratched' });
      figure(ctx, 128, 225, 0.6, { skin: '#b89a82', cloth: '#6a5a50', hair: '#6a4a2a', girl: true });
      break;
    case 'ellie':
      oilBackground(ctx, w, h, '#3a3040', '#0a080c');
      figure(ctx, w / 2, 150, 1.4, { skin: '#c0a088', cloth: '#7a6a70', hair: '#6a4a2a', girl: true });
      catSilhouette(ctx, w / 2 + 40, 240, 0.32, { body: '#1a1616' });
      break;
    case 'hat': {
      oilBackground(ctx, w, h, '#2a2218', '#080604');
      ctx.fillStyle = '#1a120c'; ctx.fillRect(20, 230, 216, 60);
      ctx.save(); ctx.translate(128, 225); ctx.rotate(-0.08);
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-60, -6, 120, 10);
      for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#d8d0c0' : '#8a0c0c'; ctx.fillRect(-36 + i, -24 - i * 22, 72 - i * 2, 22); }
      ctx.restore();
      ctx.fillStyle = '#8a0c0c';
      ctx.beginPath(); ctx.moveTo(128, 262); ctx.lineTo(100, 248); ctx.lineTo(100, 276); ctx.fill();
      ctx.beginPath(); ctx.moveTo(128, 262); ctx.lineTo(156, 248); ctx.lineTo(156, 276); ctx.fill();
      break;
    }
    case 'landscape': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a1e24'); g.addColorStop(0.6, '#2a2a26'); g.addColorStop(1, '#141410');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0c0c0a';
      ctx.beginPath(); ctx.moveTo(0, 230); ctx.quadraticCurveTo(128, 150, 256, 220); ctx.lineTo(256, 320); ctx.lineTo(0, 320); ctx.fill();
      ctx.fillStyle = '#060606';
      ctx.fillRect(95, 150, 70, 45);
      ctx.beginPath(); ctx.moveTo(88, 152); ctx.lineTo(130, 118); ctx.lineTo(172, 152); ctx.fill();
      ctx.fillStyle = '#d8c060';
      ctx.fillRect(106, 162, 8, 10);
      ctx.fillStyle = '#e0e050';
      ctx.beginPath(); ctx.arc(146, 168, 2, 0, 7); ctx.arc(152, 168, 2, 0, 7); ctx.fill();
      break;
    }
    default: {
      oilBackground(ctx, w, h, rng.pick(['#2e2620', '#262a22', '#2a2226']), '#080606');
      figure(ctx, w / 2, 150, 1.4, { skin: rng.pick(['#9a7a62', '#a88a72', '#8a6a52']), cloth: rng.pick(['#14100e', '#201818', '#18181e']), hair: rng.pick(['#2a1a10', '#4a4038', '#1a1a1a']), mustache: rng.chance(0.5), eyes: rng.pick(['scratched', 'hollow', 'normal']) });
    }
  }
  vignette(ctx, w, h, 0.7);
  grain(ctx, w, h, 22, rng);
  // craquelure
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) {
    let x = rng.float(0, w), y = rng.float(0, h);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += rng.float(-12, 12); y += rng.float(-12, 12); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return tex(c);
}

/** Child's crayon drawing (paper colour, wobbly lines). */
export function drawingTexture(seed, caption = 'ME AND MR GRIN') {
  const rng = new RNG(seed);
  const w = 256, h = 200;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e6dfcf';
  ctx.fillRect(0, 0, w, h);
  const wobble = (pts, col, width = 3) => {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const X = x + rng.float(-1.5, 1.5), Y = y + rng.float(-1.5, 1.5); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.stroke();
  };
  // sun or moon
  if (rng.chance(0.5)) { ctx.fillStyle = '#e0b020'; ctx.beginPath(); ctx.arc(220, 30, 16, 0, 7); ctx.fill(); }
  else { ctx.fillStyle = '#b0b0b0'; ctx.beginPath(); ctx.arc(220, 30, 14, 0, 7); ctx.fill(); ctx.fillStyle = '#e6dfcf'; ctx.beginPath(); ctx.arc(226, 26, 12, 0, 7); ctx.fill(); }
  // girl
  ctx.fillStyle = '#e8b890'; ctx.beginPath(); ctx.arc(70, 90, 13, 0, 7); ctx.fill();
  wobble([[70, 103], [70, 140]], '#c02070', 4);
  wobble([[55, 115], [85, 115]], '#c02070', 3);
  wobble([[70, 140], [60, 170]], '#3050c0', 3); wobble([[70, 140], [80, 170]], '#3050c0', 3);
  ctx.fillStyle = '#7a4a1a'; ctx.fillRect(56, 76, 28, 6);
  // the cat, much taller
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(150, 80, 18, 16, 0, 0, 7); ctx.fill();
  wobble([[150, 95], [150, 160]], '#111', 9);
  wobble([[140, 110], [110, 130]], '#111', 4); wobble([[160, 110], [185, 140]], '#111', 4);
  wobble([[150, 160], [138, 190]], '#111', 4); wobble([[150, 160], [162, 190]], '#111', 4);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#d01010'; ctx.fillRect(138, 50 - i * 8, 24, 8); }
  ctx.fillStyle = '#111'; ctx.fillRect(132, 58, 36, 4);
  ctx.fillStyle = '#e0d020'; ctx.fillRect(142, 76, 5, 5); ctx.fillRect(154, 76, 5, 5);
  wobble([[138, 86], [150, 92], [162, 86]], '#fff', 2);
  ctx.fillStyle = '#d01010'; ctx.fillRect(144, 96, 12, 5);
  // hand holding
  wobble([[85, 115], [110, 130]], '#c02070', 3);
  ctx.fillStyle = '#403028';
  ctx.font = 'bold 15px "Comic Sans MS", cursive';
  ctx.fillText(caption, 12, 192);
  return tex(c);
}

/** Old photograph (sepia or bleached polaroid). */
export function photoTexture(kind, seed) {
  const rng = new RNG(seed);
  const w = 200, h = 240;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ddd6c4'; ctx.fillRect(0, 0, w, h);
  const ix = 14, iy = 14, iw = w - 28, ih = h - 60;
  ctx.save();
  ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
  const g = ctx.createLinearGradient(0, iy, 0, iy + ih);
  g.addColorStop(0, '#3a3228'); g.addColorStop(1, '#16120e');
  ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
  if (kind === 'hallway') {
    ctx.fillStyle = '#0a0806';
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(w / 2 - 12, iy + ih * 0.4); ctx.lineTo(w / 2 + 12, iy + ih * 0.4); ctx.lineTo(ix + iw, iy); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ix, iy + ih); ctx.lineTo(w / 2 - 12, iy + ih * 0.62); ctx.lineTo(w / 2 + 12, iy + ih * 0.62); ctx.lineTo(ix + iw, iy + ih); ctx.fill();
    catSilhouette(ctx, w / 2, iy + ih * 0.45, 0.13, {});
  } else if (kind === 'bedroom') {
    ctx.fillStyle = '#5a5046'; ctx.fillRect(ix + 20, iy + ih * 0.55, iw - 40, 40);
    ctx.fillStyle = '#c8c0b0'; ctx.fillRect(ix + 20, iy + ih * 0.5, 50, 20);
    catSilhouette(ctx, ix + iw - 45, iy + 40, 0.3, {});
  } else if (kind === 'victim') {
    figure(ctx, w / 2, iy + 80, 0.9, { skin: '#a88a72', cloth: rng.pick(['#2a3a5a', '#3a2a1a', '#1a1a1a']), hair: '#2a1a10', eyes: 'normal' });
  } else {
    figure(ctx, w / 2 - 30, iy + 90, 0.6, { mustache: true, eyes: 'scratched' });
    figure(ctx, w / 2 + 25, iy + 110, 0.45, { girl: true, hair: '#6a4a2a', skin: '#b89a82' });
    catSilhouette(ctx, w / 2 + 50, iy + 30, 0.35, {});
  }
  ctx.restore();
  // sepia / fade
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = l * 1.08 + 12; d[i + 1] = l * 0.95 + 6; d[i + 2] = l * 0.78;
  }
  ctx.putImageData(img, 0, 0);
  grain(ctx, w, h, 28, rng);
  ctx.fillStyle = 'rgba(40,30,20,0.8)';
  ctx.font = 'italic 13px serif';
  ctx.fillText(rng.pick(['1962', 'playing', "she's hiding", 'found you', '1987', 'the new friend']), 20, h - 22);
  return tex(c);
}

/** Paper with illegible handwriting for notes lying in the world. */
export function paperTexture(seed, style = 'paper') {
  const rng = new RNG(seed);
  const w = 128, h = 160;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = style === 'crayon' ? '#e6dfcf' : style === 'journal' ? '#cbbf9e' : '#d8d0bc';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = style === 'crayon' ? 'rgba(180,20,40,0.8)' : 'rgba(30,25,40,0.7)';
  ctx.lineWidth = style === 'crayon' ? 2.5 : 1;
  for (let y = 18; y < h - 12; y += style === 'crayon' ? 18 : 9) {
    ctx.beginPath();
    let x = 10;
    ctx.moveTo(x, y);
    const end = rng.float(80, 118);
    while (x < end) { x += rng.float(2, 6); ctx.lineTo(x, y + rng.float(-2, 2)); }
    ctx.stroke();
  }
  grain(ctx, w, h, 14, rng);
  return tex(c);
}

/** Decals with alpha: blood splats, claw marks, handprints, wall writing. */
export function decalTexture(kind, seed = 1, text = '') {
  const rng = new RNG(seed);
  const w = kind === 'writing' ? 512 : 256, h = kind === 'writing' ? 160 : 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (kind === 'blood') {
    ctx.fillStyle = 'rgba(70,4,4,0.9)';
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, rng.float(40, 70), rng.float(30, 60), rng.float(0, 3), 0, 7); ctx.fill();
    for (let i = 0; i < 26; i++) {
      const a = rng.float(0, 7), r = rng.float(40, 120);
      ctx.beginPath(); ctx.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, rng.float(2, 12), 0, 7); ctx.fill();
    }
  } else if (kind === 'drag') {
    ctx.fillStyle = 'rgba(60,4,4,0.8)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(90 + i * 20, 0);
      for (let y = 0; y < h; y += 10) ctx.lineTo(90 + i * 20 + rng.float(-4, 4), y);
      ctx.lineTo(96 + i * 20, h); ctx.lineTo(96 + i * 20, 0); ctx.fill();
    }
  } else if (kind === 'claws') {
    ctx.strokeStyle = 'rgba(20,12,10,0.85)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = rng.float(3, 6);
      ctx.beginPath(); ctx.moveTo(60 + i * 32, 30 + i * 6);
      ctx.bezierCurveTo(70 + i * 32, 100, 58 + i * 30, 170, 72 + i * 30, 230 - i * 8);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(210,190,160,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(62 + i * 32, 32 + i * 6); ctx.bezierCurveTo(72 + i * 32, 100, 60 + i * 30, 170, 74 + i * 30, 228 - i * 8); ctx.stroke(); }
  } else if (kind === 'hand') {
    ctx.fillStyle = 'rgba(80,6,6,0.85)';
    ctx.beginPath(); ctx.ellipse(128, 150, 40, 48, 0, 0, 7); ctx.fill();
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(92 + i * 24, 80 - (i === 1 || i === 2 ? 14 : 0), 9, 30, 0, 0, 7); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(178, 150, 9, 26, -0.8, 0, 7); ctx.fill();
    for (let i = 0; i < 5; i++) ctx.fillRect(100 + i * 14, 190, 4, rng.float(20, 60));
  } else if (kind === 'writing') {
    ctx.fillStyle = 'rgba(90,6,6,0.92)';
    ctx.font = 'bold 64px "Brush Script MT", "Segoe Script", cursive';
    ctx.textAlign = 'center';
    ctx.fillText(text || 'COME OUT', w / 2, 90);
    for (let i = 0; i < 18; i++) ctx.fillRect(rng.float(40, w - 40), rng.float(80, 95), rng.float(2, 4), rng.float(15, 60));
  }
  const t = tex(c);
  return t;
}
