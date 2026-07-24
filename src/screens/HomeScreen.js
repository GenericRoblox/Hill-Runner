import { el, screens } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { setUserMuted, isUserMuted } from '../ui/AudioBus.js';

// A large home action: a big toy-block button with an icon badge, a title and
// a one-line subtitle, so the two front-door choices read at a glance.
function bigButton(variant, icon, title, sub, onclick) {
  const btn = el('button', { class: `btn big ${variant}`.trim(), onclick });
  btn.appendChild(el('span', { class: 'big-icon', text: icon }));
  const label = el('span', { class: 'big-label' });
  label.appendChild(el('span', { class: 'big-title', text: title }));
  label.appendChild(el('span', { class: 'big-sub', text: sub }));
  btn.appendChild(label);
  return btn;
}

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
      style: 'text-align:center; margin-bottom: 22px;',
    }));

    // Two big front-door actions. Everything else (Infinite, Created Levels)
    // now lives one layer in, inside the Worlds menu.
    col.appendChild(bigButton('primary', '▶', 'Play', 'Worlds, levels & stars',
      () => screens.show('worldselect')));
    col.appendChild(bigButton('', '🔧', 'Garage', 'Buy & tune your rides',
      () => screens.show('garage')));

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
