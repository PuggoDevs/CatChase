// Builds the house shell from the grid: walls (with correct corners, jambs,
// lintels), floors, ceilings, stairs, railings, windows, door frames,
// baseboards and wainscoting. Also emits the static physics colliders.
import * as THREE from 'three';
import { FLOOR_H, SLAB, WALL_T, EXT_WALL_T, DOOR_H, FLOOR_CEIL, floorBaseY } from './layout.js';
import { HOLE } from './grid.js';
import { mat4 } from './geo.js';

const EXT_FLOOR = 9; // bucket id for always-visible exterior geometry

const WAINSCOT = new Set(['1F', '1D', '1h', '1S', '2u', '2r', '1R', '2l', '1^', '1Y']);
const NO_BASEBOARD_KINDS = new Set(['cellar', 'tunnel', 'attic', 'garage', 'secret']);
const WALLISH = new Set(['wall', 'window', 'door', 'secret', 'bookshelf', 'front', 'garage', 'grate', 'arch', 'atticwin', 'tiny', 'crawl']);
const OPENING_TOPS = { door: DOOR_H, secret: DOOR_H, bookshelf: 2.2, front: 2.35, garage: 2.45, grate: 1.25, arch: 2.3, tiny: 1.05, crawl: 0.75 };
const FRAMED = new Set(['door', 'arch', 'front']);

export function edgeThickness(e) { return e.exterior ? EXT_WALL_T : WALL_T; }

export function openingTop(e) {
  return OPENING_TOPS[e.type] ?? DOOR_H;
}

function windowSpan(e) {
  const op = e.opening || {};
  if (e.type === 'atticwin') return [0.75, 1.85];
  if (op.style === 'basement') return [2.05, 2.7];
  if (op.small) return [1.45, 2.1];
  if (op.tall) return [0.35, 2.35];
  if (op.style === 'round') return [0.9, 1.8];
  return [0.85, 2.15];
}

export class ArchitectureBuilder {
  constructor(grid, geo) {
    this.grid = grid;
    this.geo = geo;
    this.colliders = [];
    this.windows = []; // descriptors for events (window stares, lightning)
  }

  build() {
    for (let f = 0; f < this.grid.floorCount; f++) {
      this.buildFloorsAndCeilings(f);
    }
    for (const e of this.grid.edges.values()) this.buildEdge(e);
    for (const st of this.grid.stairs) this.buildStair(st);
    return { colliders: this.colliders, windows: this.windows };
  }

  // ---------------------------------------------------------------- helpers
  roomOfSide(e, which) {
    const r = which === 1 ? e.r1 : e.r2;
    const c = which === 1 ? e.c1 : e.c2;
    if (r >= 0) return this.grid.rooms[r];
    if (r === HOLE) {
      const st = this.grid.holeStair(e.f, c[0], c[1]);
      return st ? this.grid.rooms[st.room] : null;
    }
    return null; // outside
  }

  wallMatFor(room) {
    if (!room) return null;
    return room.meta.wall || 'plasterWall';
  }

  lightSlot(room) { return room ? room.lightSlot : this.grid.outsideLightSlot; }

  /** extension and cap info at both ends of an edge */
  endInfo(e) {
    const g = this.grid;
    const f = e.f;
    const res = [];
    for (const end of [0, 1]) {
      let col, perpA, perpB;
      if (e.orient === 'V') {
        // edge x = a, z in [b, b+1]; vertex at (a, b + end)
        const vz = e.b + end;
        col = g.edges.get(this._key(f, 'V', e.a, end === 0 ? e.b - 1 : e.b + 1));
        perpA = g.edges.get(this._key(f, 'H', e.a - 1, vz));
        perpB = g.edges.get(this._key(f, 'H', e.a, vz));
      } else {
        const vx = e.a + end;
        col = g.edges.get(this._key(f, 'H', end === 0 ? e.a - 1 : e.a + 1, e.b));
        perpA = g.edges.get(this._key(f, 'V', vx, e.b - 1));
        perpB = g.edges.get(this._key(f, 'V', vx, e.b));
      }
      const colWall = col && WALLISH.has(col.type);
      const pa = perpA && WALLISH.has(perpA.type) ? perpA : null;
      const pb = perpB && WALLISH.has(perpB.type) ? perpB : null;
      let ext = 0, cap = false;
      if (!colWall) {
        if (pa || pb) ext = Math.max(pa ? edgeThickness(pa) : 0, pb ? edgeThickness(pb) : 0) / 2;
        else cap = true;
      }
      res.push({ ext, cap, col });
    }
    return res;
  }

