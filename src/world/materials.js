import * as THREE from 'three';
import { TEXTURE_DEFS } from './textures.js';
import { patchRoomLit } from './roomLighting.js';

// Plain (untextured) materials.
const PLAIN = {
  trimWhite: { color: 0x9c9484, roughness: 0.55 },
  trimDark: { color: 0x2a1a10, roughness: 0.5 },
  black: { color: 0x040404, roughness: 0.9 },
  void: { color: 0x000000, roughness: 1 },
  porcelain: { color: 0xc8c8c0, roughness: 0.12 },
  brass: { color: 0x8a6a30, roughness: 0.35, metalness: 0.85 },
  iron: { color: 0x26262a, roughness: 0.55, metalness: 0.75 },
  chrome: { color: 0xb8b8b8, roughness: 0.18, metalness: 1 },
  rubber: { color: 0x101010, roughness: 0.9 },
  paintRed: { color: 0x6a1010, roughness: 0.5 },
  paintCream: { color: 0xb4ab94, roughness: 0.6 },
  paintGreen: { color: 0x2c3e30, roughness: 0.6 },
  paintBlue: { color: 0x2a3446, roughness: 0.6 },
  carBody: { color: 0x3a1616, roughness: 0.35, metalness: 0.4 },
  tire: { color: 0x121212, roughness: 0.85 },
  wax: { color: 0xd8ccb0, roughness: 0.6 },
  blood: { color: 0x2c0303, roughness: 0.25 },
  bloodDry: { color: 0x1e0604, roughness: 0.7 },
  water: { color: 0x0a0e10, roughness: 0.05, metalness: 0.2 },
  mattress: { color: 0x9a927e, roughness: 0.95 },
  pillow: { color: 0xa8a092, roughness: 0.95 },
  toyRed: { color: 0x8a1c18, roughness: 0.5 },
  toyBlue: { color: 0x1c3a7a, roughness: 0.5 },
  toyYellow: { color: 0x9a7a18, roughness: 0.5 },
  doll: { color: 0xb89a88, roughness: 0.7 },
  dust: { color: 0x3a3630, roughness: 1 },
  crtGlass: { color: 0x0a0c0a, roughness: 0.08, metalness: 0.1 },
  plasticBeige: { color: 0x8a8070, roughness: 0.6 },
  plasticWhite: { color: 0xb8b8b2, roughness: 0.4 },
  ceramic: { color: 0x7a6a5a, roughness: 0.4 },
  greenGlass: { color: 0x14301c, roughness: 0.1, metalness: 0.1 },
  plant: { color: 0x2a3a1c, roughness: 0.9 },
  deadPlant: { color: 0x3a2e1c, roughness: 0.95 },
  pianoBlack: { color: 0x080808, roughness: 0.15 },
  ivory: { color: 0xc8c0a8, roughness: 0.3 },
  gold: { color: 0x9a7a30, roughness: 0.3, metalness: 1 },
};

export class MaterialLib {
  constructor(texLib, lightTable) {
    this.tex = texLib;
    this.lights = lightTable;
    this.staticCache = new Map();
    this.all = [];
  }

  _params(name) {
    if (PLAIN[name]) return { ...PLAIN[name] };
    const def = TEXTURE_DEFS[name];
    if (!def) throw new Error('unknown material ' + name);
    const t = this.tex.get(name);
    const rep = 1 / def.scale;
    t.map.repeat.set(rep, rep);
    const p = { map: t.map, roughness: def.rough ?? 0.8, metalness: def.metal ?? 0 };
    if (t.bump) {
      t.bump.repeat.set(rep, rep);
      p.bumpMap = t.bump;
      p.bumpScale = 1.2;
    }
    return p;
  }

  /** Shared material for merged static geometry (uses aRoom + vertex colours). */
  static(name) {
    if (this.staticCache.has(name)) return this.staticCache.get(name);
    let mat;
    if (name === 'glass') {
      mat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
    } else if (name === 'frosted') {
      mat = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
    } else if (name === 'cobweb') {
      mat = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    } else {
      mat = new THREE.MeshStandardMaterial({ ...this._params(name), vertexColors: true });
    }
    mat.name = name;
    if (name !== 'glass' && name !== 'frosted' && name !== 'cobweb') mat.vertexColors = true;
    patchRoomLit(mat, this.lights, false);
    this.staticCache.set(name, mat);
    this.all.push(mat);
    return mat;
  }

  /** A fresh material for a dynamic object whose room changes or differs. */
  dynamic(name, extra = {}) {
    const mat = new THREE.MeshStandardMaterial({ ...this._params(name), ...extra });
    mat.name = name + ':dyn';
    patchRoomLit(mat, this.lights, true);
    this.all.push(mat);
    return mat;
  }

  /** Plain room-lit dynamic material from explicit params. */
  custom(params, name = 'custom') {
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = name + ':dyn';
    patchRoomLit(mat, this.lights, true);
    this.all.push(mat);
    return mat;
  }
}

export const PLAIN_MATERIALS = PLAIN;
