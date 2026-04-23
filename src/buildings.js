import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory, PlayerCarry } from './state.js';
import { ZoneDecal } from './zone.js';
import { CoinPile } from './coins.js';

// Module-level shared geometry/material cache for produced items. Filled on
// first spawn, reused for every subsequent spawn — prevents runaway GPU
// buffer allocation (was a primary cause of multi-minute play freezes).
const PRODUCE_PROTOS = {};

// A BuildSite is a painted plot that evolves through phases:
//   under-construction → completed building
// After completion, certain keys become producers (Hay Baler, Saw Mill,
// Market) that operate indefinitely without hard caps.
export class BuildSite {
  constructor(scene, recipeKey, plotPos, pickupables) {
    this.scene = scene;
    this.recipe = CONFIG.builds[recipeKey];
    this.key = recipeKey;
    this.position = new THREE.Vector3(plotPos.x, 0, plotPos.z);
    this.radius = 2.4;
    this.completed = false;
    this._locked = false;
    this.dropoffPos = this.position.clone();
    this.progress = {};
    for (const k of Object.keys(this.recipe.require)) this.progress[k] = 0;

    this.pickupables = pickupables;
    this.producerCfg = CONFIG.producers[recipeKey]
      ? JSON.parse(JSON.stringify(CONFIG.producers[recipeKey])) // deep copy so upgrades don't mutate config
      : null;
    this.produceTimer = 0;
    this.producedItems = [];
    this.level = 1;
    this.inputs = CONFIG.buildingInputs[recipeKey] || null;

    // Pre-built buildings (e.g., Market) skip the BUILD/crate phase entirely.
    if (this.recipe.prebuilt) {
      this.completed = true;
      this._spawnFinishedBuilding();
      if (this.key === 'market') this._attachMarketExtras();
      this._attachDropZone();
    } else {
      this._buildCrate();
      this._buildArrow();
      this._buildDecal();
      this._buildProgressStack();
      this.setVisible(false);
    }
  }

