// Smoke test: boots the game in headless Chromium, checks the menu comes up,
// starts a night, lets the house and the cat run for a while and fails on any
// page error. Pass --dist to test the production build instead of the dev
// server (run `npm run build` first).
// usage: node scripts/smoke.mjs [--dist]
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';

const useDist = process.argv.includes('--dist');
const server = useDist
  ? await preview({ preview: { port: 5197, strictPort: true }, logLevel: 'error' })
  : await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
if (!useDist) await server.listen();
const url = `http://localhost:5197/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

const errors = [];
let failed = false;
function check(ok, what, info = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${info ? ' - ' + info : ''}`);
  if (!ok) failed = true;
}
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // fonts come from Google and may be blocked in CI; that's not our bug
    if (m.type() === 'error' && !/fonts\.g|ERR_CERT|net::ERR_/.test(m.text())) errors.push(m.text());
  });
  await page.goto(url + query);
  return page;
}

try {
  // 1. the menu
  let page = await open('');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 250 });
  // the content warning comes first, then the main menu
  await page.click('[data-a=go]');
  await page.waitForSelector('[data-a=story]', { timeout: 120000 });
  const menu = await page.evaluate(() => ({ state: window.__game.state, buttons: [...document.querySelectorAll('.menu-buttons button')].map((b) => b.textContent.trim()) }));
  check(menu.state === 'menu' && menu.buttons.includes('New Night'), 'menu loads', menu.buttons.join(' / '));
  await page.close();

  // 2. a night: world, items, the cat and the director all running
  page = await open('?autostart=normal&skipintro=1&fixeddt=1&seed=SMOKE');
  await page.waitForFunction(() => window.__game && window.__game.state === 'playing', null, { timeout: 180000, polling: 250 });
  await page.waitForFunction(() => window.__frames > 10, null, { timeout: 120000 });
  const night = await page.evaluate(() => {
    const g = window.__game;
    g.director.phase = 'buildup';
    g.cat.emerge();
    const states = new Set();
    for (let i = 0; i < 30 && g.state === 'playing'; i++) {
      g.stepSim(1);
      states.add(g.cat.state.name);
    }
    return {
      state: g.state,
      room: g.player.room && g.player.room.name,
      pickups: g.items.pickups.length,
      hidingSpots: g.world.hidingSpots.length,
      catStates: [...states],
      drawCalls: g.renderer.info.render.calls,
    };
  });
  check(night.room === 'Guest Bedroom', 'player wakes in the guest bedroom', night.room);
  check(night.pickups > 20 && night.hidingSpots > 20, 'house is furnished and stocked', `${night.pickups} pickups, ${night.hidingSpots} hiding spots`);
  check(night.catStates.length > 0 && !night.catStates.includes('dormant'), 'the cat is awake and hunting', night.catStates.join(', '));
  check(night.drawCalls > 0, 'frames render', `${night.drawCalls} draw calls`);
  await page.waitForFunction((f) => window.__frames > f, 20, { timeout: 120000 });
  await page.close();
  check(errors.length === 0, 'no page errors', errors.slice(0, 5).join(' | '));
} catch (e) {
  check(false, 'smoke run', e.message.split('\n')[0]);
  for (const er of errors.slice(0, 5)) console.log('   error:', er.slice(0, 400));
}

await browser.close();
if (useDist) server.httpServer.close(); else await server.close();
console.log(failed ? '\nsmoke test FAILED' : '\nsmoke test passed');
process.exit(failed ? 1 : 0);
