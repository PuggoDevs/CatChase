// Horror events. Each has conditions and a cooldown; the Director picks
// among the eligible ones so no two nights play out the same way.
import * as THREE from 'three';
import { floorBaseY } from '../world/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function camForward(game) {
  return V(0, 0, -1).applyQuaternion(game.camera.quaternion);
}

function flatForward(game) {
  const f = camForward(game);
  f.y = 0;
  return f.normalize();
}

/** Is the phantom (or a point) currently looked at? */
function lookedAt(game, pos, cosMin = 0.85) {
  const to = pos.clone().sub(game.camera.position).normalize();
  return to.dot(camForward(game)) > cosMin;
}

function nearbyWindows(dir, maxD = 14, minD = 3) {
  const g = dir.game;
  const p = g.player;
  return g.world.windows.filter((w) => {
    if (w.f !== p.floor || w.style === 'boarded' || w.style === 'boarded-heavy' || w.style === 'frosted' || w.style === 'basement') return false;
    const d = Math.hypot(w.x - p.pos.x, w.z - p.pos.z);
    return d > minD && d < maxD;
  });
}

function whisperLine(game) {
  const lines = ['come out, come out...', 'I can hear you breathing', "we're still playing", 'Ellie? Is that you?', 'found you... found you...', 'hide and seek, hide and seek', 'your turn to hide'];
  return lines[Math.floor(Math.random() * lines.length)];
}

// Place the phantom just outside a window, staring in.
function phantomAtWindow(dir, w) {
  const g = dir.game;
  const [ox, oz] = w.outward;
  const p = g.player;
  let pos, flip = false;
  if (w.f <= 1) {
    pos = V(w.x + ox * 1.1, -0.3, w.z + oz * 1.1);
  } else {
    // hanging upside down from the eaves above the window
    pos = V(w.x + ox * 0.7, w.head + 0.9, w.z + oz * 0.7);
    flip = true;
  }
  const yaw = Math.atan2(p.pos.x - pos.x, p.pos.z - pos.z);
  dir.showPhantom(pos, yaw, flip ? 'hang' : 'stare', { flip: false, slot: g.world.grid.outsideLightSlot });
  if (flip) {
    dir.phantom.root.rotation.set(0, yaw, Math.PI, 'YXZ');
    dir.phantom.root.position.y = w.head + 1.9;
  }
  return pos;
}

