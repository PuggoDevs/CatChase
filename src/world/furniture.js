// Procedural furniture. Each builder draws static parts into the shared
// GeoBuilder (so they get merged), and registers colliders, hiding spots,
// item spawn slots, interactables and animated parts with the world.
//
// Local frame: the piece's front faces local +Z, x is its width, y is up
// from the floor. Placement rotates that frame to face N/S/E/W (or any yaw).
import * as THREE from 'three';
import { GeoBuilder, mat4 } from './geo.js';
import { floorBaseY } from './layout.js';

export const FACING = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** A double-sided folded cloth panel (curtains, shower curtain). */
export function clothGeometry(W, H, folds, depth) {
  const seg = folds * 6;
  const pos = [], nor = [], uv = [], idx = [];
  for (let side = 0; side < 2; side++) {
    const base = pos.length / 3;
    const off = side ? -0.004 : 0.004;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const x = -W / 2 + u * W;
        const a = u * folds * Math.PI * 2;
        const z = Math.sin(a) * depth + off;
        const dz = Math.cos(a) * depth * folds * Math.PI * 2 / W;
        const nl = Math.hypot(dz, 1);
        const sgn = side ? -1 : 1;
        pos.push(x, -H / 2 + j * H, z);
        nor.push((-dz / nl) * sgn, 0, (1 / nl) * sgn);
        uv.push(x, -H / 2 + j * H);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i, b = base + i + 1, c2 = base + seg + 1 + i, d = base + seg + 2 + i;
      if (side === 0) idx.push(a, b, d, a, d, c2); else idx.push(a, d, b, a, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class FurnitureContext {
  constructor(world, room, x, z, facing, opts = {}) {
    this.world = world;
    this.room = room;
    this.f = room.floor;
    this.baseY = floorBaseY(this.f) + (opts.y || 0);
    this.x = x; this.z = z;
    this.ry = typeof facing === 'number' ? facing : FACING[facing || 'S'];
    this.cos = Math.cos(this.ry); this.sin = Math.sin(this.ry);
    this.geo = world.staticGeo;
    this.slot = room.lightSlot;
    this.opts = opts;
    this.id = opts.id || `${opts.type || 'f'}_${room.key}_${Math.round(x * 10)}_${Math.round(z * 10)}`;
  }

  /** local -> world (x,z) */
  w(lx, lz) {
    return [this.x + lx * this.cos + lz * this.sin, this.z - lx * this.sin + lz * this.cos];
  }

  wv(lx, ly, lz) {
    const [x, z] = this.w(lx, lz);
    return V3(x, this.baseY + ly, z);
  }

  /** world yaw that points along local direction angle a (0 = +Z) */
  yaw(a = 0) { return this.ry + a; }

  box(mat, lx, ly, lz, sx, sy, sz, o = {}) {
    const [x, z] = this.w(lx, lz);
    this.geo.floor = this.f;
    this.geo.box(mat, x, this.baseY + ly, z, sx, sy, sz, { room: this.slot, ...o, ry: this.ry + (o.ry || 0) });
  }

  /** arbitrary geometry, local transform (lx,ly,lz, rx,ry,rz, scale) */
  geom(mat, g, lx, ly, lz, rx = 0, ry = 0, rz = 0, s = 1, o = {}) {
    const [x, z] = this.w(lx, lz);
    const sv = Array.isArray(s) ? s : [s, s, s];
    const m = mat4(x, this.baseY + ly, z, rx, this.ry + ry, rz, sv[0], sv[1], sv[2]);
    this.geo.floor = this.f;
    this.geo.geometry(mat, g, m, { room: this.slot, ...o });
  }

  cyl(mat, lx, ly, lz, r0, r1, h, seg = 12, o = {}) {
    this.geom(mat, new THREE.CylinderGeometry(r0, r1, h, seg), lx, ly, lz, o.rx || 0, o.ry || 0, o.rz || 0, 1, o);
  }

  sphere(mat, lx, ly, lz, r, sy = 1, o = {}) {
    this.geom(mat, new THREE.SphereGeometry(r, 12, 9), lx, ly, lz, 0, 0, 0, [1, sy, 1], o);
  }

  /** Axis-aligned world collider from a local rectangle (rotation-safe). */
  collider(lx0, lz0, lx1, lz1, y0, y1, o = {}) {
    const pts = [this.w(lx0, lz0), this.w(lx1, lz0), this.w(lx0, lz1), this.w(lx1, lz1)];
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const c = {
      f: this.f, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs),
      y0: this.baseY + y0, y1: this.baseY + y1, kind: o.kind || 'furniture', sight: !!o.sight, active: true,
      nav: o.nav !== false && y1 - y0 > 0.3 && y0 < 0.4, furniture: this.id,
    };
    this.world.collision.addStatic(c);
    this.world.furnitureColliders.push(c);
    return c;
  }

  itemSlot(lx, ly, lz, o = {}) {
    const p = this.wv(lx, ly, lz);
    this.world.itemSlots.push({ f: this.f, room: this.room.index, x: p.x, y: p.y, z: p.z, yaw: this.ry, surface: o.surface || 'table', tags: o.tags || [], furniture: this.id });
  }

  /** A movable sub-model (door, lid...) built with its own GeoBuilder. */
  part(buildFn, lx, ly, lz, name = 'part') {
    const g = new GeoBuilder(this.world.materials);
    g.floor = this.f;
    g.room = this.slot;
    buildFn(g, this.slot);
    const grp = g.buildGroup(name);
    const holder = new THREE.Group();
    const p = this.wv(lx, ly, lz);
    holder.position.copy(p);
    holder.rotation.y = this.ry;
    holder.add(grp);
    holder.userData.floor = this.f;
    this.world.addDynamicObject(holder, this.f);
    return { holder, grp };
  }

  hideSpot(spec) {
    const entry = this.wv(spec.entry[0], 0, spec.entry[1]);
    const inside = this.wv(spec.inside[0], spec.inside[1], spec.inside[2]);
    const exit = spec.exit ? this.wv(spec.exit[0], 0, spec.exit[1]) : entry.clone();
    const look = this.wv(spec.look[0], spec.look[1], spec.look[2]);
    const spot = {
      id: this.id + ':' + spec.type,
      type: spec.type, f: this.f, room: this.room.index, roomKey: this.room.key,
      entry, inside, exit, look,
      yaw: Math.atan2(look.x - inside.x, look.z - inside.z),
      yawRange: spec.yawRange ?? 0.9, pitchMin: spec.pitchMin ?? -0.5, pitchMax: spec.pitchMax ?? 0.4,
      concealment: spec.concealment ?? 1,
      setOpen: spec.setOpen || (() => {}),
      openAmount: 0,
      furniture: this.id,
      overlay: spec.overlay || null,
      uses: 0,
    };
    this.world.hidingSpots.push(spot);
    return spot;
  }

  interact(spec) {
    const p = spec.pos ? this.wv(spec.pos[0], spec.pos[1], spec.pos[2]) : this.wv(0, 1, 0);
    const it = { id: spec.id || this.id, f: this.f, room: this.room.index, radius: spec.radius ?? 0.6, ...spec, pos: p };
    this.world.interactables.push(it);
    return it;
  }
}

// =====================================================================
// Builders. Signature: (c: FurnitureContext, o: options) => void
// =====================================================================
const B = {};

B.rug = (c, o) => {
  const w = o.w || 2.4, d = o.d || 1.6;
  c.box(o.mat || 'carpetRed', 0, 0.006, 0, w, 0.012, d, { faces: 'Y', ao: 1 });
  c.box('trimDark', 0, 0.004, 0, w + 0.06, 0.008, d + 0.06, { faces: 'Y', ao: 1 });
};

B.bed = (c, o) => {
  const size = o.size || 'double';
  const W = size === 'double' ? 1.6 : size === 'child' ? 0.95 : 1.0;
  const L = size === 'child' ? 1.75 : 2.05;
  const wood = o.wood || 'woodFurnitureDark';
  const h0 = 0.3, frameH = 0.16;
  // legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box(wood, sx * (W / 2 - 0.05), h0 / 2, sz * (L / 2 - 0.05), 0.08, h0, 0.08);
  // frame + slats underside
  c.box(wood, 0, h0 + frameH / 2, 0, W, frameH, L);
  // mattress
  c.box('mattress', 0, h0 + frameH + 0.1, 0.02, W - 0.06, 0.2, L - 0.12, { ao: 0.8 });
  // blanket draped over the foot two thirds
  const blanket = o.blanket || (size === 'child' ? 'fabricPink' : 'fabricRed');
  c.box(blanket, 0, h0 + frameH + 0.215, 0.25, W + 0.04, 0.05, L * 0.7, { ao: 0.9 });
  c.box(blanket, 0, h0 + 0.1, 0.25, W + 0.06, 0.34, 0.03, { faces: 'xXzZ', ao: 0.9, uvScale: 1 });
  c.box(blanket, W / 2 + 0.03, h0 + 0.12, 0.25, 0.02, 0.36, L * 0.7, { faces: 'X', ao: 0.9 });
  c.box(blanket, -W / 2 - 0.03, h0 + 0.12, 0.25, 0.02, 0.36, L * 0.7, { faces: 'x', ao: 0.9 });
  // pillows
  const pillows = size === 'double' ? [-0.38, 0.38] : [0];
  for (const px of pillows) c.box('pillow', px, h0 + frameH + 0.26, -L / 2 + 0.3, size === 'double' ? 0.62 : 0.6, 0.13, 0.36, { ao: 0.85 });
  // headboard / footboard
  const hb = size === 'child' ? 0.95 : 1.25;
  c.box(wood, 0, hb / 2, -L / 2 - 0.03, W + 0.08, hb, 0.07);
  c.box(wood, 0, 0.42, L / 2 + 0.03, W + 0.08, 0.84 - 0.2, 0.06);
  for (const sx of [-1, 1]) {
    c.box(wood, sx * (W / 2 + 0.02), hb / 2 + 0.05, -L / 2 - 0.03, 0.09, hb + 0.1, 0.09);
    c.box(wood, sx * (W / 2 + 0.02), 0.5, L / 2 + 0.03, 0.09, 1.0, 0.09);
  }
  c.collider(-W / 2 - 0.05, -L / 2 - 0.07, W / 2 + 0.05, L / 2 + 0.07, 0, 0.62);
  c.collider(-W / 2 - 0.05, -L / 2 - 0.07, W / 2 + 0.05, -L / 2 + 0.01, 0, hb);
  c.itemSlot(W * 0.22, h0 + frameH + 0.25, L * 0.15, { surface: 'bed' });
  if (o.hide !== false) {
    const side = o.hideSide || 1; // which long side you slide under from
    c.hideSpot({
      type: 'bed', entry: [side * (W / 2 + 0.55), 0.1], inside: [side * 0.12, 0.16, 0.15], exit: [side * (W / 2 + 0.55), 0.1],
      look: [side * 3, 0.1, 0.15], yawRange: 1.25, pitchMin: -0.15, pitchMax: 0.25, concealment: 0.85,
    });
  }
};

B.wardrobe = (c, o) => {
  const W = o.w || 1.1, D = 0.62, H = 2.05;
  const wood = o.wood || 'woodFurnitureDark';
  c.box(wood, 0, H / 2, -D / 2 + 0.02, W, H, 0.04); // back
  c.box(wood, -W / 2 + 0.02, H / 2, 0, 0.04, H, D); // sides
  c.box(wood, W / 2 - 0.02, H / 2, 0, 0.04, H, D);
  c.box(wood, 0, H - 0.02, 0, W, 0.05, D);
  c.box(wood, 0, 0.05, 0, W, 0.1, D);
  c.box(wood, 0, H + 0.04, 0.01, W + 0.08, 0.08, D + 0.06); // cornice
  c.box('void', 0, H / 2, 0, W - 0.1, H - 0.14, D - 0.1, { faces: 'yYz', ao: 0.5 }); // dark interior
  c.box(wood, 0, 1.75, 0, W - 0.08, 0.03, 0.03); // rail
  // hanging clothes shapes inside
  for (let i = 0; i < 3; i++) c.box(o.clothes || 'fabricBeige', -0.3 + i * 0.28, 1.25, -0.02, 0.05, 0.9, 0.42, { ao: 0.5 });
  // louvred doors (two leaves, animated)
  const doors = [];
  for (const side of [-1, 1]) {
    const leafW = W / 2 - 0.03;
    const hingeX = side * (W / 2 - 0.02);
    const p = c.part((g, slot) => {
      // leaf built extending from hinge toward centre (local -side*x)
      const cx = -side * leafW / 2;
      g.box(wood, cx, H / 2 - 0.02, 0, leafW, 0.1, 0.035, { room: slot, ao: 1 });
      g.box(wood, cx, 0.12, 0, leafW, 0.12, 0.035, { room: slot, ao: 1 });
      g.box(wood, cx, H - 0.1, 0, leafW, 0.12, 0.035, { room: slot, ao: 1 });
      g.box(wood, -side * 0.03, H / 2, 0, 0.06, H - 0.1, 0.035, { room: slot, ao: 1 });
      g.box(wood, -side * (leafW - 0.03), H / 2, 0, 0.06, H - 0.1, 0.035, { room: slot, ao: 1 });
      for (let i = 0; i < 22; i++) {
        const y = 0.22 + i * ((H - 0.45) / 22);
        const m = new THREE.Matrix4().makeTranslation(cx, y, 0).multiply(new THREE.Matrix4().makeRotationX(-0.6));
        g.geometry(wood, new THREE.BoxGeometry(leafW - 0.1, 0.055, 0.012), m, { room: slot });
      }
      g.box('brass', -side * (leafW - 0.06), 1.05, 0.03, 0.02, 0.1, 0.02, { room: slot });
    }, hingeX, 0.01, D / 2 - 0.01, 'wardrobeDoor');
    doors.push({ p, side });
  }
  const setOpen = (t) => {
    for (const d of doors) d.p.holder.rotation.y = c.ry + d.side * t * 1.9;
  };
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H + 0.08, { sight: true });
  if (o.hide !== false) {
    c.hideSpot({
      type: 'wardrobe', entry: [0, D / 2 + 0.55], inside: [0, 1.5, -0.02], exit: [0, D / 2 + 0.55],
      look: [0, 1.4, 3], yawRange: 0.55, pitchMin: -0.45, pitchMax: 0.2, concealment: 1, setOpen,
    });
  }
  return { setOpen };
};

B.dresser = (c, o) => {
  const W = o.w || 1.2, D = 0.5, H = 0.88;
  const wood = o.wood || 'woodFurniture';
  c.box(wood, 0, H / 2 + 0.05, 0, W, H - 0.1, D);
  c.box(wood, 0, H + 0.02, 0, W + 0.04, 0.04, D + 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box(wood, sx * (W / 2 - 0.05), 0.04, sz * (D / 2 - 0.05), 0.06, 0.08, 0.06);
  for (let i = 0; i < 3; i++) {
    const y = 0.2 + i * 0.25;
    c.box(wood, 0, y, D / 2 + 0.008, W - 0.08, 0.2, 0.016);
    for (const sx of [-0.28, 0.28]) c.box('brass', sx * W, y, D / 2 + 0.03, 0.08, 0.02, 0.025);
  }
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H + 0.04);
  c.itemSlot(-W * 0.25, H + 0.04, 0.05);
  c.itemSlot(W * 0.25, H + 0.04, 0.05);
  if (o.mirror) {
    c.box(wood, 0, H + 0.55, -D / 2 + 0.03, 0.8, 0.9, 0.04);
    c.box('crtGlass', 0, H + 0.55, -D / 2 + 0.06, 0.66, 0.76, 0.01, { faces: 'Z' });
  }
};

B.nightstand = (c, o) => {
  const W = 0.46, D = 0.4, H = 0.58;
  const wood = o.wood || 'woodFurniture';
  c.box(wood, 0, H / 2, 0, W, H, D);
  c.box(wood, 0, H + 0.015, 0, W + 0.03, 0.03, D + 0.03);
  c.box(wood, 0, H - 0.14, D / 2 + 0.008, W - 0.06, 0.16, 0.016);
  c.box('brass', 0, H - 0.14, D / 2 + 0.025, 0.05, 0.02, 0.02);
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H + 0.03);
  c.itemSlot(0.08, H + 0.03, 0.02);
};

