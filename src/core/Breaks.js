// Interstitial cadence: an ad break every 3 completed levels, taken at the
// next natural break — a tap that means "play again" (Next Level, Retry, Drive
// Again, picking a level). Never mid-run, never on the way out to a menu.
//
// NAMING, AND WHY IT IS NOT NEGOTIABLE: this file was once `AdManager.js` and
// ad blockers refused to load it. A blocked script kills the whole ES module
// graph, so main.js never ran and the player got a bare hillside with no menu —
// on a plain page with no ads on it at all. Nothing in a URL the browser
// requests may look like ad tech ('ad', 'ads', 'advert', 'banner', 'sponsor'):
// not this filename, not a folder, not a query string. Keep it boring.
//
// The counter only advances on a WIN: wrecking and retrying a hard level never
// marches the player toward an ad. A finished Infinite run counts too — it has
// no win state and would otherwise never contribute.
//
// The portals cap frequency themselves (CrazyGames spaces midgames ~3 minutes
// apart and answers `adCooldown` if you ask sooner; Poki decides per
// commercialBreak), so a break we offer may well pass without an ad. That's the
// normal case, not an error — gate() always hands control back to the game
// either way, and it's why offering one every 3 levels is safe: the portal, not
// this file, has the final say on how often a player actually sees one.

import { platform } from './Platform.js';
import { muteForAd, unmuteAfterAd } from '../ui/AudioBus.js';

const LEVELS_PER_BREAK = 3;

class BreakManager {
  constructor() {
    this.levelsWon = 0;
    this.blocking = false; // main.js freezes the game loop while a break is up
  }

  noteLevelWon() {
    this.levelsWon++;
  }

  // Wraps every path back into gameplay: takes the break first if one is due,
  // then starts the run. `fn` runs either way.
  async gate(fn) {
    if (this.blocking) return; // tapped again while the break was opening
    if (this.levelsWon >= LEVELS_PER_BREAK) {
      this.levelsWon = 0;
      await this._break();
    }
    fn();
  }

  async _break() {
    this.blocking = true;
    platform.gameplayStop(); // no SDK gameplay events may fire during a break
    muteForAd();
    try {
      await platform.showAd();
    } catch (e) {
      console.warn('Ad break failed:', e); // never block play on a broken ad
    } finally {
      unmuteAfterAd();
      this.blocking = false;
    }
  }
}

export const ads = new BreakManager();
