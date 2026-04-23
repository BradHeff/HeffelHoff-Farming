import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory } from './state.js';
import { RES_ICONS } from './hud.js';
import { getFaceMaterial } from './faces.js';

// Shared chibi geometry pool — created ONCE at module load. Every spawned
// NPC reuses these buffers. Materials per-color are cached below.
const CHIBI_GEOS = {
  leg: new THREE.CapsuleGeometry(0.13, 0.35, 4, 8),
  torso: new THREE.CapsuleGeometry(0.26, 0.3, 4, 10),
  head: new THREE.SphereGeometry(0.26, 16, 12),
  eye: new THREE.SphereGeometry(0.04, 6, 6),
  hat: new THREE.CylinderGeometry(0.38, 0.38, 0.06, 18),
  hatTop: new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  arm: new THREE.CapsuleGeometry(0.09, 0.28, 4, 6),
  hand: new THREE.SphereGeometry(0.11, 10, 8),
  mouth: new THREE.SphereGeometry(0.05, 8, 6),
  hair: new THREE.SphereGeometry(0.28, 12, 8),
};
const CHIBI_SKIN_MAT = new THREE.MeshLambertMaterial({ color: 0xffcf87 });
const CHIBI_PANTS_MAT = new THREE.MeshLambertMaterial({ color: 0x333a55 });
const CHIBI_EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const CHIBI_MOUTH_MAT = new THREE.MeshBasicMaterial({ color: 0x8a3020 });
const CHIBI_SHIRT_MATS = new Map(); // keyed by color int
const CHIBI_HAT_MATS = new Map();
const CHIBI_HAIR_MATS = new Map();
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
function chibiHairMat(color) {
  let m = CHIBI_HAIR_MATS.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); CHIBI_HAIR_MATS.set(color, m); }
  return m;
}

const HAIR_COLORS = [0x3a2412, 0x8a5232, 0xd4a552, 0x5a3820, 0x2a2018, 0xa86a42];

// Shared geometry + material for items NPCs carry. Created once; every
// worker/helper reuses these buffers (no GPU leak across hundreds of trips).
const NPC_CARRY_PROTOS = {
  grass:  { geo: new THREE.IcosahedronGeometry(0.16, 0),            mat: new THREE.MeshLambertMaterial({ color: 0x5bbf3d }), rotZ: 0 },
  wood:   { geo: new THREE.BoxGeometry(0.22, 0.16, 0.16),            mat: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }), rotZ: 0 },
  bale:   { geo: new THREE.CylinderGeometry(0.17, 0.17, 0.28, 10),   mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }), rotZ: Math.PI / 2 },
  planks: { geo: new THREE.BoxGeometry(0.42, 0.07, 0.16),            mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }), rotZ: 0 },
  tomato: { geo: new THREE.SphereGeometry(0.14, 10, 8),              mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }), rotZ: 0 },
  potato: { geo: new THREE.SphereGeometry(0.13, 8, 6),               mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }), rotZ: 0 },
  sauce:  { geo: new THREE.CylinderGeometry(0.09, 0.11, 0.24, 10),   mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }), rotZ: 0 },
  chips:  { geo: new THREE.BoxGeometry(0.22, 0.18, 0.14),            mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }), rotZ: 0 },
  egg:    { geo: new THREE.SphereGeometry(0.12, 10, 8),              mat: new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }), rotZ: 0 },
};
NPC_CARRY_PROTOS.egg.geo.scale(1, 1.25, 1);

