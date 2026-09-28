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
    // and the room with the television in it
    for (const tv of g.world.tvs) { const r = g.world.grid.rooms[tv.room]; spots.push([r.floor, r.cx, r.cz, 0]); }
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
  return { ok: Object.values(info).every(Boolean), info };
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


await scenario('distraction', `${base}&seed=THROW`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    g.director.phase = 'buildup';
    p.pos.set(14.5, 3.2, 9.5); p.floor = 2; p.yaw = -Math.PI / 2; p.pitch = 0;
    g.cat.teleport(2, 22.5, 4.5, 0); // guest bedroom
    g.cat.setState('patrol');
    g.stepSim(0.1);
    const out = [];
    const heard = [];
    const orig = g.cat.hear.bind(g.cat);
    g.cat.hear = (n) => { heard.push(n.kind + ':' + n.radius.toFixed(0)); orig(n); };
    for (let k = 0; k < 5; k++) {
      p.held = { kind: 'bottle', def: { name: 'Bottle', noise: 17, breaks: true } };
      const susNow = g.cat.learn.distractionSuspicion(g.time, g.run.diff);
      g.throwables.throwHeld();
      const fl = g.throwables.flying.length;
      g.stepSim(2);
      if (k === 0) window.__dbg = { fl, heard: [...heard], flying: g.throwables.flying.length };
      const st = g.cat.state;
      out.push(st.name + (st.data && st.data.kind ? ':' + st.data.kind : '') + '@' + susNow.toFixed(2));
      g.cat.teleport(2, 22.5, 4.5, 0);
      g.cat.setState('patrol');
      g.cat.learn.recordFooled(g.time);
      p.pos.set(14.5, 3.2, 9.5); p.yaw = -Math.PI / 2;
      g.stepSim(0.1);
    }
    // fooled over and over: now it must never fall for a throw again
    for (let k = 0; k < 6; k++) g.cat.learn.recordFooled(g.time);
    const wise = [];
    for (let k = 0; k < 6; k++) {
      p.held = { kind: 'bottle', def: { name: 'Bottle', noise: 17, breaks: true } };
      g.throwables.throwHeld();
      g.stepSim(2);
      const st = g.cat.state;
      wise.push(st.name + (st.data && st.data.kind ? ':' + st.data.kind : ''));
      g.cat.teleport(2, 22.5, 4.5, 0);
      g.cat.setState('patrol');
      p.pos.set(14.5, 3.2, 9.5); p.yaw = -Math.PI / 2;
      g.stepSim(0.1);
    }
    return { out, wise, fooled: g.cat.learn.fooled.length, suspicion: g.cat.learn.distractionSuspicion(g.time, g.run.diff).toFixed(2) };
  });
  return { ok: info.out[0].startsWith('investigate') && !info.wise.some((s) => s === 'investigate:distraction'), info };
});

await scenario('underbed', `${base}&seed=UNDER`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const c = g.cat;
    g.director.phase = 'buildup';
    const spot = g.world.hidingSpots.find((h) => h.type === 'bed' && h.roomKey === '2M');
    const room = g.world.grid.rooms[spot.room];
    const lurk = () => {
      c.teleport(spot.f, spot.exit.x, spot.exit.z, 0);
      c.detection = 0;
      c.setState('ambush', { room, ceiling: false, under: spot, wait: 60, lurking: false });
      g.stepSim(0.2);
    };
    const aim = (v) => {
      const e = p.eyePos.clone();
      p.yaw = Math.atan2(-(v.x - e.x), -(v.z - e.z));
      p.pitch = Math.atan2(v.y - e.y, Math.hypot(v.x - e.x, v.z - e.z));
    };
    lurk();
    const face = c.face.root.position.clone();
    // somewhere in the room with a clear view of the bed, 2.5-7 m away
    let stand = null;
    for (let i = 0; i < 80 && !stand; i++) {
      const pt = c.nav.randomPointInRoom(room, g.run.rng);
      const d = pt && Math.hypot(pt.x - face.x, pt.z - face.z);
      if (!pt || d < 2.5 || d > 7) continue;
      p.pos.set(pt.x, g.world.grid.groundY(2, pt.x, pt.z), pt.z); p.floor = 2;
      aim(face);
      g.stepSim(0.05);
      if (g.canPlayerSee(face.clone().setY(face.y + 0.08), 0)) stand = pt;
    }
    if (!stand) return { error: 'no view of the bed' };
    // 1: in the dark, looking away, it just waits
    p.flash.has = true; p.flash.on = false;
    p.yaw += Math.PI; p.pitch = 0;
    g.stepSim(3);
    const waited = { state: c.state.name, lurking: !!c.lurkSpot, face: c.face.root.visible, body: c.model.root.visible };
    // 2: the flashlight finds its eyes
    p.flash.on = true;
    aim(face);
    let burst = null;
    for (let i = 0; i < 40 && !burst; i++) {
      g.stepSim(0.1);
      if (c.state.name === 'chase') burst = { t: (i + 1) / 10, body: c.model.root.visible, face: c.face.root.visible };
    }
    // 3: crawl under the bed it's lying under
    c.teleport(2, 3, 3, 0);
    c.setState('patrol');
    p.flash.on = false;
    lurk();
    let kind = null;
    const orig = g.cutscenes.death.bind(g.cutscenes);
    g.cutscenes.death = (k, s, done) => { kind = k; return orig(k, s, done); };
    p.pos.copy(spot.entry); p.floor = 2;
    p.enterHiding(spot);
    g.stepSim(0.5);
    const during = { state: g.state, face: c.face.root.visible };
    g.stepSim(4);
    return { stand: [stand.x.toFixed(1), stand.z.toFixed(1)], waited, burst, kind, during, end: g.state, faceAfter: c.face.root.visible };
  });
  const ok = !info.error && info.waited.lurking && info.waited.face && !info.waited.body
    && info.burst && info.burst.body && !info.burst.face
    && info.kind === 'under' && info.during.face && !info.faceAfter;
  return { ok, info };
});

