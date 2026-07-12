// Shared wheel rendering: rubber drawn around the rim-only wheel sprite.
// Used by GameScreen (live wheels) and UpgradeIcons (tire-tier previews) so
// the upgrade menu shows exactly what rolls in-game.
//
// ctx must be translated to the wheel centre. `r` is the physics radius (the
// tire's outer edge); the rim shrinks as the tire tier's `look.thick` grows.
// Tread rotates with `angle` (spin readability); slick sheen stays unrotated
// (it's lighting). `rimSprite` may be null — falls back to vector art.

export function drawWheel(ctx, r, angle, look, rimSprite) {
  ctx.save();
  ctx.rotate(angle);
  if (rimSprite) {
    const thick = Math.max(3.5, r * look.thick);
    const lugs = 11;
    if (look.tread === 'blocks') {
      // Knobby lugs poke past the casing so the silhouette reads off-road.
      const lugOut = Math.min(2.5, r * 0.1);
      ctx.fillStyle = '#17181b';
      for (let i = 0; i < lugs; i++) {
        ctx.save();
        ctx.rotate((i / lugs) * Math.PI * 2);
        ctx.fillRect(-r * 0.16, -(r + lugOut), r * 0.32, lugOut + thick * 0.5);
        ctx.restore();
      }
    }
    // Annulus, not a disc — the rim art is transparent between its
    // spokes, so anything behind the hub must show through.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.arc(0, 0, r - thick, 0, Math.PI * 2, true);
    ctx.fillStyle = '#232529';
    ctx.fill();
    if (look.tread === 'blocks') {
      // Carve the gaps between lugs out of the casing edge.
      ctx.fillStyle = '#101114';
      for (let i = 0; i < lugs; i++) {
        ctx.save();
        ctx.rotate(((i + 0.5) / lugs) * Math.PI * 2);
        ctx.fillRect(-r * 0.1, -r, r * 0.2, thick * 0.45);
        ctx.restore();
      }
    } else if (look.tread === 'street') {
      // Shallow sipes across the tread band.
      ctx.strokeStyle = '#111317';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * (r - thick * 0.75), Math.sin(a) * (r - thick * 0.75));
        ctx.lineTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1));
      }
      ctx.stroke();
    }
    // +1: tuck the rim's outer hoop under the rubber so no seam shows.
    const rimR = r - thick + 1;
    ctx.drawImage(rimSprite, -rimR, -rimR, rimR * 2, rimR * 2);
    if (look.tread === 'slick') {
      // Smooth compound: a static sheen instead of tread (lighting, not spin).
      ctx.rotate(-angle);
      ctx.beginPath();
      ctx.arc(0, 0, r - thick * 0.5, -2.4, -0.8);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = thick * 0.55;
      ctx.stroke();
    }
  } else {
    // Vector fallback until the rim sprite loads.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#999';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.9, 0);
    ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.9);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.restore();
}
