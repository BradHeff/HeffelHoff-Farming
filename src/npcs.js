import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory } from './state.js';

const RES_ICONS = { grass: '🌿', wood: '🪵', bale: '🌾', planks: '🪚', coin: '🪙' };

// Shared chibi geometry pool — created ONCE at module load. Every spawned
// NPC reuses these buffers. Materials per-color are cached below.
const CHIBI_GEOS = {
  leg: new THREE.CapsuleGeometry(0.13, 0.35, 4, 8),
  torso: new THREE.CapsuleGeometry(0.26, 0.3, 4, 10),
  head: new THREE.SphereGeometry(0.26, 16, 12),
  eye: new THREE.SphereGeometry(0.035, 6, 6),
  hat: new THREE.CylinderGeometry(0.38, 0.38, 0.06, 18),
};
const CHIBI_SKIN_MAT = new THREE.MeshLambertMaterial({ color: 0xffcf87 });
const CHIBI_PANTS_MAT = new THREE.MeshLambertMaterial({ color: 0x333a55 });
const CHIBI_EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const CHIBI_SHIRT_MATS = new Map(); // keyed by color int
const CHIBI_HAT_MATS = new Map();
function chibiShirtMat(color) {
  let m = CHIBI_SHIRT_MATS.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); CHIBI_SHIRT_MATS.set(color, m); }
  return m;
}
function chibiHatMat(color) {
  let m = CHIBI_HAT_MATS.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); CHIBI_HAT_MATS.set(color, m); }
  return m;
}

// Rounded chibi NPC using shared capsule + sphere primitives.
function makeChibi(color, hatColor = 0xc69645) {
  const g = new THREE.Group();
  const shirt = chibiShirtMat(color);
  const hat = chibiHatMat(hatColor);
  const legL = new THREE.Mesh(CHIBI_GEOS.leg, CHIBI_PANTS_MAT);
  legL.position.set(-0.14, 0.3, 0);
  const legR = new THREE.Mesh(CHIBI_GEOS.leg, CHIBI_PANTS_MAT);
  legR.position.set(0.14, 0.3, 0);
  g.add(legL, legR);

  const torso = new THREE.Mesh(CHIBI_GEOS.torso, shirt);
  torso.position.y = 0.85;
  g.add(torso);

  const head = new THREE.Mesh(CHIBI_GEOS.head, CHIBI_SKIN_MAT);
  head.position.y = 1.45;
  g.add(head);

  const eL = new THREE.Mesh(CHIBI_GEOS.eye, CHIBI_EYE_MAT); eL.position.set(-0.09, 1.48, 0.24);
  const eR = new THREE.Mesh(CHIBI_GEOS.eye, CHIBI_EYE_MAT); eR.position.set(0.09, 1.48, 0.24);
  g.add(eL, eR);

  const hatMesh = new THREE.Mesh(CHIBI_GEOS.hat, hat);
  hatMesh.position.y = 1.7;
  g.add(hatMesh);

  g.userData.legs = [legL, legR];
  g.userData.torso = torso;
  return g;
}

