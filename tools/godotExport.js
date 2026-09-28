// Runs inside the web game (served by Vite) and turns the built house into
// files the Godot port loads: glTF models, one JSON file of gameplay data and
// WAV sounds. Driven by scripts/godot-export.mjs.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { floorBaseY, FLOOR_CEIL, FLOOR_H, PLAYER_START, STAIRS } from '../src/world/layout.js';
import { HOLE, OUTSIDE } from '../src/world/grid.js';
import { buildItemModel, ITEM_DEFS } from '../src/game/items.js';
import { buildAccessGraph, placeItems, KEY_ITEMS, ESCAPE_ITEMS, SECRET_ITEMS } from '../src/game/placement.js';
import { RNG } from '../src/core/rng.js';
import { DIFFICULTIES } from '../src/config.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const v3 = (v) => [r3(v.x), r3(v.y), r3(v.z)];

function toGLB(object) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(object, (res) => resolve(res), (err) => reject(err), { binary: true, onlyVisible: false, maxTextureSize: 1024 });
  });
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function wav(buffer) {
  const ch = buffer.getChannelData(0);
  const n = ch.length;
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true);
  return out.buffer;
}

/** Strip what glTF (or Godot) can't use and return a clean copy for export. */
function exportable(root) {
  // userData can hold live game objects (circular); the page is thrown away after export
  root.traverse((o) => {
    o.userData = {};
    if (o.material) for (const m of [].concat(o.material)) m.userData = {};
  });
  const copy = root.clone(true);
  const drop = [];
  copy.traverse((o) => {
    if (o.isPoints || o.isLine || o.isSprite) drop.push(o);
    else if (o.isMesh) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.isShaderMaterial || m.isRawShaderMaterial || m.isMeshDistanceMaterial) { drop.push(o); return; }
      if (o.geometry.attributes.aRoom) {
        o.geometry = o.geometry.clone();
        o.geometry.deleteAttribute('aRoom');
      }
      if (o.isInstancedMesh) drop.push(o);
    }
  });
  for (const o of drop) o.removeFromParent();
  return copy;
}

