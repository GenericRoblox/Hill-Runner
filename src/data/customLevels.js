// Player-created levels: localStorage store, the obstacle catalog the editor
// exposes, and the grid → level-object compiler. Compiled output has the same
// shape LevelBuilder.finish() produces, so Terrain/Obstacles/GameScreen consume
// it unchanged.
//
// Grid model: a level is `length` columns of CELL_W px. Each cell:
//   { h: number|null, s?: 'mud'|'ice', liquid?: 'water'|'acid'|'lava'|'sludge' }
// h is ground height in UNIT_H steps above BASE_Y; null = gap (pit).
// Obstacles: { type, cell, params } anchored at a column (cell = left edge of
// the footprint). Pit-cutting types mask the ground beneath their footprint.

export const CELL_W = 60;   // px per grid column
export const UNIT_H = 25;   // px per height unit
export const BASE_Y = 600;  // h = 0 ground line (matches levels.js GROUND_Y)

const KEY = 'hillrunner_custom_v1';

// --- Store -------------------------------------------------------------------

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}

function persist(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); }
  catch (e) { console.warn('Custom level save failed:', e); }
}

export function listCustomLevels() { return loadAll(); }
export function getCustomLevel(id) { return loadAll().find(l => l.id === id); }

export function saveCustomLevel(lvl) {
  const all = loadAll();
  const i = all.findIndex(l => l.id === lvl.id);
  if (i >= 0) all[i] = lvl; else all.push(lvl);
  persist(all);
}

export function deleteCustomLevel(id) {
  persist(loadAll().filter(l => l.id !== id));
}

export function newCustomLevel() {
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const length = 100;
  return {
    id,
    name: 'My Level',
    theme: 1,          // WORLDS id used for sky/textures/backdrop
    length,            // columns of CELL_W px
    targetTime: 60,    // 3-star time (seconds)
    cells: Array.from({ length }, () => ({ h: 0 })),
    obstacles: [],     // { type, cell, params }
  };
}

// --- Obstacle catalog ----------------------------------------------------------
// Each entry: id/name/icon, editable params (min/max/step/default), span(p) =
// footprint width in px, box(p) = visual extents {up, down} in px around the
// anchor line (selection/hover hit box), pit: true if the footprint carves its
// own gap, and build(x, gy, p) → { defs, walls } where x is the footprint's
// left edge and gy the anchor line. Defs match what LevelBuilder pushes, so
// physics/Obstacles.js builds them verbatim.

const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, def });

