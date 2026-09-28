// Runs inside the web game (served by Vite) and writes everything the Unreal
// project needs: geometry in a compact binary (.chm), textures (with bump maps
// turned into normal maps), decal/note art, sounds and one JSON of gameplay
// data and texts. Driven by scripts/unreal-export.mjs.
//
// Everything stays in the web game's coordinates (metres, Y up); the Unreal
// code converts: UE = (x, z, y) * 100.
import * as THREE from 'three';
import { floorBaseY, FLOOR_CEIL, FLOOR_H, PLAYER_START, STAIRS, WALL_T, EXT_WALL_T } from '../src/world/layout.js';
import { HOLE, OUTSIDE } from '../src/world/grid.js';
import { buildItemModel, ITEM_DEFS, ESCAPE_ROUTES } from '../src/game/items.js';
import { buildAccessGraph, placeItems, KEY_ITEMS, ESCAPE_ITEMS, SECRET_ITEMS } from '../src/game/placement.js';
import { RNG } from '../src/core/rng.js';
import { DIFFICULTIES, PLAYER, NOISE } from '../src/config.js';
import { DOCUMENTS } from '../src/game/story.js';
import { DEATH_LINES } from '../src/game/cutscenes.js';
import { drawingTexture, photoTexture, paperTexture, decalTexture } from '../src/world/art.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const v3 = (v) => [r3(v.x), r3(v.y), r3(v.z)];

const WALL_WRITING = ['COME OUT COME OUT', 'HE CHECKS THE WARDROBES', 'IT LEARNS', "WE'RE STILL PLAYING", 'NOT UNDER THE BED', 'FOUND YOU', 'LOOK UP', 'DONT HIDE TWICE', 'SHE IS HIDING', 'ELLIE?'];
const DRAWING_CAPTIONS = ['ME AND MR GRIN', 'HIDE AND SEEK', 'MY FRIEND', 'HE FOUND ME', 'MR GRIN', 'PLAY WITH ME'];
const ENDINGS = {
  front: { title: 'Out the Front Door', text: 'The chain falls away and the door swings open onto the rain.\nYou run down the path without looking back. You almost make it to the gate before you do.\nIn the window above the door, something tall is standing very still. Waving.' },
  car: { title: 'Headlights', text: 'The garage door clears the roof of the car and you floor it.\nSomething rolls off the hood and into the dark. In the mirror, two small lights watch you go.\nYou do not stop driving until the sun comes up.' },
  attic: { title: 'Over the Roof', text: 'Hand over hand down the wet rope, the house groaning against your back.\nWhen your feet touch the mud you finally look up. It is in the attic window. Smiling.\nIt does not follow. Not tonight.' },
  tunnel: { title: 'Through the Dark Water', text: 'You crawl for a long time through water and rot, until the tunnel turns upward into a rusted ladder and a manhole cover and the smell of wet streets.\nBehind you, far back in the dark, something laughs. Then it stops.' },
  secret: { title: 'Game Over, Ellie Wins', text: 'The little song winds down. Mister Grin sits by her bed and listens, and his eyes go sleepy, and he is only a toy.\nBehind the tiny door there is a narrow crawlspace full of old drawings and warm morning light.\nYou are sure you hear a little girl laugh. "Thank you for playing with him."' },
};

