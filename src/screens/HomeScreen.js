import { el, screens } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { setUserMuted, isUserMuted } from '../ui/AudioBus.js';

export class HomeScreen {
  constructor(root) { this.root = root; }

  enter() {
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });
    s.appendChild(el('h1', { text: 'HILL RUNNER' }));
    s.appendChild(el('p', { class: 'tagline', text: 'Drive. Fly. Flip (carefully). Upgrade.' }));

    const col = el('div', { class: 'center-col' });
    col.appendChild(el('div', {
      class: 'coins',
      text: `🪙 ${saveData.getCoins()} coins`,
      style: 'text-align:center; margin-bottom: 16px;',
    }));
    col.appendChild(el('button', {
      class: 'btn primary', text: '▶ Play',
      onclick: () => screens.show('worldselect'),
    }));
    col.appendChild(el('button', {
      class: 'btn', text: '∞ Infinite',
      onclick: () => screens.show('infinite'),
    }));
    col.appendChild(el('button', {
      class: 'btn', text: '🔧 Garage',
      onclick: () => screens.show('garage'),
    }));
    // Endgame reward: appears only once every level of every world is starred
    // (the Worlds menu shows the locked version until then).
    if (saveData.isCreatorUnlocked()) {
      col.appendChild(el('button', {
        class: 'btn concrete', text: '🛠️ Level Creator',
        onclick: () => screens.show('customlevels'),
      }));
    }
    const muteLabel = () => (isUserMuted() ? '🔇 Sound: Off' : '🔊 Sound: On');
    const muteBtn = el('button', {
      class: 'btn small',
      text: muteLabel(),
      style: 'display:block; margin: 12px auto 0;',
      onclick: () => {
        setUserMuted(!isUserMuted());
        muteBtn.textContent = muteLabel();
      },
    });
    col.appendChild(muteBtn);
    s.appendChild(col);

    s.appendChild(el('p', {
      class: 'hint',
      text: 'D / → = gas · A / ← = brake & reverse · In the air: gas tips nose up, brake tips nose down · R = restart · Esc = pause',
    }));
    this.root.appendChild(s);
  }

  exit() {}
}