export const OBSTACLE_TYPES = [
  {
    id: 'ramp', name: 'Ramp', icon: '📐',
    params: [P('w', 'Width', 100, 320, 10, 170), P('h', 'Height', 40, 150, 5, 80)],
    span: p => p.w,
    box: p => ({ up: p.h + 14, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'ramp', x, y: gy, w: p.w, h: p.h }] }),
  },
  {
    id: 'seesaw', name: 'Seesaw', icon: '⚖️',
    params: [P('length', 'Length', 260, 520, 20, 380)],
    span: p => p.length + 40,
    box: () => ({ up: 90, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'seesaw', cx: x + 20 + p.length / 2, groundY: gy, length: p.length, postH: 55 }] }),
  },
  {
    id: 'bumps', name: 'Speed Bumps', icon: '〰️',
    params: [P('count', 'Count', 2, 8, 1, 4), P('spacing', 'Spacing', 90, 200, 10, 130)],
    span: p => p.count * p.spacing + 60,
    box: () => ({ up: 22, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'bumps', x0: x + 30, groundY: gy, count: p.count, spacing: p.spacing, r: 13 }] }),
  },
  {
    id: 'tree', name: 'Tree', icon: '🌳',
    params: [P('clearance', 'Clearance', 70, 180, 5, 95), P('r', 'Canopy Size', 50, 100, 5, 70)],
    span: p => p.r * 2,
    box: p => ({ up: p.clearance + p.r * 2 + 10, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'tree', x: x + p.r, groundY: gy, clearance: p.clearance, r: p.r }] }),
  },
  {
    id: 'oil', name: 'Oil Slick', icon: '🛢️',
    params: [P('w', 'Width', 120, 400, 20, 200), P('push', 'Direction (+fwd)', -1, 1, 2, 1)],
    span: p => p.w,
    box: () => ({ up: 20, down: 10 }),
    build: (x, gy, p) => ({ defs: [{ type: 'oil', x0: x, groundY: gy, w: p.w, push: p.push >= 0 ? 1 : -1 }] }),
  },
  {
    id: 'ball', name: 'Wrecking Ball', icon: '🏗️',
    params: [P('height', 'Height', 240, 420, 10, 330), P('r', 'Ball Size', 30, 60, 2, 42), P('angle0', 'Swing', 0.5, 1.3, 0.05, 1.0)],
    span: p => 2 * (Math.sin(p.angle0) * (p.height - 14 - p.r) + p.r),
    box: p => ({ up: p.height + 16, down: 8 }),
    build: (x, gy, p) => {
      const len = p.height - 14 - p.r;
      const sweep = Math.sin(p.angle0) * len + p.r;
      return { defs: [{ type: 'ball', ax: x + sweep, ay: gy - p.height, len, r: p.r, angle0: p.angle0 }] };
    },
  },
  {
    id: 'spikyball', name: 'Spiked Flail', icon: '⛓️',
    params: [P('height', 'Height', 180, 320, 10, 270), P('r', 'Ball Size', 24, 48, 2, 36), P('angle0', 'Swing', 0.6, 1.3, 0.05, 1.1)],
    span: p => 2 * (Math.sin(p.angle0) * (p.height - 14 - p.r) + p.r),
    box: p => ({ up: p.height + 16, down: 8 }),
    build: (x, gy, p) => {
      const len = p.height - 14 - p.r;
      const sweep = Math.sin(p.angle0) * len + p.r;
      return { defs: [{ type: 'ball', spiky: true, ax: x + sweep, ay: gy - p.height, len, r: p.r, angle0: p.angle0 }] };
    },
  },
  {
    id: 'press', name: 'Press', icon: '🔨',
    params: [P('w', 'Width', 60, 160, 10, 100), P('clearance', 'Clearance', 120, 260, 5, 175), P('period', 'Period (s)', 2, 6, 0.2, 3.4), P('phase', 'Phase', 0, 1, 0.05, 0)],
    span: p => p.w,
    box: p => ({ up: p.clearance + 95 + 44, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'press', cx: x + p.w / 2, groundY: gy, w: p.w, clearance: p.clearance, period: p.period, phase: p.phase }] }),
  },
  {
    id: 'compactor', name: 'Compactor', icon: '🏭',
    params: [P('w', 'Width', 120, 260, 10, 190), P('clearance', 'Clearance', 180, 340, 10, 260), P('period', 'Period (s)', 2.5, 6, 0.1, 4.2), P('phase', 'Phase', 0, 1, 0.05, 0)],
    span: p => p.w,
    box: p => ({ up: p.clearance + 150 + 44, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'compactor', cx: x + p.w / 2, groundY: gy, w: p.w, clearance: p.clearance, period: p.period, phase: p.phase }] }),
  },
  {
    id: 'fan', name: 'Updraft Fan', icon: '🌀',
    params: [P('w', 'Width', 80, 220, 10, 140), P('h', 'Reach', 300, 600, 20, 460), P('lift', 'Lift', 1.5, 3.5, 0.1, 2.8)],
    span: p => p.w,
    box: p => ({ up: p.h, down: 12 }),
    build: (x, gy, p) => ({ defs: [{ type: 'fan', x, groundY: gy, w: p.w, h: p.h, lift: p.lift, oy: 0 }] }),
  },
  {
    id: 'bouncer', name: 'Tire Stack', icon: '🛞',
    params: [P('w', 'Width', 100, 200, 10, 140)],
    span: p => p.w,
    box: () => ({ up: 74, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'bouncer', x: x + p.w / 2, groundY: gy, w: p.w }] }),
  },
  {
    id: 'spikes', name: 'Spike Strip', icon: '🔺',
    params: [P('w', 'Width', 80, 240, 10, 120)],
    span: p => p.w,
    box: () => ({ up: 30, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'spikes', x0: x, groundY: gy, w: p.w }] }),
  },
  {
    id: 'beam', name: 'Timber Beam', icon: '🪵',
    params: [P('h', 'Height', 200, 420, 10, 300)],
    span: () => CELL_W,
    box: p => ({ up: p.h + 10, down: 8 }),
    build: (x, gy, p) => ({ defs: [{ type: 'beam', x: x + CELL_W / 2, groundY: gy, h: p.h }] }),
  },
  {
    id: 'arrows', name: 'Arrow Volley', icon: '🏹',
    params: [P('w', 'Width', 100, 260, 10, 150), P('period', 'Period (s)', 1.6, 5, 0.1, 2.6), P('phase', 'Phase', 0, 1, 0.05, 0), P('rainFrac', 'Rain Time', 0.2, 0.6, 0.02, 0.36)],
    span: p => p.w,
    box: () => ({ up: 400, down: 8 }), // murder-hole ledge sits 380 above the road
    build: (x, gy, p) => ({ defs: [{ type: 'arrows', x: x + p.w / 2, w: p.w, groundY: gy, period: p.period, phase: p.phase, rainFrac: p.rainFrac }] }),
  },
  {
    id: 'conveyor', name: 'Conveyor', icon: '➡️',
    params: [P('w', 'Width', 180, 600, 20, 300), P('speed', 'Speed (+fwd)', -8, 8, 1, 4)],
    span: p => p.w,
    box: () => ({ up: 26, down: 12 }),
    build: (x, gy, p) => ({ defs: [{ type: 'conveyor', x0: x, groundY: gy, w: p.w, speed: p.speed }] }),
  },
  {
    id: 'spring', name: 'Spring Pad', icon: '🆙',
    params: [P('w', 'Width', 80, 160, 10, 110), P('launchVel', 'Launch Power', 12, 24, 0.5, 19)],
    span: p => p.w,
    box: () => ({ up: 30, down: 10 }),
    build: (x, gy, p) => ({ defs: [{ type: 'spring', x: x + p.w / 2, groundY: gy, w: p.w, launchVel: p.launchVel }] }),
  },
  {
    id: 'blade', name: 'Spin Blade', icon: '⚙️',
    params: [P('height', 'Hub Height', 160, 360, 10, 260), P('omega', 'Spin Speed', 1, 6, 0.2, 3)],
    span: p => p.height * 2 + 30,
    box: p => ({ up: p.height * 2 + 20, down: 8 }), // blade tip sweeps hub height above the hub
    build: (x, gy, p) => {
      const len = p.height * 2 + 30;
      return { defs: [{ type: 'blade', ax: x + len / 2, ay: gy - p.height, groundY: gy, len, thickness: 30, omega: p.omega, phase: 0 }] };
    },
  },
  {
    id: 'wall', name: 'Wall', icon: '🧱',
    params: [P('h', 'Height', 60, 400, 10, 150)],
    span: () => CELL_W,
    box: p => ({ up: p.h + 8, down: 8 }),
    build: (x, gy, p) => ({ walls: [{ cx: x + CELL_W / 2, cy: gy - p.h / 2, w: 28, h: p.h }] }),
  },
  // --- Pit-cutters: the ground beneath their footprint is removed ---
  {
    id: 'ropebridge', name: 'Rope Bridge', icon: '🌉', pit: true,
    params: [P('w', 'Width', 240, 520, 20, 320)],
    span: p => p.w,
    box: () => ({ up: 26, down: 70 }),
    build: (x, gy, p) => ({ defs: [{ type: 'ropebridge', x0: x, y0: gy, width: p.w }] }),
  },
  {
    id: 'crumble', name: 'Crumble Bridge', icon: '🪜', pit: true,
    params: [P('w', 'Width', 220, 520, 20, 300)],
    span: p => p.w,
    box: () => ({ up: 22, down: 60 }),
    build: (x, gy, p) => ({ defs: [{ type: 'crumble', x0: x, y0: gy, width: p.w }] }),
  },
  {
    id: 'rockfall', name: 'Rockfall Pit', icon: '🪨', pit: true,
    params: [P('w', 'Width', 180, 360, 10, 240), P('period', 'Period (s)', 1.5, 5, 0.1, 2.8), P('phase', 'Phase', 0, 1, 0.05, 0), P('r', 'Rock Size', 18, 34, 2, 26)],
    span: p => p.w,
    box: () => ({ up: 220, down: 140 }),
    build: (x, gy, p) => ({ defs: [{ type: 'rockfall', x: x + p.w / 2, groundY: gy, topY: gy - 470, r: p.r, period: p.period, phase: p.phase }] }),
  },
  {
    id: 'jumphole', name: 'Jump Hole', icon: '🦷', pit: true,
    params: [P('w', 'Width', 160, 300, 10, 200), P('clearance', 'Clearance', 110, 200, 5, 140)],
    span: p => p.w,
    box: p => ({ up: p.clearance + 190, down: 140 }),
    build: (x, gy, p) => ({ defs: [{ type: 'stalactite', x: x + p.w / 2, groundY: gy, clearance: p.clearance }] }),
  },
  {
    id: 'fireballpit', name: 'Fireball Pit', icon: '☄️', pit: true,
    params: [P('w', 'Width', 200, 420, 10, 300), P('period', 'Period (s)', 2.5, 6, 0.1, 3.6), P('phase', 'Phase', 0, 1, 0.05, 0)],
    span: p => p.w,
    box: () => ({ up: 140, down: 140 }),
    build: (x, gy, p) => ({
      defs: [
        { type: 'molten', x0: x, y0: gy, w: p.w, drop: 105, kind: 'lava' },
        { type: 'fireball', x: x + p.w / 2, groundY: gy, surfaceY: gy + 105, period: p.period, phase: p.phase, r: 22 },
      ],
    }),
  },
  {
    id: 'scrap', name: 'Falling Scrap', icon: '🗑️', pit: true,
    params: [P('w', 'Width', 200, 420, 20, 300), P('count', 'Chunks', 2, 5, 1, 3), P('period', 'Period (s)', 1.8, 5, 0.1, 2.6), P('phase', 'Phase', 0, 1, 0.05, 0)],
    span: p => p.w,
    box: () => ({ up: 240, down: 140 }),
    build: (x, gy, p) => ({ defs: [{ type: 'scrap', x0: x, w: p.w, groundY: gy, topY: gy - 520, count: p.count, period: p.period, phase: p.phase }] }),
  },
];

