// Infinite mode: per-theme procedural chunk generation + economy.
//
// Chunks are authored with the SAME LevelBuilder the hand-made levels use, so
// every obstacle def and terrain chain has exactly the shape Terrain/Obstacles
// expect. Each "feature" lays its own approach flat, hazard, and recovery
// ground (the spacing rules from CLAUDE.md are baked into the features), so
// features can be concatenated in any order without overlapping.
//
// Difficulty d grows with distance (0 at the start line, 1 at ~1.2km, creeping
// to 1.6): gaps widen, presses/compactors/fireballs cycle faster, hills grow.

import { LevelBuilder } from './levels.js';

export const PX_PER_M = 22;      // ~4m car is ~90px wide
export const MILESTONE_M = 500;  // coin checkpoint spacing (meters)
export const BASELINE_Y = 600;

// Theme configs: unlock cost, payout multiplier (harder worlds pay more),
// and a short blurb for the select screen.
export const INFINITE_THEMES = [
  { id: 1, cost: 0, payMult: 1.0, blurb: 'Rolling hills, hay ramps and frequent gaps.' },
  { id: 2, cost: 400, payMult: 1.15, blurb: 'Streets, potholes, trees and oily corners.' },
  { id: 3, cost: 900, payMult: 1.3, blurb: 'Wrecking balls, presses and canal jumps.' },
  { id: 4, cost: 1600, payMult: 1.5, blurb: 'Rockfalls, lava veins and thin ice.' },
  { id: 5, cost: 2400, payMult: 1.7, blurb: 'Fireballs, spikes and archer volleys.' },
  { id: 6, cost: 3200, payMult: 2.0, blurb: 'Compactors, conveyors and spinning steel.' },
];

export function getInfiniteTheme(id) {
  return INFINITE_THEMES.find(t => t.id === id);
}

// Milestone k (1 = 500m, 2 = 1000m, ...) pays more the farther you get.
export function milestoneCoins(k, payMult) {
  return Math.round((80 + 40 * k) * payMult);
}

export const FLIP_COINS = 15;      // per full airborne rotation (× payMult)
export const AIR_COINS_PER_S = 4;  // air-time trickle (× payMult, capped 60s)

export function difficultyAt(x) {
  // Full difficulty lands while the first tank of fuel is still fresh
  // (~1.2km), then keeps creeping — an endless run should never go stale.
  return Math.max(0, Math.min(1.6, x / (PX_PER_M * 1200)));
}

// Deterministic small RNG so a run's world is reproducible from its seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Coherent elevation noise ---------------------------------------------------
// Multi-octave value noise drives the long-range elevation profile: terrain
// climbs mountains and drops into valleys instead of hugging the baseline.
// Each theme sets octaves ([wavelength, amplitude] pairs) and a walking style:
//   'smooth'   — the ground chases the profile in short steps (rolling bumps)
//   'terraced' — flat shelves joined by straight constant-grade ramps
// Farm/Mines stack a short-wavelength octave for extra bumpiness; City and
// Factory use single long waves so roads read as grades between flats.

function hash1(i, seed) {
  let t = (Math.imul(i, 374761393) + Math.imul(seed, 668265263)) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, wav, seed) {
  const i = Math.floor(x / wav);
  const f = x / wav - i;
  const e = (1 - Math.cos(Math.PI * f)) / 2; // cosine ease between lattice points
  return (hash1(i, seed) * (1 - e) + hash1(i + 1, seed) * e) * 2 - 1; // -1..1
}

const THEME_TERRAIN = {
  1: { style: 'smooth', maxGrade: 0.58, octaves: [[2600, 270], [900, 125], [340, 50]] }, // Farm: bounciest
  2: { style: 'smooth', maxGrade: 0.50, octaves: [[2600, 240], [1000, 85]] },            // Town: mellow rolls
  3: { style: 'terraced', grade: 0.42, threshold: 60, flat: [220, 520], octaves: [[3000, 310]] }, // City: ramp → flat
  4: { style: 'smooth', maxGrade: 0.62, octaves: [[2300, 290], [750, 135], [300, 58]] }, // Mines: rugged
  5: { style: 'smooth', maxGrade: 0.55, octaves: [[2700, 260], [900, 100]] },            // Castle: broad ramparts
  6: { style: 'terraced', grade: 0.32, threshold: 85, flat: [300, 640], octaves: [[3400, 220]] }, // Factory: flattest
};

