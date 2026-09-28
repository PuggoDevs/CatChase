// DOM user interface: menus, HUD, notes, journal, death and ending screens,
// touch controls.
import { DIFFICULTIES } from '../config.js';
import { ITEM_DEFS, ESCAPE_ROUTES } from '../game/items.js';

const ICONS = {
  flashlight: '🔦', battery: '🔋', plank: '🪵', fuse: '🧯', key_cellar: '🗝', key_study: '🗝', key_master: '🗝', key_attic: '🗝',
  key_front: '🔑', bolt_cutters: '✂', car_keys: '🔑', car_battery: '🔌', gas_can: '⛽', crowbar: '⚒', rope: '➰', wrench: '🔧',
  valve_wheel: '⚙', music_box: '🎁', music_key: '🦋', ribbon: '🎀',
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.layer = el('div', 'ui');
    root.appendChild(this.layer);
    this.toasts = [];
    this._build();
  }

  _build() {
    const L = this.layer;
    // ---- HUD
    this.hud = el('div', 'hud hidden');
    this.crosshair = el('div', 'crosshair');
    this.prompt = el('div', 'prompt');
    this.progress = el('div', 'progress hidden', '<div class="progress-label"></div><div class="progress-bar"><div></div></div>');
    this.stamina = el('div', 'meter stamina', '<div class="fill"></div>');
    this.breathEl = el('div', 'meter breath hidden', '<div class="label">HOLD BREATH [SPACE]</div><div class="fill"></div>');
    this.battery = el('div', 'battery hidden', '<span class="icon">🔦</span><div class="cells"><div class="fill"></div></div><span class="pct"></span>');
    this.invBar = el('div', 'invbar');
    this.held = el('div', 'held hidden');
    this.toastBox = el('div', 'toasts');
    this.subBox = el('div', 'subtitles');
    this.hint = el('div', 'hint hidden');
    this.wave = el('div', 'wave hidden');
    this.struggle = el('div', 'struggle hidden', '<div class="big">STRUGGLE!</div><div>Mash <b>SPACE</b> / <b>E</b></div><div class="bar"><div></div></div>');
    this.hud.append(this.crosshair, this.prompt, this.progress, this.stamina, this.breathEl, this.battery, this.invBar, this.held, this.hint, this.wave, this.struggle);
    L.append(this.hud, this.toastBox, this.subBox);
    // ---- screens
    this.screens = {};
    for (const name of ['loading', 'warning', 'menu', 'newgame', 'settings', 'controls', 'endings', 'pause', 'journal', 'note', 'death', 'ending', 'click']) {
      const s = el('div', 'screen hidden ' + name);
      this.screens[name] = s;
      L.appendChild(s);
    }
    this._buildLoading();
    this.fader = el('div', 'fader');
    L.appendChild(this.fader);
    this.debugEl = el('div', 'debug hidden');
    L.appendChild(this.debugEl);
  }

  // ================================================================ screens
  show(name, on = true) {
    const s = this.screens[name];
    if (!s) return;
    s.classList.toggle('hidden', !on);
  }

  hideAllScreens() {
    for (const s of Object.values(this.screens)) s.classList.add('hidden');
  }

  isOpen(name) { return this.screens[name] && !this.screens[name].classList.contains('hidden'); }

  anyMenuOpen() {
    return ['menu', 'newgame', 'settings', 'controls', 'endings', 'pause', 'journal', 'death', 'ending', 'warning', 'loading'].some((n) => this.isOpen(n));
  }

  fade(to, seconds = 1) {
    this.fader.style.transition = `opacity ${seconds}s ease`;
    this.fader.style.opacity = to;
  }

  _buildLoading() {
    const s = this.screens.loading;
    s.innerHTML = `
      <div class="title-block">
        <div class="title">THE CAT'S HOUSE</div>
        <div class="subtitle">it wants to play</div>
      </div>
      <div class="loadbar"><div class="fill"></div></div>
      <div class="loadtext">Opening the door...</div>`;
    this.show('loading');
  }

  setLoading(p, text) {
    const s = this.screens.loading;
    s.querySelector('.fill').style.width = `${Math.round(p * 100)}%`;
    if (text) s.querySelector('.loadtext').textContent = text;
  }

  showWarning(onContinue) {
    const s = this.screens.warning;
    s.innerHTML = `
      <div class="panel narrow">
        <h2>Before you go in</h2>
        <p>This is a horror game with <b>sudden loud jumpscares</b>, disturbing imagery and <b>flashing lights</b> (lightning, flickering bulbs, strobing static).</p>
        <p>You can reduce flashing and camera shake in <i>Settings</i>.</p>
        <p class="dim">Best with headphones, in the dark. The house listens to you, too.</p>
        <button class="btn primary" data-a="go">I understand</button>
      </div>`;
    s.querySelector('[data-a=go]').onclick = () => { this.show('warning', false); onContinue(); };
    this.show('loading', false);
    this.show('warning');
  }

  showMenu() {
    const g = this.game;
    const s = this.screens.menu;
    const endings = g.progress.endings || {};
    const count = Object.keys(endings).length;
    const best = g.progress.bestEndless ? `Best endless: ${g.progress.bestEndless.nights} night(s), ${fmtTime(g.progress.bestEndless.time)}` : '';
    s.innerHTML = `
      <div class="menu-inner">
        <div class="title-block">
          <div class="title">THE CAT'S HOUSE</div>
          <div class="subtitle">survive the night</div>
        </div>
        <div class="menu-buttons">
          <button class="btn primary" data-a="story">New Night</button>
          <button class="btn" data-a="endless">Endless Survival</button>
          <button class="btn" data-a="settings">Settings</button>
          <button class="btn" data-a="controls">Controls</button>
          <button class="btn" data-a="endings">Endings <span class="dim">(${count}/5)</span></button>
        </div>
        <div class="menu-foot dim">${best}</div>
      </div>`;
    s.querySelector('[data-a=story]').onclick = () => this.showNewGame('story');
    s.querySelector('[data-a=endless]').onclick = () => this.showNewGame('endless');
    s.querySelector('[data-a=settings]').onclick = () => this.showSettings('menu');
    s.querySelector('[data-a=controls]').onclick = () => this.showControls('menu');
    s.querySelector('[data-a=endings]').onclick = () => this.showEndings();
    this.hideAllScreens();
    this.show('menu');
    this.setHUD(false);
  }

  showNewGame(mode) {
    const g = this.game;
    const s = this.screens.newgame;
    const last = g.progress.lastDifficulty || 'normal';
    const diffs = Object.entries(DIFFICULTIES).map(([k, d]) => `
      <label class="diff ${k === last ? 'sel' : ''}" data-d="${k}">
        <input type="radio" name="diff" value="${k}" ${k === last ? 'checked' : ''}/>
        <div class="dname">${d.label}</div><div class="dblurb">${d.blurb}</div>
      </label>`).join('');
    s.innerHTML = `
      <div class="panel">
        <h2>${mode === 'endless' ? 'Endless Survival' : 'A New Night'}</h2>
        <p class="dim">${mode === 'endless' ? 'There is no way out. Survive wave after wave as the hunt grows worse.' : 'Find a way out of the house. Every night the house rearranges its secrets.'}</p>
        <div class="diffs">${diffs}</div>
        <div class="row"><label class="dim">Seed <input class="seed" placeholder="random" maxlength="12"/></label></div>
        <div class="row buttons">
          <button class="btn" data-a="back">Back</button>
          <button class="btn primary" data-a="start">Enter the house</button>
        </div>
      </div>`;
    for (const lab of s.querySelectorAll('.diff')) {
      lab.onclick = () => {
        s.querySelectorAll('.diff').forEach((x) => x.classList.remove('sel'));
        lab.classList.add('sel');
        lab.querySelector('input').checked = true;
      };
    }
    s.querySelector('[data-a=back]').onclick = () => this.showMenu();
    s.querySelector('[data-a=start]').onclick = () => {
      const diff = s.querySelector('input[name=diff]:checked').value;
      const seedText = s.querySelector('.seed').value.trim();
      this.hideAllScreens();
      g.startRun({ mode, difficulty: diff, seed: seedText || null });
    };
    this.hideAllScreens();
    this.show('newgame');
  }

  showSettings(back) {
    const g = this.game;
    const st = g.settings;
    const s = this.screens.settings;
    s.innerHTML = `
      <div class="panel">
        <h2>Settings</h2>
        <div class="settings">
          <label>Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" data-k="sensitivity" value="${st.sensitivity}"/></label>
          <label>Field of view <input type="range" min="60" max="95" step="1" data-k="fov" value="${st.fov}"/></label>
          <label>Master volume <input type="range" min="0" max="1" step="0.01" data-k="volume" value="${st.volume}"/></label>
          <label>Music volume <input type="range" min="0" max="1" step="0.01" data-k="musicVolume" value="${st.musicVolume}"/></label>
          <label>Brightness <input type="range" min="0.6" max="2" step="0.05" data-k="brightness" value="${st.brightness}"/></label>
          <label>Quality <select data-k="quality">${['low', 'medium', 'high'].map((q) => `<option ${q === st.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" data-k="invertY" ${st.invertY ? 'checked' : ''}/> Invert mouse Y</label>
          <label class="check"><input type="checkbox" data-k="crouchToggle" ${st.crouchToggle ? 'checked' : ''}/> Toggle crouch (off = hold)</label>
          <label class="check"><input type="checkbox" data-k="reduceFlashes" ${st.reduceFlashes ? 'checked' : ''}/> Reduce flashing lights</label>
          <label class="check"><input type="checkbox" data-k="reduceShake" ${st.reduceShake ? 'checked' : ''}/> Reduce camera shake</label>
          <label class="check"><input type="checkbox" data-k="subtitles" ${st.subtitles ? 'checked' : ''}/> Sound captions</label>
        </div>
        <div class="row buttons"><button class="btn primary" data-a="back">Done</button></div>
      </div>`;
    for (const input of s.querySelectorAll('[data-k]')) {
      input.oninput = input.onchange = () => {
        const k = input.dataset.k;
        let v = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value);
        g.applySetting(k, v);
      };
    }
    s.querySelector('[data-a=back]').onclick = () => {
      this.show('settings', false);
      if (back === 'pause') this.show('pause'); else this.showMenu();
    };
    this.hideAllScreens();
    this.show('settings');
  }

  showControls(back) {
    const s = this.screens.controls;
    const rows = [
      ['WASD / Arrows', 'Move (arrow keys ← → also turn)'], ['Mouse', 'Look'], ['Shift', 'Sprint (drains stamina)'],
      ['C / Ctrl', 'Crouch'], ['Z / X', 'Crawl (fit under tables, stay quiet)'], ['E', 'Interact / open / hide / exit hiding'],
      ['Hold E', 'Open or close a door quietly'], ['R', 'Slam a door shut (loud!)'], ['L', 'Lock / bolt a door'],
      ['B', 'Barricade a closed door (needs a plank)'], ['F', 'Flashlight'], ['LMB / G', 'Throw what you are holding'],
      ['Space', 'Hold breath while hiding'], ['Tab / I', 'Journal & inventory'], ['Esc / P', 'Pause'],
    ];
    s.innerHTML = `
      <div class="panel">
        <h2>Controls</h2>
        <table class="controls-table">${rows.map(([k, v]) => `<tr><td class="key">${k}</td><td>${v}</td></tr>`).join('')}</table>
        <p class="dim">Noise carries. Light gives you away. It learns your habits - don't hide in the same place twice.</p>
        <div class="row buttons"><button class="btn primary" data-a="back">Back</button></div>
      </div>`;
    s.querySelector('[data-a=back]').onclick = () => {
      this.show('controls', false);
      if (back === 'pause') this.show('pause'); else this.showMenu();
    };
    this.hideAllScreens();
    this.show('controls');
  }

  showEndings() {
    const g = this.game;
    const s = this.screens.endings;
    const list = [
      ['front', 'Out the Front Door'], ['car', 'Headlights'], ['attic', 'Over the Roof'], ['tunnel', 'Through the Dark Water'], ['secret', 'Game Over, Ellie Wins'],
    ];
    const got = g.progress.endings || {};
    s.innerHTML = `
      <div class="panel">
        <h2>Endings</h2>
        <ul class="endings">${list.map(([k, n]) => `<li class="${got[k] ? 'got' : ''}">${got[k] ? n : '???'} <span class="dim">${got[k] ? '- ' + got[k] + '×' : ''}</span></li>`).join('')}</ul>
        <p class="dim">Deaths: ${g.progress.deaths || 0}</p>
        <div class="row buttons"><button class="btn primary" data-a="back">Back</button></div>
      </div>`;
    s.querySelector('[data-a=back]').onclick = () => this.showMenu();
    this.hideAllScreens();
    this.show('endings');
  }

  showPause() {
    const g = this.game;
    const s = this.screens.pause;
    const run = g.run;
    s.innerHTML = `
      <div class="panel narrow">
        <h2>Paused</h2>
        <p class="dim">${run ? `${DIFFICULTIES[run.difficulty].label} · seed ${esc(run.seedText)} · ${fmtTime(run.time)}` : ''}</p>
        <div class="menu-buttons">
          <button class="btn primary" data-a="resume">Resume</button>
          <button class="btn" data-a="settings">Settings</button>
          <button class="btn" data-a="controls">Controls</button>
          <button class="btn" data-a="quit">Quit to menu</button>
        </div>
      </div>`;
    s.querySelector('[data-a=resume]').onclick = () => g.resume();
    s.querySelector('[data-a=settings]').onclick = () => this.showSettings('pause');
    s.querySelector('[data-a=controls]').onclick = () => this.showControls('pause');
    s.querySelector('[data-a=quit]').onclick = () => g.quitToMenu();
    this.show('pause');
  }

  showClickToPlay(on, failed = false) {
    const s = this.screens.click;
    s.innerHTML = `<div class="clickmsg">${failed ? 'Mouse capture is unavailable here: <b>click and drag</b> to look around.<br/>Click to continue.' : 'Click to continue'}</div>`;
    this.show('click', on);
  }

  // ================================================================ journal
  showJournal() {
    const g = this.game;
    const p = g.player;
    const s = this.screens.journal;
    const inv = [...p.inventory.entries()].map(([id, n]) => {
      const d = ITEM_DEFS[id];
      return `<div class="item"><span class="ico">${ICONS[id] || '•'}</span><div><div class="iname">${esc(d.name)}${n > 1 ? ` ×${n}` : ''}</div><div class="idesc">${esc(d.desc)}</div></div></div>`;
    }).join('') || '<p class="dim">Nothing yet.</p>';
    const routes = g.objectives.routeStatus().map((r) => `
      <div class="route ${r.known ? '' : 'unknown'}">
        <div class="rname">${esc(r.known ? r.name : '???')}</div>
        <div class="rneeds">${r.known ? r.needs.map((n) => `<span class="need ${n.have ? 'have' : ''}">${esc(n.label)}</span>`).join('') : '<span class="dim">Read more of the house to learn of this way out.</span>'}</div>
      </div>`).join('');
    const docs = g.story.readDocs().map((d, i) => `<li data-i="${i}">${esc(d.title)}</li>`).join('') || '<li class="dim">No notes found.</li>';
    s.innerHTML = `
      <div class="panel wide journal-panel">
        <div class="cols">
          <div class="col">
            <h3>Ways out</h3>${routes}
            <h3>Carrying</h3><div class="inv">${inv}</div>
          </div>
          <div class="col">
            <h3>Notes</h3><ul class="docs">${docs}</ul>
            <p class="dim small">${esc(g.run.mode === 'endless' ? 'Endless: there is no way out. Survive.' : 'Tab to close')}</p>
          </div>
        </div>
      </div>`;
    for (const li of s.querySelectorAll('.docs li[data-i]')) {
      li.onclick = () => g.story.read(g.story.readDocs()[Number(li.dataset.i)], null, true);
    }
    this.show('journal');
  }

  hideJournal() { this.show('journal', false); }

  showNote(doc) {
    const s = this.screens.note;
    s.innerHTML = `
      <div class="paper ${doc.style || ''}">
        <div class="paper-title">${esc(doc.title)}</div>
        <div class="paper-body">${doc.html || esc(doc.text).replace(/\n/g, '<br/>')}</div>
        <div class="paper-foot dim">[E] / [Esc] close</div>
      </div>`;
    s.onclick = () => this.game.story.closeNote();
    this.show('note');
  }

  hideNote() { this.show('note', false); }

  // ================================================================ end screens
  showDeath(info) {
    const g = this.game;
    const s = this.screens.death;
    s.innerHTML = `
      <div class="panel narrow death-panel">
        <div class="death-title">YOU WERE CAUGHT</div>
        <p class="death-line">${esc(info.line)}</p>
        ${statsHTML(info.stats)}
        <div class="menu-buttons">
          <button class="btn primary" data-a="retry">Try again</button>
          <button class="btn" data-a="menu">Main menu</button>
        </div>
      </div>`;
    s.querySelector('[data-a=retry]').onclick = () => { this.hideAllScreens(); g.retry(); };
    s.querySelector('[data-a=menu]').onclick = () => g.quitToMenu();
    this.hideAllScreens();
    this.show('death');
    this.setHUD(false);
  }

  showEnding(info) {
    const g = this.game;
    const s = this.screens.ending;
    s.innerHTML = `
      <div class="panel narrow ending-panel ${info.secret ? 'secret' : ''}">
        <div class="ending-kicker">${esc(info.kicker || 'ENDING')}</div>
        <div class="ending-title">${esc(info.title)}</div>
        <div class="ending-text">${info.text.split('\n').map((p) => `<p>${esc(p)}</p>`).join('')}</div>
        ${statsHTML(info.stats)}
        ${info.unlocked ? `<p class="unlock">New ending unlocked.</p>` : ''}
        <div class="menu-buttons">
          <button class="btn primary" data-a="again">Play again</button>
          <button class="btn" data-a="menu">Main menu</button>
        </div>
      </div>`;
    s.querySelector('[data-a=again]').onclick = () => { this.hideAllScreens(); g.retry(); };
    s.querySelector('[data-a=menu]').onclick = () => g.quitToMenu();
    this.hideAllScreens();
    this.show('ending');
    this.setHUD(false);
  }

  // ================================================================ HUD
  setHUD(on) { this.hud.classList.toggle('hidden', !on); }

  setPrompt(list, title) {
    const key = list ? JSON.stringify(list) + (title || '') : '';
    if (key === this._promptKey) return;
    this._promptKey = key;
    if (!list || !list.length) { this.prompt.innerHTML = ''; return; }
    this.prompt.innerHTML = (title ? `<div class="ptitle">${esc(title)}</div>` : '') + list.map((p) => `<span class="pk">${p.key ? `<b>${esc(p.key)}</b> ` : ''}${esc(p.label)}</span>`).join('');
  }

  setCrosshair(state) {
    if (state === this._cross) return;
    this._cross = state;
    this.crosshair.className = 'crosshair ' + state;
  }

  setProgress(label, v = 0) {
    if (!label) { this.progress.classList.add('hidden'); return; }
    this.progress.classList.remove('hidden');
    this.progress.querySelector('.progress-label').textContent = label;
    this.progress.querySelector('.progress-bar div').style.width = `${Math.round(v * 100)}%`;
  }

  toast(text, important = false) {
    const t = el('div', 'toast' + (important ? ' important' : ''), esc(text));
    this.toastBox.appendChild(t);
    while (this.toastBox.children.length > 4) this.toastBox.firstChild.remove();
    setTimeout(() => t.classList.add('out'), important ? 4200 : 2800);
    setTimeout(() => t.remove(), important ? 5000 : 3600);
  }

  subtitle(text) {
    if (this._lastSub === text && performance.now() - this._lastSubT < 1500) return;
    this._lastSub = text;
    this._lastSubT = performance.now();
    const t = el('div', 'sub', esc(text));
    this.subBox.appendChild(t);
    while (this.subBox.children.length > 2) this.subBox.firstChild.remove();
    setTimeout(() => t.remove(), 2600);
  }

  setHint(text) {
    if (!text) { this.hint.classList.add('hidden'); return; }
    this.hint.textContent = text;
    this.hint.classList.remove('hidden');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hint.classList.add('hidden'), 9000);
  }

  setWave(text) {
    if (!text) { this.wave.classList.add('hidden'); return; }
    this.wave.classList.remove('hidden');
    this.wave.innerHTML = text;
  }

  setStruggle(v) {
    if (v === null) { this.struggle.classList.add('hidden'); return; }
    this.struggle.classList.remove('hidden');
    this.struggle.querySelector('.bar div').style.width = `${Math.round(v * 100)}%`;
  }

  updateHUD(p) {
    // stamina (fades when full)
    const st = p.stamina / 100;
    this.stamina.querySelector('.fill').style.width = `${st * 100}%`;
    this.stamina.classList.toggle('faded', st > 0.98);
    this.stamina.classList.toggle('exhausted', p.exhausted);
    // breath while hiding
    const hid = !!p.hiding;
    this.breathEl.classList.toggle('hidden', !hid);
    if (hid) this.breathEl.querySelector('.fill').style.width = `${(p.breath / 7) * 100}%`;
    // battery
    this.battery.classList.toggle('hidden', !p.flash.has);
    if (p.flash.has) {
      const b = Math.max(0, p.flash.battery);
      this.battery.querySelector('.fill').style.width = `${b}%`;
      this.battery.querySelector('.pct').textContent = `${Math.round(b)}%${p.inventory.get('battery') ? ` +${p.inventory.get('battery')}` : ''}`;
      this.battery.classList.toggle('low', b < 20);
      this.battery.classList.toggle('off', !p.flash.on);
    }
    // inventory quick bar
    const key = [...p.inventory.entries()].map(([k, v]) => k + v).join(',');
    if (key !== this._invKey) {
      this._invKey = key;
      this.invBar.innerHTML = [...p.inventory.entries()].filter(([id]) => id !== 'battery').map(([id, n]) => `<div class="slot" title="${esc(ITEM_DEFS[id].name)}"><span>${ICONS[id] || '•'}</span>${n > 1 ? `<i>${n}</i>` : ''}</div>`).join('');
    }
    const h = p.held ? p.held.def.name : '';
    if (h !== this._heldKey) {
      this._heldKey = h;
      this.held.classList.toggle('hidden', !h);
      this.held.innerHTML = h ? `Holding: ${esc(h)} <b>[LMB/G]</b> throw` : '';
    }
  }

  setDebug(text) {
    if (text === null) { this.debugEl.classList.add('hidden'); return; }
    this.debugEl.classList.remove('hidden');
    this.debugEl.textContent = text;
  }

  // ================================================================ touch
  enableTouch(input) {
    if (this.touch) return;
    const t = el('div', 'touch');
    t.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="lookpad"></div>
      <div class="tbtns">
        <button data-a="interact">USE</button><button data-a="sprint" class="toggle">RUN</button>
        <button data-a="crouch">DUCK</button><button data-a="flashlight">LIGHT</button>
        <button data-a="primary">THROW</button><button data-a="breath">HOLD<br/>BREATH</button>
        <button data-a="slam">SLAM</button><button data-a="inventory">BAG</button><button data-a="pause">❚❚</button>
      </div>`;
    this.hud.appendChild(t);
    this.touch = t;
    const stick = t.querySelector('.stick'), knob = t.querySelector('.knob');
    let stickId = null, sx = 0, sy = 0;
    stick.addEventListener('touchstart', (e) => { const tt = e.changedTouches[0]; stickId = tt.identifier; sx = tt.clientX; sy = tt.clientY; e.preventDefault(); }, { passive: false });
    const moveStick = (e) => {
      for (const tt of e.changedTouches) {
        if (tt.identifier !== stickId) continue;
        const dx = Math.max(-50, Math.min(50, tt.clientX - sx)), dy = Math.max(-50, Math.min(50, tt.clientY - sy));
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        input.virtualMove.x = dx / 50;
        input.virtualMove.y = -dy / 50;
      }
      e.preventDefault();
    };
    const endStick = (e) => {
      for (const tt of e.changedTouches) if (tt.identifier === stickId) { stickId = null; knob.style.transform = ''; input.virtualMove.x = input.virtualMove.y = 0; }
    };
    stick.addEventListener('touchmove', moveStick, { passive: false });
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);
    const pad = t.querySelector('.lookpad');
    let lookId = null, lx = 0, ly = 0;
    pad.addEventListener('touchstart', (e) => { const tt = e.changedTouches[0]; lookId = tt.identifier; lx = tt.clientX; ly = tt.clientY; e.preventDefault(); }, { passive: false });
    pad.addEventListener('touchmove', (e) => {
      for (const tt of e.changedTouches) {
        if (tt.identifier !== lookId) continue;
        input.addLook((tt.clientX - lx) * 2.2, (tt.clientY - ly) * 2.2);
        lx = tt.clientX; ly = tt.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    pad.addEventListener('touchend', () => { lookId = null; });
    for (const b of t.querySelectorAll('button')) {
      const a = b.dataset.a;
      if (b.classList.contains('toggle')) {
        b.addEventListener('touchstart', (e) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); input.setVirtual(a, on); e.preventDefault(); }, { passive: false });
      } else {
        b.addEventListener('touchstart', (e) => { input.setVirtual(a, true); e.preventDefault(); }, { passive: false });
        b.addEventListener('touchend', (e) => { input.setVirtual(a, false); e.preventDefault(); }, { passive: false });
      }
    }
  }
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function statsHTML(st) {
  if (!st) return '';
  return `<div class="stats">
    <div><span>Survived</span><b>${fmtTime(st.time)}</b></div>
    <div><span>Chased</span><b>${st.chases}×</b></div>
    <div><span>Hid</span><b>${st.hides}×</b></div>
    <div><span>Rooms explored</span><b>${st.rooms}</b></div>
    <div><span>Difficulty</span><b>${esc(st.difficulty)}</b></div>
    <div><span>Seed</span><b>${esc(st.seed)}</b></div>
  </div>`;
}

export { ESCAPE_ROUTES };