// Customer queue at the market. Each customer has a state machine:
//   approach: walking toward their assigned queue slot
//   wait:     standing in slot, bubble visible — not served yet
//   receive:  head of line, item flying from table, ~0.6s animation
//   leave:    walking off, bubble fading
// Market sale logic is driven by this queue — we call market.requestSale()
// whenever the head is waiting and we want to buy. Market consumes from
// Inventory and replies with market._soldThisTick (key of sold resource).
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

  _slotPos(slot) {
    const cfg = CONFIG.customers;
    return {
      x: cfg.queueStart.x + cfg.queueDir.x * slot * cfg.spacing,
      z: cfg.queueStart.z + cfg.queueDir.z * slot * cfg.spacing,
    };
  }

  _spawn() {
    const cfg = CONFIG.customers;
    // Count active (not leaving) to determine next free slot
    const activeCount = this.customers.filter((c) => c.state !== 'leave').length;
    if (activeCount >= cfg.maxQueue) return;
    const slot = activeCount;
    const color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
    const group = makeChibi(color, 0xffffff);
    const entry = this._slotPos(cfg.maxQueue + 1); // walk in from past the last slot
    group.position.set(entry.x, 0, entry.z);
    group.rotation.y = Math.atan2(-cfg.queueDir.x, -cfg.queueDir.z);
    this.scene.add(group);

    const bubble = document.createElement('div');
    bubble.className = 'npc-bubble';
    const options = ['bale', 'planks', 'tomato', 'potato'];
    const wantType = options[Math.floor(Math.random() * options.length)];
    bubble.textContent = `${1 + Math.floor(Math.random() * 3)} ${RES_ICONS[wantType] || '?'}`;
    document.getElementById('world-overlay').appendChild(bubble);

    const target = this._slotPos(slot);
    this.customers.push({
      group,
      bubble,
      slot,
      targetX: target.x,
      targetZ: target.z,
      walkPhase: 0,
      state: 'approach',
      stateTimer: 0,
    });
  }

  _reassignSlots() {
    // After a customer leaves, shift everyone forward by one slot
    const cfg = CONFIG.customers;
    const staying = this.customers.filter((c) => c.state !== 'leave');
    staying.sort((a, b) => a.slot - b.slot);
    staying.forEach((c, i) => {
      c.slot = i;
      const t = this._slotPos(i);
      c.targetX = t.x; c.targetZ = t.z;
      // If they were already waiting, transition back to approach so they
      // walk forward to the new slot smoothly.
      if (c.state === 'wait') c.state = 'approach';
    });
  }

  update(dt) {
    if (!this.active) return;
    const cfg = CONFIG.customers;
    this.spawnTimer += dt;
    if (this.spawnTimer >= cfg.spawnIntervalSec) {
      this.spawnTimer = 0;
      this._spawn();
    }

    // Per-customer state update
    for (const c of this.customers) {
      // Movement for 'approach' and 'leave' states
      if (c.state === 'approach' || c.state === 'leave') {
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
        } else if (c.state === 'approach') {
          c.state = 'wait';
          c.stateTimer = 0;
        }
      } else if (c.group.userData.legs) {
        c.group.userData.legs[0].rotation.x *= 0.8;
        c.group.userData.legs[1].rotation.x *= 0.8;
      }

      if (c.state === 'receive') {
        c.stateTimer += dt;
        if (c.stateTimer > 0.55) {
          c.state = 'leave';
          // Walk out past the end of the queue
          c.targetX = c.group.position.x + 8;
          c.targetZ = c.group.position.z + 2;
        }
      }

      // Bubble follow
      this._projVec.set(c.group.position.x, 2.1, c.group.position.z);
      const v = this._projVec.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      c.bubble.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
      c.bubble.style.opacity = (v.z > 0 && v.z < 1 && c.state === 'wait') ? '1' : '0';
    }

    // Remove fully-left customers once they're far from their exit point
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      if (c.state !== 'leave') continue;
      const dx = c.targetX - c.group.position.x;
      const dz = c.targetZ - c.group.position.z;
      if (Math.hypot(dx, dz) < 0.2) {
        this._remove(c);
        this.customers.splice(i, 1);
      }
    }

    // Serve: if head customer is waiting, ask market to sell.
    const head = this.customers.find((c) => c.slot === 0 && c.state === 'wait');
    if (head) {
      this.marketSite.requestSale();
    }
    // Check if market sold this tick; if so, animate bale → head customer
    const sold = this.marketSite._soldThisTick;
    this.marketSite._soldThisTick = null;
    if (sold && head) {
      head.state = 'receive';
      head.stateTimer = 0;
      const from = this.marketSite.getTopStockSlot(sold)
        || this.marketSite.getAnyTableSlot()
        || new THREE.Vector3(this.marketSite.position.x, 1.2, this.marketSite.position.z);
      if (this.flight) {
        const proto = CUSTOMER_FLIGHT_PROTOS[sold] || CUSTOMER_FLIGHT_PROTOS.bale;
        this.flight.spawn({
          geometry: proto.geo, material: proto.mat,
          startPos: from.clone(),
          endFn: () => head.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)),
          durationMs: 520, arcH: 1.4,
        });
      }
      // Vacate head's slot for the next one
      this._reassignSlots();
    }
  }
}

