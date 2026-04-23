import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory, PlayerStats } from './state.js';
import { ZoneDecal } from './zone.js';

// A ground tile with a floating icon+cost card. Standing on it drains coins
// from Inventory into the tile's buffer at a fast rate; when the buffer hits
// the cost, the stat is upgraded and the cost scales up for the next level.
export class UpgradeTile {
  constructor(scene, camera, key, plotPos) {
    const cfg = CONFIG.upgradeSteps[key];
    this.scene = scene;
    this.camera = camera;
    this.key = key;
    this.cfg = cfg;
    this.position = new THREE.Vector3(plotPos.x, 0, plotPos.z);
    this.radius = 1.6;
    this.paidIn = 0;
    this._paymentAcc = 0;

    this.decal = new ZoneDecal({
      width: 2.6, depth: 2.2,
      label: '', icon: cfg.icon,
      color: '#b7f2ff', textColor: 'rgba(255,255,255,0.95)',
      textSize: 160,
    });
    this.decal.setPosition(this.position.x, this.position.z);
    this.decal.addTo(scene);

    // Raised plinth underneath for depth
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.06, 2.0),
      new THREE.MeshLambertMaterial({ color: 0x3e5a8a, transparent: true, opacity: 0.5 })
    );
    plinth.position.set(this.position.x, 0.03, this.position.z);
    scene.add(plinth);
    this.plinth = plinth;

    this._buildFloatingCard();
  }

  get currentCost() {
    return Math.round(this.cfg.baseCost * Math.pow(this.cfg.costGrowth, PlayerStats.level[this.key]));
  }

  _buildFloatingCard() {
    const el = document.createElement('div');
    el.className = 'upgrade-card';
    el.innerHTML = `
      <div class="row"><span class="icon">${this.cfg.icon}</span><span class="name">${this.cfg.label}</span></div>
      <div class="row cost"><span class="coin-ico">🪙</span><span class="cost-num">${this.currentCost}</span></div>
      <div class="bar"><div class="fill"></div></div>
      <div class="lvl">Lv <span class="lvl-num">${PlayerStats.level[this.key] + 1}</span></div>
    `;
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this.costNum = el.querySelector('.cost-num');
    this.fillEl = el.querySelector('.fill');
    this.lvlNum = el.querySelector('.lvl-num');
    this._projVec = new THREE.Vector3();
  }

  _refreshCard() {
    this.costNum.textContent = this.currentCost;
    this.lvlNum.textContent = PlayerStats.level[this.key] + 1;
    const pct = Math.min(1, this.paidIn / this.currentCost);
    this.fillEl.style.width = `${pct * 100}%`;
  }

  // Called each frame. `playerInside` gates the payment drain.
  update(dt, player) {
    const dx = player.group.position.x - this.position.x;
    const dz = player.group.position.z - this.position.z;
    const inside = Math.hypot(dx, dz) < this.radius;
    this.decal.update(dt);
    this._refreshCard();

    if (inside && Inventory.coin > 0) {
      // Accelerate slightly as player stays — feels responsive
      this._paymentAcc += dt;
      const rate = 0.04; // 25 coins/sec
      while (this._paymentAcc >= rate && Inventory.coin > 0) {
        this._paymentAcc -= rate;
        Inventory.coin -= 1;
        Inventory.emit();
        this.paidIn += 1;
        if (this.paidIn >= this.currentCost) {
          this._commit();
          this.paidIn = 0;
        }
      }
    } else {
      this._paymentAcc = 0;
    }

    // Project to screen for the floating card
    this._projVec.set(this.position.x, 1.8, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const onscreen = v.z > 0 && v.z < 1;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = onscreen ? '1' : '0';
  }

  _commit() {
    PlayerStats.upgrade(this.key);
  }

  dispose() {
    if (this.card) this.card.remove();
    this.decal.removeFrom(this.scene);
    this.scene.remove(this.plinth);
  }
}

export class UpgradeManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.tiles = CONFIG.upgradePlots.map((p) => new UpgradeTile(scene, camera, p.key, p));
  }
  update(dt, player) {
    for (const t of this.tiles) t.update(dt, player);
  }
}
