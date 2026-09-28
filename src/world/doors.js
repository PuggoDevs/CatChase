// Doors, secret panels, the bookshelf, the front door, the garage door and
// the tunnel grate. Each Door owns its visuals, animation, lock state,
// barricade and physics collider, and is attached to its grid edge so the
// cat's pathfinding, line of sight and sound occlusion all see its state.
import * as THREE from 'three';
import { DOOR_W, floorBaseY, FLOOR_CEIL } from './layout.js';
import { GeoBuilder } from './geo.js';
import { edgeThickness, openingTop } from './architecture.js';
import { HOLE } from './grid.js';

const MAX_ANGLE = Math.PI * 0.56;

export class Door {
  constructor(world, edge, opening, extraEdges = []) {
    this.world = world;
    this.grid = world.grid;
    this.edge = edge;
    this.edges = [edge, ...extraEdges];
    this.opening = opening;
    this.id = opening.id;
    this.type = edge.type;
    this.f = edge.f;
    this.lock = opening.lock || null;          // null | 'bolt' | itemId
    this.locked = !!opening.lock && opening.lock !== 'bolt';
    this.barricade = 0;
    this.maxBarricade = 3;
    this.barricadeSide = 1;
    this.broken = false;
    this.open = 0;          // 0 closed .. 1 fully open
    this.target = 0;
    this.speed = 1.6;
    this.heavy = !!opening.heavy;
    this.creaky = !!opening.creaky;
    this.discovered = !(this.type === 'secret' || this.type === 'bookshelf');
    this.breakable = this.type === 'door';
    this.escape = ['front', 'garage', 'grate', 'tiny'].includes(this.type);
    this.jammed = this.escape; // escape doors only open through objectives
    this.lastUser = null;
    this.movingNoiseCooldown = 0;
    this.baseY = floorBaseY(edge.f);
    this.top = this.baseY + openingTop(edge);
    this.width = this.edges.length;
    for (const e of this.edges) e.door = this;
    this._computeGeometry();
    this.object = this._buildVisual();
    world.scene.add(this.object);
    this.collider = this._makeCollider();
    world.collision.addDynamic(this.collider);
    this.updateCollider();
  }

  // ------------------------------------------------------------ geometry
  _computeGeometry() {
    const e = this.edge;
    const allEdges = this.edges;
    // span along the edge axis (multi-edge doors)
    let a0 = Infinity, a1 = -Infinity;
    for (const ed of allEdges) {
      const s = ed.orient === 'V' ? ed.b : ed.a;
      a0 = Math.min(a0, s); a1 = Math.max(a1, s + 1);
    }
    this.span = [a0, a1];
    // which side does the door swing into?
    const g = this.grid;
    const r1 = g.roomOfEdgeSide(e, 1), r2 = g.roomOfEdgeSide(e, 2);
    const room1 = r1 >= 0 ? g.rooms[r1] : null, room2 = r2 >= 0 ? g.rooms[r2] : null;
    this.room1 = room1; this.room2 = room2;
    const bad = (side) => {
      const room = side === 1 ? room1 : room2;
      const raw = side === 1 ? e.r1 : e.r2;
      if (!room || raw === HOLE) return 3;
      if (room.kind === 'stairs') return 3;
      if (room.kind === 'hallway' || room.kind === 'foyer') return 1;
      return 0;
    };
    this.swingSide = bad(1) <= bad(2) ? 1 : 2;
    if (this.type === 'secret' && this.id === 'dining_panel') this.swingSide = 2; // into the passage
    // hinge end: prefer the end with a wall on the swing side
    this.hingeEnd = 0;
    const len = a1 - a0;
    this.panelW = this.type === 'tiny' ? 0.62 : this.type === 'grate' ? len - 0.16 : len - 0.1;
    this.panelH = this.top - this.baseY - 0.02;
    this.thick = this.type === 'secret' ? edgeThickness(e) * 0.9 : this.type === 'bookshelf' ? 0.34 : this.type === 'garage' ? 0.06 : 0.05;
  }

  _pivotFrame() {
    const e = this.edge;
    const [a0, a1] = this.span;
    const jamb = this.type === 'tiny' ? (1 - this.panelW) / 2 : (a1 - a0 - this.panelW) / 2;
    let px, pz, theta;
    if (e.orient === 'H') {
      if (this.hingeEnd === 0) { px = a0 + jamb; theta = 0; } else { px = a1 - jamb; theta = Math.PI; }
      pz = e.b;
    } else {
      if (this.hingeEnd === 0) { pz = a0 + jamb; theta = -Math.PI / 2; } else { pz = a1 - jamb; theta = Math.PI / 2; }
      px = e.a;
    }
    // local -Z maps to world direction (-sin t, -cos t)
    const wx = -Math.sin(theta), wz = -Math.cos(theta);
    const minusZSide = e.orient === 'H' ? (wz < 0 ? 1 : 2) : (wx < 0 ? 1 : 2);
    return { px, pz, theta, minusZSide };
  }

