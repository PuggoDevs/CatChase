// Pure (three.js-free) spatial model of the house: rooms, cells, wall edges,
// stairs and openings. Everything that needs to reason about the building -
// physics, pathfinding, line of sight, sound occlusion - goes through here.

import {
  GRID_W, GRID_D, FLOOR_H, FLOOR_MAPS, FLOOR_CEIL, STAIRS, OPENINGS, ROOMS, floorBaseY,
} from './layout.js';

export const DIRS = {
  N: { dx: 0, dz: -1, opp: 'S' },
  S: { dx: 0, dz: 1, opp: 'N' },
  W: { dx: -1, dz: 0, opp: 'E' },
  E: { dx: 1, dz: 0, opp: 'W' },
};
export const DIR_LIST = ['N', 'S', 'W', 'E'];

export const OUTSIDE = -1;
export const HOLE = -2;

// Edge types that physically block a walker (doors are resolved at runtime).
const BLOCKING = new Set(['wall', 'window', 'railing', 'atticwin']);
const DOORLIKE = new Set(['door', 'secret', 'bookshelf', 'front', 'garage', 'grate', 'tiny']);
// Edge types that block line of sight.
const SIGHT_BLOCKING = new Set(['wall', 'atticwin', 'tiny']);

export function edgeKey(f, orient, a, b) {
  return f * 100000 + (orient === 'V' ? 0 : 50000) + a * 100 + b;
}

export class HouseGrid {
  constructor() {
    this.W = GRID_W;
    this.D = GRID_D;
    this.floorCount = FLOOR_MAPS.length;
    this.rooms = [];
    this.roomByKey = {};
    this.cells = [];
    this.stairCells = [];
    this.holeCells = [];
    this.edges = new Map();
    this.stairs = [];
    this.errors = [];
    this._buildRooms();
    this._buildStairs();
    this._buildEdges();
  }

  // ------------------------------------------------------------------ build
  _buildRooms() {
    for (let f = 0; f < this.floorCount; f++) {
      const map = FLOOR_MAPS[f];
      const cells = new Int16Array(this.W * this.D).fill(OUTSIDE);
      if (map.length !== this.D) this.errors.push(`floor ${f}: expected ${this.D} rows, got ${map.length}`);
      for (let z = 0; z < this.D; z++) {
        const row = map[z] || '';
        if (row.length !== this.W) this.errors.push(`floor ${f} row ${z}: expected ${this.W} cols, got ${row.length}`);
        for (let x = 0; x < this.W; x++) {
          const ch = row[x] || '.';
          if (ch === '.') continue;
          if (ch === 'H') { cells[z * this.W + x] = HOLE; continue; }
          const key = `${f}${ch}`;
          let room = this.roomByKey[key];
          if (!room) {
            const meta = ROOMS[key];
            if (!meta) this.errors.push(`no room metadata for ${key}`);
            room = {
              key, index: this.rooms.length, floor: f, code: ch,
              name: meta ? meta.name : key, kind: meta ? meta.kind : 'room', meta: meta || {},
              cells: [], x0: 1e9, z0: 1e9, x1: -1e9, z1: -1e9,
            };
            this.rooms.push(room);
            this.roomByKey[key] = room;
          }
          room.cells.push([x, z]);
          room.x0 = Math.min(room.x0, x); room.z0 = Math.min(room.z0, z);
          room.x1 = Math.max(room.x1, x); room.z1 = Math.max(room.z1, z);
          cells[z * this.W + x] = room.index;
        }
      }
      this.cells.push(cells);
      this.stairCells.push(new Int16Array(this.W * this.D).fill(-1));
      this.holeCells.push(new Int16Array(this.W * this.D).fill(-1));
    }
    for (const room of this.rooms) {
      let sx = 0, sz = 0;
      for (const [x, z] of room.cells) { sx += x + 0.5; sz += z + 0.5; }
      room.cx = sx / room.cells.length;
      room.cz = sz / room.cells.length;
      // pick the room cell closest to the centroid as a representative point
      let best = null, bd = 1e9;
      for (const [x, z] of room.cells) {
        const d = (x + 0.5 - room.cx) ** 2 + (z + 0.5 - room.cz) ** 2;
        if (d < bd) { bd = d; best = [x, z]; }
      }
      room.centerCell = best;
      room.area = room.cells.length;
      room.baseY = floorBaseY(room.floor);
      room.ceil = FLOOR_CEIL[room.floor];
    }
    // light sharing (stairwells borrow the lights of the room they open onto)
    let slot = 0;
    for (const room of this.rooms) {
      if (!room.meta.lightFrom) room.lightSlot = slot++;
    }
    for (const room of this.rooms) {
      if (room.meta.lightFrom) {
        const src = this.roomByKey[room.meta.lightFrom];
        room.lightSlot = src ? src.lightSlot : slot++;
      }
    }
    this.outsideLightSlot = slot++;
    this.lightSlotCount = slot;
  }

