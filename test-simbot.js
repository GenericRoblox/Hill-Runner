// Shared headless driver bot for the physics regression pages
// (test-sim.html runs the whole campaign, test-world.html runs one world).
//
// Kept OUT of src/ on purpose: tools/build-platforms.ps1 ships src/ wholesale,
// and a test harness has no business in a portal build.
//
// The bot is deliberately naive — it holds gas, works the air-control toward
// level, reverses out of stalls, and parks in front of lethal timing hazards
// until it reads the opening. So its results are a LOWER BOUND on playability:
// a level it wins is beatable; one it fails may still be fine for a human.

import { PhysicsWorld } from './src/physics/PhysicsWorld.js';
import { Terrain } from './src/physics/Terrain.js';
import { Obstacles } from './src/physics/Obstacles.js';
import { Car } from './src/physics/Car.js';
import { getLevel } from './src/data/levels.js';
import { getStatsAtTiers } from './src/data/vehicles.js';

const STEP = 1000 / 60;

export const TIERS = {
  stock: { engine: 0, suspension: 0, tires: 0, brakes: 0 },
  tier1: { engine: 1, suspension: 0, tires: 0, brakes: 0 },
  tier2: { engine: 2, suspension: 1, tires: 1, brakes: 1 },
  tier3: { engine: 3, suspension: 2, tires: 2, brakes: 2 },
  maxed: { engine: 3, suspension: 3, tires: 3, brakes: 3 },
};

const WORLD_TAG = { 1: 'F', 2: 'T', 3: 'C', 4: 'M', 5: 'K', 6: 'X' };

// What is the car sitting on/next to at x? A bare "FELL at 59%" costs an hour
// of bisecting a 30,000px level; naming the feature makes the fix obvious.
function featureAt(level, x) {
  const near = [];
  for (const o of level.obstacles || []) {
    const ox = o.x ?? o.cx ?? o.ax ?? o.x0;
    if (ox != null && Math.abs(ox - x) < 500) near.push(`${o.type}@${Math.round(ox)}`);
  }
  // Pit edges: a break between two chains is a gap the car can fall into.
  const cs = level.chains;
  for (let i = 0; i < cs.length - 1; i++) {
    const a = cs[i][cs[i].length - 1], b = cs[i + 1][0];
    if (b.x - a.x > 4 && Math.abs(a.x - x) < 500) {
      near.push(`pit(${Math.round(b.x - a.x)}px)@${Math.round(a.x)}`);
    }
  }
  for (const w of level.walls || []) {
    if (Math.abs(w.cx - x) < 400) near.push(`wall${w.style ? ':' + w.style : ''}@${Math.round(w.cx)}`);
  }
  return near.length ? near.join(',') : 'open ground';
}

