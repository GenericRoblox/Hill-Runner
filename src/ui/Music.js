// Looping level background music (music/*.mp3): fades in on level start,
// loops, fades out on level end/quit. Routed through its own AudioContext +
// GainNode so fades are sample-accurate automation, not frame-timed —
// they keep running smoothly across screen transitions regardless of the
// game loop. GameScreen owns the only calls to playNext()/stop(), so music
// never plays outside a level (menus stay silent).

const TRACKS = ['music/beat-1.mp3', 'music/beat-2.mp3', 'music/beat-3.mp3'];
const FADE_S = 1.6;
const VOLUME = 0.32;

class Music {
  constructor() {
    this.ctx = null;
    this.current = null; // { audio, gain }
    this.lastIndex = -1;
  }

  // Must be called from a user gesture at least once (autoplay policy) —
  // level entry always originates from a click, same as Sound.ensureContext.
  _ensureContext() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch { return false; }
    }
    if (this.ctx.state !== 'running') this.ctx.resume()?.catch?.(() => {});
    return true;
  }

  // Fades in a track different from whatever just played (if any), looping
  // until stop() or the next playNext() call.
  playNext() {
    if (!this._ensureContext()) return;
    let idx = Math.floor(Math.random() * TRACKS.length);
    if (TRACKS.length > 1) {
      while (idx === this.lastIndex) idx = Math.floor(Math.random() * TRACKS.length);
    }
    this.lastIndex = idx;

    const prev = this.current;
    this.current = null;
    if (prev) this._fadeOutAndStop(prev);

    const audio = new Audio(TRACKS[idx]);
    audio.loop = true;
    const source = this.ctx.createMediaElementSource(audio);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.ctx.destination);
    audio.play().catch(() => {}); // swallow autoplay-policy rejections

    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(VOLUME, t + FADE_S);

    this.current = { audio, gain };
  }

  // Fades the current track to silence and stops it — used when leaving a
  // level for a menu, where music must not play.
  stop() {
    if (!this.current) return;
    this._fadeOutAndStop(this.current);
    this.current = null;
  }

  _fadeOutAndStop({ audio, gain }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    setTimeout(() => { audio.pause(); audio.src = ''; }, FADE_S * 1000 + 80);
  }
}

export const music = new Music();