// Shared geometries + materials for customer-buy flight meshes. Created once
// at module load; every flight reuses these so we don't leak GPU buffers.
const CUSTOMER_FLIGHT_PROTOS = {
  bale:   { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10), mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }) },
  planks: { geo: new THREE.BoxGeometry(0.5, 0.08, 0.18),         mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }) },
  tomato: { geo: new THREE.SphereGeometry(0.18, 10, 8),          mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }) },
  potato: { geo: new THREE.SphereGeometry(0.16, 8, 6),           mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }) },
};

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

// Wandering NPC — purely cosmetic. Walks random loops carrying props
// (hay bundle, watering can, pitchfork). Doesn't interact with gameplay.
export class WanderingNpc {
  constructor(scene, bounds) {
    this.scene = scene;
    this.bounds = bounds;
    const shirtColors = [0x3a7dd6, 0xd4493c, 0x8a5ed1, 0xd4a53a, 0x3e9d6e];
    const hatColors   = [0xe1b458, 0xffffff, 0x5a3a2a, 0x2a3a5a];
    this.group = makeChibi(
      shirtColors[Math.floor(Math.random() * shirtColors.length)],
      hatColors[Math.floor(Math.random() * hatColors.length)]
    );
    this.group.position.set(
      bounds.x0 + Math.random() * (bounds.x1 - bounds.x0),
      0,
      bounds.z0 + Math.random() * (bounds.z1 - bounds.z0)
    );
    scene.add(this.group);

    // Random prop
    const propKind = Math.floor(Math.random() * 3);
    const prop = new THREE.Group();
    if (propKind === 0) {
      // Hay bundle in hands
      const b = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.3, 10),
        new THREE.MeshLambertMaterial({ color: 0xe2c35a })
      );
      b.rotation.z = Math.PI / 2;
      b.position.set(0, 1.0, 0.35);
      prop.add(b);
    } else if (propKind === 1) {
      // Watering can
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.25, 12),
        new THREE.MeshLambertMaterial({ color: 0x4a90c4 })
      );
      body.position.set(0.25, 0.95, 0.25);
      const spout = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.22, 6),
        new THREE.MeshLambertMaterial({ color: 0x4a90c4 })
      );
      spout.rotation.z = Math.PI / 3;
      spout.position.set(0.43, 1.0, 0.25);
      prop.add(body, spout);
    } else {
      // Pitchfork over the shoulder
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6),
        new THREE.MeshLambertMaterial({ color: 0x7a5232 })
      );
      handle.rotation.z = 0.4;
      handle.position.set(0.18, 1.35, -0.2);
      const tines = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.3, 0.24),
        new THREE.MeshLambertMaterial({ color: 0xbac1c7 })
      );
      tines.position.set(0.4, 1.85, -0.2);
      prop.add(handle, tines);
    }
    this.group.add(prop);

    this.walkPhase = 0;
    this.speed = 1.8 + Math.random() * 0.8;
    this.idleTimer = 0;
    this._pickTarget();
  }

  _pickTarget() {
    const b = this.bounds;
    this.target = {
      x: b.x0 + Math.random() * (b.x1 - b.x0),
      z: b.z0 + Math.random() * (b.z1 - b.z0),
    };
  }

  update(dt) {
    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      if (this.group.userData.legs) {
        this.group.userData.legs[0].rotation.x *= 0.85;
        this.group.userData.legs[1].rotation.x *= 0.85;
      }
      return;
    }
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) {
      // Pause at target, then pick a new one
      this.idleTimer = 1.5 + Math.random() * 2.0;
      this._pickTarget();
      return;
    }
    const step = Math.min(dist, this.speed * dt);
    this.group.position.x += (dx / dist) * step;
    this.group.position.z += (dz / dist) * step;
    this.walkPhase += dt * 8;
    if (this.group.userData.legs) {
      this.group.userData.legs[0].rotation.x = Math.sin(this.walkPhase) * 0.7;
      this.group.userData.legs[1].rotation.x = -Math.sin(this.walkPhase) * 0.7;
    }
    this.group.rotation.y = Math.atan2(dx / dist, dz / dist);
  }
}