export async function exportForGodot(game, save) {
  const world = game.world;
  const grid = world.grid;
  game.items.clear();

  // ------------------------------------------------------------ house model
  const house = new THREE.Group();
  house.name = 'House';
  for (const g of world.floorGroups) { g.visible = true; house.add(exportable(g)); }
  const ext = exportable(world.extGroup);
  ext.name = 'Exterior';
  house.add(ext);
  const doorsGroup = new THREE.Group();
  doorsGroup.name = 'Doors';
  for (const d of world.doorList) {
    d.object.traverse((o) => { o.userData = {}; });
    const obj = d.object.clone(true);
    obj.name = 'door_' + d.id;
    obj.children[0].name = 'pivot';
    obj.children[1].name = 'barricade1';
    obj.children[2].name = 'barricade2';
    doorsGroup.add(exportable(obj));
  }
  house.add(doorsGroup);
  await save('house.glb', b64(await toGLB(house)));

  // ------------------------------------------------------------ item models
  const items = new THREE.Group();
  items.name = 'Items';
  const M = (params) => new THREE.MeshStandardMaterial(params);
  for (const kind of Object.keys(ITEM_DEFS)) {
    const m = buildItemModel(kind, M);
    m.name = kind;
    items.add(m);
  }
  await save('items.glb', b64(await toGLB(exportable(items))));

  // ------------------------------------------------------------ gameplay data
  const rooms = grid.rooms.map((r) => ({
    index: r.index, key: r.key, name: r.name, floor: r.floor, kind: r.kind,
    cells: r.cells, cx: r3(r.cx), cz: r3(r.cz), meta: { floor: r.meta.floor, wall: r.meta.wall },
  }));
  const cells = [];
  for (let f = 0; f < grid.floorCount; f++) {
    const row = [];
    for (let z = 0; z < grid.D; z++) for (let x = 0; x < grid.W; x++) row.push(grid.cellRaw(f, x, z));
    cells.push(row);
  }
  const stairs = grid.stairs.map((s) => ({ id: s.id, lower: s.lower, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, len: s.len, dir: s.dir, baseY: s.baseY, room: s.room }));
  const colliders = world.collision.all.filter((c) => c.kind !== 'door').map((c) => ({
    f: c.f ?? -1, x0: r3(c.x0), x1: r3(c.x1), y0: r3(c.y0), y1: r3(c.y1), z0: r3(c.z0), z1: r3(c.z1), kind: c.kind, sight: !!c.sight,
  }));
  const doors = world.doorList.map((d) => ({
    id: d.id, type: d.type, f: d.f, lock: d.lock, locked: d.locked, jammed: d.jammed, heavy: d.heavy, creaky: d.creaky,
    discovered: d.discovered, breakable: d.breakable, escape: d.escape,
    pivot: v3(d.pivot.position), theta: r3(d.baseTheta ?? d.pivot.rotation.y), swingSign: d.swingSide === d.minusZSide ? 1 : -1,
    orient: d.edge.orient, span: d.span, edgeA: d.edge.a, edgeB: d.edge.b, center: [r3(d.center.x), r3(d.center.y), r3(d.center.z)],
    room1: d.room1 ? d.room1.index : -1, room2: d.room2 ? d.room2.index : -1,
    panelW: r3(d.panelW), panelH: r3(d.panelH), thick: r3(d.thick), top: r3(d.top), baseY: r3(d.baseY),
    collider: { x0: r3(d.collider.x0), x1: r3(d.collider.x1), y0: r3(d.collider.y0), y1: r3(d.collider.y1), z0: r3(d.collider.z0), z1: r3(d.collider.z1) },
  }));
  // nav graph: every walkable cell with its neighbours, as if all doors were open;
  // the door (if any) on each link is recorded so Godot can apply its state
  const restore = [];
  for (const d of world.doorList) { restore.push([d, d.isPassable]); d.isPassable = () => true; }
  const navGraph = game.cat.nav;
  const nodes = [];
  const nb = [];
  for (let f = 0; f < grid.floorCount; f++) {
    for (let z = 0; z < grid.D; z++) {
      for (let x = 0; x < grid.W; x++) {
        if (!navGraph.isNode(f, x, z)) continue;
        const n = navGraph.id(f, x, z);
        const w = navGraph.worldOf(n);
        const links = navGraph.neighbours(n, { cat: true, doors: 'any', ignoreBlocked: true }, nb).map((e) => {
          const l = { n: e.n, c: r3(e.cost) };
          if (e.door) l.door = e.door.id;
          if (e.edge && e.edge.type === 'crawl') l.crawl = true;
          return l;
        });
        nodes.push({ n, f, x, z, y: r3(w.y), room: grid.cellRaw(f, x, z), blocked: navGraph.isBlocked(f, x, z), stair: !!grid.stairAt(f, x, z), links });
      }
    }
  }
  for (const [d, fn] of restore) d.isPassable = fn;
  const vents = world.vents.map((v) => ({ id: v.id, f: v.f, x: v.x, z: v.z, side: v.side, room: v.room, pos: v3(v.pos), normal: v3(v.normal), mouth: v3(v.mouth), node: navGraph.id(v.f, v.x, v.z) }));
  const hidingSpots = world.hidingSpots.map((h) => ({
    id: h.id, type: h.type, f: h.f, room: h.room, entry: v3(h.entry), inside: v3(h.inside), exit: v3(h.exit), look: v3(h.look),
    yaw: r3(h.yaw), yawRange: h.yawRange, pitchMin: h.pitchMin, pitchMax: h.pitchMax, concealment: h.concealment,
  }));
  const itemSlots = world.itemSlots.map((s, i) => ({ i, f: s.f, room: s.room, x: r3(s.x), y: r3(s.y), z: r3(s.z), surface: s.surface }));
  const lights = world.lighting.fixtures.map((fx) => ({
    room: fx.room.index, f: fx.room.floor, type: fx.type, pos: v3(fx.pos), color: '#' + fx.color.getHexString(),
    intensity: fx.baseIntensity, range: fx.range, on: fx.on, flicker: fx.flicker, needsPower: fx.needsPower,
  }));
  const interactables = world.interactables.filter((i) => ['fusebox', 'lamp', 'switch', 'piano', 'phone'].includes(i.kind)).map((i) => ({ kind: i.kind, id: i.id, f: i.f, room: i.room, pos: v3(i.pos), radius: i.radius }));
  const windows = world.windows.map((w) => ({ f: w.f, x: r3(w.x), z: r3(w.z), style: w.style, room: w.room, outward: w.outward, sill: r3(w.sill ?? 0), head: r3(w.head ?? 0) }));

  // item layouts for many seeds, each checked solvable by the web game's placer
  const slots = world.itemSlots.filter((s) => s.surface !== 'top');
  const slotIndex = new Map(world.itemSlots.map((s, i) => [s, i]));
  const graph = buildAccessGraph(grid);
  const startRoom = grid.roomAtWorld(PLAYER_START.f, PLAYER_START.x, PLAYER_START.z).index;
  const tunnel = grid.roomByKey['0Z'].index;
  const layouts = [];
  for (let s = 0; s < 40; s++) {
    const rng = new RNG(9001 + s * 7919);
    const chosen = placeItems({ grid, graph, slots, rng, startRoom, items: [...KEY_ITEMS, ...ESCAPE_ITEMS, ...SECRET_ITEMS], forbidRooms: [tunnel] });
    if (!chosen || !chosen.size) continue;
    const out = {};
    for (const [item, slot] of chosen) out[item] = slotIndex.get(slot);
    layouts.push(out);
  }

  const data = {
    version: 1,
    grid: { W: grid.W, D: grid.D, floors: grid.floorCount, HOLE, OUTSIDE, floorH: FLOOR_H, baseY: [0, 1, 2, 3].map(floorBaseY), ceil: FLOOR_CEIL },
    playerStart: PLAYER_START, startRoom,
    rooms, cells, stairs, stairDefs: STAIRS, colliders, doors, nav: nodes, vents, hidingSpots, itemSlots, lights, interactables, windows,
    items: ITEM_DEFS, layouts, difficulties: DIFFICULTIES,
  };
  await save('house.json', btoa(unescape(encodeURIComponent(JSON.stringify(data)))));

  // ------------------------------------------------------------ sounds
  const names = [];
  if (game.audio && game.audio.buffers) {
    for (const [name, list] of game.audio.buffers) {
      for (let i = 0; i < list.length; i++) {
        const file = `${name}_${i}.wav`;
        await save('sounds/' + file, b64(wav(list[i])));
        names.push(file);
      }
    }
  }
  return { rooms: rooms.length, colliders: colliders.length, doors: doors.length, nav: nodes.length, spots: hidingSpots.length, slots: itemSlots.length, lights: lights.length, layouts: layouts.length, sounds: names.length };
}
