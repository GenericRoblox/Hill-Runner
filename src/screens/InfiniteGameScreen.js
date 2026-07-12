// Infinite mode: endless per-theme procedural run built on GameScreen.
// Terrain/obstacles stream in as chunks ahead of the car and are torn down
// behind it; there is no finish line — the run ends on any fail verdict, and
// pays out new-best 500m milestones (live), plus flip and air-time bonuses.

import { GameScreen } from './GameScreen.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Terrain } from '../physics/Terrain.js';
import { Obstacles } from '../physics/Obstacles.js';
import { Car } from '../physics/Car.js';
import { ParticleSystem, buildTireProfiles } from '../ui/Particles.js';
import { Camera } from '../ui/Camera.js';
import { sound } from '../ui/Sound.js';
import { music } from '../ui/Music.js';
import { input } from '../core/InputManager.js';
import { screens } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { getWorld } from '../data/levels.js';
import { getVehicleDef, getStatsAtTiers } from '../data/vehicles.js';
import { showResult, hideResult } from './ResultOverlay.js';
import {
  PX_PER_M, MILESTONE_M, BASELINE_Y, FLIP_COINS, AIR_COINS_PER_S,
  getInfiniteTheme, milestoneCoins, difficultyAt, mulberry32, makeElevation,
  generateIntroChunk, generateChunk,
} from '../data/infinite.js';

const STEP_MS = 1000 / 60;
const AHEAD_PX = 4200;   // keep this much world generated past the car
const BEHIND_PX = 2400;  // recycle chunks whose end is this far behind

export class InfiniteGameScreen extends GameScreen {
  enter({ themeId, vehId: vehOverride }) {
    this.custom = null;
    this.themeId = themeId;
    this.theme = getInfiniteTheme(themeId);
    this.worldDef = getWorld(themeId);
    this.level = {
      chains: [], walls: [], obstacles: [], buildings: [],
      deathY: BASELINE_Y + 550,
      startX: 150, startY: BASELINE_Y - 80,
      finishX: Infinity,
      name: `${this.worldDef.name} Infinite`, // Beachday has no ∞ glyph
      targetTime: Infinity,
      friction: 0.85,
    };

    const vehId = vehOverride || saveData.getActiveVehicle();
    this.vehicleDef = getVehicleDef(vehId);
    this.stats = getStatsAtTiers(vehId, saveData.getVehicleState(vehId).upgrades);

    document.getElementById('btn-quit').textContent = 'Quit to Infinite';
    input.onPause = () => this.togglePause();
    input.onRestart = () => {
      if (this.state === 'playing' || this.state === 'failed') {
        hideResult();
        this.restart();
      }
    };
    input.reset();

    sound.startEngine();
    music.playNext();
    this._build();
  }

  _build() {
    this.physics = new PhysicsWorld();
    const seed = (Math.random() * 1e9) | 0;
    this.rng = mulberry32(seed);
    // Coherent-noise elevation profile for this run: open terrain climbs and
    // dives with it (per-theme bumpiness), so it must be one continuous
    // function across every chunk of the run.
    this.profile = makeElevation(this.themeId, seed ^ 0x9e3779b9);
    this.chunks = [];
    this.level.chains.length = 0;
    this.level.walls.length = 0;
    this.level.buildings.length = 0;
    this.genX = 0;
    this.genY = BASELINE_Y;

    this._addChunk(generateIntroChunk(this.themeId, this.rng, this.profile), true);
    while (this.genX < this.level.startX + AHEAD_PX) this._spawnNext();

    // Facade over the live chunk list — GameScreen.render just calls
    // obstacleSet.render/renderOverlay and never needs to know.
    this.obstacleSet = {
      render: (ctx, carPos) => { for (const c of this.chunks) c.obs.render(ctx, carPos); },
      renderOverlay: (ctx) => { for (const c of this.chunks) c.obs.renderOverlay(ctx); },
    };

    this.car = new Car(this.stats, this.level.startX, this.level.startY);
    this.car.addTo(this.physics);
    this.particles = new ParticleSystem();
    this.tireProfiles = buildTireProfiles(this.worldDef);
    window.__car = this.car; // dev hook, same as GameScreen
    this.camera = new Camera(this.canvas);
    this.time = 0;
    this.accumulator = 0;

    // Run tracking
    this.maxX = this.level.startX;
    this.distM = 0;
    this.baseBestM = saveData.getInfiniteBest(this.themeId);
    this._lastMilestone = 0;
    this.milestoneEarned = 0;
    this.flips = 0;
    this._spin = 0;
    this._prevAngle = this.car.chassis.angle;
    this.flash = null; // { text, until } — HUD banner for milestones/flips
    this._progressAt = 0; // last time maxX advanced (soft-lock watchdog)

    this.state = 'playing';
  }

