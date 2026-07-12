// Editor hotbar/catalog icons: each obstacle type rendered by the REAL
// physics/Obstacles.js set-piece renderer into a small data-URL image, so the
// picker shows exactly what will appear in the level. Generated lazily once
// per session (cache below); falls back to the catalog emoji on any failure.

import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Obstacles } from '../physics/Obstacles.js';
import { texPattern } from './Textures.js';
import { getObstacleType, defaultParams } from '../data/customLevels.js';

const cache = new Map();

// Sky-high or road-wide set-pieces get compacted defs so the icon isn't a
// thin sliver. Purely cosmetic — placement always uses the real builder.
const TWEAKS = {
  rockfall: defs => { defs[0].topY = -190; },
  scrap: defs => { defs[0].topY = -210; },
  fan: defs => { defs[0].h = 230; },
  bumps: defs => { defs[0].count = 3; defs[0].spacing = 56; },
  oil: defs => { defs[0].w = 110; },
  conveyor: defs => { defs[0].w = 150; },
  ropebridge: defs => { defs[0].width = 190; },
  crumble: defs => { defs[0].width = 170; },
  spikes: defs => { defs[0].w = 90; },
  fireballpit: defs => {
    // Park the fireball mid-leap above the pool so it shows in the icon.
    const f = defs.find(d => d.type === 'fireball');
    if (f) f.surfaceY = -150;
  },
};

// Returns a data-URL for the type's icon, or null (caller shows the emoji).
export function obstacleIconURL(typeId) {
  if (cache.has(typeId)) return cache.get(typeId);
  let url = null;
  try {
    url = generate(getObstacleType(typeId));
  } catch (e) {
    console.warn('obstacle icon failed:', typeId, e);
  }
  cache.set(typeId, url);
  return url;
}

function generate(t) {
  const p = defaultParams(t);
  const box = t.box ? t.box(p) : { up: 200, down: 40 };
  const span = Math.max(40, t.span(p));
  const pad = 30;
  const W = Math.ceil(span + pad * 2);
  const H = Math.ceil(box.up + box.down + pad * 2);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.translate(pad, pad + box.up); // anchor line at local y=0

  const out = t.build(0, 0, p);
  const defs = out.defs || [];
  TWEAKS[t.id]?.(defs);

  if (defs.length) {
    // deathY only affects how deep water/molten pools render — keep it shallow.
    const world = new PhysicsWorld();
    const obs = new Obstacles({ deathY: -100, chains: [], obstacles: defs }, world);
    obs.render(ctx, { x: 0, y: 0 });
    obs.renderOverlay(ctx);
    obs.destroy();
    world.destroy();
  }
  for (const wl of out.walls || []) {
    ctx.fillStyle = texPattern('wood', '#c9985e', 170) || '#8a6b42';
    ctx.fillRect(wl.cx - wl.w / 2, wl.cy - wl.h / 2, wl.w, wl.h);
    ctx.strokeStyle = '#5e4626';
    ctx.lineWidth = 3;
    ctx.strokeRect(wl.cx - wl.w / 2, wl.cy - wl.h / 2, wl.w, wl.h);
  }

  // Auto-crop to drawn pixels, then fit into a square icon.
  const data = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // nothing drawn

  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const S = 56;
  const icon = document.createElement('canvas');
  icon.width = icon.height = S;
  const ictx = icon.getContext('2d');
  const scale = Math.min((S - 4) / cw, (S - 4) / ch, 2.4);
  const dw = cw * scale, dh = ch * scale;
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(cv, x0, y0, cw, ch, (S - dw) / 2, (S - dh) / 2, dw, dh);
  return icon.toDataURL();
}
