import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory } from './state.js';

// ===== Combine Harvester — slow auto-harvester that only eats crop cells =====
// Has a front reel that spins + cutting bar underneath. Very visibly a
// harvester rather than a car. Sweeps the unlocked farms in lawnmower
// rows, "ejecting" harvested crops into a companion tractor that drives
// alongside. When the tractor bin is full the tractor peels off to deliver,
// and the harvester idles in place until the tractor returns.

function buildHarvesterMesh() {
  const g = new THREE.Group();
  const redMat = new THREE.MeshLambertMaterial({ color: 0xc94a28 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const metal = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xffd040 });
  const winMat = new THREE.MeshLambertMaterial({ color: 0xa0d8ff, transparent: true, opacity: 0.75 });

  // Main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.8), redMat);
  body.position.y = 0.85;
  g.add(body);

  // Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.9), redMat);
  cab.position.set(0, 1.55, -0.35);
  g.add(cab);
  const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 0.95), winMat);
  cabGlass.position.set(0, 1.6, -0.35);
  g.add(cabGlass);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1.05), dark);
  cabRoof.position.set(0, 1.95, -0.35);
  g.add(cabRoof);

  // Grain bin on top (back) — tall hopper
  const bin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), metal);
  bin.position.set(0, 1.7, -1.1);
  g.add(bin);

  // Unload auger arm sticking out the side
  const auger = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 10), metal);
  auger.rotation.z = Math.PI / 2.3;
  auger.position.set(0.9, 1.5, -0.95);
  g.add(auger);

  // FRONT HEADER — the big reel + cutting bar. Offset forward so the
  // harvester clearly has a "business end" pointing +Z.
  const header = new THREE.Group();
  header.position.set(0, 0, 1.35);
  g.add(header);
  const cutter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 0.3), yellow);
  cutter.position.y = 0.32;
  header.add(cutter);
  const cutterBladeMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  for (let i = -1; i <= 1; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.18), cutterBladeMat);
    blade.position.set(i * 0.8, 0.18, 0);
    header.add(blade);
  }
  // Spinning reel — 6 slats rotating around a horizontal axle
  const reel = new THREE.Group();
  reel.position.set(0, 0.55, 0.25);
  header.add(reel);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), dark);
  axle.rotation.z = Math.PI / 2;
  reel.add(axle);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const slat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.12), cutterBladeMat);
    slat.position.set(0, Math.cos(a) * 0.25, Math.sin(a) * 0.25);
    slat.rotation.x = a;
    reel.add(slat);
  }
  g.userData.reel = reel;

  // Wheels — big rear, small front (like a real combine)
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xd8d8dc });
  const wheels = [];
  const addWheel = (x, y, z, r, hubR) => {
    const geo = new THREE.CylinderGeometry(r, r, 0.25, 14);
    geo.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(geo, wheelMat);
    w.position.set(x, y, z);
    g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 0.27, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(w.position);
    g.add(hub);
    wheels.push(w);
  };
  addWheel(-0.8, 0.55, -0.7, 0.55, 0.18);
  addWheel( 0.8, 0.55, -0.7, 0.55, 0.18);
  addWheel(-0.75, 0.32, 0.85, 0.32, 0.12);
  addWheel( 0.75, 0.32, 0.85, 0.32, 0.12);
  g.userData.wheels = wheels;

  // Exhaust stack
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.65, 10), dark);
  stack.position.set(-0.45, 2.2, 0.1);
  g.add(stack);
  return g;
}