B.table = (c, o) => {
  const W = o.w || 1.4, D = o.d || 0.9, H = o.h || 0.76;
  const wood = o.wood || 'woodFurniture';
  c.box(wood, 0, H - 0.025, 0, W, 0.05, D);
  c.box(wood, 0, H - 0.1, 0, W - 0.12, 0.1, D - 0.12, { faces: 'xXzZy' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    c.box(wood, sx * (W / 2 - 0.08), (H - 0.05) / 2, sz * (D / 2 - 0.08), 0.07, H - 0.05, 0.07);
    c.collider(sx * (W / 2 - 0.08) - 0.04, sz * (D / 2 - 0.08) - 0.04, sx * (W / 2 - 0.08) + 0.04, sz * (D / 2 - 0.08) + 0.04, 0, H);
  }
  // table top: crawlable underneath
  c.collider(-W / 2, -D / 2, W / 2, D / 2, H - 0.16, H, { nav: false });
  const n = Math.max(1, Math.floor(W / 0.7));
  for (let i = 0; i < n; i++) c.itemSlot(-W / 2 + (i + 0.5) * (W / n), H, (i % 2 ? 0.15 : -0.15) * (D / 0.9));
  if (o.cloth) c.box('linen', 0, H + 0.003, 0, W * 0.9, 0.006, D * 0.9, { faces: 'Y', ao: 1 });
};

B.chair = (c, o) => {
  const wood = o.wood || 'woodFurnitureDark';
  const seat = o.seat || 'fabricRed';
  c.box(wood, 0, 0.44, 0, 0.46, 0.05, 0.44);
  c.box(seat, 0, 0.475, 0.01, 0.42, 0.03, 0.4, { faces: 'Y' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box(wood, sx * 0.19, 0.21, sz * 0.18, 0.04, 0.42, 0.04);
  c.box(wood, 0, 0.72, -0.2, 0.44, 0.5, 0.04);
  if (o.tipped) return;
  c.collider(-0.23, -0.23, 0.23, 0.22, 0, 0.95);
};

B.armchair = (c, o) => {
  const fab = o.mat || 'fabricGreen';
  c.box(fab, 0, 0.24, 0.02, 0.84, 0.3, 0.8);
  c.box(fab, 0, 0.44, 0.06, 0.64, 0.12, 0.66, { ao: 0.9 });
  c.box(fab, 0, 0.7, -0.33, 0.84, 0.75, 0.2);
  for (const sx of [-1, 1]) c.box(fab, sx * 0.37, 0.52, 0.02, 0.14, 0.34, 0.8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box('woodFurnitureDark', sx * 0.36, 0.045, sz * 0.34, 0.06, 0.09, 0.06);
  c.collider(-0.44, -0.44, 0.44, 0.42, 0, 1.05);
};

B.sofa = (c, o) => {
  const W = o.w || 2.1;
  const fab = o.mat || 'fabricRed';
  c.box(fab, 0, 0.24, 0.02, W, 0.3, 0.86);
  for (let i = 0; i < 3; i++) c.box(fab, -W / 3 + i * (W / 3), 0.44, 0.08, W / 3 - 0.06, 0.12, 0.64, { ao: 0.9 });
  c.box(fab, 0, 0.66, -0.34, W, 0.72, 0.2);
  for (const sx of [-1, 1]) c.box(fab, sx * (W / 2 - 0.08), 0.5, 0.02, 0.16, 0.34, 0.86);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box('woodFurnitureDark', sx * (W / 2 - 0.1), 0.045, sz * 0.36, 0.06, 0.09, 0.06);
  c.collider(-W / 2, -0.44, W / 2, 0.45, 0, 1.0);
  c.itemSlot(W * 0.3, 0.52, 0.12, { surface: 'seat' });
  if (o.hideBehind) {
    c.hideSpot({
      type: 'behind', entry: [W / 2 + 0.5, -0.8], inside: [0.1, 0.62, -0.78], exit: [W / 2 + 0.5, -0.8],
      look: [0.1, 0.8, 3], yawRange: 1.2, pitchMin: -0.3, pitchMax: 0.3, concealment: 0.55,
    });
  }
};

B.coffeeTable = (c, o) => {
  const wood = o.wood || 'woodFurnitureDark';
  c.box(wood, 0, 0.4, 0, 1.1, 0.04, 0.6);
  c.box(wood, 0, 0.12, 0, 1.0, 0.03, 0.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box(wood, sx * 0.5, 0.2, sz * 0.26, 0.05, 0.4, 0.05);
  c.collider(-0.55, -0.3, 0.55, 0.3, 0, 0.42);
  c.itemSlot(0.2, 0.42, 0);
};

B.bookshelf = (c, o) => {
  const W = o.w || 1.2, D = 0.36, H = o.h || 2.2;
  const wood = o.wood || 'woodFurnitureDark';
  c.box(wood, 0, H / 2, -D / 2 + 0.015, W, H, 0.03);
  for (const sx of [-1, 1]) c.box(wood, sx * (W / 2 - 0.02), H / 2, 0, 0.04, H, D);
  const shelves = Math.round(H / 0.45);
  for (let i = 0; i <= shelves; i++) {
    const y = 0.05 + i * ((H - 0.08) / shelves);
    c.box(wood, 0, y, 0, W - 0.04, 0.03, D);
    if (i < shelves && !(o.gaps && o.gaps.includes(i))) {
      c.box('books', 0, y + 0.19, -0.01, W - 0.1, 0.34, D - 0.08, { faces: 'Z', uvOffset: [i * 0.31 + c.x * 0.13, (i % 4) * 0.25] });
      c.box('woodFurnitureDark', 0, y + 0.19, -0.01, W - 0.1, 0.34, D - 0.08, { faces: 'Y' });
    } else if (i < shelves) {
      c.itemSlot(0, y + 0.02, 0.02, { surface: 'shelf' });
    }
  }
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H, { sight: true });
};

B.desk = (c, o) => {
  const W = o.w || 1.4, D = 0.7, H = 0.76;
  const wood = o.wood || 'woodFurnitureDark';
  c.box(wood, 0, H - 0.025, 0, W, 0.05, D);
  c.box(wood, W / 2 - 0.22, (H - 0.05) / 2, 0, 0.42, H - 0.05, D - 0.04);
  for (let i = 0; i < 3; i++) {
    c.box(wood, W / 2 - 0.22, 0.14 + i * 0.22, D / 2 - 0.01, 0.38, 0.18, 0.02);
    c.box('brass', W / 2 - 0.22, 0.14 + i * 0.22, D / 2 + 0.01, 0.07, 0.02, 0.02);
  }
  c.box(wood, -W / 2 + 0.04, (H - 0.05) / 2, 0, 0.06, H - 0.05, D - 0.04);
  c.box(wood, 0, H * 0.55, -D / 2 + 0.03, W - 0.1, H * 0.5, 0.02);
  if (o.leather !== false) c.box('leather', -0.1, H + 0.002, 0.05, W * 0.5, 0.004, D * 0.55, { faces: 'Y', ao: 1 });
  c.collider(W / 2 - 0.44, -D / 2, W / 2, D / 2, 0, H);
  c.collider(-W / 2, -D / 2, -W / 2 + 0.08, D / 2, 0, H);
  c.collider(-W / 2, -D / 2, W / 2, D / 2, H - 0.1, H, { nav: false });
  c.itemSlot(-0.15, H, 0.1);
  c.itemSlot(0.3, H, 0.12);
};

B.piano = (c, o) => {
  c.box('pianoBlack', 0, 0.68, -0.08, 1.5, 1.3, 0.42);
  c.box('pianoBlack', 0, 0.73, 0.17, 1.5, 0.06, 0.28);
  c.box('ivory', 0, 0.765, 0.2, 1.3, 0.015, 0.16, { faces: 'YZ' });
  for (let i = 0; i < 36; i++) {
    const k = i % 7;
    if (k === 2 || k === 6) continue;
    c.box('pianoBlack', -0.62 + i * 0.036, 0.785, 0.16, 0.018, 0.02, 0.09);
  }
  for (const sx of [-1, 1]) c.box('pianoBlack', sx * 0.7, 0.36, 0.22, 0.06, 0.72, 0.06);
  c.box('pianoBlack', 0, 0.45, 0.62, 0.7, 0.06, 0.34);
  for (const sx of [-1, 1]) c.box('pianoBlack', sx * 0.3, 0.22, 0.62, 0.05, 0.44, 0.3);
  c.collider(-0.76, -0.3, 0.76, 0.34, 0, 1.33);
  c.collider(-0.36, 0.45, 0.36, 0.8, 0, 0.48);
  c.interact({ kind: 'piano', pos: [0, 0.8, 0.3], prompt: 'Touch the keys', radius: 0.8 });
};

B.clock = (c, o) => {
  const wood = 'woodFurnitureDark';
  c.box(wood, 0, 1.05, 0, 0.5, 2.1, 0.32);
  c.box(wood, 0, 2.14, 0, 0.58, 0.1, 0.38);
  c.box('ivory', 0, 1.78, 0.165, 0.34, 0.34, 0.01, { faces: 'Z' });
  c.box('crtGlass', 0, 1.0, 0.165, 0.3, 0.9, 0.008, { faces: 'Z' });
  c.collider(-0.25, -0.16, 0.25, 0.16, 0, 2.2, { sight: true });
  // pendulum + hands (animated)
  const pend = c.part((g, slot) => {
    g.geometry('brass', new THREE.CylinderGeometry(0.008, 0.008, 0.62, 6), new THREE.Matrix4().makeTranslation(0, -0.31, 0), { room: slot });
    g.geometry('brass', new THREE.CylinderGeometry(0.075, 0.075, 0.015, 16), new THREE.Matrix4().makeTranslation(0, -0.66, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), { room: slot });
  }, 0, 1.45, 0.12, 'pendulum');
  const hands = c.part((g, slot) => {
    g.box('black', 0, 0.06, 0, 0.012, 0.12, 0.004, { room: slot });
  }, 0, 1.78, 0.172, 'hands');
  c.world.animators.push((t) => {
    pend.grp.rotation.z = Math.sin(t * Math.PI) * 0.18;
    hands.grp.rotation.z = -Math.floor(t) * 0.02;
  });
  c.world.soundSources.push({ kind: 'clock', f: c.f, pos: c.wv(0, 1.4, 0) });
};

B.fireplace = (c, o) => {
  c.box('brick', 0, 0.65, -0.05, 1.9, 1.3, 0.5);
  c.box('void', 0, 0.42, 0.05, 1.0, 0.72, 0.32, { faces: 'Z' });
  c.box('trimDark', 0, 1.34, 0.02, 2.1, 0.08, 0.62);
  c.box('stone', 0, 0.02, 0.45, 2.0, 0.04, 0.5, { faces: 'YZxX' });
  // logs + embers
  for (let i = 0; i < 3; i++) c.cyl('woodBeams', -0.2 + i * 0.2, 0.12, 0.05, 0.06, 0.06, 0.6, 7, { rz: Math.PI / 2, ry: 0.3 * (i - 1) });
  c.collider(-0.95, -0.3, 0.95, 0.2, 0, 1.38, { sight: true });
  c.itemSlot(-0.6, 1.38, 0.05, { surface: 'mantel' });
  c.itemSlot(0.6, 1.38, 0.05, { surface: 'mantel' });
  c.world.fireplaces.push({ f: c.f, pos: c.wv(0, 0.25, 0.1), room: c.room.index });
};

B.tv = (c, o) => {
  c.box('woodFurnitureDark', 0, 0.28, 0, 0.9, 0.56, 0.45);
  c.box('plasticBeige', 0, 0.84, -0.05, 0.62, 0.52, 0.5);
  c.box('plasticBeige', 0, 0.84, -0.3, 0.4, 0.36, 0.2);
  for (const sx of [-0.12, 0.12]) c.cyl('chrome', sx, 1.2, -0.1, 0.005, 0.005, 0.35, 5, { rz: sx * 3 });
  c.collider(-0.45, -0.4, 0.45, 0.25, 0, 1.12);
  const screenPos = c.wv(-0.04, 0.85, 0.205);
  c.world.tvs.push({ f: c.f, room: c.room.index, pos: screenPos, yaw: c.ry, id: c.id });
  c.interact({ kind: 'tv', id: c.id, pos: [0, 0.85, 0.3], prompt: 'Switch the TV', radius: 0.9 });
};

B.counter = (c, o) => {
  // length along local x, back against the wall (-Z)
  const L = o.len || 2, D = 0.62, H = 0.9;
  const wood = o.wood || 'woodPaintedDark';
  c.box(wood, 0, (H - 0.05) / 2 + 0.05, 0, L, H - 0.1, D - 0.02);
  c.box('black', 0, 0.05, 0.02, L, 0.1, D - 0.1);
  c.box(o.top || 'marble', 0, H - 0.02, 0.01, L + 0.02, 0.04, D + 0.02);
  const doors = Math.max(1, Math.round(L / 0.5));
  const dw = L / doors;
  for (let i = 0; i < doors; i++) {
    const x = -L / 2 + (i + 0.5) * dw;
    if (o.sink && i === Math.floor(doors / 2)) continue;
    c.box(wood, x, 0.48, D / 2, dw - 0.03, 0.66, 0.018);
    c.box('chrome', x + dw * 0.32, 0.7, D / 2 + 0.02, 0.015, 0.1, 0.02);
  }
  if (o.sink) {
    const sx = -L / 2 + (Math.floor(doors / 2) + 0.5) * dw;
    c.box('chrome', sx, H - 0.08, 0.02, 0.5, 0.16, 0.4, { faces: 'yY' });
    c.box('void', sx, H - 0.01, 0.02, 0.46, 0.005, 0.36, { faces: 'Y' });
    c.cyl('chrome', sx, H + 0.15, -0.22, 0.015, 0.015, 0.3, 6);
    c.cyl('chrome', sx, H + 0.28, -0.12, 0.012, 0.012, 0.22, 6, { rx: Math.PI / 2 });
    // the sink cabinet is a hiding spot
    const door = c.part((g, slot) => {
      g.box(wood, -dw / 2 + 0.02, 0.33, 0, dw - 0.03, 0.66, 0.02, { room: slot });
      g.box('chrome', -dw + 0.1, 0.5, 0.02, 0.015, 0.1, 0.02, { room: slot });
    }, sx + dw / 2 - 0.02, 0.15, D / 2, 'cabinetDoor');
    c.hideSpot({
      type: 'cabinet', entry: [sx, D / 2 + 0.55], inside: [sx, 0.45, -0.02], exit: [sx, D / 2 + 0.55],
      look: [sx, 0.5, 3], yawRange: 0.4, pitchMin: -0.2, pitchMax: 0.15, concealment: 1, overlay: 'slit',
      setOpen: (t) => { door.holder.rotation.y = c.ry - t * 1.7; },
    });
  }
  c.collider(-L / 2, -D / 2, L / 2, D / 2, 0, H);
  for (let i = 0; i < Math.max(1, Math.floor(L / 0.8)); i++) c.itemSlot(-L / 2 + 0.4 + i * 0.8, H, 0.05, { surface: 'counter' });
  if (o.upper) {
    const uy = 1.5;
    c.box(wood, 0, uy + 0.35, -D / 2 + 0.19, L, 0.7, 0.36);
    for (let i = 0; i < doors; i++) {
      const x = -L / 2 + (i + 0.5) * dw;
      c.box(wood, x, uy + 0.35, -D / 2 + 0.38, dw - 0.03, 0.64, 0.016);
      c.box('chrome', x + dw * 0.32, uy + 0.1, -D / 2 + 0.4, 0.015, 0.1, 0.02);
    }
    c.collider(-L / 2, -D / 2, L / 2, -D / 2 + 0.38, uy, uy + 0.72);
  }
};

B.fridge = (c, o) => {
  c.box('plasticWhite', 0, 0.9, 0, 0.76, 1.8, 0.7);
  c.box('plasticWhite', 0, 1.33, 0.36, 0.74, 0.9, 0.02);
  c.box('plasticWhite', 0, 0.42, 0.36, 0.74, 0.82, 0.02);
  c.box('chrome', -0.3, 1.1, 0.4, 0.03, 0.4, 0.03);
  c.box('chrome', -0.3, 0.65, 0.4, 0.03, 0.3, 0.03);
  c.collider(-0.38, -0.35, 0.38, 0.37, 0, 1.8, { sight: true });
  c.itemSlot(0, 1.8, 0, { surface: 'top' });
  c.world.soundSources.push({ kind: 'hum', f: c.f, pos: c.wv(0, 0.5, 0) });
};

B.stove = (c, o) => {
  c.box('plasticWhite', 0, 0.45, 0, 0.76, 0.9, 0.64);
  c.box('black', 0, 0.91, 0, 0.74, 0.02, 0.6, { faces: 'Y' });
  for (const [x, z] of [[-0.18, -0.14], [0.18, -0.14], [-0.18, 0.14], [0.18, 0.14]]) c.cyl('iron', x, 0.93, z, 0.09, 0.09, 0.02, 12);
  c.box('crtGlass', 0, 0.45, 0.325, 0.6, 0.4, 0.01, { faces: 'Z' });
  c.box('plasticWhite', 0, 1.02, -0.3, 0.76, 0.22, 0.05);
  c.collider(-0.38, -0.32, 0.38, 0.33, 0, 0.95);
  c.itemSlot(0.18, 0.95, 0.14, { surface: 'stove' });
};

B.island = (c, o) => {
  const W = o.w || 2.0, D = 0.95, H = 0.92;
  c.box('woodPaintedDark', 0, H / 2, 0, W - 0.06, H - 0.05, D - 0.06);
  c.box('marble', 0, H - 0.02, 0, W + 0.08, 0.04, D + 0.08);
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H);
  c.itemSlot(-0.4, H, 0, { surface: 'counter' });
  c.itemSlot(0.45, H, 0.1, { surface: 'counter' });
};

B.shelves = (c, o) => {
  const W = o.w || 1.8, D = o.d || 0.45, H = o.h || 1.9;
  const mat = o.metal ? 'metal' : 'woodPlanks';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box(mat, sx * (W / 2 - 0.03), H / 2, sz * (D / 2 - 0.03), 0.04, H, 0.04);
  const n = o.levels || 4;
  for (let i = 0; i < n; i++) {
    const y = 0.15 + i * ((H - 0.2) / (n - 1));
    c.box(mat, 0, y, 0, W, 0.025, D);
    // stuff on shelves
    const rng = c.world.decorRng;
    let x = -W / 2 + 0.1;
    while (x < W / 2 - 0.15) {
      const kind = rng.int(0, 4);
      const w = rng.float(0.12, 0.3);
      if (kind === 0) c.box('cardboard', x + w / 2, y + 0.12, rng.float(-0.05, 0.05), w, 0.22, D * 0.7);
      else if (kind === 1 && o.jars !== false) for (let j = 0; j < 3; j++) c.cyl(rng.chance(0.5) ? 'greenGlass' : 'ceramic', x + 0.05 + j * 0.07, y + 0.09, 0, 0.03, 0.035, 0.15, 8);
      else if (kind === 2) c.box('paper', x + w / 2, y + 0.04, 0, w, 0.06, D * 0.6);
      x += w + rng.float(0.03, 0.2);
    }
    if (i < n - 1) c.itemSlot(rng.float(-W / 3, W / 3), y + 0.015, 0.05, { surface: 'shelf' });
  }
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H, { sight: H > 1.6 });
};

B.washer = (c, o) => {
  c.box('plasticWhite', 0, 0.44, 0, 0.62, 0.88, 0.62);
  c.cyl('crtGlass', 0, 0.42, 0.31, 0.2, 0.2, 0.02, 16, { rx: Math.PI / 2 });
  c.cyl('chrome', 0, 0.42, 0.315, 0.23, 0.23, 0.01, 16, { rx: Math.PI / 2 });
  c.box('plasticBeige', 0, 0.82, -0.2, 0.6, 0.1, 0.12);
  c.collider(-0.31, -0.31, 0.31, 0.31, 0, 0.9);
  c.itemSlot(0.1, 0.88, 0.05, { surface: 'top' });
};

B.fusebox = (c, o) => {
  c.box('metal', 0, 1.5, -0.04, 0.5, 0.7, 0.14);
  c.box('iron', 0, 1.5, 0.035, 0.44, 0.62, 0.02, { faces: 'Z' });
  c.box('paintRed', 0.15, 1.72, 0.05, 0.04, 0.1, 0.03);
  c.cyl('rust', 0, 2.3, -0.06, 0.03, 0.03, 1.1, 6);
  c.interact({ kind: 'fusebox', id: 'fusebox', pos: [0, 1.5, 0.12], prompt: 'Fuse box', radius: 0.9 });
  c.world.fuseBoxPos = c.wv(0, 1.5, 0.1);
};

B.bathtub = (c, o) => {
  const L = 1.7, W = 0.78;
  c.box('porcelain', 0, 0.3, 0, L, 0.56, W);
  c.box('void', 0, 0.58, 0, L - 0.14, 0.01, W - 0.14, { faces: 'Y' });
  c.box('porcelain', 0, 0.2, 0, L - 0.14, 0.02, W - 0.14, { faces: 'Y' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.sphere('brass', sx * (L / 2 - 0.12), 0.03, sz * (W / 2 - 0.1), 0.05, 0.8);
  c.cyl('chrome', -L / 2 + 0.1, 0.8, -W / 2 + 0.05, 0.015, 0.015, 0.5, 6);
  c.cyl('chrome', 0, 2.0, W / 2 - 0.02, 0.01, 0.01, L, 6, { rz: Math.PI / 2 });
  c.collider(-L / 2, -W / 2, L / 2, W / 2, 0, 0.6);
  // shower curtain (animated)
  const curtain = c.part((g, slot) => {
    g.geometry('sheet', clothGeometry(L, 1.42, 9, 0.035), new THREE.Matrix4().makeTranslation(0, -0.72, 0), { room: slot });
  }, 0, 1.98, W / 2 - 0.02, 'curtain');
  c.hideSpot({
    type: 'tub', entry: [0.2, W / 2 + 0.55], inside: [0.1, 0.32, -0.05], exit: [0.2, W / 2 + 0.55],
    look: [0.2, 0.9, 3], yawRange: 1.1, pitchMin: -0.2, pitchMax: 0.6, concealment: 0.9,
    setOpen: (t) => { curtain.grp.scale.x = 1 - t * 0.75; curtain.grp.position.x = -t * 0.6; },
  });
};

B.toilet = (c, o) => {
  c.box('porcelain', 0, 0.2, 0.05, 0.38, 0.4, 0.5);
  c.box('porcelain', 0, 0.42, 0.08, 0.42, 0.04, 0.52);
  c.box('porcelain', 0, 0.62, -0.22, 0.46, 0.4, 0.18);
  c.collider(-0.23, -0.31, 0.23, 0.33, 0, 0.8);
};

B.bathSink = (c, o) => {
  c.cyl('porcelain', 0, 0.4, 0, 0.07, 0.1, 0.8, 10);
  c.box('porcelain', 0, 0.84, 0.02, 0.56, 0.12, 0.44);
  c.box('void', 0, 0.9, 0.04, 0.4, 0.005, 0.28, { faces: 'Y' });
  c.cyl('chrome', 0, 1.0, -0.14, 0.012, 0.012, 0.18, 6);
  c.collider(-0.28, -0.22, 0.28, 0.24, 0, 0.9);
  c.itemSlot(0.2, 0.9, -0.14, { surface: 'sink' });
  if (o.mirror !== false) {
    const p = c.wv(0, 1.55, -0.2);
    c.world.mirrors.push({ f: c.f, room: c.room.index, pos: p, yaw: c.ry, w: 0.62, h: 0.8 });
    c.box('trimDark', 0, 1.55, -0.225, 0.72, 0.9, 0.03);
  }
};

B.car = (c, o) => {
  // sedan facing local +Z; ~4.3m long
  const L = 4.3, W = 1.8;
  const body = 'carBody';
  c.box(body, 0, 0.62, 0, W, 0.62, L);
  c.box(body, 0, 1.02, -0.25, W - 0.12, 0.2, 2.2);
  c.box(body, 0, 1.35, -0.35, W - 0.24, 0.05, 1.6);
  // windows (dark glass) and pillars
  c.box('crtGlass', 0, 1.2, -0.35, W - 0.26, 0.28, 1.58, { faces: 'xX' });
  c.box('crtGlass', 0, 1.2, 0.55, W - 0.3, 0.3, 0.02, { faces: 'Z', ry: 0 });
  c.box('crtGlass', 0, 1.2, -1.25, W - 0.3, 0.3, 0.02, { faces: 'z' });
  for (const sz of [0.53, -1.23]) for (const sx of [-1, 1]) c.box(body, sx * (W / 2 - 0.13), 1.2, sz, 0.05, 0.32, 0.06);
  c.box('chrome', 0, 0.45, L / 2 + 0.02, W + 0.04, 0.1, 0.06);
  c.box('chrome', 0, 0.45, -L / 2 - 0.02, W + 0.04, 0.1, 0.06);
  for (const sx of [-1, 1]) {
    c.box('ivory', sx * 0.6, 0.66, L / 2 + 0.01, 0.22, 0.14, 0.02, { faces: 'Z' });
    c.box('paintRed', sx * 0.65, 0.66, -L / 2 - 0.01, 0.18, 0.1, 0.02, { faces: 'z' });
    for (const sz of [1.35, -1.35]) {
      c.cyl('tire', sx * (W / 2 - 0.1), 0.34, sz, 0.34, 0.34, 0.24, 16, { rz: Math.PI / 2 });
      c.cyl('chrome', sx * (W / 2 - 0.02), 0.34, sz, 0.18, 0.18, 0.02, 12, { rz: Math.PI / 2 });
    }
  }
  c.collider(-W / 2 - 0.05, -L / 2 - 0.05, W / 2 + 0.05, L / 2 + 0.05, 0, 1.4, { sight: false });
  c.interact({ kind: 'car_hood', id: 'car_hood', pos: [0, 0.9, L / 2 - 0.3], prompt: 'Car engine', radius: 1.2 });
  c.interact({ kind: 'car_fuel', id: 'car_fuel', pos: [-W / 2 - 0.05, 0.8, -1.2], prompt: 'Fuel cap', radius: 0.9 });
  c.interact({ kind: 'car_door', id: 'car_door', pos: [-W / 2 - 0.1, 1.0, 0.1], prompt: 'Driver door', radius: 1.0 });
  c.world.car = { pos: c.wv(0, 0, 0), yaw: c.ry, f: c.f, seat: c.wv(-0.4, 1.1, -0.1), front: c.wv(0, 0.9, L / 2) };
};

B.workbench = (c, o) => {
  const W = o.w || 2.0, D = 0.7, H = 0.9;
  c.box('woodPlanks', 0, H - 0.03, 0, W, 0.06, D);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box('woodPlanks', sx * (W / 2 - 0.06), (H - 0.06) / 2, sz * (D / 2 - 0.06), 0.08, H - 0.06, 0.08);
  c.box('woodPlanks', 0, 0.2, 0, W - 0.1, 0.03, D - 0.1);
  // pegboard with tool silhouettes
  c.box('cardboard', 0, H + 0.6, -D / 2 + 0.02, W, 1.0, 0.02, { faces: 'Z' });
  const rng = c.world.decorRng;
  for (let i = 0; i < 6; i++) c.box('iron', -W / 2 + 0.25 + i * (W - 0.4) / 5, H + 0.6 + rng.float(-0.25, 0.25), -D / 2 + 0.05, 0.04, rng.float(0.15, 0.35), 0.02);
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H);
  c.collider(-W / 2, -D / 2, W / 2, D / 2, H - 0.1, H, { nav: false });
  c.itemSlot(-W * 0.3, H, 0.08, { surface: 'bench' });
  c.itemSlot(W * 0.25, H, 0.05, { surface: 'bench' });
  if (o.dolls) {
    // the toymaker's work: doll heads, a giant half-sewn cat head
    for (let i = 0; i < 4; i++) c.sphere('doll', -0.6 + i * 0.25, H + 0.07, 0.15, 0.07);
    c.sphere('fur', 0.55, H + 0.25, 0.05, 0.25, 1.05);
    c.sphere('gold', 0.47, H + 0.3, 0.26, 0.04);
    c.sphere('gold', 0.63, H + 0.3, 0.26, 0.04);
  }
};

B.boxes = (c, o) => {
  const rng = c.world.decorRng;
  const n = o.n || 3;
  let y = 0;
  let maxH = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.float(0.4, 0.7), d = rng.float(0.35, 0.6), h = rng.float(0.3, 0.55);
    const stack = i > 0 && rng.chance(0.45) && y < 1.1;
    const bx = stack ? rng.float(-0.05, 0.05) : rng.float(-0.35, 0.35);
    const bz = stack ? rng.float(-0.05, 0.05) : rng.float(-0.25, 0.25);
    if (!stack) y = 0;
    c.box(o.mat || 'cardboard', bx, y + h / 2, bz, w, h, d, { ry: rng.float(-0.2, 0.2) });
    y += h;
    maxH = Math.max(maxH, y);
  }
  c.collider(-0.55, -0.45, 0.55, 0.45, 0, maxH, { sight: maxH > 1.3 });
  c.itemSlot(0, maxH, 0, { surface: 'box' });
};

B.crate = (c, o) => {
  const s = o.s || 0.7;
  c.box('woodPlanks', 0, s / 2, 0, s, s, s);
  for (const y of [0.08, s - 0.08]) c.box('woodBeams', 0, y, s / 2 + 0.01, s + 0.02, 0.06, 0.02);
  c.collider(-s / 2, -s / 2, s / 2, s / 2, 0, s);
  c.itemSlot(0, s, 0, { surface: 'box' });
};

B.boiler = (c, o) => {
  c.cyl('rust', 0, 1.0, 0, 0.6, 0.6, 2.0, 20);
  c.cyl('iron', 0, 2.05, 0, 0.62, 0.62, 0.1, 20);
  c.box('iron', 0, 0.5, 0.55, 0.4, 0.4, 0.1);
  c.box('void', 0, 0.5, 0.61, 0.3, 0.12, 0.01, { faces: 'Z' });
  c.cyl('rust', 0.3, 2.5, 0, 0.1, 0.1, 0.9, 8);
  c.cyl('rust', 0.3, 2.9, -0.8, 0.08, 0.08, 1.6, 8, { rx: Math.PI / 2 });
  for (const a of [0, 1.2, 2.4, 3.6, 4.8]) c.box('iron', Math.cos(a) * 0.6, 1.0, Math.sin(a) * 0.6, 0.06, 1.8, 0.06, { ry: -a });
  c.collider(-0.62, -0.62, 0.62, 0.62, 0, 2.2, { sight: true });
  c.world.soundSources.push({ kind: 'boiler', f: c.f, pos: c.wv(0, 1, 0) });
};

B.wineRack = (c, o) => {
  const W = o.w || 2.0, D = 0.4, H = 2.0;
  for (let i = 0; i <= 5; i++) c.box('woodFurnitureDark', -W / 2 + i * (W / 5), H / 2, 0, 0.04, H, D);
  for (let j = 0; j <= 6; j++) c.box('woodFurnitureDark', 0, 0.05 + j * ((H - 0.1) / 6), 0, W, 0.03, D);
  const rng = c.world.decorRng;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 6; j++) {
    for (let k = 0; k < 3; k++) {
      if (rng.chance(0.25)) continue;
      c.cyl('greenGlass', -W / 2 + i * (W / 5) + 0.08 + k * 0.12, 0.13 + j * ((H - 0.1) / 6), 0.02, 0.04, 0.04, 0.34, 7, { rx: Math.PI / 2 });
    }
  }
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H, { sight: true });
  c.itemSlot(0, 0.08, 0.02, { surface: 'shelf' });
};

