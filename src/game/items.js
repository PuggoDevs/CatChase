// Items: definitions, procedural pickup models, seeded placement and the
// flashlight "glint" that makes things findable in the dark.
import * as THREE from 'three';
import { buildAccessGraph, placeItems, KEY_ITEMS, ESCAPE_ITEMS, SECRET_ITEMS } from './placement.js';
import { setObjectRoom } from '../world/roomLighting.js';

export const ITEM_DEFS = {
  flashlight: { name: 'Flashlight', kind: 'tool', desc: 'Old, heavy, and the batteries never last. [F] to toggle.' },
  battery: { name: 'Battery', kind: 'consumable', stack: true, desc: 'Restores flashlight charge. Used automatically when the light dies.' },
  plank: { name: 'Plank', kind: 'consumable', stack: true, desc: 'Barricade a closed door [B]. It will not hold forever.' },
  fuse: { name: 'Fuse', kind: 'consumable', stack: true, desc: 'A spare ceramic fuse for the fuse box in the laundry room.' },
  key_cellar: { name: 'Cellar Key', kind: 'key', desc: 'Heavy and cold. The tag reads CELLAR in careful capitals.' },
  key_study: { name: 'Study Key', kind: 'key', desc: 'A small brass key tied with string. "A.W. - STUDY".' },
  key_master: { name: 'Master Bedroom Key', kind: 'key', desc: 'The ribbon on this key is faded pink.' },
  key_attic: { name: 'Attic Key', kind: 'key', desc: 'Dusty. Someone scratched a little cat on the bow.' },
  key_front: { name: 'Front Door Key', kind: 'escape', desc: 'The big brass key to the front door. The door is also chained.' },
  bolt_cutters: { name: 'Bolt Cutters', kind: 'escape', desc: 'Strong enough for a chain. Loud enough to wake anything.' },
  car_keys: { name: 'Car Keys', kind: 'escape', desc: 'Keys to the car in the garage. A plastic fob shaped like a fish.' },
  car_battery: { name: 'Car Battery', kind: 'escape', desc: 'Heavy. It should still hold a charge.' },
  gas_can: { name: 'Gas Can', kind: 'escape', desc: 'Half full. It sloshes when you move.' },
  crowbar: { name: 'Crowbar', kind: 'escape', desc: 'Could pry boards off a window.' },
  rope: { name: 'Rope', kind: 'escape', desc: 'Long enough to climb down from somewhere high.' },
  wrench: { name: 'Pipe Wrench', kind: 'escape', desc: 'For stubborn bolts. There is a grate in the coal cellar...' },
  valve_wheel: { name: 'Valve Wheel', kind: 'escape', desc: 'A red iron wheel. It fits a drain valve.' },
  music_box: { name: "Ellie's Music Box", kind: 'secret', desc: 'A little box with a dancer inside. It is missing its winding key.' },
  music_key: { name: 'Winding Key', kind: 'secret', desc: 'A tiny butterfly-shaped key.' },
  ribbon: { name: 'Red Ribbon', kind: 'secret', desc: "A child's hair ribbon. It smells faintly of lavender." },
  // throwables (held one at a time)
  bottle: { name: 'Glass Bottle', kind: 'throwable', noise: 17, breaks: true, desc: 'Shatters loudly.' },
  can: { name: 'Tin Can', kind: 'throwable', noise: 12, desc: 'Clatters.' },
  toy: { name: 'Wind-up Toy', kind: 'throwable', noise: 11, desc: 'Rattles and squeaks.' },
  plate: { name: 'Plate', kind: 'throwable', noise: 15, breaks: true, desc: 'Porcelain. It will not survive.' },
  book: { name: 'Book', kind: 'throwable', noise: 8, desc: 'A heavy thud.' },
};

