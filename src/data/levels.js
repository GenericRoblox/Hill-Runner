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
  // the road, so keep other set-pieces out of the arc. Any hit wrecks the
  // car — time your pass.
  wreckingBall(ox, height = 330, r = 42, angle0 = 1.0) {
    this.obstacles.push({
      type: 'ball', ax: this.x + ox, ay: this.y - height,
      len: height - 14 - r, r, angle0,
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
  // sinking is not.
  water(w, drop = 70) {
    this.obstacles.push({ type: 'water', x0: this.x, y0: this.y, w, drop });
    return this.gap(w, 0);
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
  // Sandwich between slope(150, -35) lips to keep the baseline.
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

  // Spiked flail: a wrecking ball on a short chain — tighter arc, faster
  // swing. Same lethal-contact mechanics as wreckingBall().
  spikyBall(ox, height = 270, r = 36, angle0 = 1.1) {
    this.obstacles.push({
      type: 'ball', spiky: true, ax: this.x + ox, ay: this.y - height,
      len: height - 14 - r, r, angle0,
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
      len: len ?? (height * 2 + 30), thickness, omega, phase,
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
      this.walls.push({ cx: this.x + w + 14, cy: this.y + guardH / 2, w: 28, h: guardH, style: 'steel' });
    }
    return this.gap(w, drop);
  }

  finish(meta) {
    if (this._chain.length > 1) this.chains.push(this._chain);
    return {
      chains: this.chains,
      walls: this.walls,
      obstacles: this.obstacles,
      buildings: this.buildings,
      finishX: this.x - (meta.finishBack || 120),
      deathY: meta.deathY || GROUND_Y + 550,
      startX: meta.startX || 150,
      startY: meta.startY || GROUND_Y - 80,
      ...meta,
    };
  }
}

// Hole-in-wall reached from a wooden launch ramp. Lays its own flat ground.
// Opening spans `holeLo`..`holeHi` px above the ground line.
function rampWall(b, { rampW = 180, rampH = 80, wallDx = 350, holeLo = 60, holeHi = 245, runout = 600 } = {}) {
  const rx = b.x, gy = b.y;
  b.ramp(rampW, rampH);
  b.flat(wallDx + runout); // ground runs flat under ramp, wall and landing
  b.wallAt(rx + wallDx, gy - holeLo / 2, 28, holeLo);                 // bottom stub
  b.wallAt(rx + wallDx, gy - holeHi - 150, 28, 300);                  // upper wall
  return b;
}

// --- Levels ------------------------------------------------------------------

function level1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hills(3, 480, 55)
    .flat(200)
    .hills(2, 520, 75)
    .flat(500);
  return b.finish({
    name: '1. First Gear',
    concept: 'Gentle hills — get a feel for gas and brake.',
    targetTime: 32,
    basePayout: 150,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(500)
    .hills(2, 450, 50)
    .flat(300)
    .slope(160, -40)      // slight lip before the gap for lift
    .gap(190, 50)
    .flat(400)
    .hills(2, 480, 55)
    .flat(450);
  return b.finish({
    name: '2. Mind the Gap',
    concept: 'Your first jump — carry speed off the edge.',
    targetTime: 34,
    basePayout: 175,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hill(400, 60)
    .flat(250)            // speed run-up
    .slope(200, -90)      // terrain launch lip
    .gap(250, 70)
    .slope(260, 90)       // downhill landing — match your nose to the slope!
    .flat(320)
    .ramp(170, 75)        // first wooden ramp: hit it with speed
    .flat(180)
    .gap(280, 80)
    .slope(240, 70)
    .flat(420);
  return b.finish({
    name: '3. Get Some Air',
    concept: 'Hold GAS in the air to raise the nose, BRAKE to dip it.',
    targetTime: 38,
    basePayout: 200,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .hills(2, 420, 110)
    .flat(150)
    .hill(380, 150)
    .mudDip(300, 70)
    .hill(400, 160)
    .hills(2, 360, 120)
    .flat(450);
  return b.finish({
    name: '4. Steep Country',
    concept: 'Steep slopes test your suspension — and mud saps your grip.',
    targetTime: 42,
    basePayout: 220,
    recommended: 'pickup',
    friction: 0.8,
  });
}

function level5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(500)
    .hills(2, 420, 60)
    .flat(250);
  // Narrow bridge over a pit, with an overhead beam: no jumping through here.
  b.gap(30, 20);
  const bridgeStartX = b.x;
  b.flat(300);            // the bridge itself
  b.wallAt(bridgeStartX + 150, b.y - 145, 340, 26); // overhead beam, ~119px clearance
  b.gap(30, -20)
    .flat(250)
    .mudDip(260, 45)      // sticky exit — keep momentum through the dip
    .hills(2, 450, 55)
    .flat(450);
  return b.finish({
    name: '5. The Squeeze',
    concept: 'A narrow bridge with a low beam — precision beats speed.',
    targetTime: 40,
    basePayout: 240,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hills(2, 430, 55)
    .flat(200)
    .drop(120)            // cliff into the pocket — momentum won't carry through
    .flat(340)            // pocket floor: back up to the wall for a run-up!
    .slope(190, -150, 8)  // steep exit ramp (~38°, needs a full run-up)
    .flat(250)
    .hills(2, 440, 60)
    .flat(450);
  return b.finish({
    name: '6. Back It Up',
    concept: 'Stuck at the ramp? REVERSE to the back wall, then floor it.',
    targetTime: 45,
    basePayout: 260,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function level7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .hills(2, 400, 90)
    .flat(180)
    .slope(180, -70)
    .gap(230, 50)
    .slope(200, 70)
    .flat(150)
    .seesaw(380, 55)      // new: ride the plank over the pivot
    .flat(500)
    .hill(380, 120)
    .flat(350)
    .slope(170, -80)
    .gap(200, 70)
    .slope(240, 90)
    .hills(2, 380, 100)
    .flat(450);
  return b.finish({
    name: '7. Ups and Downs',
    concept: 'Hills, gaps and a seesaw — balance beats bravado.',
    targetTime: 46,
    basePayout: 280,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(500)
    .hills(2, 420, 60)
    .flat(250);
  rampWall(b);            // wooden launch ramp -> hole in the wall
  b.hills(2, 430, 55)
    .flat(450);
  return b.finish({
    name: '8. Through the Wall',
    concept: 'Hit the ramp and sail THROUGH the opening in the wall.',
    targetTime: 44,
    basePayout: 300,
    recommended: 'pickup',
    friction: 0.85,
  });
}

function level9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .hills(3, 400, 80)
    .flat(180)
    .slope(170, -70)
    .gap(230, 60)
    .slope(220, 80)
    .mudDip(320, 60)
    .hill(380, 130)
    .flat(200)
    .ropeBridge(320)      // new: swaying planks over the drop
    .flat(250)
    .slope(180, -85)
    .gap(250, 70)
    .slope(250, 90)
    .hills(2, 370, 110)
    .flat(250);
  rampWall(b, { rampW: 170, rampH: 75, wallDx: 340, holeLo: 60, holeHi: 240, runout: 500 });
  b.hills(2, 400, 70)
    .flat(450);
  return b.finish({
    name: '9. The Long Haul',
    concept: 'Mud, rope bridges, walls — and the clock is ticking.',
    targetTime: 62,
    basePayout: 320,
    recommended: 'pickup',
    friction: 0.82,
  });
}

function level10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380)
    .hills(2, 380, 100)
    .flat(200)
    .slope(170, -80)
    .gap(260, 60)
    .slope(230, 85)
    .flat(150)
    .seesaw(380, 55)
    .flat(500);
  // Bridge + beam
  b.gap(30, 20);
  const bx = b.x;
  b.flat(280);
  b.wallAt(bx + 140, b.y - 145, 320, 26);
  b.gap(30, -20)
    .flat(200)
    .drop(120)
    .flat(320)
    .slope(190, -150, 8)  // reverse-for-run-up ramp
    .flat(200)
    .ropeBridge(300)
    .flat(250);
  rampWall(b, { rampW: 175, rampH: 78, wallDx: 345, holeLo: 60, holeHi: 245, runout: 450 });
  b.slope(160, -75)
    .gap(240, 60)
    .slope(230, 85)
    .hills(2, 360, 115)
    .flat(500);
  return b.finish({
    name: '10. Graduation Day',
    concept: 'The full farm gauntlet. Pass this and World 2 awaits.',
    targetTime: 75,
    basePayout: 380,
    recommended: 'pickup',
    friction: 0.85,
  });
}

// --- Town (World 2) ----------------------------------------------------------
// Harder than the farm: higher speeds assumed (engine tier 1-2), new hazards —
// speed bumps, potholes, and tree canopies that snag over-eager jumpers.

function town1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .speedBumps(4)
    .flat(700)
    .hills(2, 450, 60)
    .flat(100)
    .speedBumps(5, 115)
    .flat(750)
    .hill(400, 70)
    .flat(500);
  return b.finish({
    name: '1. Suburban Cruise',
    concept: 'Speed bumps punish flat-out driving — ease off or get bounced.',
    targetTime: 40,
    basePayout: 340,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380)
    .pothole()
    .flat(220)
    .pothole(85, 26)
    .flat(300)
    .hills(2, 420, 65)
    .flat(150)
    .pothole()
    .flat(90)
    .pothole()
    .flat(320)
    .slope(170, -60)
    .gap(230, 50)
    .flat(350)
    .pothole(80, 24)
    .flat(450);
  return b.finish({
    name: '2. Pothole Alley',
    concept: 'Potholes swallow slow wheels — carry speed to skip across.',
    targetTime: 42,
    basePayout: 360,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .hill(320, 75)
    .tree(190, 100)      // canopy right past the crest: big air gets snagged
    .flat(420)
    .slope(180, -70)
    .gap(250, 55)
    .slope(220, 75);
  b.tree(240, 105);      // hangs over the landing runout
  b.flat(500)
    .ramp(160, 70)
    .flat(170)
    .gap(270, 75)
    .slope(230, 70);
  b.tree(200, 110);
  b.flat(480);
  return b.finish({
    name: '3. Watch the Trees',
    concept: 'Leaves snag flying cars. Jump LOW under the canopies.',
    targetTime: 45,
    basePayout: 380,
    recommended: 'sports',
    friction: 1.0,
  });
}

function town4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .hill(220, 45);       // little launch crest...
  b.wallHere(90, 20, 55); // ...to hop this fence
  b.flat(400)
    .speedBumps(3, 125)
    .flat(500)
    .hill(230, 50);
  b.wallHere(95, 20, 60);
  b.flat(380)
    .slope(180, -70)
    .gap(280, 60)
    .slope(220, 80)
    .flat(200)
    .hill(230, 50);
  b.wallHere(95, 20, 60);
  b.flat(500);
  return b.finish({
    name: '4. Fence Hopper',
    concept: 'Pop off the crests to clear backyard fences.',
    targetTime: 48,
    basePayout: 400,
    recommended: 'sports',
    friction: 1.0,
  });
}

function town5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .speedBumps(3, 130)
    .flat(550)
    .slope(260, -180, 8)  // service ramp up to the roofs
    .ramp(130, 50, 210)   // launch ramp near roof 1's edge
    .roof(380)            // roof 1
    .gap(250)
    .ramp(140, 55, 220)   // launch ramp near roof 2's edge
    .roof(400)            // roof 2
    .gap(290)
    .roof(360)            // roof 3
    .drop(180)            // fire-escape drop back to street
    .flat(250)
    .speedBumps(3, 125)
    .flat(550);
  return b.finish({
    name: '5. Rooftop Run',
    concept: 'Up the ramp and across the rooftops — don\'t look down.',
    targetTime: 50,
    basePayout: 420,
    recommended: 'sports',
    friction: 1.0,
  });
}

function town6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380)
    .speedBumps(4, 120)
    .flat(600)
    .pothole()
    .flat(140)
    .pothole(80, 26)
    .flat(320)
    .hill(300, 70);
  b.tree(180, 100);
  b.flat(420)
    .slope(170, -65)
    .gap(260, 55)
    .slope(210, 75);
  b.tree(230, 105);
  b.flat(350)
    .pothole()
    .flat(180)
    .speedBumps(3, 115)
    .flat(600);
  return b.finish({
    name: '6. Rush Hour',
    concept: 'Bumps, holes and low branches — pick your speed wisely.',
    targetTime: 52,
    basePayout: 440,
    recommended: 'pickup',
    friction: 1.0,
  });
}

function town7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .seesaw(360, 50)
    .flat(480)
    .hill(220, 45);
  b.wallHere(90, 20, 55);
  b.flat(350);
  b.tree(180, 85, 65);    // low canopy — thread the needle
  b.flat(380)
    .pothole()
    .flat(110)
    .pothole()
    .flat(110)
    .pothole()
    .flat(300);
  // Low crane beam over the road: stay grounded.
  b.wallAt(b.x + 220, b.y - 150, 320, 24);
  b.flat(560)
    .slope(170, -65)
    .gap(250, 60)
    .slope(210, 75)
    .flat(450);
  return b.finish({
    name: '7. Alley Cat',
    concept: 'Tight clearances and traps — the motorbike shines here.',
    targetTime: 55,
    basePayout: 460,
    recommended: 'bike',
    friction: 1.0,
  });
}

function town8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420)
    .pothole()
    .flat(200)
    .speedBumps(3, 120)
    .flat(450)
    .ropeBridge(300)      // scaffolding planks over the excavation
    .flat(300)
    .pothole(85, 26)
    .flat(250);
  rampWall(b, { rampW: 175, rampH: 78, wallDx: 345, holeLo: 60, holeHi: 250, runout: 450 });
  b.tree(150, 105);
  b.flat(400)
    .slope(180, -70)
    .gap(280, 60)
    .slope(220, 80)
    .flat(450);
  return b.finish({
    name: '8. Construction Zone',
    concept: 'Scaffolds, walls and wet concrete... okay, potholes.',
    targetTime: 58,
    basePayout: 480,
    recommended: 'sports',
    friction: 1.0,
  });
}

function town9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .speedBumps(3, 125)
    .flat(500)
    .speedBumps(2, 110)   // brake check before the service ramp — no hot launches
    .flat(260)
    .slope(300, -160, 8)  // up to the roofs
    .ramp(130, 50, 330)   // launch ramp near roof 1's edge
    .roof(500)            // roof 1: room to rebuild speed after the climb
    .gap(220);
  b.ramp(120, 45, 290);   // low ramp — the tree past the gap punishes big air
  b.roof(450);            // roof 2
  b.tree(310, 120, 60);   // canopy fully past the gap — snagged cars drop onto the roof, not the pit
  b.gap(240);
  b.roof(400)             // roof 3
    .ropeBridge(300)      // plank bridge to the next building
    .roof(380)            // roof 4
    .drop(180)
    .flat(300)
    .pothole()
    .flat(160)
    .pothole(80, 25)
    .flat(320)
    .slope(180, -70)
    .gap(300, 60)
    .slope(230, 80)
    .flat(500);
  return b.finish({
    name: '9. Rooftop Marathon',
    concept: 'Roofs, rope bridges and one long way down.',
    targetTime: 70,
    basePayout: 500,
    recommended: 'sports',
    friction: 1.0,
  });
}

function town10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380)
    .speedBumps(4, 115)
    .flat(600)
    .pothole()
    .flat(120)
    .pothole(85, 26)
    .flat(300)
    .hill(220, 45);
  b.wallHere(90, 20, 58);
  b.flat(380)
    .seesaw(360, 50)
    .flat(480)
    .slope(300, -160, 8)  // rooftop section
    .ramp(130, 22, 280)   // curb-hop ramp — anything taller and fast cars overfly roof 2 entirely
    .roof(450)
    .gap(230);
  b.ramp(120, 45, 290);   // low ramp — tree past the gap punishes big air
  b.roof(450);
  b.tree(310, 120, 60);   // canopy fully past the gap so ramp jumps that snag drop onto the roof
  b.gap(240);
  b.roof(380)
    .drop(160)
    .flat(280);
  rampWall(b, { rampW: 175, rampH: 78, wallDx: 345, holeLo: 60, holeHi: 250, runout: 420 });
  b.tree(140, 105);
  b.flat(350)
    .slope(180, -70)
    .gap(300, 60)
    .slope(230, 85)
    .hills(2, 380, 90)
    .flat(550);
  return b.finish({
    name: '10. Downtown Gauntlet',
    concept: 'Everything the town can throw at you. Good luck.',
    targetTime: 85,
    basePayout: 560,
    recommended: 'sports',
    friction: 1.0,
  });
}

// --- City (World 3) ----------------------------------------------------------
// Dusk downtown, harder than Town: expected player state is engine tier 2-3.
// New hazards: oil slicks (boost/shove), wrecking balls and industrial presses
// (timing), crane lifts (ride up to rooftops), open waterways (sink!), and
// updraft fans (stretch jumps, reach ledges).

function city1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .oilSlick(260, 1)
    .flat(560)
    .hills(2, 420, 60)
    .flat(120)
    .oilSlick(240, 1)     // boost straight into the jump
    .flat(240)
    .slope(160, -40)
    .gap(240, 40)
    .flat(340)
    .oilSlick(200, -1)    // first taste of a shove-back slick — hit it fast
    .flat(420)
    .hill(380, 70)
    .flat(450);
  return b.finish({
    name: '1. Slick Start',
    concept: 'Oil slicks: gold arrows boost you, red ones shove you back. Hit red fast.',
    targetTime: 45,
    basePayout: 480,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420)
    .pothole()
    .flat(180)
    .oilSlick(180, -1)
    .flat(300)
    .hills(2, 400, 70)
    .flat(280)
    .oilSlick(240, 1)
    .flat(240)
    .slope(150, -40)
    .gap(300, 45)
    .flat(320)
    .pothole(80, 25)
    .flat(260)            // room to rebuild speed — the red slick needs a fast entry
    .oilSlick(170, -1)
    .flat(320)
    .hill(360, 85)
    .flat(430);
  return b.finish({
    name: '2. Grease Trap',
    concept: 'Potholes bleed the speed you need to beat the red slicks.',
    targetTime: 48,
    basePayout: 500,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(430);
  b.wreckingBall(240, 330, 42, 0.85); // gentler first swing — it's the tutorial ball
  b.flat(470)
    .hill(360, 70)
    .flat(90);
  b.wreckingBall(230, 330, 42, -1.05);
  b.flat(460)
    .slope(160, -50)
    .gap(250, 50)
    .flat(240);
  b.wreckingBall(210, 320, 40, 1.1);
  b.flat(430)
    .hills(2, 380, 80)
    .flat(450);
  return b.finish({
    name: '3. Demolition Row',
    concept: 'Wrecking balls swing on a rhythm. Watch one full swing, then go.',
    targetTime: 52,
    basePayout: 520,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hill(380, 60)
    .flat(200)
    .slope(160, -50)
    .fan(90, 150, 480, 3.0, 60)
    .gap(360, 50)         // long gap — the updraft carries you across
    .flat(320)
    .oilSlick(220, 1)
    .flat(230)
    .slope(150, -45)
    .fan(100, 150, 500, 3.0, 60)
    .fan(310, 150, 500, 3.0, 60)
    .gap(520, 45)         // double-fan monster gap
    .flat(340)
    .slope(170, -60)
    .fan(70, 160, 520, 3.2, 60)
    .gap(300, -90)        // ride the draft UP to a higher street
    .flat(360)
    .drop(130)
    .flat(420);
  return b.finish({
    name: '4. Updraft Avenue',
    concept: 'Vent fans push you skyward — line up your jumps through the air columns.',
    targetTime: 55,
    basePayout: 540,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(430)
    .slope(150, -40)
    .water(260)
    .slope(160, 40)
    .flat(300)
    .pothole()
    .flat(200)
    .slope(150, -45)
    .fan(110, 150, 480, 3.0, 60)
    .water(380)
    .slope(170, 45)
    .flat(430)            // the fan jump lands hard — rebuild speed before the ramp
    .ramp(150, 55, 60)
    .flat(240)
    .water(250)
    .flat(320)
    .hill(360, 80)
    .flat(430);
  return b.finish({
    name: '5. Canal District',
    concept: 'Open water sinks you. Skim fast, jump hard, trust the fans.',
    targetTime: 56,
    basePayout: 560,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380);
  b.press(300, 100, 175, 3.5, 0.0);
  b.flat(700);
  b.oilSlick(220, 1);
  b.flat(320);
  b.press(160, 100, 175, 3.5, 0.5);
  b.flat(560)
    .pothole()
    .flat(220);
  b.press(200, 100, 170, 3.4, 0.25);
  b.flat(520)
    .hills(2, 370, 75)
    .flat(430);
  return b.finish({
    name: '6. The Stamping Line',
    concept: 'Heavy presses slam on a cycle. Wait for the rise — or floor it through.',
    targetTime: 58,
    basePayout: 580,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .pothole()
    .flat(240)
    .craneLift(210, 240)  // ride the crane up to the girders
    .ramp(110, 42, 250)   // the lift exit is slow — this ramp makes the first gap
    .roof(400)
    .gap(240)
    .roof(360)
    .drop(140)
    .flat(260)
    .craneLift(210, 220)
    .ramp(120, 45, 350)   // long run-up: heavy tiers exit the lift slowly
    .roof(520)
    .fan(60, 130, 420, 2.8, 220) // vent in the shaft catches undershot jumps
    .gap(230)
    .roof(340)
    .slope(300, 165, 8)   // long girder descent
    .flat(200)
    .drop(155)
    .flat(420);
  return b.finish({
    name: '7. Site Elevator',
    concept: 'Drive onto the crane platform and it hauls you up. Mind the edge.',
    targetTime: 60,
    basePayout: 600,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380)
    .oilSlick(230, 1)
    .flat(250)
    .slope(150, -40)
    .water(300)
    .slope(160, 40)
    .flat(230);
  b.wreckingBall(220, 330, 42, 1.0);
  b.flat(450)
    .pothole()
    .flat(280)            // fast entry beats the red slick
    .oilSlick(160, -1)
    .flat(300)
    .slope(160, -50)
    .fan(100, 150, 500, 3.0, 60)
    .water(400)
    .slope(170, 50)
    .flat(240);
  b.wreckingBall(210, 320, 40, -1.05);
  b.flat(430)
    .hill(350, 85)
    .flat(430);
  return b.finish({
    name: '8. Storm Drain',
    concept: 'Oil into water into swinging steel. Keep your rhythm.',
    targetTime: 62,
    basePayout: 620,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(360)
    .oilSlick(240, 1)
    .flat(300);
  b.wreckingBall(260, 330, 42, -0.95); // guards the way to the service ramp
  b.flat(520)
    .slope(300, -170, 8)  // service ramp to the high steel
    .ramp(130, 50, 250)
    .roof(430)
    .gap(250);
  b.roof(500);            // no hazards at the landing — you can't stop mid-jump
  b.fan(90, 150, 320, 2.6, 60);      // fan alone carries the flat jump — a ramp
  b.gap(280);                        // here overshoots into the canal below
  b.roof(400)
    .drop(180)
    .flat(520)            // full run-up — the canal below demands real speed
    .slope(150, -45)
    .water(280)
    .slope(160, 45)
    .flat(430);
  return b.finish({
    name: '9. High Steel',
    concept: 'Rooftops with wrecking balls and wind. Do not look down — there is water.',
    targetTime: 68,
    basePayout: 640,
    recommended: 'sports',
    friction: 0.95,
  });
}

function city10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(340)
    .oilSlick(220, 1)
    .flat(300);
  b.press(160, 100, 175, 3.4, 0.15);
  b.flat(520);
  b.wreckingBall(230, 330, 42, 1.0);
  b.flat(460)
    .slope(150, -45)
    .water(320)
    .slope(160, 45)
    .flat(250)
    .craneLift(210, 240)
    .ramp(120, 45, 260)
    .roof(420)
    .fan(60, 130, 420, 2.8, 220) // vent catches undershot jumps
    .gap(240)
    .roof(400)
    .drop(170)
    .flat(320)            // room to rebuild speed after the drop — red slick ahead
    .oilSlick(160, -1)
    .flat(300);
  b.press(170, 100, 170, 3.3, 0.5);
  b.flat(480)
    .slope(160, -55)
    .gap(300, 55)
    .slope(220, 75)
    .hills(2, 360, 90)
    .flat(500);
  return b.finish({
    name: '10. City Limits',
    concept: 'Everything the city has, back to back. Prove you belong downtown.',
    targetTime: 90,
    basePayout: 700,
    recommended: 'sports',
    friction: 0.95,
  });
}

// --- Mines (World 4) ---------------------------------------------------------
// Long lantern-lit tunnels, harder than the City: expected player state is
// engine tier 3 (or maxed). New hazards: crumbling plank bridges (outrun the
// collapse), rockfall pits (time the boulder), ice strips (no drive, no
// brakes), molten lava/acid pools (touch = death), jump holes (thread the
// slot under a stalactite), and bouncy tire stacks (trampoline up ledges).

function mines1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hills(2, 420, 55)
    .flat(250)
    .crumbleBridge(260)
    .flat(400)
    .hill(380, 65)
    .flat(250)
    .crumbleBridge(320)
    .flat(350)
    .hills(2, 400, 60)
    .flat(450);
  return b.finish({
    name: '1. Timber Line',
    concept: 'Old mine planks give way a moment after you touch them. Never stop on a bridge.',
    targetTime: 46,
    basePayout: 560,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(500)
    .hill(380, 55)
    .flat(320)
    .rockfallPit(180)
    .slope(160, -45)
    .flat(300)
    .rockfallPit(190, { phase: 0.5 })
    .slope(160, -45)
    .flat(330)
    .hill(360, 65)
    .flat(300)
    .rockfallPit(200, { phase: 0.25 })
    .slope(160, -45)
    .flat(480);
  return b.finish({
    name: '2. Rockfall Alley',
    concept: 'Boulders drop from the ceiling chutes. Let one fall, then punch it across.',
    targetTime: 52,
    basePayout: 580,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(480)
    .icePatch(300)
    .flat(320)
    .hill(360, 60)
    .flat(140)
    .icePatch(320)
    .flat(280)
    .slope(160, -45)
    .gap(230, 50)
    .slope(200, 65)
    .flat(180)
    .icePatch(300)     // runs right to the pit lip — set your speed early
    .gap(210, 45)
    .slope(200, 60)
    .flat(480);
  return b.finish({
    name: '3. Frozen Seam',
    concept: 'Frozen groundwater: no grip, no brakes, no gas. Pick your speed BEFORE the ice.',
    targetTime: 50,
    basePayout: 600,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(480)
    .slope(150, -35)
    .moltenPit(250)
    .slope(150, -35)
    .flat(320)
    .hill(340, 60)
    .flat(260)
    .slope(150, -35)
    .moltenPit(280)
    .slope(160, -35)
    .flat(380)
    .slope(170, -35)
    .moltenPit(300)
    .slope(180, -35)
    .flat(480);
  return b.finish({
    name: '4. Molten Vein',
    concept: 'Water forgives a skim — lava does not. Clear every pool clean.',
    targetTime: 52,
    basePayout: 620,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(550)
    .jumpHole(200, 150)
    .flat(560)
    .jumpHole(210, 138)
    .flat(560)
    .jumpHole(220, 126)
    .flat(420)
    .hill(340, 55)
    .flat(420);
  return b.finish({
    name: '5. The Needle\'s Eye',
    concept: 'The tunnel pinches shut. Jump the slot flat and fast — no showboating.',
    targetTime: 54,
    basePayout: 640,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hill(380, 55)
    .flat(250)
    .drop(150)          // down into the tire yard
    .tireStack(240)
    .flat(360)
    .drop(-280)         // sheer ledge — bounce up it
    .flat(420)
    .drop(130)
    .flat(300)
    .drop(170)
    .tireStack(240)
    .flat(360)
    .drop(-320)
    .flat(400)
    .drop(150)
    .flat(480);
  return b.finish({
    name: '6. The Tire Yard',
    concept: 'Fall onto the tire stacks — each bounce throws you higher. Ride them up the ledges.',
    targetTime: 58,
    basePayout: 660,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420)
    .hill(360, 60)
    .flat(220)
    .crumbleBridge(300)
    .flat(560)
    .rockfallPit(190)
    .slope(160, -45)
    .flat(360)
    .icePatch(300)
    .flat(220)
    .slope(160, -45)
    .gap(240, 50)
    .slope(200, 65)
    .flat(650)          // jump landing needs braking room before the chute
    .rockfallPit(200, { phase: 0.4 })
    .slope(160, -45)
    .flat(300)
    .crumbleBridge(340)
    .flat(460);
  return b.finish({
    name: '7. Cave-In',
    concept: 'Falling rock, breaking planks and black ice. The mine wants you buried.',
    targetTime: 62,
    basePayout: 680,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines8() {
  const b = new LevelBuilder(0, GROUND_Y);
  // Ordering matters here: jump holes come off long clean flats, never right
  // after a molten-pit landing — a hard landing floats the car for ~500px at
  // exactly tooth height. Molten pits also enter from FLAT road (their dy is
  // the fall budget); an up-lip launches fast cars sky-high.
  b.flat(560)
    .jumpHole(200, 140)
    .flat(560)
    .moltenPit(260, 'acid')
    .slope(150, -35)
    .flat(460)
    .drop(160)
    .tireStack(240)
    .flat(360)
    .drop(-300)
    .flat(400)
    .drop(140)
    .flat(640)
    .jumpHole(210, 130)
    .flat(520)
    .moltenPit(250, 'acid')
    .slope(160, -35)
    .flat(520);
  return b.finish({
    name: '8. Acid Bath',
    concept: 'Tailing ponds went bad down here. Bounce high, jump tight, touch nothing green.',
    targetTime: 64,
    basePayout: 700,
    recommended: 'pickup',
    friction: 0.9,
  });
}

function mines9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(400)
    .hills(2, 380, 65)
    .flat(220)
    .crumbleBridge(320)
    .flat(320)
    .rockfallPit(190)
    .slope(160, -45)
    .flat(360)
    .icePatch(320)
    .flat(260)
    .slope(150, -35)
    .moltenPit(280)
    .slope(160, -35)
    .flat(360)
    .jumpHole(220, 138)
    .flat(480)
    .hill(360, 65)
    .flat(300)
    .rockfallPit(200, { phase: 0.5 })
    .slope(160, -45)
    .flat(320)
    .icePatch(280)
    .gap(210, 45)
    .slope(200, 60)
    .flat(320)
    .crumbleBridge(300)
    .flat(480);
  return b.finish({
    name: '9. The Deep Seam',
    concept: 'The long way down: every hazard the mine has, one after another.',
    targetTime: 80,
    basePayout: 720,
    recommended: 'sports',
    friction: 0.9,
  });
}

function mines10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(380)
    .crumbleBridge(280)
    .flat(620)          // bot/humans brake for the chute here — keep the
    .rockfallPit(190)   // collapsed bridge well behind the stopping zone
    .slope(160, -45)
    .flat(320)
    .icePatch(300)
    .flat(300)
    .moltenPit(280)     // flat entry — see the note in mines8
    .slope(160, -35)
    .flat(440)
    .jumpHole(215, 132)
    .flat(420)
    .drop(160)
    .tireStack(320)     // deep enough in that a fast entry lands ON it
    .flat(520)
    .drop(-310)         // bounce up to the high gallery
    .flat(380)
    .crumbleBridge(300) // rotten planks with a LONG way down
    .flat(300)
    .drop(150)
    .flat(600)          // braking room after the drop, before the chute
    .rockfallPit(200, { phase: 0.35 })
    .slope(160, -45)
    .flat(760)          // long enough for the pit-landing float to settle
    .slope(140, 30)     // grounded speed-builder into the lip (downhill, no launch)
    .moltenPit(230, 'acid')
    .slope(170, -35)
    .flat(300)
    .icePatch(260)
    .gap(200, 45)
    .slope(190, 60)
    .flat(520);
  return b.finish({
    name: '10. The Motherlode',
    concept: 'Everything the mountain has left. Dig deep and drive out the other side.',
    targetTime: 95,
    basePayout: 780,
    recommended: 'pickup',
    friction: 0.9,
  });
}

// --- Castle (World 5) ----------------------------------------------------------
// Torchlit ramparts, harder than the Mines: expected player state is a maxed
// (or near-maxed) car. New hazards: fireball moats (time the leap), spike
// strips (jump or shred your tires), standing beams (ram at speed — a felled
// beam can bridge a gap), arrow volleys (pass in the lull), and spiked flails
// (short-chain wrecking balls that swing faster). Spacing rules from the
// Mines apply: timing hazards get long braking flats, and crumble bridges
// stay ~1000px clear of anything the bot brakes for.

function castle1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .hills(2, 420, 60)
    .flat(250)
    .crumbleBridge(280)
    .flat(420)
    .hill(380, 70)
    .flat(420)
    .slope(160, -45)
    .gap(240, 50)
    .slope(200, 65)
    .flat(350)
    .crumbleBridge(320)
    .flat(450);
  return b.finish({
    name: '1. The Drawbridge',
    concept: 'The old approach road: rotten planks and a ramp over the dry moat.',
    targetTime: 48,
    basePayout: 640,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle2() {
  const b = new LevelBuilder(0, GROUND_Y);
  // Fireball pits need ~700px of flat approach: the bot (and a human at
  // speed) must fully stop short of the pit edge before the wait-and-go.
  b.flat(700)
    .fireballPit(200)
    .slope(150, -35)
    .flat(720)
    .fireballPit(210, { phase: 0.5 })
    .slope(150, -35)
    .flat(780)
    .fireballPit(200, { phase: 0.25 })
    .slope(160, -35)
    .flat(500);
  return b.finish({
    name: '2. The Fire Moat',
    concept: 'Fireballs leap from the molten moats on a rhythm. Cross while they dive.',
    targetTime: 56,
    basePayout: 660,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle3() {
  const b = new LevelBuilder(0, GROUND_Y);
  // Strips sit right past a ramp lip: the launch clears them and the landing
  // zone falls well beyond (a crest launch instead LANDS on the strip).
  // Strips sit right past a ramp lip: the launch clears them and the landing
  // zone falls well beyond (a crest launch instead LANDS on the strip). Long
  // flats between sections so the landing float settles before the next ramp.
  // ~1050 between ramp sections: a floaty launch can carry ~850 past the
  // lip, and it must never land on the NEXT section's strip.
  b.flat(450)
    .ramp(130, 45)
    .spikeStrip(150, 120)
    .flat(1050)
    .ramp(130, 45)
    .spikeStrip(145, 120)
    .flat(1050)
    .ramp(140, 50)
    .spikeStrip(165, 140)
    .flat(640)
    .hill(340, 60)
    .flat(450);
  return b.finish({
    name: '3. Spike Row',
    concept: 'Caltrop strips shred tires on touch. Pop off the crests and clear them.',
    targetTime: 52,
    basePayout: 680,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(550)
    .beam(300)
    .flat(620)
    .hill(340, 55)
    .flat(220)
    .beam(280)
    .flat(850)
    .beam(160)          // standing just before the gap — fell it to bridge it
    .flat(300)
    .gap(200, 0)
    .flat(500)
    .hills(2, 360, 70)
    .flat(550)
    .beam(160)          // standing just before the gap — fell it to bridge it
    .flat(300)
    .gap(200, 0)
    .flat(450);
  return b.finish({
    name: '4. The Battering Run',
    concept: 'Ram the standing beams at full speed. A felled beam makes a fine bridge.',
    targetTime: 56,
    basePayout: 700,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420)
    .arrowVolley(320)
    .flat(700)
    .hill(360, 60)
    .flat(320)
    .arrowVolley(280, 150, 2.6, 0.5)
    .flat(700)
    .slope(160, -45)
    .gap(240, 50)
    .slope(200, 65)
    .flat(760)
    .arrowVolley(280, 150, 2.6, 0.3)
    .flat(520);
  return b.finish({
    name: '5. Archer Walls',
    concept: 'The murder-holes volley on a cycle. Wait out the rain, then run the gap.',
    targetTime: 58,
    basePayout: 720,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(430)
    .spikyBall(290)
    .flat(560)
    .hill(340, 60)
    .flat(180)
    .spikyBall(280, 270, 36, -1.1)
    .flat(560)
    .slope(150, -40)
    .gap(230, 45)
    .slope(200, 60)
    .flat(650)
    .spikyBall(280)
    .flat(500);
  return b.finish({
    name: '6. The Flail Yard',
    concept: 'Spiked flails on short chains swing FAST. Park close, watch one pass, go.',
    targetTime: 60,
    basePayout: 740,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(450)
    .ramp(130, 45)
    .spikeStrip(150, 120)
    .flat(560)
    .crumbleBridge(300)
    .flat(620)
    .beam(280)
    .flat(540)
    .ramp(130, 45)
    .spikeStrip(150, 125)
    .flat(560)
    .beam(160)
    .flat(320)
    .gap(140, 0)
    .flat(520);
  return b.finish({
    name: '7. The Outer Ward',
    concept: 'Spikes, rotten planks and stubborn timber. Keep your speed up.',
    targetTime: 64,
    basePayout: 760,
    recommended: 'pickup',
    friction: 0.95,
  });
}

function castle8() {
  const b = new LevelBuilder(0, GROUND_Y);
  // The spike-strip ramp goes LAST: its floaty landing zone reaches ~850
  // past the lip and must not overlap a pit or a braking zone.
  b.flat(760)
    .fireballPit(200)
    .slope(150, -35)
    .flat(760)
    .arrowVolley(300, 150, 2.6, 0.25)
    .flat(1000)         // parking corridor: backing off the pit must not
    .fireballPit(210, { phase: 0.5 }) // reverse into the arrow curtain
    .slope(150, -35)
    .flat(760)
    .arrowVolley(280, 150, 2.6, 0.6)
    .flat(680)
    .ramp(140, 50)
    .spikeStrip(180, 130)
    .flat(700)
    .hill(340, 55)
    .flat(450);
  return b.finish({
    name: '8. Gauntlet of Fire',
    concept: 'Fire below, arrows above, spikes between. Timing is everything.',
    targetTime: 68,
    basePayout: 780,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(700)
    .fireballPit(200)
    .slope(150, -35)
    .flat(760)
    .arrowVolley(280)
    .flat(640)
    .ramp(130, 45)
    .spikeStrip(150, 120)
    .flat(560)
    .beam(260)
    .flat(500)
    .crumbleBridge(300)
    .flat(760)
    .spikyBall(280)
    .flat(600)
    .hill(340, 60)
    .flat(700)
    .fireballPit(190, { phase: 0.35 })
    .slope(160, -35)
    .flat(760)
    .arrowVolley(270, 150, 2.6, 0.5)
    .flat(540);
  return b.finish({
    name: '9. The Inner Bailey',
    concept: 'Every defense the garrison has, wall after wall.',
    targetTime: 85,
    basePayout: 800,
    recommended: 'sports',
    friction: 0.95,
  });
}

function castle10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(420)
    .crumbleBridge(280)
    .flat(760)
    .spikyBall(300)
    .flat(700)
    .fireballPit(200)
    .slope(150, -35)
    .flat(760)
    .arrowVolley(280)
    .flat(640)
    .ramp(130, 45)
    .spikeStrip(150, 125)
    .flat(560)
    .beam(170)
    .flat(300)
    .gap(220, 0)
    .flat(480)
    .hill(340, 60)
    .flat(700)
    .fireballPit(190, { phase: 0.5 })
    .slope(160, -35)
    .flat(680)
    .spikyBall(290, 270, 36, -1.05)
    .flat(760)
    .arrowVolley(280, 150, 2.6, 0.35)
    .flat(560);
  return b.finish({
    name: '10. The Throne Gauntlet',
    concept: 'The keep itself. Fire, steel and arrows between you and the crown.',
    targetTime: 100,
    basePayout: 850,
    recommended: 'sports',
    friction: 0.95,
  });
}

// --- Factory (World 6) ---------------------------------------------------
// Sprawling machine floor, harder than the Castle: expected player state is
// a heavily upgraded (near-maxed or maxed) car — these levels run long and
// tall, with big gaps that need real speed. New hazards: pneumatic
// compactors (oversized presses), conveyor belts (push with/against you),
// falling scrap (dodge the drop), drivable pipes (interior only renders
// while you're inside), sludge vats (a fill/drain corrosion bar, not
// instant death), ground springs (hard vertical launch on contact),
// spinning blades (continuous — pure timing) and elevators that lower
// instead of raise. Reuses plenty of the usual cast too: conveyors and
// compactors sit alongside oil, presses, wrecking balls, fans, crane
// lifts, rockfall-style timing, tire stacks and acid (molten 'acid') pools.

function factory1() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(650)
    .conveyor(280, 6)
    .flat(480)
    .conveyor(240, -5)
    .flat(560);
  b.compactor(260, 180, 250, 4.0, 0);
  b.flat(760)
    .hills(2, 480, 70)
    .flat(300)
    .slope(220, -110, 8)
    .gap(380, 60)
    .slope(260, 110)
    .flat(500)
    .conveyor(300, 7)
    .flat(560)
    .hills(2, 520, 90)
    .flat(700);
  return b.finish({
    name: '1. The Loading Dock',
    concept: 'Welcome to the Factory: conveyor belts, a compactor, and your first big jump.',
    targetTime: 78,
    basePayout: 700,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory2() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(700)
    .oilSlick(260, 1)
    .flat(560)
    .fallingScrap(260, { count: 3, period: 2.6 })
    .flat(760)
    .conveyor(260, 5)
    .flat(500)
    .hills(2, 460, 80)
    .flat(300)
    .fallingScrap(300, { count: 4, period: 2.8, phase: 0.3 })
    .flat(820)
    .conveyor(240, -6)
    .flat(560)
    .slope(200, -90)
    .gap(320, 55)
    .slope(230, 90)
    .flat(600)
    .fallingScrap(280, { count: 3, period: 2.4, phase: 0.5 })
    .flat(700);
  return b.finish({
    name: '2. Scrap Line',
    concept: 'Scrap metal rains from the chutes above. Watch a fall clear, then punch it across.',
    targetTime: 82,
    basePayout: 720,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory3() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(750)
    .slope(160, -35)
    .moltenPit(280, 'acid')
    .slope(160, -35)
    .flat(700);
  b.spring(280, 120, 20);
  b.flat(560)
    .slope(150, -35)
    .moltenPit(340, 'acid')
    .slope(170, -35)
    .flat(760)
    .hills(2, 480, 80)
    .flat(400);
  b.spring(260, 120, 21);
  b.flat(600)
    .slope(160, -35)
    .moltenPit(380, 'acid', 90)
    .slope(180, -35)
    .flat(700);
  return b.finish({
    name: '3. Acid Alley',
    concept: 'Acid pools eat anything that touches them. Ground springs give you extra hang time.',
    targetTime: 86,
    basePayout: 740,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory4() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(700)
    .conveyor(260, 5)
    .flat(560);
  b.pipeStart(100)
    .flat(500)
    .slope(300, -140, 8)
    .flat(400);
  b.pipeEnd();
  b.slope(200, -60)
    .gap(340, 40)
    .slope(220, 20);
  b.pipeStart(110)
    .flat(700);
  b.pipeEnd();
  b.slope(240, 180, 8)
    .flat(500)
    .hills(2, 460, 80)
    .flat(400)
    .conveyor(280, -6)
    .flat(600)
    .slope(200, -90)
    .gap(360, 60)
    .slope(240, 90)
    .flat(700);
  return b.finish({
    name: '4. Pipe Works',
    concept: 'Big steel pipes carry the road underground. Launch out of one, land in the next.',
    targetTime: 84,
    basePayout: 760,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory5() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(700);
  b.sludgeVat(650, 140);
  b.flat(700)
    .hills(2, 480, 80)
    .flat(400);
  b.sludgeVat(500, 180);
  b.flat(760)
    .conveyor(260, 5)
    .flat(560)
    .drop(160);
  b.tireStack(240);
  b.flat(400)
    .drop(-320)
    .flat(500);
  b.sludgeVat(600, 180);
  b.flat(700);
  return b.finish({
    name: '5. The Sludge Pits',
    concept: 'Corrosive sludge pools in the dips. A fast splash survives — dawdling melts you.',
    targetTime: 88,
    basePayout: 780,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory6() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(800);
  b.compactor(280, 200, 260, 4.4, 0);
  b.flat(700)
    .hills(2, 460, 70)
    .flat(300);
  b.conveyor(280, 6);
  b.flat(560);
  b.compactor(260, 210, 250, 4.2, 0.3);
  b.flat(700)
    .hills(2, 500, 90)
    .flat(300);
  b.conveyor(260, -5);
  b.flat(600);
  b.compactor(280, 220, 270, 4.6, 0.55);
  b.flat(750)
    .hills(2, 480, 85)
    .flat(700);
  return b.finish({
    name: '6. Compactor Row',
    concept: 'Pneumatic compactors slam on a slow, heavy cycle. Wait for the rise, then floor it.',
    targetTime: 92,
    basePayout: 800,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory7() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(750);
  b.spinBlade(300, { height: 280, omega: 2.8 });
  b.flat(700)
    .hills(2, 460, 70)
    .flat(300);
  b.wreckingBall(260, 340, 44, 1.0);
  b.flat(700)
    .slope(220, -110, 8)
    .gap(400, 60)
    .slope(260, 110)
    .flat(500);
  b.spinBlade(280, { height: 300, omega: 3.2, phase: 1.4 });
  b.flat(750)
    .hills(2, 480, 80)
    .flat(300);
  b.spinBlade(300, { height: 270, omega: 3.4, phase: 2.6 });
  b.flat(700)
    .hills(2, 460, 75)
    .flat(600);
  return b.finish({
    name: '7. The Blade Line',
    concept: 'Rotor blades spin without pause. Park close, watch a full sweep, then thread it.',
    targetTime: 94,
    basePayout: 820,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory8() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(700)
    .hills(2, 480, 70)
    .flat(400);
  b.elevatorDown(220, 320);
  b.flat(700)
    .conveyor(260, 5)
    .flat(560);
  b.elevatorDown(220, 340);
  b.flat(650);
  b.compactor(260, 190, 250, 4.0, 0);
  b.flat(900);
  b.craneLift(220, 300);
  b.ramp(130, 50, 260)
    .roof(500)
    .gap(260)
    .roof(450)
    .drop(200)
    .flat(700)
    .hills(2, 460, 80)
    .flat(700);
  return b.finish({
    name: '8. Down the Shaft',
    concept: 'Two elevators drop you deep below the factory floor before a crane hauls you back up.',
    targetTime: 100,
    basePayout: 840,
    deathY: GROUND_Y + 1300,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory9() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(700)
    .conveyor(260, 6)
    .flat(600);
  b.spring(260, 120, 20);
  b.flat(600)
    .slope(210, -100, 8)
    .gap(380, 50)
    .slope(250, 100)
    .flat(500);
  b.compactor(260, 190, 250, 4.2, 0.2);
  b.flat(700)
    .hills(2, 460, 75)
    .flat(300);
  b.fallingScrap(280, { count: 4, period: 2.6, phase: 0.2 });
  b.flat(760);
  b.spinBlade(280, { height: 280, omega: 3.0, phase: 0.8 });
  b.flat(700)
    .hills(2, 480, 80)
    .flat(300);
  b.sludgeVat(650, 120);
  b.flat(700)
    .hills(2, 460, 80)
    .flat(300)
    .slope(160, -35)
    .moltenPit(320, 'acid')
    .slope(170, -35)
    .flat(700)
    .conveyor(260, -6)
    .flat(600);
  b.spring(240, 120, 20);
  b.flat(700);
  return b.finish({
    name: '9. Assembly Gauntlet',
    concept: 'Every station on the line, back to back. Nothing here forgives hesitation.',
    targetTime: 118,
    basePayout: 860,
    deathY: GROUND_Y + 800,
    recommended: 'sports',
    friction: 0.95,
  });
}

function factory10() {
  const b = new LevelBuilder(0, GROUND_Y);
  b.flat(750)
    .conveyor(280, 6)
    .flat(600);
  b.fallingScrap(300, { count: 4, period: 2.6 });
  b.flat(700)
    .hills(2, 460, 70)
    .flat(300);
  b.compactor(280, 210, 260, 4.4, 0.1);
  b.flat(900);
  b.spinBlade(280, { height: 300, omega: 3.2, phase: 0.4 });
  b.flat(700)
    .hills(2, 480, 75)
    .flat(300);
  b.spring(260, 120, 20);
  b.flat(600)
    .slope(220, -110, 8)
    .gap(420, 60)
    .slope(260, 110)
    .flat(600);
  b.pipeStart(105)
    .flat(500)
    .slope(280, -130, 8)
    .flat(400);
  b.pipeEnd();
  b.slope(200, -60)
    .gap(340, 40)
    .slope(220, 20);
  b.pipeStart(105)
    .flat(650);
  b.pipeEnd();
  b.slope(230, 170, 8)
    .flat(700);
  b.sludgeVat(750, 100);
  b.flat(700)
    .slope(160, -35)
    .moltenPit(360, 'acid')
    .slope(180, -35)
    .flat(750);
  b.elevatorDown(220, 320);
  b.flat(700)
    .conveyor(260, -6)
    .flat(560);
  b.spinBlade(280, { height: 270, omega: 3.4, phase: 1.6 });
  b.flat(750);
  b.compactor(260, 200, 250, 4.2, 0.4);
  b.flat(750)
    .hills(2, 500, 90)
    .flat(700);
  return b.finish({
    name: '10. The Furnace Floor',
    concept: 'The heart of the plant. Presses, blades, acid, sludge and steel pipes — survive it all.',
    targetTime: 155,
    basePayout: 900,
    deathY: GROUND_Y + 1500,
    recommended: 'sports',
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
