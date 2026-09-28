// Everything outside the walls: the yard, fence, dead trees, a swing that
// moves by itself, roofs, the stormy sky, rain and lightning. Also the pale
// moonlight patches that windows throw across the floors.
import * as THREE from 'three';
import { floorBaseY, FLOOR_CEIL, SLAB } from './layout.js';
import { OUTSIDE } from './grid.js';
import { mat4 } from './geo.js';
import { RNG } from '../core/rng.js';
import { makeCanvas } from './textures.js';

const EXT_FLOOR = 9; // geo bucket id for always-visible exterior geometry

export class Exterior {
  constructor(world) {
    this.world = world;
    this.grid = world.grid;
    this.rng = new RNG(777);
    this.lightning = 0;
    this.lightningTimer = 25;
    this.flashes = [];
    this.swing = null;
  }

  build() {
    const geo = this.world.staticGeo;
    const slot = this.grid.outsideLightSlot;
    geo.floor = EXT_FLOOR;
    // ground
    for (let x = -40; x < 80; x += 12) {
      for (let z = -40; z < 70; z += 12) {
        geo.quad('grass', [[x, -0.3, z + 12], [x + 12, -0.3, z + 12], [x + 12, -0.3, z], [x, -0.3, z]],
          [[x, -(z + 12)], [x + 12, -(z + 12)], [x + 12, -z], [x, -z]], [0, 1, 0], 1, slot, EXT_FLOOR);
      }
    }
    // paths
    geo.box('stone', 16.9, -0.28, 30, 2.0, 0.04, 10, { room: slot, floor: EXT_FLOOR, faces: 'Y' });
    geo.box('concrete', 4.6, -0.28, 30, 4.4, 0.04, 10, { room: slot, floor: EXT_FLOOR, faces: 'Y' });
    // porch step + roof over the front door
    geo.box('stone', 16.9, -0.15, 25.6, 3.2, 0.3, 1.2, { room: slot, floor: EXT_FLOOR });
    for (const x of [15.4, 18.4]) geo.box('trimWhite', x, 1.2, 26.1, 0.16, 2.9, 0.16, { room: slot, floor: EXT_FLOOR });
    geo.box('shingles', 16.9, 2.75, 25.75, 3.6, 0.12, 1.6, { room: slot, floor: EXT_FLOOR });
    this._buildFence(geo, slot);
    this._buildTrees(geo, slot);
    this._buildRoofs(geo, slot);
    this._buildSwing();
    this._buildSky();
    this._buildRain();
    this._buildWindowPatches();
    this._buildBasementWells(geo, slot);
  }

  _buildFence(geo, slot) {
    const x0 = -8, x1 = 44, z0 = -8, z1 = 34;
    const post = (x, z) => geo.box('woodPlanks', x, 0.4, z, 0.12, 1.4, 0.12, { room: slot, floor: EXT_FLOOR });
    const rail = (x, z, len, alongX, y) => geo.box('woodPlanks', x, y, z, alongX ? len : 0.05, 0.09, alongX ? 0.05 : len, { room: slot, floor: EXT_FLOOR });
    for (let x = x0; x <= x1; x += 2.5) {
      post(x, z0);
      if (Math.abs(x - 16.9) > 2 && Math.abs(x - 4.6) > 2.5) post(x, z1);
    }
    for (let z = z0; z <= z1; z += 2.5) { post(x0, z); post(x1, z); }
    for (const y of [0.3, 0.85]) {
      rail((x0 + x1) / 2, z0, x1 - x0, true, y);
      rail(x0, (z0 + z1) / 2, z1 - z0, false, y);
      rail(x1, (z0 + z1) / 2, z1 - z0, false, y);
      rail((x0 + 2.2) / 2, z1, 2.2 - x0, true, y);
      rail((6.9 + 15) / 2, z1, 15 - 6.9, true, y);
      rail((18.8 + x1) / 2, z1, x1 - 18.8, true, y);
    }
    // gate posts + mailbox
    for (const x of [15.6, 18.2]) geo.box('stone', x, 0.6, z1, 0.4, 1.8, 0.4, { room: slot, floor: EXT_FLOOR });
    geo.box('iron', 20.2, 0.55, z1 + 0.6, 0.08, 1.1, 0.08, { room: slot, floor: EXT_FLOOR });
    geo.box('rust', 20.2, 1.2, z1 + 0.6, 0.25, 0.25, 0.5, { room: slot, floor: EXT_FLOOR });
  }

