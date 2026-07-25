// Portal seam — POKI build. Drops in for src/core/Platform.js (see
// tools/build-platforms.ps1); same shape, same exports, SDK-backed guts.
//
// The SDK is loaded as a classic script in index.html and exposes
// window.PokiSDK. Docs: https://sdk.poki.com/html5

export const localStore = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* blocked or full */ } },
  removeItem(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
};

const poki = () => window.PokiSDK;

class Platform {
  constructor() {
    this.name = 'poki';
    this.ready = false;
    this._inGameplay = false;
    // Poki has no host-side audio setting: the game keeps its own mute button.
    this.portalAudioControl = false;

    // Poki has no storage API by design: the SDK watches localStorage and
    // IndexedDB and syncs them to their cloud gamesave (1 MB gzipped cap — the
    // profile is a few KB). So the save path is just localStorage, wrapped
    // because Poki requires it survive incognito, where it throws outright.
    this.storage = localStore;
  }

  async init() {
    try {
      // Their docs are explicit: if init rejects, load the game anyway.
      await poki().init();
    } catch (e) {
      console.warn('[Hill Runner] Poki SDK init failed — playing on:', e);
    }
    this.ready = !!window.PokiSDK; // the SDK object still works after a failed init
    if (this.ready && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      this._call(p => p.setDebug(true)); // local QA: logs event order + serves test ads
    }
    // One line, on purpose: this is how you confirm from DevTools that the
    // portal SDK really came up and that ads will route through it.
    console.log(this.ready
      ? '[Hill Runner] Poki SDK initialized — ads via commercialBreak, saves via localStorage (Poki cloud-syncs it)'
      : '[Hill Runner] Poki SDK missing — local saves, no ads');
  }

  _call(fn) {
    if (!this.ready) return;
    try { fn(poki()); } catch (e) { console.warn('Poki event failed:', e); }
  }

  loadingStart() {}
  loadingStop() { this._call(p => p.gameLoadingFinished()); }

  // Poki flags duplicate/consecutive gameplay events in QA, and the game fires
  // these from many paths — collapse them here so no caller has to care.
  gameplayStart() {
    if (this._inGameplay) return;
    this._inGameplay = true;
    this._call(p => p.gameplayStart());
  }
  gameplayStop() {
    if (!this._inGameplay) return;
    this._inGameplay = false;
    this._call(p => p.gameplayStop());
  }

  happytime() { this._call(p => p.happyTime(1)); }

  // No host audio setting on Poki — the in-game toggle is the only one, so
  // there is nothing to subscribe to. Must still EXIST: main.js calls this on
  // every build, and a missing method here would throw during boot and leave
  // the player staring at a bare hillside.
  watchAudioSetting(_cb) {}

  // Poki owns the frequency logic: not every commercialBreak plays an ad, and
  // the promise resolves either way. AdManager has already muted and frozen
  // the game by the time we get here.
  async showAd() {
    if (!this.ready) return false;
    try {
      await poki().commercialBreak();
      return true;
    } catch (e) {
      console.warn('Poki commercial break failed:', e);
      return false;
    }
  }
}

export const platform = new Platform();
