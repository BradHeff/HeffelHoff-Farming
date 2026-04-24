import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ZoneDecal } from './zone.js';
import { populateDecorations } from './decorations.js';
import { buildPaths } from './paths.js';

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
    // Wide warm-sand courtyards UNDER the build row + market + customer
    // queue — gives the Klondike "buildings sit on dirt, not on grass" look.
    this._buildCourtyards();
    // Dirt paths go on after biome overlays so they render above them.
    buildPaths(this.scene);
    this._buildGrassCarpet();
    this._buildFlowerDecals();   // scattered white 4-petal flowers on grass
    this._buildForest();
    this._buildExpansionBiome(); // initially locked — slash ignores these
    this._buildExpansionGate();  // physical wall + sign across expansion line
    this._buildPerimeter();
    this._buildDistantHills();   // dimmed landscape around the map edge
    populateDecorations(this.scene, this.rand);
  }

  // Two big rounded sand-coloured rectangles painted on the ground: one
  // wraps the build row + market, one wraps the customer queue road.
  // Buildings render on top, giving the Klondike "courtyard" look.
  _buildCourtyards() {
    const cdtex = (w, h, fill, edge) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = Math.round(256 * h / w);
      const ctx = c.getContext('2d');
      const cw = c.width, ch = c.height;
      ctx.clearRect(0, 0, cw, ch);
      const r = Math.min(cw, ch) * 0.18;
      const path = (x, y, rw, rh, rr) => {
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + rw - rr, y);
        ctx.quadraticCurveTo(x + rw, y, x + rw, y + rr);
        ctx.lineTo(x + rw, y + rh - rr);
        ctx.quadraticCurveTo(x + rw, y + rh, x + rw - rr, y + rh);
        ctx.lineTo(x + rr, y + rh);
        ctx.quadraticCurveTo(x, y + rh, x, y + rh - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
      };
      ctx.fillStyle = '#' + fill.toString(16).padStart(6, '0');
      path(2, 2, cw - 4, ch - 4, r);
      ctx.fill();
      ctx.strokeStyle = '#' + edge.toString(16).padStart(6, '0');
      ctx.lineWidth = Math.max(3, Math.round(cw * 0.012));
      ctx.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };

    const placeApron = (cx, cz, w, d) => {
      const tex = cdtex(w, d, CONFIG.colors.courtyard, CONFIG.colors.courtyardEdge);
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx, 0.02, cz);
      m.renderOrder = 1;
      this.scene.add(m);
    };

    // Build-row apron — covers the whole row of factories + spawn area
    placeApron(0, 4, 44, 14);
    // Market + customer queue apron — on the road south of spawn
    placeApron(0, 16, 30, 8);
  }

  // Tiny white 4-petal flower sprites scattered on the meadow — the
  // Klondike grass texture has these everywhere and they're what makes the
  // green plane feel alive instead of monotone.
  _buildFlowerDecals() {
    const { meadow } = CONFIG.world;
    const count = 220;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = '#ffffff';
    // four-petal cross
    const petal = (cx, cy, w, h) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    petal(16, 9,  3.2, 5.5);
    petal(16, 23, 3.2, 5.5);
    petal(9,  16, 5.5, 3.2);
    petal(23, 16, 5.5, 3.2);
    ctx.fillStyle = '#ffe66a';
    ctx.beginPath(); ctx.arc(16, 16, 2.3, 0, Math.PI * 2); ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(0.55, 0.55);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.renderOrder = 3;
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const x = meadow.minX + this.rand() * (meadow.maxX - meadow.minX);
      const z = meadow.minZ + this.rand() * (meadow.maxZ - meadow.minZ);
      if (this._isReserved(x, z)) continue;
      const s = 0.7 + this.rand() * 0.7;
      _m.makeScale(s, 1, s);
      _m.setPosition(x, 0.04, z);
      mesh.setMatrixAt(placed++, _m);
    }
    // Zero-out unused slots
    for (let i = placed; i < count; i++) mesh.setMatrixAt(i, _zero);
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  // Build a visible wooden fence line across the expansion boundary. While
  // expansion is locked, the player can't step past this line. `setLocked`
  // toggles both the mesh visibility and the collision state.
  _buildExpansionGate() {
    const ex = CONFIG.expansion;
    if (!ex) return;
    const gateZ = ex.meadowStrip.maxZ; // southern edge of the locked strip
    this.expansionGateZ = gateZ;
    this.expansionGateOpen = false;

    const b = CONFIG.world.bounds;
    const group = new THREE.Group();
    this.scene.add(group);
    this.expansionGateGroup = group;

    // Continuous post + 2-rail fence along x from b.minX to b.maxX, with a
    // small gap in the middle (center on x=0) so the visual has "gates".
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const railMat = new THREE.MeshLambertMaterial({ color: 0xa66633 });
    const spacing = 1.8;
    const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.4, 8);
    const railGeo = new THREE.BoxGeometry(spacing, 0.1, 0.1);
    for (let x = b.minX + 0.5; x <= b.maxX - 0.5; x += spacing) {
      // Skip a 2-post-wide opening at center so the path visually "gates"
      if (Math.abs(x) < 1.5) continue;
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, 0.7, gateZ);
      group.add(p);
      if (x + spacing > b.maxX - 0.5 || Math.abs(x + spacing) < 1.5) continue;
      for (const y of [0.5, 1.05]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(x + spacing / 2, y, gateZ);
        group.add(rail);
      }
    }

    // Center warning sign on the gap — dashed stop look
    const signPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8),
      postMat,
    );
    signPost.position.set(0, 0.9, gateZ);
    group.add(signPost);
    const signBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.6, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xffcc66 }),
    );
    signBoard.position.set(0, 1.6, gateZ);
    group.add(signBoard);
    this.expansionGateSign = signBoard;
  }

  openExpansionGate() {
    this.expansionGateOpen = true;
    if (this.expansionGateGroup) {
      this.scene.remove(this.expansionGateGroup);
      this.expansionGateGroup = null;
    }
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
    this.openExpansionGate();
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
      { x: plots.dairyFarm.x, z: plots.dairyFarm.z, r: 5 },
      { x: plots.market.x,   z: plots.market.z,   r: 6 },
      { x: plots.sauceFactory.x, z: plots.sauceFactory.z, r: 5 },
      { x: plots.chipsFactory.x, z: plots.chipsFactory.z, r: 5 },
      { x: plots.eggFarm.x,  z: plots.eggFarm.z,  r: 5 },
      // Upgrade tile row between spawn and build area
      { x: CONFIG.upgradePlots[0].x, z: CONFIG.upgradePlots[0].z, r: 1.8 },
      { x: CONFIG.upgradePlots[1].x, z: CONFIG.upgradePlots[1].z, r: 1.8 },
      // Expansion tile — player needs clean ground to walk to it
      { x: ex.tilePos.x, z: ex.tilePos.z, r: 2.4 },
      // Tractor + harvester unlock pads — keep grass/trees from blocking the
      // preview silhouettes that should be visible from spawn.
      { x: CONFIG.tractor.unlockPos.x,   z: CONFIG.tractor.unlockPos.z,   r: 4.5 },
      { x: CONFIG.harvester.unlockPos.x, z: CONFIG.harvester.unlockPos.z, r: 4.5 },
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
    const b = CONFIG.world.bounds || {
      minX: -CONFIG.world.size / 2, maxX: CONFIG.world.size / 2,
      minZ: -CONFIG.world.size / 2, maxZ: CONFIG.world.size / 2,
    };
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.ground });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
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

  // Ring of soft conical hills outside the playable rectangle so the map
  // reads like it continues into unexplored distance instead of ending in a
  // void. Using instance-free meshes (low count: ~28) so the draw-call hit
  // is minimal.
  _buildDistantHills() {
    const b = CONFIG.world.bounds || {
      minX: -CONFIG.world.size / 2, maxX: CONFIG.world.size / 2,
      minZ: -CONFIG.world.size / 2, maxZ: CONFIG.world.size / 2,
    };
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const rx = (b.maxX - b.minX) / 2 + 6;
    const rz = (b.maxZ - b.minZ) / 2 + 6;

    const hillGeo = new THREE.ConeGeometry(3.2, 5.0, 7);
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x4a8a4a });
    const hillMat2 = new THREE.MeshLambertMaterial({ color: 0x3a6f3a });

    const spots = 28;
    for (let i = 0; i < spots; i++) {
      const a = (i / spots) * Math.PI * 2;
      // Put the hill on an ellipse slightly outside the bounds rectangle
      const rr = 1.0 + this.rand() * 0.35;
      const x = cx + Math.cos(a) * rx * rr;
      const z = cz + Math.sin(a) * rz * rr;
      const s = 0.8 + this.rand() * 1.1;
      const hill = new THREE.Mesh(hillGeo, i % 2 === 0 ? hillMat : hillMat2);
      hill.position.set(x, s * 2.5 - 1.5, z);
      hill.scale.set(s, s * (0.8 + this.rand() * 0.5), s);
      hill.rotation.y = this.rand() * Math.PI * 2;
      this.scene.add(hill);
    }
    // Smaller hillocks dotted further out for a depth-layered look
    const smallGeo = new THREE.ConeGeometry(2.0, 3.0, 7);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + 0.15;
      const rr = 1.35 + this.rand() * 0.4;
      const x = cx + Math.cos(a) * rx * rr;
      const z = cz + Math.sin(a) * rz * rr;
      const s = 0.6 + this.rand() * 0.8;
      const h = new THREE.Mesh(smallGeo, hillMat2);
      h.position.set(x, s * 1.5 - 1.0, z);
      h.scale.set(s, s * 0.8, s);
      this.scene.add(h);
    }
  }

  _buildPerimeter() {
    // Perimeter posts as a single InstancedMesh — was ~100 draw calls, now 1.
    const b = CONFIG.world.bounds || {
      minX: -CONFIG.world.size / 2, maxX: CONFIG.world.size / 2,
      minZ: -CONFIG.world.size / 2, maxZ: CONFIG.world.size / 2,
    };
    const spacing = 2.5;
    const positions = [];
    for (let x = b.minX; x <= b.maxX; x += spacing) {
      positions.push([x, b.minZ]);
      positions.push([x, b.maxZ]);
    }
    for (let z = b.minZ + spacing; z < b.maxZ; z += spacing) {
      positions.push([b.minX, z]);
      positions.push([b.maxX, z]);
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
