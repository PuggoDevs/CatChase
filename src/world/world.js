// Assembles the whole house and owns every world-side registry: colliders,
// doors, hiding spots, item slots, interactables, fixtures, windows...
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { getGrid } from './grid.js';
import { TextureLib } from './textures.js';
import { MaterialLib } from './materials.js';
import { GeoBuilder } from './geo.js';
import { ArchitectureBuilder } from './architecture.js';
import { CollisionWorld } from './collision.js';
import { Door } from './doors.js';
import { furnish } from './furnishing.js';
import { LightingSystem } from './lights.js';
import { Exterior, EXT_FLOOR } from './exterior.js';
import { OPENINGS, VENTS, floorBaseY, WALL_T, EXT_WALL_T } from './layout.js';
import { RNG } from '../core/rng.js';
import { paintArt } from './art.js';
import { setObjectRoom } from './roomLighting.js';

export const MIRROR_LAYER = 2; // things only mirrors can see

export class World {
  constructor({ scene, renderer, events, quality = 'high' }) {
    this.scene = scene;
    this.renderer = renderer;
    this.events = events;
    this.quality = quality;
    this.grid = getGrid();
    this.collision = new CollisionWorld(this.grid.W, this.grid.D);
    this.furnitureColliders = [];
    this.itemSlots = [];
    this.hidingSpots = [];
    this.interactables = [];
    this.tvs = [];
    this.mirrors = [];
    this.paintings = [];
    this.fireplaces = [];
    this.soundSources = [];
    this.rockingChairs = [];
    this.animators = [];
    this.windows = [];
    this.doors = new Map();
    this.doorList = [];
    this.vents = [];
    this.decorRng = new RNG(20240613);
    this.floorGroups = [];
    for (let f = 0; f < this.grid.floorCount; f++) {
      const g = new THREE.Group();
      g.name = 'floor' + f;
      this.floorGroups.push(g);
      scene.add(g);
    }
    this.extGroup = new THREE.Group();
    this.extGroup.name = 'exterior';
    scene.add(this.extGroup);
    this.activeFloor = 1;
    this.time = 0;
  }

  addDynamicObject(obj, f) {
    if (f === EXT_FLOOR || f == null) this.extGroup.add(obj);
    else this.floorGroups[f].add(obj);
  }

  async build(onProgress = () => {}) {
    const step = async (p, label) => { onProgress(p, label); await new Promise((r) => setTimeout(r, 0)); };
    this.textures = new TextureLib(this.renderer);
    await this.textures.preload((p, name) => onProgress(p * 0.55, 'Painting ' + name));
    this.lighting = new LightingSystem(this);
    this.materials = new MaterialLib(this.textures, this.lighting.table);
    this.staticGeo = new GeoBuilder(this.materials);
    await step(0.58, 'Raising walls');
    const arch = new ArchitectureBuilder(this.grid, this.staticGeo);
    const { colliders, windows } = arch.build();
    for (const c of colliders) this.collision.addStatic(c);
    this.windows = windows;
    await step(0.64, 'Hanging doors');
    this._buildDoors();
    await step(0.7, 'Moving furniture');
    furnish(this);
    await step(0.78, 'Wiring lights');
    this.lighting.build();
    this._buildVents();
    await step(0.82, 'Summoning the storm');
    this.exterior = new Exterior(this);
    this.exterior.build();
    await step(0.86, 'Framing pictures');
    this._buildPaintings();
    this._buildTVs();
    this._buildMirrors();
    await step(0.92, 'Merging geometry');
    const { byFloor } = this.staticGeo.build();
    for (const [f, meshes] of byFloor) {
      for (const m of meshes) {
        if (f === EXT_FLOOR) this.extGroup.add(m);
        else this.floorGroups[f].add(m);
      }
    }
    this.navBlocked = this._computeNavBlocked();
    await step(1, 'The house is awake');
  }

