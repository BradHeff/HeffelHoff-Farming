import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory } from './state.js';

const RES_ICONS = { grass: '🌿', wood: '🪵', bale: '🌾', planks: '🪚', coin: '🪙' };

// Rounded chibi NPC using capsule + sphere primitives to avoid the blocky
// Minecraft look. Returns a group with userData.legs for walk animation.
function makeChibi(color, hatColor = 0xc69645) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xffcf87 });
  const shirt = new THREE.MeshLambertMaterial({ color });
  const pants = new THREE.MeshLambertMaterial({ color: 0x333a55 });

  const legGeo = new THREE.CapsuleGeometry(0.13, 0.35, 4, 8);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.14, 0.3, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legL, legR);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.3, 4, 10), shirt);
  torso.position.y = 0.85;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), skin);
  head.position.y = 1.45;
  g.add(head);

  // Tiny eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const eyeGeo = new THREE.SphereGeometry(0.035, 6, 6);
  const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.09, 1.48, 0.24);
  const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.09, 1.48, 0.24);
  g.add(eL, eR);

  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.06, 18),
    new THREE.MeshLambertMaterial({ color: hatColor })
  );
  hat.position.y = 1.7;
  g.add(hat);

  g.userData.legs = [legL, legR];
  g.userData.torso = torso;
  return g;
}

// Customer queue at the market. Animates a bale from the store table to the
// head customer on each market sale tick, then has them walk off-screen.
export class CustomerQueue {
  constructor(scene, camera, marketSite, flightManager) {
    this.scene = scene;
    this.camera = camera;
    this.marketSite = marketSite;
    this.flight = flightManager;
    this.active = false;
    this.customers = [];
    this.spawnTimer = 0;
    this._projVec = new THREE.Vector3();
  }

  setActive(v) {
    this.active = v;
    if (!v) {
      for (const c of this.customers) this._remove(c);
      this.customers.length = 0;
    }
  }

  _remove(c) {
    if (c.group) this.scene.remove(c.group);
    if (c.bubble) c.bubble.remove();
  }

  _spawn() {
    const cfg = CONFIG.customers;
    if (this.customers.filter((c) => !c.leaving).length >= cfg.maxQueue) return;
    const slot = this.customers.filter((c) => !c.leaving).length;
    const color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
    const group = makeChibi(color, 0xffffff);
    const spawnX = cfg.queueStart.x + cfg.queueDir.x * (cfg.maxQueue + 1) * cfg.spacing;
    const spawnZ = cfg.queueStart.z + cfg.queueDir.z * (cfg.maxQueue + 1) * cfg.spacing;
    group.position.set(spawnX, 0, spawnZ);
    group.rotation.y = Math.atan2(-cfg.queueDir.x, -cfg.queueDir.z);
    this.scene.add(group);

    const bubble = document.createElement('div');
    bubble.className = 'npc-bubble';
    const wantType = Math.random() < 0.5 ? 'bale' : 'planks';
    bubble.textContent = `${1 + Math.floor(Math.random() * 3)} ${RES_ICONS[wantType]}`;
    document.getElementById('world-overlay').appendChild(bubble);

    this.customers.push({
      group,
      bubble,
      slot,
      targetX: cfg.queueStart.x + cfg.queueDir.x * slot * cfg.spacing,
      targetZ: cfg.queueStart.z + cfg.queueDir.z * slot * cfg.spacing,
      walkPhase: 0,
      leaving: false,
      satisfiedTimer: 0,
    });
  }

  update(dt, soldKind) {
    if (!this.active) return;
    const cfg = CONFIG.customers;
    this.spawnTimer += dt;
    if (this.spawnTimer >= cfg.spawnIntervalSec) {
      this.spawnTimer = 0;
      this._spawn();
    }

    for (const c of this.customers) {
      const dx = c.targetX - c.group.position.x;
      const dz = c.targetZ - c.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, 2.8 * dt);
        c.group.position.x += (dx / dist) * step;
        c.group.position.z += (dz / dist) * step;
        c.walkPhase += dt * 8;
        if (c.group.userData.legs) {
          c.group.userData.legs[0].rotation.x = Math.sin(c.walkPhase) * 0.7;
          c.group.userData.legs[1].rotation.x = -Math.sin(c.walkPhase) * 0.7;
        }
      } else if (c.group.userData.legs) {
        c.group.userData.legs[0].rotation.x *= 0.8;
        c.group.userData.legs[1].rotation.x *= 0.8;
      }

      this._projVec.set(c.group.position.x, 2.1, c.group.position.z);
      const v = this._projVec.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      c.bubble.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
      c.bubble.style.opacity = (v.z > 0 && v.z < 1) ? (c.leaving ? '0' : '1') : '0';

