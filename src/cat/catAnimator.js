// Procedural animation for the cat rig: poses and gaits blended together,
// foot planting through forward kinematics, and a "wrongness" layer of
// sudden twitches, head snaps and stop-motion stutters.
import * as THREE from 'three';
import { noise1 } from '../core/rng.js';

const ZERO = () => ({
  hipDrop: 0, bodyPitch: 0, bodyRoll: 0, spine: 0, chest: 0, neck: 0,
  headP: 0, headY: 0, headR: 0,
  shL: [0, 0, 0], shR: [0, 0, 0], elL: 0, elR: 0, wrL: 0, wrR: 0, fing: 0.2,
  hpL: [0, 0, 0], hpR: [0, 0, 0], knL: 0, knR: 0, anL: 0, anR: 0, pwL: 0, pwR: 0,
  tailP: 0.3, tailY: 0, tailCurl: 0.15, jaw: 0, grin: 1, plant: 'feet',
});

function lerpPose(a, b, t) {
  const o = {};
  for (const k in a) {
    const va = a[k], vb = b[k];
    if (Array.isArray(va)) o[k] = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
    else if (typeof va === 'number') o[k] = va + (vb - va) * t;
    else o[k] = t < 0.5 ? va : vb;
  }
  return o;
}

// ---------------------------------------------------------------- poses
// Each pose fn(p: pose object, ph: gait phase 0..1, t: time, s: speed factor)
const POSES = {
  stand(p, ph, t) {
    // tall, slightly hunched, arms hanging too low
    p.bodyPitch = 0.12; p.spine = 0.12; p.chest = 0.08; p.neck = -0.12; p.headP = -0.06;
    p.shL = [0.05, 0, -0.08]; p.shR = [0.05, 0, 0.08]; p.elL = -0.15; p.elR = -0.15;
    p.hpL = [-0.35, 0, -0.04]; p.hpR = [-0.35, 0, 0.04]; p.knL = p.knR = 0.95; p.anL = p.anR = -0.72; p.pwL = p.pwR = 0.1;
    const br = Math.sin(t * 1.6) * 0.02;
    p.chest += br; p.shL[2] -= br; p.shR[2] += br;
    p.tailP = 0.2 + Math.sin(t * 0.8) * 0.1; p.tailY = Math.sin(t * 0.55) * 0.5;
    p.grin = 1;
  },
  walk(p, ph, t) {
    POSES.stand(p, ph, t);
    const a = ph * Math.PI * 2;
    const sw = Math.sin(a);
    p.hpL[0] = -0.35 - sw * 0.42; p.hpR[0] = -0.35 + sw * 0.42;
    p.knL = 0.95 + Math.max(0, Math.cos(a)) * 0.55; p.knR = 0.95 + Math.max(0, -Math.cos(a)) * 0.55;
    p.anL = -0.72 - Math.max(0, Math.cos(a)) * 0.3; p.anR = -0.72 - Math.max(0, -Math.cos(a)) * 0.3;
    p.shL[0] = 0.05 + sw * 0.25; p.shR[0] = 0.05 - sw * 0.25;
    p.bodyRoll = sw * 0.05; p.headR = -sw * 0.05;
    p.tailY = -sw * 0.4;
  },
  stalk(p, ph, t) {
    POSES.walk(p, ph * 0.9, t);
    // low, predatory, arms reaching
    p.bodyPitch = 0.55; p.spine = 0.25; p.chest = 0.2; p.neck = -0.55; p.headP = -0.25;
    p.hpL[0] -= 0.45; p.hpR[0] -= 0.45; p.knL += 0.5; p.knR += 0.5; p.anL -= 0.2; p.anR -= 0.2;
    p.shL = [-0.6 + Math.sin(ph * Math.PI * 2) * 0.2, 0, -0.1]; p.shR = [-0.6 - Math.sin(ph * Math.PI * 2) * 0.2, 0, 0.1];
    p.elL = p.elR = -0.4; p.fing = 0.6;
    p.tailP = 0.05; p.tailCurl = 0.05;
  },
  run(p, ph, t) {
    // quadruped rotary gallop: arms become front legs
    const a = ph * Math.PI * 2;
    p.plant = 'all';
    p.bodyPitch = 1.42 + Math.sin(a) * 0.06; p.spine = -0.12 + Math.sin(a) * 0.14; p.chest = -0.18 + Math.sin(a + 1) * 0.1;
    p.neck = -0.85; p.headP = -0.35;
    const f1 = Math.sin(a), f2 = Math.sin(a + 0.6), h1 = Math.sin(a + Math.PI), h2 = Math.sin(a + Math.PI + 0.6);
    p.shL = [-1.35 + f1 * 0.75, 0, -0.1]; p.shR = [-1.35 + f2 * 0.75, 0, 0.1];
    p.elL = 0.35 + Math.max(0, -f1) * 0.6; p.elR = 0.35 + Math.max(0, -f2) * 0.6;
    p.wrL = -0.5; p.wrR = -0.5; p.fing = 0.5;
    p.hpL = [-1.1 + h1 * 0.75, 0, -0.1]; p.hpR = [-1.1 + h2 * 0.75, 0, 0.1];
    p.knL = 1.3 + Math.max(0, h1) * 0.5; p.knR = 1.3 + Math.max(0, h2) * 0.5;
    p.anL = p.anR = -0.9;
    p.tailP = -0.25 + Math.sin(a) * 0.12; p.tailY = Math.sin(a * 0.5) * 0.15; p.tailCurl = 0.02;
    p.grin = 1.15; p.jaw = 0.15 + Math.max(0, Math.sin(a)) * 0.1;
  },
  crawl(p, ph, t) {
    // spider-like: belly low, limbs splayed wide, jerky
    const a = ph * Math.PI * 2;
    p.plant = 'all';
    p.bodyPitch = 1.5; p.spine = 0.05; p.chest = -0.05; p.neck = -1.0; p.headP = -0.1;
    p.shL = [-1.2 + Math.sin(a) * 0.5, 0.3, -1.0]; p.shR = [-1.2 + Math.sin(a + Math.PI) * 0.5, -0.3, 1.0];
    p.elL = 1.6 + Math.max(0, Math.cos(a)) * 0.4; p.elR = 1.6 + Math.max(0, -Math.cos(a)) * 0.4;
    p.wrL = p.wrR = -0.6; p.fing = 0.7;
    p.hpL = [-1.3 + Math.sin(a + Math.PI) * 0.4, 0, -0.9]; p.hpR = [-1.3 + Math.sin(a) * 0.4, 0, 0.9];
    p.knL = p.knR = 2.2; p.anL = p.anR = -1.1;
    p.tailP = 0.15; p.tailY = Math.sin(t * 3) * 0.3; p.tailCurl = 0.25;
    p.hipDrop = 0.2;
    p.grin = 1.2; p.jaw = 0.05;
  },
  stare(p, ph, t) {
    POSES.stand(p, ph, t);
    p.bodyPitch = 0.04; p.spine = 0.05; p.chest = 0; p.neck = 0.05;
    p.headR = 0.45; p.headP = 0.05;  // head tilted, curious
    p.shL = [0, 0, -0.03]; p.shR = [0, 0, 0.03]; p.elL = p.elR = -0.05; p.fing = 0.1;
    p.tailP = 0.4; p.tailY = 0; p.tailCurl = 0.4;
    p.grin = 1.25; p.jaw = 0.02;
  },
  sniff(p, ph, t) {
    POSES.stand(p, ph, t);
    p.bodyPitch = 0.7; p.spine = 0.3; p.chest = 0.2; p.neck = -0.2; p.headP = 0.35 + Math.sin(t * 14) * 0.05;
    p.headY = Math.sin(t * 2.3) * 0.5;
    p.hpL[0] -= 0.6; p.hpR[0] -= 0.6; p.knL += 0.7; p.knR += 0.7; p.anL -= 0.2; p.anR -= 0.2;
    p.shL = [-0.4, 0, -0.1]; p.shR = [-0.5, 0, 0.1];
  },
  lookUnder(p, ph, t) {
    // folds down to peer beneath furniture
    POSES.stand(p, ph, t);
    p.bodyPitch = 1.35; p.spine = 0.5; p.chest = 0.3; p.neck = 0.2; p.headP = 0.3; p.headR = 1.2;
    p.hpL = [-1.6, 0, -0.3]; p.hpR = [-1.6, 0, 0.3]; p.knL = p.knR = 2.4; p.anL = p.anR = -1.2;
    p.shL = [-1.4, 0, -0.3]; p.shR = [-1.4, 0, 0.3]; p.elL = p.elR = 0.4;
    p.plant = 'feet'; p.hipDrop = 0.05;
    p.grin = 1.3;
  },
  reach(p, ph, t) {
    POSES.stand(p, ph, t);
    p.bodyPitch = 0.3; p.neck = -0.25;
    p.shL = [-1.35, 0.1, -0.15]; p.shR = [-1.35, -0.1, 0.15]; p.elL = p.elR = -0.2; p.fing = 0.9;
    p.grin = 1.3; p.jaw = 0.1;
  },
  pound(p, ph, t) {
    POSES.stand(p, ph, t);
    const a = Math.sin(t * 9);
    p.bodyPitch = 0.2 + a * 0.1;
    p.shL = [-2.6 + a * 0.5, 0, -0.2]; p.shR = [-2.6 - a * 0.5, 0, 0.2]; p.elL = p.elR = -0.3; p.fing = 1;
    p.headP = -0.2; p.jaw = 0.3;
  },
  lunge(p, ph, t) {
    // airborne pounce, everything reaching forward
    p.plant = 'none';
    p.bodyPitch = 1.35; p.spine = -0.25; p.chest = -0.2; p.neck = -0.6; p.headP = -0.4;
    p.shL = [-2.9, 0.2, -0.35]; p.shR = [-2.9, -0.2, 0.35]; p.elL = p.elR = -0.1; p.fing = 1;
    p.hpL = [0.4, 0, -0.1]; p.hpR = [0.4, 0, 0.1]; p.knL = p.knR = 0.4; p.anL = p.anR = -0.2;
    p.tailP = -0.5; p.grin = 1.4; p.jaw = 0.9;
  },
  grab(p, ph, t) {
    POSES.stand(p, ph, t);
    p.bodyPitch = 0.45; p.neck = -0.3; p.headP = -0.2;
    p.shL = [-1.55, 0.35, -0.1]; p.shR = [-1.55, -0.35, 0.1]; p.elL = p.elR = -0.9; p.fing = 1.3;
    p.grin = 1.45; p.jaw = 0.6 + Math.sin(t * 20) * 0.05;
  },
  drag(p, ph, t) {
    POSES.walk(p, 1 - ph, t);
    p.bodyPitch = 0.75; p.spine = 0.3; p.neck = -0.5;
    p.shL = [-0.9, 0.2, -0.1]; p.shR = [-0.9, -0.2, 0.1]; p.elL = p.elR = -0.6; p.fing = 1.2;
    p.grin = 1.35;
  },
  squeeze(p, ph, t) {
    POSES.crawl(p, ph, t);
    p.shL = [-2.6, 0, -0.1]; p.shR = [-2.6, 0, 0.1]; p.elL = p.elR = 0; p.hipDrop = 0.35;
  },
  laugh(p, ph, t) {
    POSES.stand(p, ph, t);
    const s = Math.sin(t * 22);
    p.neck = 0.35; p.headP = 0.4 + s * 0.06; p.chest += s * 0.04;
    p.shL[2] -= Math.abs(s) * 0.1; p.shR[2] += Math.abs(s) * 0.1;
    p.jaw = 0.5 + s * 0.2; p.grin = 1.35;
  },
  sit(p, ph, t) {
    // the secret ending: slumped like a toy
    p.bodyPitch = -0.1; p.spine = 0.35; p.chest = 0.3; p.neck = 0.35; p.headP = 0.4; p.headR = 0.3;
    p.hpL = [-1.55, 0.2, -0.3]; p.hpR = [-1.55, -0.2, 0.3]; p.knL = p.knR = 0.1; p.anL = p.anR = 0;
    p.shL = [0.2, 0, -0.3]; p.shR = [0.2, 0, 0.3]; p.elL = p.elR = -0.2; p.fing = 0.1;
    p.plant = 'sit'; p.tailP = 0.8; p.tailCurl = 0.02; p.grin = 0.75; p.jaw = 0;
  },
  hang(p, ph, t) {
    // dangling from the ceiling, head down in your face
    p.plant = 'none';
    p.bodyPitch = Math.PI; p.spine = 0; p.chest = 0; p.neck = 0.2; p.headP = -0.1 + Math.sin(t * 1.3) * 0.05; p.headR = 0.3;
    p.shL = [0.2, 0, -0.3]; p.shR = [0.2, 0, 0.3];
    p.hpL = [0, 0, 0]; p.hpR = [0, 0, 0]; p.knL = p.knR = 0.1;
    p.grin = 1.4; p.jaw = 0.25;
  },
};

