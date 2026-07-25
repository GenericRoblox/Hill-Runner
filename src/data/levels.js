// Farm world (World 1) — 10 tutorial-arc levels per spec §5.2.
// Terrain = array of "chains" (drivable point strips). A break between chains is a pit.
// Walls are static rectangles (fences, hole-in-wall obstacles, overhead beams).
// Obstacles (built by physics/Obstacles.js): ramps, seesaws, rope bridges.

const GROUND_Y = 600;

// --- Terrain authoring helper -----------------------------------------------

export class LevelBuilder {
  constructor(startX = 0, startY = GROUND_Y) {
    this.chains = [];
    this.walls = [];
    this.obstacles = [];
    this.buildings = [];
    this._chain = [{ x: startX, y: startY }];
    this.x = startX;
    this.y = startY;
  }

  _push(x, y) {
    this._chain.push({ x, y });
    if (this._pipePts) this._pipePts.push({ x, y }); // see pipeStart()/pipeEnd()
    this.x = x;
    this.y = y;
    return this;
  }

  flat(dx) { return this._push(this.x + dx, this.y); }

  // Flat rooftop: identical terrain to flat(), plus a building facade drawn
  // beneath the span (GameScreen renders level.buildings behind the action).
  roof(dx) {
    this.buildings.push({ x0: this.x, x1: this.x + dx, y: this.y });
    return this.flat(dx);
  }

  slope(dx, dy, segments = 6) {
    // Cosine-eased slope for smooth entry/exit.
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const e = (1 - Math.cos(Math.PI * t)) / 2;
      this._push(x0 + dx * t, y0 + dy * e);
    }
    return this;
  }

  // One smooth bump: up `h` then back down over width `w`.
  hill(w, h, segments = 10) {
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      this._push(x0 + w * t, y0 - h * Math.sin(Math.PI * t));
    }
    return this;
  }

  hills(count, w, h) {
    for (let i = 0; i < count; i++) this.hill(w, h);
    return this;
  }

  valley(w, d, segments = 10) { return this.hill(w, -d, segments); }

  // --- Terrain character ------------------------------------------------
  // Worlds are supposed to FEEL different underfoot, not just look different.
  // These build the open ground between hazards; `hill()`/`flat()` alone give
  // every world the same bumpy-then-flat road.

  // Rolling country: a continuous wave whose crest heights and wavelengths
  // both vary, optionally drifting up or downhill (`drift` px per wave). This
  // is the Farm/Mines idiom — the ground is never level for long. Crest sizes
  // are paired with wavelengths so no wave exceeds the ~40 degree climb limit
  // at h = 0.19 * w (the documented ceiling for this helper's `h`).
  waves(count, w, h, drift = 0) {
    for (let i = 0; i < count; i++) {
      const k = i % 2 ? (i % 4 === 1 ? 0.6 : 0.8) : (i % 4 === 0 ? 1 : 1.2);
      const ww = w * (i % 2 ? 0.85 : 1.12);
      this.hill(ww, h * k, 12);
      if (drift) this.slope(ww * 0.5, drift, 5);
    }
    return this;
  }

  // A dip and the climb back out as one continuous curve: a basin you carry
  // speed through, not a notch. Keep d <= w * 0.18 — the cosine easing peaks
  // at PI/2 times the average grade, and past that the climb out is unclimbable.
  basin(w, d) {
    const s = w * 0.44;
    return this.slope(s, d, 8).flat(w * 0.12).slope(s, -d, 8);
  }

  // A rise onto a plateau and back down — a landform, not a bump. Same grade
  // ceiling as basin(): keep h <= up * 0.44.
  mesa(up, top, down, h) {
    return this.slope(up, -h, 8).flat(top).slope(down, h, 8);
  }

  // Terraced ground: flat shelves joined by short, straight, DEFINED ramps —
  // the City/Factory idiom, all clean edges and no rolling country. `steps` is
  // a list of [shelfLength, riseDown] pairs; ramps are cut at ~33 degrees.
  terrace(steps) {
    for (const [run, rise] of steps) {
      this.flat(run);
      if (rise) this.slope(Math.max(90, Math.abs(rise) * 2.4), rise, 4);
    }
    return this;
  }

  // Sawtooth machine-floor profile: shelf, step, shelf... `rise` alternates
  // sign so a run of steps stays around its starting height; `bias` tilts the
  // whole run so it genuinely descends (or climbs).
  steps(count, run, rise, bias = 0) {
    for (let i = 0; i < count; i++) {
      this.flat(run);
      const dy = (i % 2 ? -rise : rise) + bias;
      this.slope(Math.max(90, Math.abs(dy) * 2.4), dy, 4);
    }
    return this.flat(run * 0.5);
  }

  // Low overhead beam across the road at `ox` ahead, its underside
  // `clearance` px above the current ground line: stay grounded, there is no
  // jumping this. Two looks, both drawn as real structure rather than a bar
  // floating in mid-air: 'shed' is a drive-through farm machine shed you pass
  // through the inside of, 'gantry' is the soffit of a concrete overpass.
  // `groundY` is recorded because both renderers need to plant themselves on
  // the road — a header beam with nothing under it is the thing we're fixing.
  lowBeam(ox, w = 320, clearance = 145, t = 26, style = 'shed') {
    this.walls.push({
      cx: this.x + ox, cy: this.y - clearance - t / 2, w, h: t,
      style, groundY: this.y,
    });
    return this;
  }

  // End current chain, resume a new one after a horizontal gap (a pit).
  gap(w, dy = 0) {
    if (this._chain.length > 1) this.chains.push(this._chain);
    this.x += w;
    this.y += dy;
    this._chain = [{ x: this.x, y: this.y }];
    return this;
  }

  // Vertical drop-off (cliff edge) then continue.
  drop(h) {
    this._push(this.x, this.y + h);
    return this;
  }

  // Fence/wall standing on the current ground height at offset ox ahead.
  wallHere(ox, w, h, friction) {
    this.walls.push({ cx: this.x + ox, cy: this.y - h / 2, w, h, friction });
    return this;
  }

  // Free-floating wall/beam at absolute position.
  wallAt(cx, cy, w, h, friction) {
    this.walls.push({ cx, cy, w, h, friction });
    return this;
  }

  // Mark last-added chain as a mud patch (low friction, tinted render).
  mud() {
    this._chain.surface = 'mud';
    return this;
  }

  // Mark last-added chain as ice (near-zero friction: no drive, no brakes).
  ice() {
    this._chain.surface = 'ice';
    return this;
  }

  // Slick frozen-groundwater strip, isolated as its own chain. Set your speed
  // BEFORE the ice — pedals do nothing on it.
  icePatch(w) {
    this.gap(0);
    this.flat(w);
    this.ice();
    return this.gap(0);
  }

  // --- Obstacle set-pieces (see physics/Obstacles.js) ---
  // All are registered at the CURRENT position; terrain is laid (or gapped)
  // explicitly around them so ground never pokes through an obstacle.

  // Wooden launch ramp standing on flat ground ahead of the current position
  // (or `ox` px ahead of it). Does not advance the terrain cursor — follow
  // with flat()/roof() to run ground beneath and past it.
  ramp(w, h, ox = 0) {
    this.obstacles.push({ type: 'ramp', x: this.x + ox, y: this.y, w, h });
    return this;
  }

  // Seesaw plank on a center pivot, standing on flat ground starting here.
  // Follow with flat(length + margin) so the ground continues underneath.
  seesaw(length = 380, postH = 55) {
    this.obstacles.push({
      type: 'seesaw',
      cx: this.x + length / 2,
      groundY: this.y,
      length,
      postH,
    });
    return this;
  }

  // Rope bridge spanning a pit; creates the pit itself so the terrain can't
  // interfere with the hanging planks.
  ropeBridge(width) {
    this.obstacles.push({ type: 'ropebridge', x0: this.x, y0: this.y, width });
    return this.gap(width, 0);
  }

  // Low-friction mud dip, isolated as its own chain.
  mudDip(w, d) {
    this.gap(0);
    this.valley(w, d);
    this.mud();
    return this.gap(0);
  }

  // Sharp-edged pothole cut into the road (terrain-based, jolts slow wheels;
  // fast cars skip right over).
  pothole(w = 70, d = 24) {
    return this.drop(d).flat(w).drop(-d);
  }

  // Row of asphalt speed bumps ahead. Follow with flat() covering the row.
  speedBumps(count, spacing = 130, r = 13) {
    this.obstacles.push({ type: 'bumps', x0: this.x + 60, groundY: this.y, count, spacing, r });
    return this;
  }

  // Tree at offset `ox` ahead: trunk is background art; the canopy sensor
  // hangs over the road with `clearance` px of safe air beneath it. Fly into
  // the leaves and the car gets snagged and drops its speed.
  tree(ox, clearance = 95, r = 70) {
    this.obstacles.push({ type: 'tree', x: this.x + ox, groundY: this.y, clearance, r });
    return this;
  }

  // Oil slick lying on the road ahead. push=+1 boosts along the road (gold
  // arrows), push=-1 shoves against travel and can reverse a slow car (red
  // arrows). Follow with flat() covering the slick.
  oilSlick(w, push = 1) {
    this.obstacles.push({ type: 'oil', x0: this.x, groundY: this.y, w, push });
    return this;
  }

  // Wrecking ball swinging over the road at ox ahead; the swing sweeps
  // roughly ±len·sin(angle0) around that point, bottoming out ~14px above
  // the road, so keep other set-pieces out of the arc. The swing is DRIVEN
  // (Obstacles.js): same rate and same amplitude for the whole run, so the
  // rhythm you read on approach is the rhythm you get. Contact wrecks the
  // car whenever the gap is closing fast — the ball swinging into you or
  // you driving into the ball. `period` (seconds) overrides the natural
  // pendulum time if you want a specific rhythm.
  wreckingBall(ox, height = 330, r = 42, angle0 = 1.0, period) {
    this.obstacles.push({
      type: 'ball', ax: this.x + ox, ay: this.y - height,
      len: height - 14 - r, r, angle0, period,
    });
    return this;
  }

  // Industrial press over flat road at ox ahead: the block cycles between
  // `clearance` px above the road and slammed shut. Getting caught under the
  // descending block wrecks the car; the parked block is a plain wall.
  // Follow with flat() past it.
  press(ox, w = 100, clearance = 175, period = 3.4, phase = 0) {
    this.obstacles.push({
      type: 'press', cx: this.x + ox + w / 2, groundY: this.y,
      w, clearance, period, phase,
    });
    return this;
  }

  // Updraft fan column at ox ahead: housing sits oy below the current ground
  // line (drop it into a pit), blowing h px upward. Place before a gap() to
  // stretch jumps or reach higher ledges.
  fan(ox, w = 140, h = 460, lift = 2.8, oy = 0) {
    this.obstacles.push({ type: 'fan', x: this.x + ox, groundY: this.y, w, h, lift, oy });
    return this;
  }

  // Open waterway: cuts its own gap; skimming the surface fast is survivable,
  // sinking is not. `dy` drops the FAR bank, which matters more than it looks:
  // banks at equal height make this a pure horizontal jump — no fall to buy
  // hang time with — and that is the hardest gap shape in the game.
  water(w, drop = 95, dy = 0) {
    this.obstacles.push({ type: 'water', x0: this.x, y0: this.y, w, drop });
    return this.gap(w, dy);
  }

  // Crane elevator spanning [x, x+w]: platform parks at road level and
  // carries the car up `rise` px when ridden (the shaft's far wall keeps the
  // car aboard). Terrain resumes at the top on the far side.
  craneLift(w = 210, rise = 240) {
    this.obstacles.push({ type: 'lift', x0: this.x, y0: this.y, w, rise });
    this.wallAt(this.x + w + 14, this.y - rise / 2, 28, rise);
    return this.gap(w, -rise);
  }

  // --- Mines set-pieces ---

  // Pit with a boulder chute in the ceiling above its center: a rock drops
  // every `period` seconds (offset by `phase` in cycles) and any falling rock
  // wrecks the car — wait for the fall, then commit.
  // The far edge sits 45 lower so a stop-wait-and-go run-up can still land;
  // follow with slope(160, -45) to climb back.
  rockfallPit(w, { period = 2.8, phase = 0, r = 26, drop = 470 } = {}) {
    this.obstacles.push({
      type: 'rockfall', x: this.x + w / 2, groundY: this.y,
      topY: this.y - drop, r, period, phase,
    });
    return this.gap(w, 45);
  }

  // Rickety plank bridge spanning its own pit; each plank gives way ~0.45s
  // after it's first ridden, so slow crossings drop out from under you.
  crumbleBridge(w) {
    this.obstacles.push({ type: 'crumble', x0: this.x, y0: this.y, width: w });
    return this.gap(w, 0);
  }

  // Molten pool (kind 'lava' or 'acid'), cuts its own pit — but unlike water
  // touching it is near-instant death, no skimming, so the far edge resumes
  // `dy` LOWER (undershooting a level exit would always graze the pool).
  // Enter from FLAT road (the float rule: an up-lip launches fast cars into
  // a long float and dribbles slow ones into the pool); follow with a
  // slope(150.., -35) to climb back out of the basin.
  moltenPit(w, kind = 'lava', dy = 70) {
    this.obstacles.push({ type: 'molten', x0: this.x, y0: this.y, w, drop: dy + 35, kind });
    return this.gap(w, dy);
  }

  // Tunnel narrows: a pit with a rock tooth hanging `clearance` px above the
  // ENTRY road line over its center — jump the slot flat and fast. Approach
  // from FLAT road (an up-lip pops the nose into the tooth) and let the road
  // STAY `dy` lower afterwards: a climb back up would launch the car into
  // whatever comes next (the tunnel descends hole by hole).
  jumpHole(w, clearance = 140, dy = 90) {
    this.obstacles.push({
      type: 'stalactite', x: this.x + w / 2, groundY: this.y, clearance,
    });
    return this.gap(w, dy);
  }

  // Stack of old tires at ox ahead (lay flat ground beneath it). Landing on
  // it bounces the car high — the harder the fall, the bigger the bounce —
  // which is how you reach high ledges. Repeated bounces build height.
  tireStack(ox, w = 140) {
    this.obstacles.push({ type: 'bouncer', x: this.x + ox, groundY: this.y, w });
    return this;
  }

  // --- Castle set-pieces ---

  // Molten moat with a fireball that leaps from its center on a cycle —
  // cross while the fireball is back under the surface. Enters from FLAT
  // road like moltenPit; follow with slope(150, -35) to climb back.
  // Flight is ~1.9s, so the default period leaves a ~1.7s safe pause.
  fireballPit(w, { period = 3.6, phase = 0, r = 22 } = {}) {
    this.obstacles.push({ type: 'molten', x0: this.x, y0: this.y, w, drop: 105, kind: 'lava' });
    this.obstacles.push({
      type: 'fireball', x: this.x + w / 2, groundY: this.y,
      surfaceY: this.y + 105, period, phase, r,
    });
    return this.gap(w, 70);
  }

  // Spike strip on the road at ox ahead: any contact shreds the tires —
  // jump it off a crest or ramp. Follow with flat() covering it.
  spikeStrip(ox, w = 120) {
    this.obstacles.push({ type: 'spikes', x0: this.x + ox, groundY: this.y, w });
    return this;
  }

  // Standing timber beam at ox ahead: ram it at speed to slam it down (slow
  // hits just shove it). A felled beam is drivable and bridges a ~140 gap
  // when it stands just before the edge. Follow with flat() beneath it.
  beam(ox, h = 300) {
    this.obstacles.push({ type: 'beam', x: this.x + ox, groundY: this.y, h });
    return this;
  }

  // Archer volley over [ox, ox+w]: arrows rain for rainFrac of every period
  // — pass in the lull. Follow with flat() covering it.
  arrowVolley(ox, w = 150, period = 2.6, phase = 0, rainFrac = 0.36) {
    this.obstacles.push({
      type: 'arrows', x: this.x + ox + w / 2, w, groundY: this.y,
      period, phase, rainFrac,
    });
    return this;
  }

  // Spiked flail: a wrecking ball on a short, driven chain — tighter arc,
  // much faster swing. Same lethal-contact mechanics as wreckingBall().
  spikyBall(ox, height = 270, r = 36, angle0 = 1.1, period) {
    this.obstacles.push({
      type: 'ball', spiky: true, ax: this.x + ox, ay: this.y - height,
      len: height - 14 - r, r, angle0, period,
    });
    return this;
  }

  // --- Factory set-pieces ---

  // Pneumatic compactor: a press at industrial-machine scale — same
  // wait-for-the-rise timing, bigger and slower. Follow with flat() past it.
  compactor(ox, w = 190, clearance = 260, period = 4.2, phase = 0) {
    this.obstacles.push({
      type: 'compactor', cx: this.x + ox + w / 2, groundY: this.y,
      w, clearance, period, phase,
    });
    return this;
  }

  // Conveyor belt on flat ground ahead: speed > 0 carries you along, speed <
  // 0 fights your travel. Follow with flat() covering it.
  conveyor(w, speed = 4) {
    this.obstacles.push({ type: 'conveyor', x0: this.x, groundY: this.y, w, speed });
    return this;
  }

  // Gap with scrap metal raining from a chute above: several irregular
  // chunks (random shape/color) drop on their own offset cycle. Wait for a
  // clean break in the fall, then commit across.
  fallingScrap(w, { count = 3, period = 2.6, phase = 0, drop = 520 } = {}) {
    this.obstacles.push({
      type: 'scrap', x0: this.x, w, groundY: this.y,
      topY: this.y - drop, count, period, phase,
    });
    return this.gap(w, 40);
  }

  // Begin a large drivable pipe: ordinary flat()/slope() calls lay the floor
  // as usual — pipeStart just starts recording the path so pipeEnd can wrap
  // it in a tube shell + ceiling. The interior only renders while the car is
  // inside; from outside it reads as a plain steel pipe.
  pipeStart(radius = 100) {
    this._pipePts = [{ x: this.x, y: this.y }];
    this._pipeRadius = radius;
    return this;
  }

  // Close the pipe: registers the ceiling over the path laid since
  // pipeStart. The tube's mouths are open — a gap() right after lets the car
  // launch out of one pipe and land in the next.
  pipeEnd() {
    if (this._pipePts && this._pipePts.length > 1) {
      this.obstacles.push({ type: 'pipe', pts: this._pipePts, radius: this._pipeRadius });
    }
    this._pipePts = null;
    return this;
  }

  // Sludge vat: a dip with a real drivable floor (unlike water/moltenPit,
  // there's no gap — you drive INTO and OUT of this one), filled with
  // corrosive goo. The render clips the liquid to the actual terrain
  // outline (Obstacles.js), so it automatically molds to the valley shape
  // and never paints over ground that should stay visible. Submerged
  // wheels build a lethality bar (Car.js/HUD) instead of dying on contact —
  // a fast splash survives, dawdling does not.
  sludgeVat(w, depth = 130) {
    this.gap(0);
    const x0 = this.x, y0 = this.y;
    this.valley(w, depth);
    this._chain.surface = 'sludge';
    this.obstacles.push({ type: 'sludge', x0, y0, w, depth });
    return this.gap(0);
  }

  // Coiled ground spring at ox ahead: any contact launches the car hard and
  // vertically, on a cooldown. Follow with flat() past it.
  spring(ox, w = 110, launchVel = 19) {
    this.obstacles.push({ type: 'spring', x: this.x + ox, groundY: this.y, w, launchVel });
    return this;
  }

  // Continuously spinning blade on a tall post at ox ahead, hub `height`
  // above the road: a full-diameter bar sweeps in a circle, its lower tip
  // reaching all the way to road height once per rotation. `len` defaults to
  // 2*height (plus a little overlap) so the tip always reaches the floor —
  // override it explicitly only for an unusual hub height.
  spinBlade(ox, { height = 260, thickness = 30, omega = 3.0, phase = 0, len } = {}) {
    this.obstacles.push({
      type: 'blade', ax: this.x + ox, ay: this.y - height, groundY: this.y,
      len: len ?? (height * 2 + 12), thickness, omega, phase,
    });
    return this;
  }

  // Elevator that LOWERS the car: parks at road level, and while ridden
  // sinks `drop` px before springing back up once clear. Terrain resumes
  // `drop` px lower on the far side. The side guard only spans the UPPER
  // part of the shaft (stops short of the exit line) so the car isn't
  // walled in once it reaches the bottom.
  elevatorDown(w = 220, drop = 260) {
    this.obstacles.push({ type: 'elevator', x0: this.x, y0: this.y, w, drop });
    const guardH = Math.max(0, drop - 110);
    // style 'steel' renders as riveted plate (GameScreen._drawWalls) — the
    // default wood-plank wall look would clash with the industrial shaft.
    if (guardH > 0) {
      this.walls.push({ cx: this.x + w + 10, cy: this.y + guardH / 2, w: 14, h: guardH, style: 'steel', friction: 0.1 });
    }
    return this.gap(w, drop);
  }

  finish(meta) {
    if (this._chain.length > 1) this.chains.push(this._chain);
    // The kill line is derived from the terrain unless the level names one.
    // Assuming a fixed depth below the START height is a trap in long levels:
    // sections that descend stack up until the ROAD sits below the kill line
    // and the car "falls" while driving along perfectly solid ground.
    let deepest = GROUND_Y;
    for (const chain of this.chains) {
      for (const p of chain) if (p.y > deepest) deepest = p.y;
    }
    return {
      chains: this.chains,
      walls: this.walls,
      obstacles: this.obstacles,
      buildings: this.buildings,
      finishX: this.x - (meta.finishBack || 120),
      deathY: meta.deathY || deepest + 550,
      startX: meta.startX || 150,
      startY: meta.startY || GROUND_Y - 80,
      ...meta,
    };
  }
}