// ------------------------------------------------------------------ binary writer
class Bin {
  constructor() { this.parts = []; this.size = 0; }
  push(buf) { this.parts.push(buf); this.size += buf.byteLength; }
  u8(v) { this.push(new Uint8Array([v])); }
  u32(v) { const b = new Uint32Array([v]); this.push(new Uint8Array(b.buffer)); }
  str(s) {
    const e = new TextEncoder().encode(s);
    const b = new Uint16Array([e.length]);
    this.push(new Uint8Array(b.buffer));
    this.push(e);
  }
  f32(arr) { this.push(new Uint8Array(new Float32Array(arr).buffer)); }
  bytes(arr) { this.push(new Uint8Array(arr)); }
  i32(arr) { this.push(new Uint8Array(new Uint32Array(arr).buffer)); }
  blob() {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ textures
function imageCanvas(image) {
  if (!image) return null;
  const w = image.width || (image.image && image.image.width);
  const h = image.height || (image.image && image.image.height);
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (image.data && !(image instanceof HTMLCanvasElement)) {
    // DataTexture: RGBA bytes
    const id = ctx.createImageData(w, h);
    const src = image.data;
    for (let i = 0; i < w * h; i++) {
      const s = src.length === w * h * 4 ? 4 : src.length === w * h * 3 ? 3 : 1;
      id.data[i * 4] = src[i * s];
      id.data[i * 4 + 1] = src[i * s + (s > 1 ? 1 : 0)];
      id.data[i * 4 + 2] = src[i * s + (s > 1 ? 2 : 0)];
      id.data[i * 4 + 3] = s === 4 ? src[i * s + 3] : 255;
    }
    ctx.putImageData(id, 0, 0);
  } else {
    ctx.drawImage(image, 0, 0);
  }
  return c;
}

function pngBytes(canvas) {
  const url = canvas.toDataURL('image/png');
  const bin = atob(url.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Height map -> tangent-space normal map (DirectX green, as Unreal expects). */
function bumpToNormal(canvas, strength) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const id = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      id.data[i] = (nx * 0.5 + 0.5) * 255;
      id.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      id.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      id.data[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

// ------------------------------------------------------------------ export
export async function exportForUnreal(game, save) {
  const world = game.world;
  const grid = world.grid;
  game.items.clear();
  if (game.story && game.story.clear) game.story.clear();
  if (game.cat && game.cat.face) game.cat.face.root.visible = false;
  game.scene.updateMatrixWorld(true);
  for (const d of world.doorList) d.object.updateMatrixWorld(true);

  // ---------------------------------------------------------- materials & textures
  const texIds = new Map();     // texture -> file base name
  const normalIds = new Map();  // bump texture -> normal file base name
  const matList = [];
  const matIds = new Map();
  let texCount = 0;
  const texFile = async (tex) => {
    if (!tex || !tex.image) return null;
    if (texIds.has(tex)) return texIds.get(tex);
    const c = imageCanvas(tex.image);
    if (!c) return null;
    const name = 'T_' + (tex.name ? tex.name.replace(/[^A-Za-z0-9]/g, '') + '_' : '') + (texCount++);
    await save('Textures/' + name + '.png', b64(pngBytes(c)));
    texIds.set(tex, name);
    return name;
  };
  const normalFile = async (tex, scale) => {
    if (!tex || !tex.image) return null;
    const key = tex;
    if (normalIds.has(key)) return normalIds.get(key);
    const c = imageCanvas(tex.image);
    if (!c) return null;
    const name = 'N_' + (tex.name ? tex.name.replace(/[^A-Za-z0-9]/g, '') + '_' : '') + (texCount++);
    await save('Textures/' + name + '.png', b64(pngBytes(bumpToNormal(c, 2.5 * Math.max(0.5, Math.min(3, scale || 1))))));
    normalIds.set(key, name);
    return name;
  };
  const matIndex = async (m) => {
    if (matIds.has(m)) return matIds.get(m);
    const rec = {
      name: m.name || m.type,
      unlit: !!m.isMeshBasicMaterial,
      color: '#' + (m.color ? m.color.getHexString() : 'ffffff'),
      roughness: m.roughness ?? 0.8,
      metalness: m.metalness ?? 0,
      emissive: m.emissive ? '#' + m.emissive.getHexString() : '#000000',
      emissiveIntensity: m.emissiveIntensity ?? 0,
      transparent: !!m.transparent,
      opacity: m.opacity ?? 1,
      map: await texFile(m.map),
      normal: m.bumpMap ? await normalFile(m.bumpMap, m.bumpScale) : null,
      vertexColors: !!m.vertexColors,
    };
    const i = matList.length;
    matList.push(rec);
    matIds.set(m, i);
    return i;
  };

  // ---------------------------------------------------------- geometry
  const groups = new Map(); // key -> {name, parts: [{mat, geo(baked)}]}
  const addPart = async (key, mesh, toLocal = null) => {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!m || m.isShaderMaterial || m.isRawShaderMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial) return;
    let g = mesh.geometry.clone();
    if (g.index === null) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat4 = mesh.matrixWorld.clone();
    if (toLocal) mat4.premultiply(toLocal);
    g.applyMatrix4(mat4);
    // bake the texture transform into the UVs, then flip V for Unreal (top-left origin)
    const uv = g.attributes.uv;
    if (uv) {
      const map = m.map;
      const tm = map ? (map.updateMatrix(), map.matrix) : null;
      const out = new Float32Array(uv.count * 2);
      const v = new THREE.Vector3();
      for (let i = 0; i < uv.count; i++) {
        v.set(uv.getX(i), uv.getY(i), 1);
        if (tm && map.matrixAutoUpdate !== false) v.applyMatrix3(tm);
        const flip = map ? map.flipY !== false : true;
        out[i * 2] = v.x;
        out[i * 2 + 1] = flip ? 1 - v.y : v.y;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
    }
    const mi = await matIndex(m);
    if (!groups.has(key)) groups.set(key, { key, parts: [] });
    groups.get(key).parts.push({ mat: mi, geo: g, color: !!g.attributes.color });
  };

  const special = new Map(); // object3d -> key (and the matrix its geometry is made local to)
  const localTo = new Map();
  world.lighting.fixtures.forEach((fx, i) => { for (const b of fx.bulbs) special.set(b, 'fx:' + i); });
  world.tvs.forEach((tv, i) => { if (tv.mesh) special.set(tv.mesh, 'tv:' + i); });
  world.mirrors.forEach((mr, i) => { if (mr.dark) special.set(mr.dark, 'mirror:' + i); if (mr.reflector) special.set(mr.reflector, 'skip'); });
  world.rockingChairs.forEach((ch, i) => {
    if (ch.part && ch.part.holder) {
      special.set(ch.part.holder, 'rock:' + i);
      localTo.set('rock:' + i, ch.part.holder.matrixWorld.clone().invert());
    }
  });
  const obj = game.objectives;
  if (obj) {
    if (obj.boardGroup) special.set(obj.boardGroup, 'atticBoards');
    if (obj.water) special.set(obj.water, 'water');
  }
  if (world.valveWheel && world.valveWheel.holder) {
    special.set(world.valveWheel.holder, 'valveWheel');
    world.valveWheel.holder.visible = true;
  }

  const walk = async (o, key, floorKey) => {
    if (special.has(o)) key = special.get(o);
    if (key === 'skip') return;
    if (o.isPoints || o.isLine || o.isSprite) return;
    if (o.isMesh) {
      const k = key || floorKey;
      await addPart(k, o, localTo.get(k) || null);
    }
    for (const c of o.children) await walk(c, key, floorKey);
  };
  for (let f = 0; f < world.floorGroups.length; f++) await walk(world.floorGroups[f], null, 'static:' + f);
  await walk(world.extGroup, null, 'static:ext');
  const doorsOut = [];
  for (const d of world.doorList) {
    const inv = d.pivot.matrixWorld.clone().invert();
    for (const c of d.pivot.children) await walk(c, null, 'door:' + d.id);
    // walk() uses world space; redo the door group in pivot space
    const g = groups.get('door:' + d.id);
    if (g) {
      for (const part of g.parts) part.geo.applyMatrix4(inv);
    }
    for (const side of [1, 2]) {
      const bg = d.barricadeGroups[side];
      bg.grp.children.forEach((plank, i) => {
        plank.updateMatrixWorld(true);
      });
      for (let i = 0; i < bg.grp.children.length; i++) {
        const plank = bg.grp.children[i];
        const prev = bg.grp.visible;
        bg.grp.visible = true;
        await walk(plank, 'bar:' + d.id + ':' + side + ':' + i, null);
        bg.grp.visible = prev;
      }
    }
    doorsOut.push(d);
  }

  // ---------------------------------------------------------- write geometry (merged per group+material)
  const bin = new Bin();
  bin.bytes(new TextEncoder().encode('CHM1'));
  const meshRecords = [];
  for (const g of groups.values()) {
    const byMat = new Map();
    for (const p of g.parts) {
      if (!byMat.has(p.mat)) byMat.set(p.mat, []);
      byMat.get(p.mat).push(p);
    }
    for (const [mat, parts] of byMat) meshRecords.push({ name: g.key, mat, parts });
  }
  bin.u32(meshRecords.length);
  let totalVerts = 0;
  for (const r of meshRecords) {
    let nv = 0, ni = 0, anyColor = false;
    for (const p of r.parts) { nv += p.geo.attributes.position.count; ni += p.geo.index.count; anyColor = anyColor || p.color; }
    totalVerts += nv;
    bin.str(r.name);
    bin.u32(r.mat);
    bin.u32(nv);
    bin.u32(ni);
    bin.u8(anyColor ? 1 : 0);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Uint8Array(anyColor ? nv * 4 : 0), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const p of r.parts) {
      const a = p.geo.attributes;
      const n = a.position.count;
      for (let i = 0; i < n; i++) {
        pos[(vo + i) * 3] = a.position.getX(i); pos[(vo + i) * 3 + 1] = a.position.getY(i); pos[(vo + i) * 3 + 2] = a.position.getZ(i);
        nrm[(vo + i) * 3] = a.normal.getX(i); nrm[(vo + i) * 3 + 1] = a.normal.getY(i); nrm[(vo + i) * 3 + 2] = a.normal.getZ(i);
        if (a.uv) { uv[(vo + i) * 2] = a.uv.getX(i); uv[(vo + i) * 2 + 1] = a.uv.getY(i); }
        if (anyColor) {
          const c = a.color;
          const k = (x) => Math.max(0, Math.min(255, Math.round((c ? x : 1) * 255)));
          col[(vo + i) * 4] = k(c ? c.getX(i) : 1); col[(vo + i) * 4 + 1] = k(c ? c.getY(i) : 1); col[(vo + i) * 4 + 2] = k(c ? c.getZ(i) : 1); col[(vo + i) * 4 + 3] = 255;
        }
      }
      const ix = p.geo.index;
      for (let i = 0; i < ix.count; i++) idx[io + i] = ix.getX(i) + vo;
      vo += n; io += ix.count;
    }
    bin.f32(pos); bin.f32(nrm); bin.f32(uv);
    if (anyColor) bin.bytes(col);
    bin.i32(idx);
  }
  await save('Data/house.chm', b64(bin.blob()));

  // ---------------------------------------------------------- items (local space)
  const ibin = new Bin();
  ibin.bytes(new TextEncoder().encode('CHM1'));
  const itemRecs = [];
  const itemMats = [];
  const itemMatIds = new Map();
  for (const kind of Object.keys(ITEM_DEFS)) {
    const M = (params) => new THREE.MeshStandardMaterial(params);
    const model = buildItemModel(kind, M);
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      let g = o.geometry.clone();
      if (!g.index) { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); }
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      const key = m.color.getHexString() + ':' + (m.emissive ? m.emissive.getHexString() : '') + ':' + r3(m.roughness) + ':' + r3(m.metalness);
      if (!itemMatIds.has(key)) {
        itemMatIds.set(key, itemMats.length);
        itemMats.push({ color: '#' + m.color.getHexString(), roughness: m.roughness, metalness: m.metalness, emissive: '#' + (m.emissive ? m.emissive.getHexString() : '000000'), emissiveIntensity: m.emissiveIntensity ?? 0 });
      }
      itemRecs.push({ name: 'item:' + kind, mat: itemMatIds.get(key), geo: g });
    });
  }
  ibin.u32(itemRecs.length);
  for (const r of itemRecs) {
    const a = r.geo.attributes;
    const n = a.position.count;
    ibin.str(r.name); ibin.u32(r.mat); ibin.u32(n); ibin.u32(r.geo.index.count); ibin.u8(0);
    ibin.f32(a.position.array.length === n * 3 ? a.position.array : Array.from({ length: n * 3 }, (_, i) => a.position.getComponent(Math.floor(i / 3), i % 3)));
    ibin.f32(Array.from({ length: n * 3 }, (_, i) => a.normal.getComponent(Math.floor(i / 3), i % 3)));
    ibin.f32(a.uv ? Array.from({ length: n * 2 }, (_, i) => a.uv.getComponent(Math.floor(i / 2), i % 2)) : new Float32Array(n * 2));
    ibin.i32(Array.from({ length: r.geo.index.count }, (_, i) => r.geo.index.getX(i)));
  }
  await save('Data/items.chm', b64(ibin.blob()));

  // ---------------------------------------------------------- decal / note art
  const art = { drawings: [], photos: {}, blood: [], drag: [], claws: [], hand: [], writing: [], paper: {} };
  const saveArt = async (tex, name) => {
    const c = imageCanvas(tex.image);
    await save('Decals/' + name + '.png', b64(pngBytes(c)));
    return name;
  };
  for (let i = 0; i < DRAWING_CAPTIONS.length; i++) art.drawings.push(await saveArt(drawingTexture(101 + i * 17, DRAWING_CAPTIONS[i]), 'D_Drawing_' + i));
  for (const kind of ['family', 'hallway', 'bedroom', 'victim']) {
    art.photos[kind] = [];
    for (let i = 0; i < 3; i++) art.photos[kind].push(await saveArt(photoTexture(kind, 300 + i * 31), `D_Photo_${kind}_${i}`));
  }
  for (let i = 0; i < 5; i++) art.blood.push(await saveArt(decalTexture('blood', 500 + i * 13), 'D_Blood_' + i));
  for (let i = 0; i < 2; i++) art.drag.push(await saveArt(decalTexture('drag', 600 + i * 13), 'D_Drag_' + i));
  for (let i = 0; i < 3; i++) art.claws.push(await saveArt(decalTexture('claws', 700 + i * 13), 'D_Claws_' + i));
  for (let i = 0; i < 2; i++) art.hand.push(await saveArt(decalTexture('hand', 800 + i * 13), 'D_Hand_' + i));
  for (let i = 0; i < WALL_WRITING.length; i++) art.writing.push(await saveArt(decalTexture('writing', 900 + i * 13, WALL_WRITING[i]), 'D_Writing_' + i));
  for (const style of ['paper', 'journal', 'crayon']) {
    art.paper[style] = [];
    for (let i = 0; i < 2; i++) art.paper[style].push(await saveArt(paperTexture(1000 + i * 7, style), `D_Paper_${style}_${i}`));
  }

  // ---------------------------------------------------------- gameplay data
  const rooms = grid.rooms.map((r) => ({
    index: r.index, key: r.key, name: r.name, floor: r.floor, kind: r.kind, cells: r.cells,
    cx: r3(r.cx), cz: r3(r.cz), floorMat: r.meta.floor || '', lightFrom: r.meta.lightFrom || '',
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
  const doors = doorsOut.map((d) => ({
    id: d.id, type: d.type, f: d.f, lock: d.lock, locked: d.locked, jammed: d.jammed, heavy: d.heavy, creaky: d.creaky,
    discovered: d.discovered, breakable: d.breakable, escape: d.escape,
    pivot: v3(d.pivot.position), theta: r3(d.baseTheta), swingSign: d.swingSide === d.minusZSide ? 1 : -1,
    orient: d.edge.orient, span: d.span, edgeA: d.edge.a, edgeB: d.edge.b, center: [r3(d.center.x), r3(d.center.y), r3(d.center.z)],
    room1: d.room1 ? d.room1.index : -1, room2: d.room2 ? d.room2.index : -1,
    panelW: r3(d.panelW), panelH: r3(d.panelH), thick: r3(d.thick), top: r3(d.top), baseY: r3(d.baseY),
    planks: [d.barricadeGroups[1].grp.children.length, d.barricadeGroups[2].grp.children.length],
    collider: { x0: r3(d.collider.x0), x1: r3(d.collider.x1), y0: r3(d.collider.y0), y1: r3(d.collider.y1), z0: r3(d.collider.z0), z1: r3(d.collider.z1) },
  }));
  // nav graph (as if every door were open; the door on each link is recorded)
  const restore = [];
  for (const d of world.doorList) { restore.push([d, d.isPassable]); d.isPassable = () => true; }
  const nav = game.cat.nav;
  const nodes = [];
  const nb = [];
  for (let f = 0; f < grid.floorCount; f++) {
    for (let z = 0; z < grid.D; z++) {
      for (let x = 0; x < grid.W; x++) {
        if (!nav.isNode(f, x, z)) continue;
        const n = nav.id(f, x, z);
        const w = nav.worldOf(n);
        const links = nav.neighbours(n, { cat: true, doors: 'any', ignoreBlocked: true }, nb).map((e) => {
          const l = { n: e.n, c: r3(e.cost) };
          if (e.door) l.door = e.door.id;
          if (e.edge && e.edge.type === 'crawl') l.crawl = true;
          return l;
        });
        nodes.push({ n, f, x, z, y: r3(w.y), room: grid.cellRaw(f, x, z), blocked: nav.isBlocked(f, x, z), stair: !!grid.stairAt(f, x, z), links });
      }
    }
  }
  for (const [d, fn] of restore) d.isPassable = fn;
  const vents = world.vents.map((v) => ({ id: v.id, f: v.f, x: v.x, z: v.z, side: v.side, room: v.room, pos: v3(v.pos), normal: v3(v.normal), mouth: v3(v.mouth), node: nav.id(v.f, v.x, v.z) }));
  const hidingSpots = world.hidingSpots.map((h) => ({
    id: h.id, type: h.type, f: h.f, room: h.room, entry: v3(h.entry), inside: v3(h.inside), exit: v3(h.exit), look: v3(h.look),
    yaw: r3(h.yaw), yawRange: h.yawRange, pitchMin: h.pitchMin, pitchMax: h.pitchMax, concealment: h.concealment,
  }));
  const itemSlots = world.itemSlots.map((s, i) => ({ i, f: s.f, room: s.room, x: r3(s.x), y: r3(s.y), z: r3(s.z), surface: s.surface }));
  const lights = world.lighting.fixtures.map((fx, i) => ({
    index: i, room: fx.room.index, f: fx.room.floor, type: fx.type, pos: v3(fx.pos), color: '#' + fx.color.getHexString(),
    intensity: fx.baseIntensity, range: fx.range, on: fx.on, flicker: fx.flicker, needsPower: fx.needsPower,
  }));
  const fixtureIndex = new Map(world.lighting.fixtures.map((fx, i) => [fx, i]));
  const switches = world.lighting.switches.map((sw) => ({ room: sw.room.index, f: sw.room.floor, pos: v3(sw.pos), fixtures: sw.fixtures.map((fx) => fixtureIndex.get(fx)) }));
  const interactables = world.interactables.filter((i) => !['note', 'switch'].includes(i.kind)).map((i) => ({
    kind: i.kind, id: i.id || '', f: i.f, room: i.room, pos: v3(i.pos), radius: i.radius || 0.6, prompt: i.prompt || '',
    fixture: i.fixture ? fixtureIndex.get(i.fixture) : -1,
  }));
  const windows = world.windows.map((w) => ({ f: w.f, x: r3(w.x), z: r3(w.z), style: w.style, room: w.room, outward: w.outward, sill: r3(w.sill ?? 0), head: r3(w.head ?? 0) }));
  const mirrors = world.mirrors.map((m) => ({ f: m.f, room: m.room, pos: v3(m.pos), yaw: r3(m.yaw), w: m.w, h: m.h }));
  const tvs = world.tvs.map((t) => ({ f: t.f, room: t.room, pos: v3(t.pos), yaw: r3(t.yaw), id: t.id }));
  const rockingChairs = world.rockingChairs.map((c) => ({ pos: v3(c.part.holder.getWorldPosition(new THREE.Vector3())), yaw: r3(c.part.holder.rotation.y), f: c.part.holder.userData.floor ?? 1 }));
  const soundSources = world.soundSources.map((s) => ({ kind: s.kind, f: s.f, pos: v3(s.pos) }));
  const fireplaces = world.fireplaces.map((s) => ({ f: s.f, room: s.room, pos: v3(s.pos) }));
  // wall faces per room (for pinned drawings, writing, claw marks)
  const wallFaces = grid.rooms.map(() => []);
  for (const e of grid.edges.values()) {
    if (e.type !== 'wall') continue;
    for (const which of [1, 2]) {
      const r = which === 1 ? e.r1 : e.r2;
      if (r < 0) continue;
      const t = (e.exterior ? EXT_WALL_T : WALL_T) / 2 + 0.012;
      const dir = which === 1 ? -1 : 1;
      const pos = e.orient === 'V' ? [e.a + dir * t, e.b + 0.5] : [e.a + 0.5, e.b + dir * t];
      const normal = e.orient === 'V' ? [dir, 0] : [0, dir];
      wallFaces[r].push({ x: r3(pos[0]), z: r3(pos[1]), nx: normal[0], nz: normal[1] });
    }
  }
  // item layouts for many seeds, each checked solvable by the web game's placer
  const slots = world.itemSlots.filter((s) => s.surface !== 'top');
  const slotIndex = new Map(world.itemSlots.map((s, i) => [s, i]));
  const graph = buildAccessGraph(grid);
  const startRoom = grid.roomAtWorld(PLAYER_START.f, PLAYER_START.x, PLAYER_START.z).index;
  const tunnel = grid.roomByKey['0Z'].index;
  const layouts = [];
  for (let s = 0; s < 60; s++) {
    const rng = new RNG(9001 + s * 7919);
    const chosen = placeItems({ grid, graph, slots, rng, startRoom, items: [...KEY_ITEMS, ...ESCAPE_ITEMS, ...SECRET_ITEMS], forbidRooms: [tunnel] });
    if (!chosen || !chosen.size) continue;
    const out = {};
    for (const [item, slot] of chosen) out[item] = slotIndex.get(slot);
    layouts.push(out);
  }
  const extras = {
    altarPos: world.altarPos ? v3(world.altarPos) : null,
    valveWheel: world.valveWheel ? v3(world.valveWheel.holder.getWorldPosition(new THREE.Vector3())) : null,
    water: obj && obj.water ? v3(obj.water.position) : null,
    atticWindow: obj && obj.atticWin ? v3(obj.atticWin.pos) : null,
    fuseBox: world.fuseBoxPos ? v3(world.fuseBoxPos) : null,
  };
  const data = {
    version: 1,
    grid: { W: grid.W, D: grid.D, floors: grid.floorCount, HOLE, OUTSIDE, floorH: FLOOR_H, baseY: [0, 1, 2, 3].map(floorBaseY), ceil: FLOOR_CEIL },
    playerStart: PLAYER_START, startRoom,
    rooms, cells, stairs, stairDefs: STAIRS, colliders, doors, nav: nodes, vents, hidingSpots, itemSlots, lights, switches,
    interactables, windows, mirrors, tvs, rockingChairs, soundSources, fireplaces, wallFaces, extras,
    items: ITEM_DEFS, escapeRoutes: ESCAPE_ROUTES, layouts, difficulties: DIFFICULTIES, player: PLAYER, noise: NOISE,
    materials: matList, itemMaterials: itemMats, art,
    texts: { documents: DOCUMENTS, wallWriting: WALL_WRITING, endings: ENDINGS, deathLines: DEATH_LINES },
  };
  await save('Data/house.json', btoa(unescape(encodeURIComponent(JSON.stringify(data)))));

  // ---------------------------------------------------------- sounds
  let sounds = 0;
  if (game.audio && game.audio.buffers) {
    for (const [name, list] of game.audio.buffers) {
      for (let i = 0; i < list.length; i++) {
        await save(`Sounds/S_${name.replace(/[^A-Za-z0-9]/g, '_')}_${i}.wav`, b64(new Uint8Array(wavBytes(list[i]))));
        sounds++;
      }
    }
  }
  return { meshes: meshRecords.length, verts: totalVerts, materials: matList.length, textures: texCount, doors: doors.length, nav: nodes.length, layouts: layouts.length, sounds, items: itemRecs.length };
}

function wavBytes(buffer) {
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
