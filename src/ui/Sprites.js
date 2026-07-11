// Vehicle body sprites (sprites/*.png). Same convention as Textures.js:
// getSprite() returns null until the image has loaded, and callers keep
// their flat-color vector art as the fallback.

const images = new Map();

export function loadSprite(src) {
  if (!src || images.has(src)) return;
  const img = new Image();
  img.src = src;
  images.set(src, img);
}

export function getSprite(src) {
  if (!src) return null;
  if (!images.has(src)) loadSprite(src);
  const img = images.get(src);
  return img.complete && img.naturalWidth ? img : null;
}