// --- Section library ---------------------------------------------------------
//
// Levels are assembled from these sections rather than written point by point.
// Every section lays its OWN approach and recovery ground, sized to the spacing
// rules in CLAUDE.md (braking room ahead of every timing hazard, float-settling
// room after every landing), and every section starts and ends on flat ground
// at the terrain cursor. So a level built from sections cannot violate a
// spacing rule by accident, and fixing a section fixes every level using it.
//
// The dial that carries the difficulty curve is a jump's gap width. It grows
// faster than any other knob, world by world and level by level, which is what
// makes an un-upgraded engine run out of road: a stock car exits a launch lip
// around 3 px/step and a maxed one at better than triple that, and the gap you
// clear scales with the square of nothing — it scales straight off exit speed.

// ---- jumps ------------------------------------------------------------------

// Terrain launch lip -> pit -> downhill landing -> settling flat. The lip is
// long and cosine-eased so the car crests it flat instead of popping its nose,
// and the far side falls away so the arc rides out instead of stopping dead.
function jumpGap(b, w, o = {}) {
  const { lead = 420, lip = 210, rise = 70, fall = 60, settle = 400 } = o;
  // The `lead` flat is load-bearing, not padding: rolling ground costs a lot
  // of speed, and a lip taken straight off a wave crest exits several px/step
  // slower than the same lip taken off flat road — the difference between
  // clearing a gap and landing in it.
  const land = o.land ?? 220 + w * 0.55;
  const run = o.run ?? 60 + w * 0.18;
  return regain(b.flat(lead).slope(lip, -rise).gap(w, fall).slope(land, run),
                fall + run - rise, settle);
}

// A clean cliff edge: no lip, no ramp. You drive straight off flat road and
// the distance you cover is exactly speed x hang time. This is the honest
// difficulty dial — it scales monotonically with the car, where a launch lip
// can actually make a VERY fast car fall short (it floats off the crest and
// drops into the pit it was supposed to clear).
function jumpEdge(b, w, o = {}) {
  const { lead = 560, fall = 70, settle = 400 } = o;
  // The landing ramp is sized to the JUMP, not fixed: a big jump comes down
  // fast and steep, and a short flat-ish runout turns a cleared gap into a
  // nose-first flip. Long and falling away, the arc just rides out.
  const land = o.land ?? 220 + w * 0.55;
  const run = o.run ?? 60 + w * 0.18;
  return regain(b.flat(lead).gap(w, fall).slope(land, run), fall + run, settle);
}

// Every pit lands you lower than you took off — the drop into the gap plus the
// downhill runout. Left alone that stacks: fifteen jumps into a level the road
// is 2,000px below where it started. So each jump section climbs back out.
function regain(b, drop, settle) {
  return b.flat(settle * 0.35)
    .slope(Math.max(200, drop * 2.4), -drop, 6)   // ~33 degrees, always climbable
    .flat(settle * 0.65);
}

// Wooden-ramp launch over a pit. A ramp throws much further than a terrain lip
// but exits nose-high, so you have to fly it back down onto the landing.
function jumpRamp(b, w, o = {}) {
  const { rw = 175, rh = 78, lead = 320, over = 30, fall = 80, settle = 440 } = o;
  const land = o.land ?? 240 + w * 0.55;
  const run = o.run ?? 70 + w * 0.18;
  return regain(b.flat(lead).ramp(rw, rh).flat(rw + over)
    .gap(w, fall).slope(land, run), fall + run, settle);
}

// Cliff into a pocket momentum cannot carry you through: reverse to the back
// wall, then floor it up the steep exit ramp.
function pocket(b, o = {}) {
  const { fall = 130, floor = 360, exit = 190, climb = 150, after = 280 } = o;
  return b.drop(fall).flat(floor).slope(exit, -climb, 8).flat(after);
}

// Hole-in-wall: a wooden ramp launches you through an opening in a wall. The
// wall above the opening runs far up out of frame, so it reads as a wall with
// a hole punched through it rather than a slab hanging in the air.
function holeWall(b, o = {}) {
  const { rampW = 180, rampH = 80, wallDx = 400, sillW = 190, sillH = 60, hole = 260, runout = 800 } = o;
  const rx = b.x, gy = b.y;
  b.ramp(rampW, rampH);
  b.flat(wallDx + runout);                      // ground under ramp, wall and landing
  // The lower half is a WIDE block, and that is the whole trick: walls are
  // terrain, so its top is a drivable ledge. A jump that comes in low lands on
  // the ledge and drives off the far side, instead of balancing on a thin edge
  // with no wheel touching anything. A frozen run at a wall you cannot go
  // around is the worst failure this game can produce, and this shape makes it
  // impossible. The upper half runs up out of frame — thin and slick, so
  // flying too HIGH deflects you down rather than stopping you dead. That
  // ceiling is the real test.
  b.wallAt(rx + wallDx, gy - sillH / 2, sillW, sillH);
  b.wallAt(rx + wallDx, gy - sillH - hole - 380, 16, 760, 0.1);
  return b;
}

// ---- open ground, in each world's own idiom ---------------------------------

// Farm: rolling country that never settles, and can genuinely gain or lose
// height across a stretch.
const farmRoad = (b, n = 2, w = 470, h = 85, drift = 0) => b.waves(n, w, h, drift);

// Town: shallower suburb swells between flat blocks of street.
const townRoad = (b, n = 2, w = 430, h = 62, drift = 0) => b.waves(n, w, h, drift);

// City: terraced. Flat shelves joined by short straight ramps — graded lots
// and stepped streets, never rolling country.
const cityRoad = (b, steps) => b.terrace(steps);

// Mines: rolling like the Farm but tighter, and generally working downward.
const minesRoad = (b, n = 2, w = 420, h = 76, drift = 0) => b.waves(n, w, h, drift);

// Castle: wards and ramparts — flat courtyards joined by defined ramps.
const castleRoad = (b, steps) => b.terrace(steps);

// Factory: machine-cut. Long flat bays and sharp straight steps between them.
const factoryRoad = (b, n = 2, run = 420, rise = 70, bias = 0) => b.steps(n, run, rise, bias);

// ---- Farm sections ----------------------------------------------------------

// Sticky low-friction dip. Mud runs at friction 0.1, which is under the
// tangent of any slope worth building — you cannot CLIMB out of a mud dip,
// only coast out. So the dip stays wide and shallow (depth capped at w/6, a
// climb momentum can actually carry) and the approach is a long flat that
// lets you arrive with that momentum in hand.
function mudHole(b, w = 320, d = 55, o = {}) {
  const { lead = 340, after = 380 } = o;
  return b.flat(lead).mudDip(w, Math.min(d, w / 6)).flat(after);
}

