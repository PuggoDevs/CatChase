// Screenshots of the menu flow: warning -> menu -> new game -> intro.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5197 }, logLevel: 'error' });
await server.listen();
const port = server.config.server.port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
await page.goto(`http://localhost:${port}/?fixeddt=1`);
await page.waitForSelector('.screen.warning:not(.hidden) button', { timeout: 180000 });
await page.screenshot({ path: 'screenshots/m_warning.png' });
await page.click('.screen.warning button');
await page.waitForSelector('.screen.menu:not(.hidden) .btn', { timeout: 180000 });
await page.waitForFunction(() => window.__frames > 30, null, { timeout: 120000 });
await page.screenshot({ path: 'screenshots/m_menu.png' });
await page.click('[data-a=story]');
await page.waitForSelector('.screen.newgame:not(.hidden)');
await page.screenshot({ path: 'screenshots/m_newgame.png' });
await page.click('[data-a=start]');
await page.waitForFunction(() => window.__game.state === 'cutscene', null, { timeout: 60000 });
const f0 = await page.evaluate(() => window.__frames);
await page.waitForFunction((f) => window.__frames > f + 25, f0, { timeout: 120000 });
await page.screenshot({ path: 'screenshots/m_intro.png' });
try {
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 120000 });
} catch (e) {
  console.log('state after intro:', await page.evaluate(() => ({ state: window.__game.state, t: window.__game.cutscenes.active && window.__game.cutscenes.active.t, frames: window.__frames, locked: window.__game.input.pointerLocked, drag: window.__game.input.dragLook })));
}
const f1 = await page.evaluate(() => window.__frames);
await page.waitForFunction((f) => window.__frames > f + 10, f1, { timeout: 120000 });
await page.screenshot({ path: 'screenshots/m_play.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
await server.close();
