// Player profile: coins, vehicles, upgrades, level stars.
//
// Reads and writes go through `platform.storage`, which is plain localStorage
// on the web and Poki builds and the account-synced data module on CrazyGames.
// The whole profile is one serializable object under one key, which is what
// lets a portal back it with cloud storage without touching this file.

import { VEHICLES, UPGRADE_STATS } from '../data/vehicles.js';
import { getWorld, WORLDS } from '../data/levels.js';
import { platform } from './Platform.js';

const KEY = 'hillrunner_save_v1';

function defaultVehicleState(owned) {
  return {
    owned,
    // `upgrades` is the EQUIPPED tier per stat (what physics runs with);
    // `ownedUpgrades` is the highest tier bought. Buying is sequential, but
    // any bought tier can be re-equipped from the upgrade screen.
    upgrades: { engine: 0, suspension: 0, tires: 0, brakes: 0 },
    ownedUpgrades: { engine: 0, suspension: 0, tires: 0, brakes: 0 },
  };
}

function defaultSave() {
  const vehicles = {};
  for (const id of Object.keys(VEHICLES)) {
    vehicles[id] = defaultVehicleState(VEHICLES[id].price === 0);
  }
  return {
    coins: 0,
    activeVehicle: 'pickup',
    vehicles,
    stars: {},          // { "worldId-levelIndex": bestStars }
    bestTimes: {},      // { "worldId-levelIndex": seconds }
    lastLoginDay: null, // for daily bonus
    muted: false,       // master mute (sound + music), toggled from home/pause
    upgradeHintShown: false, // one-time "upgrade your car" prompt
    // One-time "new mode" reveal cutscenes (Worlds menu). Sticky once the
    // player has watched the unlock play out, so it never replays.
    infiniteSeen: false, // Infinite mode reveal shown
    creatorSeen: false,  // Created Levels reveal shown
    infinite: {
      unlocked: {},     // { themeId: true } — Farm (1) is always unlocked
      best: {},         // { themeId: best distance in meters }
    },
  };
}

class SaveData {
  constructor() {
    this.data = defaultSave();
    this.load();
  }