// Elevation profile for a run: world-x → target surface y. Anchored so the
// profile passes ~through the baseline at the spawn runway (x ≈ 900), but the
// anchor's influence FADES over the first ~5km — subtracting it outright
// biases the whole run to one side of the baseline (whatever the noise
// happened to read at x=900), and the terrain should range both high and low.
export function makeElevation(themeId, seed) {
  const t = THEME_TERRAIN[themeId] || THEME_TERRAIN[1];
  const raw = (x) => {
    let v = 0;
    for (let k = 0; k < t.octaves.length; k++) {
      const [wav, amp] = t.octaves[k];
      v += valueNoise(x, wav, (seed + k * 7919) | 0) * amp;
    }
    return v;
  };
  const anchor = raw(900);
  return (x) => {
    const fade = Math.max(0, 1 - x / 5000);
    // Ease the amplitude in over the first ~1km so a stock car isn't handed
    // a mountain range straight off the start line.
    const ampRamp = 0.45 + 0.55 * Math.min(1, x / (PX_PER_M * 1000));
    return BASELINE_Y - (raw(x) - anchor * fade) * ampRamp;
  };
}

// Walk the ground from b.x for `w` px, chasing the elevation profile in the
// theme's style. Grades are capped below the ~40° friction limit so every
// climb stays drivable.
function layGround(b, w, ctx) {
  const t = ctx.terrain;
  const endX = b.x + w;
  if (t.style === 'terraced') {
    let guard = 0;
    while (b.x < endX - 1 && guard++ < 24) {
      const flatLen = Math.min(endX - b.x, t.flat[0] + ctx.rng() * (t.flat[1] - t.flat[0]));
      const target = ctx.profile(b.x + flatLen + 260);
      const dy = target - b.y;
      if (Math.abs(dy) > t.threshold) {
        b.flat(Math.min(flatLen, 260));
        b.slope(Math.max(160, Math.abs(dy) / t.grade), dy, 1); // 1 segment = straight ramp
      } else {
        b.flat(flatLen);
      }
    }
  } else {
    const step = 52;
    let guard = 0;
    while (b.x < endX - 1 && guard++ < 200) {
      const dx = Math.min(step, endX - b.x);
      const maxDy = dx * t.maxGrade;
      const dy = Math.max(-maxDy, Math.min(maxDy, ctx.profile(b.x + dx) - b.y));
      b.slope(dx, dy, 1);
    }
  }
}

// --- Feature library -----------------------------------------------------------
// Each feature: (b, d, rng, ctx) → lays complete ground. `d` is clamped 0..1
// for interpolation but the raw value keeps creeping past 1 for widths.
// ctx = { profile, terrain, rng } — the run's coherent-noise elevation.

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const r = (rng, lo, hi) => lo + rng() * (hi - lo);

// Open terrain: ride the theme's noise profile for a stretch. This is the
// filler between hazards — hazard features keep their own literal flats.
function terrainRun(b, d, rng, ctx) {
  layGround(b, r(rng, 500, 1100), ctx);
}

// Jump over a pit. Small gaps get a terrain lip; big ones (later runs) get a
// wooden ramp — "ramps next to larger jumps".
function gapJump(b, d, rng) {
  const g = 110 + (70 + 150 * rng()) * Math.min(1.3, d + 0.15);
  b.flat(r(rng, 180, 300));
  if (g > 200) {
    const rampH = 62 + g * 0.1;
    b.ramp(170, rampH);
    b.flat(175);
    b.gap(g, 95);
    b.slope(200, -55);
  } else {
    b.slope(150, -40);
    b.gap(g, 80);
    b.slope(200, -40);
  }
  b.flat(r(rng, 320, 460)); // landing-float recovery
}

// Farm/town classic: launch ramp through a hole in a wall. Needs a real
// run-up — arriving slow means bouncing off the wall until the player backs
// up for another go (or the out-of-steam watchdog calls it).
function rampWall(b, d, rng) {
  b.flat(420);
  const rx = b.x + 40, gy = b.y;
  b.flat(40);
  b.ramp(180, 80);
  b.flat(350 + 600); // ground under ramp, wall and landing
  b.wallAt(rx + 350, gy - 30, 28, 60);          // bottom stub (holeLo 60)
  b.wallAt(rx + 350, gy - 245 - 150, 28, 300);  // upper wall (holeHi 245)
}

function seesaw(b, d, rng) {
  b.flat(80);
  b.seesaw(380, 55);
  b.flat(460);
}

function mudDip(b, d, rng) {
  b.mudDip(lerp(240, 360, d), lerp(45, 75, d));
  b.flat(r(rng, 150, 250));
}

function tree(b, d, rng) {
  b.flat(120);
  b.tree(140, lerp(125, 95, d));
  b.flat(560);
}

function speedBumps(b, d, rng) {
  const count = 3 + (3 * Math.min(1, d) * rng() | 0);
  b.speedBumps(count, 130, 13);
  b.flat(count * 130 + 160);
}

