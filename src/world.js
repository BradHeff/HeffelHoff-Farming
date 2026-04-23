import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ZoneDecal } from './zone.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rand = mulberry32(1337);
    this.harvestables = [];        // all harvestables (grass + trees)
    this.grassInstanceMesh = null; // InstancedMesh for grass
    this._buildGround();
    this._buildBiomeOverlays();
    this._buildGrassCarpet();
    this._buildForest();
    this._buildPerimeter();
    this._buildPassiveHarvestZone();
  }

  _buildPassiveHarvestZone() {
    const pz = CONFIG.passiveHarvest;
    this.passiveDecal = new ZoneDecal({
      width: pz.radiusX * 2,
      depth: pz.radiusZ * 2,
      label: 'HARVEST', icon: '',
      color: '#8fffb1', textColor: 'rgba(240,255,220,0.95)',
      textSize: 110,
    });
    this.passiveDecal.setPosition(pz.center.x, pz.center.z);
    this.passiveDecal.addTo(this.scene);
    this.passiveCenter = new THREE.Vector3(pz.center.x, 0, pz.center.z);
    this._passiveTimer = 0;
  }

  // Returns a grass harvestable within `reach` of `pos` if the pos is inside
  // the passive-harvest rectangle; else null.
  tickPassiveHarvest(pos, dt) {
    const pz = CONFIG.passiveHarvest;
    const dx = pos.x - pz.center.x;
    const dz = pos.z - pz.center.z;
    if (Math.abs(dx) > pz.radiusX || Math.abs(dz) > pz.radiusZ) return null;
    this._passiveTimer += dt;
    if (this._passiveTimer < pz.intervalSec) return null;
    this._passiveTimer = 0;

    // Pick nearest grass within reach
    let best = null; let bestD = Infinity;
    const r2 = pz.reach * pz.reach;
    for (const h of this.harvestables) {
      if (h.removed || h.type !== 'grass') continue;
      const ddx = h.position.x - pos.x;
      const ddz = h.position.z - pos.z;
      const d = ddx * ddx + ddz * ddz;
      if (d < bestD && d < r2) { bestD = d; best = h; }
    }
    return best;
  }

  _buildGround() {
    const size = CONFIG.world.size;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.ground });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _buildBiomeOverlays() {
    // Tint the ground under each biome so zones read clearly from the camera.
    const { meadow, forest } = CONFIG.world;

    const meadowGeo = new THREE.PlaneGeometry(meadow.maxX - meadow.minX, meadow.maxZ - meadow.minZ);
    meadowGeo.rotateX(-Math.PI / 2);
    const meadowMesh = new THREE.Mesh(
      meadowGeo,
      new THREE.MeshLambertMaterial({ color: CONFIG.colors.meadow, transparent: true, opacity: 0.6 })
    );
    meadowMesh.position.set((meadow.minX + meadow.maxX) / 2, 0.02, (meadow.minZ + meadow.maxZ) / 2);
    this.scene.add(meadowMesh);

    const forestGeo = new THREE.PlaneGeometry(forest.maxX - forest.minX, forest.maxZ - forest.minZ);
    forestGeo.rotateX(-Math.PI / 2);
    const forestMesh = new THREE.Mesh(
      forestGeo,
      new THREE.MeshLambertMaterial({ color: CONFIG.colors.forestFloor, transparent: true, opacity: 0.65 })
    );
    forestMesh.position.set((forest.minX + forest.maxX) / 2, 0.02, (forest.minZ + forest.maxZ) / 2);
    this.scene.add(forestMesh);
  }

  _buildGrassCarpet() {
    // Tall wheat-stalk style carpet (matches the reference screenshots).
    // Dense grid placement with jitter so it reads as a thick field rather
    // than scattered tufts. One InstancedMesh for all stalks.
    const { meadow, grassCount } = CONFIG.world;
    // Tall narrow cone — reads as a wheat/grass stalk
    const geo = new THREE.ConeGeometry(0.22, 1.1, 4);
    geo.translate(0, 0.55, 0);
    const mat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.grass });
    const mesh = new THREE.InstancedMesh(geo, mat, grassCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.grassInstanceMesh = mesh;

    const width = meadow.maxX - meadow.minX;
    const depth = meadow.maxZ - meadow.minZ;

    // Near-grid placement: determine a cell count that fits grassCount
    const aspect = width / depth;
    const cellsZ = Math.max(1, Math.round(Math.sqrt(grassCount / aspect)));
    const cellsX = Math.max(1, Math.ceil(grassCount / cellsZ));
    const cellW = width / cellsX;
    const cellD = depth / cellsZ;

    const colorA = new THREE.Color(CONFIG.colors.grass);
    const colorB = new THREE.Color(CONFIG.colors.grassDark);
    const colors = new Float32Array(grassCount * 3);

    let i = 0;
    for (let cz = 0; cz < cellsZ && i < grassCount; cz++) {
      for (let cx = 0; cx < cellsX && i < grassCount; cx++) {
        // Jitter within cell so rows aren't obvious
        const jx = (this.rand() - 0.5) * cellW * 0.75;
        const jz = (this.rand() - 0.5) * cellD * 0.75;
        const x = meadow.minX + cellW * (cx + 0.5) + jx;
        const z = meadow.minZ + cellD * (cz + 0.5) + jz;
        const s = 0.85 + this.rand() * 0.45;
        const sy = s * (0.9 + this.rand() * 0.6);
        const rot = this.rand() * Math.PI * 2;
        _m.makeRotationY(rot);
        _m.scale(new THREE.Vector3(s, sy, s));
        _m.setPosition(x, 0, z);
        mesh.setMatrixAt(i, _m);

        const c = this.rand() < 0.45 ? colorB : colorA;
        colors[i * 3 + 0] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;

        this.harvestables.push({
          instanceId: i,
          type: 'grass',
          kind: 'grassInstance',
          hp: 1,
          yield: { key: 'grass', amount: 1 },
          radius: 0.35,
          position: new THREE.Vector3(x, 0, z),
        });
        i++;
      }
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
  }

  _buildForest() {
    // Clustered trees in the forest biome. Keep individual Groups so we can
    // drop/hide them on harvest; count stays modest (~130) for perf.
    const { forest, treeCount } = CONFIG.world;
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.36, 1.6, 7);
    trunkGeo.translate(0, 0.8, 0);
    const leavesGeo = new THREE.IcosahedronGeometry(1.2, 0);
    leavesGeo.translate(0, 2.2, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeTrunk });
    const leavesA = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeLeaves });
    const leavesB = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeLeavesDark });

    const width = forest.maxX - forest.minX;
    const depth = forest.maxZ - forest.minZ;

    for (let i = 0; i < treeCount; i++) {
      const x = forest.minX + this.rand() * width;
      const z = forest.minZ + this.rand() * depth;
      const group = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      const leaves = new THREE.Mesh(leavesGeo, this.rand() < 0.5 ? leavesA : leavesB);
      const s = 0.9 + this.rand() * 0.5;
      leaves.scale.setScalar(s);
      leaves.position.y += (s - 1) * 0.4;
      group.add(trunk, leaves);
      group.position.set(x, 0, z);
      group.rotation.y = this.rand() * Math.PI * 2;
      this.scene.add(group);
      this.harvestables.push({
        kind: 'treeGroup',
        mesh: group,
        type: 'tree',
        hp: 3,
        yield: { key: 'wood', amount: 2 },
        radius: 0.9,
        position: group.position.clone(),
      });
    }

    // Scatter a few accent bushes for warmth between trees
    const bushGeo = new THREE.SphereGeometry(0.6, 6, 5);
    for (let i = 0; i < 25; i++) {
      const x = forest.minX + this.rand() * width;
      const z = forest.minZ + this.rand() * depth;
      const bush = new THREE.Mesh(bushGeo, leavesA);
      bush.position.set(x, 0.4, z);
      const s = 0.7 + this.rand() * 0.5;
      bush.scale.set(s, s * 0.8, s);
      this.scene.add(bush);
    }
  }

  _buildPerimeter() {
    const size = CONFIG.world.size;
    const postGeo = new THREE.BoxGeometry(0.25, 1.2, 0.25);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const half = size / 2 - 0.5;
    const spacing = 2.5;
    for (let x = -half; x <= half; x += spacing) {
      for (const z of [-half, half]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, 0.6, z);
        this.scene.add(post);
      }
    }
    for (let z = -half; z <= half; z += spacing) {
      for (const x of [-half, half]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, 0.6, z);
        this.scene.add(post);
      }
    }
  }

  update(dt, _elapsed) {
    if (this.passiveDecal) this.passiveDecal.update(dt);
  }

  queryInSlashArc(originVec3, forwardVec3, reach, arcDeg) {
    const out = [];
    const cosHalf = Math.cos((arcDeg * 0.5 * Math.PI) / 180);
    for (const h of this.harvestables) {
      if (h.removed) continue;
      const dx = h.position.x - originVec3.x;
      const dz = h.position.z - originVec3.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + h.radius) continue;
      const nx = dx / Math.max(dist, 1e-5);
      const nz = dz / Math.max(dist, 1e-5);
      const dot = nx * forwardVec3.x + nz * forwardVec3.z;
      if (dot >= cosHalf) out.push({ h, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  removeHarvestable(h) {
    h.removed = true;
    if (h.kind === 'grassInstance') {
      this.grassInstanceMesh.setMatrixAt(h.instanceId, _zero);
      this.grassInstanceMesh.instanceMatrix.needsUpdate = true;
    } else if (h.kind === 'treeGroup') {
      this.scene.remove(h.mesh);
      h.mesh.traverse?.((c) => { if (c.geometry) c.geometry.dispose?.(); });
    }
  }
}
