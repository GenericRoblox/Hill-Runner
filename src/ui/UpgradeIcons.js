// Upgrade-menu part icons: every stat tier rendered into a small data-URL so
// the menu shows what the part actually looks like. Tires use the REAL wheel
// renderer (ui/WheelArt.js + the vehicle's rim sprite), so the icon is exactly
// the wheel that rolls in-game at that tier. Engine/suspension/brake art is
// procedural cartoon canvas, escalating with tier. Cached per session; returns
// null on failure (caller falls back to an emoji).

import { getVehicleDef } from '../data/vehicles.js';
import { getSprite } from './Sprites.js';
import { drawWheel } from './WheelArt.js';

const SIZE = 96;
const INK = '#43290f';
// Tier accent ramp: stock grey → blue → gold → race red.
const ACCENT = ['#8f9399', '#3a67c9', '#e0a51b', '#d33c3c'];

const cache = new Map();

export function upgradeIconURL(vehId, stat, tier) {
  const key = `${vehId}/${stat}/${tier}`;
  if (cache.has(key)) return cache.get(key);
  let url = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    const ctx = cv.getContext('2d');
    ctx.lineJoin = 'round';
    if (stat === 'tires') {
      // Rim sprite still loading → return null WITHOUT caching so the next
      // screen build retries (sprites preload at boot, so this is rare).
      if (!drawTire(ctx, vehId, tier)) return null;
    } else if (stat === 'engine') drawEngine(ctx, tier);
    else if (stat === 'suspension') drawShock(ctx, tier);
    else if (stat === 'brakes') drawBrake(ctx, tier);
    else return null;
    url = cv.toDataURL();
  } catch (e) {
    console.warn('upgrade icon failed:', key, e);
    url = null;
  }
  cache.set(key, url);
  return url;
}

function drawTire(ctx, vehId, tier) {
  const v = getVehicleDef(vehId);
  const rim = getSprite(v.body.wheelSprite);
  if (!rim) return false;
  const look = v.tiers.tires[tier].look || { thick: 0.3, tread: 'street' };
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  drawWheel(ctx, SIZE * 0.42, 0, look, rim);
  ctx.restore();
  return true;
}

function outlined(ctx, fill, path) {
  ctx.beginPath();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
}

// Side-view engine: intake runners over an accent valve cover, block, oil
// pan, front pulley. Higher tiers grow the block and add runners; the top
// tier bolts on a turbo.
function drawEngine(ctx, tier) {
  const acc = ACCENT[tier];
  const w = 46 + tier * 4;
  const x0 = SIZE / 2 - w / 2 - (tier >= 3 ? 5 : 0);
  const topY = 34;
  const runners = 3 + Math.min(tier, 2);
  const gap = w / runners;
  for (let i = 0; i < runners; i++) {
    const cx = x0 + gap * (i + 0.5);
    outlined(ctx, '#c9cdd4', () => ctx.rect(cx - 4.5, topY - 13, 9, 13));
  }
  outlined(ctx, acc, () => ctx.rect(x0 - 4, topY, w + 8, 12));
  outlined(ctx, '#9aa0a8', () => ctx.rect(x0, topY + 12, w, 22));
  outlined(ctx, '#7d838c', () => {
    ctx.moveTo(x0 + 4, topY + 34);
    ctx.lineTo(x0 + w - 4, topY + 34);
    ctx.lineTo(x0 + w - 11, topY + 45);
    ctx.lineTo(x0 + 11, topY + 45);
    ctx.closePath();
  });
  outlined(ctx, '#666a70', () => ctx.arc(x0 - 1, topY + 23, 7, 0, Math.PI * 2));
  outlined(ctx, '#3d4045', () => ctx.arc(x0 - 1, topY + 23, 2.5, 0, Math.PI * 2));
  if (tier >= 3) {
    outlined(ctx, '#b7bcc4', () => ctx.arc(x0 + w + 8, topY + 18, 10, 0, Math.PI * 2));
    outlined(ctx, acc, () => ctx.arc(x0 + w + 8, topY + 18, 4, 0, Math.PI * 2));
  }
}

// Coil-over shock, tilted for style: damper body + rod with a zigzag spring
// wrapped around it. Coils, girth and length all grow with tier; the top
// tier gains a piggyback reservoir.
function drawShock(ctx, tier) {
  const acc = ACCENT[tier];
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.rotate(0.4);
  const len = 60 + tier * 6;
  const topY = -len / 2, botY = len / 2;
  const bodyW = 12 + tier * 1.5;
  outlined(ctx, '#c9cdd4', () => ctx.rect(-3, topY + 6, 6, len / 2 - 6));
  outlined(ctx, '#565b63', () => ctx.rect(-bodyW / 2, 0, bodyW, botY - 6));
  if (tier >= 3) outlined(ctx, '#565b63', () => ctx.rect(bodyW / 2 + 2, 6, 9, 22));
  // Eyelets
  outlined(ctx, '#565b63', () => ctx.arc(0, topY + 4, 6.5, 0, Math.PI * 2));
  outlined(ctx, '#565b63', () => ctx.arc(0, botY - 2, 6.5, 0, Math.PI * 2));
  // Spring: dark under-stroke, then the accent coil zigzag over everything.
  const coils = 4 + tier;
  const sy = topY + 14, ey = botY - 12;
  const springR = bodyW / 2 + 6;
  for (const [color, width] of [[INK, 7], [acc, 4]]) {
    ctx.beginPath();
    for (let i = 0; i <= coils; i++) {
      const y = sy + ((ey - sy) * i) / coils;
      const x = i % 2 ? springR : -springR;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

// Brake progression: plain drum → disc with caliper; higher tiers drill the
// rotor and grow a hotter-colored caliper.
function drawBrake(ctx, tier) {
  const acc = ACCENT[tier];
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  if (tier === 0) {
    outlined(ctx, '#8d939b', () => ctx.arc(0, 0, 30, 0, Math.PI * 2));
    outlined(ctx, '#a6acb4', () => ctx.arc(0, 0, 22, 0, Math.PI * 2));
    outlined(ctx, '#666a70', () => ctx.arc(0, 0, 8, 0, Math.PI * 2));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      outlined(ctx, '#666a70', () => ctx.arc(Math.cos(a) * 15, Math.sin(a) * 15, 2.5, 0, Math.PI * 2));
    }
  } else {
    outlined(ctx, '#c3c8cf', () => ctx.arc(0, 0, 30, 0, Math.PI * 2));
    outlined(ctx, '#b3b9c1', () => ctx.arc(0, 0, 24, 0, Math.PI * 2));
    if (tier >= 2) {
      ctx.fillStyle = '#7d838c';
      const holes = tier >= 3 ? 12 : 8;
      for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 19, Math.sin(a) * 19, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    outlined(ctx, '#878d95', () => ctx.arc(0, 0, 10, 0, Math.PI * 2));
    ctx.fillStyle = '#4d5157';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - 0.6;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 6, Math.sin(a) * 6, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // Caliper: a thick arc clamped over the rotor's top edge, bigger and
    // hotter-colored per tier.
    const span = 0.5 + tier * 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, 26, -Math.PI / 2 - span, -Math.PI / 2 + span);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 17;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 26, -Math.PI / 2 - span, -Math.PI / 2 + span);
    ctx.strokeStyle = acc;
    ctx.lineWidth = 12;
    ctx.stroke();
  }
  ctx.restore();
}
