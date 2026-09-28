// Throwing things to distract the cat: the held-item view model, simple
// ballistic physics with bounces, and a noise where it lands.
import * as THREE from 'three';
import { buildItemModel, ITEM_DEFS } from '../game/items.js';
import { NOISE } from '../config.js';

export class Throwables {
  constructor(game) {
    this.game = game;
    this.flying = [];
    this.heldModel = null;
    // the held item lives in a group that follows the camera
    this.hand = new THREE.Group();
    game.scene.add(this.hand);
  }

  showHeld(kind) {
    this.hideHeld();
    if (!kind) return;
    const M = (p) => new THREE.MeshStandardMaterial({ ...p });
    const model = buildItemModel(kind, M);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
    model.scale.setScalar(kind === 'plate' ? 0.9 : 1.1);
    this.heldModel = model;
    this.hand.add(model);
  }

  hideHeld() {
    if (this.heldModel) {
      this.hand.remove(this.heldModel);
      this.heldModel.traverse((o) => { if (o.isMesh) o.material.dispose(); });
      this.heldModel = null;
    }
  }

  drop(held, pos) {
    const room = this.game.world.grid.roomAtWorld(this.game.player.floor, pos.x, pos.z);
    this.game.items.spawn(held.kind, new THREE.Vector3(pos.x + 0.2, this.game.world.grid.groundY(this.game.player.floor, pos.x, pos.z) + 0.01, pos.z + 0.2), room ? room.index : -1);
    this.game.player.held = null;
    this.hideHeld();
  }

  throwHeld() {
    const g = this.game, p = g.player;
    if (!p.held) return;
    const kind = p.held.kind;
    p.held = null;
    this.hideHeld();
    const cam = g.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const start = cam.position.clone().addScaledVector(dir, 0.35).add(new THREE.Vector3(0, -0.1, 0));
    const vel = dir.clone().multiplyScalar(11.5).add(new THREE.Vector3(0, 2.4, 0));
    const M = (prm) => g.world.materials.custom(prm, 'thrown');
    const model = buildItemModel(kind, M);
    model.position.copy(start);
    g.scene.add(model);
    this.flying.push({ kind, def: ITEM_DEFS[kind], pos: start, vel, model, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), floor: p.floor, bounces: 0, noised: false, age: 0, thrower: p.pos.clone() });
    g.audio.whoosh(start);
    p.emitNoise(NOISE.throwWhoosh, 'throw');
    g.learn('throw', { from: p.pos.clone() });
  }

  update(dt) {
    const g = this.game;
    const col = g.world.collision;
    const grid = g.world.grid;
    // held model follows the camera
    if (this.heldModel) {
      const cam = g.camera;
      this.hand.position.copy(cam.position);
      this.hand.quaternion.copy(cam.quaternion);
      const bob = Math.sin(g.player.bobT * 2) * 0.012 * g.player.bobAmt;
      this.heldModel.position.set(0.22, -0.2 + bob, -0.42);
      this.heldModel.rotation.set(0.3, -0.6, 0.1);
    }
    for (const t of [...this.flying]) {
      t.age += dt;
      const steps = 4;
      for (let s = 0; s < steps; s++) {
        const h = dt / steps;
        t.vel.y -= 9.8 * h;
        const next = t.pos.clone().addScaledVector(t.vel, h);
        // walls & furniture: test a small box at the next position
        let hitAxis = null;
        col.forEachNear(next.x - 0.08, next.z - 0.08, next.x + 0.08, next.z + 0.08, (c) => {
          if (!c.active) return;
          if (next.y < c.y0 || next.y > c.y1) return;
          if (next.x < c.x0 - 0.05 || next.x > c.x1 + 0.05 || next.z < c.z0 - 0.05 || next.z > c.z1 + 0.05) return;
          // decide which axis we crossed
          const wasInX = t.pos.x >= c.x0 - 0.05 && t.pos.x <= c.x1 + 0.05;
          hitAxis = wasInX ? 'z' : 'x';
          if (t.pos.y > c.y1 - 0.02 && t.vel.y < 0) hitAxis = 'y-top';
          return false;
        });
        const floorF = grid.floorAt(next.x, next.y, next.z, t.floor);
        const ground = grid.groundY(floorF, next.x, next.z) + 0.03;
        const ceil = grid.rooms[Math.max(0, grid.cellRaw(floorF, Math.floor(next.x), Math.floor(next.z)))];
        const ceilY = ceil ? ceil.baseY + ceil.ceil - 0.05 : Infinity;
        if (hitAxis === 'x') { t.vel.x *= -0.35; t.vel.z *= 0.6; this._impact(t); }
        else if (hitAxis === 'z') { t.vel.z *= -0.35; t.vel.x *= 0.6; this._impact(t); }
        else if (hitAxis === 'y-top') { t.vel.y *= -0.3; t.vel.x *= 0.6; t.vel.z *= 0.6; this._impact(t); }
        else if (next.y > ceilY) { t.vel.y = -Math.abs(t.vel.y) * 0.3; }
        else if (next.y < ground) {
          next.y = ground;
          if (Math.abs(t.vel.y) > 1.2) this._impact(t);
          t.vel.y = Math.abs(t.vel.y) * 0.28;
          t.vel.x *= 0.55; t.vel.z *= 0.55;
          if (Math.abs(t.vel.y) < 0.5) t.vel.y = 0;
          t.pos.copy(next);
        } else {
          t.pos.copy(next);
        }
        t.floor = floorF;
        if (t.dead) break;
      }
      if (t.dead) continue;
      t.model.position.copy(t.pos);
      t.model.rotation.x += t.spin.x * dt;
      t.model.rotation.z += t.spin.z * dt;
      const sp = t.vel.length();
      if ((sp < 0.25 && t.pos.y <= grid.groundY(t.floor, t.pos.x, t.pos.z) + 0.05) || t.age > 6) this._settle(t);
    }
  }

  _impact(t) {
    const g = this.game;
    if (t.dead) return;
    t.bounces++;
    if (!t.noised) {
      t.noised = true;
      const def = t.def;
      g.audio.impact(t.kind, t.pos.clone());
      g.noise(t.pos.clone(), def.noise || 10, 'thrown', 'distraction', { from: t.thrower });
      if (def.breaks) { this._shatter(t); return; }
    } else if (t.bounces < 4) {
      g.audio.impact(t.kind, t.pos.clone(), 0.35);
    }
  }

  _shatter(t) {
    t.dead = true;
    this.game.scene.remove(t.model);
    const i = this.flying.indexOf(t);
    if (i >= 0) this.flying.splice(i, 1);
    this.game.fx.shards(t.pos.clone(), t.kind === 'bottle' ? 0x1e3a24 : 0xd8d4c8);
  }

  _settle(t) {
    t.dead = true;
    this.game.scene.remove(t.model);
    const i = this.flying.indexOf(t);
    if (i >= 0) this.flying.splice(i, 1);
    if (!t.noised) {
      t.noised = true;
      this.game.noise(t.pos.clone(), (t.def.noise || 10) * 0.6, 'thrown', 'distraction', { from: t.thrower });
    }
    const room = this.game.world.grid.roomAtWorld(t.floor, t.pos.x, t.pos.z);
    this.game.items.spawn(t.kind, new THREE.Vector3(t.pos.x, this.game.world.grid.groundY(t.floor, t.pos.x, t.pos.z) + 0.005, t.pos.z), room ? room.index : -1, { f: t.floor });
  }

  clear() {
    for (const t of this.flying) this.game.scene.remove(t.model);
    this.flying = [];
    this.hideHeld();
  }
}
