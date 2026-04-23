import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ZoneDecal } from './zone.js';
import { populateDecorations } from './decorations.js';

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
    this._buildExpansionBiome(); // initially locked — slash ignores these
    this._buildPerimeter();
    populateDecorations(this.scene, this.rand);
  }

  _buildExpansionBiome() {
    // Extra grass + trees in the expansion strip, all marked `_locked` so
    // they ignore slash until the player unlocks the map.
    const ex = CONFIG.expansion;
    if (!ex) return;

    // Overlay showing the locked area tint
    const msGeo = new THREE.PlaneGeometry(ex.meadowStrip.maxX - ex.meadowStrip.minX, ex.meadowStrip.maxZ - ex.meadowStrip.minZ);
    msGeo.rotateX(-Math.PI / 2);
    const msMat = new THREE.MeshLambertMaterial({
      color: 0x6aa93d, transparent: true, opacity: 0.7,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      depthWrite: false,
    });
    const msMesh = new THREE.Mesh(msGeo, msMat);
    msMesh.position.set((ex.meadowStrip.minX + ex.meadowStrip.maxX) / 2, 0.011, (ex.meadowStrip.minZ + ex.meadowStrip.maxZ) / 2);
    this.scene.add(msMesh);

    const fsGeo = new THREE.PlaneGeometry(ex.forestStrip.maxX - ex.forestStrip.minX, ex.forestStrip.maxZ - ex.forestStrip.minZ);
    fsGeo.rotateX(-Math.PI / 2);
    const fsMat = new THREE.MeshLambertMaterial({
      color: 0x387028, transparent: true, opacity: 0.7,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      depthWrite: false,
    });
    const fsMesh = new THREE.Mesh(fsGeo, fsMat);
    fsMesh.position.set((ex.forestStrip.minX + ex.forestStrip.maxX) / 2, 0.011, (ex.forestStrip.minZ + ex.forestStrip.maxZ) / 2);
    this.scene.add(fsMesh);

    // Scatter grass harvestables in the expansion meadow strip
    const grassGeo = this._makeGrassTuftGeometry();
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x69c24a });
    const expGrassMesh = new THREE.InstancedMesh(grassGeo, grassMat, ex.grassCount);
    expGrassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(expGrassMesh);
    this.expansionGrassMesh = expGrassMesh;
    const { minX, maxX, minZ, maxZ } = ex.meadowStrip;
    const m = new THREE.Matrix4();
    const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < ex.grassCount; i++) {
      const x = minX + this.rand() * (maxX - minX);
      const z = minZ + this.rand() * (maxZ - minZ);
      if (this._isReserved(x, z)) {
        expGrassMesh.setMatrixAt(i, zeroM);
        continue;
      }
      const s = 0.85 + this.rand() * 0.45;
      m.makeRotationY(this.rand() * Math.PI * 2);
      m.scale(new THREE.Vector3(s, s, s));
      m.setPosition(x, 0, z);
      expGrassMesh.setMatrixAt(i, m);
      this.harvestables.push({
        instanceId: i,
        type: 'grass',
        kind: 'expansionGrassInstance',
        hp: 1,
        yield: { key: 'grass', amount: 1 },
        radius: 0.4,
        position: new THREE.Vector3(x, 0, z),
        originalMatrix: m.clone(),
        _locked: true,
      });
    }
    expGrassMesh.instanceMatrix.needsUpdate = true;

    // Scatter tree harvestables in the expansion forest strip
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.36, 1.6, 7);
    trunkGeo.translate(0, 0.8, 0);
    const leavesGeo = new THREE.IcosahedronGeometry(1.2, 0);
    leavesGeo.translate(0, 2.2, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeTrunk });
    const leavesMat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeLeavesDark });
    const expTrunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, ex.treeCount);
    const expLeavesInst = new THREE.InstancedMesh(leavesGeo, leavesMat, ex.treeCount);
    expTrunkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    expLeavesInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(expTrunkInst, expLeavesInst);
    this.expansionTreeMeshes = [expTrunkInst, expLeavesInst];
    const fx = ex.forestStrip;
    for (let i = 0; i < ex.treeCount; i++) {
      const x = fx.minX + this.rand() * (fx.maxX - fx.minX);
      const z = fx.minZ + this.rand() * (fx.maxZ - fx.minZ);
      if (this._isReserved(x, z)) {
        expTrunkInst.setMatrixAt(i, zeroM);
        expLeavesInst.setMatrixAt(i, zeroM);
        continue;
      }
      const s = 1.0 + this.rand() * 0.45;
      const rotY = this.rand() * Math.PI * 2;
      m.makeRotationY(rotY);
      m.setPosition(x, 0, z);
      expTrunkInst.setMatrixAt(i, m);
      const trunkM = m.clone();
      const scaleM = new THREE.Matrix4().makeScale(s, s, s);
      const m2 = new THREE.Matrix4().makeRotationY(rotY);
      m2.multiply(scaleM);
      m2.setPosition(x, (s - 1) * 0.4, z);
      expLeavesInst.setMatrixAt(i, m2);
      this.harvestables.push({
        kind: 'expansionTreeInstance',
        instanceId: i,
        type: 'tree',
        hp: 3,
        yield: { key: 'wood', amount: 2 },
        radius: 0.9,
        position: new THREE.Vector3(x, 0, z),
        originalMatrices: [trunkM, m2.clone()],
        _locked: true,
      });
    }
    expTrunkInst.instanceMatrix.needsUpdate = true;
    expLeavesInst.instanceMatrix.needsUpdate = true;

    this._expansionLocked = true;
  }

  // Unlock all expansion harvestables — called by ExpansionTile once the
  // prerequisites and coin cost are met.
  unlockExpansion() {
    for (const h of this.harvestables) {
      if (h._locked) h._locked = false;
    }
    this._expansionLocked = false;
  }

  // Returns true if the point is inside any reserved clearing (build plots,
  // spawn, farm, market). Used to avoid placing grass/trees on top of UI.
  _isReserved(x, z) {
    const reserved = this._reservedZones || this._buildReservedList();
    for (const r of reserved) {
      const dx = x - r.x;
      const dz = z - r.z;
      if (dx * dx + dz * dz < r.r * r.r) return true;
    }
    return false;
  }

  _buildReservedList() {
    const plots = CONFIG.world.buildPlots;
    const spawn = CONFIG.world.spawnPos;
    const ex = CONFIG.expansion;
    const list = [
      { x: spawn.x,  z: spawn.z,  r: 4 },
      { x: plots.hayBaler.x, z: plots.hayBaler.z, r: 5 },
      { x: plots.sawMill.x,  z: plots.sawMill.z,  r: 5 },
      { x: plots.fence.x,    z: plots.fence.z,    r: 5 },
      { x: plots.market.x,   z: plots.market.z,   r: 6 },
      { x: plots.sauceFactory.x, z: plots.sauceFactory.z, r: 5 },
      { x: plots.chipsFactory.x, z: plots.chipsFactory.z, r: 5 },
      { x: plots.eggFarm.x,  z: plots.eggFarm.z,  r: 5 },
      // Upgrade tile row between spawn and build area
      { x: CONFIG.upgradePlots[0].x, z: CONFIG.upgradePlots[0].z, r: 1.8 },
      { x: CONFIG.upgradePlots[1].x, z: CONFIG.upgradePlots[1].z, r: 1.8 },
      // Expansion tile — player needs clean ground to walk to it
      { x: ex.tilePos.x, z: ex.tilePos.z, r: 2.4 },
    ];
    // Every farm plot: cover the whole rectangle with a circle big enough to
    // span the diagonal + a 1.5u buffer so trees/grass never spawn over crops.
    for (const farm of CONFIG.farms) {
      const r = Math.hypot(
        (farm.cols * farm.spacing) / 2,
        (farm.rows * farm.spacing) / 2,
      ) + 1.5;
      list.push({ x: farm.center.x, z: farm.center.z, r });
    }
    this._reservedZones = list;
    return list;
  }

  // Passive farm-plot harvest: standing in `farm` plot with ready crops picks
  // the nearest one on a timer. Returns the harvestable or null.
  tickFarmHarvest(farm, pos, dt) {
    if (!farm || !farm.unlocked) return null;
    if (!farm.isInside(pos)) return null;
    this._passiveTimer = (this._passiveTimer || 0) + dt;
    if (this._passiveTimer < CONFIG.passiveHarvest.intervalSec) return null;
    this._passiveTimer = 0;
    let best = null; let bestD = Infinity;
    const r2 = CONFIG.passiveHarvest.reach * CONFIG.passiveHarvest.reach;
    for (const h of this.harvestables) {
      if (h.removed || h.kind !== 'cropCell') continue;
      const dx = h.position.x - pos.x;
      const dz = h.position.z - pos.z;
      const d = dx * dx + dz * dz;
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
    // Tint ground under each biome. polygonOffset prevents z-fighting with
    // the base ground plane at y=0.
    const { meadow, forest } = CONFIG.world;
    const mk = (color, opacity) => new THREE.MeshLambertMaterial({
      color, transparent: true, opacity,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      depthWrite: false,
    });

    const meadowGeo = new THREE.PlaneGeometry(meadow.maxX - meadow.minX, meadow.maxZ - meadow.minZ);
    meadowGeo.rotateX(-Math.PI / 2);
    const meadowMesh = new THREE.Mesh(meadowGeo, mk(CONFIG.colors.meadow, 0.85));
    meadowMesh.position.set((meadow.minX + meadow.maxX) / 2, 0.01, (meadow.minZ + meadow.maxZ) / 2);
    this.scene.add(meadowMesh);

    const forestGeo = new THREE.PlaneGeometry(forest.maxX - forest.minX, forest.maxZ - forest.minZ);
    forestGeo.rotateX(-Math.PI / 2);
    const forestMesh = new THREE.Mesh(forestGeo, mk(CONFIG.colors.forestFloor, 0.85));
    forestMesh.position.set((forest.minX + forest.maxX) / 2, 0.01, (forest.minZ + forest.maxZ) / 2);
    this.scene.add(forestMesh);
  }

  _buildGrassCarpet() {
    // Grass is a cluster of 3 tall thin blades merged into one geometry — this
    // gives it a distinctive "tufty" look that reads clearly against the
    // round-foliage trees, even at top-down angles.
    const { meadow, grassCount } = CONFIG.world;
    const geo = this._makeGrassTuftGeometry();
    const mat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.grass });
    const mesh = new THREE.InstancedMesh(geo, mat, grassCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.grassInstanceMesh = mesh;

    const width = meadow.maxX - meadow.minX;
    const depth = meadow.maxZ - meadow.minZ;

    const aspect = width / depth;
    const cellsZ = Math.max(1, Math.round(Math.sqrt(grassCount / aspect)));
    const cellsX = Math.max(1, Math.ceil(grassCount / cellsZ));
    const cellW = width / cellsX;
    const cellD = depth / cellsZ;

    const colorA = new THREE.Color(CONFIG.colors.grass);
    const colorB = new THREE.Color(CONFIG.colors.grassDark);
    const colors = new Float32Array(grassCount * 3);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    let i = 0;
    for (let cz = 0; cz < cellsZ && i < grassCount; cz++) {
      for (let cx = 0; cx < cellsX && i < grassCount; cx++) {
        const jx = (this.rand() - 0.5) * cellW * 0.75;
        const jz = (this.rand() - 0.5) * cellD * 0.75;
        const x = meadow.minX + cellW * (cx + 0.5) + jx;
        const z = meadow.minZ + cellD * (cz + 0.5) + jz;
        // Skip if inside a reserved zone (spawn, buildings, farm, market)
        if (this._isReserved(x, z)) {
          mesh.setMatrixAt(i, zero);
          i++;
          continue;
        }
        const s = 0.8 + this.rand() * 0.5;
        const sy = s * (0.85 + this.rand() * 0.55);
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
          radius: 0.38,
          position: new THREE.Vector3(x, 0, z),
          // Cached matrix used to restore the instance after regrowth.
          originalMatrix: _m.clone(),
        });
        i++;
      }
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Cluster of three tall thin blade prisms with slightly different heights,
  // arranged in a triangle. Merged into one geometry so we can still use
  // InstancedMesh for draw-call efficiency.
  _makeGrassTuftGeometry() {
    const blade = (h, w = 0.12, d = 0.06) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, h / 2, 0);
      return g;
    };
    // 5 blades of different heights and positions for a fluffier tuft
    const b1 = blade(0.95, 0.12, 0.05);
    const b2 = blade(0.78, 0.10, 0.05); b2.translate(0.18, 0, -0.09);
    const b3 = blade(0.66, 0.10, 0.05); b3.translate(-0.16, 0, 0.11);
    const b4 = blade(0.55, 0.08, 0.05); b4.translate(0.09, 0, 0.14);
    const b5 = blade(0.48, 0.08, 0.05); b5.translate(-0.10, 0, -0.12);
    const geos = [b1, b2, b3, b4, b5];
    const totalCount = geos.reduce((sum, g) => sum + g.attributes.position.count, 0);
    const pos = new Float32Array(totalCount * 3);
    const norm = new Float32Array(totalCount * 3);
    let offset = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, offset * 3);
      norm.set(g.attributes.normal.array, offset * 3);
      offset += g.attributes.position.count;
    }
    // Build an index array that concatenates each box's index offset
    const indexArrays = [];
    let vertexBase = 0;
    for (const g of geos) {
      const arr = g.index.array;
      const shifted = new (arr.constructor)(arr.length);
      for (let i = 0; i < arr.length; i++) shifted[i] = arr[i] + vertexBase;
      indexArrays.push(shifted);
      vertexBase += g.attributes.position.count;
    }
    const totalIndex = indexArrays.reduce((s, a) => s + a.length, 0);
    const index = new Uint16Array(totalIndex);
    let io = 0;
    for (const arr of indexArrays) { index.set(arr, io); io += arr.length; }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    for (const g of geos) g.dispose();
    return merged;
  }

  _buildForest() {
    // Clustered trees in the forest biome. Keep individual Groups so we can
    // drop/hide them on harvest; count stays modest (~130) for perf.
    const { forest, treeCount } = CONFIG.world;
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.36, 1.6, 10);
    trunkGeo.translate(0, 0.8, 0);
    // Smoother foliage (detail=1 gives ~42 verts vs 12 at detail=0)
    const leavesGeo = new THREE.IcosahedronGeometry(1.2, 1);
    leavesGeo.translate(0, 2.2, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeTrunk });
    const leavesA = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeLeaves });
    const leavesB = new THREE.MeshLambertMaterial({ color: CONFIG.colors.treeLeavesDark });
    // Top-highlight foliage — lighter color, smaller, higher up for a puffy
    // layered look instead of a single blob.
    const leavesTopMat = new THREE.MeshLambertMaterial({ color: 0x6fdc5a });

    const width = forest.maxX - forest.minX;
    const depth = forest.maxZ - forest.minZ;

    // Trees use three InstancedMeshes (trunk, main leaves, accent leaves) —
    // that turns ~1000 per-tree draw calls into 3, which is a massive perf
    // win on mobile GPUs. Harvest hides an instance by zeroing its matrix.
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const leavesInst = new THREE.InstancedMesh(leavesGeo, leavesA, treeCount);
    const leaves2Inst = new THREE.InstancedMesh(leavesGeo, leavesB, treeCount);
    const leaves3Inst = new THREE.InstancedMesh(leavesGeo, leavesTopMat, treeCount);
    trunkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leavesInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leaves2Inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leaves3Inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(trunkInst, leavesInst, leaves2Inst, leaves3Inst);
    this.treeInstMeshes = [trunkInst, leavesInst, leaves2Inst, leaves3Inst];

    const m4 = new THREE.Matrix4();
    const mRot = new THREE.Matrix4();
    const mScale = new THREE.Matrix4();
    const mPos = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let placed = 0;
    for (let i = 0; i < treeCount; i++) {
      const x = forest.minX + this.rand() * width;
      const z = forest.minZ + this.rand() * depth;
      if (this._isReserved(x, z)) {
        trunkInst.setMatrixAt(i, zero);
        leavesInst.setMatrixAt(i, zero);
        leaves2Inst.setMatrixAt(i, zero);
        leaves3Inst.setMatrixAt(i, zero);
        continue;
      }
      const s = 1.0 + this.rand() * 0.45;
      const rotY = this.rand() * Math.PI * 2;
      // Trunk
      mRot.makeRotationY(rotY);
      mPos.makeTranslation(x, 0, z);
      m4.multiplyMatrices(mPos, mRot);
      trunkInst.setMatrixAt(i, m4);
      const trunkM = m4.clone();
      // Main leaves: scaled + raised
      mScale.makeScale(s, s, s);
      mPos.makeTranslation(x, (s - 1) * 0.4, z);
      m4.multiplyMatrices(mPos, mRot).multiply(mScale);
      leavesInst.setMatrixAt(i, m4);
      const leavesM = m4.clone();
      // Accent puff: smaller, slightly offset
      const ox = (this.rand() - 0.5) * 0.5;
      const oz = (this.rand() - 0.5) * 0.5;
      const s2 = s * 0.75;
      mScale.makeScale(s2, s2, s2);
      mPos.makeTranslation(x + ox, (s - 1) * 0.4 + 0.4, z + oz);
      m4.multiplyMatrices(mPos, mRot).multiply(mScale);
      leaves2Inst.setMatrixAt(i, m4);
      const leaves2M = m4.clone();
      // Top highlight puff: small, higher, bright green for sun lit
      const ox2 = (this.rand() - 0.5) * 0.3;
      const oz2 = (this.rand() - 0.5) * 0.3;
      const s3 = s * 0.55;
      mScale.makeScale(s3, s3, s3);
      mPos.makeTranslation(x + ox2, (s - 1) * 0.4 + 0.9, z + oz2);
      m4.multiplyMatrices(mPos, mRot).multiply(mScale);
      leaves3Inst.setMatrixAt(i, m4);
      const leaves3M = m4.clone();

      this.harvestables.push({
        kind: 'treeInstance',
        instanceId: i,
        type: 'tree',
        hp: 3,
        yield: { key: 'wood', amount: 2 },
        radius: 0.9,
        position: new THREE.Vector3(x, 0, z),
        // Cached per-layer matrices so we can restore the whole tree on regrow.
        originalMatrices: [trunkM, leavesM, leaves2M, leaves3M],
      });
      placed++;
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    leavesInst.instanceMatrix.needsUpdate = true;
    leaves2Inst.instanceMatrix.needsUpdate = true;
    leaves3Inst.instanceMatrix.needsUpdate = true;
    void placed;

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
    // Perimeter posts as a single InstancedMesh — was ~100 draw calls, now 1.
    const size = CONFIG.world.size;
    const half = size / 2 - 0.5;
    const spacing = 2.5;
    const positions = [];
    for (let x = -half; x <= half; x += spacing) {
      for (const z of [-half, half]) positions.push([x, z]);
    }
    for (let z = -half; z <= half; z += spacing) {
      for (const x of [-half, half]) positions.push([x, z]);
    }
    const postGeo = new THREE.BoxGeometry(0.25, 1.2, 0.25);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const mesh = new THREE.InstancedMesh(postGeo, postMat, positions.length);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < positions.length; i++) {
      m4.makeTranslation(positions[i][0], 0.6, positions[i][1]);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  update(_dt, elapsed) {
    this._elapsed = elapsed;
    // Regrow queue now holds grass AND trees with different delays, so a
    // simple FIFO peek doesn't work — scan from the end and restore any
    // ready instance.
    const q = this._regrowQueue;
    if (q && q.length > 0) {
      for (let i = q.length - 1; i >= 0; i--) {
        const h = q[i];
        if (h.respawnAt > elapsed) continue;
        q.splice(i, 1);
        this._respawnHarvestable(h);
      }
    }
  }

  _respawnHarvestable(h) {
    if (h.kind === 'grassInstance' && this.grassInstanceMesh) {
      this.grassInstanceMesh.setMatrixAt(h.instanceId, h.originalMatrix);
      this.grassInstanceMesh.instanceMatrix.needsUpdate = true;
      h.hp = 1;
    } else if (h.kind === 'treeInstance' && this.treeInstMeshes) {
      const mats = h.originalMatrices || [];
      for (let k = 0; k < this.treeInstMeshes.length && k < mats.length; k++) {
        this.treeInstMeshes[k].setMatrixAt(h.instanceId, mats[k]);
        this.treeInstMeshes[k].instanceMatrix.needsUpdate = true;
      }
      h.hp = 3;
    } else if (h.kind === 'expansionGrassInstance' && this.expansionGrassMesh) {
      this.expansionGrassMesh.setMatrixAt(h.instanceId, h.originalMatrix);
      this.expansionGrassMesh.instanceMatrix.needsUpdate = true;
      h.hp = 1;
    } else if (h.kind === 'expansionTreeInstance' && this.expansionTreeMeshes) {
      const mats = h.originalMatrices || [];
      for (let k = 0; k < this.expansionTreeMeshes.length && k < mats.length; k++) {
        this.expansionTreeMeshes[k].setMatrixAt(h.instanceId, mats[k]);
        this.expansionTreeMeshes[k].instanceMatrix.needsUpdate = true;
      }
      h.hp = 3;
    }
    h.removed = false;
    h.respawnAt = null;
  }

  queryInSlashArc(originVec3, forwardVec3, reach, arcDeg) {
    const out = [];
    const cosHalf = Math.cos((arcDeg * 0.5 * Math.PI) / 180);
    for (const h of this.harvestables) {
      if (h.removed || h._locked) continue;
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
    const now = this._elapsed || 0;
    if (h.kind === 'grassInstance') {
      this.grassInstanceMesh.setMatrixAt(h.instanceId, _zero);
      this.grassInstanceMesh.instanceMatrix.needsUpdate = true;
      h.respawnAt = now + CONFIG.world.grassRegrowSec;
      (this._regrowQueue ||= []).push(h);
    } else if (h.kind === 'treeInstance') {
      for (const inst of this.treeInstMeshes) {
        inst.setMatrixAt(h.instanceId, _zero);
        inst.instanceMatrix.needsUpdate = true;
      }
      h.respawnAt = now + (CONFIG.world.treeRegrowSec || 180);
      (this._regrowQueue ||= []).push(h);
    } else if (h.kind === 'expansionGrassInstance') {
      this.expansionGrassMesh.setMatrixAt(h.instanceId, _zero);
      this.expansionGrassMesh.instanceMatrix.needsUpdate = true;
      h.respawnAt = now + CONFIG.world.grassRegrowSec;
      (this._regrowQueue ||= []).push(h);
    } else if (h.kind === 'expansionTreeInstance') {
      for (const inst of this.expansionTreeMeshes) {
        inst.setMatrixAt(h.instanceId, _zero);
        inst.instanceMatrix.needsUpdate = true;
      }
      h.respawnAt = now + (CONFIG.world.treeRegrowSec || 180);
      (this._regrowQueue ||= []).push(h);
    } else if (h.kind === 'cropCell' && h.farm) {
      h.farm.onHarvestableRemoved(h);
    }
  }
}