  // Rounded build crate + plinth. No longer blocky — uses cylinders/spheres.
  _buildCrate() {
    const group = new THREE.Group();
    group.position.copy(this.position);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.4, 0.18, 20),
      new THREE.MeshLambertMaterial({ color: CONFIG.colors.buildSiteDirt })
    );
    plinth.position.y = 0.09;
    group.add(plinth);

    const crateMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    const crateRim = new THREE.MeshLambertMaterial({ color: 0x5a3a1f });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 0.9), crateMat);
    crate.position.y = 0.6;
    group.add(crate);

    // Rounded corner posts
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.96, 10);
    for (const [x, z] of [[-0.58, -0.48], [0.58, -0.48], [-0.58, 0.48], [0.58, 0.48]]) {
      const p = new THREE.Mesh(postGeo, crateRim);
      p.position.set(x, 0.6, z);
      group.add(p);
    }
    // Top + bottom rails
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.08, 0.98), crateRim);
    rail.position.y = 1.06; group.add(rail);
    const railB = rail.clone(); railB.position.y = 0.17; group.add(railB);

    // Gold handle
    const handleMat = new THREE.MeshLambertMaterial({ color: 0xe2b847 });
    const handleBase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.3), handleMat);
    handleBase.position.y = 1.13; group.add(handleBase);
    const handleArch = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.04, 8, 14, Math.PI), handleMat
    );
    handleArch.rotation.x = Math.PI / 2;
    handleArch.position.y = 1.22; group.add(handleArch);

    this.crateGroup = group;
    this.scene.add(group);
  }

  _buildArrow() {
    const g = new THREE.Group();
    g.position.set(this.position.x, 3.4, this.position.z);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    const outMat = new THREE.MeshBasicMaterial({ color: 0xb58600 });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.25), bodyMat);
    shaft.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.9, 4), bodyMat);
    head.rotation.y = Math.PI / 4;
    head.rotation.x = Math.PI;
    head.position.y = -0.3;
    g.add(shaft, head);
    const shaftOut = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.92, 0.28), outMat);
    shaftOut.position.y = 0.5;
    const headOut = new THREE.Mesh(new THREE.ConeGeometry(0.82, 1.04, 4), outMat);
    headOut.rotation.y = Math.PI / 4;
    headOut.rotation.x = Math.PI;
    headOut.position.y = -0.3;
    shaftOut.renderOrder = 0; headOut.renderOrder = 0;
    shaft.renderOrder = 1; head.renderOrder = 1;
    g.add(shaftOut, headOut);
    this.arrowGroup = g;
    this._arrowBob = Math.random() * Math.PI * 2;
    this.scene.add(g);
  }

  _buildDecal() {
    this.decal = new ZoneDecal({
      width: 3.4, depth: 2.6,
      label: 'BUILD', icon: '',
      color: '#ffdf66', textColor: 'rgba(255,236,160,0.95)',
      textSize: 112,
    });
    this.decal.setPosition(this.position.x, this.position.z);
    this.decal.addTo(this.scene);
  }

  _buildProgressStack() {
    this.stackGroup = new THREE.Group();
    this.stackGroup.position.set(this.position.x, 1.15, this.position.z);
    this.scene.add(this.stackGroup);
    this.stackGeo = new THREE.BoxGeometry(0.28, 0.2, 0.28);
    this.stackMats = {
      grass: new THREE.MeshLambertMaterial({ color: 0x5bbf3d }),
      wood:  new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
      bale:  new THREE.MeshLambertMaterial({ color: 0xe2c35a }),
      planks: new THREE.MeshLambertMaterial({ color: 0xb77842 }),
    };
    this.stackMeshes = [];
  }

  _refreshStack() {
    const seq = [];
    for (const key of Object.keys(this.progress)) {
      for (let i = 0; i < this.progress[key]; i++) seq.push(key);
    }
    while (this.stackMeshes.length < seq.length) {
      const m = new THREE.Mesh(this.stackGeo, this.stackMats.wood);
      m.visible = false;
      this.stackGroup.add(m);
      this.stackMeshes.push(m);
    }
    for (let i = 0; i < this.stackMeshes.length; i++) {
      const mesh = this.stackMeshes[i];
      if (i >= seq.length) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.material = this.stackMats[seq[i]] || this.stackMats.wood;
      const layer = Math.floor(i / 9);
      const cell = i % 9;
      const cx = (cell % 3) - 1;
      const cz = Math.floor(cell / 3) - 1;
      mesh.position.set(cx * 0.3, layer * 0.22, cz * 0.3);
      mesh.rotation.y = ((i * 37) % 9) * 0.03;
    }
  }

  setVisible(v) {
    this.visible = v;
    const showSite = v && !this.completed;
    if (this.crateGroup) this.crateGroup.visible = showSite;
    if (this.arrowGroup) this.arrowGroup.visible = showSite;
    if (this.decal) this.decal.mesh.visible = showSite;
    if (this.stackGroup) this.stackGroup.visible = showSite;
  }

  setLocked(v) {
    this._locked = v;
    if (v) this.setVisible(false);
  }

  // Called by BuildingLevelTile when the player accumulates the tier cost.
  applyLevel(tier) {
    this.level = tier.level;
    if (this.producerCfg) {
      if (tier.intervalMul) this.producerCfg.intervalSec *= tier.intervalMul;
      if (tier.stackMul && this.producerCfg.maxStack) {
        this.producerCfg.maxStack = Math.round(this.producerCfg.maxStack * tier.stackMul);
      }
    }
    // Replace the finished mesh with the new-level variant
    this._rebuildFinishedMesh();
  }

  // Builds a small conveyor belt between x=xStart and x=xEnd (local) to sit
  // between the factory and the brown stacking pad.
  _buildConveyor(parent, xStart, xEnd) {
    const length = Math.abs(xEnd - xStart);
    const midX = (xStart + xEnd) / 2;
    const beltMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const rollerMat = new THREE.MeshLambertMaterial({ color: 0x5a5a5a });
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x7a5a42 });
    // Belt surface
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.08, 0.7),
      beltMat
    );
    belt.position.set(midX, 0.35, 0);
    parent.add(belt);
    // Side frames
    for (const z of [-0.38, 0.38]) {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(length + 0.1, 0.15, 0.06),
        frameMat
      );
      frame.position.set(midX, 0.35, z);
      parent.add(frame);
    }
    // Legs
    for (const x of [xStart, xEnd]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.35, 0.5),
        frameMat
      );
      leg.position.set(x, 0.175, 0);
      parent.add(leg);
    }
    // Rollers at each end
    for (const x of [xStart, xEnd]) {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.7, 12),
        rollerMat
      );
      roller.rotation.x = Math.PI / 2;
      roller.position.set(x, 0.35, 0);
      parent.add(roller);
    }
  }

  _rebuildFinishedMesh() {
    if (this.finishedGroup) {
      this.scene.remove(this.finishedGroup);
      this.finishedGroup.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose?.();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
          else c.material.dispose?.();
        }
      });
      this.finishedGroup = null;
    }
    this._spawnFinishedBuilding();
  }

  // Returns true if this building accepts `key` for direct drop-off.
  // Buildings under construction accept whatever their recipe requires.
  acceptsKey(key) {
    if (!this.completed) return key in (this.recipe.require || {});
    if (!this.inputs) return false;
    return this.inputs.includes(key);
  }

  need(key) { return Math.max(0, (this.recipe.require[key] || 0) - (this.progress[key] || 0)); }
  isFulfilled() { return Object.keys(this.recipe.require).every((k) => this.need(k) === 0); }

  deposit(resources) {
    const leftover = { ...resources };
    for (const key of Object.keys(this.recipe.require)) {
      const needed = this.need(key);
      if (needed <= 0) continue;
      const have = leftover[key] || 0;
      const take = Math.min(have, needed);
      if (take > 0) {
        this.progress[key] += take;
        leftover[key] -= take;
      }
    }
    this._refreshStack();
    return leftover;
  }

  complete() {
    if (this.completed) return;
    this.completed = true;
    this.setVisible(false);
    if (this.crateGroup) this.scene.remove(this.crateGroup);
    if (this.arrowGroup) this.scene.remove(this.arrowGroup);
    if (this.decal) this.decal.removeFrom(this.scene);
    if (this.stackGroup) this.scene.remove(this.stackGroup);
    this._spawnFinishedBuilding();
    for (const [k, v] of Object.entries(this.recipe.reward)) Inventory.add(k, v);
    if (this.producerCfg) this.produceTimer = this.producerCfg.intervalSec * 0.5;
    if (this.key === 'market') this._attachMarketExtras();
    this._attachDropZone();
  }

  _attachDropZone() {
    if (this.key === 'market') {
      this.dropoffPos = new THREE.Vector3(this.position.x, 0, this.position.z - 2.8);
      return;
    }
    const offsetZ = 2.5; // DROP tile appears in front (south) of building
    this.dropDecal = new ZoneDecal({
      width: 2.6, depth: 2.0,
      label: 'DROP', icon: '',
      color: '#a0ffb0', textColor: 'rgba(240,255,220,0.95)',
      textSize: 130,
    });
    this.dropDecal.setPosition(this.position.x, this.position.z + offsetZ);
    this.dropDecal.addTo(this.scene);
    this.dropoffPos = new THREE.Vector3(this.position.x, 0, this.position.z + offsetZ);
  }

  _spawnFinishedBuilding() {
    const g = new THREE.Group();
    g.position.copy(this.position);
    const lvl = this.level;

    if (this.key === 'hayBaler') {
      // Scale grows with level. L1 = small barn, L2 adds a chimney + wider
      // base, L3 adds a silo on the side for a proper farm-industry feel.
      const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.15 : 1.3);
      const baseColor = 0xbe6a2f;
      const barn = new THREE.Mesh(
        new THREE.BoxGeometry(3.0 * s, 2.0 * s, 2.2 * s),
        new THREE.MeshLambertMaterial({ color: baseColor })
      );
      barn.position.y = 1.0 * s;
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x6a2a1a });
      const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.3 * s, 0.12, 1.5 * s), roofMat);
      roofL.rotation.z = 0.5;
      roofL.position.set(-0.7 * s, 2.35 * s, 0);
      const roofR = roofL.clone(); roofR.rotation.z = -0.5; roofR.position.set(0.7 * s, 2.35 * s, 0);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.25 * s, 0.18, 2.4 * s), roofMat);
      ridge.position.set(0, 2.9 * s, 0);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.08, 1.6),
        new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
      );
      pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
      g.add(barn, roofL, roofR, ridge);
      // Conveyor belt exiting the side of the barn
      this._buildConveyor(g, 1.7, 4.2);
      g.add(pad);
      if (lvl >= 2) {
        // Brick chimney
        const chim = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 1.2, 0.5),
          new THREE.MeshLambertMaterial({ color: 0x7a3a2a })
        );
        chim.position.set(-0.9, 2.9 * s + 0.6, 0);
        g.add(chim);
        // Puff at top
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 10, 8),
          new THREE.MeshLambertMaterial({ color: 0xe0e0e8 })
        );
        puff.position.set(-0.9, 2.9 * s + 1.4, 0);
        g.add(puff);
      }
      if (lvl >= 3) {
        // Silo on the side
        const silo = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, 3.2, 16),
          new THREE.MeshLambertMaterial({ color: 0xdadde0 })
        );
        silo.position.set(-2.4, 1.6, 0);
        const siloCap = new THREE.Mesh(
          new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshLambertMaterial({ color: 0xbfc4c8 })
        );
        siloCap.position.set(-2.4, 3.2, 0);
        g.add(silo, siloCap);
      }
    } else if (this.key === 'market') {
      // Market stall with striped awning + FRONT counter table
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.0, 1.2),
        new THREE.MeshLambertMaterial({ color: 0xf0d4a0 })
      );
      counter.position.set(0, 0.5, -0.7);
      g.add(counter);
      const postMat = new THREE.MeshLambertMaterial({ color: 0x7a4a2a });
      for (const x of [-1.5, 1.5]) {
        for (const z of [-1.2, 0.2]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 10), postMat);
          p.position.set(x, 1.1, z);
          g.add(p);
        }
      }
      for (let i = 0; i < 6; i++) {
        const color = i % 2 === 0 ? 0xffffff : 0x2e8b57;
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(3.3, 0.04, 0.26),
          new THREE.MeshLambertMaterial({ color })
        );
        stripe.position.set(0, 2.3, -1.35 + i * 0.26);
        g.add(stripe);
      }
      // Counter TABLE at the player-facing front (south of stall)
      const tableTop = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 0.12, 1.0),
        new THREE.MeshLambertMaterial({ color: 0xc08a55 })
      );
      tableTop.position.set(0, 0.95, -1.7);
      const tableEdge = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 0.06, 1.04),
        new THREE.MeshLambertMaterial({ color: 0x6a3f1a })
      );
      tableEdge.position.set(0, 1.02, -1.7);
      g.add(tableTop, tableEdge);
      // Remember slot positions in world space for offload targets
      const slots = [];
      for (let i = 0; i < 6; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const localX = -1.0 + col * 1.0;
        const localZ = -2.0 + row * 0.6;
        slots.push(new THREE.Vector3(this.position.x + localX, 1.05, this.position.z + localZ));
      }
      this.tableSlots = slots;
    } else if (this.key === 'sawMill') {
      const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.15 : 1.3);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.6 * s, 2.0 * s, 2.4 * s),
        new THREE.MeshLambertMaterial({ color: 0x967149 })
      );
      body.position.y = 1.0 * s;
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a2f1a });
      const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 0.12, 1.7 * s), roofMat);
      roofL.rotation.z = 0.45;
      roofL.position.set(-0.6 * s, 2.3 * s, 0);
      const roofR = roofL.clone(); roofR.rotation.z = -0.45; roofR.position.set(0.6 * s, 2.3 * s, 0);
      const blade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6 + (lvl - 1) * 0.12, 0.6 + (lvl - 1) * 0.12, 0.08, 20),
        new THREE.MeshLambertMaterial({ color: 0xbac1c7 })
      );
      blade.rotation.x = Math.PI / 2;
      blade.position.set(0, 1.2, 1.25 * s);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.08, 1.6),
        new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
      );
      pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
      g.add(body, roofL, roofR, blade);
      this._buildConveyor(g, 1.5, 4.0);
      g.add(pad);
      this._sawBlade = blade;
      if (lvl >= 2) {
        // Steam pipe on the roof
        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.18, 1.2, 10),
          new THREE.MeshLambertMaterial({ color: 0x5a5a5a })
        );
        pipe.position.set(-0.7, 3.0, 0);
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 10, 8),
          new THREE.MeshLambertMaterial({ color: 0xe0e0e8 })
        );
        puff.position.set(-0.7, 3.7, 0);
        g.add(pipe, puff);
      }
      if (lvl >= 3) {
        // Log pile stacked beside the mill
        const logGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.0, 10);
        const logMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
        for (let i = 0; i < 5; i++) {
          const log = new THREE.Mesh(logGeo, logMat);
          log.rotation.z = Math.PI / 2;
          log.position.set(-2.4, 0.3 + (i % 3) * 0.4, -1.0 + Math.floor(i / 3) * 0.5);
          g.add(log);
        }
      }
    } else if (this.key === 'fence') {
      const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.4, 10), postMat);
        p.position.set(Math.cos(ang) * 1.6, 0.7, Math.sin(ang) * 1.6);
        g.add(p);
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8), postMat);
      pole.position.y = 1.4;
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.5),
        new THREE.MeshLambertMaterial({ color: 0xc43a3a, side: THREE.DoubleSide })
      );
      flag.position.set(0.5, 2.5, 0);
      g.add(pole, flag);
    }
    this.scene.add(g);
    this.finishedGroup = g;
  }

  // Market extras: SELL decal + coin pile + persistent table stock mesh pool.
  _attachMarketExtras() {
    const sellDecal = new ZoneDecal({
      width: 3.2, depth: 2.0,
      label: 'SELL', icon: '',
      color: '#8fd1ff', textColor: 'rgba(255,255,255,0.95)',
      textSize: 120,
    });
    sellDecal.setPosition(this.position.x, this.position.z - 2.8);
    sellDecal.addTo(this.scene);
    this.sellDecal = sellDecal;

    this.coinPile = new CoinPile(
      this.scene,
      { x: this.position.x - 4.0, z: this.position.z + 0.5 },
      { stacksCount: 10, perStack: 12, pickupRadius: 2.0 }
    );

    // Persistent table stock: pools of meshes for each sellable resource
    // that show how much is currently on display. Players drop items here
    // and customers buy them off the table.
    this._stockMats = {
      bale:   new THREE.MeshLambertMaterial({ color: 0xe2c35a }),
      planks: new THREE.MeshLambertMaterial({ color: 0xb77842 }),
      tomato: new THREE.MeshLambertMaterial({ color: 0xe04a3c }),
      potato: new THREE.MeshLambertMaterial({ color: 0xc49a5a }),
    };
    this._stockGeos = {
      bale:   new THREE.CylinderGeometry(0.22, 0.22, 0.36, 12),
      planks: new THREE.BoxGeometry(0.55, 0.08, 0.22),
      tomato: new THREE.SphereGeometry(0.2, 10, 8),
      potato: new THREE.SphereGeometry(0.18, 8, 6),
    };
    this._stockGeos.bale.rotateZ(Math.PI / 2);

    // Column positions across the table front (matches the counter mesh)
    const tableY = 1.05;
    const tableZ = this.position.z - 1.7;
    this._stockColumns = {
      bale:   { x: this.position.x - 1.1, y: tableY, z: tableZ, maxStack: 4 },
      planks: { x: this.position.x - 0.3, y: tableY, z: tableZ, maxStack: 4 },
      tomato: { x: this.position.x + 0.5, y: tableY, z: tableZ, maxStack: 4 },
      potato: { x: this.position.x + 1.2, y: tableY, z: tableZ, maxStack: 4 },
    };
    // Wooden crate wrapper per column so stacks look like crated goods
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    const crateRim = new THREE.MeshLambertMaterial({ color: 0x5a3a1f });
    for (const key of Object.keys(this._stockColumns)) {
      const c = this._stockColumns[key];
      // Crate body with open top — 4 thin walls
      const crateGroup = new THREE.Group();
      crateGroup.position.set(c.x, c.y - 0.02, c.z);
      const wallHeight = 0.32;
      for (const [wx, wz, sx, sz] of [
        [0, -0.26, 0.5, 0.05], [0, 0.26, 0.5, 0.05],
        [-0.26, 0, 0.05, 0.5], [0.26, 0, 0.05, 0.5],
      ]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(sx, wallHeight, sz), crateMat);
        w.position.set(wx, wallHeight / 2, wz);
        crateGroup.add(w);
      }
      // Rim trim
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.58), crateRim);
      rim.position.y = wallHeight;
      crateGroup.add(rim);
      this.scene.add(crateGroup);
    }
    this._stockMeshes = { bale: [], planks: [], tomato: [], potato: [] };
    this._refreshTableStock();
  }

  _refreshTableStock() {
    if (!this._stockColumns) return;
    for (const key of Object.keys(this._stockColumns)) {
      const count = Inventory[key] || 0;
      const col = this._stockColumns[key];
      const visible = Math.min(count, col.maxStack);
      const pool = this._stockMeshes[key];
      // Grow pool as needed
      while (pool.length < visible) {
        const m = new THREE.Mesh(this._stockGeos[key], this._stockMats[key]);
        this.scene.add(m);
        pool.push(m);
      }
      // Position + show/hide
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        if (i < visible) {
          m.visible = true;
          m.position.set(col.x, col.y + i * 0.18, col.z + (i % 2) * 0.04);
          m.rotation.y = ((i * 41) % 9) * 0.07;
        } else {
          m.visible = false;
        }
      }
    }
  }

  // Called by CustomerQueue to request a sale on the market's next tick.
  requestSale() { this._saleRequested = true; }

  // Returns world position of the top-most mesh of a given stock column
  // (for customer-receive flight animations). Returns null if empty.
  getTopStockSlot(key) {
    const col = this._stockColumns?.[key];
    if (!col) return null;
    const count = Math.min(Inventory[key] || 0, col.maxStack);
    if (count <= 0) return null;
    return new THREE.Vector3(col.x, col.y + (count - 1) * 0.18, col.z);
  }

  // Producers tick:
  //   - Hay Baler and Saw Mill pull their consumeFrom resource from Inventory
  //     and spawn produced meshes onto their side pad for player pickup.
  //   - Market consumes bale/planks from Inventory and mints coins into the pile.
  _tickProducer(dt, elapsed) {
    const pc = this.producerCfg;
    if (!pc) return;

    if (this.key === 'hayBaler' || this.key === 'sawMill') {
      this.producedItems = this.producedItems.filter((it) => !it.collected);
      if (this.producedItems.length < pc.maxStack) {
        this.produceTimer += dt;
        if (this.produceTimer >= pc.intervalSec) {
          const have = Inventory[pc.consumeFrom] || 0;
          if (have >= pc.consumePerCycle) {
            Inventory[pc.consumeFrom] -= pc.consumePerCycle;
            Inventory.emit();
            this.produceTimer = 0;
            this._spawnProduced();
          }
        }
      }
      for (const it of this.producedItems) {
        if (it.mesh.scale.x < 1) {
          it.mesh.scale.setScalar(Math.min(1, it.mesh.scale.x + dt * 4));
        }
        it.mesh.position.y = it.baseY + Math.sin(elapsed * 2 + it.spawnTime * 0.001) * 0.03;
      }
    } else if (this.key === 'market') {
      this.produceTimer += dt;
      // Market only sells when there is an idle customer at the front of
      // the queue AND stock exists. The CustomerQueue drives this: it sets
      // `_saleRequested` when a customer is waiting to buy.
      if (this.produceTimer >= pc.intervalSec && this._saleRequested) {
        let sold = null;
        for (const k of pc.sellPriority) {
          if ((Inventory[k] || 0) > 0) {
            Inventory[k] -= 1;
            Inventory.emit();
            const coins = pc.sellRewards[k] || 0;
            this.coinPile.addPending(coins);
            sold = k;
            break;
          }
        }
        if (sold) {
          this.produceTimer = 0;
          this._soldThisTick = sold;
          this._saleRequested = false;
        }
      }
      this._refreshTableStock();
    }
  }

  _spawnProduced() {
    const pc = this.producerCfg;
    const idx = this.producedItems.length;
    const col = idx % 5;
    const row = Math.floor(idx / 5);
    const x = this.position.x + 2.0 + col * 0.55;
    const z = this.position.z - 0.8 + row * 0.6;

    // Shared geometry + material per produces key, cached on first spawn
    // so we don't leak GPU buffers across hundreds of production cycles.
    if (!PRODUCE_PROTOS[pc.produces]) {
      if (pc.produces === 'bale') {
        PRODUCE_PROTOS.bale = {
          geo: new THREE.CylinderGeometry(0.32, 0.32, 0.6, 14),
          mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }),
          rotZ: Math.PI / 2,
        };
      } else if (pc.produces === 'planks') {
        PRODUCE_PROTOS.planks = {
          geo: new THREE.BoxGeometry(0.7, 0.14, 0.3),
          mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }),
          rotZ: 0,
        };
      }
    }
    const proto = PRODUCE_PROTOS[pc.produces];
    const mesh = new THREE.Mesh(proto.geo, proto.mat);
    mesh.rotation.z = proto.rotZ;
    mesh.position.set(x, 0.3, z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    const item = {
      kind: 'producedItem',
      resourceKey: pc.produces,
      mesh,
      position: mesh.position,
      baseY: 0.3,
      collected: false,
      spawnTime: performance.now(),
      producer: this,
    };
    this.producedItems.push(item);
    this.pickupables.push(item);
  }

  update(dt, elapsed) {
    if (this.decal && this.decal.mesh.visible) this.decal.update(dt);
    if (this.sellDecal) this.sellDecal.update(dt);
    if (this.dropDecal) this.dropDecal.update(dt);
    if (this.arrowGroup && this.arrowGroup.visible) {
      this._arrowBob += dt * 3.5;
      this.arrowGroup.position.y = 3.4 + Math.sin(this._arrowBob) * 0.25;
      this.arrowGroup.rotation.y += dt * 0.6;
    }
    if (this._sawBlade) this._sawBlade.rotation.z += 4 * dt;
    if (this.completed) this._tickProducer(dt, elapsed);
  }

  // Return world-space position of the next free table slot at the market.
  // Used by offload animations.
  getNextTableSlot() {
    if (!this.tableSlots || this.tableSlots.length === 0) return null;
    const idx = (Inventory.bale + Inventory.planks) % this.tableSlots.length;
    return this.tableSlots[idx];
  }

  // Return a random table slot for customer buy animations (bale leaves table).
  getAnyTableSlot() {
    if (!this.tableSlots || this.tableSlots.length === 0) return null;
    return this.tableSlots[Math.floor(Math.random() * this.tableSlots.length)];
  }
}

