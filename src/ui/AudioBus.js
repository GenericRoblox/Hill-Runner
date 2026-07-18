// Central audio gate. Three things demand silence, and any one of them wins:
// an ad break (both portals require the game silent while an ad plays), a
// hidden tab (portal QA rejects games that keep sounding in the background —
// rAF stops but a looping music element and the engine oscillator would play
// on), and the player's own mute toggle (persisted in the save profile).
//
// Sound and Music own separate AudioContexts, each created lazily on first
// play (so either may still be null). Suspending the contexts mutes everything
// at once — engine hum, stingers, music, and any in-flight fade automation —
// without reaching into either module, and resume() picks up where it left
// off. Sound/Music consult isSilenced() before creating or auto-resuming a
// context, so audio poked while silenced stays quiet.

import { sound } from './Sound.js';
import { music } from './Music.js';
import { saveData } from '../core/SaveData.js';

const silencers = {
  ad: false,
  hidden: typeof document !== 'undefined' && document.hidden,
  user: saveData.isMuted(),
};

export function isSilenced() {
  return silencers.ad || silencers.hidden || silencers.user;
}

export function isUserMuted() {
  return silencers.user;
}

function forEachContext(fn) {
  for (const ctx of [sound.ctx, music.ctx]) {
    if (!ctx) continue;
    try { fn(ctx)?.catch?.(() => {}); } catch { /* context already closed */ }
  }
}

function apply() {
  const silent = isSilenced();
  // resume() outside a user gesture may reject on iOS — swallowed above; the
  // next gesture-driven ensureContext() resumes for real.
  forEachContext(ctx => (silent ? ctx.suspend() : ctx.resume()));
}

export function muteForAd() { silencers.ad = true; apply(); }
export function unmuteAfterAd() { silencers.ad = false; apply(); }

export function setUserMuted(m) {
  silencers.user = !!m;
  saveData.setMuted(!!m);
  apply();
  // The toggle lives in two places (home screen, pause overlay) — let any
  // listener resync its label without the two knowing about each other.
  window.dispatchEvent(new CustomEvent('hr-mute-changed'));
}

document.addEventListener('visibilitychange', () => {
  silencers.hidden = document.hidden;
  apply();
});