  _tree(geo, slot, x, z, h, rng) {
    const trunk = new THREE.CylinderGeometry(0.12 * h / 6, 0.3 * h / 6, h, 7);
    geo.geometry('woodBeams', trunk, mat4(x, h / 2 - 0.3, z, rng.float(-0.06, 0.06), 0, rng.float(-0.06, 0.06)), { room: slot, floor: EXT_FLOOR, uvScale: 1 });
    const branches = rng.int(4, 7);
    for (let i = 0; i < branches; i++) {
      const y = h * rng.float(0.45, 0.9);
      const len = h * rng.float(0.22, 0.42);
      const a = rng.float(0, Math.PI * 2);
      const tilt = rng.float(0.6, 1.2);
      const b = new THREE.CylinderGeometry(0.015 * h / 6, 0.07 * h / 6, len, 5);
      b.translate(0, len / 2, 0);
      const m = mat4(x, y - 0.3, z, 0, a, 0).multiply(new THREE.Matrix4().makeRotationZ(tilt));
      geo.geometry('woodBeams', b, m, { room: slot, floor: EXT_FLOOR });
      // twig
      const t = new THREE.CylinderGeometry(0.008, 0.02, len * 0.5, 4);
      t.translate(0, len * 0.25, 0);
      const m2 = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, len * 0.6, 0)).multiply(new THREE.Matrix4().makeRotationZ(-0.7));
      geo.geometry('woodBeams', t, m2, { room: slot, floor: EXT_FLOOR });
    }
  }

  _buildTrees(geo, slot) {
    const rng = this.rng;
    const spots = [];
    for (let i = 0; i < 46; i++) {
      let x, z, ok = false;
      for (let tries = 0; tries < 20 && !ok; tries++) {
        x = rng.float(-30, 66); z = rng.float(-30, 58);
        const nearHouse = x > -4 && x < 40 && z > -4 && z < 29;
        const onPath = (Math.abs(x - 16.9) < 3 || Math.abs(x - 4.6) < 4) && z > 24 && z < 40;
        ok = !nearHouse && !onPath && spots.every(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 > 16);
      }
      if (!ok) continue;
      spots.push([x, z]);
      this._tree(geo, slot, x, z, rng.float(5, 11), rng);
    }
    // a big old tree near the front for the swing
    this._tree(geo, slot, 27, 30.5, 10, rng);
    this.swingTree = new THREE.Vector3(27, 0, 30.5);
    // distant treeline silhouettes
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rng.float(-0.03, 0.03);
      const r = rng.float(75, 95);
      const x = 18 + Math.cos(a) * r, z = 13 + Math.sin(a) * r;
      const h = rng.float(10, 22);
      geo.geometry('black', new THREE.ConeGeometry(h * 0.28, h, 6), mat4(x, h / 2 - 0.3, z), { room: slot, floor: EXT_FLOOR });
    }
  }

  _buildSwing() {
    // tire swing hanging from the front tree - it sways when nobody is there
    const t = this.swingTree;
    const grp = new THREE.Group();
    grp.position.set(t.x + 1.4, 5.2, t.z);
    const ropeMat = this.world.materials.custom({ color: 0x3a3226, roughness: 1 }, 'rope');
    const tireMat = this.world.materials.custom({ color: 0x111111, roughness: 0.9 }, 'tire');
    ropeMat.userData.objRoom.value = this.grid.outsideLightSlot;
    tireMat.userData.objRoom.value = this.grid.outsideLightSlot;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 4.2, 5), ropeMat);
    rope.position.y = -2.1;
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.12, 8, 18), tireMat);
    tire.position.y = -4.3;
    grp.add(rope, tire);
    this.world.addDynamicObject(grp, EXT_FLOOR);
    this.swing = grp;
  }

  _buildRoofs(geo, slot) {
    const g = this.grid;
    for (let f = 1; f <= 2; f++) {
      const top = floorBaseY(f) + FLOOR_CEIL[f] + SLAB;
      for (let z = 0; z < g.D; z++) {
        for (let x = 0; x < g.W; x++) {
          const r = g.cellRaw(f, x, z);
          if (r === OUTSIDE) continue;
          const above = g.cellRaw(f + 1, x, z);
          if (above !== OUTSIDE) continue;
          geo.quad('shingles', [[x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z], [x, top, z]],
            [[x, -(z + 1)], [x + 1, -(z + 1)], [x + 1, -z], [x, -z]], [0, 1, 0], 0.8, slot, EXT_FLOOR);
        }
      }
      // parapet edge band around each flat roof
      for (const e of g.edges.values()) {
        if (e.f !== f || !e.exterior) continue;
        const cIn = e.r1 === OUTSIDE ? e.c2 : e.c1;
        if (g.cellRaw(f + 1, cIn[0], cIn[1]) !== OUTSIDE) continue;
        const cx = e.orient === 'V' ? e.a : e.a + 0.5, cz = e.orient === 'V' ? e.b + 0.5 : e.b;
        geo.box('trimDark', cx, top + 0.08, cz, e.orient === 'V' ? 0.3 : 1.02, 0.16, e.orient === 'V' ? 1.02 : 0.3, { room: slot, floor: EXT_FLOOR });
      }
    }
    // gable roof over the attic (x 9..35, z 1..11)
    const eave = floorBaseY(3) + FLOOR_CEIL[3];
    const ridgeY = eave + 2.2, ridgeZ = 6;
    const x0 = 8.7, x1 = 35.3, z0 = 0.6, z1 = 11.4;
    const uvs = [[0, 0], [0, 6], [26, 6], [26, 0]];
    // north slope (normal up and toward -z), CCW seen from outside
    const n = new THREE.Vector3(0, ridgeZ - z0, -(ridgeY - eave)).normalize();
    geo.quad('shingles', [[x0, eave, z0], [x0, ridgeY, ridgeZ], [x1, ridgeY, ridgeZ], [x1, eave, z0]], uvs, [n.x, n.y, n.z], 0.85, slot, EXT_FLOOR);
    // south slope (normal up and toward +z)
    const s = new THREE.Vector3(0, z1 - ridgeZ, ridgeY - eave).normalize();
    geo.quad('shingles', [[x1, eave, z1], [x1, ridgeY, ridgeZ], [x0, ridgeY, ridgeZ], [x0, eave, z1]], uvs, [s.x, s.y, s.z], 0.85, slot, EXT_FLOOR);
    // gable ends
    for (const [x, dir] of [[x0 + 0.3, -1], [x1 - 0.3, 1]]) {
      const tri = new THREE.BufferGeometry();
      const pts = dir < 0
        ? [x, eave, z0, x, eave, z1, x, ridgeY, ridgeZ]
        : [x, eave, z1, x, eave, z0, x, ridgeY, ridgeZ];
      tri.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([z0, eave, z1, eave, ridgeZ, ridgeY], 2));
      tri.computeVertexNormals();
      geo.geometry('siding', tri, new THREE.Matrix4(), { room: slot, floor: EXT_FLOOR });
    }
    // chimney
    geo.box('brick', 33.5, ridgeY + 0.3, 13.5, 0.9, 5, 0.9, { room: slot, floor: EXT_FLOOR });
  }

  _buildBasementWells(geo, slot) {
    for (const w of this.world.windows) {
      if (w.f !== 0) continue;
      const [ox, oz] = w.outward;
      geo.box('dirt', w.x + ox * 0.55, -0.9, w.z + oz * 0.55, ox ? 0.1 : 1.3, 1.4, oz ? 0.1 : 1.3, { room: slot, floor: EXT_FLOOR });
    }
  }

  _buildSky() {
    const uniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0.45, 0.35, -0.8).normalize() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uFlash; uniform vec3 uMoonDir;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 col = mix(vec3(0.028,0.034,0.05), vec3(0.004,0.005,0.009), pow(max(h,0.0), 0.45));
          // clouds
          vec2 uv = d.xz / max(0.12, d.y + 0.25) * 1.6 + vec2(uTime*0.015, uTime*0.006);
          float c = fbm(uv);
          float cl = smoothstep(0.35, 0.8, c);
          float md = max(dot(d, uMoonDir), 0.0);
          float moon = smoothstep(0.9993, 0.9996, md);
          float halo = pow(md, 60.0) * 0.35 + pow(md, 8.0) * 0.05;
          vec3 moonCol = vec3(0.75,0.8,0.9);
          col += moonCol * halo * (1.0 - cl * 0.8);
          col = mix(col + moonCol * moon * (1.0 - cl), vec3(0.05,0.055,0.07) * (0.6 + halo * 3.0), cl * 0.85);
          col += vec3(0.55,0.6,0.75) * uFlash * (0.25 + cl * 1.4) * (0.4 + h);
          if (d.y < 0.0) col *= 0.4;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.position.set(18, 0, 13);
    this.world.scene.add(sky);
    this.sky = sky;
    this.skyUniforms = uniforms;
  }

  _buildRain() {
    const N = 1600;
    this.rainN = N;
    this.rain = new Float32Array(N * 4); // x,y,z,speed
    const pos = new Float32Array(N * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x8aa0b8, transparent: true, opacity: 0.28, depthWrite: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    this.world.scene.add(lines);
    this.rainLines = lines;
    for (let i = 0; i < N; i++) this._respawnDrop(i, null, true);
  }

  _respawnDrop(i, cam, initial = false) {
    const r = this.rng;
    const cx = cam ? cam.x : 18, cz = cam ? cam.z : 13, cy = cam ? cam.y : 1;
    this.rain[i * 4] = cx + r.float(-16, 16);
    this.rain[i * 4 + 1] = initial ? r.float(-0.3, cy + 14) : cy + r.float(8, 14);
    this.rain[i * 4 + 2] = cz + r.float(-16, 16);
    this.rain[i * 4 + 3] = r.float(11, 15);
  }

  _roofHeightAt(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let f = 3; f >= 1; f--) {
      const r = this.grid.cellRaw(f, cx, cz);
      if (r !== OUTSIDE) return floorBaseY(f) + FLOOR_CEIL[f] + (f === 3 ? 2.2 : SLAB);
    }
    return -1;
  }

  _buildWindowPatches() {
    const c = makeCanvas(128);
    const ctx = c.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(8, 0, 52, 128);
    ctx.fillRect(68, 0, 52, 128);
    ctx.clearRect(0, 58, 128, 10);
    const tex = new THREE.CanvasTexture(c);
    this.patchMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x6a80a8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const w of this.world.windows) {
      if (w.f === 0 || w.style === 'boarded' || w.style === 'boarded-heavy' || w.style === 'frosted') continue;
      if (w.room < 0) continue;
      const room = this.grid.rooms[w.room];
      const [ox, oz] = w.outward;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.7), this.patchMat);
      plane.rotation.x = -Math.PI / 2;
      // stretch inward from the window
      plane.rotation.z = Math.atan2(ox, -oz) + Math.PI;
      plane.position.set(w.x - ox * 0.95, floorBaseY(room.floor) + 0.012, w.z - oz * 0.95);
      plane.renderOrder = 1;
      this.world.addDynamicObject(plane, room.floor);
    }
  }

  triggerLightning(strength = 1) {
    this.flashes = [];
    const n = 1 + this.rng.int(1, 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      this.flashes.push({ at: t, dur: this.rng.float(0.05, 0.14), k: strength * this.rng.float(0.5, 1) });
      t += this.rng.float(0.08, 0.25);
    }
    this.flashT = 0;
    this.world.events.emit('lightning', { strength, delay: this.rng.float(0.8, 3.5) });
  }

  update(dt, t, camPos, reduceFlashes = false) {
    this.skyUniforms.uTime.value = t;
    // lightning
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = this.rng.float(18, 55);
      this.triggerLightning(this.rng.float(0.5, 1));
    }
    let flash = 0;
    if (this.flashes.length) {
      this.flashT += dt;
      for (const f of this.flashes) {
        const u = (this.flashT - f.at) / f.dur;
        if (u >= 0 && u < 3) flash = Math.max(flash, f.k * (u < 1 ? 1 : Math.exp(-(u - 1) * 3)));
      }
      if (this.flashT > 2) this.flashes = [];
    }
    if (reduceFlashes) flash *= 0.25;
    this.lightning = flash;
    this.skyUniforms.uFlash.value = flash;
    this.world.lighting.lightning = flash;
    this.patchMat.opacity = 0.1 + flash * 0.9;
    // swing
    if (this.swing) {
      this.swing.rotation.z = Math.sin(t * 0.9) * 0.12 + Math.sin(t * 0.37) * 0.06;
      this.swing.rotation.x = Math.sin(t * 0.55) * 0.05;
    }
    // rain
    if (camPos) {
      const pos = this.rainLines.geometry.attributes.position.array;
      const R = this.rain;
      for (let i = 0; i < this.rainN; i++) {
        let x = R[i * 4], y = R[i * 4 + 1], z = R[i * 4 + 2];
        y -= R[i * 4 + 3] * dt;
        x += dt * 1.2;
        if (y < -0.3 || Math.abs(x - camPos.x) > 17 || Math.abs(z - camPos.z) > 17) {
          this._respawnDrop(i, camPos);
          x = R[i * 4]; y = R[i * 4 + 1]; z = R[i * 4 + 2];
        }
        R[i * 4] = x; R[i * 4 + 1] = y; R[i * 4 + 2] = z;
        const hidden = y < this._roofHeightAt(x, z);
        const o = i * 6;
        if (hidden) {
          pos[o] = pos[o + 3] = 0; pos[o + 1] = pos[o + 4] = -100; pos[o + 2] = pos[o + 5] = 0;
        } else {
          pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
          pos[o + 3] = x - 0.02; pos[o + 4] = y + 0.35; pos[o + 5] = z;
        }
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
  }
}

export { EXT_FLOOR };
