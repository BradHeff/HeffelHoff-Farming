import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory, HelperStats } from './state.js';
import { RES_ICONS } from './hud.js';
import { getFaceMaterial } from './faces.js';

// Shared chibi geometry pool — created ONCE at module load. Every spawned
// NPC reuses these buffers. Materials per-color are cached below.
// Anime chibi proportions — noticeably bigger head relative to body (~2:1),
// shorter legs, rounder torso. Reads as "cute cartoon kid" instead of
// generic human doll.
// Higher segment counts for smoother silhouette — the previous 4–8 segments
// gave a slightly faceted look that read as "blocky" from the game camera.
// Bumping radial segments + cap segments smooths the chibi profile without
// adding meaningful draw cost (geometries are shared across every NPC).
const CHIBI_GEOS = {
  leg: new THREE.CapsuleGeometry(0.14, 0.28, 8, 16),
  torso: new THREE.CapsuleGeometry(0.28, 0.28, 8, 18),
  head: new THREE.SphereGeometry(0.34, 28, 22),
  eye: new THREE.SphereGeometry(0.04, 8, 6),
  hat: new THREE.CylinderGeometry(0.46, 0.46, 0.06, 24),
  hatTop: new THREE.SphereGeometry(0.28, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
  arm: new THREE.CapsuleGeometry(0.09, 0.28, 6, 12),
  hand: new THREE.SphereGeometry(0.11, 14, 10),
  mouth: new THREE.SphereGeometry(0.05, 8, 6),
  hair: new THREE.SphereGeometry(0.36, 20, 16),
  hairBang: new THREE.SphereGeometry(0.16, 12, 10),
  hairSide: new THREE.SphereGeometry(0.14, 12, 10),
  // Neck — small cylinder bridging head + torso so the head doesn't sit
  // directly on the shoulders like a Lego stud.
  neck: new THREE.CylinderGeometry(0.13, 0.16, 0.10, 14),
  // Shoulder cap — small half-sphere where the arm joins the torso for a
  // smooth rounded transition instead of an obvious capsule end.
  shoulder: new THREE.SphereGeometry(0.16, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
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

// Module-level claim registry — every active worker that's walking toward a
// specific harvestable records it here so another helper won't pick the same
// target. Keeps multiple hires on different routes instead of a duplicate
// conga line.
const CLAIMED_HARVESTABLES = new WeakSet();

// Shared geometry + material for items NPCs carry. Created once; every
// worker/helper reuses these buffers (no GPU leak across hundreds of trips).
export const NPC_CARRY_PROTOS = {
  grass:  { geo: new THREE.IcosahedronGeometry(0.16, 0),            mat: new THREE.MeshLambertMaterial({ color: 0x5bbf3d }), rotZ: 0 },
  wood:   { geo: new THREE.BoxGeometry(0.22, 0.16, 0.16),            mat: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }), rotZ: 0 },
  bale:   { geo: new THREE.CylinderGeometry(0.17, 0.17, 0.28, 10),   mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }), rotZ: Math.PI / 2 },
  planks: { geo: new THREE.BoxGeometry(0.42, 0.07, 0.16),            mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }), rotZ: 0 },
  tomato: { geo: new THREE.SphereGeometry(0.14, 10, 8),              mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }), rotZ: 0 },
  potato: { geo: new THREE.SphereGeometry(0.13, 8, 6),               mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }), rotZ: 0 },
  sauce:  { geo: new THREE.CylinderGeometry(0.09, 0.11, 0.24, 10),   mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }), rotZ: 0 },
  chips:  { geo: new THREE.BoxGeometry(0.22, 0.18, 0.14),            mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }), rotZ: 0 },
  egg:    { geo: new THREE.SphereGeometry(0.12, 10, 8),              mat: new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }), rotZ: 0 },
  milk:   { geo: new THREE.CylinderGeometry(0.11, 0.09, 0.26, 10),   mat: new THREE.MeshLambertMaterial({ color: 0xffffff }), rotZ: 0 },
  corn:   { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.28, 8),    mat: new THREE.MeshLambertMaterial({ color: 0xf2c648 }), rotZ: 0 },
  wheat:  { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),     mat: new THREE.MeshLambertMaterial({ color: 0xe8c54a }), rotZ: 0 },
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
    // carryAnchor === 'back' — tall backpack stack behind the torso;
    // default → tight stack in front of the torso (arms).
    if (group.userData.carryAnchor === 'back') {
      cg.position.set(0, 1.1, -0.35);
    } else {
      cg.position.set(0, 0.9, 0.3);
    }
    group.add(cg);
    group.userData.carryGroup = cg;
    group.userData.carryMeshes = [];
  }
  const cg = group.userData.carryGroup;
  const meshes = group.userData.carryMeshes;

  // Helpers carrying on their back get a taller visible cap for the bag
  // look; chest-carried stacks stay at 6 so they don't spill through arms.
  const visibleCap = group.userData.carryAnchor === 'back' ? 10 : 6;
  const stepY = group.userData.carryAnchor === 'back' ? 0.16 : 0.18;

  // Build stack sequence
  const seq = [];
  for (const [k, n] of Object.entries(items || {})) {
    for (let i = 0; i < n && seq.length < visibleCap; i++) seq.push(k);
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
    y += stepY;
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
// `variant` picks a body+hair archetype: 'default', 'female', 'child', 'merchant'.
function makeChibi(color, hatColor = 0xc69645, hairColor = null, faceVariant = 'default', bodyVariant = 'default') {
  const g = new THREE.Group();
  const shirt = chibiShirtMat(color);
  const hat = chibiHatMat(hatColor);
  const hair = chibiHairMat(hairColor ?? HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]);

  const legL = new THREE.Mesh(CHIBI_GEOS.leg, CHIBI_PANTS_MAT);
  legL.position.set(-0.14, 0.26, 0);
  const legR = new THREE.Mesh(CHIBI_GEOS.leg, CHIBI_PANTS_MAT);
  legR.position.set(0.14, 0.26, 0);
  g.add(legL, legR);

  const torso = new THREE.Mesh(CHIBI_GEOS.torso, shirt);
  torso.position.y = 0.75;
  g.add(torso);

  // Neck — bridges head + torso so the head doesn't read as a Lego stud
  const neck = new THREE.Mesh(CHIBI_GEOS.neck, CHIBI_SKIN_MAT);
  neck.position.y = 1.18;
  g.add(neck);

  // Rounded shoulder caps — smooth the arm-to-torso transition
  const shoulderL = new THREE.Mesh(CHIBI_GEOS.shoulder, shirt);
  shoulderL.position.set(-0.32, 0.95, 0);
  shoulderL.rotation.z = 0.05;
  const shoulderR = new THREE.Mesh(CHIBI_GEOS.shoulder, shirt);
  shoulderR.position.set(0.32, 0.95, 0);
  shoulderR.rotation.z = -0.05;
  g.add(shoulderL, shoulderR);

  const armL = new THREE.Mesh(CHIBI_GEOS.arm, shirt);
  armL.position.set(-0.32, 0.88, 0);
  const armR = new THREE.Mesh(CHIBI_GEOS.arm, shirt);
  armR.position.set(0.32, 0.88, 0);
  g.add(armL, armR);
  const handL = new THREE.Mesh(CHIBI_GEOS.hand, CHIBI_SKIN_MAT);
  handL.position.set(0, -0.25, 0);
  armL.add(handL);
  const handR = new THREE.Mesh(CHIBI_GEOS.hand, CHIBI_SKIN_MAT);
  handR.position.set(0, -0.25, 0);
  armR.add(handR);

  // Back hair — big puffy hemisphere wrapped around the back of the head
  const hairMesh = new THREE.Mesh(CHIBI_GEOS.hair, hair);
  hairMesh.position.set(0, 1.48, -0.02);
  hairMesh.scale.set(1.05, 0.75, 1.05);
  g.add(hairMesh);

  // Head with painted face texture (bigger for anime proportions)
  const head = new THREE.Mesh(CHIBI_GEOS.head, getFaceMaterial(faceVariant));
  head.position.y = 1.5;
  g.add(head);

  // Front bangs — two small hair puffs above the face for an anime fringe
  const bangL = new THREE.Mesh(CHIBI_GEOS.hairBang, hair);
  bangL.position.set(-0.12, 1.76, 0.23);
  bangL.scale.set(1.1, 0.6, 0.8);
  const bangR = new THREE.Mesh(CHIBI_GEOS.hairBang, hair);
  bangR.position.set(0.12, 1.76, 0.23);
  bangR.scale.set(1.1, 0.6, 0.8);
  g.add(bangL, bangR);

  // Side hair tufts at ears — give character silhouette some swoop
  const sideL = new THREE.Mesh(CHIBI_GEOS.hairSide, hair);
  sideL.position.set(-0.3, 1.45, 0.08);
  sideL.scale.set(0.9, 1.4, 0.8);
  const sideR = new THREE.Mesh(CHIBI_GEOS.hairSide, hair);
  sideR.position.set(0.3, 1.45, 0.08);
  sideR.scale.set(0.9, 1.4, 0.8);
  g.add(sideL, sideR);

  let showHat = true;

  // Variant accents — extra hair pieces, skirt, beard, scale tweaks.
  if (bodyVariant === 'female') {
    // Long ponytail trailing behind the head
    const ponyGeo = new THREE.CylinderGeometry(0.1, 0.05, 0.65, 8);
    const pony = new THREE.Mesh(ponyGeo, hair);
    pony.position.set(0, 1.25, -0.38);
    pony.rotation.x = 0.35;
    g.add(pony);
    const bow = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.1, 0.06),
      chibiShirtMat(0xff4a9c),
    );
    bow.position.set(0, 1.52, -0.32);
    g.add(bow);
    // Short skirt around the hips
    const skirtMat = chibiShirtMat(color);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.34, 12, 1, true), skirtMat);
    skirt.position.y = 0.55;
    g.add(skirt);
    showHat = false;
  } else if (bodyVariant === 'child') {
    // Shrink everything about 15% for a smaller frame
    g.scale.setScalar(0.8);
    // Tiny backpack on the back so children read as school kids
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.38, 0.15),
      chibiShirtMat(0xff7036),
    );
    pack.position.set(0, 0.85, -0.28);
    g.add(pack);
  } else if (bodyVariant === 'merchant') {
    // Bigger body + beard + vest (no separate hat)
    g.scale.setScalar(1.1);
    // Beard: dark half-ellipsoid hanging below the chin
    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.6),
      hair,
    );
    beard.position.set(0, 1.35, 0.25);
    beard.scale.set(1.0, 0.9, 0.7);
    g.add(beard);
    // Vest over the torso
    const vest = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.28, 4, 12),
      chibiShirtMat(0x2a5a8a),
    );
    vest.position.y = 0.78;
    vest.scale.z = 0.75;
    g.add(vest);
    // Flat cap instead of straw hat
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.1, 18),
      chibiHatMat(0x3a2412),
    );
    cap.position.y = 1.8;
    const capVisor = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.04, 0.25),
      chibiHatMat(0x2a1808),
    );
    capVisor.position.set(0, 1.76, 0.32);
    g.add(cap, capVisor);
    showHat = false;
  }

  if (showHat) {
    const hatMesh = new THREE.Mesh(CHIBI_GEOS.hat, hat);
    hatMesh.position.y = 1.84;
    g.add(hatMesh);
    const hatTop = new THREE.Mesh(CHIBI_GEOS.hatTop, hat);
    hatTop.position.y = 1.84;
    g.add(hatTop);
  }

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
    // Stand on the FAR side of the table from the customers — the table is
    // at marketSite.z - 1.7 with customers approaching from the south, so
    // the shopkeeper sits just NORTH of the table (between the table and
    // marketSite center) facing south to serve.
    this.group.position.set(
      marketSite.position.x,
      0,
      marketSite.position.z - 2.4
    );
    this.group.rotation.y = Math.PI;   // face south (toward customers)
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
    if (sites.dairyFarm?.completed) opts.push('milk');
    if (this.farms && this.farms.some((f) => f.cropKey === 'wheat')) opts.push('wheat');
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

  // World position for (lane, row) in the 4×4 grid. Row 0 is the slot
  // closest to the table (front of line); higher rows are farther south.
  _slotPos(lane, row) {
    const cfg = CONFIG.customers;
    return {
      x: cfg.laneX[lane] + this.marketSite.position.x,
      z: cfg.frontSlotZ + row * cfg.rowSpacing,
    };
  }

  _laneOccupants(lane) {
    return this.customers.filter(
      (c) => c.lane === lane && (c.state === 'approach' || c.state === 'wait')
    );
  }

  _spawn() {
    const cfg = CONFIG.customers;
    const activeCount = this.customers.filter(
      (c) => c.state === 'approach' || c.state === 'wait'
    ).length;
    const maxQueue = cfg.laneX.length * cfg.rowsPerLane;
    if (activeCount >= maxQueue) return;
    // No unlocked resources → no point spawning customers with nothing to ask for
    const options = this._availableWants();
    if (options.length === 0) return;

    // Pick the lane with the fewest occupants — keeps lines balanced
    let bestLane = 0, bestCount = Infinity;
    for (let i = 0; i < cfg.laneX.length; i++) {
      const n = this._laneOccupants(i).length;
      if (n < bestCount) { bestCount = n; bestLane = i; }
    }
    if (bestCount >= cfg.rowsPerLane) return; // every lane full

    const lane = bestLane;
    const row = bestCount; // they take the back of the line

    const color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
    const archetypes = ['default', 'female', 'female', 'child', 'default', 'merchant'];
    const variant = archetypes[Math.floor(Math.random() * archetypes.length)];
    const hatColor = variant === 'merchant' ? 0x3a2412 : 0xffffff;
    const group = makeChibi(color, hatColor, null, 'default', variant);
    // Spawn south of the courtyard, off the dirt apron, walking IN.
    const entry = this._slotPos(lane, 0);
    group.position.set(entry.x, 0, cfg.entryZ);
    group.rotation.y = Math.PI; // facing north (toward the table)
    this.scene.add(group);

    const wantKey = options[Math.floor(Math.random() * options.length)];
    const wantQty = 1 + Math.floor(Math.random() * 3);

    const bubble = document.createElement('div');
    bubble.className = 'npc-bubble';
    bubble.textContent = `${wantQty} ${RES_ICONS[wantKey] || '?'}`;
    document.getElementById('world-overlay').appendChild(bubble);

    const target = this._slotPos(lane, row);
    this.customers.push({
      group, bubble, lane, row,
      targetX: target.x, targetZ: target.z,
      walkPhase: 0,
      state: 'approach',
      stateTimer: 0,
      wantKey, wantQty,
      serveTimer: 0,
    });
  }

  // Compact each lane: rows are reassigned by current order so a vacated
  // front slot pulls everyone behind it forward by one.
  _reassignSlots() {
    const cfg = CONFIG.customers;
    for (let lane = 0; lane < cfg.laneX.length; lane++) {
      const queueing = this.customers.filter(
        (c) => c.lane === lane && (c.state === 'wait' || c.state === 'approach')
      );
      // Sort by current row so existing order is preserved
      queueing.sort((a, b) => a.row - b.row);
      queueing.forEach((c, i) => {
        if (c.row !== i) {
          c.row = i;
          const t = this._slotPos(lane, i);
          c.targetX = t.x; c.targetZ = t.z;
          if (c.state === 'wait') c.state = 'approach';
        }
      });
    }
  }

  update(dt) {
    if (!this.active) return;
    const cfg = CONFIG.customers;
    this.spawnTimer += dt;
    // Top-up loop: if we're under the minActive threshold, spawn faster so
    // there are always at least `minActive` customers visible somewhere.
    const activeCount = this.customers.filter(
      (c) => c.state === 'approach' || c.state === 'wait'
    ).length;
    const interval = activeCount < (cfg.minActive || 0)
      ? Math.min(cfg.spawnIntervalSec, 0.6)
      : cfg.spawnIntervalSec;
    if (this.spawnTimer >= interval) {
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

      // Only the FRONT customer in each lane can be served — they must
      // physically be at the table before money changes hands.
      if (c.state === 'wait' && c.row === 0 && !c.served) {
        const stock = Inventory[c.wantKey] || 0;
        if (stock >= c.wantQty) {
          c.serveTimer += dt;
          if (c.serveTimer >= 1.0) {
            this._serveCustomer(c);
          }
        } else {
          c.serveTimer = 0;
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
    // Notify listeners (goals system etc) that a sale happened.
    if (this.onSold) this.onSold(c.wantKey, c.wantQty);
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
    // Customer takes their crate and walks off into the grass. Pick a
    // diagonal exit point well past the courtyard south edge so they're
    // visibly walking away with their purchase across the dirt before
    // disappearing in the grass biome. Lane choice biases east vs west so
    // the lanes don't clog into a single exit corridor.
    const cfg = CONFIG.customers;
    const sideDir = (c.lane < 2) ? -1 : 1;
    c.state = 'leave';
    c.targetX = c.group.position.x + sideDir * (5 + Math.random() * 3);
    c.targetZ = cfg.exitZ + Math.random() * 2;
    if (c.bubble) c.bubble.style.opacity = '0';
    c.carryItems = { [c.wantKey]: Math.min(c.wantQty, 6) };
    setNpcCarry(c.group, c.carryItems);
    // Wave to the departing customer + start the coin-flow animation
    if (this.shopkeeper) this.shopkeeper.wave();
    this._spawnCoinFlow(c);
    this._reassignSlots();
  }

  // Coin-flow animation: spawn a few gold coin meshes that fly from the
  // customer's hands to the market money pile, paying the shopkeeper.
  _spawnCoinFlow(c) {
    if (!this.flight || !this.marketSite.coinPile) return;
    const start = c.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const pile = this.marketSite.coinPile;
    const target = pile.origin.clone().add(new THREE.Vector3(0, 0.8, 0));
    const proto = COIN_FLOW_PROTOS;
    const flights = Math.min(3 + Math.floor(c.wantQty / 2), 6);
    for (let i = 0; i < flights; i++) {
      this.flight.spawn({
        geometry: proto.geo, material: proto.mat,
        startPos: start.clone(),
        endPos: target.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5
        )),
        durationMs: 600 + i * 50,
        arcH: 1.6 + i * 0.1,
        delayMs: i * 80,
      });
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
  sauce:  { geo: new THREE.CylinderGeometry(0.1, 0.13, 0.3, 10), mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }) },
  chips:  { geo: new THREE.BoxGeometry(0.25, 0.2, 0.2),          mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }) },
  egg:    { geo: new THREE.SphereGeometry(0.14, 10, 8),          mat: new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }) },
  milk:   { geo: new THREE.CylinderGeometry(0.13, 0.1, 0.3, 10),  mat: new THREE.MeshLambertMaterial({ color: 0xffffff }) },
  corn:   { geo: new THREE.CylinderGeometry(0.07, 0.07, 0.32, 8), mat: new THREE.MeshLambertMaterial({ color: 0xf2c648 }) },
  wheat:  { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8), mat: new THREE.MeshLambertMaterial({ color: 0xe8c54a }) },
};
CUSTOMER_FLIGHT_PROTOS.egg.geo.scale(1, 1.25, 1);

