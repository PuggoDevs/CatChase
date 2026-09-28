// The Director paces the night. It watches tension, keeps the cat on a
// leash (close enough to matter, never omniscient), forces a breather when
// you've been hunted too long (rarely, on Nightmare), cuts the power, makes
// the house change, runs endless-mode waves, and schedules horror events.
import * as THREE from 'three';
import { createCatModel } from '../cat/catModel.js';
import { CatAnimator } from '../cat/catAnimator.js';
import { setObjectRoom } from '../world/roomLighting.js';
import { HORROR_EVENTS } from './events.js';

export class Director {
  constructor(game) {
    this.game = game;
    // the phantom: a second cat used for apparitions (windows, mirrors, fakes)
    this.phantom = createCatModel(game.world.materials);
    this.phantomAnim = new CatAnimator(this.phantom);
    this.phantom.root.visible = false;
    game.scene.add(this.phantom.root);
    this.active = [];
    this.reset(null);
  }

  reset(run) {
    this.run = run;
    this.tension = 0;
    this.menace = 0;
    this.phase = 'intro';
    this.phaseT = 0;
    this.relaxT = 0;
    this.eventPressure = 0;
    this.lastEvent = {};
    this.eventT = 8;
    this.outageT = run ? run.rng.float(230, 330) : 300;
    this.changeT = 100;
    this.leashT = 20;
    this.active = [];
    this.hidePhantom();
    this.wave = 0;
    this.waveT = 0;
    this.lull = false;
    this.encounterT = 0;
    this.chaseGrace = 0;
  }

  get cat() { return this.game.cat; }
  get player() { return this.game.player; }
  get diff() { return this.game.run.diff; }

  allowWake() { return this.phase !== 'intro' || this.phaseT > 25; }

  // ---------------------------------------------------------------- phantom
  showPhantom(pos, yaw, pose = 'stare', opts = {}) {
    const ph = this.phantom;
    ph.root.visible = true;
    ph.root.position.copy(pos);
    ph.root.rotation.set(0, yaw, opts.flip ? Math.PI : 0, 'YXZ');
    ph.root.scale.setScalar(opts.scale || 1);
    this.phantomAnim.setPose(pose, 0.01);
    this.phantomAnim.twitchiness = opts.twitch ?? 1.5;
    const grid = this.game.world.grid;
    const room = grid.roomAtWorld(grid.floorAt(pos.x, pos.y, pos.z), pos.x, pos.z);
    const slot = opts.slot ?? (room ? room.lightSlot : grid.outsideLightSlot);
    for (const m of ph.allMaterials) setObjectRoom(m, slot);
    const layer = opts.mirrorOnly ? 2 : 0;
    ph.root.traverse((o) => o.layers.set(layer));
    this.phantomOn = true;
  }

