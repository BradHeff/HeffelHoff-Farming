import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory, HelperStats } from './state.js';
import { ZoneDecal } from './zone.js';
import { showLevelBanner } from './hud.js';

// Builds a chibi tractor mesh (body + cab + stack + wheels + trailer). The
// same function is used for the locked preview and the active harvester.
// Front of the tractor points +Z (same as the cow + NPCs).
function buildTractorMesh() {
  const g = new THREE.Group();

  // Tractor body — red + cream
  const redMat = new THREE.MeshLambertMaterial({ color: 0xcc3020 });
  const creamMat = new THREE.MeshLambertMaterial({ color: 0xf1e3b8 });
  const metalDark = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const metalMid = new THREE.MeshLambertMaterial({ color: 0x606068 });

  // Lower chassis beam
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.8), redMat);
  chassis.position.y = 0.45;
  g.add(chassis);

  // Engine bonnet (front)
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.9), redMat);
  bonnet.position.set(0, 0.8, 0.5);
  g.add(bonnet);
  // Bonnet cream stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 0.92), creamMat);
  stripe.position.set(0, 0.78, 0.5);
  g.add(stripe);

  // Cab (back)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.85), redMat);
  cab.position.set(0, 1.1, -0.35);
  g.add(cab);
  // Cab windows — pale blue tinted box
  const winMat = new THREE.MeshLambertMaterial({ color: 0xa0d8ff, transparent: true, opacity: 0.75 });
  const winFront = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.04), winMat);
  winFront.position.set(0, 1.25, 0.05);
  g.add(winFront);
  const winBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.04), winMat);
  winBack.position.set(0, 1.25, -0.73);
  g.add(winBack);
  const winSide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.6), winMat);
  winSide.position.set(0.51, 1.25, -0.35);
  g.add(winSide);
  const winSide2 = winSide.clone(); winSide2.position.x = -0.51; g.add(winSide2);
  // Roof overhang
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.0), metalDark);
  roof.position.set(0, 1.6, -0.35);
  g.add(roof);

  // Exhaust stack
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.75, 10),
    metalDark,
  );
  stack.position.set(-0.35, 1.25, 0.9);
  g.add(stack);
  const stackCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10),
    metalMid,
  );
  stackCap.position.set(-0.35, 1.66, 0.9);
  g.add(stackCap);

  // Headlights
  const headlightMat = new THREE.MeshLambertMaterial({
    color: 0xffe580, emissive: 0x664400,
  });
  const hlGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10);
  hlGeo.rotateX(Math.PI / 2);
  const hlL = new THREE.Mesh(hlGeo, headlightMat);
  hlL.position.set(-0.3, 0.78, 0.97);
  g.add(hlL);
  const hlR = new THREE.Mesh(hlGeo, headlightMat);
  hlR.position.set(0.3, 0.78, 0.97);
  g.add(hlR);

  // Big rear wheels + small front wheels
  const bigWheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.22, 16);
  bigWheelGeo.rotateZ(Math.PI / 2);
  const smallWheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14);
  smallWheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xd8d8dc });
  const wheels = [];
  const addWheel = (x, y, z, geo, hubR) => {
    const w = new THREE.Mesh(geo, wheelMat);
    w.position.set(x, y, z);
    g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 0.24, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(w.position);
    g.add(hub);
    wheels.push(w);
    wheels.push(hub);
    return w;
  };
  // Front small wheels
  addWheel(-0.65, 0.3, 0.6, smallWheelGeo, 0.11);
  addWheel( 0.65, 0.3, 0.6, smallWheelGeo, 0.11);
  // Rear big wheels
  addWheel(-0.7, 0.48, -0.5, bigWheelGeo, 0.15);
  addWheel( 0.7, 0.48, -0.5, bigWheelGeo, 0.15);
  g.userData.wheels = wheels;

  // Tow hitch at the back
  const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.3), metalMid);
  hitch.position.set(0, 0.5, -1.08);
  g.add(hitch);

  // Trailer — wooden box on a short axle + its own wheels
  const trailer = new THREE.Group();
  trailer.position.set(0, 0, -1.8);
  g.add(trailer);
  const trailerBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.18, 1.4),
    new THREE.MeshLambertMaterial({ color: 0x9a6b3a }),
  );
  trailerBase.position.y = 0.55;
  trailer.add(trailerBase);
  // Plank walls
  const plankMat = new THREE.MeshLambertMaterial({ color: 0xbd8548 });
  const plankDark = new THREE.MeshLambertMaterial({ color: 0x7a4f25 });
  const wallH = 0.5;
  const walls = [
    [1.3, wallH, 0.08, 0, 0.55 + wallH / 2, 0.66],
    [1.3, wallH, 0.08, 0, 0.55 + wallH / 2, -0.66],
    [0.08, wallH, 1.34, 0.65, 0.55 + wallH / 2, 0],
    [0.08, wallH, 1.34, -0.65, 0.55 + wallH / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plankMat);
    m.position.set(x, y, z);
    trailer.add(m);
  }
  // Corner posts
  for (const [cx, cz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, wallH + 0.1, 0.12), plankDark);
    p.position.set(cx, 0.55 + (wallH + 0.1) / 2, cz);
    trailer.add(p);
  }
  // Trailer wheels
  addTrailerWheels(trailer, smallWheelGeo, wheelMat, hubMat);
  // Hitch arm connecting trailer to tractor
  const hitchArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.6),
    metalMid,
  );
  hitchArm.position.set(0, 0.5, 0.9);
  trailer.add(hitchArm);
  g.userData.trailer = trailer;
  g.userData.trailerContentAnchor = new THREE.Vector3(0, 0.78, 0);

  // Stack meshes inside the trailer (populated by setTractorCarry below)
  const contents = new THREE.Group();
  contents.position.copy(g.userData.trailerContentAnchor);
  trailer.add(contents);
  g.userData.trailerContents = contents;
  g.userData.trailerMeshes = [];

  return g;
}