function pothole(b, d, rng) {
  b.flat(r(rng, 150, 260));
  b.pothole(70, 24);
  b.flat(r(rng, 150, 260));
}

function oilSlick(b, d, rng) {
  const w = r(rng, 160, 300);
  const push = rng() < 0.25 + 0.35 * Math.min(1, d) ? -1 : 1;
  b.oilSlick(w, push);
  b.flat(w + 120);
}

function wreckingBall(b, d, rng) {
  b.flat(220);
  b.wreckingBall(280, 330, 42, lerp(0.7, 1.15, d));
  b.flat(580);
}

function press(b, d, rng) {
  b.flat(160);
  b.press(120, 100, lerp(195, 155, d), lerp(3.6, 2.3, d), rng());
  b.flat(400);
}

// Fan on flat road: an air-time (and flip-coin) fountain rather than a hazard.
function fanBoost(b, d, rng) {
  b.flat(100);
  b.fan(60, 140, 440, 2.7, 0);
  b.flat(340);
}

function water(b, d, rng) {
  b.flat(r(rng, 220, 340));
  b.slope(160, -40);
  b.water(lerp(200, 340, d));
  b.slope(160, 40);
  b.flat(r(rng, 300, 420));
}

function ropeBridge(b, d, rng) {
  b.flat(120);
  b.ropeBridge(lerp(280, 380, d));
  b.flat(240);
}

function rockfall(b, d, rng) {
  b.flat(620); // braking room (bot brakes from ~170 + vx·30 out)
  b.rockfallPit(lerp(200, 300, d), { period: lerp(3.0, 2.0, d), phase: rng() });
  b.slope(160, -45);
  b.flat(260);
}

function crumbleBridge(b, d, rng) {
  b.flat(200);
  b.crumbleBridge(lerp(260, 400, d));
  b.flat(260);
}

function moltenPit(kind) {
  return (b, d, rng) => {
    b.flat(700); // molten pits need a long flat approach
    b.slope(150, -35);
    b.moltenPit(lerp(200, 330, d), kind);
    b.slope(150, -35);
    b.flat(300);
  };
}

function icePatch(b, d, rng) {
  b.flat(180);
  b.icePatch(lerp(300, 520, d));
  b.flat(240);
}

function jumpHole(b, d, rng) {
  b.flat(600); // clean flat approach — teeth sit at float height
  b.jumpHole(200, lerp(150, 130, d), 90);
  b.flat(420);
  b.slope(240, -70); // climb back toward the baseline
  b.flat(160);
}

function tireStack(b, d, rng) {
  b.flat(150);
  b.tireStack(190, 140);
  b.flat(480);
}

function fireball(b, d, rng) {
  b.flat(720); // braking must finish short of the lip
  b.fireballPit(lerp(220, 340, d), { period: lerp(3.8, 2.7, d), phase: rng() });
  b.slope(150, -35);
  b.slope(150, -35);
  b.flat(300);
}

function spikeRamp(b, d, rng) {
  b.flat(200);
  b.ramp(160, lerp(58, 80, d));
  b.spikeStrip(180, lerp(110, 170, d)); // lip sits ~20px before the strip
  b.flat(1150); // launch float carries ~850 past the lip
}

function arrowVolley(b, d, rng) {
  b.flat(260);
  b.arrowVolley(60, 150, lerp(2.8, 1.9, d), rng(), lerp(0.32, 0.46, d));
  b.flat(900); // ~1000px before the next timing hazard
}

function spikyBall(b, d, rng) {
  b.flat(200);
  b.spikyBall(260, 270, 36, lerp(0.85, 1.25, d));
  b.flat(520);
}

function beam(b, d, rng) {
  b.flat(220);
  b.beam(260, 300);
  b.flat(560);
}

function compactor(b, d, rng) {
  b.flat(200);
  b.compactor(140, 190, lerp(270, 210, d), lerp(4.4, 2.7, d), rng());
  b.flat(460);
}

function conveyor(b, d, rng) {
  const w = r(rng, 280, 480);
  const speed = (rng() < 0.3 + 0.3 * Math.min(1, d) ? -1 : 1) * lerp(3, 6, d);
  b.conveyor(w, speed);
  b.flat(w + 140);
}

function spring(b, d, rng) {
  b.flat(160);
  b.spring(170, 110, lerp(15, 19, d));
  b.flat(760); // long clear landing zone
}

function blade(b, d, rng) {
  b.flat(260);
  b.spinBlade(300, { height: 260, omega: lerp(2.2, 4.2, d), phase: rng() * 6 });
  b.flat(700);
}

function fallingScrap(b, d, rng) {
  b.flat(520);
  b.fallingScrap(lerp(220, 340, d), { period: lerp(2.9, 2.0, d), phase: rng() });
  b.slope(160, -40);
  b.flat(280);
}

