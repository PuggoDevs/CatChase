// House light fixtures: visuals + behaviour (switches, flicker, stutter
// events, power outages) + light spilling through open doorways.
import * as THREE from 'three';
import { RoomLightTable, SLOTS } from './roomLighting.js';
import { floorBaseY, FLOOR_CEIL } from './layout.js';
import { noise1 } from '../core/rng.js';
import { HOLE } from './grid.js';

const RANGE = { ceiling: 8, chandelier: 9, bulb: 6.5, tube: 7.5, lamp: 4.5, sconce: 3.5, nightlight: 2.4, candle: 3.2, fire: 5, tv: 4.2 };
const CEILING_TYPES = new Set(['ceiling', 'chandelier', 'bulb', 'tube']);
const NO_POWER_NEEDED = new Set(['candle', 'fire']);

class Fixture {
  constructor(room, index, def, sys) {
    this.room = room;
    this.index = index;
    this.def = def;
    this.type = def.type;
    this.color = new THREE.Color(def.color);
    this.baseIntensity = def.i;
    this.range = def.range || RANGE[def.type] || 6;
    this.on = !!def.on;
    this.flicker = def.flicker || 0;
    this.needsPower = !NO_POWER_NEEDED.has(def.type);
    this.seed = sys.seedCounter++;
    this.stutter = 0;
    this.eventDim = 1;      // scripted dimming (0..1)
    this.level = 0;         // current output 0..1+
    const base = floorBaseY(room.floor);
    const ceil = base + FLOOR_CEIL[room.floor];
    let y;
    switch (def.type) {
      case 'ceiling': y = ceil - 0.28; break;
      case 'chandelier': y = ceil - 0.8; break;
      case 'bulb': y = ceil - 0.6; break;
      case 'tube': y = ceil - 0.12; break;
      default: y = base + (def.y ?? 1.2);
    }
    this.pos = new THREE.Vector3(def.x, y, def.z);
    this.ceil = ceil;
    this.base = base;
    this.bulbs = [];
  }
}

export class LightingSystem {
  constructor(world) {
    this.world = world;
    this.grid = world.grid;
    this.table = new RoomLightTable(this.grid.lightSlotCount);
    this.fixtures = [];
    this.byRoom = new Map();
    this.power = true;
    this.powerFade = 1;
    this.seedCounter = 1;
    this.switches = [];
    this.outsideLevel = 1;
    this.lightning = 0;
    this.openings = new Map(); // roomIndex -> openings
    this._c = new THREE.Color();
  }

  build() {
    const g = this.grid;
    for (const room of g.rooms) {
      const defs = room.meta.lights || [];
      const list = [];
      defs.forEach((def, i) => {
        const fx = new Fixture(room, i, def, this);
        this._buildVisual(fx);
        this.fixtures.push(fx);
        list.push(fx);
      });
      this.byRoom.set(room.index, list);
    }
    this._buildOpenings();
    this._buildSwitches();
  }

  // ---------------------------------------------------------------- visuals
  _bulbMat(fx, strength = 1) {
    const m = new THREE.MeshBasicMaterial({ color: fx.color.clone() });
    m.userData.base = fx.color.clone().multiplyScalar(strength);
    return m;
  }

