// Per-vehicle upgrade shop: every tier of every stat shown as a part image.
// Tiers must be bought in order; any bought tier can be re-equipped by
// tapping it (e.g. run knobbies instead of slicks). No sell-back — parts
// stay owned forever.

import { el, screens, showToast } from '../core/ScreenManager.js';
import { saveData } from '../core/SaveData.js';
import { getVehicleDef, UPGRADE_STATS, STAT_LABELS } from '../data/vehicles.js';
import { upgradeIconURL } from '../ui/UpgradeIcons.js';

const STAT_EMOJI = { engine: '⚙️', suspension: '🔩', tires: '🛞', brakes: '🛑' };

export class UpgradeScreen {
  constructor(root) { this.root = root; }

  enter({ vehicleId } = {}) {
    vehicleId = vehicleId || saveData.getActiveVehicle();
    this.vehicleId = vehicleId;
    const v = getVehicleDef(vehicleId);
    const state = saveData.getVehicleState(vehicleId);
    let missingIcons = false; // rim sprite still loading → tire icons pending
    this.root.innerHTML = '';
    const s = el('div', { class: 'screen' });

    const bar = el('div', { class: 'topbar' });
    bar.appendChild(el('button', { class: 'btn small', text: '← Garage', onclick: () => screens.show('garage') }));
    bar.appendChild(el('h2', { text: `${v.icon} ${v.name}` }));
    bar.appendChild(el('div', { class: 'coins', text: `🪙 ${saveData.getCoins()}` }));
    s.appendChild(bar);

    for (const stat of UPGRADE_STATS) {
      const equipped = state.upgrades[stat];
      const owned = state.ownedUpgrades[stat];
      const tiers = v.tiers[stat];
      const row = el('div', { class: 'upg-row' });

      const info = el('div', { class: 'info' });
      info.appendChild(el('strong', { text: STAT_LABELS[stat] }));
      info.appendChild(el('div', { class: 'tier-name', text: tiers[equipped].name }));
      row.appendChild(info);

      const grid = el('div', { class: 'tier-grid' });
      tiers.forEach((t, i) => {
        const isOwned = i <= owned;
        const isNext = i === owned + 1;
        const cls = ['tier-cell'];
        if (isOwned) cls.push('owned');
        if (i === equipped) cls.push('equipped');
        if (isNext) cls.push('buyable');
        if (!isOwned && !isNext) cls.push('locked');
        const cell = el('div', { class: cls.join(' '), tabindex: '0', role: 'button' });

        const url = upgradeIconURL(vehicleId, stat, i);
        if (!url) missingIcons = true;
        cell.appendChild(url
          ? el('img', { class: 'tier-icon', src: url, alt: t.name })
          : el('div', { class: 'tier-icon emoji', text: STAT_EMOJI[stat] }));
        cell.appendChild(el('div', { class: 'tier-cell-name', text: t.name }));
        cell.appendChild(
          i === equipped ? el('div', { class: 'tier-tag on', text: '✓ Equipped' })
            : isOwned ? el('div', { class: 'tier-tag', text: 'Tap to equip' })
              : el('div', { class: 'tier-tag price', text: `${isNext ? '' : '🔒 '}🪙 ${t.cost}` })
        );

        const act = () => {
          if (isOwned) {
            if (i === equipped) return;
            saveData.setUpgradeTier(vehicleId, stat, i);
            showToast(`${STAT_LABELS[stat]}: ${t.name} equipped.`);
            this.enter({ vehicleId });
          } else if (isNext) {
            if (saveData.spendCoins(t.cost)) {
              saveData.ownUpgradeTier(vehicleId, stat, i);
              showToast(`${STAT_LABELS[stat]} → ${t.name}!`);
              this.enter({ vehicleId });
            } else {
              showToast(`Not enough coins — need 🪙 ${t.cost}.`);
            }
          } else {
            showToast(`Buy ${tiers[owned + 1].name} first — tiers unlock in order.`);
          }
        };
        cell.addEventListener('click', act);
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });

        grid.appendChild(cell);
      });
      row.appendChild(grid);
      s.appendChild(row);
    }

    s.appendChild(el('p', {
      class: 'hint',
      text: 'Parts you own stay yours — tap any of them to swap back on. Brakes also sharpen air control.',
    }));
    this.root.appendChild(s);

    // A deep-link can land here before the rim sprites finish loading —
    // rebuild once they arrive so tire icons swap in for the emoji stand-ins.
    if (missingIcons) {
      setTimeout(() => {
        if (screens.current === this && this.vehicleId === vehicleId) this.enter({ vehicleId });
      }, 400);
    }
  }

  exit() {}
}
