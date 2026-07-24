// Win/fail end-of-run overlay (DOM).

import { el, starIcon } from '../core/ScreenManager.js';
import { formatTime } from '../ui/HUD.js';

const overlay = () => document.getElementById('result-overlay');
const panel = () => document.getElementById('result-panel');

// Three stars that pop in one after another (filled and empty alike, so the
// row reads as one gesture). Each star transitions in when its timer adds
// .pop — see the .big-stars .star rule for why this isn't an animation-delay.
function starsRow(stars) {
  const row = el('div', { class: 'big-stars' });
  for (let i = 0; i < 3; i++) {
    const s = starIcon(i < stars, 42);
    setTimeout(() => s.classList.add('pop'), 250 + i * 160);
    row.appendChild(s);
  }
  return row;
}

// Coin totals tick up instead of just appearing. Skipped under
// prefers-reduced-motion (CSS already stills everything else).
function countUp(node, total, suffix = ' coins') {
  if (total <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = `+${total}${suffix}`;
    return;
  }
  node.textContent = `+0${suffix}`;
  const t0 = performance.now();
  const dur = 700;
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 2.2);
    node.textContent = `+${Math.round(total * eased)}${suffix}`;
    if (t < 1 && node.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Confetti burst over the whole overlay (spec §8's completion juice).
function burstConfetti() {
  const colors = ['#ffd75e', '#ffab2e', '#e0524a', '#58bf43', '#7ac9f0', '#fff6e3'];
  const box = el('div', { class: 'confetti' });
  for (let i = 0; i < 28; i++) {
    const piece = el('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${1.5 + Math.random() * 1.1}s`;
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    box.appendChild(piece);
  }
  overlay().appendChild(box);
  setTimeout(() => box.remove(), 3400);
}

export function showResult(r) {
  const p = panel();
  p.innerHTML = '';

  if (r.infinite) {
    // Infinite mode run summary: distance + coin breakdown.
    p.appendChild(el('h2', { text: r.newBest ? '🏁 New Best!' : 'Run Over' }));
    p.appendChild(el('div', { class: 'fail-reason', text: r.reason }));
    p.appendChild(el('div', { class: 'big-stars', text: `${r.distM}m` }));
    p.appendChild(el('div', { class: 'stat-line', text: `Best: ${r.bestM}m` }));
    if (r.milestoneCoins > 0) {
      p.appendChild(el('div', { class: 'stat-line', text: `New milestones: +${r.milestoneCoins} coins` }));
    }
    if (r.flips > 0) {
      p.appendChild(el('div', { class: 'stat-line', text: `🔄 ${r.flips} flip${r.flips > 1 ? 's' : ''}: +${r.flipCoins} coins` }));
    }
    if (r.airCoins > 0) {
      p.appendChild(el('div', { class: 'stat-line', text: `Air time ${r.airTime.toFixed(1)}s: +${r.airCoins} coins` }));
    }
    const total = (r.milestoneCoins || 0) + (r.flipCoins || 0) + (r.airCoins || 0);
    if (total > 0) {
      const earn = el('div', { class: 'earn' });
      countUp(earn, total);
      p.appendChild(earn);
    }
    p.appendChild(el('button', { class: 'btn primary', text: 'Drive Again (R)', onclick: () => { hideResult(); r.onRetry(); } }));
    p.appendChild(el('button', { class: 'btn', text: 'Infinite Menu', onclick: () => { hideResult(); r.onQuit(); } }));
    overlay().classList.remove('hidden');
    if (r.newBest) burstConfetti();
    return;
  }

  if (r.won) {
    p.appendChild(el('h2', { text: 'Level Complete!' }));
    p.appendChild(starsRow(r.stars));
    p.appendChild(el('div', { class: 'stat-line', text: `Time: ${formatTime(r.time)}` }));
    if (r.bestTime != null) {
      p.appendChild(el('div', { class: 'stat-line', text: `Best: ${formatTime(r.bestTime)}` }));
    }
    if (r.airTime > 0.5) {
      p.appendChild(el('div', { class: 'stat-line', text: `Air time: ${r.airTime.toFixed(1)}s` }));
    }
    // Custom levels pass coins: null — they award no payout.
    if (r.coins != null) {
      const earn = el('div', { class: 'earn' });
      countUp(earn, r.coins);
      p.appendChild(earn);
    }
    if (r.onGarage) {
      // One-time upgrade nudge (GameScreen sets onGarage the first time the
      // player can afford an engine upgrade). Framed as its own "shop ticket"
      // callout — a bigger button wrapped in text — so it reads as a reward and
      // stands apart from the routine Next/Retry/Level Select blocks below.
      const nudge = el('div', { class: 'garage-nudge' });
      nudge.appendChild(el('div', {
        class: 'nudge-eyebrow',
        text: 'You can afford your first upgrade!',
      }));
      nudge.appendChild(el('button', {
        class: 'btn primary nudge-btn',
        text: '🔧 Go to Garage',
        onclick: () => { hideResult(); r.onGarage(); },
      }));
      nudge.appendChild(el('div', {
        class: 'nudge-sub',
        text: 'The hills get steeper from here — a bigger engine helps you climb.',
      }));
      p.appendChild(nudge);
    }
    if (r.onNext) {
      p.appendChild(el('button', { class: 'btn primary', text: 'Next Level ▶', onclick: () => { hideResult(); r.onNext(); } }));
    }
    if (r.onNextWorld) {
      p.appendChild(el('button', { class: 'btn blue', text: 'Next World ▶', onclick: () => { hideResult(); r.onNextWorld(); } }));
    }
    // The final-level mode-unlock win hides Retry — the one move is forward,
    // into the reveal (see the unlock-styled quit button below).
    if (!r.hideRetry) {
      p.appendChild(el('button', { class: 'btn', text: 'Retry', onclick: () => { hideResult(); r.onRetry(); } }));
    }
  } else {
    p.appendChild(el('h2', { text: 'Wrecked!' }));
    p.appendChild(el('div', { class: 'fail-reason', text: r.reason }));
    p.appendChild(el('button', { class: 'btn primary', text: 'Retry (R)', onclick: () => { hideResult(); r.onRetry(); } }));
  }

  p.appendChild(el('button', {
    class: r.unlockMode ? 'btn primary unlock' : 'btn',
    text: r.quitLabel || 'Level Select',
    onclick: () => { hideResult(); r.onQuit(); },
  }));
  overlay().classList.remove('hidden');
  if (r.won) burstConfetti();
}

export function hideResult() {
  overlay().querySelector('.confetti')?.remove();
  overlay().classList.add('hidden');
}
