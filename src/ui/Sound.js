// Minimal WebAudio engine hum: pitch scales with speed (spec §8), plus one-shot
// stingers for landings, crashes and level completion. No audio assets needed.

import { isSilenced } from './AudioBus.js';

class Sound {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
  }

  // Must be called from a user gesture at least once (autoplay policy).
  ensureContext() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch { return false; }
      // A context born while the game is muted starts 'running' — park it.
      if (isSilenced()) this.ctx.suspend()?.catch?.(() => {});
    }
    // iOS Safari also has an 'interrupted' state (phone call, lock screen,
    // Control Center); treat anything not running as resumable, and swallow
    // the rejection resume() throws when called outside a user gesture.
    // While silenced (mute toggle, ad break, hidden tab) leave it suspended —
    // AudioBus resumes it when the silence lifts.
    if (this.ctx.state !== 'running' && !isSilenced()) this.ctx.resume()?.catch?.(() => {});
    return true;
  }

  startEngine() {
    if (!this.ensureContext() || this.engineOsc) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 50;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineGain).connect(this.ctx.destination);
    this.engineOsc.start();
  }

  updateEngine(speed, throttle) {
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    const freq = 45 + speed * 5 + (throttle ? 25 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
    this.engineGain.gain.setTargetAtTime(throttle ? 0.035 : 0.015, t, 0.1);
  }

  stopEngine() {
    if (!this.engineOsc) return;
    try { this.engineOsc.stop(); } catch { /* already stopped */ }
    this.engineOsc = null;
    this.engineGain = null;
  }

  _blip(freq, duration, type = 'square', volume = 0.06, slideTo = null) {
    // A suspended context's currentTime is frozen, so a blip scheduled while
    // muted doesn't vanish — it QUEUES, and every stinger fired during the
    // mute plays in a burst the moment the player unmutes. Silenced = dropped.
    if (isSilenced()) return;
    if (!this.ensureContext()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  thud() { this._blip(90, 0.15, 'triangle', 0.1, 40); }        // hard landing
  crash() { this._blip(120, 0.5, 'sawtooth', 0.12, 30); }      // fail
  win() {
    this._blip(523, 0.12, 'square', 0.05);
    setTimeout(() => this._blip(659, 0.12, 'square', 0.05), 120);
    setTimeout(() => this._blip(784, 0.25, 'square', 0.06), 240);
  }
  coin() { this._blip(988, 0.09, 'square', 0.04, 1319); }
}

export const sound = new Sound();