  _buildVisual() {
    const lib = this.world.materials;
    const geo = new GeoBuilder(lib);
    const { px, pz, theta, minusZSide } = this._pivotFrame();
    this.minusZSide = minusZSide;
    const slotMinusZ = this._slotFor(minusZSide);
    const slotPlusZ = this._slotFor(minusZSide === 1 ? 2 : 1);
    const W = this.panelW, H = this.panelH, T = this.thick;
    const f = this.f;
    geo.floor = f;
    const body = (mat, cx, cy, cz, sx, sy, sz, faces = 'xXyYzZ') => {
      // split faces by side so each face is lit by the room it faces
      const plus = faces.replace(/[^Z]/g, ''), minus = faces.replace(/[^z]/g, ''), rest = faces.replace(/[zZ]/g, '');
      if (plus) geo.box(mat, cx, cy, cz, sx, sy, sz, { faces: plus, room: slotPlusZ, ao: 1 });
      if (minus) geo.box(mat, cx, cy, cz, sx, sy, sz, { faces: minus, room: slotMinusZ, ao: 1 });
      if (rest) geo.box(mat, cx, cy, cz, sx, sy, sz, { faces: rest, room: slotPlusZ, ao: 1 });
    };
    const room = this.room1 || this.room2;
    const kindMat = (r) => (r && (r.kind === 'bedroom' || r.kind === 'bathroom') ? 'woodPainted' : 'woodFurnitureDark');
    switch (this.type) {
      case 'secret': {
        // looks exactly like the walls on each side
        const matPlus = this._wallMat(minusZSide === 1 ? 2 : 1), matMinus = this._wallMat(minusZSide);
        geo.box(matPlus, W / 2, H / 2, 0, W, H, T, { faces: 'Z', room: slotPlusZ, ao: 1 });
        geo.box(matMinus, W / 2, H / 2, 0, W, H, T, { faces: 'z', room: slotMinusZ, ao: 1 });
        geo.box('trimDark', W / 2, H / 2, 0, W, H, T, { faces: 'xXyY', room: slotPlusZ, ao: 1 });
        break;
      }
      case 'bookshelf': {
        // bookcase on the study side (+Z or -Z depending on orientation)
        const studySide = this.room2 && this.room2.key === '1S' ? 2 : 1;
        const studyIsMinus = studySide === minusZSide;
        const sgn = studyIsMinus ? -1 : 1;
        const sSlot = studyIsMinus ? slotMinusZ : slotPlusZ;
        const pSlot = studyIsMinus ? slotPlusZ : slotMinusZ;
        geo.box('woodFurnitureDark', W / 2, H / 2, 0, W, H, 0.04, { room: pSlot, ao: 1 });
        for (const sx of [0.02, W - 0.02]) geo.box('woodFurnitureDark', sx, H / 2, sgn * 0.15, 0.04, H, 0.3, { room: sSlot, ao: 1 });
        for (let i = 0; i < 5; i++) {
          const y = 0.05 + i * (H - 0.1) / 4;
          geo.box('woodFurnitureDark', W / 2, y, sgn * 0.15, W, 0.03, 0.3, { room: sSlot, ao: 1 });
          if (i < 4) {
            geo.box('books', W / 2, y + 0.2, sgn * 0.13, W - 0.08, 0.36, 0.2, { faces: studyIsMinus ? 'z' : 'Z', room: sSlot, ao: 1, uvScale: 1, uvOffset: [i * 0.23, 0] });
            geo.box('woodFurnitureDark', W / 2, y + 0.2, sgn * 0.13, W - 0.08, 0.36, 0.2, { faces: 'yY', room: sSlot, ao: 1 });
          }
        }
        geo.box('woodFurnitureDark', W / 2, H - 0.02, sgn * 0.15, W, 0.04, 0.32, { room: sSlot });
        // the red book that opens it
        geo.box('paintRed', W * 0.62, 0.05 + 2 * (H - 0.1) / 4 + 0.19, sgn * 0.27, 0.05, 0.3, 0.2, { room: sSlot, ao: 1 });
        break;
      }
      case 'front': {
        // double doors: two leaves, handled as one panel with a split line
        for (const half of [0, 1]) {
          const x0 = half * (W / 2);
          body('woodFurnitureDark', x0 + W / 4, H / 2, 0, W / 2 - 0.01, H, T);
          for (const zs of [1, -1]) {
            geo.box('woodFurnitureDark', x0 + W / 4, H * 0.3, zs * (T / 2 + 0.008), W / 2 - 0.2, H * 0.4, 0.016, { room: zs > 0 ? slotPlusZ : slotMinusZ });
            geo.box('frosted', x0 + W / 4, H * 0.75, zs * (T / 2 + 0.002), W / 2 - 0.25, H * 0.3, 0.004, { room: zs > 0 ? slotPlusZ : slotMinusZ });
          }
        }
        for (const zs of [1, -1]) geo.box('brass', W / 2 + (zs > 0 ? -0.08 : 0.08), H * 0.48, zs * (T / 2 + 0.03), 0.04, 0.22, 0.03, { room: zs > 0 ? slotPlusZ : slotMinusZ });
        break;
      }
      case 'garage': {
        for (let i = 0; i < 6; i++) {
          const y = (i + 0.5) * (H / 6);
          body('metal', W / 2, y, 0, W, H / 6 - 0.012, T);
        }
        break;
      }
      case 'grate': {
        for (let i = 0; i <= 8; i++) geo.box('iron', 0.05 + i * (W - 0.1) / 8, H / 2, 0, 0.035, H, 0.035, { room: slotPlusZ, ao: 1 });
        for (const y of [0.1, H / 2, H - 0.1]) geo.box('iron', W / 2, y, 0, W, 0.05, 0.05, { room: slotPlusZ, ao: 1 });
        for (const x of [0.12, W - 0.12]) for (const y of [0.15, H - 0.15]) geo.box('brass', x, y, 0.04, 0.06, 0.06, 0.03, { room: slotPlusZ, ao: 1 });
        break;
      }
      case 'tiny': {
        body('woodPainted', W / 2, H / 2, 0, W, H, T);
        geo.box('brass', W - 0.08, H * 0.5, T / 2 + 0.02, 0.04, 0.04, 0.04, { room: slotPlusZ });
        break;
      }
      default: {
        const heavy = this.heavy;
        const mat = heavy ? 'woodPlanks' : kindMat(room);
        body(mat, W / 2, H / 2, 0, W, H, T);
        if (heavy) {
          for (const zs of [1, -1]) {
            for (const y of [0.35, H - 0.4]) geo.box('iron', W / 2, y, zs * (T / 2 + 0.006), W - 0.04, 0.07, 0.012, { room: zs > 0 ? slotPlusZ : slotMinusZ });
          }
        } else if (this.opening.glass) {
          for (const zs of [1, -1]) {
            geo.box('glass', W / 2, H * 0.68, zs * (T / 2 + 0.002), W - 0.3, H * 0.45, 0.004, { room: zs > 0 ? slotPlusZ : slotMinusZ });
            geo.box(mat, W / 2, H * 0.22, zs * (T / 2 + 0.008), W - 0.3, H * 0.28, 0.016, { room: zs > 0 ? slotPlusZ : slotMinusZ });
          }
        } else {
          // raised panels
          for (const zs of [1, -1]) {
            for (const [cx, cy, h] of [[0.25, 0.55, 0.7], [W - 0.25, 0.55, 0.7], [0.25, 1.45, 0.85], [W - 0.25, 1.45, 0.85]]) {
              geo.box(mat, cx, cy, zs * (T / 2 + 0.007), 0.3, h, 0.014, { room: zs > 0 ? slotPlusZ : slotMinusZ });
            }
          }
        }
        // knobs
        for (const zs of [1, -1]) {
          const m = new THREE.Matrix4().makeTranslation(W - 0.075, 0.98, zs * (T / 2 + 0.035));
          geo.geometry('brass', new THREE.SphereGeometry(0.028, 10, 8), m, { room: zs > 0 ? slotPlusZ : slotMinusZ });
          geo.box('brass', W - 0.075, 0.98, zs * (T / 2 + 0.015), 0.012, 0.012, 0.03, { room: zs > 0 ? slotPlusZ : slotMinusZ });
          if (this.lock) geo.box('brass', W - 0.075, 1.12, zs * (T / 2 + 0.006), 0.035, 0.05, 0.012, { room: zs > 0 ? slotPlusZ : slotMinusZ });
        }
        for (const y of [0.25, H - 0.3]) geo.box('brass', 0.012, y, 0, 0.025, 0.1, T + 0.01, { room: slotPlusZ });
      }
    }
    const panel = geo.buildGroup('door:' + this.id);
    const pivot = new THREE.Group();
    pivot.name = 'doorPivot:' + this.id;
    pivot.position.set(px, this.baseY + 0.01, pz);
    pivot.rotation.y = theta;
    this.baseTheta = theta;
    pivot.add(panel);
    this.panel = panel;
    this.pivot = pivot;
    // barricade planks (hidden until used), built on both sides
    this.barricadeGroups = {};
    for (const side of [1, 2]) {
      const slot = this._slotFor(side);
      const zs = side === minusZSide ? -1 : 1;
      const d = zs * (edgeThickness(this.edge) / 2 + 0.05);
      const planks = [[0.5, 1.45, 0.35], [0.5, 0.75, -0.3], [0.5, 1.1, 0.02]];
      // one group per plank so they can fall away one at a time
      const grp = new THREE.Group();
      grp.name = 'barricade';
      planks.forEach(([cx, cy, rot], i) => {
        const bg = new GeoBuilder(lib);
        bg.floor = f;
        const m = new THREE.Matrix4().makeTranslation(cx * this.panelW, cy, d + zs * i * 0.012).multiply(new THREE.Matrix4().makeRotationZ(rot));
        bg.geometry('woodPlanks', new THREE.BoxGeometry(1.25, 0.16, 0.035), m, { room: slot });
        grp.add(bg.buildGroup('plank' + i));
      });
      grp.visible = false;
      // barricade is attached to the frame, not to the swinging panel
      const holder = new THREE.Group();
      holder.position.copy(pivot.position);
      holder.rotation.y = theta;
      holder.add(grp);
      this.barricadeGroups[side] = { holder, grp };
    }
    const root = new THREE.Group();
    root.add(pivot);
    root.add(this.barricadeGroups[1].holder);
    root.add(this.barricadeGroups[2].holder);
    root.userData.floor = f;
    root.userData.door = this;
    return root;
  }