B.mannequin = (c, o) => {
  const mat = o.mat || 'fabricBeige';
  c.cyl('woodFurnitureDark', 0, 0.02, 0, 0.18, 0.2, 0.04, 12);
  c.cyl('woodFurnitureDark', 0, 0.55, 0, 0.02, 0.02, 1.0, 6);
  c.geom(mat, new THREE.CylinderGeometry(0.17, 0.13, 0.55, 12), 0, 1.3, 0);
  c.sphere(mat, 0, 1.55, 0, 0.19, 0.75);
  c.sphere(mat, 0, 1.08, 0, 0.18, 0.6);
  if (o.head) c.sphere('doll', 0, 1.82, 0, 0.1, 1.2);
  c.collider(-0.22, -0.22, 0.22, 0.22, 0, 1.75);
};

B.sheeted = (c, o) => {
  // furniture hidden under a dust sheet - lumpy silhouette
  const W = o.w || 1.4, D = o.d || 0.9, H = o.h || 1.0;
  const g = new THREE.BoxGeometry(W, H, D, 6, 4, 6);
  const pos = g.attributes.position;
  const rng = c.world.decorRng;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const s = y < -H / 2 + 0.01 ? 1.08 : 1 + rng.float(-0.04, 0.04);
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
    if (y > H / 2 - 0.01) pos.setY(i, y + rng.float(-0.06, 0.03));
  }
  g.computeVertexNormals();
  c.geom('sheet', g, 0, H / 2, 0, 0, 0, 0, 1, { aoBottom: true });
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H, { sight: H > 1.5 });
  c.itemSlot(W * 0.2, H, 0, { surface: 'sheet' });
};

