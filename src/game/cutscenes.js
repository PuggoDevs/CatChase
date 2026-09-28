// Scripted camera sequences: the wake-up intro, six different deaths, the
// struggle, and the five endings. A cutscene owns the camera while it runs.
import * as THREE from 'three';
import { floorBaseY } from '../world/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function lookQuat(from, to, roll = 0) {
  const m = new THREE.Matrix4().lookAt(from, to, V(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), roll));
  return q;
}

export const DEATH_LINES = {
  lunge: ['It was faster than you.', 'It pounced before you could scream.', 'You felt its breath before you saw its teeth.'],
  grab: ['Long fingers closed around your shoulders.', 'Its grin kept getting wider. And wider.', 'It wanted to play a different game.'],
  drag: ['It dragged you into the dark. Somewhere, a door closed.', 'The last thing you saw was the ceiling, sliding away.'],
  hide: ['It knew where you were hiding. It always knows.', 'The doors swung open. It was smiling.', 'Found you.'],
  bed: ['Its face appeared at the edge of the bed. Upside down. Smiling.'],
  ceiling: ['You never thought to look up.', 'It was on the ceiling the whole time.'],
  behind: ['It was behind you the whole time.', 'You felt something breathing on your neck.'],
};

export class Cutscenes {
  constructor(game) {
    this.game = game;
    this.active = null;
  }

  get cam() { return this.game.camera; }

  play(scene) {
    this.active = scene;
    scene.t = 0;
    if (scene.start) scene.start();
  }

  update(dt) {
    const s = this.active;
    if (!s) return false;
    s.t += dt;
    s.update(s.t, dt);
    this.game.syncFlashlight();
    if (s.t >= s.duration) {
      this.active = null;
      if (s.done) s.done();
    }
    return true;
  }

  // ================================================================ intro
  intro() {
    const g = this.game;
    const p = g.player;
    const cam = this.cam;
    const bedHead = V(19.6, floorBaseY(2) + 0.85, 3.2);
    const stand = V(p.pos.x, p.pos.y + 1.6, p.pos.z);
    const ceilingLook = V(20.4, floorBaseY(2) + 3, 3.2);
    const doorLook = V(21.5, floorBaseY(2) + 1.4, 9);
    return {
      duration: 6,
      start() {
        g.ui.fade(1, 0.01);
        setTimeout(() => g.ui.fade(0, 2.5), 60);
        g.ui.toast('You wake up in a stranger\'s bed. You don\'t remember coming here.', true);
      },
      update(t) {
        if (t < 2.5) {
          cam.position.copy(bedHead);
          cam.quaternion.copy(lookQuat(bedHead, ceilingLook, 0.3 - t * 0.1));
        } else {
          const k = ease(clamp01((t - 2.5) / 2.2));
          cam.position.lerpVectors(bedHead, stand, k);
          const look = ceilingLook.clone().lerp(doorLook, k);
          cam.quaternion.copy(lookQuat(cam.position, look, 0.3 * (1 - k)));
        }
        if (t > 2.4 && t < 2.45) g.audio.creak(bedHead, 0.6);
      },
      done() {
        const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
        p.yaw = Math.atan2(-fwd.x, -fwd.z);
        p.pitch = 0;
        g.onIntroDone();
      },
    };
  }

  // ================================================================ deaths
  chooseDeath(kind, spot) {
    const g = this.game;
    const cat = g.cat;
    if (kind === 'hide') return spot && spot.type === 'bed' ? 'bed' : 'hide';
    if (cat.mode === 'ceiling' || cat.flip > 0.5) return 'ceiling';
    const fwd = V(0, 0, -1).applyQuaternion(this.cam.quaternion).setY(0).normalize();
    const to = cat.pos.clone().sub(g.player.pos).setY(0).normalize();
    if (fwd.dot(to) < -0.3) return Math.random() < 0.6 ? 'behind' : 'drag';
    return ['lunge', 'grab', 'drag', 'lunge'][Math.floor(Math.random() * 4)];
  }

