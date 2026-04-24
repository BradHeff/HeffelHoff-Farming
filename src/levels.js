import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory, HelperStats } from './state.js';
import { ZoneDecal } from './zone.js';
import { showLevelBanner } from './hud.js';

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
      width: 2.0, depth: 1.7,
      label: 'UP', icon: '⬆️',
      color: '#ffb347', textColor: 'rgba(255,230,180,0.95)',
      textSize: 120,
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
    // DOM card visibility is further gated by player proximity in update()
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
    const dist = Math.hypot(dx, dz);
    const inside = dist < this.radius;

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

    // Only show the floating card when the player is close — avoids
    // multiple adjacent building upgrade cards visually stacking.
    const near = dist < 5.5;
    this.card.style.display = near ? 'block' : 'none';
    if (near) this._refreshCard(tier);
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
      width: 2.2, depth: 1.7,
      label: 'HIRE', icon: '👷',
      color: '#d1b7ff', textColor: 'rgba(250,240,255,0.95)',
      textSize: 110,
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
    // DOM card visibility is further gated by player proximity in update()
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
    const dist = Math.hypot(dx, dz);
    const inside = dist < this.radius;
    if (inside && Inventory.coin >= this.cost) {
      Inventory.coin -= this.cost;
      Inventory.emit();
      onHireFn(this.buildingKey);
      this.onHired();
      return;
    }

    // Only show the floating card when the player is close enough to care —
    // prevents multiple adjacent building cards from stacking into a blob.
    const near = dist < 5.5;
    this.card.style.display = near ? 'block' : 'none';
    if (!near) return;
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

// Expansion tile — the "unlock the rest of the map" gate. Appears only when
// every required factory is Level 3; then the player pays a coin cost to
// activate and the locked biome area becomes harvestable + new build plots
// open up.
export class ExpansionTile {
  constructor(scene, camera, cfg, buildManager, world, onActivate) {
    this.scene = scene;
    this.camera = camera;
    this.cfg = cfg;
    this.buildManager = buildManager;
    this.world = world;
    this.onActivate = onActivate;
    this.activated = false;
    this.position = new THREE.Vector3(cfg.tilePos.x, 0, cfg.tilePos.z);
    this.radius = 2.2;
    this._projVec = new THREE.Vector3();
    this._buildDecal();
    this._buildCard();
  }

