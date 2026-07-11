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

// Small deterministic PRNG (mulberry32) so scrap-metal chunks get stable
// shapes/colors/positions across runs without needing Math.random().
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Obstacles {
  constructor(level, world) {
    this.world = world;
    this.engine = world.engine;
    this.deathY = level.deathY;
    this.chains = level.chains; // real terrain outline, used to clip sludge fills to it
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
      else if (def.type === 'compactor') this._compactor(def);
      else if (def.type === 'conveyor') this._conveyor(def);
      else if (def.type === 'scrap') this._scrap(def);
      else if (def.type === 'pipe') this._pipe(def);
      else if (def.type === 'sludge') this._sludge(def);
      else if (def.type === 'spring') this._spring(def);
      else if (def.type === 'blade') this._blade(def);
      else if (def.type === 'elevator') this._elevator(def);
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
      } else if (m.kind === 'blade') {
        // Continuously spinning Factory blade: a full-diameter bar rotating
        // about its own hub. No position update needed — Body.setAngle alone
        // sweeps it through the road-level danger zone once per rotation.
        Body.setAngle(m.body, m.phase - (now / 1000) * m.omega);
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

  // --- Factory set-pieces ---

  // Pneumatic compactor: a press at industrial-machine scale. Shares the
  // 'press' mover math (generic over any body) but its own label so
  // PhysicsWorld's lethal check and the fail message can tell them apart.
  _compactor({ cx, groundY, w, clearance, period, phase }) {
    const h = 150;
    const block = Bodies.rectangle(cx, groundY - clearance - h / 2, w, h, {
      isStatic: true, friction: 0.4, label: 'compactor',
    });
    this.all.push(block);
    this.movers.push({ kind: 'press', body: block, cx, groundY, w, h, clearance, period, phase });
    this.items.push({ type: 'compactor', body: block, cx, groundY, w, h, clearance });
  }

  // Conveyor belt: a sensor strip over flat ground that shoves grounded cars
  // along at `speed` (Car.js). Purely a force nudge, so the player still
  // steers/brakes normally — it just fights or helps their own throttle.
  _conveyor({ x0, groundY, w, speed }) {
    const zone = Bodies.rectangle(x0 + w / 2, groundY - 10, w, 26, {
      isStatic: true, isSensor: true, label: 'conveyor',
    });
    zone.plugin.speed = speed;
    this.all.push(zone);
    this.items.push({ type: 'conveyor', x0, groundY, w, speed });
  }

  // Falling scrap metal: irregular chunks (random shape/color, deterministic
  // per slot) drop from a ceiling chute on their own offset cycle, reusing
  // the rockfall 'rock' mover (generic over body shape) so each chunk drops,
  // resets and re-arms independently — a staggered curtain to thread.
  _scrap({ x0, w, groundY, topY, count, period, phase }) {
    const colors = ['#c0392b', '#d99a2b', '#7f8c8d', '#4a6fa5', '#7a8a3a', '#a85a2e'];
    const chunks = [];
    for (let i = 0; i < count; i++) {
      const rnd = seededRandom(x0 * 31 + i * 97 + 13);
      const cx = x0 + (w / (count + 1)) * (i + 1) + (rnd() - 0.5) * Math.min(50, w / (count + 2));
      const r = 18 + rnd() * 14;
      const opts = {
        label: 'debris', density: 0.0042, friction: 0.4, frictionAir: 0,
        restitution: 0.15, isStatic: true,
      };
      // Shape strides with the slot index (rotated by a per-CHUTE offset),
      // so a chute never rains two identical shapes back to back; the
      // seeded rolls still vary size and drop position. Color's {2i, 2i+1}
      // ranges are disjoint for consecutive slots — no back-to-back repeats.
      const shapeIdx = (i + Math.floor(x0 / 37)) % 3;
      const body = shapeIdx === 0
        ? Bodies.rectangle(cx, topY, r * 1.6, r * 1.6, { ...opts, chamfer: { radius: 3 } })
        : shapeIdx === 1
          ? Bodies.polygon(cx, topY, 3, r * 1.25, opts)
          : Bodies.polygon(cx, topY, 6, r, opts);
      const color = colors[(i * 2 + Math.floor(rnd() * 2)) % colors.length];
      this.all.push(body);
      this.movers.push({
        kind: 'rock', body, x: cx, topY, groundY,
        period, phase: phase + i / count, cycle: null,
      });
      chunks.push({ body, color });
    }
    this.items.push({ type: 'scrap', x0, w, topY, groundY, chunks });
  }

  // Large drivable pipe: pipeStart()/pipeEnd() (LevelBuilder) capture the
  // floor path (laid with ordinary flat()/slope() calls) and hand it here as
  // `pts`. We only add the ceiling — matching rotated static rectangles
  // offset above the floor line, same segment math as Terrain.js — so the
  // tube is open at both mouths (a gap() after pipeEnd() lets the car launch
  // out of one pipe and land in the next).
  _pipe({ pts, radius }) {
    const t = 24;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const angle = Math.atan2(dy, dx);
      const nx = -dy / len, ny = dx / len;
      const midx = (p0.x + p1.x) / 2, midy = (p0.y + p1.y) / 2;
      const off = radius * 2 + t / 2;
      const ceil = Bodies.rectangle(midx - nx * off, midy - ny * off, len + 2, t, {
        isStatic: true, angle, friction: 0.3, label: 'terrain',
      });
      this.all.push(ceil);
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y - radius * 2); maxY = Math.max(maxY, p.y + radius * 0.5);
    }
    this.items.push({ type: 'pipe', pts, radius, minX, maxX, minY, maxY });
  }

  // Sludge vat: a real drivable dip (LevelBuilder.sludgeVat lays the floor)
  // with a corrosive-goo sensor zone over its lower portion. Car.js fills a
  // lethality bar while submerged instead of killing on contact.
  //
  // Like any liquid, the pool has a flat surface (`top`) — but its FLOOR is
  // the real terrain curve, not a fixed depth. So the fill only ever
  // occupies the space ABOVE the ground and below the surface line (where
  // terrain genuinely isn't present); it can never paint over the solid dip
  // floor itself. Both the wet x-range and the floor line come straight
  // from the actual chain points, so it automatically molds to whatever
  // shape the dip actually is.
  _sludge({ x0, y0, w, depth }) {
    const top = y0 + depth * 0.3;
    const zoneBottom = y0 + depth + 50; // sensor zone only — generous, doesn't need to be visual

    const chain = this.chains.find(c =>
      Math.abs(c[0].x - x0) < 2 && Math.abs(c[c.length - 1].x - (x0 + w)) < 2);
    let wetX0 = x0, wetX1 = x0 + w;
    let floor = [];
    if (chain) {
      let enter = null, exit = null;
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i], b = chain[i + 1];
        if (a.y < top && b.y >= top && enter === null) {
          enter = a.x + (b.x - a.x) * (top - a.y) / (b.y - a.y);
        }
        if (a.y >= top && b.y < top) {
          exit = a.x + (b.x - a.x) * (top - a.y) / (b.y - a.y);
        }
      }
      if (enter !== null) wetX0 = enter;
      if (exit !== null) wetX1 = exit;
      if (enter === null && exit === null && !chain.every(p => p.y >= top)) {
        wetX0 = wetX1 = x0; // whole dip stays shallower than `top` — no pool
      }
      // The pool's floor: the surface-crossing points themselves (exactly
      // on the water line) plus every real chain sample strictly between
      // them (the actual, possibly-curved bottom of the dip).
      floor = [
        { x: wetX0, y: top },
        ...chain.filter(p => p.x > wetX0 + 0.5 && p.x < wetX1 - 0.5),
        { x: wetX1, y: top },
      ];
    }
    const wetW = Math.max(0, wetX1 - wetX0);

    const zone = Bodies.rectangle(wetX0 + wetW / 2, (top + zoneBottom) / 2, wetW, zoneBottom - top, {
      isStatic: true, isSensor: true, label: 'sludge',
    });
    this.all.push(zone);
    this.items.push({ type: 'sludge', wetX0, wetX1, top, floor });
  }

  // Coiled ground spring: a solid pad (also a zone, like the tire-stack
  // bouncer) that launches the car hard on contact (Car.js), cooldown-gated.
  // Kept LOW (the idle visual is a flat plate flush with the road, so a tall
  // collider would be an invisible step) and chamfered so rolling onto it is
  // seamless — the launch fires on first touch either way.
  _spring({ x, groundY, w, launchVel }) {
    const h = 14;
    const pad = Bodies.rectangle(x, groundY - h / 2, w, h, {
      isStatic: true, friction: 0.8, label: 'spring', chamfer: { radius: 6 },
    });
    pad.plugin.launchVel = launchVel;
    this.all.push(pad);
    this.items.push({ type: 'spring', x, groundY, w, pad });
  }

  // Spinning blade: a full-diameter sensor bar rotating continuously about a
  // fixed hub — lethal on any touch (PhysicsWorld), so clearing it is pure
  // timing, not a directional-hit check like the wrecking ball. `len` is
  // sized by the builder to reach the floor at the bottom of every rotation.
  _blade({ ax, ay, groundY, len, thickness = 30, omega, phase }) {
    const blade = Bodies.rectangle(ax, ay, len, thickness, {
      isStatic: true, isSensor: true, label: 'blade', angle: phase,
    });
    this.all.push(blade);
    this.movers.push({ kind: 'blade', body: blade, ax, ay, omega, phase });
    this.items.push({ type: 'blade', ax, ay, groundY, len, thickness, blade });
  }

  // Elevator that LOWERS the car: identical mover math to the Mines/City
  // crane lift (parks at road level, travels to a hold target while ridden,
  // springs back once clear) — just with the ridden target BELOW road level.
  _elevator({ x0, y0, w, drop }) {
    const platform = Bodies.rectangle(x0 + w / 2, y0 + 11, w - 8, 22, {
      isStatic: true, friction: 1.0, label: 'terrain',
    });
    this.all.push(platform);
    this.movers.push({
      kind: 'lift', body: platform,
      yBot: y0 + 11, yTop: y0 + drop + 11, holdUntil: 0,
    });
    this.items.push({ type: 'elevator', body: platform, x0, y0, w, drop });
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

  render(ctx, carPos) {
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
      else if (it.type === 'compactor') this._renderCompactor(ctx, it);
      else if (it.type === 'conveyor') this._renderConveyor(ctx, it);
      else if (it.type === 'scrap') this._renderScrap(ctx, it);
      else if (it.type === 'pipe') this._renderPipe(ctx, it, carPos);
      else if (it.type === 'sludge') this._renderSludge(ctx, it);
      else if (it.type === 'spring') this._renderSpring(ctx, it);
      else if (it.type === 'blade') this._renderBlade(ctx, it);
      else if (it.type === 'elevator') this._renderElevator(ctx, it);
    }
  }

  // Drawn AFTER the car: canopies swallow snagged cars, water/lava/sludge submerge them.
  renderOverlay(ctx) {
    for (const it of this.items) {
      if (it.type === 'tree') this._renderCanopy(ctx, it);
      else if (it.type === 'water') this._renderWaterFront(ctx, it);
      else if (it.type === 'molten') this._renderMoltenFront(ctx, it);
      else if (it.type === 'sludge') this._renderSludgeFront(ctx, it);
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

  _renderCompactor(ctx, { body, cx, groundY, w, h, clearance }) {
    const top = groundY - clearance - h - 40;
    ctx.save();
    // Twin hydraulic cylinder housings, bigger than a plain press.
    ctx.fillStyle = '#4a5058';
    ctx.fillRect(cx - w / 2 - 34, top, 26, groundY - top);
    ctx.fillRect(cx + w / 2 + 8, top, 26, groundY - top);
    ctx.fillStyle = '#2b2e35';
    ctx.fillRect(cx - w / 2 - 40, top - 20, w + 80, 24);
    // Warning beacon: red while the ram is descending (lethal), green while
    // parked or rising (safe to pass) — the read the player times against.
    const crushing = !!body.plugin.crushing;
    ctx.beginPath();
    ctx.arc(cx, top - 32, 8, 0, Math.PI * 2);
    ctx.fillStyle = crushing ? '#ff5a3c' : '#4dbb63';
    ctx.fill();
    if (crushing) {
      ctx.fillStyle = 'rgba(255, 90, 60, 0.25)';
      ctx.beginPath();
      ctx.arc(cx, top - 32, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    // Piston shaft down to the block
    const blockTop = body.position.y - h / 2;
    ctx.fillStyle = '#7d8798';
    ctx.fillRect(cx - 16, top + 4, 32, blockTop - top - 4);
    // Block, tinted concrete for a heavy cast-iron read
    ctx.translate(cx - w / 2, blockTop);
    ctx.fillStyle = texPattern('concrete', '#525a68', 190) || '#454c58';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#20232a';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, w, h);
    // Crush-face stripes, clamped so the row spans the full block width
    for (let sx = 0, i = 0; sx < w; sx += 28, i++) {
      ctx.fillStyle = i % 2 ? '#20232a' : '#e8c34a';
      ctx.fillRect(sx, h - 18, Math.min(28, w - sx), 18);
    }
    ctx.restore();
  }

  _renderConveyor(ctx, { x0, groundY, w, speed }) {
    const t = this.engine.timing.timestamp / 1000;
    ctx.save();
    ctx.fillStyle = texPattern('concrete', '#3a3f47', 150) || '#33373d';
    ctx.fillRect(x0, groundY - 16, w, 20);
    // Rollers at both ends
    for (const rx of [x0, x0 + w]) {
      ctx.beginPath();
      ctx.arc(rx, groundY - 6, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#20232a';
      ctx.fill();
    }
    // Moving chevrons show direction + relative speed
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, groundY - 16, w, 20);
    ctx.clip();
    const dir = speed >= 0 ? 1 : -1;
    const spacing = 34;
    const scroll = ((t * speed * 20) % spacing + spacing) % spacing;
    ctx.strokeStyle = '#e8c34a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let cx = x0 - spacing + scroll; cx < x0 + w + spacing; cx += spacing) {
      ctx.beginPath();
      ctx.moveTo(cx - 8 * dir, groundY - 14);
      ctx.lineTo(cx + 8 * dir, groundY - 6);
      ctx.lineTo(cx - 8 * dir, groundY + 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  _renderScrap(ctx, { x0, w, topY, chunks }) {
    ctx.save();
    // Chute mouth
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(x0 - 10, topY - 260, w + 20, 260);
    ctx.fillStyle = '#e8c34a';
    for (let sx = x0; sx < x0 + w; sx += 26) {
      ctx.fillRect(sx, topY - 14, 14, 8);
    }
    // Parked chunks are drawn too (they're solid bodies wedged in the chute
    // mouth, like the rockfall boulder — and seeing one loaded telegraphs
    // the next drop); ghost trails only while actually falling.
    for (const { body, color } of chunks) {
      const verts = body.vertices;
      if (!body.isStatic) {
        // Trailing ghost for a falling read (cheap: two faded offset copies).
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = color;
        for (const s of [16, 32]) {
          ctx.beginPath();
          ctx.moveTo(verts[0].x, verts[0].y - s);
          for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y - s);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#1c1e22';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fill();
    }
    ctx.restore();
  }

  // Exterior always reads as a plain steel tube; interior rings/lighter tint
  // only appear while the car sits within the tube's bounding box, per spec
  // ("interior is shown only when the player is inside").
  _renderPipe(ctx, item, carPos) {
    const { pts, radius } = item;
    const inside = !!carPos && carPos.x >= item.minX - 30 && carPos.x <= item.maxX + 30
      && carPos.y >= item.minY - 30 && carPos.y <= item.maxY + 30;

    const top = [], bot = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      top.push({ x: pts[i].x - nx * radius * 2, y: pts[i].y - ny * radius * 2 });
      bot.push({ x: pts[i].x + nx * radius * 0.4, y: pts[i].y + ny * radius * 0.4 });
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (const p of top) ctx.lineTo(p.x, p.y);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
    ctx.fillStyle = texPattern('concrete', inside ? '#8d94a0' : '#565d68', 160)
      || (inside ? '#7d848f' : '#4c525c');
    ctx.fill();
    ctx.strokeStyle = '#2a2d33';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Rivet seams along the shell
    ctx.fillStyle = '#20232a';
    for (let i = 0; i < pts.length; i += 2) {
      ctx.beginPath();
      ctx.arc(top[i].x, top[i].y + 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (inside) {
      // Floor line along the path: the shell fill runs below the road line,
      // so without this the car looks like it's driving on nothing.
      ctx.strokeStyle = '#3a4049';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        i === 0 ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      // Interior rings sliding along the tube sell the hollow-cylinder read.
      const t = this.engine.timing.timestamp / 1000;
      ctx.strokeStyle = 'rgba(20,22,26,0.5)';
      ctx.lineWidth = 5;
      let acc = -((t * 90) % 70);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const segLen = Math.hypot(dx, dy) || 1;
        const nx = -dy / segLen, ny = dx / segLen;
        for (let d = acc; d < segLen; d += 70) {
          if (d < 0) continue;
          const tt = d / segLen;
          const rx = p0.x + dx * tt, ry = p0.y + dy * tt;
          ctx.beginPath();
          ctx.moveTo(rx - nx * radius * 1.9, ry - ny * radius * 1.9);
          ctx.lineTo(rx + nx * radius * 0.3, ry + ny * radius * 0.3);
          ctx.stroke();
        }
        acc -= segLen;
      }
    }

    // Open end caps: dark hollow mouths so the tube reads as a pipe even
    // from outside.
    for (const p of [pts[0], pts[pts.length - 1]]) {
      ctx.save();
      ctx.translate(p.x, p.y - radius * 0.8);
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, radius * 1.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0e0f11';
      ctx.fill();
      ctx.strokeStyle = '#2a2d33';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Traces a flat (gently rippled) liquid surface across the top and the
  // REAL terrain curve (floor, from _sludge()) across the bottom — so the
  // fill only ever occupies the space above the ground, never the ground
  // itself, and automatically matches whatever shape the dip actually is.
  _sludgePath(wetX0, wetX1, top, floor, t) {
    const path = new Path2D();
    let started = false;
    for (let sx = wetX0; sx <= wetX1; sx += 14) {
      const y = top + Math.sin(sx * 0.045 + t * 1.1) * 3;
      started ? path.lineTo(sx, y) : path.moveTo(sx, y);
      started = true;
    }
    path.lineTo(wetX1, top + Math.sin(wetX1 * 0.045 + t * 1.1) * 3);
    for (let i = floor.length - 1; i >= 0; i--) path.lineTo(floor[i].x, floor[i].y);
    path.closePath();
    return path;
  }

  _renderSludge(ctx, { wetX0, wetX1, top, floor }) {
    if (wetX1 - wetX0 < 1 || floor.length < 2) return;
    const t = this.engine.timing.timestamp / 1000;
    ctx.save();
    ctx.fillStyle = texPattern('mud', '#6b7a2e', 170) || '#565f22';
    ctx.fill(this._sludgePath(wetX0, wetX1, top, floor, t));
    // Surface line (the flat/rippled water line, not the ground)
    ctx.strokeStyle = '#8a9c3c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let sx = wetX0; sx <= wetX1; sx += 14) {
      const y = top + Math.sin(sx * 0.045 + t * 1.1) * 3;
      sx === wetX0 ? ctx.moveTo(sx, y) : ctx.lineTo(sx, y);
    }
    ctx.stroke();
    // Ooze bubbles near the surface
    ctx.fillStyle = '#b8c25a';
    for (let k = 0; k < 4; k++) {
      const px = wetX0 + ((k * 71 + 23) % Math.max(1, wetX1 - wetX0 - 20)) + 10;
      const cycle = (t * 0.6 + k * 0.4) % 1;
      ctx.globalAlpha = 1 - cycle;
      ctx.beginPath();
      ctx.arc(px, top - 2 - cycle * 10, 2.5 + cycle * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Translucent front pass so a submerged car reads as coated in goo — same
  // ground-hugging shape as the main fill.
  _renderSludgeFront(ctx, { wetX0, wetX1, top, floor }) {
    if (wetX1 - wetX0 < 1 || floor.length < 2) return;
    const t = this.engine.timing.timestamp / 1000;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#5b6b26';
    ctx.fill(this._sludgePath(wetX0, wetX1, top, floor, t));
    ctx.restore();
  }

  // Idle: coiled flat into the floor, reads as just a yellow warning line.
  // On a fresh contact (pad.plugin.lastRider, stamped by PhysicsWorld) the
  // coil pops up fast then eases back down flat over FIRE_MS.
  _renderSpring(ctx, { x, groundY, w, pad }) {
    const now = this.engine.timing.timestamp;
    const FIRE_MS = 500;
    const elapsed = now - (pad.plugin.lastRider ?? -Infinity);
    let extend = 0;
    if (elapsed >= 0 && elapsed < FIRE_MS) {
      const t = elapsed / FIRE_MS;
      extend = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
    }
    ctx.save();
    // Base plate covers the (low) physics pad exactly, so what you roll
    // over is what you see.
    ctx.fillStyle = '#3a3d45';
    ctx.fillRect(x - w / 2, groundY - 14, w, 18);
    if (extend <= 0.03) {
      // Idle: just the coil's top edge, flush with the plate.
      ctx.strokeStyle = '#e8c34a';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + 10, groundY - 12);
      ctx.lineTo(x + w / 2 - 10, groundY - 12);
      ctx.stroke();
    } else {
      const coilH = 70 * extend;
      const coils = 5;
      const cw = w * 0.7;
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= coils * 2; i++) {
        const px = x - cw / 2 + (cw * i) / (coils * 2);
        const py = groundY - 12 - (coilH * i) / (coils * 2);
        const jog = (i % 2 === 0 ? -1 : 1) * cw * 0.12;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px + jog, py);
      }
      ctx.stroke();
      ctx.fillStyle = '#e8c34a';
      ctx.fillRect(x - w / 2 + 6, groundY - 12 - coilH - 8, w - 12, 10);
    }
    ctx.restore();
  }

  _renderBlade(ctx, { ax, ay, groundY, len, thickness = 30, blade }) {
    const half = thickness / 2;
    ctx.save();
    // Support post: mounting bracket above the hub, full column down to the
    // ground below it — a proper post, not just a stub between hub and floor.
    const postTop = ay - 55;
    ctx.fillStyle = '#454b57';
    ctx.fillRect(ax - 12, postTop, 24, Math.max(0, groundY - postTop));
    ctx.fillStyle = '#33363d';
    ctx.fillRect(ax - 22, postTop - 16, 44, 18);
    // Everything from here is clipped to ABOVE the road line: the sweep
    // circle touches the floor, so an unclipped wash would paint a gray arc
    // across the terrain, and the blade tip (which overlaps the floor by
    // ~15px so no gap survives at the bottom of the sweep) would slice
    // through the surface stripe instead of vanishing into it.
    ctx.beginPath();
    ctx.rect(ax - len / 2 - 24, ay - len / 2 - 24, len + 48, groundY - (ay - len / 2 - 24));
    ctx.clip();
    // Danger disc: the full swept area, faint fill + thin rim.
    ctx.fillStyle = 'rgba(200, 210, 220, 0.10)';
    ctx.beginPath();
    ctx.arc(ax, ay, len / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 210, 220, 0.3)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Blade bar
    ctx.save();
    ctx.translate(blade.position.x, blade.position.y);
    ctx.rotate(blade.angle);
    ctx.fillStyle = '#c7ced9';
    ctx.fillRect(-len / 2, -half, len, thickness);
    ctx.strokeStyle = '#5a606b';
    ctx.lineWidth = 2;
    ctx.strokeRect(-len / 2, -half, len, thickness);
    ctx.fillStyle = '#8a919c';
    for (const s of [-1, 1]) {
      for (let tx = -len / 2 + 6; tx < len / 2 - 6; tx += 18) {
        ctx.beginPath();
        ctx.moveTo(tx, s * half);
        ctx.lineTo(tx + 9, s * half);
        ctx.lineTo(tx + 4.5, s * (half + 9));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    // Hub cap (drawn last, on top of the blade center)
    ctx.beginPath();
    ctx.arc(ax, ay, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2e35';
    ctx.fill();
    ctx.strokeStyle = '#0f1114';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Down-elevator: a hydraulic platform that sinks into its shaft. All the
  // machinery lives BELOW the deck (piston from the shaft floor) — nothing
  // is drawn across the mouth at car height, so the car never appears to
  // drive through structure on its way onto the platform.
  _renderElevator(ctx, { body, x0, y0, w, drop }) {
    const px = body.position.x, py = body.position.y - 11;
    const floorY = y0 + drop;
    ctx.save();
    // Shaft void the platform descends through, so the hole reads clearly
    // instead of the platform looking like it floats in open air.
    const grad = ctx.createLinearGradient(0, y0, 0, floorY);
    grad.addColorStop(0, '#16171b');
    grad.addColorStop(1, '#050506');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, w, drop);
    // Guide rails
    ctx.fillStyle = '#3a3d45';
    ctx.fillRect(x0 - 8, y0 - 6, 12, drop + 6);
    ctx.fillRect(x0 + w - 4, y0 - 6, 12, drop + 6);
    // Hazard stripes across the mouth (clamped to exactly w)
    for (let sx = 0, i = 0; sx < w; sx += 24, i++) {
      ctx.fillStyle = i % 2 ? '#1c1e22' : '#e8c34a';
      ctx.fillRect(x0 + sx, y0 - 10, Math.min(24, w - sx), 10);
    }
    // Hydraulic piston: fixed outer sleeve rising from the shaft floor,
    // inner rod telescoping up to the platform underside.
    const sleeveH = Math.max(40, drop * 0.4);
    ctx.fillStyle = '#33363d';
    ctx.fillRect(px - 30, floorY - 12, 60, 12); // base plate
    ctx.fillStyle = '#454b57';
    ctx.fillRect(px - 17, floorY - sleeveH, 34, sleeveH);
    ctx.fillStyle = '#7d8798';
    ctx.fillRect(px - 8, py + 22, 16, Math.max(0, floorY - sleeveH - (py + 22)));
    // Platform deck
    ctx.fillStyle = '#6a7181';
    ctx.fillRect(px - w / 2 + 4, py, w - 8, 22);
    ctx.fillStyle = '#e8c34a';
    ctx.fillRect(px - w / 2 + 4, py, w - 8, 5);
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
