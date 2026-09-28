// Debug viewer: ?view=x,y,z,yawDeg,pitchDeg[&flash=1][&floor=f]
// Builds the world and renders from a fixed camera. Used for screenshots.
import * as THREE from 'three';
import { World } from './world/world.js';
import { EventBus } from './core/events.js';
import { PostFX } from './render/postfx.js';
import { createCatModel } from './cat/catModel.js';
import { CatAnimator } from './cat/catAnimator.js';
import { setObjectRoom } from './world/roomLighting.js';

export async function debugView(container, params) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x020304, Number(params.get('fog') || 0.045));
  const camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.05, 250);
  const hemi = new THREE.HemisphereLight(0x8a9ab8, 0x14100c, Number(params.get('amb') || 0.12));
  scene.add(hemi);
  const flash = new THREE.SpotLight(0xfff0dc, params.get('flash') === '1' ? Number(params.get('fi') || 90) : 0, 26, 0.44, 0.5, 2);
  flash.castShadow = params.get('shadow') !== '0';
  flash.shadow.mapSize.set(1024, 1024);
  flash.shadow.bias = -0.0004;
  flash.shadow.normalBias = 0.02;
  flash.shadow.camera.near = 0.1;
  scene.add(flash, flash.target);
  const events = new EventBus();
  const world = new World({ scene, renderer, events });
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;font:12px monospace;color:#aaa;z-index:5';
  document.body.appendChild(status);
  const t0 = performance.now();
  await world.build((p, label) => { status.textContent = `${Math.round(p * 100)}% ${label}`; });
  const buildMs = performance.now() - t0;
  const v = (params.get('view') || '21.5,4.8,9.8,-90,0').split(',').map(Number);
  camera.position.set(v[0], v[1], v[2]);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = THREE.MathUtils.degToRad(v[3]);
  camera.rotation.x = THREE.MathUtils.degToRad(v[4] || 0);
  const floor = world.grid.floorAt(v[0], v[1] - 1.6, v[2]);
  world.setActiveFloor(floor);
  if (params.get('lights') === 'all') for (const fx of world.lighting.fixtures) fx.on = true;
  let anim = null;
  if (params.has('cat')) {
    const [cx, cz, cf, cyaw] = params.get('cat').split(',').map(Number);
    const model = createCatModel(world.materials);
    const room = world.grid.roomAtWorld(cf, cx, cz);
    for (const m of model.allMaterials) setObjectRoom(m, room ? room.lightSlot : 0);
    model.root.position.set(cx, world.grid.groundY(cf, cx, cz), cz);
    model.root.rotation.y = THREE.MathUtils.degToRad(cyaw || 0);
    scene.add(model.root);
    anim = new CatAnimator(model);
    anim.twitchiness = 0;
    anim.setPose(params.get('pose') || 'stand', 0.01);
    anim.phase = Number(params.get('phase') || 0.25);
    window.__cat = { model, anim };
  }
  const post = new PostFX(renderer, scene, camera);
  post.setSize(container.clientWidth, container.clientHeight);
  let frames = 0;
  const clock = new THREE.Timer();
  const loop = () => {
    clock.update(); const dt = Math.min(0.05, clock.getDelta());
    world.update(dt, camera, floor);
    if (anim) anim.update(params.get('still') ? 0 : dt, Number(params.get('speed') || 0));
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    flash.position.copy(camera.position).add(new THREE.Vector3(0.2, -0.15, 0).applyQuaternion(camera.quaternion));
    flash.target.position.copy(camera.position).addScaledVector(dir, 5);
    post.render(dt);
    frames++;
    const info = renderer.info.render;
    status.textContent = `build ${buildMs.toFixed(0)}ms | frames ${frames} | calls ${info.calls} | tris ${info.triangles} | floor ${floor}`;
    window.__frames = frames;
    requestAnimationFrame(loop);
  };
  loop();
  window.__world = world;
  window.__ready = true;
}