      if (c.leaving) {
        c.satisfiedTimer += dt;
        if (c.satisfiedTimer > cfg.leaveAfterSec) this._remove(c);
      }
    }
    this.customers = this.customers.filter((c) => c.group.parent);

    if (soldKind) {
      const head = this.customers.find((c) => !c.leaving);
      if (head) {
        head.leaving = true;
        // Animate item flying from the market table to this customer
        const fromSlot = this.marketSite.getAnyTableSlot();
        if (fromSlot && this.flight) {
          const targetGroup = head.group;
          const isBale = soldKind === 'bale';
          const geo = isBale
            ? new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10)
            : new THREE.BoxGeometry(0.5, 0.08, 0.18);
          const mat = new THREE.MeshLambertMaterial({ color: isBale ? 0xe2c35a : 0xb77842 });
          this.flight.spawn({
            geometry: geo,
            material: mat,
            startPos: fromSlot.clone(),
            endFn: () => targetGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0)),
            durationMs: 520,
            arcH: 1.4,
          });
        }
        head.targetX = head.group.position.x + 6;
        head.targetZ = head.group.position.z + 2;
        for (const c of this.customers) {
          if (c.leaving || c.slot <= head.slot) continue;
          c.slot -= 1;
          c.targetX = cfg.queueStart.x + cfg.queueDir.x * c.slot * cfg.spacing;
          c.targetZ = cfg.queueStart.z + cfg.queueDir.z * c.slot * cfg.spacing;
        }
      }
    }
  }
}

// Helper NPC — hireable farmer that walks meadow → deposit loop endlessly.
export class Helper {
  constructor(scene, world, buildManager) {
    this.scene = scene;
    this.world = world;
    this.buildManager = buildManager;

    this.group = makeChibi(0x8a3a55, 0xe1b458);
    this.group.position.set(CONFIG.world.spawnPos.x, 0, CONFIG.world.spawnPos.z);
    scene.add(this.group);

    this.carried = 0;
    this.capacity = CONFIG.helpers.capacity;
    this.walkPhase = 0;
    this.state = 'toMeadow';
    this._pickTarget();
    this.harvestTimer = 0;
  }

  _pickTarget() {
    if (this.state === 'toMeadow') {
      const { meadow } = CONFIG.world;
      this.target = {
        x: meadow.minX + Math.random() * (meadow.maxX - meadow.minX),
        z: meadow.minZ + Math.random() * (meadow.maxZ - meadow.minZ),
      };
    } else if (this.state === 'toDepot') {
      const baler = this.buildManager.sites.hayBaler;
      const site = baler.completed ? baler : (this.buildManager.active || baler);
      const p = site.dropoffPos || site.position;
      this.target = { x: p.x + (Math.random() - 0.5) * 1.8, z: p.z + (Math.random() - 0.5) * 1.8 };
    }
  }

  update(dt) {
    const speed = CONFIG.helpers.moveSpeed;
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.2) {
      const step = Math.min(dist, speed * dt);
      this.group.position.x += (dx / dist) * step;
      this.group.position.z += (dz / dist) * step;
      this.walkPhase += dt * 10;
      if (this.group.userData.legs) {
        this.group.userData.legs[0].rotation.x = Math.sin(this.walkPhase) * 0.8;
        this.group.userData.legs[1].rotation.x = -Math.sin(this.walkPhase) * 0.8;
      }
      this.group.rotation.y = Math.atan2(dx / dist, dz / dist);
      return;
    }
    if (this.state === 'toMeadow') {
      this.state = 'harvesting';
      this.harvestTimer = 0;
    } else if (this.state === 'harvesting') {
      this.harvestTimer += dt;
      if (this.harvestTimer > 0.55) {
        this.harvestTimer = 0;
        let best = null; let bestD = Infinity;
        for (const h of this.world.harvestables) {
          if (h.removed || h.type !== 'grass') continue;
          const ddx = h.position.x - this.group.position.x;
          const ddz = h.position.z - this.group.position.z;
          const d = ddx * ddx + ddz * ddz;
          if (d < bestD) { bestD = d; best = h; }
        }
        if (best && bestD < 16) {
          this.world.removeHarvestable(best);
          this.carried += 1;
          if (this.carried >= this.capacity) {
            this.state = 'toDepot';
            this._pickTarget();
          }
        } else {
          this.state = 'toMeadow';
          this._pickTarget();
        }
      }
    } else if (this.state === 'toDepot') {
      Inventory.add('grass', this.carried);
      this.carried = 0;
      this.state = 'toMeadow';
      this._pickTarget();
    }
  }
}

export class HelperManager {
  constructor(scene, world, buildManager) {
    this.scene = scene;
    this.world = world;
    this.buildManager = buildManager;
    this.helpers = [];
  }
  hireCost() {
    const cfg = CONFIG.helpers;
    return Math.round(cfg.hireCostBase * Math.pow(cfg.costGrowth, this.helpers.length));
  }
  canHire() { return this.helpers.length < CONFIG.helpers.maxHelpers; }
  tryHire() {
    if (!this.canHire()) return false;
    const cost = this.hireCost();
    if (Inventory.coin < cost) return false;
    Inventory.coin -= cost;
    Inventory.emit();
    this.helpers.push(new Helper(this.scene, this.world, this.buildManager));
    return true;
  }
  update(dt) { for (const h of this.helpers) h.update(dt); }
}
