// Portal seam: save storage, ad breaks, and gameplay/loading telemetry.
//
// This is the plain-web build — every hook is a no-op and saves go straight to
// localStorage, so the game behaves exactly as it always has. The CrazyGames
// and Poki builds swap this ONE file (see tools/platform/<name>/Platform.js)
// for an SDK-backed version; nothing else in the game knows a portal exists.

// localStorage throws outright in some incognito/embedded contexts (Poki's
// requirements call this out) — a save must never be able to take down a run.
export const localStore = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* blocked or full */ } },
  removeItem(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
};

class Platform {
  constructor() {
    this.name = 'web';
    this.ready = false;
    this.storage = localStore;
    this._inGameplay = false;
  }

  // Awaited once at boot, before the first save read. Must never reject: a
  // portal SDK that fails to load leaves a playable, locally-saved game.
  async init() {
    this.ready = true;
  }

  loadingStart() {}
  loadingStop() {}

  // Portals reject duplicate/consecutive gameplay events, and the game fires
  // these from many paths (enter, restart, pause, resume, win, fail, quit).
  // Collapsing them here means no caller has to track which state it's in.
  gameplayStart() {
    if (this._inGameplay) return;
    this._inGameplay = true;
    this._gameplayStart();
  }
  gameplayStop() {
    if (!this._inGameplay) return;
    this._inGameplay = false;
    this._gameplayStop();
  }
  _gameplayStart() {}
  _gameplayStop() {}

  happytime() {}

  // Resolves when the ad break is over, true if an ad actually played. Never
  // rejects — an adblocked or unfilled break must fall straight through into
  // gameplay rather than soft-lock the player behind a spinner.
  async showAd() {
    return false;
  }
}

export const platform = new Platform();
