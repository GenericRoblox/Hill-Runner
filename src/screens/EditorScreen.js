// Level creator: grid-based terrain painting + obstacle placement on canvas,
// with a DOM toolbar/hotbar overlay (#editor-ui, managed here — the editor is
// a canvas screen, so #menu-root is hidden while it's up).
//
// Terrain mode: paint columns with flat/slope/raise/lower tools and liquids;
// right-drag deletes ground (cuts pits). Obstacle mode: 9-slot hotbar (keys
// 1-9) backed by the full catalog; click places, clicking a placed obstacle
// opens its parameter panel, right-click deletes. The preview is WYSIWYG: the
// compiled level is rebuilt on every edit and rendered with the real
// physics/Obstacles.js set-piece renderer (bodies parked, never stepped).

import { el, screens, showToast } from '../core/ScreenManager.js';
import { getWorld, WORLDS } from '../data/levels.js';
import { texPattern } from '../ui/Textures.js';
import { obstacleIconURL } from '../ui/ObstacleIcons.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Obstacles } from '../physics/Obstacles.js';
import {
  CELL_W, UNIT_H, BASE_Y,
  OBSTACLE_TYPES, getObstacleType, defaultParams, cellsFor, groundHAt,
  getCustomLevel, saveCustomLevel, newCustomLevel, compileCustomLevel,
} from '../data/customLevels.js';

const HOTBAR_KEY = 'hillrunner_editor_hotbar_v1';
const DEFAULT_HOTBAR = ['ramp', 'seesaw', 'bumps', 'tree', 'oil', 'ball', 'press', 'fan', 'spikes'];

