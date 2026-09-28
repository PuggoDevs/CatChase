// Exports the web game's house, items, art, sounds and data (plus the cat
// model from godot/models/cat.glb) into the Unreal project (unreal/CatHouse).
// Re-run after changing the web house.
// usage: node scripts/unreal-export.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PROJECT = 'unreal/CatHouse';
const route = (name) => {
  if (name.startsWith('Data/')) return join(PROJECT, 'Content/CatHouse', name);
  return join(PROJECT, 'RawAssets', name);
};
const write = (path, buf) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
};

// ------------------------------------------------------------------ the web house
const server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
let bytes = 0;
await page.exposeFunction('__save', (name, data) => {
  const buf = Buffer.from(data, 'base64');
  write(route(name), buf);
  bytes += buf.length;
});
await page.goto('http://localhost:5193/?autostart=normal&skipintro=1&fixeddt=1&seed=EXPORT&nocat=1');
await page.waitForFunction(() => window.__game && window.__game.state === 'playing' && window.__game.audio.buffers.size > 0, null, { timeout: 240000, polling: 500 });
const summary = await page.evaluate(async () => {
  const { exportForUnreal } = await import('/tools/unrealExport.js');
  return exportForUnreal(window.__game, (name, data) => window.__save(name, data));
});
console.log('house:', JSON.stringify(summary), `${(bytes / 1e6).toFixed(1)} MB`);
await browser.close();
await server.close();

// ------------------------------------------------------------------ the cat model (glTF binary)
const glb = readFileSync('godot/models/cat.glb');
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart);
const view = (i) => {
  const bv = gltf.bufferViews[i];
  return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
};
const accessor = (i) => {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || comps * T.BYTES_PER_ELEMENT;
  const out = new T(a.count * comps);
  for (let i = 0; i < a.count; i++) {
    const base = off + i * stride;
    for (let c = 0; c < comps; c++) {
      const p = base + c * T.BYTES_PER_ELEMENT;
      out[i * comps + c] = T === Float32Array ? bin.readFloatLE(p) : T === Uint32Array ? bin.readUInt32LE(p) : T === Uint16Array ? bin.readUInt16LE(p) : bin.readUInt8(p);
    }
  }
  return out;
};
const prim = gltf.meshes[0].primitives[0];
const pos = accessor(prim.attributes.POSITION);
const nrm = accessor(prim.attributes.NORMAL);
const uv = accessor(prim.attributes.TEXCOORD_0);
const idx = accessor(prim.indices);
const nv = pos.length / 3;
const parts = [];
const push = (b) => parts.push(Buffer.from(b));
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); push(b); };
const name = Buffer.from('cat');
const nl = Buffer.alloc(2);
nl.writeUInt16LE(name.length);
push(Buffer.from('CHM1'));
u32(1);
push(nl); push(name);
u32(0); u32(nv); u32(idx.length); push(Buffer.from([0]));
push(Buffer.from(new Float32Array(pos).buffer));
push(Buffer.from(new Float32Array(nrm).buffer));
push(Buffer.from(new Float32Array(uv).buffer));
push(Buffer.from(new Uint32Array(idx).buffer));
write(join(PROJECT, 'Content/CatHouse/Data/cat.chm'), Buffer.concat(parts));
const mat = gltf.materials[0];
const texImage = (t) => gltf.images[gltf.textures[t.index].source];
const saveImg = (t, file) => {
  if (!t) return;
  const img = texImage(t);
  const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
  write(join(PROJECT, 'RawAssets/Cat', file + '.' + ext), view(img.bufferView));
};
saveImg(mat.pbrMetallicRoughness.baseColorTexture, 'T_Cat_BaseColor');
saveImg(mat.pbrMetallicRoughness.metallicRoughnessTexture, 'T_Cat_MetalRough');
saveImg(mat.normalTexture, 'N_Cat_Normal');
const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) { bb[c] = Math.min(bb[c], pos[i * 3 + c]); bb[c + 3] = Math.max(bb[c + 3], pos[i * 3 + c]); }
console.log('cat:', nv, 'verts', idx.length / 3, 'tris, bounds', bb.map((v) => v.toFixed(3)).join(' '));

// ------------------------------------------------------------------ a soft glow (eyes, glints)
{
  const { deflateSync } = await import('node:zlib');
  const N = 64;
  const raw = Buffer.alloc((N * 4 + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const a = Math.max(0, 1 - d) ** 2.2;
      const o = y * (N * 4 + 1) + 1 + x * 4;
      raw[o] = 255; raw[o + 1] = 245; raw[o + 2] = 200; raw[o + 3] = Math.round(a * 255);
    }
  }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  write(join(PROJECT, 'RawAssets/Textures/T_Glow.png'), png);
}

// ------------------------------------------------------------------ the typeface
mkdirSync(join(PROJECT, 'Content/CatHouse/Fonts'), { recursive: true });
copyFileSync('godot/fonts/IMFellEnglish-Regular.ttf', join(PROJECT, 'Content/CatHouse/Fonts/IMFellEnglish-Regular.ttf'));
copyFileSync('godot/fonts/OFL.txt', join(PROJECT, 'Content/CatHouse/Fonts/OFL.txt'));
console.log('done');
