// The game: owns the renderer, the loop, every subsystem, the run state and
// the glue between them (noise, deaths, endings, menus, settings).
import * as THREE from 'three';
import { World } from '../world/world.js';
import { EventBus } from '../core/events.js';
import { Input } from '../core/input.js';
import { RNG, hashString } from '../core/rng.js';
import { load, save } from '../core/storage.js';
import { DIFFICULTIES, DEFAULT_SETTINGS, QUALITY } from '../config.js';
import { PLAYER_START, floorBaseY, ROOMS } from '../world/layout.js';
import { PostFX } from '../render/postfx.js';
import { FX } from '../render/fx.js';
import { AudioEngine } from '../audio/audio.js';
import { UI, fmtTime } from '../ui/ui.js';
import { Player } from '../player/player.js';
import { Interaction } from '../player/interaction.js';
import { Throwables } from '../player/throwables.js';
import { ItemSystem } from './items.js';
import { Story } from './story.js';
import { Objectives } from './objectives.js';
import { Cutscenes } from './cutscenes.js';
import { Cat } from '../cat/cat.js';
import { Director } from '../horror/director.js';

const ENDINGS = {
  front: { title: 'Out the Front Door', text: 'The chain falls away and the door swings open onto the rain.\nYou run down the path without looking back. You almost make it to the gate before you do.\nIn the window above the door, something tall is standing very still. Waving.' },
  car: { title: 'Headlights', text: 'The garage door clears the roof of the car and you floor it.\nSomething rolls off the hood and into the dark. In the mirror, two small lights watch you go.\nYou do not stop driving until the sun comes up.' },
  attic: { title: 'Over the Roof', text: 'Hand over hand down the wet rope, the house groaning against your back.\nWhen your feet touch the mud you finally look up. It is in the attic window. Smiling.\nIt does not follow. Not tonight.' },
  tunnel: { title: 'Through the Dark Water', text: 'You crawl for a long time through water and rot, until the tunnel turns upward into a rusted ladder and a manhole cover and the smell of wet streets.\nBehind you, far back in the dark, something laughs. Then it stops.' },
  secret: { title: 'Game Over, Ellie Wins', text: 'The little song winds down. Mister Grin sits by her bed and listens, and his eyes go sleepy, and he is only a toy.\nBehind the tiny door there is a narrow crawlspace full of old drawings and warm morning light.\nYou are sure you hear a little girl laugh. "Thank you for playing with him."' },
};

export class Game {
  constructor(container) {
    this.container = container;
    this.settings = { ...DEFAULT_SETTINGS, ...load('settings', {}) };
    this.progress = load('progress', { endings: {}, deaths: 0 });
    this.params = new URLSearchParams(location.search);
    this.debug = this.params.has('debug');
    this.state = 'boot';
    this.time = 0;
    this.run = null;
    this.stats = {};
    this.loop = this.loop.bind(this);
  }

