// Dynamic level set-pieces: wooden launch ramps (static), seesaws (plank on a
// pin constraint), rope bridges (plank chain linked by stiff short constraints,
// anchored to the pit edges), speed bumps (half-buried discs), and trees whose
// canopies are sensors that snag airborne cars (Car.js applies the damping).
// All drivable surfaces are labeled 'terrain' so PhysicsWorld's contact
// tracking treats them as ground; canopies are labeled 'canopy'.

const { Bodies, Body, Constraint, Events } = Matter;

import { texPattern, texUpright } from '../ui/Textures.js';

function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export class Obstacles {
  constructor(level, world) {
    this.world = world;
    this.engine = world.engine;
    this.deathY = level.deathY;
    this.items = [];   // per-obstacle render data
    this.all = [];     // every body + constraint added, for teardown
    this.movers = [];  // kinematic bodies driven each physics step

    for (const def of level.obstacles || []) {
      if (def.type === 'ramp') this._ramp(def);
      else if (def.type === 'seesaw') this._seesaw(def);
      else if (def.type === 'ropebridge') this._ropeBridge(def);
      else if (def.type === 'bumps') this._bumps(def);
      else if (def.type === 'tree') this._tree(def);
      else if (def.type === 'oil') this._oil(def);
      else if (def.type === 'fan') this._fan(def);
      else if (def.type === 'water') this._water(def);
      else if (def.type === 'ball') this._ball(def);
      else if (def.type === 'press') this._press(def);
      else if (def.type === 'lift') this._lift(def);
      else if (def.type === 'rockfall') this._rockfall(def);
      else if (def.type === 'crumble') this._crumble(def);
      else if (def.type === 'molten') this._molten(def);
      else if (def.type === 'stalactite') this._stalactite(def);
      else if (def.type === 'bouncer') this._bouncer(def);
      else if (def.type === 'fireball') this._fireball(def);
      else if (def.type === 'spikes') this._spikes(def);
      else if (def.type === 'beam') this._beam(def);
      else if (def.type === 'arrows') this._arrows(def);
    }
    for (const thing of this.all) world.add(thing);

    // Kinematic motion runs inside the physics step so it works identically
    // in the game loop and in test-sim.
    this._tick = () => this._updateMovers();
    if (this.movers.length) Events.on(this.engine, 'beforeUpdate', this._tick);
  }

  _updateMovers() {
    const now = this.engine.timing.timestamp;
    for (const m of this.movers) {
      if (m.kind === 'press') {
        // Sinusoidal cycle: openness 0 = slammed shut, 1 = full clearance.
        const p = ((now / 1000) / m.period + m.phase) % 1;
        const openness = 0.5 - 0.5 * Math.cos(Math.PI * 2 * p);
        const bottom = m.groundY - 14 - (m.clearance - 14) * openness;
        const y = bottom - m.h / 2;
        // Descending block crushes (PhysicsWorld marks lethal contact);
        // a parked/rising block is just a wall you can wait against.
        m.body.plugin.crushing = y - m.body.position.y > 0.4;
        m.body.plugin.rising = y - m.body.position.y < -0.4;
        Body.setPosition(m.body, { x: m.body.position.x, y });
      } else if (m.kind === 'lift') {
        // Rider-triggered elevator: parked at road level, rises while ridden
        // (PhysicsWorld stamps plugin.lastRider), returns shortly after.
        if (now - (m.body.plugin.lastRider ?? -Infinity) < 150) m.holdUntil = now + 1200;
        const target = now < m.holdUntil ? m.yTop : m.yBot;
        const speed = target < m.body.position.y ? 3.2 : 2.0; // brisk up, gentle down
        const y = approach(m.body.position.y, target, speed);
        Body.setPosition(m.body, { x: m.body.position.x, y });
      } else if (m.kind === 'rock') {
        // Rockfall boulder: parked static in its ceiling chute, released on a
        // period cycle, then reset once it has fallen well past the pit mouth.
        const cyc = Math.floor((now / 1000) / m.period + m.phase);
        if (m.cycle === null) m.cycle = cyc; // don't drop on the very first tick
        if (m.body.isStatic) {
          if (cyc > m.cycle) { m.cycle = cyc; Body.setStatic(m.body, false); }
        } else if (m.body.position.y > m.groundY + 300) {
          Body.setStatic(m.body, true);
          Body.setPosition(m.body, { x: m.x, y: m.topY });
          Body.setVelocity(m.body, { x: 0, y: 0 });
          Body.setAngularVelocity(m.body, 0);
          m.cycle = cyc; // full pause before the next drop even if a cycle elapsed mid-fall
        }
      } else if (m.kind === 'fireball') {
        // Leaps from the lava on a period cycle, arcs, and dives back in.
        // It's a dynamic SENSOR: gravity moves it, terrain doesn't stop it,
        // and contact is lethal only while it's in flight (not parked).
        const cyc = Math.floor((now / 1000) / m.period + m.phase);
        if (m.cycle === null) m.cycle = cyc;
        if (m.body.isStatic) {
          if (cyc > m.cycle) {
            m.cycle = cyc;
            Body.setStatic(m.body, false);
            Body.setVelocity(m.body, { x: 0, y: -13 });
          }
        } else if (m.body.velocity.y > 0 && m.body.position.y > m.surfaceY + 60) {
          Body.setStatic(m.body, true);
          Body.setPosition(m.body, { x: m.x, y: m.surfaceY + 90 });
          m.cycle = cyc;
        }
      } else if (m.kind === 'arrows') {
        const p = (((now / 1000) / m.period + m.phase) % 1 + 1) % 1;
        m.zone.plugin.raining = p < m.rainFrac;
      } else if (m.kind === 'crumble') {
        // Planks give way a beat after they're first ridden (PhysicsWorld
        // stamps plugin.lastRider on terrain contact) — outrun the collapse.
        for (const p of m.planks) {
          if (!p.isStatic) continue;
          if (p.plugin.lastRider && !p.plugin.breakAt) p.plugin.breakAt = p.plugin.lastRider + 450;
          if (p.plugin.breakAt && now > p.plugin.breakAt) {
            Body.setStatic(p, false);
            Body.setAngularVelocity(p, (Math.random() - 0.5) * 0.1);
          }
        }
      }
    }
  }

  _bumps({ x0, groundY, count, spacing, r }) {
    for (let i = 0; i < count; i++) {
      this.all.push(Bodies.circle(x0 + i * spacing, groundY - r * 0.35, r, {
        isStatic: true, friction: 0.9, label: 'terrain',
      }));
    }
    this.items.push({ type: 'bumps', x0, groundY, count, spacing, r });
  }

  _tree({ x, groundY, clearance, r }) {
    // Trunk is background art only — the road passes in front of it. The
    // canopy is a sensor; overlapping it makes Car.js bleed velocity hard.
    const cy = groundY - clearance - r;
    const canopy = Bodies.circle(x, cy, r, {
      isStatic: true, isSensor: true, label: 'canopy',
    });
    this.all.push(canopy);
    this.items.push({ type: 'tree', x, groundY, clearance, r, cy });
  }

  _oil({ x0, groundY, w, push }) {
    const zone = Bodies.rectangle(x0 + w / 2, groundY - 10, w, 26, {
      isStatic: true, isSensor: true, label: 'oil',
    });
    zone.plugin.push = push;
    this.all.push(zone);
    this.items.push({ type: 'oil', x0, groundY, w, push });
  }

  _fan({ x, groundY, w, h, lift, oy }) {
    const bottom = groundY + oy;
    const zone = Bodies.rectangle(x + w / 2, bottom - h / 2, w, h, {
      isStatic: true, isSensor: true, label: 'updraft',
    });
    zone.plugin.lift = lift;
    this.all.push(zone);
    this.items.push({ type: 'fan', x, bottom, w, h });
  }

  _water({ x0, y0, w, drop }) {
    const surface = y0 + drop;
    const depth = this.deathY + 300 - surface;
    const zone = Bodies.rectangle(x0 + w / 2, surface + depth / 2, w, depth, {
      isStatic: true, isSensor: true, label: 'water',
    });
    this.all.push(zone);
    this.items.push({ type: 'water', x0, w, surface });
  }

  _ball({ ax, ay, len, r, angle0, spiky }) {
    // Free pendulum on a stiff cable; swings essentially forever. Spiky
    // variants ride a shorter chain (set by the builder), so they swing faster.
    const ball = Bodies.circle(ax + Math.sin(angle0) * len, ay + Math.cos(angle0) * len, r, {
      label: 'ball', density: 0.0045, frictionAir: 0, friction: 0.1, restitution: 0.25,
    });
    const cable = Constraint.create({
      pointA: { x: ax, y: ay }, bodyB: ball, pointB: { x: 0, y: 0 },
      length: len, stiffness: 0.95, damping: 0,
    });
    this.all.push(ball, cable);
    const sweep = Math.abs(Math.sin(angle0)) * len + r; // max horizontal reach
    this.items.push({ type: 'ball', ax, ay, ball, r, len, sweep, spiky });
  }

  _press({ cx, groundY, w, clearance, period, phase }) {
    const h = 95;
    const block = Bodies.rectangle(cx, groundY - clearance - h / 2, w, h, {
      isStatic: true, friction: 0.4, label: 'press',
    });
    this.all.push(block);
    this.movers.push({ kind: 'press', body: block, cx, groundY, w, h, clearance, period, phase });
    this.items.push({ type: 'press', body: block, cx, groundY, w, h, clearance });
  }

  _lift({ x0, y0, w, rise }) {
    // Platform parked flush with the approach road (top surface at y0).
    const platform = Bodies.rectangle(x0 + w / 2, y0 + 11, w - 8, 22, {
      isStatic: true, friction: 1.0, label: 'terrain',
    });
    this.all.push(platform);
    this.movers.push({
      kind: 'lift', body: platform,
      yBot: y0 + 11, yTop: y0 - rise + 11, holdUntil: 0,
    });
    this.items.push({ type: 'lift', body: platform, x0, y0, w, rise });
  }

  _rockfall({ x, topY, groundY, r, period, phase }) {
    // Boulder starts parked in its ceiling chute; the mover cycles it.
    // Lethal only while falling (PhysicsWorld checks label + !isStatic).
    // density is set before isStatic so setStatic(false) restores real mass.
    const rock = Bodies.circle(x, topY, r, {
      label: 'debris', density: 0.005, friction: 0.4, frictionAir: 0,
      restitution: 0.1, isStatic: true,
    });
    this.all.push(rock);
    this.movers.push({ kind: 'rock', body: rock, x, topY, groundY, period, phase, cycle: null });
    this.items.push({ type: 'rockfall', x, topY, groundY, r, rock });
  }

  _crumble({ x0, y0, width }) {
    const n = Math.max(5, Math.round(width / 46));
    const pw = width / n;
    const planks = [];
    for (let i = 0; i < n; i++) {
      planks.push(Bodies.rectangle(x0 + pw * (i + 0.5), y0 + 7, pw - 4, 14, {
        label: 'terrain', friction: 1.0, density: 0.002, isStatic: true,
      }));
    }
    this.all.push(...planks);
    this.movers.push({ kind: 'crumble', planks });
    this.items.push({ type: 'crumble', planks, x0, y0, width, pw });
  }

  _molten({ x0, y0, w, drop, kind }) {
    const surface = y0 + drop;
    const depth = this.deathY + 300 - surface;
    const zone = Bodies.rectangle(x0 + w / 2, surface + depth / 2, w, depth, {
      isStatic: true, isSensor: true, label: 'molten',
    });
    zone.plugin.kind = kind;
    this.all.push(zone);
    this.items.push({ type: 'molten', x0, w, surface, kind });
  }

  _stalactite({ x, groundY, clearance }) {
    // Hanging rock tooth over a pit: jump through the slot beneath its tip.
    // A tall blocker above the tooth seals the "tunnel" so nothing flies over.
    const tipY = groundY - clearance;
    const rw = 110, rh = 170;
    const topY = tipY - rh;
    const verts = [{ x: x - rw / 2, y: topY }, { x: x + rw / 2, y: topY }, { x, y: tipY }];
    const tooth = Bodies.fromVertices(x, (topY * 2 + tipY) / 3, [verts], {
      isStatic: true, friction: 0.1, label: 'terrain',
    });
    const blocker = Bodies.rectangle(x, topY - 190, rw, 380, {
      isStatic: true, friction: 0.1, label: 'terrain',
    });
    this.all.push(tooth, blocker);
    this.items.push({ type: 'stalactite', x, groundY, tipY, rw, rh });
  }

  _bouncer({ x, groundY, w }) {
    // Solid tire stack; the launch itself comes from Car.js (label 'bouncer'
    // is both a contact zone and counts as ground in PhysicsWorld).
    const h = 62;
    const pad = Bodies.rectangle(x, groundY - h / 2, w, h, {
      isStatic: true, friction: 0.8, restitution: 0.1, label: 'bouncer',
      chamfer: { radius: 8 },
    });
    this.all.push(pad);
    this.items.push({ type: 'bouncer', x, groundY, w, h });
  }

  _fireball({ x, groundY, surfaceY, period, phase, r }) {
    // Parked static under the lava between leaps. density before isStatic so
    // setStatic(false) restores real mass; isSensor so it passes through the
    // pit walls and only "hits" via the lethal-contact check.
    const ball = Bodies.circle(x, surfaceY + 90, r, {
      label: 'fireball', density: 0.003, frictionAir: 0,
      isSensor: true, isStatic: true,
    });
    this.all.push(ball);
    this.movers.push({ kind: 'fireball', body: ball, x, surfaceY, period, phase, cycle: null });
    this.items.push({ type: 'fireball', x, groundY, ball, r, period, phase });
  }

  _spikes({ x0, groundY, w }) {
    const zone = Bodies.rectangle(x0 + w / 2, groundY - 9, w, 22, {
      isStatic: true, isSensor: true, label: 'spikes',
    });
    this.all.push(zone);
    this.items.push({ type: 'spikes', x0, groundY, w });
  }

  _beam({ x, groundY, h }) {
    // Free-standing dynamic timber: heavy enough that only a fast hit slams
    // it down. Labeled terrain so a felled beam is drivable ground (and can
    // bridge a small gap).
    const beam = Bodies.rectangle(x, groundY - h / 2, 26, h, {
      label: 'terrain', density: 0.0028, friction: 1.5, restitution: 0.4,
      chamfer: { radius: 4 },
    });
    this.all.push(beam);
    this.items.push({ type: 'beam', body: beam, h });
  }

  _arrows({ x, w, groundY, period, phase, rainFrac }) {
    // Lethal only while plugin.raining (toggled by the mover) — the zone
    // covers car height under the murder-holes above, trimmed a little
    // narrower than the visual curtain so an edge graze is forgiven.
    const zone = Bodies.rectangle(x, groundY - 85, w - 24, 170, {
      isStatic: true, isSensor: true, label: 'arrows',
    });
    zone.plugin.raining = false;
    this.all.push(zone);
    this.movers.push({ kind: 'arrows', zone, period, phase, rainFrac });
    this.items.push({ type: 'arrows', x, w, groundY, topY: groundY - 380, period, phase, rainFrac, zone });
  }

  _ramp({ x, y, w, h }) {
    // Deck: rotated rectangle whose top face runs (x,y) -> (x+w, y-h).
    const len = Math.hypot(w, h);
    const angle = Math.atan2(-h, w);
    const t = 18;
    const nx = h / len, ny = w / len; // downward-facing normal of the deck line
    const deck = Bodies.rectangle(
      x + w / 2 + nx * t / 2, y - h / 2 + ny * t / 2, len, t,
      { isStatic: true, angle, friction: 0.9, label: 'terrain' },
    );
    // Support post under the lip.
    const post = Bodies.rectangle(x + w - 12, y - h / 2 + 8, 20, h - 12,
      { isStatic: true, friction: 0.5, label: 'terrain' });
    this.all.push(deck, post);
    this.items.push({ type: 'ramp', x, y, w, h });
  }

  _seesaw({ cx, groundY, length, postH }) {
    const pivotY = groundY - postH - 8;
    const group = Body.nextGroup(true); // plank must not collide with its post
    const plank = Bodies.rectangle(cx, pivotY, length, 15, {
      label: 'terrain',
      friction: 1.0,
      density: 0.0005,
      chamfer: { radius: 4 },
      collisionFilter: { group },
    });
    const post = Bodies.rectangle(cx, groundY - postH / 2, 18, postH, {
      isStatic: true, friction: 0.6, label: 'terrain', collisionFilter: { group },
    });
    // Start tilted with the approach (left) end resting on the ground, so the
    // car meets a ramp — not a plank edge hovering at bumper height.
    const drop = groundY - pivotY - 7.5;
    Body.setAngle(plank, -Math.asin(Math.min(0.9, drop / (length / 2))));
    const pin = Constraint.create({
      pointA: { x: cx, y: pivotY },
      bodyB: plank,
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: 0.95,
      damping: 0.1,
    });
    this.all.push(plank, post, pin);
    this.items.push({ type: 'seesaw', plank, cx, groundY, postH, length });
  }

  _ropeBridge({ x0, y0, width }) {
    const n = Math.max(6, Math.round(width / 36));
    const plankW = width / n;
    const group = Body.nextGroup(true); // adjacent planks shouldn't grind on each other
    const planks = [];
    for (let i = 0; i < n; i++) {
      planks.push(Bodies.rectangle(x0 + plankW * (i + 0.5), y0 + 5, plankW - 3, 11, {
        label: 'terrain',
        friction: 1.0,
        density: 0.003,
        collisionFilter: { group },
      }));
    }
    const links = [];
    const link = (opts) => links.push(Constraint.create({
      stiffness: 0.4, damping: 0.08, length: 3, ...opts,
    }));
    link({ pointA: { x: x0 - 4, y: y0 + 2 }, bodyB: planks[0], pointB: { x: -plankW / 2 + 2, y: 0 } });
    for (let i = 0; i < n - 1; i++) {
      link({
        bodyA: planks[i], pointA: { x: plankW / 2 - 2, y: 0 },
        bodyB: planks[i + 1], pointB: { x: -plankW / 2 + 2, y: 0 },
      });
    }
    link({ pointA: { x: x0 + width + 4, y: y0 + 2 }, bodyB: planks[n - 1], pointB: { x: plankW / 2 - 2, y: 0 } });

    this.all.push(...planks, ...links);
    this.items.push({ type: 'ropebridge', planks, x0, y0, width });
  }

  render(ctx) {
    for (const it of this.items) {
      if (it.type === 'ramp') this._renderRamp(ctx, it);
      else if (it.type === 'seesaw') this._renderSeesaw(ctx, it);
      else if (it.type === 'ropebridge') this._renderRopeBridge(ctx, it);
      else if (it.type === 'bumps') this._renderBumps(ctx, it);
      else if (it.type === 'tree') this._renderTreeTrunk(ctx, it);
      else if (it.type === 'oil') this._renderOil(ctx, it);
      else if (it.type === 'fan') this._renderFan(ctx, it);
      else if (it.type === 'water') this._renderWater(ctx, it);
      else if (it.type === 'ball') this._renderBall(ctx, it);
      else if (it.type === 'press') this._renderPress(ctx, it);
      else if (it.type === 'lift') this._renderLift(ctx, it);
      else if (it.type === 'rockfall') this._renderRockfall(ctx, it);
      else if (it.type === 'crumble') this._renderCrumble(ctx, it);
      else if (it.type === 'molten') this._renderMolten(ctx, it);
      else if (it.type === 'stalactite') this._renderStalactite(ctx, it);
      else if (it.type === 'bouncer') this._renderBouncer(ctx, it);
      else if (it.type === 'fireball') this._renderFireball(ctx, it);
      else if (it.type === 'spikes') this._renderSpikes(ctx, it);
      else if (it.type === 'beam') this._renderBeam(ctx, it);
      else if (it.type === 'arrows') this._renderArrows(ctx, it);
    }
  }

  // Drawn AFTER the car: canopies swallow snagged cars, water/lava submerge them.
  renderOverlay(ctx) {
    for (const it of this.items) {
      if (it.type === 'tree') this._renderCanopy(ctx, it);
      else if (it.type === 'water') this._renderWaterFront(ctx, it);
      else if (it.type === 'molten') this._renderMoltenFront(ctx, it);
    }
  }

  _renderOil(ctx, { x0, groundY, w, push }) {
    ctx.save();
    // Puddle
    ctx.beginPath();
    ctx.ellipse(x0 + w / 2, groundY - 3, w / 2, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#181b22';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x0 + w / 2, groundY - 6, w / 2.6, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2e3644';
    ctx.fill();
    // Direction chevrons: gold = boost, red = shove-back
    ctx.strokeStyle = push > 0 ? '#e8c34a' : '#e05548';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const dir = push > 0 ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      const cx = x0 + w / 2 + (i - 1) * 34;
      ctx.beginPath();
      ctx.moveTo(cx - 7 * dir, groundY - 12);
      ctx.lineTo(cx + 5 * dir, groundY - 6);
      ctx.lineTo(cx - 7 * dir, groundY);
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderFan(ctx, { x, bottom, w, h }) {
    const t = this.engine.timing.timestamp / 1000;
    ctx.save();
    // Air streaks rising through the column
    ctx.strokeStyle = 'rgba(210, 228, 246, 0.5)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const sx = x + (k + 0.5) * (w / 5);
      const sy = bottom - ((t * 240 + k * 97) % h);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - 26);
      ctx.stroke();
    }
    // Housing + grille
    ctx.fillStyle = '#454b57';
    ctx.fillRect(x - 6, bottom - 18, w + 12, 22);
    ctx.strokeStyle = '#7d8798';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let gx = x + 8; gx < x + w - 4; gx += 12) {
      ctx.moveTo(gx, bottom - 15);
      ctx.lineTo(gx, bottom + 1);
    }
    ctx.stroke();
    ctx.restore();
  }

  _renderWater(ctx, { x0, w, surface }) {
    const t = this.engine.timing.timestamp / 1000;
    const bottom = this.deathY + 300;
    ctx.save();
    ctx.fillStyle = texPattern('liquid', '#8fb3d6', 190) || '#2b5b86';
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let sx = 0; sx <= w; sx += 14) {
      ctx.lineTo(x0 + sx, surface + Math.sin(sx * 0.045 + t * 2.6) * 4);
    }
    ctx.lineTo(x0 + w, bottom);
    ctx.closePath();
    ctx.fill();
    // Crest highlight
    ctx.strokeStyle = '#6ea4d2';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (let sx = 0; sx <= w; sx += 14) {
      const y = surface + Math.sin(sx * 0.045 + t * 2.6) * 4;
      sx === 0 ? ctx.moveTo(x0 + sx, y) : ctx.lineTo(x0 + sx, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Translucent front pass so a sinking car reads as underwater.
  _renderWaterFront(ctx, { x0, w, surface }) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#2b5b86';
    ctx.fillRect(x0, surface, w, this.deathY + 300 - surface);
    ctx.restore();
  }

  _renderBall(ctx, { ax, ay, ball, r, spiky }) {
    ctx.save();
    // Crane stub the cable hangs from
    ctx.fillStyle = '#3c414b';
    ctx.fillRect(ax - 26, ay - 18, 52, 18);
    // Cable
    ctx.strokeStyle = '#494f59';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ball.position.x, ball.position.y);
    ctx.stroke();
    // Spikes (drawn under the ball so their bases are hidden)
    if (spiky) {
      ctx.fillStyle = '#22252b';
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + ball.angle;
        const tx = ball.position.x + Math.cos(a) * (r + 13);
        const ty = ball.position.y + Math.sin(a) * (r + 13);
        ctx.beginPath();
        ctx.moveTo(ball.position.x + Math.cos(a + 0.3) * (r - 2), ball.position.y + Math.sin(a + 0.3) * (r - 2));
        ctx.lineTo(tx, ty);
        ctx.lineTo(ball.position.x + Math.cos(a - 0.3) * (r - 2), ball.position.y + Math.sin(a - 0.3) * (r - 2));
        ctx.closePath();
        ctx.fill();
      }
    }
    // Ball
    ctx.beginPath();
    ctx.arc(ball.position.x, ball.position.y, r, 0, Math.PI * 2);
    ctx.fillStyle = spiky ? '#2a2d34' : '#33363d';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ball.position.x - r * 0.3, ball.position.y - r * 0.35, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = '#5a606b';
    ctx.fill();
    ctx.restore();
  }

  _renderFireball(ctx, { ball, r }) {
    if (ball.isStatic) return; // parked under the lava
    const { x: bx, y: by } = ball.position;
    ctx.save();
    // Trail behind the flight path
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ff9a3d';
    for (const s of [0.6, 1.1]) {
      ctx.beginPath();
      ctx.arc(bx - ball.velocity.x * 3 * s, by - ball.velocity.y * 3 * s, r * (1 - s * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Glow + molten core
    ctx.fillStyle = 'rgba(255, 140, 40, 0.3)';
    ctx.beginPath();
    ctx.arc(bx, by, r + 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7a1e';
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.arc(bx - r * 0.2, by - r * 0.2, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderSpikes(ctx, { x0, groundY, w }) {
    ctx.save();
    // Base plate
    ctx.fillStyle = '#3a3d45';
    ctx.fillRect(x0, groundY - 6, w, 10);
    // Spikes
    ctx.fillStyle = '#b9bfca';
    ctx.strokeStyle = '#22242a';
    ctx.lineWidth = 1.5;
    for (let sx = x0 + 5; sx + 12 <= x0 + w; sx += 14) {
      ctx.beginPath();
      ctx.moveTo(sx, groundY - 4);
      ctx.lineTo(sx + 6, groundY - 24);
      ctx.lineTo(sx + 12, groundY - 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderBeam(ctx, { body, h }) {
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.fillStyle = texUpright('wood', '#a8794a', 140, body.angle) || '#8a6b42';
    ctx.fillRect(-13, -h / 2, 26, h);
    ctx.strokeStyle = '#3d2c15';
    ctx.lineWidth = 3;
    ctx.strokeRect(-13, -h / 2, 26, h);
    // Iron bands
    ctx.fillStyle = '#565b66';
    ctx.fillRect(-13, -h / 2 + 10, 26, 10);
    ctx.fillRect(-13, h / 2 - 20, 26, 10);
    ctx.restore();
  }

  _renderArrows(ctx, { x, w, groundY, topY, period, phase, rainFrac }) {
    const t = this.engine.timing.timestamp / 1000;
    const p = ((t / period + phase) % 1 + 1) % 1;
    ctx.save();
    // Murder-hole ledge the volleys come from
    ctx.fillStyle = '#3a3444';
    ctx.fillRect(x - w / 2 - 12, topY - 16, w + 24, 16);
    ctx.fillStyle = '#1d1826';
    for (let sx = x - w / 2 + 8; sx + 12 < x + w / 2; sx += 28) {
      ctx.fillRect(sx, topY - 13, 12, 10);
    }
    if (p < rainFrac) {
      // Falling arrow columns
      const span = groundY - topY;
      ctx.strokeStyle = '#cfd4dc';
      ctx.fillStyle = '#cfd4dc';
      ctx.lineWidth = 2.5;
      for (let k = 0; k < Math.floor(w / 24); k++) {
        const ax = x - w / 2 + 12 + k * 24;
        const ay = topY + ((t * 620 + k * 133) % span);
        ctx.beginPath();
        ctx.moveTo(ax, ay - 24);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax - 4, ay);
        ctx.lineTo(ax + 4, ay);
        ctx.lineTo(ax, ay + 9);
        ctx.closePath();
        ctx.fill();
      }
    } else if (p > 1 - 0.1 / period) {
      // Glint in the slits just before the next volley
      ctx.fillStyle = 'rgba(255, 220, 140, 0.7)';
      for (let sx = x - w / 2 + 8; sx + 12 < x + w / 2; sx += 28) {
        ctx.fillRect(sx + 3, topY - 11, 6, 6);
      }
    }
    ctx.restore();
  }

  _renderPress(ctx, { body, cx, groundY, w, h, clearance }) {
    const top = groundY - clearance - h - 26;
    ctx.save();
    // Side posts + crossbeam
    ctx.fillStyle = '#3c414b';
    ctx.fillRect(cx - w / 2 - 22, top, 16, groundY - top);
    ctx.fillRect(cx + w / 2 + 6, top, 16, groundY - top);
    ctx.fillRect(cx - w / 2 - 26, top - 14, w + 52, 18);
    // Piston shaft down to the block
    const blockTop = body.position.y - h / 2;
    ctx.fillStyle = '#6a7181';
    ctx.fillRect(cx - 11, top + 2, 22, blockTop - top - 2);
    // Block with hazard stripes on the crush face. Drawn in block-local
    // coordinates so the texture pattern rides with the moving block instead
    // of scrolling through it (patterns anchor to the current transform).
    ctx.translate(cx - w / 2, blockTop);
    ctx.fillStyle = texPattern('concrete', '#5e6675', 170) || '#525a68';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2b2e35';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
    for (let i = 0; i < Math.floor(w / 24); i++) {
      ctx.fillStyle = i % 2 ? '#2b2e35' : '#e8c34a';
      ctx.fillRect(i * 24, h - 14, 24, 14);
    }
    ctx.restore();
  }

  _renderLift(ctx, { body, x0, y0, w, rise }) {
    const px = body.position.x, py = body.position.y - 11; // platform top
    const jibY = y0 - rise - 72;
    ctx.save();
    // Crane tower behind the shaft's far side + jib arm over the platform
    ctx.fillStyle = '#c9762e';
    ctx.fillRect(x0 + w + 4, jibY, 20, y0 - jibY);
    ctx.fillRect(x0 - 34, jibY - 16, w + 58, 16);
    // Cables from jib to platform corners
    ctx.strokeStyle = '#494f59';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(px - w / 2 + 14, py);
    ctx.lineTo(px - w / 2 + 14, jibY);
    ctx.moveTo(px + w / 2 - 14, py);
    ctx.lineTo(px + w / 2 - 14, jibY);
    ctx.stroke();
    // Platform deck
    ctx.fillStyle = '#6a7181';
    ctx.fillRect(px - w / 2 + 4, py, w - 8, 22);
    ctx.fillStyle = '#e8c34a';
    ctx.fillRect(px - w / 2 + 4, py, w - 8, 5);
    ctx.restore();
  }

  _renderRockfall(ctx, { x, topY, rock, r }) {
    ctx.save();
    // Ceiling chute the boulder drops from
    ctx.fillStyle = '#15100a';
    ctx.fillRect(x - r - 16, topY - 280, (r + 16) * 2, 280);
    // Jagged chute mouth
    ctx.fillStyle = '#3b3125';
    ctx.beginPath();
    ctx.moveTo(x - r - 16, topY);
    ctx.lineTo(x - r - 2, topY + 16);
    ctx.lineTo(x - r + 8, topY - 2);
    ctx.moveTo(x + r + 16, topY);
    ctx.lineTo(x + r + 2, topY + 18);
    ctx.lineTo(x + r - 8, topY - 2);
    ctx.closePath();
    ctx.fill();
    // Boulder (with faint motion streaks while falling)
    const { x: bx, y: by } = rock.position;
    if (!rock.isStatic) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#8a7a63';
      for (const d of [26, 52]) {
        ctx.beginPath();
        ctx.arc(bx, by - d, r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(rock.angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = texUpright('stone', '#a08c6e', 120, rock.angle) || '#6f6350';
    ctx.fill();
    ctx.strokeStyle = '#453c2e';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Facet cracks
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(r * 0.15, 0); ctx.lineTo(-r * 0.25, r * 0.55);
    ctx.moveTo(r * 0.15, 0); ctx.lineTo(r * 0.6, -r * 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  _renderCrumble(ctx, { planks, x0, y0, width, pw }) {
    const now = this.engine.timing.timestamp;
    ctx.save();
    for (const p of planks) {
      ctx.save();
      // Touched planks tremble before they let go.
      const armed = p.isStatic && p.plugin.breakAt;
      const jx = armed ? (Math.random() - 0.5) * 3 : 0;
      const jy = armed ? (Math.random() - 0.5) * 2 : 0;
      ctx.translate(p.position.x + jx, p.position.y + jy);
      ctx.rotate(p.angle);
      const half = (pw - 4) / 2;
      ctx.globalAlpha = p.isStatic ? 1 : Math.max(0, 1 - (p.position.y - y0) / 400);
      ctx.fillStyle = (armed
        ? texUpright('wood', '#a87c48', 130, p.angle)
        : texUpright('wood', '#c9995c', 130, p.angle)) || (armed ? '#8f6f45' : '#a8865a');
      ctx.fillRect(-half, -7, half * 2, 14);
      ctx.strokeStyle = '#5e4626';
      ctx.lineWidth = 2;
      ctx.strokeRect(-half, -7, half * 2, 14);
      // Crack down the middle
      ctx.beginPath();
      ctx.moveTo(-3, -7); ctx.lineTo(2, 0); ctx.lineTo(-2, 7);
      ctx.stroke();
      ctx.restore();
    }
    // End supports
    for (const px of [x0 - 8, x0 + width + 8]) {
      ctx.fillStyle = '#6b4f28';
      ctx.fillRect(px - 6, y0 - 4, 12, 30);
    }
    ctx.restore();
  }

  _renderMolten(ctx, { x0, w, surface, kind }) {
    const t = this.engine.timing.timestamp / 1000;
    const bottom = this.deathY + 300;
    const acid = kind === 'acid';
    const body = acid ? '#3f7d16' : '#8a2c0f';
    const crest = acid ? '#9fe04a' : '#ff8c3a';
    const bubble = acid ? '#d6ff7a' : '#ffcf4d';
    // Liquid tile is teal — desaturate it so the tint sets the hue outright.
    const pat = texPattern('liquid', acid ? '#7ed42c' : '#f0561a', 190, true);
    ctx.save();
    ctx.fillStyle = pat || body;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let sx = 0; sx <= w; sx += 14) {
      ctx.lineTo(x0 + sx, surface + Math.sin(sx * 0.05 + t * 1.4) * 3);
    }
    ctx.lineTo(x0 + w, bottom);
    ctx.closePath();
    ctx.fill();
    // Glowing crest
    ctx.strokeStyle = crest;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let sx = 0; sx <= w; sx += 14) {
      const y = surface + Math.sin(sx * 0.05 + t * 1.4) * 3;
      sx === 0 ? ctx.moveTo(x0 + sx, y) : ctx.lineTo(x0 + sx, y);
    }
    ctx.stroke();
    // Popping bubbles
    ctx.fillStyle = bubble;
    for (let k = 0; k < 4; k++) {
      const px = x0 + ((k * 83 + 31) % Math.max(1, w - 20)) + 10;
      const cycle = (t * 0.9 + k * 0.37) % 1;
      ctx.globalAlpha = 1 - cycle;
      ctx.beginPath();
      ctx.arc(px, surface - 2 - cycle * 14, 3 + cycle * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Hot haze in front so a melting car reads as consumed.
  _renderMoltenFront(ctx, { x0, w, surface, kind }) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = kind === 'acid' ? '#4c9124' : '#a83a12';
    ctx.fillRect(x0, surface, w, this.deathY + 300 - surface);
    ctx.restore();
  }

  _renderStalactite(ctx, { x, tipY, rw, rh }) {
    const topY = tipY - rh;
    ctx.save();
    // Rock mass reaching up out of view
    ctx.fillStyle = texPattern('stone', '#5c4e3a', 200) || '#3b3125';
    ctx.fillRect(x - rw / 2, topY - 600, rw, 600);
    // The tooth
    ctx.beginPath();
    ctx.moveTo(x - rw / 2, topY - 2);
    ctx.lineTo(x + rw / 2, topY - 2);
    ctx.lineTo(x, tipY);
    ctx.closePath();
    ctx.fillStyle = texPattern('stone', '#7d6b52', 160) || '#4c4238';
    ctx.fill();
    ctx.strokeStyle = '#2a231a';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Side fangs for a jagged silhouette
    ctx.fillStyle = '#3b3125';
    for (const [dx, len] of [[-rw / 2 - 14, 44], [rw / 2 + 14, 58]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx - 14, topY - 2);
      ctx.lineTo(x + dx + 14, topY - 2);
      ctx.lineTo(x + dx, topY + len);
      ctx.closePath();
      ctx.fill();
    }
    // Drip highlight down the tooth
    ctx.strokeStyle = '#6f6350';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - rw * 0.16, topY + 8);
    ctx.lineTo(x - 3, tipY - 22);
    ctx.stroke();
    ctx.restore();
  }

  _renderBouncer(ctx, { x, groundY, w, h }) {
    ctx.save();
    const rows = 3, rowH = h / rows;
    const perRow = Math.max(2, Math.round(w / 52));
    const tw = w / perRow;
    for (let r = 0; r < rows; r++) {
      const cy = groundY - rowH * (r + 0.5);
      const off = (r % 2) * (tw / 2);
      for (let i = 0; i < perRow; i++) {
        const cx = x - w / 2 + off + tw * (i + 0.5);
        if (cx - tw / 2 < x - w / 2 - 4 || cx + tw / 2 > x + w / 2 + 4) continue;
        ctx.beginPath();
        ctx.ellipse(cx, cy, tw / 2 - 2, rowH / 2 - 1, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#23262b';
        ctx.fill();
        ctx.strokeStyle = '#0f1114';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Hub
        ctx.beginPath();
        ctx.ellipse(cx, cy, tw / 5, rowH / 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#3a3f47';
        ctx.fill();
      }
    }
    // Warning paint on the top row
    ctx.strokeStyle = '#e8c34a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 8, groundY - h + 3);
    ctx.lineTo(x + w / 2 - 8, groundY - h + 3);
    ctx.stroke();
    ctx.restore();
  }

  _renderBumps(ctx, { x0, groundY, count, spacing, r }) {
    ctx.save();
    for (let i = 0; i < count; i++) {
      const bx = x0 + i * spacing, by = groundY - r * 0.35;
      ctx.beginPath();
      ctx.arc(bx, by, r, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#3a3d45';
      ctx.fill();
      // Warning stripes
      ctx.beginPath();
      ctx.arc(bx, by, r, Math.PI * 1.25, Math.PI * 1.55);
      ctx.strokeStyle = '#e8c34a';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderTreeTrunk(ctx, { x, groundY, clearance, r }) {
    ctx.save();
    ctx.fillStyle = texPattern('wood', '#7d5a34', 120) || '#6b4f30';
    ctx.fillRect(x - 9, groundY - clearance - r, 18, clearance + r);
    ctx.restore();
  }

  _renderCanopy(ctx, { x, cy, r }) {
    const leaves = texPattern('leaves', null, 170);
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (const [dx, dy, rr] of [[-r * 0.5, r * 0.25, r * 0.7], [r * 0.5, r * 0.25, r * 0.7], [0, -r * 0.2, r * 0.85]]) {
      ctx.beginPath();
      ctx.arc(x + dx, cy + dy, rr, 0, Math.PI * 2);
      ctx.fillStyle = leaves || '#4e8a3d';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x - r * 0.25, cy - r * 0.3, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = texPattern('leaves', '#d2ffc0', 170) || '#61a34c';
    ctx.fill();
    ctx.restore();
  }

  _renderRamp(ctx, { x, y, w, h }) {
    ctx.save();
    // Wedge silhouette
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fillStyle = texPattern('wood', '#b98a52', 150) || '#9a7745';
    ctx.fill();
    ctx.strokeStyle = '#6b4f28';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Deck plank line
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y - h);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#c49a62';
    ctx.stroke();
    ctx.restore();
  }

  _renderSeesaw(ctx, { plank, cx, groundY, postH, length }) {
    ctx.save();
    // Pivot post (triangle)
    ctx.beginPath();
    ctx.moveTo(cx - 16, groundY);
    ctx.lineTo(cx, groundY - postH - 4);
    ctx.lineTo(cx + 16, groundY);
    ctx.closePath();
    ctx.fillStyle = '#8a6b42';
    ctx.fill();
    ctx.strokeStyle = '#5e4626';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Plank
    ctx.translate(plank.position.x, plank.position.y);
    ctx.rotate(plank.angle);
    const half = length / 2;
    ctx.fillStyle = texUpright('wood', '#e0b478', 150, plank.angle) || '#c49a62';
    ctx.fillRect(-half, -7.5, half * 2, 15);
    ctx.strokeStyle = '#6b4f28';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-half, -7.5, half * 2, 15);
    ctx.restore();
  }

  _renderRopeBridge(ctx, { planks, x0, y0, width }) {
    ctx.save();
    // Rope: through anchors and plank centers
    ctx.beginPath();
    ctx.moveTo(x0 - 4, y0 + 2);
    for (const p of planks) ctx.lineTo(p.position.x, p.position.y);
    ctx.lineTo(x0 + width + 4, y0 + 2);
    ctx.strokeStyle = '#7d6540';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Planks
    for (const p of planks) {
      ctx.save();
      ctx.translate(p.position.x, p.position.y);
      ctx.rotate(p.angle);
      const half = Math.hypot(
        p.vertices[1].x - p.vertices[0].x,
        p.vertices[1].y - p.vertices[0].y) / 2;
      ctx.fillStyle = texUpright('wood', '#e0b478', 130, p.angle) || '#c49a62';
      ctx.fillRect(-half, -5.5, half * 2, 11);
      ctx.strokeStyle = '#6b4f28';
      ctx.lineWidth = 2;
      ctx.strokeRect(-half, -5.5, half * 2, 11);
      ctx.restore();
    }
    // End posts
    for (const px of [x0 - 8, x0 + width + 8]) {
      ctx.fillStyle = '#8a6b42';
      ctx.fillRect(px - 5, y0 - 26, 10, 30);
    }
    ctx.restore();
  }

  destroy() {
    if (this.movers.length) Events.off(this.engine, 'beforeUpdate', this._tick);
    for (const thing of this.all) this.world.remove(thing);
    this.all = [];
    this.items = [];
    this.movers = [];
  }
}
