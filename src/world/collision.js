// Axis-aligned box collision. Colliders carry a vertical extent, so a table
// top blocks a standing player but not a crawling one, stair railings block
// only at the right heights, and floors never interfere with each other.
//
// collider: { x0,x1, y0,y1, z0,z1, active?, sight?, kind, f? }

const STEP_UP = 0.28;

export class CollisionWorld {
  constructor(width, depth) {
    this.W = width;
    this.D = depth;
    this.cells = new Array(width * depth);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.dynamic = [];
    this._stamp = 0;
    this.all = [];
  }

  _range(c) {
    const x0 = Math.max(0, Math.floor(c.x0)), x1 = Math.min(this.W - 1, Math.floor(c.x1 - 1e-6));
    const z0 = Math.max(0, Math.floor(c.z0)), z1 = Math.min(this.D - 1, Math.floor(c.z1 - 1e-6));
    return [x0, x1, z0, z1];
  }

  addStatic(c) {
    if (c.active === undefined) c.active = true;
    c._stamp = 0;
    const [x0, x1, z0, z1] = this._range(c);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * this.W + x].push(c);
    this.all.push(c);
    return c;
  }

  removeStatic(c) {
    const [x0, x1, z0, z1] = this._range(c);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const arr = this.cells[z * this.W + x];
      const i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1);
    }
    const j = this.all.indexOf(c);
    if (j >= 0) this.all.splice(j, 1);
  }

  /** Move a static collider (e.g. a pushed wardrobe). */
  moveStatic(c, nx0, nz0) {
    this.removeStatic(c);
    const w = c.x1 - c.x0, d = c.z1 - c.z0;
    c.x0 = nx0; c.z0 = nz0; c.x1 = nx0 + w; c.z1 = nz0 + d;
    this.addStatic(c);
  }

  addDynamic(c) {
    if (c.active === undefined) c.active = true;
    c._stamp = 0;
    this.dynamic.push(c);
    return c;
  }

  /** Visit colliders overlapping the XZ rectangle (each once). */
  forEachNear(x0, z0, x1, z1, fn) {
    const stamp = ++this._stamp;
    const cx0 = Math.max(0, Math.floor(x0)), cx1 = Math.min(this.W - 1, Math.floor(x1));
    const cz0 = Math.max(0, Math.floor(z0)), cz1 = Math.min(this.D - 1, Math.floor(z1));
    for (let z = cz0; z <= cz1; z++) {
      for (let x = cx0; x <= cx1; x++) {
        const arr = this.cells[z * this.W + x];
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          if (fn(c) === false) return;
        }
      }
    }
    for (const c of this.dynamic) {
      if (c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
      if (fn(c) === false) return;
    }
  }

  /**
   * Push a vertical cylinder (centre x,z, feet y, radius r, height h) out of
   * all overlapping colliders. Mutates and returns pos. `filter(c)` may veto.
   */
  resolveCylinder(pos, r, h, filter = null) {
    const feet = pos.y, head = pos.y + h;
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.forEachNear(pos.x - r - 0.1, pos.z - r - 0.1, pos.x + r + 0.1, pos.z + r + 0.1, (c) => {
        if (!c.active) return;
        if (c.y1 <= feet + STEP_UP || c.y0 >= head) return;
        if (filter && !filter(c)) return;
        const cx = pos.x < c.x0 ? c.x0 : pos.x > c.x1 ? c.x1 : pos.x;
        const cz = pos.z < c.z0 ? c.z0 : pos.z > c.z1 ? c.z1 : pos.z;
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        hit = true;
        moved = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-4;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // centre inside the box: exit through the nearest side
          const l = pos.x - c.x0, rr = c.x1 - pos.x, t = pos.z - c.z0, b = c.z1 - pos.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) pos.x = c.x0 - r; else if (m === rr) pos.x = c.x1 + r;
          else if (m === t) pos.z = c.z0 - r; else pos.z = c.z1 + r;
        }
      });
      if (!moved) break;
    }
    return hit;
  }

  /** Is a cylinder at pos free of colliders? */
  isFree(pos, r, h, filter = null) {
    let free = true;
    const feet = pos.y, head = pos.y + h;
    this.forEachNear(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (c) => {
      if (!c.active) return;
      if (c.y1 <= feet + STEP_UP || c.y0 >= head) return;
      if (filter && !filter(c)) return;
      const cx = Math.max(c.x0, Math.min(pos.x, c.x1)), cz = Math.max(c.z0, Math.min(pos.z, c.z1));
      if ((pos.x - cx) ** 2 + (pos.z - cz) ** 2 < r * r) { free = false; return false; }
    });
    return free;
  }

  /**
   * Segment test against sight-blocking colliders. Returns true if blocked.
   * a, b: {x,y,z}
   */
  segmentBlocked(a, b, filter = null) {
    const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x);
    const minz = Math.min(a.z, b.z), maxz = Math.max(a.z, b.z);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    let blocked = false;
    // walk only the cells the segment passes through (2D DDA), plus dynamics
    const visit = (c) => {
      if (!c.active || !c.sight) return;
      if (filter && !filter(c)) return;
      if (segAabb(a.x, a.y, a.z, dx, dy, dz, c)) { blocked = true; return false; }
    };
    const stamp = ++this._stamp;
    let x = Math.floor(a.x), z = Math.floor(a.z);
    const ex = Math.floor(b.x), ez = Math.floor(b.z);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? x + 1 - a.x : a.x - x) * tdx : Infinity;
    let tmz = dz !== 0 ? (dz > 0 ? z + 1 - a.z : a.z - z) * tdz : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      // check this cell and its neighbours (colliders straddle cell borders)
      for (let oz = -1; oz <= 1 && !blocked; oz++) {
        for (let ox = -1; ox <= 1 && !blocked; ox++) {
          const cx = x + ox, cz = z + oz;
          if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.D) continue;
          const arr = this.cells[cz * this.W + cx];
          for (let i = 0; i < arr.length; i++) {
            const c = arr[i];
            if (c._stamp === stamp) continue;
            c._stamp = stamp;
            if (visit(c) === false) break;
          }
        }
      }
      if (blocked) return true;
      if (x === ex && z === ez) break;
      if (tmx < tmz) { if (tmx > 1) break; x += stepX; tmx += tdx; }
      else { if (tmz > 1) break; z += stepZ; tmz += tdz; }
    }
    for (const c of this.dynamic) {
      if (c.x1 < minx || c.x0 > maxx || c.z1 < minz || c.z0 > maxz) continue;
      if (visit(c) === false) return true;
    }
    return blocked;
  }
}

/** Slab test: does segment p + t*d (t in [0,1]) hit the box? */
export function segAabb(px, py, pz, dx, dy, dz, c) {
  let t0 = 0, t1 = 1;
  const axes = [[px, dx, c.x0, c.x1], [py, dy, c.y0, c.y1], [pz, dz, c.z0, c.z1]];
  for (let i = 0; i < 3; i++) {
    const [p, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
  }
  return true;
}