  // ================================================================ boot
  async boot() {
    const c = this.container;
    this.ui = new UI(this, document.body);
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('is-touch');
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    renderer.setSize(c.clientWidth, c.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    c.appendChild(renderer.domElement);
    this.renderer = renderer;
    renderer.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x020304, 0.04);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, c.clientWidth / c.clientHeight, 0.04, 250);
    this.camera.rotation.order = 'YXZ';
    this.hemi = new THREE.HemisphereLight(0x8a9ab8, 0x14100c, 0.18);
    this.scene.add(this.hemi);
    this.events = new EventBus();
    this.input = new Input(renderer.domElement);
    this.input.onLockChange = (locked, failed) => this._onLockChange(locked, failed);
    // world
    this.world = new World({ scene: this.scene, renderer, events: this.events, quality: this.settings.quality });
    await this.world.build((p, label) => this.ui.setLoading(p * 0.92, label));
    this.world.reduceFlashes = this.settings.reduceFlashes;
    // systems
    this.post = new PostFX(renderer, this.scene, this.camera, this.settings.quality);
    this.post.setSize(c.clientWidth, c.clientHeight);
    this.fx = new FX(this);
    this.audio = new AudioEngine(this);
    this.player = new Player(this);
    this.player.spot.shadow.mapSize.setScalar(q.shadowMap);
    this.interaction = new Interaction(this);
    this.throwables = new Throwables(this);
    this.items = new ItemSystem(this);
    this.cat = new Cat(this);
    this.story = new Story(this);
    this.objectives = new Objectives(this);
    this.cutscenes = new Cutscenes(this);
    this.director = new Director(this);
    this.events.on('door', (ev) => this.audio.door(ev));
    this.events.on('lightning', (ev) => setTimeout(() => this.audio.thunder(ev.strength), ev.delay * 1000));
    this.applyBrightness();
    window.addEventListener('resize', () => this._resize());
    this.ui.setLoading(1, 'The house is awake.');
    this.timer = new THREE.Timer();
    requestAnimationFrame(this.loop);
    window.__game = this;
    if (this.params.has('autostart')) {
      this.ui.hideAllScreens();
      this._initAudio(false).then(() => {
        this.startRun({ mode: this.params.get('mode') || 'story', difficulty: this.params.get('autostart') || 'normal', seed: this.params.get('seed') });
      });
    } else {
      this.ui.showWarning(() => this._afterWarning());
    }
    this._setupMenuScene();
    this.state = 'menu';
    window.__ready = true;
  }

  async _afterWarning() {
    this.ui.show('loading');
    this.ui.setLoading(0.95, 'Tuning the house...');
    await this._initAudio(true);
    this.ui.show('loading', false);
    this.ui.showMenu();
  }

  async _initAudio(show) {
    try {
      await this.audio.init((p) => { if (show) this.ui.setLoading(0.95 + p * 0.05, 'Tuning the house...'); });
    } catch (e) {
      console.warn('audio unavailable', e);
    }
  }

  _resize() {
    const c = this.container;
    this.renderer.setSize(c.clientWidth, c.clientHeight);
    this.camera.aspect = c.clientWidth / c.clientHeight;
    this.camera.updateProjectionMatrix();
    this.post.setSize(c.clientWidth, c.clientHeight);
  }

  // ================================================================ settings
  applySetting(k, v) {
    this.settings[k] = v;
    save('settings', this.settings);
    if (k === 'volume' && this.audio.ready) this.audio.setVolume(v);
    if (k === 'musicVolume' && this.audio.ready) this.audio.setMusicVolume(v);
    if (k === 'brightness') this.applyBrightness();
    if (k === 'fov') { this.camera.fov = v; this.camera.updateProjectionMatrix(); }
    if (k === 'reduceFlashes') this.world.reduceFlashes = v;
    if (k === 'quality') {
      const q = QUALITY[v];
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
      this.post.setQuality(v);
      this.player.spot.shadow.mapSize.setScalar(q.shadowMap);
      if (this.player.spot.shadow.map) { this.player.spot.shadow.map.dispose(); this.player.spot.shadow.map = null; }
      this._resize();
    }
  }

  applyBrightness() {
    const b = this.settings.brightness;
    this.hemi.intensity = 0.18 * b;
    this.renderer.toneMappingExposure = 0.9 + 0.2 * b;
  }

  // ================================================================ menu backdrop
  _setupMenuScene() {
    const cat = this.cat;
    cat.teleport(2, 27.6, 9.45, -Math.PI / 2);
    cat.anim.setPose('stare', 0.01);
    this.world.setActiveFloor(2);
    for (const fx of this.world.lighting.fixtures) {
      if (fx.room.key === '2u') { fx.on = fx.index !== 1; fx.flicker = fx.index === 2 ? 0.8 : 0.3; }
    }
    this.menuT = 0;
  }

  _updateMenu(dt) {
    this.menuT += dt;
    const t = this.menuT;
    const cam = this.camera;
    cam.position.set(14.2 + Math.sin(t * 0.07) * 0.6, floorBaseY(2) + 1.55 + Math.sin(t * 0.5) * 0.02, 9.55 + Math.sin(t * 0.11) * 0.25);
    // look down the hallway with the vanishing point right of centre, where it waits
    cam.rotation.set(0.02 + Math.sin(t * 0.13) * 0.015, -Math.PI / 2 + 0.2 + Math.sin(t * 0.09) * 0.03, 0);
    cam.fov = this.settings.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.cat.anim.update(dt, 0);
    this.cat._syncModel(0);
    this.world.update(dt, cam, 2);
    this.post.u.uVignette.value = 1.1;
    if (this.audio.ready) this.audio.update(dt, { tension: 0.15, fear: 0, chase: false });
  }

  // ================================================================ runs
  startRun({ mode = 'story', difficulty = 'normal', seed = null }) {
    const seedText = seed || Math.random().toString(36).slice(2, 8).toUpperCase();
    const base = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    const run = {
      mode, difficulty, seedText,
      rng: new RNG(hashString(seedText + ':' + difficulty)),
      diff: { ...base }, baseDiff: { ...base },
      time: 0, start: { ...PLAYER_START }, creaky: new Set(),
      strugglesLeft: base.struggles, visited: new Set(), nightsSurvived: 0,
    };
    this.run = run;
    this.progress.lastDifficulty = difficulty;
    save('progress', this.progress);
    this.stats = { events: 0 };
    this._resetWorld(run);
    this.state = 'playing';
    this.ui.hideAllScreens();
    this.ui.setHUD(true);
    this.ui.setWave(null);
    this.post.u.uBlack.value = 0;
    this.post.u.uRed.value = 0;
    this.ui.fader.style.background = '#000';
    this.ui.fade(0, 0.01);
    if (this.params.has('nocat')) this.cat.disabled = true;
    if (this.params.has('tp')) {
      const [f, x, z] = this.params.get('tp').split(',').map(Number);
      this.player.pos.set(x, floorBaseY(f), z);
      this.player.floor = f;
    }
    if (this.params.has('skipintro') || mode === 'endless') this.onIntroDone();
    else {
      this.state = 'cutscene';
      this.ui.setHUD(false);
      this.cutscenes.play(this.cutscenes.intro());
    }
    if (document.body.classList.contains('is-touch')) this.ui.enableTouch(this.input);
    this.requestLock();
  }

  _resetWorld(run) {
    const w = this.world;
    const rng = run.rng.fork('world');
    // doors: locks restored, some interior doors left ajar
    for (const d of w.doorList) {
      d.locked = !!d.lock && d.lock !== 'bolt';
      d.barricade = 0;
      d.broken = false;
      d.lockHp = undefined;
      d.discovered = !(d.type === 'secret' || d.type === 'bookshelf');
      d.jammed = d.escape;
      d._refreshBarricade();
      let open = 0;
      if (d.type === 'door' && !d.locked && rng.chance(0.45)) open = rng.float(0.75, 1);
      d.open = d.target = open;
      d.speed = 100;
      d.target = open;
      d.open = open === 0 ? 0.001 : open - 0.001;
      d.update(0.1);
      d.open = open;
      d.pivot.rotation.z = 0;
      d.updateCollider();
    }
    // lights, TVs, chairs, hiding spots
    for (const fx of w.lighting.fixtures) { fx.on = !!fx.def.on; fx.stutter = 0; fx.eventDim = 1; fx.flicker = fx.def.flicker || 0; }
    w.lighting.power = true;
    w.lighting.powerFade = 1;
    for (const tv of w.tvs) w.setTV(tv, false);
    for (const c of w.rockingChairs) c.rock = 0;
    for (const h of w.hidingSpots) { h.setOpen(0); h.uses = 0; }
    // creaky floorboards
    run.creaky = new Set();
    for (const cell of w.grid.walkableCells()) {
      const room = w.grid.rooms[cell.room];
      const mat = room.meta.floor || '';
      if ((mat.startsWith('wood') || mat === 'atticBoards') && !w.grid.stairAt(cell.f, cell.x, cell.z) && rng.chance(0.09)) run.creaky.add(`${cell.f}:${cell.x}:${cell.z}`);
    }
    this.fx.clear();
    this.throwables.clear();
    this.objectives.clearAltar();
    this.player.reset();
    this.player.spawn(run.start);
    this.player.struggles = run.strugglesLeft;
    this.objectives.reset(run);
    this.items.populate(run);
    this.cat.reset(run);
    this.cat.hide();
    this.cat.setState('dormant', { returnIn: 999 });
    this.story.populate(run);
    this.director.reset(run);
    this.world.setActiveFloor(run.start.f);
    if (this.audio.ready) this.audio.stopAllLoops();
  }

  onIntroDone() {
    this.state = 'playing';
    this.ui.setHUD(true);
    const hint = this.run.mode === 'endless'
      ? 'ENDLESS: there is no way out. Survive each night until dawn.'
      : 'Find a way out of the house. Read notes for clues. [Tab] journal. Take the flashlight.';
    this.ui.setHint(hint);
  }

  retry() {
    const r = this.run;
    this.startRun({ mode: r.mode, difficulty: r.difficulty, seed: null });
  }

  quitToMenu() {
    this.ui.hideAllScreens();
    this.ui.setHUD(false);
    this.ui.fader.style.background = '#000';
    this.ui.fade(0, 0.01);
    this.post.u.uBlack.value = 0;
    this.post.u.uRed.value = 0;
    this.post.u.uStatic.value = 0;
    this.run = null;
    this.state = 'menu';
    this.cat.reset(null);
    this.director.hidePhantom();
    this.throwables.clear();
    if (this.audio.ready) { this.audio.stopAllLoops(); this.audio.unsilence(); }
    this.input.releaseLock();
    this._setupMenuScene();
    this.ui.showMenu();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause();
    this.input.releaseLock();
    if (this.audio.ctx) this.audio.ctx.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.show('pause', false);
    this.ui.show('settings', false);
    this.ui.show('controls', false);
    this.state = 'playing';
    if (this.audio.ctx) this.audio.ctx.resume();
    this.requestLock();
  }

  requestLock() {
    if (document.body.classList.contains('is-touch')) return;
    this.input.requestLock();
  }

  _onLockChange(locked, failed) {
    if (failed) {
      if (this.state === 'playing') this.ui.toast('Mouse capture unavailable - click and drag to look.');
      return;
    }
    if (!locked && this.state === 'playing' && !this.input.dragLook && !this.ui.isOpen('journal') && !this.ui.isOpen('note')) this.pause();
  }

  // ================================================================ loop
  loop(ts) {
    requestAnimationFrame(this.loop);
    this.timer.update(ts);
    let dt = Math.min(0.05, this.timer.getDelta());
    if (this.params.has('fixeddt')) dt = 1 / 30;
    this.time += dt;
    this.frames = (this.frames || 0) + 1;
    window.__frames = this.frames;
    this.renderer.info.reset();
    try {
      if (this.state === 'menu') this._updateMenu(dt);
      else if (this.state === 'playing') this._updatePlaying(dt);
      else if (this.state === 'cutscene') this._updateCutscene(dt);
      if (this.state !== 'paused') this.post.render(dt);
    } catch (e) {
      console.error(e);
      if (!this._errShown) { this._errShown = true; this.ui.toast('Error: ' + e.message, true); }
    }
    this.input.endFrame();
  }

  _updatePlaying(dt) {
    const input = this.input;
    const p = this.player;
    const run = this.run;
    run.time += dt;
    // UI overlays
    if (this.story.open) {
      if (input.pressed('interact') || input.pressed('pause') || input.pressed('primary')) this.story.closeNote();
    } else if (this.ui.isOpen('journal')) {
      if (input.pressed('inventory') || input.pressed('pause')) { this.ui.hideJournal(); this.requestLock(); }
    } else {
      if (input.pressed('pause')) { this.pause(); return; }
      if (input.pressed('inventory') || input.pressed('journal')) { this.ui.showJournal(); }
      if (input.pressed('flashlight')) p.toggleFlashlight();
      if ((input.pressed('throw') || input.pressed('primary')) && p.held && !p.hiding) this.throwables.throwHeld();
      if (!this.input.pointerLocked && !this.input.dragLook && input.pressed('primary') && !document.body.classList.contains('is-touch')) this.requestLock();
    }
    if (input.pressed('debug')) this.debugOverlay = !this.debugOverlay;
    const frozenUI = this.ui.isOpen('journal');
    p.frozen = frozenUI;
    p.update(dt);
    if (!frozenUI && !this.story.open) this.interaction.update(dt);
    else { this.ui.setPrompt(null); this.interaction.cancelHold(); }
    this.throwables.update(dt);
    if (!this.cat.disabled) this.cat.update(dt);
    this.director.update(dt);
    this.objectives.update(dt);
    this._commonUpdate(dt);
    this.ui.updateHUD(p);
    if (this.debugOverlay || this.debug) this._debugText();
    if (this.room !== p.room && p.room) {
      this.room = p.room;
      run.visited.add(p.room.index);
    }
  }

  /** Test hook: advance the simulation without rendering. */
  stepSim(seconds, dt = 1 / 30) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      this.time += dt;
      if (this.state === 'playing') this._updatePlaying(dt);
      else if (this.state === 'cutscene') this._updateCutscene(dt);
      this.input.endFrame();
    }
    return this.state;
  }

  _updateCutscene(dt) {
    if (this.run) this.run.time += dt;
    this.cutscenes.update(dt);
    // the cat keeps animating in scripted moments
    const cat = this.cat;
    if (cat.state.name === 'attack' || cat.state.name === 'scripted' || cat.state.name === 'recoil') {
      cat.anim.update(dt, 0);
      if (!(this.cutscenes.active && this.cutscenes.active.ceilingLock)) cat._syncModel(0);
    } else if (!cat.disabled && this.run) {
      cat.update(dt);
    }
    this.director.phantomOn && this.director.phantomAnim.update(dt, 0);
    this._commonUpdate(dt, true);
  }

  _commonUpdate(dt, cutscene = false) {
    const p = this.player;
    const camFloor = this.world.grid.floorAt(this.camera.position.x, this.camera.position.y - 1.2, this.camera.position.z, p.floor);
    this.world.setActiveFloor(cutscene ? camFloor : p.floor);
    this.world.update(dt, this.camera, cutscene ? camFloor : p.floor);
    this.items.update(dt, this.time, p.flash);
    this.fx.update(dt);
    // fear from the cat's presence
    const cat = this.cat;
    let fear = 0;
    if (!cat.hidden && !cat.disabled) {
      const d = cat.distToPlayer();
      fear = Math.max(0, 1 - d / 14) * (cat.visibleToPlayer ? 1 : 0.55);
      if (cat.state.name === 'chase') fear = Math.max(fear, 0.75);
    }
    if (p.hiding && cat.state.name === 'check' && cat.state.data.spot === p.hiding.spot) fear = Math.max(fear, 0.9);
    this.scare = Math.max(0, (this.scare || 0) - dt * 0.6);
    fear = Math.min(1, Math.max(fear, this.scare));
    p.fear += (fear - p.fear) * Math.min(1, dt * 2.5);
    const u = this.post.u;
    u.uFear.value = p.fear;
    const close = cat.visibleToPlayer && !cat.hidden ? Math.max(0, 1 - cat.distToPlayer() / 7) : 0;
    this.presenceStatic = close * 0.22;
    u.uAberration.value = 0.002 + p.fear * 0.006 + close * 0.01;
    u.uDistort.value = Math.max(u.uDistort.value * 0.95, close * 0.35);
    u.uSlit.value = p.hiding && p.hiding.phase === 'in' && (p.hiding.spot.overlay === 'slit') ? 1 : 0;
    this.hemi.intensity = 0.18 * this.settings.brightness * (this.world.lighting.power ? 1 : 0.7) + this.world.exterior.lightning * 0.25;
    // audio
    if (this.audio.ready) {
      this.audio.updateListener();
      const d = this.director;
      this.audio.update(dt, {
        tension: d.tension, fear: p.fear, chase: cat.state.name === 'chase',
        silent: false, outage: !this.world.lighting.power,
      });
    }
    this.syncFlashlight(false);
  }

  syncFlashlight(force = true) {
    if (!force) return;
    const p = this.player;
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    p.flash.dir.copy(dir);
    p.flash.pos.copy(cam.position).add(new THREE.Vector3(0.16, -0.2, -0.05).applyQuaternion(cam.quaternion));
    p.spot.position.copy(p.flash.pos);
    p.spot.target.position.copy(p.flash.pos).addScaledVector(dir, 6);
    p.spot.target.updateMatrixWorld();
  }

  _debugText() {
    const c = this.cat, p = this.player, d = this.director;
    const fps = this._fps = (this._fps || 30) * 0.95 + (1 / Math.max(0.001, this.timer.getDelta() || 0.016)) * 0.05;
    this.ui.setDebug([
      `fps ${fps.toFixed(0)}  calls ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}`,
      `player f${p.floor} ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} ${p.room ? p.room.name : '-'} ${p.stance}`,
      `cat ${c.state.name} mode ${c.mode} f${c.floor} ${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)} dist ${c.hidden ? '-' : c.distToPlayer().toFixed(1)}`,
      `detect ${c.detection.toFixed(2)} sees ${c.seesPlayer} visible ${c.visibleToPlayer}`,
      `director ${d.phase} tension ${d.tension.toFixed(2)} menace ${d.menace.toFixed(2)} events ${this.stats.events || 0}`,
      `power ${this.world.lighting.power} seed ${this.run.seedText}`,
    ].join('\n'));
  }

  // ================================================================ senses
  /** Is a world point on screen and unoccluded? margin widens the frustum. */
  canPlayerSee(pos, margin = 0) {
    const cam = this.camera;
    const v = pos.clone().project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 + margin || Math.abs(v.y) > 1 + margin) return false;
    return !this.world.collision.segmentBlocked(cam.position, pos);
  }

  noise(pos, radius, kind, source = 'player', extra = {}) {
    const floor = this.world.grid.floorAt(pos.x, pos.y - 0.3, pos.z, this.player.floor);
    const n = { pos, radius, kind: source === 'distraction' ? 'distraction' : kind, sourceKind: kind, source, floor, from: extra.from || null, time: this.time };
    if (source === 'distraction') n.source = 'player';
    if (!this.cat.disabled && this.run) this.cat.hear(n);
  }

  learn(kind, data) {
    const L = this.cat.learn;
    if (kind === 'lock' || kind === 'barricade') L.recordLock();
  }

  // ================================================================ event hooks
  onPlayerHide(spot) {
    const seen = this.cat.noticeHide(spot);
    if (seen && this.run.diff.checkSeenEntering >= 1) this.ui.subtitle('[it saw you]');
  }

  onPlayerUnhide() {}

  onPlayerRoom(room) {
    if (this.state !== 'playing') return;
    if (!this.run.visited.has(room.index)) this.ui.toast(room.name);
  }

  onCatState(name, prev) {
    if (name === 'chase' && prev !== 'chase') this.stats.chases = (this.stats.chases || 0) + 1;
  }

  onCatHeard() {}

  onCatSeesThrough() {
    this.ui.subtitle('[it did not fall for it]');
  }

  onChaseStart(sudden) {
    if (sudden) { this.audio.stinger(0.9); this.onScare(0.8); }
    else this.audio.catVocal('hiss', this.cat.headPos(new THREE.Vector3()));
    this.player.addShake(0.03, 0.8);
    if (!this.run.chaseHintShown) {
      this.run.chaseHintShown = true;
      this.ui.setHint('RUN. Break its line of sight - slam doors behind you - then hide.');
    }
  }

  onChaseLost() {
    this.ui.subtitle('[it lost your trail]');
  }

  onAmbush() {
    this.audio.stinger(1);
    this.onScare(1);
    this.player.addShake(0.06, 0.5);
  }

  onStareEnd() {}

  onScare(k = 1) {
    this.scare = Math.max(this.scare || 0, k);
    this.fx.static(0.25 * k);
  }

  onCatAttack(kind, spot) {
    if (this.params.has('god')) { this.cat.recoil(); return; }
    const p = this.player;
    this.state = 'cutscene';
    this.interaction.cancelHold();
    this.ui.setPrompt(null);
    this.story.open && this.story.closeNote();
    this.ui.hideJournal();
    // caught inside a hiding place: no struggling free from there
    const cornered = kind === 'hide' || kind === 'under';
    if (p.hiding && !cornered) p.hiding = null;
    if (!cornered && this.run.strugglesLeft > 0) {
      this.cutscenes.struggle(() => {
        this.run.strugglesLeft--;
        this.cat.recoil();
        p.stamina = 100;
        p.exhausted = false;
        this.state = 'playing';
        this.ui.toast(`You tore free! RUN! (${this.run.strugglesLeft} escape${this.run.strugglesLeft === 1 ? '' : 's'} left)`, true);
      }, () => this._die(kind === 'chase' ? this.cutscenes.chooseDeath(kind, spot) : 'grab', spot));
      return;
    }
    this._die(this.cutscenes.chooseDeath(kind, spot), spot);
  }

  _die(kind, spot) {
    const p = this.player;
    p.dead = true;
    p.flash.on = false;
    this.ui.setHUD(false);
    this.cutscenes.death(kind, spot, (line) => {
      this.progress.deaths = (this.progress.deaths || 0) + 1;
      const run = this.run;
      if (run.mode === 'endless') {
        const nights = run.nightsSurvived;
        const best = this.progress.bestEndless;
        if (!best || nights > best.nights || (nights === best.nights && run.time > best.time)) this.progress.bestEndless = { nights, time: run.time };
      }
      save('progress', this.progress);
      this.state = 'dead';
      this.input.releaseLock();
      if (this.audio.ready) this.audio.stopAllLoops();
      this.ui.showDeath({ line: run.mode === 'endless' ? `${line} You survived ${run.nightsSurvived} night(s).` : line, stats: this._stats() });
    });
  }

  _stats() {
    const r = this.run;
    return { time: r.time, chases: this.cat.stats.chases, hides: this.player.stats.hides, rooms: r.visited.size, difficulty: DIFFICULTIES[r.difficulty].label, seed: r.seedText };
  }

  onPickup(kind) {
    const o = this.objectives;
    if (kind === 'key_front' || kind === 'bolt_cutters') o.learnRoute('front');
    if (kind === 'car_keys' || kind === 'car_battery' || kind === 'gas_can') o.learnRoute('car');
    if (kind === 'crowbar' || kind === 'rope') o.learnRoute('attic');
    if (kind === 'wrench' || kind === 'valve_wheel') o.learnRoute('tunnel');
    if (kind === 'flashlight') this.ui.setHint('Light helps you see - and helps it see you. Batteries are scarce.');
  }

  onDoorUnlocked() {}

  onSecretFound() {
    this.stats.secrets = (this.stats.secrets || 0) + 1;
  }

  onDocumentRead(doc) {
    if (doc.route) this.objectives.learnRoute(doc.route);
    if (doc.truth) this.objectives.learnRoute('secret');
  }

  restorePower(silent = false) {
    this.world.lighting.setPower(true);
    if (!silent) {
      this.audio.play('bang', { volume: 0.35, rate: 1.5 });
      this.ui.toast('The lights stutter back to life.', true);
      this.noise(this.world.fuseBoxPos ? this.world.fuseBoxPos.clone() : this.player.pos.clone(), 9, 'breaker', 'player');
    }
    this.cat.aggression = Math.max(0.3, this.cat.aggression - 0.2);
  }

  // ================================================================ endings
  startEscape(route) {
    if (this.objectives.escaping) return;
    this.objectives.escaping = route;
    this.state = 'cutscene';
    this.interaction.cancelHold();
    this.ui.setPrompt(null);
    this.ui.setHUD(false);
    if (this.player.hiding) this.player.hiding = null;
    this.player.flash.on = route === 'tunnel' || route === 'attic';
    this.cutscenes.escape(route, () => this._ending(route));
  }

  _ending(route) {
    const e = ENDINGS[route];
    const had = this.progress.endings[route];
    this.progress.endings[route] = (had || 0) + 1;
    save('progress', this.progress);
    this.state = 'ended';
    this.input.releaseLock();
    if (this.audio.ready) this.audio.stopAllLoops();
    this.post.u.uBlack.value = 1;
    this.ui.showEnding({ title: e.title, text: e.text, kicker: route === 'secret' ? 'SECRET ENDING' : 'YOU ESCAPED', secret: route === 'secret', stats: this._stats(), unlocked: !had });
  }

  startSecretEnding(inter) {
    const g = this;
    const alt = this.world.altarPos;
    const mel = [12, 10, 7, 10, 12, 12, 12, 10, 10, 10, 12, 15, 15, 12, 10, 7, 10, 12, 12, 12, 12, 10, 10, 12, 10, 7];
    let i = 0;
    const timer = setInterval(() => {
      if (!inter.hold || i >= mel.length) { clearInterval(timer); return; }
      g.audio.bell(mel[i], alt, 0.6);
      i++;
    }, 300);
    // the song calls him home
    if (this.cat.hidden) {
      const room = this.world.grid.roomByKey['3A'];
      const pt = this.cat.nav.randomPointInRoom(room, this.run.rng);
      if (pt) this.cat.teleport(pt.f, pt.x, pt.z);
    }
    this.cat.lure(alt.clone().add(new THREE.Vector3(-0.9, 0, 0.4)), 3);
    inter.startHold('Winding the music box', 7.5, () => {
      clearInterval(timer);
      this.objectives.s.wound = true;
      this.objectives.s.tinyOpen = true;
      const tiny = this.world.doors.get('tiny_door');
      tiny.jammed = false;
      tiny.openDoor('world', 'quiet');
      tiny.speed = 0.3;
      // warm light behind the tiny door
      const light = new THREE.PointLight(0xffd8a0, 3, 4, 2);
      light.position.set(8.4, floorBaseY(3) + 0.6, 9.5);
      this.scene.add(light);
      this.secretLight = light;
      mel.forEach((n, k) => setTimeout(() => this.audio.bell(n, alt, 0.35), k * 420));
      this.ui.toast('The song plays out. Behind you, something sits down very gently.', true);
      this.ui.setHint("Ellie's tiny door is open. Crawl through [Z].");
    });
  }
}

export { fmtTime, ROOMS };
