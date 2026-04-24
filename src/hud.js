import { Inventory, UserLevel } from './state.js';

export const RES_ICONS = {
  grass: '🌿', wood: '🪵', bale: '🌾', planks: '🪚',
  tomato: '🍅', potato: '🥔', sauce: '🍶', chips: '🍟', egg: '🥚',
  milk: '🥛', corn: '🌽', wheat: '🌾', coin: '🪙', meat: '🥩',
};

export function mountHUD() {
  // Only display the store's sellable stock + coins. Raw materials (grass /
  // wood) are silent intermediates consumed by factories.
  const keys = ['bale', 'planks', 'tomato', 'potato', 'corn', 'sauce', 'chips', 'egg', 'milk', 'coin'];
  const els = {};
  for (const k of keys) els[k] = document.querySelector(`[data-count="${k}"]`);
  const renderInventory = () => {
    for (const k of keys) if (els[k]) els[k].textContent = Inventory[k];
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

export function mountUserLevelPill() {
  const pill = document.getElementById('user-level-pill');
  if (!pill) return;
  const numEl = pill.querySelector('.ul-num');
  const fillEl = pill.querySelector('.ul-fill');
  const xpEl = pill.querySelector('.ul-xp');
  const refresh = () => {
    numEl.textContent = UserLevel.level;
    xpEl.textContent = `${UserLevel.xp}/${UserLevel.xpToNext} XP`;
    const pct = Math.max(0, Math.min(1, UserLevel.xp / UserLevel.xpToNext));
    fillEl.style.width = `${pct * 100}%`;
  };
  UserLevel.subscribe(refresh);
  refresh();
  // Short pop whenever level itself changes
  let last = UserLevel.level;
  UserLevel.subscribe(() => {
    if (UserLevel.level !== last) {
      last = UserLevel.level;
      pill.classList.remove('pulse');
      void pill.offsetWidth;
      pill.classList.add('pulse');
      showLevelBanner({
        tier: `LEVEL ${UserLevel.level}`,
        name: 'YOU LEVELED UP!',
        icon: '⭐',
      });
    }
  });
}

// Big level-up celebration banner. Re-triggering within the animation
// window restarts the animation cleanly instead of queueing up pops.
let bannerTimer = null;
export function showLevelBanner({ tier, name, icon = '⭐' }) {
  const el = document.getElementById('level-banner');
  if (!el) return;
  el.querySelector('.banner-icon').textContent = icon;
  el.querySelector('.banner-tier').textContent = tier;
  el.querySelector('.banner-name').textContent = name;
  el.classList.remove('show');
  // Force reflow so the animation restarts
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 1850);
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
