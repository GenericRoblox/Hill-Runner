// Bootstrap: wire screens, input, resize, daily bonus, and the RAF loop.

import { screens, showToast } from './core/ScreenManager.js';
import { input } from './core/InputManager.js';
import { saveData } from './core/SaveData.js';
import { platform } from './core/Platform.js';
import { ads } from './core/Breaks.js';
import { setUserMuted, isUserMuted, setPortalMuted } from './ui/AudioBus.js';
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

async function boot() {
  platform.loadingStart();

  loadTextures();
  for (const v of Object.values(VEHICLES)) {
    loadSprite(v.body.sprite);
    loadSprite(v.body.wheelSprite);
  }
  document.fonts?.load('20px Beachday'); // warm up the display face for canvas HUD text
  document.fonts?.load('14px Fredoka');  // ...and the rounded body face (HUD labels, popups)

  // Master mute on the shared pause overlay. Wired ONCE here (not in
  // GameScreen, whose two instances would each register a handler on the
  // shared DOM); the label resyncs off AudioBus's event so the home-screen
  // toggle and this button never disagree. Null-guarded: the test pages boot
  // main.js against their own minimal pause-overlay DOM without this button.
  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    const syncMuteBtn = () => { muteBtn.textContent = isUserMuted() ? '🔇 Sound: Off' : '🔊 Sound: On'; };
    muteBtn.addEventListener('click', () => setUserMuted(!isUserMuted()));
    window.addEventListener('hr-mute-changed', syncMuteBtn);
    syncMuteBtn();
  }

  // Hidden tab: AudioBus already silences the audio; a run in progress also
  // pauses (portal QA — and a player returning mid-flight would just wreck).
  document.addEventListener('visibilitychange', () => {
    const s = screens.current;
    if (document.hidden && s?.state === 'playing' && s.togglePause) s.togglePause();
  });

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

  // The portal SDK (a no-op on the plain web build) has to be up before the
  // first profile read: on CrazyGames the save lives in their account-synced
  // data module, not localStorage. SaveData already loaded once at import —
  // this second load is the one that sees the portal's copy.
  await platform.init();
  saveData.load();

  // Host-site audio control (CrazyGames' game settings). Fires once with the
  // current value and again on every change; a no-op everywhere else.
  platform.watchAudioSetting(setPortalMuted);

  // Dev deep-link: ?screen=<name> or ?world=4&level=2 jumps straight there;
  // add &bot=1 to hold the gas down (for screenshotting mid-level).
  const q = new URLSearchParams(location.search);
  // &coins=N force-sets the wallet (dev testing: economy/upgrade-hint flows).
  if (q.has('coins')) { saveData.data.coins = +q.get('coins'); saveData.save(); }
  // &tiers=e,s,t,b force-sets the (&veh-overridable) vehicle's upgrade tiers
  // (dev testing: per-tier visuals like tire looks, tuning previews).
  if (q.has('tiers')) {
    const [e, s, t, b] = q.get('tiers').split(',').map(n => +n || 0);
    const vs = saveData.getVehicleState(q.get('veh') || saveData.getActiveVehicle());
    if (vs) {
      vs.upgrades = { engine: e, suspension: s, tires: t, brakes: b };
      vs.ownedUpgrades = { engine: e, suspension: s, tires: t, brakes: b };
      saveData.save();
    }
  }
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
  } else if (!q.has('screen') && saveData.isFirstRun()) {
    // FIRST LAUNCH EVER: straight into Farm 1, no menu in the way. Portals
    // (CrazyGames' quality bar in particular) want a brand-new player driving
    // within seconds of the page loading, not reading a home screen first —
    // and the level intro card names where they've landed. The flag is set
    // before the jump so a refresh mid-level doesn't relaunch them into it.
    saveData.markFirstRunDone();
    screens.show('game', { worldId: 1, levelIndex: 0 });
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
    // Held until the level intro card has cleared: both sit top-centre, and on
    // a first launch (which drops straight into a level) they would otherwise
    // land on top of each other.
    setTimeout(() => showToast(`🎁 Daily bonus: +${bonus} coins!`), 2700);
  }

  platform.loadingStop();
  last = performance.now();
  requestAnimationFrame(frame);
  window.__hillRunnerBooted = true; // index.html's boot watchdog stands down
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 100); // clamp tab-switch spikes
  last = now;
  // An ad break owns the screen: freeze the world (and let AudioBus silence it)
  // until the break resolves, then carry on from the same frame.
  if (!ads.blocking) {
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
  }
  requestAnimationFrame(frame);
}

// A rejected boot leaves the menus unbuilt — an empty hillside the player has
// no way to read. Put the reason on screen (index.html defines the panel).
boot().catch((err) => {
  console.error('Boot failed:', err);
  window.showBootError?.('Failed to start', `Hill Runner couldn't start:<br><code>${err.message}</code>`);
});