  _buildStairs() {
    STAIRS.forEach((s, i) => {
      const st = { ...s, index: i, cells: [] };
      const along = s.dir === 'N' || s.dir === 'S' ? 'z' : 'x';
      st.along = along;
      for (let a = 0; a < s.len; a++) {
        for (let b = 0; b < s.w; b++) {
          const x = along === 'z' ? s.x + b : s.x + a;
          const z = along === 'z' ? s.z + a : s.z + b;
          st.cells.push([x, z]);
          const idx = z * this.W + x;
          const lowerRoom = this.cells[s.lower][idx];
          if (lowerRoom < 0) this.errors.push(`stair ${s.id}: cell ${x},${z} is not a room on floor ${s.lower}`);
          else if (a === 0 && b === 0) st.room = lowerRoom;
          else if (lowerRoom !== st.room) this.errors.push(`stair ${s.id}: inconsistent stair room at ${x},${z}`);
          this.stairCells[s.lower][idx] = i;
          if (this.cells[s.lower + 1][idx] !== HOLE) this.errors.push(`stair ${s.id}: cell ${x},${z} should be a hole on floor ${s.lower + 1}`);
          this.holeCells[s.lower + 1][idx] = i;
        }
      }
      // entry (bottom) and exit (top) edges
      st.bottomEdges = [];
      st.topEdges = [];
      for (let b = 0; b < s.w; b++) {
        if (s.dir === 'N') {
          st.bottomEdges.push({ f: s.lower, x: s.x + b, z: s.z + s.len - 1, side: 'S' });
          st.topEdges.push({ f: s.lower + 1, x: s.x + b, z: s.z, side: 'N' });
        } else if (s.dir === 'S') {
          st.bottomEdges.push({ f: s.lower, x: s.x + b, z: s.z, side: 'N' });
          st.topEdges.push({ f: s.lower + 1, x: s.x + b, z: s.z + s.len - 1, side: 'S' });
        } else if (s.dir === 'W') {
          st.bottomEdges.push({ f: s.lower, x: s.x + s.len - 1, z: s.z + b, side: 'E' });
          st.topEdges.push({ f: s.lower + 1, x: s.x, z: s.z + b, side: 'W' });
        } else {
          st.bottomEdges.push({ f: s.lower, x: s.x, z: s.z + b, side: 'W' });
          st.topEdges.push({ f: s.lower + 1, x: s.x + s.len - 1, z: s.z + b, side: 'E' });
        }
      }
      // bounds in world space
      if (along === 'z') { st.x0 = s.x; st.x1 = s.x + s.w; st.z0 = s.z; st.z1 = s.z + s.len; }
      else { st.x0 = s.x; st.x1 = s.x + s.len; st.z0 = s.z; st.z1 = s.z + s.w; }
      st.baseY = floorBaseY(s.lower);
      this.stairs.push(st);
    });
  }

  _edgeCoords(f, x, z, side) {
    // returns canonical {orient, a, b} plus the two cells
    switch (side) {
      case 'N': return { orient: 'H', a: x, b: z, c1: [x, z - 1], c2: [x, z] };
      case 'S': return { orient: 'H', a: x, b: z + 1, c1: [x, z], c2: [x, z + 1] };
      case 'W': return { orient: 'V', a: x, b: z, c1: [x - 1, z], c2: [x, z] };
      case 'E': return { orient: 'V', a: x + 1, b: z, c1: [x, z], c2: [x + 1, z] };
      default: throw new Error('bad side ' + side);
    }
  }