// Balance plank on a centre pivot.
function seesawSpan(b, o = {}) {
  const { length = 380, postH = 55, lead = 260, after = 520 } = o;
  return b.flat(lead).seesaw(length, postH).flat(length + after);
}

// Swaying plank bridge over a drop.
function ropeSpan(b, w = 300, o = {}) {
  // Kept short on purpose: a long span sags enough that a slow car settles
  // into the middle and can never climb out. Never enter one straight out of
  // mud — arrive with speed or don't arrive.
  const { lead = 320, after = 440 } = o;
  return b.flat(lead).ropeBridge(Math.min(w, 320)).flat(after);
}

// A paddock fence with a kicker ramp in front of it. The ramp is the point: a
// bare crest is an unreliable launcher — you are back on the ground before you
// reach the rail — whereas a ramp lip 70px short of it always is. The rail
// itself is thin and slick, because a wide grippy fence top is a beaching
// hazard: a car that comes down square on it balances there with no wheel
// touching anything, and that freezes the run outright.
function fenceHop(b, o = {}) {
  const { rw = 130, rh = 46, h = 52, after = 520 } = o;
  b.ramp(rw, rh);
  b.wallHere(rw + 70, 14, h, 0.15);
  return b.flat(rw + 70 + after);
}

// Low branches over the road. Fly into the leaves and you get snagged, so
// jump LOW through here. Canopies always sit over solid ground.
function treeLine(b, count = 2, o = {}) {
  const { clearance = 105, r = 70, spacing = 440, lead = 200 } = o;
  for (let i = 0; i < count; i++) {
    b.tree(lead, clearance + (i % 2) * 10, r);
    b.flat(spacing);
  }
  return b;
}

// ---- Town sections ----------------------------------------------------------

function bumpRow(b, count = 4, spacing = 125, o = {}) {
  const { lead = 200, after = 300 } = o;
  return b.flat(lead).speedBumps(count, spacing).flat(count * spacing + after);
}

function potholeRun(b, count = 3, o = {}) {
  const { spread = 130, lead = 180, after = 340 } = o;
  b.flat(lead);
  for (let i = 0; i < count; i++) {
    b.pothole(70 + (i % 2) * 16, 24 + (i % 2) * 3);
    if (i < count - 1) b.flat(spread);
  }
  return b.flat(after);
}

// Service ramp up to the roofline, n rooftops with pits between them, then the
// fire-escape drop back to the street. A launch ramp sits near each edge that
// needs one; the last roof never gets one (nothing to jump to).
function rooftops(b, n, o = {}) {
  const { climb = 300, height = 175, roof = 470, gap = 200, step = 50, rampH = 0, after = 340 } = o;
  // Roofs STEP DOWN across the block. A skyline of descending rooftops is what
  // a city actually looks like, and a landing that falls away is enormously
  // more forgiving than a flat one — a roof gap has no downhill runout to ride
  // the arc out on. No kicker ramps by default either: a ramp at the edge pops
  // the nose, and a car that leaves the roof climbing spends its carry going
  // up instead of across, then drops into the very gap it was aimed over. The
  // roofs are flat, the run is clean, and momentum is the whole answer.
  b.slope(climb, -height, 8);
  for (let i = 0; i < n; i++) {
    if (i < n - 1 && rampH) b.ramp(130, rampH, roof - 200);   // kicker near each edge
    b.roof(roof);
    if (i < n - 1) b.gap(gap, step);
  }
  // Fire-escape drop back to the street: whatever height the roofline has
  // left, so the section always returns to the level it started on.
  return b.drop(Math.max(80, height - (n - 1) * step)).flat(after);
}

// Low structure across the road: no jumping this stretch, stay grounded.
// The Farm gets a drive-through machine shed; paved worlds get the concrete
// overpass, because a barn on a downtown block reads as a mistake.
function underpass(b, o = {}) {
  const { lead = 260, w = 340, clearance = 145, after = 520, style = 'shed' } = o;
  return b.flat(lead).lowBeam(w / 2 + 40, w, clearance, 26, style).flat(w + after);
}

// The same structure sunk in a hollow. The dip is the point: you drop in, the
// suspension unloads on the way out, and the far lip tries to pop you up into
// the header exactly when you can least afford it. Terrain doing the work of
// a second obstacle.
function dipUnderpass(b, o = {}) {
  const { lead = 320, w = 340, depth = 70, clearance = 150, after = 480, style = 'shed' } = o;
  b.flat(lead).slope(200, depth, 6).flat(60);
  b.lowBeam(w / 2 + 30, w, clearance, 26, style);
  return b.flat(w + 80).slope(220, -depth, 6).flat(after);
}

// ---- City sections ----------------------------------------------------------

// Oil on the tarmac. push = +1 boosts along the road, -1 shoves back and can
// reverse a slow car — a red slick always gets a run-up in front of it.
function slick(b, w = 230, push = 1, o = {}) {
  const { lead = push < 0 ? 380 : 200, after = 360 } = o;
  return b.flat(lead).oilSlick(w, push).flat(w + after);
}

// Wrecking ball with room to read a full swing in front of it and a runout the
// arc cannot reach. The swing is driven, so the rhythm never decays.
function ballYard(b, o = {}) {
  const { height = 330, r = 42, angle0 = 1.0, period, lead = 620, after = 720 } = o;
  b.flat(lead);
  b.wreckingBall(260, height, r, angle0, period);
  return b.flat(260 + after);
}

function pressBay(b, o = {}) {
  const { w = 100, clearance = 175, period = 3.4, phase = 0, lead = 540, after = 620 } = o;
  b.flat(lead);
  b.press(200, w, clearance, period, phase);
  return b.flat(200 + w + after);
}

// Updraft-assisted gap: the fan stands in the mouth of the pit and carries the
// jump. Never stack a ramp AND a fan on one gap — the car lands vertically.
function fanGap(b, w, o = {}) {
  const { lip = 160, rise = 50, lift = 3.0, fanW = 150, fanH = 500, fall = 45, settle = 420 } = o;
  b.slope(lip, -rise);
  b.fan(90, fanW, fanH, lift, 60);
  return b.gap(w, fall).flat(settle);
}

// Open water. Skim it fast or clear it outright; sinking ends the run.
function canal(b, w = 280, o = {}) {
  const { lead = 440, lip = 130, rise = 32, fall = 60, land = 200, run = 40, settle = 420 } = o;
  // The lead flat is not padding. A canal taken while still floating off the
  // previous landing (a fan column especially) is entered high and slow, and
  // a waterway punishes that with the one failure the player cannot drive out
  // of. Arrive settled and fast, or don't arrive.
  return regain(b.flat(lead).slope(lip, -rise).water(w, 95, fall).slope(land, run),
                fall + run - rise, settle);
}

// Crane platform up to the high steel, with the launch ramp the slow exit
// needs to make the first gap up there.
function craneUp(b, o = {}) {
  const { w = 300, rise = 240, roof = 560, lead = 380 } = o;
  // Wide deck and a settling flat in front, both load-bearing: a car that
  // arrives hot skips a short platform entirely, hits the shaft's far wall
  // and drops down the shaft.
  b.flat(lead);
  b.craneLift(w, rise);
  // No kicker on the exit shelf: a ramp there pops the nose exactly where the
  // car is still finding its feet coming off the platform, and the roof gap
  // that follows is unforgiving about a nose-high launch.
  return b.roof(roof);
}

// ---- Mines sections ---------------------------------------------------------

// Ceiling chute over a pit. Long braking flat in front: the bot (and a human
// at speed) brakes from ~170 + vx*30 px out, and parking under the chute is
// lethal. Climbs back out of the drop afterwards.
function rockChute(b, w = 190, o = {}) {
  const { period = 2.8, phase = 0, lead = 640, after = 400 } = o;
  return b.flat(lead).rockfallPit(w, { period, phase }).slope(160, -45).flat(after);
}

// Rotten planks that give way a beat after you touch them. Kept well clear of
// any braking zone: parking on one, or reversing back onto one, drops you.
function plankSpan(b, w = 300, o = {}) {
  const { lead = 340, after = 460 } = o;
  return b.flat(lead).crumbleBridge(w).flat(after);
}

// Molten pool. Entered from FLAT road (an up-lip launches fast cars into a
// long float and dribbles slow ones straight in), climbing out of the basin
// afterwards. Touching it is death — there is no skim.
function pool(b, w = 260, kind = 'lava', o = {}) {
  const { lead = 560, after = 460, dy = 70 } = o;
  return b.flat(lead).moltenPit(w, kind, dy)
    .flat(220).slope(220, -dy / 2).flat(after);
}

// Frozen groundwater: no drive, no brakes. Set your speed BEFORE it.
function iceRun(b, w = 300, o = {}) {
  const { lead = 280, after = 340 } = o;
  return b.flat(lead).icePatch(w).flat(after);
}

// Tunnel pinch: thread the slot under the rock tooth, flat and fast. Needs a
// long clean flat approach — the float artifact parks a car at exactly tooth
// height for ~500px after any hard landing.
function needle(b, w = 210, clearance = 138, o = {}) {
  const { lead = 580, after = 500 } = o;
  return b.flat(lead).jumpHole(w, clearance).flat(after);
}

// Tire-stack basin: fall in, trampoline out over the headwall. The stack sits
// far enough in that a fast entry lands ON it, and the headwall far enough
// past that the first big bounce clears it.
function tireBasin(b, o = {}) {
  const { fall = 160, into = 260, floor = 440, wall = 300, after = 420 } = o;
  return b.drop(fall).tireStack(into).flat(floor).drop(-wall).flat(after);
}

// ---- Castle sections --------------------------------------------------------

// Fire moat: needs ~700px of flat approach, because braking has to finish
// short of the lip — parking on the lip catapults you into the lava.
function fireMoat(b, w = 200, o = {}) {
  const { period = 3.6, phase = 0, lead = 700, after = 480 } = o;
  return b.flat(lead).fireballPit(w, { period, phase }).slope(150, -35).flat(after);
}

// Ramp + caltrops. The ramp is not optional: a crest launch LANDS on the strip,
// only a ramp lip ~20px short of it clears. ~1050px before the next ramp
// section, because a floaty launch carries ~850 past the lip and must never
// come down on the NEXT strip.
function spikeRamp(b, o = {}) {
  const { lead = 560, rw = 150, rh = 52, strip = 90, after = 1200 } = o;
  // The strip sits CLOSE to the ramp lip — about 25px past it — and that
  // placement is the whole trick. A car coming off a ramp leaves nose-up and
  // sheds forward speed fast, so it clears a hundred-odd pixels reliably and
  // four hundred not at all; a strip set further out is a coin flip that the
  // slowest, most laboured approach always loses. Close in, the launch itself
  // is the answer, which is the lesson: a crest launch LANDS on caltrops, a
  // ramp launch flies them.
  b.flat(lead);
  b.ramp(rw, rh);
  b.spikeStrip(rw + 25, strip);
  return b.flat(rw + 25 + strip + after);
}

// A barred gate: a ram wedge with the timber right behind it. The wedge lifts
// your nose so you strike high and the beam goes OVER instead of stopping you
// dead — a beam standing on its own with no approach reads as scenery, and
// this is what makes it a decision (hit it hard, or don't hit it at all).
function barricade(b, o = {}) {
  const { lead = 480, rw = 150, rh = 46, h = 300, after = 760 } = o;
  b.flat(lead);
  b.ramp(rw, rh);
  b.beam(rw + 55, h);
  return b.flat(rw + 55 + after);
}

// Archer wall: a machicolated gallery that looses a real volley on a cycle.
// Long clear road on both sides — backing off a volley must not reverse you
// into the last hazard, and committing must not run you into the next.
function archerWall(b, o = {}) {
  const { w = 150, period = 2.6, phase = 0, rainFrac = 0.36, lead = 460, after = 720 } = o;
  b.flat(lead);
  b.arrowVolley(280, w, period, phase, rainFrac);
  return b.flat(280 + w + after);
}

// Spiked flail on a short driven chain — tight arc, fast rhythm.
function flailPost(b, o = {}) {
  const { height = 270, r = 36, angle0 = 1.1, period, lead = 560, after = 660 } = o;
  b.flat(lead);
  b.spikyBall(280, height, r, angle0, period);
  return b.flat(280 + after);
}

// ---- Factory sections -------------------------------------------------------

function compactorBay(b, o = {}) {
  const { w = 190, clearance = 250, period = 4.2, phase = 0, lead = 660, after = 760 } = o;
  b.flat(lead);
  b.compactor(240, w, clearance, period, phase);
  return b.flat(240 + w + after);
}

function beltRun(b, w = 280, speed = 6, o = {}) {
  const { lead = 280, after = 440 } = o;
  return b.flat(lead).conveyor(w, speed).flat(w + after);
}

function scrapChute(b, w = 280, o = {}) {
  const { count = 3, period = 2.6, phase = 0, lead = 820, after = 540 } = o;
  return b.flat(lead).fallingScrap(w, { count, period, phase }).slope(150, -40).flat(after);
}

// Steel pipe carrying the road under the floor. Both mouths are open, so a
// gap() straight after lets you launch out of one and land in the next.
function pipeRun(b, o = {}) {
  const { radius = 105, run1 = 480, dip = -130, run2 = 400 } = o;
  return b.pipeStart(radius).flat(run1).slope(300, dip, 8).flat(run2).pipeEnd();
}

// Corrosive vat with a real drivable floor: a fast splash survives, dawdling
// dissolves you.
function sludgePit(b, w = 620, depth = 150, o = {}) {
  const { lead = 520, after = 640 } = o;
  return b.flat(lead).sludgeVat(w, depth).flat(after);
}

// Coiled ground spring. Optionally followed by the pit its launch is sized for.
function springLaunch(b, gapW = 0, o = {}) {
  const { lead = 440, launch = 20, run = 320, fall = 60, land = 250, after = 520 } = o;
  b.flat(lead);
  b.spring(240, 120, launch);
  b.flat(run);
  if (gapW) b.gap(gapW, fall).slope(land, 90);
  return b.flat(after);
}

function bladePost(b, o = {}) {
  const { height = 285, omega = 1.5, phase = 0, lead = 980, after = 720 } = o;
  b.flat(lead);
  b.spinBlade(280, { height, omega, phase });
  return b.flat(280 + after);
}

function shaftDown(b, o = {}) {
  const { w = 220, drop = 320, after = 660 } = o;
  return b.elevatorDown(w, drop).flat(after);
}