// Simple chibi tractor with a shallow grain trailer, built smaller than the
// endgame tractor so they read differently. Used as the companion follower.
function buildCompanionTractorMesh() {
  const g = new THREE.Group();
  const green = new THREE.MeshLambertMaterial({ color: 0x3aa538 });
  const dark  = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
  const metal = new THREE.MeshLambertMaterial({ color: 0xd8d8dc });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.4), green);
  chassis.position.y = 0.4;
  g.add(chassis);
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.45, 0.7), green);
  bonnet.position.set(0, 0.72, 0.4);
  g.add(bonnet);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.6), green);
  cab.position.set(0, 0.95, -0.25);
  g.add(cab);
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.4, 0.62),
    new THREE.MeshLambertMaterial({ color: 0xa0d8ff, transparent: true, opacity: 0.75 }),
  );
  win.position.set(0, 1.0, -0.25);
  g.add(win);

  // Wheels
  const wheels = [];
  const addWheel = (x, y, z, r) => {
    const geo = new THREE.CylinderGeometry(r, r, 0.2, 12);
    geo.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(geo, dark);
    w.position.set(x, y, z);
    g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.22, 8), metal);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(w.position);
    g.add(hub);
    wheels.push(w);
  };
  addWheel(-0.45, 0.28, 0.45, 0.22);
  addWheel( 0.45, 0.28, 0.45, 0.22);
  addWheel(-0.5, 0.4, -0.4, 0.4);
  addWheel( 0.5, 0.4, -0.4, 0.4);
  g.userData.wheels = wheels;

  // Hopper / bin behind
  const bin = new THREE.Group();
  bin.position.set(0, 0, -1.5);
  g.add(bin);
  const binBase = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 1.1), metal);
  binBase.position.y = 0.5;
  bin.add(binBase);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe9c75a });
  const wallH = 0.4;
  const walls = [
    [0.95, wallH, 0.06, 0, 0.55 + wallH / 2, 0.52],
    [0.95, wallH, 0.06, 0, 0.55 + wallH / 2, -0.52],
    [0.06, wallH, 1.05, 0.48, 0.55 + wallH / 2, 0],
    [0.06, wallH, 1.05, -0.48, 0.55 + wallH / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    bin.add(m);
  }
  // Trailer wheels
  const tWGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 12);
  tWGeo.rotateZ(Math.PI / 2);
  for (const x of [-0.52, 0.52]) {
    const w = new THREE.Mesh(tWGeo, dark);
    w.position.set(x, 0.28, 0);
    bin.add(w);
    g.userData.wheels.push(w);
  }

  // Contents group that shows stacked crop meshes as the bin fills
  const contents = new THREE.Group();
  contents.position.set(0, 0.85, 0);
  bin.add(contents);
  g.userData.bin = bin;
  g.userData.binContents = contents;
  g.userData.binMeshes = [];
  return g;
}

function setBinCarry(group, items, protos) {
  const sig = Object.entries(items || {}).map(([k, v]) => `${k}:${v}`).join(',');
  if (group.userData.binSig === sig) return;
  group.userData.binSig = sig;
  const cg = group.userData.binContents;
  const meshes = group.userData.binMeshes;
  const cap = 12;
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
    const col = i % 3;
    const row = Math.floor(i / 3);
    m.position.set(-0.25 + col * 0.25, (row % 2) * 0.18, -0.3 + Math.floor(i / 6) * 0.3);
    m.rotation.z = proto.rotZ || 0;
  }
}

// The two-vehicle duo as a single update()-able object.
export class HarvesterCrew {
  constructor(scene, world, farms, buildManager, carryProtos, particles = null) {
    this.scene = scene;
    this.world = world;
    this.farms = farms;
    this.buildManager = buildManager;
    this.protos = carryProtos;
    this.particles = particles;
    this.cfg = CONFIG.harvester;

    this.harvester = buildHarvesterMesh();
    this.tractor = buildCompanionTractorMesh();
    // Idle park pose near the first farm
    const farm = farms[0];
    const base = farm ? farm.center : { x: 0, z: -4 };
    this.harvester.position.set(base.x - 1.4, 0, base.z + 4);
    this.tractor.position.set(base.x + 1.8, 0, base.z + 4);
    scene.add(this.harvester, this.tractor);

    this.binFill = {};
    this.harvestTimer = 0;
    this.state = 'toField';  // toField → sweeping → waitTractor → toField
    this.tractorState = 'following'; // following → toDepot → returning → following
    this._pickField();
  }

  _pickField() {
    // Pick the first unlocked farm with ready/regrowing crops; if none,
    // just idle near the first unlocked farm.
    for (const f of this.farms) {
      if (!f.unlocked) continue;
      if (f.cells.some((c) => c.state === 'ready')) {
        this.targetFarm = f;
        this._pickCellTarget();
        return;
      }
    }
    this.targetFarm = this.farms.find((f) => f.unlocked) || null;
    if (this.targetFarm) {
      this.cellTarget = {
        x: this.targetFarm.center.x,
        z: this.targetFarm.center.z,
      };
    } else {
      this.cellTarget = { x: this.harvester.position.x, z: this.harvester.position.z };
    }
  }

  _pickCellTarget() {
    const f = this.targetFarm;
    if (!f) return;
    // Nearest ready cell to the harvester's current position
    let best = null; let bestD = Infinity;
    const hx = this.harvester.position.x, hz = this.harvester.position.z;
    for (const c of f.cells) {
      if (c.state !== 'ready' || !c.harvestable || c.harvestable.removed) continue;
      const dx = c.x - hx, dz = c.z - hz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      this.cellTarget = { x: best.x, z: best.z };
      this.targetCell = best;
    } else {
      this.targetCell = null;
      this.cellTarget = { x: f.center.x, z: f.center.z };
    }
  }