  // Called once at import (so the test harnesses, which never boot a platform,
  // still get a profile) and again from main.js once platform.init() has
  // resolved — by then storage may point at a portal's cloud save.
  load() {
    try {
      const raw = platform.storage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge over defaults so new vehicles/fields added later don't break old saves.
        this.data = { ...defaultSave(), ...parsed };
        for (const id of Object.keys(VEHICLES)) {
          if (!this.data.vehicles[id]) {
            this.data.vehicles[id] = defaultVehicleState(VEHICLES[id].price === 0);
          }
        }
        // Nested objects merge wholesale — backfill sub-keys for older saves.
        this.data.infinite = { unlocked: {}, best: {}, ...(this.data.infinite || {}) };
        // Older saves had no owned/equipped split: everything bought was equipped.
        for (const vs of Object.values(this.data.vehicles)) {
          if (!vs.ownedUpgrades) vs.ownedUpgrades = { ...vs.upgrades };
        }
      }
    } catch (e) {
      console.warn('Save load failed, starting fresh:', e);
      this.data = defaultSave();
    }
  }

  save() {
    try {
      platform.storage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  // --- Coins ---
  getCoins() { return this.data.coins; }
  addCoins(n) { this.data.coins += n; this.save(); }
  spendCoins(n) {
    if (this.data.coins < n) return false;
    this.data.coins -= n;
    this.save();
    return true;
  }

  // --- Vehicles / upgrades ---
  getVehicleState(id) { return this.data.vehicles[id]; }
  getActiveVehicle() { return this.data.activeVehicle; }
  setActiveVehicle(id) {
    if (this.data.vehicles[id]?.owned) {
      this.data.activeVehicle = id;
      this.save();
    }
  }
  unlockVehicle(id) {
    this.data.vehicles[id].owned = true;
    this.save();
  }
  // Equip a tier the player already owns.
  setUpgradeTier(id, stat, tier) {
    if (!UPGRADE_STATS.includes(stat)) return;
    const vs = this.data.vehicles[id];
    if (tier > vs.ownedUpgrades[stat]) return;
    vs.upgrades[stat] = tier;
    this.save();
  }
  // Record a purchase (caller pays) and equip the new tier.
  ownUpgradeTier(id, stat, tier) {
    if (!UPGRADE_STATS.includes(stat)) return;
    const vs = this.data.vehicles[id];
    vs.ownedUpgrades[stat] = Math.max(vs.ownedUpgrades[stat], tier);
    vs.upgrades[stat] = tier;
    this.save();
  }

  // --- Level progress ---
  getLevelStars(key) { return this.data.stars[key] || 0; }
  recordResult(key, stars, timeSeconds) {
    if (stars > (this.data.stars[key] || 0)) this.data.stars[key] = stars;
    const best = this.data.bestTimes[key];
    if (best == null || timeSeconds < best) this.data.bestTimes[key] = timeSeconds;
    this.save();
  }
  getBestTime(key) { return this.data.bestTimes[key]; }

  // Each level unlocks when the previous has ≥1 star. A world's first level
  // unlocks when the previous world's final level has ≥1 star (spec §5.2:
  // the farm "graduation" level gates World 2).
  isLevelUnlocked(worldId, levelIndex) {
    if (levelIndex === 0) return this.isWorldUnlocked(worldId);
    return this.getLevelStars(`${worldId}-${levelIndex - 1}`) >= 1;
  }

  isWorldUnlocked(worldId) {
    if (worldId === 1) return true;
    const prev = getWorld(worldId - 1);
    if (!prev || !prev.playable || prev.levels.length === 0) return false;
    return this.getLevelStars(`${prev.id}-${prev.levels.length - 1}`) >= 1;
  }

  // True when EVERY level of every playable world has at least `min` stars.
  everyLevelHasStars(min) {
    for (const w of WORLDS) {
      if (!w.playable || w.levels.length === 0) continue;
      for (let i = 0; i < w.levels.length; i++) {
        if (this.getLevelStars(`${w.id}-${i}`) < min) return false;
      }
    }
    return true;
  }

  // Infinite mode is the first endgame reward: it unlocks once all worlds are
  // completed (every level starred — which beating the final level guarantees).
  isInfiniteModeUnlocked() { return this.everyLevelHasStars(1); }

  // The level creator is the deeper reward: three stars on EVERY level.
  isCreatorUnlocked() { return this.everyLevelHasStars(3); }

  // --- One-time reveal cutscenes (Worlds menu) ---
  isInfiniteSeen() { return !!this.data.infiniteSeen; }
  markInfiniteSeen() { this.data.infiniteSeen = true; this.save(); }
  isCreatorSeen() { return !!this.data.creatorSeen; }
  markCreatorSeen() { this.data.creatorSeen = true; this.save(); }

  // --- Infinite mode: coin-gated theme unlocks + best distance per theme ---
  isInfiniteUnlocked(themeId) {
    return themeId === 1 || !!this.data.infinite.unlocked[themeId];
  }

  unlockInfinite(themeId, cost) {
    if (!this.spendCoins(cost)) return false;
    this.data.infinite.unlocked[themeId] = true;
    this.save();
    return true;
  }

  getInfiniteBest(themeId) {
    return this.data.infinite.best[themeId] || 0;
  }

  recordInfiniteBest(themeId, meters) {
    if (meters > this.getInfiniteBest(themeId)) {
      this.data.infinite.best[themeId] = Math.round(meters);
      this.save();
    }
  }

  // --- Master mute (AudioBus reads this at boot; setUserMuted writes it) ---
  isMuted() { return !!this.data.muted; }
  setMuted(m) { this.data.muted = !!m; this.save(); }

  // --- One-time upgrade hint (shown when coins first cover an engine upgrade) ---
  isUpgradeHintShown() { return !!this.data.upgradeHintShown; }
  markUpgradeHintShown() { this.data.upgradeHintShown = true; this.save(); }

  // --- Daily login bonus (spec §5.4) — returns bonus amount if newly granted.
  claimDailyBonus(amount) {
    const today = new Date().toDateString();
    if (this.data.lastLoginDay === today) return 0;
    this.data.lastLoginDay = today;
    this.data.coins += amount;
    this.save();
    return amount;
  }
}

export const saveData = new SaveData();
