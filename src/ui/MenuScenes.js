// Authentic per-world level-select backdrops. Instead of faking scenery with
// CSS, each scene is a compact level authored with the real LevelBuilder and
// drawn every frame with the game's own terrain textures and the real
// physics/Obstacles set-piece renderer — so the moving parts (presses,
// compactors, wrecking balls, fireballs, rockfalls) animate exactly as in-game.

import { LevelBuilder } from '../data/levels.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Obstacles } from '../physics/Obstacles.js';
import { texPattern } from './Textures.js';

const GROUND_Y = 600;
const STEP_MS = 1000 / 60;

// Flat textured ground carrying a few of the world's signature set-pieces,
// spread out so any viewport width lands on something. Obstacles that need a
// car or rider (lifts, crumble bridges, standing beams) are avoided — every
// piece here animates, swings or sits correctly with no car present.
const SCENES = {
  1: (b) => b.flat(520).ramp(170, 92).flat(300).speedBumps(3, 120).flat(430)
             .seesaw(340).flat(430).tree(150).flat(520),
  2: (b) => b.flat(520).speedBumps(3, 120).flat(360).ramp(150, 80).flat(320)
             .tree(130).flat(320).ropeBridge(240).flat(460),
  3: (b) => b.flat(560).oilSlick(150).flat(230).wreckingBall(120, 340).flat(360)
             .press(40).flat(340).fan(130, 150, 360).flat(520),
  4: (b) => b.flat(540).tireStack(130).flat(320).rockfallPit(220, { period: 2.6 })
             .slope(160, -45).flat(320).moltenPit(200, 'lava').slope(150, -35).flat(460),
  5: (b) => b.flat(540).spikeStrip(80, 130).flat(320).spikyBall(150, 280).flat(360)
             .fireballPit(200, { period: 3.0 }).slope(150, -35).flat(320)
             .arrowVolley(120, 150, 2.4).flat(460),
  6: (b) => b.flat(540).conveyor(200, 4).flat(220).compactor(60).flat(380)
             .press(40).flat(340).moltenPit(200, 'acid').slope(150, -35).flat(460),
};

export class WorldScene {
  constructor(world) {
    this.world = world;
    const b = new LevelBuilder(0, GROUND_Y);
    (SCENES[world.id] || SCENES[1])(b);
    this.level = b.finish({ deathY: GROUND_Y + 420 });
    const pts = this.level.chains.flat();
    this.camX = (pts[0].x + pts[pts.length - 1].x) / 2; // centre on the run

    this.physics = new PhysicsWorld();
    this.obstacles = new Obstacles(this.level, this.physics);

    this.el = document.createElement('canvas');
    this.el.className = 'world-scene';
    this.ctx = this.el.getContext('2d');
    this.acc = 0;
    this._reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    // Reduced motion: settle the movers into an interesting static pose once,
    // then never step again (update() only repaints).
    if (this._reduce) { for (let i = 0; i < 90; i++) this.physics.step(STEP_MS); }
    this._draw();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.el.width = Math.round(this.w * this.dpr);
    this.el.height = Math.round(this.h * this.dpr);
    if (this._reduce) this._draw();
  }

  update(dt) {
    if (this._reduce) return; // static pose already drawn
    this.acc = Math.min(this.acc + dt, STEP_MS * 5);
    while (this.acc >= STEP_MS) { this.physics.step(STEP_MS); this.acc -= STEP_MS; }
    this._draw();
  }

  _draw() {
    const { ctx, w, h, dpr } = this;
    const wl = this.world;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, wl.sky[0]);
    sky.addColorStop(1, wl.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const S = Math.max(0.5, Math.min(0.92, h / 1050));
    ctx.save();
    ctx.translate(w / 2, h * 0.82);
    ctx.scale(S, S);
    ctx.translate(-this.camX, -GROUND_Y);
    this._drawTerrain(ctx);
    this._drawWalls(ctx);
    this.obstacles.render(ctx, { x: this.camX, y: 0 });
    this.obstacles.renderOverlay(ctx);
    ctx.restore();

    // Legibility veil — gentle, heavier toward the busy foreground.
    const veil = ctx.createLinearGradient(0, 0, 0, h);
    veil.addColorStop(0, 'rgba(12,17,28,0.06)');
    veil.addColorStop(0.55, 'rgba(12,17,28,0.02)');
    veil.addColorStop(1, 'rgba(12,17,28,0.24)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
  }

  // Mirrors GameScreen/EditorScreen terrain fill + surface stripe.
  _drawTerrain(ctx) {
    const wl = this.world;
    const bottom = this.level.deathY + 300;
    const tex = wl.tex || {};
    const groundPat = tex.ground && texPattern(tex.ground[0], tex.ground[1], tex.ground[2] || 260);
    const stripePat = tex.stripe && texPattern(tex.stripe[0], tex.stripe[1], 140);
    const mudPat = texPattern('mud', '#6b4a2a', 160);
    for (const chain of this.level.chains) {
      ctx.beginPath();
      ctx.moveTo(chain[0].x, bottom);
      for (const p of chain) ctx.lineTo(p.x, p.y);
      ctx.lineTo(chain[chain.length - 1].x, bottom);
      ctx.closePath();
      ctx.fillStyle = groundPat || wl.groundColor;
      ctx.fill();

      ctx.beginPath();
      chain.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.strokeStyle = chain.surface === 'mud' ? (mudPat || '#4a3520')
        : chain.surface === 'ice' ? '#b9dcea'
        : (stripePat || wl.grassColor);
      ctx.stroke();
      if (chain.surface === 'ice') {
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.stroke();
      }
    }
  }

  _drawWalls(ctx) {
    const woodPat = texPattern('wood', '#c9985e', 170);
    for (const wall of this.level.walls) {
      ctx.save();
      ctx.translate(wall.cx, wall.cy);
      ctx.fillStyle = woodPat || '#8a6b42';
      ctx.fillRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
      ctx.strokeStyle = '#5e4626';
      ctx.lineWidth = 3;
      ctx.strokeRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
      ctx.restore();
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.obstacles.destroy();
    this.physics.destroy();
    this.el.remove();
  }
}
