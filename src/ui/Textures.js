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

// Fractional edge inset cropped off when baking — hides baked-in watermarks
// and non-seamless borders on some of the source tiles.
const CROP = { underground: 0.09, stone: 0.09, grass: 0.05, mud: 0.04, leaves: 0.03 };

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

// `size` = tile width in world px (textures ship at wildly different sizes).
// `desat` grayscales the tile before tinting — use it to push a strongly
// colored tile (e.g. the teal liquid) to a different hue than it ships in.
export function texPattern(name, tint = null, size = 220, desat = false) {
  const img = images[name];
  if (!img || !img.complete || !img.naturalWidth) return null;
  const key = `${name}|${tint}|${size}|${desat}`;
  if (!cache.has(key)) {
    const crop = CROP[name] || 0;
    const sx = img.naturalWidth * crop, sy = img.naturalHeight * crop;
    const sw = img.naturalWidth - sx * 2, sh = img.naturalHeight - sy * 2;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = Math.max(1, Math.round(sh * (size / sw)));
    const g = c.getContext('2d');
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
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
    cache.set(key, g.createPattern(c, 'repeat'));
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
