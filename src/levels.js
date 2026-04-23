import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory } from './state.js';
import { ZoneDecal } from './zone.js';

// Per-building upgrade tile. Appears next to a building once the build is
// complete. Requires items (drawn from Inventory) to raise the building's
// level. Each tier scales the building's production speed + output cap.
export class BuildingLevelTile {
  constructor(scene, camera, buildingKey, buildSite) {
    this.scene = scene;
    this.camera = camera;
    this.buildingKey = buildingKey;
    this.site = buildSite;
    this.tiers = CONFIG.buildingLevels[buildingKey] || [];
    this.active = false;        // becomes true once the site completes
    this.progress = {};

    const off = CONFIG.buildingUpgradeOffset;
    this.position = new THREE.Vector3(
      this.site.position.x + off.x, 0, this.site.position.z + off.z
    );
    this.radius = 1.8;

    this._buildDecal();
    this._buildCard();
    this._resetProgress();
  }

  _buildDecal() {
    this.decal = new ZoneDecal({
      width: 2.2, depth: 2.0,
      label: 'UP', icon: '',
      color: '#ffb347', textColor: 'rgba(255,230,180,0.95)',
      textSize: 150,
    });
    this.decal.setPosition(this.position.x, this.position.z);
    this.decal.addTo(this.scene);
    this.decal.mesh.visible = false;
  }

  _buildCard() {
    const el = document.createElement('div');
    el.className = 'level-card';
    el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();
  }

  _resetProgress() {
    const tier = this._nextTier();
    this.progress = {};
    if (!tier) return;
    for (const k of Object.keys(tier.require)) this.progress[k] = 0;
  }

  _nextTier() {
    return this.tiers.find((t) => t.level === this.site.level + 1) || null;
  }

  setActive(v) {
    this.active = v;
    this.decal.mesh.visible = v && !!this._nextTier();
    this.card.style.display = (v && !!this._nextTier()) ? 'block' : 'none';
  }

  update(dt, player) {
    if (!this.active) return;
    this.decal.update(dt);

    const tier = this._nextTier();
    if (!tier) {
      this.decal.mesh.visible = false;
      this.card.style.display = 'none';
      return;
    }

    const dx = player.group.position.x - this.position.x;
    const dz = player.group.position.z - this.position.z;
    const inside = Math.hypot(dx, dz) < this.radius;

    if (inside) {
      this._drainAcc = (this._drainAcc || 0) + dt;
      const rate = 0.12;
      while (this._drainAcc >= rate) {
        this._drainAcc -= rate;
        let progressed = false;
        for (const k of Object.keys(tier.require)) {
          const need = tier.require[k] - (this.progress[k] || 0);
          if (need <= 0) continue;
          if ((Inventory[k] || 0) > 0) {
            Inventory[k] -= 1;
            Inventory.emit();
            this.progress[k] = (this.progress[k] || 0) + 1;
            progressed = true;
            break;
          }
        }
        if (!progressed) break;
      }
      if (Object.keys(tier.require).every((k) => (this.progress[k] || 0) >= tier.require[k])) {
        this._commit(tier);
      }
    } else {
      this._drainAcc = 0;
    }

    this._refreshCard(tier);
  }

  _commit(tier) {
    this.site.applyLevel(tier);
    this._resetProgress();
  }

