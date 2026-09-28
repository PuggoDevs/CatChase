// Action-based input: keyboard, mouse (pointer lock with a drag-to-look
// fallback for sandboxed frames), and a virtual layer for touch controls.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  turnLeft: ['ArrowLeft'],
  turnRight: ['ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  prone: ['KeyZ', 'KeyX'],
  interact: ['KeyE', 'Enter'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  flashlight: ['KeyF'],
  throw: ['KeyG'],
  slam: ['KeyR'],
  lock: ['KeyL'],
  barricade: ['KeyB'],
  inventory: ['Tab', 'KeyI'],
  journal: ['KeyJ'],
  breath: ['Space'],
  pause: ['Escape', 'KeyP'],
  debug: ['F3'],
  map: ['KeyM'],
};

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.downSince = new Map();
    this.look = { x: 0, y: 0 };
    this.virtualMove = { x: 0, y: 0 };
    this.virtualDown = new Set();
    this.pointerLocked = false;
    this.dragLook = false;       // fallback when pointer lock is unavailable
    this.dragging = false;
    this.enabled = true;
    this.lockFailed = false;
    this.onLockChange = null;
    this.lastKeyTime = 0;
    this._bind();
  }

  _codeDown(code) {
    if (!this.down.has(code)) {
      this.down.add(code);
      this.pressedSet.add(code);
      this.downSince.set(code, performance.now());
    }
  }

  _codeUp(code) {
    if (this.down.has(code)) {
      this.down.delete(code);
      this.releasedSet.add(code);
    }
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F3') e.preventDefault();
      this.lastKeyTime = performance.now();
      this._codeDown(e.code);
    };
    this._onKeyUp = (e) => this._codeUp(e.code);
    this._onMouseDown = (e) => {
      this._codeDown('Mouse' + e.button);
      if (this.dragLook && e.button === 0) this.dragging = true;
    };
    this._onMouseUp = (e) => {
      this._codeUp('Mouse' + e.button);
      if (e.button === 0) this.dragging = false;
    };
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked || (this.dragLook && this.dragging)) {
        // ignore absurd spikes some browsers produce on lock
        const mx = Math.max(-250, Math.min(250, e.movementX || 0));
        const my = Math.max(-250, Math.min(250, e.movementY || 0));
        this.look.x += mx;
        this.look.y += my;
      }
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => {
      for (const c of [...this.down]) this._codeUp(c);
    };
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    };
    this._onLockError = () => {
      this.lockFailed = true;
      this.dragLook = true;
      if (this.onLockChange) this.onLockChange(false, true);
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('contextmenu', this._onContext);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
  }

  requestLock() {
    if (this.pointerLocked || this.dragLook) return;
    try {
      const p = this.dom.requestPointerLock && this.dom.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => this._onLockError());
    } catch (e) {
      this._onLockError();
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _codes(action) { return BINDINGS[action] || [action]; }

  isDown(action) {
    if (this.virtualDown.has(action)) return true;
    return this._codes(action).some((c) => this.down.has(c));
  }

  pressed(action) {
    if (this.virtualPressed && this.virtualPressed.has(action)) return true;
    return this._codes(action).some((c) => this.pressedSet.has(c));
  }

  released(action) {
    if (this.virtualReleased && this.virtualReleased.has(action)) return true;
    return this._codes(action).some((c) => this.releasedSet.has(c));
  }

  /** seconds the action has been held (0 if up) */
  heldTime(action) {
    if (this.virtualDown.has(action)) return (performance.now() - (this.virtualSince?.get(action) || performance.now())) / 1000;
    let best = 0;
    for (const c of this._codes(action)) {
      if (this.down.has(c)) best = Math.max(best, (performance.now() - this.downSince.get(c)) / 1000);
    }
    return best;
  }

  moveVector() {
    let x = 0, y = 0;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    x += this.virtualMove.x;
    y += this.virtualMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0; this.look.y = 0;
    return l;
  }

  // ---- virtual (touch) layer
  setVirtual(action, isDown) {
    this.virtualPressed = this.virtualPressed || new Set();
    this.virtualReleased = this.virtualReleased || new Set();
    this.virtualSince = this.virtualSince || new Map();
    if (isDown && !this.virtualDown.has(action)) {
      this.virtualDown.add(action);
      this.virtualPressed.add(action);
      this.virtualSince.set(action, performance.now());
    } else if (!isDown && this.virtualDown.has(action)) {
      this.virtualDown.delete(action);
      this.virtualReleased.add(action);
    }
  }

  tapVirtual(action) {
    this.setVirtual(action, true);
    setTimeout(() => this.setVirtual(action, false), 60);
  }

  addLook(dx, dy) { this.look.x += dx; this.look.y += dy; }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    if (this.virtualPressed) this.virtualPressed.clear();
    if (this.virtualReleased) this.virtualReleased.clear();
  }

  clearAll() {
    this.down.clear();
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.virtualDown.clear();
    this.look.x = this.look.y = 0;
  }
}
