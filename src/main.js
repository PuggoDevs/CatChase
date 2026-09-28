import { Game } from './game/game.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');

function fatal(e) {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:auto 0 0 0;color:#f66;background:#000c;padding:12px;font:12px monospace;white-space:pre-wrap;z-index:99';
  pre.textContent = 'Something went wrong while opening the house:\n' + (e && e.stack ? e.stack : e);
  document.body.appendChild(pre);
}

if (params.has('view')) {
  import('./debugView.js').then((m) => m.debugView(app, params)).catch(fatal);
} else {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    document.body.innerHTML = '<div style="color:#d8d0c0;font:18px Georgia,serif;padding:40px;max-width:600px">The Cat\'s House needs WebGL2. Please try a recent version of Chrome, Edge, Firefox or Safari.</div>';
  } else {
    new Game(app).boot().catch(fatal);
  }
}
