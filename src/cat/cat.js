// The cat's body and brain.
//
// Brain states: dormant, patrol, investigate, stalk, chase, search, check,
// ambush (in a doorway, on the ceiling or under a bed), stare, fakeLeave,
// doorBlocked, attack, recoil, lured, scripted.
// Locomotion: path following across floors, doors (quiet / normal / burst),
// barricades and locks, vents (hidden travel with scratching in the walls)
// and ceiling crawling.
import * as THREE from 'three';
import { createCatModel, createLurkFace } from './catModel.js';
import { CatAnimator } from './catAnimator.js';
import { NavGraph } from './nav.js';
import { PlayerModel } from './learning.js';
import { setObjectRoom } from '../world/roomLighting.js';
import { floorBaseY, FLOOR_CEIL, CAT_START_ROOMS } from '../world/layout.js';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Cat {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.grid = game.world.grid;
    this.nav = new NavGraph(this.grid, this.world.navBlocked, this.world.vents);
    this.model = createCatModel(this.world.materials);
    this.anim = new CatAnimator(this.model);
    this.model.root.visible = false;
    game.scene.add(this.model.root);
    this.face = createLurkFace(this.model);
    game.scene.add(this.face.root);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.floor = 1;
    this.reset(null);
  }

  get diff() { return this.game.run.diff; }
  get player() { return this.game.player; }
  get rng() { return this.game.run.rng; }
  get now() { return this.game.time; }

  reset(run) {
    this.state = { name: 'dormant', t: 0, data: {} };
    this.path = null;
    this.pathI = 0;
    this.goal = null;
    this.speed = 0;
    this.moveOpts = {};
    this.mode = 'floor';      // floor | ceiling | vent | hidden
    this.flip = 0;            // 0 floor .. 1 ceiling
    this.detection = 0;
    this.lastSeen = null;     // {pos, time, vel}
    this.lastHeard = null;
    this.seesPlayer = false;
    this.visibleToPlayer = false;
    this.chaseTime = 0;
    this.stepPhase = 0;
    this.silentUntil = 0;
    this.doorWait = null;
    this.stun = 0;
    this.percT = 0;
    this.visT = 0;
    this.purrT = 0;
    this.vocalT = 5;
    this.sinceChase = 999;
    this.ambushCooldown = 30;
    this.aggression = 0.5;
    this.leashRoom = null;
    this.relaxing = false;
    this.mood = 1;             // outage multiplier
    this.model.root.visible = false;
    this.lurkSpot = null;
    this.face.root.visible = false;
    this.learn = new PlayerModel(run ? run.diff.learnRate : 1);
    this.lastPlayerPos = new THREE.Vector3();
    this.playerVel = new THREE.Vector3();
    this.anim.jawOverride = null;
    this.anim.grinOverride = null;
    this.stats = { chases: 0, checks: 0, ambushes: 0, stares: 0 };
  }

  // ================================================================ helpers
  get room() { return this.grid.roomAtWorld(this.floor, this.pos.x, this.pos.z); }
  get hidden() { return this.mode === 'vent' || this.mode === 'hidden' || this.state.name === 'dormant'; }

  headPos(out = new THREE.Vector3()) {
    return this.model.head.getWorldPosition(out);
  }

  distToPlayer() {
    const p = this.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) + Math.abs(p.y - this.pos.y) * 1.5;
  }

  setState(name, data = {}) {
    const prev = this.state.name;
    if (this.lurkSpot) this._unlurk();
    this.state = { name, t: 0, data, prev };
    this.game.onCatState(name, prev);
  }

  /** Put the cat somewhere (only while the player can't see). */
  teleport(f, x, z, yaw = null) {
    if (this.lurkSpot) this._unlurk();
    this.floor = f;
    this.pos.set(x, this.grid.groundY(f, x, z), z);
    if (yaw !== null) this.yaw = yaw;
    this.path = null;
    this.mode = 'floor';
    this.flip = 0;
    this.model.root.visible = true;
    this._syncModel(0);
  }

  hide() {
    if (this.lurkSpot) this._unlurk();
    this.mode = 'hidden';
    this.model.root.visible = false;
    this.path = null;
  }

  // ================================================================ locomotion
  /**
   * Walk/run to a world point. opts: {speed, pose, doorMode, vents, ceiling}
   */
  goTo(f, x, z, opts = {}) {
    const d = this.diff;
    const pathOpts = {
      doors: 'any',
      breakDoors: opts.breakDoors ?? (d.doorBreak > 0 && this.learn.lockHabit() * d.doorBreak > 0.2),
      vents: opts.vents ?? false,
      ventCost: 0.6,
    };
    let path = this.nav.findPath(this.floor, this.pos.x, this.pos.z, f, x, z, pathOpts);
    // shut in? the walls are full of ducts, and on hard nights doors give way
    if ((!path || !path.length) && !pathOpts.vents) path = this.nav.findPath(this.floor, this.pos.x, this.pos.z, f, x, z, { ...pathOpts, vents: true });
    if ((!path || !path.length) && !pathOpts.breakDoors && d.doorBreak > 0) path = this.nav.findPath(this.floor, this.pos.x, this.pos.z, f, x, z, { ...pathOpts, vents: true, breakDoors: true });
    if (!path || !path.length) { this.path = null; return false; }
    this.path = path;
    this.pathI = 0;
    this.goal = { f, x, z };
    this.moveOpts = opts;
    return true;
  }

  stop() { this.path = null; this.speed = 0; }
  get arrived() { return !this.path; }

  _move(dt) {
    if (!this.path) {
      this.speed += (0 - this.speed) * Math.min(1, dt * 6);
      return;
    }
    const o = this.moveOpts;
    const target = this.path[this.pathI];
    // door on the way?
    if (target.door && this._handleDoor(target, dt)) return;
    // vent segment
    if (target.vent && this.mode !== 'vent') { this._enterVent(target); return; }
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = (o.speed || this.diff.catWalk) * this.mood * (this.stun > 0 ? 0.3 : 1);
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 2.5 : 6));
    if (dist < 0.3 || (dist < 0.6 && this.pathI < this.path.length - 1)) {
      this.pathI++;
      if (this.pathI >= this.path.length) { this.path = null; return; }
      return;
    }
    const step = Math.min(dist, this.speed * dt);
    this.pos.x += (dx / dist) * step;
    this.pos.z += (dz / dist) * step;
    const f = this.grid.floorAt(this.pos.x, this.pos.y + 0.2, this.pos.z, this.floor);
    const cellOk = this.grid.cellRaw(f, Math.floor(this.pos.x), Math.floor(this.pos.z)) >= 0 || this.grid.holeStair(f, Math.floor(this.pos.x), Math.floor(this.pos.z));
    if (cellOk) this.floor = f;
    this.pos.y = this.grid.groundY(this.floor, this.pos.x, this.pos.z);
    // face travel direction
    const targetYaw = Math.atan2(dx, dz);
    this.yaw = turnToward(this.yaw, targetYaw, dt * (this.speed > 3 ? 10 : 5));
    // ceiling crawling on long straight stretches
    if (o.ceiling && this.mode === 'floor' && dist > 4 && !this.grid.stairAt(this.floor, Math.floor(this.pos.x), Math.floor(this.pos.z))) this.mode = 'ceiling';
    if (this.mode === 'ceiling' && (dist < 1.2 || this.grid.stairAt(this.floor, Math.floor(target.x), Math.floor(target.z)) || target.door)) this.mode = 'floor';
  }

  _handleDoor(target, dt) {
    const door = target.door;
    if (door.isPassable()) { this.doorWait = null; return false; }
    // walk up to the door on our side first
    const side = door.sideOf(this.pos.x, this.pos.z);
    const ap = door.approachPoint(side, 0.62);
    const dx = ap.x - this.pos.x, dz = ap.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.25 && !this.doorWait) {
      const step = Math.min(dist, Math.max(1.2, this.speed) * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      this.pos.y = this.grid.groundY(this.floor, this.pos.x, this.pos.z);
      this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), dt * 8);
      return true;
    }
    if (this.mode === 'ceiling') this.mode = 'floor';
    const c = door.center;
    this.yaw = turnToward(this.yaw, Math.atan2(c.x - this.pos.x, c.z - this.pos.z), dt * 8);
    if (!this.doorWait) this.doorWait = { door, t: 0, hits: 0, rattled: false };
    const w = this.doorWait;
    w.t += dt;
    if (door.canBeOpenedBy({ cat: true })) {
      const mode = this.moveOpts.doorMode || 'normal';
      if (w.t > (mode === 'burst' ? 0.05 : mode === 'quiet' ? 0.6 : 0.35)) {
        door.openDoor('cat', mode === 'burst' ? 'burst' : mode === 'quiet' ? 'quiet' : 'normal');
        if (mode === 'burst') this.game.noise(new THREE.Vector3(c.x, c.y, c.z), 16, 'door', 'cat');
        this.anim.setPose('reach', 0.15);
      }
      return true;
    }
    // locked or barricaded
    return this._blockedDoor(door, w, dt);
  }

  _blockedDoor(door, w, dt) {
    const d = this.diff;
    const c = door.center;
    if (!w.rattled) {
      w.rattled = true;
      this.game.audio.rattle(c, true);
      this.game.events.emit('catAtDoor', { door });
      w.decision = null;
    }
    if (w.decision === null) {
      w.decision = 'reroute';
      if (door.barricade > 0) w.decision = 'pound';
      else if (door.locked && door.breakable && d.doorBreak > 0 && this.rng.chance(0.25 + d.doorBreak * 0.6 * (0.6 + this.learn.lockHabit() * 0.4))) w.decision = 'pound';
      if (this.state.name !== 'chase' && w.decision === 'pound' && door.locked && this.rng.chance(0.5)) w.decision = 'reroute';
    }
    if (w.decision === 'pound') {
      this.anim.setPose('pound', 0.2);
      const interval = door.barricade > 0 ? 1.05 : Math.max(0.6, (d.doorBreakTime || 6) / 5);
      if (w.t - w.hits * interval > interval) {
        w.hits++;
        this.game.noise(new THREE.Vector3(c.x, c.y, c.z), 22, 'bang', 'cat');
        this.game.player.addShake(this.distToPlayer() < 6 ? 0.03 : 0.01, 0.3);
        if (door.hit(1)) {
          this.doorWait = null;
          if (!door.isPassable() && door.canBeOpenedBy({ cat: true })) door.openDoor('cat', 'burst');
        }
      }
      return true;
    }
    // reroute: look for another way, maybe through the vents
    if (w.t > 0.8) {
      this.doorWait = null;
      this.learn.recordLock();
      const g = this.goal;
      const useVents = this.rng.chance(d.ventUse + 0.2);
      // temporarily treat this door as impassable by asking for a path that avoids locked doors
      const ok = g && this.goTo(g.f, g.x, g.z, { ...this.moveOpts, vents: useVents, breakDoors: false });
      if (!ok || (this.path && this.path.some((p) => p.door === door))) {
        // no other way: scratch at it for a while, then give up
        this.game.audio.scratch(c);
        this.path = null;
        this.onPathFailed();
      }
      return true;
    }
    return true;
  }

  _enterVent(target) {
    const [from, to] = target.vent;
    this.mode = 'vent';
    this.anim.setPose('squeeze', 0.2);
    const a = this.world.vents.find((v) => v.id === from.id);
    const b = this.world.vents.find((v) => v.id === to.id);
    const dist = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) + Math.abs(a.f - b.f) * 4;
    this.vent = { a, b, t: 0, phase: 'in', travel: 1.2 + dist / 4.5, scratch: 0 };
    this.game.audio.ventRattle(a.pos);
  }

  _updateVent(dt) {
    const v = this.vent;
    v.t += dt;
    if (v.phase === 'in') {
      // squeeze in through the grille
      const k = Math.min(1, v.t / 0.8);
      tmp.copy(v.a.pos).addScaledVector(v.a.normal, 0.6 * (1 - k));
      this.pos.set(tmp.x, floorBaseY(v.a.f), tmp.z);
      this.yaw = Math.atan2(-v.a.normal.x, -v.a.normal.z);
      this.model.root.scale.set(1 - k * 0.5, 1 - k * 0.6, 1);
      if (k >= 1) { v.phase = 'travel'; v.t = 0; this.model.root.visible = false; }
      return;
    }
    if (v.phase === 'travel') {
      const k = Math.min(1, v.t / v.travel);
      // an invisible sound source crawls through the walls
      this.ventSound = tmp.lerpVectors(v.a.pos, v.b.pos, k).clone();
      v.scratch -= dt;
      if (v.scratch <= 0) {
        v.scratch = 0.25 + Math.random() * 0.4;
        this.game.audio.ventScratch(this.ventSound);
      }
      if (k >= 1) {
        v.phase = 'out'; v.t = 0;
        this.floor = v.b.f;
        this.model.root.visible = true;
        this.game.audio.ventRattle(v.b.pos);
      }
      return;
    }
    const k = Math.min(1, v.t / 0.8);
    tmp.copy(v.b.pos).addScaledVector(v.b.normal, 0.7 * k);
    this.pos.set(tmp.x, floorBaseY(v.b.f), tmp.z);
    this.yaw = Math.atan2(v.b.normal.x, v.b.normal.z);
    this.model.root.scale.set(0.5 + k * 0.5, 0.4 + k * 0.6, 1);
    if (k >= 1) {
      this.model.root.scale.set(1, 1, 1);
      this.mode = 'floor';
      this.ventSound = null;
      this.vent = null;
      // continue along the path after the vent exit
      if (this.path) {
        this.pathI++;
        if (this.pathI >= this.path.length) this.path = null;
      }
      const g = this.goal;
      if (g) this.goTo(g.f, g.x, g.z, this.moveOpts);
    }
  }

  // ================================================================ perception
  _perceive(dt) {
    const p = this.player;
    const d = this.diff;
    // track the player's velocity for prediction
    this.playerVel.subVectors(p.pos, this.lastPlayerPos).divideScalar(Math.max(dt, 1e-3));
    this.lastPlayerPos.copy(p.pos);
    if (this.hidden || this.lurkSpot || this.state.name === 'attack' || p.dead) { this.seesPlayer = false; return; }
    const eye = this.headPos(tmp);
    const vis = this._visibility(eye);
    this.seesPlayer = vis > 0;
    if (vis > 0) {
      this.detection = Math.min(1.2, this.detection + vis * dt * 2.4 * d.detectRate * this.mood);
      if (this.detection > 0.3) this.lastSeen = { pos: p.pos.clone(), time: this.now, vel: this.playerVel.clone(), floor: p.floor };
    } else {
      this.detection = Math.max(0, this.detection - dt * (this.state.name === 'chase' ? 0.12 : 0.3));
    }
  }

  /** 0 = can't see you, >0 = how clearly (per second detection gain). */
  _visibility(eye) {
    const p = this.player;
    const d = this.diff;
    if (p.hiding) return 0;
    const target = tmp2.set(p.pos.x, p.pos.y + p.eye * 0.8, p.pos.z);
    const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (Math.abs(p.pos.y - this.pos.y) > 2.4 && dist > 3) return 0;
    const fwdX = Math.sin(this.yaw + (this.anim.twitch.yaw || 0) * 0.5), fwdZ = Math.cos(this.yaw);
    const cosA = (dx * fwdX + dz * fwdZ) / Math.max(0.001, Math.hypot(dx, dz));
    const half = (d.sightFov * Math.PI) / 360;
    let angleK = cosA > Math.cos(half) ? 1 : cosA > Math.cos(Math.min(Math.PI * 0.85, half * 1.6)) ? 0.3 : 0;
    if (dist < 1.6) angleK = Math.max(angleK, 0.8);
    if (angleK <= 0) return 0;
    // light at the player's position
    let light = 0.12;
    const room = p.room;
    if (room) light += this.world.lighting.lightAt(room.index, p.pos);
    light += this.world.exterior.lightning * 0.8;
    if (p.flash.on) {
      light += 0.5;
      // shining the flashlight toward the cat makes you a beacon
      const toCat = tmp.set(eye.x - p.flash.pos.x, eye.y - p.flash.pos.y, eye.z - p.flash.pos.z).normalize();
      if (toCat.dot(p.flash.dir) > 0.85) light += 1.2 + this.learn.lightReliance();
    }
    light = Math.min(2, light);
    const range = d.sightRange * (0.35 + 0.65 * Math.min(1, light));
    if (dist > range) return 0;
    // occlusion: walls, closed doors, tall furniture
    const eyeC = this.headPos(new THREE.Vector3());
    if (this.world.collision.segmentBlocked(eyeC, target)) {
      // try the head too
      const head = tmp.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
      if (this.world.collision.segmentBlocked(eyeC, head)) return 0;
    }
    const stance = p.stance === 'prone' ? 0.3 : p.stance === 'crouch' ? 0.55 : 1;
    const move = 0.55 + Math.min(0.65, p.moving / 3);
    const near = Math.pow(1 - dist / range, 1.3);
    if (dist < 1.8) return 3;
    return angleK * stance * move * (0.35 + light * 0.65) * (0.35 + near * 1.6);
  }

  /** Called for every noise in the house. */
  hear(n) {
    if (this.hidden && this.state.name !== 'dormant') {
      // still listening from inside the walls
    }
    if (n.source === 'cat' || this.state.name === 'attack' || this.state.name === 'lured' || this.state.name === 'scripted') return;
    const d = this.diff;
    const occ = this.grid.occlusion(this.floor, this.pos.x, this.pos.z, n.floor, n.pos.x, n.pos.z);
    const eff = n.radius * d.hearing * this.mood * (this.state.name === 'dormant' ? 0.6 : 1) - occ.walls * 2.2 - occ.doors * 3.2 - occ.floors * 6;
    const dist = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z) + Math.abs(n.pos.y - this.pos.y);
    if (eff <= 0 || dist > eff) return;
    const strength = (eff - dist) / eff;
    this.lastHeard = { ...n, time: this.now, strength };
    this.game.onCatHeard(n, strength);
    const st = this.state.name;
    if (st === 'chase' && this.seesPlayer) return;
    // distractions: learn to see through them
    if (n.kind === 'distraction') {
      this.learn.recordDistraction();
      const sus = this.learn.distractionSuspicion(this.now, d);
      if (this.rng.next() < sus) {
        if (n.from && this.rng.chance(0.4 + d.deception * 0.5)) {
          // it knows where the throw came from
          this._investigate(n.floor, n.from.x, n.from.z, true, 'sawThrough');
          this.game.onCatSeesThrough();
        } else if (this.rng.chance(0.5)) {
          // not fooled, and it wants you to know
          this.game.audio.catVocal('laugh', this.headPos(new THREE.Vector3()));
        }
        return;
      }
    }
    if (['check', 'attack', 'recoil'].includes(st)) {
      // a hidden player gasping right next to it
      if (st === 'check' && n.kind === 'gasp') this.state.data.heardGasp = true;
      return;
    }
    if (st === 'dormant') {
      if (strength > 0.25 && this.game.director.allowWake()) this._wakeNear(n);
      return;
    }
    // loud and close while stalking or searching -> go look fast
    if (st === 'chase') {
      if (!this.seesPlayer && strength > 0.2) this.lastSeen = { pos: n.pos.clone(), time: this.now, vel: new THREE.Vector3(), floor: n.floor };
      return;
    }
    if (this.lurkSpot) {
      // something right next to its bed: out it comes
      if (strength > 0.6 && this.distTo(n.pos) < 4) this._burstFromUnder(n);
      return;
    }
    if (st === 'stare' || st === 'ambush') {
      if (strength > 0.5 && this.distTo(n.pos) < 8) this._investigate(n.floor, n.pos.x, n.pos.z, true, n.kind);
      return;
    }
    if (st === 'investigate' && this.state.data.strength > strength + 0.2) return;
    this._investigate(n.floor, n.pos.x, n.pos.z, strength > 0.55 || n.radius >= 14, n.kind, strength, n);
  }

  distTo(v) { return Math.hypot(v.x - this.pos.x, v.z - this.pos.z) + Math.abs(v.y - this.pos.y); }

  _wakeNear(n) {
    // appear from the nearest vent to the noise, out of sight if possible
    const v = this._ventNear(n.floor, n.pos, 6, 22);
    if (v) {
      this.teleport(v.f, v.mouth.x, v.mouth.z, Math.atan2(v.normal.x, v.normal.z));
      this.game.audio.ventRattle(v.pos);
    }
    this._investigate(n.floor, n.pos.x, n.pos.z, false, n.kind, 0.5, n);
  }

  _ventNear(f, pos, minD = 0, maxD = 30, unseen = true) {
    const cands = this.world.vents.filter((v) => {
      if (v.f !== f) return false;
      const d = Math.hypot(v.mouth.x - pos.x, v.mouth.z - pos.z);
      if (d < minD || d > maxD) return false;
      if (unseen && this.game.canPlayerSee(v.mouth, 2)) return false;
      return true;
    });
    if (!cands.length) return null;
    cands.sort((a, b) => Math.hypot(a.mouth.x - pos.x, a.mouth.z - pos.z) - Math.hypot(b.mouth.x - pos.x, b.mouth.z - pos.z));
    return cands[0];
  }

  // ================================================================ brain
  update(dt) {
    if (!this.game.run) return;
    const d = this.diff;
    this.mood = this.world.lighting.power ? 1 : d.outageAggro;
    this.state.t += dt;
    this.sinceChase += dt;
    this.ambushCooldown -= dt;
    this.stun = Math.max(0, this.stun - dt);
    // perception at ~10 Hz
    this.percT -= dt;
    if (this.percT <= 0) {
      const pdt = 0.1 - this.percT;
      this.percT = 0.1;
      this._perceive(pdt);
    }
    if (this.mode === 'vent') {
      this._updateVent(dt);
    } else {
      this._think(dt);
      this._move(dt);
    }
    this._vocalise(dt);
    this._syncModel(dt);
    this._checkVisibleToPlayer(dt);
    this.learn.tick(dt, this.player.room ? this.player.room.index : -1, this.player.flash.on);
  }

  _think(dt) {
    const s = this.state;
    const p = this.player;
    // universal: detection -> chase (unless busy with something special)
    const busy = ['attack', 'recoil', 'lured', 'scripted', 'dormant', 'check'].includes(s.name);
    if (!busy && this.detection >= 1 && !p.hiding && s.name !== 'chase') {
      this._startChase();
      return;
    }
    switch (s.name) {
      case 'dormant': this._stDormant(dt); break;
      case 'patrol': this._stPatrol(dt); break;
      case 'investigate': this._stInvestigate(dt); break;
      case 'stalk': this._stStalk(dt); break;
      case 'chase': this._stChase(dt); break;
      case 'search': this._stSearch(dt); break;
      case 'check': this._stCheck(dt); break;
      case 'ambush': this._stAmbush(dt); break;
      case 'stare': this._stStare(dt); break;
      case 'fakeLeave': this._stFakeLeave(dt); break;
      case 'attack': this._stAttack(dt); break;
      case 'recoil': this._stRecoil(dt); break;
      case 'lured': this._stLured(dt); break;
      default: break;
    }
  }

  onPathFailed() {
    const n = this.state.name;
    if (n === 'chase') this._startSearch(this.lastSeen ? this.lastSeen.pos : this.pos);
    else if (n === 'check') this.setState('search', this.state.data.search || {});
    else this.setState('patrol');
  }

  // ---------------------------------------------------------------- dormant
  _stDormant() {
    // the director wakes the cat up (see Director)
  }

  /** Bring the cat into the house somewhere away from the player. */
  emerge(nearRoom = null) {
    const p = this.player;
    const rooms = this.grid.rooms.filter((r) => r.key !== '0Z' && r.kind !== 'secret' && r.kind !== 'stairs');
    let cands = rooms;
    if (nearRoom) {
      cands = rooms.filter((r) => Math.hypot(r.cx - nearRoom.cx, r.cz - nearRoom.cz) < 14 && r.floor === nearRoom.floor);
    }
    cands = cands.filter((r) => {
      const dd = Math.hypot(r.cx - p.pos.x, r.cz - p.pos.z) + Math.abs(r.floor - p.floor) * 6;
      return dd > 11;
    });
    if (!cands.length) cands = rooms.filter((r) => r.floor !== p.floor);
    const room = this.rng.pick(cands);
    const pt = this.nav.randomPointInRoom(room, this.rng);
    if (!pt) return;
    this.teleport(pt.f, pt.x, pt.z, this.rng.float(0, 6.28));
    this.setState('patrol');
  }

  // ---------------------------------------------------------------- patrol
  _stPatrol(dt) {
    const s = this.state;
    const d = this.diff;
    if (!s.data.target || (this.arrived && s.data.wait <= 0)) {
      if (s.data.target && this.arrived && s.data.lingers > 0) {
        // wander a little inside the room
        s.data.lingers--;
        const pt = this.nav.randomPointInRoom(s.data.room, this.rng);
        if (pt) this.goTo(pt.f, pt.x, pt.z, this._patrolMove());
        s.data.wait = this.rng.float(0.5, 2.5);
        return;
      }
      const room = this._chooseRoom();
      const pt = room && this.nav.randomPointInRoom(room, this.rng);
      if (!pt || !this.goTo(pt.f, pt.x, pt.z, this._patrolMove())) { s.data.target = null; return; }
      s.data = { target: pt, room, lingers: this.rng.int(0, 2), wait: 0 };
      // occasionally set an ambush instead of wandering
      if (this.ambushCooldown <= 0 && this.rng.chance(d.ambush * (this.relaxing ? 0.3 : 1))) this._startAmbush();
      return;
    }
    if (this.arrived) {
      s.data.wait -= dt;
      this.anim.setPose(s.data.wait > 1 ? 'sniff' : 'stand', 0.4);
    }
    // stalking: sees something but isn't sure
    if (this.detection > 0.35 && this.seesPlayer && this.rng.chance(dt * 2)) {
      if (this.rng.chance(d.stalk)) this._startStalk();
      else this._investigate(this.player.floor, this.player.pos.x, this.player.pos.z, false, 'glimpse', 0.6);
    }
  }

  _patrolMove() {
    const d = this.diff;
    const silent = this.rng.chance(d.silentMove);
    if (silent) this.silentUntil = this.now + this.rng.float(6, 20);
    return {
      speed: d.catWalk * this.rng.float(0.85, 1.1) * (this.relaxing ? 0.85 : 1),
      pose: this.rng.chance(0.18) ? 'crawl' : 'walk',
      doorMode: this.rng.chance(0.35 + d.deception * 0.3) ? 'quiet' : 'normal',
      vents: this.rng.chance(d.ventUse * 0.35),
      ceiling: this.rng.chance(0.12 + d.deception * 0.15),
    };
  }

  _chooseRoom() {
    const p = this.player;
    const pr = p.room || p.currentRoom;
    const cur = this.room;
    const rooms = this.grid.rooms.filter((r) => r.key !== '0Z' && r.kind !== 'stairs' && (!cur || r !== cur) && r.cells.length > 2);
    const leash = this.leashRoom;
    return this.rng.weighted(rooms, (r) => {
      let w = this.learn.roomWeight(r.index);
      if (r.kind === 'secret') w *= 0.3;
      const dCat = Math.hypot(r.cx - this.pos.x, r.cz - this.pos.z) + Math.abs(r.floor - this.floor) * 8;
      w *= 1 / (1 + dCat * 0.04);
      if (pr) {
        const dP = Math.hypot(r.cx - pr.cx, r.cz - pr.cz) + Math.abs(r.floor - pr.floor) * 7;
        if (this.relaxing) w *= dP > 16 ? 2.5 : 0.25;
        else w *= 1 + (this.aggression * 3) / (1 + dP * 0.25);
      }
      if (leash && r === leash) w *= 6;
      return w;
    });
  }

  // ---------------------------------------------------------------- investigate
  _investigate(f, x, z, urgent = false, kind = 'noise', strength = 0.5, noise = null) {
    // error grows with distance
    const dist = Math.hypot(x - this.pos.x, z - this.pos.z);
    const err = Math.min(3, dist * 0.08) * (1 - strength * 0.5);
    const tx = x + this.rng.float(-err, err), tz = z + this.rng.float(-err, err);
    const d = this.diff;
    const ok = this.goTo(f, tx, tz, {
      speed: urgent ? d.catRun * 0.92 : d.catWalk * 1.35,
      pose: urgent ? 'run' : 'stalk',
      doorMode: urgent ? 'burst' : 'normal',
      vents: urgent && this.rng.chance(d.ventUse * 0.5),
    });
    if (!ok) return;
    this.setState('investigate', { f, x: tx, z: tz, urgent, kind, strength, noise, look: 0 });
    if (urgent) this.game.audio.catVocal('growl', this.pos);
  }

  _stInvestigate(dt) {
    const s = this.state;
    if (!this.arrived) {
      this.anim.setPose(s.data.urgent ? 'run' : 'stalk', 0.3);
      return;
    }
    s.data.look += dt;
    this.anim.setPose(s.data.look < 1.8 ? 'sniff' : 'stand', 0.4);
    this.anim.headLookYaw = Math.sin(s.data.look * 1.4) * 0.9;
    if (s.data.look > 2.6) {
      this.anim.headLookYaw = 0;
      const n = s.data.noise;
      if (n && n.kind === 'distraction') this.learn.recordFooled(this.now);
      // check hiding spots around the noise, then give up
      this._startSearch(new THREE.Vector3(s.data.x, this.pos.y, s.data.z), { short: true, heardNoise: n && ['gasp', 'breath', 'hide'].includes(n.kind) });
    }
  }

  // ---------------------------------------------------------------- stalk
  _startStalk() {
    this.setState('stalk', { repath: 0, freeze: 0 });
  }

  _stStalk(dt) {
    const s = this.state;
    const p = this.player;
    const d = this.diff;
    const dist = this.distToPlayer();
    // weeping-angel flavour: freeze when watched, move when not
    const watched = this.visibleToPlayer && this.watchedAmount > 0.4;
    s.data.repath -= dt;
    if (watched) {
      this.stop();
      this.anim.setPose('stare', 0.2);
      s.data.freeze += dt;
      if (s.data.freeze > 1.2 + this.rng.next() * 2 || dist < 4) { this._startChase(true); return; }
    } else if (s.data.repath <= 0) {
      s.data.repath = 0.6;
      // keep ~6m behind the player
      const back = tmp.set(this.pos.x - p.pos.x, 0, this.pos.z - p.pos.z).normalize().multiplyScalar(6);
      this.goTo(p.floor, p.pos.x + back.x, p.pos.z + back.z, { speed: d.catWalk * 1.4, pose: 'stalk', doorMode: 'quiet', ceiling: this.rng.chance(0.3) });
      this.silentUntil = this.now + 2;
    }
    if (!watched && dist < 3.2 && this.rng.chance(dt * 0.8)) { this._startChase(true); return; }
    if (s.t > 25 || (!this.seesPlayer && s.t > 6 && this.detection < 0.1)) this._startSearch(p.pos.clone(), { short: true });
  }

  // ---------------------------------------------------------------- chase
  _startChase(sudden = false) {
    const p = this.player;
    this.setState('chase', { repath: 0, lostFor: 0, sudden });
    this.detection = 1;
    this.chaseTime = 0;
    this.stats.chases++;
    this.lastSeen = { pos: p.pos.clone(), time: this.now, vel: this.playerVel.clone(), floor: p.floor };
    this.game.onChaseStart(sudden);
    this.silentUntil = 0;
    if (this.mode === 'ceiling') this.mode = 'floor';
  }

  _stChase(dt) {
    const s = this.state;
    const p = this.player;
    const d = this.diff;
    this.chaseTime += dt;
    this.sinceChase = 0;
    const speed = Math.min(d.catRunMax, d.catRun + (d.catRunMax - d.catRun) * (this.chaseTime / 6));
    s.data.repath -= dt;
    if (this.seesPlayer) s.data.lostFor = 0;
    else s.data.lostFor += dt;
    // the player dove into a hiding spot in front of it
    if (p.hiding && s.data.sawHide) {
      this._startCheck(p.hiding.spot, { saw: true, search: {} });
      return;
    }
    if (s.data.repath <= 0) {
      s.data.repath = this.seesPlayer ? 0.3 : 0.6;
      let tx, tz, tf;
      if (this.seesPlayer || s.data.lostFor < 0.8) {
        tx = p.pos.x; tz = p.pos.z; tf = p.floor;
      } else if (this.lastSeen) {
        // predict where you ran
        const lead = Math.min(2.5, s.data.lostFor);
        tx = this.lastSeen.pos.x + this.lastSeen.vel.x * lead * 0.6;
        tz = this.lastSeen.pos.z + this.lastSeen.vel.z * lead * 0.6;
        tf = this.lastSeen.floor;
      }
      if (tx !== undefined && !this.goTo(tf, tx, tz, { speed, pose: 'run', doorMode: 'burst' })) {
        if (this.lastSeen) this.goTo(this.lastSeen.floor, this.lastSeen.pos.x, this.lastSeen.pos.z, { speed, pose: 'run', doorMode: 'burst' });
      }
    }
    if (this.moveOpts) this.moveOpts.speed = speed;
    this.anim.setPose('run', 0.2);
    // catch
    const dist = this.distToPlayer();
    if (!p.hiding && dist < d.grabRange && (this.seesPlayer || dist < 0.9) && this.stun <= 0) {
      this._startAttack('chase');
      return;
    }
    if (s.data.lostFor > d.loseTrack || (this.arrived && !this.seesPlayer && s.data.lostFor > 1.2)) {
      this.game.onChaseLost();
      this._startSearch(this.lastSeen ? this.lastSeen.pos.clone() : this.pos.clone());
    }
  }

  /** Called by the game when the player hides while the cat watches. */
  noticeHide(spot) {
    if (this.hidden) return false;
    const seen = this.seesPlayer || (this.state.name === 'chase' && this.state.data.lostFor < 0.6 && this.distToPlayer() < 9);
    const d = this.diff;
    const caught = seen && this.rng.chance(d.checkSeenEntering);
    this.learn.recordHide(spot.id, caught);
    if (caught && this.state.name === 'chase') this.state.data.sawHide = true;
    else if (caught) this._startCheck(spot, { saw: true, search: {} });
    return caught;
  }

  // ---------------------------------------------------------------- search
  _startSearch(center, opts = {}) {
    const d = this.diff;
    const room = this.grid.roomAtWorld(this.floor, center.x, center.z) || this.room;
    this.setState('search', {
      center: center.clone(), room, until: this.now + (opts.short ? d.searchTime * 0.4 : d.searchTime),
      checked: new Set(), next: 0, heardNoise: !!opts.heardNoise, checks: 0,
    });
  }

  _stSearch(dt) {
    const s = this.state;
    const d = this.diff;
    const data = s.data;
    if (this.now > data.until) {
      if (this.rng.chance(d.fakeLeave) && data.checks > 0) { this._startFakeLeave(data.center); return; }
      this.setState('patrol');
      return;
    }
    if (!this.arrived) { this.anim.setPose(this.speed > 2 ? 'run' : 'stalk', 0.3); return; }
    data.next -= dt;
    this.anim.setPose('sniff', 0.4);
    this.anim.headLookYaw = Math.sin(this.state.t * 1.1) * 0.8;
    if (data.next > 0) return;
    this.anim.headLookYaw = 0;
    // choose: check a hiding spot, or sweep a nearby point
    const spots = this.world.hidingSpots.filter((h) => h.f === this.floor && !data.checked.has(h.id) && Math.hypot(h.entry.x - data.center.x, h.entry.z - data.center.z) < 8);
    let best = null, bestP = 0;
    for (const h of spots) {
      const lastSeenNear = this.lastSeen && Math.hypot(h.entry.x - this.lastSeen.pos.x, h.entry.z - this.lastSeen.pos.z) < 3.5 && this.now - this.lastSeen.time < 15;
      const pr = this.learn.checkChance(h, d, { heardNoise: data.heardNoise, lastSeenNear }) * (0.8 + this.rng.next() * 0.4);
      if (pr > bestP) { bestP = pr; best = h; }
    }
    if (best && this.rng.next() < bestP) {
      data.checked.add(best.id);
      data.checks++;
      this._startCheck(best, { search: data });
      return;
    }
    if (best) data.checked.add(best.id);
    // sweep: a random point in this or an adjacent room
    let room = data.room || this.room;
    if (room && this.rng.chance(0.35)) {
      const nb = this.grid.neighbours(room).filter((r) => r.key !== '0Z');
      if (nb.length) room = this.rng.pick(nb);
    }
    const pt = room && this.nav.randomPointInRoom(room, this.rng);
    if (pt) this.goTo(pt.f, pt.x, pt.z, { speed: d.catWalk * 1.25, pose: 'stalk', doorMode: 'normal' });
    data.next = this.rng.float(0.6, 2.2);
    if (this.rng.chance(0.12)) this.game.audio.catVocal(this.rng.chance(0.5) ? 'laugh' : 'meow', this.pos);
  }

  // ---------------------------------------------------------------- check a hiding spot
  _startCheck(spot, ctx = {}) {
    this.stats.checks++;
    this.goTo(spot.f, spot.entry.x, spot.entry.z, { speed: ctx.saw ? this.diff.catRun : this.diff.catWalk * 1.3, pose: ctx.saw ? 'run' : 'stalk', doorMode: ctx.saw ? 'burst' : 'normal' });
    this.setState('check', { spot, phase: 'approach', saw: !!ctx.saw, search: ctx.search || {}, t2: 0, heardGasp: false });
  }

  _stCheck(dt) {
    const s = this.state;
    const data = s.data;
    const spot = data.spot;
    const p = this.player;
    if (data.phase === 'approach') {
      this.anim.setPose(this.speed > 2 ? 'run' : 'stalk', 0.3);
      if (!p.hiding && this.seesPlayer && this.detection > 0.6) { this._startChase(); return; }
      if (this.arrived || s.t > 14) {
        data.phase = 'sniff';
        data.t2 = 0;
        data.sniffTime = data.saw ? 0.4 : this.rng.float(1.2, 3.2);
      }
      return;
    }
    const face = Math.atan2(spot.inside.x - this.pos.x, spot.inside.z - this.pos.z);
    this.yaw = turnToward(this.yaw, face, dt * 6);
    data.t2 += dt;
    const inside = p.hiding && p.hiding.spot === spot;
    if (data.phase === 'sniff') {
      this.anim.setPose(spot.type === 'bed' ? 'lookUnder' : 'sniff', 0.4);
      // it can smell you: purring right outside
      if (inside) {
        this.purrT -= dt;
        if (this.purrT <= 0) { this.purrT = 1.6; this.game.audio.catVocal('purr', this.headPos(new THREE.Vector3())); }
        if (p.holdingBreath) data.sniffTime += dt * 0.3;
      }
      if (data.t2 > data.sniffTime) {
        // last chance: a quiet player who holds their breath might be spared
        const d = this.diff;
        let open = true;
        if (!data.saw && inside && p.holdingBreath && !data.heardGasp) open = this.rng.chance(0.55 + d.deception * 0.3);
        if (!open) { data.phase = 'leave'; data.t2 = 0; return; }
        data.phase = 'open';
        data.t2 = 0;
        this.game.audio.hideSound(spot.type, spot.inside, true);
      }
      return;
    }
    if (data.phase === 'open') {
      this.anim.setPose(spot.type === 'bed' ? 'lookUnder' : 'reach', 0.2);
      const k = Math.min(1, data.t2 / 0.45);
      spot.setOpen(k);
      if (k >= 1) {
        if (inside) { this._startAttack('hide', spot); return; }
        data.phase = 'close';
        data.t2 = 0;
      }
      return;
    }
    if (data.phase === 'close') {
      const k = Math.min(1, data.t2 / 0.8);
      spot.setOpen(1 - k);
      if (k >= 1) data.phase = 'leave';
      return;
    }
    // leave: return to searching
    spot.setOpen(0);
    if (data.search && data.search.until) {
      this.state = { name: 'search', t: 0, data: data.search, prev: 'check' };
      data.search.next = 0.5;
    } else this._startSearch(this.pos.clone(), { short: true });
  }

  // ---------------------------------------------------------------- ambush
  _startAmbush() {
    const p = this.player;
    const d = this.diff;
    this.ambushCooldown = 45 / (0.5 + d.ambush);
    // predict: a room the player likes, or where their items say they're headed
    let room = null;
    const goal = this.game.objectives ? this.game.objectives.predictedGoalRoom() : null;
    if (goal && this.rng.chance(0.4 + d.deception * 0.3)) room = goal;
    if (!room) {
      const fav = this.learn.favouriteRooms(4).map((i) => this.grid.rooms[i]).filter((r) => r && r !== p.room && r.key !== '0Z');
      room = fav.length ? this.rng.pick(fav) : null;
    }
    if (!room || room === p.room) return;
    // wait on its ceiling, under one of its beds, or low in a corner
    const beds = this.world.hidingSpots.filter((h) => h.type === 'bed' && h.room === room.index && !(p.hiding && p.hiding.spot === h));
    const ceiling = this.rng.chance(0.35 + d.deception * 0.3);
    const under = !ceiling && beds.length && this.rng.chance(0.6) ? this.rng.pick(beds) : null;
    const pt = under ? { f: under.f, x: under.exit.x, z: under.exit.z } : this.nav.randomPointInRoom(room, this.rng);
    if (!pt) return;
    if (!this.goTo(pt.f, pt.x, pt.z, { speed: d.catWalk * 1.5, pose: 'crawl', doorMode: 'quiet', vents: this.rng.chance(d.ventUse) })) return;
    this.stats.ambushes++;
    this.setState('ambush', { room, ceiling, under, wait: this.rng.float(25, 45), lurking: false });
    this.silentUntil = this.now + 60;
  }

  _stAmbush(dt) {
    const s = this.state;
    const p = this.player;
    if (!this.arrived) { this.anim.setPose('crawl', 0.3); return; }
    if (!s.data.lurking) {
      s.data.lurking = true;
      if (s.data.ceiling) this.mode = 'ceiling';
      if (s.data.under) {
        // someone got into that bed while it was on its way
        if (p.hiding && p.hiding.spot === s.data.under) { this._startCheck(s.data.under, {}); return; }
        this._slideUnder(s.data.under);
      }
    }
    if (this.lurkSpot) { this._stLurkUnder(dt); return; }
    this.anim.setPose(this.mode === 'ceiling' ? 'crawl' : 'lookUnder', 0.5);
    this.anim.headLookYaw = 0;
    s.data.wait -= dt;
    const dist = this.distToPlayer();
    const spotted = this.visibleToPlayer && this.watchedAmount > 0.6 && dist < 9;
    if ((dist < 3.2 && !p.hiding && Math.abs(p.pos.y - this.pos.y) < 2.5) || spotted) {
      this.game.onAmbush(this.mode === 'ceiling');
      if (this.mode === 'ceiling') this.mode = 'floor';
      this._startChase(true);
      return;
    }
    if (s.data.wait <= 0) { this.mode = 'floor'; this.setState('patrol'); }
  }

  // ---------------------------------------------------------------- under the bed
  _slideUnder(spot) {
    this.stop();
    this.lurkSpot = spot;
    this.detection = 0;
    this.model.root.visible = false;
    const out = tmp.copy(spot.exit).sub(spot.inside).setY(0).normalize();
    // the face rests just inside the bed's edge, chin on the floorboards
    const f = this.face.root;
    f.position.copy(spot.exit).addScaledVector(out, -0.8);
    f.position.y = this.grid.groundY(spot.f, f.position.x, f.position.z) + 0.1;
    this.lurkYaw = Math.atan2(out.x, out.z);
    f.rotation.set(0, this.lurkYaw, 0);
    this.face.head.rotation.set(0.12, 0, 0);
    this.face.blink(1);
    f.visible = true;
    this.lurkWatched = 0;
    this.purrT = this.rng.float(2, 5);
    this.blinkT = this.rng.float(2, 6);
    this.game.audio.hideSound('bed', spot.inside, false);
  }

  _unlurk() {
    this.lurkSpot = null;
    this.face.root.visible = false;
    this.face.blink(1);
    this.model.root.visible = this.mode !== 'hidden';
  }

  _stLurkUnder(dt) {
    const s = this.state;
    const p = this.player;
    const d = this.diff;
    const spot = this.lurkSpot;
    const face = this.face.root;
    // you crawled under *this* bed
    if (p.hiding && p.hiding.spot === spot) { this._startAttack('under', spot); return; }
    const dist = Math.hypot(p.pos.x - face.position.x, p.pos.z - face.position.z) + Math.abs(p.pos.y - this.pos.y) * 2;
    // the eyes follow you across the room
    const toP = Math.atan2(p.pos.x - face.position.x, p.pos.z - face.position.z);
    let rel = toP - this.lurkYaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const want = this.lurkYaw + Math.max(-0.8, Math.min(0.8, rel));
    face.rotation.y = turnToward(face.rotation.y, want, dt * 1.2);
    // slow blinks
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      const b = -this.blinkT;
      this.face.blink(b < 0.25 ? 1 - b / 0.25 : Math.min(1, (b - 0.25) / 0.3));
      if (b > 0.6) { this.blinkT = this.rng.float(3, 8); this.face.blink(1); }
    }
    // being looked at: eyes on screen, near the middle, lit or close
    const eyes = tmp2.set(face.position.x, face.position.y + 0.08, face.position.z);
    let looked = false;
    if (p.floor === this.floor && dist < 12 && this.game.canPlayerSee(eyes, 0)) {
      const cam = this.game.camera;
      const fwd = tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const to = eyes.clone().sub(cam.position).normalize();
      const centred = to.dot(fwd);
      const lit = p.flash.on && to.dot(p.flash.dir) > 0.93;
      looked = centred > 0.93 && (lit || dist < 4.5);
    }
    this.lurkWatched = looked ? this.lurkWatched + dt : Math.max(0, this.lurkWatched - dt * 0.5);
    // you're right there, or you've been staring into its eyes too long
    if (!p.hiding && p.floor === this.floor && (dist < 1.9 || this.lurkWatched > 0.6 + (1 - d.deception) * 0.6)) { this._burstFromUnder(); return; }
    // a fair warning, most nights
    this.purrT -= dt;
    if (this.purrT <= 0) {
      this.purrT = this.rng.float(4, 8);
      if (dist < 5 && this.rng.chance(1 - d.deception * 0.7)) this.game.audio.catVocal('purr', eyes.clone());
    }
    s.data.wait -= dt;
    if (s.data.wait <= 0) {
      // only slip away when nobody is watching the bed
      if (this.game.canPlayerSee(eyes, 0.2)) { s.data.wait = 2; return; }
      this.setState('patrol');
    }
  }

  _burstFromUnder(noise = null) {
    const spot = this.lurkSpot;
    const p = this.player;
    this._unlurk();
    this.pos.set(spot.exit.x, this.grid.groundY(spot.f, spot.exit.x, spot.exit.z), spot.exit.z);
    this.yaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    this.anim.setPose('crawl', 0.05);
    this.game.audio.hideSound('bed', spot.inside, true);
    // a noise it came out for, with you nowhere near: go and see
    if (noise && (this.distToPlayer() > 4 || p.floor !== this.floor)) {
      this._investigate(noise.floor, noise.pos.x, noise.pos.z, true, noise.kind, 1, noise);
      return;
    }
    this.game.onAmbush(false);
    this._startChase(true);
  }

  // ---------------------------------------------------------------- stare
  /** Director: stand at the end of a hallway and stare. */
  startStare(f, x, z) {
    this.teleport(f, x, z, 0);
    const p = this.player;
    this.yaw = Math.atan2(p.pos.x - x, p.pos.z - z);
    this.stats.stares++;
    this.setState('stare', { dur: this.rng.float(3.5, 9), lit: 0 });
    this.silentUntil = this.now + 30;
    this.stop();
  }

  _stStare(dt) {
    const s = this.state;
    const p = this.player;
    const d = this.diff;
    this.anim.setPose('stare', 0.6);
    this.yaw = turnToward(this.yaw, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z), dt * 1.5);
    const dist = this.distToPlayer();
    // flashlight in its eyes
    if (p.flash.on && this.visibleToPlayer && this.watchedAmount > 0.7) s.data.lit += dt; else s.data.lit = Math.max(0, s.data.lit - dt);
    const provoke = dist < 5.5 || s.data.lit > 0.9;
    if (provoke || s.t > s.data.dur) {
      if (provoke && this.rng.chance(0.35 + d.deception * 0.5)) { this._startChase(true); return; }
      // melt back into the dark
      this.game.onStareEnd();
      if (!this.visibleToPlayer || this.rng.chance(0.5)) { this.hide(); this.setState('dormant', { returnIn: this.rng.float(6, 14) }); }
      else {
        const pt = this.nav.randomPointInRoom(this.room || this.grid.rooms[0], this.rng);
        this.setState('patrol');
        if (pt) this.goTo(pt.f, pt.x, pt.z, { speed: d.catWalk * 1.2, pose: 'walk' });
      }
    }
  }

  // ---------------------------------------------------------------- fake leave
  _startFakeLeave(center) {
    const d = this.diff;
    // stomp away loudly, slam something far off, then creep back
    const away = this.grid.rooms.filter((r) => r.floor === this.floor && Math.hypot(r.cx - center.x, r.cz - center.z) > 10 && r.key !== '0Z');
    const room = this.rng.pick(away.length ? away : this.grid.rooms);
    const pt = this.nav.randomPointInRoom(room, this.rng);
    if (!pt || !this.goTo(pt.f, pt.x, pt.z, { speed: d.catWalk * 1.3, pose: 'walk', doorMode: 'normal' })) { this.setState('patrol'); return; }
    this.setState('fakeLeave', { center: center.clone(), phase: 'leave', wait: 0 });
    this.silentUntil = 0;
    this.loudSteps = true;
  }

  _stFakeLeave(dt) {
    const s = this.state;
    const d = this.diff;
    const data = s.data;
    if (data.phase === 'leave') {
      this.anim.setPose('walk', 0.3);
      if (this.arrived || s.t > 12) {
        this.loudSteps = false;
        this.game.audio.distantSlam(this.pos.clone());
        data.phase = 'return';
        this.silentUntil = this.now + 40;
        this.goTo(this.floor, data.center.x + this.rng.float(-1.5, 1.5), data.center.z + this.rng.float(-1.5, 1.5), { speed: d.catWalk * 1.1, pose: 'crawl', doorMode: 'quiet' });
      }
      return;
    }
    if (data.phase === 'return') {
      this.anim.setPose('crawl', 0.3);
      if (this.arrived) { data.phase = 'wait'; data.wait = this.rng.float(8, 18); }
      return;
    }
    this.anim.setPose('stare', 0.6);
    data.wait -= dt;
    if (data.wait <= 0) this.setState('patrol');
  }

  // ---------------------------------------------------------------- attack
  _startAttack(kind, spot = null) {
    this.setState('attack', { kind, spot, t2: 0 });
    this.stop();
    this.mode = 'floor';
    this.game.onCatAttack(kind, spot);
  }

  _stAttack() {
    // the game's death / struggle sequence drives the cat now
  }

  /** Player broke free: stagger back hissing, then resume. */
  recoil() {
    this.stun = 2.6;
    this.setState('recoil', {});
    this.game.audio.catVocal('hiss', this.pos);
    const p = this.player;
    const back = tmp.set(this.pos.x - p.pos.x, 0, this.pos.z - p.pos.z).normalize();
    this.pos.addScaledVector(back, 0.8);
  }

  _stRecoil() {
    this.anim.setPose('crawl', 0.2);
    if (this.stun <= 0) {
      if (this.diff.struggles > 1 && this.rng.chance(0.5)) this.setState('patrol');
      else this._startChase();
    }
  }

  // ---------------------------------------------------------------- secret ending
  lure(pos, f) {
    this.setState('lured', { phase: 'walk' });
    this.goTo(f, pos.x, pos.z, { speed: this.diff.catWalk * 0.8, pose: 'walk', doorMode: 'normal', vents: false });
  }

  _stLured(dt) {
    const s = this.state;
    if (s.data.phase === 'walk') {
      this.anim.setPose('walk', 0.5);
      if (this.arrived || s.t > 40) { s.data.phase = 'sit'; s.t = 0; }
      return;
    }
    this.anim.setPose('sit', 1.5);
    this.anim.twitchiness = Math.max(0, 1 - s.t * 0.4);
    const eyes = Math.max(0, 1 - s.t * 0.25);
    this.model.mats.eyeMat.color.setRGB(2.6 * eyes, 2.4 * eyes, 0.55 * eyes);
    for (const g of this.model.glows) g.material.opacity = 0.55 * eyes;
  }

  // ================================================================ presentation
  _vocalise(dt) {
    if (this.hidden) return;
    const s = this.state.name;
    // footsteps (silent while it wants to be)
    const silent = this.now < this.silentUntil && !this.loudSteps;
    if (this.speed > 0.3 && this.mode !== 'vent') {
      const prev = this.stepPhase;
      this.stepPhase = this.anim.phase;
      const crossed = (prev < 0.5 && this.stepPhase >= 0.5) || prev > this.stepPhase;
      if (crossed && !silent) {
        const running = this.speed > 3;
        this.game.audio.catStep(this.pos.clone(), running ? 1 : this.loudSteps ? 0.8 : 0.45, running, this.mode === 'ceiling');
      }
    }
    this.vocalT -= dt;
    if (this.vocalT <= 0) {
      this.vocalT = this.rng.float(7, 16);
      if (s === 'patrol' && !silent && this.rng.chance(0.4)) this.game.audio.catVocal(this.rng.pick(['meow', 'laugh', 'whisper']), this.headPos(new THREE.Vector3()));
      if (s === 'chase' && this.rng.chance(0.6)) this.game.audio.catVocal(this.rng.pick(['laugh', 'growl', 'hiss']), this.headPos(new THREE.Vector3()));
    }
  }

  _checkVisibleToPlayer(dt) {
    this.visT -= dt;
    if (this.visT > 0) return;
    this.visT = 0.1;
    if (this.hidden || !this.model.root.visible) { this.visibleToPlayer = false; this.watchedAmount = 0; return; }
    const chest = this.headPos(new THREE.Vector3());
    chest.y -= 0.3;
    const vis = this.game.canPlayerSee(chest, 0);
    this.visibleToPlayer = vis;
    // how centred in view (0..1)
    if (vis) {
      const cam = this.game.camera;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const to = chest.sub(cam.position).normalize();
      this.watchedAmount = Math.max(0, (to.dot(dir) - 0.7) / 0.3);
    } else this.watchedAmount = 0;
  }

  _syncModel(dt) {
    const m = this.model;
    const root = m.root;
    // ceiling flip
    const wantFlip = this.mode === 'ceiling' ? 1 : 0;
    this.flip += (wantFlip - this.flip) * Math.min(1, dt * 5);
    const room = this.room;
    const ceilY = room ? room.baseY + room.ceil : this.pos.y + 2.9;
    root.position.set(this.pos.x, this.pos.y + (ceilY - this.pos.y) * this.flip, this.pos.z);
    root.rotation.set(0, this.yaw, Math.PI * this.flip, 'YXZ');
    // lighting: use the room the cat is in
    const slot = room ? room.lightSlot : this.grid.outsideLightSlot;
    if (slot !== this._slot) {
      this._slot = slot;
      for (const mat of m.allMaterials) setObjectRoom(mat, slot);
    }
    // gait selection from movement
    const s = this.state.name;
    if (this.path && this.speed > 0.2 && !['attack', 'check', 'stare'].includes(s)) {
      const pose = this.moveOpts.pose || 'walk';
      const p = this.mode === 'ceiling' ? 'crawl' : this.speed > 3 ? 'run' : pose === 'run' ? 'stalk' : pose;
      this.anim.setPose(p, 0.3);
    }
    const stride = this.anim.pose === 'run' ? 2.2 : this.anim.pose === 'crawl' ? 0.9 : 1.3;
    this.anim.pupil = s === 'chase' ? 2.2 : s === 'stare' ? 0.6 : 1;
    this.anim.twitchiness = s === 'lured' ? this.anim.twitchiness : s === 'stare' ? 1.8 : 1;
    this.anim.update(dt, this.path ? this.speed : 0, stride);
  }
}

export function turnToward(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

export { CAT_START_ROOMS, FLOOR_CEIL };
