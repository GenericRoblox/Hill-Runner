// Cartoon texture tiles (textures/*.jpg) as tinted, scaled canvas patterns.
// Tinting is a multiply blend — pass roughly the color the mid-tones should
// become (null = untinted). Patterns anchor to the current canvas transform,
// so world-space fills scroll with the camera and translated fills ride
// their body. Fills made inside a ROTATED context must use texUpright(),
// which counter-rotates the tile grid so textures stay upright on screen.
// Both return null until the tile has loaded; callers keep their flat color
// as the fallback.

const FILES = [
  'grass', 'dirt', 'mud', 'wood', 'stone',
  'brick', 'pavement', 'concrete', 'leaves', 'underground', 'liquid',
];

// Every tile ships as a jpg. Stone used to be a 2.9 MB png — a third of the
// game's entire download for one opaque tile with no transparency to protect.
// Re-encoded at quality 95 with no chroma subsampling it is 125 KB and differs
// by well under one level of brightness per pixel, which nothing survives being
// multiplied by a tint anyway.
const images = {};
const cache = new Map();

export function loadTextures() {
  for (const name of FILES) {
    const img = new Image();
    img.src = `textures/${name}-texture.jpg`;
    images[name] = img;
  }
}

const IDENTITY = new DOMMatrix();

// Bake one cropped, tinted tile to an offscreen canvas (shared by patterns
// and particle chunks). Returns null until the source image has loaded.
const tiles = new Map();
function bakeTile(name, tint, size, desat) {
  const img = images[name];
  if (!img || !img.complete || !img.naturalWidth) return null;
  const key = `${name}|${tint}|${size}|${desat}`;
  if (!tiles.has(key)) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = Math.max(1, Math.round(img.naturalHeight * (size / img.naturalWidth)));
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    if (tint) {
      if (desat) {
        g.globalCompositeOperation = 'saturation';
        g.fillStyle = '#808080';
        g.fillRect(0, 0, c.width, c.height);
      }
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = tint;
      g.fillRect(0, 0, c.width, c.height);
    }
    tiles.set(key, c);
  }
  return tiles.get(key);
}

// `size` = tile width in world px (textures ship at wildly different sizes).
// `desat` grayscales the tile before tinting — use it to push a strongly
// colored tile (e.g. the teal liquid) to a different hue than it ships in.
export function texPattern(name, tint = null, size = 220, desat = false) {
  const key = `${name}|${tint}|${size}|${desat}`;
  if (!cache.has(key)) {
    const c = bakeTile(name, tint, size, desat);
    if (!c) return null;
    cache.set(key, c.getContext('2d').createPattern(c, 'repeat'));
  }
  // Patterns are shared instances: clear any counter-rotation a texUpright
  // caller left behind, so plain callers always get an upright tile grid.
  const pat = cache.get(key);
  pat.setTransform(IDENTITY);
  return pat;
}

// Like texPattern, for fills made while the canvas is rotated by `angleRad`
// (planks, beams, boulders): counter-rotates the tile grid so the texture
// stays upright on screen instead of rotating with the body. The transform
// lives on the shared pattern object — fetch this right before filling.
export function texUpright(name, tint, size, angleRad, desat = false) {
  const pat = texPattern(name, tint, size, desat);
  if (pat && angleRad) {
    pat.setTransform(new DOMMatrix().rotateSelf(-angleRad * 180 / Math.PI));
  }
  return pat;
}

// Small irregular debris sprites cut from a texture tile — tire-spray
// particles use these so flying chunks visually match the surface they came
// off. Deterministic per key; null until the source image has loaded.
export const CHUNK_PX = 18;
const chunkCache = new Map();

export function texChunks(name, tint = null, desat = false) {
  const key = `${name}|${tint}|${desat}`;
  if (chunkCache.has(key)) return chunkCache.get(key);
  const tile = bakeTile(name, tint, 200, desat);
  if (!tile) return null;
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const chunks = [];
  for (let i = 0; i < 10; i++) {
    const c = document.createElement('canvas');
    c.width = c.height = CHUNK_PX;
    const g = c.getContext('2d');
    // Irregular blob clip so chunks read as torn clods, not square stamps.
    g.beginPath();
    const mid = CHUNK_PX / 2, verts = 6;
    for (let k = 0; k < verts; k++) {
      const a = (k / verts) * Math.PI * 2;
      const rad = CHUNK_PX * (0.3 + rnd() * 0.2);
      const px = mid + Math.cos(a) * rad, py = mid + Math.sin(a) * rad;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.clip();
    const sx = rnd() * (tile.width - CHUNK_PX);
    const sy = rnd() * (tile.height - CHUNK_PX);
    g.drawImage(tile, sx, sy, CHUNK_PX, CHUNK_PX, 0, 0, CHUNK_PX, CHUNK_PX);
    chunks.push(c);
  }
  chunkCache.set(key, chunks);
  return chunks;
}
