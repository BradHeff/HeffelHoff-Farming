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

  // Red-barn hay baler with slat accents, pitched shingle roof with flag,
  // side silo, hay bale pile, smoke stack. All levels get the detailed base —
  // higher levels just scale up.
  _buildHayBalerMesh(g, lvl) {
    const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.12 : 1.25);

    const barnMat = new THREE.MeshLambertMaterial({ color: 0xc94a34 });
    const barnDark = new THREE.MeshLambertMaterial({ color: 0x8e2818 });
    const barn = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 2.0 * s, 2.2 * s), barnMat);
    barn.position.y = 1.0 * s;
    g.add(barn);

    // Horizontal slat accents on barn walls
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(3.02 * s, 0.06, 2.22 * s), barnDark);
      slat.position.y = 0.35 + i * 0.55;
      g.add(slat);
    }

    // Barn-door face with yellow X bracing
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x8a2818 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4 * s, 1.55 * s, 0.08), doorMat);
    door.position.set(0, 0.88 * s, 1.12 * s);
    g.add(door);
    const braceMat = new THREE.MeshLambertMaterial({ color: 0xe0b650 });
    const xA = new THREE.Mesh(new THREE.BoxGeometry(1.6 * s, 0.1, 0.04), braceMat);
    xA.rotation.z = 0.82; xA.position.set(0, 0.88 * s, 1.17 * s);
    const xB = xA.clone(); xB.rotation.z = -0.82;
    g.add(xA, xB);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), braceMat);
    handle.position.set(0.3, 0.85 * s, 1.18 * s);
    g.add(handle);

    // Pitched shingle roof
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a1e12 });
    const roofDark = new THREE.MeshLambertMaterial({ color: 0x2a1410 });
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.4 * s, 0.14, 1.8 * s), roofMat);
    roofL.rotation.z = 0.5; roofL.position.set(-0.75 * s, 2.35 * s, 0);
    const roofR = roofL.clone(); roofR.rotation.z = -0.5; roofR.position.set(0.75 * s, 2.35 * s, 0);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.26 * s, 0.2, 2.42 * s), roofDark);
    ridge.position.set(0, 2.98 * s, 0);
    g.add(roofL, roofR, ridge);

    // Flag pole + flag on the ridge
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6),
      new THREE.MeshLambertMaterial({ color: 0x8a5a3a })
    );
    flagPole.position.set(0, 3.38 * s, 0);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.28),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, side: THREE.DoubleSide })
    );
    flag.position.set(0.24, 3.52 * s, 0);
    flag.rotation.y = Math.PI / 2;
    g.add(flagPole, flag);

    // Hay bale pile against left wall
    const baleMat = new THREE.MeshLambertMaterial({ color: 0xe2c35a });
    const baleGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.5, 12);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(baleGeo, baleMat);
      b.rotation.z = Math.PI / 2;
      b.position.set(-1.88, 0.3 + (i % 2) * 0.5, -0.3 + Math.floor(i / 2) * 0.55);
      g.add(b);
    }

    // Output pad and conveyor out to it
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.08, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
    );
    pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
    g.add(pad);
    this._buildConveyor(g, 1.7, 4.2);

    // Smoke stack always on for a lived-in feel
    this._buildSmokeStack(g, { x: -0.9 * s, y: 2.9 * s, z: 0 }, 0x7a3a2a);

    // Side silo — always shown for silhouette
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.7, 3.0, 18),
      new THREE.MeshLambertMaterial({ color: 0xdadde2 })
    );
    silo.position.set(-2.35, 1.5, -0.3);
    const siloTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xbfc4c8 })
    );
    siloTop.position.set(-2.35, 3.0, -0.3);
    g.add(silo, siloTop);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x8a8a92 });
    const ringGeo = new THREE.TorusGeometry(0.68, 0.035, 6, 18);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(-2.35, 0.5 + i * 0.95, -0.3);
      g.add(ring);
    }
  }

  // Teal-painted wood saw mill with plank siding, shingle roof, big guarded
  // blade, cutting table, stacked logs, output chute.
  _buildSawMillMesh(g, lvl) {
    const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.12 : 1.25);

    // Painted teal body
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x35a4b3 });
    const bodyDark = new THREE.MeshLambertMaterial({ color: 0x207583 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6 * s, 1.9 * s, 2.4 * s), bodyMat);
    body.position.y = 0.95 * s;
    g.add(body);

    // Vertical plank seams on the body
    for (let i = -1; i <= 1; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9 * s, 2.42 * s), bodyDark);
      plank.position.set(i * 0.85 * s, 0.95 * s, 0);
      g.add(plank);
    }

    // Glowing front window
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x6a3a1a });
    const winGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7 * s, 0.45),
      new THREE.MeshBasicMaterial({ color: 0xfff0b3 })
    );
    winGlow.position.set(0, 1.25, 1.22 * s);
    g.add(winGlow);
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.76 * s, 0.51, 0.04), frameMat);
    winFrame.position.set(0, 1.25, 1.22 * s);
    g.add(winFrame);
    const winCross = new THREE.Mesh(new THREE.BoxGeometry(0.76 * s, 0.05, 0.06), frameMat);
    winCross.position.set(0, 1.25, 1.23 * s); g.add(winCross);
    const winCross2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.06), frameMat);
    winCross2.position.set(0, 1.25, 1.23 * s); g.add(winCross2);

    // Pitched shingle roof
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a2418 });
    const roofDark = new THREE.MeshLambertMaterial({ color: 0x2a1810 });
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 0.14, 1.8 * s), roofMat);
    roofL.rotation.z = 0.5; roofL.position.set(-0.65 * s, 2.2 * s, 0);
    const roofR = roofL.clone(); roofR.rotation.z = -0.5; roofR.position.set(0.65 * s, 2.2 * s, 0);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.2, 2.42 * s), roofDark);
    ridge.position.set(0, 2.82 * s, 0);
    g.add(roofL, roofR, ridge);

    // Big saw blade + teeth + red safety guard (half-torus) + cutting table
    const bladeR = 0.78 + (lvl - 1) * 0.1;
    const bladeAssembly = new THREE.Group();
    bladeAssembly.position.set(1.2 * s, 1.3, 1.25 * s);
    g.add(bladeAssembly);
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(bladeR, bladeR, 0.08, 24),
      new THREE.MeshLambertMaterial({ color: 0xd8dde2 })
    );
    blade.rotation.x = Math.PI / 2;
    bladeAssembly.add(blade);
    // Teeth as small boxes around the rim
    const toothMat = new THREE.MeshLambertMaterial({ color: 0x6a6f75 });
    const toothGeo = new THREE.BoxGeometry(0.14, 0.1, 0.09);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const tooth = new THREE.Mesh(toothGeo, toothMat);
      tooth.position.set(Math.cos(a) * (bladeR + 0.03), Math.sin(a) * (bladeR + 0.03), 0);
      tooth.rotation.z = a;
      tooth.rotation.x = Math.PI / 2;
      bladeAssembly.add(tooth);
    }
    // Bolt in center
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8),
      new THREE.MeshLambertMaterial({ color: 0x303238 })
    );
    bolt.rotation.x = Math.PI / 2;
    bladeAssembly.add(bolt);
    this._sawBlade = bladeAssembly;

    // Red safety guard arcs over the top half of the blade
    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(bladeR + 0.08, 0.13, 8, 22, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0xd24028 })
    );
    guard.position.copy(bladeAssembly.position);
    guard.position.z += 0.01;
    g.add(guard);

    // Cutting table under the blade
    const tableMat = new THREE.MeshLambertMaterial({ color: 0xb58048 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.1), tableMat);
    table.position.set(1.2 * s, 0.55, 1.25 * s);
    g.add(table);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x7a5030 });
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6);
    for (const [lx, lz] of [[-0.7, -0.45], [0.7, -0.45], [-0.7, 0.45], [0.7, 0.45]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(1.2 * s + lx, 0.27, 1.25 * s + lz);
      g.add(leg);
    }
    // Half-cut plank on the table, being fed into the blade
    const planksOnTable = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.06, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xc48a4a })
    );
    planksOnTable.position.set(1.2 * s - 0.2, 0.64, 1.25 * s + 0.2);
    g.add(planksOnTable);

    // Stacked logs against the west wall
    const logGeo = new THREE.CylinderGeometry(0.24, 0.24, 2.0, 10);
    const logMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      log.rotation.z = Math.PI / 2;
      log.position.set(-2.15, 0.28 + (i % 3) * 0.5, -0.8 + Math.floor(i / 3) * 0.6);
      g.add(log);
    }

    // Output pad + conveyor (planks coming out)
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.08, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
    );
    pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
    g.add(pad);
    this._buildConveyor(g, 1.5, 4.0);

    // Smoke stack always on
    this._buildSmokeStack(g, { x: -0.7, y: 2.85, z: 0 }, 0x5a5a5a);
  }

  // Dairy Farm — wooden milking station with the front half open so a
  // spotted cow is visibly sticking out, head forward. A state machine in
  // update() makes the cow look around, walk out, turn, walk back in.
  _buildDairyFarmMesh(g, lvl) {
    const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.12 : 1.25);

    // Painted red-and-white barn body with open south face (the stall opening)
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xe85a3a });
    const wallDark = new THREE.MeshLambertMaterial({ color: 0xa43020 });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    // Back wall
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 2.0 * s, 0.15), wallMat);
    back.position.set(0, 1.0 * s, -1.1 * s);
    g.add(back);
    // Side walls
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.0 * s, 2.2 * s), wallMat);
    const sideL = side.clone(); sideL.position.set(-1.5 * s, 1.0 * s, 0);
    const sideR = side.clone(); sideR.position.set( 1.5 * s, 1.0 * s, 0);
    g.add(sideL, sideR);
    // White horizontal trim strip around the stall (barn character)
    for (const [w, h, d, x, y, z] of [
      [3.02 * s, 0.12, 0.18, 0, 0.6, -1.1 * s],
      [0.17, 0.12, 2.24 * s, -1.5 * s, 0.6, 0],
      [0.17, 0.12, 2.24 * s,  1.5 * s, 0.6, 0],
    ]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), whiteMat);
      t.position.set(x, y, z);
      g.add(t);
    }

    // Pitched shingle roof extending over the open front
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a1e14 });
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.4 * s, 0.14, 2.4 * s), roofMat);
    roofL.rotation.z = 0.5; roofL.position.set(-0.75 * s, 2.35 * s, 0);
    const roofR = roofL.clone(); roofR.rotation.z = -0.5; roofR.position.set(0.75 * s, 2.35 * s, 0);
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.28 * s, 0.2, 2.44 * s),
      new THREE.MeshLambertMaterial({ color: 0x2a140e })
    );
    ridge.position.set(0, 2.98 * s, 0);
    g.add(roofL, roofR, ridge);

    // Stall header beam across the opening
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(3.0 * s, 0.24, 0.3),
      wallDark
    );
    header.position.set(0, 1.85 * s, 1.05 * s);
    g.add(header);

    // Milking gear: a steel bucket + tap hanging under the header
    const tankMat = new THREE.MeshLambertMaterial({ color: 0xc6cbd2 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.36, 12), tankMat);
    tank.position.set(-0.9 * s, 1.45, 1.0 * s);
    g.add(tank);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), tankMat);
    spout.rotation.z = Math.PI / 2;
    spout.position.set(-0.6 * s, 1.38, 1.0 * s);
    g.add(spout);

    // Output pad for fresh milk bottles
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.08, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
    );
    pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
    g.add(pad);
    this._buildConveyor(g, 1.5, 4.0);

    // Little wooden yard fence posts flanking the opening
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.55, 8);
    for (const [px, pz] of [[-1.6, 1.2], [-0.5, 1.4], [0.5, 1.4], [1.6, 1.2]]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(px * s, 0.27, pz);
      g.add(p);
    }

    // The cow! Build a Group so the state machine can translate + rotate
    // the whole cow as a unit. Rest pose: head pointing +Z (out of the stall).
    this._cow = this._buildCow();
    // Home position = half out of the stall, facing outward (+Z)
    this._cowHome = new THREE.Vector3(0.4 * s, 0, 0.7 * s);
    this._cow.position.copy(this._cowHome);
    this._cow.rotation.y = 0; // facing +Z
    g.add(this._cow);

    // State machine state (kept here so update() finds it)
    this._cowState = 'peek';
    this._cowT = 0;
    this._cowNextChangeT = 4 + Math.random() * 4;
    this._cowWalkPhase = 0;
  }

  // Chibi spotted cow — body capsule, blocky head, 4 legs, udder, tail.
  _buildCow() {
    const g = new THREE.Group();
    const hide = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const spot = new THREE.MeshLambertMaterial({ color: 0x262626 });
    const snout = new THREE.MeshLambertMaterial({ color: 0xf5b5a8 });
    const hoof = new THREE.MeshLambertMaterial({ color: 0x2a1a18 });

    // Body — elongated capsule
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.44, 0.75, 6, 12),
      hide,
    );
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.75;
    g.add(body);

    // Black Holstein-style spots
    for (const [sx, sy, sz, r] of [
      [0.2, 0.9, 0.15, 0.22],
      [-0.15, 0.85, -0.12, 0.18],
      [0.35, 0.6, -0.15, 0.15],
      [-0.25, 0.65, 0.18, 0.16],
    ]) {
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 8),
        spot,
      );
      sp.position.set(sx, sy, sz);
      sp.scale.set(1.0, 0.4, 1.0);
      g.add(sp);
    }

    // Head (front of body, facing +Z) — box with rounded pink snout
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.42, 0.55),
      hide,
    );
    head.position.set(0, 0.9, 0.78);
    g.add(head);
    const headSnout = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.24, 0.16),
      snout,
    );
    headSnout.position.set(0, 0.82, 1.04);
    g.add(headSnout);
    // Nostrils
    const nostrilMat = new THREE.MeshBasicMaterial({ color: 0x2a1a1a });
    const nostril = new THREE.SphereGeometry(0.03, 6, 6);
    const nL = new THREE.Mesh(nostril, nostrilMat); nL.position.set(-0.08, 0.85, 1.12); g.add(nL);
    const nR = new THREE.Mesh(nostril, nostrilMat); nR.position.set(0.08, 0.85, 1.12); g.add(nR);
    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const eyeGeo = new THREE.SphereGeometry(0.055, 8, 6);
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.14, 1.03, 1.0); g.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.14, 1.03, 1.0); g.add(eR);
    // Horns
    const hornMat = new THREE.MeshLambertMaterial({ color: 0xe8dcb8 });
    const horn = new THREE.ConeGeometry(0.06, 0.22, 6);
    const hL = new THREE.Mesh(horn, hornMat); hL.position.set(-0.18, 1.2, 0.62); hL.rotation.z = -0.4; g.add(hL);
    const hR = new THREE.Mesh(horn, hornMat); hR.position.set( 0.18, 1.2, 0.62); hR.rotation.z =  0.4; g.add(hR);
    // Ears
    const earMat = new THREE.MeshLambertMaterial({ color: 0xf5b5a8 });
    const ear = new THREE.SphereGeometry(0.1, 8, 6);
    const earL = new THREE.Mesh(ear, earMat); earL.position.set(-0.3, 1.12, 0.72); earL.scale.set(1, 0.4, 1.2); g.add(earL);
    const earR = new THREE.Mesh(ear, earMat); earR.position.set( 0.3, 1.12, 0.72); earR.scale.set(1, 0.4, 1.2); g.add(earR);

    // Legs (4) — cylinders ending in dark hooves
    const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8);
    const legMat = hide;
    const legs = [];
    for (const [lx, lz] of [[-0.28, -0.4], [0.28, -0.4], [-0.28, 0.35], [0.28, 0.35]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, 0.28, lz);
      g.add(leg);
      legs.push(leg);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), hoof);
      h.position.set(lx, 0.03, lz);
      g.add(h);
    }

    // Pink udder underneath
    const udder = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xf7a4a0 }),
    );
    udder.position.set(0, 0.5, -0.2);
    udder.scale.set(1, 0.8, 1);
    g.add(udder);

    // Tail — angled dark line
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.02, 0.4, 6),
      hide,
    );
    tail.position.set(0, 0.65, -0.8);
    tail.rotation.x = -0.6;
    g.add(tail);
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), spot);
    tuft.position.set(0, 0.45, -0.95);
    g.add(tuft);

    // Expose the head + legs so we can animate head-turns + walk cycle
    g.userData.head = head;
    g.userData.headSnout = headSnout;
    g.userData.legs = legs;
    g.userData.eyes = [eL, eR];
    g.userData.ears = [earL, earR];
    g.userData.horns = [hL, hR];
    g.userData.nostrils = [nL, nR];
    return g;
  }


  // Chicken coop — proper A-frame red-roof coop with a ramp, nesting-box
  // window, a fenced pen in front, and 3 wandering chicken NPCs with idle
  // animations (bob + wing flap + pecking).
  _buildEggFarmMesh(g, lvl) {
    const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.12 : 1.25);

    // Coop body — pale wood with white trim
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf1d79a });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const coop = new THREE.Mesh(new THREE.BoxGeometry(2.6 * s, 1.5 * s, 2.0 * s), bodyMat);
    coop.position.y = 0.75 * s;
    g.add(coop);
    // White corner trim
    for (const [x, z] of [[-1.3, -1.0], [1.3, -1.0], [-1.3, 1.0], [1.3, 1.0]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5 * s, 0.1), trimMat);
      c.position.set(x * s, 0.75 * s, z * s);
      g.add(c);
    }

    // Pitched red roof
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xd04028 });
    const roofDark = new THREE.MeshLambertMaterial({ color: 0xa0301a });
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.1 * s, 0.14, 2.2 * s), roofMat);
    roofL.rotation.z = 0.55; roofL.position.set(-0.68 * s, 1.9 * s, 0);
    const roofR = roofL.clone(); roofR.rotation.z = -0.55; roofR.position.set(0.68 * s, 1.9 * s, 0);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.24 * s, 0.2, 2.22 * s), roofDark);
    ridge.position.set(0, 2.45 * s, 0);
    g.add(roofL, roofR, ridge);

    // Round arched doorway on the front (dark hole) + wooden ramp
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x3a2010 });
    const door = new THREE.Mesh(
      new THREE.CircleGeometry(0.35 * s, 20, 0, Math.PI),
      doorMat,
    );
    door.position.set(0, 0.4 * s, 1.01 * s);
    g.add(door);
    const rampMat = new THREE.MeshLambertMaterial({ color: 0x7a4a28 });
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.06, 1.0), rampMat);
    ramp.position.set(0, 0.15, 1.5 * s);
    ramp.rotation.x = -0.25;
    g.add(ramp);
    // Ramp cross-slats for grip
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(
        new THREE.BoxGeometry(0.52 * s, 0.02, 0.05),
        doorMat,
      );
      slat.position.set(0, 0.18 + i * 0.02, 1.2 * s + i * 0.2);
      g.add(slat);
    }

    // Nesting-box window (yellow glow) on the side
    const winMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), winMat);
    win.position.set(-1.32 * s, 1.0, 0);
    win.rotation.y = -Math.PI / 2;
    g.add(win);
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.48, 0.58), doorMat);
    winFrame.position.set(-1.33 * s, 1.0, 0);
    g.add(winFrame);

    // Weather vane on roof peak
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), poleMat);
    pole.position.set(0, 2.75 * s, 0);
    g.add(pole);
    const vaneChicken = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.14, 0.04),
      poleMat,
    );
    vaneChicken.position.set(0, 2.97 * s, 0);
    g.add(vaneChicken);

    // Fenced pen out front — 6 posts + 2 horizontal rails
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const penPosts = [[-1.8, 1.5], [-0.9, 2.0], [0.0, 2.1], [0.9, 2.0], [1.8, 1.5]];
    for (const [px, pz] of penPosts) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8), postMat);
      p.position.set(px, 0.35, pz);
      g.add(p);
    }
    // Connecting rails
    for (let i = 0; i < penPosts.length - 1; i++) {
      const [x1, z1] = penPosts[i];
      const [x2, z2] = penPosts[i + 1];
      const dx = x2 - x1; const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      for (const y of [0.24, 0.48]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), postMat);
        r.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
        r.rotation.y = -Math.atan2(dz, dx);
        g.add(r);
      }
    }

    // Output pad + conveyor
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.08, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
    );
    pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
    g.add(pad);
    this._buildConveyor(g, 1.5, 4.0);

    // 3 wandering chicken NPCs inside the pen — each with its own bob/phase
    this._chickens = [];
    const chickenSpots = [[-0.5, 1.5], [0.5, 1.7], [1.2, 1.3]];
    for (let i = 0; i < chickenSpots.length; i++) {
      const [cx, cz] = chickenSpots[i];
      const c = this._buildChicken(i === 0 ? 0xffffff : (i === 1 ? 0xffe0a0 : 0xf4a0a0));
      c.position.set(cx, 0, cz);
      c.userData.phase = Math.random() * Math.PI * 2;
      c.userData.anchor = new THREE.Vector3(cx, 0, cz);
      g.add(c);
      this._chickens.push(c);
    }

    // Extra big egg prop on the roof at L2+
    if (lvl >= 2) {
      const bigEggGeo = new THREE.SphereGeometry(0.3, 12, 10);
      bigEggGeo.scale(1, 1.25, 1);
      const bigEgg = new THREE.Mesh(bigEggGeo, new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }));
      bigEgg.position.set(-0.8, 2.3 * s, 0);
      g.add(bigEgg);
    }
  }

  _buildChicken(bodyColor = 0xffffff) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshLambertMaterial({ color: bodyColor })
    );
    body.scale.set(1.0, 0.9, 1.2);
    body.position.y = 0.22;
    g.add(body);
    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshLambertMaterial({ color: bodyColor })
    );
    head.position.set(0, 0.42, 0.18);
    g.add(head);
    // Red comb
    const comb = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.08, 0.18),
      new THREE.MeshLambertMaterial({ color: 0xd4302a })
    );
    comb.position.set(0, 0.52, 0.18);
    g.add(comb);
    // Yellow beak
    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.1, 6),
      new THREE.MeshLambertMaterial({ color: 0xffc040 })
    );
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.41, 0.3);
    g.add(beak);
    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat);
    eL.position.set(-0.06, 0.45, 0.24); g.add(eL);
    const eR = eL.clone(); eR.position.set(0.06, 0.45, 0.24); g.add(eR);
    // Wings (for flap)
    const wingMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const wingGeo = new THREE.SphereGeometry(0.14, 10, 8);
    const wL = new THREE.Mesh(wingGeo, wingMat);
    wL.scale.set(0.4, 0.6, 0.8);
    wL.position.set(-0.2, 0.24, 0.0);
    g.add(wL);
    const wR = wL.clone();
    wR.position.set(0.2, 0.24, 0.0);
    g.add(wR);
    // Orange legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0xf0a040 });
    const leg = new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6);
    const lL = new THREE.Mesh(leg, legMat); lL.position.set(-0.07, 0.06, 0); g.add(lL);
    const lR = new THREE.Mesh(leg, legMat); lR.position.set(0.07, 0.06, 0); g.add(lR);

    g.userData.body = body;
    g.userData.head = head;
    g.userData.wings = [wL, wR];
    return g;
  }

  // Builds an animated conveyor belt between xStart and xEnd (local). Rollers
  // spin continuously; belt scrolls via a UV-independent color-stripe trick
  // (child stripe meshes that slide along the belt).
  _buildConveyor(parent, xStart, xEnd) {
    const length = Math.abs(xEnd - xStart);
    const midX = (xStart + xEnd) / 2;
    const beltMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
    const rollerMat = new THREE.MeshLambertMaterial({ color: 0x7a7a7a });
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x7a5a42 });

    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.08, 0.7),
      beltMat
    );
    belt.position.set(midX, 0.35, 0);
    parent.add(belt);

    // Scrolling stripe segments on top of the belt — gives the illusion of
    // motion. They loop along the belt length in _tickProducer.
    const stripeGroup = new THREE.Group();
    stripeGroup.position.set(xStart, 0.39, 0);
    const stripeGeo = new THREE.BoxGeometry(0.12, 0.02, 0.62);
    const stripes = [];
    const stripeCount = Math.max(3, Math.floor(length / 0.4));
    for (let i = 0; i < stripeCount; i++) {
      const s = new THREE.Mesh(stripeGeo, stripeMat);
      s.position.x = (i / stripeCount) * length;
      stripeGroup.add(s);
      stripes.push(s);
    }
    parent.add(stripeGroup);
    this._conveyorStripes = this._conveyorStripes || [];
    this._conveyorStripes.push({ stripes, length, baseX: xStart });

    for (const z of [-0.38, 0.38]) {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(length + 0.1, 0.15, 0.06),
        frameMat
      );
      frame.position.set(midX, 0.35, z);
      parent.add(frame);
    }
    for (const x of [xStart, xEnd]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.35, 0.5),
        frameMat
      );
      leg.position.set(x, 0.175, 0);
      parent.add(leg);
    }
    // Rollers spin on each frame
    this._conveyorRollers = this._conveyorRollers || [];
    for (const x of [xStart, xEnd]) {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.7, 12),
        rollerMat
      );
      roller.rotation.x = Math.PI / 2;
      roller.position.set(x, 0.35, 0);
      parent.add(roller);
      this._conveyorRollers.push(roller);
    }
  }

  // Build a chimney that periodically puffs out smoke spheres. `pos` is local
  // to the finished building group.
  _buildSmokeStack(parent, pos, color = 0x7a3a2a) {
    const chim = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 1.4, 0.4),
      new THREE.MeshLambertMaterial({ color })
    );
    chim.position.set(pos.x, pos.y, pos.z);
    parent.add(chim);

    const puffsParent = new THREE.Group();
    puffsParent.position.set(pos.x, pos.y + 0.9, pos.z);
    parent.add(puffsParent);
    this._smokePuffs = this._smokePuffs || [];
    const puffGeo = new THREE.SphereGeometry(0.22, 10, 8);
    for (let i = 0; i < 4; i++) {
      // Clone material per puff so opacity tweens are independent
      const mat = new THREE.MeshLambertMaterial({
        color: 0xe6e6ea, transparent: true, opacity: 0.8,
      });
      const puff = new THREE.Mesh(puffGeo, mat);
      puff.visible = false;
      puffsParent.add(puff);
      this._smokePuffs.push({ mesh: puff, t: 0, ttl: 2.2, delay: i * 0.55 });
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
      // SELL tile sits NORTH of the customer queue (player side) so the
      // player isn't standing inside the customer line when depositing.
      this.dropoffPos = new THREE.Vector3(this.position.x, 0, this.position.z - 3.8);
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
      this._buildHayBalerMesh(g, lvl);
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
      // Big striped awning, tilted forward so it's the stall's defining
      // silhouette from game-camera angle. White + deep-green ticking stripes
      // match the reference painted-awning look.
      const awningGroup = new THREE.Group();
      const stripeCount = 6;
      const stripeW = 4.0;
      const stripeD = 0.44;
      for (let i = 0; i < stripeCount; i++) {
        const color = i % 2 === 0 ? 0xffffff : 0x2aa55a;
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(stripeW, 0.08, stripeD),
          new THREE.MeshLambertMaterial({ color })
        );
        stripe.position.set(
          0,
          i * 0.05,                         // subtle stepped shingle feel
          -stripeD * (stripeCount - 1) / 2 + i * stripeD,
        );
        awningGroup.add(stripe);
      }
      awningGroup.position.set(0, 2.45, -0.15);
      awningGroup.rotation.x = -0.22; // forward tilt — eaves drop toward player
      g.add(awningGroup);

      // Scalloped fringe at the front edge of the awning for character
      const fringeMat = new THREE.MeshLambertMaterial({ color: 0x2aa55a });
      const fringeGeo = new THREE.ConeGeometry(0.16, 0.22, 3);
      fringeGeo.rotateX(Math.PI);
      for (let i = 0; i < 9; i++) {
        const c = new THREE.Mesh(fringeGeo, fringeMat);
        c.position.set(-1.9 + i * 0.475, 2.15, 1.0);
        c.rotation.y = Math.PI / 6;
        g.add(c);
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
      this._buildSawMillMesh(g, lvl);
    } else if (this.key === 'sauceFactory') {
      const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.12 : 1.25);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.6 * s, 2.0 * s, 2.4 * s),
        new THREE.MeshLambertMaterial({ color: 0xd6584a })
      );
      body.position.y = 1.0 * s;
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x7a2420 });
      const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 0.12, 1.7 * s), roofMat);
      roofL.rotation.z = 0.45; roofL.position.set(-0.6 * s, 2.3 * s, 0);
      const roofR = roofL.clone(); roofR.rotation.z = -0.45; roofR.position.set(0.6 * s, 2.3 * s, 0);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.08, 1.6),
        new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
      );
      pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
      g.add(body, roofL, roofR, pad);
      this._buildConveyor(g, 1.5, 4.0);
      if (lvl >= 2) {
        this._buildSmokeStack(g, { x: -0.8, y: 3.0, z: 0 }, 0x5a5a5a);
      }
      if (lvl >= 3) {
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.3, 0.8, 12),
          new THREE.MeshLambertMaterial({ color: 0xd02e2a })
        );
        bottle.position.set(0.5, 3.2, 0);
        g.add(bottle);
      }
    } else if (this.key === 'chipsFactory') {
      const s = lvl === 1 ? 1.0 : (lvl === 2 ? 1.12 : 1.25);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.6 * s, 2.0 * s, 2.4 * s),
        new THREE.MeshLambertMaterial({ color: 0xe6b548 })
      );
      body.position.y = 1.0 * s;
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x7a5a20 });
      const roofL = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 0.12, 1.7 * s), roofMat);
      roofL.rotation.z = 0.45; roofL.position.set(-0.6 * s, 2.3 * s, 0);
      const roofR = roofL.clone(); roofR.rotation.z = -0.45; roofR.position.set(0.6 * s, 2.3 * s, 0);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.08, 1.6),
        new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
      );
      pad.position.set(2.7 + (lvl - 1) * 0.3, 0.04, 0);
      g.add(body, roofL, roofR, pad);
      this._buildConveyor(g, 1.5, 4.0);
      if (lvl >= 2) {
        this._buildSmokeStack(g, { x: -0.8, y: 3.0, z: 0 }, 0x5a5a5a);
      }
      if (lvl >= 3) {
        // Big chip bag on the roof
        const bag = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.9, 0.4),
          new THREE.MeshLambertMaterial({ color: 0xf0c860 })
        );
        bag.position.set(0.5, 3.2, 0);
        g.add(bag);
      }
    } else if (this.key === 'eggFarm') {
      this._buildEggFarmMesh(g, lvl);
    } else if (this.key === 'dairyFarm') {
      this._buildDairyFarmMesh(g, lvl);
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
      highlightColor: '#2e9bff',
      rounded: true,
      cornerRadius: 0.32,
    });
    sellDecal.setPosition(this.position.x, this.position.z - 3.8);
    sellDecal.addTo(this.scene);
    this.sellDecal = sellDecal;

    this.coinPile = new CoinPile(
      this.scene,
      { x: this.position.x - 3.2, z: this.position.z + 0.8 },
      { cols: 8, rows: 6, perStack: 2, pickupRadius: 2.2 }
    );

    // Persistent table stock: pools of meshes for each sellable resource
    // that show how much is currently on display. Players drop items here
    // and customers buy them off the table.
    this._stockMats = {
      bale:   new THREE.MeshLambertMaterial({ color: 0xe2c35a }),
      planks: new THREE.MeshLambertMaterial({ color: 0xb77842 }),
      tomato: new THREE.MeshLambertMaterial({ color: 0xe04a3c }),
      potato: new THREE.MeshLambertMaterial({ color: 0xc49a5a }),
      sauce:  new THREE.MeshLambertMaterial({ color: 0xd02e2a }),
      chips:  new THREE.MeshLambertMaterial({ color: 0xe6b548 }),
      egg:    new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }),
      milk:   new THREE.MeshLambertMaterial({ color: 0xffffff }),
    };
    this._stockGeos = {
      bale:   new THREE.CylinderGeometry(0.22, 0.22, 0.36, 12),
      planks: new THREE.BoxGeometry(0.55, 0.08, 0.22),
      tomato: new THREE.SphereGeometry(0.2, 10, 8),
      potato: new THREE.SphereGeometry(0.18, 8, 6),
      sauce:  new THREE.CylinderGeometry(0.11, 0.13, 0.3, 10),
      chips:  new THREE.BoxGeometry(0.28, 0.22, 0.2),
      egg:    new THREE.SphereGeometry(0.16, 10, 8),
      milk:   new THREE.CylinderGeometry(0.13, 0.1, 0.34, 10),
    };
    this._stockGeos.bale.rotateZ(Math.PI / 2);
    this._stockGeos.egg.scale(1, 1.25, 1);

    // Column positions across the table front (matches the counter mesh)
    const tableY = 1.05;
    const tableZ = this.position.z - 1.7;
    this._stockColumns = {
      bale:   { x: this.position.x - 1.65, y: tableY, z: tableZ, maxStack: 4 },
      planks: { x: this.position.x - 1.15, y: tableY, z: tableZ, maxStack: 4 },
      tomato: { x: this.position.x - 0.65, y: tableY, z: tableZ, maxStack: 4 },
      potato: { x: this.position.x - 0.15, y: tableY, z: tableZ, maxStack: 4 },
      sauce:  { x: this.position.x + 0.35, y: tableY, z: tableZ, maxStack: 4 },
      chips:  { x: this.position.x + 0.85, y: tableY, z: tableZ, maxStack: 4 },
      egg:    { x: this.position.x + 1.35, y: tableY, z: tableZ, maxStack: 4 },
      milk:   { x: this.position.x + 1.85, y: tableY, z: tableZ, maxStack: 4 },
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
    this._stockMeshes = { bale: [], planks: [], tomato: [], potato: [], sauce: [], chips: [], egg: [], milk: [] };
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

    if (this.key === 'hayBaler' || this.key === 'sawMill' ||
        this.key === 'sauceFactory' || this.key === 'chipsFactory' ||
        this.key === 'eggFarm' || this.key === 'dairyFarm') {
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
      // Sales are now driven by individual customers in CustomerQueue —
      // each one consumes its requested resource and pays coins directly.
      // Market just keeps the visible stock display in sync with Inventory.
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
      } else if (pc.produces === 'sauce') {
        PRODUCE_PROTOS.sauce = {
          geo: new THREE.CylinderGeometry(0.18, 0.22, 0.5, 12),
          mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }),
          rotZ: 0,
        };
      } else if (pc.produces === 'chips') {
        PRODUCE_PROTOS.chips = {
          geo: new THREE.BoxGeometry(0.4, 0.3, 0.28),
          mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }),
          rotZ: 0,
        };
      } else if (pc.produces === 'egg') {
        const g = new THREE.SphereGeometry(0.2, 12, 10);
        g.scale(1, 1.25, 1);
        PRODUCE_PROTOS.egg = {
          geo: g,
          mat: new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }),
          rotZ: 0,
        };
      } else if (pc.produces === 'milk') {
        PRODUCE_PROTOS.milk = {
          geo: new THREE.CylinderGeometry(0.2, 0.28, 0.5, 12),
          mat: new THREE.MeshLambertMaterial({ color: 0xffffff }),
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

  // Briefly scale the finished building up and settle back — makes level-ups
  // and completions feel landed instead of silent state mutations.
  triggerScalePunch() {
    this._punchT = 0;
    this._punchActive = true;
  }

  update(dt, elapsed) {
    if (this.decal && this.decal.mesh.visible) this.decal.update(dt);
    if (this.sellDecal) this.sellDecal.update(dt);
    if (this.dropDecal) this.dropDecal.update(dt);
    if (this._punchActive && this.finishedGroup) {
      this._punchT += dt;
      const dur = 0.35;
      const k = Math.min(1, this._punchT / dur);
      // Smooth out-in bump: 0 → peak (at k=0.5) → back to 1
      const bump = Math.sin(k * Math.PI) * 0.22;
      const s = 1 + bump;
      this.finishedGroup.scale.set(s, s, s);
      if (k >= 1) {
        this._punchActive = false;
        this.finishedGroup.scale.set(1, 1, 1);
      }
    }
    if (this.arrowGroup && this.arrowGroup.visible) {
      this._arrowBob += dt * 3.5;
      this.arrowGroup.position.y = 3.4 + Math.sin(this._arrowBob) * 0.25;
      this.arrowGroup.rotation.y += dt * 0.6;
    }
    if (this._sawBlade) this._sawBlade.rotation.z += 4 * dt;
    // Animate conveyor rollers + scrolling stripes
    if (this._conveyorRollers) {
      for (const r of this._conveyorRollers) r.rotation.y += 6 * dt;
    }
    if (this._conveyorStripes) {
      for (const cs of this._conveyorStripes) {
        for (const s of cs.stripes) {
          s.position.x = (s.position.x + dt * 0.6) % cs.length;
        }
      }
    }
    // Smoke puffs — each has its own delay and TTL; float up + grow + fade.
    if (this._smokePuffs) {
      for (const p of this._smokePuffs) {
        p.t += dt;
        const local = (p.t - p.delay) % (p.ttl + p.delay * (this._smokePuffs.length - 1));
        if (local < 0) { p.mesh.visible = false; continue; }
        const life = local / p.ttl;
        if (life >= 1) { p.mesh.visible = false; continue; }
        p.mesh.visible = true;
        p.mesh.position.set(
          Math.sin(local * 2) * 0.15,
          life * 1.2,
          Math.cos(local * 1.7) * 0.12
        );
        const s = 0.5 + life * 0.9;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = 0.8 * (1 - life);
      }
    }
    if (this._cow) this._tickCow(dt);
    if (this._chickens) this._tickChickens(dt, elapsed);
    if (this.completed) this._tickProducer(dt, elapsed);
  }

  // Chicken idle animation: gentle bob, random head pecks, occasional wing
  // flaps, small lateral wandering within 0.4u of their anchor spot.
  _tickChickens(dt, elapsed) {
    for (const c of this._chickens) {
      c.userData.phase += dt;
      const ph = c.userData.phase + (elapsed || 0);
      // Body bob
      if (c.userData.body) {
        c.userData.body.position.y = 0.22 + Math.abs(Math.sin(ph * 3)) * 0.04;
      }
      // Head peck: occasional dip forward
      if (c.userData.head) {
        const peck = Math.max(0, Math.sin(ph * 1.5));
        c.userData.head.rotation.x = peck * peck * 0.8;
      }
      // Wing flap every ~3-5 seconds
      if (c.userData.wings) {
        const flap = Math.max(0, Math.sin(ph * 0.8 - 2));
        c.userData.wings[0].rotation.z =  0.4 * flap * flap;
        c.userData.wings[1].rotation.z = -0.4 * flap * flap;
      }
      // Lazy wander
      const anchor = c.userData.anchor;
      c.position.x = anchor.x + Math.sin(ph * 0.4) * 0.25;
      c.position.z = anchor.z + Math.cos(ph * 0.3) * 0.2;
      c.rotation.y = Math.sin(ph * 0.4) * 0.6;
    }
  }

  // Cow state machine:
  //  peek       — half out of stall, facing +Z, head occasionally turning
  //  walkOut    — walks forward a couple units
  //  turnAround — rotates 180° in place
  //  walkIn     — walks back into stall
  //  (loops → peek with facing +Z again)
  _tickCow(dt) {
    const cow = this._cow;
    this._cowT += dt;
    this._cowWalkPhase += dt * 5;

    const legs = cow.userData.legs;
    const head = cow.userData.head;
    const snout = cow.userData.headSnout;
    const moving = this._cowState === 'walkOut' || this._cowState === 'walkIn';

    // Leg animation
    if (legs) {
      const amp = moving ? 0.55 : 0.0;
      legs[0].rotation.x =  Math.sin(this._cowWalkPhase) * amp;
      legs[1].rotation.x = -Math.sin(this._cowWalkPhase) * amp;
      legs[2].rotation.x = -Math.sin(this._cowWalkPhase) * amp;
      legs[3].rotation.x =  Math.sin(this._cowWalkPhase) * amp;
    }

    // Head idle-turn — only when peeking/idle
    if (head && this._cowState === 'peek') {
      const hy = Math.sin(this._cowT * 0.8) * 0.5;
      head.rotation.y = hy;
      if (snout) snout.rotation.y = hy;
    } else if (head) {
      head.rotation.y *= 0.9;
      if (snout) snout.rotation.y *= 0.9;
    }

    const speed = 0.7; // cow shuffle

    if (this._cowState === 'peek') {
      if (this._cowT >= this._cowNextChangeT) {
        this._cowState = 'walkOut';
        this._cowT = 0;
        // Walk out ~1.6 units in +Z
        this._cowWalkTarget = this._cowHome.z + 1.8;
      }
    } else if (this._cowState === 'walkOut') {
      cow.position.z += speed * dt;
      if (cow.position.z >= this._cowWalkTarget) {
        cow.position.z = this._cowWalkTarget;
        this._cowState = 'turnAround';
        this._cowT = 0;
      }
    } else if (this._cowState === 'turnAround') {
      const dur = 1.2;
      const t = Math.min(this._cowT / dur, 1);
      cow.rotation.y = t * Math.PI; // 0 → PI (now facing -Z)
      if (t >= 1) {
        cow.rotation.y = Math.PI;
        this._cowState = 'walkIn';
        this._cowT = 0;
      }
    } else if (this._cowState === 'walkIn') {
      cow.position.z -= speed * dt;
      if (cow.position.z <= this._cowHome.z) {
        cow.position.z = this._cowHome.z;
        this._cowState = 'turnOut';
        this._cowT = 0;
      }
    } else if (this._cowState === 'turnOut') {
      const dur = 1.0;
      const t = Math.min(this._cowT / dur, 1);
      cow.rotation.y = Math.PI + t * Math.PI; // PI → 2PI
      if (t >= 1) {
        cow.rotation.y = 0;
        this._cowState = 'peek';
        this._cowT = 0;
        this._cowNextChangeT = 6 + Math.random() * 6; // 6-12s until next walk-out
      }
    }
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
      hayBaler:     new BuildSite(scene, 'hayBaler',     CONFIG.world.buildPlots.hayBaler,     this.pickupables),
      market:       new BuildSite(scene, 'market',       CONFIG.world.buildPlots.market,       this.pickupables),
      sawMill:      new BuildSite(scene, 'sawMill',      CONFIG.world.buildPlots.sawMill,      this.pickupables),
      dairyFarm:    new BuildSite(scene, 'dairyFarm',    CONFIG.world.buildPlots.dairyFarm,    this.pickupables),
      sauceFactory: new BuildSite(scene, 'sauceFactory', CONFIG.world.buildPlots.sauceFactory, this.pickupables),
      chipsFactory: new BuildSite(scene, 'chipsFactory', CONFIG.world.buildPlots.chipsFactory, this.pickupables),
      eggFarm:      new BuildSite(scene, 'eggFarm',      CONFIG.world.buildPlots.eggFarm,      this.pickupables),
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
    if (this.hasEnemies) return ['dairyFarm', 'sawMill', 'hayBaler', 'sauceFactory', 'chipsFactory', 'eggFarm', 'market'];
    return ['hayBaler', 'sawMill', 'dairyFarm', 'sauceFactory', 'chipsFactory', 'eggFarm', 'market'];
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