function sludgeVat(b, d, rng) {
  b.flat(160);
  // Width ≥ ~4.4× depth keeps the vat's sine walls under the drivable grade.
  b.sludgeVat(lerp(470, 580, d), 105);
  b.flat(280);
}

function pipeRun(b, d, rng) {
  b.flat(120);
  b.pipeStart(100);
  b.flat(r(rng, 380, 620));
  b.pipeEnd();
  b.flat(220);
}

// --- Theme tables --------------------------------------------------------------
// [feature, weight] pools. Terrain character per theme: Farm rolls, Factory
// stays flat with occasional grade changes, Mines is rugged, etc.

const THEME_FEATURES = {
  1: [ // Farm: bounciest noise, frequent gaps, hay ramps and wall holes
    [terrainRun, 6.5], [gapJump, 3.2], [rampWall, 1], [seesaw, 1],
    [mudDip, 1.6], [tree, 1.2], [speedBumps, 0.7], [ropeBridge, 0.8],
  ],
  2: [ // Town: mellow rolls, potholes, trees, oil
    [terrainRun, 5.5], [pothole, 1.8], [speedBumps, 1.8], [tree, 1.5],
    [oilSlick, 1.6], [gapJump, 2.2], [seesaw, 1], [rampWall, 0.7], [water, 0.5],
  ],
  3: [ // City: terraced grades, heavy steel and canals
    [terrainRun, 6], [oilSlick, 1.8], [wreckingBall, 1.6], [press, 1.6],
    [fanBoost, 1.1], [water, 1.3], [gapJump, 1.8], [speedBumps, 0.9],
  ],
  4: [ // Mines: rugged rock, rockfalls, lava, ice
    [terrainRun, 5.5], [rockfall, 1.5], [crumbleBridge, 1.2],
    [moltenPit('lava'), 1.2], [icePatch, 1.3], [jumpHole, 0.7],
    [tireStack, 1], [gapJump, 1.7],
  ],
  5: [ // Castle: broad ramparts, fire and steel
    [terrainRun, 5], [fireball, 1.3], [spikeRamp, 1.1], [arrowVolley, 1.2],
    [spikyBall, 1.3], [beam, 0.8], [gapJump, 1.7], [moltenPit('lava'), 0.7],
  ],
  6: [ // Factory: flattest terraces, machines everywhere
    [terrainRun, 7], [compactor, 1.6], [conveyor, 1.8], [spring, 1.2],
    [blade, 1.3], [fallingScrap, 1], [sludgeVat, 1], [pipeRun, 0.8],
    [press, 1], [gapJump, 1.2],
  ],
};

function pickFeature(pool, rng) {
  let total = 0;
  for (const [, w] of pool) total += w;
  let roll = rng() * total;
  for (const [fn, w] of pool) {
    roll -= w;
    if (roll <= 0) return fn;
  }
  return pool[0][0];
}

// --- Chunk generation ----------------------------------------------------------

// The very first chunk: a plain flat runway from x=0 (spawn is at x=150).
// makeElevation anchors the profile near the baseline at the runway's end.
export function generateIntroChunk(themeId, rng, profile) {
  const b = new LevelBuilder(0, BASELINE_Y);
  b.flat(900);
  return finishChunk(b);
}

// One streamed chunk (~2200px+ of features) starting at (x0, y0). `profile`
// is the run's makeElevation() function — open ground chases it, hazard
// features stay level wherever the terrain happens to be.
export function generateChunk(themeId, x0, y0, d, rng, profile) {
  const b = new LevelBuilder(x0, y0);
  const pool = THEME_FEATURES[themeId] || THEME_FEATURES[1];
  const ctx = { profile, terrain: THEME_TERRAIN[themeId] || THEME_TERRAIN[1], rng };
  const targetLen = 2200 + rng() * 900;
  let guard = 0;
  while (b.x - x0 < targetLen && guard++ < 12) {
    pickFeature(pool, rng)(b, d, rng, ctx);
  }
  // Land every chunk on a stretch of flat so the next chunk's feature gets a
  // sane entry no matter what just happened.
  b.flat(260);
  return finishChunk(b);
}

function finishChunk(b) {
  const out = b.finish({});
  // Lowest ground in the chunk — the run screen keeps its death line a fixed
  // margin below the deepest LIVE terrain, since valleys now run deep.
  let maxY = BASELINE_Y;
  for (const chain of out.chains) {
    for (const p of chain) if (p.y > maxY) maxY = p.y;
  }
  return {
    chains: out.chains,
    walls: out.walls,
    obstacles: out.obstacles,
    buildings: out.buildings,
    endX: b.x,
    endY: b.y,
    maxY,
  };
}