  _slotFor(side) {
    const room = side === 1 ? this.room1 : this.room2;
    return room ? room.lightSlot : this.grid.outsideLightSlot;
  }

  _wallMat(side) {
    const room = side === 1 ? this.room1 : this.room2;
    return room ? room.meta.wall || 'plasterWall' : 'siding';
  }

  _makeCollider() {
    const e = this.edge;
    const [a0, a1] = this.span;
    const t = Math.max(0.08, this.thick);
    const c = { f: this.f, y0: this.baseY - 0.3, y1: this.top, kind: 'door', door: this, active: true, sight: true };
    if (e.orient === 'H') { c.x0 = a0; c.x1 = a1; c.z0 = e.b - t / 2; c.z1 = e.b + t / 2; }
    else { c.x0 = e.a - t / 2; c.x1 = e.a + t / 2; c.z0 = a0; c.z1 = a1; }
    return c;
  }

  // ------------------------------------------------------------ state
  get center() {
    const e = this.edge;
    const [a0, a1] = this.span;
    const mid = (a0 + a1) / 2;
    return e.orient === 'H' ? { x: mid, y: this.baseY + 1, z: e.b } : { x: e.a, y: this.baseY + 1, z: mid };
  }

  /** Point in front of the door on the given side (for agents to stand on). */
  approachPoint(side, dist = 0.7) {
    const c = this.center;
    const s = side === 1 ? -1 : 1;
    return this.edge.orient === 'H' ? { x: c.x, z: c.z + s * dist } : { x: c.x + s * dist, z: c.z };
  }