  death(kind, spot, onDone) {
    const g = this.game;
    const cat = g.cat;
    const cam = this.cam;
    const fx = g.post.u;
    const eye = cam.position.clone();
    const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
    const floorY = g.player.pos.y;
    const place = (pos, faceTo) => {
      cat.pos.copy(pos);
      cat.yaw = Math.atan2(faceTo.x - pos.x, faceTo.z - pos.z);
      cat.mode = 'floor';
      cat.flip = 0;
      cat.model.root.visible = true;
      cat.model.root.scale.set(1, 1, 1);
    };
    const crunch = () => { g.audio.play('slam', { volume: 1, rate: 0.6 }); g.audio.catVocal('growl', cam.position.clone()); };
    const black = (k) => { fx.uBlack.value = k; };
    const base = { lines: DEATH_LINES[kind] || DEATH_LINES.grab };
    let scene;
    switch (kind) {
      case 'lunge': {
        const from = eye.clone().addScaledVector(fwd, 2.6).setY(floorY);
        scene = {
          duration: 1.7,
          start() { place(from, eye); cat.anim.setPose('lunge', 0.05); cat.anim.jawOverride = 1.1; g.audio.stinger(1); },
          update(t) {
            const k = ease(clamp01(t / 0.38));
            const target = eye.clone().addScaledVector(fwd, 0.25).setY(eye.y - 1.45);
            cat.pos.lerpVectors(from, target, k);
            g.player.addShake(0.12, 0.2);
            fx.uRed.value = k * 0.5;
            if (t > 0.4 && !this.crunched) { this.crunched = true; crunch(); }
            black(t > 0.4 ? 1 : 0);
          },
        };
        break;
      }
      case 'grab': case 'behind': {
        const behind = kind === 'behind';
        const turnFrom = cam.quaternion.clone();
        const catPos = eye.clone().addScaledVector(fwd, behind ? -0.95 : 0.95).setY(floorY);
        scene = {
          duration: behind ? 3.0 : 2.6,
          start() { place(catPos, eye); cat.anim.setPose(behind ? 'stare' : 'grab', 0.1); if (!behind) g.audio.stinger(0.9); else g.audio.silence(1.2, 0.02); },
          update(t) {
            const head = cat.headPos(V());
            if (behind) {
              const k = ease(clamp01(t / 1.1));
              const q = lookQuat(eye, head);
              cam.quaternion.copy(turnFrom).slerp(q, k);
              if (t > 1.1 && !this.stung) { this.stung = true; g.audio.unsilence(); g.audio.stinger(1); cat.anim.setPose('grab', 0.15); }
            } else cam.quaternion.copy(lookQuat(eye, head));
            const u = clamp01((t - (behind ? 1.1 : 0)) / 1.4);
            cat.anim.jawOverride = 0.2 + u * 1.25;
            cat.pos.copy(catPos).addScaledVector(fwd, (behind ? 1 : -1) * -u * 0.45);
            g.player.addShake(0.02 + u * 0.05, 0.2);
            fx.uRed.value = u * 0.6;
            fx.uDistort.value = u;
            const end = behind ? 2.4 : 1.8;
            if (t > end && !this.crunched) { this.crunched = true; crunch(); }
            black(t > end ? 1 : 0);
          },
        };
        break;
      }
      case 'drag': {
        const floorCam = eye.clone().setY(floorY + 0.28);
        const back = fwd.clone().negate();
        scene = {
          duration: 4.2,
          start() { place(eye.clone().addScaledVector(fwd, 0.7).setY(floorY), eye); cat.anim.setPose('grab', 0.1); g.audio.stinger(0.9); },
          update(t, dt) {
            const fall = ease(clamp01(t / 0.45));
            const drag = clamp01((t - 0.9) / 2.6);
            const pos = eye.clone().lerp(floorCam, fall).addScaledVector(back, drag * 3.2);
            pos.y += Math.abs(Math.sin(t * 9)) * 0.03 * (drag > 0 && drag < 1 ? 1 : 0);
            cam.position.copy(pos);
            const catFeet = pos.clone().addScaledVector(fwd, 0.9).setY(floorY);
            cat.pos.copy(catFeet);
            cat.yaw = Math.atan2(-fwd.x, -fwd.z);
            if (t > 0.9) cat.anim.setPose('drag', 0.2);
            const head = cat.headPos(V());
            cam.quaternion.copy(lookQuat(pos, head, 1.1 * fall));
            if (drag > 0 && Math.random() < dt * 6) g.audio.footstep(pos, 'wood', 0.4, true, false);
            fx.uRed.value = 0.25 * fall;
            black(clamp01((t - 2.8) / 0.8));
            if (t > 3.5 && !this.slam) { this.slam = true; g.audio.distantSlam(pos); }
          },
        };
        break;
      }
      case 'hide': case 'bed': {
        const s = spot;
        const bed = kind === 'bed';
        scene = {
          duration: 2.6,
          start() {
            const out = s.entry.clone().sub(s.inside).setY(0).normalize();
            const pos = s.inside.clone().addScaledVector(out, bed ? 0.85 : 0.75).setY(floorBaseY(s.f));
            place(pos, s.inside);
            cat.anim.setPose(bed ? 'lookUnder' : 'reach', 0.05);
            cat.anim.jawOverride = 0.05;
            s.setOpen(1);
            g.audio.silence(1.1, 0.0);
          },
          update(t) {
            cam.position.copy(s.inside);
            const head = cat.headPos(V());
            cam.quaternion.copy(lookQuat(s.inside, head));
            if (t > 1.1 && !this.stung) { this.stung = true; g.audio.unsilence(); g.audio.stinger(1); }
            if (t > 1.1) {
              const u = clamp01((t - 1.1) / 0.5);
              cat.anim.jawOverride = 0.05 + u * 1.2;
              g.player.addShake(0.08 * u, 0.2);
              fx.uRed.value = u * 0.5;
            }
            if (t > 1.7 && !this.crunched) { this.crunched = true; crunch(); }
            black(t > 1.7 ? 1 : 0);
          },
          done0() { s.setOpen(0); },
        };
        break;
      }
      case 'ceiling': {
        const ceilY = (g.player.room ? g.player.room.baseY + g.player.room.ceil : eye.y + 1.4);
        const hangAt = eye.clone().addScaledVector(fwd, 0.75);
        scene = {
          duration: 2.4,
          start() {
            cat.model.root.visible = true;
            cat.mode = 'floor';
            cat.flip = 0;
            cat.anim.setPose('hang', 0.05);
            g.audio.stinger(0.8);
          },
          update(t) {
            const drop = ease(clamp01(t / 0.3));
            cat.pos.set(hangAt.x, ceilY + 0.2 - drop * 0.4, hangAt.z);
            cat.yaw = Math.atan2(eye.x - hangAt.x, eye.z - hangAt.z) + Math.PI;
            cat.model.root.position.copy(cat.pos);
            cat.model.root.rotation.set(0, cat.yaw, Math.PI, 'YXZ');
            const head = cat.headPos(V());
            cam.quaternion.copy(lookQuat(eye, head));
            const u = clamp01((t - 0.9) / 0.6);
            cat.anim.jawOverride = 0.2 + u * 1.1;
            fx.uRed.value = u * 0.5;
            if (t > 1.5 && !this.crunched) { this.crunched = true; crunch(); }
            black(t > 1.5 ? 1 : 0);
          },
          ceilingLock: true,
        };
        break;
      }
      default:
        return this.death('grab', spot, onDone);
    }
    scene.done = () => {
      cat.anim.jawOverride = null;
      if (spot) spot.setOpen(0);
      fx.uRed.value = 0; fx.uDistort.value = 0;
      onDone(base.lines[Math.floor(Math.random() * base.lines.length)]);
    };
    this.play(scene);
    return scene;
  }