function addTrailerWheels(trailer, geo, wheelMat, hubMat) {
  for (const [x, z] of [[-0.72, 0], [0.72, 0]]) {
    const w = new THREE.Mesh(geo, wheelMat);
    w.position.set(x, 0.3, z);
    trailer.add(w);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.22, 10),
      hubMat,
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(w.position);
    trailer.add(hub);
  }
}

// Renders the current trailer carry as stacked resource meshes in the bed.
// Uses the same geometry/material pool as NPC carry (imported lazily to
// avoid a circular import — access via a shared lookup passed in).
function setTractorCarry(group, items, protos) {
  const sig = Object.entries(items || {}).map(([k, v]) => `${k}:${v}`).join(',');
  if (group.userData.trailerSig === sig) return;
  group.userData.trailerSig = sig;
  const cg = group.userData.trailerContents;
  const meshes = group.userData.trailerMeshes;

  // Flatten to a sequence capped at 16 visible items stacked 4×4
  const cap = 16;
  const seq = [];
  for (const [k, n] of Object.entries(items || {})) {
    for (let i = 0; i < n && seq.length < cap; i++) seq.push(k);
  }
  while (meshes.length < seq.length) {
    const m = new THREE.Mesh(protos.grass.geo, protos.grass.mat);
    m.visible = false;
    cg.add(m);
    meshes.push(m);
  }
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (i >= seq.length) { m.visible = false; continue; }
    const proto = protos[seq[i]] || protos.grass;
    m.visible = true;
    m.geometry = proto.geo;
    m.material = proto.mat;
    const col = i % 4, row = Math.floor(i / 4);
    m.position.set(-0.3 + col * 0.2, (row % 2) * 0.22, -0.3 + Math.floor(i / 8) * 0.3);
    m.rotation.z = proto.rotZ || 0;
  }
}

// The working tractor: autonomous harvester after unlock. Drives in large
// loops, auto-slashes any harvestable in a wide radius, delivers when the
// trailer is full.
export class Tractor {
  constructor(scene, world, buildManager, carryProtos, particles = null) {
    this.scene = scene;
    this.world = world;
    this.buildManager = buildManager;
    this.carryProtos = carryProtos;
    this.particles = particles;

    this.group = buildTractorMesh();
    this.group.position.set(CONFIG.world.spawnPos.x + 4, 0, CONFIG.world.spawnPos.z);
    scene.add(this.group);

    this.cfg = CONFIG.tractor;
    this.capacity = this.cfg.capacity;
    this.carrying = {};
    this.state = 'roaming';
    this.harvestTimer = 0;
    this.smokeTimer = 0;
    this._pickRoamTarget();
  }

  _carriedTotal() {
    let t = 0;
    for (const v of Object.values(this.carrying)) t += v;
    return t;
  }

  _pickRoamTarget() {
    // Pick a grid spot anywhere in the playable rectangle (prefer north)
    const b = CONFIG.world.bounds;
    // 70% stay in the harvesting area (meadow + forest, z < 0), 30% wander
    const stayNorth = Math.random() < 0.7;
    const z = stayNorth
      ? b.minZ + Math.random() * (0 - b.minZ)
      : b.minZ + Math.random() * (b.maxZ - 4 - b.minZ);
    const x = b.minX + 4 + Math.random() * (b.maxX - b.minX - 8);
    this.target = { x, z };
  }

