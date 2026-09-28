// Cell-level A* over all four floors: stairs, doors (with open / closed /
// barricaded / locked costs), furniture-blocked cells and the vent network.
import { DIR_LIST, DIRS } from '../world/grid.js';
import { floorBaseY } from '../world/layout.js';

class Heap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const it = this.items, pr = this.prio;
    it.push(item); pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [it[parent], it[i]] = [it[i], it[parent]];
      [pr[parent], pr[i]] = [pr[i], pr[parent]];
      i = parent;
    }
  }
  pop() {
    const it = this.items, pr = this.prio;
    const top = it[0];
    const lastI = it.pop(), lastP = pr.pop();
    if (it.length) {
      it[0] = lastI; pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}

export class NavGraph {
  /**
   * @param grid HouseGrid
   * @param blocked per-floor Uint8Array of furniture-blocked cells
   * @param vents [{id, f, x, z, side, mouth?}]
   */
  constructor(grid, blocked, vents = []) {
    this.grid = grid;
    this.W = grid.W; this.D = grid.D; this.F = grid.floorCount;
    this.blocked = blocked || Array.from({ length: this.F }, () => new Uint8Array(this.W * this.D));
    this.N = this.W * this.D * this.F;
    this.vents = [];
    for (const v of vents) {
      // the cell in front of the grille
      const node = this.id(v.f, v.x, v.z);
      this.vents.push({ ...v, node });
    }
    this.ventByNode = new Map(this.vents.map((v) => [v.node, v]));
  }

  id(f, x, z) { return (f * this.D + z) * this.W + x; }
  unpack(n) {
    const x = n % this.W;
    const z = Math.floor(n / this.W) % this.D;
    const f = Math.floor(n / (this.W * this.D));
    return { f, x, z };
  }

  isNode(f, x, z) {
    return this.grid.cellRaw(f, x, z) >= 0;
  }

  isBlocked(f, x, z) { return this.blocked[f][z * this.W + x] === 1; }

  /** Node for a world position (resolving stairs/holes). */
  nodeAt(f, wx, wz) {
    let x = Math.floor(wx), z = Math.floor(wz);
    const hs = this.grid.holeStair(f, x, z);
    if (hs) f = hs.lower;
    if (!this.isNode(f, x, z)) return -1;
    return this.id(f, x, z);
  }

  /** Nearest unblocked node to a world position (searching outward). */
  nearestFree(f, wx, wz, maxR = 3) {
    const n0 = this.nodeAt(f, wx, wz);
    if (n0 >= 0) {
      const { f: ff, x, z } = this.unpack(n0);
      if (!this.isBlocked(ff, x, z)) return n0;
      f = ff;
    }
    let best = -1, bd = Infinity;
    const cx = Math.floor(wx), cz = Math.floor(wz);
    for (let dz = -maxR; dz <= maxR; dz++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        const x = cx + dx, z = cz + dz;
        if (!this.isNode(f, x, z) || this.isBlocked(f, x, z)) continue;
        // must be in the same room if possible
        const d = (x + 0.5 - wx) ** 2 + (z + 0.5 - wz) ** 2 + (this.grid.cellRaw(f, x, z) === this.grid.cellRaw(f, Math.floor(wx), Math.floor(wz)) ? 0 : 4);
        if (d < bd) { bd = d; best = this.id(f, x, z); }
      }
    }
    return best;
  }

  worldOf(n) {
    const { f, x, z } = this.unpack(n);
    const wx = x + 0.5, wz = z + 0.5;
    return { f, x: wx, z: wz, y: this.grid.groundY(f, wx, wz) };
  }

  neighbours(n, opts, out) {
    out.length = 0;
    const { f, x, z } = this.unpack(n);
    const g = this.grid;
    for (const side of DIR_LIST) {
      const s = g.step(f, x, z, side, opts);
      if (!s.ok) continue;
      if (this.isBlocked(s.f2, s.x2, s.z2) && !opts.ignoreBlocked) continue;
      out.push({ n: this.id(s.f2, s.x2, s.z2), cost: s.cost || 1, door: s.door || null, edge: s.edge || null });
    }
    // diagonals inside the same room with no walls at the corner
    if (!g.stairAt(f, x, z)) {
      for (const [a, b] of [['N', 'E'], ['N', 'W'], ['S', 'E'], ['S', 'W']]) {
        const da = DIRS[a], db = DIRS[b];
        const x2 = x + da.dx + db.dx, z2 = z + da.dz + db.dz;
        const r0 = g.cellRaw(f, x, z);
        if (g.cellRaw(f, x2, z2) !== r0 || g.cellRaw(f, x + da.dx, z + da.dz) !== r0 || g.cellRaw(f, x + db.dx, z + db.dz) !== r0) continue;
        if (g.stairAt(f, x2, z2)) continue;
        if (this.isBlocked(f, x2, z2) || this.isBlocked(f, x + da.dx, z + da.dz) || this.isBlocked(f, x + db.dx, z + db.dz)) continue;
        out.push({ n: this.id(f, x2, z2), cost: 1.414, door: null, edge: null });
      }
    }
    if (opts.vents) {
      const v = this.ventByNode.get(n);
      if (v) {
        for (const w of this.vents) {
          if (w === v) continue;
          if (Math.abs(w.f - v.f) > 1) continue;
          const d = Math.hypot(w.x - v.x, w.z - v.z) + Math.abs(w.f - v.f) * 4;
          out.push({ n: w.node, cost: 3 + d * (opts.ventCost ?? 0.7), vent: [v, w] });
        }
      }
    }
    return out;
  }

  /**
   * A* from world position a to b. Returns an array of waypoints
   * [{x,z,f,y, door?, vent?}] or null.
   * opts: { doors: 'any'|'open', breakDoors, vents, ventCost, maxIter, cat:true }
   */
  findPath(fa, ax, az, fb, bx, bz, opts = {}) {
    const o = { cat: true, doors: 'any', ...opts };
    const start = this.nearestFree(fa, ax, az);
    const goal = this.nearestFree(fb, bx, bz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [this.worldOf(goal)];
    const gScore = new Map([[start, 0]]);
    const came = new Map();
    const heap = new Heap();
    const G = this.unpack(goal);
    const h = (n) => {
      const p = this.unpack(n);
      return Math.hypot(p.x - G.x, p.z - G.z) + Math.abs(p.f - G.f) * 5;
    };
    heap.push(start, h(start));
    const closed = new Set();
    const nb = [];
    let iter = 0;
    const maxIter = o.maxIter || 20000;
    while (heap.size && iter++ < maxIter) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = gScore.get(cur);
      for (const e of this.neighbours(cur, o, nb)) {
        const ng = gc + e.cost;
        if (ng < (gScore.get(e.n) ?? Infinity)) {
          gScore.set(e.n, ng);
          came.set(e.n, { from: cur, door: e.door, vent: e.vent || null });
          heap.push(e.n, ng + h(e.n));
        }
      }
    }
    if (!came.has(goal)) return null;
    const nodes = [];
    let n = goal;
    while (n !== start) {
      const c = came.get(n);
      nodes.push({ n, door: c.door, vent: c.vent });
      n = c.from;
    }
    nodes.reverse();
    const out = [];
    for (const s of nodes) {
      const w = this.worldOf(s.n);
      if (s.door) w.door = s.door;
      if (s.vent) w.vent = s.vent;
      out.push(w);
    }
    const smoothed = this.smooth(this.worldOf(start), out);
    smoothed.totalCost = gScore.get(goal);
    smoothed.usesVent = out.some((p) => p.vent);
    return smoothed;
  }

  /** Drop intermediate points reachable in a straight, clear line. */
  smooth(startPt, pts) {
    if (pts.length < 3) return pts;
    const out = [];
    let anchor = startPt;
    let i = 0;
    while (i < pts.length) {
      let j = i;
      // extend as far as possible while the straight line stays clear
      while (j + 1 < pts.length && !pts[j + 1].door && !pts[j + 1].vent && !pts[j].door && !pts[j].vent && pts[j + 1].f === anchor.f && this.clearLine(anchor, pts[j + 1])) j++;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  clearLine(a, b) {
    if (a.f !== b.f) return false;
    const g = this.grid;
    if (g.stairAt(a.f, Math.floor(a.x), Math.floor(a.z)) || g.stairAt(b.f, Math.floor(b.x), Math.floor(b.z))) return false;
    // no walls/doors crossed
    let ok = true;
    g.forEachCrossedEdge(a.f, a.x, a.z, b.x, b.z, (e) => {
      if (e.type !== 'open' && e.type !== 'arch') { ok = false; return false; }
      return true;
    });
    if (!ok) return false;
    // no blocked cells along the line (sample, with a little body width)
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / 0.25);
    const nx = -(b.z - a.z) / (d || 1), nz = (b.x - a.x) / (d || 1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      for (const w of [-0.3, 0, 0.3]) {
        const x = Math.floor(a.x + (b.x - a.x) * t + nx * w), z = Math.floor(a.z + (b.z - a.z) * t + nz * w);
        if (!this.isNode(a.f, x, z) || this.isBlocked(a.f, x, z) || g.stairAt(a.f, x, z)) return false;
      }
    }
    return true;
  }

  /** Random walkable, unblocked point inside a room. */
  randomPointInRoom(room, rng) {
    const cells = room.cells.filter(([x, z]) => !this.isBlocked(room.floor, x, z) && !this.grid.stairAt(room.floor, x, z));
    if (!cells.length) return null;
    const [x, z] = rng.pick(cells);
    return { f: room.floor, x: x + rng.float(0.3, 0.7), z: z + rng.float(0.3, 0.7), y: floorBaseY(room.floor) };
  }

  /** Connected-component check used by tests: rooms reachable from a room. */
  reachableRooms(fromRoom, opts = { doors: 'any' }) {
    const [x, z] = fromRoom.centerCell;
    const start = this.nearestFree(fromRoom.floor, x + 0.5, z + 0.5);
    const seen = new Set([start]);
    const q = [start];
    const nb = [];
    const rooms = new Set();
    while (q.length) {
      const n = q.shift();
      const { f, x: cx, z: cz } = this.unpack(n);
      rooms.add(this.grid.cellRaw(f, cx, cz));
      for (const e of this.neighbours(n, { cat: true, ...opts }, nb)) {
        if (!seen.has(e.n)) { seen.add(e.n); q.push(e.n); }
      }
    }
    return rooms;
  }
}