  /** Which side of the door (1 or 2) is world position (x,z) on? */
  sideOf(x, z) {
    const e = this.edge;
    return e.orient === 'H' ? (z < e.b ? 1 : 2) : (x < e.a ? 1 : 2);
  }

  isPassable() { return this.broken || (this.open > 0.72 && !this.escapeClosed()); }
  escapeClosed() { return false; }
  blocksSight() { return !this.broken && this.open < 0.25; }
  isClosed() { return !this.broken && this.open < 0.05 && this.target === 0; }

  canBeOpenedBy(opts = {}) {
    if (this.broken) return true;
    if (this.jammed) return false;
    if (!this.discovered && !opts.cat) return false;
    if (this.barricade > 0) return false;
    if (this.locked) return false;
    if (this.type === 'secret' && opts.cat && !this.discovered && this.id === 'ellie_secret') return true;
    return true;
  }

  /** Begin opening. mode: 'normal' | 'quiet' | 'burst' */
  openDoor(by, mode = 'normal') {
    if (this.broken || this.jammed || this.barricade > 0 || this.locked) return false;
    this.target = 1;
    this.lastUser = by;
    this.speed = mode === 'quiet' ? 0.32 : mode === 'burst' ? 5.5 : this.heavy ? 1.1 : 1.6;
    this.mode = mode;
    if (this.open < 0.05) {
      this.world.events.emit('door', { door: this, action: mode === 'burst' ? 'burst' : mode === 'quiet' ? 'quietOpen' : 'open', by });
    }
    return true;
  }

