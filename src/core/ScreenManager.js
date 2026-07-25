// Switches between DOM menu screens and the canvas game screen.
// Each screen: { enter(params), exit(), update?(dt), render?(ctx) }.

class ScreenManager {
  constructor() {
    this.screens = {};
    this.current = null;
    this.currentName = null;
    this.menuRoot = null;
    this.canvas = null;
  }

  init(menuRoot, canvas) {
    this.menuRoot = menuRoot;
    this.canvas = canvas;
  }

  register(name, screen) {
    this.screens[name] = screen;
  }

  show(name, params) {
    if (this.current?.exit) this.current.exit();
    this.current = this.screens[name];
    this.currentName = name;

    // Canvas screens (game, editor) declare usesCanvas; everything else is DOM.
    const usesCanvas = !!this.current.usesCanvas;
    this.canvas.classList.toggle('active', usesCanvas);
    this.menuRoot.classList.toggle('hidden', usesCanvas);
    if (!usesCanvas) this.menuRoot.scrollTop = 0;

    this.current.enter(params);
  }

  update(dt) { this.current?.update?.(dt); }
  render(ctx) { this.current?.render?.(ctx); }
}

export const screens = new ScreenManager();

// Small DOM helper used by all menu screens.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

// Inline SVG rating star. The game's fonts don't carry ★/☆ glyphs (Fredoka
// has none at all), and font-fallback stars vary wildly across platforms —
// an SVG renders identically everywhere and takes the cartoon outline style.
export function starIcon(filled, size = 15) {
  return el('span', {
    class: 'star' + (filled ? ' filled' : ''),
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">`
      + '<polygon points="12,1.5 14.8,8.1 22,8.8 16.6,13.5 18.2,20.5 12,16.8 5.8,20.5 7.4,13.5 2,8.8 9.2,8.1"/>'
      + '</svg>',
  });
}

export function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

// Roadside route marker naming the level you just dropped into. It matters
// most on a first launch, where the player lands mid-hillside with no menu
// behind them and nothing else says where they are.
//
// It sits top-centre, below the HUD timer and well clear of the car (which
// spawns lower-left), and it never takes a click: `pointer-events: none` means
// the very first tap goes to the throttle. Removal is on a TIMER, not on
// animationend — prefers-reduced-motion kills animations outright, and a card
// waiting for an event that will never fire would sit there for the whole run.
export function showLevelIntro({ icon, eyebrow, title }, ms = 2300) {
  document.getElementById('level-intro')?.remove();
  const card = el('div', { id: 'level-intro', class: 'level-intro' });
  if (icon) card.appendChild(el('span', { class: 'li-shield', text: icon }));
  const text = el('div', { class: 'li-text' });
  text.appendChild(el('span', { class: 'li-eyebrow', text: eyebrow }));
  text.appendChild(el('span', { class: 'li-title', text: title }));
  card.appendChild(text);
  document.body.appendChild(card);
  setTimeout(() => card.classList.add('out'), ms - 400);
  setTimeout(() => card.remove(), ms);
}