  _pickDeliveryTarget() {
    const sites = this.buildManager.sites;
    const c = this.carrying;
    if ((c.tomato || 0) > 0 && sites.sauceFactory?.completed) return sites.sauceFactory;
    if ((c.potato || 0) > 0 && sites.chipsFactory?.completed) return sites.chipsFactory;
    if ((c.corn   || 0) > 0 && sites.eggFarm?.completed)      return sites.eggFarm;
    if ((c.grass  || 0) > 0 && sites.hayBaler?.completed)     return sites.hayBaler;
    if ((c.wood   || 0) > 0 && sites.sawMill?.completed)      return sites.sawMill;
    return sites.market;
  }

  update(dt) {
    const speed = this.cfg.moveSpeed;
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);

    // Move
    if (dist > 0.3) {
      const step = Math.min(dist, speed * dt);
      this.group.position.x += (dx / dist) * step;
      this.group.position.z += (dz / dist) * step;
      // Face direction of travel
      this.group.rotation.y = Math.atan2(dx / dist, dz / dist);
      // Spin wheels while moving
      const wheels = this.group.userData.wheels || [];
      for (const w of wheels) w.rotation.x += step * 3;
      // Exhaust puffs
      this.smokeTimer += dt;
      if (this.smokeTimer > 0.35 && this.particles) {
        this.smokeTimer = 0;
        const worldPos = new THREE.Vector3();
        this.group.getWorldPosition(worldPos);
        this.particles.burst(
          { x: worldPos.x - 0.35, y: 1.8, z: worldPos.z + 0.9 },
          { count: 4, power: 1.2, ttl: 0.7, scale: 0.5,
            colors: [0x707078, 0x90909a, 0xaaaab2] },
        );
      }
    }

    // Auto-harvest in a wide radius while driving
    if (this.state === 'roaming') {
      this.harvestTimer += dt;
      if (this.harvestTimer >= this.cfg.harvestIntervalSec) {
        this.harvestTimer = 0;
        this._sweep();
      }
      // Switch to deliver when full or when reaching the current roam spot
      if (this._carriedTotal() >= this.capacity) {
        this.state = 'toDepot';
        const dst = this._pickDeliveryTarget();
        const p = dst.dropoffPos || dst.position;
        this.target = { x: p.x, z: p.z };
      } else if (dist < 0.6) {
        this._pickRoamTarget();
      }
    } else if (this.state === 'toDepot') {
      if (dist < 1.0) {
        // Unload
        for (const [k, v] of Object.entries(this.carrying)) {
          if (v > 0) Inventory.add(k, v);
        }
        this.carrying = {};
        this.state = 'roaming';
        this._pickRoamTarget();
      }
    }

    setTractorCarry(this.group, this.carrying, this.carryProtos);
  }

  _sweep() {
    const pos = this.group.position;
    const r2 = this.cfg.harvestRadius * this.cfg.harvestRadius;
    let collected = 0;
    for (const h of this.world.harvestables) {
      if (h.removed || h._locked) continue;
      const dx = h.position.x - pos.x;
      const dz = h.position.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      const key = h.yield.key;
      const amt = h.yield.amount || 1;
      this.carrying[key] = (this.carrying[key] || 0) + amt;
      this.world.removeHarvestable(h);
      collected++;
      if (collected >= this.cfg.perSweepMax) break;
      if (this._carriedTotal() >= this.capacity) break;
    }
    if (collected > 0 && this.particles) {
      const worldPos = new THREE.Vector3();
      this.group.getWorldPosition(worldPos);
      this.particles.burst(
        { x: worldPos.x, y: 0.7, z: worldPos.z },
        { count: 8 + Math.min(6, collected),
          power: 2.6, ttl: 0.55, scale: 0.7 },
      );
    }
  }
}

// Preview tractor + unlock tile. Shows a stationary sparkling tractor
// parked on a pulsing circle while prerequisites aren't met / cost unpaid.
// Unlock condition: every main building Lv3 AND HelperStats.level >= 2.
export class TractorUnlockTile {
  constructor(scene, camera, buildManager) {
    this.scene = scene;
    this.camera = camera;
    this.buildManager = buildManager;
    this.cfg = CONFIG.tractor;
    this.position = new THREE.Vector3(this.cfg.unlockPos.x, 0, this.cfg.unlockPos.z);
    this.radius = 2.4;
    this.revealed = false;
    this.unlocked = false;

    // Preview tractor, hidden until prereqs satisfied
    this.previewGroup = buildTractorMesh();
    this.previewGroup.position.copy(this.position);
    this.previewGroup.visible = false;
    scene.add(this.previewGroup);

    // Pulsing circle under the tractor (inner disc + outer ring)
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xffe066, transparent: true, opacity: 0.35,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.pulse = new THREE.Mesh(new THREE.CircleGeometry(2.2, 36), pulseMat);
    this.pulse.rotation.x = -Math.PI / 2;
    this.pulse.position.set(this.position.x, 0.03, this.position.z);
    this.pulse.visible = false;
    scene.add(this.pulse);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, opacity: 0.8,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.15, 36),
      ringMat,
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(this.position.x, 0.04, this.position.z);
    this.ring.visible = false;
    scene.add(this.ring);

