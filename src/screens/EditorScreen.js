// Level creator: grid-based terrain painting + obstacle placement on canvas,
// with a DOM chrome overlay (#editor-ui, managed here — the editor is a canvas
// screen, so #menu-root is hidden while it's up).
//
// The interaction model is deliberately flat: ONE tray of tools, always
// visible, with the held tool lifted out of it. There is no hidden mode and no
// configurable hotbar — the old editor had both, and "which mode am I in and
// what is in slot 4" was the single most confusing thing about it. Groups
// (Shape / Paint / Build) only decide which row of tools is showing.
//
// Everything is reachable by touch: Pan and Erase are real tools rather than
// middle-drag and right-click, one finger acts, two fingers pan and pinch.
// Desktop keeps its shortcuts on top of that, not instead of it.
//
// The preview is WYSIWYG: the compiled level is rebuilt on every edit and
// rendered with the real physics/Obstacles.js set-piece renderer (bodies
// parked, never stepped).

import { el, screens, showToast } from '../core/ScreenManager.js';
import { getWorld, WORLDS } from '../data/levels.js';
import { texPattern } from '../ui/Textures.js';
import { obstacleIconURL } from '../ui/ObstacleIcons.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Obstacles } from '../physics/Obstacles.js';
import { saveData } from '../core/SaveData.js';
import { VEHICLES } from '../data/vehicles.js';
import {
  CELL_W, UNIT_H, BASE_Y,
  OBSTACLE_TYPES, getObstacleType, defaultParams, cellsFor, groundHAt,
  getCustomLevel, saveCustomLevel, newCustomLevel, compileCustomLevel,
} from '../data/customLevels.js';

const VEH_KEY = 'hillrunner_editor_veh_v1';
const UNDO_DEPTH = 50;

// Height of the two chrome strips, used to frame the camera on the band of
// canvas the player can actually see. Kept in step with style.css by eye —
// being a few px out just shifts the initial framing slightly.
const CHROME_TOP = 58;
const CHROME_BOTTOM = 152;

// Slope rates are height units per column: gentle ~12 degrees, normal ~23,
// steep ~37 (the friction limit is ~40, so steep stays drivable).
const SHAPE_TOOLS = [
  { id: 'flat',   kind: 'flat',                  name: 'Level',      icon: '▬' },
  { id: 'up',     kind: 'slope', rate: 1,        name: 'Up',         icon: '◢' },
  { id: 'upgent', kind: 'slope', rate: 0.5,      name: 'Gentle Up',  icon: '↗' },
  { id: 'upstep', kind: 'slope', rate: 1.8,      name: 'Steep Up',   icon: '⬈' },
  { id: 'down',   kind: 'slope', rate: -1,       name: 'Down',       icon: '◣' },
  { id: 'dngent', kind: 'slope', rate: -0.5,     name: 'Gentle Down', icon: '↘' },
  { id: 'dnstep', kind: 'slope', rate: -1.8,     name: 'Steep Down', icon: '⬊' },
  { id: 'raise',  kind: 'raise', dir: 1,         name: 'Raise',      icon: '▲' },
  { id: 'lower',  kind: 'raise', dir: -1,        name: 'Lower',      icon: '▼' },
];

const PAINT_TOOLS = [
  { id: 'water',  kind: 'liquid',  liquid: 'water',  name: 'Water',  icon: '💧' },
  { id: 'lava',   kind: 'liquid',  liquid: 'lava',   name: 'Lava',   icon: '🔥' },
  { id: 'acid',   kind: 'liquid',  liquid: 'acid',   name: 'Acid',   icon: '🧪' },
  { id: 'sludge', kind: 'liquid',  liquid: 'sludge', name: 'Sludge', icon: '🥣' },
  { id: 'mud',    kind: 'surface', surf: 'mud',      name: 'Mud',    icon: '🟫' },
  { id: 'ice',    kind: 'surface', surf: 'ice',      name: 'Ice',    icon: '🧊' },
  { id: 'clean',  kind: 'clean',                     name: 'Wipe',   icon: '🧼' },
];

// Always-available tools, pinned beside the group tabs rather than buried in a
// row: these two are what makes the editor usable without a mouse.
const PAN_TOOL = { id: 'pan', kind: 'pan', name: 'Move View', icon: '✋' };
const ERASE_TOOL = { id: 'erase', kind: 'erase', name: 'Erase', icon: '🧽' };