  _binTotal() {
    let t = 0;
    for (const v of Object.values(this.binFill)) t += v;
    return t;
  }

  _deliveryTarget() {
    const sites = this.buildManager.sites;
    const b = this.binFill;
    if ((b.tomato || 0) > 0 && sites.sauceFactory?.completed) return sites.sauceFactory;
    if ((b.potato || 0) > 0 && sites.chipsFactory?.completed) return sites.chipsFactory;
    if ((b.corn || 0) > 0 && sites.eggFarm?.completed) return sites.eggFarm;
    return sites.market;
  }

  _driveVehicle(veh, tx, tz, speed, dt) {
    const dx = tx - veh.position.x;
    const dz = tz - veh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;
    const step = Math.min(dist, speed * dt);
    veh.position.x += (dx / dist) * step;
    veh.position.z += (dz / dist) * step;
    veh.rotation.y = Math.atan2(dx / dist, dz / dist);
    for (const w of veh.userData.wheels || []) w.rotation.x += step * 3;
    return false;
  }

  update(dt) {
    // Reel spin — always rotating while running (idle or sweeping)
    if (this.harvester.userData.reel) {
      this.harvester.userData.reel.rotation.x += dt * 3.5;
    }

    // ===== Harvester state machine =====
    if (this.state === 'toField' || this.state === 'sweeping') {
      // Re-pick cell target each tick if it got harvested already
      if (!this.targetCell || this.targetCell.state !== 'ready') {
        this._pickCellTarget();
      }
      const arrived = this._driveVehicle(
        this.harvester,
        this.cellTarget.x, this.cellTarget.z - 1.3,
        this.cfg.harvesterSpeed, dt,
      );
      if (arrived && this.targetCell) {
        // Slowly chew through this cell's crop
        this.harvestTimer += dt;
        if (this.harvestTimer >= this.cfg.harvestIntervalSec) {
          this.harvestTimer = 0;
          const c = this.targetCell;
          if (c && c.state === 'ready' && c.harvestable && !c.harvestable.removed) {
            const h = c.harvestable;
            const key = h.yield.key;
            const amt = h.yield.amount || 1;
            this.binFill[key] = (this.binFill[key] || 0) + amt;
            this.world.removeHarvestable(h);
            if (this.particles) {
              this.particles.burst(
                { x: c.x, y: 0.7, z: c.z },
                { count: 8, power: 2.8, ttl: 0.55, scale: 0.7 },
              );
            }
          }
          // Move on to the next ready cell
          this._pickCellTarget();
          // Full? Hand off to tractor
          if (this._binTotal() >= this.cfg.binCapacity) {
            this.state = 'waitTractor';
            this.tractorState = 'toDepot';
          }
        }
      }
    } else if (this.state === 'waitTractor') {
      // Harvester idles while tractor makes its delivery run
      if (this.tractorState === 'following') {
        this.state = 'toField';
        this._pickField();
      }
    }

    // ===== Companion tractor state machine =====
    if (this.tractorState === 'following') {
      // Drive alongside the harvester, staying 1.5u to the east
      const tx = this.harvester.position.x + 1.8;
      const tz = this.harvester.position.z + 0.2;
      this._driveVehicle(this.tractor, tx, tz, this.cfg.tractorSpeed, dt);
    } else if (this.tractorState === 'toDepot') {
      const dst = this._deliveryTarget();
      const p = dst.dropoffPos || dst.position;
      const arrived = this._driveVehicle(
        this.tractor, p.x, p.z, this.cfg.tractorSpeed * 1.4, dt,
      );
      if (arrived) {
        // Offload binFill to Inventory
        for (const [k, v] of Object.entries(this.binFill)) {
          if (v > 0) Inventory.add(k, v);
        }
        this.binFill = {};
        this.tractorState = 'returning';
      }
    } else if (this.tractorState === 'returning') {
      const tx = this.harvester.position.x + 1.8;
      const tz = this.harvester.position.z + 0.2;
      const arrived = this._driveVehicle(
        this.tractor, tx, tz, this.cfg.tractorSpeed * 1.4, dt,
      );
      if (arrived) {
        this.tractorState = 'following';
      }
    }

    setBinCarry(this.tractor, this.binFill, this.protos);
  }
}