export class BuildManager {
  constructor(scene) {
    this.scene = scene;
    this.pickupables = [];
    this.sites = {
      hayBaler: new BuildSite(scene, 'hayBaler', CONFIG.world.buildPlots.hayBaler, this.pickupables),
      market:   new BuildSite(scene, 'market',   CONFIG.world.buildPlots.market,   this.pickupables),
      sawMill:  new BuildSite(scene, 'sawMill',  CONFIG.world.buildPlots.sawMill,  this.pickupables),
      fence:    new BuildSite(scene, 'fence',    CONFIG.world.buildPlots.fence,    this.pickupables),
    };
    this.hasEnemies = false;
    this._subs = new Set();
    this.active = null;
    this._updateActive();
  }

  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  emit() { this._subs.forEach((fn) => fn(this)); }

  setHasEnemies(v) {
    if (this.hasEnemies !== v) { this.hasEnemies = v; this._updateActive(); }
  }

  _priorityOrder() {
    if (this.hasEnemies) return ['fence', 'sawMill', 'hayBaler', 'market'];
    return ['hayBaler', 'sawMill', 'market', 'fence'];
  }

  _updateActive() {
    const order = this._priorityOrder();
    let next = null;
    for (const k of order) {
      const s = this.sites[k];
      if (s._locked) continue;
      if (!s.completed) { next = s; break; }
    }
    for (const k of Object.keys(this.sites)) {
      const s = this.sites[k];
      s.setVisible(s === next && !s._locked);
    }
    this.active = next;
    this.emit();
  }

