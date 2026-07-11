// Semi-transparent pedals anchored to the bottom corners (spec §4).
// Input zones themselves live in InputManager (left/right screen halves);
// these are the visual affordance.

export function renderTouchPedals(ctx, { width, height, gas, brake }) {
  const r = Math.max(44, Math.min(70, width * 0.07));
  const pad = r + 24;
  const y = height - pad;

  drawPedal(ctx, pad, y, r, brake, '◀', '#e05c5c');       // brake/reverse
  drawPedal(ctx, width - pad, y, r, gas, '▶', '#5ecb6f'); // gas
}

function drawPedal(ctx, x, y, r, active, glyph, color) {
  ctx.save();
  ctx.globalAlpha = active ? 0.85 : 0.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = active ? color : 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * 0.7)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y + 2);
  ctx.restore();
}
