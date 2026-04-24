import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ZoneDecal } from './zone.js';

// Shared plant geometry pool — one fruit + one leaf + one stem per crop,
// reused across every replant of every cell (hundreds of reseeds without
// leaking GPU buffers).
const PLANT_PROTOS = {};
function getPlantProto(cropKey) {
  if (PLANT_PROTOS[cropKey]) return PLANT_PROTOS[cropKey];
  const crop = CONFIG.crops[cropKey];
  PLANT_PROTOS[cropKey] = {
    leafGeo: new THREE.SphereGeometry(0.22, 8, 6),
    leafMat: new THREE.MeshLambertMaterial({ color: crop.leafColor }),
    fruitGeo: new THREE.SphereGeometry(0.16, 10, 8),
    fruitMat: new THREE.MeshLambertMaterial({ color: crop.fruitColor }),
    stemGeo: new THREE.CylinderGeometry(0.04, 0.05, crop.height, 5),
    stemMat: new THREE.MeshLambertMaterial({ color: 0x2a4a2a }),
    height: crop.height,
  };
  return PLANT_PROTOS[cropKey];
}

// Grid of crop cells. Each cell lifecycle: empty → seeded (growing) → ready
// (harvestable). Only ready cells appear in world.harvestables. Empty plot
// auto-reseeds after a short delay once the player has picked a crop.
export class Farm {
  constructor(scene, cfg = CONFIG.farm) {
    this.scene = scene;
    this.cfg = cfg;
    this.cols = cfg.cols;
    this.rows = cfg.rows;
    this.center = new THREE.Vector3(cfg.center.x, 0, cfg.center.z);

    this.unlocked = false;
    this.requiresExpansion = !!cfg.requiresExpansion;
    this.expansionUnlocked = !this.requiresExpansion;
    this.cropKey = null;
    this.tier = 1;          // 1: base size, 2 & 3: bigger plots
    // Each cell: { x, z, plant: Group|null, harvestable: ref|null,
    //              growT: seconds_since_seed, growSec: total_grow_time,
    //              state: 'empty'|'growing'|'ready' }
    this.cells = [];
    this._reseedTimer = 0;

    this._buildDecal();
    this._buildCells();
    this._buildProps();
  }

