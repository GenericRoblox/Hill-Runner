// localStorage-backed player profile: coins, vehicles, upgrades, level stars.
// (Spec §7 asks for cloud sync — out of scope for a local build; the shape here
// is a single serializable object so a sync layer can be added on top later.)

import { VEHICLES, UPGRADE_STATS } from '../data/vehicles.js';
import { getWorld } from '../data/levels.js';

const KEY = 'hillrunner_save_v1';

function defaultVehicleState(owned) {
  return {
    owned,
    upgrades: { engine: 0, suspension: 0, tires: 0, brakes: 0 },
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
    upgradeHintShown: false, // one-time "upgrade your car" prompt
  };
}

class SaveData {
  constructor() {
    this.data = defaultSave();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge over defaults so new vehicles/fields added later don't break old saves.
        this.data = { ...defaultSave(), ...parsed };
        for (const id of Object.keys(VEHICLES)) {
          if (!this.data.vehicles[id]) {
            this.data.vehicles[id] = defaultVehicleState(VEHICLES[id].price === 0);
          }
        }
      }
    } catch (e) {
      console.warn('Save load failed, starting fresh:', e);
      this.data = defaultSave();
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
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
  setUpgradeTier(id, stat, tier) {
    if (!UPGRADE_STATS.includes(stat)) return;
    this.data.vehicles[id].upgrades[stat] = tier;
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