  // ---------------------------------------------------------------- doors
  _buildDoors() {
    const g = this.grid;
    const DOORLIKE = new Set(['door', 'secret', 'bookshelf', 'front', 'garage', 'grate', 'tiny']);
    for (const op of OPENINGS) {
      if (!DOORLIKE.has(op.type) || op.part) continue;
      const e = g.edgeAt(op.f, op.x, op.z, op.side);
      if (!e) continue;
      // gather collinear "part" edges of multi-leaf doors
      const extra = [];
      for (const other of OPENINGS) {
        if (!other.part || other.type !== op.type || other.f !== op.f) continue;
        const oe = g.edgeAt(other.f, other.x, other.z, other.side);
        if (oe && oe.orient === e.orient && (oe.orient === 'V' ? oe.a === e.a : oe.b === e.b)) extra.push(oe);
      }
      const door = new Door(this, e, op, extra);
      this.doors.set(door.id, door);
      this.doorList.push(door);
    }
  }

  // ---------------------------------------------------------------- vents
  _buildVents() {
    const geo = this.staticGeo;
    for (const v of VENTS) {
      const room = this.grid.rooms[this.grid.cellRaw(v.f, v.x, v.z)];
      const e = this.grid.edgeAt(v.f, v.x, v.z, v.side);
      const t = e ? (e.exterior ? EXT_WALL_T : WALL_T) / 2 : 0.07;
      const base = floorBaseY(v.f);
      let x = v.x + 0.5, z = v.z + 0.5, nx = 0, nz = 0;
      if (v.side === 'N') { z = v.z + t + 0.01; nz = 1; }
      if (v.side === 'S') { z = v.z + 1 - t - 0.01; nz = -1; }
      if (v.side === 'W') { x = v.x + t + 0.01; nx = 1; }
      if (v.side === 'E') { x = v.x + 1 - t - 0.01; nx = -1; }
      const y = base + 0.28;
      geo.floor = v.f;
      const vertical = nx !== 0;
      geo.box('void', x - nx * 0.005, y, z - nz * 0.005, vertical ? 0.01 : 0.5, 0.3, vertical ? 0.5 : 0.01, { room: room.lightSlot, ao: 1 });
      for (let i = 0; i < 5; i++) {
        const yy = y - 0.11 + i * 0.055;
        geo.box('metal', x + nx * 0.006, yy, z + nz * 0.006, vertical ? 0.012 : 0.5, 0.018, vertical ? 0.5 : 0.012, { room: room.lightSlot, ao: 1 });
      }
      geo.box('metal', x + nx * 0.004, y, z + nz * 0.004, vertical ? 0.008 : 0.56, 0.36, vertical ? 0.56 : 0.008, { room: room.lightSlot, ao: 1, faces: vertical ? 'xX' : 'zZ' });
      this.vents.push({ ...v, room: room.index, pos: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(nx, 0, nz), mouth: new THREE.Vector3(x + nx * 0.5, base, z + nz * 0.5) });
    }
  }

  // ---------------------------------------------------------------- art / tv / mirrors
  _buildPaintings() {
    for (const p of this.paintings) {
      const tex = paintArt(p.kind, this.decorRng.int(0, 1e6));
      const mat = this.materials.custom({ map: tex, roughness: 0.75 }, 'painting');
      setObjectRoom(mat, this.grid.rooms[p.room].lightSlot);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
      m.position.copy(p.pos);
      m.rotation.y = p.yaw;
      m.receiveShadow = true;
      p.mesh = m;
      this.addDynamicObject(m, p.f);
    }
  }