// Unlock tile for the Harvester crew — appears once user level is high
// enough and every factory is L3. Matches the existing TractorUnlockTile
// shape but with a dedicated cost and preview pair.
import { ZoneDecal } from './zone.js';
import { showLevelBanner } from './hud.js';
import { UserLevel } from './state.js';

export class HarvesterUnlockTile {
  constructor(scene, camera, buildManager) {
    this.scene = scene;
    this.camera = camera;
    this.buildManager = buildManager;
    this.cfg = CONFIG.harvester;
    this.position = new THREE.Vector3(this.cfg.unlockPos.x, 0, this.cfg.unlockPos.z);
    this.unlocked = false;
    this.revealed = false;

    this.previewH = buildHarvesterMesh();
    this.previewH.position.copy(this.position);
    this.previewH.visible = false;
    this.previewT = buildCompanionTractorMesh();
    this.previewT.position.set(this.position.x + 2.8, 0, this.position.z);
    this.previewT.visible = false;
    scene.add(this.previewH, this.previewT);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, opacity: 0.5,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.pulse = new THREE.Mesh(new THREE.CircleGeometry(3.2, 36), ringMat);
    this.pulse.rotation.x = -Math.PI / 2;
    this.pulse.position.set(this.position.x + 1.4, 0.03, this.position.z);
    this.pulse.visible = false;
    scene.add(this.pulse);

    this.decal = new ZoneDecal({
      width: 3.0, depth: 2.2,
      label: `🪙 ${this.cfg.unlockCost}`, icon: '🌾',
      color: '#ffd24a', textColor: 'rgba(255,240,200,0.98)',
      textSize: 130, rounded: true, cornerRadius: 0.3,
    });
    this.decal.setPosition(this.position.x + 1.4, this.position.z + 3.2);
    this.decal.addTo(scene);
    this.decal.mesh.visible = false;

    const el = document.createElement('div');
    el.className = 'level-card';
    el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();
    this._t = 0;
  }

  _prereqMet() {
    if (UserLevel.level < this.cfg.minUserLevel) return false;
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
      this.previewH.visible = ready;
      this.previewT.visible = ready;
      this.pulse.visible = ready;
      this.decal.mesh.visible = ready;
    }
    if (!ready) {
      this.card.style.display = 'none';
      return;
    }
    const k = (Math.sin(this._t * 2.2) + 1) * 0.5;
    this.pulse.scale.setScalar(0.95 + k * 0.22);
    this.pulse.material.opacity = 0.3 + k * 0.35;
    this.previewH.position.y = Math.sin(this._t * 1.8) * 0.1;
    this.previewT.position.y = Math.sin(this._t * 2.1 + 1) * 0.1;
    this.decal.update(dt);

    const dpx = player.group.position.x - (this.position.x + 1.4);
    const dpz = player.group.position.z - (this.position.z + 3.2);
    if (Math.hypot(dpx, dpz) < 1.4 && Inventory.coin >= this.cfg.unlockCost) {
      Inventory.coin -= this.cfg.unlockCost;
      Inventory.emit();
      this._unlock(particles);
      return;
    }
    const near = Math.hypot(
      player.group.position.x - this.position.x,
      player.group.position.z - this.position.z,
    ) < 8;
    this.card.style.display = near ? 'block' : 'none';
    if (!near) return;
    const sig = `${this.cfg.unlockCost}|${Inventory.coin >= this.cfg.unlockCost}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      const canPay = Inventory.coin >= this.cfg.unlockCost;
      this.card.innerHTML = `
        <div class="title">🌾 Unlock Harvester</div>
        <div class="lvl-row"><span class="${canPay ? 'done' : 'missing'}">🪙 ${this.cfg.unlockCost}</span></div>
      `;
    }
    this._projVec.set(this.position.x + 1.4, 2.4, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';
  }

  _unlock(particles) {
    this.unlocked = true;
    this.scene.remove(this.previewH);
    this.scene.remove(this.previewT);
    this.scene.remove(this.pulse);
    this.decal.removeFrom(this.scene);
    this.card.remove();
    if (particles) {
      particles.burst(
        { x: this.position.x + 1.4, y: 1.5, z: this.position.z },
        { count: 60, power: 7.5, ttl: 1.8, scale: 1.3 },
      );
    }
    showLevelBanner({ tier: 'UNLOCKED', name: 'HARVESTER', icon: '🌾' });
    if (this.onUnlock) this.onUnlock();
  }
}