// Shared geometry+material for the coin-flow animation that fires when an
// NPC pays the shopkeeper. One pool, reused for every customer.
const COIN_FLOW_PROTOS = {
  geo: new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12),
  mat: new THREE.MeshLambertMaterial({ color: 0xf7c648 }),
};

// Helper NPC — hired from the HUD button. A full farmhand: slashes grass,
// chops trees, occasionally harvests crop plots, and delivers whatever they
// picked up to the matching factory (fallback: market).
//   grass  → hayBaler
//   wood   → sawMill
//   tomato → sauceFactory (else market)
//   potato → chipsFactory (else market)
//   corn   → eggFarm      (else market)
export class Helper {
  constructor(scene, world, buildManager, particles = null) {
    this.scene = scene;
    this.world = world;
    this.buildManager = buildManager;
    this.particles = particles;

    this.group = makeChibi(0x8a3a55, 0xe1b458);
    this.group.position.set(CONFIG.world.spawnPos.x, 0, CONFIG.world.spawnPos.z);
    // Helpers get backpack-anchored carry (raw materials stacked high on back)
    this.group.userData.carryAnchor = 'back';
    scene.add(this.group);

    this.carrying = {};       // { grass: n, wood: n, tomato: n, ... }
    this.walkPhase = 0;
    this.state = 'idle';
    this.harvestTimer = 0;
    // Each helper prefers a different starting job so two hires don't
    // instantly pick the same target tree / grass on spawn.
    this._preferredFirstJob = ['grass', 'wood', 'grass', 'crop'][
      Math.floor(Math.random() * 4)
    ];
    this._pickJob(true);
  }