B.chest = (c, o) => {
  const W = o.w || 1.0, D = 0.55, H = 0.52;
  const mat = o.mat || 'woodPainted';
  c.box(mat, 0, H / 2, 0, W, H, D);
  c.box('void', 0, H - 0.005, 0, W - 0.08, 0.005, D - 0.08, { faces: 'Y' });
  for (const sx of [-1, 1]) c.box('iron', sx * (W / 2 - 0.1), H / 2, D / 2 + 0.005, 0.05, H, 0.01);
  const lid = c.part((g, slot) => {
    g.box(mat, 0, 0.03, D / 2, W + 0.02, 0.07, D + 0.02, { room: slot });
    g.box('iron', 0, 0.02, D + 0.015, 0.1, 0.08, 0.02, { room: slot });
  }, 0, H, -D / 2, 'lid');
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H + 0.07);
  if (o.hide) {
    c.hideSpot({
      type: 'chest', entry: [0, D / 2 + 0.55], inside: [0, 0.3, 0], exit: [0, D / 2 + 0.55],
      look: [0, 0.8, 3], yawRange: 0.3, pitchMin: -0.1, pitchMax: 0.2, concealment: 1, overlay: 'slit',
      setOpen: (t) => { lid.grp.rotation.x = -t * 1.6 - 0.03; },
    });
  }
  lid.grp.rotation.x = -0.03;
};