  hidePhantom() {
    if (!this.phantom) return;
    this.phantom.root.visible = false;
    this.phantom.root.traverse((o) => o.layers.set(0));
    this.phantomOn = false;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    const run = g.run;
    if (!run) return;
    const cat = this.cat, p = this.player, d = this.diff;
    this.phaseT += dt;
    if (cat.disabled) {
      this._scheduleEvents(dt);
      for (const e of [...this.active]) if (e.update(dt) === true) { this.active.splice(this.active.indexOf(e), 1); if (e.cleanup) e.cleanup(); }
      if (this.phantomOn) this.phantomAnim.update(dt, this.phantomSpeed || 0, 1.3);
      return;
    }
    // ---- tension
    const dist = cat.hidden ? 40 : cat.distToPlayer();
    let target = Math.max(0, 1 - dist / 22) * 0.6;
    const st = cat.state.name;
    if (st === 'chase') target = 1;
    else if (st === 'check' || st === 'search') target = Math.max(target, dist < 10 ? 0.75 : 0.45);
    else if (st === 'stalk' || st === 'stare' || st === 'ambush') target = Math.max(target, 0.6);
    if (cat.visibleToPlayer) target = Math.max(target, 0.7);
    if (!g.world.lighting.power) target = Math.max(target, 0.35);
    this.tension += (target - this.tension) * Math.min(1, dt * (target > this.tension ? 2 : 0.35));
    // ---- menace & relief
    if (this.tension > 0.5) this.menace += dt * this.tension / 30;
    else this.menace = Math.max(0, this.menace - dt / 45);
    if (st === 'chase') this.chaseGrace = 4;
    this.chaseGrace = Math.max(0, this.chaseGrace - dt);
    if (this.phase === 'buildup' && this.menace > d.menaceLimit && st !== 'chase' && st !== 'check') {
      this._startRelax();
    }
    if (this.phase === 'relax') {
      this.relaxT -= dt;
      if (this.relaxT <= 0) { this.phase = 'buildup'; cat.relaxing = false; this.menace *= 0.3; }
    }
    // ---- intro: the house is quiet, then the first sighting
    if (this.phase === 'intro') {
      const introLen = run.mode === 'endless' ? 12 : 40;
      if (this.phaseT > introLen && cat.state.name === 'dormant') {
        this.phase = 'buildup';
        if (run.mode !== 'endless' && !run.introStareDone && HORROR_EVENTS.stare.canRun(this, { force: true })) {
          run.introStareDone = true;
          this._run('stare', { force: true });
        } else cat.emerge();
      }
    }
    // cat dormant after a stare / vanish: bring it back
    if (this.phase !== 'intro' && cat.state.name === 'dormant' && !cat.state.data.hold) {
      cat.state.data.returnIn = (cat.state.data.returnIn ?? 8) - dt;
      if (cat.state.data.returnIn <= 0) cat.emerge(this.phase === 'relax' ? null : p.room);
    }
    // ---- leash: keep the hunt near the player when it drifts away
    this.leashT -= dt;
    if (this.leashT <= 0 && this.phase === 'buildup') {
      this.leashT = 14 + run.rng.float(0, 10);
      const far = cat.hidden || cat.distToPlayer() > 18;
      if (far && cat.sinceChase > 25 && run.rng.chance(d.leash)) {
        cat.leashRoom = p.room || null;
        cat.aggression = Math.min(1, cat.aggression + 0.15);
      } else if (!far) cat.leashRoom = null;
    }
    // ---- power outages
    if (run.mode === 'endless' || run.time > 60) this.outageT -= dt;
    if (this.outageT <= 0) {
      this.outageT = run.rng.float(260, 420) / (run.mode === 'endless' ? 1.5 : 1);
      if (g.world.lighting.power && run.rng.chance(d.outageChance) && st !== 'chase') this.powerOutage();
    }
    // ---- the house changes behind your back
    this.changeT -= dt;
    if (this.changeT <= 0) {
      this.changeT = run.rng.float(80, 150);
      const room = g.story.changeHouse(run.rng);
      if (room) g.audio.whisper(new THREE.Vector3(room.cx, room.baseY + 1.5, room.cz));
    }
    // ---- endless waves
    if (run.mode === 'endless') this._updateWaves(dt);
    // ---- horror events
    this._scheduleEvents(dt);
    for (const e of [...this.active]) {
      if (e.update(dt) === true) {
        this.active.splice(this.active.indexOf(e), 1);
        if (e.cleanup) e.cleanup();
      }
    }
    if (this.phantomOn) this.phantomAnim.update(dt, this.phantomSpeed || 0, 1.3);
  }

  _startRelax() {
    this.phase = 'relax';
    this.relaxT = this.diff.relaxTime * this.game.run.rng.float(0.8, 1.3);
    this.cat.relaxing = true;
    this.cat.leashRoom = null;
    this.cat.aggression = Math.max(0.2, this.cat.aggression - 0.2);
    // on easy/normal, it really goes away for a while
    if (this.diff.relaxTime > 25 && this.cat.state.name !== 'dormant' && !this.cat.visibleToPlayer && this.game.run.rng.chance(0.5)) {
      this.cat.hide();
      this.cat.setState('dormant', { returnIn: this.relaxT * 0.8 });
    }
  }

  powerOutage(byCat = false) {
    const g = this.game;
    const run = g.run;
    g.world.lighting.setPower(false);
    for (const tv of g.world.tvs) if (tv.on) g.world.setTV(tv, false);
    if (this.diff.struggles < 2 && run.rng.chance(0.55)) g.objectives.s.fuseBlown = true;
    g.audio.play('bang', { volume: 0.5, reverb: 0.8 });
    g.audio.silence(1.5, 0.3);
    setTimeout(() => g.audio.catVocal('laugh', g.cat.hidden ? g.camera.position.clone().add(new THREE.Vector3(6, 0, 6)) : g.cat.headPos(new THREE.Vector3())), 1600);
    g.ui.toast(byCat ? 'Somewhere below, something pulls the fuses.' : 'The power dies.', true);
    g.ui.setHint('The lights are out and it is hungrier in the dark. The fuse box is in the laundry room.');
    this.cat.aggression = Math.min(1, this.cat.aggression + 0.25);
  }

