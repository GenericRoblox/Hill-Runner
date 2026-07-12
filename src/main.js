// Bootstrap: wire screens, input, resize, daily bonus, and the RAF loop.

import { screens, showToast } from './core/ScreenManager.js';
import { input } from './core/InputManager.js';
import { saveData } from './core/SaveData.js';
import { loadTextures } from './ui/Textures.js';
import { loadSprite } from './ui/Sprites.js';
import { VEHICLES } from './data/vehicles.js';
import { DAILY_BONUS } from './data/economy.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { WorldSelectScreen } from './screens/WorldSelectScreen.js';
import { LevelSelectScreen } from './screens/LevelSelectScreen.js';
import { GarageScreen } from './screens/GarageScreen.js';
import { UpgradeScreen } from './screens/UpgradeScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { EditorScreen } from './screens/EditorScreen.js';
import { CustomLevelsScreen } from './screens/CustomLevelsScreen.js';
import { InfiniteSelectScreen } from './screens/InfiniteSelectScreen.js';
import { InfiniteGameScreen } from './screens/InfiniteGameScreen.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const menuRoot = document.getElementById('menu-root');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

loadTextures();
for (const v of Object.values(VEHICLES)) loadSprite(v.body.sprite);
document.fonts?.load('20px Beachday'); // warm up the display face for canvas HUD text

input.init(canvas);
screens.init(menuRoot, canvas);
screens.register('home', new HomeScreen(menuRoot));
screens.register('worldselect', new WorldSelectScreen(menuRoot));
screens.register('levelselect', new LevelSelectScreen(menuRoot));
screens.register('garage', new GarageScreen(menuRoot));
screens.register('upgrade', new UpgradeScreen(menuRoot));
screens.register('game', new GameScreen(canvas));
screens.register('editor', new EditorScreen(canvas));
screens.register('customlevels', new CustomLevelsScreen(menuRoot));
screens.register('infinite', new InfiniteSelectScreen(menuRoot));
screens.register('infinitegame', new InfiniteGameScreen(canvas));

// Dev deep-link: ?screen=<name> or ?world=4&level=2 jumps straight there;
// add &bot=1 to hold the gas down (for screenshotting mid-level).
const q = new URLSearchParams(location.search);
// &coins=N force-sets the wallet (dev testing: economy/upgrade-hint flows).
if (q.has('coins')) { saveData.data.coins = +q.get('coins'); saveData.save(); }
if (q.has('inf')) {
  // Dev deep-link into an infinite run: ?inf=<themeId>&bot=1&warp=N.
  screens.show('infinitegame', { themeId: +q.get('inf'), vehId: q.get('veh') || undefined });
  if (q.has('bot')) input.getState = () => ({ gas: true, brake: false });
  const warp = +(q.get('warp') || 0);
  for (let i = 0; i < warp * 12; i++) screens.update(100);
} else if (q.has('world')) {
  // &veh=sports overrides the active vehicle (dev sprite/tuning preview).
  screens.show('game', {
    worldId: +q.get('world'),
    levelIndex: +(q.get('level') || 0),
    vehId: q.get('veh') || undefined,
  });
  if (q.has('bot')) input.getState = () => ({ gas: true, brake: false });
  // &warp=N fast-forwards ~N seconds of sim synchronously.
  const warp = +(q.get('warp') || 0);
  for (let i = 0; i < warp * 12; i++) screens.update(100);
} else {
  // &id=<customLevelId> targets a specific created level (editor deep-link);
  // &cam=<x> sets the editor's starting scroll.
  screens.show(q.get('screen') || 'home', {
    id: q.get('id') || undefined,
    cam: q.get('cam') || undefined,
  });
}

const bonus = saveData.claimDailyBonus(DAILY_BONUS);
if (bonus > 0) {
  setTimeout(() => showToast(`🎁 Daily bonus: +${bonus} coins!`), 600);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 100); // clamp tab-switch spikes
  last = now;
  // A throw here would kill the rAF loop and freeze the game for good —
  // players report that as a crash. Log it and keep the loop alive.
  try {
    screens.update(dt);
    if (screens.current?.usesCanvas) {
      screens.render(ctx);
    }
  } catch (e) {
    console.error('frame error:', e);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