  _spawnNext() {
    const d = difficultyAt(this.genX);
    this._addChunk(generateChunk(this.themeId, this.genX, this.genY, d, this.rng, this.profile), false);
  }

  _addChunk(gen, isFirst) {
    const stub = {
      chains: gen.chains, walls: gen.walls, obstacles: gen.obstacles,
      // Water/molten zones fill down from their surface to deathY+300 —
      // size them from this chunk's own deepest ground.
      deathY: gen.maxY + 420, friction: this.level.friction,
    };
    const terrain = new Terrain(stub, this.physics, { startWall: isFirst });
    const obs = new Obstacles(stub, this.physics);
    this.chunks.push({ x1: gen.endX, maxY: gen.maxY, terrain, obs, chains: gen.chains, walls: gen.walls });
    this.level.chains.push(...gen.chains);
    this.level.walls.push(...gen.walls);
    this.genX = gen.endX;
    this.genY = gen.endY;
    this._updateDeathY();
  }

  // Terrain now dives far below the baseline, so the kill line hangs a fixed
  // margin under the deepest LIVE chunk instead of sitting at a constant y.
  _updateDeathY() {
    let deepest = BASELINE_Y;
    for (const c of this.chunks) deepest = Math.max(deepest, c.maxY);
    this.level.deathY = deepest + 420;
  }

  // Stream: extend ahead of the car, recycle far behind it.
  _stream() {
    const x = this.car.position().x;
    while (this.genX < x + AHEAD_PX) this._spawnNext();
    while (this.chunks.length > 1 && this.chunks[0].x1 < x - BEHIND_PX) {
      const old = this.chunks.shift();
      old.obs.destroy();
      old.terrain.destroy();
      for (const c of old.chains) {
        const i = this.level.chains.indexOf(c);
        if (i >= 0) this.level.chains.splice(i, 1);
      }
      for (const w of old.walls) {
        const i = this.level.walls.indexOf(w);
        if (i >= 0) this.level.walls.splice(i, 1);
      }
      this._updateDeathY();
    }
  }

  _teardown() {
    if (!this.physics) return;
    this.car.removeFrom(this.physics);
    for (const c of this.chunks) {
      c.obs.destroy();
      c.terrain.destroy();
    }
    this.chunks = [];
    this.physics.destroy();
    this.physics = null;
  }

  quit() {
    this.state = 'idle';
    this._teardown();
    sound.stopEngine();
    input.onPause = input.onRestart = null;
    screens.show('infinite');
  }