export class AmbientNpcManager {
  constructor(scene) {
    this.npcs = [];
    // Trimmed to 2 — chibi NPCs add 8 draw calls each.
    const bounds = [
      { x0: -20, x1: -10, z0: 6, z1: 18 },
      { x0: 10, x1: 22, z0: 20, z1: 28 },
    ];
    for (const b of bounds) this.npcs.push(new WanderingNpc(scene, b));
  }
  update(dt) { for (const n of this.npcs) n.update(dt); }
}

// BuildingWorker — ferries produced items (bales/planks) from a factory
// output pad to the market's table stock. Loop: factory → pickup up to cap →
// walk to market SELL zone → deposit to Inventory → walk back.
export class BuildingWorker {
  constructor(scene, buildingKey, buildSite, marketSite) {
    this.scene = scene;
    this.buildingKey = buildingKey;
    this.site = buildSite;
    this.market = marketSite;
    this.group = makeChibi(0x3c6e8a, 0x5a3a2a);
    this.group.position.copy(buildSite.position);
    scene.add(this.group);
    this.carrying = {};
    this.cap = CONFIG.buildingWorker.carryCap;
    this.state = 'toFactory';
    this.walkPhase = 0;
    this._pickTarget();
  }

  _pickTarget() {
    if (this.state === 'toFactory') {
      // Factory pad is roughly (site.position.x + 2.7, z)
      const p = this.site.position;
      this.target = { x: p.x + 2.5, z: p.z };
    } else if (this.state === 'toMarket') {
      const p = this.market.dropoffPos || this.market.position;
      this.target = { x: p.x + (Math.random() - 0.5) * 1.2, z: p.z + (Math.random() - 0.5) * 0.6 };
    }
  }

  _carriedTotal() {
    return Object.values(this.carrying).reduce((a, b) => a + b, 0);
  }

  update(dt) {
    const speed = CONFIG.buildingWorker.moveSpeed;
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
    if (this.state === 'toFactory') {
      // Take up to `cap` produced items from the pad
      const items = this.site.producedItems || [];
      let taken = 0;
      for (let i = items.length - 1; i >= 0 && taken < this.cap; i--) {
        const it = items[i];
        if (it.collected) continue;
        it.collected = true;
        if (it.mesh && it.mesh.parent) it.mesh.parent.remove(it.mesh);
        this.carrying[it.resourceKey] = (this.carrying[it.resourceKey] || 0) + 1;
        taken++;
      }
      if (this._carriedTotal() > 0) {
        this.state = 'toMarket';
        this._pickTarget();
      } else {
        // Nothing to carry — idle briefly and retry
        this._pickTarget();
      }
    } else if (this.state === 'toMarket') {
      // Deposit into Inventory (market shelf picks it up visually)
      for (const [k, v] of Object.entries(this.carrying)) {
        if (v > 0) Inventory.add(k, v);
      }
      this.carrying = {};
      this.state = 'toFactory';
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
    this.buildingWorkers = [];
  }

  hireBuildingWorker(buildingKey) {
    const site = this.buildManager.sites[buildingKey];
    const market = this.buildManager.sites.market;
    if (!site || !market) return;
    this.buildingWorkers.push(new BuildingWorker(this.scene, buildingKey, site, market));
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
  update(dt) {
    for (const h of this.helpers) h.update(dt);
    for (const w of this.buildingWorkers) w.update(dt);
  }
}
