// In-game HUD: timer, speed, level name, target time, pause button.
// Infinite mode passes distanceM/bestM/fuel/flash instead of a finite target
// time; flash is { text, t } with t = 0..1 through the banner's life.

export function renderHUD(ctx, { time, speedKmh, levelName, targetTime, width, height = 0, sludge = 0, distanceM = null, bestM = 0, fuel = null, flash = null }) {
  ctx.save();
  ctx.textBaseline = 'top';

  ctx.font = '36px Beachday, Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(30,18,4,0.65)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 3;
  if (distanceM != null) {
    // Infinite mode: distance front and center, time small below.
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${Math.floor(distanceM)}m`, width / 2, 14);
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 6;
    ctx.font = '13px Fredoka, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(bestM > 0 ? `best ${bestM}m · ${formatTime(time)}` : formatTime(time), width / 2, 56);
  } else {
    // Timer (center top) — turns red past target time.
    ctx.fillStyle = time > targetTime ? '#ff6c60' : '#ffffff';
    ctx.fillText(formatTime(time), width / 2, 14);
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 6;
    ctx.font = '13px Fredoka, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`⭐ target ${formatTime(targetTime)}`, width / 2, 56);
  }

  // Milestone banner (infinite mode): pops in with overshoot, drifts up,
  // fades out — a little ceremony for every 500m.
  if (flash) {
    const t = Math.max(0, Math.min(1, flash.t ?? 0));
    const pop = t < 0.14 ? 0.4 + (t / 0.14) * 0.74 : Math.max(1, 1.14 - (t - 0.14) * 0.35);
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
    ctx.translate(width / 2, 96 - t * 14);
    ctx.scale(pop, pop);
    ctx.font = '30px Beachday, Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(43, 26, 8, 0.9)';
    ctx.strokeText(flash.text, 0, 0);
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(flash.text, 0, 0);
    ctx.restore();
  }

  // Level name (top-left)
  ctx.textAlign = 'left';
  ctx.font = '20px Beachday, Fredoka, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(levelName, 16, 16);

  // Speed (below level name)
  ctx.font = '14px Fredoka, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`${Math.round(speedKmh)} km/h`, 16, 44);

  // Fuel gauge (infinite mode): green → amber → flashing red, with a pulsing
  // red vignette when the tank is nearly dry.
  if (fuel != null) {
    const frac = Math.max(0, Math.min(1, fuel));
    const low = frac < 0.25;
    const bx = 40, by = 70, bw = 150, bh = 14;
    ctx.font = '16px Fredoka, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('⛽', 14, by - 2);
    ctx.fillStyle = 'rgba(20, 14, 6, 0.55)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = frac > 0.5 ? '#58bf43' : frac > 0.25 ? '#e0a72e' : '#e0463a';
    ctx.globalAlpha = low ? 0.6 + 0.4 * Math.sin(time * 9) : 1;
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    if (low && height) {
      const g = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.42,
        width / 2, height / 2, Math.max(width, height) * 0.72);
      g.addColorStop(0, 'rgba(224, 70, 58, 0)');
      g.addColorStop(1, 'rgba(224, 70, 58, 0.55)');
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 9);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  // Pause button (top-right)
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px Fredoka, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('❚❚', width - 36, 20);

  // Sludge corrosion bar (Factory sludge vats): fades in only while dirty.
  if (sludge > 0.01) {
    const bw = 220, bh = 16;
    const bx = width / 2 - bw / 2, by = 84; // below the "target" line — no overlap
    ctx.save();
    ctx.globalAlpha = Math.min(1, sludge * 3 + 0.15);
    ctx.fillStyle = 'rgba(20,15,5,0.6)';
    ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    ctx.fillStyle = sludge > 0.75 ? '#e0463a' : sludge > 0.4 ? '#e0a72e' : '#8fbf4a';
    ctx.fillRect(bx, by, bw * sludge, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.font = '600 11px Fredoka, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('CORROSION', width / 2, by + 2);
    ctx.restore();
  }

  ctx.restore();
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