  _buildEdges() {
    // 1. structural walls between differing codes
    for (let f = 0; f < this.floorCount; f++) {
      for (let z = 0; z < this.D; z++) {
        for (let x = 0; x < this.W; x++) {
          const here = this.cellRaw(f, x, z);
          // east neighbour
          if (x + 1 < this.W) {
            const there = this.cellRaw(f, x + 1, z);
            if (here !== there && !(here === OUTSIDE && there === OUTSIDE)) this._addEdge(f, x, z, 'E', 'wall');
          }
          if (z + 1 < this.D) {
            const there = this.cellRaw(f, x, z + 1);
            if (here !== there && !(here === OUTSIDE && there === OUTSIDE)) this._addEdge(f, x, z, 'S', 'wall');
          }
        }
      }
    }
    // 2. hole <-> hole of the same stair never has walls; neighbouring
    //    holes are handled because codes equal (both HOLE). Stair auto edges:
    for (const st of this.stairs) {
      for (const e of st.bottomEdges) this._setEdgeType(e.f, e.x, e.z, e.side, 'open', null, true);
      for (const e of st.topEdges) this._setEdgeType(e.f, e.x, e.z, e.side, 'open', null, true);
    }
    // 3. explicit openings
    for (const op of OPENINGS) {
      const e = this.edgeAt(op.f, op.x, op.z, op.side);
      if (!e) {
        this.errors.push(`opening ${op.id || op.type} at f${op.f} ${op.x},${op.z}${op.side} is not on a wall`);
        continue;
      }
      if (op.type === 'window' || op.type === 'atticwin' || op.type === 'garage' || op.type === 'front' || op.type === 'tiny') {
        if (!e.exterior) this.errors.push(`${op.type} ${op.id || ''} at f${op.f} ${op.x},${op.z}${op.side} is not an exterior wall`);
      }
      e.type = op.type;
      e.opening = op;
    }
  }

  _addEdge(f, x, z, side, type) {
    const c = this._edgeCoords(f, x, z, side);
    const key = edgeKey(f, c.orient, c.a, c.b);
    const r1 = this.cellRaw(f, c.c1[0], c.c1[1]);
    const r2 = this.cellRaw(f, c.c2[0], c.c2[1]);
    const edge = {
      key, f, orient: c.orient, a: c.a, b: c.b,
      c1: c.c1, c2: c.c2, r1, r2,
      exterior: r1 === OUTSIDE || r2 === OUTSIDE,
      type, opening: null, door: null,
    };
    // world-space segment
    if (c.orient === 'V') { edge.x0 = c.a; edge.x1 = c.a; edge.z0 = c.b; edge.z1 = c.b + 1; }
    else { edge.x0 = c.a; edge.x1 = c.a + 1; edge.z0 = c.b; edge.z1 = c.b; }
    this.edges.set(key, edge);
    return edge;
  }

  _setEdgeType(f, x, z, side, type, opening, onlyIfWall) {
    const e = this.edgeAt(f, x, z, side);
    if (!e) { this.errors.push(`auto edge f${f} ${x},${z}${side} missing`); return; }
    if (onlyIfWall && e.type !== 'wall') return;
    e.type = type;
    if (opening) e.opening = opening;
  }