// Terrain hotbar tools. Slope rates are height units per column: gentle ≈12°,
// normal ≈23°, steep ≈37° (the friction limit is ~40°, so steep stays drivable).
const TERRAIN_TOOLS = [
  { kind: 'flat', name: 'Flat', icon: '➖' },
  { kind: 'slope', rate: 0.5, name: 'Gentle Up', icon: '↗' },
  { kind: 'slope', rate: 1, name: 'Slope Up', icon: '⬈' },
  { kind: 'slope', rate: 1.8, name: 'Steep Up', icon: '🔺' },
  { kind: 'slope', rate: -0.5, name: 'Gentle Down', icon: '↘' },
  { kind: 'slope', rate: -1, name: 'Slope Down', icon: '⬊' },
  { kind: 'slope', rate: -1.8, name: 'Steep Down', icon: '🔻' },
  { kind: 'raise', dir: 1, name: 'Raise', icon: '⏫' },
  { kind: 'raise', dir: -1, name: 'Lower', icon: '⏬' },
  { kind: 'liquid', liquid: 'water', name: 'Water', icon: '💧' },
  { kind: 'liquid', liquid: 'acid', name: 'Acid', icon: '🧪' },
  { kind: 'liquid', liquid: 'lava', name: 'Lava', icon: '🔥' },
  { kind: 'liquid', liquid: 'sludge', name: 'Sludge', icon: '🥣' },
  { kind: 'surface', surf: 'mud', name: 'Mud', icon: '🟫' },
  { kind: 'surface', surf: 'ice', name: 'Ice', icon: '🧊' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class EditorScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.usesCanvas = true;
    this.active = () => screens.currentName === 'editor';

    // Canvas mouse interactions (guarded so they only act while the editor
    // is the current screen). Move/up live on window so strokes that end
    // over the DOM toolbar still finish cleanly.
    canvas.addEventListener('mousedown', (e) => { if (this.active()) this._down(e); });
    window.addEventListener('mousemove', (e) => { if (this.active()) this._move(e); });
    window.addEventListener('mouseup', (e) => { if (this.active()) this._up(e); });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active()) return;
      e.preventDefault();
      this._wheel(e);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => { if (this.active()) e.preventDefault(); });
  }

  enter({ id, cam } = {}) {
    this.lvl = (id && getCustomLevel(id)) || newCustomLevel();
    this.mode = 'terrain';
    this.toolIndex = 0;                 // terrain hotbar selection
    this.slot = 0;                      // obstacle hotbar selection
    this.hotbar = this._loadHotbar();
    this.selected = null;               // placed obstacle being parameter-edited
    this.stroke = null;                 // active terrain paint stroke
    this.pan = null;                    // active middle-drag pan
    this.mouse = { x: 0, y: 0, cell: -1, row: 0, inWorld: false };
    this._held = new Set();             // pan keys currently held

    // Camera: cam/zoom are the smoothed values used for rendering and input
    // mapping; tx/ty/tzoom are targets that wheel/keys move (update() eases
    // toward them). Middle-drag writes both for a 1:1 feel.
    this.zoom = this.tzoom = 0.8;
    this.camX = this.tx = cam != null ? +cam : -60; // cam: dev deep-link starting scroll
    this.camY = this.ty = BASE_Y - (this.canvas.height / this.zoom) * 0.62;

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

  // --- Persistence / actions ---

  _loadHotbar() {
    try {
      const h = JSON.parse(localStorage.getItem(HOTBAR_KEY));
      if (Array.isArray(h) && h.length === 9 && h.every(id => getObstacleType(id))) return h;
    } catch { /* fall through */ }
    return [...DEFAULT_HOTBAR];
  }

  _saveHotbar() {
    try { localStorage.setItem(HOTBAR_KEY, JSON.stringify(this.hotbar)); } catch { /* best effort */ }
  }

  _save(silent = false) {
    saveCustomLevel(this.lvl);
    if (!silent) showToast('💾 Level saved!');
  }

  _test() {
    this._save(true);
    screens.show('game', {
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
    this._confirm('Reset level?', 'All terrain and obstacles will be cleared.', () => {
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

  // --- Mouse ---

  _down(e) {
    if (e.button === 1) { // middle: pan
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY, camX: this.camX, camY: this.camY };
      return;
    }
    const w = this._toWorld(e);
    const cell = this._cellAt(w.x);
    // Keep hover state in sync even if no mousemove preceded this click
    // (placement and ghosting both read this.mouse).
    this.mouse = { x: w.x, y: w.y, cell, row: this._rowAt(w.y), inWorld: true };
    if (cell < 0 || cell >= this.lvl.length) return;

    if (this.mode === 'terrain') {
      if (e.button === 0) {
        const tool = TERRAIN_TOOLS[this.toolIndex];
        const c = this.lvl.cells[cell];
        const anchorH = (c && c.h != null) ? c.h : groundHAt(this.lvl.cells, cell);
        this.stroke = { tool, anchorCell: cell, anchorH, lastCell: null, painted: new Set() };
        this._paintTo(cell);
      } else if (e.button === 2) {
        this.stroke = { tool: { kind: 'delete' }, lastCell: null, painted: new Set() };
        this._paintTo(cell);
      }
    } else {
      const hit = this._obstacleAt(w.x, w.y);
      if (e.button === 2) {
        if (hit) {
          this.lvl.obstacles.splice(this.lvl.obstacles.indexOf(hit), 1);
          if (this.selected === hit) this._closeParams();
          this.dirty = true;
        }
        return;
      }
      if (e.button !== 0) return;
      if (hit) { this._openParams(hit); return; }
      this._closeParams();
      const place = this._placement();
      if (place) {
        const ob = { type: place.t.id, cell: place.cell, h: place.h, params: defaultParams(place.t) };
        this.lvl.obstacles.push(ob);
        this.dirty = true;
      }
    }
  }

  _move(e) {
    if (this.pan) {
      // Drag pan is 1:1 — write the smoothed values and targets together.
      this.camX = this.tx = this.pan.camX - (e.clientX - this.pan.x) / this.zoom;
      this.camY = this.ty = this.pan.camY - (e.clientY - this.pan.y) / this.zoom;
      return;
    }
    const w = this._toWorld(e);
    this.mouse = {
      x: w.x, y: w.y,
      cell: this._cellAt(w.x),
      row: this._rowAt(w.y),
      inWorld: e.target === this.canvas,
    };
    if (this.stroke) this._paintTo(this.mouse.cell);
  }

  _up() {
    this.stroke = null;
    this.pan = null;
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
  // `cell` (fast mouse moves must not skip columns).
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
      case 'delete':
        c.h = null;
        delete c.liquid; delete c.s;
        break;
    }
  }

  // --- Obstacle placement helpers ---

  // Footprint (in cells), left-edge cell, and anchor row for placing the
  // selected hotbar obstacle centered on the hovered grid point. Obstacles
  // anchor to any height line, not just the ground.
  _placement() {
    const t = getObstacleType(this.hotbar[this.slot]);
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
    if (k >= '1' && k <= '9') {
      const i = +k - 1;
      if (this.mode === 'terrain') { if (i < TERRAIN_TOOLS.length) this.toolIndex = i; }
      else this.slot = i;
      this._refreshHotbar();
    } else if (k === 't') {
      this._setMode(this.mode === 'terrain' ? 'obstacle' : 'terrain');
    } else if (k === 'escape') {
      // Close an open modal or the params panel first; only a bare Escape exits.
      const modal = this.ui?.querySelector('.overlay');
      if (modal) modal.remove();
      else if (this.selected) this._closeParams();
      else this._exitToList();
    } else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
      this._held.add(k); // continuous pan applied in update()
    }
  }

  _exitToList() {
    this._save(true);
    screens.show('customlevels');
  }

  // --- DOM UI ---

  _buildUI() {
    this.ui = el('div', { id: 'editor-ui' });

    // Left toolbar
    const left = el('div', { class: 'ed-left' });
    this.modeBtns = {};
    const addBtn = (icon, label, title, onclick, cls = '') => {
      const b = el('button', { class: `ed-btn ${cls}`, title, onclick });
      b.appendChild(el('span', { class: 'ic', text: icon }));
      b.appendChild(el('span', { class: 'nm', text: label }));
      left.appendChild(b);
      return b;
    };
    this.modeBtns.terrain = addBtn('⛰️', 'Terrain', 'Terrain & liquids (T)', () => this._setMode('terrain'));
    this.modeBtns.obstacle = addBtn('🚧', 'Obstacles', 'Obstacles (T)', () => this._setMode('obstacle'));
    left.appendChild(el('div', { class: 'ed-sep' }));
    addBtn('🎨', 'Theme', 'Level theme', () => this._themeModal());
    addBtn('⚙️', 'Settings', 'Name, length & target time', () => this._settingsModal());
    left.appendChild(el('div', { class: 'ed-sep' }));
    addBtn('▶️', 'Test', 'Test level', () => this._test(), 'go');
    addBtn('💾', 'Save', 'Save', () => this._save());
    addBtn('♻️', 'Reset', 'Reset level', () => this._reset());
    addBtn('🚪', 'Exit', 'Save & exit', () => this._exitToList());
    this.ui.appendChild(left);

    // Top hotbar
    this.hotbarEl = el('div', { class: 'ed-hotbar' });
    this.ui.appendChild(this.hotbarEl);

    // Parameter panel (hidden until an obstacle is selected)
    this.paramsEl = el('div', { class: 'ed-params hidden' });
    this.ui.appendChild(this.paramsEl);

    // Hint bar
    this.ui.appendChild(el('div', {
      class: 'ed-hint',
      text: 'Click/drag to build · right-click deletes · wheel scrolls · Ctrl+wheel zooms · middle-drag pans · 1-9 tools · T switches mode',
    }));

    document.body.appendChild(this.ui);
    this._setMode('terrain');
  }

  _setMode(mode) {
    this.mode = mode;
    this._closeParams();
    this._destroyGhost();
    this.modeBtns.terrain.classList.toggle('active', mode === 'terrain');
    this.modeBtns.obstacle.classList.toggle('active', mode === 'obstacle');
    this._refreshHotbar();
  }

  _refreshHotbar() {
    const bar = this.hotbarEl;
    bar.innerHTML = '';
    if (this.mode === 'terrain') {
      TERRAIN_TOOLS.forEach((t, i) => {
        const slot = el('button', {
          class: `ed-slot${i === this.toolIndex ? ' selected' : ''}`,
          title: t.name,
          onclick: () => { this.toolIndex = i; this._refreshHotbar(); },
        });
        if (i < 9) slot.appendChild(el('span', { class: 'num', text: `${i + 1}` }));
        slot.appendChild(el('span', { class: 'ic', text: t.icon }));
        slot.appendChild(el('span', { class: 'nm', text: t.name }));
        bar.appendChild(slot);
      });
    } else {
      this.hotbar.forEach((typeId, i) => {
        const t = getObstacleType(typeId);
        const slot = el('button', {
          class: `ed-slot${i === this.slot ? ' selected' : ''}`,
          title: `${t.name} — click a spot in the level to place`,
          onclick: () => { this.slot = i; this._refreshHotbar(); },
        });
        slot.appendChild(el('span', { class: 'num', text: `${i + 1}` }));
        slot.appendChild(iconEl(t));
        slot.appendChild(el('span', { class: 'nm', text: t.name }));
        // Drag an obstacle from the catalog onto a slot to replace it.
        slot.addEventListener('dragover', (e) => e.preventDefault());
        slot.addEventListener('drop', (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/plain');
          if (getObstacleType(id)) {
            this.hotbar[i] = id;
            this.slot = i;
            this._saveHotbar();
            this._refreshHotbar();
          }
        });
        bar.appendChild(slot);
      });
      const more = el('button', {
        class: 'ed-slot more',
        title: 'All obstacles — click or drag one onto a hotbar slot',
        onclick: () => this._catalogModal(),
      });
      more.appendChild(el('span', { class: 'ic', text: '➕' }));
      more.appendChild(el('span', { class: 'nm', text: 'More' }));
      bar.appendChild(more);
    }
  }

  // --- Obstacle parameter panel ---

  _openParams(ob) {
    this.selected = ob;
    const t = getObstacleType(ob.type);
    const p = this.paramsEl;
    p.innerHTML = '';
    p.classList.remove('hidden');
    p.appendChild(el('h3', { text: `${t.icon} ${t.name}` }));
    for (const d of t.params) {
      const val = ob.params[d.key] ?? d.def;
      const row = el('div', { class: 'ed-param' });
      const readout = el('span', { class: 'val', text: fmt(val, d.step) });
      row.appendChild(el('label', { text: d.label }));
      const slider = el('input', {
        type: 'range', min: `${d.min}`, max: `${d.max}`, step: `${d.step}`, value: `${val}`,
      });
      slider.addEventListener('input', () => {
        ob.params[d.key] = parseFloat(slider.value);
        readout.textContent = fmt(ob.params[d.key], d.step);
        this.dirty = true;
      });
      row.appendChild(slider);
      row.appendChild(readout);
      p.appendChild(row);
    }
    const actions = el('div', { class: 'ed-param-actions' });
    actions.appendChild(el('button', {
      class: 'btn small', text: '🗑 Delete',
      onclick: () => {
        this.lvl.obstacles.splice(this.lvl.obstacles.indexOf(ob), 1);
        this._closeParams();
        this.dirty = true;
      },
    }));
    actions.appendChild(el('button', { class: 'btn small primary', text: 'Done', onclick: () => this._closeParams() }));
    p.appendChild(actions);
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
      class: 'btn primary', text: 'Yes, do it',
      onclick: () => { overlay.remove(); onYes(); },
    }));
    panel.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: () => overlay.remove() }));
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

  _catalogModal() {
    const { overlay, panel } = this._modal('Obstacles');
    panel.appendChild(el('div', {
      class: 'stat-line',
      text: `Click (or drag onto a slot) to put an obstacle in hotbar slot ${this.slot + 1}.`,
    }));
    const grid = el('div', { class: 'ed-cat' });
    for (const t of OBSTACLE_TYPES) {
      const b = el('button', {
        class: 'ed-cat-item',
        draggable: 'true',
        title: t.name,
        onclick: () => {
          this.hotbar[this.slot] = t.id;
          this._saveHotbar();
          this._refreshHotbar();
          overlay.remove();
        },
      });
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        overlay.remove(); // reveal the hotbar so the drop target is visible
      });
      b.appendChild(iconEl(t));
      b.appendChild(el('span', { class: 'nm', text: t.name }));
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
          while (this.lvl.cells.length < n) this.lvl.cells.push({ h: 0 });
          this.lvl.cells.length = n;
          this.lvl.length = n;
          this.lvl.obstacles = this.lvl.obstacles.filter(ob => ob.cell < n);
        }
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
    const x0 = Math.max(0, Math.floor(this.camX / CELL_W) * CELL_W);
    const x1 = Math.min(this.lvl.length * CELL_W, this.camX + width / this.zoom);
    const yTop = BASE_Y - 16 * UNIT_H;
    const yBot = BASE_Y + 10 * UNIT_H;

    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += CELL_W) {
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
    }
    for (let y = yTop; y <= yBot; y += UNIT_H) {
      ctx.moveTo(Math.max(0, this.camX), y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

    // Baseline (h = 0)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, this.camX), BASE_Y);
    ctx.lineTo(x1, BASE_Y);
    ctx.stroke();

    // Death line
    ctx.strokeStyle = 'rgba(224, 82, 74, 0.6)';
    ctx.setLineDash([18, 12]);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, this.camX), this.compiled.deathY);
    ctx.lineTo(x1, this.compiled.deathY);
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
    if (!this.mouse.inWorld) return;
    const cell = this.mouse.cell;
    if (cell < 0 || cell >= this.lvl.length) return;

    if (this.mode === 'terrain') {
      const deleting = this.stroke?.tool.kind === 'delete';
      ctx.fillStyle = deleting ? 'rgba(224, 82, 74, 0.25)' : 'rgba(255, 198, 92, 0.22)';
      ctx.fillRect(cell * CELL_W, BASE_Y - 16 * UNIT_H, CELL_W, 26 * UNIT_H);
      return;
    }

    // Selected obstacle outline
    if (this.selected) {
      const f = this._footprint(this.selected);
      ctx.strokeStyle = 'rgba(255, 198, 92, 0.9)';
      ctx.lineWidth = 3 / this.zoom;
      ctx.strokeRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
    }

    // Hovering an existing obstacle: highlight it instead of ghosting.
    const hit = this._obstacleAt(this.mouse.x, this.mouse.y);
    if (hit) {
      const f = this._footprint(hit);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(f.x0, f.top, f.x1 - f.x0, f.bottom - f.top);
      return;
    }

    // Ghost preview of the would-be placement.
    const place = this._placement();
    if (!place) return;
    const gx = place.cell * CELL_W;
    const gw = place.span * CELL_W;
    const gy = BASE_Y - groundHAt(this.lvl.cells, place.cell) * UNIT_H;
    ctx.fillStyle = 'rgba(88, 191, 67, 0.18)';
    ctx.fillRect(gx, gy - 260, gw, 300);
    ctx.strokeStyle = 'rgba(88, 191, 67, 0.7)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.strokeRect(gx, gy - 260, gw, 300);
    ctx.font = `${44 / this.zoom}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(place.t.icon, gx + gw / 2, gy - 100);
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