const TYPE_MAP = Object.fromEntries(OBSTACLE_TYPES.map(t => [t.id, t]));

export function getObstacleType(id) { return TYPE_MAP[id]; }

export function defaultParams(t) {
  const p = {};
  for (const d of t.params) p[d.key] = d.def;
  return p;
}

export function cellsFor(t, p) {
  return Math.max(1, Math.ceil(t.span(p) / CELL_W));
}

// --- Compiler -----------------------------------------------------------------

// Nearest solid-ground height around column i (for anchoring obstacles/liquids
// placed next to gaps). Falls back to the baseline.
export function groundHAt(cells, i) {
  const ok = c => c && c.h != null && !c.liquid;
  if (ok(cells[i])) return cells[i].h;
  for (let d = 1; d < cells.length; d++) {
    if (ok(cells[i - d])) return cells[i - d].h;
    if (ok(cells[i + d])) return cells[i + d].h;
  }
  return 0;
}

export function compileCustomLevel(lvl) {
  const n = lvl.length;
  const X = i => i * CELL_W;
  const Y = h => BASE_Y - h * UNIT_H;

  // Working copy with start/finish safety: the car spawns at x=150 and the
  // finish flag needs ground beneath it, so those columns are forced solid.
  const cells = lvl.cells.slice(0, n).map(c => ({ ...(c || { h: 0 }) }));
  while (cells.length < n) cells.push({ h: 0 });
  for (const i of [0, 1, 2, 3, n - 2, n - 1]) {
    if (cells[i].h == null) cells[i].h = groundHAt(cells, i);
    delete cells[i].liquid;
  }

  const obstacles = [];
  const walls = [];
  const masked = new Array(n).fill(false); // pit-cutter footprints
  for (const ob of lvl.obstacles) {
    const t = TYPE_MAP[ob.type];
    if (!t || ob.cell >= n) continue;
    const p = { ...defaultParams(t), ...ob.params };
    // Free grid placement: ob.h anchors the obstacle at that height line;
    // obstacles without one (older saves) sit on the nearest ground.
    const gy = Y(ob.h != null ? ob.h : groundHAt(cells, ob.cell));
    const out = t.build(X(ob.cell), gy, p);
    if (out.defs) obstacles.push(...out.defs);
    if (out.walls) walls.push(...out.walls);
    if (t.pit) {
      const span = cellsFor(t, p);
      // Keep the forced start/finish columns solid even under a pit footprint.
      for (let i = Math.max(4, ob.cell); i < Math.min(n - 2, ob.cell + span); i++) masked[i] = true;
    }
  }

  const chains = [];
  let lowestY = BASE_Y;
  const ground = i => i >= 0 && i < n && !masked[i] && cells[i].h != null && !cells[i].liquid;

  let i = 0;
  while (i < n) {
    const c = cells[i];
    if (masked[i] || c.h == null) { i++; continue; }

    if (c.liquid === 'water' || c.liquid === 'lava' || c.liquid === 'acid') {
      let j = i;
      while (j < n && !masked[j] && cells[j].h != null && cells[j].liquid === c.liquid) j++;
      const rimY = Y(c.h);
      const w = X(j) - X(i);
      if (c.liquid === 'water') obstacles.push({ type: 'water', x0: X(i), y0: rimY, w, drop: 70 });
      else obstacles.push({ type: 'molten', x0: X(i), y0: rimY, w, drop: 105, kind: c.liquid });
      lowestY = Math.max(lowestY, rimY + 105);
      i = j;
      continue;
    }

    if (c.liquid === 'sludge') {
      // Drivable goo dip: its own chain spanning exactly the run (the sludge
      // render clips the pool to that chain's outline).
      let j = i;
      while (j < n && !masked[j] && cells[j].h != null && cells[j].liquid === 'sludge') j++;
      const rimY = Y(c.h), x0 = X(i), w = X(j) - x0;
      const depth = Math.min(110, Math.max(60, w * 0.28));
      const steps = Math.max(6, Math.round(w / 30));
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const t2 = k / steps;
        pts.push({ x: x0 + w * t2, y: rimY + depth * Math.sin(Math.PI * t2) });
      }
      pts.surface = 'sludge';
      chains.push(pts);
      obstacles.push({ type: 'sludge', x0, y0: rimY, w, depth });
      lowestY = Math.max(lowestY, rimY + depth);
      i = j;
      continue;
    }

    // Ground run with a uniform surface. Interior points sit at column
    // boundaries at the average of the neighbor heights, so constant-rate
    // staircases compile to straight slopes with softened corners.
    const s = c.s;
    let j = i;
    while (j < n && ground(j) && cells[j].s === s) j++;
    const pts = [];
    const startY = ground(i - 1) ? (Y(cells[i - 1].h) + Y(cells[i].h)) / 2 : Y(cells[i].h);
    pts.push({ x: X(i), y: startY });
    for (let k = i + 1; k < j; k++) pts.push({ x: X(k), y: (Y(cells[k - 1].h) + Y(cells[k].h)) / 2 });
    const endY = ground(j) ? (Y(cells[j - 1].h) + Y(cells[j].h)) / 2 : Y(cells[j - 1].h);
    pts.push({ x: X(j), y: endY });
    if (s === 'mud' || s === 'ice') pts.surface = s;
    for (const p of pts) lowestY = Math.max(lowestY, p.y);
    chains.push(pts);
    i = j;
  }

  const startH = groundHAt(cells, 2);
  return {
    chains,
    walls,
    obstacles,
    buildings: [],
    finishX: X(n) - 100,
    deathY: Math.max(BASE_Y + 550, lowestY + 320),
    startX: 150,
    startY: Y(startH) - 80,
    name: lvl.name,
    concept: 'Custom level',
    targetTime: lvl.targetTime || 60,
    basePayout: 0,
    recommended: 'pickup',
    friction: 0.85,
  };
}