  _updateWaves(dt) {
    const g = this.game;
    const run = g.run;
    this.waveT += dt;
    if (this.wave === 0 && this.waveT > 5) { this._nextWave(); return; }
    if (!this.lull) {
      const len = 140 + this.wave * 25;
      const left = len - this.waveT;
      g.ui.setWave(`NIGHT ${this.wave}<br/><span class="dim">${Math.max(0, Math.ceil(left))}s until dawn</span>`);
      if (left <= 0) {
        this.lull = true;
        this.waveT = 0;
        run.nightsSurvived = this.wave;
        g.audio.bell(0, null, 0.8);
        g.ui.toast(`You survived night ${this.wave}. It retreats... for now.`, true);
        this.cat.hide();
        this.cat.setState('dormant', { hold: true });
        g.restorePower(true);
        g.items.populateSupplies(run, 4 + this.wave);
      }
    } else {
      const left = 25 - this.waveT;
      g.ui.setWave(`DAWN<br/><span class="dim">night ${this.wave + 1} in ${Math.max(0, Math.ceil(left))}s</span>`);
      if (left <= 0) this._nextWave();
    }
  }

  _nextWave() {
    const g = this.game;
    this.wave++;
    this.waveT = 0;
    this.lull = false;
    const run = g.run;
    // the hunt grows worse every night
    const k = 1 + (this.wave - 1) * 0.07;
    const base = run.baseDiff;
    Object.assign(run.diff, {
      catWalk: base.catWalk * k, catRun: base.catRun * Math.min(1.25, k), catRunMax: base.catRunMax * Math.min(1.25, k),
      detectRate: base.detectRate * k, hearing: base.hearing * Math.min(1.5, k), searchTime: base.searchTime * k,
      checkBase: Math.min(0.9, base.checkBase + (this.wave - 1) * 0.06), relaxTime: Math.max(6, base.relaxTime / k),
    });
    this.cat.state.data.hold = false;
    this.cat.emerge();
    this.cat.aggression = Math.min(1, 0.4 + this.wave * 0.1);
    g.audio.stinger(0.5);
    g.ui.toast(`Night ${this.wave}. It is hunting.`, true);
  }

  // ---------------------------------------------------------------- events
  _scheduleEvents(dt) {
    const run = this.game.run;
    const st = this.cat.state.name;
    this.eventPressure = Math.min(1.5, this.eventPressure + dt / 40);
    this.eventT -= dt;
    if (this.eventT > 0) return;
    this.eventT = run.rng.float(2.5, 5);
    if (this.active.length) return;
    if (st === 'chase' || st === 'attack' || this.game.player.dead) return;
    const p = this.eventPressure * this.diff.eventRate * (this.phase === 'relax' ? 1.2 : 0.8);
    if (run.rng.next() > p * 0.5) return;
    const now = this.game.time;
    const cands = Object.entries(HORROR_EVENTS).filter(([id, ev]) => {
      if (ev.auto === false) return false;
      if ((run.time || 0) < (ev.minTime || 0)) return false;
      if (now - (this.lastEvent[id] ?? -1e9) < (ev.cooldown || 60)) return false;
      try { return ev.canRun(this, {}); } catch (e) { return false; }
    });
    if (!cands.length) return;
    const [id] = run.rng.weighted(cands, ([, ev]) => ev.weight || 1);
    this._run(id, {});
  }

  _run(id, opts) {
    const ev = HORROR_EVENTS[id];
    const inst = ev.start(this, opts);
    this.lastEvent[id] = this.game.time;
    this.eventPressure = 0;
    if (inst) this.active.push(inst);
    this.game.stats.events = (this.game.stats.events || 0) + 1;
    if (this.game.debug) console.log('[director] event', id);
    return inst || true;
  }

  /** Trigger an event by name (used by debugging and scripted moments). */
  trigger(id, opts = {}) {
    if (!HORROR_EVENTS[id]) return null;
    if (!HORROR_EVENTS[id].canRun(this, { ...opts, force: true })) return null;
    return this._run(id, { ...opts, force: true });
  }
}
