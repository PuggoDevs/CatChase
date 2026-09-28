// Picks what the player is looking at and runs the context actions:
// doors (open / quiet / slam / lock / barricade), pickups, hiding spots,
// switches, lamps, TVs, the piano, notes and objective machinery.
import * as THREE from 'three';
import { NOISE, PLAYER } from '../config.js';
import { ITEM_DEFS } from '../game/items.js';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Interaction {
  constructor(game) {
    this.game = game;
    this.target = null;
    this.hold = null;       // active hold-to-use action
    this.doorPress = null;  // tap vs hold detection for doors
  }

  get player() { return this.game.player; }
  get world() { return this.game.world; }

  /** Gather candidate targets near the player. */
  _candidates() {
    const p = this.player;
    const eye = p.eyePos.clone();
    const out = [];
    const near = (pos, r = 3.2) => Math.abs(pos.x - eye.x) < r && Math.abs(pos.z - eye.z) < r && Math.abs(pos.y - eye.y) < 2.6;
    for (const d of this.world.doorList) {
      const c = d.center;
      tmp.set(c.x, Math.min(eye.y, c.y + 0.1), c.z);
      if (!d.discovered && d.type === 'secret' && d.id === 'dining_panel' && d.sideOf(eye.x, eye.z) === 1) {
        // the dining side of the panel just looks like wainscoting
        if (near(tmp)) out.push({ kind: 'panelHint', door: d, pos: tmp.clone(), radius: 0.45 });
        continue;
      }
      if (near(tmp)) out.push({ kind: 'door', door: d, pos: tmp.clone(), radius: 0.48 });
    }
    for (const pk of this.game.items.pickups) {
      if (near(pk.pos)) out.push({ kind: 'pickup', pickup: pk, pos: pk.pos.clone().add(new THREE.Vector3(0, 0.05, 0)), radius: pk.def.kind === 'escape' ? 0.28 : 0.2 });
    }
    for (const h of this.world.hidingSpots) {
      if (h.f !== p.floor && Math.abs(h.inside.y - eye.y) > 2) continue;
      const pos = h.type === 'bed' ? tmp2.copy(h.inside).setY(h.inside.y + 0.35).clone() : h.inside.clone();
      if (near(pos)) out.push({ kind: 'hide', spot: h, pos, radius: h.type === 'bed' ? 0.7 : 0.55 });
    }
    for (const it of this.world.interactables) {
      if (it.disabled) continue;
      if (near(it.pos)) out.push({ kind: it.kind, it, pos: it.pos.clone(), radius: it.radius ?? 0.5 });
    }
    return out;
  }

  _pick() {
    const p = this.player;
    const eye = p.eyePos.clone();
    const fwd = p.forward(new THREE.Vector3());
    let best = null, bestScore = Infinity;
    for (const c of this._candidates()) {
      tmp.subVectors(c.pos, eye);
      const d = tmp.length();
      if (d > PLAYER.reach + c.radius) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, tmp.dot(fwd) / Math.max(d, 1e-4))));
      const allowed = Math.atan2(c.radius, Math.max(0.3, d)) + 0.12;
      if (ang > allowed) continue;
      // line of sight (ignore the target's own collider)
      const blocked = this.world.collision.segmentBlocked(eye, c.pos, (col) => !(c.door && col.door === c.door) && col.kind !== 'furniture');
      if (blocked) continue;
      const score = ang * 2 + d * 0.25;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  cancelHold() {
    if (this.hold) {
      this.hold = null;
      this.game.ui.setProgress(null);
    }
  }

  startHold(label, duration, onComplete, opts = {}) {
    this.hold = { label, duration, t: 0, onComplete, target: this.target, noiseEvery: opts.noiseEvery || 0, noiseR: opts.noiseR || 0, noiseAcc: 0, sound: opts.sound, key: opts.key || 'interact' };
  }

  update(dt) {
    const game = this.game;
    const p = this.player;
    const input = game.input;
    if (p.hiding || p.dead || p.frozen) {
      this.target = null;
      game.ui.setPrompt(null);
      this.cancelHold();
      return;
    }
    // continue a hold action
    if (this.hold) {
      const h = this.hold;
      if (!input.isDown(h.key)) { this.cancelHold(); }
      else {
        const still = this._pick();
        const sameTarget = still && h.target && (still.door ? still.door === h.target.door : still.it ? still.it === h.target.it : still.pickup ? still.pickup === h.target.pickup : still.kind === h.target.kind);
        if (!sameTarget && h.t > 0.15) { this.cancelHold(); game.ui.toast('Interrupted.'); }
        else {
          h.t += dt;
          if (h.noiseEvery) {
            h.noiseAcc += dt;
            if (h.noiseAcc >= h.noiseEvery) {
              h.noiseAcc = 0;
              p.emitNoise(h.noiseR, 'work', h.target ? h.target.pos : null);
              if (h.sound) game.audio.work(h.sound, h.target ? h.target.pos : p.pos);
            }
          }
          game.ui.setProgress(h.label, Math.min(1, h.t / h.duration));
          if (h.t >= h.duration) {
            const fn = h.onComplete;
            this.hold = null;
            game.ui.setProgress(null);
            fn();
          }
          game.ui.setPrompt(null);
          return;
        }
      }
    }
    const t = this._pick();
    this.target = t;
    game.ui.setPrompt(t ? this._prompt(t) : null, t ? this._title(t) : null);
    game.ui.setCrosshair(t ? 'active' : p.held ? 'held' : 'idle');
    // door tap / hold detection
    if (t && t.kind === 'door' && t.door.discovered) {
      const d = t.door;
      if (input.pressed('interact') || input.pressed('primary') && !p.held) this.doorPress = { door: d, t: 0, done: false };
      if (this.doorPress && this.doorPress.door === d) {
        const dp = this.doorPress;
        if (input.isDown('interact') || input.isDown('primary')) {
          dp.t += dt;
          if (!dp.done && dp.t > 0.28) { dp.done = true; this._doorAction(d, 'quiet'); }
        } else {
          if (!dp.done) this._doorAction(d, 'normal');
          this.doorPress = null;
        }
      }
      if (input.pressed('slam')) this._doorSlam(d);
      if (input.pressed('lock')) this._doorLock(d);
      if (input.pressed('barricade')) this._doorBarricade(d);
    } else {
      this.doorPress = null;
      const pressedUse = input.pressed('interact') || (input.pressed('primary') && !p.held);
      if (t && pressedUse) this._use(t);
    }
  }

  _title(t) {
    switch (t.kind) {
      case 'door': return t.door.discovered ? doorName(t.door) : 'Wall';
      case 'panelHint': return 'Wainscot panel';
      case 'pickup': return t.pickup.def.name;
      case 'hide': return hideName(t.spot.type);
      default: return t.it && t.it.prompt ? t.it.prompt : null;
    }
  }

  _prompt(t) {
    const p = this.player;
    const g = this.game;
    switch (t.kind) {
      case 'door': {
        const d = t.door;
        if (!d.discovered) return [{ key: 'E', label: 'Examine' }];
        if (d.escape) return g.objectives.doorPrompt(d);
        const out = [];
        if (d.broken) return [{ key: '', label: 'Broken off its hinges' }];
        if (d.barricade > 0) {
          const mySide = d.sideOf(p.pos.x, p.pos.z) === d.barricadeSide;
          return mySide ? [{ key: 'Hold E', label: 'Remove planks' }] : [{ key: '', label: 'Barricaded from the other side' }];
        }
        if (d.open > 0.05) {
          out.push({ key: 'E', label: 'Close' }, { key: 'Hold E', label: 'Close quietly' }, { key: 'R', label: 'Slam shut' });
        } else if (d.locked) {
          if (d.lock === 'bolt') out.push({ key: 'L', label: 'Unbolt' });
          else if (p.has(d.lock)) out.push({ key: 'E', label: `Unlock (${ITEM_DEFS[d.lock].name})` });
          else out.push({ key: '', label: 'Locked' });
        } else {
          out.push({ key: 'E', label: 'Open' }, { key: 'Hold E', label: 'Open quietly' });
          if (d.lock === 'bolt') out.push({ key: 'L', label: 'Bolt' });
          else if (d.lock && p.has(d.lock)) out.push({ key: 'L', label: 'Lock' });
          if (d.type === 'door') out.push({ key: 'B', label: `Barricade${p.has('plank') ? '' : ' (needs plank)'}` });
        }
        return out;
      }
      case 'panelHint': return [{ key: 'E', label: 'Knock' }];
      case 'pickup': {
        const k = t.pickup.def.kind;
        if (k === 'throwable') return [{ key: 'E', label: 'Pick up' }, { key: 'LMB/G', label: 'then throw' }];
        return [{ key: 'E', label: 'Take' }];
      }
      case 'hide': return [{ key: 'E', label: 'Hide' }];
      case 'switch': return [{ key: 'E', label: t.it.sw.fixtures.some((f) => f.on) ? 'Lights off' : 'Lights on' }];
      case 'lamp': return [{ key: 'E', label: t.it.fixture.on ? 'Switch off' : 'Switch on' }];
      case 'tv': return [{ key: 'E', label: 'Switch on/off' }];
      case 'piano': return [{ key: 'E', label: 'Press the keys (loud)' }];
      case 'note': return [{ key: 'E', label: 'Read' }];
      default: return g.objectives.prompt(t) || [{ key: 'E', label: 'Use' }];
    }
  }

  // ------------------------------------------------------------ doors
  _doorAction(d, mode) {
    const g = this.game;
    const p = this.player;
    if (d.escape) { g.objectives.useDoor(d, this); return; }
    if (d.barricade > 0) {
      if (d.sideOf(p.pos.x, p.pos.z) === d.barricadeSide) {
        this.startHold('Removing planks', 1.4, () => {
          d.barricade = 0; d._refreshBarricade(); p.give('plank');
          g.ui.toast('You pry the planks loose.');
        }, { noiseEvery: 0.5, noiseR: 6, sound: 'wood' });
      } else {
        g.audio.rattle(d.center);
        g.ui.toast('Something is holding it shut from the other side.');
      }
      return;
    }
    if (d.open > 0.05 && d.target > 0) {
      d.closeDoor('player', mode === 'quiet' ? 'quiet' : 'normal');
      if (mode !== 'quiet') p.emitNoise(NOISE.doorShut * 0.7, 'door', d.center);
      return;
    }
    if (d.locked) {
      if (d.lock !== 'bolt' && p.has(d.lock)) {
        d.locked = false;
        g.audio.unlock(d.center);
        g.ui.toast(`Unlocked with the ${ITEM_DEFS[d.lock].name}.`);
        p.emitNoise(NOISE.lock, 'lock', d.center);
        g.onDoorUnlocked(d);
        return;
      }
      g.audio.rattle(d.center);
      p.emitNoise(4, 'rattle', d.center);
      g.ui.toast(d.lock === 'bolt' ? 'Bolted. [L] to unbolt.' : 'Locked. You need a key.');
      return;
    }
    d.openDoor('player', mode === 'quiet' ? 'quiet' : 'normal');
    if (mode !== 'quiet') p.emitNoise(NOISE.doorOpen * (d.creaky ? 1.4 : 1), 'door', d.center);
  }

  _doorSlam(d) {
    if (d.escape || d.broken || d.barricade > 0) return;
    if (d.open > 0.05) {
      d.closeDoor('player', 'slam');
      this.player.emitNoise(NOISE.doorSlam, 'slam', d.center);
    }
  }

  _doorLock(d) {
    const g = this.game, p = this.player;
    if (d.escape || d.broken || d.open > 0.05) return;
    if (d.lock === 'bolt' || (d.lock && p.has(d.lock))) {
      d.toggleLock('player');
      p.emitNoise(NOISE.lock, 'lock', d.center);
      g.ui.toast(d.locked ? 'Locked.' : 'Unlocked.');
      g.learn('lock', d);
    } else if (!d.lock) g.ui.toast('This door has no lock.');
  }

  _doorBarricade(d) {
    const g = this.game, p = this.player;
    if (d.escape || d.broken || d.type !== 'door') return;
    if (d.open > 0.05) { g.ui.toast('Close it first.'); return; }
    if (!p.has('plank')) { g.ui.toast('You need a plank to barricade.'); return; }
    const side = d.sideOf(p.pos.x, p.pos.z);
    if (d.barricade > 0 && side !== d.barricadeSide) return;
    this.startHold('Barricading', 1.6, () => {
      if (d.open > 0.05 || !p.take('plank')) return;
      d.addBarricade(side);
      g.ui.toast('Barricaded. It will slow it down.');
      g.learn('barricade', d);
    }, { key: 'barricade', noiseEvery: 0.45, noiseR: NOISE.barricade, sound: 'hammer' });
  }

  // ------------------------------------------------------------ everything else
  _use(t) {
    const g = this.game, p = this.player;
    switch (t.kind) {
      case 'door': {
        const d = t.door;
        if (!d.discovered) {
          d.discovered = true;
          g.ui.toast(d.type === 'bookshelf' ? 'One red book sits slightly forward. You pull it - something clicks.' : 'Behind the peeling paper: the outline of a small door.');
          g.audio.unlock(d.center);
          if (d.type === 'bookshelf') d.openDoor('player', 'normal');
          g.onSecretFound(d);
        }
        return;
      }
      case 'panelHint': {
        g.audio.knock(t.door.center);
        g.ui.toast(t.door.discovered ? 'It swings freely now.' : 'It sounds hollow. It will not open from this side.');
        if (t.door.discovered) t.door.openDoor('player', 'normal');
        return;
      }
      case 'pickup': return this._pickup(t.pickup);
      case 'hide': {
        p.enterHiding(t.spot);
        return;
      }
      case 'switch': {
        const on = g.world.lighting.toggleSwitch(t.it.sw);
        g.audio.click(0.9, t.it.pos);
        p.emitNoise(NOISE.switch, 'switch', t.it.pos);
        if (on && !g.world.lighting.power) g.ui.toast('Nothing happens. The power is out.');
        g.learn('lights', on);
        return;
      }
      case 'lamp': {
        const fx = t.it.fixture;
        fx.on = !fx.on;
        g.audio.click(0.7, t.it.pos);
        p.emitNoise(NOISE.switch * 0.6, 'switch', t.it.pos);
        if (fx.on && !g.world.lighting.power && fx.needsPower) g.ui.toast('Dead. The power is out.');
        return;
      }
      case 'tv': {
        const tv = g.world.tvs.find((x) => x.id === t.it.id);
        if (!tv) return;
        if (!g.world.lighting.power) { g.ui.toast('No power.'); return; }
        g.world.setTV(tv, !tv.on);
        if (tv.on) { g.audio.tvStatic(tv, true); p.emitNoise(NOISE.tvOn, 'tv', tv.pos); g.learn('distraction', tv.pos); }
        else g.audio.tvStatic(tv, false);
        return;
      }
      case 'piano': {
        g.audio.piano(t.it.pos);
        p.emitNoise(NOISE.piano, 'piano', t.it.pos);
        g.learn('distraction', t.it.pos);
        return;
      }
      case 'note': {
        g.story.read(t.it.doc, t.it);
        return;
      }
      default:
        g.objectives.use(t, this);
    }
  }

  _pickup(pk) {
    const g = this.game, p = this.player;
    const def = pk.def;
    if (def.kind === 'throwable') {
      if (p.held) g.throwables.drop(p.held, p.pos);
      p.held = { kind: pk.kind, def };
      g.items.remove(pk);
      g.audio.pickup(pk.pos, 'throwable');
      g.ui.toast(`${def.name} - [LMB] or [G] to throw.`);
      g.throwables.showHeld(pk.kind);
      return;
    }
    g.items.remove(pk);
    g.audio.pickup(pk.pos, def.kind);
    p.emitNoise(NOISE.pickup, 'pickup', pk.pos);
    if (pk.kind === 'flashlight') {
      p.flash.has = true;
      p.flash.on = true;
      g.ui.toast('Flashlight. [F] to toggle. Light makes you easier to see.');
      g.onPickup(pk.kind);
      return;
    }
    p.give(pk.kind);
    g.ui.toast(`Picked up: ${def.name}${def.stack ? ` (${p.inventory.get(pk.kind)})` : ''}`, def.kind === 'escape' || def.kind === 'key' || def.kind === 'secret');
    g.onPickup(pk.kind);
  }
}

function doorName(d) {
  switch (d.type) {
    case 'bookshelf': return 'Bookshelf';
    case 'secret': return 'Hidden door';
    case 'front': return 'Front door';
    case 'garage': return 'Garage door';
    case 'grate': return 'Tunnel grate';
    case 'tiny': return 'Tiny door';
    default: return d.heavy ? 'Heavy door' : 'Door';
  }
}

function hideName(type) {
  return { wardrobe: 'Wardrobe', bed: 'Under the bed', cabinet: 'Cabinet', tub: 'Bathtub', curtain: 'Curtains', coats: 'Between the coats', chest: 'Chest', behind: 'Behind the sofa' }[type] || 'Hide';
}
