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
    this.cropKey = null;
    // Each cell: { x, z, plant: Group|null, harvestable: ref|null,
    //              growT: seconds_since_seed, growSec: total_grow_time,
    //              state: 'empty'|'growing'|'ready' }
    this.cells = [];
    this._reseedTimer = 0;

    this._buildDecal();
    this._buildCells();
  }

  _buildDecal() {
    const width = this.cols * this.cfg.spacing + 1.2;
    const depth = this.rows * this.cfg.spacing + 1.0;
    this.decal = new ZoneDecal({
      width, depth,
      label: 'FARM', icon: '',
      color: '#a0ffb0', textColor: 'rgba(240,255,220,0.95)',
      textSize: 110,
    });
    this.decal.setPosition(this.center.x, this.center.z);
    this.decal.addTo(this.scene);
    this.bounds = { width, depth };

    const soil = new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.6, depth - 0.6),
      new THREE.MeshLambertMaterial({ color: 0x5a3e22, transparent: true, opacity: 0.6 })
    );
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(this.center.x, 0.03, this.center.z);
    this.scene.add(soil);
    this.soilMesh = soil;
  }

  _buildCells() {
    const startX = this.center.x - ((this.cols - 1) * this.cfg.spacing) / 2;
    const startZ = this.center.z - ((this.rows - 1) * this.cfg.spacing) / 2;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = startX + c * this.cfg.spacing;
        const z = startZ + r * this.cfg.spacing;
        this.cells.push({
          x, z,
          plant: null, harvestable: null,
          growT: 0, growSec: 0,
          state: 'empty',
        });
      }
    }
  }

  setUnlocked(v) { this.unlocked = v; }

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
      cell.plant.position.set(cell.x, 0, cell.z);
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
    const leaf = new THREE.Mesh(proto.leafGeo, proto.leafMat);
    leaf.position.y = proto.height * 0.6;
    leaf.scale.set(1.1, 0.6, 1.1);
    g.add(leaf);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(proto.fruitGeo, proto.fruitMat);
      const a = (i / 3) * Math.PI * 2;
      f.position.set(Math.cos(a) * 0.18, proto.height * 0.45, Math.sin(a) * 0.18);
      g.add(f);
    }
    const stem = new THREE.Mesh(proto.stemGeo, proto.stemMat);
    stem.position.y = proto.height / 2;
    g.add(stem);
    return g;
  }

  onHarvestableRemoved(h) {
    const cell = h.cell;
    if (!cell) return;
    if (cell.plant) {
      // Don't dispose geos/mats — they're shared via PLANT_PROTOS.
      this.scene.remove(cell.plant);
      cell.plant = null;
    }
    cell.harvestable = null;
    cell.state = 'empty';
    cell.growT = 0;
    this._reseedTimer = 0;
  }

  update(dt, worldHarvestables) {
    if (!this.unlocked) return;
    // Grow ticking
    for (const cell of this.cells) {
      if (cell.state !== 'growing' || !cell.plant) continue;
      cell.growT += dt;
      const t = Math.min(1, cell.growT / cell.growSec);
      // Ease-out scale so they puff up on finish
      const s = 0.2 + 0.8 * (1 - Math.pow(1 - t, 2));
      cell.plant.scale.setScalar(s);
      if (cell.growT >= cell.growSec) {
        cell.state = 'ready';
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
    if (this.decal) this.decal.update(dt);
  }
}