await scenario('barricade', 'autostart=hard&skipintro=1&fixeddt=1&seed=BARR', async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    g.director.phase = 'buildup';
    // we are in the guest bedroom; barricade its door and let the cat come
    const d = g.world.doors.get('guest_door');
    d.open = d.target = 0; d.update(0.1); d.updateCollider();
    d.addBarricade(1);
    p.pos.set(21.5, 3.2, 4); p.floor = 2;
    g.cat.teleport(2, 21.5, 10.3, Math.PI);
    g.cat._startChase();
    const trace = [];
    for (let i = 0; i < 40 && g.state === 'playing'; i++) { g.stepSim(0.5); trace.push(g.cat.state.name + '/' + d.barricade + (d.broken ? 'B' : '')); }
    return { barricadeLeft: d.barricade, broken: d.broken, trace: [...new Set(trace)].slice(0, 12), state: g.state };
  });
  return { ok: info.barricadeLeft === 0, info };
});

await scenario('vent', `${base}&seed=VENT`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const cat = g.cat;
    g.director.phase = 'buildup';
    // kitchen vent -> upper hallway vent
    const a = g.world.vents.find((v) => v.id === 'v_kitchen');
    cat.teleport(1, a.mouth.x, a.mouth.z, 0);
    cat.setState('patrol', { target: { f: 2, x: 30.5, z: 9.5 }, room: g.world.grid.roomByKey['2u'], lingers: 0, wait: 99 });
    const ok = cat.goTo(2, 30.5, 9.5, { speed: 2, vents: true, ventCost: 0.05 });
    const modes = [];
    for (let i = 0; i < 40; i++) { g.stepSim(0.4); modes.push(cat.mode + '@' + cat.floor); }
    return { ok, usesVent: cat.path ? cat.path.usesVent : 'arrived', modes: [...new Set(modes)], end: [cat.pos.x.toFixed(1), cat.pos.z.toFixed(1), cat.floor] };
  });
  return { ok: info.modes.some((m) => m.startsWith('vent')), info };
});

await scenario('stare', `${base}&seed=STARE`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    g.director.phase = 'buildup';
    p.pos.set(10.5, 3.2, 9.5); p.floor = 2; p.yaw = -Math.PI / 2; p.pitch = 0;
    g.stepSim(0.2);
    const ran = g.director.trigger('stare');
    g.stepSim(0.5);
    return { ran: !!ran, state: g.cat.state.name, visible: g.cat.visibleToPlayer, pos: [g.cat.pos.x.toFixed(1), g.cat.pos.z.toFixed(1)] };
  });
  await page.waitForFunction(() => window.__frames > 8, null, { timeout: 60000 });
  await page.screenshot({ path: 'screenshots/p_stare.png' });
  return { ok: info.ran && info.state === 'stare', info };
});

await scenario('outage', `${base}&seed=POWER&nocat=1`, async (page) => {
  const info = await page.evaluate(() => {
    const g = window.__game;
    g.director.powerOutage();
    g.stepSim(1);
    const off = !g.world.lighting.power;
    g.objectives.s.fuseBlown = false;
    const fb = g.world.interactables.find((i) => i.kind === 'fusebox');
    g.objectives.use({ kind: 'fusebox', it: fb, pos: fb.pos }, g.interaction);
    g.interaction.hold && g.interaction.hold.onComplete();
    g.interaction.hold = null;
    g.stepSim(1);
    return { wentOff: off, restored: g.world.lighting.power };
  });
  return { ok: info.wentOff && info.restored, info };
});

await browser.close();
await server.close();
console.log(failures ? `\n${failures} scenario(s) failed` : '\nall scenarios passed');
process.exit(failures ? 1 : 0);
