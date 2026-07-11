// Chassis + spring-damper wheel suspension car (spec §3).
// Each wheel hangs from two angled constraints (a triangle), which gives
// vertical spring travel while staying laterally rigid.

const { Bodies, Body, Composite, Constraint } = Matter;

const CONTACT_WINDOW_MS = 90; // wheel counts as grounded if it touched terrain this recently
const STUCK_GRACE_S = 1.5;    // spec §3.3

// Matter stores angular velocity in radians per 16.6ms step; vehicle stats are
// authored in human-readable rad/s, so convert by /60.
const PER_STEP = 1 / 60;

function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export class Car {
  constructor(stats, x, y) {
    this.stats = stats;
    const { width, height, wheelRadius, wheelBase, density, comY = 0 } = stats.body;

    const group = Body.nextGroup(true); // negative group: car parts never self-collide

    // The collider is only the BOTTOM HALF of the sprite box (the cabin/rider
    // above is visual-only), centred height/4 below the sprite centre.
    this.chassis = Bodies.rectangle(x, y + height / 4, width, height / 2, {
      label: 'chassis',
      density,
      friction: 0.4,
      restitution: 0.05,
      collisionFilter: { group },
      chamfer: { radius: 6 },
    });
    // Drop the centre of mass to comY below the SPRITE centre (body.comY,
    // vehicles.js) so tall sprites don't wheelie/flip. After this,
    // chassis.position is the COM — comY below the sprite's centre — so
    // constraint anchors and rendering offset by comY to stay in sprite space.
    const comOffset = comY - height / 4; // collider centre → target COM
    if (comOffset) Body.setCentre(this.chassis, { x: 0, y: comOffset }, true);

    // body.wheelY (vehicles.js) sets how far below the chassis center the
    // wheels hang at rest; suspension travel tier still adds ride height.
    const wheelDrop = (stats.body.wheelY ?? height / 2) + wheelRadius * 0.8 * stats.travel;
    this.wheels = [-1, 1].map(side => {
      const wheel = Bodies.circle(x + side * wheelBase / 2, y + wheelDrop, wheelRadius, {
        label: 'wheel',
        density: 0.0012,
        friction: stats.grip,
        frictionStatic: stats.grip * 1.1,
        restitution: 0.1,
        collisionFilter: { group },
      });
      wheel.plugin.lastContact = -Infinity;
      return wheel;
    });
    this.chassis.plugin.lastContact = -Infinity;

    // Two angled spring constraints per wheel, anchored at the chassis TOP edge.
    // The deep triangle keeps the wheel from swinging past the anchors and
    // "inverting" the suspension on hard landings.
    this.constraints = [];
    const spread = Math.min(26, wheelBase * 0.4);
    // Rigid fore/aft guide links sit at hub height, so they're near-horizontal:
    // vertical spring travel only stretches them second-order, but any
    // horizontal force on the wheel (drive, braking, bumps) loads them
    // first-order. They emulate a prismatic joint — without them the soft
    // springs are all that holds the wheel's x, and it swings back and forth
    // under the car (badly so with tall sprite-sized chassis, whose high
    // anchors make the spring pair nearly parallel).
    const guide = Math.max(24, wheelBase * 0.35);
    this.wheels.forEach((wheel, i) => {
      const side = i === 0 ? -1 : 1;
      for (const s of [-spread, spread]) {
        this.constraints.push(Constraint.create({
          bodyA: this.chassis,
          pointA: { x: side * wheelBase / 2 + s, y: -height / 2 - comY },
          bodyB: wheel,
          stiffness: stats.stiffness,
          damping: stats.damping,
        }));
      }
      for (const s of [-guide, guide]) {
        this.constraints.push(Constraint.create({
          bodyA: this.chassis,
          pointA: { x: side * wheelBase / 2 + s, y: wheelDrop - comY },
          bodyB: wheel,
          stiffness: 0.3,
          damping: 0.1,
        }));
      }
    });

    this.composite = Composite.create();
    Composite.add(this.composite, [this.chassis, ...this.wheels, ...this.constraints]);

    // Run-state tracking
    this.everFlipped = false;
    this.stuckTimer = 0;
    this.waterTime = 0;
    this.moltenTime = 0;
    this.lavaKind = 'lava';   // last molten zone touched ('lava'/'acid'), for the fail message
    this.bounceReadyAt = 0;   // tire-stack bounce cooldown
    this.springReadyAt = 0;   // Factory spring-launch cooldown
    this.sludgeLethality = 0; // 0..1 corrosion bar for Factory sludge vats
    this.airTime = 0;
    this.prevVelY = 0;
    this.landingImpact = 0; // set for one frame on hard landings (camera shake hook)
  }

  addTo(world) { world.add(this.composite); }
  removeFrom(world) { world.remove(this.composite); }

  isWheelGrounded(wheel, now) {
    return now - wheel.plugin.lastContact < CONTACT_WINDOW_MS;
  }

  groundedWheelCount(now) {
    return this.wheels.filter(w => this.isWheelGrounded(w, now)).length;
  }

  // Normalized chassis angle in [-PI, PI]; |angle| > ~2.2 means roof-down.
  normAngle() {
    let a = this.chassis.angle % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  speed() { return this.chassis.speed; }
  position() { return this.chassis.position; }
  velocity() { return this.chassis.velocity; }

  // Called once per fixed physics step, BEFORE world.step().
  // Returns 'stuck' when the flip-and-stuck fail state triggers.
  update(inputState, dtSeconds, now) {
    // Wrecking-ball hit, press crush, falling debris/fireball or arrow volley
    // destroys the car outright; crushedBy tells GameScreen what did it.
    const crusher = [this.chassis, ...this.wheels].find(
      b => now - (b.plugin.lastCrush ?? -Infinity) < 60,
    );
    if (crusher) {
      this.crushedBy = crusher.plugin.crushKind;
      return 'crushed';
    }

    const s = this.stats;
    const grounded = this.groundedWheelCount(now) > 0;
    const airborne = this.groundedWheelCount(now) === 0;
    // Air control needs the car fully free of the world: no wheel OR chassis
    // touching terrain or any other solid object (PhysicsWorld stamps
    // plugin.lastTouch on every non-sensor contact).
    const freeFloating = ![this.chassis, ...this.wheels].some(
      b => now - (b.plugin.lastTouch ?? -Infinity) < CONTACT_WINDOW_MS,
    );

    // Terrain grip scales drive/brake force with the surface the wheels are
    // ON right now (mud spins wheels, ice takes the pedals away; spec §3.4).
    // Use the slipperiest FRESH wheel contact — a stale reading from a
    // surface already left behind (or one wheel still on tarmac while the
    // other rides the ice) must not keep full grip on a slick patch.
    let terrainGrip = 1;
    for (const w of this.wheels) {
      if (now - w.plugin.lastContact < CONTACT_WINDOW_MS) {
        terrainGrip = Math.min(terrainGrip, (w.plugin.contactFriction ?? 1) * 1.15);
      }
    }
    this.debugGrip = terrainGrip; // read by the ?debug=1 HUD overlay

    const topOmega = s.topSpeed * PER_STEP;
    const airOmega = s.airControl * PER_STEP;
    // Drive force on the chassis is what actually moves the car (wheel spin
    // alone gets eaten by the friction solver); torque tier scales it.
    const DRIVE_FORCE = 0.0009;
    const groundedFrac = this.groundedWheelCount(now) / this.wheels.length;

    if (inputState.gas) {
      if (grounded) {
        const spinUp = s.torque * 8 * dtSeconds;
        for (const w of this.wheels) {
          Body.setAngularVelocity(w, approach(w.angularVelocity, topOmega, spinUp));
        }
        // Taper force as the car approaches top speed (surface speed of wheels).
        const topVx = topOmega * s.body.wheelRadius;
        const headroom = Math.max(0, 1 - this.chassis.velocity.x / topVx);
        Body.applyForce(this.chassis, this.chassis.position, {
          x: s.torque * DRIVE_FORCE * terrainGrip * groundedFrac * headroom,
          y: 0,
        });
      }
      if (freeFloating) {
        // Nose-up (spec §3.2): counterclockwise in screen coords.
        Body.setAngularVelocity(this.chassis,
          approach(this.chassis.angularVelocity, -airOmega, airOmega * 4 * dtSeconds));
      }
    }

    if (inputState.brake) {
      if (grounded) {
        const movingForward = this.chassis.velocity.x > 0.6;
        if (movingForward) {
          const decel = s.torque * 12 * dtSeconds * s.brakePower;
          for (const w of this.wheels) {
            Body.setAngularVelocity(w, approach(w.angularVelocity, 0, decel));
          }
          // Scaled by terrainGrip: brakes must fade on mud and vanish on ice
          // just like drive does — this force is the main brake channel, so
          // leaving it unscaled made every surface stop like dry tarmac.
          Body.applyForce(this.chassis, this.chassis.position, {
            x: -s.torque * DRIVE_FORCE * 0.8 * s.brakePower * terrainGrip * groundedFrac,
            y: 0,
          });
        } else {
          const spinUp = s.torque * 6 * dtSeconds * s.brakePower;
          for (const w of this.wheels) {
            Body.setAngularVelocity(w, approach(w.angularVelocity, -topOmega * 0.55, spinUp));
          }
          const topVx = topOmega * 0.55 * s.body.wheelRadius;
          const headroom = Math.max(0, 1 + this.chassis.velocity.x / topVx);
          Body.applyForce(this.chassis, this.chassis.position, {
            x: -s.torque * DRIVE_FORCE * 0.7 * s.brakePower * terrainGrip * groundedFrac * headroom,
            y: 0,
          });
        }
      }
      if (freeFloating) {
        // Nose-down.
        Body.setAngularVelocity(this.chassis,
          approach(this.chassis.angularVelocity, airOmega, airOmega * 4 * dtSeconds));
      }
    }

    // --- Sensor zones (canopy/oil/updraft/water; PhysicsWorld stamps these) ---
    const zoneRef = (key) => {
      for (const b of [this.chassis, ...this.wheels]) {
        if (now - (b.plugin['last' + key] ?? -Infinity) < 60) return b.plugin['zone' + key];
      }
      return null;
    };

    // Spike strip: any contact shreds the tires — jump it or lose the run.
    if (zoneRef('Spikes')) return 'popped';

    // Tree canopy snag: bleed velocity hard while touching leaves.
    const inCanopy = !!zoneRef('Canopy');
    if (inCanopy) {
      Body.setVelocity(this.chassis, {
        x: this.chassis.velocity.x * 0.88,
        y: this.chassis.velocity.y * 0.9,
      });
      Body.setAngularVelocity(this.chassis, this.chassis.angularVelocity * 0.9);
    }

    // Oil slick: violent horizontal shove. push > 0 boosts along the road,
    // push < 0 fights (and can reverse) your momentum.
    const oil = zoneRef('Oil');
    if (oil && grounded) {
      Body.applyForce(this.chassis, this.chassis.position, {
        x: (oil.plugin.push ?? 1) * 0.0004 * this.chassis.mass,
        y: 0,
      });
    }

    // Updraft fan: lift in multiples of gravity on the whole car (gravity.y
    // is 0.35 in PhysicsWorld; Matter's gravity force = mass * g * 0.001).
    // Terminal rise rate: without the cap a slow car dwelling in the column
    // gets tossed sky-high, bleeds vx to air drag, and splashes down vertically.
    const draft = zoneRef('Updraft');
    if (draft && this.chassis.velocity.y > -3.5) {
      const mass = this.chassis.mass + this.wheels[0].mass + this.wheels[1].mass;
      const liftForce = (draft.plugin.lift ?? 2.8) * mass * 0.35 * 0.001;
      // Tilted slightly forward so a slow car gets carried across, never
      // trapped hovering in the column.
      Body.applyForce(this.chassis, this.chassis.position, {
        x: liftForce * 0.3,
        y: -liftForce,
      });
    }

    // Water: heavy drag while submerged; stay under too long and you sink.
    // A fast skim across the surface is survivable.
    const inWater = !!zoneRef('Water');
    if (inWater) {
      Body.setVelocity(this.chassis, {
        x: this.chassis.velocity.x * 0.9,
        y: this.chassis.velocity.y * 0.93,
      });
      this.waterTime += dtSeconds;
      if (this.waterTime > 0.55) return 'sank';
    } else {
      this.waterTime = 0;
    }

    // Molten rock / acid: near-instant death. Unlike water there is no skim —
    // the tiny grace only forgives a sensor-edge graze at the lip.
    const molten = zoneRef('Molten');
    if (molten) {
      this.lavaKind = molten.plugin.kind ?? 'lava';
      Body.setVelocity(this.chassis, {
        x: this.chassis.velocity.x * 0.9,
        y: this.chassis.velocity.y * 0.9,
      });
      this.moltenTime += dtSeconds;
      if (this.moltenTime > 0.12) return 'melted';
    } else {
      this.moltenTime = 0;
    }

    // Sludge vat: corrosive goo pooled in a dip. Unlike molten pools this
    // doesn't kill on contact — a lethality bar fills while submerged and
    // drains while clear, so a quick splash through is survivable but
    // dawdling (or repeated grazes) melts the car. Heavy drag like water.
    const sludge = zoneRef('Sludge');
    if (sludge) {
      Body.setVelocity(this.chassis, {
        x: this.chassis.velocity.x * 0.95,
        y: this.chassis.velocity.y * 0.9,
      });
      this.sludgeLethality = Math.min(1, this.sludgeLethality + dtSeconds / 4);
      if (this.sludgeLethality >= 1) return 'dissolved';
    } else {
      this.sludgeLethality = Math.max(0, this.sludgeLethality - dtSeconds / 8);
    }

    // Conveyor belt: steady horizontal shove while grounded on it, direction
    // and strength set per-belt (push < 0 runs against travel).
    const belt = zoneRef('Conveyor');
    if (belt && grounded) {
      Body.applyForce(this.chassis, this.chassis.position, {
        x: (belt.plugin.speed ?? 4) * 0.00012 * this.chassis.mass,
        y: 0,
      });
    }

    // Coiled ground spring: any fresh contact launches the car hard, on a
    // cooldown so it fires once per pass rather than every physics step.
    // Biased mostly forward with a modest pop upward — a distance launch,
    // not a near-vertical one.
    const spring = zoneRef('Spring');
    if (spring && now > this.springReadyAt) {
      const vy = spring.plugin.launchVel ?? 19;
      const fx = vy * 0.55, fy = -vy * 0.7;
      Body.setVelocity(this.chassis, { x: this.chassis.velocity.x + fx, y: fy });
      for (const w of this.wheels) {
        Body.setVelocity(w, { x: w.velocity.x + fx, y: fy });
      }
      this.springReadyAt = now + 600;
    }

    // Tire-stack bounce pad: launch scales with landing impact, so a fall
    // bounces high and repeated bounces build height (a stalled car can
    // trampoline its way up). Tilted slightly forward like the updraft so a
    // dead-stop car still drifts toward the ledge instead of pogoing in place.
    const bouncer = zoneRef('Bouncer');
    if (bouncer && now > this.bounceReadyAt) {
      const impact = Math.max(0, this.prevVelY);
      const vy = Math.min(16.5, 6 + impact * 1.05);
      Body.setVelocity(this.chassis, { x: this.chassis.velocity.x + vy * 0.15, y: -vy });
      for (const w of this.wheels) {
        Body.setVelocity(w, { x: w.velocity.x + vy * 0.15, y: -vy });
      }
      this.bounceReadyAt = now + 500;
    }

    // --- Airtime + landing impact tracking ---
    if (airborne) {
      this.airTime += dtSeconds;
      this._wasAirborne = true;
    } else if (this._wasAirborne) {
      this._wasAirborne = false;
      const impact = this.prevVelY; // downward velocity just before landing
      if (impact > 9) this.landingImpact = impact;
    }
    this.prevVelY = this.chassis.velocity.y;

    // --- Flip / stuck detection (spec §2.2, §3.3) ---
    const a = Math.abs(this.normAngle());
    if (a > 2.1) this.everFlipped = true;

    const inverted = a > 1.9;
    const slow = this.chassis.speed < 2 && Math.abs(this.chassis.angularVelocity) < 0.08;
    const chassisDragging = now - this.chassis.plugin.lastContact < CONTACT_WINDOW_MS;
    const wedged = inverted || (chassisDragging && airborne && a > 1.3);

    // Dangling in leaves or bobbing in water/sludge isn't "stuck" — those resolve themselves.
    if (wedged && slow && !inCanopy && !inWater && !sludge) {
      this.stuckTimer += dtSeconds;
      if (this.stuckTimer >= STUCK_GRACE_S) return 'stuck';
    } else {
      this.stuckTimer = 0;
    }
    return null;
  }

  consumeLandingImpact() {
    const v = this.landingImpact;
    this.landingImpact = 0;
    return v;
  }
}
