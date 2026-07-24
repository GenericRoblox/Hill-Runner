// One-shot "new mode unlocked" reveal, played over the Worlds menu when the
// player earns Infinite and/or Created Levels. Pure DOM + CSS; the caller marks
// the modes seen and re-renders once `onDone` fires.

import { el } from '../core/ScreenManager.js';

const MODE = {
  infinite: {
    icon: '🏁', name: 'Infinite',
    desc: 'Endless runs — drive as far as you can for coins.',
  },
  creator: {
    icon: '🛠️', name: 'Created Levels',
    desc: 'Build, edit and play your very own tracks.',
  },
};

function eyebrowFor(modes) {
  const both = modes.includes('infinite') && modes.includes('creator');
  if (both) return 'A perfect finish — 3 stars on every level!';
  if (modes.includes('creator')) return 'Flawless — 3 stars on every level!';
  return 'You conquered all six worlds!';
}

function confetti(host) {
  const colors = ['#ffd75e', '#ffab2e', '#e0524a', '#58bf43', '#7ac9f0', '#fff6e3'];
  const box = el('div', { class: 'confetti' });
  for (let i = 0; i < 40; i++) {
    const piece = el('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${1.6 + Math.random() * 1.3}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    box.appendChild(piece);
  }
  host.appendChild(box);
}

// modes: array of 'infinite' | 'creator'. onDone runs once, when dismissed.
export function playUnlockCutscene(modes, onDone) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    overlay.classList.add('closing');
    setTimeout(() => { overlay.remove(); onDone?.(); }, reduce ? 0 : 260);
  };

  const overlay = el('div', { class: 'overlay cutscene' });
  const stage = el('div', { class: 'cutscene-stage' });

  stage.appendChild(el('div', { class: 'cutscene-eyebrow', text: eyebrowFor(modes) }));
  stage.appendChild(el('h2', {
    class: 'cutscene-title',
    text: modes.length > 1 ? 'New Modes Unlocked!' : 'New Mode Unlocked!',
  }));

  const tiles = el('div', { class: 'cutscene-modes' });
  const revealEls = [];
  for (const id of modes) {
    const m = MODE[id];
    const tile = el('div', { class: 'reveal-tile' });
    const art = el('div', { class: 'reveal-art' });
    art.appendChild(el('span', { class: 'reveal-lock', text: '🔒' }));
    art.appendChild(el('span', { class: 'reveal-icon', text: m.icon }));
    tile.appendChild(art);
    tile.appendChild(el('div', { class: 'reveal-name', text: m.name }));
    tile.appendChild(el('div', { class: 'reveal-desc', text: m.desc }));
    tiles.appendChild(tile);
    revealEls.push(art);
  }
  stage.appendChild(tiles);

  stage.appendChild(el('button', {
    class: 'btn primary cutscene-go', text: 'Continue ▶', onclick: finish,
  }));

  overlay.appendChild(stage);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
  document.body.appendChild(overlay);

  // Kick the sequence: title/tiles ease in (CSS), then each lock shatters.
  requestAnimationFrame(() => overlay.classList.add('in'));
  if (reduce) {
    revealEls.forEach(a => a.classList.add('shattered'));
  } else {
    confetti(overlay);
    revealEls.forEach((a, i) => setTimeout(() => a.classList.add('shattered'), 620 + i * 340));
  }
}
