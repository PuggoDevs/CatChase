// Renders the house floor plans (rooms, walls, openings, stairs, vents and -
// when available - furniture colliders) to an SVG and a PNG for inspection.
// Usage: node scripts/planview.mjs [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { HouseGrid, HOLE } from '../src/world/grid.js';
import { VENTS, FLOOR_NAMES } from '../src/world/layout.js';

const outDir = process.argv[2] || 'screenshots';
mkdirSync(outDir, { recursive: true });

const grid = new HouseGrid();
if (grid.errors.length) {
  console.log('LAYOUT ERRORS:');
  for (const e of grid.errors) console.log('  -', e);
} else {
  console.log('layout OK:', grid.rooms.length, 'rooms,', grid.edges.size, 'edges,', grid.stairs.length, 'stairs');
}

let furniture = null;
try {
  const mod = await import('../src/world/furnishing.js');
  furniture = mod.planFurniture ? mod.planFurniture(grid) : null;
} catch (e) {
  if (!String(e).includes('Cannot find module')) console.log('furniture not rendered:', e.message);
}

const S = 22; // px per metre
const pad = 30;
const colours = {};
const palette = ['#5b7fa6', '#a6795b', '#6fa65b', '#a65b8a', '#8aa65b', '#5ba6a0', '#a6a05b', '#7a5ba6', '#a65b5b', '#5b8aa6', '#9c8f6a', '#6a9c8f'];
grid.rooms.forEach((r, i) => { colours[r.index] = palette[i % palette.length]; });

const edgeStyle = {
  wall: ['#111', 3], window: ['#39f', 5], railing: ['#b80', 2], door: ['#e33', 5], arch: ['#0a0', 2], open: ['#0f0', 1],
  secret: ['#f0f', 5], bookshelf: ['#f0f', 5], front: ['#ff0', 6], garage: ['#ff0', 6], grate: ['#0ff', 6],
  atticwin: ['#0ff', 6], tiny: ['#0ff', 6], crawl: ['#fa0', 4],
};

let svgs = [];
for (let f = 0; f < grid.floorCount; f++) {
  const w = grid.W * S + pad * 2, h = grid.D * S + pad * 2 + 20;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="monospace">`;
  s += `<rect width="100%" height="100%" fill="#f4f1ea"/>`;
  s += `<text x="${pad}" y="20" font-size="16" font-weight="bold">Floor ${f} - ${FLOOR_NAMES[f]}</text>`;
  s += `<g transform="translate(${pad},${pad + 10})">`;
  for (let z = 0; z < grid.D; z++) {
    for (let x = 0; x < grid.W; x++) {
      const r = grid.cellRaw(f, x, z);
      if (r >= 0) s += `<rect x="${x * S}" y="${z * S}" width="${S}" height="${S}" fill="${colours[r]}" opacity="0.35"/>`;
      else if (r === HOLE) s += `<rect x="${x * S}" y="${z * S}" width="${S}" height="${S}" fill="#000" opacity="0.5"/>`;
      if (grid.stairAt(f, x, z)) s += `<line x1="${x * S}" y1="${z * S}" x2="${x * S + S}" y2="${z * S + S}" stroke="#333"/>`;
    }
  }
  // grid ticks
  for (let x = 0; x <= grid.W; x += 5) s += `<text x="${x * S}" y="-2" font-size="9">${x}</text>`;
  for (let z = 0; z <= grid.D; z += 5) s += `<text x="-22" y="${z * S + 4}" font-size="9">${z}</text>`;
  if (furniture) {
    for (const b of furniture.filter((b) => b.f === f)) {
      s += `<rect x="${b.x0 * S}" y="${b.z0 * S}" width="${(b.x1 - b.x0) * S}" height="${(b.z1 - b.z0) * S}" fill="${b.hide ? '#c60' : '#555'}" opacity="0.7" stroke="#000" stroke-width="0.5"/>`;
      if (b.label) s += `<text x="${b.x0 * S + 1}" y="${b.z0 * S + 8}" font-size="7" fill="#fff">${b.label}</text>`;
    }
  }
  for (const e of grid.edges.values()) {
    if (e.f !== f) continue;
    const [col, wd] = edgeStyle[e.type] || ['#888', 2];
    s += `<line x1="${e.x0 * S}" y1="${e.z0 * S}" x2="${e.x1 * S}" y2="${e.z1 * S}" stroke="${col}" stroke-width="${wd}"/>`;
    if (e.opening && e.opening.lock) {
      s += `<circle cx="${((e.x0 + e.x1) / 2) * S}" cy="${((e.z0 + e.z1) / 2) * S}" r="4" fill="#000"/>`;
    }
  }
  for (const r of grid.rooms.filter((r) => r.floor === f)) {
    s += `<text x="${r.cx * S}" y="${r.cz * S}" font-size="10" text-anchor="middle" fill="#000">${r.code}:${r.name}</text>`;
  }
  for (const v of VENTS.filter((v) => v.f === f)) {
    s += `<rect x="${(v.x + 0.35) * S}" y="${(v.z + 0.35) * S}" width="${S * 0.3}" height="${S * 0.3}" fill="#0cc" stroke="#000"/>`;
  }
  s += `</g></svg>`;
  svgs.push(s);
  writeFileSync(`${outDir}/plan_floor${f}.svg`, s);
}

try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 36 * S + 60, height: 26 * S + 80 } });
  for (let f = 0; f < svgs.length; f++) {
    await page.setContent(`<html><body style="margin:0">${svgs[f]}</body></html>`);
    await page.screenshot({ path: `${outDir}/plan_floor${f}.png` });
  }
  await browser.close();
  console.log('wrote', outDir + '/plan_floor*.png');
} catch (e) {
  console.log('png render skipped:', e.message);
}