  // ---------------------------------------------------------------- queries
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.W && z < this.D; }

  cellRaw(f, x, z) {
    if (f < 0 || f >= this.floorCount || !this.inBounds(x, z)) return OUTSIDE;
    return this.cells[f][z * this.W + x];
  }

  /** room index at a cell or -1 (outside) / -2 (stairwell hole) */
  roomIndexAt(f, x, z) { return this.cellRaw(f, x, z); }

  roomAtWorld(f, wx, wz) {
    const r = this.cellRaw(f, Math.floor(wx), Math.floor(wz));
    if (r >= 0) return this.rooms[r];
    if (r === HOLE) {
      const s = this.holeStair(f, Math.floor(wx), Math.floor(wz));
      if (s) return this.rooms[s.room];
    }
    return null;
  }

  stairAt(f, x, z) {
    if (f < 0 || f >= this.floorCount || !this.inBounds(x, z)) return null;
    const i = this.stairCells[f][z * this.W + x];
    return i >= 0 ? this.stairs[i] : null;
  }

  holeStair(f, x, z) {
    if (f < 0 || f >= this.floorCount || !this.inBounds(x, z)) return null;
    const i = this.holeCells[f][z * this.W + x];
    return i >= 0 ? this.stairs[i] : null;
  }

  edgeAt(f, x, z, side) {
    const c = this._edgeCoords(f, x, z, side);
    return this.edges.get(edgeKey(f, c.orient, c.a, c.b)) || null;
  }

  /** ramp progress (0 bottom .. 1 top) of a world position on a stair */
  stairT(st, wx, wz) {
    let t;
    switch (st.dir) {
      case 'N': t = (st.z1 - wz) / st.len; break;
      case 'S': t = (wz - st.z0) / st.len; break;
      case 'W': t = (st.x1 - wx) / st.len; break;
      default: t = (wx - st.x0) / st.len; break;
    }
    return Math.min(1, Math.max(0, t));
  }

  /** Height of the walkable surface for an agent that is on floor `f`. */
  groundY(f, wx, wz) {
    const x = Math.floor(wx), z = Math.floor(wz);
    const st = this.stairAt(f, x, z);
    if (st) return st.baseY + this.stairT(st, wx, wz) * FLOOR_H;
    return floorBaseY(f);
  }

  /**
   * Which floor grid an agent standing at (wx, y, wz) belongs to. Agents on a
   * staircase belong to the stair's lower floor.
   */
  floorAt(wx, y, wz, hint = 1) {
    const x = Math.floor(wx), z = Math.floor(wz);
    for (let f = this.floorCount - 1; f >= 0; f--) {
      if (y < floorBaseY(f) - 0.6) continue;
      const r = this.cellRaw(f, x, z);
      if (r === HOLE) {
        const st = this.holeStair(f, x, z);
        if (st) return st.lower;
        continue;
      }
      if (r >= 0) return f;
    }
    return hint;
  }

  isWalkableCell(f, x, z) {
    return this.cellRaw(f, x, z) >= 0;
  }

  /**
   * Can an agent cross from cell (x,z) on floor f in direction `side`?
   * Handles stairs (the top exit of a stair is on the upper floor's grid).
   * Returns { ok, f2, x2, z2, edge, door } describing the destination.
   * opts: { doors: 'open'|'any'|'unlocked', prone, cat }
   */
  step(f, x, z, side, opts = {}) {
    const d = DIRS[side];
    const x2 = x + d.dx, z2 = z + d.dz;
    let edgeFloor = f;
    let f2 = f;
    const st = this.stairAt(f, x, z);
    if (st) {
      // moving inside the stair column or out through top/bottom
      const top = st.topEdges.find((e) => this._sameEdge(e, f + 1, x, z, side));
      if (top) { edgeFloor = f + 1; f2 = f + 1; }
    }
    const edge = this.edgeAt(edgeFloor, x, z, side);
    let r2 = this.cellRaw(f2, x2, z2);
    if (r2 === HOLE) {
      const hs = this.holeStair(f2, x2, z2);
      if (!hs) return { ok: false };
      // walking into a stair from its top (hole side) -> belongs to lower floor
      f2 = hs.lower;
      r2 = this.cellRaw(f2, x2, z2);
    }
    if (r2 < 0) return { ok: false };
    if (edge) {
      const res = this.edgePassable(edge, opts);
      if (!res.ok) return { ok: false, edge, door: edge.door };
      return { ok: true, f2, x2, z2, edge, door: edge.door, cost: res.cost };
    }
    // no edge: same room on this floor; but a stair column edge might hide here
    if (st && !this.stairAt(f, x2, z2) && f2 === f) {
      // leaving the stair sideways/through the lower-floor top without an edge record
      return { ok: false };
    }
    return { ok: true, f2, x2, z2, edge: null, door: null, cost: 1 };
  }

  _sameEdge(e, f, x, z, side) {
    if (e.f !== f) return false;
    const a = this._edgeCoords(e.f, e.x, e.z, e.side);
    const b = this._edgeCoords(f, x, z, side);
    return a.orient === b.orient && a.a === b.a && a.b === b.b;
  }

  edgePassable(edge, opts = {}) {
    const t = edge.type;
    if (t === 'open' || t === 'arch') return { ok: true, cost: 1 };
    if (BLOCKING.has(t)) return { ok: false };
    if (t === 'crawl') return { ok: !!(opts.prone || opts.cat), cost: 3 };
    if (DOORLIKE.has(t)) {
      const door = edge.door;
      if (!door) return { ok: false };
      if (door.isPassable()) return { ok: true, cost: 1 };
      if (opts.doors === 'open' || door.jammed) return { ok: false };
      if (door.locked) return opts.breakDoors && door.breakable ? { ok: true, cost: 14 } : { ok: false };
      // barricades only slow the cat down: it will batter its way through
      if (door.barricade > 0) return opts.cat ? { ok: true, cost: 9 } : { ok: false };
      if (!door.canBeOpenedBy(opts)) return { ok: false };
      return { ok: true, cost: 2 };
    }
    return { ok: true, cost: 1 };
  }

  /** Does the edge block sight? */
  edgeBlocksSight(edge) {
    if (SIGHT_BLOCKING.has(edge.type)) return true;
    if (edge.type === 'window') return false;
    if (edge.type === 'open' || edge.type === 'arch' || edge.type === 'railing' || edge.type === 'crawl') return false;
    if (edge.door) return edge.door.blocksSight();
    return true;
  }

  /** Walk the grid cells crossed by the 2D segment and report crossed edges. */
  forEachCrossedEdge(f, ax, az, bx, bz, cb) {
    let x = Math.floor(ax), z = Math.floor(az);
    const ex = Math.floor(bx), ez = Math.floor(bz);
    const dx = bx - ax, dz = bz - az;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? (x + 1 - ax) : (ax - x)) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? (z + 1 - az) : (az - z)) * tDeltaZ : Infinity;
    let guard = 0;
    while ((x !== ex || z !== ez) && guard++ < 200) {
      let side;
      if (tMaxX < tMaxZ) {
        side = stepX > 0 ? 'E' : 'W';
        if (tMaxX > 1) break;
        const e = this.edgeAt(f, x, z, side);
        if (e && cb(e, x, z, side) === false) return false;
        x += stepX; tMaxX += tDeltaX;
      } else {
        side = stepZ > 0 ? 'S' : 'N';
        if (tMaxZ > 1) break;
        const e = this.edgeAt(f, x, z, side);
        if (e && cb(e, x, z, side) === false) return false;
        z += stepZ; tMaxZ += tDeltaZ;
      }
    }
    return true;
  }

  /** True when a straight line on floor f is not blocked by walls/closed doors. */
  hasLineOfSight(f, ax, az, bx, bz) {
    let clear = true;
    this.forEachCrossedEdge(f, ax, az, bx, bz, (e) => {
      if (this.edgeBlocksSight(e)) { clear = false; return false; }
      return true;
    });
    return clear;
  }

  /** Count occluders between two points for audio (walls, doors, floors). */
  occlusion(f1, ax, az, f2, bx, bz) {
    let walls = 0, doors = 0;
    this.forEachCrossedEdge(f1, ax, az, bx, bz, (e) => {
      if (e.type === 'open' || e.type === 'arch' || e.type === 'railing') return true;
      if (e.door) {
        if (!e.door.isPassable()) doors++;
        return true;
      }
      if (e.type === 'window') { walls += 0.6; return true; }
      walls++;
      return true;
    });
    const floors = Math.abs(f1 - f2);
    return { walls, doors, floors };
  }

  /** All cells of the house flattened as {f,x,z,room} (walkable only). */
  *walkableCells() {
    for (let f = 0; f < this.floorCount; f++) {
      for (let z = 0; z < this.D; z++) {
        for (let x = 0; x < this.W; x++) {
          const r = this.cells[f][z * this.W + x];
          if (r >= 0) yield { f, x, z, room: r };
        }
      }
    }
  }

  roomsOnFloor(f) { return this.rooms.filter((r) => r.floor === f); }

  /** Rooms directly connected to `room` through any passable-type opening. */
  neighbours(room) {
    const out = new Set();
    for (const e of this.edges.values()) {
      if (e.type === 'wall' || e.type === 'window' || e.type === 'railing') continue;
      if (e.f !== room.floor && !(e.r1 === HOLE || e.r2 === HOLE)) continue;
      const a = this.roomOfEdgeSide(e, 1), b = this.roomOfEdgeSide(e, 2);
      if (a === room.index && b >= 0) out.add(b);
      if (b === room.index && a >= 0) out.add(a);
    }
    return [...out].map((i) => this.rooms[i]);
  }

  roomOfEdgeSide(e, which) {
    const c = which === 1 ? e.c1 : e.c2;
    const r = which === 1 ? e.r1 : e.r2;
    if (r === HOLE) {
      const st = this.holeStair(e.f, c[0], c[1]);
      return st ? st.room : -1;
    }
    return r;
  }
}

let _grid = null;
export function getGrid() {
  if (!_grid) _grid = new HouseGrid();
  return _grid;
}