  // Drain only the resources this site accepts. If the site is the active
  // build, advance its construction progress from Inventory afterwards.
  depositAt(site, backpack, carry) {
    const emptied = {};
    const drain = (pack) => {
      for (const k of Object.keys(pack.items)) {
        const v = pack.items[k] || 0;
        if (v <= 0) continue;
        if (!site.acceptsKey(k)) continue;
        emptied[k] = (emptied[k] || 0) + v;
        Inventory.add(k, v);
        pack.items[k] = 0;
      }
      pack.emit();
    };
    drain(backpack);
    drain(carry);

    const deposited = {};
    if (site && site === this.active && !site.completed) {
      for (const key of Object.keys(site.recipe.require)) {
        const need = site.need(key);
        if (need <= 0) continue;
        const have = Inventory[key] || 0;
        const take = Math.min(need, have);
        if (take > 0) {
          site.progress[key] += take;
          Inventory[key] = have - take;
          deposited[key] = take;
        }
      }
      site._refreshStack();
      Inventory.emit();
      if (site.isFulfilled()) { site.complete(); this._updateActive(); }
      else this.emit();
    }
    return { deposited, emptied };
  }

  consumePickupable(item) {
    item.collected = true;
    if (item.mesh && item.mesh.parent) item.mesh.parent.remove(item.mesh);
    const i = this.pickupables.indexOf(item);
    if (i !== -1) this.pickupables.splice(i, 1);
  }

  update(dt, elapsed) {
    for (const k of Object.keys(this.sites)) this.sites[k].update(dt, elapsed);
  }
}