  _buildTVs() {
    for (const tv of this.tvs) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 96;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.38), mat);
      m.position.copy(tv.pos);
      m.rotation.y = tv.yaw;
      this.addDynamicObject(m, tv.f);
      Object.assign(tv, { canvas: c, ctx: c.getContext('2d'), tex, mat, mesh: m, on: false, face: 0, timer: 0 });
      const room = this.grid.rooms[tv.room];
      tv.fixture = this.lighting.fixtures.find((fx) => fx.type === 'tv' && fx.room === room) || null;
    }
  }

  setTV(tv, on, face = 0) {
    tv.on = on;
    tv.face = face;
    if (!on) {
      tv.mat.color.setHex(0x000000);
      if (tv.fixture) tv.fixture.tvLevel = 0;
    }
  }

  _updateTVs(dt, t) {
    for (const tv of this.tvs) {
      if (!tv.on) continue;
      if (!this.lighting.power) { this.setTV(tv, false); continue; }
      tv.timer -= dt;
      if (tv.timer > 0) continue;
      tv.timer = 1 / 15;
      const { ctx } = tv;
      const img = ctx.createImageData(128, 96);
      const d = img.data;
      const roll = (t * 40) % 96;
      for (let i = 0; i < 128 * 96; i++) {
        const y = (i / 128) | 0;
        const v = Math.random() * 200 * (Math.abs(y - roll) < 6 ? 1.3 : 1);
        d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v * 1.05; d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (tv.face > 0) {
        // the grin, surfacing through the static
        ctx.globalAlpha = Math.min(1, tv.face);
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(64, 50, 38, 32, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8f080';
        ctx.beginPath(); ctx.ellipse(48, 42, 7, 9, 0, 0, Math.PI * 2); ctx.ellipse(80, 42, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000';
        ctx.fillRect(47, 35, 2, 14); ctx.fillRect(79, 35, 2, 14);
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(64, 50, 26, 0.25, Math.PI - 0.25); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      tv.tex.needsUpdate = true;
      tv.mat.color.setScalar(1.6);
      if (tv.fixture) tv.fixture.tvLevel = 0.7 + Math.random() * 0.3;
    }
  }

  _buildMirrors() {
    for (const mr of this.mirrors) {
      const size = this.quality === 'low' ? 256 : 512;
      const reflector = new Reflector(new THREE.PlaneGeometry(mr.w, mr.h), {
        textureWidth: size, textureHeight: size, color: 0x8a8a8a, clipBias: 0.003,
      });
      reflector.position.copy(mr.pos);
      reflector.rotation.y = mr.yaw;
      reflector.visible = false;
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(mr.w, mr.h), new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.08, metalness: 0.6 }));
      dark.position.copy(mr.pos);
      dark.rotation.y = mr.yaw;
      this.addDynamicObject(reflector, mr.f);
      this.addDynamicObject(dark, mr.f);
      mr.reflector = reflector;
      mr.dark = dark;
      mr.normal = new THREE.Vector3(Math.sin(mr.yaw), 0, Math.cos(mr.yaw));
    }
  }

  /** Enable at most one live mirror: the closest one in front of the camera. */
  _updateMirrors(camera, playerFloor) {
    let best = null, bd = 5.5;
    const cp = camera.position;
    for (const mr of this.mirrors) {
      const d = mr.pos.distanceTo(cp);
      const facing = mr.normal.dot(new THREE.Vector3().subVectors(cp, mr.pos)) > 0;
      if (mr.f === playerFloor && facing && d < bd) { bd = d; best = mr; }
    }
    for (const mr of this.mirrors) {
      const live = mr === best;
      mr.reflector.visible = live;
      mr.dark.visible = !live;
      if (live && !mr.layerSet) {
        const rc = mr.reflector.getReflectionCamera(camera);
        rc.layers.enable(MIRROR_LAYER);
        mr.layerSet = true;
      }
    }
    this.liveMirror = best;
  }

  // ---------------------------------------------------------------- nav
  /** Cells mostly covered by furniture (the cat walks around them). */
  _computeNavBlocked() {
    const g = this.grid;
    const blocked = [];
    for (let f = 0; f < g.floorCount; f++) blocked.push(new Uint8Array(g.W * g.D));
    for (const c of this.furnitureColliders) {
      if (!c.nav) continue;
      const f = c.f;
      for (let z = Math.floor(c.z0); z <= Math.floor(c.z1 - 1e-6); z++) {
        for (let x = Math.floor(c.x0); x <= Math.floor(c.x1 - 1e-6); x++) {
          const ox = Math.max(0, Math.min(x + 1, c.x1) - Math.max(x, c.x0));
          const oz = Math.max(0, Math.min(z + 1, c.z1) - Math.max(z, c.z0));
          if (ox * oz > 0.42) blocked[f][z * g.W + x] = 1;
        }
      }
    }
    return blocked;
  }

  // ---------------------------------------------------------------- runtime
  setActiveFloor(f) {
    this.activeFloor = f;
    for (let i = 0; i < this.floorGroups.length; i++) this.floorGroups[i].visible = Math.abs(i - f) <= 1;
  }

  update(dt, camera, playerFloor) {
    this.time += dt;
    const t = this.time;
    for (const d of this.doorList) d.update(dt);
    for (const a of this.animators) a(t, dt);
    this._updateTVs(dt, t);
    this.lighting.update(dt, t);
    this.exterior.update(dt, t, camera.position, this.reduceFlashes);
    this._updateMirrors(camera, playerFloor);
  }
}
