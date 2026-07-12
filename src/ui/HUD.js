// In-game HUD: timer, speed, level name, target time, pause button.
// Infinite mode passes distanceM/bestM/flash instead of a finite target time.

export function renderHUD(ctx, { time, speedKmh, levelName, targetTime, width, sludge = 0, distanceM = null, bestM = 0, flash = null }) {
  ctx.save();
  ctx.textBaseline = 'top';

  ctx.font = '36px Beachday, "Segoe UI", sans-serif';
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
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(bestM > 0 ? `best ${bestM}m · ${formatTime(time)}` : formatTime(time), width / 2, 56);
  } else {
    // Timer (center top) — turns red past target time.
    ctx.fillStyle = time > targetTime ? '#ff6c60' : '#ffffff';
    ctx.fillText(formatTime(time), width / 2, 14);
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 6;
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`⭐ target ${formatTime(targetTime)}`, width / 2, 56);
  }

  // Milestone / flip banner (infinite mode)
  if (flash) {
    ctx.font = '26px Beachday, "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffd75e';
    ctx.shadowOffsetY = 2;
    ctx.fillText(flash, width / 2, 84);
    ctx.shadowOffsetY = 0;
  }

  // Level name (top-left)
  ctx.textAlign = 'left';
  ctx.font = '20px Beachday, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(levelName, 16, 16);

  // Speed (below level name)
  ctx.font = '14px "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`${Math.round(speedKmh)} km/h`, 16, 44);

  // Pause button (top-right)
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
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
    ctx.font = '11px "Segoe UI", sans-serif';
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
