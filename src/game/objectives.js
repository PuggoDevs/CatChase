// Escape routes and the machinery around them: the fuse box, the car, the
// chained front door, the attic window, the flooded tunnel and Ellie's bed.
import * as THREE from 'three';
import { ITEM_DEFS, ESCAPE_ROUTES } from './items.js';
import { floorBaseY } from '../world/layout.js';

const NEED_LABEL = {
  key_front: 'Front door key', bolt_cutters: 'Bolt cutters', car_keys: 'Car keys', car_battery: 'Car battery', gas_can: 'Gas can',
  crowbar: 'Crowbar', rope: 'Rope', wrench: 'Pipe wrench', valve_wheel: 'Valve wheel', music_box: 'Music box', music_key: 'Winding key', ribbon: 'Red ribbon', power: 'Power on',
};

export class Objectives {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this._setupStatic();
  }

  _setupStatic() {
    const w = this.world;
    // interactable for the attic window (it is not a door)
    const win = w.windows.find((x) => x.style === 'boarded-heavy');
    if (win) {
      const [ox, oz] = win.outward;
      const pos = new THREE.Vector3(win.x - ox * 0.35, floorBaseY(3) + 1.3, win.z - oz * 0.35);
      this.atticWin = { kind: 'atticwin', id: 'atticwin', f: 3, room: win.room, pos, radius: 0.7, prompt: 'Boarded window', win };
      w.interactables.push(this.atticWin);
    }
    // tunnel water surface
    const tunnel = w.grid.roomByKey['0Z'];
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2, 11), new THREE.MeshStandardMaterial({ color: 0x0a0d0e, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(32, floorBaseY(0) + 0.9, 16.5);
    w.addDynamicObject(water, 0);
    this.water = water;
    this.tunnelRoom = tunnel;
  }

  reset(run) {
    this.run = run;
    this.known = { front: false, car: false, attic: false, tunnel: false, secret: false };
    this.s = {
      frontUnlocked: false, chainCut: false,
      carBattery: false, carFuel: false, carRunning: false,
      drained: false, grateOpen: false,
      boards: false, rope: false,
      altar: { music_box: false, music_key: false, ribbon: false }, wound: false, tinyOpen: false,
      fuseBlown: false,
    };
    this.escaping = null;
    this.water.position.y = floorBaseY(0) + 0.9;
    this.water.visible = true;
    const d = this.world.doors;
    for (const id of ['front_door', 'garage_door', 'tunnel_grate', 'tiny_door']) {
      const door = d.get(id);
      if (door) { door.jammed = true; door.open = 0; door.target = 0; door.update(0); }
    }
    if (this.world.valveWheel) this.world.valveWheel.holder.visible = false;
    this._boardsVisible(true);
  }

  _boardsVisible(on) {
    // the heavy boards inside the attic window are dynamic so they can come off
    if (!this.boardGroup) {
      const win = this.atticWin && this.atticWin.win;
      if (!win) return;
      const g = new THREE.Group();
      const mat = this.world.materials.dynamic('woodPlanks');
      const room = this.world.grid.rooms[win.room];
      mat.userData.objRoom.value = room.lightSlot;
      const [ox, oz] = win.outward;
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(oz ? 1.1 : 0.04, 0.16, oz ? 0.04 : 1.1), mat);
        b.position.set(win.x - ox * 0.2, win.sill + 0.12 + i * 0.3, win.z - oz * 0.2);
        b.rotation.set(0, 0, (i % 2 ? 0.08 : -0.06));
        b.castShadow = true;
        g.add(b);
      }
      this.world.addDynamicObject(g, 3);
      this.boardGroup = g;
    }
    this.boardGroup.visible = on;
  }

  // ---------------------------------------------------------------- knowledge
  learnRoute(key, silent = false) {
    if (!this.known[key]) {
      this.known[key] = true;
      if (!silent) this.game.ui.toast(`New way out: ${key === 'secret' ? 'Ellie\'s bed' : ESCAPE_ROUTES[key].name}`, true);
    }
  }

  routeStatus() {
    const p = this.game.player;
    const have = (id) => p.has(id) || (id === 'car_battery' && this.s.carBattery) || (id === 'gas_can' && this.s.carFuel) || (id === 'valve_wheel' && this.s.drained) || (this.s.altar[id]);
    const out = [];
    if (this.run.mode === 'endless') return [{ known: true, name: 'None. Survive until dawn.', needs: [] }];
    for (const [key, r] of Object.entries(ESCAPE_ROUTES)) {
      const needs = r.needs.map((n) => ({ label: NEED_LABEL[n], have: have(n) }));
      if (key === 'car') needs.push({ label: NEED_LABEL.power, have: this.world.lighting.power });
      out.push({ key, known: this.known[key], name: key === 'secret' ? "Ellie's Bed (the truth)" : r.name, needs });
    }
    return out;
  }

  predictedGoalRoom() {
    const p = this.game.player;
    const g = this.world.grid;
    const score = {
      '1F': +p.has('key_front') + +p.has('bolt_cutters'),
      '1G': +p.has('car_keys') + +p.has('car_battery') + +p.has('gas_can') + (this.s.carBattery ? 1 : 0) + (this.s.carFuel ? 1 : 0),
      '3A': +p.has('crowbar') + +p.has('rope'),
      '0C': +p.has('wrench') + +p.has('valve_wheel'),
      '3R': +p.has('music_box') + +p.has('music_key') + +p.has('ribbon'),
    };
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 1 ? g.roomByKey[best[0]] : null;
  }

  // ---------------------------------------------------------------- prompts
  prompt(t) {
    const p = this.game.player;
    const s = this.s;
    const L = this.world.lighting;
    switch (t.kind) {
      case 'fusebox':
        if (L.power) return [{ key: '', label: 'Humming. The power is on.' }];
        if (s.fuseBlown) return p.has('fuse') ? [{ key: 'Hold E', label: 'Replace the blown fuse' }] : [{ key: '', label: 'A fuse is blown. You need a spare fuse.' }];
        return [{ key: 'Hold E', label: 'Throw the breaker' }];
      case 'car_hood':
        if (s.carBattery) return [{ key: '', label: 'Battery connected.' }];
        return p.has('car_battery') ? [{ key: 'Hold E', label: 'Install the car battery' }] : [{ key: '', label: 'The battery is missing.' }];
      case 'car_fuel':
        if (s.carFuel) return [{ key: '', label: 'Tank has gas.' }];
        return p.has('gas_can') ? [{ key: 'Hold E', label: 'Pour in the gas' }] : [{ key: '', label: 'Empty tank. It needs gas.' }];
      case 'car_door': {
        if (!p.has('car_keys')) return [{ key: '', label: 'Locked. Where are the keys?' }];
        if (!s.carBattery || !s.carFuel) return [{ key: '', label: `Needs ${!s.carBattery ? 'a battery' : ''}${!s.carBattery && !s.carFuel ? ' and ' : ''}${!s.carFuel ? 'gas' : ''}.` }];
        if (!L.power) return [{ key: '', label: 'The garage door needs power first.' }];
        return [{ key: 'E', label: 'Get in and start the engine' }];
      }
      case 'valve':
        if (s.drained) return [{ key: '', label: 'Drained.' }];
        return p.has('valve_wheel') ? [{ key: 'Hold E', label: 'Fit the wheel and open the drain' }] : [{ key: '', label: 'The valve wheel is missing.' }];
      case 'atticwin':
        if (!s.boards) return p.has('crowbar') ? [{ key: 'Hold E', label: 'Pry off the boards (loud)' }] : [{ key: '', label: 'Boarded shut. Something to pry with...' }];
        return p.has('rope') ? [{ key: 'Hold E', label: 'Tie the rope and climb out' }] : [{ key: '', label: 'A long drop. You need a rope.' }];
      case 'altar': {
        if (s.wound) return [{ key: '', label: 'The song is playing.' }];
        const missing = ['music_box', 'music_key', 'ribbon'].filter((k) => !s.altar[k]);
        const canPlace = missing.filter((k) => p.has(k));
        if (canPlace.length) return [{ key: 'E', label: `Place the ${ITEM_DEFS[canPlace[0]].name}` }];
        if (!missing.length) return [{ key: 'Hold E', label: 'Wind the music box' }];
        return [{ key: '', label: "Ellie's bedside. Something belongs here." }];
      }
      default: return null;
    }
  }

  doorPrompt(d) {
    const p = this.game.player;
    const s = this.s;
    switch (d.type) {
      case 'front':
        if (!s.frontUnlocked) return p.has('key_front') ? [{ key: 'Hold E', label: 'Unlock the front door' }] : [{ key: '', label: 'Locked. A big brass keyhole.' }];
        if (!s.chainCut) return p.has('bolt_cutters') ? [{ key: 'Hold E', label: 'Cut the chain (loud)' }] : [{ key: '', label: 'Chained shut from inside. Bolt cutters?' }];
        return [{ key: 'E', label: 'Open the door and run' }];
      case 'garage': return [{ key: '', label: 'Electric roll-up door. It opens from the car.' }];
      case 'grate':
        if (s.grateOpen) return [{ key: '', label: 'Open. The tunnel leads out.' }];
        if (!s.drained) return [{ key: '', label: 'The tunnel beyond is flooded to the ceiling.' }];
        return p.has('wrench') ? [{ key: 'Hold E', label: 'Unbolt the grate' }] : [{ key: '', label: 'Rusted bolts. A big wrench would do it.' }];
      case 'tiny':
        if (s.tinyOpen) return [{ key: '', label: 'Crawl through [Z]' }];
        return [{ key: '', label: 'A tiny painted door. It will not open.' }];
      default: return [{ key: '', label: 'Locked' }];
    }
  }

  // ---------------------------------------------------------------- actions
  use(t, inter) {
    const g = this.game;
    const p = g.player;
    const s = this.s;
    const L = this.world.lighting;
    switch (t.kind) {
      case 'fusebox':
        if (L.power) return;
        if (s.fuseBlown && !p.has('fuse')) { g.ui.toast('You need a spare fuse.'); return; }
        inter.startHold(s.fuseBlown ? 'Replacing the fuse' : 'Resetting the breaker', 1.6, () => {
          if (s.fuseBlown) { p.take('fuse'); s.fuseBlown = false; }
          g.restorePower();
        }, { noiseEvery: 0.8, noiseR: 5, sound: 'metal' });
        return;
      case 'car_hood':
        if (s.carBattery || !p.has('car_battery')) return;
        this.learnRoute('car', true);
        inter.startHold('Connecting the battery', 3, () => { p.take('car_battery'); s.carBattery = true; g.ui.toast('Battery connected.', true); }, { noiseEvery: 0.9, noiseR: 8, sound: 'metal' });
        return;
      case 'car_fuel':
        if (s.carFuel || !p.has('gas_can')) return;
        this.learnRoute('car', true);
        inter.startHold('Pouring gas', 3.5, () => { p.take('gas_can'); s.carFuel = true; g.ui.toast('The tank sloshes. Enough to get away.', true); }, { noiseEvery: 1.1, noiseR: 5, sound: 'thud' });
        return;
      case 'car_door':
        this.learnRoute('car', true);
        if (!p.has('car_keys') || !s.carBattery || !s.carFuel || !L.power) { g.audio.rattle(t.pos); return; }
        g.startEscape('car');
        return;
      case 'valve':
        if (s.drained || !p.has('valve_wheel')) return;
        this.learnRoute('tunnel', true);
        if (this.world.valveWheel) this.world.valveWheel.holder.visible = true;
        inter.startHold('Turning the valve', 4, () => {
          p.take('valve_wheel');
          s.drained = true;
          g.ui.toast('Water drains away with a long gurgle...', true);
          g.audio.play('water', { pos: new THREE.Vector3(32, -2.5, 12), volume: 1, reverb: 0.7 });
          g.noise(new THREE.Vector3(32, -2.5, 11), 16, 'water', 'world');
        }, { noiseEvery: 1, noiseR: 12, sound: 'metal' });
        return;
      case 'atticwin':
        if (!s.boards) {
          if (!p.has('crowbar')) return;
          this.learnRoute('attic', true);
          inter.startHold('Prying boards', 4, () => {
            s.boards = true;
            this._boardsVisible(false);
            g.ui.toast('The last board splinters away. Cold air pours in.', true);
          }, { noiseEvery: 0.7, noiseR: 16, sound: 'wood' });
          return;
        }
        if (!p.has('rope')) return;
        inter.startHold('Tying the rope', 2.2, () => g.startEscape('attic'), { noiseEvery: 1, noiseR: 4, sound: 'thud' });
        return;
      case 'altar': {
        if (s.wound) return;
        const missing = ['music_box', 'music_key', 'ribbon'].filter((k) => !s.altar[k]);
        const canPlace = missing.find((k) => p.has(k));
        if (canPlace) {
          p.take(canPlace);
          s.altar[canPlace] = true;
          this.learnRoute('secret', true);
          g.audio.click(0.6, t.pos);
          this._spawnAltarItem(canPlace);
          g.ui.toast(missing.length === 1 ? 'Everything is in its place. Wind the music box.' : `You place the ${ITEM_DEFS[canPlace].name}.`, true);
          return;
        }
        if (missing.length) return;
        g.startSecretEnding(inter);
        return;
      }
      default:
        break;
    }
  }

  useDoor(d, inter) {
    const g = this.game;
    const p = g.player;
    const s = this.s;
    switch (d.type) {
      case 'front':
        this.learnRoute('front', true);
        if (!s.frontUnlocked) {
          if (!p.has('key_front')) { g.audio.rattle(d.center); return; }
          inter.startHold('Unlocking', 1.2, () => { s.frontUnlocked = true; g.audio.unlock(d.center); g.ui.toast('The lock turns. The chain holds.', true); });
          return;
        }
        if (!s.chainCut) {
          if (!p.has('bolt_cutters')) { g.audio.rattle(d.center, true); p.emitNoise(9, 'rattle', d.center); return; }
          inter.startHold('Cutting the chain', 3.2, () => { s.chainCut = true; g.audio.work('cut', d.center); g.ui.toast('The chain snaps!', true); }, { noiseEvery: 0.8, noiseR: 18, sound: 'cut' });
          return;
        }
        g.startEscape('front');
        return;
      case 'grate':
        this.learnRoute('tunnel', true);
        if (s.grateOpen || !s.drained || !p.has('wrench')) { g.audio.rattle(d.center); return; }
        inter.startHold('Unbolting the grate', 3.6, () => {
          s.grateOpen = true;
          d.jammed = false;
          d.locked = false;
          d.openDoor('player', 'normal');
          g.ui.toast('The grate swings open. The tunnel is black and stinks of rot.', true);
        }, { noiseEvery: 0.9, noiseR: 12, sound: 'metal' });
        return;
      case 'tiny':
        if (!s.tinyOpen) { g.audio.knock(d.center); g.ui.toast('Knock knock. Nobody answers. Something breathes on the other side?'); }
        return;
      case 'garage':
        g.ui.toast('It will only open from the car.');
        return;
      default:
        break;
    }
  }

  _spawnAltarItem(kind) {
    const pos = this.world.altarPos.clone();
    const offs = { music_box: [0, 0], music_key: [0.1, 0.08], ribbon: [-0.1, 0.06] }[kind];
    pos.x += offs[0];
    pos.z += offs[1];
    const room = this.world.grid.roomByKey['3R'];
    const p = this.game.items.spawn(kind, pos, room.index, { yaw: 0.3 });
    p.altar = true;
    this.game.items.pickups.splice(this.game.items.pickups.indexOf(p), 1); // not pick-up-able
    p.glint.visible = false;
    (this.altarModels = this.altarModels || []).push(p);
  }

  clearAltar() {
    for (const p of this.altarModels || []) { p.model.removeFromParent(); p.glint.removeFromParent(); }
    this.altarModels = [];
  }

  update(dt) {
    // lower the tunnel water after draining
    if (this.s && this.s.drained && this.water.visible) {
      this.water.position.y -= dt * 0.18;
      if (this.water.position.y < floorBaseY(0) + 0.03) this.water.visible = false;
    }
    // walking out through the tunnel or the tiny door ends the night
    const p = this.game.player;
    if (this.s && this.s.grateOpen && p.floor === 0 && p.pos.z > 19.5 && p.pos.x > 31 && !this.escaping) this.game.startEscape('tunnel');
    if (this.s && this.s.tinyOpen && p.floor === 3 && p.pos.x < 9.35 && p.pos.z > 9 && p.pos.z < 10 && !this.escaping) this.game.startEscape('secret');
  }
}
