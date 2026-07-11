// Single internal Gas/Brake input state mapped from keyboard + touch (spec §4, §7).
// Keyboard: D/→ = gas, A/← = brake/reverse; W/S alt pair; Esc/P = pause; R = restart.
// Touch: right pedal zone = gas, left = brake; multi-touch supported (rocking).

class InputManager {
  constructor() {
    this.gas = false;
    this.brake = false;
    this._keys = new Set();
    this._touches = new Map(); // touchId -> 'gas' | 'brake'
    this.touchActive = false;  // true once any touch happens (show pedals)
    this.onPause = null;
    this.onRestart = null;
    this._canvas = null;
  }

  init(canvas) {
    this._canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') { this.onPause?.(); return; }
      if (k === 'r') { this.onRestart?.(); return; }
      this._keys.add(k);
      this._recomputeKeys();
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.key.toLowerCase());
      this._recomputeKeys();
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._touches.clear();
      this._recompute();
    });

    canvas.addEventListener('touchstart', (e) => this._touch(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this._touch(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this._touchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this._touchEnd(e), { passive: false });
  }

  _recomputeKeys() {
    const K = this._keys;
    this._kbGas = K.has('d') || K.has('arrowright') || K.has('w');
    this._kbBrake = K.has('a') || K.has('arrowleft') || K.has('s');
    this._recompute();
  }

  _recompute() {
    let tGas = false, tBrake = false;
    for (const zone of this._touches.values()) {
      if (zone === 'gas') tGas = true;
      else if (zone === 'brake') tBrake = true;
    }
    this.gas = !!this._kbGas || tGas;
    this.brake = !!this._kbBrake || tBrake;
  }

  _zoneFor(touch) {
    const w = window.innerWidth, h = window.innerHeight;
    const x = touch.clientX, y = touch.clientY;
    // Pause button hotspot: top-right corner.
    if (x > w - 70 && y < 70) return 'pause';
    return x >= w / 2 ? 'gas' : 'brake';
  }

  _touch(e) {
    e.preventDefault();
    this.touchActive = true;
    for (const t of e.changedTouches) {
      const zone = this._zoneFor(t);
      if (zone === 'pause') {
        if (e.type === 'touchstart') this.onPause?.();
        continue;
      }
      this._touches.set(t.identifier, zone);
    }
    this._recompute();
  }

  _touchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) this._touches.delete(t.identifier);
    this._recompute();
  }

  getState() {
    return { gas: this.gas, brake: this.brake };
  }

  reset() {
    this._keys.clear();
    this._touches.clear();
    this._kbGas = this._kbBrake = false;
    this._recompute();
  }
}

export const input = new InputManager();