  _shadeMat(fx, color = 0xc8b48a) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: fx.color.clone(), emissiveIntensity: 0, side: THREE.DoubleSide });
    m.userData.shade = true;
    return m;
  }

  _add(fx, mesh) {
    mesh.userData.floor = fx.room.floor;
    this.world.addDynamicObject(mesh, fx.room.floor);
    return mesh;
  }

  _buildVisual(fx) {
    const geo = this.world.staticGeo;
    geo.floor = fx.room.floor;
    const slot = fx.room.lightSlot;
    const { x, z } = fx.pos;
    const ceil = fx.ceil;
    const box = (mat, cx, cy, cz, sx, sy, sz) => geo.box(mat, cx, cy, cz, sx, sy, sz, { room: slot, ao: 1 });
    const cylM = (mat, r0, r1, h, cx, cy, cz, seg = 10) => {
      geo.geometry(mat, new THREE.CylinderGeometry(r0, r1, h, seg), new THREE.Matrix4().makeTranslation(cx, cy, cz), { room: slot });
    };
    switch (fx.type) {
      case 'ceiling': {
        cylM('trimWhite', 0.2, 0.22, 0.04, x, ceil - 0.02, z, 16);
        const mat = this._bulbMat(fx, 3.2);
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat);
        m.position.set(x, ceil - 0.04, z);
        m.scale.y = 0.9;
        fx.bulbs.push(this._add(fx, m));
        break;
      }
      case 'chandelier': {
        cylM('brass', 0.012, 0.012, 0.62, x, ceil - 0.31, z, 6);
        cylM('brass', 0.06, 0.03, 0.14, x, ceil - 0.68, z, 10);
        geo.geometry('brass', new THREE.TorusGeometry(0.38, 0.012, 6, 24), new THREE.Matrix4().makeTranslation(x, fx.pos.y + 0.02, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), { room: slot });
        const bulbGeos = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const bx = x + Math.cos(a) * 0.38, bz = z + Math.sin(a) * 0.38;
          cylM('wax', 0.018, 0.018, 0.1, bx, fx.pos.y + 0.08, bz, 6);
          const sg = new THREE.SphereGeometry(0.03, 8, 6);
          sg.scale(1, 1.6, 1);
          sg.translate(bx, fx.pos.y + 0.17, bz);
          bulbGeos.push(sg);
        }
        const merged = mergeGeos(bulbGeos);
        const m = new THREE.Mesh(merged, this._bulbMat(fx, 5));
        fx.bulbs.push(this._add(fx, m));
        break;
      }
      case 'bulb': {
        cylM('black', 0.006, 0.006, ceil - fx.pos.y - 0.05, x, (ceil + fx.pos.y) / 2 + 0.02, z, 4);
        cylM('iron', 0.025, 0.025, 0.06, x, fx.pos.y + 0.07, z, 8);
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this._bulbMat(fx, 5));
        m.position.copy(fx.pos);
        m.scale.y = 1.25;
        fx.bulbs.push(this._add(fx, m));
        break;
      }
      case 'tube': {
        box('metal', x, ceil - 0.04, z, 1.3, 0.06, 0.2);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), this._bulbMat(fx, 3));
        m.rotation.z = Math.PI / 2;
        m.position.set(x, ceil - 0.1, z);
        fx.bulbs.push(this._add(fx, m));
        break;
      }
      case 'lamp': {
        const table = fx.def.y < 1.3;
        const baseY = table ? fx.pos.y - 0.42 : fx.base;
        cylM('brass', 0.08, 0.1, 0.03, x, baseY + 0.015, z, 12);
        cylM('brass', 0.012, 0.012, fx.pos.y - baseY - 0.05, x, (fx.pos.y + baseY) / 2, z, 6);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 0.26, 16, 1, true), this._shadeMat(fx));
        shade.position.set(x, fx.pos.y + 0.06, z);
        fx.bulbs.push(this._add(fx, shade));
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), this._bulbMat(fx, 4));
        m.position.set(x, fx.pos.y, z);
        fx.bulbs.push(this._add(fx, m));
        break;
      }
      case 'sconce': {
        box('brass', x - 0.04, fx.pos.y - 0.05, z, 0.04, 0.18, 0.1);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.14, 12, 1, true), this._shadeMat(fx));
        shade.position.set(x + 0.06, fx.pos.y + 0.04, z);
        fx.bulbs.push(this._add(fx, shade));
        break;
      }
      case 'nightlight': {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this._bulbMat(fx, 2));
        m.position.set(x, fx.pos.y - 0.08, z);
        fx.bulbs.push(this._add(fx, m));
        cylM('plasticWhite', 0.075, 0.08, 0.03, x, fx.pos.y - 0.095, z, 12);
        break;
      }
      case 'candle': {
        for (const [dx, dz, h] of [[0, 0, 0.18], [0.08, 0.05, 0.12], [-0.07, 0.06, 0.09]]) {
          cylM('wax', 0.02, 0.022, h, x + dx, fx.pos.y - 0.2 + h / 2, z + dz, 8);
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 6), this._bulbMat(fx, 6));
          flame.position.set(x + dx, fx.pos.y - 0.2 + h + 0.025, z + dz);
          fx.bulbs.push(this._add(fx, flame));
        }
        break;
      }
      case 'fire': {
        const embers = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), this._bulbMat(fx, 2.5));
        embers.rotation.x = -Math.PI / 2;
        embers.position.set(fx.pos.x + 0.15, fx.base + 0.07, fx.pos.z);
        embers.rotation.z = Math.PI / 2;
        fx.bulbs.push(this._add(fx, embers));
        for (let i = 0; i < 3; i++) {
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), this._bulbMat(fx, 3));
          flame.position.set(fx.pos.x + 0.2, fx.base + 0.28, fx.pos.z - 0.2 + i * 0.2);
          flame.userData.flame = i;
          fx.bulbs.push(this._add(fx, flame));
        }
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- openings
  _buildOpenings() {
    const g = this.grid;
    for (const e of g.edges.values()) {
      if (!['door', 'arch', 'open', 'secret', 'bookshelf'].includes(e.type)) continue;
      const a = g.roomOfEdgeSide(e, 1), b = g.roomOfEdgeSide(e, 2);
      if (a < 0 || b < 0 || a === b) continue;
      const ra = g.rooms[a], rb = g.rooms[b];
      const cx = e.orient === 'V' ? e.a : e.a + 0.5;
      const cz = e.orient === 'V' ? e.b + 0.5 : e.b;
      const y = floorBaseY(e.f) + 1.7;
      const n = e.orient === 'V' ? [1, 0] : [0, 1]; // points toward side 2
      const push = (room, other, sign) => {
        const slotRoom = room.meta.lightFrom ? g.roomByKey[room.meta.lightFrom] : room;
        if (!this.openings.has(slotRoom.index)) this.openings.set(slotRoom.index, []);
        this.openings.get(slotRoom.index).push({ edge: e, other, pos: new THREE.Vector3(cx + n[0] * sign * 0.75, y, cz + n[1] * sign * 0.75), wide: e.type === 'arch' || e.type === 'open' });
      };
      push(ra, rb, -1);
      push(rb, ra, 1);
    }
  }

  // ---------------------------------------------------------------- switches
  _buildSwitches() {
    const g = this.grid;
    for (const room of g.rooms) {
      const list = this.byRoom.get(room.index) || [];
      const ceilingFx = list.filter((f) => CEILING_TYPES.has(f.type));
      if (!ceilingFx.length) continue;
      // find a door/arch edge of this room to put the switch beside
      let spot = null;
      for (const e of g.edges.values()) {
        if (e.f !== room.floor || !['door', 'arch'].includes(e.type)) continue;
        const side = g.roomOfEdgeSide(e, 1) === room.index && e.r1 !== HOLE ? 1 : g.roomOfEdgeSide(e, 2) === room.index && e.r2 !== HOLE ? 2 : 0;
        if (!side) continue;
        // prefer an end where the collinear neighbour is a solid wall
        for (const end of [0, 1]) {
          const s = end === 0 ? -0.22 : 1.22;
          const nb = e.orient === 'V'
            ? g.edgeAt(e.f, e.a - (side === 1 ? 1 : 0), end === 0 ? e.b - 1 : e.b + 1, side === 1 ? 'E' : 'W')
            : g.edgeAt(e.f, end === 0 ? e.a - 1 : e.a + 1, e.b - (side === 1 ? 1 : 0), side === 1 ? 'S' : 'N');
          if (!nb || nb.type !== 'wall') continue;
          const off = (side === 1 ? -1 : 1) * 0.09;
          const x = e.orient === 'V' ? e.a + off : e.a + s;
          const z = e.orient === 'V' ? e.b + s : e.b + off;
          spot = { x, z, e, side };
          break;
        }
        if (spot) break;
      }
      if (!spot) continue;
      const y = floorBaseY(room.floor) + 1.25;
      const geo = this.world.staticGeo;
      geo.floor = room.floor;
      const vertical = spot.e.orient === 'V';
      geo.box('plasticWhite', spot.x, y, spot.z, vertical ? 0.02 : 0.08, 0.12, vertical ? 0.08 : 0.02, { room: room.lightSlot, ao: 1 });
      const sw = { room, fixtures: ceilingFx, pos: new THREE.Vector3(spot.x, y, spot.z) };
      this.switches.push(sw);
      this.world.interactables.push({ kind: 'switch', id: 'switch_' + room.key, f: room.floor, room: room.index, pos: sw.pos, radius: 0.55, prompt: 'Light switch', sw });
    }
    // lamps you can click directly
    for (const fx of this.fixtures) {
      if (['lamp', 'sconce', 'nightlight'].includes(fx.type)) {
        this.world.interactables.push({ kind: 'lamp', id: 'lamp_' + fx.room.key + fx.index, f: fx.room.floor, room: fx.room.index, pos: fx.pos.clone(), radius: 0.5, prompt: 'Lamp', fixture: fx });
      }
    }
  }

  toggleSwitch(sw) {
    const anyOn = sw.fixtures.some((f) => f.on);
    for (const f of sw.fixtures) f.on = !anyOn;
    return !anyOn;
  }

  // ---------------------------------------------------------------- control
  setPower(on) {
    if (this.power === on) return;
    this.power = on;
    this.powerFade = on ? 0 : 1;
  }

  /** Make the lights in a room (or all near a point) stutter for a while. */
  stutterRoom(roomIndex, duration = 2) {
    for (const f of this.byRoom.get(roomIndex) || []) f.stutter = Math.max(f.stutter, duration);
  }

  roomBrightness(roomIndex) {
    let s = 0;
    for (const f of this.byRoom.get(roomIndex) || []) s += f.level * f.baseIntensity;
    return s;
  }

  /** Approximate light level (0..1+) at a point, used for visibility. */
  lightAt(roomIndex, pos) {
    let v = 0;
    const room = this.grid.rooms[roomIndex];
    const list = this.byRoom.get(room && room.meta.lightFrom ? this.grid.roomByKey[room.meta.lightFrom].index : roomIndex) || [];
    for (const f of list) {
      if (f.level <= 0) continue;
      const d2 = f.pos.distanceToSquared(pos);
      v += (f.level * f.baseIntensity) / (1 + d2) * 0.35;
    }
    return v;
  }

  update(dt, t) {
    // power fade
    if (this.power) this.powerFade = Math.min(1, this.powerFade + dt * 1.5);
    else this.powerFade = Math.max(0, this.powerFade - dt * 2.5);
    const table = this.table;
    const g = this.grid;
    for (const fx of this.fixtures) {
      let lvl = fx.on ? 1 : 0;
      if (fx.needsPower) {
        // lights die with a sputter, and come back with a buzz
        const pf = this.powerFade;
        lvl *= pf >= 1 ? 1 : pf <= 0 ? 0 : (noise1(t * 30 + fx.seed * 7, fx.seed) > 0.5 ? pf : pf * 0.2);
      }
      if (fx.flicker > 0 && lvl > 0) {
        const n = noise1(t * 3 + fx.seed * 13, fx.seed + 3);
        const drop = noise1(t * 0.7 + fx.seed * 5, fx.seed + 9);
        let k = 1 - fx.flicker * 0.25 * n;
        if (drop > 1 - fx.flicker * 0.35) k *= noise1(t * 40 + fx.seed, fx.seed) > 0.45 ? 0.08 : 0.9;
        lvl *= k;
      }
      if (fx.type === 'fire' || fx.type === 'candle') {
        lvl *= 0.8 + 0.2 * noise1(t * 7 + fx.seed, fx.seed) + 0.08 * Math.sin(t * 23 + fx.seed);
      }
      if (fx.stutter > 0) {
        fx.stutter -= dt;
        lvl *= noise1(t * 25 + fx.seed * 3, fx.seed + 1) > 0.55 ? 1 : 0.05;
      }
      if (fx.type === 'tv') lvl = fx.tvLevel || 0;
      lvl *= fx.eventDim;
      fx.level = lvl;
      const I = lvl * fx.baseIntensity;
      const slot = fx.room.lightSlot;
      if (fx.index < SLOTS - 1) {
        table.set(slot, fx.index, fx.pos.x, fx.pos.y, fx.pos.z, fx.range, fx.color.r * I, fx.color.g * I, fx.color.b * I);
      }
      // visuals
      for (const b of fx.bulbs) {
        const m = b.material;
        if (m.userData.shade) m.emissiveIntensity = lvl * 1.2;
        else if (m.userData.base) {
          const k = 0.06 + lvl;
          m.color.copy(m.userData.base).multiplyScalar(k);
          if (b.userData.flame !== undefined) b.scale.y = 0.8 + 0.4 * noise1(t * 9 + b.userData.flame * 3, 5);
        }
      }
    }
    // spill light through open doorways into darker rooms
    for (const room of g.rooms) {
      if (room.meta.lightFrom) continue;
      const ops = this.openings.get(room.index);
      const own = this.roomBrightness(room.index);
      let best = null, bestV = 0;
      if (ops) {
        for (const op of ops) {
          const door = op.edge.door;
          const open = door ? (door.broken ? 1 : door.open) : 1;
          if (open < 0.05) continue;
          const other = op.other.meta.lightFrom ? g.roomByKey[op.other.meta.lightFrom] : op.other;
          const v = this.roomBrightness(other.index) * (op.wide ? 0.3 : 0.14) * Math.min(1, open * 1.3);
          if (v > bestV) { bestV = v; best = { op, other }; }
        }
      }
      if (best && bestV > own * 0.25 + 0.2) {
        const list = this.byRoom.get(best.other.index) || [];
        const c = this._c.setRGB(0, 0, 0);
        for (const f of list) c.r += f.color.r * f.level, c.g += f.color.g * f.level, c.b += f.color.b * f.level;
        const n = Math.max(0.001, c.r + c.g + c.b) / 3;
        table.set(room.lightSlot, SLOTS - 1, best.op.pos.x, best.op.pos.y, best.op.pos.z, best.op.wide ? 7 : 4.2, (c.r / n) * bestV, (c.g / n) * bestV, (c.b / n) * bestV);
      } else {
        table.clear(room.lightSlot, SLOTS - 1);
      }
    }
    // outside (moon + lightning)
    const out = g.outsideLightSlot;
    const moon = 0.55 * this.outsideLevel + this.lightning * 40;
    table.set(out, 0, 60, 45, -35, 0, 0.55 * moon * 1600, 0.65 * moon * 1600, 0.95 * moon * 1600);
    table.commit();
  }
}

function mergeGeos(geos) {
  const g = new THREE.BufferGeometry();
  const pos = [], nor = [], idx = [];
  let off = 0;
  for (const s of geos) {
    const ni = s.index ? s.index.array : null;
    const p = s.attributes.position.array, n = s.attributes.normal.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) nor.push(n[i]);
    if (ni) for (let i = 0; i < ni.length; i++) idx.push(ni[i] + off);
    off += p.length / 3;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