// Renders an NPC's carried load as a small stack in front of their torso.
// Items = { bale: 3 }, { grass: 5 }, etc. Mesh pool grows as needed and is
// reused across trips so there are no allocations while walking.
function setNpcCarry(group, items) {
  const sig = Object.entries(items || {}).map(([k, v]) => `${k}:${v}`).join(',');
  if (group.userData.carrySig === sig) return;
  group.userData.carrySig = sig;

  if (!group.userData.carryGroup) {
    const cg = new THREE.Group();
    cg.position.set(0, 0.9, 0.3); // front of torso
    group.add(cg);
    group.userData.carryGroup = cg;
    group.userData.carryMeshes = [];
  }
  const cg = group.userData.carryGroup;
  const meshes = group.userData.carryMeshes;

  // Build stack sequence, cap at 6 visible for readability
  const seq = [];
  for (const [k, n] of Object.entries(items || {})) {
    for (let i = 0; i < n && seq.length < 6; i++) seq.push(k);
  }

  while (meshes.length < seq.length) {
    const m = new THREE.Mesh(NPC_CARRY_PROTOS.grass.geo, NPC_CARRY_PROTOS.grass.mat);
    m.visible = false;
    cg.add(m);
    meshes.push(m);
  }

  let y = 0;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (i >= seq.length) { m.visible = false; continue; }
    const proto = NPC_CARRY_PROTOS[seq[i]] || NPC_CARRY_PROTOS.grass;
    m.visible = true;
    m.geometry = proto.geo;
    m.material = proto.mat;
    m.position.set(((i * 41) % 9 - 4) * 0.01, y, 0);
    m.rotation.z = proto.rotZ;
    y += 0.18;
  }
}

// Shared walk-cycle helpers so every NPC animates the same way.
function animateWalk(group, phase) {
  const legs = group.userData.legs;
  const arms = group.userData.arms;
  if (legs) {
    legs[0].rotation.x = Math.sin(phase) * 0.7;
    legs[1].rotation.x = -Math.sin(phase) * 0.7;
  }
  if (arms) {
    arms[0].rotation.x = -Math.sin(phase) * 0.5;
    arms[1].rotation.x =  Math.sin(phase) * 0.5;
  }
}
function damperWalk(group) {
  const legs = group.userData.legs;
  const arms = group.userData.arms;
  if (legs) { legs[0].rotation.x *= 0.8; legs[1].rotation.x *= 0.8; }
  if (arms) { arms[0].rotation.x *= 0.8; arms[1].rotation.x *= 0.8; }
}

// Rounded chibi NPC. Head uses a CanvasTexture-painted face (eyes, mouth,
// blush, eyebrows) — much more expressive than stacked primitive eyes.
function makeChibi(color, hatColor = 0xc69645, hairColor = null, faceVariant = 'default') {
  const g = new THREE.Group();
  const shirt = chibiShirtMat(color);
  const hat = chibiHatMat(hatColor);
  const hair = chibiHairMat(hairColor ?? HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]);

  const legL = new THREE.Mesh(CHIBI_GEOS.leg, CHIBI_PANTS_MAT);
  legL.position.set(-0.14, 0.3, 0);
  const legR = new THREE.Mesh(CHIBI_GEOS.leg, CHIBI_PANTS_MAT);
  legR.position.set(0.14, 0.3, 0);
  g.add(legL, legR);

  const torso = new THREE.Mesh(CHIBI_GEOS.torso, shirt);
  torso.position.y = 0.85;
  g.add(torso);

  const armL = new THREE.Mesh(CHIBI_GEOS.arm, shirt);
  armL.position.set(-0.32, 0.95, 0);
  const armR = new THREE.Mesh(CHIBI_GEOS.arm, shirt);
  armR.position.set(0.32, 0.95, 0);
  g.add(armL, armR);
  const handL = new THREE.Mesh(CHIBI_GEOS.hand, CHIBI_SKIN_MAT);
  handL.position.set(0, -0.25, 0);
  armL.add(handL);
  const handR = new THREE.Mesh(CHIBI_GEOS.hand, CHIBI_SKIN_MAT);
  handR.position.set(0, -0.25, 0);
  armR.add(handR);

  // Hair sticks out from under the hat at the back + sides
  const hairMesh = new THREE.Mesh(CHIBI_GEOS.hair, hair);
  hairMesh.position.y = 1.5;
  hairMesh.scale.set(1.02, 0.65, 1.02);
  g.add(hairMesh);

  // Head with painted face texture
  const head = new THREE.Mesh(CHIBI_GEOS.head, getFaceMaterial(faceVariant));
  head.position.y = 1.45;
  g.add(head);

  const hatMesh = new THREE.Mesh(CHIBI_GEOS.hat, hat);
  hatMesh.position.y = 1.7;
  g.add(hatMesh);
  const hatTop = new THREE.Mesh(CHIBI_GEOS.hatTop, hat);
  hatTop.position.y = 1.7;
  g.add(hatTop);

  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.torso = torso;
  g.userData.head = head;
  return g;
}

