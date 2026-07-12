import { el, screens, showToast } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { WORLDS, levelKey } from '../data/levels.js';

export class WorldSelectScreen {
  constructor(root) { this.root = root; }

  enter() {
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Home', onclick: () => screens.show('home') }));
    bar.appendChild(el('h2', { text: 'Worlds' }));
    bar.appendChild(el('div', { class: 'coins', text: `🪙 ${saveData.getCoins()}` }));
    s.appendChild(bar);

    const grid = el('div', { class: 'grid' });
    for (const w of WORLDS) {
      const unlocked = w.playable && saveData.isWorldUnlocked(w.id);
      const stars = w.levels.reduce((sum, _, i) => sum + saveData.getLevelStars(levelKey(w.id, i)), 0);
      const card = el('div', { class: `card${unlocked ? '' : ' locked'}` });
      card.appendChild(el('div', { class: 'icon', text: unlocked ? w.icon : '🔒' }));
      card.appendChild(el('h3', { text: w.name }));
      if (unlocked) {
        card.appendChild(el('div', { class: 'sub', text: w.desc }));
        card.appendChild(el('div', { class: 'stars', text: `★ ${stars} / ${w.levels.length * 3}` }));
        card.addEventListener('click', () => screens.show('levelselect', { worldId: w.id }));
      } else if (w.playable) {
        const prev = WORLDS.find(p => p.id === w.id - 1);
        card.appendChild(el('div', { class: 'sub', text: `Finish ${prev ? prev.name : 'the previous world'} to unlock.` }));
        card.addEventListener('click', () => showToast(`🔒 Beat the last ${prev ? prev.name : ''} level first!`));
      } else {
        card.appendChild(el('div', { class: 'sub', text: 'Coming soon' }));
        card.addEventListener('click', () => showToast(`${w.icon} ${w.name} — coming in a future update!`));
      }
      grid.appendChild(card);
    }

    // Created Levels tab: the player's own levels + the level creator.
    const custom = el('div', { class: 'card' });
    custom.appendChild(el('div', { class: 'icon', text: '🛠️' }));
    custom.appendChild(el('h3', { text: 'Created Levels' }));
    custom.appendChild(el('div', { class: 'sub', text: 'Build, edit and play your own levels.' }));
    custom.addEventListener('click', () => screens.show('customlevels'));
    grid.appendChild(custom);

    s.appendChild(grid);
    this.root.appendChild(s);
  }

  exit() {}
}