B.rockingChair = (c, o) => {
  const part = c.part((g, slot) => {
    const w = 'woodFurnitureDark';
    g.box(w, 0, 0.45, 0, 0.5, 0.05, 0.5, { room: slot });
    g.box(w, 0, 0.85, -0.25, 0.5, 0.75, 0.04, { room: slot });
    for (const sx of [-1, 1]) {
      g.box(w, sx * 0.22, 0.25, 0.18, 0.04, 0.42, 0.04, { room: slot });
      g.box(w, sx * 0.22, 0.25, -0.2, 0.04, 0.42, 0.04, { room: slot });
      // curved rocker approximated by three short segments
      for (const [cz, a] of [[-0.3, 0.35], [0, 0], [0.3, -0.35]]) {
        const m = new THREE.Matrix4().makeTranslation(sx * 0.22, 0.04 + Math.abs(cz) * 0.25, cz).multiply(new THREE.Matrix4().makeRotationX(a));
        g.geometry(w, new THREE.BoxGeometry(0.035, 0.035, 0.32), m, { room: slot });
      }
      g.box(w, sx * 0.22, 0.62, 0.0, 0.04, 0.04, 0.45, { room: slot });
    }
    g.box(o.mat || 'fabricRed', 0, 0.48, 0.02, 0.44, 0.03, 0.42, { room: slot });
  }, 0, 0, 0, 'rockingChair');
  c.collider(-0.3, -0.35, 0.3, 0.35, 0, 1.1);
  const chair = { part, rock: 0, target: 0 };
  c.world.rockingChairs.push(chair);
  c.world.animators.push((t, dt) => {
    chair.rock = Math.max(0, chair.rock - dt * 0.05);
    part.grp.rotation.x = Math.sin(t * 2.2) * 0.14 * chair.rock;
  });
};