const GROUPS = [
  { id: 'shape', name: 'Shape', icon: '⛰️', tools: SHAPE_TOOLS },
  { id: 'paint', name: 'Paint', icon: '🎨', tools: PAINT_TOOLS },
  { id: 'build', name: 'Build', icon: '🚧', tools: null },   // OBSTACLE_TYPES
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class EditorScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.usesCanvas = true;
    this.active = () => screens.currentName === 'editor';

    // Pointer events throughout, so mouse / touch / pen all take one path.
    // Move and up live on window so a stroke that ends over the chrome (or off
    // the edge of a phone screen) still finishes cleanly.
    canvas.addEventListener('pointerdown', (e) => { if (this.active()) this._ptrDown(e); });
    window.addEventListener('pointermove', (e) => { if (this.active()) this._ptrMove(e); });
    window.addEventListener('pointerup', (e) => { if (this.active()) this._ptrUp(e); });
    window.addEventListener('pointercancel', (e) => { if (this.active()) this._ptrUp(e); });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active()) return;
      e.preventDefault();
      this._wheel(e);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => { if (this.active()) e.preventDefault(); });
  }

  enter({ id, cam } = {}) {
    this.lvl = (id && getCustomLevel(id)) || newCustomLevel();
    this.group = 'shape';
    this.toolId = { shape: 'flat', paint: 'water', build: OBSTACLE_TYPES[0].id };
    this.pinned = null;                 // 'pan' | 'erase' | null (overrides the group tool)
    this.selected = null;               // placed obstacle being parameter-edited
    this.stroke = null;                 // active terrain paint stroke
    this.mouse = { x: 0, y: 0, cell: -1, row: 0, inWorld: false };
    this._held = new Set();             // pan keys currently held
    this._ptrs = new Map();             // live pointers, for pinch/two-finger pan
    this._gesture = null;               // active two-finger pan/zoom
    this._drag = null;                  // active one-finger view drag (Pan tool / middle button)
    this._dragOb = null;                // placed obstacle being repositioned
    this._undo = [];
    this._redo = [];
    this._pendingUndo = false;
    this.testVeh = this._loadVeh();

    // Camera: cam/zoom are the smoothed values used for rendering and input
    // mapping; tx/ty/tzoom are targets that wheel/keys move (update() eases
    // toward them). Drags write both for a 1:1 feel.
    this.zoom = this.tzoom = 0.8;
    this.camX = this.tx = cam != null ? +cam : -60; // cam: dev deep-link starting scroll
    // Frame the ground inside the band BETWEEN the two chrome strips, not the
    // middle of the canvas — on a phone the tray is a fifth of the screen, and
    // centring on the raw canvas puts the road you're editing behind it.
    const band = Math.max(120, this.canvas.height - CHROME_TOP - CHROME_BOTTOM);
    this.camY = this.ty = BASE_Y - (CHROME_TOP + band * 0.62) / this.zoom;

    this.physics = null;
    this.obstacleSet = null;
    this.compiled = null;
    this.dirty = true;
    this._ghostKey = null;

    this._buildUI();
    this._onKey = (e) => this._key(e);
    this._onKeyUp = (e) => this._held.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
  }

  exit() {
    saveCustomLevel(this.lvl); // never lose work on the way out
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    this._teardownPhysics();
    this._destroyGhost();
    this.ui?.remove();
    this.ui = null;
  }

  _teardownPhysics() {
    if (this.obstacleSet) { this.obstacleSet.destroy(); this.obstacleSet = null; }
    if (this.physics) { this.physics.destroy(); this.physics = null; }
  }

  // Recompile + rebuild the parked physics bodies the preview renders from.
  _rebuild() {
    this.dirty = false;
    this._teardownPhysics();
    this.compiled = compileCustomLevel(this.lvl);
    this.physics = new PhysicsWorld();
    this.obstacleSet = new Obstacles(this.compiled, this.physics);
  }

  update(dt = 16.6) {
    // Held-key panning moves the target; the camera eases after it.
    const panSpeed = 1500 * (dt / 1000) / this.zoom;
    if (this._held.has('arrowleft') || this._held.has('a')) this.tx -= panSpeed;
    if (this._held.has('arrowright') || this._held.has('d')) this.tx += panSpeed;
    if (this._held.has('arrowup') || this._held.has('w')) this.ty -= panSpeed;
    if (this._held.has('arrowdown') || this._held.has('s')) this.ty += panSpeed;
    this._clampTargets();

    const a = 1 - Math.exp(-dt / 80);
    this.camX += (this.tx - this.camX) * a;
    this.camY += (this.ty - this.camY) * a;
    this.zoom += (this.tzoom - this.zoom) * a;

    if (this.dirty) this._rebuild();
  }

  _clampTargets() {
    this.tx = clamp(this.tx, -400, this.lvl.length * CELL_W + 400 - this.canvas.width / this.tzoom);
    this.ty = clamp(this.ty, BASE_Y - 1500, BASE_Y + 500);
    this.tzoom = clamp(this.tzoom, 0.3, 1.6);
  }

  // --- Tool selection ---

  // The tool actually in hand: a pinned Pan/Erase wins over the group's tool.
  tool() {
    if (this.pinned === 'pan') return PAN_TOOL;
    if (this.pinned === 'erase') return ERASE_TOOL;
    if (this.group === 'build') return { kind: 'place', id: this.toolId.build };
    const list = this.group === 'shape' ? SHAPE_TOOLS : PAINT_TOOLS;
    return list.find(t => t.id === this.toolId[this.group]) || list[0];
  }

  _selectTool(group, id) {
    this.pinned = null;
    if (group !== this.group) this._closeParams();
    this.group = group;
    if (id) this.toolId[group] = id;
    this._destroyGhost();
    this._refreshTray();
  }

  _pin(which) {
    this.pinned = this.pinned === which ? null : which;
    this._closeParams();
    this._destroyGhost();
    this._refreshTray();
  }

  // --- Undo ---

  // Snapshot before any mutation. Cheap: a level is a few KB of JSON, and the
  // alternative (a command log) is a lot of machinery for an editor this size.
  _snapshot() {
    this._undo.push(JSON.stringify({ c: this.lvl.cells, o: this.lvl.obstacles, n: this.lvl.length }));
    if (this._undo.length > UNDO_DEPTH) this._undo.shift();
    this._redo.length = 0;
    this._refreshHistory();
  }

  _applyState(json) {
    const s = JSON.parse(json);
    this.lvl.cells = s.c;
    this.lvl.obstacles = s.o;
    this.lvl.length = s.n ?? this.lvl.cells.length;
    this._closeParams();
    this.dirty = true;
    this._refreshHistory();
  }

  _undoStep() {
    if (!this._undo.length) return;
    this._redo.push(JSON.stringify({ c: this.lvl.cells, o: this.lvl.obstacles, n: this.lvl.length }));
    this._applyState(this._undo.pop());
  }

  _redoStep() {
    if (!this._redo.length) return;
    this._undo.push(JSON.stringify({ c: this.lvl.cells, o: this.lvl.obstacles, n: this.lvl.length }));
    this._applyState(this._redo.pop());
  }

  // Undo an edit that is still in flight (the press that made it hasn't ended
  // yet), without leaving it on the redo stack — the player never asked for it.
  _rollback() {
    if (!this._pendingUndo || !this._undo.length) return;
    const st = JSON.parse(this._undo.pop());
    this.lvl.cells = st.c;
    this.lvl.obstacles = st.o;
    this.lvl.length = st.n ?? this.lvl.length;
    this._pendingUndo = false;
    this._closeParams();
    this.dirty = true;
    this._refreshHistory();
  }

  // Snapshot for an edit a pointer press is starting: rollback-able until the
  // press ends.
  _snapshotPending() {
    this._snapshot();
    this._pendingUndo = true;
  }

  // --- Persistence / actions ---

  _loadVeh() {
    const v = localStorage.getItem(VEH_KEY);
    return VEHICLES[v] ? v : saveData.getActiveVehicle();
  }

  _save(silent = false) {
    saveCustomLevel(this.lvl);
    if (!silent) showToast('💾 Level saved!');
  }

  _test() {
    this._save(true);
    screens.show('game', {
      vehId: this.testVeh,
      custom: {
        id: this.lvl.id,
        name: this.lvl.name,
        theme: this.lvl.theme,
        level: compileCustomLevel(this.lvl),
        from: 'editor',
      },
    });
  }

  _reset() {
    this._confirm('Clear the level?', 'All terrain and obstacles go. You can undo this.', () => {
      this._snapshot();
      this.lvl.cells = Array.from({ length: this.lvl.length }, () => ({ h: 0 }));
      this.lvl.obstacles = [];
      this._closeParams();
      this.dirty = true;
    });
  }

  // --- Coordinate helpers ---

  _toWorld(e) {
    return {
      x: e.clientX / this.zoom + this.camX,
      y: e.clientY / this.zoom + this.camY,
    };
  }

  _cellAt(wx) { return Math.floor(wx / CELL_W); }

  // Nearest height-grid line to a world y (obstacles snap to these rows).
  _rowAt(wy) { return clamp(Math.round((BASE_Y - wy) / UNIT_H), -14, 20); }

  // --- Pointer input ---

  _ptrDown(e) {
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Second finger down: this is a pinch, not an edit. Roll back whatever the
    // first finger just did — otherwise every two-finger zoom leaves a stray
    // object or a painted column behind, because the first touch of a pinch is
    // indistinguishable from a tap until the second one lands.
    if (this._ptrs.size === 2) {
      this._rollback();
      this._dragOb = null;
      this.stroke = null;
      this._drag = null;
      const [a, b] = [...this._ptrs.values()];
      this._gesture = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        camX: this.camX, camY: this.camY, zoom: this.zoom,
      };
      return;
    }
    if (this._ptrs.size > 2) return;

    const tool = this.tool();
    // Middle button or the Pan tool: drag the view.
    if (e.button === 1 || tool.kind === 'pan') {
      this._drag = { x: e.clientX, y: e.clientY, camX: this.camX, camY: this.camY };
      return;
    }

    const w = this._toWorld(e);
    const cell = this._cellAt(w.x);
    // Keep hover state in sync even if no move preceded this press (placement
    // and ghosting both read this.mouse, and a touch has no hover at all).
    this.mouse = { x: w.x, y: w.y, cell, row: this._rowAt(w.y), inWorld: true };
    if (cell < 0 || cell >= this.lvl.length) return;

    const erasing = tool.kind === 'erase' || e.button === 2;

    if (erasing) {
      // Erase hits objects first, ground second — you nearly always mean the
      // thing you can see rather than the ground under it.
      const hit = this._obstacleAt(w.x, w.y);
      if (hit) {
        this._snapshotPending();
        this.lvl.obstacles.splice(this.lvl.obstacles.indexOf(hit), 1);
        if (this.selected === hit) this._closeParams();
        this.dirty = true;
        return;
      }
      this._snapshotPending();
      this.stroke = { tool: { kind: 'delete' }, lastCell: null, painted: new Set() };
      this._paintTo(cell);
      return;
    }

    if (this.group === 'build') {
      const hit = this._obstacleAt(w.x, w.y);
      if (hit) {
        // Press on a placed object arms a MOVE. Whether this turns out to be a
        // drag or a tap is decided by whether the pointer actually travels —
        // so one finger can both reposition things and open their settings,
        // with no modifier key and nothing to discover.
        this._dragOb = {
          ob: hit, cell0: hit.cell, h0: hit.h ?? 0,
          cell: this.mouse.cell, row: this.mouse.row, moved: false,
        };
        return;
      }
      this._closeParams();
      const place = this._placement();
      if (place) {
        this._snapshotPending();
        this.lvl.obstacles.push({
          type: place.t.id, cell: place.cell, h: place.h, params: defaultParams(place.t),
        });
        this.dirty = true;
      }
      return;
    }

    // Shape / paint: start a stroke.
    const c = this.lvl.cells[cell];
    const anchorH = (c && c.h != null) ? c.h : groundHAt(this.lvl.cells, cell);
    this._snapshotPending();
    this.stroke = { tool, anchorCell: cell, anchorH, lastCell: null, painted: new Set() };
    this._paintTo(cell);
  }

  _ptrMove(e) {
    if (this._ptrs.has(e.pointerId)) this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._gesture && this._ptrs.size >= 2) {
      const [a, b] = [...this._ptrs.values()];
      const g = this._gesture;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // Zoom about the pinch centre, then pan by however far that centre moved.
      const zoom = clamp(g.zoom * (dist / g.dist), 0.3, 1.6);
      const wx = g.camX + g.mx / g.zoom;
      const wy = g.camY + g.my / g.zoom;
      this.zoom = this.tzoom = zoom;
      this.camX = this.tx = wx - mx / zoom;
      this.camY = this.ty = wy - my / zoom;
      this._clampTargets();
      return;
    }

    // Dragging a placed object: it follows the pointer by whole grid steps.
    if (this._dragOb) {
      const w2 = this._toWorld(e);
      const d = this._dragOb;
      this.mouse = { x: w2.x, y: w2.y, cell: this._cellAt(w2.x), row: this._rowAt(w2.y), inWorld: true };
      const dCell = this.mouse.cell - d.cell;
      const dRow = this.mouse.row - d.row;
      if (!dCell && !dRow) return;
      if (!d.moved) { this._snapshotPending(); d.moved = true; }
      const span = cellsFor(getObstacleType(d.ob.type), { ...defaultParams(getObstacleType(d.ob.type)), ...d.ob.params });
      d.ob.cell = clamp(d.cell0 + dCell, 0, Math.max(0, this.lvl.length - span));
      d.ob.h = clamp(d.h0 + dRow, -14, 20);
      this.dirty = true;
      return;
    }

    if (this._drag) {
      this.camX = this.tx = this._drag.camX - (e.clientX - this._drag.x) / this.zoom;
      this.camY = this.ty = this._drag.camY - (e.clientY - this._drag.y) / this.zoom;
      this._clampTargets();
      return;
    }

    const w = this._toWorld(e);
    this.mouse = {
      x: w.x, y: w.y,
      cell: this._cellAt(w.x),
      row: this._rowAt(w.y),
      // A touch has no hover: keep the ghost alive for the whole press so the
      // placement preview doesn't flicker out from under a dragging finger.
      inWorld: e.pointerType === 'mouse' ? e.target === this.canvas : this._ptrs.size > 0,
    };
    if (this.stroke) this._paintTo(this.mouse.cell);
  }

  _ptrUp(e) {
    this._ptrs.delete(e.pointerId);
    if (this._ptrs.size < 2) this._gesture = null;
    if (this._ptrs.size === 0) {
      // A press on an object that never travelled was a tap: open its settings.
      if (this._dragOb && !this._dragOb.moved) this._openParams(this._dragOb.ob);
      this._dragOb = null;
      this.stroke = null;
      this._drag = null;
      this._pendingUndo = false;   // the press finished: the edit is committed
      if (e.pointerType !== 'mouse') this.mouse.inWorld = false;
    }
  }

  _wheel(e) {
    if (e.ctrlKey) {
      // Zoom around the cursor: retarget cam so the world point under the
      // mouse stays put once the eased zoom settles.
      const mx = e.clientX, my = e.clientY;
      const wx = this.camX + mx / this.zoom;
      const wy = this.camY + my / this.zoom;
      this.tzoom = clamp(this.tzoom * (e.deltaY < 0 ? 1.15 : 0.87), 0.3, 1.6);
      this.tx = wx - mx / this.tzoom;
      this.ty = wy - my / this.tzoom;
    } else if (e.shiftKey) {
      this.ty += e.deltaY / this.zoom;
    } else {
      this.tx += (e.deltaY + e.deltaX) * 1.1 / this.zoom;
    }
    this._clampTargets();
  }

  // Apply the current stroke to every column between the last painted one and
  // `cell` (fast moves must not skip columns).
  _paintTo(cell) {
    const s = this.stroke;
    const from = s.lastCell == null ? cell : s.lastCell + Math.sign(cell - s.lastCell);
    const step = cell >= from ? 1 : -1;
    for (let i = from; step > 0 ? i <= cell : i >= cell; i += step) this._paintCell(i);
    s.lastCell = cell;
    this.dirty = true;
  }

  _paintCell(i) {
    if (i < 0 || i >= this.lvl.length) return;
    const s = this.stroke;
    const c = this.lvl.cells[i] || (this.lvl.cells[i] = { h: 0 });
    const t = s.tool;
    switch (t.kind) {
      case 'flat':
        c.h = s.anchorH;
        delete c.liquid; delete c.s;
        break;
      case 'slope':
        // Height is a line through the stroke anchor: rises to the right for
        // "up" tools regardless of which way the player drags.
        c.h = Math.round((s.anchorH + t.rate * (i - s.anchorCell)) * 10) / 10;
        delete c.liquid; delete c.s;
        break;
      case 'raise':
        if (s.painted.has(i)) return;
        s.painted.add(i);
        if (c.h == null) c.h = groundHAt(this.lvl.cells, i);
        c.h += t.dir;
        break;
      case 'liquid':
        if (c.h == null) c.h = groundHAt(this.lvl.cells, i);
        c.liquid = t.liquid;
        delete c.s;
        break;
      case 'surface':
        if (c.h != null && !c.liquid) c.s = t.surf;
        break;
      case 'clean':
        delete c.liquid; delete c.s;
        break;
      case 'delete':
        c.h = null;
        delete c.liquid; delete c.s;
        break;
    }
  }

  // --- Obstacle placement helpers ---

  // Footprint (in cells), left-edge cell, and anchor row for placing the
  // selected obstacle centred on the hovered grid point. Obstacles anchor to
  // any height line, not just the ground.
  _placement() {
    const t = getObstacleType(this.toolId.build);
    if (!t || this.mouse.cell < 0) return null;
    const span = cellsFor(t, defaultParams(t));
    const cell = clamp(this.mouse.cell - Math.floor(span / 2), 0, Math.max(0, this.lvl.length - span));
    return { t, span, cell, h: this.mouse.row };
  }

  // Selection/hover hit box, sized from the type's visual extents.
  _footprint(ob) {
    const t = getObstacleType(ob.type);
    const p = { ...defaultParams(t), ...ob.params };
    const span = cellsFor(t, p);
    const box = t.box ? t.box(p) : { up: 200, down: 40 };
    const gy = BASE_Y - (ob.h != null ? ob.h : groundHAt(this.lvl.cells, ob.cell)) * UNIT_H;
    return { x0: ob.cell * CELL_W, x1: (ob.cell + span) * CELL_W, top: gy - box.up, bottom: gy + box.down, gy, t };
  }

  _obstacleAt(wx, wy) {
    for (let k = this.lvl.obstacles.length - 1; k >= 0; k--) {
      const ob = this.lvl.obstacles[k];
      const f = this._footprint(ob);
      if (wx >= f.x0 && wx <= f.x1 && wy >= f.top && wy <= f.bottom) return ob;
    }
    return null;
  }

  // --- Placement ghost: a parked mini-world holding just the hovered def,
  // rendered translucent by the real set-piece renderer. Rebuilt only when
  // the type/cell/row changes.
  _ensureGhost(place) {
    const key = `${place.t.id}:${place.cell}:${place.h}`;
    if (this._ghostKey === key) return;
    this._destroyGhost();
    this._ghostKey = key;
    const gy = BASE_Y - place.h * UNIT_H;
    const out = place.t.build(place.cell * CELL_W, gy, defaultParams(place.t));
    this._ghostWalls = out.walls || [];
    this._ghostPhysics = new PhysicsWorld();
    this._ghostSet = new Obstacles(
      { deathY: this.compiled?.deathY ?? BASE_Y + 550, chains: [], obstacles: out.defs || [] },
      this._ghostPhysics,
    );
  }

  _destroyGhost() {
    if (this._ghostSet) { this._ghostSet.destroy(); this._ghostPhysics.destroy(); }
    this._ghostSet = this._ghostPhysics = null;
    this._ghostWalls = [];
    this._ghostKey = null;
  }

  // --- Keyboard ---

  _key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      e.shiftKey ? this._redoStep() : this._undoStep();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this._redoStep(); return; }
    if (k >= '1' && k <= '9') {
      const list = this._groupTools();
      const t = list[+k - 1];
      if (t) this._selectTool(this.group, t.id);
    } else if (k === 'q') {
      const i = GROUPS.findIndex(g => g.id === this.group);
      this._selectTool(GROUPS[(i + 1) % GROUPS.length].id);
    } else if (k === 'e') {
      this._pin('erase');
    } else if (k === ' ') {
      e.preventDefault();
      this._pin('pan');
    } else if (k === 'escape') {
      // Escape backs out of whatever is open — modal, pinned tool, params panel
      // — and stops there. It deliberately does NOT exit the editor: on the web
      // Escape also leaves fullscreen, so a bare Escape would both drop the
      // player out of fullscreen AND close their level in one press. The back
      // arrow in the top bar is the way out.
      const modal = this.ui?.querySelector('.overlay');
      if (modal) modal.remove();
      else if (this.pinned) this._pin(this.pinned);
      else if (this.selected) this._closeParams();
    } else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
      this._held.add(k); // continuous pan applied in update()
    }
  }

  _exitToList() {
    this._save(true);
    screens.show('customlevels');
  }

  // --- DOM UI ---

  _groupTools() {
    return this.group === 'build' ? OBSTACLE_TYPES : GROUPS.find(g => g.id === this.group).tools;
  }

  _buildUI() {
    this.ui = el('div', { id: 'editor-ui' });

    // --- Top bar: what you do TO the level, in the order you do it ---
    const top = el('div', { class: 'ed-top' });

    top.appendChild(el('button', {
      class: 'ed-icon', title: 'Save & close', text: '←',
      onclick: () => this._exitToList(),
    }));

    this.nameBtn = el('button', {
      class: 'ed-name', title: 'Level name, length & target time',
      onclick: () => this._settingsModal(),
    });
    top.appendChild(this.nameBtn);

    this.undoBtn = el('button', {
      class: 'ed-icon', title: 'Undo (Ctrl+Z)', text: '↶', onclick: () => this._undoStep(),
    });
    this.redoBtn = el('button', {
      class: 'ed-icon', title: 'Redo (Ctrl+Shift+Z)', text: '↷', onclick: () => this._redoStep(),
    });
    top.appendChild(this.undoBtn);
    top.appendChild(this.redoBtn);

    top.appendChild(el('button', {
      class: 'ed-icon', title: 'Theme, save, clear', text: '⋯',
      onclick: () => this._moreModal(),
    }));

    // Test vehicle + Test, kept together: the vehicle is a property of the
    // test run, not of the level, and reads that way sitting on the button.
    this.vehBtn = el('button', {
      class: 'ed-veh', title: 'Choose the car to test with',
      onclick: () => this._vehicleModal(),
    });
    top.appendChild(this.vehBtn);
    top.appendChild(el('button', {
      class: 'ed-play', title: 'Test drive this level',
      onclick: () => this._test(),
    }, [el('span', { text: '▶' }), el('span', { class: 'lbl', text: 'Test' })]));

    this.ui.appendChild(top);

    // --- Parameter panel (hidden until an obstacle is selected) ---
    this.paramsEl = el('div', { class: 'ed-params hidden' });
    this.ui.appendChild(this.paramsEl);

    // --- Bottom tray: what you build WITH ---
    const tray = el('div', { class: 'ed-tray' });
    const head = el('div', { class: 'ed-tabs' });
    this.tabEls = {};
    for (const g of GROUPS) {
      const b = el('button', {
        class: 'ed-tab', title: `${g.name} tools (Q cycles)`,
        onclick: () => this._selectTool(g.id),
      }, [el('span', { class: 'ic', text: g.icon }), el('span', { class: 'lbl', text: g.name })]);
      this.tabEls[g.id] = b;
      head.appendChild(b);
    }
    head.appendChild(el('div', { class: 'ed-tabs-gap' }));
    this.panBtn = el('button', {
      class: 'ed-tab pin', title: 'Move the view — drag with one finger (Space)',
      onclick: () => this._pin('pan'),
    }, [el('span', { class: 'ic', text: PAN_TOOL.icon }), el('span', { class: 'lbl', text: 'Move' })]);
    this.eraseBtn = el('button', {
      class: 'ed-tab pin', title: 'Erase ground and objects (E)',
      onclick: () => this._pin('erase'),
    }, [el('span', { class: 'ic', text: ERASE_TOOL.icon }), el('span', { class: 'lbl', text: 'Erase' })]);
    head.appendChild(this.panBtn);
    head.appendChild(this.eraseBtn);
    tray.appendChild(head);

    this.trayRow = el('div', { class: 'ed-row' });
    tray.appendChild(this.trayRow);
    this.ui.appendChild(tray);

    this.hintEl = el('div', { class: 'ed-hint' });
    this.ui.appendChild(this.hintEl);

    document.body.appendChild(this.ui);
    this._refreshTray();
    this._refreshHistory();
    this._refreshName();
    this._refreshVeh();
  }

  _refreshName() {
    this.nameBtn.textContent = this.lvl.name;
  }

  _refreshVeh() {
    const v = VEHICLES[this.testVeh];
    this.vehBtn.innerHTML = '';
    this.vehBtn.appendChild(el('img', { src: v.body.sprite, alt: v.name, draggable: 'false' }));
  }

  _refreshHistory() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this._undo.length;
    this.redoBtn.disabled = !this._redo.length;
  }

  _refreshTray() {
    for (const g of GROUPS) {
      this.tabEls[g.id].classList.toggle('active', !this.pinned && this.group === g.id);
    }
    this.panBtn.classList.toggle('active', this.pinned === 'pan');
    this.eraseBtn.classList.toggle('active', this.pinned === 'erase');

    const row = this.trayRow;
    row.innerHTML = '';
    if (this.pinned) {
      row.appendChild(el('div', {
        class: 'ed-row-note',
        text: this.pinned === 'pan'
          ? 'Drag anywhere to move the view. Pinch to zoom.'
          : 'Tap an object to remove it, or drag across the ground to cut a pit.',
      }));
      this._refreshHint();
      return;
    }

    // 18 obstacle types don't browse well in a one-line scroller, so Build
    // keeps a grid behind an "All" button: the row is the fast path for the
    // handful you reach for, the grid is how you find the one you half-remember.
    if (this.group === 'build') {
      const all = el('button', {
        class: 'ed-tool all', title: 'Browse every obstacle',
        onclick: () => this._catalogModal(),
      });
      all.appendChild(el('span', { class: 'ic', text: '⊞' }));
      all.appendChild(el('span', { class: 'nm', text: 'All' }));
      row.appendChild(all);
    }

    const held = this.group === 'build' ? this.toolId.build : this.toolId[this.group];
    this._groupTools().forEach((t, i) => {
      const isBuild = this.group === 'build';
      const b = el('button', {
        class: `ed-tool${t.id === held ? ' held' : ''}`,
        title: isBuild ? `${t.name} — tap the level to place one` : t.name,
        onclick: () => this._selectTool(this.group, t.id),
      });
      if (i < 9) b.appendChild(el('span', { class: 'num', text: `${i + 1}` }));
      b.appendChild(isBuild ? iconEl(t) : el('span', { class: 'ic', text: t.icon }));
      b.appendChild(el('span', { class: 'nm', text: t.name }));
      row.appendChild(b);
    });
    // Keep the held tool on screen when the row scrolls.
    row.querySelector('.held')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    this._refreshHint();
  }

  // The hint teaches the GESTURE. It doesn't re-label the tool — the tray
  // already does that, and a line that reads "drag across the ground to steep
  // up" is a label doing a sentence's job.
  _refreshHint() {
    const t = this.tool();
    const lower = t.name ? t.name.toLowerCase() : '';
    this.hintEl.textContent =
      t.kind === 'place' ? `Tap to place ${getObstacleType(t.id)?.name ?? 'it'} · drag a placed one to move it, tap to tune it`
      : t.kind === 'pan' ? 'Drag to move the view · pinch or Ctrl+wheel to zoom'
      : t.kind === 'erase' ? 'Tap an object to remove it · drag the ground to cut a pit'
      : t.kind === 'liquid' ? `Drag along the ground to pour ${lower}`
      : t.kind === 'surface' ? `Drag along the ground to lay ${lower}`
      : t.kind === 'clean' ? 'Drag to wipe liquid and surface back off'
      : 'Drag across the ground to shape it';
  }

  // --- Obstacle parameter panel ---

  _openParams(ob) {
    this.selected = ob;
    const t = getObstacleType(ob.type);
    const p = this.paramsEl;
    p.innerHTML = '';
    p.classList.remove('hidden');

    const head = el('div', { class: 'ed-params-head' });
    head.appendChild(el('h3', { text: `${t.icon} ${t.name}` }));
    head.appendChild(el('button', { class: 'ed-icon tiny', text: '✕', title: 'Close', onclick: () => this._closeParams() }));
    p.appendChild(head);

    for (const d of t.params) {
      const val = ob.params[d.key] ?? d.def;
      const row = el('div', { class: 'ed-param' });
      const readout = el('span', { class: 'val', text: fmt(val, d.step) });
      row.appendChild(el('label', { text: d.label }));
      const slider = el('input', {
        type: 'range', min: `${d.min}`, max: `${d.max}`, step: `${d.step}`, value: `${val}`,
      });
      // One undo entry per drag, not per pixel of slider travel.
      slider.addEventListener('pointerdown', () => this._snapshot());
      slider.addEventListener('input', () => {
        ob.params[d.key] = parseFloat(slider.value);
        readout.textContent = fmt(ob.params[d.key], d.step);
        this.dirty = true;
      });
      row.appendChild(slider);
      row.appendChild(readout);
      p.appendChild(row);
    }
    p.appendChild(el('button', {
      class: 'btn small danger', text: '🗑 Remove',
      onclick: () => {
        this._snapshot();
        this.lvl.obstacles.splice(this.lvl.obstacles.indexOf(ob), 1);
        this._closeParams();
        this.dirty = true;
      },
    }));
  }

  _closeParams() {
    this.selected = null;
    if (this.paramsEl) {
      this.paramsEl.classList.add('hidden');
      this.paramsEl.innerHTML = '';
    }
  }

  // --- Modals ---

  _modal(title) {
    const overlay = el('div', { class: 'overlay' });
    const panel = el('div', { class: 'panel ed-modal' });
    panel.appendChild(el('h2', { text: title }));
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    this.ui.appendChild(overlay);
    return { overlay, panel };
  }

  _confirm(title, message, onYes) {
    const { overlay, panel } = this._modal(title);
    panel.appendChild(el('div', { class: 'stat-line', text: message }));
    panel.appendChild(el('button', {
      class: 'btn primary', text: 'Yes, clear it',
      onclick: () => { overlay.remove(); onYes(); },
    }));
    panel.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: () => overlay.remove() }));
  }

  _moreModal() {
    const { overlay, panel } = this._modal('Level');
    const grid = el('div', { class: 'ed-cat' });
    const item = (icon, name, onclick) => {
      const b = el('button', { class: 'ed-cat-item', onclick: () => { overlay.remove(); onclick(); } });
      b.appendChild(el('span', { class: 'ic', text: icon }));
      b.appendChild(el('span', { class: 'nm', text: name }));
      grid.appendChild(b);
    };
    item('🎨', 'Theme', () => this._themeModal());
    item('⚙️', 'Settings', () => this._settingsModal());
    item('💾', 'Save now', () => this._save());
    item('♻️', 'Clear all', () => this._reset());
    panel.appendChild(grid);
  }

  _vehicleModal() {
    const { overlay, panel } = this._modal('Test with');
    panel.appendChild(el('div', {
      class: 'stat-line',
      text: 'Only changes your test drives — your garage pick stays as it is.',
    }));
    const grid = el('div', { class: 'ed-cat veh' });
    for (const v of Object.values(VEHICLES)) {
      const tiers = Object.values(saveData.getVehicleState(v.id).upgrades).reduce((a, b) => a + b, 0);
      const b = el('button', {
        class: `ed-cat-item${v.id === this.testVeh ? ' selected' : ''}`,
        onclick: () => {
          this.testVeh = v.id;
          try { localStorage.setItem(VEH_KEY, v.id); } catch { /* best effort */ }
          this._refreshVeh();
          overlay.remove();
        },
      });
      b.appendChild(el('img', { class: 'veh-thumb', src: v.body.sprite, alt: v.name, draggable: 'false' }));
      b.appendChild(el('span', { class: 'nm', text: v.name }));
      b.appendChild(el('span', { class: 'sub', text: `${tiers}/12 upgrades` }));
      grid.appendChild(b);
    }
    panel.appendChild(grid);
  }

  _catalogModal() {
    const { overlay, panel } = this._modal('Obstacles');
    const grid = el('div', { class: 'ed-cat' });
    for (const t of OBSTACLE_TYPES) {
      const b = el('button', {
        class: `ed-cat-item${t.id === this.toolId.build ? ' selected' : ''}`,
        title: t.name,
        onclick: () => { this._selectTool('build', t.id); overlay.remove(); },
      });
      b.appendChild(iconEl(t));
      b.appendChild(el('span', { class: 'nm', text: t.name }));
      grid.appendChild(b);
    }
    panel.appendChild(grid);
  }

  _themeModal() {
    const { overlay, panel } = this._modal('Level Theme');
    const grid = el('div', { class: 'ed-cat' });
    for (const w of WORLDS) {
      const b = el('button', {
        class: `ed-cat-item${w.id === this.lvl.theme ? ' selected' : ''}`,
        onclick: () => { this.lvl.theme = w.id; this.dirty = true; overlay.remove(); },
      });
      b.appendChild(el('span', { class: 'ic', text: w.icon }));
      b.appendChild(el('span', { class: 'nm', text: w.name }));
      grid.appendChild(b);
    }
    panel.appendChild(grid);
  }

  _settingsModal() {
    const { overlay, panel } = this._modal('Level Settings');

    const field = (label, input) => {
      const row = el('div', { class: 'ed-field' });
      row.appendChild(el('label', { text: label }));
      row.appendChild(input);
      panel.appendChild(row);
      return input;
    };

    const name = field('Name', el('input', { type: 'text', maxlength: '28', value: this.lvl.name }));
    const len = field('Length (columns)', el('input', { type: 'number', min: '30', max: '400', value: `${this.lvl.length}` }));
    const time = field('3-star time (s)', el('input', { type: 'number', min: '10', max: '600', value: `${this.lvl.targetTime}` }));

    panel.appendChild(el('button', {
      class: 'btn primary', text: 'Apply',
      onclick: () => {
        this.lvl.name = name.value.trim() || 'My Level';
        this.lvl.targetTime = clamp(Math.round(+time.value || 60), 10, 600);
        const n = clamp(Math.round(+len.value || this.lvl.length), 30, 400);
        if (n !== this.lvl.length) {
          this._snapshot();
          while (this.lvl.cells.length < n) this.lvl.cells.push({ h: 0 });
          this.lvl.cells.length = n;
          this.lvl.length = n;
          this.lvl.obstacles = this.lvl.obstacles.filter(ob => ob.cell < n);
        }
        this._refreshName();
        this.dirty = true;
        overlay.remove();
      },
    }));
    panel.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: () => overlay.remove() }));
  }

  // --- Rendering ---

  render(ctx) {
    const { width, height } = this.canvas;
    const w = getWorld(this.lvl.theme);

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, w.sky[0]);
    sky.addColorStop(1, w.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    if (!this.compiled) return;

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    this._drawTerrain(ctx, w);
    this._drawWalls(ctx);
    this.obstacleSet.render(ctx, { x: this.camX, y: 0 });
    this._drawMarkers(ctx);
    this.obstacleSet.renderOverlay(ctx);
    this._drawGrid(ctx, width, height);
    this._drawBounds(ctx, width, height);
    this._drawHover(ctx);

    ctx.restore();
  }

  _drawTerrain(ctx, w) {
    // Mirrors GameScreen._drawTerrain (fill + surface stripe), minus buildings.
    const bottom = this.compiled.deathY + 300;
    const tex = w.tex || {};
    const groundPat = tex.ground && texPattern(tex.ground[0], tex.ground[1], tex.ground[2] || 260);
    const stripePat = tex.stripe && texPattern(tex.stripe[0], tex.stripe[1], 140);
    const mudPat = texPattern('mud', '#6b4a2a', 160);
    for (const chain of this.compiled.chains) {
      ctx.beginPath();
      ctx.moveTo(chain[0].x, bottom);
      for (const p of chain) ctx.lineTo(p.x, p.y);
      ctx.lineTo(chain[chain.length - 1].x, bottom);
      ctx.closePath();
      ctx.fillStyle = groundPat || w.groundColor;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < chain.length; i++) {
        const p = chain[i];
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.strokeStyle = chain.surface === 'mud' ? (mudPat || '#4a3520')
        : chain.surface === 'ice' ? '#b9dcea'
        : (stripePat || w.grassColor);
      ctx.stroke();
      if (chain.surface === 'ice') {
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.stroke();
      }
    }
  }

  _drawWalls(ctx) {
    const woodPat = texPattern('wood', '#c9985e', 170);
    for (const wall of this.compiled.walls) {
      ctx.save();
      ctx.translate(wall.cx, wall.cy);
      ctx.fillStyle = woodPat || '#8a6b42';
      ctx.fillRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
      ctx.strokeStyle = '#5e4626';
      ctx.lineWidth = 3;
      ctx.strokeRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
      ctx.restore();
    }
  }

  _groundYAt(x) {
    for (const chain of this.compiled.chains) {
      if (x < chain[0].x || x > chain[chain.length - 1].x) continue;
      for (let i = 0; i < chain.length - 1; i++) {
        if (x >= chain[i].x && x <= chain[i + 1].x) {
          const t = (x - chain[i].x) / Math.max(1, chain[i + 1].x - chain[i].x);
          return chain[i].y + (chain[i + 1].y - chain[i].y) * t;
        }
      }
    }
    return BASE_Y;
  }

  _drawMarkers(ctx) {
    // Start: green flag where the car spawns.
    const sx = this.compiled.startX;
    const sy = this._groundYAt(sx);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 100);
    ctx.stroke();
    ctx.fillStyle = '#58bf43';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 100);
    ctx.lineTo(sx + 44, sy - 86);
    ctx.lineTo(sx, sy - 72);
    ctx.closePath();
    ctx.fill();

    // Finish: checkered flag (same as GameScreen).
    const fx = this.compiled.finishX;
    const fy = this._groundYAt(fx);
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - 110);
    ctx.stroke();
    const fw = 46, fh = 30, cellW = fw / 4;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
        ctx.fillRect(fx + c * cellW, fy - 110 + r * (fh / 2), cellW, fh / 2);
      }
    }
  }

  _drawGrid(ctx, width, height) {
    // Cover the whole visible viewport (clipped to the level's x-span) so the
    // grid never runs out while panning/zooming. BASE_Y is a multiple of
    // UNIT_H, so lines land exactly on the height rows obstacles snap to.
    const endX = this.lvl.length * CELL_W;
    const vx0 = Math.max(0, this.camX);
    const vx1 = Math.min(endX, this.camX + width / this.zoom);
    const vy0 = this.camY;
    const vy1 = this.camY + height / this.zoom;
    if (vx1 <= vx0) return;

    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    for (let x = Math.ceil(vx0 / CELL_W) * CELL_W; x <= vx1; x += CELL_W) {
      ctx.moveTo(x, vy0);
      ctx.lineTo(x, vy1);
    }
    for (let y = Math.floor(vy0 / UNIT_H) * UNIT_H; y <= vy1; y += UNIT_H) {
      ctx.moveTo(vx0, y);
      ctx.lineTo(vx1, y);
    }
    ctx.stroke();

    // Baseline (h = 0)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(vx0, BASE_Y);
    ctx.lineTo(vx1, BASE_Y);
    ctx.stroke();

    // Death line
    ctx.strokeStyle = 'rgba(224, 82, 74, 0.6)';
    ctx.setLineDash([18, 12]);
    ctx.beginPath();
    ctx.moveTo(vx0, this.compiled.deathY);
    ctx.lineTo(vx1, this.compiled.deathY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawBounds(ctx, width, height) {
    // Dim everything outside the level's span.
    const endX = this.lvl.length * CELL_W;
    const viewX0 = this.camX, viewX1 = this.camX + width / this.zoom;
    const viewY0 = this.camY, viewY1 = this.camY + height / this.zoom;
    ctx.fillStyle = 'rgba(20, 16, 30, 0.45)';
    if (viewX0 < 0) ctx.fillRect(viewX0, viewY0, -viewX0, viewY1 - viewY0);
    if (viewX1 > endX) ctx.fillRect(endX, viewY0, viewX1 - endX, viewY1 - viewY0);
  }

  _drawHover(ctx) {
    const tool = this.tool();
    if (tool.kind === 'pan' || !this.mouse.inWorld) {
      this._destroyGhost();
      return;
    }
    const cell = this.mouse.cell;
    if (cell < 0 || cell >= this.lvl.length) {
      this._destroyGhost();
      return;
    }

    if (tool.kind === 'erase') {
      const hit = this._obstacleAt(this.mouse.x, this.mouse.y);
      if (hit) {
        this._destroyGhost();
        const f = this._footprint(hit);
        ctx.fillStyle = 'rgba(224, 82, 74, 0.25)';
        ctx.fillRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
        ctx.strokeStyle = 'rgba(224, 82, 74, 0.95)';
        ctx.lineWidth = 3 / this.zoom;
        ctx.strokeRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
        return;
      }
      this._drawTerrainHover(ctx, cell, { kind: 'delete' });
      return;
    }

    if (tool.kind !== 'place') {
      this._drawTerrainHover(ctx, cell, tool);
      return;
    }

    // Selected obstacle outline
    if (this.selected) {
      const f = this._footprint(this.selected);
      ctx.strokeStyle = 'rgba(255, 198, 92, 0.9)';
      ctx.lineWidth = 3 / this.zoom;
      ctx.strokeRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
    }

    // Being dragged: outline it, and don't ghost a new one underneath.
    if (this._dragOb) {
      this._destroyGhost();
      const f = this._footprint(this._dragOb.ob);
      ctx.fillStyle = 'rgba(255, 198, 92, 0.16)';
      ctx.fillRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
      ctx.strokeStyle = 'rgba(255, 198, 92, 0.95)';
      ctx.lineWidth = 3 / this.zoom;
      ctx.strokeRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
      return;
    }

    // Hovering an existing obstacle: highlight it instead of ghosting.
    const hit = this._obstacleAt(this.mouse.x, this.mouse.y);
    if (hit) {
      this._destroyGhost();
      const f = this._footprint(hit);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
      return;
    }

    // Translucent preview of the would-be placement, drawn by the real
    // set-piece renderer (see _ensureGhost).
    const place = this._placement();
    if (!place) {
      this._destroyGhost();
      return;
    }
    this._ensureGhost(place);
    ctx.save();
    ctx.globalAlpha = 0.55;
    this._ghostSet.render(ctx, { x: 0, y: 0 });
    this._ghostSet.renderOverlay(ctx);
    const woodPat = texPattern('wood', '#c9985e', 170);
    for (const wl of this._ghostWalls) {
      ctx.fillStyle = woodPat || '#8a6b42';
      ctx.fillRect(wl.cx - wl.w / 2, wl.cy - wl.h / 2, wl.w, wl.h);
    }
    ctx.restore();

    // Anchor line marker so the snap row reads clearly.
    const gy = BASE_Y - place.h * UNIT_H;
    ctx.strokeStyle = 'rgba(255, 198, 92, 0.55)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(place.cell * CELL_W - 20, gy);
    ctx.lineTo((place.cell + place.span) * CELL_W + 20, gy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Terrain-mode hover: a translucent preview of what a stroke would produce
  // in the hovered column(s) — new surface line for shaping tools, tinted
  // pool for liquids, tinted stripe for surface paints, red column for erase.
  _drawTerrainHover(ctx, cell, tool) {
    const w = getWorld(this.lvl.theme);
    const X = i => i * CELL_W;
    const Y = h => BASE_Y - h * UNIT_H;
    const cells = this.lvl.cells;
    const c = cells[cell];
    const curH = c && c.h != null ? c.h : groundHAt(cells, cell);
    const t = this.stroke ? this.stroke.tool : tool;

    // Faint column marker (always) — red while erasing.
    const deleting = t.kind === 'delete';
    ctx.fillStyle = deleting ? 'rgba(224, 82, 74, 0.22)' : 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(X(cell), this.camY, CELL_W, this.canvas.height / this.zoom);
    if (this.stroke) return; // while painting, the live terrain IS the preview

    // Ground-shaping tools: ghost surface line + earth fill at the result height.
    const ghostSurface = (pts) => {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y + 130);
      ctx.closePath();
      ctx.fillStyle = w.groundColor;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.strokeStyle = w.grassColor;
      ctx.stroke();
      ctx.restore();
    };

    if (t.kind === 'flat') {
      ghostSurface([{ x: X(cell) - CELL_W, y: Y(curH) }, { x: X(cell + 1) + CELL_W, y: Y(curH) }]);
    } else if (t.kind === 'slope') {
      // Line through the anchor at the tool's rate, previewed over ±2 columns.
      ghostSurface([
        { x: X(cell - 2), y: Y(curH - 2 * t.rate) },
        { x: X(cell + 3), y: Y(curH + 3 * t.rate) },
      ]);
    } else if (t.kind === 'raise') {
      const toH = curH + t.dir;
      ghostSurface([{ x: X(cell), y: Y(toH) }, { x: X(cell + 1), y: Y(toH) }]);
      // Direction arrow
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#ffc65c';
      const ax = X(cell) + CELL_W / 2, ay = Y(Math.max(curH, toH)) - 34;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 14 * t.dir);
      ctx.lineTo(ax - 12, ay + 8 * t.dir);
      ctx.lineTo(ax + 12, ay + 8 * t.dir);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (t.kind === 'liquid') {
      const tints = {
        water: 'rgba(63, 169, 224, 0.45)',
        acid: 'rgba(140, 220, 60, 0.45)',
        lava: 'rgba(255, 110, 40, 0.5)',
        sludge: 'rgba(150, 130, 60, 0.5)',
      };
      ctx.fillStyle = tints[t.liquid];
      ctx.fillRect(X(cell), Y(curH), CELL_W, 120);
    } else if (t.kind === 'surface' || t.kind === 'clean') {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(X(cell), Y(curH));
      ctx.lineTo(X(cell + 1), Y(curH));
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.strokeStyle = t.kind === 'clean' ? w.grassColor
        : t.surf === 'ice' ? '#b9dcea'
        : (texPattern('mud', '#6b4a2a', 160) || '#4a3520');
      ctx.stroke();
      ctx.restore();
    }
  }
}

function fmt(v, step) {
  return step < 1 ? v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : `${Math.round(v)}`;
}

// Icon node for an obstacle type: the real rendered image when available,
// the catalog emoji otherwise.
function iconEl(t) {
  const url = obstacleIconURL(t.id);
  return url
    ? el('img', { class: 'icimg', src: url, alt: t.name, draggable: 'false' })
    : el('span', { class: 'ic', text: t.icon });
}
