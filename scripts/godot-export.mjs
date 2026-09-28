// Exports the web game's house, items, gameplay data and sounds into the
// Godot project (godot/). Re-run after changing the web house.
// usage: node scripts/godot-export.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = 'godot';
const DEST = { 'house.glb': 'models/house.glb', 'items.glb': 'models/items.glb', 'house.json': 'data/house.json' };

const server = await createServer({ server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
let bytes = 0;
await page.exposeFunction('__save', (name, data) => {
  const path = join(OUT, DEST[name] || name);
  mkdirSync(dirname(path), { recursive: true });
  const buf = Buffer.from(data, 'base64');
  writeFileSync(path, buf);
  bytes += buf.length;
});
await page.goto('http://localhost:5194/?autostart=normal&skipintro=1&fixeddt=1&seed=EXPORT&nocat=1');
await page.waitForFunction(() => window.__game && window.__game.state === 'playing' && window.__game.audio.buffers.size > 0, null, { timeout: 240000, polling: 500 });
const summary = await page.evaluate(async () => {
  const { exportForGodot } = await import('/tools/godotExport.js');
  return exportForGodot(window.__game, (name, data) => window.__save(name, data));
});
console.log(JSON.stringify(summary), `${(bytes / 1e6).toFixed(1)} MB written`);
await browser.close();
await server.close();
