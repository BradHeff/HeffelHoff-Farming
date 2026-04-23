import * as THREE from 'three';
import { CONFIG } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { InputManager } from './input.js';
import { PickupManager } from './pickups.js';
import { Backpack, PlayerCarry, Inventory, PlayerStats } from './state.js';
import { BuildManager } from './buildings.js';
import { mountHUD, toast, bindBuildPanel, positionBuildPanel, RES_ICONS } from './hud.js';
import { FloaterManager, StickyLabel } from './floaters.js';
import { UpgradeManager } from './upgrades.js';
import { PlayerCoinTower } from './coins.js';
import { CustomerQueue, HelperManager } from './npcs.js';
import { LockedPlot } from './locks.js';
import { FlightManager } from './flight.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 110);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a5a3a, 0.6);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(20, 35, 10);
    this.scene.add(dir);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, this._aspect(), 0.1, 200);

    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.pickups = new PickupManager(this.scene, this.player);
    this.builds = new BuildManager(this.scene);
    this.input = new InputManager(document.getElementById('joystick-zone'));
    this.floaters = new FloaterManager(this.camera);
    this.flight = new FlightManager(this.scene);
    this.fullLabel = new StickyLabel(this.camera, ''); // unused (uncapped pack)
    this.upgrades = new UpgradeManager(this.scene, this.camera);
    this.customers = new CustomerQueue(this.scene, this.camera, this.builds.sites.market, this.flight);
    this.helpers = new HelperManager(this.scene, this.world, this.builds);
    this.coinTower = new PlayerCoinTower(this.player);

    this.fenceLock = new LockedPlot(
      this.scene, this.camera,
      CONFIG.world.buildPlots.fence, 120,
      () => { toast('🔓 Fence plot unlocked'); this.builds.setHasEnemies(true); },
      this.builds, 'fence'
    );

    mountHUD();
    bindBuildPanel(this.builds);
    this._bindHireButton();

    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 200));
    this._resize();

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.lastDropoffKey = null;

    setTimeout(() => toast('Walk through grass & trees to harvest'), 400);

    this._projectVec = new THREE.Vector3();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _bindHireButton() {
    const btn = document.getElementById('hire-btn');
    const costEl = document.getElementById('hire-cost');
    const refresh = () => {
      costEl.textContent = this.helpers.hireCost();
      btn.disabled = !this.helpers.canHire() || Inventory.coin < this.helpers.hireCost();
    };
    btn.addEventListener('click', () => {
      if (this.helpers.tryHire()) toast('👨‍🌾 Helper hired!');
      refresh();
    });
    Inventory.subscribe(refresh);
    refresh();
  }

  _aspect() { return window.innerWidth / window.innerHeight; }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = h > w ? 62 : CONFIG.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  _updateCamera() {
    const p = this.player.group.position;
    const targetX = p.x;
    const targetZ = p.z + CONFIG.camera.backDistance;
    const targetY = CONFIG.camera.height;
    const k = 0.12;
    this.camera.position.x += (targetX - this.camera.position.x) * k;
    this.camera.position.y += (targetY - this.camera.position.y) * k;
    this.camera.position.z += (targetZ - this.camera.position.z) * k;
    this.camera.lookAt(p.x, 0.8, p.z + CONFIG.camera.lookAheadZ);
  }

  _updateSlash(_dt) {
    if (!this.player.isMoving) return;
    if (!this.player.canSlash()) return;
    const hits = this.world.queryInSlashArc(
      this.player.group.position,
      this.player.forward,
      PlayerStats.slashRadius,
      CONFIG.player.slashArcDeg
    );
    if (hits.length === 0) return;
    this.player.startSlash();
    const maxTargets = 5;
    for (let i = 0; i < Math.min(hits.length, maxTargets); i++) {
      const { h } = hits[i];
      h.hp -= 1;
      if (h.hp <= 0) {
        const srcPos = h.position.clone();
        srcPos.y = 0.4;
        for (let y = 0; y < h.yield.amount; y++) this.pickups.spawn(h.yield.key, srcPos);
        this.floaters.spawn(
          { x: h.position.x, y: 0.9, z: h.position.z },
          `+${h.yield.amount} ${RES_ICONS[h.yield.key] || ''}`,
          { cls: 'gain', ttl: 0.9, vy: 1.8 }
        );
        this.world.removeHarvestable(h);
      } else if (h.kind === 'treeGroup') {
        h.mesh.rotation.z = 0.12;
        setTimeout(() => { if (h.mesh && !h.removed) h.mesh.rotation.z = 0; }, 90);
      }
    }
  }

  _updatePassiveHarvest(dt) {
    const h = this.world.tickPassiveHarvest(this.player.group.position, dt);
    if (h) {
      const pos = h.position.clone(); pos.y = 0.4;
      this.pickups.spawn(h.yield.key, pos);
      this.floaters.spawn(
        { x: h.position.x, y: 0.9, z: h.position.z },
        `+${h.yield.amount} ${RES_ICONS[h.yield.key] || ''}`,
        { cls: 'gain', ttl: 0.7, vy: 1.6 }
      );
      this.world.removeHarvestable(h);
    }
  }

  _updatePickupables(_dt) {
    const pickR = PlayerStats.pickupRadius;
    const pickR2 = pickR * pickR;
    const px = this.player.group.position.x;
    const pz = this.player.group.position.z;
    const list = this.builds.pickupables;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.collected) { list.splice(i, 1); continue; }
      const dx = it.position.x - px;
      const dz = it.position.z - pz;
      if (dx * dx + dz * dz > pickR2) continue;
      const ok = this.pickups.spawn(it.resourceKey, it.position.clone());
      if (ok) this.builds.consumePickupable(it);
    }
  }

  _depositEligibleSites() {
    const out = [];
    for (const k of Object.keys(this.builds.sites)) {
      const s = this.builds.sites[k];
      if (s._locked) continue;
      if (!s.completed && s !== this.builds.active) continue;
      out.push(s);
    }
    return out;
  }

  _updateGpsArrow(dt) {
    const hasLoad = Backpack.total() + PlayerCarry.total() > 0;
    let target = null;
    if (hasLoad) {
      if (this.builds.active) target = this.builds.active.dropoffPos || this.builds.active.position;
      else {
        const p = this.player.group.position;
        let bestD = Infinity;
        for (const s of this._depositEligibleSites()) {
          const dp = s.dropoffPos || s.position;
          const d = Math.hypot(dp.x - p.x, dp.z - p.z);
          if (d < bestD) { bestD = d; target = dp; }
        }
      }
    }
    this.player.updateGpsArrow(target, !!target, dt);
  }

  // Runs when the player enters a deposit zone. Plays offload flight
  // animations for each carried item before crediting Inventory, and also
  // drains the backpack straight to Inventory (those can't fly to a visible
  // spot on a generic building).
  _doDepositFlights(site, beforeCarry) {
    const to = site.key === 'market' && site.tableSlots ? site.getAnyTableSlot() : null;
    const anchor = this.player.getCarryAnchor();
    let spawned = 0;
    // Bales
    for (let i = 0; i < (beforeCarry.bale || 0); i++) {
      const geo = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 10);
      const mat = new THREE.MeshLambertMaterial({ color: 0xe2c35a });
      const startOffset = new THREE.Vector3(0, -0.2 + i * 0.18, 0).add(anchor);
      const endPos = to
        ? to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.3))
        : new THREE.Vector3(site.position.x, 1.0, site.position.z);
      this.flight.spawn({
        geometry: geo, material: mat,
        startPos: startOffset, endPos,
        durationMs: 500 + i * 60,
        arcH: 1.6,
      });
      spawned++;
    }
    // Planks
    for (let i = 0; i < (beforeCarry.planks || 0); i++) {
      const geo = new THREE.BoxGeometry(0.5, 0.08, 0.18);
      const mat = new THREE.MeshLambertMaterial({ color: 0xb77842 });
      const startOffset = new THREE.Vector3(0, -0.2 + i * 0.18, 0).add(anchor);
      const endPos = to
        ? to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.3))
        : new THREE.Vector3(site.position.x, 1.0, site.position.z);
      this.flight.spawn({
        geometry: geo, material: mat,
        startPos: startOffset, endPos,
        durationMs: 500 + i * 60,
        arcH: 1.4,
      });
      spawned++;
    }
    return spawned;
  }

  _updateDropoff() {
    const p = this.player.group.position;
    let entered = null;
    for (const s of this._depositEligibleSites()) {
      const dp = s.dropoffPos || s.position;
      const dist = Math.hypot(p.x - dp.x, p.z - dp.z);
      if (dist < s.radius) { entered = s; break; }
    }
    const key = entered ? entered.key : null;
    if (key && key !== this.lastDropoffKey) {
      // Capture pre-deposit snapshot for animations
      const beforeCarry = { ...PlayerCarry.items };
      const beforeBack = { ...Backpack.items };
      const flights = this._doDepositFlights(entered, beforeCarry);

      const { deposited, emptied } = this.builds.depositAt(entered, Backpack, PlayerCarry);
      const dp = entered.dropoffPos || entered.position;
      for (const [k, v] of Object.entries(deposited)) {
        if (!v) continue;
        this.floaters.spawn(
          { x: dp.x, y: 1.4, z: dp.z },
          `+${v} ${RES_ICONS[k] || ''}`,
          { cls: 'gain', ttl: 1.0, vy: 1.3 }
        );
      }
      const storedParts = [];
      for (const [k, v] of Object.entries(emptied)) {
        const used = deposited[k] || 0;
        const stored = v - used;
        if (stored > 0) storedParts.push(`+${stored} ${RES_ICONS[k] || ''}`);
      }
      if (storedParts.length) {
        this.floaters.spawn(
          { x: p.x, y: 2.6, z: p.z },
          storedParts.join('  '),
          { cls: 'gain', ttl: 1.0, vy: 1.2 }
        );
      }
      if (!entered.completed && entered.isFulfilled()) {
        toast(`✅ ${entered.recipe.name} built!`);
      }
      void flights; void beforeBack;
    }
    this.lastDropoffKey = key;
  }

  _updateMarketSystems(dt) {
    const market = this.builds.sites.market;
    if (!market) return;
    if (market.completed && !this.customers.active) this.customers.setActive(true);
    const sold = market._soldThisTick;
    market._soldThisTick = null;
    this.customers.update(dt, sold);
    if (market.coinPile) market.coinPile.update(dt, this.player, this.floaters, RES_ICONS);
  }

  _updateBuildPanel() {
    const active = this.builds.active;
    if (!active) {
      const el = document.getElementById('build-panel');
      if (el) el.classList.remove('show');
      return;
    }
    this._projectVec.set(active.position.x, 2.0, active.position.z);
    const v = this._projectVec.clone().project(this.camera);
    const onscreen = v.z > 0 && v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    positionBuildPanel(sx, sy, onscreen);
  }

  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    const move = this.input.getMove();
    this.player.update(dt, move);
    this._updateSlash(dt);
    this._updatePassiveHarvest(dt);
    this.pickups.update(dt);
    this.flight.update(dt);
    this.world.update(dt, this.elapsed);
    this.builds.update(dt, this.elapsed);
    this.helpers.update(dt);
    this._updatePickupables(dt);
    this._updateDropoff();
    this._updateMarketSystems(dt);
    this.upgrades.update(dt, this.player);
    if (this.fenceLock && !this.fenceLock.unlocked) this.fenceLock.update(dt, this.player);
    this._updateCamera();
    this._updateGpsArrow(dt);
    this.floaters.update(dt);
    this._updateBuildPanel();

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }
}

new Game();
void PlayerStats;
