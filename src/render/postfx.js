// Post-processing: bloom (glowing eyes, bulbs) + a horror pass applied in
// display space: film grain, vignette, chromatic aberration, wobble, TV
// static, heartbeat-driven fear pulse, red flash and fade to black.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.07 },
    uVignette: { value: 1.0 },
    uAberration: { value: 0.0 },
    uDistort: { value: 0.0 },
    uStatic: { value: 0.0 },
    uFear: { value: 0.0 },
    uRed: { value: 0.0 },
    uBlack: { value: 0.0 },
    uDesat: { value: 0.25 },
    uFlash: { value: 0.0 },
    uAspect: { value: 1.0 },
    uSlit: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration, uDistort, uStatic, uFear, uRed, uBlack, uDesat, uFlash, uAspect, uSlit;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // wobble / distortion
      if (uDistort > 0.0) {
        uv.x += sin(uv.y * 24.0 + uTime * 9.0) * 0.004 * uDistort;
        uv.y += sin(uv.x * 17.0 - uTime * 7.0) * 0.003 * uDistort;
        float band = step(0.985, hash(vec2(floor(uv.y * 60.0), floor(uTime * 20.0))));
        uv.x += band * 0.03 * uDistort;
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      vec2 off = c * (uAberration + 0.0015) * (1.0 + r2 * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // desaturate + cold grade
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col *= vec3(0.96, 1.0, 1.05);
      // fear: vignette tightens and pulses
      float vig = smoothstep(0.95 + uFear * 0.15, 0.18 - uFear * 0.08, sqrt(r2) * (1.0 + uFear * 0.35));
      col *= mix(1.0, vig, uVignette);
      col = mix(col, col * vec3(1.25, 0.55, 0.5), uFear * 0.25 * (1.0 - vig));
      // static
      float n = hash(uv * vec2(640.0, 480.0) + fract(uTime * 13.7));
      col = mix(col, vec3(n), uStatic * 0.6);
      col += (n - 0.5) * uGrain;
      // scanline shimmer when static is up
      col *= 1.0 - uStatic * 0.15 * sin(uv.y * 800.0 + uTime * 60.0);
      // red flash, white flash, black fade
      col = mix(col, vec3(0.45, 0.0, 0.0), uRed * 0.6);
      col += vec3(uFlash);
      // hiding slit (looking through a cabinet door gap)
      if (uSlit > 0.0) {
        float s = smoothstep(0.09, 0.05, abs(uv.x - 0.5)) ;
        col *= mix(1.0, s, uSlit);
      }
      col *= 1.0 - uBlack;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    const size = renderer.getSize(new THREE.Vector2());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.35, 0.82);
    this.bloom.enabled = quality !== 'low';
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
    this.u = this.horror.uniforms;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.u.uAspect.value = w / h;
  }

  setQuality(q) { this.bloom.enabled = q !== 'low'; }

  render(dt) {
    this.u.uTime.value += dt;
    this.composer.render(dt);
  }
}