export class CatAnimator {
  constructor(model) {
    this.m = model;
    this.pose = 'stand';
    this.prevPose = null;
    this.blend = 1;
    this.blendTime = 0.3;
    this.phase = 0;
    this.time = 0;
    this.current = ZERO();
    this.twitch = { t: 2, yaw: 0, roll: 0, pitch: 0, targetYaw: 0, targetRoll: 0, targetPitch: 0, hold: 0 };
    this.stutter = 0;
    this.blinkT = 3;
    this.blinkAmt = 0;
    this.pupil = 1;
    this.jawOverride = null;
    this.grinOverride = null;
    this.headLookYaw = 0;   // extra head yaw toward a target
    this.headLookPitch = 0;
    this.lastGrin = [1, 0];
    this.twitchiness = 1;
    this._v = new THREE.Vector3();
  }

  setPose(name, blendTime = 0.3) {
    if (name === this.pose) return;
    this.prevSnapshot = { ...this.current, shL: [...this.current.shL], shR: [...this.current.shR], hpL: [...this.current.hpL], hpR: [...this.current.hpR] };
    this.pose = name;
    this.blend = 0;
    this.blendTime = blendTime;
  }

  /** speed: current movement speed (m/s), stride: metres per gait cycle */
  update(dt, speed = 0, stride = 1.4) {
    // stop-motion stutter: occasionally hold a frame, then catch up
    if (this.stutter > 0) { this.stutter -= dt; if (this.stutter > 0.03) { return; } }
    else if (Math.random() < dt * 0.15 * this.twitchiness) this.stutter = 0.08 + Math.random() * 0.12;
    this.time += dt;
    const t = this.time;
    this.phase = (this.phase + (speed * dt) / stride) % 1;
    const target = ZERO();
    (POSES[this.pose] || POSES.stand)(target, this.phase, t, speed);
    let p = target;
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendTime);
      const e = this.blend * this.blend * (3 - 2 * this.blend);
      p = lerpPose(this.prevSnapshot, target, e);
    }
    this.current = p;
    this._twitch(dt, t);
    this._apply(p, t);
  }

  _twitch(dt, t) {
    const tw = this.twitch;
    tw.t -= dt;
    if (tw.t <= 0) {
      // snap the head somewhere unnatural, hold, relax
      const big = Math.random() < 0.3;
      tw.targetYaw = (Math.random() - 0.5) * (big ? 1.6 : 0.6);
      tw.targetRoll = (Math.random() - 0.5) * (big ? 1.4 : 0.5);
      tw.targetPitch = (Math.random() - 0.5) * 0.4;
      tw.hold = 0.25 + Math.random() * 1.2;
      tw.t = (1.5 + Math.random() * 4.5) / this.twitchiness;
    }
    if (tw.hold > 0) {
      tw.hold -= dt;
      const k = 1 - Math.exp(-dt * 30); // snap fast
      tw.yaw += (tw.targetYaw - tw.yaw) * k;
      tw.roll += (tw.targetRoll - tw.roll) * k;
      tw.pitch += (tw.targetPitch - tw.pitch) * k;
    } else {
      const k = 1 - Math.exp(-dt * 3);
      tw.yaw -= tw.yaw * k; tw.roll -= tw.roll * k; tw.pitch -= tw.pitch * k;
    }
    // blinking: slow, deliberate
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkAmt = 1; this.blinkT = 3 + Math.random() * 7; }
    this.blinkAmt = Math.max(0, this.blinkAmt - dt * 3);
  }

  _apply(p, t) {
    const m = this.m;
    m.body.rotation.set(0, 0, 0);
    m.hips.rotation.set(p.bodyPitch, 0, p.bodyRoll);
    m.spine.rotation.set(p.spine, 0, 0);
    m.chest.rotation.set(p.chest, 0, 0);
    m.neck.rotation.set(p.neck, 0, 0);
    const tw = this.twitch;
    // keep the head roughly level when the body pitches (so it looks ahead)
    const levelK = p.plant === 'all' ? 1 : 0.6;
    const counter = -(p.bodyPitch + p.spine + p.chest + p.neck) * levelK;
    m.head.rotation.set(p.headP + counter + tw.pitch + this.headLookPitch, p.headY + tw.yaw + this.headLookYaw, p.headR + tw.roll, 'YXZ');
    const A = m.arms, L = m.legs;
    A.L.shoulder.rotation.set(p.shL[0], p.shL[1], p.shL[2]);
    A.R.shoulder.rotation.set(p.shR[0], p.shR[1], p.shR[2]);
    A.L.elbow.rotation.set(p.elL, 0, 0);
    A.R.elbow.rotation.set(p.elR, 0, 0);
    A.L.wrist.rotation.set(p.wrL, 0, 0);
    A.R.wrist.rotation.set(p.wrR, 0, 0);
    for (const s of ['L', 'R']) for (const f of A[s].fingers) f.rotation.x = -p.fing - Math.sin(t * 7 + f.position.x * 40) * 0.05;
    L.L.hip.rotation.set(p.hpL[0], p.hpL[1], p.hpL[2]);
    L.R.hip.rotation.set(p.hpR[0], p.hpR[1], p.hpR[2]);
    L.L.knee.rotation.set(p.knL, 0, 0);
    L.R.knee.rotation.set(p.knR, 0, 0);
    L.L.ankle.rotation.set(p.anL, 0, 0);
    L.R.ankle.rotation.set(p.anR, 0, 0);
    // paws stay flat-ish
    const pitchL = p.bodyPitch + p.hpL[0] + p.knL + p.anL;
    const pitchR = p.bodyPitch + p.hpR[0] + p.knR + p.anR;
    L.L.paw.rotation.set(-pitchL + p.pwL, 0, 0);
    L.R.paw.rotation.set(-pitchR + p.pwR, 0, 0);
    // tail
    m.tail.forEach((seg, i) => {
      const k = i / m.tail.length;
      seg.rotation.set(i === 0 ? p.tailP - p.bodyPitch * 0.8 : p.tailCurl * (1 + k) + Math.sin(t * 2.2 - i * 0.6) * 0.06, i === 0 ? p.tailY : Math.sin(t * 1.7 - i * 0.7) * 0.12 + p.tailY * 0.2, 0);
    });
    // face
    const jaw = this.jawOverride ?? p.jaw;
    const grin = this.grinOverride ?? p.grin;
    if (Math.abs(jaw - this.lastGrin[1]) > 0.004 || Math.abs(grin - this.lastGrin[0]) > 0.004) {
      m.grin.set(grin, jaw);
      this.lastGrin = [grin, jaw];
    }
    for (const e of m.eyes) {
      e.lid.scale.y = 0.01 + this.blinkAmt * 1.3;
      e.pupil.scale.x = this.pupil;
    }
    // foot planting: move the hips so the lowest contact touches the floor
    m.hips.position.y = 1.0;
    m.root.updateMatrixWorld(true);
    if (p.plant !== 'none') {
      const inv = new THREE.Matrix4().copy(m.root.matrixWorld).invert();
      const low = (obj) => this._v.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(inv).y;
      let y = Math.min(low(L.L.paw), low(L.R.paw)) - 0.05;
      if (p.plant === 'all') y = Math.min(y, low(A.L.wrist) - 0.17, low(A.R.wrist) - 0.17);
      if (p.plant === 'sit') y = low(m.hips) - 0.12;
      m.hips.position.y = 1.0 - y - p.hipDrop * 0.2;
      m.root.updateMatrixWorld(true);
    }
  }
}

export const CAT_POSES = Object.keys(POSES);
void noise1;
