// First-run coaching, played INSIDE the level rather than in front of it.
//
// CrazyGames' quality guidelines want a new player driving immediately, taught
// visually, with as little text as possible, and able to skip. So this is not a
// modal and it never takes the wheel: the car is live from the first frame and
// this strip sits at the foot of the screen commenting on what the player does.
//
// The one idea it is built on: the hint is a LIVE MIRROR of the controls, not a
// diagram of them. The two halves depress and light up exactly as the player
// presses, in the same toy-block way every button in this game presses. A
// diagram has to be believed; a mirror is verified the instant you touch a key,
// which is why the whole thing needs two words of copy instead of a sentence.
//
// It retires itself the moment it has been understood — 0.8s of cumulative
// throttle IS the proof of understanding — so a returning player who knows the
// game never reads it, and nobody has to dismiss it to get on with playing.
//
// Two constraints, both learned the hard way elsewhere in this UI:
//   - the card is pointer-events:none (the very first tap has to reach the
//     throttle); only the "Got it" button opts back in.
//   - every stage change runs off a TIMER, never `animationend`. Under
//     prefers-reduced-motion the global reset kills animations outright, and a
//     card waiting on an event that never fires would sit there for the run.

import { input, coarsePointer } from '../core/InputManager.js';

const GAS_TO_LEARN = 0.8;   // seconds of throttle that count as "got it"
const CONTROLS_MAX = 14;    // seconds before the strip gives up and retires
const GOAL_DELAY = 1.4;     // pause between the two beats
const GOAL_LIFE = 3.0;      // seconds the goal chip stays up

let active = null;

// `onDone` fires once the whole sequence has finished (or been dismissed), so
// the caller can record that this player has been coached.
export function showCoach(onDone) {
  hideCoach();
  active = new Coach(onDone);
  return active;
}

export function hideCoach() {
  if (active) active.destroy();
  active = null;
}

// Pause/results own the screen while they're up; the strip steps aside rather
// than being torn down, so resuming mid-lesson picks up where it left off.
export function setCoachVisible(visible) {
  if (active) active.setVisible(visible);
}

class Coach {
  constructor(onDone) {
    this.onDone = onDone;
    this.touch = coarsePointer();
    this.gasHeld = 0;
    this.elapsed = 0;
    this.stage = 'controls';
    this.last = performance.now();
    this.timers = [];
    this._build();
    // A timer rather than requestAnimationFrame: all this loop does is toggle
    // two classes, and under the headless harness (--dump-dom) rAF never fires
    // while timers still advance — so rAF would put the whole coach beyond the
    // reach of test-onboarding.html. Background tabs are already covered by
    // main.js pausing the run, which stands this strip down with it.
    this.timer = setInterval(() => this._tick(performance.now()), 16);
  }

  _build() {
    const el = document.createElement('div');
    el.className = `coach${this.touch ? ' touch' : ''}`;
    el.id = 'coach';
    // Arrow keys on a keyboard, pedal triangles on glass — the glyph names the
    // thing the player is actually looking for on their own device.
    const back = this.touch ? '◀' : '←';
    const go = this.touch ? '▶' : '→';
    el.innerHTML = `
      <span class="coach-eyebrow">Hold to drive</span>
      <div class="coach-keys">
        <div class="coach-key brake"><span class="ck-glyph">${back}</span><span class="ck-label">Back</span></div>
        <div class="coach-key gas"><span class="ck-glyph">${go}</span><span class="ck-label">Go</span></div>
      </div>
      <button class="coach-done" type="button">Got it</button>`;
    document.body.appendChild(el);
    this.el = el;
    this.brakeEl = el.querySelector('.coach-key.brake');
    this.gasEl = el.querySelector('.coach-key.gas');
    // Pressing "Got it" is the player saying "leave me alone", so it ends the
    // whole sequence — the goal chip never follows it.
    el.querySelector('.coach-done').addEventListener('click', (e) => {
      e.stopPropagation();
      this._finish();
    });
  }

  setVisible(visible) {
    if (this.el) this.el.classList.toggle('hidden', !visible);
    // Time spent under a pause overlay is not time spent learning.
    if (visible) this.last = performance.now();
  }

  _tick(now) {
    if (!this.el) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.el.classList.contains('hidden')) return;

    if (this.stage === 'controls') {
      const { gas, brake } = input.getState();
      this.gasEl.classList.toggle('on', !!gas);
      this.brakeEl.classList.toggle('on', !!brake);
      if (gas) this.gasHeld += dt;
      this.elapsed += dt;
      if (this.gasHeld >= GAS_TO_LEARN) this._toGoal();
      else if (this.elapsed >= CONTROLS_MAX) this._finish();
    }
  }

  // Beat two reuses the same slot at the foot of the screen: one strip that
  // teaches one thing at a time reads as a single voice, where a second card
  // somewhere else would read as a second interruption.
  _toGoal() {
    this.stage = 'goal';
    this.el.classList.add('out');
    this._after(GOAL_DELAY, () => {
      if (!this.el) return;
      this.el.innerHTML = `
        <span class="coach-eyebrow">Your goal</span>
        <div class="coach-goal"><span class="cg-flag">\u{1F3C1}</span><span class="cg-text">Reach the flag</span></div>`;
      this.el.classList.remove('out');
      this._after(GOAL_LIFE, () => this._finish());
    });
  }

  _after(seconds, fn) {
    this.timers.push(setTimeout(fn, seconds * 1000));
  }

  _finish() {
    if (!this.el || this.stage === 'done') return;
    this.stage = 'done'; // stops _tick re-entering this every frame
    this.el.classList.add('out');
    this._after(0.42, () => this.destroy());
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  destroy() {
    clearInterval(this.timer);
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.el?.remove();
    this.el = null;
    if (active === this) active = null;
  }
}