// Stationary shopkeeper standing behind the market counter. Idles with a
// subtle torso bob and waves one arm when a sale happens — sells the stall
// as "alive" instead of an empty booth.
export class Shopkeeper {
  constructor(scene, marketSite) {
    this.scene = scene;
    this.marketSite = marketSite;
    this.group = makeChibi(0xc4a053, 0xffffff, null, 'happy');
    // Inside the stall, behind the counter, facing customers (+Z).
    this.group.position.set(
      marketSite.position.x,
      0,
      marketSite.position.z - 0.5
    );
    this.group.rotation.y = 0;
    scene.add(this.group);
    this._t = Math.random() * Math.PI;
    this._waveTimer = 0;
  }

  wave() {
    // Triggered by CustomerQueue on each successful sale.
    this._waveTimer = 1.0;
  }

  update(dt) {
    this._t += dt;
    if (this.group.userData.torso) {
      this.group.userData.torso.position.y = 0.85 + Math.sin(this._t * 2) * 0.025;
    }
    const arms = this.group.userData.arms;
    if (!arms) return;
    if (this._waveTimer > 0) {
      this._waveTimer = Math.max(0, this._waveTimer - dt * 1.6);
      const t = 1 - this._waveTimer; // 0 → 1 progression
      const env = Math.sin(t * Math.PI);
      arms[1].rotation.x = -Math.PI * 0.7 * env;
      arms[1].rotation.z = 0.35 * env + Math.sin(this._t * 10) * 0.25 * env;
    } else {
      arms[1].rotation.x *= 0.85;
      arms[1].rotation.z *= 0.85;
    }
  }
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
  constructor(scene, camera, marketSite, flightManager, buildManager, farms, shopkeeper) {
    this.scene = scene;
    this.camera = camera;
    this.marketSite = marketSite;
    this.flight = flightManager;
    // Used to compute which resources exist in-world so customers only ask
    // for items the player can actually produce.
    this.buildManager = buildManager;
    this.farms = farms;
    this.shopkeeper = shopkeeper;
    this.active = false;
    this.customers = [];
    this.spawnTimer = 0;
    this._projVec = new THREE.Vector3();
  }

  // Returns the list of resource keys that are currently sellable. Grows as
  // the player builds factories / plants crops.
  _availableWants() {
    const opts = [];
    const sites = this.buildManager?.sites || {};
    if (sites.hayBaler?.completed) opts.push('bale');
    if (sites.sawMill?.completed) opts.push('planks');
    if (this.farms) {
      for (const farm of this.farms) {
        if (farm.cropKey === 'tomato' && !opts.includes('tomato')) opts.push('tomato');
        if (farm.cropKey === 'potato' && !opts.includes('potato')) opts.push('potato');
      }
    }
    if (sites.sauceFactory?.completed) opts.push('sauce');
    if (sites.chipsFactory?.completed) opts.push('chips');
    if (sites.eggFarm?.completed) opts.push('egg');
    return opts;
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
    const activeCount = this.customers.filter((c) => c.state !== 'leave').length;
    if (activeCount >= cfg.maxQueue) return;
    // No unlocked resources → no point spawning customers with nothing to ask for
    const options = this._availableWants();
    if (options.length === 0) return;

    const slot = activeCount;
    const color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
    const group = makeChibi(color, 0xffffff);
    const entry = this._slotPos(cfg.maxQueue + 1);
    group.position.set(entry.x, 0, entry.z);
    group.rotation.y = Math.atan2(-cfg.queueDir.x, -cfg.queueDir.z);
    this.scene.add(group);

    // Each customer wants a specific resource and quantity they can actually
    // buy given the current production chain.
    const wantKey = options[Math.floor(Math.random() * options.length)];
    const wantQty = 1 + Math.floor(Math.random() * 3);

    const bubble = document.createElement('div');
    bubble.className = 'npc-bubble';
    bubble.textContent = `${wantQty} ${RES_ICONS[wantKey] || '?'}`;
    document.getElementById('world-overlay').appendChild(bubble);

    const target = this._slotPos(slot);
    this.customers.push({
      group, bubble, slot,
      targetX: target.x, targetZ: target.z,
      walkPhase: 0,
      state: 'approach',
      stateTimer: 0,
      wantKey, wantQty,
      serveTimer: 0,
    });
  }