    // Unlock ground decal
    this.decal = new ZoneDecal({
      width: 2.8, depth: 2.0,
      label: `🪙 ${this.cfg.unlockCost}`, icon: '🚜',
      color: '#ffd24a', textColor: 'rgba(255,240,200,0.98)',
      textSize: 130, rounded: true, cornerRadius: 0.3,
    });
    this.decal.setPosition(this.position.x, this.position.z + 3.0);
    this.decal.addTo(scene);
    this.decal.mesh.visible = false;

    // Floating card
    const el = document.createElement('div');
    el.className = 'level-card';
    el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();

    this._t = 0;
  }

  _prereqMet() {
    if (HelperStats.level < 2) return false;
    for (const k of this.cfg.requiredL3) {
      const s = this.buildManager.sites[k];
      if (!s || !s.completed || (s.level || 1) < 3) return false;
    }
    return true;
  }

  update(dt, player, particles) {
    if (this.unlocked) return;
    this._t += dt;
    const ready = this._prereqMet();
    if (ready !== this.revealed) {
      this.revealed = ready;
      this.previewGroup.visible = ready;
      this.pulse.visible = ready;
      this.ring.visible = ready;
      this.decal.mesh.visible = ready;
    }
    if (!ready) {
      this.card.style.display = 'none';
      return;
    }

    // Pulse + shimmer
    const k = (Math.sin(this._t * 2.4) + 1) * 0.5;
    this.pulse.scale.setScalar(0.9 + k * 0.25);
    this.pulse.material.opacity = 0.2 + k * 0.3;
    this.ring.scale.setScalar(1.0 + k * 0.3);
    this.ring.material.opacity = 0.4 + (1 - k) * 0.5;
    this.previewGroup.position.y = Math.sin(this._t * 2.0) * 0.12;
    this.previewGroup.rotation.y = Math.sin(this._t * 0.6) * 0.3;
    this.decal.update(dt);

    // Sparkle particles occasionally
    if (particles && Math.random() < 0.05) {
      particles.sparkle({
        x: this.position.x + (Math.random() - 0.5) * 2.2,
        y: 0.8 + Math.random() * 1.5,
        z: this.position.z + (Math.random() - 0.5) * 1.8,
      }, { count: 2 });
    }

    // Collision: step on decal + pay cost
    const dpx = player.group.position.x - this.position.x;
    const dpz = player.group.position.z - (this.position.z + 3.0);
    const onDecal = Math.hypot(dpx, dpz) < 1.4;
    if (onDecal && Inventory.coin >= this.cfg.unlockCost) {
      Inventory.coin -= this.cfg.unlockCost;
      Inventory.emit();
      this._unlock(particles);
      return;
    }

    const near = Math.hypot(
      player.group.position.x - this.position.x,
      player.group.position.z - this.position.z,
    ) < 7;
    this.card.style.display = near ? 'block' : 'none';
    if (!near) return;
    const sig = `${this.cfg.unlockCost}|${Inventory.coin >= this.cfg.unlockCost}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      const canPay = Inventory.coin >= this.cfg.unlockCost;
      this.card.innerHTML = `
        <div class="title">🚜 Unlock Tractor</div>
        <div class="lvl-row">
          <span class="${canPay ? 'done' : 'missing'}">🪙 ${this.cfg.unlockCost}</span>
        </div>
      `;
    }
    this._projVec.set(this.position.x, 2.2, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';
  }

  _unlock(particles) {
    this.unlocked = true;
    this.scene.remove(this.previewGroup);
    this.scene.remove(this.pulse);
    this.scene.remove(this.ring);
    this.decal.removeFrom(this.scene);
    this.card.remove();
    if (particles) {
      particles.burst(
        { x: this.position.x, y: 1.5, z: this.position.z },
        { count: 60, power: 7.5, ttl: 1.8, scale: 1.3 },
      );
    }
    showLevelBanner({ tier: 'UNLOCKED', name: 'TRACTOR', icon: '🚜' });
    if (this.onUnlock) this.onUnlock(this.position);
  }
}
