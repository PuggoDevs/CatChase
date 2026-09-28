// First-person survivor: movement with stances and stamina, collision,
// stairs, footsteps and noise, the flashlight, hiding and breath holding.
import * as THREE from 'three';
import { PLAYER, NOISE } from '../config.js';
import { floorBaseY } from '../world/layout.js';
import { noise1 } from '../core/rng.js';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.grid = game.world.grid;
    this.camera = game.camera;
    this.input = game.input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.floor = 1;
    this.stance = 'stand';
    this.height = PLAYER.height.stand;
    this.eye = PLAYER.eye.stand;
    this.flash = {
      has: false, on: false, battery: 100, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1),
      flicker: 0, dead: false,
    };
    // spot light that follows the camera with a little hand lag
    const spot = new THREE.SpotLight(0xfff0dc, 0, 24, 0.5, 0.72, 2);
    spot.castShadow = true;
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.025;
    spot.shadow.camera.near = 0.12;
    this.spot = spot;
    game.scene.add(spot, spot.target);
    this.reset();
  }

  reset() {
    this.vel.set(0, 0, 0);
    this.stance = 'stand';
    this.height = PLAYER.height.stand;
    this.eye = PLAYER.eye.stand;
    this.stamina = PLAYER.staminaMax;
    this.exhausted = false;
    this.inventory = new Map();
    this.held = null;
    this.hiding = null;
    this.breath = PLAYER.breathMax;
    this.holdingBreath = false;
    this.dead = false;
    this.frozen = false;
    this.bobT = 0;
    this.bobAmt = 0;
    this.stepAcc = 0;
    this.footLeft = false;
    this.fear = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.fovKick = 0;
    this.moving = 0;
    this.sprinting = false;
    this.breathTimer = 0;
    this.lastNoise = 0;
    this.flash.has = false;
    this.flash.on = false;
    this.flash.battery = 100;
    this.flash.dead = false;
    this.lookOverride = null;
    this.struggles = 0;
    this.stats = { distance: 0, sprint: 0, hides: 0, noises: 0 };
    this.roomTime = new Map();
    this.currentRoom = null;
  }

  spawn(start) {
    this.pos.set(start.x, floorBaseY(start.f), start.z);
    this.floor = start.f;
    this.yaw = start.yaw || 0;
    this.pitch = 0;
    this._placeCamera(0);
  }

  // ------------------------------------------------------------ inventory
  has(id, n = 1) { return (this.inventory.get(id) || 0) >= n; }
  give(id, n = 1) { this.inventory.set(id, (this.inventory.get(id) || 0) + n); }
  take(id, n = 1) {
    const c = this.inventory.get(id) || 0;
    if (c < n) return false;
    if (c - n <= 0) this.inventory.delete(id); else this.inventory.set(id, c - n);
    return true;
  }

  get settings() { return this.game.settings; }
  get diff() { return this.game.run ? this.game.run.diff : null; }

  // ------------------------------------------------------------ helpers
  get eyePos() { return tmpV.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
  get room() { return this.grid.roomAtWorld(this.floor, this.pos.x, this.pos.z); }

  emitNoise(radius, kind, pos = null) {
    this.stats.noises++;
    this.game.noise(pos ? pos.clone() : new THREE.Vector3(this.pos.x, this.pos.y + 0.5, this.pos.z), radius, kind, 'player');
  }

  addShake(amount, duration = 0.4) {
    const k = this.settings.reduceShake ? 0.3 : 1;
    this.shake = Math.max(this.shake, amount * k);
    this.shakeT = Math.max(this.shakeT, duration);
  }

  // ------------------------------------------------------------ stance
  canStand(target) {
    const h = PLAYER.height[target];
    const p = tmpV2.copy(this.pos);
    return this.world.collision.isFree(p, PLAYER.radius * 0.9, h);
  }

  setStance(s) {
    if (s === this.stance) return;
    if ((s === 'stand' || s === 'crouch') && PLAYER.height[s] > this.height + 0.01 && !this.canStand(s)) {
      this.game.ui.toast(s === 'stand' ? 'Not enough room to stand.' : 'Not enough room.');
      return;
    }
    this.stance = s;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const input = this.input;
    if (this.dead) return;
    if (this.hiding) {
      this._updateHiding(dt);
      this._updateFlashlight(dt);
      this._placeCamera(dt);
      return;
    }
    if (!this.frozen) {
      // look
      const look = input.consumeLook();
      const sens = 0.0022 * this.settings.sensitivity;
      this.yaw -= look.x * sens;
      this.pitch -= look.y * sens * (this.settings.invertY ? -1 : 1);
      if (input.isDown('turnLeft')) this.yaw += dt * 2.2;
      if (input.isDown('turnRight')) this.yaw -= dt * 2.2;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
      // stance toggles
      if (input.pressed('crouch')) this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
      if (input.pressed('prone')) this.setStance(this.stance === 'prone' ? 'crouch' : 'prone');
      if (!this.settings.crouchToggle && this.stance === 'crouch' && input.released('crouch')) this.setStance('stand');
    } else {
      input.consumeLook();
    }
    this._move(dt);
    this._updateStamina(dt);
    this._updateFlashlight(dt);
    this._trackRoom(dt);
    this._placeCamera(dt);
  }

  _speedFor() {
    if (this.stance === 'prone') return PLAYER.prone;
    if (this.stance === 'crouch') return PLAYER.crouch;
    return PLAYER.walk;
  }

  _move(dt) {
    const input = this.input;
    const mv = this.frozen ? { x: 0, y: 0 } : input.moveVector();
    const wantsSprint = !this.frozen && input.isDown('sprint') && mv.y > 0.2 && this.stance !== 'prone' && !this.exhausted && this.stamina > 1;
    if (wantsSprint && this.stance === 'crouch') this.setStance('stand');
    this.sprinting = wantsSprint && this.stance === 'stand';
    let speed = this.sprinting ? PLAYER.sprint : this._speedFor();
    if (this.exhausted) speed *= 0.8;
    if (this.held && this.held.kind === 'plank') speed *= 0.95;
    // desired velocity in world space
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const dx = (fx * mv.y + rx * mv.x) * speed;
    const dz = (fz * mv.y + rz * mv.x) * speed;
    const accel = mv.x || mv.y ? 12 : 14;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (dx - this.vel.x) * k;
    this.vel.z += (dz - this.vel.z) * k;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.moving = sp;
    if (sp < 0.01) { this.vel.x = this.vel.z = 0; }
    // integrate with sub-steps to avoid tunnelling through thin walls
    const dist = sp * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.12));
    const col = this.world.collision;
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.z += (this.vel.z * dt) / steps;
      col.resolveCylinder(this.pos, PLAYER.radius, this.height);
      this._resolveGround();
    }
    this.stats.distance += dist;
    if (this.sprinting) this.stats.sprint += dt;
    // footsteps
    if (sp > 0.3) {
      const stride = this.sprinting ? 0.72 : this.stance === 'prone' ? 0.45 : this.stance === 'crouch' ? 0.55 : 0.68;
      this.stepAcc += dist;
      if (this.stepAcc >= stride) {
        this.stepAcc = 0;
        this._footstep();
      }
      this.bobT += dt * sp * (this.stance === 'prone' ? 3 : 5.2) / Math.max(1, speed / 2.2);
    }
    this.bobAmt += ((sp > 0.3 ? Math.min(1, sp / 3) : 0) - this.bobAmt) * Math.min(1, dt * 6);
  }

  _resolveGround() {
    const grid = this.grid;
    const f = grid.floorAt(this.pos.x, this.pos.y, this.pos.z, this.floor);
    // guard: never enter outside cells (collision should prevent it anyway)
    const cellX = Math.floor(this.pos.x), cellZ = Math.floor(this.pos.z);
    const r = grid.cellRaw(f, cellX, cellZ);
    if (r === -1 && !grid.holeStair(f, cellX, cellZ)) return;
    this.floor = f;
    const gy = grid.groundY(f, this.pos.x, this.pos.z);
    // smooth small steps, snap big ones (stairs are ramps so this is gentle)
    const d = gy - this.pos.y;
    this.pos.y = Math.abs(d) > 0.6 ? gy : this.pos.y + d * 0.6;
    if (Math.abs(gy - this.pos.y) < 0.002) this.pos.y = gy;
  }

  _footstep() {
    this.footLeft = !this.footLeft;
    const room = this.room;
    const surface = room ? room.meta.floor : 'woodFloor';
    let radius = this.sprinting ? NOISE.sprint : this.stance === 'prone' ? NOISE.prone : this.stance === 'crouch' ? NOISE.crouch : NOISE.walk;
    if (surface && surface.startsWith('carpet')) radius *= 0.6;
    if (surface && (surface.startsWith('tile') || surface === 'marble')) radius *= 1.15;
    const cx = Math.floor(this.pos.x), cz = Math.floor(this.pos.z);
    const creak = this.game.run && this.game.run.creaky.has(`${this.floor}:${cx}:${cz}`) && this.stance !== 'prone';
    this.game.audio.footstep(this.pos, surface, this.sprinting ? 1 : this.stance === 'stand' ? 0.6 : 0.3, this.footLeft, true);
    if (creak) {
      this.game.audio.creak(new THREE.Vector3(this.pos.x, this.pos.y, this.pos.z), this.stance === 'crouch' ? 0.5 : 1);
      radius = Math.max(radius, this.stance === 'crouch' ? NOISE.creak * 0.55 : NOISE.creak);
    }
    this.emitNoise(radius, creak ? 'creak' : 'step');
  }

  _updateStamina(dt) {
    const d = this.diff || { staminaDrain: 1 };
    if (this.sprinting && this.moving > 0.5) {
      this.stamina -= PLAYER.sprintCost * d.staminaDrain * dt;
      this.regenDelay = 0.8;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        this.game.audio.gasp();
        this.emitNoise(NOISE.gasp, 'gasp');
      }
    } else {
      this.regenDelay = Math.max(0, (this.regenDelay || 0) - dt);
      if (this.regenDelay <= 0) {
        const idle = this.moving < 0.3 || this.stance !== 'stand';
        this.stamina = Math.min(PLAYER.staminaMax, this.stamina + (idle ? PLAYER.staminaRegenIdle : PLAYER.staminaRegen) * dt);
      }
      if (this.exhausted && this.stamina >= PLAYER.exhaustedUntil) this.exhausted = false;
    }
    // ragged breathing while winded gives you away
    if (this.stamina < 30 && !this.holdingBreath) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 1.3;
        this.game.audio.breath(this.stamina < 12 ? 1 : 0.6);
        if (this.stamina < 20) this.emitNoise(NOISE.exhaustedBreath, 'breath');
      }
    }
  }

  // ------------------------------------------------------------ flashlight
  toggleFlashlight() {
    const f = this.flash;
    if (!f.has) { this.game.ui.toast('You have no light.'); return; }
    if (this.hiding) { this.game.ui.toast('Not in here - it would give you away.'); return; }
    if (!f.on && f.battery <= 0.5) {
      if (!this._swapBattery()) { this.game.ui.toast('The flashlight is dead. Find batteries.'); this.game.audio.click(0.4); return; }
    }
    f.on = !f.on;
    this.game.audio.click(f.on ? 1 : 0.8);
    this.emitNoise(NOISE.flashlight, 'click');
  }

  _swapBattery() {
    if (!this.take('battery')) return false;
    this.flash.battery = 100;
    this.game.ui.toast('You swap in a fresh battery.');
    this.game.audio.click(0.6);
    return true;
  }

  _updateFlashlight(dt) {
    const f = this.flash;
    const d = this.diff || { batteryDrain: 1 };
    if (f.on) {
      f.battery -= PLAYER.batteryDrainPerSec * d.batteryDrain * dt * (this.game.run && this.game.run.mode === 'endless' ? 0.8 : 1);
      if (f.battery <= 0) {
        f.battery = 0;
        if (!this._swapBattery()) {
          f.on = false;
          this.game.ui.toast('The flashlight dies.');
          this.game.audio.click(0.4);
        }
      }
    }
    const t = this.game.time;
    let intensity = 0;
    if (f.on) {
      const b = f.battery / 100;
      intensity = 48 * (b > 0.25 ? 0.85 + b * 0.15 : 0.35 + b * 2.2);
      // weak batteries stutter
      if (b < 0.25 && noise1(t * 6, 3) > 0.62 + b) intensity *= noise1(t * 40, 4) > 0.5 ? 0.15 : 0.6;
      if (f.flicker > 0) {
        f.flicker -= dt;
        intensity *= noise1(t * 35, 9) > 0.5 ? 1 : 0.05;
      }
    }
    this.spot.intensity = intensity;
  }

  // ------------------------------------------------------------ hiding
  enterHiding(spot) {
    if (this.hiding) return;
    this.flashWasOn = this.flash.on;
    this.flash.on = false;
    this.hiding = { spot, phase: 'enter', t: 0, from: this.eyePos.clone(), fromYaw: this.yaw, fromPitch: this.pitch };
    spot.uses = (spot.uses || 0) + 1;
    this.stats.hides++;
    this.game.onPlayerHide(spot);
    this.vel.set(0, 0, 0);
    this.game.audio.hideSound(spot.type, spot.inside);
    this.emitNoise(1.8, 'hide', spot.inside);
  }

  exitHiding() {
    const h = this.hiding;
    if (!h || h.phase !== 'in') return;
    h.phase = 'exit';
    h.t = 0;
    h.from = this.eyePos.clone();
    this.game.audio.hideSound(h.spot.type, h.spot.inside);
    this.emitNoise(2.2, 'hide', h.spot.inside);
    this.game.onPlayerUnhide(h.spot);
  }

  _updateHiding(dt) {
    const h = this.hiding;
    const spot = h.spot;
    const input = this.input;
    h.t += dt;
    if (h.phase === 'enter') {
      const k = Math.min(1, h.t / 0.7);
      spot.setOpen(Math.sin(k * Math.PI) * 0.85);
      const e = k * k * (3 - 2 * k);
      this._hideCam = new THREE.Vector3().lerpVectors(h.from, spot.inside, e);
      this.yaw = lerpAngle(h.fromYaw, spot.yaw + Math.PI, e);
      // camera yaw convention: looking along (-sin yaw, -cos yaw)
      this.pitch = h.fromPitch * (1 - e);
      if (k >= 1) {
        h.phase = 'in';
        spot.setOpen(0);
        this.yaw = spot.yaw + Math.PI;
        this.pos.set(spot.inside.x, spot.inside.y - this.eye, spot.inside.z);
      }
      input.consumeLook();
      return;
    }
    if (h.phase === 'exit') {
      const k = Math.min(1, h.t / 0.6);
      spot.setOpen(Math.sin(k * Math.PI) * 0.85);
      const target = new THREE.Vector3(spot.exit.x, spot.exit.y + PLAYER.eye.crouch, spot.exit.z);
      this._hideCam = new THREE.Vector3().lerpVectors(h.from, target, k * k * (3 - 2 * k));
      if (k >= 1) {
        spot.setOpen(0);
        this.hiding = null;
        this._hideCam = null;
        this.pos.set(spot.exit.x, spot.exit.y, spot.exit.z);
        this.floor = spot.f;
        this.stance = 'crouch';
        this.height = PLAYER.height.crouch;
        this.eye = PLAYER.eye.crouch;
        this.world.collision.resolveCylinder(this.pos, PLAYER.radius, this.height);
        if (this.flashWasOn && this.flash.battery > 0) this.flash.on = true;
      }
      input.consumeLook();
      return;
    }
    // inside: limited look
    const look = input.consumeLook();
    const sens = 0.0022 * this.settings.sensitivity;
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens * (this.settings.invertY ? -1 : 1);
    const baseYaw = spot.yaw + Math.PI;
    let dy = wrapAngle(this.yaw - baseYaw);
    dy = Math.max(-spot.yawRange, Math.min(spot.yawRange, dy));
    this.yaw = baseYaw + dy;
    this.pitch = Math.max(spot.pitchMin, Math.min(spot.pitchMax, this.pitch));
    this._hideCam = spot.inside.clone();
    // breath holding
    const wasHolding = this.holdingBreath;
    this.holdingBreath = input.isDown('breath') && this.breath > 0;
    if (this.holdingBreath) {
      this.breath = Math.max(0, this.breath - dt);
      if (this.breath <= 0) {
        this.holdingBreath = false;
        this.game.audio.gasp();
        this.emitNoise(NOISE.gasp, 'gasp', spot.inside);
        this.game.ui.toast('You gasp for air!');
      }
    } else {
      this.breath = Math.min(PLAYER.breathMax, this.breath + dt * 0.8);
      if (wasHolding && this.breath > 0.5) this.game.audio.exhale();
    }
    if (input.pressed('interact') || input.pressed('primary')) this.exitHiding();
  }

  // ------------------------------------------------------------ rooms
  _trackRoom(dt) {
    const room = this.room;
    if (!room) return;
    if (room !== this.currentRoom) {
      this.currentRoom = room;
      this.game.onPlayerRoom(room);
    }
    this.roomTime.set(room.index, (this.roomTime.get(room.index) || 0) + dt);
  }

  // ------------------------------------------------------------ camera
  _placeCamera(dt) {
    const cam = this.camera;
    const targetH = this.hiding ? PLAYER.height.crouch : PLAYER.height[this.stance];
    const targetE = this.hiding ? PLAYER.eye.crouch : PLAYER.eye[this.stance];
    const k = 1 - Math.exp(-10 * dt);
    this.height += (targetH - this.height) * k;
    this.eye += (targetE - this.eye) * k;
    const t = this.game.time;
    if (this._hideCam) {
      cam.position.copy(this._hideCam);
    } else {
      cam.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
      // head bob
      const amp = this.bobAmt * (this.sprinting ? 0.06 : this.stance === 'prone' ? 0.015 : 0.032) * (this.settings.reduceShake ? 0.4 : 1);
      cam.position.y += Math.sin(this.bobT * 2) * amp;
      tmpV2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(Math.cos(this.bobT) * amp * 0.6);
      cam.position.add(tmpV2);
    }
    // shake
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      sx = (noise1(t * 22, 1) - 0.5) * this.shake;
      sy = (noise1(t * 24, 2) - 0.5) * this.shake;
      if (this.shakeT <= 0) this.shake = 0;
    }
    // fear tremor
    if (this.fear > 0.4 && !this.settings.reduceShake) {
      sx += (noise1(t * 9, 5) - 0.5) * this.fear * 0.012;
      sy += (noise1(t * 11, 6) - 0.5) * this.fear * 0.012;
    }
    cam.rotation.order = 'YXZ';
    if (this.lookOverride) {
      cam.quaternion.copy(this.lookOverride);
    } else {
      cam.rotation.set(this.pitch + sy, this.yaw + sx, 0);
      cam.rotation.z = -this.vel.dot(tmpV2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) * 0.006;
    }
    // FOV kick when sprinting
    const fovT = this.settings.fov + (this.sprinting ? 7 : 0) + this.fovKick;
    cam.fov += (fovT - cam.fov) * Math.min(1, dt * 5);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // flashlight rig with hand lag
    const f = this.flash;
    const camDir = tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (f.dir.lengthSq() < 0.5) f.dir.copy(camDir);
    f.dir.lerp(camDir, 1 - Math.exp(-16 * dt)).normalize();
    const off = tmpV2.set(0.16, -0.2, -0.05).applyQuaternion(cam.quaternion);
    f.pos.copy(cam.position).add(off);
    this.spot.position.copy(f.pos);
    this.spot.target.position.copy(f.pos).addScaledVector(f.dir, 6);
    this.spot.target.updateMatrixWorld();
  }
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

