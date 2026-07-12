// Vehicle roster: buy, select active, jump to upgrades (spec §6.3).

import { el, screens, showToast } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { VEHICLES } from '../data/vehicles.js';

export class GarageScreen {
  constructor(root) { this.root = root; }

  enter() {
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Home', onclick: () => screens.show('home') }));
    bar.appendChild(el('h2', { text: '🔧 Garage' }));
    bar.appendChild(el('div', { class: 'coins', text: `🪙 ${saveData.getCoins()}` }));
    s.appendChild(bar);

    const grid = el('div', { class: 'grid', style: 'grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));' });
    for (const v of Object.values(VEHICLES)) {
      const state = saveData.getVehicleState(v.id);
      const isActive = saveData.getActiveVehicle() === v.id;

      const card = el('div', { class: `card${isActive ? ' selected' : ''}${state.owned ? '' : ' locked'}` });
      card.appendChild(el('img', { class: 'veh-img', src: v.body.sprite, alt: v.name }));
      card.appendChild(el('h3', { text: v.name + (isActive ? '  ✓ active' : '') }));
      card.appendChild(el('div', { class: 'sub', text: v.desc }));

      if (state.owned) {
        const tiers = Object.values(state.ownedUpgrades).reduce((a, b) => a + b, 0);
        card.appendChild(el('div', { class: 'sub', text: `Upgrades: ${tiers}/12 tiers` }));
        if (!isActive) {
          card.appendChild(el('button', {
            class: 'btn small primary', text: 'Select',
            onclick: (e) => { e.stopPropagation(); saveData.setActiveVehicle(v.id); this.enter(); },
          }));
        }
        card.appendChild(el('button', {
          class: 'btn small', text: 'Upgrade →',
          onclick: (e) => { e.stopPropagation(); screens.show('upgrade', { vehicleId: v.id }); },
        }));
      } else {
        card.appendChild(el('div', { class: 'price', text: `🪙 ${v.price}` }));
        card.appendChild(el('button', {
          class: 'btn small primary', text: 'Buy',
          onclick: (e) => {
            e.stopPropagation();
            if (saveData.spendCoins(v.price)) {
              saveData.unlockVehicle(v.id);
              showToast(`${v.icon} ${v.name} added to your garage!`);
              this.enter();
            } else {
              showToast(`Not enough coins — need 🪙 ${v.price}.`);
            }
          },
        }));
      }
      grid.appendChild(card);
    }
    s.appendChild(grid);
    this.root.appendChild(s);
  }

  exit() {}
}
