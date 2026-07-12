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

export function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}