  _key(f, orient, a, b) {
    return f * 100000 + (orient === 'V' ? 0 : 50000) + a * 100 + b;
  }

  /**
   * Emit one wall face (a vertical quad) on side `which` of edge e between
   * heights y0..y1 and along-edge range s0..s1 (0..1 = edge, can extend).
   */
  face(e, which, s0, s1, y0, y1, mat, room, shadeFn, floorOverride) {
    const t = edgeThickness(e) / 2;
    const slot = this.lightSlot(room);
    const g = this.geo;
    g.floor = e.f;
    const dir = which === 1 ? -1 : 1; // side 1 is toward the lower coordinate
    let corners, normal, uvs;
    const sh = shadeFn ? [shadeFn(y0), shadeFn(y0), shadeFn(y1), shadeFn(y1)] : 1;
    if (e.orient === 'V') {
      const x = e.a + dir * t;
      const za = e.b + s0, zb = e.b + s1;
      if (dir < 0) { // facing -x: right = +z
        corners = [[x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za]];
        uvs = [[za, y0], [zb, y0], [zb, y1], [za, y1]];
        normal = [-1, 0, 0];
      } else { // facing +x: right = -z
        corners = [[x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb]];
        uvs = [[-zb, y0], [-za, y0], [-za, y1], [-zb, y1]];
        normal = [1, 0, 0];
      }
    } else {
      const z = e.b + dir * t;
      const xa = e.a + s0, xb = e.a + s1;
      if (dir < 0) { // facing -z: right = -x
        corners = [[xb, y0, z], [xa, y0, z], [xa, y1, z], [xb, y1, z]];
        uvs = [[-xb, y0], [-xa, y0], [-xa, y1], [-xb, y1]];
        normal = [0, 0, -1];
      } else { // facing +z: right = +x
        corners = [[xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z]];
        uvs = [[xa, y0], [xb, y0], [xb, y1], [xa, y1]];
        normal = [0, 0, 1];
      }
    }
    g.quad(mat, corners, uvs, normal, sh, slot, floorOverride ?? e.f);
  }

  /** Face perpendicular to the edge at along-position s (jamb / end cap). */
  capFace(e, s, y0, y1, facingPositive, mat, room) {
    const t = edgeThickness(e) / 2;
    const slot = this.lightSlot(room);
    let corners, normal, uvs;
    if (e.orient === 'V') {
      const z = e.b + s;
      const xa = e.a - t, xb = e.a + t;
      if (facingPositive) { corners = [[xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z]]; normal = [0, 0, 1]; }
      else { corners = [[xb, y0, z], [xa, y0, z], [xa, y1, z], [xb, y1, z]]; normal = [0, 0, -1]; }
      uvs = [[0, y0], [t * 2, y0], [t * 2, y1], [0, y1]];
    } else {
      const x = e.a + s;
      const za = e.b - t, zb = e.b + t;
      if (facingPositive) { corners = [[x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb]]; normal = [1, 0, 0]; }
      else { corners = [[x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za]]; normal = [-1, 0, 0]; }
      uvs = [[0, y0], [t * 2, y0], [t * 2, y1], [0, y1]];
    }
    this.geo.quad(mat, corners, uvs, normal, 0.85, slot, e.f);
  }

  /** Horizontal face spanning the wall thickness (sill top / lintel soffit). */
  flatFace(e, s0, s1, y, up, mat, room) {
    const t = edgeThickness(e) / 2;
    const slot = this.lightSlot(room);
    let corners;
    if (e.orient === 'V') {
      const x0 = e.a - t, x1 = e.a + t, z0 = e.b + s0, z1 = e.b + s1;
      corners = up ? [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]] : [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
    } else {
      const x0 = e.a + s0, x1 = e.a + s1, z0 = e.b - t, z1 = e.b + t;
      corners = up ? [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]] : [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
    }
    const uvs = corners.map((c) => [c[0], c[2]]);
    this.geo.quad(mat, corners, uvs, up ? [0, 1, 0] : [0, -1, 0], 0.8, slot, e.f);
  }