  update(dtMs) {
    if (this.state !== 'playing') return;

    this.accumulator = Math.min(this.accumulator + dtMs, STEP_MS * 5);
    const inputState = input.getState();

    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.time += STEP_MS / 1000;

      const now = this.physics.timestamp();
      const verdict = this.car.update(inputState, STEP_MS / 1000, now);
      this.physics.step(STEP_MS);
      this._stream();

      const impact = this.car.consumeLandingImpact();
      if (impact > 0) {
        this.camera.addShake(impact * 0.7);
        sound.thud();
      }

      this._emitTireSpray();
      this.particles.update(STEP_MS / 1000);
      this._trackRun(now);
      if (this.state !== 'playing') return; // watchdog may have ended the run

      if (verdict === 'stuck') return this._endRun('Flipped and stuck!');
      if (verdict === 'sank') return this._endRun('Sank into open water!');
      if (verdict === 'dissolved') return this._endRun('Dissolved in the sludge!');
      if (verdict === 'melted') {
        return this._endRun(this.car.lavaKind === 'acid'
          ? 'Dissolved in the acid pool!'
          : 'Melted in the lava!');
      }
      if (verdict === 'popped') return this._endRun('Tires shredded on the spikes!');
      if (verdict === 'crushed') {
        this.car.smashed = true;
        this.camera.addShake(16);
        const by = this.car.crushedBy;
        return this._endRun(by === 'arrows' ? 'Skewered by the archers!'
          : by === 'fireball' ? 'Torched by a fireball!'
          : by === 'blade' ? 'Diced by the spinning blade!'
          : by === 'compactor' ? 'Flattened by the compactor!'
          : 'Smashed to scrap!');
      }
      if (this.car.position().y > this.level.deathY) return this._endRun('You fell into a pit!');
    }

    sound.updateEngine(this.car.speed(), inputState.gas);
    this.camera.follow(this.car.position(), this.car.velocity(), dtMs / 1000);
  }

  // Distance, live milestone payouts, airborne-flip counting, and the
  // soft-lock watchdog (wedged behind a wall or stalled in a rope-bridge sag
  // isn't a crash — end the run instead of hanging forever).
  _trackRun(now) {
    const x = this.car.position().x;
    if (x > this.maxX + 2) {
      this.maxX = Math.max(this.maxX, x);
      this._progressAt = this.time;
    } else if (this.time - this._progressAt > 12) {
      return this._endRun('Ran out of steam!');
    }
    this.distM = Math.max(0, (this.maxX - this.level.startX) / PX_PER_M);

    const k = Math.floor(this.distM / MILESTONE_M);
    while (this._lastMilestone < k) {
      const hit = ++this._lastMilestone;
      const m = hit * MILESTONE_M;
      if (m > this.baseBestM) {
        // Never been this far in this theme: pay out on the spot.
        const coins = milestoneCoins(hit, this.theme.payMult);
        saveData.addCoins(coins);
        this.milestoneEarned += coins;
        this._flash(`${m}m — +${coins} coins!`);
        sound.win();
      } else {
        this._flash(`${m}m`);
      }
    }

    // Full airborne rotations pay flip bonuses at the end of the run.
    const airborne = this.car.groundedWheelCount(now) === 0;
    const angle = this.car.chassis.angle;
    if (airborne) {
      this._spin += angle - this._prevAngle;
      if (Math.abs(this._spin) > Math.PI * 1.9) {
        this.flips++;
        this._spin = 0;
        this._flash('🔄 Flip!');
      }
    } else {
      this._spin = 0;
    }
    this._prevAngle = angle;
  }

  _flash(text) {
    this.flash = { text, until: this.time + 2.2 };
  }

  _hudExtras() {
    return {
      distanceM: this.distM,
      bestM: this.baseBestM,
      flash: this.flash && this.time < this.flash.until ? this.flash.text : null,
    };
  }

  _endRun(reason) {
    this.state = 'failed';
    this.camera.shake = 0;
    sound.crash();
    sound.updateEngine(0, false);

    const distM = Math.round(this.distM);
    const mult = this.theme.payMult;
    const flipCoins = Math.round(this.flips * FLIP_COINS * mult);
    const airCoins = Math.round(Math.min(this.car.airTime, 60) * AIR_COINS_PER_S * mult);
    if (flipCoins + airCoins > 0) saveData.addCoins(flipCoins + airCoins);
    const newBest = distM > this.baseBestM;
    saveData.recordInfiniteBest(this.themeId, distM);

    showResult({
      infinite: true,
      reason,
      distM,
      bestM: saveData.getInfiniteBest(this.themeId),
      newBest,
      milestoneCoins: this.milestoneEarned,
      flips: this.flips,
      flipCoins,
      airTime: this.car.airTime,
      airCoins,
      onRetry: () => this.restart(),
      onQuit: () => this.quit(),
    });
  }

  _drawFinish() {} // no finish line in an endless run
}
