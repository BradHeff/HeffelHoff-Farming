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
import { CustomerQueue, HelperManager, AmbientNpcManager } from './npcs.js';
import { LockedPlot } from './locks.js';
import { FlightManager } from './flight.js';
import { Farm } from './farms.js';
import { BuildingUpgradeManager, BuildingHireManager } from './levels.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    // Mobile GPU budget: a 1440×3088 device at pixelRatio 2 allocates ~150MB
    // of color/depth buffers, which on Samsung drivers pushes GL memory past
    // stall thresholds. Cap the render ratio and skip MSAA — cartoon look
    // doesn't need either.
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    // Fog adds a per-fragment computation to every draw call. On some mobile
    // GPUs (notably WebView Mali/Adreno combos) this pushed frames past the
    // 5s TDR watchdog. Removed for now; draw distance is capped by the
    // camera far plane instead.

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
    this.input = new InputManager();
    this.floaters = new FloaterManager(this.camera);
    this.flight = new FlightManager(this.scene);
    this.fullLabel = new StickyLabel(this.camera, ''); // unused (uncapped pack)
    this.upgrades = new UpgradeManager(this.scene, this.camera);
    this.customers = new CustomerQueue(this.scene, this.camera, this.builds.sites.market, this.flight);
    this.helpers = new HelperManager(this.scene, this.world, this.builds);
    this.ambient = new AmbientNpcManager(this.scene);
    this.coinTower = new PlayerCoinTower(this.player);
    this.farm = new Farm(this.scene);
    this.buildingUpgrades = new BuildingUpgradeManager(this.scene, this.camera, this.builds);
    this.buildingHires = new BuildingHireManager(
      this.scene, this.camera, this.builds,
      (key) => { this.helpers.hireBuildingWorker(key); toast('👷 Worker hired!'); }
    );

    this.fenceLock = new LockedPlot(
      this.scene, this.camera,
      CONFIG.world.buildPlots.fence, 120,
      () => { toast('🔓 Fence plot unlocked'); this.builds.setHasEnemies(true); },
      this.builds, 'fence'
    );

    mountHUD();
    bindBuildPanel(this.builds);
    this._bindHireButton();
    this._bindSeedModal();

    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 200));
    this._resize();

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.lastDropoffKey = null;
    // FPS meter state
    this._fpsEl = document.getElementById('fps-meter');
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    setTimeout(() => toast('Walk through grass & trees to harvest'), 400);

    this._projectVec = new THREE.Vector3();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _bindSeedModal() {
    const modal = document.getElementById('seed-modal');
    const buttons = modal.querySelectorAll('.seed-btn');
    buttons.forEach((b) => {
      b.addEventListener('click', () => {
        const crop = b.dataset.crop;
        this.farm.seed(crop, this.world.harvestables);
        modal.classList.remove('show');
      });
    });
    this._seedModal = modal;
  }

  _updateSeedModal() {
    if (!this._seedModal) return;
    // Show when: farm unlocked, fully empty, no crop chosen yet, player inside
    const inside = this.farm.isInside(this.player.group.position);
    const shouldShow = this.farm.unlocked
      && this.farm.isFullyEmpty()
      && this.farm.cropKey === null
      && inside;
    this._seedModal.classList.toggle('show', shouldShow);
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
      }
    }
  }

  _updatePassiveHarvest(dt) {
    // Passive harvest only inside the farm plot (once unlocked)
    const h = this.world.tickFarmHarvest(this.farm, this.player.group.position, dt);
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

  _updateFarm(dt) {
    const unlockLevel = CONFIG.farm.unlockAtBalerLevel;
    const balerLevel = this.builds.sites.hayBaler.level;
    const shouldUnlock = balerLevel >= unlockLevel;
    if (shouldUnlock !== this.farm.unlocked) {
      this.farm.setUnlocked(shouldUnlock);
      if (shouldUnlock) toast('🌱 Farm plot unlocked! Plant seeds.');
    }
    this.farm.update(dt, this.world.harvestables);
    this._updateSeedModal();
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

  // Flight animations for offload. Capped to prevent overwhelming the GPU
  // when the player has accumulated dozens of crops/bales.
  _doDepositFlights(site, beforeCarry) {
    if (site.key !== 'market' || !site.tableSlots) return 0;
    const anchor = this.player.getCarryAnchor();
    const MAX_FLIGHTS = 12;
    // Cached geometries/materials (owned by this instance) to avoid allocating
    // per-spawn — was a suspected source of stalls with large carries.
    if (!this._flightProto) {
      this._flightProto = {
        bale:   { geo: new THREE.CylinderGeometry(0.22, 0.22, 0.32, 10), mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }) },
        planks: { geo: new THREE.BoxGeometry(0.5, 0.08, 0.18), mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }) },
        tomato: { geo: new THREE.SphereGeometry(0.18, 10, 8), mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }) },
        potato: { geo: new THREE.SphereGeometry(0.16, 8, 6), mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }) },
      };
    }
    let spawned = 0;
    const spawnOne = (key, indexInKey) => {
      if (spawned >= MAX_FLIGHTS) return;
      const proto = this._flightProto[key];
      if (!proto) return;
      const to = site.getAnyTableSlot() || new THREE.Vector3(site.position.x, 1.0, site.position.z);
      const startOffset = new THREE.Vector3(0, -0.2 + indexInKey * 0.18, 0).add(anchor);
      const endPos = to.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.3
      ));
      this.flight.spawn({
        geometry: proto.geo, material: proto.mat,
        startPos: startOffset, endPos,
        durationMs: 500 + indexInKey * 50,
        arcH: 1.5,
      });
      spawned++;
    };
    for (const key of ['bale', 'planks', 'tomato', 'potato']) {
      const count = Math.min(beforeCarry[key] || 0, 6); // at most 6 flight anims per key
      for (let i = 0; i < count; i++) spawnOne(key, i);
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
    this.customers.update(dt); // queue reads market._soldThisTick internally
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
    try {
      this._tick();
    } catch (e) {
      // Don't let a single frame error take the whole render loop down;
      // log and continue so the scheduled rAF below keeps firing.
      console.error('Frame error:', e);
    }
    requestAnimationFrame(this._loop);
  }

  _tick() {
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
    this.ambient.update(dt);
    this._updateFarm(dt);
    this._updatePickupables(dt);
    this._updateDropoff();
    this._updateMarketSystems(dt);
    this.upgrades.update(dt, this.player);
    this.buildingUpgrades.update(dt, this.player);
    this.buildingHires.update(dt, this.player);
    if (this.fenceLock && !this.fenceLock.unlocked) this.fenceLock.update(dt, this.player);
    this._updateCamera();
    this._updateGpsArrow(dt);
    this.floaters.update(dt);
    this._updateBuildPanel();

    this.renderer.render(this.scene, this.camera);
    this._tickFps(dt);
    // NOTE: no rAF here — _loop() schedules the next frame. A stray rAF in
    // both caused exponential callback growth → GPU TDR at ~5 seconds.
  }

  _tickFps(dt) {
    this._fpsAcc += dt;
    this._fpsFrames += 1;
    if (this._fpsAcc >= 0.5) {
      const fps = Math.round(this._fpsFrames / this._fpsAcc);
      if (this._fpsEl) {
        this._fpsEl.textContent = `FPS ${fps}`;
        this._fpsEl.classList.toggle('bad', fps < 20);
        this._fpsEl.classList.toggle('warn', fps >= 20 && fps < 45);
      }
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  }
}

new Game();
void PlayerStats;