  /** Wall face that may be split into wainscot + wallpaper + baseboard. */
  sideSurface(e, which, s0, s1, y0, y1, room, opts = {}) {
    const f = e.f;
    const base = floorBaseY(f);
    const top = base + FLOOR_CEIL[f];
    if (!room) {
      // exterior face (outside) - not visible from the basement
      if (f === 0) return;
      const yb = f === 1 ? Math.min(y0, base - SLAB) : y0;
      this.face(e, which, s0, s1, yb, y1, 'siding', null, null, EXT_FLOOR);
      return;
    }
    const wallMat = this.wallMatFor(room);
    const shade = (y) => {
      const rel = y - base;
      if (rel <= 0.05) return 0.62;
      if (rel >= FLOOR_CEIL[f] - 0.05) return 0.78;
      return 1;
    };
    const wains = WAINSCOT.has(room.key) && !opts.noWainscot;
    const wy = base + 0.95;
    if (wains && y0 < wy && y1 > wy) {
      this.face(e, which, s0, s1, y0, wy, 'woodPanel', room, shade);
      this.face(e, which, s0, s1, wy, y1, wallMat, room, shade);
      // chair rail
      this.trimStrip(e, which, s0, s1, wy - 0.03, wy + 0.03, 0.022, 'trimDark', room);
    } else {
      this.face(e, which, s0, s1, y0, y1, wallMat, room, shade);
    }
    if (!opts.noBaseboard && !NO_BASEBOARD_KINDS.has(room.kind) && y0 <= base + 0.01) {
      this.trimStrip(e, which, s0, s1, base, base + 0.13, 0.018, room.kind === 'bathroom' ? 'porcelain' : 'trimDark', room);
    }
    if (!opts.noCrown && y1 >= top - 0.01 && (WAINSCOT.has(room.key) || room.kind === 'bedroom')) {
      this.trimStrip(e, which, s0, s1, top - 0.1, top, 0.03, 'trimWhite', room);
    }
  }

  /** A thin box running along the face (baseboard, chair rail, crown). */
  trimStrip(e, which, s0, s1, y0, y1, depth, mat, room) {
    const t = edgeThickness(e) / 2;
    const dir = which === 1 ? -1 : 1;
    const off = t + depth / 2;
    const len = s1 - s0;
    if (len <= 0.01) return;
    const mid = (s0 + s1) / 2;
    this.geo.floor = e.f;
    if (e.orient === 'V') {
      this.geo.box(mat, e.a + dir * off, (y0 + y1) / 2, e.b + mid, depth, y1 - y0, len, { room: this.lightSlot(room), faces: dir < 0 ? 'xyYzZ' : 'XyYzZ', ao: 1 });
    } else {
      this.geo.box(mat, e.a + mid, (y0 + y1) / 2, e.b + dir * off, len, y1 - y0, depth, { room: this.lightSlot(room), faces: dir < 0 ? 'zxXyY' : 'ZxXyY', ao: 1 });
    }
  }

  collider(e, s0, s1, y0, y1, kind = 'wall', thick = null) {
    const t = (thick ?? edgeThickness(e)) / 2;
    if (e.orient === 'V') {
      this.colliders.push({ f: e.f, x0: e.a - t, x1: e.a + t, z0: e.b + s0, z1: e.b + s1, y0, y1, kind, sight: kind === 'wall' });
    } else {
      this.colliders.push({ f: e.f, x0: e.a + s0, x1: e.a + s1, z0: e.b - t, z1: e.b + t, y0, y1, kind, sight: kind === 'wall' });
    }
  }

