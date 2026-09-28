// Screenshot harness for development and CI smoke checks.
// usage: node scripts/shot.mjs '<json array of {q, out, frames?, w?, h?, eval?}>'
//    or: node scripts/shot.mjs "<querystring>" out.png [frames]
import { createServer } from 'vite';
import { chromium } from 'playwright';

const arg = process.argv[2];
let shots;
if (arg && arg.trim().startsWith('[')) shots = JSON.parse(arg);
else shots = [{ q: arg || 'view=21.5,4.8,9.8,-90,0', out: process.argv[3] || 'screenshots/shot.png', frames: Number(process.argv[4] || 20) }];

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const port = server.config.server.port;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
try {
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.w || 960, height: s.h || 540 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?${s.q}`);
    try {
      await page.waitForFunction((n) => window.__ready && (window.__frames || 0) >= n, s.frames || 12, { timeout: s.timeout || 240000, polling: 250 });
    } catch (e) {
      errors.push('[timeout] ' + e.message.split('\n')[0]);
      failed = true;
    }
    if (s.eval) {
      const r = await page.evaluate(s.eval);
      if (r !== undefined) console.log('eval:', JSON.stringify(r));
      if (s.after) await page.waitForFunction((n) => (window.__frames || 0) >= n, s.after, { timeout: 120000, polling: 250 });
    }
    await page.screenshot({ path: s.out });
    const stat = await page.evaluate(() => document.querySelector('div[style*="monospace"]')?.textContent || '');
    console.log(`${s.out}  (${((Date.now() - t0) / 1000).toFixed(1)}s) ${stat}`);
    const uniq = [...new Set(errors)];
    if (uniq.length) {
      console.log('  console issues:');
      for (const e of uniq.slice(0, 15)) console.log('   ', e.slice(0, 400));
      if (uniq.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]'))) failed = true;
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