B.rockingHorse = (c, o) => {
  c.box('toyRed', 0, 0.55, 0, 0.18, 0.28, 0.62);
  c.box('toyRed', 0, 0.78, 0.3, 0.14, 0.3, 0.16, { ry: 0 });
  c.box('toyRed', 0, 0.9, 0.42, 0.12, 0.12, 0.22);
  c.box('toyYellow', 0, 0.72, -0.05, 0.22, 0.04, 0.3);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) c.box('toyRed', sx * 0.08, 0.28, sz * 0.22, 0.05, 0.36, 0.05);
  c.box('woodFurnitureDark', -0.1, 0.06, 0, 0.04, 0.05, 0.95);
  c.box('woodFurnitureDark', 0.1, 0.06, 0, 0.04, 0.05, 0.95);
  c.collider(-0.15, -0.48, 0.15, 0.48, 0, 0.9);
};

B.dollhouse = (c, o) => {
  c.box('woodPainted', 0, 0.35, 0, 0.9, 0.7, 0.45);
  c.geom('toyRed', new THREE.ConeGeometry(0.58, 0.35, 4, 1), 0, 0.88, 0, 0, Math.PI / 4, 0, [1, 1, 0.55]);
  for (const y of [0.18, 0.5]) for (const x of [-0.25, 0.25]) c.box('void', x, y, 0.226, 0.14, 0.14, 0.005, { faces: 'Z' });
  c.collider(-0.46, -0.24, 0.46, 0.24, 0, 1.0);
};

