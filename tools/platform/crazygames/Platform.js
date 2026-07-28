// Portal seam — CRAZYGAMES build. Drops in for src/core/Platform.js (see
// tools/build-platforms.ps1); same shape, same exports, SDK-backed guts.
//
// SDK v3 is loaded as a classic script in index.html and exposes
// window.CrazyGames.SDK. Docs: https://docs.crazygames.com/sdk/intro/
//
// Modules used here:
//   SDK.game  — loadingStart/Stop, gameplayStart/Stop, happytime, settings +
//               addSettingsChangeListener  (docs.crazygames.com/sdk/game)
//   SDK.ad    — requestAd('midgame', { adStarted, adFinished, adError })
//               (docs.crazygames.com/sdk/video-ads)
//   SDK.data  — account-synced getItem/setItem/removeItem
//               (docs.crazygames.com/sdk/data)

const KEY = 'hillrunner_save_v1'; // must match SaveData's key

export const localStore = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* blocked or full */ } },
  removeItem(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
};

const sdk = () => window.CrazyGames?.SDK;

class Platform {
  constructor() {
    this.name = 'crazygames';
    this.ready = false;
    this._inGameplay = false;
    this._loading = false;
    // CrazyGames' own audio setting outranks any in-game toggle (their docs
    // say so outright), so this build hides the game's mute control and lets
    // the site's switch be the only one.
    this.portalAudioControl = true;

    // The profile lives in CrazyGames' data module: a synchronous,
    // localStorage-shaped API that syncs to the player's account across
    // devices. It's only usable after init(), and SaveData reads once at
    // import — so until the SDK is up (or if it never comes up at all, e.g.
    // the game is opened outside the portal) fall through to localStorage.
    this.storage = {
      getItem: (key) => (this.ready ? sdk().data.getItem(key) : localStore.getItem(key)),
      setItem: (key, value) => (this.ready ? sdk().data.setItem(key, value) : localStore.setItem(key, value)),
      removeItem: (key) => (this.ready ? sdk().data.removeItem(key) : localStore.removeItem(key)),
    };
  }

  async init() {
    try {
      if (!sdk()) throw new Error('SDK script did not load');
      await sdk().init(); // the SDK is unusable until this resolves
      this.ready = true;
      this._migrateLocalSave();
      if (this._loading) this._game(g => g.loadingStart()); // boot called it pre-init
      // One line, on purpose: this is how you confirm from DevTools that the
      // portal SDK really came up and that saves are going to their servers.
      console.log('[Hill Runner] CrazyGames SDK initialized — saves via SDK.data, ads via SDK.ad');
    } catch (e) {
      console.warn('[Hill Runner] CrazyGames SDK unavailable — falling back to local saves:', e);
    }
  }

  // A player who played this game anywhere else on this browser keeps their
  // progress the first time they open the CrazyGames build.
  _migrateLocalSave() {
    try {
      if (sdk().data.getItem(KEY)) return; // portal save wins
      const local = localStore.getItem(KEY);
      if (local) sdk().data.setItem(KEY, local);
    } catch (e) {
      console.warn('Save migration skipped:', e);
    }
  }

  _game(fn) {
    if (!this.ready) return;
    try { fn(sdk().game); } catch (e) { console.warn('CrazyGames event failed:', e); }
  }

  loadingStart() { this._loading = true; this._game(g => g.loadingStart()); }
  loadingStop() { this._loading = false; this._game(g => g.loadingStop()); }

  // Collapsed so the portal never sees a duplicate or out-of-order event, no
  // matter which of the game's many start/stop paths fired.
  gameplayStart() {
    if (this._inGameplay) return;
    this._inGameplay = true;
    this._game(g => g.gameplayStart());
  }
  gameplayStop() {
    if (!this._inGameplay) return;
    this._inGameplay = false;
    this._game(g => g.gameplayStop());
  }

  happytime() { this._game(g => g.happytime()); }

  // The site's mute switch. `settings.muteAudio` gives the current state and
  // addSettingsChangeListener keeps it live. Guarded per call: an SDK that
  // failed to come up must not take the audio system down with it.
  watchAudioSetting(cb) {
    if (!this.ready) return;
    const read = () => {
      try { return !!sdk().game.settings?.muteAudio; } catch { return false; }
    };
    cb(read());
    try {
      sdk().game.addSettingsChangeListener((s) => cb(!!s?.muteAudio));
    } catch (e) {
      console.warn('CrazyGames settings listener unavailable:', e);
    }
  }

  // Resolves when the break is over — true only if an ad really played. Errors
  // resolve false rather than reject: Breaks has the game frozen and muted, so
  // anything that doesn't resolve strands the player behind a black screen.
  //
  // Breaks.js mutes and pauses BEFORE calling this and restores once it
  // settles, which satisfies the docs' "mute the audio and pause the game when
  // the ad starts / restore when it finishes or fails" rule more completely
  // than acting on adStarted would — muting only then would leak engine hum
  // for the length of the request.
  //
  // The watchdog is in TWO stages, and that matters. A single flat timeout
  // fires while a long ad is still on screen, which unmutes and unfreezes the
  // game underneath it — exactly what the docs forbid. So: a short guard while
  // we're waiting on a request that should answer quickly, swapped for a long
  // one the moment adStarted tells us an ad is genuinely playing.
  async showAd() {
    if (!this.ready) return false;
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => finish(false), ms); };
      const finish = (played) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(played);
      };
      arm(15000); // no answer at all from the request
      try {
        sdk().ad.requestAd('midgame', {
          adStarted: () => arm(180000), // an ad is on screen: wait it out
          adFinished: () => finish(true),
          adError: (err) => {
            // `unfilled`, `adblock`, `adCooldown` and `adsDisabledBasicLaunch`
            // are the ordinary outcomes of asking, not faults — the portal caps
            // midgames at roughly one per three minutes and declines between.
            const code = err?.code || 'other';
            const routine = code === 'unfilled' || code === 'adblock'
              || code === 'adCooldown' || code === 'adsDisabledBasicLaunch';
            if (routine) console.info(`[Hill Runner] no ad this break (${code}) — playing on`);
            else console.warn('CrazyGames ad error:', err);
            finish(false);
          },
        });
      } catch (e) {
        console.warn('CrazyGames ad request failed:', e);
        finish(false);
      }
    });
  }
}

export const platform = new Platform();