export const HORROR_EVENTS = {
  flicker: {
    weight: 3, cooldown: 25,
    canRun(dir) {
      const g = dir.game;
      const room = g.player.room;
      return room && g.world.lighting.power && (g.world.lighting.byRoom.get(room.index) || []).some((f) => f.on);
    },
    start(dir) {
      const g = dir.game;
      g.world.lighting.stutterRoom(g.player.room.index, 1.5 + Math.random() * 2.5);
      g.audio.play('static', { volume: 0.12, rate: 0.5, reverb: 0 });
      if (Math.random() < 0.3) g.player.flash.flicker = 1.2;
      return null;
    },
  },

  tvOn: {
    weight: 1.5, cooldown: 120, minTime: 60,
    canRun(dir) {
      const g = dir.game;
      return g.world.lighting.power && g.world.tvs.some((tv) => !tv.on && tv.pos.distanceTo(g.player.pos) < 18);
    },
    start(dir) {
      const g = dir.game;
      const tv = g.world.tvs.find((t) => !t.on && t.pos.distanceTo(g.player.pos) < 18);
      g.world.setTV(tv, true, 0);
      g.audio.tvStatic(tv, true);
      g.noise(tv.pos.clone(), 13, 'tv', 'house');
      g.ui.subtitle('[a television hisses to life]');
      let t = 0;
      return {
        update(dt) {
          t += dt;
          tv.face = t > 3 && t < 3.6 ? 1 : t > 7 && t < 7.25 ? 1 : 0;
          if (!tv.on) return true;
          if (t > 40) { g.world.setTV(tv, false); return true; }
          return false;
        },
      };
    },
  },

  doorCreep: {
    weight: 2, cooldown: 40,
    canRun(dir) {
      const g = dir.game;
      return g.world.doorList.some((d) => d.type === 'door' && d.f === g.player.floor && d.isClosed() && !d.locked && !d.barricade && V(d.center.x, d.center.y, d.center.z).distanceTo(g.player.pos) < 9);
    },
    start(dir) {
      const g = dir.game;
      const cands = g.world.doorList.filter((d) => d.type === 'door' && d.f === g.player.floor && d.isClosed() && !d.locked && !d.barricade && V(d.center.x, d.center.y, d.center.z).distanceTo(g.player.pos) < 9);
      const d = cands[Math.floor(Math.random() * cands.length)];
      d.ghostOpen(0.25 + Math.random() * 0.3);
      return null;
    },
  },

  windowStare: {
    weight: 1.4, cooldown: 110, minTime: 90,
    canRun(dir) {
      const g = dir.game;
      if (dir.phantomOn || g.player.hiding) return false;
      return nearbyWindows(dir).some((w) => g.canPlayerSee(V(w.x, w.sill + 0.6, w.z), 0.1));
    },
    start(dir) {
      const g = dir.game;
      const w = nearbyWindows(dir).find((x) => g.canPlayerSee(V(x.x, x.sill + 0.6, x.z), 0.1));
      const pos = phantomAtWindow(dir, w);
      if (Math.random() < 0.5) g.world.exterior.triggerLightning(0.8);
      let t = 0, seen = 0, away = 0, stung = false, lit = 0;
      const head = pos.clone().add(V(0, 1.7, 0));
      return {
        update(dt) {
          t += dt;
          const looking = lookedAt(g, head, 0.9);
          if (looking) {
            seen += dt;
            if (!stung && seen > 0.25) { stung = true; g.audio.stinger(0.45); g.onScare(0.5); }
            if (g.player.flash.on) lit += dt;
          } else if (seen > 0) away += dt;
          if (t > 6 || away > 0.4 || lit > 0.5 || (seen > 2.5)) { dir.hidePhantom(); return true; }
          return false;
        },
        cleanup() { dir.hidePhantom(); },
      };
    },
  },

  lightningReveal: {
    weight: 1, cooldown: 120, minTime: 100,
    canRun(dir) {
      const g = dir.game;
      if (dir.phantomOn || g.player.hiding || g.settings.reduceFlashes) return false;
      return nearbyWindows(dir, 12, 2).some((w) => g.canPlayerSee(V(w.x, w.sill + 0.6, w.z), 0.2));
    },
    start(dir) {
      const g = dir.game;
      const w = nearbyWindows(dir, 12, 2).find((x) => g.canPlayerSee(V(x.x, x.sill + 0.6, x.z), 0.2));
      phantomAtWindow(dir, w);
      g.world.exterior.triggerLightning(1.3);
      let t = 0;
      return {
        update(dt) {
          t += dt;
          if (t > 0.45) { dir.hidePhantom(); return true; }
          return false;
        },
        cleanup() { dir.hidePhantom(); },
      };
    },
  },

  mirror: {
    weight: 2.5, cooldown: 80,
    canRun(dir) {
      const g = dir.game;
      const mr = g.world.liveMirror;
      if (!mr || dir.phantomOn || g.player.hiding) return false;
      return mr.pos.distanceTo(g.camera.position) < 3.8 && lookedAt(g, mr.pos, 0.8);
    },
    start(dir) {
      const g = dir.game;
      const p = g.player;
      const f = flatForward(g);
      // stands right behind you - only the mirror can see it
      const pos = V(p.pos.x - f.x * 1.15, p.pos.y, p.pos.z - f.z * 1.15);
      const yaw = Math.atan2(f.x, f.z);
      dir.showPhantom(pos, yaw, 'stare', { mirrorOnly: true, twitch: 2 });
      g.audio.whisper(pos.clone().add(V(0, 1.6, 0)));
      let t = 0;
      return {
        update(dt) {
          t += dt;
          const back = pos.clone().add(V(0, 1.5, 0));
          if (lookedAt(g, back, 0.3) || t > 2.2) {
            if (t < 2.2) { g.fx.static(0.4); g.audio.stinger(0.35); }
            dir.hidePhantom();
            return true;
          }
          return false;
        },
        cleanup() { dir.hidePhantom(); },
      };
    },
  },

  footstepsAbove: {
    weight: 1.6, cooldown: 90, minTime: 45,
    canRun(dir) {
      const g = dir.game;
      const p = g.player;
      return p.floor < 3 && g.world.grid.cellRaw(p.floor + 1, Math.floor(p.pos.x), Math.floor(p.pos.z)) >= 0;
    },
    start(dir) {
      const g = dir.game;
      const p = g.player;
      const y = floorBaseY(p.floor + 1) + 0.1;
      const a = Math.random() * Math.PI * 2;
      const from = V(p.pos.x + Math.cos(a) * 5, y, p.pos.z + Math.sin(a) * 5);
      const to = V(p.pos.x - Math.cos(a) * 5, y, p.pos.z - Math.sin(a) * 5);
      let t = 0, step = 0;
      g.ui.subtitle('[something runs across the floor above you]');
      return {
        update(dt) {
          t += dt;
          step -= dt;
          if (step <= 0 && t < 1.8) {
            step = 0.13;
            const pos = from.clone().lerp(to, t / 1.8);
            g.audio.catStep(pos, 1.2, true, false);
          }
          if (t > 2.2) {
            // sometimes it's really up there now, on the ceiling
            const cat = g.cat;
            if ((cat.state.name === 'dormant' || cat.hidden) && Math.random() < 0.5) {
              const f = p.floor + 1;
              const room = g.world.grid.roomAtWorld(f, to.x, to.z);
              const pt = room && cat.nav.randomPointInRoom(room, g.run.rng);
              if (pt) {
                cat.teleport(pt.f, pt.x, pt.z);
                cat.mode = 'ceiling';
                cat.setState('patrol');
              }
            }
            return true;
          }
          return false;
        },
      };
    },
  },

  ceilingCrawl: {
    weight: 1.1, cooldown: 140, minTime: 110,
    canRun(dir) {
      const g = dir.game;
      if (dir.phantomOn || g.player.hiding) return false;
      if (!(g.cat.hidden || g.cat.distToPlayer() > 16)) return false;
      return !!HORROR_EVENTS.ceilingCrawl._spot(dir);
    },
    _spot(dir) {
      const g = dir.game;
      const p = g.player;
      const f = flatForward(g);
      for (const d of [8, 7, 6]) {
        const x = p.pos.x + f.x * d, z = p.pos.z + f.z * d;
        const room = g.world.grid.roomAtWorld(p.floor, x, z);
        if (!room || room.floor !== p.floor) continue;
        const pos = V(x, room.baseY + room.ceil, z);
        if (!g.world.grid.hasLineOfSight(p.floor, p.pos.x, p.pos.z, x, z)) continue;
        return { pos, room, dir: f };
      }
      return null;
    },
    start(dir) {
      const g = dir.game;
      const s = HORROR_EVENTS.ceilingCrawl._spot(dir);
      const yaw = Math.atan2(s.dir.x, s.dir.z);
      dir.showPhantom(s.pos, yaw, 'crawl', { flip: true, slot: s.room.lightSlot, twitch: 2 });
      dir.phantom.root.rotation.set(0, yaw, Math.PI, 'YXZ');
      dir.phantomSpeed = 3;
      let t = 0, stung = false;
      g.audio.catVocal('hiss', s.pos);
      return {
        update(dt) {
          t += dt;
          dir.phantom.root.position.addScaledVector(s.dir, dt * 3.2);
          if (dt > 0 && Math.random() < 0.2) g.audio.catStep(dir.phantom.root.position.clone(), 0.7, true, true);
          if (!stung && lookedAt(g, dir.phantom.root.position, 0.85)) { stung = true; g.audio.stinger(0.4); g.onScare(0.6); }
          if (t > 2.2) { dir.hidePhantom(); dir.phantomSpeed = 0; return true; }
          return false;
        },
        cleanup() { dir.hidePhantom(); dir.phantomSpeed = 0; },
      };
    },
  },

  fakeJumpscare: {
    weight: 0.7, cooldown: 200, minTime: 150,
    canRun(dir) {
      const g = dir.game;
      if (dir.phantomOn || g.player.hiding) return false;
      if (!(g.cat.hidden || g.cat.distToPlayer() > 15)) return false;
      const p = g.player, f = flatForward(g);
      return g.world.grid.hasLineOfSight(p.floor, p.pos.x, p.pos.z, p.pos.x + f.x * 4, p.pos.z + f.z * 4);
    },
    start(dir) {
      const g = dir.game;
      const p = g.player;
      const f = flatForward(g);
      const pos = V(p.pos.x + f.x * 4, p.pos.y, p.pos.z + f.z * 4);
      dir.showPhantom(pos, Math.atan2(-f.x, -f.z), 'lunge', { twitch: 0 });
      dir.phantomAnim.jawOverride = 1;
      g.audio.stinger(1);
      g.onScare(1);
      let t = 0;
      return {
        update(dt) {
          t += dt;
          const cam = g.camera.position;
          const target = V(cam.x, cam.y - 1.3, cam.z);
          dir.phantom.root.position.lerp(target, Math.min(1, dt * 7));
          if (dir.phantom.root.position.distanceTo(target) < 0.7 || t > 0.6) {
            g.fx.static(0.8);
            g.player.addShake(0.08, 0.4);
            dir.phantomAnim.jawOverride = null;
            dir.hidePhantom();
            return true;
          }
          return false;
        },
        cleanup() { dir.phantomAnim.jawOverride = null; dir.hidePhantom(); },
      };
    },
  },

  silentBehind: {
    weight: 0.6, cooldown: 240, minTime: 180,
    canRun(dir) {
      const g = dir.game;
      const p = g.player;
      if (dir.phantomOn || p.hiding || g.cat.visibleToPlayer) return false;
      const f = flatForward(g);
      const x = p.pos.x - f.x * 1.25, z = p.pos.z - f.z * 1.25;
      return g.world.grid.roomAtWorld(p.floor, x, z) === p.room && g.world.collision.isFree(V(x, p.pos.y, z), 0.25, 1.8);
    },
    start(dir) {
      const g = dir.game;
      const p = g.player;
      const f = flatForward(g);
      const pos = V(p.pos.x - f.x * 1.25, p.pos.y, p.pos.z - f.z * 1.25);
      g.audio.silence(5, 0.0);
      dir.showPhantom(pos, Math.atan2(f.x, f.z), 'stare', { twitch: 0.5 });
      dir.phantomAnim.grinOverride = 1.5;
      let t = 0;
      return {
        update(dt) {
          t += dt;
          const head = dir.phantom.root.position.clone().add(V(0, 1.7, 0));
          if (t > 0.3 && lookedAt(g, head, 0.55)) {
            g.audio.unsilence();
            g.audio.stinger(1);
            g.fx.static(0.9);
            g.onScare(1);
            g.player.addShake(0.06, 0.4);
            // on the hardest nights, it wasn't a ghost
            if (g.run.diff.deception > 0.8 && Math.random() < 0.3 && g.cat.hidden) {
              g.cat.teleport(p.floor, pos.x, pos.z, Math.atan2(p.pos.x - pos.x, p.pos.z - pos.z));
              g.cat._startChase(true);
            }
            dir.hidePhantom();
            return true;
          }
          if (t > 5) {
            g.ui.subtitle(`[whispering, right behind you: "${whisperLine(g)}"]`);
            g.audio.whisper(head);
            dir.hidePhantom();
            return true;
          }
          return false;
        },
        cleanup() { dir.phantomAnim.grinOverride = null; dir.hidePhantom(); },
      };
    },
  },

  footOfBed: {
    weight: 4, cooldown: 70,
    canRun(dir) {
      const g = dir.game;
      const h = g.player.hiding;
      return h && h.phase === 'in' && h.spot.type === 'bed' && g.cat.state.name !== 'check' && !dir.phantomOn;
    },
    start(dir) {
      const g = dir.game;
      const spot = g.player.hiding.spot;
      const out = spot.exit.clone().sub(spot.inside).setY(0).normalize();
      const pos = spot.exit.clone().addScaledVector(out, 0.2);
      pos.y = floorBaseY(spot.f);
      dir.showPhantom(pos, Math.atan2(-out.x, -out.z), 'lookUnder', { twitch: 1.8 });
      g.audio.catVocal('purr', pos.clone().add(V(0, 0.4, 0)));
      let t = 0;
      return {
        update(dt) {
          t += dt;
          if (!g.player.hiding || t > 3.2) { dir.hidePhantom(); return true; }
          if (t > 1.2 && t < 1.25) g.onScare(0.7);
          return false;
        },
        cleanup() { dir.hidePhantom(); },
      };
    },
  },

  whispers: {
    weight: 2, cooldown: 70,
    canRun() { return true; },
    start(dir) {
      const g = dir.game;
      let t = 0, n = 0;
      g.ui.subtitle(`[whispering: "${whisperLine(g)}"]`);
      return {
        update(dt) {
          t += dt;
          if (t > n * 0.9 && n < 4) {
            const a = Math.random() * Math.PI * 2;
            const cam = g.camera.position;
            g.audio.whisper(V(cam.x + Math.cos(a) * 2.5, cam.y, cam.z + Math.sin(a) * 2.5));
            n++;
          }
          return t > 4;
        },
      };
    },
  },

  laughDistant: {
    weight: 2, cooldown: 60, minTime: 30,
    canRun() { return true; },
    start(dir) {
      const g = dir.game;
      const a = Math.random() * Math.PI * 2;
      const cam = g.camera.position;
      g.audio.catVocal('laugh', V(cam.x + Math.cos(a) * 14, cam.y + (Math.random() - 0.5) * 3, cam.z + Math.sin(a) * 14));
      return null;
    },
  },

  scratchWalls: {
    weight: 1.5, cooldown: 60, minTime: 40,
    canRun() { return true; },
    start(dir) {
      const g = dir.game;
      const cam = g.camera.position.clone();
      const a = Math.random() * Math.PI * 2;
      const from = V(cam.x + Math.cos(a) * 3, cam.y - 1.2, cam.z + Math.sin(a) * 3);
      const to = V(cam.x - Math.cos(a) * 3, cam.y + 0.5, cam.z - Math.sin(a) * 3);
      let t = 0, k = 0;
      g.ui.subtitle('[scratching inside the walls]');
      return {
        update(dt) {
          t += dt; k -= dt;
          if (k <= 0) { k = 0.3; g.audio.ventScratch(from.clone().lerp(to, Math.min(1, t / 3))); }
          return t > 3;
        },
      };
    },
  },

  musicBox: {
    weight: 0.8, cooldown: 200, minTime: 120,
    canRun(dir) { return dir.game.run.mode !== 'endless'; },
    start(dir) {
      const g = dir.game;
      const pos = g.world.altarPos ? g.world.altarPos.clone() : V(12, 7, 5);
      const melody = [12, 10, 7, 10, 12, 12, 12, 10, 10, 10, 12, 15, 15];
      let t = 0, i = 0;
      g.ui.subtitle('[a music box, somewhere far above]');
      return {
        update(dt) {
          t += dt;
          if (t > i * 0.42 * (1 + i * 0.03) && i < melody.length) { g.audio.bell(melody[i], pos, 0.45); i++; }
          return i >= melody.length && t > 7;
        },
      };
    },
  },

  rockingChair: {
    weight: 1.3, cooldown: 90,
    canRun(dir) {
      const g = dir.game;
      return g.world.rockingChairs.some((c) => c.part.holder.position.distanceTo(g.player.pos) < 9 && c.rock < 0.2);
    },
    start(dir) {
      const g = dir.game;
      const c = g.world.rockingChairs.find((x) => x.part.holder.position.distanceTo(g.player.pos) < 9 && x.rock < 0.2);
      c.rock = 1;
      let t = 0, k = 0;
      return {
        update(dt) {
          t += dt; k -= dt;
          if (k <= 0) { k = 1.4; g.audio.creak(c.part.holder.position.clone(), 0.35); }
          return t > 8;
        },
      };
    },
  },

  pianoPlays: {
    weight: 0.8, cooldown: 150, minTime: 90,
    canRun(dir) {
      const g = dir.game;
      return g.world.interactables.some((i) => i.kind === 'piano' && i.pos.distanceTo(g.player.pos) < 22 && i.pos.distanceTo(g.player.pos) > 5);
    },
    start(dir) {
      const g = dir.game;
      const it = g.world.interactables.find((i) => i.kind === 'piano' && i.pos.distanceTo(g.player.pos) < 22 && i.pos.distanceTo(g.player.pos) > 5);
      g.audio.piano(it.pos);
      g.noise(it.pos.clone(), 18, 'piano', 'house');
      g.ui.subtitle('[the piano plays by itself]');
      return null;
    },
  },

  objectFall: {
    weight: 1.5, cooldown: 50,
    canRun() { return true; },
    start(dir) {
      const g = dir.game;
      const a = Math.random() * Math.PI * 2;
      const p = g.player.pos;
      const pos = V(p.x + Math.cos(a) * 4, p.y + 0.3, p.z + Math.sin(a) * 4);
      g.audio.impact(Math.random() < 0.5 ? 'bottle' : 'book', pos, 0.8);
      g.noise(pos, 8, 'fall', 'house');
      return null;
    },
  },

  stare: {
    weight: 1.5, cooldown: 100, minTime: 30,
    canRun(dir, opts = {}) {
      const g = dir.game;
      const cat = g.cat;
      if (g.player.hiding) return false;
      if (!opts.force && !(cat.state.name === 'dormant' || (cat.state.name === 'patrol' && cat.distToPlayer() > 18 && !cat.visibleToPlayer))) return false;
      return !!HORROR_EVENTS.stare._spot(dir);
    },
    _spot(dir) {
      const g = dir.game;
      const p = g.player;
      const f = flatForward(g);
      const grid = g.world.grid;
      // prefer somewhere down the line of sight, far and dark
      const tries = [];
      for (let i = 0; i < 24; i++) {
        const ang = (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.12;
        const c = Math.cos(ang), s = Math.sin(ang);
        const dx = f.x * c - f.z * s, dz = f.x * s + f.z * c;
        for (const d of [13, 11, 9]) tries.push([p.pos.x + dx * d, p.pos.z + dz * d]);
      }
      for (const [x, z] of tries) {
        const room = grid.roomAtWorld(p.floor, x, z);
        if (!room || room.floor !== p.floor || room.kind === 'stairs') continue;
        if (g.cat.nav.isBlocked(p.floor, Math.floor(x), Math.floor(z))) continue;
        if (!grid.hasLineOfSight(p.floor, p.pos.x, p.pos.z, x, z)) continue;
        if (g.world.collision.segmentBlocked(V(p.pos.x, p.pos.y + 1.6, p.pos.z), V(x, p.pos.y + 1.6, z))) continue;
        return { x, z };
      }
      return null;
    },
    start(dir) {
      const g = dir.game;
      const s = HORROR_EVENTS.stare._spot(dir);
      g.cat.startStare(g.player.floor, s.x, s.z);
      g.audio.silence(2.5, 0.25);
      return null;
    },
  },
};
