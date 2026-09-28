// Automated playtest: drives the real game in headless Chromium through a
// set of scenarios (patrol, chase, catch, hiding, horror events, escapes)
// and reports anything that throws or behaves unexpectedly.
// usage: node scripts/playtest.mjs [scenario...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('screenshots', { recursive: true });
const only = process.argv.slice(2);
const server = await createServer({ server: { port: 5198 }, logLevel: 'error' });
await server.listen();
const port = server.config.server.port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

let failures = 0;
async function scenario(name, query, fn) {
  if (only.length && !only.includes(name)) return;
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForFunction(() => window.__game && window.__game.state === 'playing' && window.__game.run, null, { timeout: 180000, polling: 250 });
    const res = await fn(page);
    const errs = errors.filter((e) => !e.includes('ERR_CERT') && !e.includes('fonts.g'));
    const ok = res.ok !== false && !errs.length;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s) ${JSON.stringify(res.info || {})}`);
    for (const e of errs.slice(0, 6)) console.log('   error:', e.slice(0, 500));
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    for (const er of errors.slice(0, 6)) console.log('   error:', er.slice(0, 500));
  }
  await page.close();
}

const base = 'autostart=normal&skipintro=1&fixeddt=1';

await scenario('look', `${base}&seed=LOOK`, async (page) => {
  await page.evaluate(() => {
    const g = window.__game;
    g.player.flash.has = true; g.player.flash.on = true;
    g.player.yaw = 0; g.player.pitch = -0.1;
  });
  await page.waitForFunction(() => window.__frames > 20, null, { timeout: 60000 });
  await page.screenshot({ path: 'screenshots/p_look.png' });
  return { info: await page.evaluate(() => ({ room: window.__game.player.room?.name, pickups: window.__game.items.pickups.length, notes: window.__game.world.interactables.filter((i) => i.kind === 'note').length })) };
});

await scenario('patrol', `${base}&seed=PATROL`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    g.director.phase = 'buildup';
    g.cat.emerge();
    const trace = [];
    for (let i = 0; i < 12; i++) {
      g.stepSim(5);
      trace.push(`${g.cat.state.name}@${g.cat.room ? g.cat.room.key : '?'}`);
    }
    return { trace, pos: [g.cat.pos.x.toFixed(1), g.cat.pos.z.toFixed(1)] };
  });
  const rooms = new Set(info.trace.map((t) => t.split('@')[1]));
  return { ok: rooms.size >= 2, info };
});

await scenario('chase', `${base}&seed=CHASE`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    g.director.phase = 'buildup';
    // put the cat down the hallway and let it see us
    p.pos.set(14.5, 3.2, 9.5); p.floor = 2; p.yaw = -Math.PI / 2;
    g.cat.teleport(2, 20.5, 9.5, -Math.PI / 2);
    g.cat.setState('patrol');
    g.cat._startChase();
    const trace = [];
    for (let i = 0; i < 40 && g.state === 'playing'; i++) {
      g.stepSim(0.5);
      trace.push(`${g.cat.state.name}:${g.cat.distToPlayer().toFixed(1)}`);
    }
    return { state: g.state, trace: trace.slice(-8) };
  });
  await page.waitForFunction(() => window.__frames > 5, null, { timeout: 60000 });
  await page.screenshot({ path: 'screenshots/p_caught.png' });
  // let the death cutscene play out
  const end = await page.evaluate(() => { const g = window.__game; g.stepSim(6); return { state: g.state, deathShown: g.ui.isOpen('death') }; });
  return { ok: end.deathShown || info.state === 'cutscene', info: { ...info, ...end } };
});

await scenario('hide', `${base}&seed=HIDE`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    g.director.phase = 'buildup';
    const spot = g.world.hidingSpots.find((h) => h.roomKey === '2g' && h.type === 'wardrobe');
    p.pos.copy(spot.entry); p.floor = 2;
    p.enterHiding(spot);
    g.stepSim(1.5);
    // the cat searches the room we vanished in
    g.cat.teleport(2, 21.5, 7.5, Math.PI);
    g.cat.lastSeen = { pos: spot.entry.clone(), time: g.time, vel: p.pos.clone().multiplyScalar(0), floor: 2 };
    g.cat._startSearch(spot.entry.clone());
    const trace = [];
    for (let i = 0; i < 60 && g.state === 'playing'; i++) {
      p.holdingBreath = false;
      g.stepSim(0.5);
      trace.push(g.cat.state.name + (g.cat.state.data.spot ? ':' + g.cat.state.data.spot.type : ''));
    }
    return { state: g.state, checks: g.cat.stats.checks, trace: [...new Set(trace)] };
  });
  return { ok: info.checks >= 1, info };
});

await scenario('events', `${base}&seed=EVENTS&nocat=1`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const results = {};
    const spots = [[2, 13.5, 9.5, -Math.PI / 2], [1, 13.5, 9.5, -Math.PI / 2], [1, 4.5, 11.5, Math.PI / 2], [2, 17.5, 5.5, -Math.PI / 2]];
    const ids = ['flicker', 'tvOn', 'doorCreep', 'windowStare', 'lightningReveal', 'mirror', 'footstepsAbove', 'ceilingCrawl', 'fakeJumpscare', 'silentBehind', 'whispers', 'laughDistant', 'scratchWalls', 'musicBox', 'rockingChair', 'pianoPlays', 'objectFall'];
    for (const id of ids) {
      let ran = false;
      for (const [f, x, z, yaw] of spots) {
        p.pos.set(x, (f - 1) * 3.2, z); p.floor = f; p.yaw = yaw; p.pitch = 0;
        g.stepSim(0.1);
        g.director.active = [];
        if (g.director.trigger(id)) { ran = true; break; }
      }
      g.stepSim(3);
      results[id] = ran;
    }
    return results;
  });
  return { info };
});

await scenario('escape-front', `${base}&seed=FRONT&nocat=1`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    p.give('key_front'); p.give('bolt_cutters');
    p.pos.set(16.9, 0, 23.4); p.floor = 1; p.yaw = 0; p.pitch = 0;
    const d = g.world.doors.get('front_door');
    const inter = g.interaction;
    g.objectives.useDoor(d, inter);
    // complete hold actions instantly
    if (inter.hold) inter.hold.onComplete(), inter.hold = null;
    g.objectives.useDoor(d, inter);
    if (inter.hold) inter.hold.onComplete(), inter.hold = null;
    g.objectives.useDoor(d, inter);
    g.stepSim(10);
    return { state: g.state, ending: g.ui.isOpen('ending') };
  });
  await page.waitForFunction(() => window.__frames > 5, null, { timeout: 60000 });
  await page.screenshot({ path: 'screenshots/p_ending.png' });
  return { ok: info.ending, info };
});

await scenario('escape-car', `${base}&seed=CAR&nocat=1`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    g.objectives.s.carBattery = true; g.objectives.s.carFuel = true;
    g.player.give('car_keys');
    g.startEscape('car');
    g.stepSim(11);
    return { state: g.state, ending: g.ui.isOpen('ending') };
  });
  return { ok: info.ending, info };
});

await scenario('secret', `${base}&seed=SECRET`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    for (const k of ['music_box', 'music_key', 'ribbon']) p.give(k);
    p.pos.set(13.4, 6.4, 3.8); p.floor = 3;
    const altar = g.world.interactables.find((i) => i.kind === 'altar');
    const t = { kind: 'altar', it: altar, pos: altar.pos };
    for (let i = 0; i < 3; i++) g.objectives.use(t, g.interaction);
    g.objectives.use(t, g.interaction);
    // hold E through the song
    const hold = g.interaction.hold;
    hold && hold.onComplete();
    g.interaction.hold = null;
    g.stepSim(12);
    const cat = g.cat.state.name;
    p.stance = 'prone'; p.height = 0.5; p.eye = 0.34;
    p.pos.set(9.6, 6.4, 9.5); p.yaw = Math.PI / 2;
    g.input.virtualMove.y = 1;
    g.stepSim(3);
    g.input.virtualMove.y = 0;
    g.stepSim(9);
    return { cat, state: g.state, ending: g.ui.isOpen('ending'), tiny: g.objectives.s.tinyOpen };
  });
  return { ok: info.ending, info };
});

await scenario('endless', 'autostart=hard&mode=endless&fixeddt=1&seed=ENDLESS', async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    // stand very still in the collection room and see what the night does
    p.pos.set(12, -3.2, 8.5); p.floor = 0;
    const trace = [];
    for (let i = 0; i < 20 && g.state === 'playing'; i++) { g.stepSim(3); trace.push(g.director.wave + ':' + g.cat.state.name); }
    return { state: g.state, wave: g.director.wave, trace: [...new Set(trace)] };
  });
  return { ok: info.wave >= 1, info };
});

await browser.close();
await server.close();
console.log(failures ? `\n${failures} scenario(s) failed` : '\nall scenarios passed');
process.exit(failures ? 1 : 0);