  _reassignSlots() {
    // Only customers actively waiting (or still walking in) count toward the
    // queue order. Served customers in 'receive' or 'leave' vacate their
    // slot immediately so the next person can become slot 0 and trigger the
    // market's next sale.
    const cfg = CONFIG.customers; void cfg;
    const queueing = this.customers.filter((c) => c.state === 'wait' || c.state === 'approach');
    queueing.sort((a, b) => a.slot - b.slot);
    queueing.forEach((c, i) => {
      c.slot = i;
      const t = this._slotPos(i);
      c.targetX = t.x; c.targetZ = t.z;
      // If they were standing still and their slot moved, step forward.
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
          animateWalk(c.group, c.walkPhase);
          // Face movement direction
          c.group.rotation.y = Math.atan2(dx / dist, dz / dist);
        } else if (c.state === 'approach') {
          c.state = 'wait';
          c.stateTimer = 0;
          // Face the market center (works from any queue placement).
          const mp = this.marketSite.position;
          c.group.rotation.y = Math.atan2(
            mp.x - c.group.position.x,
            mp.z - c.group.position.z
          );
        }
      } else {
        damperWalk(c.group);
        // While waiting in line, lift the right arm slightly — reads as
        // "I'd like to buy" instead of standing still like a hatstand.
        if (c.state === 'wait' && c.group.userData.arms) {
          c.group.userData.arms[1].rotation.x = -0.8;
        }
      }

      // Independent serving logic: each waiting customer tries to buy their
      // own wantKey. If stock is available, their serveTimer ticks up. After
      // a short delay they pay coins + receive item via flight anim + leave.
      // Multiple customers can be serving in parallel; out-of-stock ones
      // just keep waiting.
      if (c.state === 'wait' && !c.served) {
        const stock = Inventory[c.wantKey] || 0;
        if (stock >= c.wantQty) {
          c.serveTimer += dt;
          if (c.serveTimer >= 1.0) {
            this._serveCustomer(c);
          }
        } else {
          c.serveTimer = 0; // out of stock → reset timer, keep waiting
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
    let removedAny = false;
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      if (c.state !== 'leave') continue;
      const dx = c.targetX - c.group.position.x;
      const dz = c.targetZ - c.group.position.z;
      if (Math.hypot(dx, dz) < 0.2) {
        this._remove(c);
        this.customers.splice(i, 1);
        removedAny = true;
      }
    }
    if (removedAny) this._reassignSlots();

    // Parallel serving: serve all waiting customers whose wants are met.
    // Sales are driven per-customer (see the 'wait' block inside the loop
    // above) so there's no single head-of-line bottleneck.
  }

  _serveCustomer(c) {
    c.served = true;
    // Consume items from Inventory
    Inventory[c.wantKey] = Math.max(0, (Inventory[c.wantKey] || 0) - c.wantQty);
    Inventory.emit();
    // Pay out coins matching what they bought
    const rewards = this.marketSite.producerCfg?.sellRewards || {};
    const perUnit = rewards[c.wantKey] || 5;
    this.marketSite.coinPile.addPending(perUnit * c.wantQty);
    // Flight: one item flies from the table to the customer
    if (this.flight) {
      const proto = CUSTOMER_FLIGHT_PROTOS[c.wantKey] || CUSTOMER_FLIGHT_PROTOS.bale;
      const from = this.marketSite.getTopStockSlot(c.wantKey)
        || this.marketSite.getAnyTableSlot()
        || new THREE.Vector3(this.marketSite.position.x, 1.2, this.marketSite.position.z);
      this.flight.spawn({
        geometry: proto.geo, material: proto.mat,
        startPos: from.clone(),
        endFn: () => c.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)),
        durationMs: 520, arcH: 1.4,
      });
    }
    // Walk off; next customer takes this slot. Render the purchased items
    // in their arms so it reads as "bought it, carrying it home".
    c.state = 'leave';
    c.targetX = c.group.position.x + 6;
    c.targetZ = c.group.position.z + 5;
    if (c.bubble) c.bubble.style.opacity = '0';
    c.carryItems = { [c.wantKey]: Math.min(c.wantQty, 6) };
    setNpcCarry(c.group, c.carryItems);
    // Wave to the departing customer
    if (this.shopkeeper) this.shopkeeper.wave();
    this._reassignSlots();
  }
}