// ---- paired hazards ---------------------------------------------------------
//
// Two of a kind, close enough to read as one problem and deliberately set
// AGAINST each other — different periods, different reach — so the rhythm you
// just solved tells you nothing about the next one. A row of identical presses
// is one puzzle repeated; two presses beating at 3.4s and 4.6s is a new puzzle
// every cycle. Spacing still respects the braking rules: each half gets the
// room the bot (and a human at speed) needs to stop short of it.

function pressPair(b, o = {}) {
  const { lead = 540, gapBetween = 540, after = 620 } = o;
  const { w = 100, clearance = 175 } = o;
  const p1 = o.period ?? 3.4, p2 = o.period2 ?? 4.6;
  b.flat(lead);
  b.press(200, w, clearance, p1, o.phase ?? 0);
  b.flat(200 + w + gapBetween);
  b.press(0, w, clearance, p2, o.phase2 ?? 0.5);
  return b.flat(w + after);
}

function compactorPair(b, o = {}) {
  const { lead = 660, gapBetween = 700, after = 700 } = o;
  const { w = 190, clearance = 250 } = o;
  const p1 = o.period ?? 4.2, p2 = o.period2 ?? 5.4;
  b.flat(lead);
  b.compactor(240, w, clearance, p1, o.phase ?? 0);
  b.flat(240 + w + gapBetween);
  b.compactor(0, w, clearance, p2, o.phase2 ?? 0.45);
  return b.flat(w + after);
}

// Two balls on different chains. The short one swings noticeably faster, so
// the pair never lines up the same way twice.
function ballPair(b, o = {}) {
  const { lead = 620, gapBetween = 820, after = 700 } = o;
  b.flat(lead);
  b.wreckingBall(260, o.height ?? 340, o.r ?? 44, o.angle0 ?? 1.0, o.period);
  b.flat(260 + gapBetween);
  b.wreckingBall(0, o.height2 ?? 270, o.r2 ?? 36, o.angle02 ?? -1.05, o.period2);
  return b.flat(after);
}

function bladePair(b, o = {}) {
  const { lead = 940, gapBetween = 1000, after = 700 } = o;
  b.flat(lead);
  b.spinBlade(280, { height: o.height ?? 285, omega: o.omega ?? 1.5, phase: o.phase ?? 0 });
  b.flat(280 + gapBetween);
  b.spinBlade(0, { height: o.height2 ?? 250, omega: o.omega2 ?? 1.9, phase: o.phase2 ?? 1.6 });
  return b.flat(after);
}

// A kicker aimed straight at a low branch. Take the ramp flat-out and the
// canopy swallows you; roll it and you pass underneath. The ramp is what makes
// the tree a decision instead of scenery you happen to drive past.
function rampTree(b, o = {}) {
  const { lead = 420, rw = 145, rh = 55, at = 340, clearance = 150, after = 560 } = o;
  b.flat(lead);
  b.ramp(rw, rh);
  b.tree(rw + at, clearance, 72);
  return b.flat(rw + at + after);
}

// A belt feeding the ram. The conveyor is pushing you in while you are trying
// to stop short of it, which is exactly as unpleasant as it sounds.
function beltCompactor(b, o = {}) {
  const { lead = 380, beltW = 240, speed = 4, gapBetween = 620, after = 700 } = o;
  b.flat(lead).conveyor(beltW, speed).flat(beltW + gapBetween);
  b.compactor(0, o.w ?? 190, o.clearance ?? 250, o.period ?? 4.2, o.phase ?? 0.2);
  return b.flat((o.w ?? 190) + after);
}

// Gold slick straight into a press: the boost is free speed you did not ask
// for, delivered at the exact moment you wanted to be slowing down.
function slickPress(b, o = {}) {
  const { lead = 300, slickW = 220, gapBetween = 560, after = 620 } = o;
  b.flat(lead).oilSlick(slickW, 1).flat(slickW + gapBetween);
  b.press(0, o.w ?? 100, o.clearance ?? 180, o.period ?? 3.6, o.phase ?? 0.3);
  return b.flat((o.w ?? 100) + after);
}

// ---- terrain doing an obstacle's job ---------------------------------------

// A hollow whose far bank is the launch. Caltrops sit just past the crest, so
// the climb out IS the jump — no wooden ramp anywhere, the ground is the ramp.
// Same close placement rule as spikeRamp: a launch sheds forward speed fast,
// so the strip goes right behind the lip or not at all.
function spikeLeap(b, o = {}) {
  const { lead = 480, depth = 85, rw = 150, rh = 52, strip = 70, after = 900 } = o;
  // A hollow, then the ramp on the way out, then caltrops past the lip. The
  // terrain is the real hazard here: you arrive at the ramp carrying whatever
  // the dip left you, and a dip eats exactly the speed the launch needs.
  //
  // The ramp is not optional and cannot be replaced by a steeper exit bank.
  // Ground steep enough to throw a car is past the friction limit, so it stops
  // the car instead — and a car that crawls over the crest lands square on the
  // strip it was supposed to fly.
  b.flat(lead)
    .slope(250, depth, 6)
    .flat(110)
    .slope(250, -depth, 6)
    .flat(180);
  b.ramp(rw, rh);
  b.spikeStrip(rw + 25, strip);
  return b.flat(rw + 25 + strip + after);
}

// Ice ON the descent, running right to the lip. There are no brakes on ice and
// no throttle either, so the run-in decides everything and the only choice left
// is how fast you enter. Author ice downhill like this — never uphill, where a
// car simply stops and cannot restart.
function iceLeap(b, o = {}) {
  const { lead = 420, drop = 125, w = 165, after = 460 } = o;
  b.flat(lead);
  b.gap(0);
  b.slope(300, drop, 8);
  b.ice();
  b.gap(0);
  b.flat(130);
  return regain(b.gap(Math.min(w, 165), 60).slope(220 + w * 0.5, 60 + w * 0.18), 120 + drop, after);
}

// Speed bumps laid over a crest, where the car is lightest and the bumps hit
// hardest. A bump row on the flat is a nuisance; over a rise it is a launcher.
function bumpCrest(b, o = {}) {
  const { lead = 260, count = 3, spacing = 120, h = 70, after = 420 } = o;
  b.flat(lead).slope(260, -h, 6);
  b.speedBumps(count, spacing);
  return b.flat(count * spacing + 160).slope(280, h, 6).flat(after);
}

// --- Farm (World 1) ----------------------------------------------------------
// The teaching world, and now a long one: rolling country you have to read,
// with the hazard vocabulary introduced one piece at a time. Levels 1-6 are
// stock-passable; 7-9 want the 1000-coin engine; 10 wants a second upgrade.

