import { el, screens, showToast, starIcon } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { WORLDS, levelKey } from '../data/levels.js';
import { playUnlockCutscene } from '../ui/Cutscene.js';

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
        card.appendChild(el('div', { class: 'stars' },
          [starIcon(true, 16), el('span', { text: `${stars} / ${w.levels.length * 3}` })]));
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
    s.appendChild(grid);

    // ---- Extra Modes: the two endgame rewards, unlocked by completing the
    // campaign. Each stays locked (and reveals with a cutscene) until earned.
    const infQual = saveData.isInfiniteModeUnlocked();
    const creQual = saveData.isCreatorUnlocked();
    const infShow = infQual && saveData.isInfiniteSeen();
    const creShow = creQual && saveData.isCreatorSeen();

    s.appendChild(el('div', { class: 'section-head', text: 'Extra Modes' }));
    const extras = el('div', { class: 'grid extras' });
    extras.appendChild(this._infiniteCard(infShow));
    extras.appendChild(this._creatorCard(creShow));
    s.appendChild(extras);

    this.root.appendChild(s);

    // A freshly-earned but not-yet-seen mode plays its reveal now. Cards above
    // rendered locked (seen is false); the cutscene marks them seen, then the
    // re-render shows them unlocked in full colour.
    const reveals = [];
    if (infQual && !saveData.isInfiniteSeen()) reveals.push('infinite');
    if (creQual && !saveData.isCreatorSeen()) reveals.push('creator');
    if (reveals.length) {
      playUnlockCutscene(reveals, () => {
        if (reveals.includes('infinite')) saveData.markInfiniteSeen();
        if (reveals.includes('creator')) saveData.markCreatorSeen();
        this.enter();
        this.root.querySelector('.section-head')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  _infiniteCard(unlocked) {
    const card = el('div', { class: `card mode-infinite${unlocked ? '' : ' locked'}` });
    card.appendChild(el('div', { class: 'icon', text: unlocked ? '🏁' : '🔒' }));
    card.appendChild(el('h3', { text: 'Infinite' }));
    card.appendChild(el('div', {
      class: 'sub',
      text: unlocked
        ? 'Endless per-world runs — drive as far as you can for coins.'
        : 'Complete every world to unlock endless mode.',
    }));
    card.addEventListener('click', () => {
      if (unlocked) screens.show('infinite');
      else showToast('🔒 Finish all six worlds to unlock Infinite!');
    });
    return card;
  }

  _creatorCard(unlocked) {
    const card = el('div', { class: `card concrete mode-creator${unlocked ? '' : ' locked'}` });
    card.appendChild(el('div', { class: 'icon', text: unlocked ? '🛠️' : '🔒' }));
    card.appendChild(el('h3', { text: 'Created Levels' }));
    card.appendChild(el('div', {
      class: 'sub',
      text: unlocked
        ? 'Build, edit and play your own tracks in the level creator.'
        : 'Earn 3 stars on every level to unlock the level creator.',
    }));
    card.addEventListener('click', () => {
      if (unlocked) screens.show('customlevels');
      else showToast('🔒 Three-star every level to unlock the level creator!');
    });
    return card;
  }

  exit() {}
}