// Shared geometries + materials for customer-buy flight meshes. Created once
// at module load; every flight reuses these so we don't leak GPU buffers.
const CUSTOMER_FLIGHT_PROTOS = {
  bale:   { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10), mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }) },
  planks: { geo: new THREE.BoxGeometry(0.5, 0.08, 0.18),         mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }) },
  tomato: { geo: new THREE.SphereGeometry(0.18, 10, 8),          mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }) },
  potato: { geo: new THREE.SphereGeometry(0.16, 8, 6),           mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }) },
  sauce:  { geo: new THREE.CylinderGeometry(0.1, 0.13, 0.3, 10), mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }) },
  chips:  { geo: new THREE.BoxGeometry(0.25, 0.2, 0.2),          mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }) },
  egg:    { geo: new THREE.SphereGeometry(0.14, 10, 8),          mat: new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }) },
};
CUSTOMER_FLIGHT_PROTOS.egg.geo.scale(1, 1.25, 1);

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
      animateWalk(this.group, this.walkPhase);
      this.group.rotation.y = Math.atan2(dx / dist, dz / dist);
      setNpcCarry(this.group, { grass: this.carried });
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
    setNpcCarry(this.group, { grass: this.carried });
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
      damperWalk(this.group);
      return;
    }
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) {
      this.idleTimer = 1.5 + Math.random() * 2.0;
      this._pickTarget();
      return;
    }
    const step = Math.min(dist, this.speed * dt);
    this.group.position.x += (dx / dist) * step;
    this.group.position.z += (dz / dist) * step;
    this.walkPhase += dt * 8;
    animateWalk(this.group, this.walkPhase);
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
      animateWalk(this.group, this.walkPhase);
      this.group.rotation.y = Math.atan2(dx / dist, dz / dist);
      setNpcCarry(this.group, this.carrying);
      return;
    }
    if (this.state === 'toFactory') {
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
        this._pickTarget();
      }
    } else if (this.state === 'toMarket') {
      for (const [k, v] of Object.entries(this.carrying)) {
        if (v > 0) Inventory.add(k, v);
      }
      this.carrying = {};
      this.state = 'toFactory';
      this._pickTarget();
    }
    setNpcCarry(this.group, this.carrying);
  }
}

// FarmWorker — hired at a farm's HIRE tile. Walks into the plot, picks the
// nearest ready crop, carries it out to the matching factory (sauce for
// tomato, chips for potato) or the market if the factory isn't built, then
// returns. The Farm itself auto-reseeds empty cells, so the worker only has
// to harvest + deliver.
export class FarmWorker {
  constructor(scene, farm, buildManager, world) {
    this.scene = scene;
    this.farm = farm;
    this.buildManager = buildManager;
    this.world = world;
    this.group = makeChibi(0x6aa33a, 0xffd240, null, 'content');
    this.group.position.set(farm.center.x, 0, farm.center.z + 1.5);
    scene.add(this.group);
    this.carrying = {};
    this.cap = CONFIG.farmWorker.carryCap;
    this.state = 'toField';
    this.walkPhase = 0;
    this.harvestTimer = 0;
    this._pickTarget();
  }