  // Decorative props around the planter bed — watering can on the south-
  // east corner, scarecrow on a stake, small seed sack. Pure set dressing,
  // no collision. Adds character without adding draw-call cost.
  _buildProps() {
    const props = new THREE.Group();
    this.decalGroup.add(props);
    const w = this.bounds.width;
    const d = this.bounds.depth;

    // Watering can: blue metal body + spout + handle
    const can = new THREE.Group();
    const metalBlue = new THREE.MeshLambertMaterial({ color: 0x4a90c4 });
    const metalDark = new THREE.MeshLambertMaterial({ color: 0x2a5a7a });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.32, 12), metalBlue);
    body.position.y = 0.35;
    can.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 6, 14), metalDark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.51;
    can.add(rim);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.28, 8), metalBlue);
    spout.rotation.z = Math.PI / 2.6;
    spout.position.set(0.22, 0.42, 0);
    can.add(spout);
    const spoutHead = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), metalDark);
    spoutHead.rotation.z = Math.PI / 2.6;
    spoutHead.position.set(0.34, 0.48, 0);
    can.add(spoutHead);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 14, Math.PI), metalDark);
    handle.rotation.z = Math.PI;
    handle.position.set(-0.05, 0.58, 0);
    can.add(handle);
    can.position.set(this.center.x + w / 2 + 0.4, 0, this.center.z + d / 2 + 0.3);
    can.rotation.y = -0.6;
    props.add(can);

    // Scarecrow: wooden stake + straw body + pumpkin head with button eyes
    const scare = new THREE.Group();
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x7a5232 });
    const strawMat = new THREE.MeshLambertMaterial({ color: 0xd9b24a });
    const clothMat = new THREE.MeshLambertMaterial({ color: 0xc43a3a });
    const pumpkinMat = new THREE.MeshLambertMaterial({ color: 0xe07028 });
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8), woodMat);
    stake.position.y = 0.7;
    scare.add(stake);
    const crossArms = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), woodMat);
    crossArms.rotation.z = Math.PI / 2;
    crossArms.position.y = 1.05;
    scare.add(crossArms);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.2), clothMat);
    torso.position.y = 0.95;
    scare.add(torso);
    // Straw tufts at cuffs
    const strawGeo = new THREE.IcosahedronGeometry(0.1, 0);
    for (const x of [-0.5, 0.5]) {
      const s1 = new THREE.Mesh(strawGeo, strawMat);
      s1.position.set(x, 1.0, 0);
      scare.add(s1);
    }
    // Pumpkin head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), pumpkinMat);
    head.scale.set(1.1, 0.9, 1.1);
    head.position.y = 1.45;
    scare.add(head);
    // Eyes + smile
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1008 });
    const eyeGeo = new THREE.SphereGeometry(0.03, 6, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.07, 1.48, 0.18); scare.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set( 0.07, 1.48, 0.18); scare.add(eyeR);
    scare.position.set(this.center.x - w / 2 - 0.6, 0, this.center.z + d / 2 + 0.2);
    props.add(scare);

    // Seed sack: burlap bag with a cord tie
    const sack = new THREE.Group();
    const sackMat = new THREE.MeshLambertMaterial({ color: 0xd9b880 });
    const cordMat = new THREE.MeshLambertMaterial({ color: 0x6a4028 });
    const sackBody = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), sackMat);
    sackBody.scale.set(1.0, 1.2, 0.9);
    sackBody.position.y = 0.2;
    sack.add(sackBody);
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 6, 14), cordMat);
    cord.rotation.x = Math.PI / 2;
    cord.position.y = 0.32;
    sack.add(cord);
    const neck = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 8), sackMat);
    neck.position.y = 0.4;
    sack.add(neck);
    sack.position.set(this.center.x + w / 2 + 0.3, 0, this.center.z - d / 2 - 0.35);
    sack.rotation.y = 0.7;
    props.add(sack);
  }

  _buildDecal() {
    // Raised wooden planter bed: the soil sits inside a box of chunky wooden
    // walls, ~0.3u above ground so the crops grow "out of the bed" like the
    // reference screenshots.
    const width = this.cols * this.cfg.spacing + 0.8;
    const depth = this.rows * this.cfg.spacing + 0.6;
    this.bounds = { width, depth };
    this.soilY = 0.22;
    this.decalGroup = new THREE.Group();
    this.scene.add(this.decalGroup);
    // If this farm is gated behind the expansion unlock, hide the whole bed
    // until the player activates expansion.
    this.decalGroup.visible = this.expansionUnlocked;

    // Raised soil surface (thin box so it has visible sides too)
    const soilMat = new THREE.MeshLambertMaterial({ color: 0x6a4628 });
    const soil = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.2, depth),
      soilMat
    );
    soil.position.set(this.center.x, 0.12, this.center.z);
    this.decalGroup.add(soil);
    this.soilMesh = soil;

    // Darker plow furrows on top of the soil
    const furrowMat = new THREE.MeshLambertMaterial({ color: 0x3a2410 });
    this.furrowGroup = new THREE.Group();
    const furrowCount = this.rows * 2;
    const furrowGeo = new THREE.PlaneGeometry(width * 0.92, 0.1);
    furrowGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < furrowCount; i++) {
      const f = new THREE.Mesh(furrowGeo, furrowMat);
      const t = (i + 0.5) / furrowCount;
      f.position.set(this.center.x, this.soilY + 0.005, this.center.z - depth / 2 + t * depth);
      this.furrowGroup.add(f);
    }
    this.decalGroup.add(this.furrowGroup);

    // Wooden planter walls — thick enough to read as a real box from top-down
    const plankMat = new THREE.MeshLambertMaterial({ color: 0x8a5a32 });
    const plankDark = new THREE.MeshLambertMaterial({ color: 0x5a3820 });
    const wallH = 0.32;
    const wallT = 0.18;
    const hRail = new THREE.Mesh(
      new THREE.BoxGeometry(width + wallT * 2, wallH, wallT),
      plankMat,
    );
    const vRail = new THREE.Mesh(
      new THREE.BoxGeometry(wallT, wallH, depth + wallT * 2),
      plankMat,
    );
    const y = wallH / 2;
    const hN = hRail.clone(); hN.position.set(this.center.x, y, this.center.z - depth / 2 - wallT / 2);
    const hS = hRail.clone(); hS.position.set(this.center.x, y, this.center.z + depth / 2 + wallT / 2);
    const vW = vRail.clone(); vW.position.set(this.center.x - width / 2 - wallT / 2, y, this.center.z);
    const vE = vRail.clone(); vE.position.set(this.center.x + width / 2 + wallT / 2, y, this.center.z);
    this.decalGroup.add(hN, hS, vW, vE);
    this.frame = [hN, hS, vW, vE];

    // Dark corner posts so the box silhouette pops
    const postGeo = new THREE.BoxGeometry(wallT * 1.2, wallH * 1.15, wallT * 1.2);
    for (const [cx, cz] of [
      [-width / 2 - wallT / 2, -depth / 2 - wallT / 2],
      [ width / 2 + wallT / 2, -depth / 2 - wallT / 2],
      [-width / 2 - wallT / 2,  depth / 2 + wallT / 2],
      [ width / 2 + wallT / 2,  depth / 2 + wallT / 2],
    ]) {
      const p = new THREE.Mesh(postGeo, plankDark);
      p.position.set(this.center.x + cx, y + 0.02, this.center.z + cz);
      this.decalGroup.add(p);
      this.frame.push(p);
    }
  }

  _buildCells() {
    const startX = this.center.x - ((this.cols - 1) * this.cfg.spacing) / 2;
    const startZ = this.center.z - ((this.rows - 1) * this.cfg.spacing) / 2;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = startX + c * this.cfg.spacing;
        const z = startZ + r * this.cfg.spacing;
        this.cells.push({
          col: c, row: r,
          x, z,
          plant: null, harvestable: null,
          growT: 0, growSec: 0,
          state: 'empty',
        });
      }
    }
  }

  setUnlocked(v) { this.unlocked = v; }
  setExpansionUnlocked(v) {
    this.expansionUnlocked = !!v;
    if (this.decalGroup) this.decalGroup.visible = this.expansionUnlocked;
  }

  // Grow the planter bed by +1 col and +1 row per tier (5x3 → 6x4 → 7x5).
  // Preserves existing plants by matching cells on their grid coordinates.
  upgradeSize() {
    if (this.tier >= 3) return false;
    this.tier += 1;
    this.cols += 1;
    this.rows += 1;
    const oldCells = this.cells.slice();
    // Clear the old visual group (soil + frame + furrows + props)
    if (this.decalGroup) {
      this.scene.remove(this.decalGroup);
      this.decalGroup = null;
    }
    this.cells = [];
    this._buildDecal();
    this._buildCells();
    // Copy matching old cells by (col, row) grid index and move the plant
    // mesh to the new cell's world position (center shifts on resize).
    for (const oldCell of oldCells) {
      const match = this.cells.find((c) =>
        c.col === oldCell.col && c.row === oldCell.row);
      if (!match) continue;
      if (oldCell.plant) {
        match.plant = oldCell.plant;
        match.plant.position.set(match.x, this.soilY, match.z);
        match.state = oldCell.state;
        match.growT = oldCell.growT;
        match.growSec = oldCell.growSec;
        match.cropKey = oldCell.cropKey;
        match.harvestable = oldCell.harvestable;
        if (match.harvestable) {
          match.harvestable.cell = match;
          match.harvestable.position = match.plant.position;
        }
      }
    }
    this._buildProps();
    return true;
  }

  isInside(pos) {
    const dx = Math.abs(pos.x - this.center.x);
    const dz = Math.abs(pos.z - this.center.z);
    return dx < this.bounds.width / 2 && dz < this.bounds.depth / 2;
  }

  hasEmptyCells() { return this.cells.some((c) => c.state === 'empty'); }
  isFullyEmpty()  { return this.cells.every((c) => c.state === 'empty'); }

  // Seed all empty cells with the given crop. Plants start tiny and grow
  // to full size over CONFIG.crops[key].growSec seconds before becoming
  // harvestable.
  seed(cropKey, worldHarvestables) {
    const crop = CONFIG.crops[cropKey];
    if (!crop) return;
    this.cropKey = cropKey;
    for (const cell of this.cells) {
      if (cell.state !== 'empty') continue;
      cell.plant = this._makePlantMesh(crop);
      cell.plant.position.set(cell.x, this.soilY, cell.z);
      cell.plant.scale.setScalar(0.2);
      this.scene.add(cell.plant);
      cell.growT = 0;
      cell.growSec = crop.growSec;
      cell.state = 'growing';
      cell.cropKey = cropKey;
      cell.harvestable = null;
      void worldHarvestables; // harvestable added when plant is ready
    }
  }

  _makePlantMesh(crop) {
    const proto = getPlantProto(crop.key);
    const g = new THREE.Group();
    // Stem + leaf crown are the STUB — always visible once seeded.
    const stem = new THREE.Mesh(proto.stemGeo, proto.stemMat);
    stem.position.y = proto.height / 2;
    g.add(stem);
    const leaf = new THREE.Mesh(proto.leafGeo, proto.leafMat);
    leaf.position.y = proto.height * 0.6;
    leaf.scale.set(1.1, 0.6, 1.1);
    g.add(leaf);
    // Fruits — vanish on harvest, pop back on regrow.
    const fruits = [];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(proto.fruitGeo, proto.fruitMat);
      const a = (i / 3) * Math.PI * 2;
      f.position.set(Math.cos(a) * 0.18, proto.height * 0.45, Math.sin(a) * 0.18);
      g.add(f);
      fruits.push(f);
    }
    g.userData.fruits = fruits;
    g.userData.stubs = [stem, leaf];
    return g;
  }

  onHarvestableRemoved(h) {
    const cell = h.cell;
    if (!cell) return;
    // Keep the stub (stem + leaves) visible — only hide the fruits and
    // start the regrow timer. The plot always reads as "planted".
    if (cell.plant && cell.plant.userData.fruits) {
      for (const f of cell.plant.userData.fruits) f.visible = false;
    }
    cell.harvestable = null;
    // Regrow ~60% of the original grow time — faster than a fresh seed.
    const crop = CONFIG.crops[cell.cropKey];
    cell.state = 'regrowing';
    cell.growT = 0;
    cell.growSec = (crop?.growSec || 4.5) * 0.6;
  }

  update(dt, worldHarvestables) {
    if (!this.unlocked) return;
    // Grow ticking — both initial 'growing' and post-harvest 'regrowing'
    // cells progress the fruit in. Initial growth scales the whole plant
    // up; regrow just pops the fruits back in.
    for (const cell of this.cells) {
      if (!cell.plant) continue;
      if (cell.state === 'growing') {
        cell.growT += dt;
        const t = Math.min(1, cell.growT / cell.growSec);
        const s = 0.2 + 0.8 * (1 - Math.pow(1 - t, 2));
        cell.plant.scale.setScalar(s);
      } else if (cell.state === 'regrowing') {
        cell.growT += dt;
        const t = Math.min(1, cell.growT / cell.growSec);
        // Fruits pop in at t>=0.75 so stubs sit bare for most of the cycle
        const fruits = cell.plant.userData.fruits;
        if (fruits) {
          const show = t >= 0.75;
          const fruitScale = show ? Math.min(1, (t - 0.75) / 0.25 * 1.1) : 0;
          for (const f of fruits) {
            f.visible = show;
            if (show) f.scale.setScalar(fruitScale);
          }
        }
      } else {
        continue;
      }
      if (cell.growT >= cell.growSec) {
        cell.state = 'ready';
        // Reset any fruit scale to 1 on full ripen
        if (cell.plant.userData.fruits) {
          for (const f of cell.plant.userData.fruits) {
            f.visible = true;
            f.scale.setScalar(1);
          }
        }
        const harv = {
          kind: 'cropCell',
          type: cell.cropKey,
          hp: 1,
          yield: { key: cell.cropKey, amount: this.cfg.harvestYield },
          radius: 0.4,
          position: cell.plant.position,
          cell,
          farm: this,
          removed: false,
        };
        cell.harvestable = harv;
        worldHarvestables.push(harv);
      }
    }
    // Auto-reseed once fully empty + crop chosen
    if (this.isFullyEmpty() && this.cropKey) {
      this._reseedTimer += dt;
      if (this._reseedTimer > this.cfg.reseedDelayMs / 1000) {
        this._reseedTimer = 0;
        this.seed(this.cropKey, worldHarvestables);
      }
    } else {
      this._reseedTimer = 0;
    }
    // Plowed-soil farm no longer has an animated decal
  }
}