B.teddy = (c, o) => {
  const m = o.mat || 'fur';
  c.sphere(m, 0, 0.14, 0, 0.13, 1.1);
  c.sphere(m, 0, 0.34, 0.01, 0.09);
  for (const sx of [-1, 1]) {
    c.sphere(m, sx * 0.07, 0.42, 0.0, 0.035);
    c.sphere(m, sx * 0.12, 0.16, 0.06, 0.045);
    c.sphere(m, sx * 0.08, 0.04, 0.1, 0.05);
    c.sphere('black', sx * 0.03, 0.36, 0.085, 0.012);
  }
};

B.toys = (c, o) => {
  const rng = c.world.decorRng;
  for (let i = 0; i < (o.n || 6); i++) {
    const x = rng.float(-0.8, 0.8), z = rng.float(-0.6, 0.6);
    const k = rng.int(0, 3);
    const mat = rng.pick(['toyRed', 'toyBlue', 'toyYellow']);
    if (k === 0) c.box(mat, x, 0.05, z, 0.1, 0.1, 0.1, { ry: rng.float(0, 3) });
    else if (k === 1) c.sphere(mat, x, 0.08, z, 0.08);
    else if (k === 2) c.cyl(mat, x, 0.04, z, 0.05, 0.05, 0.08, 8);
    else { c.box('doll', x, 0.03, z, 0.08, 0.05, 0.3, { ry: rng.float(0, 3) }); c.sphere('doll', x + 0.05, 0.05, z, 0.05); }
  }
};

B.coats = (c, o) => {
  // row of heavy coats on a rail - hide among them
  const W = o.w || 2.2;
  c.cyl('brass', 0, 1.75, 0, 0.015, 0.015, W, 6, { rz: Math.PI / 2 });
  for (const sx of [-1, 1]) c.box('woodFurnitureDark', sx * W / 2, 0.9, 0, 0.05, 1.8, 0.05);
  const rng = c.world.decorRng;
  const n = Math.round(W / 0.2);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.1 + i * (W - 0.2) / (n - 1);
    if (Math.abs(x) < 0.2) continue;
    const m = rng.pick(['fabricBeige', 'fabricGreen', 'leather', 'fabricBlue', 'fabricRed']);
    c.box(m, x, 1.15, rng.float(-0.03, 0.03), 0.12, 1.15, 0.5, { ry: rng.float(-0.15, 0.15), ao: 0.6 });
  }
  const coatsFront = c.part((g, slot) => {
    for (const x of [-0.12, 0.12]) g.box('fabricBeige', x, -0.6, 0, 0.14, 1.15, 0.5, { room: slot, ao: 0.6 });
  }, 0, 1.75, 0, 'coats');
  c.collider(-W / 2, -0.28, -0.25, 0.28, 0.5, 1.8, { sight: true });
  c.collider(0.25, -0.28, W / 2, 0.28, 0.5, 1.8, { sight: true });
  c.hideSpot({
    type: 'coats', entry: [0, 0.8], inside: [0, 1.5, -0.05], exit: [0, 0.8],
    look: [0, 1.4, 3], yawRange: 0.5, pitchMin: -0.4, pitchMax: 0.2, concealment: 0.8,
    setOpen: (t) => { coatsFront.grp.children.forEach((m) => { m.position.x = 0; }); coatsFront.grp.scale.x = 1 + t * 2.5; },
  });
};

B.curtains = (c, o) => {
  // floor-length curtains in front of a window (window behind at local -Z)
  const W = o.w || 1.4;
  const mat = o.mat || 'fabricRed';
  c.cyl('brass', 0, 2.45, -0.02, 0.015, 0.015, W + 0.3, 6, { rz: Math.PI / 2 });
  const panel = c.part((g, slot) => {
    g.geometry(mat, clothGeometry(W, 2.4, 7, 0.06), new THREE.Matrix4().makeTranslation(0, -1.2, 0), { room: slot });
  }, 0, 2.43, 0.06, 'curtain');
  if (o.hide) {
    c.hideSpot({
      type: 'curtain', entry: [0.1, 0.75], inside: [0, 1.5, -0.12], exit: [0.1, 0.75],
      look: [0, 1.4, 3], yawRange: 0.7, pitchMin: -0.4, pitchMax: 0.3, concealment: 0.7,
      setOpen: (t) => { panel.grp.scale.x = 1 - t * 0.7; panel.grp.position.x = t * W * 0.3; },
    });
  }
};

B.plant = (c, o) => {
  c.cyl('ceramic', 0, 0.18, 0, 0.16, 0.12, 0.36, 10);
  c.cyl('dirt', 0, 0.35, 0, 0.14, 0.14, 0.02, 10);
  const rng = c.world.decorRng;
  const dead = o.dead !== false;
  for (let i = 0; i < 7; i++) {
    const a = rng.float(0, Math.PI * 2), h = rng.float(0.3, 0.9);
    c.cyl(dead ? 'deadPlant' : 'plant', Math.cos(a) * 0.05, 0.36 + h / 2, Math.sin(a) * 0.05, 0.008, 0.012, h, 4, { rz: Math.cos(a) * 0.4, rx: Math.sin(a) * 0.4 });
  }
  c.collider(-0.17, -0.17, 0.17, 0.17, 0, 0.9);
};

B.bench = (c, o) => {
  const W = o.w || 1.3;
  c.box('woodFurnitureDark', 0, 0.44, 0, W, 0.05, 0.4);
  for (const sx of [-1, 1]) c.box('woodFurnitureDark', sx * (W / 2 - 0.06), 0.21, 0, 0.06, 0.42, 0.36);
  c.collider(-W / 2, -0.2, W / 2, 0.2, 0, 0.47);
  c.itemSlot(0.3, 0.47, 0, { surface: 'bench' });
};