  closeDoor(by, mode = 'normal') {
    if (this.broken) return false;
    this.target = 0;
    this.lastUser = by;
    this.mode = mode;
    this.speed = mode === 'slam' ? 7 : mode === 'quiet' ? 0.35 : this.heavy ? 1.2 : 1.8;
    this.world.events.emit('door', { door: this, action: mode === 'slam' ? 'slamStart' : mode === 'quiet' ? 'quietClose' : 'close', by });
    return true;
  }

  toggleLock(by) {
    if (!this.lock || this.broken || this.open > 0.05) return false;
    this.locked = !this.locked;
    this.world.events.emit('door', { door: this, action: this.locked ? 'lock' : 'unlock', by });
    return true;
  }

  addBarricade(side) {
    if (this.broken || this.open > 0.05) return false;
    if (this.barricade > 0 && side !== this.barricadeSide) return false;
    this.barricadeSide = side;
    this.barricade = Math.min(this.maxBarricade, this.barricade + 3);
    this.target = 0;
    this._refreshBarricade();
    this.world.events.emit('door', { door: this, action: 'barricade', by: 'player' });
    return true;
  }

  /** The cat (or anyone) hits the door. Returns true when it gives way. */
  hit(power = 1) {
    if (this.broken) return true;
    if (this.barricade > 0) {
      this.barricade = Math.max(0, this.barricade - power);
      this._refreshBarricade();
      this.world.events.emit('door', { door: this, action: this.barricade > 0 ? 'bang' : 'barricadeBreak', by: 'cat' });
      if (this.barricade > 0) return false;
      if (!this.locked) return true;
    }
    if (this.locked) {
      this.lockHp = (this.lockHp ?? 4) - power;
      this.world.events.emit('door', { door: this, action: 'bang', by: 'cat' });
      if (this.lockHp <= 0) {
        this.breakDown();
        return true;
      }
      return false;
    }
    return true;
  }

  breakDown() {
    this.broken = true;
    this.locked = false;
    this.barricade = 0;
    this._refreshBarricade();
    this.target = 1;
    this.open = Math.max(this.open, 0.3);
    this.speed = 8;
    this.world.events.emit('door', { door: this, action: 'break', by: 'cat' });
  }

  _refreshBarricade() {
    for (const side of [1, 2]) {
      const b = this.barricadeGroups[side];
      b.grp.visible = this.barricade > 0 && side === this.barricadeSide;
      if (b.grp.visible) {
        // planks come away one by one as it batters through, the rest knocked askew
        const left = Math.ceil(this.barricade);
        b.grp.children.forEach((plank, i) => { plank.visible = i < left; });
        b.grp.rotation.z = (this.maxBarricade - this.barricade) * 0.04;
      }
    }
  }

  updateCollider() {
    const c = this.collider;
    c.active = !this.broken && this.open < 0.45;
    c.sight = this.blocksSight();
  }

  update(dt) {
    if (this.open !== this.target) {
      const prev = this.open;
      const d = this.target - this.open;
      const step = Math.sign(d) * Math.min(Math.abs(d), this.speed * dt);
      this.open += step;
      if (this.type === 'garage') {
        this.pivot.position.y = this.baseY + 0.01 + this.open * (this.panelH - 0.2);
      } else {
        const sign = this.swingSide === this.minusZSide ? 1 : -1;
        const eased = this.open;
        this.pivot.rotation.y = this.baseTheta + sign * eased * MAX_ANGLE * (this.broken ? 1.12 : 1);
        if (this.broken) this.pivot.rotation.z = Math.min(0.12, this.open * 0.12);
      }
      if (prev > 0 && this.open === 0) {
        this.world.events.emit('door', { door: this, action: this.mode === 'slam' ? 'slam' : this.mode === 'quiet' ? 'quietShut' : 'shut', by: this.lastUser });
      }
      this.updateCollider();
    }
  }

  /** A door slowly creaking open by itself (horror event). */
  ghostOpen(amount = 0.35) {
    if (this.locked || this.barricade || this.broken || this.jammed || !this.discovered) return false;
    this.target = amount;
    this.speed = 0.12;
    this.mode = 'quiet';
    this.world.events.emit('door', { door: this, action: 'ghostCreak', by: 'house' });
    return true;
  }

  get ceilY() { return this.baseY + FLOOR_CEIL[this.f]; }
  get doorWidth() { return DOOR_W; }
}
