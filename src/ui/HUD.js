// In-game HUD: timer, speed, level name, target time, pause button.

export function renderHUD(ctx, { time, speedKmh, levelName, targetTime, width }) {
  ctx.save();
  ctx.textBaseline = 'top';

  // Timer (center top) — turns red past target time.
  ctx.font = '36px Beachday, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = time > targetTime ? '#ff6c60' : '#ffffff';
  ctx.shadowColor = 'rgba(30,18,4,0.65)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 3;
  ctx.fillText(formatTime(time), width / 2, 14);
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 6;

  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`⭐ target ${formatTime(targetTime)}`, width / 2, 56);

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

  ctx.restore();
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