export const ESCAPE_ROUTES = {
  front: { name: 'The Front Door', needs: ['key_front', 'bolt_cutters'] },
  car: { name: 'The Car', needs: ['car_keys', 'car_battery', 'gas_can'] },
  attic: { name: 'The Attic Window', needs: ['crowbar', 'rope'] },
  tunnel: { name: 'The Flooded Tunnel', needs: ['wrench', 'valve_wheel'] },
  secret: { name: '???', needs: ['music_box', 'music_key', 'ribbon'] },
};

// ------------------------------------------------------------------ models
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

export function buildItemModel(kind, M) {
  // M(params) -> material factory
  const g = new THREE.Group();
  const brass = M({ color: 0x9a7a38, roughness: 0.35, metalness: 0.9 });
  const iron = M({ color: 0x2c2c30, roughness: 0.5, metalness: 0.8 });
  const red = M({ color: 0x8a1410, roughness: 0.5 });
  const black = M({ color: 0x0c0c0c, roughness: 0.7 });
  const wood = M({ color: 0x6a4a2a, roughness: 0.8 });
  const paper = M({ color: 0xc8bea2, roughness: 0.9 });
  switch (kind) {
    case 'key_cellar': case 'key_study': case 'key_master': case 'key_attic': case 'key_front': {
      const s = kind === 'key_front' ? 1.5 : 1;
      g.add(mesh(new THREE.TorusGeometry(0.018 * s, 0.006 * s, 6, 14), brass, -0.035 * s, 0.006, 0, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.06 * s, 0.008 * s, 0.008 * s), brass, 0.012 * s, 0.006, 0));
      g.add(mesh(new THREE.BoxGeometry(0.012 * s, 0.006 * s, 0.018 * s), brass, 0.035 * s, 0.006, 0.01 * s));
      const tagCol = { key_cellar: 0x7a6a50, key_study: 0x5a7aa0, key_master: 0xc080a0, key_attic: 0x708060, key_front: 0xd0c090 }[kind];
      g.add(mesh(new THREE.BoxGeometry(0.035, 0.003, 0.05), M({ color: tagCol, roughness: 0.9 }), -0.07 * s, 0.003, 0.02, 0, 0.4));
      break;
    }
    case 'car_keys':
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.008, 0.012), iron, 0.02, 0.006, 0));
      g.add(mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 12), iron, -0.012, 0.004, 0, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.045, 0.012, 0.025), M({ color: 0xd07020, roughness: 0.5 }), -0.05, 0.007, 0));
      break;
    case 'bolt_cutters':
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.42, 0.018, 0.018), iron, 0, 0.012, s * 0.022, 0, s * 0.05));
        g.add(mesh(new THREE.BoxGeometry(0.16, 0.026, 0.026), red, -0.14, 0.014, s * 0.03, 0, s * 0.05));
      }
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.02, 0.035), iron, 0.24, 0.012, 0));
      break;
    case 'crowbar':
      g.add(mesh(new THREE.BoxGeometry(0.6, 0.02, 0.02), M({ color: 0x3a0c0c, roughness: 0.45, metalness: 0.6 }), 0, 0.012, 0));
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), iron, 0.32, 0.03, 0, 0, 0, 0.9));
      break;
    case 'wrench':
      g.add(mesh(new THREE.BoxGeometry(0.34, 0.022, 0.03), iron, 0, 0.012, 0));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.08), iron, 0.18, 0.016, 0.02));
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.026, 0.034), red, -0.12, 0.014, 0));
      break;
    case 'rope':
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(0.13 - i * 0.012, 0.018, 6, 20), M({ color: 0x7a6440, roughness: 1 }), 0, 0.02 + i * 0.03, 0, Math.PI / 2));
      break;
    case 'valve_wheel':
      g.add(mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 18), red, 0, 0.02, 0, Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.014, 0.02), red, 0, 0.02, 0));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.014, 0.3), red, 0, 0.02, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), iron, 0, 0.02, 0));
      break;
    case 'car_battery':
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.18), black, 0, 0.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), red, 0.1, 0.215, 0.05));
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), iron, -0.1, 0.215, 0.05));
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), iron, 0, 0.22, -0.04));
      break;
    case 'gas_can':
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.34, 0.14), M({ color: 0x8a1810, roughness: 0.45, metalness: 0.3 }), 0, 0.17, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 8), iron, 0.1, 0.38, 0, 0, 0, -0.5));
      g.add(mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), M({ color: 0x8a1810, roughness: 0.45 }), -0.03, 0.36, 0));
      break;
    case 'fuse':
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.07, 10), M({ color: 0xd8d0c0, roughness: 0.3 }), 0, 0.015, 0, 0, 0, Math.PI / 2));
      for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10), brass, s * 0.035, 0.015, 0, 0, 0, Math.PI / 2));
      break;
    case 'battery':
      g.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 12), M({ color: 0x202a3a, roughness: 0.4, metalness: 0.3 }), 0, 0.017, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.02, 12), M({ color: 0xb06a20, roughness: 0.3, metalness: 0.7 }), 0.02, 0.017, 0, 0, 0, Math.PI / 2));
      break;
    case 'plank':
      g.add(mesh(new THREE.BoxGeometry(1.1, 0.03, 0.14), wood, 0, 0.015, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 4), iron, 0.4, 0.04, 0.03));
      break;
    case 'music_box': {
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.08, 0.11), M({ color: 0x4a1a24, roughness: 0.4 }), 0, 0.04, 0));
      const lid = mesh(new THREE.BoxGeometry(0.165, 0.02, 0.115), M({ color: 0x5a2230, roughness: 0.4 }), 0, 0.09, 0);
      g.add(lid);
      g.add(mesh(new THREE.BoxGeometry(0.17, 0.012, 0.012), brass, 0, 0.08, 0.056));
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.005), brass, 0, 0.05, 0.058));
      break;
    }
    case 'music_key':
      g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), brass, 0, 0.005, 0, 0, 0, Math.PI / 2));
      for (const s of [-1, 1]) g.add(mesh(new THREE.CircleGeometry(0.018, 10), brass, -0.03, 0.006, s * 0.014, -Math.PI / 2));
      break;
    case 'ribbon':
      for (const s of [-1, 1]) g.add(mesh(new THREE.ConeGeometry(0.03, 0.06, 6), red, s * 0.03, 0.01, 0, 0, 0, s * Math.PI / 2));
      g.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), red, 0, 0.012, 0));
      g.add(mesh(new THREE.BoxGeometry(0.012, 0.004, 0.09), red, 0.012, 0.003, 0.05, 0, 0.3));
      break;
    case 'flashlight':
      g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 12), black, 0, 0.024, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.034, 0.024, 0.06, 12), iron, 0.12, 0.034, 0, 0, 0, Math.PI / 2));
      g.add(mesh(new THREE.CircleGeometry(0.03, 12), M({ color: 0xe8e0c0, roughness: 0.1, emissive: 0x302810 }), 0.151, 0.034, 0, 0, Math.PI / 2));
      break;
    case 'bottle':
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), M({ color: 0x1e3a24, roughness: 0.1, metalness: 0.1 }), 0, 0.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.08, 10), M({ color: 0x1e3a24, roughness: 0.1 }), 0, 0.24, 0));
      break;
    case 'can':
      g.add(mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.11, 12), M({ color: 0x9a9a98, roughness: 0.35, metalness: 0.8 }), 0, 0.055, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 0.07, 12), M({ color: 0x7a2a1a, roughness: 0.6 }), 0, 0.055, 0));
      break;
    case 'toy':
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), M({ color: 0x8a6a18, roughness: 0.5 }), 0, 0.04, 0));
      g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), M({ color: 0x8a1c18, roughness: 0.4 }), 0, 0.11, 0));
      g.add(mesh(new THREE.BoxGeometry(0.01, 0.04, 0.03), iron, 0.045, 0.05, 0));
      break;
    case 'plate':
      g.add(mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.02, 20), M({ color: 0xd8d4c8, roughness: 0.2 }), 0, 0.01, 0));
      break;
    case 'book':
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.04, 0.22), M({ color: [0x5a1a14, 0x1d3a24, 0x1c2846][Math.floor(Math.random() * 3)], roughness: 0.7 }), 0, 0.02, 0));
      g.add(mesh(new THREE.BoxGeometry(0.15, 0.034, 0.212), paper, 0.008, 0.02, 0));
      break;
    default:
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), red, 0, 0.05, 0));
  }
  return g;
}

