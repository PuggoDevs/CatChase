// Room-confined lighting.
//
// Classic point lights leak through walls (they have no shadows), which ruins
// a dark house. Instead, every static vertex carries the index of the room it
// belongs to, and each room owns SLOTS light slots stored in a tiny float
// texture. The patched standard material only evaluates the lights of its own
// room, so light never bleeds into the neighbouring room - and flicker, power
// cuts and switches are just texture updates, with no shader recompiles.
import * as THREE from 'three';

export const SLOTS = 4; // 3 fixture slots + 1 dynamic "spill" slot per room

export class RoomLightTable {
  constructor(slotCount) {
    this.rooms = slotCount;
    this.width = slotCount * SLOTS;
    this.data = new Float32Array(this.width * 2 * 4);
    this.texture = new THREE.DataTexture(this.data, this.width, 2, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uRoomLights: { value: this.texture },
      uRoomBounce: { value: 0.05 },
    };
  }

  set(roomSlot, i, x, y, z, range, r, g, b) {
    const idx = roomSlot * SLOTS + i;
    const p = idx * 4;
    const c = (this.width + idx) * 4;
    const d = this.data;
    d[p] = x; d[p + 1] = y; d[p + 2] = z; d[p + 3] = range;
    d[c] = r; d[c + 1] = g; d[c + 2] = b; d[c + 3] = r + g + b > 1e-4 ? 1 : 0;
  }

  clear(roomSlot, i) {
    const idx = roomSlot * SLOTS + i;
    const c = (this.width + idx) * 4;
    this.data[c] = this.data[c + 1] = this.data[c + 2] = this.data[c + 3] = 0;
  }

  commit() { this.texture.needsUpdate = true; }
}

const VERT_DECL = /* glsl */ `
#ifdef ROOM_DYNAMIC
uniform int uObjRoom;
#else
attribute float aRoom;
#endif
flat varying int vRoomIdx;
`;

const VERT_MAIN = /* glsl */ `
#ifdef ROOM_DYNAMIC
vRoomIdx = uObjRoom;
#else
vRoomIdx = int( aRoom + 0.5 );
#endif
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D uRoomLights;
uniform float uRoomBounce;
flat varying int vRoomIdx;
`;

const FRAG_LIGHTS = /* glsl */ `
#if defined( RE_Direct )
{
	for ( int ri = 0; ri < ${SLOTS}; ri ++ ) {
		int tx = vRoomIdx * ${SLOTS} + ri;
		vec4 rlc = texelFetch( uRoomLights, ivec2( tx, 1 ), 0 );
		if ( rlc.a < 0.5 ) continue;
		vec4 rlp = texelFetch( uRoomLights, ivec2( tx, 0 ), 0 );
		vec3 lposV = ( viewMatrix * vec4( rlp.xyz, 1.0 ) ).xyz;
		vec3 lvec = lposV - geometryPosition;
		float ldist = max( length( lvec ), 0.05 );
		directLight.direction = lvec / ldist;
		// clamp the falloff near the fixture so ceilings don't blow out
		directLight.color = rlc.rgb * getDistanceAttenuation( max( ldist, 0.9 ), rlp.w, 2.0 );
		directLight.visible = true;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		// cheap bounce light so the unlit sides of a lit room are not pitch black
		float bounceK = uRoomBounce * clamp( 1.0 - ldist / ( rlp.w * 1.4 ), 0.0, 1.0 );
		reflectedLight.indirectDiffuse += rlc.rgb * bounceK * BRDF_Lambert( material.diffuseColor );
	}
}
#endif
`;

/**
 * Patch a MeshStandardMaterial so it is lit by room light slots.
 * @param {THREE.Material} mat
 * @param {RoomLightTable} table
 * @param {boolean} dynamic - per-object room via uniform instead of attribute
 */
export function patchRoomLit(mat, table, dynamic = false) {
  mat.defines = mat.defines || {};
  if (dynamic) {
    mat.defines.ROOM_DYNAMIC = '';
    mat.userData.objRoom = mat.userData.objRoom || { value: 0 };
  }
  const objRoom = mat.userData.objRoom;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRoomLights = table.uniforms.uRoomLights;
    shader.uniforms.uRoomBounce = table.uniforms.uRoomBounce;
    if (dynamic) shader.uniforms.uObjRoom = objRoom;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n' + FRAG_LIGHTS);
  };
  mat.customProgramCacheKey = () => (dynamic ? 'roomlit-dyn' : 'roomlit');
  mat.needsUpdate = true;
  return mat;
}

/** Set which room's light slots a dynamic room-lit object uses. */
export function setObjectRoom(mat, lightSlot) {
  if (mat && mat.userData && mat.userData.objRoom) mat.userData.objRoom.value = lightSlot;
}
