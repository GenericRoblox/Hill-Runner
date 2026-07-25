// Thin wrapper around Matter.js: engine lifecycle + wheel/chassis ground-contact
// tracking via collision events (used for grounded checks and stuck detection).

const { Engine, Composite, Events } = Matter;

export class PhysicsWorld {
  constructor() {
    this.engine = Engine.create();
    this.engine.gravity.y = 0.35;
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;

    // Sensor zone labels -> plugin key suffix. Car.js reads plugin['last'+Key]
    // (recent-contact time) and plugin['zone'+Key] (the zone body, which
    // carries per-zone params like push/lift on its own plugin).
    const ZONES = {
      canopy: 'Canopy', oil: 'Oil', updraft: 'Updraft', water: 'Water', molten: 'Molten',
      bouncer: 'Bouncer', spikes: 'Spikes', sludge: 'Sludge', conveyor: 'Conveyor', spring: 'Spring',
    };
    // A wrecking ball/flail kills on CLOSING SPEED — how fast the gap between
    // ball and car is shutting, counting both bodies' motion. So it's lethal
    // whether the ball swings into a parked car OR the car drives hard into a
    // hanging one; what survives is a low-energy touch. Catching up to a ball
    // swinging away is still safe (the gap is opening, not closing), which is
    // deliberate: a car crossing behind a swing outruns the ball and would
    // otherwise die rear-ending it.
    const CLOSING_KILL = 4.5; // px/step
    const ballStrike = (ball, other) => {
      const dx = other.position.x - ball.position.x;
      const dy = other.position.y - ball.position.y;
      const d = Math.hypot(dx, dy) || 1;
      const rvx = ball.velocity.x - other.velocity.x;
      const rvy = ball.velocity.y - other.velocity.y;
      return (rvx * dx + rvy * dy) / d > CLOSING_KILL;
    };
    // Other lethal contacts: presses (and the bigger Factory compactors)
    // while descending, rockfall/scrap debris, fireballs and loosed arrows
    // while in flight (parked they're scenery), spinning Factory blades any
    // time they're touched.
    const lethal = (body, other) =>
      (body.label === 'ball' && ballStrike(body, other)) ||
      (body.label === 'press' && body.plugin.crushing) ||
      (body.label === 'compactor' && body.plugin.crushing) ||
      (body.label === 'debris' && !body.isStatic) ||
      (body.label === 'fireball' && !body.isStatic) ||
      (body.label === 'arrow' && !body.isStatic) ||
      (body.label === 'blade');
    const markContact = (e) => {
      const now = this.engine.timing.timestamp;
      for (const pair of e.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        // Tire stacks and spring pads count as ground too: you can drive on/off them.
        if (a.label === 'terrain' || a.label === 'bouncer' || a.label === 'spring') this._mark(b, a, now);
        else if (b.label === 'terrain' || b.label === 'bouncer' || b.label === 'spring') this._mark(a, b, now);
        // Any SOLID contact (terrain or object alike) suppresses air control
        // (Car.js reads plugin.lastTouch). Sensors (zones) don't count.
        if (!a.isSensor && !b.isSensor) {
          this._markTouch(a, now);
          this._markTouch(b, now);
        }
        const za = ZONES[a.label], zb = ZONES[b.label];
        if (za) this._markZone(b, za, a, now);
        else if (zb) this._markZone(a, zb, b, now);
        if (lethal(a, b)) this._markCrush(b, a.label, now);
        else if (lethal(b, a)) this._markCrush(a, b.label, now);
      }
    };
    Events.on(this.engine, 'collisionStart', markContact);
    Events.on(this.engine, 'collisionActive', markContact);
  }

  _mark(body, terrain, now) {
    if (body.label === 'wheel' || body.label === 'chassis') {
      body.plugin.lastContact = now;
      body.plugin.contactFriction = terrain.friction;
      terrain.plugin.lastRider = now; // kinematic platforms key off this
    }
  }

  _markTouch(body, now) {
    if (body.label === 'wheel' || body.label === 'chassis') {
      body.plugin.lastTouch = now;
    }
  }

  _markZone(body, key, zone, now) {
    if (body.label === 'wheel' || body.label === 'chassis') {
      body.plugin['last' + key] = now;
      body.plugin['zone' + key] = zone;
    }
  }

  _markCrush(body, kind, now) {
    if (body.label === 'wheel' || body.label === 'chassis') {
      body.plugin.lastCrush = now;
      body.plugin.crushKind = kind; // Car copies this out for the fail message
    }
  }

  add(bodyOrComposite) {
    Composite.add(this.engine.world, bodyOrComposite);
  }

  remove(bodyOrComposite) {
    Composite.remove(this.engine.world, bodyOrComposite);
  }

  // Fixed-step update; dt in ms.
  step(dt) {
    Engine.update(this.engine, dt);
  }

  timestamp() {
    return this.engine.timing.timestamp;
  }

  destroy() {
    Events.off(this.engine);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}