// glint sprite texture (shared)
let glintTex = null;
function getGlintTexture() {
  if (glintTex) return glintTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,230,1)');
  g.addColorStop(0.15, 'rgba(255,240,200,0.6)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,250,235,0.9)';
  ctx.fillRect(31, 4, 2, 56);
  ctx.fillRect(4, 31, 56, 2);
  glintTex = new THREE.CanvasTexture(c);
  return glintTex;
}

let pickupCounter = 0;

export class ItemSystem {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.pickups = [];
    this.graph = buildAccessGraph(this.world.grid);
  }

  _materialFactory(roomSlot) {
    const mats = [];
    const lib = this.world.materials;
    const M = (params) => {
      const m = lib.custom(params, 'item');
      setObjectRoom(m, roomSlot);
      mats.push(m);
      return m;
    };
    return { M, mats };
  }

  spawn(kind, pos, roomIndex, opts = {}) {
    const grid = this.world.grid;
    const room = grid.rooms[roomIndex] || grid.roomAtWorld(opts.f ?? 1, pos.x, pos.z);
    const slot = room ? room.lightSlot : 0;
    const { M, mats } = this._materialFactory(slot);
    const model = buildItemModel(kind, M);
    model.position.copy(pos);
    model.rotation.y = opts.yaw ?? (Math.random() * Math.PI * 2);
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlintTexture(), color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glint.scale.setScalar(0.22);
    glint.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
    const f = room ? room.floor : opts.f ?? 1;
    this.world.addDynamicObject(model, f);
    this.world.addDynamicObject(glint, f);
    const p = { id: 'p' + pickupCounter++, kind, def: ITEM_DEFS[kind], pos: pos.clone(), f, room: room ? room.index : -1, model, glint, mats, phase: Math.random() * 6 };
    this.pickups.push(p);
    return p;
  }

  remove(p) {
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
    p.model.removeFromParent();
    p.glint.removeFromParent();
    p.glint.material.dispose();
    for (const m of p.mats) m.dispose();
  }

  clear() {
    for (const p of [...this.pickups]) this.remove(p);
  }

  /**
   * Place every item for a new run. Returns a map item -> pickup for the
   * items that matter to objectives.
   */
  populate(run) {
    this.clear();
    const world = this.world;
    const grid = world.grid;
    const rng = run.rng.fork('items');
    const startRoom = grid.roomAtWorld(run.start.f, run.start.x, run.start.z).index;
    // key / escape / secret items
    const items = run.mode === 'endless' ? [] : [...KEY_ITEMS, ...ESCAPE_ITEMS, ...SECRET_ITEMS];
    const slots = world.itemSlots.filter((s) => s.surface !== 'top');
    const tunnel = grid.roomByKey['0Z'].index;
    let chosen = new Map();
    if (items.length) {
      chosen = placeItems({ grid, graph: this.graph, slots, rng, startRoom, items, forbidRooms: [tunnel] });
    }
    const used = new Set(chosen.values());
    run.itemLocations = {};
    for (const [item, slot] of chosen) {
      const pos = new THREE.Vector3(slot.x, slot.y + 0.005, slot.z);
      this.spawn(item, pos, slot.room, { yaw: rng.float(0, 6.28) });
      run.itemLocations[item] = grid.rooms[slot.room].name;
    }
    // the flashlight waits on the nightstand beside you
    const startSlots = slots.filter((s) => s.room === startRoom && !used.has(s)).sort((a, b) => Math.hypot(a.x - run.start.x, a.z - run.start.z) - Math.hypot(b.x - run.start.x, b.z - run.start.z));
    if (startSlots.length) {
      const s = startSlots[0];
      used.add(s);
      this.spawn('flashlight', new THREE.Vector3(s.x, s.y + 0.005, s.z), s.room, { yaw: 0.4 });
    }
    // consumables spread around the house
    const free = () => slots.filter((s) => !used.has(s));
    const scatter = (kind, n, prefer = null) => {
      for (let i = 0; i < n; i++) {
        let cands = free();
        if (prefer && rng.chance(0.6)) {
          const pc = cands.filter((s) => prefer.includes(grid.rooms[s.room].kind));
          if (pc.length) cands = pc;
        }
        const s = rng.pick(cands);
        if (!s) return;
        used.add(s);
        this.spawn(kind, new THREE.Vector3(s.x, s.y + 0.005, s.z), s.room, { yaw: rng.float(0, 6.28) });
      }
    };
    const d = run.diff;
    const endless = run.mode === 'endless';
    scatter('battery', endless ? 6 : Math.round(9 / Math.max(0.7, d.batteryDrain)));
    scatter('plank', endless ? 6 : 6, ['garage', 'cellar', 'workshop', 'attic', 'utility', 'storage']);
    scatter('fuse', 3, ['utility', 'cellar', 'garage', 'workshop']);
    // throwables, flavoured by room
    const throwFor = (kind) => ({ kitchen: ['plate', 'bottle', 'can'], dining: ['plate', 'bottle'], cellar: ['bottle', 'can'], storage: ['can', 'bottle'], study: ['book'], bedroom: ['toy', 'book'], playroom: ['toy'], living: ['book', 'bottle'], garage: ['can'], utility: ['can', 'bottle'], workshop: ['toy', 'can'], attic: ['toy', 'book'] }[kind] || ['book', 'can', 'bottle']);
    for (let i = 0; i < 26; i++) {
      const s = rng.pick(free());
      if (!s) break;
      used.add(s);
      this.spawn(rng.pick(throwFor(grid.rooms[s.room].kind)), new THREE.Vector3(s.x, s.y + 0.005, s.z), s.room, { yaw: rng.float(0, 6.28) });
    }
    return chosen;
  }

  /** Endless mode: a few fresh supplies appear at dawn. */
  populateSupplies(run, n = 5) {
    const rng = run.rng.fork('supplies' + run.nightsSurvived);
    const taken = new Set(this.pickups.map((p) => p.pos.x.toFixed(2) + p.pos.z.toFixed(2)));
    const slots = this.world.itemSlots.filter((s) => s.surface !== 'top' && !taken.has(s.x.toFixed(2) + s.z.toFixed(2)));
    for (let i = 0; i < n; i++) {
      const s = rng.pick(slots);
      if (!s) break;
      slots.splice(slots.indexOf(s), 1);
      const kind = rng.weighted(['battery', 'plank', 'fuse', 'bottle'], (k) => ({ battery: 3, plank: 2, fuse: 1, bottle: 1 }[k]));
      this.spawn(kind, new THREE.Vector3(s.x, s.y + 0.005, s.z), s.room);
    }
  }

  update(dt, t, flash) {
    // glints: visible when the flashlight beam sweeps over an item
    for (const p of this.pickups) {
      let k = 0;
      if (flash && flash.on) {
        const to = p.pos.clone().sub(flash.pos);
        const d = to.length();
        if (d < 14 && d > 0.2) {
          const cos = to.dot(flash.dir) / d;
          if (cos > 0.93) k = (cos - 0.93) / 0.07 * Math.min(1, 10 / (d * d + 1) + 0.25);
        }
      }
      const tw = 0.6 + 0.4 * Math.sin(t * 5 + p.phase);
      p.glint.material.opacity = Math.min(1, k * tw * (p.def.kind === 'throwable' ? 0.35 : 1));
      if (p.def.kind === 'secret') p.glint.material.color.setHex(0xffc0c8);
    }
  }
}