  _buildDecal() {
    this.decal = new ZoneDecal({
      width: 3.2, depth: 2.4,
      label: 'EXPAND', icon: '',
      color: '#ffcc66', textColor: 'rgba(255,236,180,0.95)',
      textSize: 110,
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
  }

  _prereqMet() {
    return this.cfg.requiredAtL3.every((k) => {
      const s = this.buildManager.sites[k];
      return s && s.level >= 3;
    });
  }

  update(dt, player) {
    if (this.activated) return;
    const met = this._prereqMet();
    this.decal.mesh.visible = met;
    this.card.style.display = met ? 'block' : 'none';
    if (!met) return;
    this.decal.update(dt);

    const dx = player.group.position.x - this.position.x;
    const dz = player.group.position.z - this.position.z;
    const inside = Math.hypot(dx, dz) < this.radius;
    if (inside && Inventory.coin >= this.cfg.unlockCost) {
      Inventory.coin -= this.cfg.unlockCost;
      Inventory.emit();
      this._activate();
      return;
    }

    // Refresh card (cheap — sig only changes when cost/state changes)
    const sig = `${Inventory.coin >= this.cfg.unlockCost}`;
    if (sig !== this._lastCardSig) {
      this._lastCardSig = sig;
      const canPay = Inventory.coin >= this.cfg.unlockCost;
      this.card.innerHTML = `
        <div class="title">🗺️ Expand Map</div>
        <div class="lvl-row ${canPay ? '' : 'req'}">
          <span class="${canPay ? 'done' : 'missing'}">🪙 ${this.cfg.unlockCost}</span>
        </div>
      `;
    }
    this._projVec.set(this.position.x, 2.0, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';
  }

  _activate() {
    this.activated = true;
    this.decal.removeFrom(this.scene);
    this.card.remove();
    this.world.unlockExpansion();
    if (this.onActivate) this.onActivate();
  }
}

export class BuildingHireManager {
  constructor(scene, camera, buildManager, onHireFn) {
    this.tiles = {};
    this.onHireFn = onHireFn;
    for (const k of Object.keys(buildManager.sites)) {
      if (!CONFIG.buildingWorker) continue;
      if (k === 'market') continue; // market doesn't need a worker
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

// Farm hire tile — sits south of each farm plot. Unlocked when the farm is
// unlocked; spending the hire cost spawns a FarmWorker that auto-harvests
// ready crops and delivers them to the matching factory (sauce for tomato,
// chips for potato) or the market as a fallback.
export class FarmHireTile {
  constructor(scene, camera, farm) {
    this.scene = scene;
    this.camera = camera;
    this.farm = farm;
    const cfg = CONFIG.farmWorker;
    this.cost = cfg.hireCost;
    this.radius = 1.6;
    this.hired = false;
    this.active = false;
    // Position south of farm (toward camera) so the player walks into it.
    const halfDepth = (farm.bounds?.depth || farm.rows * farm.cfg.spacing) / 2;
    this.position = new THREE.Vector3(
      farm.center.x, 0, farm.center.z + halfDepth + cfg.tileOffsetZ
    );
    this._buildDecal();
    this._buildCard();
  }

  _buildDecal() {
    this.decal = new ZoneDecal({
      width: 2.4, depth: 1.9,
      label: 'HIRE', icon: '👩‍🌾',
      color: '#b7ff94', textColor: 'rgba(240,255,230,0.98)',
      textSize: 100,
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
    // DOM card visibility further gated by player proximity in update()
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
    const dist = Math.hypot(dx, dz);
    if (dist < this.radius && Inventory.coin >= this.cost) {
      Inventory.coin -= this.cost;
      Inventory.emit();
      onHireFn(this.farm);
      this.onHired();
      return;
    }

    const near = dist < 5.5;
    this.card.style.display = near ? 'block' : 'none';
    if (!near) return;

    const sig = `${this.cost}|${Inventory.coin >= this.cost}`;
    if (sig !== this._lastCardSig) {
      this._lastCardSig = sig;
      const canPay = Inventory.coin >= this.cost;
      this.card.innerHTML = `
        <div class="title">👩‍🌾 Hire Farmer</div>
        <div class="lvl-row">
          <span class="${canPay ? 'done' : 'missing'}">🪙 ${this.cost}</span>
        </div>
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

export class FarmHireManager {
  constructor(scene, camera, farms, onHireFn) {
    this.onHireFn = onHireFn;
    this.tiles = farms.map((f) => new FarmHireTile(scene, camera, f));
  }
  update(dt, player) {
    for (const t of this.tiles) {
      const shouldShow = t.farm.unlocked && !t.hired;
      if (t.active !== shouldShow) t.setActive(shouldShow);
      t.update(dt, player, this.onHireFn);
    }
  }
}

// Helper training tile — appears only after full build + expansion. Each
// purchase advances HelperStats to the next tier, boosting every hired NPC.
export class HelperTrainingTile {
  constructor(scene, camera, buildManager, expansionTile) {
    this.scene = scene;
    this.camera = camera;
    this.buildManager = buildManager;
    this.expansionTile = expansionTile;
    this.cfg = CONFIG.helperTraining;
    this.position = new THREE.Vector3(this.cfg.tilePos.x, 0, this.cfg.tilePos.z);
    this.radius = 1.8;
    this.active = false;
    this.decal = new ZoneDecal({
      width: 2.6, depth: 2.0,
      label: 'TRAIN', icon: '🎓',
      color: '#ffd24a', textColor: 'rgba(255,240,200,0.98)',
      textSize: 130,
      rounded: true, cornerRadius: 0.3,
    });
    this.decal.setPosition(this.position.x, this.position.z);
    this.decal.addTo(this.scene);
    this.decal.mesh.visible = false;
    const el = document.createElement('div');
    el.className = 'level-card';
    el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();
  }

  _prereqMet() {
    if (!this.expansionTile?.activated) return false;
    for (const k of this.cfg.requiredBuilds) {
      const s = this.buildManager.sites[k];
      if (!s || !s.completed) return false;
    }
    return true;
  }

  _nextTier() {
    return this.cfg.tiers.find((t) => t.level === HelperStats.level + 1) || null;
  }

  setActive(v) {
    this.active = v;
    this.decal.mesh.visible = v && !!this._nextTier();
  }

  update(dt, player) {
    const shouldShow = this._prereqMet() && !!this._nextTier();
    if (shouldShow !== this.active) this.setActive(shouldShow);
    if (!this.active) {
      this.card.style.display = 'none';
      return;
    }
    this.decal.update(dt);
    const tier = this._nextTier();
    if (!tier) return;

    const dx = player.group.position.x - this.position.x;
    const dz = player.group.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < this.radius && Inventory.coin >= tier.cost) {
      Inventory.coin -= tier.cost;
      Inventory.emit();
      HelperStats.applyTier(tier);
      showLevelBanner({
        tier: `HELPERS LV ${tier.level}`,
        name: `+${Math.round((tier.capMul - 1) * 100)}% CARRY · +${Math.round((tier.speedMul - 1) * 100)}% SPEED`,
        icon: '🎓',
      });
      return;
    }

    const near = dist < 6;
    this.card.style.display = near ? 'block' : 'none';
    if (!near) return;

    const sig = `${HelperStats.level}→${tier.level}|${tier.cost}|${Inventory.coin >= tier.cost}`;
    if (sig !== this._lastCardSig) {
      this._lastCardSig = sig;
      const canPay = Inventory.coin >= tier.cost;
      this.card.innerHTML = `
        <div class="title">🎓 Train Helpers L${HelperStats.level} → ${tier.level}</div>
        <div class="lvl-row">
          <span class="${canPay ? 'done' : 'missing'}">🪙 ${tier.cost}</span>
          <span class="done">🎒 ×${tier.capMul.toFixed(1)}</span>
          <span class="done">👟 ×${tier.speedMul.toFixed(1)}</span>
        </div>
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
