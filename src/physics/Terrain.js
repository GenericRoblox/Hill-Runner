// Builds static Matter bodies from level data (chains of surface points + walls).
// Each chain segment becomes a thin rotated rectangle whose top edge lies on the
// authored surface line. Chains keep their point arrays for rendering.

const { Bodies } = Matter;

const SEGMENT_THICKNESS = 26;
const MUD_FRICTION = 0.1;
const ICE_FRICTION = 0.05; // near-frictionless: no drive, no brakes — coast it

export class Terrain {
  // startWall: false for streamed chunks (infinite mode) — the reverse-stop
  // wall only belongs at the very start of a run, not at every chunk seam.
  constructor(level, world, { startWall = true } = {}) {
    this.level = level;
    this.bodies = [];

    for (const chain of level.chains) {
      const friction = chain.surface === 'mud' ? MUD_FRICTION
        : chain.surface === 'ice' ? ICE_FRICTION
        : level.friction;
      for (let i = 0; i < chain.length - 1; i++) {
        const p0 = chain[i], p1 = chain[i + 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const angle = Math.atan2(dy, dx);
        // Offset center half a thickness along the downward-facing normal, so the
        // body's top face lies exactly on the authored surface line.
        const nx = -dy / len, ny = dx / len;
        const cx = (p0.x + p1.x) / 2 + nx * (SEGMENT_THICKNESS / 2);
        const cy = (p0.y + p1.y) / 2 + ny * (SEGMENT_THICKNESS / 2);
        const body = Bodies.rectangle(cx, cy, len + 2, SEGMENT_THICKNESS, {
          isStatic: true,
          angle,
          friction,
          label: 'terrain',
        });
        // Matter's Body.setStatic (run by the isStatic option above) FORCES
        // friction to 1 on static bodies, stashing the authored value in
        // body._original. Re-assign after creation or every static surface —
        // ice and mud included — collides at friction 1 and feels identical.
        body.friction = friction;
        this.bodies.push(body);
      }
    }

    for (const wall of level.walls) {
      const body = Bodies.rectangle(wall.cx, wall.cy, wall.w, wall.h, {
        isStatic: true,
        friction: wall.friction ?? 0.6,
        label: 'terrain',
      });
      body.friction = wall.friction ?? 0.6; // see static-friction note above
      this.bodies.push(body);
    }

    // Invisible wall at level start so the player can't reverse out of the world.
    if (startWall && level.chains.length) {
      const first = level.chains[0][0];
      const wall = Bodies.rectangle(first.x - 40, first.y - 200, 40, 500, {
        isStatic: true,
        friction: 0.1,
        label: 'terrain',
      });
      wall.friction = 0.1; // see static-friction note above
      this.bodies.push(wall);
    }

    for (const b of this.bodies) world.add(b);
    this.world = world;
  }

  destroy() {
    for (const b of this.bodies) this.world.remove(b);
    this.bodies = [];
  }
}