B.billiards = (c, o) => {
  c.box('woodFurnitureDark', 0, 0.72, 0, 2.6, 0.12, 1.5);
  c.box('fabricGreen', 0, 0.785, 0, 2.3, 0.01, 1.2, { faces: 'Y' });
  for (const sx of [-1, 1]) c.box('woodFurnitureDark', 0, 0.82, sx * 0.68, 2.6, 0.08, 0.14);
  for (const sx of [-1, 1]) c.box('woodFurnitureDark', sx * 1.23, 0.82, 0, 0.14, 0.08, 1.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box('woodFurnitureDark', sx * 1.15, 0.33, sz * 0.62, 0.14, 0.66, 0.14);
  const rng = c.world.decorRng;
  for (let i = 0; i < 6; i++) c.sphere(rng.pick(['toyRed', 'toyYellow', 'toyBlue', 'ivory']), rng.float(-1, 1), 0.82, rng.float(-0.5, 0.5), 0.028);
  c.collider(-1.3, -0.75, 1.3, 0.75, 0.62, 0.86, { nav: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.collider(sx * 1.15 - 0.08, sz * 0.62 - 0.08, sx * 1.15 + 0.08, sz * 0.62 + 0.08, 0, 0.7);
  c.itemSlot(0.5, 0.79, 0.2, { surface: 'table' });
};

B.displayCase = (c, o) => {
  const W = o.w || 1.2;
  c.box('woodFurnitureDark', 0, 0.4, 0, W, 0.8, 0.45);
  c.box('woodFurnitureDark', 0, 1.95, 0, W, 0.08, 0.45);
  for (const sx of [-1, 1]) c.box('woodFurnitureDark', sx * (W / 2 - 0.02), 1.4, 0, 0.04, 1.1, 0.45);
  c.box('glass', 0, 1.4, 0.22, W - 0.06, 1.08, 0.01, { faces: 'Z' });
  // top hats on display (a collection of striped hats...)
  for (let i = 0; i < 3; i++) {
    const x = -W / 3 + i * (W / 3);
    c.cyl('black', x, 0.9, 0, 0.12, 0.12, 0.02, 12);
    for (let s = 0; s < 4; s++) c.cyl(s % 2 ? 'ivory' : 'paintRed', x, 0.95 + s * 0.06, 0, 0.075, 0.075, 0.06, 12);
    c.cyl('black', x, 1.52, 0, 0.004, 0.004, 0.001, 3);
  }
  c.box('woodFurnitureDark', 0, 1.35, 0, W - 0.06, 0.02, 0.4);
  for (let i = 0; i < 4; i++) c.sphere('doll', -W / 3 + i * (W / 4.5), 1.42, 0.02, 0.05);
  c.collider(-W / 2, -0.23, W / 2, 0.23, 0, 2.0, { sight: false });
  c.itemSlot(0.3, 0.8, 0.1, { surface: 'case' });
};

B.sewingMachine = (c, o) => {
  B.table(c, { w: 1.0, d: 0.55 });
  c.box('black', 0, 0.86, 0, 0.42, 0.18, 0.2);
  c.box('black', -0.15, 1.0, 0, 0.1, 0.2, 0.16);
  c.box('black', 0.05, 1.08, 0, 0.35, 0.08, 0.14);
  c.box('gold', 0.2, 0.9, 0.105, 0.05, 0.05, 0.01, { faces: 'Z' });
};

B.cage = (c, o) => {
  const W = o.w || 1.2, D = 0.9, H = 1.1;
  for (let i = 0; i <= 8; i++) {
    c.box('iron', -W / 2 + i * (W / 8), H / 2, D / 2, 0.02, H, 0.02);
    c.box('iron', -W / 2 + i * (W / 8), H / 2, -D / 2, 0.02, H, 0.02);
  }
  for (let i = 0; i <= 6; i++) for (const sx of [-1, 1]) c.box('iron', sx * W / 2, H / 2, -D / 2 + i * (D / 6), 0.02, H, 0.02);
  for (const y of [0.02, H]) c.box('iron', 0, y, 0, W, 0.03, D, { faces: 'yY' });
  c.box('fabricBeige', 0, 0.06, 0.1, W * 0.6, 0.06, D * 0.5);
  c.collider(-W / 2, -D / 2, W / 2, D / 2, 0, H);
};

B.clothesPile = (c, o) => {
  const rng = c.world.decorRng;
  for (let i = 0; i < 7; i++) {
    const m = rng.pick(['fabricBeige', 'fabricBlue', 'fabricGreen', 'leather', 'fabricRed']);
    c.box(m, rng.float(-0.35, 0.35), 0.04 + i * 0.03, rng.float(-0.3, 0.3), rng.float(0.3, 0.55), 0.05, rng.float(0.25, 0.45), { ry: rng.float(0, 3) });
  }
  // shoes
  for (let i = 0; i < 4; i++) {
    const x = rng.float(-0.6, 0.6), z = rng.float(0.35, 0.6);
    c.box('leather', x, 0.05, z, 0.1, 0.09, 0.26, { ry: rng.float(-1, 1) });
  }
};

B.hooks = (c, o) => {
  // victims' belongings hung on hooks along a wall (local -Z is the wall)
  const W = o.w || 3;
  c.box('woodBeams', 0, 1.7, -0.02, W, 0.08, 0.04);
  const rng = c.world.decorRng;
  const items = ['fabricBlue', 'leather', 'fabricBeige', 'fabricGreen', 'fabricRed'];
  for (let i = 0; i < Math.floor(W / 0.45); i++) {
    const x = -W / 2 + 0.25 + i * 0.45;
    c.box('iron', x, 1.65, 0.02, 0.02, 0.08, 0.06);
    if (rng.chance(0.8)) c.box(rng.pick(items), x, 1.25, 0.06, rng.float(0.3, 0.4), rng.float(0.6, 0.8), 0.06, { ao: 0.7 });
  }
};

B.lampTable = (c, o) => {
  // small side table under a lamp fixture
  c.cyl('woodFurnitureDark', 0, 0.33, 0, 0.25, 0.25, 0.03, 16);
  c.cyl('woodFurnitureDark', 0, 0.16, 0, 0.03, 0.05, 0.32, 8);
  c.cyl('woodFurnitureDark', 0, 0.01, 0, 0.18, 0.2, 0.02, 12);
  c.collider(-0.25, -0.25, 0.25, 0.25, 0, 0.36);
};

B.barrel = (c, o) => {
  c.cyl('woodPlanks', 0, 0.45, 0, 0.3, 0.3, 0.9, 12);
  for (const y of [0.15, 0.75]) c.cyl('iron', 0, y, 0, 0.31, 0.31, 0.04, 12);
  c.collider(-0.3, -0.3, 0.3, 0.3, 0, 0.9);
  c.itemSlot(0, 0.9, 0, { surface: 'box' });
};

B.waterHeater = (c, o) => {
  c.cyl('metal', 0, 0.8, 0, 0.3, 0.3, 1.6, 16);
  c.cyl('rust', 0.1, 1.9, 0, 0.03, 0.03, 0.6, 6);
  c.collider(-0.3, -0.3, 0.3, 0.3, 0, 1.6, { sight: true });
};

B.pipeValve = (c, o) => {
  // drain pipe with a missing valve wheel (tunnel escape)
  c.cyl('rust', 0, 0.9, 0, 0.09, 0.09, 1.8, 10);
  c.cyl('rust', 0, 1.1, 0.15, 0.05, 0.05, 0.3, 8, { rx: Math.PI / 2 });
  c.box('iron', 0, 1.1, 0.3, 0.04, 0.04, 0.04);
  c.collider(-0.12, -0.12, 0.12, 0.2, 0, 1.8);
  c.interact({ kind: 'valve', id: 'valve', pos: [0, 1.1, 0.35], prompt: 'Drain valve', radius: 0.8 });
  const wheel = c.part((g, slot) => {
    g.geometry('iron', new THREE.TorusGeometry(0.16, 0.02, 6, 16), new THREE.Matrix4(), { room: slot });
    g.box('iron', 0, 0, 0, 0.3, 0.02, 0.02, { room: slot });
    g.box('iron', 0, 0, 0, 0.02, 0.3, 0.02, { room: slot });
  }, 0, 1.1, 0.33, 'valveWheel');
  wheel.holder.visible = false;
  c.world.valveWheel = wheel;
};

B.altar = (c, o) => {
  // Ellie's little bed - where the music box belongs (secret ending)
  B.bed(c, { size: 'child', blanket: 'fabricPink', hide: false });
  c.box('woodPainted', 0.75, 0.3, -0.6, 0.45, 0.6, 0.4);
  c.box('ivory', 0.75, 0.61, -0.6, 0.2, 0.02, 0.15, { faces: 'Y' });
  c.interact({ kind: 'altar', id: 'altar', pos: [0.75, 0.7, -0.6], prompt: "Ellie's bedside", radius: 1.0 });
  c.world.altarPos = c.wv(0.75, 0.62, -0.6);
};

B.photoWall = (c, o) => {
  // cluster of photo frames on a wall at local -Z
  const rng = c.world.decorRng;
  for (let i = 0; i < (o.n || 5); i++) {
    const w = rng.float(0.2, 0.35), h = rng.float(0.25, 0.4);
    c.box('trimDark', rng.float(-0.6, 0.6), rng.float(1.3, 1.9), -0.01, w, h, 0.025, { ao: 1 });
  }
};

B.painting = (c, o) => {
  const w = o.w || 0.9, h = o.h || 0.7;
  c.box('gold', 0, o.y || 1.6, -0.02, w + 0.1, h + 0.1, 0.04, { ao: 1 });
  c.world.paintings.push({ f: c.f, room: c.room.index, pos: c.wv(0, o.y || 1.6, 0.005), yaw: c.ry, w, h, kind: o.kind || 'portrait' });
};

B.stool = (c, o) => {
  c.cyl('woodFurniture', 0, 0.62, 0, 0.18, 0.18, 0.04, 12);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    c.cyl('woodFurniture', Math.cos(a) * 0.12, 0.31, Math.sin(a) * 0.12, 0.018, 0.02, 0.62, 5, { rz: Math.cos(a) * 0.12, rx: -Math.sin(a) * 0.12 });
  }
  c.collider(-0.18, -0.18, 0.18, 0.18, 0, 0.64);
};

B.ladderShelf = B.shelves;

export const FURNITURE = B;

/** Build a furniture piece of `type` at (x,z) in `room`. */
export function placeFurniture(world, type, room, x, z, facing = 'S', opts = {}) {
  const b = B[type];
  if (!b) throw new Error('unknown furniture ' + type);
  const ctx = new FurnitureContext(world, room, x, z, facing, { ...opts, type });
  const res = b(ctx, opts) || {};
  return { ctx, ...res };
}
