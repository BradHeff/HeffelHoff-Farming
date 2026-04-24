import * as THREE from 'three';
import { CONFIG } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { InputManager } from './input.js';
import { PickupManager } from './pickups.js';
import { Backpack, PlayerCarry, Inventory, PlayerStats, UserLevel } from './state.js';
import { BuildManager } from './buildings.js';
import { mountHUD, mountUserLevelPill, toast, bindBuildPanel, positionBuildPanel, RES_ICONS, showLevelBanner } from './hud.js';
import { FloaterManager, StickyLabel } from './floaters.js';
import { UpgradeManager } from './upgrades.js';
import { PlayerCoinTower } from './coins.js';
import { CustomerQueue, HelperManager, AmbientNpcManager, Shopkeeper, NPC_CARRY_PROTOS } from './npcs.js';
import { Tractor, TractorUnlockTile } from './tractor.js';
import { HarvesterCrew, HarvesterUnlockTile } from './harvester.js';
import { DustPuffManager } from './dust.js';
import { LockedPlot } from './locks.js';
import { FlightManager } from './flight.js';
import { Farm } from './farms.js';
import { BuildingUpgradeManager, BuildingHireManager, ExpansionTile, FarmHireManager, HelperTrainingTile } from './levels.js';
import { ParticleBurst } from './particles.js';
import { GoalManager } from './goals.js';
import { TraderEvent } from './trader.js';
import { showAuthScreen } from './auth.js';
import { applySave, startAutoSave } from './save.js';

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
    this.scene.background = this._makeSkyTexture();
    // Fog adds a per-fragment computation to every draw call. On some mobile
    // GPUs (notably WebView Mali/Adreno combos) this pushed frames past the
    // 5s TDR watchdog. Removed for now; draw distance is capped by the
    // camera far plane instead.

    // Punchier lighting — warm sun + cool ground bounce gives chibi models
    // a candy-bright shaded look instead of flat-green washed-out tones.
    const hemi = new THREE.HemisphereLight(0xfff4dc, 0x2e7d33, 0.85);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff1c8, 1.15);
    dir.position.set(20, 35, 10);
    this.scene.add(dir);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, this._aspect(), 0.1, 200);

    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    // Expose the expansion gate to the player's movement clamp
    this.player._expansionGateZ = this.world.expansionGateZ;
    this.player._expansionGateOpen = this.world.expansionGateOpen;
    this.pickups = new PickupManager(this.scene, this.player);
    this.pickups.onLand = (key, n) => {
      this._lifetimeCollected[key] = (this._lifetimeCollected[key] || 0) + n;
      if (this.goals) this.goals.update();
    };
    this.builds = new BuildManager(this.scene);
    this.input = new InputManager();
    this.floaters = new FloaterManager(this.camera);
    this.flight = new FlightManager(this.scene);
    this.fullLabel = new StickyLabel(this.camera, ''); // unused (uncapped pack)
    this.upgrades = new UpgradeManager(this.scene, this.camera);
    this.helpers = new HelperManager(this.scene, this.world, this.builds);
    this.ambient = new AmbientNpcManager(this.scene);
    this.coinTower = new PlayerCoinTower(this.player);
    this.farms = CONFIG.farms.map((cfg) => new Farm(this.scene, cfg));
    this.shopkeeper = new Shopkeeper(this.scene, this.builds.sites.market);
    this.customers = new CustomerQueue(
      this.scene, this.camera, this.builds.sites.market, this.flight,
      this.builds, this.farms, this.shopkeeper
    );
    this.customers.onSold = (key, qty) => {
      this._lifetimeSold[key] = (this._lifetimeSold[key] || 0) + qty;
      if (this.goals) this.goals.update();
    };
    this.dust = new DustPuffManager(this.scene);
    this.particles = new ParticleBurst(this.scene);
    this.helpers.setParticles(this.particles);
    this._buildGroundChevron();
    this._buildCrateStockPills();

    // Lifetime counters that goals read from (slashed-by-type, collected,
    // sold). GoalManager polls these + Inventory to track progress.
    this._countSlashed = { tree: 0, grass: 0, crop: 0 };
    this._lifetimeCollected = {};
    this._lifetimeSold = {};
    this._lifetimeCoinsEarned = 0;
    this._traderCompleted = 0;
    // Watch Inventory.coin for increments to aggregate lifetime earnings
    this._lastCoinSeen = 0;
    Inventory.subscribe(() => {
      const now = Inventory.coin || 0;
      if (now > this._lastCoinSeen) {
        this._lifetimeCoinsEarned += (now - this._lastCoinSeen);
      }
      this._lastCoinSeen = now;
    });
    this.goals = new GoalManager(this);

    // Farm patch auto-upgrades — every 2 user levels each farm grows +1 in
    // each axis, up to tier 3. Banner fires via the farm hook.
    UserLevel.subscribe(() => {
      const targetTier = Math.min(3, 1 + Math.floor((UserLevel.level - 1) / 2));
      for (const farm of this.farms) {
        while (farm.tier < targetTier && farm.unlocked) {
          const grew = farm.upgradeSize();
          if (!grew) break;
          showLevelBanner({
            tier: `FARM +SIZE`,
            name: `${farm.cols}×${farm.rows} bed`,
            icon: '🌱',
          });
          if (this.particles) {
            this.particles.burst(
              { x: farm.center.x, y: 1.0, z: farm.center.z },
              { count: 24, power: 5, ttl: 1.2, scale: 1.0 },
            );
          }
        }
      }
    });
    this.trader = new TraderEvent(
      this.scene, this.camera, this.builds, this.flight, this.particles,
    );
    this.trader.onComplete = () => {
      this._traderCompleted = (this._traderCompleted || 0) + 1;
      if (this.goals) this.goals.update();
    };
    this.buildingUpgrades = new BuildingUpgradeManager(this.scene, this.camera, this.builds);
    this.buildingHires = new BuildingHireManager(
      this.scene, this.camera, this.builds,
      (key) => {
        this.helpers.hireBuildingWorker(key);
        toast('👷 Worker hired!');
        const site = this.builds.sites[key];
        this._celebrate(site.position, 'hire');
      }
    );
    this.farmHires = new FarmHireManager(
      this.scene, this.camera, this.farms,
      (farm) => {
        this.helpers.hireFarmWorker(farm);
        toast('👩‍🌾 Farmer hired!');
        this._celebrate(farm.center, 'hire');
      }
    );

    this.dairyLock = new LockedPlot(
      this.scene, this.camera,
      CONFIG.world.buildPlots.dairyFarm, 120,
      () => {
        toast('🐄 Dairy Farm plot unlocked');
        this._celebrate(CONFIG.world.buildPlots.dairyFarm, 'unlock');
        showLevelBanner({ tier: 'UNLOCKED', name: 'Dairy Farm Plot', icon: '🐄' });
      },
      this.builds, 'dairyFarm'
    );

    // Sauce + Chips factories start locked. They reveal (become active build
    // plots) the moment the matching crop is chosen on any farm. This lets
    // the player progress naturally: grow crop → factory shows up → build it.
    this.builds.sites.sauceFactory.setLocked(true);
    this.builds.sites.chipsFactory.setLocked(true);
    this.builds.sites.eggFarm.setLocked(true);
    this.builds._updateActive();

    // Expansion tile — shows up after all main factories hit Level 3. When
    // activated, unlocks the locked biome strip and reveals the Egg Farm
    // plot for construction.
    this.helperTraining = null; // created after expansionTile below
    this.tractor = null;        // created on unlock
    this.tractorUnlock = new TractorUnlockTile(this.scene, this.camera, this.builds);
    this.tractorUnlock.onUnlock = (pos) => {
      this.tractor = new Tractor(
        this.scene, this.world, this.builds, NPC_CARRY_PROTOS, this.particles,
      );
      // Park the freshly-unlocked tractor where the preview was
      this.tractor.group.position.set(pos.x, 0, pos.z);
      this.tractor._pickRoamTarget();
    };
    this.harvester = null;      // created on unlock
    this.harvesterUnlock = new HarvesterUnlockTile(this.scene, this.camera, this.builds);
    this.harvesterUnlock.onUnlock = () => {
      this.harvester = new HarvesterCrew(
        this.scene, this.world, this.farms, this.builds, NPC_CARRY_PROTOS, this.particles,
      );
    };
    this.expansionTile = new ExpansionTile(
      this.scene, this.camera, CONFIG.expansion, this.builds, this.world,
      () => {
        toast('🗺️ Map expanded — Egg Farm + new fields unlocked!');
        this.builds.sites.eggFarm.setLocked(false);
        this.builds._updateActive();
        for (const farm of this.farms) {
          if (farm.requiresExpansion) farm.setExpansionUnlocked(true);
        }
        this.player._expansionGateOpen = true;
        this._celebrate(CONFIG.expansion.tilePos, 'unlock-big');
        showLevelBanner({ tier: 'MAP EXPANDED!', name: 'New Fields · Egg Farm', icon: '🗺️' });
      }
    );
    // Helper training tile — only reveals once expansion + all main builds done.
    this.helperTraining = new HelperTrainingTile(
      this.scene, this.camera, this.builds, this.expansionTile,
    );

    mountHUD();
    mountUserLevelPill();
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
    this._fpsEl = null; // FPS meter removed from HUD
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
        if (!this._pendingFarm) return;
        const crop = b.dataset.crop;
        const minLevel = parseInt(b.dataset.minLevel || '1', 10);
        if (UserLevel.level < minLevel) {
          toast(`🔒 Unlocks at Level ${minLevel}`);
          return;
        }
        this._pendingFarm.seed(crop, this.world.harvestables);
        modal.classList.remove('show');
      });
    });
    // Reflect current user level on the buttons (disabled styling)
    const refreshButtons = () => {
      buttons.forEach((b) => {
        const minLevel = parseInt(b.dataset.minLevel || '1', 10);
        b.classList.toggle('locked', UserLevel.level < minLevel);
      });
    };
    UserLevel.subscribe(refreshButtons);
    refreshButtons();
    this._seedModal = modal;
  }

  _updateSeedModal() {
    if (!this._seedModal) return;
    // Show when the player is standing inside an unlocked, unseeded farm.
    // _pendingFarm is what the modal buttons will seed on click.
    let pending = null;
    for (const farm of this.farms) {
      if (!farm.unlocked) continue;
      if (!farm.isFullyEmpty()) continue;
      if (farm.cropKey !== null) continue; // already chosen → auto re-seeds
      if (farm.isInside(this.player.group.position)) { pending = farm; break; }
    }
    this._pendingFarm = pending;
    this._seedModal.classList.toggle('show', !!pending);
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

  // Paints a wrap-around sky panorama: vertical blue gradient with soft
  // cloud blobs scattered horizontally. Used as scene.background (equirect
  // mapped) so the edges read as sky instead of a solid void.
  // Big yellow 3D arrow hovering at the active GPS target — matches the
  // reference game's "step here" ground chevron. Always visible whenever the
  // player has a current task destination.
  _buildGroundChevron() {
    const pivot = new THREE.Group();
    this.scene.add(pivot);
    const shape = new THREE.Shape();
    const s = 0.8;
    shape.moveTo(-0.35 * s, -0.6 * s);
    shape.lineTo(-0.35 * s,  0.2 * s);
    shape.lineTo(-0.9  * s,  0.2 * s);
    shape.lineTo( 0.00 * s,  1.0 * s);
    shape.lineTo( 0.9  * s,  0.2 * s);
    shape.lineTo( 0.35 * s,  0.2 * s);
    shape.lineTo( 0.35 * s, -0.6 * s);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    // Arrow apex points +Y in shape. We want it pointing DOWN at the target
    // (a big down-chevron hovering above the spot), so rotate X by -PI/2 so
    // the apex points down the world -Y axis.
    geo.rotateX(-Math.PI / 2);
    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0xffd24a, side: THREE.DoubleSide,
      transparent: true, opacity: 0.95, depthTest: false,
    });
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0x8a5a10, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85, depthTest: false,
    });
    const outline = new THREE.Mesh(geo, outlineMat);
    outline.scale.setScalar(1.22);
    outline.position.y = -0.03;
    outline.renderOrder = 998;
    const body = new THREE.Mesh(geo, bodyMat);
    body.renderOrder = 999;
    pivot.add(outline, body);
    pivot.visible = false;
    this.groundChevron = pivot;
    this._chevronBob = 0;
  }

  // DOM stock pills floating above each market crate. Updated each frame
  // via worldspace-to-screen projection of the column anchor.
  _buildCrateStockPills() {
    const keys = ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips', 'egg', 'milk'];
    this._cratePills = {};
    this._cratePillVec = new THREE.Vector3();
    const overlay = document.getElementById('world-overlay');
    for (const k of keys) {
      const el = document.createElement('div');
      el.className = 'crate-pill';
      el.innerHTML = `<span class="pill-icon">${RES_ICONS[k] || ''}</span><span class="pill-n">0</span>`;
      overlay.appendChild(el);
      this._cratePills[k] = el;
    }
  }

  _updateCrateStockPills() {
    const market = this.builds.sites.market;
    if (!market || !market._stockColumns || !this._cratePills) return;
    for (const [k, col] of Object.entries(market._stockColumns)) {
      const pill = this._cratePills[k];
      if (!pill) continue;
      const n = Inventory[k] || 0;
      if (n <= 0) { pill.style.opacity = '0'; continue; }
      pill.querySelector('.pill-n').textContent = n;
      this._cratePillVec.set(col.x, col.y + 0.9, col.z);
      const v = this._cratePillVec.project(this.camera);
      const onscreen = v.z > 0 && v.z < 1;
      if (!onscreen) { pill.style.opacity = '0'; continue; }
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      pill.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
      pill.style.opacity = '1';
    }
  }

  _updateGroundChevron(targetPos, visible, dt) {
    if (!this.groundChevron) return;
    this.groundChevron.visible = !!visible && !!targetPos;
    if (!this.groundChevron.visible) return;
    this._chevronBob += dt * 4.0;
    const bob = Math.sin(this._chevronBob) * 0.35;
    this.groundChevron.position.set(targetPos.x, 2.2 + bob, targetPos.z);
  }

  _makeSkyTexture() {
    const W = 1024, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // Vertical gradient — deep blue zenith down to pale horizon
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.0, '#2a8fe0');
    grad.addColorStop(0.45, '#78c6ff');
    grad.addColorStop(0.8, '#ccecff');
    grad.addColorStop(1.0, '#e0d9a0');  // warm haze at the horizon
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Fluffy cloud blobs — several stacked circles at various positions
    const drawCloud = (cx, cy, scale = 1, alpha = 0.85) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      const puffs = [
        [0, 0, 38], [28, -6, 30], [-30, -4, 32], [14, -20, 26], [-14, -18, 24],
        [48, 6, 22], [-48, 6, 24],
      ];
      for (const [dx, dy, r] of puffs) {
        ctx.beginPath();
        ctx.arc(cx + dx * scale, cy + dy * scale, r * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const cloudSpots = [
      [80, 120, 1.0], [260, 80, 1.2], [430, 150, 0.9], [580, 100, 1.1],
      [740, 160, 1.0], [880, 110, 1.3], [180, 220, 0.85], [520, 230, 0.95],
      [700, 250, 0.8], [360, 260, 1.0], [940, 240, 0.9],
    ];
    for (const [cx, cy, scale] of cloudSpots) {
      drawCloud(cx, cy, scale);
    }

    // Faint distant hills silhouette across the horizon band
    ctx.fillStyle = 'rgba(90, 142, 92, 0.6)';
    ctx.beginPath();
    ctx.moveTo(0, H - 40);
    const hillsSeed = [
      0, -22, 60, -8, 130, -30, 200, -12, 280, -38, 360, -18, 430, -44, 510,
      -20, 590, -34, 670, -12, 740, -28, 820, -18, 910, -34, 980, -14, W, -26,
    ];
    for (let i = 0; i < hillsSeed.length; i += 2) {
      ctx.lineTo(hillsSeed[i], H - 40 + hillsSeed[i + 1]);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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
    // Slash fires whenever targets are in range — player no longer has to
    // be moving. When stationary, treat the slash as a full 360° sweep so
    // you don't have to aim manually; when walking, keep the directional
    // arc so slashes visually follow motion.
    if (!this.player.canSlash()) return;
    const arcDeg = this.player.isMoving ? CONFIG.player.slashArcDeg : 360;
    const hits = this.world.queryInSlashArc(
      this.player.group.position,
      this.player.forward,
      PlayerStats.slashRadius,
      arcDeg
    );
    if (hits.length === 0) return;
    this.player.startSlash();
    // Bigger bright-white slash puff in front of the player — matches the
    // ref video's dust-cloud-per-swing beat.
    if (this.dust) {
      const p = this.player.group.position;
      const f = this.player.forward;
      this.dust.spawn(p.x + f.x * 1.1, p.z + f.z * 1.1, 'slash');
    }
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
        // Count slashed-by-type for goal progress (cut N trees / grass / etc)
        if (h.type === 'tree') this._countSlashed.tree++;
        else if (h.type === 'grass') this._countSlashed.grass++;
        else if (h.kind === 'cropCell') this._countSlashed.crop++;
        // Note: _lifetimeCollected is bumped in PickupManager.onLand instead,
        // so produced items (bales etc.) count too.
        if (this.goals) this.goals.update();
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

  _updateDust(dt) {
    this.dust.update(dt);
    if (!this.player.isMoving) return;
    this._dustTimer = (this._dustTimer || 0) + dt;
    if (this._dustTimer < 0.25) return;
    this._dustTimer = 0;
    const p = this.player.group.position;
    const yaw = this.player.bodyGroup.rotation.y;
    // Drop the puff slightly behind the player's feet + small lateral jitter
    const bx = p.x - Math.sin(yaw) * 0.25 + (Math.random() - 0.5) * 0.18;
    const bz = p.z - Math.cos(yaw) * 0.25 + (Math.random() - 0.5) * 0.18;
    this.dust.spawn(bx, bz);
  }

  _updateFactoryUnlocks() {
    // Any farm with tomato unlocks the sauce factory; any with potato opens
    // the chips factory.
    const anyTomato = this.farms.some((f) => f.cropKey === 'tomato');
    const anyPotato = this.farms.some((f) => f.cropKey === 'potato');
    if (anyTomato && this.builds.sites.sauceFactory._locked) {
      this.builds.sites.sauceFactory.setLocked(false);
      this.builds._updateActive();
      toast('🍶 Sauce Factory plot opened — build it!');
    }
    if (anyPotato && this.builds.sites.chipsFactory._locked) {
      this.builds.sites.chipsFactory.setLocked(false);
      this.builds._updateActive();
      toast('🍟 Chips Factory plot opened — build it!');
    }
  }

  _updateFarm(dt) {
    for (const farm of this.farms) {
      const unlockLevel = farm.cfg.unlockAtBalerLevel;
      const balerLevel = this.builds.sites.hayBaler.level;
      // Expansion-gated farms need the expansion tile activated first.
      const gated = farm.requiresExpansion && !farm.expansionUnlocked;
      const shouldUnlock = !gated && balerLevel >= unlockLevel;
      if (shouldUnlock !== farm.unlocked) {
        farm.setUnlocked(shouldUnlock);
        if (shouldUnlock) toast('🌱 Farm plot unlocked! Plant seeds.');
      }
      farm.update(dt, this.world.harvestables);
    }
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
    this._updateGroundChevron(target, !!target, dt);
    this._updateCrateStockPills();
  }

  // Flight animations for offload. Capped to prevent overwhelming the GPU
  // when the player has accumulated dozens of crops/bales.
  _doDepositFlights(site, beforeCarry) {
    if (site.key !== 'market' || !site.tableSlots) return 0;
    const anchor = this.player.getCarryAnchor();
    const MAX_FLIGHTS = 16;
    // Cached geometries/materials (owned by this instance) to avoid allocating
    // per-spawn. Expanded to cover every sellable good so offloads read for
    // every market-bound item the player might dump, not just four.
    if (!this._flightProto) {
      this._flightProto = {
        bale:   { geo: new THREE.CylinderGeometry(0.22, 0.22, 0.32, 10), mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }) },
        planks: { geo: new THREE.BoxGeometry(0.5, 0.08, 0.18), mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }) },
        tomato: { geo: new THREE.SphereGeometry(0.18, 10, 8), mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }) },
        potato: { geo: new THREE.SphereGeometry(0.16, 8, 6), mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }) },
        sauce:  { geo: new THREE.CylinderGeometry(0.1, 0.13, 0.3, 10), mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }) },
        chips:  { geo: new THREE.BoxGeometry(0.25, 0.2, 0.2), mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }) },
        egg:    { geo: new THREE.SphereGeometry(0.14, 10, 8), mat: new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }) },
        milk:   { geo: new THREE.CylinderGeometry(0.13, 0.1, 0.3, 10), mat: new THREE.MeshLambertMaterial({ color: 0xffffff }) },
      };
      this._flightProto.egg.geo.scale(1, 1.25, 1);
    }
    let spawned = 0;
    // Build the full queue across all keys so delays are monotonic across
    // the whole offload — "rhythmic deposit" feel instead of parallel arcs.
    const order = ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips', 'egg', 'milk'];
    const queue = [];
    for (const key of order) {
      const count = Math.min(beforeCarry[key] || 0, 8);
      for (let i = 0; i < count; i++) queue.push({ key, indexInKey: i });
    }
    const STAGGER_MS = 90;
    for (let q = 0; q < queue.length && spawned < MAX_FLIGHTS; q++, spawned++) {
      const { key, indexInKey } = queue[q];
      const proto = this._flightProto[key];
      if (!proto) continue;
      const to = site.getAnyTableSlot() || new THREE.Vector3(site.position.x, 1.0, site.position.z);
      const startOffset = new THREE.Vector3(0, -0.2 + indexInKey * 0.18, 0).add(anchor);
      const endPos = to.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.3
      ));
      this.flight.spawn({
        geometry: proto.geo, material: proto.mat,
        startPos: startOffset, endPos,
        durationMs: 440,
        arcH: 1.4,
        delayMs: q * STAGGER_MS,
      });
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
    // Flip the SELL tile to its "active" thick-blue highlight whenever the
    // player steps into the drop zone — communicates drop-ready state.
    if (market.sellDecal) {
      const dp = market.dropoffPos || market.position;
      const p = this.player.group.position;
      const inside = Math.hypot(p.x - dp.x, p.z - dp.z) < market.radius;
      market.sellDecal.setHighlighted(inside);
    }
  }

  // Fire a ParticleBurst tuned to the event kind. Small for routine hires,
  // big rainbow cone for rare map unlocks.
  _celebrate(pos, kind) {
    if (!this.particles) return;
    const src = { x: pos.x, y: 1.4, z: pos.z };
    switch (kind) {
      case 'level-up':
        this.particles.burst(src, { count: 26, power: 6.5, ttl: 1.3, scale: 1.1 });
        break;
      case 'complete':
        this.particles.burst(src, { count: 32, power: 6.8, ttl: 1.4, scale: 1.15 });
        break;
      case 'hire':
        this.particles.burst(src, {
          count: 14, power: 4.2, ttl: 0.95, scale: 0.9,
          colors: [0xffe166, 0x6fff6b, 0xffffff, 0x4ad5ff],
        });
        break;
      case 'unlock':
        this.particles.burst(src, { count: 22, power: 5.5, ttl: 1.2, scale: 1.05 });
        break;
      case 'unlock-big':
        this.particles.burst(src, { count: 60, power: 7.5, ttl: 1.8, scale: 1.25 });
        break;
      default:
        this.particles.burst(src, { count: 14, power: 4.5, ttl: 1.0 });
    }
  }

  // Polls build sites for level / completion changes each frame and fires a
  // celebratory burst on any transition. Using a poll rather than callbacks
  // means we don't have to thread event plumbing through BuildManager.
  _updateCelebrations() {
    if (!this._celebState) {
      this._celebState = { complete: {}, level: {} };
      for (const k of Object.keys(this.builds.sites)) {
        const s = this.builds.sites[k];
        this._celebState.complete[k] = !!s.completed;
        this._celebState.level[k] = s.level || 1;
      }
    }
    const st = this._celebState;
    for (const k of Object.keys(this.builds.sites)) {
      const s = this.builds.sites[k];
      if (s.completed && !st.complete[k]) {
        st.complete[k] = true;
        this._celebrate(s.position, 'complete');
        if (s.triggerScalePunch) s.triggerScalePunch();
        showLevelBanner({
          tier: 'BUILT!',
          name: s.recipe.name,
          icon: s.recipe.icon || '🏗️',
        });
      }
      const prev = st.level[k] || 1;
      if ((s.level || 1) > prev) {
        st.level[k] = s.level;
        this._celebrate(s.position, 'level-up');
        if (s.triggerScalePunch) s.triggerScalePunch();
        showLevelBanner({
          tier: `LEVEL ${s.level}`,
          name: s.recipe.name,
          icon: s.recipe.icon || '⭐',
        });
      }
    }
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
    this.shopkeeper.update(dt);
    this._updateDust(dt);
    this._updateFarm(dt);
    this._updateFactoryUnlocks();
    this._updatePickupables(dt);
    this._updateDropoff();
    this._updateMarketSystems(dt);
    this.upgrades.update(dt, this.player);
    this.buildingUpgrades.update(dt, this.player);
    this.buildingHires.update(dt, this.player);
    this.farmHires.update(dt, this.player);
    if (this.expansionTile) this.expansionTile.update(dt, this.player);
    if (this.helperTraining) this.helperTraining.update(dt, this.player);
    if (this.tractorUnlock) this.tractorUnlock.update(dt, this.player, this.particles);
    if (this.tractor) this.tractor.update(dt);
    if (this.harvesterUnlock) this.harvesterUnlock.update(dt, this.player, this.particles);
    if (this.harvester) this.harvester.update(dt);
    if (this.trader) this.trader.update(dt, this.player);
    if (this.dairyLock && !this.dairyLock.unlocked) this.dairyLock.update(dt, this.player);
    this._updateCamera();
    this._updateGpsArrow(dt);
    this._updateCelebrations();
    if (this.particles) this.particles.update(dt);
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

// Show the auth start screen first; once the player is logged in (or has
// chosen to play offline) we instantiate the game and apply any saved
// state before the first frame.
(async () => {
  const { auth, savedState } = await showAuthScreen();
  const game = new Game();
  if (savedState) {
    try { applySave(game, savedState); } catch (err) {
      console.warn('[main] applySave failed:', err);
    }
  }
  startAutoSave(game, auth);
  // Expose for debugging
  if (typeof window !== 'undefined') {
    window.__hh = { game, auth };
  }
})();
void PlayerStats;