  // ================================================================ struggle
  struggle(onEscape, onFail) {
    const g = this.game;
    const cat = g.cat;
    const cam = this.cam;
    const fx = g.post.u;
    const eye = cam.position.clone();
    const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    let meter = 0.25;
    const scene = {
      duration: 3.4,
      start() {
        cat.pos.copy(eye.clone().addScaledVector(fwd, 0.8).setY(g.player.pos.y));
        cat.yaw = Math.atan2(-fwd.x, -fwd.z);
        cat.model.root.visible = true;
        cat.mode = 'floor';
        cat.anim.setPose('grab', 0.1);
        g.audio.stinger(0.8);
        g.ui.setStruggle(meter);
      },
      update(t, dt) {
        const head = cat.headPos(V());
        cam.quaternion.copy(lookQuat(eye, head));
        cam.position.copy(eye);
        if (g.input.pressed('breath') || g.input.pressed('interact') || g.input.pressed('primary')) meter += 0.11;
        meter = Math.max(0, meter - dt * 0.28);
        g.ui.setStruggle(Math.min(1, meter));
        cat.anim.jawOverride = 0.3 + Math.sin(t * 18) * 0.05 + t * 0.12;
        g.player.addShake(0.05, 0.2);
        fx.uRed.value = 0.2 + t * 0.1;
        if (meter >= 1) { scene.duration = 0; scene.escaped = true; }
      },
      done() {
        g.ui.setStruggle(null);
        cat.anim.jawOverride = null;
        fx.uRed.value = 0;
        if (scene.escaped) onEscape(); else onFail();
      },
    };
    this.play(scene);
  }