  _pickTarget() {
    if (this.state === 'toField') {
      // Head toward a random spot inside the plot
      const bounds = this.farm.bounds || { width: 4, depth: 4 };
      this.target = {
        x: this.farm.center.x + (Math.random() - 0.5) * (bounds.width * 0.6),
        z: this.farm.center.z + (Math.random() - 0.5) * (bounds.depth * 0.6),
      };
    } else if (this.state === 'toFactory') {
      const dst = this._deliveryTarget();
      const p = dst.dropoffPos || dst.position;
      this.target = {
        x: p.x + (Math.random() - 0.5) * 1.2,
        z: p.z + (Math.random() - 0.5) * 0.6,
      };
    }
  }

  _deliveryTarget() {
    // Pick the factory that consumes whatever we're carrying. If the factory
    // isn't built yet, fall back to the market (so sales still happen).
    const sites = this.buildManager.sites;
    if ((this.carrying.tomato || 0) > 0 && sites.sauceFactory?.completed) return sites.sauceFactory;
    if ((this.carrying.potato || 0) > 0 && sites.chipsFactory?.completed) return sites.chipsFactory;
    return sites.market;
  }

  _carriedTotal() {
    let total = 0;
    for (const v of Object.values(this.carrying)) total += v;
    return total;
  }

  update(dt) {
    if (!this.farm.unlocked) return;
    const speed = CONFIG.farmWorker.moveSpeed;
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.2) {
      const step = Math.min(dist, speed * dt);
      this.group.position.x += (dx / dist) * step;
      this.group.position.z += (dz / dist) * step;
      this.walkPhase += dt * 10;
      animateWalk(this.group, this.walkPhase);
      this.group.rotation.y = Math.atan2(dx / dist, dz / dist);
      setNpcCarry(this.group, this.carrying);
      return;
    }
    damperWalk(this.group);

    if (this.state === 'toField') {
      this.harvestTimer += dt;
      if (this.harvestTimer < CONFIG.farmWorker.harvestIntervalSec) {
        setNpcCarry(this.group, this.carrying);
        return;
      }
      this.harvestTimer = 0;
      // Find the closest ready cell in the farm
      let best = null; let bestD = Infinity;
      for (const cell of this.farm.cells) {
        if (cell.state !== 'ready' || !cell.harvestable || cell.harvestable.removed) continue;
        const ddx = cell.x - this.group.position.x;
        const ddz = cell.z - this.group.position.z;
        const d = ddx * ddx + ddz * ddz;
        if (d < bestD) { bestD = d; best = cell; }
      }
      if (best) {
        const h = best.harvestable;
        const key = h.yield.key;
        this.carrying[key] = (this.carrying[key] || 0) + h.yield.amount;
        this.world.removeHarvestable(h);
        if (this._carriedTotal() >= this.cap) {
          this.state = 'toFactory';
          this._pickTarget();
        } else {
          // Walk to the next nearest spot in the field
          this._pickTarget();
        }
      } else if (this._carriedTotal() > 0) {
        // Nothing ready right now — take what we have to the factory
        this.state = 'toFactory';
        this._pickTarget();
      } else {
        // Idle wander inside the plot
        this._pickTarget();
      }
    } else if (this.state === 'toFactory') {
      for (const [k, v] of Object.entries(this.carrying)) {
        if (v > 0) Inventory.add(k, v);
      }
      this.carrying = {};
      this.state = 'toField';
      this._pickTarget();
    }
    setNpcCarry(this.group, this.carrying);
  }
}

export class HelperManager {
  constructor(scene, world, buildManager) {
    this.scene = scene;
    this.world = world;
    this.buildManager = buildManager;
    this.helpers = [];
    this.buildingWorkers = [];
    this.farmWorkers = [];
  }

  hireBuildingWorker(buildingKey) {
    const site = this.buildManager.sites[buildingKey];
    const market = this.buildManager.sites.market;
    if (!site || !market) return;
    this.buildingWorkers.push(new BuildingWorker(this.scene, buildingKey, site, market));
  }
  hireFarmWorker(farm) {
    this.farmWorkers.push(new FarmWorker(this.scene, farm, this.buildManager, this.world));
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
    for (const w of this.farmWorkers) w.update(dt);
  }
}
