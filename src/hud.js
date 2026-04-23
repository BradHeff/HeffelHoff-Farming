import { Inventory } from './state.js';

export const RES_ICONS = { grass: '🌿', wood: '🪵', bale: '🌾', planks: '🪚', coin: '🪙', meat: '🥩' };

export function mountHUD() {
  const els = {
    wood: document.querySelector('[data-count="wood"]'),
    grass: document.querySelector('[data-count="grass"]'),
    bale: document.querySelector('[data-count="bale"]'),
    planks: document.querySelector('[data-count="planks"]'),
    coin: document.querySelector('[data-count="coin"]'),
  };
  const renderInventory = () => {
    els.wood.textContent = Inventory.wood;
    els.grass.textContent = Inventory.grass;
    els.bale.textContent = Inventory.bale;
    els.planks.textContent = Inventory.planks;
    els.coin.textContent = Inventory.coin;
  };
  Inventory.subscribe(renderInventory);
  renderInventory();
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// Build progress panel ------------------------------------------------------
let currentBuildKey = null;
let lastProgress = {};

export function bindBuildPanel(buildManager) {
  const el = document.getElementById('build-panel');
  const nameEl = document.getElementById('build-name');
  const iconEl = document.getElementById('build-icon');
  const rowsEl = document.getElementById('build-rows');

  const rebuild = () => {
    const active = buildManager.active;
    if (!active) {
      el.classList.remove('show');
      currentBuildKey = null;
      return;
    }
    if (active.key !== currentBuildKey) {
      currentBuildKey = active.key;
      lastProgress = {};
      nameEl.textContent = active.recipe.name;
      iconEl.textContent = active.recipe.icon;
      rowsEl.innerHTML = '';
      for (const [mat, total] of Object.entries(active.recipe.require)) {
        const row = document.createElement('div');
        row.className = 'build-row';
        row.dataset.mat = mat;
        const icon = document.createElement('span');
        icon.className = 'mat-icon';
        icon.textContent = RES_ICONS[mat] || '?';
        const squares = document.createElement('div');
        squares.className = 'squares';
        for (let i = 0; i < total; i++) {
          const sq = document.createElement('div');
          sq.className = 'sq';
          squares.appendChild(sq);
        }
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = `0/${total}`;
        row.appendChild(icon);
        row.appendChild(squares);
        row.appendChild(count);
        rowsEl.appendChild(row);
      }
    }

    for (const [mat, total] of Object.entries(active.recipe.require)) {
      const have = active.progress[mat] || 0;
      const row = rowsEl.querySelector(`.build-row[data-mat="${mat}"]`);
      if (!row) continue;
      const squares = row.querySelectorAll('.sq');
      const prev = lastProgress[mat] || 0;
      squares.forEach((sq, i) => {
        const shouldFill = i < have;
        sq.classList.toggle('filled', shouldFill);
        if (shouldFill && i >= prev) {
          sq.classList.remove('pop');
          void sq.offsetWidth;
          sq.classList.add('pop');
        }
      });
      row.querySelector('.count').textContent = `${have}/${total}`;
      lastProgress[mat] = have;
    }
    el.classList.add('show');
  };
  buildManager.subscribe(rebuild);
  rebuild();
}

export function positionBuildPanel(screenX, screenY, onscreen) {
  const el = document.getElementById('build-panel');
  if (!el) return;
  el.style.transform = `translate(calc(-50% + ${screenX}px), calc(-100% + ${screenY}px))`;
  el.classList.toggle('offscreen', !onscreen);
}
