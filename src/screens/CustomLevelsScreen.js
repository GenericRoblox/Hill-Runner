// "Created Levels" tab: list, play, edit, delete and create custom levels.

import { el, screens, showToast, starIcon } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { getWorld } from '../data/levels.js';
import { formatTime } from '../ui/HUD.js';
import {
  listCustomLevels, saveCustomLevel, deleteCustomLevel, newCustomLevel,
  compileCustomLevel, CELL_W,
} from '../data/customLevels.js';

export class CustomLevelsScreen {
  constructor(root) { this.root = root; }

  enter() {
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Worlds', onclick: () => screens.show('worldselect') }));
    bar.appendChild(el('h2', { text: '🛠️ Created Levels' }));
    bar.appendChild(el('button', {
      class: 'btn small primary', text: '➕ New Level',
      onclick: () => {
        const lvl = newCustomLevel();
        saveCustomLevel(lvl);
        screens.show('editor', { id: lvl.id });
      },
    }));
    s.appendChild(bar);

    const levels = listCustomLevels();
    if (levels.length === 0) {
      s.appendChild(el('p', {
        class: 'hint',
        text: 'No levels yet — hit “New Level” to open the level creator and build your own track!',
      }));
    }

    const grid = el('div', { class: 'grid' });
    for (const lvl of levels) {
      const world = getWorld(lvl.theme) || getWorld(1);
      const key = `custom-${lvl.id}`;
      const stars = saveData.getLevelStars(key);
      const best = saveData.getBestTime(key);

      const card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'icon', text: world.icon }));
      card.appendChild(el('h3', { text: lvl.name }));
      card.appendChild(el('div', {
        class: 'sub',
        text: `${world.name} theme · ${Math.round(lvl.length * CELL_W / 100) / 10}k px · ${lvl.obstacles.length} obstacles`,
      }));
      card.appendChild(el('div', { class: 'stars' },
        [0, 1, 2].map(n => starIcon(n < stars, 16))));
      if (best != null) card.appendChild(el('div', { class: 'sub', text: `Best: ${formatTime(best)}` }));

      const row = el('div', { class: 'custom-actions' });
      row.appendChild(el('button', {
        class: 'btn small primary', text: '▶ Play',
        onclick: (e) => {
          e.stopPropagation();
          screens.show('game', {
            custom: {
              id: lvl.id, name: lvl.name, theme: lvl.theme,
              level: compileCustomLevel(lvl), from: 'customlevels',
            },
          });
        },
      }));
      row.appendChild(el('button', {
        class: 'btn small', text: '✏️ Edit',
        onclick: (e) => { e.stopPropagation(); screens.show('editor', { id: lvl.id }); },
      }));
      const del = el('button', {
        class: 'btn small', text: '🗑',
        onclick: (e) => {
          e.stopPropagation();
          // Two-step confirm: first click arms the button.
          if (del.dataset.armed) {
            deleteCustomLevel(lvl.id);
            showToast(`Deleted "${lvl.name}"`);
            this.enter();
          } else {
            del.dataset.armed = '1';
            del.textContent = 'Sure?';
            setTimeout(() => { delete del.dataset.armed; del.textContent = '🗑'; }, 2500);
          }
        },
      });
      row.appendChild(del);
      card.appendChild(row);
      grid.appendChild(card);
    }
    s.appendChild(grid);
    this.root.appendChild(s);
  }

  exit() {}
}
