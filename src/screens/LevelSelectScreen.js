// Level grid + pre-level modal with recommended-vehicle picker (spec §6.3).

import { el, screens, starIcon } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { ads } from '../core/Breaks.js';
import { getWorld, levelKey } from '../data/levels.js';
import { VEHICLES } from '../data/vehicles.js';
import { formatTime } from '../ui/HUD.js';

export class LevelSelectScreen {
  constructor(root) { this.root = root; }

  enter({ worldId }) {
    this.worldId = worldId;
    const world = getWorld(worldId);
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Worlds', onclick: () => screens.show('worldselect') }));
    bar.appendChild(el('h2', { text: `${world.icon} ${world.name}` }));
    bar.appendChild(el('div', { class: 'coins', text: `🪙 ${saveData.getCoins()}` }));
    s.appendChild(bar);

    const grid = el('div', { class: 'grid' });
    world.levels.forEach((level, i) => {
      const unlocked = saveData.isLevelUnlocked(worldId, i);
      const key = levelKey(worldId, i);
      const stars = saveData.getLevelStars(key);
      const best = saveData.getBestTime(key);

      const card = el('div', { class: `card${unlocked ? '' : ' locked'}` });
      card.appendChild(el('h3', { text: unlocked ? level.name : `🔒 ${level.name}` }));
      card.appendChild(el('div', { class: 'sub', text: unlocked ? level.concept : 'Earn a star on the previous level.' }));
      if (unlocked) {
        card.appendChild(el('div', { class: 'stars' },
          [0, 1, 2].map(n => starIcon(n < stars, 16))));
        if (best != null) card.appendChild(el('div', { class: 'sub', text: `Best: ${formatTime(best)}` }));
        card.addEventListener('click', () => this._showPreLevel(level, i));
      }
      grid.appendChild(card);
    });
    s.appendChild(grid);
    this.root.appendChild(s);
  }

  _showPreLevel(level, levelIndex) {
    const overlay = el('div', { class: 'overlay' });
    const panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', { text: level.name }));
    panel.appendChild(el('div', { class: 'stat-line', text: level.concept }));
    panel.appendChild(el('div', {
      class: 'stat-line',
      text: `⭐ 3-star time: ${formatTime(level.targetTime)}`,
    }));

    // Vehicle picker (owned only), recommended flagged.
    let selected = saveData.getActiveVehicle();
    const list = el('div', { class: 'modal-veh-list' });
    const refresh = () => {
      list.innerHTML = '';
      for (const v of Object.values(VEHICLES)) {
        if (!saveData.getVehicleState(v.id).owned) continue;
        const opt = el('button', {
          class: `veh-opt${v.id === selected ? ' selected' : ''}`,
          onclick: () => { selected = v.id; refresh(); },
        });
        opt.appendChild(el('span', { text: `${v.icon} ${v.name}` }));
        if (v.id === level.recommended) opt.appendChild(el('span', { class: 'rec', text: '✓ recommended' }));
        list.appendChild(opt);
      }
    };
    refresh();
    panel.appendChild(list);

    panel.appendChild(el('button', {
      class: 'btn primary', text: 'Start ▶',
      onclick: () => {
        saveData.setActiveVehicle(selected);
        overlay.remove();
        ads.gate(() => screens.show('game', { worldId: this.worldId, levelIndex }));
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