  // ---------------------------------------------------------------- edges
  buildEdge(e) {
    const f = e.f;
    const base = floorBaseY(f);
    const top = base + FLOOR_CEIL[f];
    const bottom = base - SLAB;
    const r1 = this.roomOfSide(e, 1), r2 = this.roomOfSide(e, 2);
    const [end0, end1] = this.endInfo(e);
    const s0 = -end0.ext, s1 = 1 + end1.ext;
    const t = edgeThickness(e);
    // slab edge next to stair holes (railings / open edges above stairs)
    if ((e.r1 === HOLE) !== (e.r2 === HOLE) && (e.type === 'railing' || e.type === 'open')) {
      const holeSide = e.r1 === HOLE ? 1 : 2;
      const other = holeSide === 1 ? r2 : r1;
      if (other) this.face(e, holeSide, 0, 1, bottom, base, 'trimDark', other);
    }
    switch (e.type) {
      case 'wall': {
        this.sideSurface(e, 1, s0, s1, bottom, top, r1);
        this.sideSurface(e, 2, s0, s1, bottom, top, r2);
        if (end0.cap) this.capFace(e, 0, bottom, top, false, this.wallMatFor(r1 || r2) || 'siding', r1 || r2);
        if (end1.cap) this.capFace(e, 1, bottom, top, true, this.wallMatFor(r1 || r2) || 'siding', r1 || r2);
        this.collider(e, -t / 2, 1 + t / 2, bottom, top);
        break;
      }
      case 'window':
      case 'atticwin':
        this.buildWindow(e, r1, r2, s0, s1, bottom, top);
        break;
      case 'railing':
        this.buildRailing(e, r1, r2);
        break;
      case 'open':
        break;
      default:
        this.buildOpening(e, r1, r2, s0, s1, bottom, top);
    }
  }

  buildOpening(e, r1, r2, s0, s1, bottom, top) {
    const base = floorBaseY(e.f);
    const oTop = base + openingTop(e);
    const t = edgeThickness(e);
    // lintel above the opening
    if (oTop < top - 0.01) {
      this.sideSurface(e, 1, s0, s1, oTop, top, r1, { noBaseboard: true, noWainscot: true });
      this.sideSurface(e, 2, s0, s1, oTop, top, r2, { noBaseboard: true, noWainscot: true });
      this.flatFace(e, 0, 1, oTop, false, 'trimDark', r1 || r2);
      this.collider(e, -t / 2, 1 + t / 2, oTop, top, 'lintel');
    }
    // below-floor slab part so there's no gap under the threshold
    this.face(e, 1, s0, s1, bottom, base, 'trimDark', r1 || r2);
    this.face(e, 2, s0, s1, bottom, base, 'trimDark', r2 || r1);
    // jambs where the neighbour is not a continuation of the same opening
    const [end0, end1] = this.endInfo(e);
    const sameGroup = (col) => col && col.type === e.type && (e.type === 'arch' || (col.opening && e.opening && (col.opening.part || e.opening.part)));
    const jambMat = FRAMED.has(e.type) ? 'woodFurnitureDark' : (this.wallMatFor(r1 || r2) || 'siding');
    const jambW = e.type === 'garage' ? 0.02 : e.type === 'tiny' || e.type === 'grate' ? 0.08 : 0.05;
    if (!sameGroup(end0.col)) {
      this.capFace(e, jambW, base, oTop, true, jambMat, r1 || r2);
      this.collider(e, -t / 2, jambW, bottom, top, 'jamb');
      if (jambW > 0.001) {
        this.face(e, 1, 0, jambW, base, oTop, jambMat, r1 || r2);
        this.face(e, 2, 0, jambW, base, oTop, jambMat, r2 || r1);
      }
    }
    if (!sameGroup(end1.col)) {
      this.capFace(e, 1 - jambW, base, oTop, false, jambMat, r1 || r2);
      this.collider(e, 1 - jambW, 1 + t / 2, bottom, top, 'jamb');
      if (jambW > 0.001) {
        this.face(e, 1, 1 - jambW, 1, base, oTop, jambMat, r1 || r2);
        this.face(e, 2, 1 - jambW, 1, base, oTop, jambMat, r2 || r1);
      }
    }
    // threshold strip
    if (e.type === 'door' || e.type === 'front') {
      this.geo.floor = e.f;
      const room = r1 || r2;
      if (e.orient === 'V') this.geo.box('woodFurnitureDark', e.a, base + 0.008, e.b + 0.5, t + 0.04, 0.016, 1 - jambW * 2, { room: this.lightSlot(room), faces: 'YxXzZ', ao: 1 });
      else this.geo.box('woodFurnitureDark', e.a + 0.5, base + 0.008, e.b, 1 - jambW * 2, 0.016, t + 0.04, { room: this.lightSlot(room), faces: 'YxXzZ', ao: 1 });
    }
    // casing trim on both faces
    if (FRAMED.has(e.type)) {
      for (const which of [1, 2]) {
        const room = which === 1 ? r1 : r2;
        if (!room) continue;
        const mat = room.kind === 'bathroom' || room.kind === 'kitchen' ? 'trimWhite' : 'trimDark';
        if (!sameGroup(end0.col)) this.casing(e, which, -0.02, 0.07, base, oTop + 0.07, mat, room);
        if (!sameGroup(end1.col)) this.casing(e, which, 0.93, 1.02, base, oTop + 0.07, mat, room);
        this.casing(e, which, sameGroup(end0.col) ? 0 : -0.02, sameGroup(end1.col) ? 1 : 1.02, oTop, oTop + 0.08, mat, room);
      }
    }
    if (e.type === 'crawl') {
      this.sideSurface(e, 1, s0, s1, oTop, top, r1);
      this.sideSurface(e, 2, s0, s1, oTop, top, r2);
    }
  }

