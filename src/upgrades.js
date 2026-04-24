import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory, PlayerStats } from './state.js';
import { ZoneDecal } from './zone.js';
import { showLevelBanner } from './hud.js';

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
      rounded: true, cornerRadius: 0.32,
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

    // Green radial progress fill that grows as coins are paid in. We
    // regenerate the CircleGeometry on pct change (only when it moves
    // noticeably so we don't allocate every frame).
    this._progressMat = new THREE.MeshBasicMaterial({
      color: 0x4aff4a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this._progressMesh = new THREE.Mesh(
      this._buildProgressGeo(0),
      this._progressMat,
    );
    this._progressMesh.position.set(this.position.x, 0.075, this.position.z);
    this._progressMesh.renderOrder = 3;
    scene.add(this._progressMesh);
    this._lastPct = 0;

    // Pool of small coin meshes that fall onto the tile while the player
    // pays — "coins spilling" visual. 6 is enough to read as a stream.
    this._coinPool = [];
    this._coinActive = [];
    const cGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10);
    const cMat = new THREE.MeshLambertMaterial({ color: 0xffd04a });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(cGeo, cMat);
      m.visible = false;
      scene.add(m);
      this._coinPool.push(m);
    }
    this._coinSpawnAcc = 0;

    this._buildFloatingCard();
  }

  // Pie slice starting at 12 o'clock growing clockwise so progress visually
  // "fills" the circle. pct 0..1.
  _buildProgressGeo(pct) {
    const segments = 36;
    const p = Math.max(0.001, Math.min(1, pct));
    const g = new THREE.CircleGeometry(0.95, segments, -Math.PI / 2, p * Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    return g;
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
      // Fast drain so higher-level costs don't take forever: scale rate so
      // any tier fills in ~1.5–2s if the player has the coins.
      this._paymentAcc += dt;
      const cost = this.currentCost;
      const period = Math.max(0.008, 1.6 / cost); // total ~1.6s to fill
      while (this._paymentAcc >= period && Inventory.coin > 0) {
        this._paymentAcc -= period;
        Inventory.coin -= 1;
        Inventory.emit();
        this.paidIn += 1;
        if (this.paidIn >= cost) {
          this._commit();
          this.paidIn = 0;
          break;
        }
      }
      // Spawn coin-drop meshes while paying
      this._coinSpawnAcc += dt;
      if (this._coinSpawnAcc >= 0.09) {
        this._coinSpawnAcc = 0;
        this._spawnCoinDrop();
      }
    } else {
      this._paymentAcc = 0;
      this._coinSpawnAcc = 0;
    }

    this._tickCoinDrops(dt);
    this._updateProgressFill();

    // Project to screen for the floating card
    this._projVec.set(this.position.x, 1.8, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const onscreen = v.z > 0 && v.z < 1;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = onscreen ? '1' : '0';
  }

  _updateProgressFill() {
    const pct = Math.min(1, this.paidIn / this.currentCost);
    // Only regenerate when the pie slice moves visibly (≥ 2%) to avoid
    // thrashing the geometry allocator.
    if (Math.abs(pct - this._lastPct) < 0.02 && !(pct === 0 && this._lastPct > 0)) return;
    this._lastPct = pct;
    const old = this._progressMesh.geometry;
    this._progressMesh.geometry = this._buildProgressGeo(pct);
    if (old) old.dispose();
    // Pop in color as it fills — greener as you approach 100%
    const tint = 0.5 + pct * 0.4;
    this._progressMat.opacity = tint;
  }

  _spawnCoinDrop() {
    const m = this._coinPool.pop();
    if (!m) return;
    const a = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 0.3;
    const sx = this.position.x + Math.cos(a) * r;
    const sz = this.position.z + Math.sin(a) * r;
    m.position.set(sx, 1.8, sz);
    m.visible = true;
    this._coinActive.push({
      mesh: m,
      vy: 0,
      t: 0,
      ttl: 0.65,
      spin: (Math.random() - 0.5) * 14,
      targetX: this.position.x + (Math.random() - 0.5) * 0.3,
      targetZ: this.position.z + (Math.random() - 0.5) * 0.3,
      startX: sx, startZ: sz,
    });
  }

  _tickCoinDrops(dt) {
    for (let i = this._coinActive.length - 1; i >= 0; i--) {
      const c = this._coinActive[i];
      c.t += dt;
      const k = Math.min(1, c.t / c.ttl);
      c.mesh.position.x = c.startX + (c.targetX - c.startX) * k;
      c.mesh.position.z = c.startZ + (c.targetZ - c.startZ) * k;
      c.mesh.position.y = 1.8 - 1.7 * k * k; // gravity-ish fall
      c.mesh.rotation.y += c.spin * dt;
      c.mesh.rotation.x += c.spin * 0.6 * dt;
      if (k >= 1) {
        c.mesh.visible = false;
        this._coinPool.push(c.mesh);
        this._coinActive.splice(i, 1);
      }
    }
  }

  _commit() {
    PlayerStats.upgrade(this.key);
    const lvl = PlayerStats.level[this.key];
    showLevelBanner({
      tier: `LEVEL ${lvl + 1}`,
      name: this.cfg.label.toUpperCase(),
      icon: this.cfg.icon || '⬆️',
    });
  }

  dispose() {
    if (this.card) this.card.remove();
    this.decal.removeFrom(this.scene);
    this.scene.remove(this.plinth);
    if (this._progressMesh) this.scene.remove(this._progressMesh);
    for (const m of this._coinPool) this.scene.remove(m);
    for (const c of this._coinActive) this.scene.remove(c.mesh);
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
