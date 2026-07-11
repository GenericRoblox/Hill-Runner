// Per-vehicle upgrade tiers with buy + 50% sell-back (spec §6.2).

import { el, screens, showToast } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import {
  getVehicleDef, getUpgradeCost, getSellBackValue, UPGRADE_STATS, STAT_LABELS,
} from '../data/vehicles.js';

export class UpgradeScreen {
  constructor(root) { this.root = root; }

  enter({ vehicleId }) {
    this.vehicleId = vehicleId;
    const v = getVehicleDef(vehicleId);
    const state = saveData.getVehicleState(vehicleId);
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Garage', onclick: () => screens.show('garage') }));
    bar.appendChild(el('h2', { text: `${v.icon} ${v.name}` }));
    bar.appendChild(el('div', { class: 'coins', text: `🪙 ${saveData.getCoins()}` }));
    s.appendChild(bar);

    for (const stat of UPGRADE_STATS) {
      const tier = state.upgrades[stat];
      const tiers = v.tiers[stat];
      const row = el('div', { class: 'upg-row' });

      const info = el('div', { class: 'info' });
      info.appendChild(el('strong', { text: STAT_LABELS[stat] }));
      info.appendChild(el('div', { class: 'tier-name', text: tiers[tier].name }));
      const pips = el('div', { class: 'pips' });
      for (let i = 0; i < tiers.length; i++) {
        pips.appendChild(el('span', { class: `pip${i <= tier ? ' on' : ''}` }));
      }
      info.appendChild(pips);
      row.appendChild(info);

      const actions = el('div', { class: 'upg-actions' });
      const cost = getUpgradeCost(vehicleId, stat, tier);
      if (cost != null) {
        actions.appendChild(el('button', {
          class: 'btn small primary', text: `Upgrade 🪙 ${cost}`,
          onclick: () => {
            if (saveData.spendCoins(cost)) {
              saveData.setUpgradeTier(vehicleId, stat, tier + 1);
              showToast(`${STAT_LABELS[stat]} → ${tiers[tier + 1].name}`);
              this.enter({ vehicleId });
            } else {
              showToast(`Not enough coins — need 🪙 ${cost}.`);
            }
          },
        }));
      } else {
        actions.appendChild(el('button', { class: 'btn small', text: 'MAX', disabled: 'true' }));
      }
      const refund = getSellBackValue(vehicleId, stat, tier);
      if (refund != null) {
        actions.appendChild(el('button', {
          class: 'btn small', text: `Sell 🪙 +${refund}`,
          onclick: () => {
            saveData.setUpgradeTier(vehicleId, stat, tier - 1);
            saveData.addCoins(refund);
            showToast(`Sold ${tiers[tier].name} for 🪙 ${refund}.`);
            this.enter({ vehicleId });
          },
        }));
      }
      row.appendChild(actions);
      s.appendChild(row);
    }

    s.appendChild(el('p', {
      class: 'hint',
      text: 'Sell-back refunds 50% — experiment freely. Brakes also sharpen air control.',
    }));
    this.root.appendChild(s);
  }

  exit() {}
}
