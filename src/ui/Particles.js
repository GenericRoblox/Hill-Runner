// Tire spray: debris chunks kicked up behind spinning wheels, matched to the
// surface being driven on. Purely visual — simulated with cheap Euler steps
// outside the physics engine, so it can never affect the sim or the bot.

import { texChunks } from './Textures.js';

const MAX_PARTICLES = 240;
const GRAVITY = 1150; // px/s² — heavier than the floaty car so spray arcs read snappy
const DRAG = 1.6;     // /s horizontal damping

// How much a surface sheds per radian of wheel rotation (`rate`), how big the
// chunks are (`size`, px) and how hard they pop upward (`pop`). Softer surface
// ⇒ more + bigger chunks: mud sheds heavily, paved roads barely at all.
// `sources` are [tile, tint] pairs fed to texChunks so chunks match the drawn
// surface stripe; a profile with `colors` skips textures for flat flecks (ice).
const STRIPE_PROFILES = {
  grass:    { rate: 0.40, size: [4, 8],    pop: 1.25, mixDirt: true, fallback: '#5d8a3a' },
  mud:      { rate: 0.50, size: [4, 8],    pop: 1.1,  mixDirt: true, fallback: '#8a7150' },
  concrete: { rate: 0.07, size: [2.5, 4.5], pop: 0.8,  fallback: '#8b9099' },
  pavement: { rate: 0.09, size: [2.5, 5],  pop: 0.8,  fallback: '#87828f' },
};

// Mud-patch chains are the softest surface in the game; tint matches the
// stripe GameScreen._drawTerrain paints on them.
const MUD_PATCH = {
  rate: 0.95, size: [6, 11], pop: 1.5,
  sources: [['mud', '#6b4a2a']], fallback: '#4a3520',
};
const ICE = {
  rate: 0.12, size: [2, 4], pop: 0.7,
  colors: ['#eaf6fc', '#b9dcea', '#ffffff'], fallback: '#eaf6fc',
};

// Resolve the three profiles a run can hit (world-default surface, mud patch,
// ice) from the world's stripe texture. Grass mixes green tufts with dirt
// clods 50/50; the Mines' dusty mud stripe does the same.
export function buildTireProfiles(worldDef) {
  const stripe = (worldDef.tex && worldDef.tex.stripe) || ['grass', null];
  const base = STRIPE_PROFILES[stripe[0]] || STRIPE_PROFILES.grass;
  const sources = [[stripe[0], stripe[1]]];
  if (base.mixDirt) sources.push(['dirt', null]);
  return {
    normal: { ...base, sources },
    mud: MUD_PATCH,
    ice: ICE,
  };
}

export class ParticleSystem {
  constructor() {
    this.parts = [];
    this.budgets = new Map(); // wheel body id → fractional emission carry-over
  }

  // `spin` is the wheel's angular velocity in Matter units (rad per 16.6ms
  // step). Fractional emission accumulates across steps so slow rolling on a
  // hard surface still sheds the occasional fleck.
  emitTireSpray(wheel, spin, prof) {
    const abs = Math.abs(spin);
    let budget = (this.budgets.get(wheel.id) || 0) + abs * prof.rate;
    const dir = spin > 0 ? 1 : -1;
    const r = wheel.circleRadius;
    const rim = abs * r * 60; // rim surface speed, px/s
    while (budget >= 1) {
      budget -= 1;
      this._spawn(wheel, dir, r, rim, prof);
    }
    this.budgets.set(wheel.id, budget);
  }

  _spawn(wheel, dir, r, rim, prof) {
    const src = prof.sources && prof.sources[(Math.random() * prof.sources.length) | 0];
    const chunks = src && texChunks(src[0], src[1]);
    const size = prof.size[0] + Math.random() * (prof.size[1] - prof.size[0]);
    // Thrown opposite the rim's contact-point motion: driving right (spin > 0)
    // flings roost backward-left and up, like the wheel is grabbing the road.
    const vx = -dir * rim * (0.12 + Math.random() * 0.28);
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push({
      x: wheel.position.x - dir * r * 0.35 + (Math.random() - 0.5) * 8,
      y: wheel.position.y + r * (0.55 + Math.random() * 0.35),
      vx: Math.max(-520, Math.min(520, vx)) + (Math.random() - 0.5) * 50,
      vy: -(30 + Math.random() * 150 + rim * 0.07 * Math.random()) * prof.pop,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 14,
      size,
      age: 0,
      life: 0.45 + Math.random() * 0.35,
      sprite: chunks ? chunks[(Math.random() * chunks.length) | 0] : null,
      color: prof.colors
        ? prof.colors[(Math.random() * prof.colors.length) | 0]
        : prof.fallback,
    });
  }

  update(dt) {
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      p.vy += GRAVITY * dt;
      p.vx *= Math.max(0, 1 - DRAG * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
  }

  render(ctx) {
    for (const p of this.parts) {
      const t = p.age / p.life;
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.sprite) {
        ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