export function simulate(levelIndex, vehicleId = 'pickup', upgrades = TIERS.stock, worldId = 1) {
  const level = getLevel(worldId, levelIndex);
  const pw = new PhysicsWorld();
  const terrain = new Terrain(level, pw);
  const obstacles = new Obstacles(level, pw);
  const stats = getStatsAtTiers(vehicleId, upgrades);
  const car = new Car(stats, level.startX, level.startY);
  car.addTo(pw);

  let stallTime = 0, reverseUntil = -1, maxX = 0, result = 'timeout', t = 0;
  // Levels run long now (the biggest are a couple of real minutes even driven
  // flat out), so the cap is generous — a genuine soft-lock still shows up as
  // a stalled progress percentage rather than as a timeout at 100%.
  const maxSteps = 60 * 420;

  for (let i = 0; i < maxSteps; i++) {
    t = i / 60;
    const now = pw.timestamp();
    const grounded = car.groundedWheelCount(now) > 0;
    const angle = car.normAngle();

    // Lethal timing hazards ahead? Any player stops and waits for the opening
    // cue, then commits; the bot does the same (blind driving can't validate
    // these). `_cleared` latches the commit per hazard.
    let waiting = false, backOff = false, committed = false;
    for (const it of obstacles.items) {
      if (it._cleared) continue;
      if (it.type === 'ball') {
        const d = it.ax - car.position().x;
        // Park just outside the swing reach (speed-scaled braking margin): a
        // distant standstill can't cross the corridor in half a period.
        const stopZone = it.sweep + 130 + Math.max(0, car.velocity().x) * 30;
        if (d < 40 || d > stopZone) continue;
        // Go as the ball swings through centre AWAY from us — but only commit
        // once parked NEAR the corridor: latching while still braking far out
        // means the ball is back by the time we arrive.
        // Park CLOSE to the arc (not 260px back): the ball is lethal on
        // CLOSING speed now, so the crossing has to finish inside half a
        // swing, and every metre parked further out is time you don't have.
        if (d < it.sweep + 140 && Math.abs(it.ball.position.x - it.ax) < 50 && it.ball.velocity.x > 0.5) it._cleared = true;
        else waiting = true;
      } else if (it.type === 'blade') {
        // Spinning blade: the bar's low end only reaches road level within
        // ~90px of the hub, and only while the bar is near vertical. So the
        // moment an end IS down is the moment to go — that buys a full half
        // rotation of clearance to cross the hub.
        const d = it.ax - car.position().x;
        if (d < 30 || d > 380 + Math.max(0, car.velocity().x) * 38) continue;
        if (Math.abs(Math.sin(it.blade.angle)) > 0.8) { it._cleared = true; committed = true; }
        else {
          waiting = true;
          if (d < 150) backOff = true;
        }
      } else if (it.type === 'press' || it.type === 'compactor') {
        const d = it.cx - car.position().x;
        // Speed-scaled engagement, like rockfall: a fast car must start braking
        // well out or it coasts to a stop under the block.
        if (d < 40 || d > Math.max(300, (it.type === 'compactor' ? 260 : 170) + car.velocity().x * 34)) continue;
        const openFrac = (it.groundY - 14 - (it.body.position.y + it.h / 2)) / (it.clearance - 14);
        if (openFrac > 0.5 && it.body.plugin.rising) it._cleared = true;
        else {
          waiting = true;
          // Rolled to a stop under the block (e.g. braking for another hazard
          // at the same time): back out — parking there is lethal.
          if (d < 130) backOff = true;
        }
      } else if (it.type === 'rockfall' || it.type === 'scrap') {
        // Scrap chutes are rockfall with several staggered chunks: same read,
        // wait for something to hit the floor and go in behind it.
        const chunks = it.type === 'scrap' ? it.chunks.map(c => c.body) : [it.rock];
        const cx = it.type === 'scrap' ? it.x0 + it.w / 2 : it.x;
        const d = cx - car.position().x;
        // A scrap chute is a wide curtain of several staggered chunks, not one
        // boulder, so it needs to be read from further out than a rockfall.
        const stopZone = (it.type === 'scrap' ? 240 : 170) + Math.max(0, car.velocity().x) * 34;
        if (d < 40 || d > stopZone) continue;
        // Commit the moment a rock has fallen past the road line: the next one
        // is a full period + fall-time away.
        if (chunks.some(r => !r.isStatic && r.position.y > it.groundY + 60)) { it._cleared = true; committed = true; }
        else {
          waiting = true;
          // Parked under the chute is lethal AND leaves no run-up — back up.
          if (d < 300) backOff = true;
        }
      } else if (it.type === 'fireball' || it.type === 'arrows') {
        const d = it.x - car.position().x;
        // Once armed, stay engaged until committed: the speed-scaled zone alone
        // causes a stop/re-accelerate seesaw that creeps the car right onto the
        // hazard's lip or curtain edge.
        const stopZone = 220 + Math.max(0, car.velocity().x) * 32;
        if (d < 40) continue;
        if (d > stopZone && !it._seen) continue;
        it._seen = true;
        // Parked too far back (after a long reverse): creep forward into the
        // parking band — but never skip braking on a hot arrival.
        if (d > 420 && car.velocity().x < 3) continue;
        let go;
        if (it.type === 'fireball') {
          // Primary commit: the fireball is parked with most of the pause ahead
          // AND we're close — either stopped (a full run-up fits) or already
          // fast (carry through). The dive-commit has only ~0.9s of margin, so
          // it's reserved for close-and-fast carry-throughs; mid speeds always
          // brake to a stop first.
          const fb = it.ball;
          const vx = car.velocity().x;
          const frac = ((now / 1000) / it.period + it.phase) % 1;
          const dive = !fb.isStatic && fb.velocity.y > 0.5 && fb.position.y > it.groundY + 30;
          go = (dive && d < 380 && vx > 11)
            || (fb.isStatic && (1 - frac) * it.period > 1.15 && d < 420 && (vx < 6 || vx > 11));
        } else {
          // Go right as a volley ends — a full lull to cross in.
          const p = ((now / 1000) / it.period + it.phase) % 1;
          go = p > it.rainFrac && p < it.rainFrac + 0.15;
        }
        if (go && car.velocity().x > -0.5) { it._cleared = true; committed = true; } // never commit mid-reverse
        else {
          waiting = true;
          if (d < 310) backOff = true;
        }
      }
    }

    // --- simple driver bot ---
    if (committed) reverseUntil = -1; // a commit cancels any pending back-off
    let inp = { gas: false, brake: false };
    if (t < reverseUntil) {
      inp.brake = true; // reversing out of a stall
    } else if (!grounded) {
      if (angle > 0.22) inp.gas = true;         // nose dipping: pull up
      else if (angle < -0.22) inp.brake = true; // nose too high: push down
    } else if (waiting) {
      inp.brake = car.velocity().x > 1.0; // stop short, don't reverse
      if (backOff && !inp.brake) reverseUntil = t + 0.5;
      stallTime = 0;
    } else {
      inp.gas = true;
      // Stall detection: grounded, throttle on, but not moving -> back up for a run-up.
      if (car.speed() < 0.6) {
        stallTime += 1 / 60;
        if (stallTime > 1.2) { reverseUntil = t + 1.4; stallTime = 0; }
      } else stallTime = 0;
    }

    const verdict = car.update(inp, 1 / 60, now);
    pw.step(STEP);
    maxX = Math.max(maxX, car.position().x);

    if (verdict) { result = verdict.toUpperCase(); break; }
    if (car.position().y > level.deathY) { result = 'FELL'; break; }
    if (car.position().x > level.finishX) { result = 'WIN'; break; }
  }

  const pct = Math.round(100 * maxX / level.finishX);
  const endX = car.position().x;
  const why = result === 'WIN' ? '' : `  <- at x=${Math.round(endX)} near ${featureAt(level, endX)}`;
  car.removeFrom(pw); obstacles.destroy(); terrain.destroy(); pw.destroy();
  const tag = Object.values(upgrades).some(v => v > 0)
    ? ` [${vehicleId} e${upgrades.engine}s${upgrades.suspension}t${upgrades.tires}b${upgrades.brakes}]`
    : ` [${vehicleId} stock]`;
  return `${WORLD_TAG[worldId] || worldId}${levelIndex + 1}${tag} "${level.name}": ${result} ` +
         `t=${t.toFixed(1)}s progress=${pct}% (finishX=${Math.round(level.finishX)}, ` +
         `target=${level.targetTime}s, airTime=${car.airTime.toFixed(1)}s)${why}`;
}

// Suspension sanity: a car standing still for 2s should settle with its chassis
// above the wheel centres.
export function settleCheck() {
  const level = getLevel(1, 0);
  const pw = new PhysicsWorld();
  const terrain = new Terrain(level, pw);
  const stats = getStatsAtTiers('pickup', TIERS.stock);
  const car = new Car(stats, level.startX, level.startY);
  car.addTo(pw);
  for (let i = 0; i < 120; i++) { car.update({ gas: false, brake: false }, 1 / 60, pw.timestamp()); pw.step(STEP); }
  const clearance = car.wheels[0].position.y - car.chassis.position.y;
  const out = `SETTLE: chassis is ${clearance.toFixed(1)}px above wheel centers (expect ~15-35), ` +
              `chassisY=${car.chassis.position.y.toFixed(0)}, angle=${car.normAngle().toFixed(3)}`;
  car.removeFrom(pw); terrain.destroy(); pw.destroy();
  return out;
}