  casing(e, which, s0, s1, y0, y1, mat, room) {
    this.trimStrip(e, which, s0, s1, y0, y1, 0.02, mat, room);
  }

  buildWindow(e, r1, r2, s0, s1, bottom, top) {
    const base = floorBaseY(e.f);
    const [sillR, headR] = windowSpan(e);
    const sill = base + sillR, head = base + headR;
    const t = edgeThickness(e);
    const inside = r1 || r2;
    const insideWhich = r1 ? 1 : 2;
    const outsideWhich = insideWhich === 1 ? 2 : 1;
    // below sill and above header
    this.sideSurface(e, 1, s0, s1, bottom, sill, r1, { noCrown: true });
    this.sideSurface(e, 2, s0, s1, bottom, sill, r2, { noCrown: true });
    this.sideSurface(e, 1, s0, s1, head, top, r1, { noBaseboard: true, noWainscot: true });
    this.sideSurface(e, 2, s0, s1, head, top, r2, { noBaseboard: true, noWainscot: true });
    // reveal
    const jw = 0.08;
    const revealMat = this.wallMatFor(inside) || 'plasterWall';
    this.face(e, 1, 0, jw, sill, head, revealMat, r1 || inside);
    this.face(e, 2, 0, jw, sill, head, revealMat, r2 || inside);
    this.face(e, 1, 1 - jw, 1, sill, head, revealMat, r1 || inside);
    this.face(e, 2, 1 - jw, 1, sill, head, revealMat, r2 || inside);
    this.capFace(e, jw, sill, head, true, 'trimWhite', inside);
    this.capFace(e, 1 - jw, sill, head, false, 'trimWhite', inside);
    this.flatFace(e, jw, 1 - jw, sill, true, 'trimWhite', inside);
    this.flatFace(e, jw, 1 - jw, head, false, 'trimWhite', inside);
    this.collider(e, -t / 2, 1 + t / 2, bottom, top, 'window', t);
    // window sill board (inside)
    this.trimStrip(e, insideWhich, 0.02, 0.98, sill - 0.035, sill, 0.07, 'trimWhite', inside);
    // glass + frame in the middle plane
    const op = e.opening || {};
    const style = e.type === 'atticwin' ? 'boarded-heavy' : op.style || 'clear';
    const w = 1 - jw * 2;
    const h = head - sill;
    const mid = 0.5;
    const g = this.geo;
    g.floor = e.f;
    const slot = this.lightSlot(inside);
    const place = (along, y, sx, sy, sz, mat, extraOff = 0, slotOverride = null) => {
      // along: 0..1 along edge; offset across edge by extraOff (toward outside positive)
      const outSign = outsideWhich === 2 ? 1 : -1;
      const floor = slotOverride === this.grid.outsideLightSlot ? EXT_FLOOR : e.f;
      if (e.orient === 'V') g.box(mat, e.a + extraOff * outSign, y, e.b + along, sz, sy, sx, { room: slotOverride ?? slot, ao: 1, floor });
      else g.box(mat, e.a + along, y, e.b + extraOff * outSign, sx, sy, sz, { room: slotOverride ?? slot, ao: 1, floor });
    };
    const frameMat = 'trimWhite';
    place(mid, sill + 0.03, w, 0.06, 0.08, frameMat);
    place(mid, head - 0.03, w, 0.06, 0.08, frameMat);
    place(jw + 0.03, (sill + head) / 2, 0.06, h, 0.08, frameMat);
    place(1 - jw - 0.03, (sill + head) / 2, 0.06, h, 0.08, frameMat);
    if (style !== 'round') {
      place(mid, (sill + head) / 2, 0.035, h - 0.1, 0.05, frameMat);
      place(mid, sill + h * 0.5, w - 0.1, 0.035, 0.05, frameMat);
    }
    // glass quads (both directions)
    const gm = style === 'frosted' ? 'frosted' : 'glass';
    const gx0 = jw + 0.05, gx1 = 1 - jw - 0.05;
    for (const which of [1, 2]) this.glassQuad(e, which, gx0, gx1, sill + 0.05, head - 0.05, gm, inside);
    // exterior treatment
    const outOff = t / 2 + 0.03;
    const outSlot = this.grid.outsideLightSlot;
    if (style === 'boarded') {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const y = sill + 0.12 + (i / (n - 1)) * (h - 0.24);
        place(mid, y, 1.1, 0.16, 0.03, 'woodPlanks', outOff, outSlot);
      }
      place(mid, (sill + head) / 2, 0.14, h * 1.05, 0.03, 'woodPlanks', outOff + 0.03, outSlot);
    } else if (style === 'barred') {
      for (let i = 0; i < 6; i++) place(0.14 + i * 0.145, (sill + head) / 2, 0.025, h + 0.1, 0.025, 'iron', outOff, outSlot);
      place(mid, sill + 0.1, 0.95, 0.03, 0.03, 'iron', outOff, outSlot);
      place(mid, head - 0.1, 0.95, 0.03, 0.03, 'iron', outOff, outSlot);
    }
    // outer sill
    if (e.f > 0) place(mid, sill - 0.04, 1.05, 0.06, 0.12, 'trimWhite', t / 2 + 0.03, outSlot);
    // record for horror events
    const cx = e.orient === 'V' ? e.a : e.a + 0.5;
    const cz = e.orient === 'V' ? e.b + 0.5 : e.b;
    const outN = e.orient === 'V' ? [outsideWhich === 2 ? 1 : -1, 0] : [0, outsideWhich === 2 ? 1 : -1];
    this.windows.push({
      edge: e, f: e.f, x: cx, z: cz, sill, head, style, room: inside ? inside.index : -1,
      outward: outN, id: `win_${e.f}_${e.orient}${e.a}_${e.b}`,
    });
  }

  glassQuad(e, which, s0, s1, y0, y1, mat, room) {
    const slot = this.lightSlot(room);
    const off = which === 1 ? -0.004 : 0.004;
    let corners, normal;
    if (e.orient === 'V') {
      const x = e.a + off;
      const za = e.b + s0, zb = e.b + s1;
      if (which === 1) { corners = [[x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za]]; normal = [-1, 0, 0]; }
      else { corners = [[x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb]]; normal = [1, 0, 0]; }
    } else {
      const z = e.b + off;
      const xa = e.a + s0, xb = e.a + s1;
      if (which === 1) { corners = [[xb, y0, z], [xa, y0, z], [xa, y1, z], [xb, y1, z]]; normal = [0, 0, -1]; }
      else { corners = [[xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z]]; normal = [0, 0, 1]; }
    }
    this.geo.quad(mat, corners, [[0, 0], [1, 0], [1, 1], [0, 1]], normal, 1, slot, e.f);
  }

  buildRailing(e, r1, r2) {
    const f = e.f;
    const base = floorBaseY(f);
    const g = this.geo;
    g.floor = f;
    const room = (e.r1 === HOLE ? r2 : e.r2 === HOLE ? r1 : r1 || r2);
    const slot = this.lightSlot(room);
    // is this railing beside a stair on this floor? then it follows the ramp
    const c1 = e.c1, c2 = e.c2;
    const st = this.grid.stairAt(f, c1[0], c1[1]) || this.grid.stairAt(f, c2[0], c2[1]);
    const t = WALL_T;
    const heightAt = (s) => {
      if (!st) return base;
      const wx = e.orient === 'V' ? e.a : e.a + s;
      const wz = e.orient === 'V' ? e.b + s : e.b;
      return st.baseY + this.grid.stairT(st, wx, wz) * FLOOR_H;
    };
    const balusters = 7;
    for (let i = 0; i < balusters; i++) {
      const s = (i + 0.5) / balusters;
      const y0 = heightAt(s);
      const hh = 0.92;
      if (e.orient === 'V') g.box('trimWhite', e.a, y0 + hh / 2, e.b + s, 0.04, hh, 0.04, { room: slot, ao: 0.8 });
      else g.box('trimWhite', e.a + s, y0 + hh / 2, e.b, 0.04, hh, 0.04, { room: slot, ao: 0.8 });
    }
    // handrail (inclined if on a stair)
    const yA = heightAt(0) + 0.95, yB = heightAt(1) + 0.95;
    const len = Math.hypot(1, yB - yA);
    const pitch = Math.atan2(yB - yA, 1);
    const box = new THREE.BoxGeometry(len + 0.04, 0.07, 0.09);
    let m;
    if (e.orient === 'V') m = mat4(e.a, (yA + yB) / 2, e.b + 0.5, 0, -Math.PI / 2, 0).multiply(new THREE.Matrix4().makeRotationZ(pitch));
    else m = mat4(e.a + 0.5, (yA + yB) / 2, e.b, 0, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(pitch));
    g.geometry('woodFurnitureDark', box, m, { room: slot, uvScale: 1 });
    // bottom rail on flat railings
    if (!st) {
      if (e.orient === 'V') g.box('woodFurnitureDark', e.a, base + 0.06, e.b + 0.5, 0.08, 0.12, 1.02, { room: slot });
      else g.box('woodFurnitureDark', e.a + 0.5, base + 0.06, e.b, 1.02, 0.12, 0.08, { room: slot });
    }
    // newel posts at free ends
    const [end0, end1] = this.endInfo(e);
    for (const [end, info] of [[0, end0], [1, end1]]) {
      if (info.col && info.col.type === 'railing') continue;
      const y0 = heightAt(end);
      if (e.orient === 'V') g.box('woodFurnitureDark', e.a, y0 + 0.55, e.b + end, 0.11, 1.1, 0.11, { room: slot });
      else g.box('woodFurnitureDark', e.a + end, y0 + 0.55, e.b, 0.11, 1.1, 0.11, { room: slot });
    }
    // physics: tall blocker so nobody steps off a stair or into a stairwell
    this.collider(e, -0.05, 1.05, base - SLAB, base + FLOOR_CEIL[f], 'railing', t);
  }

  // ---------------------------------------------------------------- floors
  buildFloorsAndCeilings(f) {
    const g = this.grid;
    const base = floorBaseY(f);
    const ceil = base + FLOOR_CEIL[f];
    this.geo.floor = f;
    for (let z = 0; z < g.D; z++) {
      for (let x = 0; x < g.W; x++) {
        const r = g.cellRaw(f, x, z);
        if (r < 0) continue;
        const room = g.rooms[r];
        const stairHere = g.stairAt(f, x, z);
        // wall adjacency per side for fake AO
        const wallN = this.isWallish(f, x, z, 'N'), wallS = this.isWallish(f, x, z, 'S');
        const wallW = this.isWallish(f, x, z, 'W'), wallE = this.isWallish(f, x, z, 'E');
        const k = 0.2;
        const nw = 1 - k * (+wallN + +wallW), ne = 1 - k * (+wallN + +wallE);
        const sw = 1 - k * (+wallS + +wallW), se = 1 - k * (+wallS + +wallE);
        if (!stairHere) {
          const fm = room.meta.floor || 'woodFloor';
          // CCW seen from above: (x,z+1) -> (x+1,z+1) -> (x+1,z) -> (x,z)
          this.geo.quad(fm, [[x, base, z + 1], [x + 1, base, z + 1], [x + 1, base, z], [x, base, z]],
            [[x, -(z + 1)], [x + 1, -(z + 1)], [x + 1, -z], [x, -z]], [0, 1, 0], [sw, se, ne, nw], room.lightSlot, f);
          // ceiling (skip under stair holes of the floor above)
          const cm = room.meta.ceil || 'plaster';
          const ck = 0.12;
          const cnw = 1 - ck * (+wallN + +wallW), cne = 1 - ck * (+wallN + +wallE);
          const csw = 1 - ck * (+wallS + +wallW), cse = 1 - ck * (+wallS + +wallE);
          this.geo.quad(cm, [[x, ceil, z], [x + 1, ceil, z], [x + 1, ceil, z + 1], [x, ceil, z + 1]],
            [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], [0, -1, 0], [cnw, cne, cse, csw], room.lightSlot, f);
        }
      }
    }
    // attic rafters
    if (f === 3) {
      for (let x = 9.5; x < 35; x += 1.6) {
        this.geo.box('woodBeams', x, ceil - 0.12, 5.5, 0.14, 0.22, 10, { room: g.roomAtWorld(3, Math.min(34.5, x), 5.5)?.lightSlot ?? 0, floor: 3, ao: 0.8 });
      }
      for (const z of [1.2, 9.8]) {
        for (let x = 9.5; x < 35; x += 1.6) {
          const r = g.roomAtWorld(3, Math.min(34.5, x), z);
          if (!r) continue;
          const m = mat4(x, ceil - 0.8, z, z < 5 ? -0.75 : 0.75, 0, 0);
          this.geo.geometry('woodBeams', new THREE.BoxGeometry(0.12, 1.9, 0.16), m, { room: r.lightSlot, floor: 3 });
        }
      }
    }
    // basement pipes along the hall ceiling
    if (f === 0) {
      const pipeRoom = g.roomByKey['0Q'];
      for (const zz of [1.35, 1.6]) {
        const m = mat4(22, ceil - 0.18, zz, 0, 0, Math.PI / 2);
        this.geo.geometry('rust', new THREE.CylinderGeometry(0.06, 0.06, 13.8, 8), m, { room: pipeRoom.lightSlot, floor: 0 });
      }
    }
  }

  isWallish(f, x, z, side) {
    const e = this.grid.edgeAt(f, x, z, side);
    return !!(e && e.type !== 'open' && e.type !== 'arch' && e.type !== 'railing' && !(e.type === 'door'));
  }

  // ---------------------------------------------------------------- stairs
  buildStair(st) {
    const g = this.geo;
    g.floor = st.lower;
    const room = this.grid.rooms[st.room];
    const slot = room.lightSlot;
    const steps = 16;
    const rise = FLOOR_H / steps;
    const depth = st.len / steps;
    const treadMat = room.meta.floor || 'woodPlain';
    const grand = st.style === 'grand';
    const along = st.along;
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * rise;
      // distance from the bottom edge of the step's centre
      const dCenter = (i + 0.5) * depth;
      let cx, cz, sx, sz;
      const width = st.w - 0.02;
      if (along === 'z') {
        cx = st.x + st.w / 2;
        cz = st.dir === 'S' ? st.z0 + dCenter : st.z1 - dCenter;
        sx = width; sz = depth;
      } else {
        cz = st.z + st.w / 2;
        cx = st.dir === 'E' ? st.x0 + dCenter : st.x1 - dCenter;
        sx = depth; sz = width;
      }
      const y0 = st.baseY - 0.02;
      // riser/body
      g.box(grand ? 'woodFurnitureDark' : 'woodPlanks', cx, (y0 + st.baseY + h - 0.03) / 2, cz, sx, st.baseY + h - 0.03 - y0, sz, { room: slot, faces: 'xXzZ', ao: 0.7 });
      // tread with a small nosing
      const nose = 0.025;
      let tcx = cx, tcz = cz, tsx = sx, tsz = sz;
      if (along === 'z') { tsz += nose; tcz += st.dir === 'S' ? -nose / 2 : nose / 2; }
      else { tsx += nose; tcx += st.dir === 'E' ? -nose / 2 : nose / 2; }
      g.box(grand ? 'woodFurniture' : treadMat, tcx, st.baseY + h - 0.015, tcz, tsx, 0.03, tsz, { room: slot, faces: 'xXyYzZ', ao: 1 });
      if (grand) {
        // carpet runner
        let rx = cx, rz = cz, rsx = sx * 0.7, rsz = sz;
        if (along === 'x') { rsx = sx; rsz = sz * 0.7; }
        g.box('carpetRed', rx, st.baseY + h + 0.002, rz, rsx, 0.01, rsz, { room: slot, faces: 'Y', ao: 1 });
      }
    }
  }
}
