// Gameplay: fixed-step physics, camera, win/fail checks, canvas rendering.

import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { texPattern } from '../ui/Textures.js';
import { ParticleSystem, buildTireProfiles } from '../ui/Particles.js';
import { getSprite } from '../ui/Sprites.js';
import { Terrain } from '../physics/Terrain.js';
import { Obstacles } from '../physics/Obstacles.js';
import { Car } from '../physics/Car.js';
import { Camera } from '../ui/Camera.js';
import { renderHUD } from '../ui/HUD.js';
import { renderTouchPedals } from '../ui/TouchControls.js';
import { sound } from '../ui/Sound.js';
import { music } from '../ui/Music.js';
import { input } from '../core/InputManager.js';
import { screens } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { getWorld, getLevel, levelKey } from '../data/levels.js';

const DEBUG_HUD = new URLSearchParams(location.search).has('debug');
import { getVehicleDef, getStatsAtTiers, getUpgradeCost } from '../data/vehicles.js';
import { calcStars, calcPayout } from '../data/economy.js';
import { showResult, hideResult } from './ResultOverlay.js';

const STEP_MS = 1000 / 60;

export class GameScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'idle';

    // Pause overlay buttons
    document.getElementById('btn-resume').addEventListener('click', () => this.resume());
    document.getElementById('btn-restart').addEventListener('click', () => {
      this._hidePause();
      this.restart();
    });
    document.getElementById('btn-quit').addEventListener('click', () => {
      this._hidePause();
      this.quit();
    });

    // Desktop pause button click (top-right of canvas)
    canvas.addEventListener('mousedown', (e) => {
      if (screens.currentName !== 'game') return;
      if (e.offsetX > canvas.width - 70 && e.offsetY < 70) this.togglePause();
    });
  }

  enter({ worldId, levelIndex, vehId: vehOverride }) {
    this.worldId = worldId;
    this.levelIndex = levelIndex;
    this.worldDef = getWorld(worldId);
    this.level = getLevel(worldId, levelIndex);
    this.key = levelKey(worldId, levelIndex);

    const vehId = vehOverride || saveData.getActiveVehicle();
    this.vehicleDef = getVehicleDef(vehId);
    this.stats = getStatsAtTiers(vehId, saveData.getVehicleState(vehId).upgrades);

    input.onPause = () => this.togglePause();
    input.onRestart = () => { if (this.state === 'playing' || this.state === 'failed') { hideResult(); this.restart(); } };
    input.reset();

    sound.startEngine();
    music.playNext(); // fades in a track different from whatever just played
    this._build();
  }

  _build() {
    this.physics = new PhysicsWorld();
    this.terrain = new Terrain(this.level, this.physics);
    this.obstacleSet = new Obstacles(this.level, this.physics);
    this.car = new Car(this.stats, this.level.startX, this.level.startY);
    this.car.addTo(this.physics);
    this.particles = new ParticleSystem();
    this.tireProfiles = buildTireProfiles(this.worldDef);
    window.__car = this.car; // dev hook: console access for physics tuning
    this.camera = new Camera(this.canvas);
    this.time = 0;
    this.accumulator = 0;
    this.state = 'playing';
  }

  _teardown() {
    if (this.physics) {
      this.car.removeFrom(this.physics);
      this.obstacleSet.destroy();
      this.terrain.destroy();
      this.physics.destroy();
      this.physics = null;
    }
  }

  restart() {
    // Retrying from the win screen: _win() already faded music out at the
    // goal, so bring it back for the replay (retrying after a fail never
    // stopped it, so this is a no-op there).
    if (!music.current) music.playNext();
    this._teardown();
    input.reset();
    this._build();
  }

  quit(target = 'levelselect') {
    this.state = 'idle';
    this._teardown();
    sound.stopEngine();
    input.onPause = input.onRestart = null;
    screens.show(target, target === 'levelselect' ? { worldId: this.worldId } : {});
  }

  exit() {
    if (this.physics) this._teardown();
    sound.stopEngine();
    music.stop(); // covers quitting to a menu; no-op if _win() already faded it out
    hideResult();
    this._hidePause();
  }

  // --- Pause ---
  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      document.getElementById('pause-overlay').classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.resume();
    }
  }
  resume() {
    if (this.state !== 'paused') return;
    this._hidePause();
    input.reset();
    this.state = 'playing';
  }
  _hidePause() {
    document.getElementById('pause-overlay').classList.add('hidden');
  }

  // --- Update ---
  update(dtMs) {
    if (this.state !== 'playing') return;

    this.accumulator = Math.min(this.accumulator + dtMs, STEP_MS * 5);
    const inputState = input.getState();

    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.time += STEP_MS / 1000;

      const verdict = this.car.update(inputState, STEP_MS / 1000, this.physics.timestamp());
      this.physics.step(STEP_MS);

      const impact = this.car.consumeLandingImpact();
      if (impact > 0) {
        this.camera.addShake(impact * 0.7);
        sound.thud();
      }

      this._emitTireSpray();
      this.particles.update(STEP_MS / 1000);

      if (verdict === 'stuck') return this._fail('Flipped and stuck!');
      if (verdict === 'sank') return this._fail('Sank into open water!');
      if (verdict === 'dissolved') return this._fail('Dissolved in the sludge!');
      if (verdict === 'melted') {
        return this._fail(this.car.lavaKind === 'acid'
          ? 'Dissolved in the acid pool!'
          : 'Melted in the lava!');
      }
      if (verdict === 'popped') return this._fail('Tires shredded on the spikes!');
      if (verdict === 'crushed') {
        this.car.smashed = true;
        this.camera.addShake(16);
        const by = this.car.crushedBy;
        return this._fail(by === 'arrows' ? 'Skewered by the archers!'
          : by === 'fireball' ? 'Torched by a fireball!'
          : by === 'blade' ? 'Diced by the spinning blade!'
          : by === 'compactor' ? 'Flattened by the compactor!'
          : 'Smashed to scrap!');
      }
      const pos = this.car.position();
      if (pos.y > this.level.deathY) return this._fail('You fell into a pit!');
      if (pos.x > this.level.finishX) return this._win();
    }

    sound.updateEngine(this.car.speed(), inputState.gas);
    this.camera.follow(this.car.position(), this.car.velocity(), dtMs / 1000);
  }

  // Kick surface-matched debris off any grounded, rotating wheel. Surface
  // kind comes from the wheel's freshest contact friction (mud 0.1, ice 0.05
  // vs ~0.85 road — same signal Car.update uses for terrain grip).
  _emitTireSpray() {
    const now = this.physics.timestamp();
    for (const w of this.car.wheels) {
      if (now - w.plugin.lastContact > 90) continue;      // airborne
      if (Math.abs(w.angularVelocity) < 0.06) continue;   // not rotating
      const f = w.plugin.contactFriction;
      const prof = f !== undefined && f < 0.075 ? this.tireProfiles.ice
        : f !== undefined && f < 0.3 ? this.tireProfiles.mud
        : this.tireProfiles.normal;
      this.particles.emitTireSpray(w, w.angularVelocity, prof);
    }
  }

  _fail(reason) {
    this.state = 'failed';
    // camera.follow (the only thing that decays shake) stops with the run —
    // clear any leftover shake or the world jitters under the overlay forever.
    this.camera.shake = 0;
    sound.crash();
    sound.updateEngine(0, false);
    showResult({
      won: false,
      reason,
      onRetry: () => this.restart(),
      onQuit: () => this.quit(),
    });
  }

  _win() {
    this.state = 'won';
    this.camera.shake = 0; // see _fail — a hard landing at the flag otherwise shakes forever
    music.stop(); // fade out right at the goal, not when they leave for the next level
    const prevBest = saveData.getLevelStars(this.key);
    const stars = calcStars(this.level, this.time, this.car.everFlipped);
    const coins = calcPayout(this.level, this.time, stars, this.car.airTime, prevBest);
    saveData.recordResult(this.key, stars, this.time);
    saveData.addCoins(coins);
    sound.win();
    sound.updateEngine(0, false);

    // One-time nudge: the first time the player can afford the pickup's
    // first engine upgrade, point them at the garage.
    const firstEngineCost = getUpgradeCost('pickup', 'engine', 0);
    const upgradeHint = !saveData.isUpgradeHintShown()
      && firstEngineCost != null
      && saveData.getCoins() >= firstEngineCost;
    if (upgradeHint) saveData.markUpgradeHintShown();

    const hasNext = !!getLevel(this.worldId, this.levelIndex + 1);
    showResult({
      won: true,
      stars,
      time: this.time,
      bestTime: saveData.getBestTime(this.key),
      airTime: this.car.airTime,
      coins,
      onNext: hasNext
        ? () => screens.show('game', { worldId: this.worldId, levelIndex: this.levelIndex + 1 })
        : null,
      onRetry: () => this.restart(),
      onQuit: () => this.quit(),
      onGarage: upgradeHint ? () => this.quit('garage') : null,
    });
  }

  // --- Rendering ---
  render(ctx) {
    if (!this.physics) return;
    // Once the end-of-run overlay is up the world is static: paint a couple
    // more frames so the final pose lands on screen, then stop repainting.
    // Continuously redrawing a full-screen canvas under a DOM modal at 60fps
    // is heavy compositing work — it's what tipped iOS Safari into killing
    // the tab at level completion. Resizing CLEARS a canvas (rotation, URL
    // bar collapse), so any size change restarts the freeze-frame paint.
    if (this.state === 'won' || this.state === 'failed') {
      const resized = this.canvas.width !== this._paintW || this.canvas.height !== this._paintH;
      if (!resized && this._overlayFrames > 2) return;
      this._overlayFrames = resized ? 1 : (this._overlayFrames || 0) + 1;
    } else {
      this._overlayFrames = 0;
    }
    this._paintW = this.canvas.width;
    this._paintH = this.canvas.height;
    const { width, height } = this.canvas;
    const w = this.worldDef;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, w.sky[0]);
    sky.addColorStop(1, w.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const [pFar, pNear] = w.parallax || ['rgba(110, 150, 90, 0.35)', 'rgba(90, 130, 70, 0.45)'];
    this._drawParallax(ctx, width, height, 0.15, 0.55, pFar);
    this._drawParallax(ctx, width, height, 0.35, 0.68, pNear);
    if (w.cave) this._drawCaveCeiling(ctx, width, height);
    if (w.castle) this._drawCastleBackdrop(ctx, width, height);
    if (w.factory) this._drawFactoryBackdrop(ctx, width, height);

    ctx.save();
    this.camera.applyTransform(ctx);
    this._drawTerrain(ctx);
    this._drawBuildings(ctx);
    this._drawWalls(ctx);
    this.obstacleSet.render(ctx, this.car.position());
    this._drawFinish(ctx);
    this._drawCar(ctx);
    this.particles.render(ctx);
    this.obstacleSet.renderOverlay(ctx); // tree canopies hide a snagged car
    ctx.restore();

    renderHUD(ctx, {
      time: this.time,
      speedKmh: this.car.speed() * 8, // px/step → rough km/h at ~4m car length
      levelName: this.level.name,
      targetTime: this.level.targetTime,
      sludge: this.car.sludgeLethality,
      width,
    });

    if (input.touchActive) {
      const s = input.getState();
      renderTouchPedals(ctx, { width, height, gas: s.gas, brake: s.brake });
    }

    if (DEBUG_HUD) this._drawDebugHud(ctx, height);
  }

  // ?debug=1 overlay: live grip + per-wheel surface friction, for verifying
  // low-friction surfaces (ice/mud) and general handling tuning.
  _drawDebugHud(ctx, height) {
    const car = this.car;
    const now = this.physics.timestamp();
    const wheelInfo = car.wheels.map(w => {
      const fresh = now - (w.plugin.lastContact ?? -Infinity) < 90;
      const f = w.plugin.contactFriction;
      return `${fresh ? '●' : '○'} ${f === undefined ? '—' : f.toFixed(4)}`;
    });
    const lines = [
      `grip ${car.debugGrip !== undefined ? car.debugGrip.toFixed(4) : '—'}`,
      `wheels ${wheelInfo.join('  ')}`,
      `vx ${car.velocity().x.toFixed(2)} px/step`,
    ];
    ctx.save();
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    lines.forEach((t, i) => {
      const y = height - 64 + i * 18;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(t, 13, y + 1);
      ctx.fillStyle = '#9ff09f';
      ctx.fillText(t, 12, y);
    });
    ctx.restore();
  }

  _drawParallax(ctx, width, height, speed, baseFrac, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const base = height * baseFrac;
    const offset = this.camera.x * speed;
    ctx.moveTo(0, height);
    for (let sx = 0; sx <= width; sx += 16) {
      const wx = sx + offset;
      const y = base
        - 60 * Math.sin(wx * 0.004)
        - 30 * Math.sin(wx * 0.011 + 2);
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }

  // Screen-space tunnel roof for cave worlds (worldDef.cave): a jagged rock
  // band with stalactite teeth and hanging lanterns, scrolled at near-full
  // camera speed. Purely aesthetic — physics ceilings are authored per level.
  _drawCaveCeiling(ctx, width, height) {
    const offset = this.camera.x * 0.9;
    const base = Math.min(120, height * 0.12);
    const yAt = (wx) => base + 26 * Math.sin(wx * 0.0052) + 14 * Math.sin(wx * 0.017 + 1.7);
    ctx.fillStyle = '#191106';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let sx = 0; sx <= width; sx += 14) ctx.lineTo(sx, yAt(sx + offset));
    ctx.lineTo(width, 0);
    ctx.closePath();
    ctx.fill();
    // Rock teeth + lanterns at deterministic world-x buckets
    const k0 = Math.floor(offset / 190) - 1;
    const k1 = Math.floor((offset + width) / 190) + 1;
    for (let k = k0; k <= k1; k++) {
      const wx = k * 190 + ((k * 73) % 90);
      const sx = wx - offset;
      const y = yAt(wx);
      const len = 22 + ((k * 37 % 34) + 34) % 34;
      ctx.fillStyle = '#191106';
      ctx.beginPath();
      ctx.moveTo(sx - 13, y - 4);
      ctx.lineTo(sx + 13, y - 4);
      ctx.lineTo(sx, y + len);
      ctx.closePath();
      ctx.fill();
      if (k % 4 === 0) {
        // Hanging lantern with a warm glow
        const ly = y + 30;
        ctx.strokeStyle = '#3a2f1e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.lineTo(sx, ly);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 200, 90, 0.16)';
        ctx.beginPath();
        ctx.arc(sx, ly + 6, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcf6b';
        ctx.fillRect(sx - 4, ly, 8, 12);
      }
    }
  }

  // Screen-space rampart band for castle worlds (worldDef.castle): battlement
  // merlons along the top with flickering wall torches — the "dim luminating
  // lights" that sell the keep. Purely aesthetic, like the cave ceiling.
  _drawCastleBackdrop(ctx, width, height) {
    const offset = this.camera.x * 0.9;
    const t = this.physics ? this.physics.timestamp() / 1000 : 0;
    const base = Math.min(96, height * 0.1);
    ctx.fillStyle = '#171221';
    ctx.fillRect(0, 0, width, base);
    // Merlons (alternating teeth)
    const mw = 46;
    const k0 = Math.floor(offset / mw) - 1;
    const k1 = Math.floor((offset + width) / mw) + 1;
    for (let k = k0; k <= k1; k++) {
      if ((k % 2 + 2) % 2 === 0) ctx.fillRect(k * mw - offset, base, mw, 26);
    }
    // Wall torches on deterministic world-x buckets
    const b0 = Math.floor(offset / 420) - 1;
    const b1 = Math.floor((offset + width) / 420) + 1;
    for (let k = b0; k <= b1; k++) {
      const sx = k * 420 + ((k * 97) % 130) - offset;
      const ty = base + 44;
      const flick = 0.75 + 0.25 * Math.sin(t * 9 + k * 2.7);
      // Bracket + shaft
      ctx.fillStyle = '#3a2f22';
      ctx.fillRect(sx - 3, ty - 26, 6, 26);
      // Warm glow
      ctx.fillStyle = `rgba(255, 168, 66, ${0.13 * flick})`;
      ctx.beginPath();
      ctx.arc(sx, ty - 32, 46 * flick + 14, 0, Math.PI * 2);
      ctx.fill();
      // Flame
      ctx.fillStyle = '#ff9a2e';
      ctx.beginPath();
      ctx.ellipse(sx, ty - 32, 6, 9 + 2 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.ellipse(sx, ty - 30, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Screen-space girder/smokestack skyline for the Factory world (worldDef.
  // factory): purely aesthetic, like the cave ceiling and castle backdrop.
  _drawFactoryBackdrop(ctx, width, height) {
    const offset = this.camera.x * 0.85;
    const t = this.physics ? this.physics.timestamp() / 1000 : 0;
    const base = Math.min(110, height * 0.11);
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(0, 0, width, base);
    // Girder truss zigzag
    ctx.strokeStyle = '#33353c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    const gw = 70;
    const k0 = Math.floor(offset / gw) - 1;
    const k1 = Math.floor((offset + width) / gw) + 1;
    for (let k = k0; k <= k1; k++) {
      const sx = k * gw - offset;
      ctx.moveTo(sx, base - 4);
      ctx.lineTo(sx + gw, base - 34);
      ctx.moveTo(sx, base - 34);
      ctx.lineTo(sx + gw, base - 4);
    }
    ctx.stroke();
    // Smokestacks with drifting smoke, on deterministic world-x buckets
    const b0 = Math.floor(offset / 480) - 1;
    const b1 = Math.floor((offset + width) / 480) + 1;
    for (let k = b0; k <= b1; k++) {
      const sx = k * 480 + ((k * 113) % 160) - offset;
      ctx.fillStyle = '#2a2b30';
      ctx.fillRect(sx - 14, base - 90, 28, 90);
      ctx.fillStyle = '#e8c34a';
      ctx.fillRect(sx - 14, base - 12, 28, 6);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#888e98';
      for (let p = 0; p < 3; p++) {
        const py = base - 96 - ((t * 22 + p * 30 + k * 17) % 90);
        ctx.beginPath();
        ctx.arc(sx + Math.sin(py * 0.05 + k) * 8, py, 12 + p * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Blinking hazard lights along the truss
    const h0 = Math.floor(offset / 260) - 1;
    const h1 = Math.floor((offset + width) / 260) + 1;
    for (let k = h0; k <= h1; k++) {
      const sx = k * 260 + ((k * 61) % 90) - offset;
      const on = Math.sin(t * 3 + k * 2.1) > 0.3;
      ctx.beginPath();
      ctx.arc(sx, base - 18, 5, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#ff5a3c' : '#5a2a20';
      ctx.fill();
    }
  }

  _drawTerrain(ctx) {
    const bottom = this.level.deathY + 300;
    const tex = this.worldDef.tex || {};
    const groundPat = tex.ground && texPattern(tex.ground[0], tex.ground[1], tex.ground[2] || 260);
    const stripePat = tex.stripe && texPattern(tex.stripe[0], tex.stripe[1], 140);
    const mudPat = texPattern('mud', '#6b4a2a', 160);
    for (const chain of this.level.chains) {
      ctx.beginPath();
      ctx.moveTo(chain[0].x, bottom);
      for (const p of chain) ctx.lineTo(p.x, p.y);
      ctx.lineTo(chain[chain.length - 1].x, bottom);
      ctx.closePath();
      ctx.fillStyle = groundPat || this.worldDef.groundColor;
      ctx.fill();

      // Surface stripe: grass/asphalt tile, mud tile, or flat ice.
      ctx.beginPath();
      for (let i = 0; i < chain.length; i++) {
        const p = chain[i];
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.strokeStyle = chain.surface === 'mud' ? (mudPat || '#4a3520')
        : chain.surface === 'ice' ? '#b9dcea'
        : (stripePat || this.worldDef.grassColor);
      ctx.stroke();
      // Ice shine
      if (chain.surface === 'ice') {
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.stroke();
      }
    }
  }

  // Building facades under rooftop spans (level.buildings, authored via
  // LevelBuilder.roof()). Drawn over the terrain fill so the columns read as
  // houses instead of bare ground.
  _drawBuildings(ctx) {
    const buildings = this.level.buildings || [];
    const bottom = this.level.deathY + 300;
    const palettes = [
      { wall: '#a3786a', shade: '#8a6156', tint: '#cfa08c' }, // brick
      { wall: '#98a2b3', shade: '#7d8798', tint: '#9aa6bc' }, // slate
      { wall: '#b3a486', shade: '#99896c', tint: '#cbb996' }, // sandstone
    ];
    for (let i = 0; i < buildings.length; i++) {
      const { x0, x1, y } = buildings[i];
      const p = palettes[i % palettes.length];
      const w = x1 - x0;

      // Facade (brick tile tinted per building) with a darker right edge
      ctx.fillStyle = texPattern('brick', p.tint, 190) || p.wall;
      ctx.fillRect(x0, y, w, bottom - y);
      ctx.fillStyle = p.shade;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x1 - 14, y, 14, bottom - y);
      ctx.globalAlpha = 1;

      // Windows: deterministic grid, a few lit (varies per building, stable per frame)
      const cols = Math.max(2, Math.round(w / 95));
      const pitch = w / cols;
      for (let c = 0; c < cols; c++) {
        const wx = x0 + pitch * (c + 0.5) - 17;
        for (let r = 0; y + 52 + r * 105 + 46 < bottom; r++) {
          const wy = y + 52 + r * 105;
          ctx.fillStyle = (c * 7 + r * 13 + i * 5) % 4 === 0 ? '#e9d68d' : '#39404d';
          ctx.fillRect(wx, wy, 34, 46);
        }
      }

      // Cornice: rooftop trim with a slight overhang; doubles as the roof surface
      ctx.fillStyle = shade(p.wall, -60);
      ctx.fillRect(x0 - 7, y - 4, w + 14, 16);
    }
  }

  _drawWalls(ctx) {
    const woodPat = texPattern('wood', '#c9985e', 170);
    for (const wall of this.level.walls) {
      ctx.save();
      ctx.translate(wall.cx, wall.cy);
      if (wall.style === 'steel') {
        // Riveted plate (Factory elevator guards etc.) — the wood-plank
        // default would clash with industrial set-pieces.
        ctx.fillStyle = texPattern('concrete', '#5a616c', 170) || '#4c525c';
        ctx.fillRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
        ctx.strokeStyle = '#23262c';
        ctx.lineWidth = 3;
        ctx.strokeRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
        ctx.fillStyle = '#23262c';
        for (let y = -wall.h / 2 + 18; y < wall.h / 2 - 8; y += 34) {
          ctx.beginPath();
          ctx.arc(0, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = woodPat || '#8a6b42';
        ctx.fillRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
        ctx.strokeStyle = '#5e4626';
        ctx.lineWidth = 3;
        ctx.strokeRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
        // Plank lines
        ctx.beginPath();
        for (let y = -wall.h / 2 + 22; y < wall.h / 2; y += 22) {
          ctx.moveTo(-wall.w / 2, y);
          ctx.lineTo(wall.w / 2, y);
        }
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _groundYAt(x) {
    for (const chain of this.level.chains) {
      if (x < chain[0].x || x > chain[chain.length - 1].x) continue;
      for (let i = 0; i < chain.length - 1; i++) {
        if (x >= chain[i].x && x <= chain[i + 1].x) {
          const t = (x - chain[i].x) / Math.max(1, chain[i + 1].x - chain[i].x);
          return chain[i].y + (chain[i + 1].y - chain[i].y) * t;
        }
      }
    }
    return 600;
  }

  _drawFinish(ctx) {
    const x = this.level.finishX;
    const y = this._groundYAt(x);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 110);
    ctx.stroke();
    // Checkered flag
    const fw = 46, fh = 30, cell = fw / 4;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
        ctx.fillRect(x + c * cell, y - 110 + r * (fh / 2), cell, fh / 2);
      }
    }
  }

  _drawCar(ctx) {
    const { chassis, wheels } = this.car;
    const { width: bw, height: bh } = this.stats.body;
    const isBike = this.vehicleDef.id === 'bike';
    const colors = { pickup: '#d9772f', sports: '#d33c3c', bike: '#3a67c9' };
    const color = colors[this.vehicleDef.id] || '#888';

    // Wheels
    for (const wheel of wheels) {
      const r = wheel.circleRadius;
      ctx.save();
      ctx.translate(wheel.position.x, wheel.position.y);
      ctx.rotate(wheel.angle);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#222';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#999';
      ctx.fill();
      // Spokes make wheel spin readable (spec §8 readability).
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.9, 0);
      ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.9);
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    // Chassis
    ctx.save();
    ctx.translate(chassis.position.x, chassis.position.y);
    ctx.rotate(chassis.angle);
    // chassis.position is the COM, shifted comY below the sprite centre.
    ctx.translate(0, -(this.stats.body.comY || 0));

    if (this.car.smashed) {
      // Flattened, charred wreck (freeze-frame after a crush fail).
      ctx.fillStyle = '#3a3d42';
      roundRect(ctx, -bw / 2, -bh / 4, bw, bh * 0.55, 4);
      ctx.fill();
      ctx.fillStyle = '#26282c';
      ctx.beginPath();
      ctx.moveTo(-bw * 0.22, -bh / 4);
      ctx.lineTo(-bw * 0.02, -bh / 4 - 9);
      ctx.lineTo(bw * 0.16, -bh / 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // Smoke puffs
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#9a9da3';
      for (const [dx, dy, r] of [[-8, -34, 11], [6, -50, 14], [20, -68, 17]]) {
        ctx.beginPath();
        ctx.arc(chassis.position.x + dx, chassis.position.y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    const sprite = getSprite(this.stats.body.sprite);
    if (sprite) {
      // Sprite is authored at the collider's aspect ratio; draw it to exactly
      // cover the chassis box.
      ctx.drawImage(sprite, -bw / 2, -bh / 2, bw, bh);
    } else if (isBike) {
      // Frame bar + rider
      ctx.fillStyle = color;
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.beginPath();
      ctx.arc(2, -bh / 2 - 20, 9, 0, Math.PI * 2); // helmet
      ctx.fillStyle = '#e8ecf4';
      ctx.fill();
      ctx.fillStyle = '#444';
      ctx.fillRect(-6, -bh / 2 - 14, 14, 16); // torso
    } else {
      ctx.fillStyle = color;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 6);
      ctx.fill();
      // Cabin
      ctx.fillStyle = shade(color, -25);
      const cabW = bw * 0.4, cabH = bh * 0.85;
      roundRect(ctx, -cabW / 2 - bw * 0.08, -bh / 2 - cabH, cabW, cabH, 5);
      ctx.fill();
      // Window
      ctx.fillStyle = '#bcd8ee';
      ctx.fillRect(-cabW / 2 - bw * 0.08 + 5, -bh / 2 - cabH + 5, cabW - 14, cabH - 10);
      // Headlight marks the nose (orientation readability).
      ctx.fillStyle = '#ffe28a';
      ctx.fillRect(bw / 2 - 5, -bh / 4, 5, bh / 3);
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}