function level1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(430);
  farmRoad(b, 3, 470, 60);
  b.flat(260).basin(460, 78).flat(300);
  farmRoad(b, 3, 470, 76);
  b.mesa(320, 420, 320, 120);
  farmRoad(b, 3, 470, 70);
  b.flat(300).basin(480, 82).flat(560);
  return b.finish({
    name: '1. First Gear',
    concept: 'Rolling country. Get a feel for gas, brake, and reading the ground ahead.',
    targetTime: 52,
    basePayout: 200,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(430);
  farmRoad(b, 2, 470, 66);
  jumpGap(b, 170, { lead: 380, lip: 170, rise: 45, fall: 55 });   // first jump: small and forgiving
  farmRoad(b, 3, 470, 78);
  b.basin(460, 80).flat(240);
  jumpGap(b, 200, { lead: 400, lip: 190, rise: 55, fall: 60 });
  farmRoad(b, 2, 470, 84);
  b.mesa(340, 380, 320, 120);
  jumpEdge(b, 230);                                    // straight off the shelf
  farmRoad(b, 3, 470, 74);
  b.flat(560);
  return b.finish({
    name: '2. Mind the Gap',
    concept: 'Three jumps, each a little wider. Carry speed off every edge.',
    targetTime: 62,
    basePayout: 230,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  farmRoad(b, 2, 470, 70);
  jumpGap(b, 210, { lip: 250, rise: 72 });
  farmRoad(b, 2, 470, 80);
  jumpRamp(b, 270, { rw: 170, rh: 75, lead: 400 });    // first wooden ramp
  b.basin(480, 84).flat(220);
  farmRoad(b, 2, 470, 86);
  jumpRamp(b, 290, { rw: 175, rh: 78, lead: 420 });
  farmRoad(b, 3, 470, 76);
  b.mesa(360, 400, 340, 125);
  jumpGap(b, 240, { lip: 240, rise: 70 });
  farmRoad(b, 2, 470, 70);
  b.flat(540);
  return b.finish({
    name: '3. Get Some Air',
    concept: 'Hold GAS in the air to raise the nose, BRAKE to dip it. Land wheels-first.',
    targetTime: 74,
    basePayout: 260,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  farmRoad(b, 3, 460, 88);
  mudHole(b, 300, 62);
  farmRoad(b, 2, 450, 92);
  b.mesa(360, 360, 340, 125);
  mudHole(b, 330, 66);
  farmRoad(b, 3, 460, 90, 20);      // the road works uphill through here
  b.basin(500, 88).flat(260);
  jumpEdge(b, 240);
  farmRoad(b, 2, 460, 94);
  mudHole(b, 320, 64);
  b.mesa(380, 420, 360, 130);
  farmRoad(b, 3, 470, 86, -20);     // ...and back down
  b.flat(560);
  return b.finish({
    name: '4. Steep Country',
    concept: 'Steep ground tests your suspension — and mud saps every bit of grip.',
    targetTime: 86,
    basePayout: 195,
    recommended: 'pickup',
    friction: 0.8,
  });
}

function level5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  farmRoad(b, 2, 470, 74);
  dipUnderpass(b, { w: 320, clearance: 148 });
  farmRoad(b, 2, 460, 84);
  // Narrow bridge over a pit under a low beam: no jumping through here.
  b.gap(30, 20);
  b.lowBeam(160, 320, 140).flat(320);
  b.gap(30, -20).flat(260);
  mudHole(b, 300, 58);
  farmRoad(b, 3, 460, 88);
  jumpEdge(b, 235);
  b.basin(480, 82).flat(240);
  underpass(b, { w: 300, clearance: 138, after: 460 });
  rampTree(b, { clearance: 152 });
  farmRoad(b, 2, 470, 80);
  seesawSpan(b);
  farmRoad(b, 2, 470, 76);
  b.flat(540);
  return b.finish({
    name: '5. The Squeeze',
    concept: 'Low beams and a narrow bridge — precision beats bravado.',
    targetTime: 92,
    basePayout: 215,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  farmRoad(b, 2, 470, 80);
  pocket(b);                                    // reverse-and-run-up ramp
  farmRoad(b, 3, 460, 90);
  mudHole(b, 320, 64);
  b.mesa(370, 380, 350, 125);
  pocket(b, { fall: 145, floor: 400, climb: 150 });
  farmRoad(b, 2, 460, 92);
  jumpGap(b, 255, { lip: 230, rise: 68 });
  b.basin(500, 90).flat(260);
  seesawSpan(b);
  farmRoad(b, 3, 470, 86, 22);
  pocket(b, { fall: 150, floor: 420, climb: 155 });
  farmRoad(b, 2, 470, 82, -30);
  b.flat(560);
  return b.finish({
    name: '6. Back It Up',
    concept: 'Stuck at the foot of a ramp? REVERSE to the back wall, then floor it.',
    targetTime: 100,
    basePayout: 235,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function level7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  farmRoad(b, 2, 470, 84);
  jumpGap(b, 255, { lip: 240, rise: 72 });
  farmRoad(b, 2, 460, 90);
  seesawSpan(b);
  rampTree(b, { clearance: 148 });               // kicker aimed at a low branch
  treeLine(b, 2, { clearance: 108 });            // orchard row over the road
  farmRoad(b, 1, 460, 92);
  jumpRamp(b, 440, { rw: 175, rh: 80, lead: 460 });  // past a stock engine's reach
  b.basin(500, 84).flat(240);
  mudHole(b, 340, 66);
  farmRoad(b, 3, 470, 94);
  b.mesa(380, 400, 360, 130);
  jumpEdge(b, 250);
  farmRoad(b, 2, 460, 88);
  seesawSpan(b, { length: 400 });
  treeLine(b, 2, { clearance: 100 });
  farmRoad(b, 3, 470, 84);
  b.flat(540);
  return b.finish({
    name: '7. Ups and Downs',
    concept: 'Hills, wider gaps, planks and low branches. Balance beats bravado.',
    targetTime: 112,
    basePayout: 260,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  farmRoad(b, 2, 470, 82);
  holeWall(b, { sillH: 46 });
  farmRoad(b, 2, 460, 90);
  jumpGap(b, 255, { lip: 240, rise: 72 });
  b.basin(500, 84).flat(240);
  fenceHop(b);
  farmRoad(b, 2, 460, 92);
  holeWall(b, { rampW: 178, rampH: 80, sillH: 54 });
  mudHole(b, 320, 64);
  farmRoad(b, 3, 470, 90);
  fenceHop(b, { h: 56 });
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 470 });
  farmRoad(b, 2, 470, 84);
  holeWall(b, { rampW: 180, rampH: 82, sillH: 60 });
  farmRoad(b, 2, 470, 80);
  b.flat(540);
  return b.finish({
    name: '8. Through the Wall',
    concept: 'Hit the ramp and sail THROUGH the opening. Nose down as you go.',
    targetTime: 116,
    basePayout: 280,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  farmRoad(b, 3, 470, 88);
  jumpGap(b, 250, { lip: 240, rise: 70 });     // ease in, then escalate
  mudHole(b, 340, 66);
  farmRoad(b, 2, 460, 94);
  ropeSpan(b, 320);
  b.mesa(380, 380, 360, 130);
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 480 });
  farmRoad(b, 2, 460, 92);
  treeLine(b, 3, { clearance: 104 });
  rampTree(b, { clearance: 150 });
  seesawSpan(b);
  farmRoad(b, 3, 470, 90, 20);
  holeWall(b, { sillH: 62 });
  b.basin(520, 86).flat(260);
  jumpGap(b, 255, { lip: 250, rise: 76 });
  farmRoad(b, 2, 460, 94);
  mudHole(b, 340, 66);
  farmRoad(b, 2, 460, 88);
  ropeSpan(b, 300);
  farmRoad(b, 2, 470, 88, -24);
  fenceHop(b, { h: 54 });
  jumpRamp(b, 400, { rw: 180, rh: 84, lead: 480 });
  farmRoad(b, 3, 470, 84);
  b.flat(540);
  return b.finish({
    name: '9. The Long Haul',
    concept: 'Mud, rope bridges, walls and orchards — and the clock is ticking.',
    targetTime: 150,
    basePayout: 310,
    recommended: 'pickup',
    friction: 0.82,
  });
}

function level10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  farmRoad(b, 2, 470, 88);
  jumpGap(b, 255, { lip: 245, rise: 76 });
  seesawSpan(b);
  farmRoad(b, 2, 460, 94);
  dipUnderpass(b, { w: 320, clearance: 150 });
  mudHole(b, 340, 66);
  farmRoad(b, 3, 460, 96);
  jumpRamp(b, 400, { rw: 180, rh: 84, lead: 490 });
  pocket(b, { fall: 150, floor: 400, climb: 152 });
  farmRoad(b, 2, 470, 92);
  ropeSpan(b, 340);
  rampTree(b, { clearance: 146 });
  treeLine(b, 2, { clearance: 100 });
  farmRoad(b, 2, 470, 88);
  b.mesa(380, 400, 360, 130);
  holeWall(b, { rampW: 182, rampH: 84, sillH: 68 });
  farmRoad(b, 3, 470, 94, 20);
  fenceHop(b, { h: 58 });
  jumpGap(b, 255, { lip: 250, rise: 80 });   // past what engine tier 1 can carry
  b.basin(520, 86).flat(260);
  seesawSpan(b, { length: 400 });
  mudHole(b, 360, 68);
  farmRoad(b, 2, 460, 90, -26);
  ropeSpan(b, 300);
  jumpRamp(b, 400, { rw: 182, rh: 86, lead: 500 });  // more than a stock engine carries
  farmRoad(b, 2, 470, 86);
  b.flat(560);
  return b.finish({
    name: '10. Graduation Day',
    concept: 'The full farm gauntlet, end to end. Pass this and the Town awaits.',
    targetTime: 195,
    basePayout: 365,
    recommended: 'pickup',
    friction: 0.85,
  });
}

// --- Town (World 2) ----------------------------------------------------------
// Asphalt and rooftops. Faster than the Farm and much longer, with the street
// furniture the Farm never had: bump rows, potholes, low branches and low
// overpasses. Expected player state runs from engine tier 1 up to tier 2.

function town1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  bumpRow(b, 4);
  townRoad(b, 2, 430, 66);
  potholeRun(b, 2);
  b.flat(200).basin(460, 78).flat(240);
  bumpCrest(b, { count: 4, spacing: 115 });
  townRoad(b, 1, 440, 74);
  jumpEdge(b, 230);
  bumpRow(b, 3, 130);
  townRoad(b, 2, 430, 70);
  b.mesa(320, 420, 320, 120);
  potholeRun(b, 3);
  townRoad(b, 2, 440, 68);
  b.flat(560);
  return b.finish({
    name: '1. Suburban Cruise',
    concept: 'Speed bumps and potholes punish flat-out driving. Read the street.',
    targetTime: 78,
    basePayout: 275,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380);
  potholeRun(b, 3);
  townRoad(b, 2, 430, 70);
  bumpRow(b, 4, 120);
  potholeRun(b, 2, { spread: 95 });
  b.flat(220).basin(480, 80).flat(240);
  jumpGap(b, 240, { lip: 200, rise: 60 });
  potholeRun(b, 4, { spread: 105 });
  townRoad(b, 2, 440, 76);
  underpass(b, { style: 'gantry' });
  bumpRow(b, 4, 118);
  potholeRun(b, 3, { spread: 90 });
  townRoad(b, 2, 430, 72);
  jumpRamp(b, 320, { rw: 170, rh: 74, lead: 420 });
  townRoad(b, 2, 440, 70);
  b.flat(520);
  return b.finish({
    name: '2. Pothole Alley',
    concept: 'Potholes swallow slow wheels — carry speed to skip across them.',
    targetTime: 84,
    basePayout: 290,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  townRoad(b, 2, 430, 72);
  rampTree(b, { clearance: 150 });
  bumpCrest(b, { count: 3, spacing: 125 });
  jumpEdge(b, 250);
  treeLine(b, 2, { clearance: 98 });
  townRoad(b, 2, 440, 78);
  potholeRun(b, 3);
  jumpRamp(b, 340, { rw: 170, rh: 72, lead: 440 });
  rampTree(b, { clearance: 146 });
  treeLine(b, 2, { clearance: 100 });
  b.mesa(340, 400, 330, 125);
  underpass(b, { clearance: 140, style: 'gantry' });
  townRoad(b, 2, 430, 74);
  treeLine(b, 2, { clearance: 96 });
  jumpEdge(b, 255);
  townRoad(b, 2, 440, 70);
  b.flat(540);
  return b.finish({
    name: '3. Watch the Trees',
    concept: 'Leaves snag flying cars. Jump LOW under the canopies, or not at all.',
    targetTime: 90,
    basePayout: 310,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  fenceHop(b);
  bumpRow(b, 3, 125);
  townRoad(b, 2, 430, 72);
  fenceHop(b, { h: 56 });
  potholeRun(b, 3);
  jumpGap(b, 250, { lip: 210, rise: 62 });
  fenceHop(b, { h: 58 });
  townRoad(b, 2, 440, 78);
  bumpCrest(b, { count: 4, spacing: 118 });
  fenceHop(b, { rw: 140, rh: 50, h: 62 });
  b.basin(500, 84).flat(240);
  treeLine(b, 2, { clearance: 102 });
  jumpRamp(b, 380, { rw: 175, rh: 76, lead: 450 });
  fenceHop(b, { rw: 140, rh: 50, h: 64 });
  townRoad(b, 2, 430, 74);
  b.flat(540);
  return b.finish({
    name: '4. Fence Hopper',
    concept: 'Pop off the kickers to clear the backyard fences. Timing, not throttle.',
    targetTime: 96,
    basePayout: 330,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  bumpRow(b, 3, 130);
  townRoad(b, 2, 430, 70);
  rooftops(b, 3, { roof: 470, gap: 200 });
  bumpRow(b, 3, 125);
  potholeRun(b, 3);
  townRoad(b, 2, 440, 76);
  rooftops(b, 4, { climb: 320, height: 190, roof: 480, gap: 200, drop: 200 });
  treeLine(b, 2, { clearance: 104 });
  townRoad(b, 2, 430, 72);
  jumpEdge(b, 250);
  rooftops(b, 3, { climb: 300, height: 180, roof: 460, gap: 200, drop: 190 });
  bumpRow(b, 4, 120);
  townRoad(b, 2, 440, 70);
  b.flat(540);
  return b.finish({
    name: '5. Rooftop Run',
    concept: 'Up the service ramp and across the roofs. Do not look down.',
    targetTime: 104,
    basePayout: 350,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  bumpRow(b, 4, 120);
  potholeRun(b, 3, { spread: 100 });
  townRoad(b, 2, 430, 74);
  treeLine(b, 2, { clearance: 100 });
  jumpGap(b, 255, { lip: 215, rise: 64 });
  dipUnderpass(b, { clearance: 146, style: 'gantry' });
  bumpCrest(b, { count: 3, spacing: 115 });
  b.mesa(340, 400, 330, 128);
  potholeRun(b, 4, { spread: 95 });
  townRoad(b, 2, 440, 78);
  seesawSpan(b);
  treeLine(b, 2, { clearance: 96 });
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 460 });
  bumpRow(b, 4, 118);
  potholeRun(b, 3);
  townRoad(b, 2, 430, 72);
  b.flat(520);
  return b.finish({
    name: '6. Rush Hour',
    concept: 'Bumps, holes, branches and a low bridge. Pick your speed for each.',
    targetTime: 108,
    basePayout: 370,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  seesawSpan(b);
  townRoad(b, 2, 430, 72);
  fenceHop(b, { h: 56 });
  treeLine(b, 2, { clearance: 92, r: 65 });
  underpass(b, { clearance: 136, style: 'gantry' });
  potholeRun(b, 4, { spread: 95 });
  townRoad(b, 2, 440, 76);
  ropeSpan(b, 300);
  underpass(b, { w: 360, clearance: 134, style: 'gantry' });
  jumpEdge(b, 255);
  seesawSpan(b, { length: 400 });
  bumpRow(b, 4, 115);
  treeLine(b, 3, { clearance: 94, r: 65 });
  townRoad(b, 2, 430, 74);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 460 });
  townRoad(b, 2, 440, 70);
  b.flat(520);
  return b.finish({
    name: '7. Alley Cat',
    concept: 'Tight clearances and traps back to back. Precision work.',
    targetTime: 112,
    basePayout: 390,
    recommended: 'bike',
    friction: 1.0,
  });
}

function town8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  potholeRun(b, 3);
  bumpRow(b, 3, 120);
  ropeSpan(b, 300);
  townRoad(b, 2, 430, 74);
  holeWall(b, { sillH: 52 });
  potholeRun(b, 3, { spread: 100 });
  treeLine(b, 2, { clearance: 100 });
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 470 });
  townRoad(b, 2, 440, 78);
  ropeSpan(b, 320);
  b.mesa(350, 400, 340, 130);
  holeWall(b, { rampW: 178, rampH: 80, sillH: 60 });
  bumpCrest(b, { count: 4, spacing: 118 });
  jumpEdge(b, 258);
  townRoad(b, 2, 430, 72);
  b.flat(540);
  return b.finish({
    name: '8. Construction Zone',
    concept: 'Scaffold planks, hoardings and holes in the wall. Mind the gap.',
    targetTime: 116,
    basePayout: 410,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  bumpRow(b, 3, 125);
  potholeRun(b, 3);
  townRoad(b, 2, 430, 72);
  rooftops(b, 3, { climb: 320, height: 185, roof: 500, gap: 200 });
  treeLine(b, 2, { clearance: 104 });
  jumpEdge(b, 255);
  townRoad(b, 2, 440, 78);
  rooftops(b, 4, { climb: 320, height: 195, roof: 470, gap: 200, drop: 205 });
  potholeRun(b, 4, { spread: 95 });
  seesawSpan(b);
  ropeSpan(b, 300);
  townRoad(b, 2, 430, 76);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 470 });
  bumpRow(b, 4, 118);
  rooftops(b, 3, { climb: 300, height: 180, roof: 460, gap: 200, drop: 195 });
  underpass(b, { clearance: 138, style: 'gantry' });
  townRoad(b, 2, 440, 72);
  b.flat(540);
  return b.finish({
    name: '9. Rooftop Marathon',
    concept: 'Roofs, planks and one very long way down. Keep it together.',
    targetTime: 140,
    basePayout: 440,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  bumpRow(b, 4, 115);
  potholeRun(b, 3, { spread: 100 });
  townRoad(b, 2, 430, 74);
  fenceHop(b, { h: 58 });
  seesawSpan(b);
  jumpEdge(b, 258);
  treeLine(b, 2, { clearance: 98 });
  rooftops(b, 3, { climb: 320, height: 190, roof: 480, gap: 200 });
  underpass(b, { clearance: 136, style: 'gantry' });
  townRoad(b, 2, 440, 78);
  holeWall(b, { rampW: 180, rampH: 82, sillH: 62 });
  potholeRun(b, 4, { spread: 95 });
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 480 });
  b.mesa(350, 420, 340, 130);
  ropeSpan(b, 320);
  bumpRow(b, 4, 118);
  rooftops(b, 4, { climb: 320, height: 195, roof: 470, gap: 200, drop: 200 });
  treeLine(b, 2, { clearance: 96 });
  townRoad(b, 2, 430, 76);
  jumpRamp(b, 400, { rw: 180, rh: 84, lead: 500 });   // beyond a tier-1 engine
  townRoad(b, 2, 440, 70);
  b.flat(540);
  return b.finish({
    name: '10. Downtown Gauntlet',
    concept: 'Everything the town can throw at you, in one run. Good luck.',
    targetTime: 165,
    basePayout: 495,
    recommended: 'pickup',
    friction: 1.0,
  });
}

// --- City (World 3) ----------------------------------------------------------
// Dusk downtown, and the first world built on TERRACED ground: flat shelves and
// straight cut ramps, never rolling country. New hazards are all about timing
// and force — oil slicks, wrecking balls, industrial presses, updraft fans,
// open water and crane lifts. Expected player state is engine tier 2-3.

function city1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  slick(b, 260, 1);
  cityRoad(b, [[420, 70], [380, -70], [420, 0]]);
  slick(b, 240, 1);
  jumpEdge(b, 250);
  cityRoad(b, [[400, -80], [420, 80]]);
  slick(b, 200, -1);
  bumpRow(b, 3, 125);
  cityRoad(b, [[420, 90], [400, -90]]);
  slick(b, 250, 1);
  jumpRamp(b, 360, { rw: 172, rh: 74, lead: 440 });
  cityRoad(b, [[420, 0], [400, 70], [420, -70]]);
  slick(b, 190, -1);
  potholeRun(b, 3);
  cityRoad(b, [[440, 0]]);
  b.flat(540);
  return b.finish({
    name: '1. Slick Start',
    concept: 'Gold arrows boost you, red ones shove you back. Hit the red ones fast.',
    targetTime: 92,
    basePayout: 405,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  potholeRun(b, 3);
  slick(b, 180, -1);
  cityRoad(b, [[420, 80], [400, -80]]);
  slick(b, 250, 1);
  jumpEdge(b, 255);
  potholeRun(b, 3, { spread: 100 });
  cityRoad(b, [[440, -90], [420, 90]]);
  slick(b, 180, -1);
  bumpRow(b, 4, 120);
  jumpRamp(b, 390, { rw: 175, rh: 76, lead: 450 });
  cityRoad(b, [[420, 0], [400, 80]]);
  slick(b, 260, 1);
  underpass(b, { clearance: 140, style: 'gantry' });
  potholeRun(b, 4, { spread: 95 });
  cityRoad(b, [[420, -80], [440, 0]]);
  slick(b, 190, -1);
  b.flat(540);
  return b.finish({
    name: '2. Grease Trap',
    concept: 'Potholes bleed the speed you need to beat the red slicks. Plan ahead.',
    targetTime: 96,
    basePayout: 420,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  ballYard(b, { angle0: 0.85 });                    // the tutorial swing
  cityRoad(b, [[420, 80], [400, -80]]);
  slick(b, 230, 1);
  ballPair(b, { height: 330, r: 42, angle0: -1.05, height2: 265, r2: 36, angle02: 1.05 });
  jumpEdge(b, 250);
  cityRoad(b, [[440, 0], [420, 90]]);
  ballYard(b, { height: 320, r: 40, angle0: 1.1 });
  bumpRow(b, 3, 125);
  cityRoad(b, [[420, -90], [400, 0]]);
  jumpRamp(b, 300, { rw: 175, rh: 76, lead: 500 });
  ballPair(b, { height: 340, r: 44, angle0: -1.0, height2: 280, r2: 38, angle02: 1.0 });
  cityRoad(b, [[420, 70], [420, -70]]);
  slick(b, 200, -1);
  b.flat(540);
  return b.finish({
    name: '3. Demolition Row',
    concept: 'The balls swing on a fixed rhythm and never lose height. Read one, then go.',
    targetTime: 104,
    basePayout: 440,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  cityRoad(b, [[420, 70], [400, -70]]);
  fanGap(b, 380);
  slick(b, 230, 1);
  cityRoad(b, [[420, 0], [400, 80]]);
  fanGap(b, 460, { lift: 3.1, fanH: 520 });
  bumpRow(b, 3, 125);
  cityRoad(b, [[440, -80], [420, 0]]);
  jumpEdge(b, 255);
  slick(b, 240, 1);
  fanGap(b, 540, { lift: 3.2, fanH: 540, lip: 170, rise: 55 });
  cityRoad(b, [[420, 90], [400, -90]]);
  potholeRun(b, 3);
  fanGap(b, 500, { lift: 3.1, fanH: 520 });
  cityRoad(b, [[440, 0]]);
  b.flat(560);
  return b.finish({
    name: '4. Updraft Avenue',
    concept: 'Vent fans throw you skyward. Line your jumps up through the air columns.',
    targetTime: 108,
    basePayout: 460,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  canal(b, 215);
  cityRoad(b, [[420, 80], [400, -80]]);
  potholeRun(b, 3);
  fanGap(b, 420);
  canal(b, 215);
  cityRoad(b, [[440, 0], [420, 90]]);
  slick(b, 240, 1);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  canal(b, 215);
  cityRoad(b, [[420, -90], [400, 0]]);
  bumpRow(b, 3, 120);
  fanGap(b, 480, { lift: 3.1 });
  canal(b, 215);
  cityRoad(b, [[440, 70], [420, -70]]);
  b.flat(560);
  return b.finish({
    name: '5. Canal District',
    concept: 'Open water sinks you. Skim it fast, jump it hard, trust the fans.',
    targetTime: 112,
    basePayout: 480,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  pressPair(b, { period: 3.4, period2: 4.6 });
  cityRoad(b, [[420, 80], [400, -80]]);
  slickPress(b, { period: 3.6, phase: 0.4 });
  jumpEdge(b, 250);
  cityRoad(b, [[440, 0], [420, 90]]);
  pressPair(b, { period: 3.6, period2: 5.0, phase2: 0.35 });
  potholeRun(b, 3);
  cityRoad(b, [[420, -90], [400, 0]]);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  pressBay(b, { period: 3.4, phase: 0.6, clearance: 180 });
  cityRoad(b, [[420, 70], [420, -70]]);
  slick(b, 200, -1);
  b.flat(540);
  return b.finish({
    name: '6. The Stamping Line',
    concept: 'The presses slam on a cycle. Wait for the rise — or floor it through.',
    targetTime: 116,
    basePayout: 500,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  potholeRun(b, 3);
  craneUp(b, { rise: 240, roof: 460 });
  b.gap(200).roof(420).drop(150).flat(300);
  cityRoad(b, [[420, 0], [400, 80]]);
  slick(b, 230, 1);
  craneUp(b, { rise: 230, roof: 520 });
  b.fan(60, 130, 420, 2.8, 220);          // shaft vent catches undershot jumps
  b.gap(200).roof(400).slope(300, 165, 8).flat(260).drop(150).flat(420);
  cityRoad(b, [[420, -80], [440, 0]]);
  bumpRow(b, 3, 125);
  jumpEdge(b, 255);
  craneUp(b, { rise: 250, roof: 480 });
  b.gap(200).roof(430).drop(180).flat(320);
  cityRoad(b, [[420, 70], [420, -70]]);
  b.flat(560);
  return b.finish({
    name: '7. Site Elevator',
    concept: 'Drive onto the crane platform and it hauls you up. Mind the edge.',
    targetTime: 120,
    basePayout: 520,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  slick(b, 230, 1);
  canal(b, 215);
  ballYard(b, { angle0: 1.0 });
  cityRoad(b, [[420, 80], [400, -80]]);
  potholeRun(b, 3);
  slick(b, 180, -1);
  pressPair(b, { period: 3.5, period2: 4.4, phase: 0.35 });
  cityRoad(b, [[440, 0], [420, 90]]);
  fanGap(b, 460, { lift: 3.1 });
  canal(b, 215);
  ballYard(b, { height: 320, r: 40, angle0: -1.05 });
  cityRoad(b, [[420, -90], [400, 0]]);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 470 });
  pressBay(b, { period: 3.5, phase: 0.15 });
  cityRoad(b, [[440, 70], [420, -70]]);
  b.flat(560);
  return b.finish({
    name: '8. Storm Drain',
    concept: 'Oil into water into swinging steel. Keep your rhythm all the way through.',
    targetTime: 128,
    basePayout: 540,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  slick(b, 240, 1);
  ballYard(b, { angle0: -0.95 });
  cityRoad(b, [[420, 0], [400, 80]]);
  rooftops(b, 3, { climb: 320, height: 190, roof: 480, gap: 200 });
  fanGap(b, 480, { lift: 3.1 });
  cityRoad(b, [[440, -80], [420, 0]]);
  canal(b, 215);
  pressBay(b, { phase: 0.45 });
  jumpEdge(b, 255);
  rooftops(b, 4, { climb: 320, height: 195, roof: 470, gap: 200, drop: 205 });
  cityRoad(b, [[420, 90], [400, -90]]);
  ballYard(b, { height: 340, r: 44, angle0: 1.05 });
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  canal(b, 215);
  cityRoad(b, [[440, 0]]);
  b.flat(560);
  return b.finish({
    name: '9. High Steel',
    concept: 'Rooftops with wrecking balls and wind. Do not look down — there is water.',
    targetTime: 148,
    basePayout: 565,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function city10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400);
  slick(b, 230, 1);
  pressBay(b, { phase: 0.15 });
  ballYard(b, { angle0: 1.0 });
  cityRoad(b, [[420, 80], [400, -80]]);
  canal(b, 215);
  craneUp(b, { rise: 240, roof: 470 });
  b.fan(60, 130, 420, 2.8, 220);
  b.gap(200).roof(420).drop(170).flat(340);
  cityRoad(b, [[440, 0], [420, 90]]);
  slick(b, 190, -1);
  fanGap(b, 520, { lift: 3.2, fanH: 540 });
  potholeRun(b, 3);
  slickPress(b, { period: 3.6, phase: 0.5 });
  cityRoad(b, [[420, -90], [400, 0]]);
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 490 });
  ballYard(b, { height: 340, r: 44, angle0: -1.05 });
  canal(b, 215);
  cityRoad(b, [[420, 70], [440, -70]]);
  bumpRow(b, 4, 118);
  b.flat(560);
  return b.finish({
    name: '10. City Limits',
    concept: 'Everything downtown has, back to back. Prove you belong here.',
    targetTime: 170,
    basePayout: 610,
    recommended: 'pickup',
    friction: 0.95,
  });
}

// --- Mines (World 4) ---------------------------------------------------------
// Lantern-lit tunnels working downward. Rolling ground like the Farm but
// tighter, and every hazard is lethal on contact rather than merely costly:
// crumbling planks, rockfall chutes, black ice, lava and acid, ceiling teeth,
// and the tire yards you trampoline out of. Expected state is engine tier 3.

function mines1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  minesRoad(b, 2, 420, 76);
  plankSpan(b, 260);
  minesRoad(b, 2, 430, 82);
  jumpEdge(b, 250);
  plankSpan(b, 300);
  b.basin(480, 82).flat(240);
  minesRoad(b, 2, 420, 86);
  plankSpan(b, 320);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 460 });
  minesRoad(b, 2, 430, 80);
  plankSpan(b, 300);
  minesRoad(b, 2, 420, 76);
  b.flat(540);
  return b.finish({
    name: '1. Timber Line',
    concept: 'Old mine planks give way a moment after you touch them. Never stop on a bridge.',
    targetTime: 96,
    basePayout: 495,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  minesRoad(b, 2, 420, 76);
  rockChute(b, 180);
  minesRoad(b, 2, 430, 80);
  rockChute(b, 190, { phase: 0.5 });
  jumpEdge(b, 250);
  minesRoad(b, 2, 420, 84);
  rockChute(b, 200, { phase: 0.25 });
  plankSpan(b, 280);
  minesRoad(b, 2, 430, 78);
  rockChute(b, 200, { period: 2.5, phase: 0.6 });
  minesRoad(b, 2, 420, 82);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  minesRoad(b, 2, 430, 76);
  b.flat(540);
  return b.finish({
    name: '2. Rockfall Alley',
    concept: 'Boulders drop from the ceiling chutes. Let one fall, then punch it across.',
    targetTime: 108,
    basePayout: 515,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  minesRoad(b, 2, 420, 74);
  iceRun(b, 300);
  minesRoad(b, 2, 430, 80);
  iceRun(b, 320);
  jumpEdge(b, 250);
  b.basin(480, 80).flat(240);
  iceRun(b, 300);
  plankSpan(b, 280);
  minesRoad(b, 2, 420, 82);
  iceRun(b, 340);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  minesRoad(b, 2, 430, 78);
  iceRun(b, 300);
  minesRoad(b, 2, 420, 74);
  b.flat(540);
  return b.finish({
    name: '3. Frozen Seam',
    concept: 'Frozen groundwater: no grip, no brakes, no gas. Choose your speed BEFORE the ice.',
    targetTime: 104,
    basePayout: 535,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(480);
  minesRoad(b, 2, 420, 76);
  pool(b, 235);
  minesRoad(b, 2, 430, 80);
  pool(b, 235);
  jumpEdge(b, 250);
  minesRoad(b, 2, 420, 84);
  pool(b, 235);
  plankSpan(b, 280);
  minesRoad(b, 2, 430, 78);
  pool(b, 235, 'acid');
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  minesRoad(b, 2, 420, 80);
  pool(b, 235);
  minesRoad(b, 2, 430, 74);
  b.flat(540);
  return b.finish({
    name: '4. Molten Vein',
    concept: 'Water forgives a skim. Lava does not. Clear every pool clean.',
    targetTime: 112,
    basePayout: 550,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  minesRoad(b, 2, 420, 70);
  needle(b, 200, 150);
  minesRoad(b, 2, 430, 74);
  needle(b, 210, 142);
  plankSpan(b, 280);
  minesRoad(b, 2, 420, 76);
  needle(b, 215, 136);
  jumpEdge(b, 250);
  minesRoad(b, 2, 430, 72);
  needle(b, 220, 130);
  iceRun(b, 300);
  minesRoad(b, 2, 420, 74);
  needle(b, 220, 126);
  minesRoad(b, 2, 430, 70);
  b.flat(540);
  return b.finish({
    name: '5. The Needle\'s Eye',
    concept: 'The tunnel pinches shut. Jump the slot flat and fast — no showboating.',
    targetTime: 110,
    basePayout: 570,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  minesRoad(b, 2, 420, 74);
  tireBasin(b);
  minesRoad(b, 2, 430, 78);
  tireBasin(b, { fall: 180, wall: 320 });
  plankSpan(b, 280);
  minesRoad(b, 2, 420, 80);
  tireBasin(b, { fall: 190, into: 280, floor: 460, wall: 340 });
  jumpEdge(b, 250);
  minesRoad(b, 2, 430, 76);
  tireBasin(b, { fall: 200, into: 280, floor: 470, wall: 350 });
  minesRoad(b, 2, 420, 74);
  b.flat(540);
  return b.finish({
    name: '6. The Tire Yard',
    concept: 'Fall onto the stacks — each bounce throws you higher. Ride them up the ledges.',
    targetTime: 118,
    basePayout: 590,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  minesRoad(b, 2, 420, 78);
  plankSpan(b, 300);
  rockChute(b, 190);
  minesRoad(b, 2, 430, 82);
  iceRun(b, 300);
  jumpEdge(b, 252);
  minesRoad(b, 2, 420, 84);
  rockChute(b, 200, { phase: 0.4 });
  plankSpan(b, 320);
  minesRoad(b, 2, 430, 80);
  pool(b, 235);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  iceLeap(b, { w: 190 });
  minesRoad(b, 1, 420, 78);
  rockChute(b, 200, { period: 2.5, phase: 0.7 });
  minesRoad(b, 2, 430, 74);
  b.flat(540);
  return b.finish({
    name: '7. Cave-In',
    concept: 'Falling rock, breaking planks and black ice. The mine wants you buried.',
    targetTime: 132,
    basePayout: 610,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  minesRoad(b, 2, 420, 74);
  needle(b, 200, 144);
  pool(b, 235, 'acid');
  minesRoad(b, 2, 430, 78);
  tireBasin(b, { fall: 180, wall: 310 });
  minesRoad(b, 2, 420, 80);
  needle(b, 210, 134);
  jumpEdge(b, 252);
  pool(b, 235, 'acid');
  minesRoad(b, 2, 430, 76);
  tireBasin(b, { fall: 190, into: 280, floor: 460, wall: 330 });
  needle(b, 215, 130);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  pool(b, 235, 'acid');
  minesRoad(b, 2, 420, 74);
  b.flat(540);
  return b.finish({
    name: '8. Acid Bath',
    concept: 'The tailing ponds went bad down here. Bounce high, jump tight, touch nothing green.',
    targetTime: 136,
    basePayout: 630,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  minesRoad(b, 2, 420, 78);
  plankSpan(b, 300);
  rockChute(b, 190);
  iceRun(b, 300);
  minesRoad(b, 2, 430, 82);
  pool(b, 235);
  needle(b, 215, 138);
  jumpEdge(b, 255);
  minesRoad(b, 2, 420, 84);
  tireBasin(b, { fall: 180, wall: 320 });
  rockChute(b, 200, { phase: 0.5 });
  minesRoad(b, 2, 430, 80);
  iceLeap(b, { w: 190 });
  minesRoad(b, 1, 430, 74);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  pool(b, 235, 'acid');
  plankSpan(b, 320);
  minesRoad(b, 2, 420, 78);
  needle(b, 220, 132);
  minesRoad(b, 2, 430, 74);
  b.flat(540);
  return b.finish({
    name: '9. The Deep Seam',
    concept: 'The long way down: every hazard the mine has, one after another.',
    targetTime: 158,
    basePayout: 650,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  plankSpan(b, 280);
  minesRoad(b, 2, 420, 76);
  rockChute(b, 190);
  iceRun(b, 300);
  pool(b, 235);
  minesRoad(b, 2, 430, 80);
  needle(b, 215, 136);
  jumpEdge(b, 255);
  tireBasin(b, { fall: 190, into: 280, floor: 470, wall: 340 });
  minesRoad(b, 2, 420, 82);
  plankSpan(b, 300);
  rockChute(b, 200, { phase: 0.35 });
  minesRoad(b, 2, 430, 78);
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 490 });
  pool(b, 235, 'acid');
  iceLeap(b, { w: 185 });
  minesRoad(b, 1, 420, 80);
  needle(b, 220, 130);
  tireBasin(b, { fall: 200, into: 280, floor: 470, wall: 350 });
  minesRoad(b, 2, 430, 76);
  rockChute(b, 200, { period: 2.5, phase: 0.15 });
  minesRoad(b, 2, 420, 74);
  b.flat(560);
  return b.finish({
    name: '10. The Motherlode',
    concept: 'Everything the mountain has left. Dig deep and drive out the other side.',
    targetTime: 178,
    basePayout: 690,
    recommended: 'pickup',
    friction: 0.9,
  });
}

// --- Castle (World 5) --------------------------------------------------------
// Torchlit ramparts on terraced ground: flat wards joined by cut ramps. The
// garrison's defences are all TIMING — fireball moats, arrow volleys off the
// machicolations, spiked flails on driven chains — and the level design mixes
// them deliberately: an archer wall is never just archers, it comes with the
// timber and the fire. Expected state is a near-maxed car.

function castle1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420);
  castleRoad(b, [[420, 70], [400, -70]]);
  plankSpan(b, 280);
  castleRoad(b, [[440, 0], [420, 80]]);
  jumpEdge(b, 250);
  plankSpan(b, 300);
  castleRoad(b, [[420, -80], [400, 0]]);
  barricade(b, { h: 280 });
  castleRoad(b, [[420, 90], [420, -90]]);
  plankSpan(b, 320);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 460 });
  castleRoad(b, [[440, 0]]);
  b.flat(540);
  return b.finish({
    name: '1. The Drawbridge',
    concept: 'The old approach road: rotten planks, a barred gate and a dry moat.',
    targetTime: 102,
    basePayout: 585,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  fireMoat(b, 185);
  castleRoad(b, [[420, 70], [400, -70]]);
  fireMoat(b, 185, { phase: 0.5 });
  jumpEdge(b, 248);
  castleRoad(b, [[440, 0]]);
  fireMoat(b, 185, { phase: 0.25 });
  plankSpan(b, 280);
  castleRoad(b, [[420, 80], [420, -80]]);
  fireMoat(b, 185, { period: 3.4, phase: 0.6 });
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  castleRoad(b, [[440, 0]]);
  fireMoat(b, 185, { period: 3.4, phase: 0.15 });
  castleRoad(b, [[420, 0]]);
  b.flat(540);
  return b.finish({
    name: '2. The Fire Moat',
    concept: 'Fireballs leap from the molten moats on a rhythm. Cross while they dive.',
    targetTime: 122,
    basePayout: 605,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  spikeRamp(b);
  castleRoad(b, [[400, 70], [380, -70]]);
  spikeRamp(b, { strip: 125 });
  jumpEdge(b, 250);
  castleRoad(b, [[420, 0]]);
  spikeLeap(b);
  barricade(b, { h: 300 });
  castleRoad(b, [[420, 80], [400, -80]]);
  spikeLeap(b, { depth: 100 });
  plankSpan(b, 300);
  castleRoad(b, [[440, 0]]);
  spikeRamp(b, { rw: 140, rh: 50, strip: 125, after: 700 });
  castleRoad(b, [[420, 0]]);
  b.flat(540);
  return b.finish({
    name: '3. Spike Row',
    concept: 'Caltrops shred tires on touch. The ramp is not optional — pop it and clear them.',
    targetTime: 116,
    basePayout: 625,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  barricade(b);
  castleRoad(b, [[420, 70], [400, -70]]);
  barricade(b, { h: 320 });
  castleRoad(b, [[440, 0]]);
  barricade(b, { rw: 155, rh: 48, h: 320 });
  jumpEdge(b, 250);
  castleRoad(b, [[420, 80], [400, -80]]);
  barricade(b, { h: 320 });
  spikeRamp(b, { after: 1250 });
  castleRoad(b, [[440, 0]]);
  barricade(b, { rw: 155, rh: 50, h: 320 });
  barricade(b, { h: 320 });
  castleRoad(b, [[420, 0]]);
  b.flat(540);
  return b.finish({
    name: '4. The Battering Run',
    concept: 'Ram wedge, then timber. Hit the gates at full speed or bounce off them.',
    targetTime: 124,
    basePayout: 645,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle5() {
  const b = new LevelBuilder(0, GROUND_Y);
  // An archer wall is never JUST archers: every gallery here is paired with
  // something that stops you dead underneath it if you misread the volley.
  b.flat(440);
  archerWall(b);
  castleRoad(b, [[420, 70], [400, -70]]);
  barricade(b, { h: 300 });
  archerWall(b, { phase: 0.5 });
  castleRoad(b, [[440, 0]]);
  fireMoat(b, 185, { phase: 0.3 });
  archerWall(b, { phase: 0.3, rainFrac: 0.38 });
  jumpEdge(b, 250);
  castleRoad(b, [[420, 80], [400, -80]]);
  barricade(b, { h: 320 });
  archerWall(b, { period: 2.4, phase: 0.15 });
  castleRoad(b, [[440, 0]]);
  fireMoat(b, 185, { period: 3.4, phase: 0.55 });
  archerWall(b, { period: 2.4, phase: 0.6 });
  castleRoad(b, [[420, 0]]);
  b.flat(540);
  return b.finish({
    name: '5. Archer Walls',
    concept: 'Real arrows, real hitboxes. Wait out the volley, then run the gallery.',
    targetTime: 140,
    basePayout: 665,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  flailPost(b);
  castleRoad(b, [[420, 70], [400, -70]]);
  flailPost(b, { angle0: -1.1 });
  jumpEdge(b, 250);
  castleRoad(b, [[440, 0]]);
  flailPost(b, { height: 280, r: 38 });
  barricade(b, { h: 300 });
  castleRoad(b, [[420, 80], [400, -80]]);
  flailPost(b, { height: 260, r: 34, angle0: -1.15 });
  plankSpan(b, 300);
  castleRoad(b, [[440, 0]]);
  flailPost(b, { height: 280, r: 38, angle0: 1.15 });
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  castleRoad(b, [[420, 0]]);
  b.flat(540);
  return b.finish({
    name: '6. The Flail Yard',
    concept: 'Short chains, fast rhythm, and they never slow down. Park close and watch one pass.',
    targetTime: 130,
    basePayout: 680,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  spikeRamp(b);
  plankSpan(b, 300);
  castleRoad(b, [[420, 70], [400, -70]]);
  barricade(b, { h: 300 });
  archerWall(b, { phase: 0.4 });
  castleRoad(b, [[440, 0]]);
  spikeLeap(b);
  flailPost(b, { height: 270, r: 36 });
  jumpEdge(b, 252);
  castleRoad(b, [[420, 80], [400, -80]]);
  barricade(b, { h: 320 });
  plankSpan(b, 300);
  castleRoad(b, [[440, 0]]);
  spikeRamp(b, { rw: 135, rh: 48, strip: 125, after: 760 });
  castleRoad(b, [[420, 0]]);
  b.flat(540);
  return b.finish({
    name: '7. The Outer Ward',
    concept: 'Spikes, rotten planks, stubborn timber and a flail. Keep your speed up.',
    targetTime: 138,
    basePayout: 700,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  fireMoat(b, 185);
  castleRoad(b, [[420, 70], [400, -70]]);
  archerWall(b, { phase: 0.25 });
  castleRoad(b, [[440, 0]]);
  fireMoat(b, 185, { phase: 0.5 });
  barricade(b, { h: 310 });
  jumpEdge(b, 252);
  castleRoad(b, [[420, 80], [400, -80]]);
  archerWall(b, { phase: 0.6 });
  flailPost(b, { height: 275, r: 36 });
  castleRoad(b, [[440, 0]]);
  spikeRamp(b, { rw: 140, rh: 50, strip: 125, after: 900 });
  fireMoat(b, 185, { period: 3.4, phase: 0.2 });
  castleRoad(b, [[420, 0]]);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  castleRoad(b, [[440, 0]]);
  b.flat(540);
  return b.finish({
    name: '8. Gauntlet of Fire',
    concept: 'Fire below, arrows above, spikes between. Timing is the only thing that saves you.',
    targetTime: 152,
    basePayout: 720,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  fireMoat(b, 185);
  archerWall(b);
  castleRoad(b, [[420, 70], [400, -70]]);
  spikeRamp(b, { after: 1250 });
  barricade(b, { h: 300 });
  castleRoad(b, [[440, 0]]);
  plankSpan(b, 300);
  flailPost(b, { height: 280, r: 38 });
  jumpEdge(b, 255);
  castleRoad(b, [[420, 80], [400, -80]]);
  barricade(b, { h: 320 });
  fireMoat(b, 185, { phase: 0.35 });
  castleRoad(b, [[440, 0]]);
  archerWall(b, { phase: 0.5, period: 2.4 });
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  castleRoad(b, [[420, 0]]);
  flailPost(b, { height: 270, r: 36, angle0: -1.1 });
  castleRoad(b, [[440, 0]]);
  b.flat(540);
  return b.finish({
    name: '9. The Inner Bailey',
    concept: 'Every defence the garrison has, wall after wall after wall.',
    targetTime: 168,
    basePayout: 740,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  plankSpan(b, 280);
  flailPost(b, { height: 285, r: 38 });
  castleRoad(b, [[420, 70], [400, -70]]);
  fireMoat(b, 185);
  archerWall(b);
  castleRoad(b, [[440, 0]]);
  spikeRamp(b, { after: 1250 });
  barricade(b, { h: 320 });
  castleRoad(b, [[420, 80], [400, -80]]);
  jumpEdge(b, 255);
  fireMoat(b, 185, { phase: 0.5 });
  barricade(b, { rw: 155, rh: 50, h: 320 });
  castleRoad(b, [[440, 0]]);
  archerWall(b, { phase: 0.35, period: 2.4 });
  flailPost(b, { height: 270, r: 36, angle0: -1.05 });
  castleRoad(b, [[420, 0]]);
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 490 });
  plankSpan(b, 300);
  fireMoat(b, 185, { period: 3.4, phase: 0.25 });
  archerWall(b, { phase: 0.7 });
  castleRoad(b, [[440, 0]]);
  b.flat(560);
  return b.finish({
    name: '10. The Throne Gauntlet',
    concept: 'The keep itself. Fire, steel and arrows between you and the crown.',
    targetTime: 190,
    basePayout: 780,
    recommended: 'pickup',
    friction: 0.95,
  });
}

// --- Factory (World 6) -------------------------------------------------------
// The machine floor: long flat bays and sharp cut steps, the most mechanical
// ground in the game. Compactors, conveyors, falling scrap, drivable pipes,
// sludge vats, ground springs, spinning blades and elevators that take you
// DOWN — mixed with the whole back catalogue. Expected state is a maxed car.

function factory1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  beltRun(b, 280, 6);
  factoryRoad(b, 1, 400, 66);
  beltRun(b, 240, -4);
  compactorBay(b, { w: 180, clearance: 250, period: 4.0 });
  factoryRoad(b, 1, 420, 72);
  jumpEdge(b, 250);
  beltCompactor(b, { speed: 4, period: 4.4, phase: 0.3 });
  factoryRoad(b, 1, 400, 68);
  beltRun(b, 300, 7);
  compactorPair(b, { period: 4.0, period2: 5.2 });
  factoryRoad(b, 1, 420, 70);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  beltRun(b, 280, -4);
  factoryRoad(b, 1, 400, 66);
  b.flat(520);
  return b.finish({
    name: '1. The Loading Dock',
    concept: 'Welcome to the floor: belts that fight you, a compactor, and your first big jump.',
    targetTime: 120,
    basePayout: 650,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  slick(b, 250, 1);
  scrapChute(b, 260, { count: 3, period: 2.6 });
  beltRun(b, 260, 5);
  factoryRoad(b, 1, 400, 68);
  scrapChute(b, 300, { count: 4, period: 2.8, phase: 0.3 });
  slickPress(b, { period: 3.8, phase: 0.4 });
  jumpEdge(b, 250);
  factoryRoad(b, 1, 420, 74);
  beltRun(b, 240, -4);
  scrapChute(b, 280, { count: 3, period: 2.4, phase: 0.5 });
  compactorBay(b, { phase: 0.55 });
  factoryRoad(b, 1, 400, 70);
  jumpRamp(b, 400, { rw: 175, rh: 78, lead: 470 });
  factoryRoad(b, 1, 400, 66);
  scrapChute(b, 300, { count: 4, period: 2.5, phase: 0.15 });
  beltRun(b, 260, 6);
  factoryRoad(b, 1, 420, 68);
  b.flat(520);
  return b.finish({
    name: '2. Scrap Line',
    concept: 'Scrap rains from the chutes above. Watch a fall clear, then punch it across.',
    targetTime: 128,
    basePayout: 670,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(480);
  pool(b, 200, 'acid');
  springLaunch(b, 0, { launch: 20 });
  beltRun(b, 240, 5);
  factoryRoad(b, 1, 400, 68);
  pool(b, 220, 'acid');
  springLaunch(b, 380, { launch: 21 });
  factoryRoad(b, 1, 400, 68);
  jumpEdge(b, 250);
  slickPress(b, { period: 3.8, phase: 0.25 });
  factoryRoad(b, 1, 420, 72);
  pool(b, 220, 'acid');
  beltRun(b, 260, -4);
  compactorPair(b, { period: 4.4, period2: 5.6, phase2: 0.35 });
  factoryRoad(b, 1, 400, 70);
  springLaunch(b, 400, { launch: 21 });
  factoryRoad(b, 1, 400, 66);
  pool(b, 210, 'acid');
  factoryRoad(b, 1, 420, 66);
  b.flat(520);
  return b.finish({
    name: '3. Acid Alley',
    concept: 'Acid eats anything that touches it. The ground springs buy you the hang time.',
    targetTime: 132,
    basePayout: 690,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(440);
  beltRun(b, 260, 5);
  pipeRun(b);
  b.slope(160, -35).gap(255, 55).slope(240, 45).flat(420);
  pipeRun(b, { run1: 560, dip: 0, run2: 280 });
  b.slope(240, 170, 8).flat(400);
  compactorPair(b, { period: 4.0, period2: 5.2, phase2: 0.3 });
  factoryRoad(b, 1, 400, 70);
  beltCompactor(b, { speed: 5, period: 4.6, phase: 0.4 });
  jumpEdge(b, 252);
  pipeRun(b, { radius: 110, run1: 500, dip: -140 });
  b.slope(220, 150, 8).flat(420);
  scrapChute(b, 280, { count: 3, period: 2.6, phase: 0.2 });
  factoryRoad(b, 1, 420, 74);
  beltRun(b, 280, -4);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  bladePost(b, { height: 275, omega: 1.6, phase: 0.9 });
  factoryRoad(b, 1, 400, 68);
  b.flat(520);
  return b.finish({
    name: '4. Pipe Works',
    concept: 'Steel pipes carry the road under the floor. Launch out of one, land in the next.',
    targetTime: 134,
    basePayout: 710,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  sludgePit(b, 600, 140);
  beltRun(b, 260, 5);
  sludgePit(b, 500, 170);
  factoryRoad(b, 1, 400, 70);
  jumpEdge(b, 250);
  tireBasin(b, { fall: 170, wall: 310 });
  factoryRoad(b, 1, 400, 66);   // let the trampoline exit settle before the vat
  sludgePit(b, 580, 175);
  compactorPair(b, { period: 4.2, period2: 5.4, phase2: 0.5 });
  factoryRoad(b, 1, 420, 74);
  sludgePit(b, 560, 160);
  beltCompactor(b, { speed: 4, period: 4.4, phase: 0.15 });
  factoryRoad(b, 1, 400, 68);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  sludgePit(b, 620, 150);
  factoryRoad(b, 1, 420, 66);
  b.flat(520);
  return b.finish({
    name: '5. The Sludge Pits',
    concept: 'Corrosive sludge pools in the dips. A fast splash survives — dawdling melts you.',
    targetTime: 138,
    basePayout: 730,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(480);
  compactorBay(b, { w: 200, clearance: 260, period: 4.4 });
  beltRun(b, 280, 6);
  compactorPair(b, { w: 210, clearance: 250, period: 4.2, period2: 5.6, phase2: 0.3 });
  jumpEdge(b, 252);
  factoryRoad(b, 1, 400, 72);
  beltCompactor(b, { speed: 5, w: 200, period: 4.8, phase: 0.2 });
  factoryRoad(b, 1, 420, 76);
  beltRun(b, 260, -4);
  compactorPair(b, { w: 220, clearance: 270, period: 4.6, period2: 3.8, phase2: 0.55 });
  factoryRoad(b, 1, 400, 70);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  compactorBay(b, { w: 200, clearance: 250, period: 4.0, phase: 0.2 });
  factoryRoad(b, 1, 420, 68);
  b.flat(520);
  return b.finish({
    name: '6. Compactor Row',
    concept: 'Pneumatic rams on a slow heavy cycle. Wait for the rise, then floor it.',
    targetTime: 142,
    basePayout: 750,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(480);
  bladePost(b, { height: 280, omega: 1.4 });
  factoryRoad(b, 1, 400, 70);
  ballPair(b, { height: 340, r: 44, angle0: 1.0, height2: 275, r2: 36, angle02: -1.05 });
  bladePair(b, { omega: 1.5, omega2: 1.9, phase2: 1.4 });
  jumpEdge(b, 252);
  factoryRoad(b, 1, 420, 76);
  beltRun(b, 280, -4);
  bladePost(b, { height: 270, omega: 1.8, phase: 2.6 });
  factoryRoad(b, 1, 400, 72);
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  bladePair(b, { height: 290, omega: 1.6, height2: 260, omega2: 1.9, phase2: 0.7 });
  factoryRoad(b, 1, 420, 68);
  b.flat(520);
  return b.finish({
    name: '7. The Blade Line',
    concept: 'Rotor blades never pause. Park close, watch a full sweep, then thread it.',
    targetTime: 146,
    basePayout: 765,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  beltRun(b, 260, 5);
  factoryRoad(b, 1, 400, 70);
  shaftDown(b, { drop: 320 });
  beltCompactor(b, { speed: 4, period: 4.4, phase: 0.1 });
  shaftDown(b, { drop: 340 });
  factoryRoad(b, 1, 420, 74);
  craneUp(b, { rise: 300, roof: 500 });
  b.gap(200).roof(450).drop(200).flat(460);
  compactorPair(b, { period: 4.2, period2: 5.4, phase2: 0.4 });
  jumpEdge(b, 252);
  shaftDown(b, { drop: 300 });
  bladePair(b, { omega: 1.5, omega2: 1.9, phase2: 0.5 });
  craneUp(b, { rise: 280, roof: 480 });
  b.gap(200).roof(430).drop(190).flat(480);
  factoryRoad(b, 1, 400, 70);
  b.flat(520);
  return b.finish({
    name: '8. Down the Shaft',
    concept: 'Elevators drop you below the floor before a crane hauls you back up.',
    targetTime: 152,
    basePayout: 785,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  beltRun(b, 260, 6);
  springLaunch(b, 400, { launch: 20 });
  factoryRoad(b, 1, 400, 66);
  compactorPair(b, { period: 4.2, period2: 5.4, phase2: 0.2 });
  scrapChute(b, 280, { count: 4, period: 2.6, phase: 0.2 });
  jumpEdge(b, 252);
  factoryRoad(b, 1, 420, 76);
  bladePair(b, { omega: 1.5, omega2: 1.8, phase2: 0.8 });
  sludgePit(b, 600, 130);
  factoryRoad(b, 1, 400, 72);
  pool(b, 220, 'acid');
  beltCompactor(b, { speed: 5, period: 4.6, phase: 0.35 });
  jumpRamp(b, 400, { rw: 178, rh: 80, lead: 480 });
  shaftDown(b, { drop: 300 });
  scrapChute(b, 300, { count: 3, period: 2.5, phase: 0.4 });
  springLaunch(b, 420, { launch: 21 });
  factoryRoad(b, 1, 420, 70);
  b.flat(520);
  return b.finish({
    name: '9. Assembly Gauntlet',
    concept: 'Every station on the line, back to back. Nothing here forgives hesitation.',
    targetTime: 178,
    basePayout: 805,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function factory10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(460);
  beltRun(b, 280, 6);
  scrapChute(b, 300, { count: 4, period: 2.6 });
  compactorPair(b, { w: 210, clearance: 260, period: 4.4, period2: 5.6, phase2: 0.1 });
  bladePost(b, { height: 290, omega: 1.6, phase: 0.4 });
  jumpEdge(b, 255);
  factoryRoad(b, 1, 420, 76);
  springLaunch(b, 440, { launch: 21 });
  pipeRun(b, { radius: 105, run1: 480, dip: -130 });
  b.slope(230, 170, 8).flat(420);
  slickPress(b, { period: 3.8, phase: 0.5 });
  factoryRoad(b, 1, 400, 72);
  sludgePit(b, 660, 110);
  pool(b, 220, 'acid');
  beltCompactor(b, { speed: 5, period: 4.4, phase: 0.25 });
  factoryRoad(b, 1, 420, 74);
  shaftDown(b, { drop: 320 });
  bladePair(b, { height: 285, omega: 1.5, height2: 255, omega2: 1.9, phase2: 1.6 });
  jumpRamp(b, 400, { rw: 180, rh: 82, lead: 490 });
  ballPair(b, { height: 340, r: 44, angle0: -1.0, height2: 270, r2: 36, angle02: 1.1 });
  compactorBay(b, { w: 200, clearance: 250, period: 4.2, phase: 0.4 });
  factoryRoad(b, 1, 400, 68);
  b.flat(540);
  return b.finish({
    name: '10. The Furnace Floor',
    concept: 'The heart of the plant. Presses, blades, acid, sludge and steel — survive all of it.',
    targetTime: 205,
    basePayout: 860,
    recommended: 'pickup',
    friction: 0.95,
  });
}

const FARM_LEVELS = [
  level1(), level2(), level3(), level4(), level5(),
  level6(), level7(), level8(), level9(), level10(),
];

const TOWN_LEVELS = [
  town1(), town2(), town3(), town4(), town5(),
  town6(), town7(), town8(), town9(), town10(),
];

const CITY_LEVELS = [
  city1(), city2(), city3(), city4(), city5(),
  city6(), city7(), city8(), city9(), city10(),
];

const MINES_LEVELS = [
  mines1(), mines2(), mines3(), mines4(), mines5(),
  mines6(), mines7(), mines8(), mines9(), mines10(),
];

const CASTLE_LEVELS = [
  castle1(), castle2(), castle3(), castle4(), castle5(),
  castle6(), castle7(), castle8(), castle9(), castle10(),
];

const FACTORY_LEVELS = [
  factory1(), factory2(), factory3(), factory4(), factory5(),
  factory6(), factory7(), factory8(), factory9(), factory10(),
];

export const WORLDS = [
  {
    id: 1, name: 'Farm', icon: '🌾', playable: true,
    desc: 'Hay, mud and gentle hills. Learn the ropes.',
    levels: FARM_LEVELS,
    sky: ['#8ec9e8', '#d9ecc0'], groundColor: '#7a5a35', grassColor: '#6da84a',
    // tex: [tile, multiply tint] for the terrain fill and surface stripe
    // (see ui/Textures.js). Backgrounds stay untextured.
    tex: { ground: ['dirt', null], stripe: ['grass', null] },
  },
  {
    id: 2, name: 'Town', icon: '🏘️', playable: true,
    desc: 'Asphalt, rooftops and pesky trees.',
    levels: TOWN_LEVELS,
    sky: ['#a6c3e3', '#e8dcc8'], groundColor: '#686e7a', grassColor: '#464b55',
    tex: { ground: ['dirt', '#a9aebc'], stripe: ['concrete', '#61666f'] },
  },
  {
    id: 3, name: 'City', icon: '🏙️', playable: true,
    desc: 'Dusk downtown: oil, wrecking balls and heavy steel.',
    levels: CITY_LEVELS,
    sky: ['#8d92c4', '#f0ba8d'], groundColor: '#5b6069', grassColor: '#3a3f49',
    parallax: ['rgba(96, 100, 138, 0.4)', 'rgba(72, 76, 108, 0.5)'],
    tex: { ground: ['dirt', '#8d92a0'], stripe: ['concrete', '#4d525c'] },
  },
  {
    id: 4, name: 'Mines', icon: '⛏️', playable: true, cave: true,
    desc: 'Deep tunnels: rockfalls, lava and thin ice.',
    levels: MINES_LEVELS,
    sky: ['#33261a', '#120c06'], groundColor: '#43372a', grassColor: '#7c6a4f',
    parallax: ['rgba(74, 60, 42, 0.5)', 'rgba(52, 42, 30, 0.6)'],
    tex: { ground: ['underground', '#7d6b54', 430], stripe: ['mud', '#96805e'] },
  },
  {
    id: 5, name: 'Castle', icon: '🏰', playable: true, castle: true,
    desc: 'Torchlit ramparts: fire, spikes and steel.',
    levels: CASTLE_LEVELS,
    sky: ['#2a2340', '#141020'], groundColor: '#4a4552', grassColor: '#6e6878',
    parallax: ['rgba(64, 55, 88, 0.45)', 'rgba(44, 38, 64, 0.6)'],
    tex: { ground: ['stone', '#8f8a9c', 300], stripe: ['pavement', '#7a7584'] },
  },
  {
    id: 6, name: 'Factory', icon: '🏭', playable: true, factory: true,
    desc: 'The big machine floor: presses, pipes and spinning steel.',
    levels: FACTORY_LEVELS,
    sky: ['#39332c', '#9a6a3e'], groundColor: '#4a4d54', grassColor: '#6b7280',
    parallax: ['rgba(50, 48, 52, 0.45)', 'rgba(36, 34, 38, 0.6)'],
    tex: { ground: ['concrete', '#5a5f68', 260], stripe: ['pavement', '#7d828c', 140] },
  },
];

// Exported for the jump-calibration harness (test-jumps.html): sizing a gap by
// hand is guesswork, so the harness drives the REAL sections at every tier.
export const __jumpGap = jumpGap;
export const __jumpEdge = jumpEdge;
export const __jumpRamp = jumpRamp;

export function getWorld(worldId) {
  return WORLDS.find(w => w.id === worldId);
}

export function getLevel(worldId, levelIndex) {
  const w = getWorld(worldId);
  return w && w.levels[levelIndex];
}

export function levelKey(worldId, levelIndex) {
  return `${worldId}-${levelIndex}`;
}

// The very last level of the campaign (final level of the final playable
// world). Beating it is what unlocks Infinite mode.
export function isFinalCampaignLevel(worldId, levelIndex) {
  const playable = WORLDS.filter(w => w.playable && w.levels.length);
  const last = playable[playable.length - 1];
  return !!last && worldId === last.id && levelIndex === last.levels.length - 1;
}