  _releaseClaim() {
    if (this.targetHarvestable) {
      CLAIMED_HARVESTABLES.delete(this.targetHarvestable);
      this.targetHarvestable = null;
    }
  }

  get capacity() {
    return Math.round(CONFIG.helpers.capacity * HelperStats.capMul);
  }

  _carriedTotal() {
    let t = 0;
    for (const v of Object.values(this.carrying)) t += v;
    return t;
  }

  // Decide what this trip targets. Crops only selected if a farm has ready
  // cells. Otherwise weighted grass vs wood — ~60% grass, ~40% wood.
  _pickJob(first = false) {
    this._releaseClaim();
    const anyCrop = this.world.harvestables.some(
      (h) => h.kind === 'cropCell' && !h.removed,
    );
    if (first && this._preferredFirstJob) {
      if (this._preferredFirstJob === 'crop' && !anyCrop) {
        this.currentType = 'grass';
      } else {
        this.currentType = this._preferredFirstJob;
      }
      this._preferredFirstJob = null;
    } else {
      const roll = Math.random();
      if (anyCrop && roll < 0.22) this.currentType = 'crop';
      else if (roll < 0.62) this.currentType = 'grass';
      else this.currentType = 'wood';
    }
    this._pickHarvestable();
  }

  // Pick the nearest unclaimed harvestable matching our job type. Adds a
  // small jitter bonus so two workers at similar distances tie-break onto
  // different trees rather than racing to the same one.
  _pickHarvestable() {
    this._releaseClaim();
    const px = this.group.position.x;
    const pz = this.group.position.z;
    let best = null; let bestScore = Infinity;
    for (const h of this.world.harvestables) {
      if (h.removed || h._locked) continue;
      if (CLAIMED_HARVESTABLES.has(h)) continue; // another helper has this one
      let match = false;
      if (this.currentType === 'grass') match = h.type === 'grass';
      else if (this.currentType === 'wood') match = h.type === 'tree';
      else if (this.currentType === 'crop') match = h.kind === 'cropCell';
      if (!match) continue;
      const dx = h.position.x - px;
      const dz = h.position.z - pz;
      const d = dx * dx + dz * dz;
      // Small hashed jitter keeps two helpers from snapping to the same
      // equidistant target every frame.
      const jitter = ((h.instanceId ?? 0) * 7919 % 97) * 0.01;
      const score = d + jitter;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (best) {
      this.target = { x: best.position.x, z: best.position.z };
      this.targetHarvestable = best;
      CLAIMED_HARVESTABLES.add(best);
      this.state = 'toTarget';
    } else {
      this.state = 'replan';
      this.target = { x: px, z: pz };
      this.targetHarvestable = null;
    }
  }

  // Where to deliver based on the primary item we're carrying.
  _deliveryTarget() {
    const sites = this.buildManager.sites;
    const c = this.carrying;
    if ((c.tomato || 0) > 0 && sites.sauceFactory?.completed) return sites.sauceFactory;
    if ((c.potato || 0) > 0 && sites.chipsFactory?.completed) return sites.chipsFactory;
    if ((c.corn || 0) > 0 && sites.eggFarm?.completed) return sites.eggFarm;
    if ((c.wood || 0) > 0 && sites.sawMill?.completed) return sites.sawMill;
    if ((c.grass || 0) > 0 && sites.hayBaler?.completed) return sites.hayBaler;
    return sites.market;
  }

  update(dt) {
    const speed = CONFIG.helpers.moveSpeed * HelperStats.speedMul;
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

    if (this.state === 'toTarget') {
      // Target may have been removed by the player slashing — re-plan.
      if (!this.targetHarvestable || this.targetHarvestable.removed) {
        this._pickHarvestable();
        return;
      }
      // Arrived — slash animation on right arm + harvest.
      this.harvestTimer += dt;
      if (this.group.userData.arms) {
        this.group.userData.arms[1].rotation.x =
          -1.4 + Math.min(1, this.harvestTimer / 0.3) * 1.0;
      }
      if (this.harvestTimer >= 0.35) {
        this.harvestTimer = 0;
        const h = this.targetHarvestable;
        if (h && !h.removed && !h._locked) {
          const key = h.yield.key;
          const amt = h.yield.amount || 1;
          this.carrying[key] = (this.carrying[key] || 0) + amt;
          // Short pop-burst at the harvest point — "pop out" grammar so the
          // user sees the conversion even when the chibi sprite is tiny.
          if (this.particles) {
            this.particles.burst(
              { x: h.position.x, y: 0.8, z: h.position.z },
              {
                count: 10,
                power: 3.2,
                ttl: 0.55,
                scale: 0.7,
                colors: h.type === 'tree'
                  ? [0x8b5a2b, 0xa66633, 0x3fd238, 0xffffff]
                  : [0x6eff3c, 0x3fd920, 0xffffff, 0xffdb47],
              },
            );
          }
          this.world.removeHarvestable(h);
        }
        CLAIMED_HARVESTABLES.delete(h);
        this.targetHarvestable = null;
        if (this._carriedTotal() >= this.capacity) {
          const dst = this._deliveryTarget();
          const p = dst.dropoffPos || dst.position;
          this.target = {
            x: p.x + (Math.random() - 0.5) * 1.6,
            z: p.z + (Math.random() - 0.5) * 1.2,
          };
          this.state = 'toDepot';
        } else {
          this._pickHarvestable();
          if (this.state !== 'toTarget' && this._carriedTotal() > 0) {
            const dst = this._deliveryTarget();
            const p = dst.dropoffPos || dst.position;
            this.target = {
              x: p.x + (Math.random() - 0.5) * 1.6,
              z: p.z + (Math.random() - 0.5) * 1.2,
            };
            this.state = 'toDepot';
          }
        }
      }
    } else if (this.state === 'toDepot') {
      for (const [k, v] of Object.entries(this.carrying)) {
        if (v > 0) Inventory.add(k, v);
      }
      this.carrying = {};
      this._pickJob();
    } else {
      this._pickJob();
    }
    setNpcCarry(this.group, this.carrying);
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
    const variants = ['default', 'female', 'child', 'default'];
    this.group = makeChibi(
      shirtColors[Math.floor(Math.random() * shirtColors.length)],
      hatColors[Math.floor(Math.random() * hatColors.length)],
      null,
      'default',
      variants[Math.floor(Math.random() * variants.length)],
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
    // Trimmed to 2 — chibi NPCs add 8 draw calls each. Positioned inside the
    // northern meadow / forest so they read on the tighter play rectangle
    // and never wander south of the customer road.
    const bounds = [
      { x0: -22, x1: -12, z0: -18, z1: -8 },
      { x0:  12, x1:  22, z0: -18, z1: -8 },
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
    const speed = CONFIG.buildingWorker.moveSpeed * HelperStats.speedMul;
    this.cap = Math.round(CONFIG.buildingWorker.carryCap * HelperStats.capMul);
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
    if ((this.carrying.corn || 0) > 0 && sites.eggFarm?.completed) return sites.eggFarm;
    return sites.market;
  }

  _carriedTotal() {
    let total = 0;
    for (const v of Object.values(this.carrying)) total += v;
    return total;
  }

  update(dt) {
    if (!this.farm.unlocked) return;
    const speed = CONFIG.farmWorker.moveSpeed * HelperStats.speedMul;
    this.cap = Math.round(CONFIG.farmWorker.carryCap * HelperStats.capMul);
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
  constructor(scene, world, buildManager, particles = null) {
    this.scene = scene;
    this.world = world;
    this.buildManager = buildManager;
    this.particles = particles;
    this.helpers = [];
    this.buildingWorkers = [];
    this.farmWorkers = [];
  }

  setParticles(p) { this.particles = p; }

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
    this.helpers.push(new Helper(this.scene, this.world, this.buildManager, this.particles));
    return true;
  }
  update(dt) {
    for (const h of this.helpers) h.update(dt);
    for (const w of this.buildingWorkers) w.update(dt);
    for (const w of this.farmWorkers) w.update(dt);
  }
}
