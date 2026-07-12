// Win/fail end-of-run overlay (DOM).

import { el } from '../core/ScreenManager.js';
import { formatTime } from '../ui/HUD.js';

const overlay = () => document.getElementById('result-overlay');
const panel = () => document.getElementById('result-panel');

export function showResult(r) {
  const p = panel();
  p.innerHTML = '';

  if (r.won) {
    p.appendChild(el('h2', { text: 'Level Complete!' }));
    p.appendChild(el('div', {
      class: 'big-stars',
      text: '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars),
    }));
    p.appendChild(el('div', { class: 'stat-line', text: `Time: ${formatTime(r.time)}` }));
    if (r.bestTime != null) {
      p.appendChild(el('div', { class: 'stat-line', text: `Best: ${formatTime(r.bestTime)}` }));
    }
    if (r.airTime > 0.5) {
      p.appendChild(el('div', { class: 'stat-line', text: `Air time: ${r.airTime.toFixed(1)}s` }));
    }
    // Custom levels pass coins: null — they award no payout.
    if (r.coins != null) p.appendChild(el('div', { class: 'earn', text: `+${r.coins} coins` }));
    if (r.onGarage) {
      // One-time upgrade nudge (GameScreen sets onGarage the first time the
      // player can afford an engine upgrade).
      p.appendChild(el('div', {
        class: 'upgrade-hint',
        text: '💡 As the levels get harder, you may need to upgrade your car!',
      }));
      p.appendChild(el('button', {
        class: 'btn primary',
        text: '🔧 Go to Garage',
        onclick: () => { hideResult(); r.onGarage(); },
      }));
    }
    if (r.onNext) {
      p.appendChild(el('button', { class: 'btn primary', text: 'Next Level ▶', onclick: () => { hideResult(); r.onNext(); } }));
    }
    p.appendChild(el('button', { class: 'btn', text: 'Retry', onclick: () => { hideResult(); r.onRetry(); } }));
  } else {
    p.appendChild(el('h2', { text: 'Wrecked!' }));
    p.appendChild(el('div', { class: 'fail-reason', text: r.reason }));
    p.appendChild(el('button', { class: 'btn primary', text: 'Retry (R)', onclick: () => { hideResult(); r.onRetry(); } }));
  }

  p.appendChild(el('button', { class: 'btn', text: r.quitLabel || 'Level Select', onclick: () => { hideResult(); r.onQuit(); } }));
  overlay().classList.remove('hidden');
}

export function hideResult() {
  overlay().classList.add('hidden');
}
