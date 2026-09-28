// Static geometry batching. Everything that never moves is appended into
// buckets keyed by (material, floor chunk) and merged into a handful of big
// meshes. Each vertex carries its room's light slot (aRoom) and a baked
// ambient-occlusion tint (color).
import * as THREE from 'three';

const CHUNK_X = 18;
const CHUNK_Z = 13;

export function chunkOf(f, x, z) {
  return `${f}:${Math.max(0, Math.floor(x / CHUNK_X))}:${Math.max(0, Math.floor(z / CHUNK_Z))}`;
}

class Bucket {
  constructor(mat, chunk, floor) {
    this.mat = mat; this.chunk = chunk; this.floor = floor;
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.room = []; this.idx = [];
    this.count = 0;
  }
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class GeoBuilder {
  constructor(materials) {
    this.materials = materials; // MaterialLib
    this.buckets = new Map();
    this.floor = 1;        // current floor (for chunking)
    this.room = 0;         // current light slot
    this.shadowless = new Set(['glass', 'frosted', 'cobweb']);
  }

  _bucket(matName, f, x, z) {
    const chunk = chunkOf(f, x, z);
    const key = matName + '|' + chunk;
    let b = this.buckets.get(key);
    if (!b) {
      b = new Bucket(matName, chunk, f);
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Append a quad. corners: 4 x [x,y,z] in CCW order seen from the front,
   * uvs: 4 x [u,v], normal [nx,ny,nz], colours: number or 4 numbers.
   */
  quad(mat, corners, uvs, normal, shade = 1, room = this.room, f = this.floor) {
    const cx = (corners[0][0] + corners[2][0]) / 2, cz = (corners[0][2] + corners[2][2]) / 2;
    const b = this._bucket(mat, f, cx, cz);
    const base = b.count;
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      b.pos.push(c[0], c[1], c[2]);
      b.nor.push(normal[0], normal[1], normal[2]);
      b.uv.push(uvs[i][0], uvs[i][1]);
      const s = Array.isArray(shade) ? shade[i] : shade;
      b.col.push(s, s, s);
      b.room.push(room);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.count += 4;
  }

  /**
   * Axis-aligned-in-local-space box, rotated around Y by `ry` about its
   * centre, with world-scale UVs. faces: string subset of 'xXyYzZ'
   * (x = -X face, X = +X face ...). ao: darken bottom vertices.
   */
  box(mat, cx, cy, cz, sx, sy, sz, opts = {}) {
    const ry = opts.ry || 0;
    const faces = opts.faces || 'xXyYzZ';
    const uvs = opts.uvScale || 1;
    const ao = opts.ao ?? 0.72;
    const room = opts.room ?? this.room;
    const f = opts.floor ?? this.floor;
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const tr = (lx, ly, lz) => [cx + lx * cos + lz * sin, cy + ly, cz - lx * sin + lz * cos];
    const rn = (nx, ny, nz) => [nx * cos + nz * sin, ny, -nx * sin + nz * cos];
    const sh = (ly) => (ly < 0 ? ao : 1);
    const u0 = opts.uvOffset ? opts.uvOffset[0] : 0, v0 = opts.uvOffset ? opts.uvOffset[1] : 0;
    const add = (c, uv, n, s) => this.quad(mat, c, uv.map(([u, v]) => [u * uvs + u0, v * uvs + v0]), n, s, room, f);
    if (faces.includes('X')) add([tr(hx, -hy, hz), tr(hx, -hy, -hz), tr(hx, hy, -hz), tr(hx, hy, hz)], [[0, 0], [sz, 0], [sz, sy], [0, sy]], rn(1, 0, 0), [sh(-1), sh(-1), 1, 1]);
    if (faces.includes('x')) add([tr(-hx, -hy, -hz), tr(-hx, -hy, hz), tr(-hx, hy, hz), tr(-hx, hy, -hz)], [[0, 0], [sz, 0], [sz, sy], [0, sy]], rn(-1, 0, 0), [sh(-1), sh(-1), 1, 1]);
    if (faces.includes('Y')) add([tr(-hx, hy, hz), tr(hx, hy, hz), tr(hx, hy, -hz), tr(-hx, hy, -hz)], [[0, 0], [sx, 0], [sx, sz], [0, sz]], rn(0, 1, 0), 1);
    if (faces.includes('y')) add([tr(-hx, -hy, -hz), tr(hx, -hy, -hz), tr(hx, -hy, hz), tr(-hx, -hy, hz)], [[0, 0], [sx, 0], [sx, sz], [0, sz]], rn(0, -1, 0), ao);
    if (faces.includes('Z')) add([tr(-hx, -hy, hz), tr(hx, -hy, hz), tr(hx, hy, hz), tr(-hx, hy, hz)], [[0, 0], [sx, 0], [sx, sy], [0, sy]], rn(0, 0, 1), [sh(-1), sh(-1), 1, 1]);
    if (faces.includes('z')) add([tr(hx, -hy, -hz), tr(-hx, -hy, -hz), tr(-hx, hy, -hz), tr(hx, hy, -hz)], [[0, 0], [sx, 0], [sx, sy], [0, sy]], rn(0, 0, -1), [sh(-1), sh(-1), 1, 1]);
  }

  /** Append an arbitrary three.js geometry transformed by `matrix`. */
  geometry(mat, geom, matrix, opts = {}) {
    const room = opts.room ?? this.room;
    const f = opts.floor ?? this.floor;
    const uvScale = opts.uvScale ?? 1;
    const shade = opts.shade ?? 1;
    const g = geom.index ? geom : geom;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    _v.set(0, 0, 0).applyMatrix4(matrix);
    const b = this._bucket(mat, f, _v.x, _v.z);
    const base = b.count;
    _m3.getNormalMatrix(matrix);
    let minY = Infinity, maxY = -Infinity;
    if (opts.aoBottom) {
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
      }
    }
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      b.pos.push(_v.x, _v.y, _v.z);
      let s = shade;
      if (opts.aoBottom && maxY > minY) s *= 0.7 + 0.3 * Math.min(1, (_v.y - minY) / Math.min(0.4, maxY - minY));
      if (nor) {
        _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
        b.nor.push(_n.x, _n.y, _n.z);
      } else b.nor.push(0, 1, 0);
      if (uv) b.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale); else b.uv.push(0, 0);
      b.col.push(s, s, s);
      b.room.push(room);
    }
    if (g.index) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i++) b.idx.push(base + ix[i]);
    } else {
      for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    }
    b.count += pos.count;
  }

  /**
   * Build everything appended so far into a movable Group (used for doors,
   * drawers and other animated parts that still use per-vertex rooms).
   */
  buildGroup(name = 'group', shadows = true) {
    const group = new THREE.Group();
    group.name = name;
    const { meshes } = this.build();
    for (const m of meshes) {
      m.matrixAutoUpdate = true;
      m.castShadow = shadows && m.castShadow;
      group.add(m);
    }
    return group;
  }

  /** Build meshes grouped per floor. Returns { meshes, byFloor: Map<f, Mesh[]> } */
  build() {
    const byFloor = new Map();
    const meshes = [];
    for (const b of this.buckets.values()) {
      if (!b.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute('aRoom', new THREE.Float32BufferAttribute(b.room, 1));
      g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mat = this.materials.static(b.mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `static:${b.mat}:${b.chunk}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      const transparent = this.shadowless.has(b.mat);
      mesh.castShadow = !transparent;
      mesh.receiveShadow = !transparent;
      if (transparent) mesh.renderOrder = 2;
      mesh.userData.floor = b.floor;
      meshes.push(mesh);
      if (!byFloor.has(b.floor)) byFloor.set(b.floor, []);
      byFloor.get(b.floor).push(mesh);
    }
    this.buckets.clear();
    return { meshes, byFloor };
  }
}

// Small helpers to create transform matrices.
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
