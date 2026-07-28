// Single internal Gas/Brake input state mapped from keyboard + touch (spec §4, §7).
// Keyboard: D/→ = gas, A/← = brake/reverse; W/S alt pair; P = pause; R = restart.
// Touch: right pedal zone = gas, left = brake; multi-touch supported (rocking).
//
// Bindings key off `event.code` (physical key position), NOT `event.key`, so the
// WASD block works unchanged on an AZERTY keyboard, where those same physical
// keys type ZQSD. CrazyGames asks that bindings adapt to the player's layout
// rather than asking the player to adapt to the game; `code` is what does that.
// The arrow keys are layout-independent either way and stay the primary hint.
//
// ESCAPE IS DELIBERATELY NOT A PAUSE KEY. On the web Escape leaves fullscreen,
// so binding it here means one press does two things and the player loses the
// fullscreen they chose. Pause is P, plus the on-screen button — see the
// CrazyGames "restricted keys" guidance.

// Layout-independent name for a key press. `code` is the physical key, so the
// same token comes back whatever the player's layout types there. Synthetic
// events (test pages) often carry only `key`, so fall back to normalising that
// into the same shape: 'd' -> 'keyd', 'ArrowRight' -> 'arrowright'.
function keyToken(e) {
  if (e.code) return e.code.toLowerCase();
  const k = (e.key || '').toLowerCase();
  return /^[a-z]$/.test(k) ? `key${k}` : k;
}

// True when the device's primary pointer is a finger. Guarded because the test
// harnesses boot this file in environments without matchMedia.
export function coarsePointer() {
  try {
    return !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  } catch (e) {
    return false;
  }
}

class InputManager {
  constructor() {
    this.gas = false;
    this.brake = false;
    this._keys = new Set();
    this._touches = new Map(); // touchId -> 'gas' | 'brake'
    // Pedals are drawn whenever touch is the likely input. Waiting for the
    // FIRST touch to reveal them (the old rule) meant a new phone player was
    // handed a car and no visible controls — they had to guess that the screen
    // halves were pedals. A coarse primary pointer says "this is a touch
    // device" up front; a real touch still flips it on for anything that
    // reports otherwise (hybrid laptops, some tablets in desktop mode).
    this.touchActive = coarsePointer();
    this.onPause = null;
    this.onRestart = null;
    this._canvas = null;
  }

  init(canvas) {
    this._canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = keyToken(e);
      if (k === 'keyp') { this.onPause?.(); return; }
      if (k === 'keyr') { this.onRestart?.(); return; }
      this._keys.add(k);
      this._recomputeKeys();
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(keyToken(e));
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
    this._kbGas = K.has('keyd') || K.has('arrowright') || K.has('keyw') || K.has('arrowup');
    this._kbBrake = K.has('keya') || K.has('arrowleft') || K.has('keys') || K.has('arrowdown');
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