  // ================================================================ endings
  escape(route, onDone) {
    const g = this.game;
    const cam = this.cam;
    const fx = g.post.u;
    const ph = g.director;
    const cat = g.cat;
    let scene;
    if (route === 'front') {
      const door = g.world.doors.get('front_door');
      const start = cam.position.clone();
      const out = V(16.9, 1.5, 27.5);
      scene = {
        duration: 7.5,
        start() {
          door.jammed = false; door.locked = false; door.openDoor('player', 'normal'); door.speed = 0.7;
          cat.hide();
          g.audio.creak(V(16.9, 1, 24.9), 1);
          g.audio.rainBed.g.gain.value = 0.1;
        },
        update(t) {
          const k = ease(clamp01((t - 0.8) / 3));
          cam.position.lerpVectors(start, out, k);
          cam.position.y += Math.sin(t * 9) * 0.02 * (k > 0 && k < 1 ? 1 : 0);
          const turn = ease(clamp01((t - 4) / 1.4));
          const lookOut = V(16.9, 1.3, 40), lookBack = V(17.5, 4.9, 19);
          cam.quaternion.copy(lookQuat(cam.position, lookOut.clone().lerp(lookBack, turn)));
          if (t > 4.6 && !this.shown) {
            this.shown = true;
            ph.showPhantom(V(17.6, floorBaseY(2), 18.1), Math.PI * 0, 'stare', { twitch: 0.5 });
            g.world.exterior.triggerLightning(1);
          }
          fx.uBlack.value = clamp01((t - 6.3) / 1.1);
        },
      };
    } else if (route === 'car') {
      const car = g.world.car;
      const gdoor = g.world.doors.get('garage_door');
      const seat = car.seat.clone();
      const fwd = V(Math.sin(car.yaw), 0, Math.cos(car.yaw));
      const hood = car.front.clone().addScaledVector(fwd, -0.9);
      scene = {
        duration: 10,
        start() {
          g.audio.engine = g.audio.engineStart(car.front);
          g.noise(car.front.clone(), 40, 'engine', 'world');
          gdoor.jammed = false; gdoor.locked = false; gdoor.openDoor('world', 'normal'); gdoor.speed = 0.14;
          cat.hide();
          g.ui.toast('The engine coughs and roars. The garage door grinds upward...', true);
        },
        update(t, dt) {
          const drive = clamp01((t - 6) / 3);
          const pos = seat.clone().addScaledVector(fwd, drive * drive * 16);
          pos.y += Math.sin(t * 30) * 0.004 + (drive > 0 ? Math.sin(t * 12) * 0.01 : 0);
          cam.position.copy(pos);
          let look = pos.clone().addScaledVector(fwd, 5).setY(pos.y - 0.1);
          if (t > 1.5 && t < 3.8) look = look.lerp(V(9, 1.2, 17.5), ease(clamp01((t - 1.5) / 0.6)) * (1 - ease(clamp01((t - 3.2) / 0.6))));
          cam.quaternion.copy(lookQuat(pos, look));
          // it comes for you
          if (t > 2.2 && !this.catIn) {
            this.catIn = true;
            cat.teleport(1, 9.3, 17.5, Math.atan2(hood.x - 9.3, hood.z - 17.5));
            cat.setState('scripted');
            cat.anim.setPose('run', 0.1);
            g.audio.catVocal('growl', V(9.3, 1, 17.5));
          }
          if (this.catIn && t < 4.2) {
            const k = clamp01((t - 2.2) / 2);
            cat.pos.lerpVectors(V(9.3, 0, 17.5), hood.clone().setY(0.9), k * k);
            cat.anim.update(dt, 5, 2.2);
          }
          if (t > 4.2 && !this.pounce) {
            this.pounce = true;
            g.audio.stinger(1);
            g.player.addShake(0.12, 0.6);
            cat.anim.setPose('grab', 0.05);
            cat.anim.jawOverride = 1;
          }
          if (this.pounce) {
            const fall = clamp01((t - 6.2) / 0.8);
            cat.pos.copy(hood.clone().addScaledVector(fwd, drive * drive * 16 - fall * 2).setY(0.95 - fall * 1.2));
            cat.pos.x += fall * 1.5;
            cat.yaw = Math.atan2(-fwd.x, -fwd.z) + fall * 2;
            if (fall >= 1) cat.hide();
          }
          fx.uBlack.value = clamp01((t - 8.6) / 1.2);
        },
        done0() { if (g.audio.engine) g.audio.engine.stop(0.5); },
      };
    } else if (route === 'attic') {
      const w = g.objectives.atticWin.win;
      const [ox, oz] = w.outward;
      const start = cam.position.clone();
      const sill = V(w.x + ox * 0.4, w.sill + 0.9, w.z + oz * 0.4);
      const ground = V(w.x + ox * 1.1, 1.4, w.z + oz * 1.1 + 1);
      scene = {
        duration: 9,
        start() { cat.hide(); g.audio.creak(sill, 1); },
        update(t) {
          if (t < 1.5) {
            cam.position.lerpVectors(start, sill, ease(t / 1.5));
            cam.quaternion.copy(lookQuat(cam.position, sill.clone().add(V(ox * 5, -3, oz * 5))));
          } else {
            const k = ease(clamp01((t - 1.5) / 4));
            cam.position.lerpVectors(sill, ground, k);
            cam.position.x += Math.sin(t * 5) * 0.03;
            const up = ease(clamp01((t - 5.3) / 1.2));
            const lookDown = cam.position.clone().add(V(ox * 3, -4, oz * 3));
            const lookUp = V(w.x, w.sill + 0.9, w.z);
            cam.quaternion.copy(lookQuat(cam.position, lookDown.lerp(lookUp, up)));
          }
          if (t > 6 && !this.shown) {
            this.shown = true;
            ph.showPhantom(V(w.x - ox * 0.5, floorBaseY(3), w.z - oz * 0.5), Math.atan2(ox, oz), 'stare', { twitch: 0.4 });
            g.world.exterior.triggerLightning(1);
            g.audio.catVocal('laugh', V(w.x, w.sill + 1, w.z));
          }
          fx.uBlack.value = clamp01((t - 7.6) / 1.2);
        },
      };
    } else if (route === 'tunnel') {
      const y = floorBaseY(0) + 0.55;
      scene = {
        duration: 8,
        start() { cat.hide(); g.audio.play('water', { volume: 0.4 }); },
        update(t) {
          const k = clamp01(t / 5.5);
          const pos = V(32, y + Math.sin(t * 7) * 0.03, 19.5 + k * 1.8);
          cam.position.copy(pos);
          let look = V(32, y, 30);
          if (t > 2 && t < 3.6) look = look.lerp(V(32, y, 10), ease(clamp01((t - 2) / 0.4)) * (1 - ease(clamp01((t - 3.2) / 0.4))));
          if (t > 5.5) look = V(32, y + 10, 21.4);
          cam.quaternion.copy(lookQuat(pos, look));
          if (t > 2.2 && !this.shown) {
            this.shown = true;
            ph.showPhantom(V(32, floorBaseY(0), 12.2), 0, 'crawl', { twitch: 1 });
            g.audio.catVocal('hiss', V(32, y, 12));
          }
          if (t > 3.6 && this.shown && !this.hid) { this.hid = true; ph.hidePhantom(); }
          fx.uBlack.value = clamp01((t - 6.6) / 1.2);
        },
      };
    } else {
      // secret ending: through Ellie's tiny door, into the light
      const start = cam.position.clone();
      scene = {
        duration: 8,
        start() {
          g.ui.fader.style.background = '#fff6e6';
        },
        update(t) {
          cam.position.lerpVectors(start, start.clone().add(V(-1.5, 0, 0)), ease(clamp01(t / 3)));
          cam.quaternion.copy(lookQuat(cam.position, V(4, cam.position.y, 9.5)));
          g.ui.fade(clamp01((t - 1) / 2.5), 0.05);
          if (t > 2 && !this.song) {
            this.song = true;
            const mel = [12, 10, 7, 10, 12, 12, 12];
            mel.forEach((n, i) => setTimeout(() => g.audio.bell(n, null, 0.4), i * 450));
          }
        },
        done0() {},
      };
    }
    const prevDone = scene.done0;
    scene.done = () => {
      if (prevDone) prevDone();
      ph.hidePhantom();
      onDone();
    };
    this.play(scene);
  }
}