  _refreshCard(tier) {
    const icon = { hayBaler: '🌾', sawMill: '🪚', market: '🏪' }[this.buildingKey] || '⬆️';
    const iconMap = { grass: '🌿', wood: '🪵', bale: '🌾', planks: '🪚', tomato: '🍅', potato: '🥔' };
    // Build a cheap signature string; only rewrite innerHTML when it changes.
    const sig = `${this.site.level}>${tier.level}|` +
      Object.entries(tier.require).map(([k, n]) => `${k}:${this.progress[k] || 0}/${n}`).join(',');
    if (sig !== this._lastCardSig) {
      this._lastCardSig = sig;
      const parts = Object.entries(tier.require).map(([k, n]) => {
        const have = this.progress[k] || 0;
        const cls = have >= n ? 'done' : 'missing';
        return `<span class="${cls}">${iconMap[k] || k} ${have}/${n}</span>`;
      });
      this.card.innerHTML = `
        <div class="title">${icon} Lv ${this.site.level} → ${tier.level}</div>
        <div class="req">${parts.join(' ')}</div>
      `;
    }
    this._projVec.set(this.position.x, 2.0, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';
  }
}

export class BuildingUpgradeManager {
  constructor(scene, camera, buildManager) {
    this.tiles = {};
    for (const k of Object.keys(buildManager.sites)) {
      if (!CONFIG.buildingLevels[k]) continue;
      this.tiles[k] = new BuildingLevelTile(scene, camera, k, buildManager.sites[k]);
    }
  }
  update(dt, player) {
    for (const k of Object.keys(this.tiles)) {
      const tile = this.tiles[k];
      const site = tile.site;
      const shouldShow = site.completed && !site._locked;
      if (tile.active !== shouldShow) tile.setActive(shouldShow);
      tile.update(dt, player);
    }
  }
}

// Per-building worker hire tile. Activates at Level 2+. Standing on it with
// the hire cost in Inventory.coin spends it and creates a BuildingWorker.
export class BuildingHireTile {
  constructor(scene, camera, buildingKey, buildSite) {
    this.scene = scene;
    this.camera = camera;
    this.buildingKey = buildingKey;
    this.site = buildSite;
    const cfg = CONFIG.buildingWorker;
    this.cost = cfg.hireCost;
    this.radius = 1.6;
    this.hired = false;
    this.active = false;

    const off = cfg.offset;
    this.position = new THREE.Vector3(
      buildSite.position.x + off.x, 0, buildSite.position.z + off.z
    );
    this._buildDecal();
    this._buildCard();
  }

  _buildDecal() {
    this.decal = new ZoneDecal({
      width: 2.0, depth: 1.8,
      label: 'HIRE', icon: '',
      color: '#d1b7ff', textColor: 'rgba(250,240,255,0.95)',
      textSize: 130,
    });
    this.decal.setPosition(this.position.x, this.position.z);
    this.decal.addTo(this.scene);
    this.decal.mesh.visible = false;
  }

  _buildCard() {
    const el = document.createElement('div');
    el.className = 'level-card';
    el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();
  }

  setActive(v) {
    this.active = v;
    const show = v && !this.hired;
    this.decal.mesh.visible = show;
    this.card.style.display = show ? 'block' : 'none';
  }

  onHired() {
    this.hired = true;
    this.decal.mesh.visible = false;
    this.card.style.display = 'none';
  }

  update(dt, player, onHireFn) {
    if (!this.active || this.hired) return;
    this.decal.update(dt);

    const dx = player.group.position.x - this.position.x;
    const dz = player.group.position.z - this.position.z;
    const inside = Math.hypot(dx, dz) < this.radius;
    if (inside && Inventory.coin >= this.cost) {
      Inventory.coin -= this.cost;
      Inventory.emit();
      onHireFn(this.buildingKey);
      this.onHired();
    }

    // Refresh card (cache innerHTML to avoid per-frame DOM rebuilds)
    const name = { hayBaler: 'Baler', sawMill: 'Saw', market: 'Market' }[this.buildingKey] || '';
    const sig = `${name}|${this.cost}`;
    if (sig !== this._lastCardSig) {
      this._lastCardSig = sig;
      this.card.innerHTML = `
        <div class="title">👷 Hire ${name}</div>
        <div class="lvl-row">🪙 ${this.cost}</div>
      `;
    }
    this._projVec.set(this.position.x, 2.0, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';
  }
}

export class BuildingHireManager {
  constructor(scene, camera, buildManager, onHireFn) {
    this.tiles = {};
    this.onHireFn = onHireFn;
    for (const k of Object.keys(buildManager.sites)) {
      if (!CONFIG.buildingWorker) continue;
      if (k === 'market' || k === 'fence') continue; // market doesn't need a worker; fence is defensive
      this.tiles[k] = new BuildingHireTile(scene, camera, k, buildManager.sites[k]);
    }
  }
  update(dt, player) {
    for (const k of Object.keys(this.tiles)) {
      const tile = this.tiles[k];
      const site = tile.site;
      const shouldShow = site.completed && !site._locked && site.level >= 2 && !tile.hired;
      if (tile.active !== shouldShow) tile.setActive(shouldShow);
      tile.update(dt, player, this.onHireFn);
    }
  }
}
