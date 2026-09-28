// Audio engine: buses, reverb, HRTF spatialisation with wall/door/floor
// occlusion, ambience beds and the game-facing sound API.
import * as THREE from 'three';
import { synthesizeAll, impulseResponse } from './synth.js';
import { Music } from './music.js';

const tmpV = new THREE.Vector3();

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ready = false;
    this.ctx = null;
    this.buffers = new Map();
    this.loops = new Map();
    this.muted = false;
    this.subtitle = null;
  }

  /** Must be called from a user gesture. Synthesises everything once. */
  async init(onProgress) {
    if (this.ctx) { await this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.game.settings.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    // buses
    this.sfx = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.game.settings.musicVolume;
    this.duck = ctx.createGain(); // for "all sound drops out" moments
    this.sfx.connect(this.duck);
    this.ambBus.connect(this.duck);
    this.musicBus.connect(this.duck);
    this.duck.connect(this.master);
    // chase distortion on the whole mix (wet/dry)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulseResponse(ctx, 2.6, 2.8, 0.45);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain).connect(this.duck);
    this.buffers = await synthesizeAll(ctx, onProgress);
    this.music = new Music(this);
    this._startAmbience();
    this.ready = true;
    await this.resume();
  }

  async resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  setVolume(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusicVolume(v) { if (this.musicBus) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  /** Everything drops away (before a silent scare), then comes back. */
  silence(seconds = 3, depth = 0.03) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(depth, t, 0.15);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.3);
  }

  unsilence() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(1, t, 0.05);
  }

  // ---------------------------------------------------------------- core play
  _buffer(name) {
    const list = this.buffers.get(name);
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * Play a buffer. opts: pos (Vector3) for 3D, floor, volume, rate, reverb,
   * loop, bus ('sfx'|'amb'|'music'), rateJitter, refDistance
   */
  play(name, opts = {}) {
    if (!this.ready || !this.ctx) return null;
    const b = this._buffer(name);
    if (!b) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const jitter = opts.rateJitter ?? 0.06;
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() * 2 - 1) * jitter);
    src.loop = !!opts.loop;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let out = gain;
    const bus = opts.bus === 'amb' ? this.ambBus : opts.bus === 'music' ? this.musicBus : this.sfx;
    let panner = null, lp = null;
    if (opts.pos) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.refDistance ?? 1.4;
      panner.rolloffFactor = opts.rolloff ?? 1.15;
      panner.maxDistance = 60;
      this._setPannerPos(panner, opts.pos);
      const occ = this._occlusion(opts.pos, opts.floor);
      lp.frequency.value = occ.cutoff;
      gain.gain.value *= occ.gain;
      src.connect(gain).connect(lp).connect(panner).connect(bus);
      out = panner;
    } else {
      src.connect(gain).connect(bus);
    }
    const rv = opts.reverb ?? 0.25;
    if (rv > 0) {
      const send = ctx.createGain();
      send.gain.value = rv;
      (opts.pos ? panner : gain).connect(send).connect(this.reverb);
    }
    src.start(ctx.currentTime + (opts.delay || 0));
    const handle = {
      src, gain, panner, lp,
      stop: (fade = 0.05) => {
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, fade);
          src.stop(ctx.currentTime + fade * 5);
        } catch { /* already stopped */ }
      },
      move: (pos) => {
        if (!panner) return;
        this._setPannerPos(panner, pos);
        const occ = this._occlusion(pos, opts.floor);
        lp.frequency.setTargetAtTime(occ.cutoff, ctx.currentTime, 0.1);
      },
    };
    void out;
    return handle;
  }

  _setPannerPos(p, pos) {
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  _occlusion(pos, floor) {
    const g = this.game;
    const grid = g.world.grid;
    const lp = g.camera.position;
    const lf = g.player ? g.player.floor : 1;
    const sf = floor ?? grid.floorAt(pos.x, pos.y - 0.4, pos.z, lf);
    const o = grid.occlusion(lf, lp.x, lp.z, sf, pos.x, pos.z);
    const k = o.walls * 1.6 + o.doors * 0.9 + o.floors * 2.2;
    return { cutoff: 18000 / (1 + k * 2.2), gain: 1 / (1 + o.walls * 0.45 + o.doors * 0.3 + o.floors * 0.9) };
  }

  updateListener() {
    if (!this.ready) return;
    const cam = this.game.camera;
    const l = this.ctx.listener;
    const f = tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(cam.position.x, t, 0.02);
      l.positionY.setTargetAtTime(cam.position.y, t, 0.02);
      l.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      l.setPosition(cam.position.x, cam.position.y, cam.position.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // ---------------------------------------------------------------- ambience
  _startAmbience() {
    // rain on the roof and windows, wind through the eaves
    this.rain = this.play('water', { loop: true, bus: 'amb', volume: 0.0, rateJitter: 0, reverb: 0 });
    this._noiseLoop();
  }

  _noiseLoop() {
    const ctx = this.ctx;
    const n = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6 + (Math.random() * 2 - 1) * 0.3; }
    const mk = (freq, q, vol) => {
      const s = ctx.createBufferSource();
      s.buffer = b; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = vol;
      s.connect(f).connect(g).connect(this.ambBus);
      s.start();
      return { s, f, g };
    };
    this.rainBed = mk(2400, 0.4, 0.05);
    this.wind = mk(420, 1.2, 0.05);
    this.houseHum = mk(90, 2, 0.03);
  }

  /** Per-frame ambience/music update. */
  update(dt, state) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const g = this.game;
    // rain louder near windows / outside walls, muffled deep inside
    const p = g.player;
    const inBasement = p && p.floor === 0;
    const rainVol = inBasement ? 0.015 : 0.045 + (g.world.exterior.lightning * 0.02);
    this.rainBed.g.gain.setTargetAtTime(rainVol, t, 0.5);
    this.rainBed.f.frequency.setTargetAtTime(inBasement ? 700 : 2400, t, 0.5);
    const gust = 0.03 + 0.04 * Math.max(0, Math.sin(g.time * 0.21) * Math.sin(g.time * 0.13));
    this.wind.g.gain.setTargetAtTime(inBasement ? 0.01 : gust, t, 0.8);
    this.wind.f.frequency.setTargetAtTime(300 + 250 * Math.sin(g.time * 0.17), t, 0.8);
    this.houseHum.g.gain.setTargetAtTime(g.world.lighting.power ? 0.025 : 0.0, t, 0.3);
    if (this.music) this.music.update(dt, state);
    this._updatePositionalLoops();
  }

  _updatePositionalLoops() {
    // clocks, the fridge, the boiler, TVs: start when near, stop when far
    const g = this.game;
    const cam = g.camera.position;
    const want = new Set();
    for (const s of g.world.soundSources) {
      const d = s.pos.distanceTo(cam);
      if (d > 14) continue;
      if (s.kind === 'hum' && !g.world.lighting.power) continue;
      const key = s.kind + '@' + s.pos.x.toFixed(1) + ',' + s.pos.z.toFixed(1);
      want.add(key);
      if (!this.loops.has(key)) {
        if (s.kind === 'clock') {
          const h = { tick: 0, s, clock: true };
          this.loops.set(key, h);
        } else {
          const name = s.kind === 'boiler' ? 'engine' : 'engine';
          const h = this.play(name, { pos: s.pos, loop: true, volume: s.kind === 'boiler' ? 0.18 : 0.06, rate: s.kind === 'boiler' ? 0.5 : 1.4, rateJitter: 0, reverb: 0.1 });
          if (h) this.loops.set(key, h);
        }
      }
    }
    for (const tv of g.world.tvs) {
      const key = 'tv@' + tv.id;
      if (tv.on) {
        want.add(key);
        if (!this.loops.has(key)) {
          const h = this.play('static', { pos: tv.pos, loop: true, volume: 0.35, rateJitter: 0 });
          if (h) this.loops.set(key, h);
        }
      }
    }
    for (const [key, h] of this.loops) {
      if (!want.has(key)) {
        if (h.stop) h.stop(0.2);
        this.loops.delete(key);
      } else if (h.clock) {
        h.tick -= 1 / 60;
        if (h.tick <= 0) {
          h.tick = 1;
          this.play('click', { pos: h.s.pos, volume: 0.35, rate: 0.55, reverb: 0.3 });
        }
      }
    }
  }

  stopAllLoops() {
    for (const [, h] of this.loops) if (h.stop) h.stop(0.1);
    this.loops.clear();
  }

  // ---------------------------------------------------------------- game API
  footstep(pos, surface, loud, left, isPlayer) {
    const s = !surface ? 'wood' : surface.startsWith('carpet') ? 'carpet' : surface.startsWith('tile') || surface === 'marble' ? 'tile' : ['concrete', 'stone', 'wetStone', 'dirt'].includes(surface) ? 'stone' : 'wood';
    const p = pos.clone(); p.y += 0.05;
    this.play('step_' + s, { pos: isPlayer ? null : p, volume: 0.22 + loud * 0.35, rate: left ? 1 : 0.94, reverb: 0.2 });
  }

  creak(pos, k = 1) { this.play('creak', { pos, volume: 0.5 * k, rate: 0.9 + Math.random() * 0.3, reverb: 0.35 }); }
  click(k = 1, pos = null) { this.play('click', { pos, volume: 0.4 * k, reverb: 0.1 }); }
  unlock(pos) { this.play('unlock', { pos, volume: 0.6 }); }
  rattle(pos, loud = false) { this.play('rattle', { pos, volume: loud ? 0.9 : 0.6, reverb: 0.3 }); }
  knock(pos) { this.play('knock', { pos, volume: 0.6 }); }
  scratch(pos) { this.play('scratch', { pos, volume: 0.6, reverb: 0.3 }); }
  gasp() { this.play('gasp', { volume: 0.55, reverb: 0.15 }); }
  exhale() { this.play('exhale', { volume: 0.3, reverb: 0.05 }); }
  breath(k = 1) { this.play('breath', { volume: 0.14 + k * 0.2, reverb: 0.05 }); }
  heartbeat(k = 1) { this.play('heartbeat', { volume: 0.25 + k * 0.6, reverb: 0, rateJitter: 0 }); }
  whoosh(pos) { this.play('whoosh', { pos, volume: 0.35 }); }
  pickup(pos, kind) { this.play(kind === 'throwable' ? 'thud' : 'unlock', { pos, volume: 0.35, rate: 1.4 }); }
  work(kind, pos) {
    const name = kind === 'hammer' ? 'hammer' : kind === 'wood' ? 'creak' : kind === 'cut' ? 'cutting' : kind === 'metal' ? 'clatter' : 'thud';
    this.play(name, { pos, volume: 0.7, reverb: 0.35 });
  }
  impact(kind, pos, k = 1) {
    const name = kind === 'bottle' || kind === 'plate' ? 'glass' : kind === 'can' ? 'clatter' : kind === 'toy' ? 'squeak' : 'thud';
    this.play(name, { pos, volume: 0.9 * k, reverb: 0.45 });
  }
  piano(pos) { this.play('pianoChord', { pos, volume: 1, reverb: 0.6, rateJitter: 0.01 }); }
  distantSlam(pos) { this.play('slam', { pos, volume: 0.8, reverb: 0.8 }); }
  stinger(k = 1) { this.play('stinger', { volume: 0.9 * k, reverb: 0.4, rateJitter: 0.03 }); }
  thunder(k = 1) { this.play('thunder', { volume: 0.55 + 0.45 * k, reverb: 0.2, bus: 'amb', rateJitter: 0.1 }); }
  phone(pos) { return this.play('phoneRing', { pos, volume: 0.8, reverb: 0.4, rateJitter: 0 }); }
  bell(semitone, pos = null, vol = 0.5) { this.play('bell' + semitone, { pos, volume: vol, reverb: 0.5, rateJitter: 0.004 }); }
  ghostPiano(pos) {
    const notes = [0, 1, 3, 6, 7, 10, 12, -2, 13];
    this.play('ghost' + notes[Math.floor(Math.random() * notes.length)], { pos, volume: 0.35, reverb: 0.7, rateJitter: 0 });
  }
  whisper(pos) { this.play('whisper', { pos, volume: 0.45, reverb: 0.5 }); }
  drip(pos) { this.play('drip', { pos, volume: 0.25, reverb: 0.6 }); }
  engineStart(pos) { return this.play('engine', { pos, loop: true, volume: 0.8, rateJitter: 0 }); }

  tvStatic(tv, on) {
    // loops are handled in _updatePositionalLoops; add a switch click
    this.play('click', { pos: tv.pos, volume: 0.5 });
    if (on) this.play('static', { pos: tv.pos, volume: 0.5, reverb: 0.2 });
  }

  hideSound(type, pos, byCat = false) {
    const name = type === 'wardrobe' || type === 'cabinet' || type === 'chest' ? 'creak' : type === 'bed' || type === 'coats' || type === 'curtain' || type === 'tub' ? 'whoosh' : 'thud';
    this.play(name, { pos, volume: byCat ? 0.9 : 0.35, rate: byCat ? 0.8 : 1.3, reverb: 0.3 });
  }

  door(ev) {
    const d = ev.door;
    const pos = new THREE.Vector3(d.center.x, d.center.y, d.center.z);
    switch (ev.action) {
      case 'open': if (Math.random() < (d.creaky ? 0.95 : 0.55)) this.play('creak', { pos, volume: d.creaky ? 0.75 : 0.45, rate: d.heavy ? 0.7 : 1 }); break;
      case 'quietOpen': case 'quietClose': this.play('creak', { pos, volume: 0.06, rate: 0.6 }); break;
      case 'ghostCreak': this.play('creak', { pos, volume: 0.55, rate: 0.55, reverb: 0.5 }); break;
      case 'burst': this.play('slam', { pos, volume: 0.9, rate: 1.1 }); break;
      case 'slam': this.play('slam', { pos, volume: 1.0 }); break;
      case 'shut': this.play('thud', { pos, volume: 0.55, rate: 1.2 }); break;
      case 'quietShut': this.play('click', { pos, volume: 0.2 }); break;
      case 'lock': case 'unlock': this.play('unlock', { pos, volume: 0.5 }); break;
      case 'barricade': this.play('hammer', { pos, volume: 0.8 }); break;
      case 'bang': this.play('bang', { pos, volume: 1.0, reverb: 0.5 }); break;
      case 'barricadeBreak': case 'break': this.play('slam', { pos, volume: 1, rate: 0.75, reverb: 0.6 }); this.play('clatter', { pos, volume: 0.8 }); break;
      default: break;
    }
  }

  catStep(pos, k, running, ceiling) {
    const p = pos.clone(); p.y += 0.1;
    this.play(running ? 'catStepRun' : 'catStepSoft', { pos: p, volume: (running ? 0.85 : 0.35) * k, rate: ceiling ? 1.3 : 1, reverb: 0.3 });
  }

  catVocal(kind, pos) {
    const vol = { purr: 0.55, hiss: 0.85, growl: 0.9, meow: 0.7, laugh: 0.8, whisper: 0.5, sniff: 0.5 }[kind] || 0.6;
    this.play(kind, { pos, volume: vol, reverb: kind === 'laugh' || kind === 'meow' ? 0.6 : 0.25, rateJitter: 0.1 });
    if (this.game.settings.subtitles) {
      const label = { purr: '[purring, very close]', hiss: '[hissing]', growl: '[a low growl]', meow: '[a distorted meow]', laugh: '[distorted laughter]', whisper: '[whispering]' }[kind];
      if (label && pos && pos.distanceTo(this.game.camera.position) < 18) this.game.ui.subtitle(label);
    }
  }

  ventScratch(pos) { this.play('ventScratch', { pos, volume: 0.7, reverb: 0.15 }); }
  ventRattle(pos) { this.play('rattle', { pos, volume: 0.55, rate: 1.4 }); }
}
