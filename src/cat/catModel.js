// The cat. A jointed rig built from primitives: digitigrade legs, far too
// long arms, a tall crooked striped hat, a red bow tie, glowing slit-pupil
// eyes and a grin that runs from ear to ear - with a jaw that can drop open
// much further than any jaw should.
import * as THREE from 'three';

const J = (name, parent, x, y, z) => {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  if (parent) parent.add(o);
  return o;
};

function capsule(r, len, mat, seg = 8) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, seg), mat);
  m.castShadow = true;
  return m;
}

function sphere(r, mat, sx = 1, sy = 1, sz = 1, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

export function createCatModel(materials, opts = {}) {
  const lib = materials;
  // dynamic (room-lit) materials, so the cat is only as visible as its room
  const mk = (params, name) => (lib && lib.custom ? lib.custom(params, name) : new THREE.MeshStandardMaterial(params));
  const furTex = lib && lib.tex ? lib.tex.get('fur') : null;
  const fur = mk({ color: 0x1c1b1f, roughness: 0.95, map: furTex ? furTex.map : null, bumpMap: furTex ? furTex.bump : null, bumpScale: 1.5 }, 'catFur');
  const whiteFur = mk({ color: 0x9a968e, roughness: 0.95, map: furTex ? furTex.map : null }, 'catWhite');
  const glove = mk({ color: 0xb8b2a6, roughness: 0.8 }, 'catGlove');
  const dark = mk({ color: 0x050303, roughness: 0.9 }, 'catDark');
  const mouthMat = mk({ color: 0x2a0406, roughness: 0.6, side: THREE.DoubleSide }, 'catMouth');
  const teethMat = mk({ color: 0xe6e0cc, roughness: 0.3, emissive: 0x3a3830, emissiveIntensity: 0.8 }, 'catTeeth');
  const clawMat = mk({ color: 0xc8c0a8, roughness: 0.35 }, 'catClaw');
  const red = mk({ color: 0x8e0b0b, roughness: 0.55 }, 'catRed');
  const white = mk({ color: 0xd8d0c0, roughness: 0.6 }, 'catWhiteHat');
  const pink = mk({ color: 0x5a2a2e, roughness: 0.8 }, 'catPink');
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 0.55) });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const mats = { fur, whiteFur, glove, dark, mouthMat, teethMat, clawMat, red, white, pink, eyeMat };

  const root = new THREE.Group();
  root.name = 'cat';
  const body = J('body', root, 0, 0, 0); // pose offsets (flip for ceiling etc.)
  const hips = J('hips', body, 0, 1.0, 0);
  const pelvis = sphere(0.15, fur, 1.25, 0.95, 1.05);
  pelvis.position.set(0, 0, -0.01);
  hips.add(pelvis);
  const spine = J('spine', hips, 0, 0.07, 0);
  const sm = capsule(0.125, 0.26, fur);
  sm.position.set(0, 0.18, 0);
  sm.scale.set(1.05, 1, 0.9);
  spine.add(sm);
  const chest = J('chest', spine, 0, 0.36, 0);
  const cm = capsule(0.155, 0.2, fur);
  cm.position.set(0, 0.12, 0);
  cm.scale.set(1.28, 1, 0.95);
  chest.add(cm);
  const bib = sphere(0.12, whiteFur, 1.05, 1.35, 0.55);
  bib.position.set(0, 0.1, 0.1);
  chest.add(bib);
  const neck = J('neck', chest, 0, 0.3, 0.02);
  const nm = capsule(0.07, 0.12, fur);
  nm.position.set(0, 0.07, 0);
  neck.add(nm);
  // bow tie
  const bow = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.11, 4), red);
    c.rotation.z = s * Math.PI / 2;
    c.scale.set(1, 1, 0.45);
    c.position.x = s * 0.052;
    c.castShadow = true;
    bow.add(c);
  }
  bow.add(sphere(0.022, red));
  bow.position.set(0, 0.035, 0.085);
  neck.add(bow);
  // head
  const head = J('head', neck, 0, 0.19, 0.03);
  const skull = sphere(0.2, fur, 1.13, 0.94, 1.0, 20);
  skull.position.set(0, 0.05, 0);
  head.add(skull);
  const cheeks = sphere(0.16, fur, 1.35, 0.7, 0.9);
  cheeks.position.set(0, -0.03, 0.03);
  head.add(cheeks);
  const muzzle = sphere(0.085, whiteFur, 1.35, 0.78, 0.85);
  muzzle.position.set(0, -0.02, 0.165);
  head.add(muzzle);
  const nose = sphere(0.022, pink, 1.3, 0.8, 0.8);
  nose.position.set(0, 0.018, 0.235);
  head.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 4), fur);
    ear.position.set(s * 0.14, 0.2, -0.02);
    ear.rotation.set(-0.1, s * 0.3, -s * 0.38);
    ear.scale.set(1, 1, 0.45);
    ear.castShadow = true;
    head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 4), pink);
    inner.position.set(s * 0.137, 0.19, 0.005);
    inner.rotation.copy(ear.rotation);
    inner.scale.set(1, 1, 0.3);
    head.add(inner);
  }
  // eyes
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), eyeMat);
    eye.scale.set(1, 1.28, 0.55);
    eye.position.set(s * 0.086, 0.075, 0.165);
    eye.rotation.z = s * -0.18;
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.085, 0.01), pupilMat);
    pupil.position.set(s * 0.086, 0.075, 0.195);
    pupil.rotation.z = s * -0.18;
    head.add(pupil);
    // eyelid (for slow blinks)
    const lid = sphere(0.056, fur, 1, 1.3, 0.62);
    lid.position.copy(eye.position);
    lid.position.z -= 0.003;
    lid.scale.y = 0.01;
    head.add(lid);
    eyes.push({ eye, pupil, lid, side: s });
  }
  // eye glow sprites (help the eyes read in fog / darkness)
  const glowTex = makeGlowTexture();
  const glows = [];
  for (const e of eyes) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xe8e070, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.setScalar(0.22);
    sp.position.copy(e.eye.position).add(new THREE.Vector3(0, 0, 0.03));
    head.add(sp);
    glows.push(sp);
  }
  // the grin
  const grin = buildGrin(mouthMat, teethMat);
  grin.group.position.set(0, -0.045, 0);
  head.add(grin.group);
  // whiskers
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0012, 0.34, 3), clawMat);
      w.position.set(s * 0.17, -0.005 - i * 0.018, 0.17);
      w.rotation.set(0, 0, s * (Math.PI / 2 - 0.12 + i * 0.12));
      w.rotation.y = s * 0.35;
      head.add(w);
    }
  }
  // hat: brim + alternating stripes, crooked and a little bent
  const hat = J('hat', head, 0.015, 0.215, -0.02);
  hat.rotation.set(-0.12, 0, 0.16);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.028, 24), red);
  brim.castShadow = true;
  hat.add(brim);
  let hy = 0.014;
  let bend = 0;
  const stripes = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.085;
    const r = 0.152 - i * 0.002;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.99, r, h, 20), i % 2 ? white : red);
    st.position.set(bend * 0.8, hy + h / 2, 0);
    st.rotation.z = -bend * 1.4;
    st.castShadow = true;
    hat.add(st);
    stripes.push(st);
    hy += h * 0.985;
    bend += 0.006 + i * 0.0035;
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.015, 20), white);
  top.position.set(bend * 0.8, hy + 0.005, 0);
  top.rotation.z = -bend * 1.4;
  hat.add(top);
  // arms (too long), gloved hands with claws
  const arms = {};
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    const shoulder = J('shoulder' + side, chest, s * 0.2, 0.22, 0);
    const ua = capsule(0.055, 0.4, fur);
    ua.position.set(0, -0.23, 0);
    shoulder.add(ua);
    const elbow = J('elbow' + side, shoulder, 0, -0.47, 0);
    const fa = capsule(0.045, 0.42, fur);
    fa.position.set(0, -0.23, 0);
    elbow.add(fa);
    const wrist = J('wrist' + side, elbow, 0, -0.47, 0);
    const palm = sphere(0.058, glove, 1.05, 1.35, 0.55);
    palm.position.set(0, -0.06, 0);
    wrist.add(palm);
    const fingers = [];
    for (let i = 0; i < 4; i++) {
      const fj = J('finger' + side + i, wrist, (i - 1.5) * 0.028, -0.12, 0.005);
      const fm = capsule(0.013, 0.12, glove, 5);
      fm.position.set(0, -0.07, 0);
      fj.add(fm);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.06, 5), clawMat);
      claw.position.set(0, -0.16, 0.006);
      claw.rotation.x = Math.PI + 0.25;
      fj.add(claw);
      fingers.push(fj);
    }
    arms[side] = { shoulder, elbow, wrist, fingers };
  }
  // digitigrade legs
  const legs = {};
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    const hip = J('hip' + side, hips, s * 0.11, -0.04, 0);
    const th = capsule(0.078, 0.36, fur);
    th.position.set(0, -0.22, 0.02);
    hip.add(th);
    const knee = J('knee' + side, hip, 0, -0.44, 0.02);
    const sh = capsule(0.05, 0.38, fur);
    sh.position.set(0, -0.21, 0);
    knee.add(sh);
    const ankle = J('ankle' + side, knee, 0, -0.42, 0);
    const mt = capsule(0.042, 0.22, fur);
    mt.position.set(0, -0.13, 0);
    ankle.add(mt);
    const paw = J('paw' + side, ankle, 0, -0.27, 0);
    const pm = sphere(0.07, glove, 0.95, 0.5, 1.45);
    pm.position.set(0, -0.015, 0.055);
    paw.add(pm);
    for (let i = 0; i < 3; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.045, 5), clawMat);
      claw.position.set((i - 1) * 0.03, -0.02, 0.16);
      claw.rotation.x = Math.PI / 2;
      paw.add(claw);
    }
    legs[side] = { hip, knee, ankle, paw };
  }
  // tail
  const tail = [];
  let tp = J('tail0', hips, 0, 0.02, -0.15);
  for (let i = 0; i < 8; i++) {
    const r = 0.05 - i * 0.004;
    const seg = capsule(r, 0.08, fur, 6);
    seg.position.set(0, 0, -0.07);
    seg.rotation.x = Math.PI / 2;
    tp.add(seg);
    tail.push(tp);
    tp = J('tail' + (i + 1), tp, 0, 0, -0.13);
  }
  root.traverse((o) => { if (o.isMesh && o.material !== eyeMat && o.material !== pupilMat) o.castShadow = true; });

  return {
    root, body, hips, spine, chest, neck, head, hat, bow, arms, legs, tail, eyes, glows, grin, mats,
    allMaterials: [fur, whiteFur, glove, dark, mouthMat, teethMat, clawMat, red, white, pink],
  };
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,200,1)');
  g.addColorStop(0.25, 'rgba(240,230,120,0.45)');
  g.addColorStop(1, 'rgba(200,200,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * The grin: a dark mouth ribbon wrapped around the front of the head from
 * cheek to cheek, lined with teeth. `set(width, open)` reshapes it.
 */
function buildGrin(mouthMat, teethMat) {
  const group = new THREE.Group();
  const N = 28;
  const R = 0.212;
  const span = 1.32; // radians either side of centre: nearly ear to ear
  const pos = new Float32Array((N + 1) * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, c, b, b, c, d);
  }
  geo.setIndex(idx);
  const ribbon = new THREE.Mesh(geo, mouthMat);
  group.add(ribbon);
  const upper = [], lower = [];
  const toothGeo = new THREE.ConeGeometry(0.009, 0.034, 4);
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const small = Math.abs(t - 0.5) > 0.38;
    const u = new THREE.Mesh(toothGeo, teethMat);
    u.scale.setScalar(small ? 0.6 : 1);
    group.add(u);
    upper.push({ m: u, t });
    const l = new THREE.Mesh(toothGeo, teethMat);
    l.scale.setScalar(small ? 0.6 : 1);
    group.add(l);
    lower.push({ m: l, t });
  }
  const state = { width: 1, open: 0 };
  const curve = (t, width, lowerLip, open) => {
    const a = (t - 0.5) * 2 * span * width;
    const x = Math.sin(a) * R * 1.08;
    const z = Math.cos(a) * R * 0.98;
    // corners curl up into a smile
    const smile = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * 0.075 * width;
    let y = smile;
    if (lowerLip) {
      const gap = (1 - Math.pow(Math.abs(t - 0.5) * 2, 1.6)) * (0.022 + open * 0.2);
      y -= gap;
    }
    return new THREE.Vector3(x, y, z + (lowerLip ? open * 0.03 : 0));
  };
  function set(width = 1, open = 0) {
    state.width = width; state.open = open;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = curve(t, width, false, open), b = curve(t, width, true, open);
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    for (const tth of upper) {
      const p = curve(tth.t, width, false, open);
      tth.m.position.copy(p).add(new THREE.Vector3(0, -0.012, 0.002));
      tth.m.rotation.set(0, Math.atan2(p.x, p.z), Math.PI);
    }
    for (const tth of lower) {
      const p = curve(tth.t, width, true, open);
      tth.m.position.copy(p).add(new THREE.Vector3(0, 0.012, 0.002));
      tth.m.rotation.set(0, Math.atan2(p.x, p.z), 0);
    }
  }
  set(1, 0);
  return { group, set, state };
}
