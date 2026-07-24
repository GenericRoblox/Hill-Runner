// Infinite mode theme picker: Farm is free, the rest unlock with coins.
// Shows best distance per theme; starting a run uses the active vehicle.

import { el, screens, showToast } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { ads } from '../core/Breaks.js';
import { getWorld } from '../data/levels.js';
import { INFINITE_THEMES } from '../data/infinite.js';

export class InfiniteSelectScreen {
  constructor(root) { this.root = root; }

  enter() {
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Worlds', onclick: () => screens.show('worldselect') }));
    bar.appendChild(el('h2', { text: 'Infinite' }));
    bar.appendChild(el('div', { class: 'coins', text: `🪙 ${saveData.getCoins()}` }));
    s.appendChild(bar);

    s.appendChild(el('p', {
      class: 'hint',
      text: 'Drive as far as you can — the world never ends, it just gets meaner. New 500m bests pay coins; flips and air time pay extra.',
    }));

    const grid = el('div', { class: 'grid' });
    for (const theme of INFINITE_THEMES) {
      const world = getWorld(theme.id);
      const unlocked = saveData.isInfiniteUnlocked(theme.id);
      const best = saveData.getInfiniteBest(theme.id);

      const card = el('div', { class: `card${unlocked ? '' : ' locked'}` });
      card.appendChild(el('div', { class: 'icon', text: unlocked ? world.icon : '🔒' }));
      card.appendChild(el('h3', { text: world.name }));
      card.appendChild(el('div', { class: 'sub', text: theme.blurb }));

      if (unlocked) {
        card.appendChild(el('div', {
          class: 'stars',
          text: best > 0 ? `🏁 best ${best}m` : 'No runs yet',
        }));
        if (theme.payMult > 1) {
          card.appendChild(el('div', { class: 'sub', text: `coin payout ×${theme.payMult}` }));
        }
        card.addEventListener('click', () => ads.gate(() => screens.show('infinitegame', { themeId: theme.id })));
      } else {
        card.appendChild(el('div', { class: 'price', text: `🪙 ${theme.cost} to unlock` }));
        card.addEventListener('click', () => this._confirmUnlock(theme, world));
      }
      grid.appendChild(card);
    }
    s.appendChild(grid);
    this.root.appendChild(s);
  }

  _confirmUnlock(theme, world) {
    if (saveData.getCoins() < theme.cost) {
      showToast(`🪙 Not enough coins — ${theme.cost} needed.`);
      return;
    }
    const overlay = el('div', { class: 'overlay' });
    const panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', { text: `${world.icon} ${world.name}` }));
    panel.appendChild(el('div', { class: 'stat-line', text: theme.blurb }));
    panel.appendChild(el('div', { class: 'stat-line', text: `Coin payout ×${theme.payMult}` }));
    panel.appendChild(el('button', {
      class: 'btn primary', text: `Unlock for 🪙 ${theme.cost}`,
      onclick: () => {
        if (saveData.unlockInfinite(theme.id, theme.cost)) {
          overlay.remove();
          showToast(`${world.icon} ${world.name} Infinite unlocked!`);
          this.enter(); // refresh cards + coin counter
        } else {
          showToast('🪙 Not enough coins.');
        }
      },
    }));
    panel.appendChild(el('button', { class: 'btn', text: 'Cancel', onclick: () => overlay.remove() }));
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  exit() {
    document.querySelectorAll('body > .overlay:not(#pause-overlay):not(#result-overlay)').forEach(n => n.remove());
  }
}
