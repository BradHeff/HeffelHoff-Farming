import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Backpack, PlayerCarry, PlayerStats } from './state.js';
import { getFaceMaterial } from './faces.js';

// Player character — smoother rounded geometry (capsules + spheres) instead
// of blocky boxes. Owns:
//   - movement + facing
//   - walk/slash animation
//   - back stack (raw harvest — unbounded tower)
//   - front carry (crafted items — unbounded tower in arms)
//   - chevron GPS arrow above head
export class Player {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.position = this.group.position;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.velocity = new THREE.Vector3();
    this.isMoving = false;
    this.walkPhase = 0;
    this.slashT = 0;
    this.slashCooldown = 0;

    this._buildModel();
    this._buildScythe();
    this._buildSlashArc();
    this._buildGroundRing();
    this._buildBackStack();
    this._buildFrontCarry();
    this._buildGpsArrow();

    this.group.position.set(CONFIG.world.spawnPos.x, 0, CONFIG.world.spawnPos.z);
    scene.add(this.group);
  }

  // Rounded character using Capsule + Sphere primitives.
  _buildModel() {
    const { colors } = CONFIG;
    const body = new THREE.Group();

    const skinMat = new THREE.MeshLambertMaterial({ color: colors.player });
    const shirtMat = new THREE.MeshLambertMaterial({ color: colors.playerShirt });
    const pantsMat = new THREE.MeshLambertMaterial({ color: colors.playerPants });
    const bootMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });

    // Legs — capsules
    const legGeo = new THREE.CapsuleGeometry(0.14, 0.45, 4, 8);
    this.legL = new THREE.Mesh(legGeo, pantsMat);
    this.legL.position.set(-0.17, 0.4, 0);
    this.legR = new THREE.Mesh(legGeo, pantsMat);
    this.legR.position.set(0.17, 0.4, 0);
    body.add(this.legL, this.legR);

    // Boots
    const bootGeo = new THREE.SphereGeometry(0.17, 10, 8);
    bootGeo.scale(1, 0.55, 1.2);
    const bootL = new THREE.Mesh(bootGeo, bootMat);
    bootL.position.set(-0.17, 0.1, 0.03);
    const bootR = new THREE.Mesh(bootGeo, bootMat);
    bootR.position.set(0.17, 0.1, 0.03);
    this.legL.add(bootL); // moves with leg
    this.legR.add(bootR);

    // Torso — rounded capsule
    const torsoGeo = new THREE.CapsuleGeometry(0.3, 0.35, 4, 10);
    this.torso = new THREE.Mesh(torsoGeo, shirtMat);
    this.torso.position.y = 1.05;
    body.add(this.torso);

    // Belt accent
    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16),
      new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
    );
    belt.position.y = 0.85;
    body.add(belt);

    // Head — sphere with painted face texture (eyes/mouth/blush/eyebrows)
    const headGeo = new THREE.SphereGeometry(0.28, 20, 16);
    this.head = new THREE.Mesh(headGeo, getFaceMaterial('default'));
    this.head.position.y = 1.75;
    body.add(this.head);

    // Straw hat — wider brim, rounded top
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 0.05, 24),
      new THREE.MeshLambertMaterial({ color: 0xc69645 })
    );
    brim.position.y = 1.98;
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xe1b458 })
    );
    cap.position.y = 2.0;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.29, 0.06, 16),
      new THREE.MeshLambertMaterial({ color: 0x8a4a2a })
    );
    band.position.y = 2.02;
    body.add(brim, cap, band);

    // Arms — capsules
    const armGeo = new THREE.CapsuleGeometry(0.11, 0.45, 4, 8);
    this.armL = new THREE.Mesh(armGeo, shirtMat);
    this.armL.position.set(-0.42, 1.12, 0);
    this.armR = new THREE.Mesh(armGeo, shirtMat);
    this.armR.position.set(0.42, 1.12, 0);
    body.add(this.armL, this.armR);

    // Hands — spheres at tip
    const handGeo = new THREE.SphereGeometry(0.11, 10, 8);
    const handL = new THREE.Mesh(handGeo, skinMat);
    handL.position.set(0, -0.3, 0);
    this.armL.add(handL);
    const handR = new THREE.Mesh(handGeo, skinMat);
    handR.position.set(0, -0.3, 0);
    this.armR.add(handR);

    // Backpack base — rounded
    const packGeo = new THREE.CapsuleGeometry(0.23, 0.28, 4, 10);
    packGeo.rotateZ(Math.PI / 2);
    const packMat = new THREE.MeshLambertMaterial({ color: colors.backpack });
    this.packBase = new THREE.Mesh(packGeo, packMat);
    this.packBase.position.set(0, 1.1, -0.35);
    body.add(this.packBase);

    this.bodyGroup = body;
    this.group.add(body);
  }

  _buildScythe() {
    const g = new THREE.Group();
    g.position.set(0.42, 1.05, 0.08);
    this.bodyGroup.add(g);

    const shaftMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0xdce6ea });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), shaftMat);
    shaft.position.y = 0.6;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.18), bladeMat);
    blade.position.set(0.42, 1.25, 0.0);
    blade.rotation.z = -0.45;
    g.add(shaft, blade);
    this.scythe = g;
    this.scythe.rotation.x = -0.4;
    this.scythe.rotation.y = 0.15;
  }

  _buildSlashArc() {
    const pivot = new THREE.Group();
    pivot.position.y = 0.6;
    this.group.add(pivot);
    this.slashPivot = pivot;

    const outerGeo = new THREE.RingGeometry(1.0, 2.1, 32, 1, -Math.PI / 2.2, 1.8);
    outerGeo.rotateX(-Math.PI / 2);
    this.slashOuter = new THREE.Mesh(outerGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    pivot.add(this.slashOuter);

    const innerGeo = new THREE.RingGeometry(1.35, 1.85, 32, 1, -Math.PI / 2.4, 1.6);
    innerGeo.rotateX(-Math.PI / 2);
    this.slashInner = new THREE.Mesh(innerGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.slashInner.position.y = 0.01;
    pivot.add(this.slashInner);

    const tipGeo = new THREE.RingGeometry(1.2, 2.0, 24, 1, 0, 0.25);
    tipGeo.rotateX(-Math.PI / 2);
    this.slashTip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.slashTip.position.y = 0.02;
    pivot.add(this.slashTip);
  }

  // The always-on slash-radius ring was visual noise under the player's
  // feet. Removed — the slash arc fan already reads clearly when it fires.
  _buildGroundRing() { /* intentionally no-op */ }

  // Klondike-style blue open crate factory. Each crate is a tiny group:
  // four side panels + bottom + a colored "filler" mound poking out the top.
  // Geometries + materials are SHARED across all crates (cached on `this`)
  // so adding/removing crates never allocates more than the empty group.
  _ensureCratePrototypes() {
    if (this._crateProtos) return;
    const blue = new THREE.MeshLambertMaterial({ color: 0x3aa1d8 });
    const blueDark = new THREE.MeshLambertMaterial({ color: 0x2a7eb0 });
    // Crate is 0.46 wide × 0.22 tall × 0.34 deep, panels are 0.04 thick
    const sideGeo = new THREE.BoxGeometry(0.46, 0.22, 0.04);
    const endGeo  = new THREE.BoxGeometry(0.04, 0.22, 0.34);
    const baseGeo = new THREE.BoxGeometry(0.46, 0.04, 0.34);

    // Per-resource detail builders. Each returns a Group with multiple small
    // meshes arranged so the contents read clearly (carrot tops sticking up,
    // tomatoes clustered, milk bottles upright with a paper label, etc.).
    // Materials are cached per key so repeating the build doesn't allocate.
    const mat = (color) => new THREE.MeshLambertMaterial({ color });
    const mats = {
      carrot:    mat(0xf08831),
      carrotTop: mat(0x2e8b3d),
      tomato:    mat(0xe04a3c),
      tomatoLeaf: mat(0x2e8b3d),
      potato:    mat(0xc49a5a),
      potatoEye: mat(0x6f4a26),
      bale:      mat(0xe2c35a),
      baleString: mat(0x6a4628),
      planks:    mat(0xb77842),
      planksDark: mat(0x6a3f1a),
      sauce:     mat(0xd02e2a),
      sauceCap:  mat(0xfff7c4),
      sauceLabel: mat(0xfff0a0),
      chips:     mat(0xe6b548),
      chipsBag:  mat(0xc84036),
      egg:       mat(0xfaf2dc),
      eggSpot:   mat(0xc89f6a),
      milk:      mat(0xffffff),
      milkCap:   mat(0xc84036),
      milkLabel: mat(0x4fb6e8),
      corn:      mat(0xf2c648),
      cornHusk:  mat(0x5caa38),
      wheat:     mat(0xe8c54a),
      wheatStem: mat(0xbfa348),
      grass:     mat(0x5bbf3d),
      grassDark: mat(0x3aa030),
      wood:      mat(0x8b5a2b),
      woodDark:  mat(0x6a4628),
    };

    // Reusable primitive geometries — created once.
    const prims = {
      tinyBall: new THREE.SphereGeometry(0.10, 10, 8),
      smallBall: new THREE.SphereGeometry(0.13, 10, 8),
      tomato: new THREE.SphereGeometry(0.11, 10, 8),
      potato: new THREE.SphereGeometry(0.10, 8, 6),
      egg: (() => { const g = new THREE.SphereGeometry(0.08, 10, 8); g.scale(1, 1.3, 1); return g; })(),
      carrotCone: (() => { const g = new THREE.ConeGeometry(0.06, 0.18, 7); g.rotateX(0); return g; })(),
      carrotLeaf: new THREE.SphereGeometry(0.04, 6, 4),
      bottle: (() => { const g = new THREE.CylinderGeometry(0.07, 0.085, 0.22, 10); return g; })(),
      bottleNeck: new THREE.CylinderGeometry(0.04, 0.05, 0.06, 8),
      bottleCap: new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8),
      label: new THREE.BoxGeometry(0.10, 0.10, 0.001),
      bale: (() => { const g = new THREE.CylinderGeometry(0.16, 0.16, 0.34, 14); g.rotateZ(Math.PI / 2); return g; })(),
      baleString: (() => { const g = new THREE.TorusGeometry(0.16, 0.012, 6, 14); return g; })(),
      plank: new THREE.BoxGeometry(0.4, 0.04, 0.10),
      cornCob: (() => { const g = new THREE.CylinderGeometry(0.06, 0.06, 0.20, 9); return g; })(),
      cornHusk: (() => { const g = new THREE.ConeGeometry(0.07, 0.14, 6); g.rotateX(Math.PI); return g; })(),
      wheatStalk: (() => { const g = new THREE.CylinderGeometry(0.025, 0.025, 0.26, 5); return g; })(),
      wheatHead: (() => { const g = new THREE.CylinderGeometry(0.045, 0.025, 0.10, 6); return g; })(),
      chipsBag: (() => { const g = new THREE.BoxGeometry(0.18, 0.20, 0.10); return g; })(),
      chipsTop: (() => { const g = new THREE.BoxGeometry(0.16, 0.04, 0.10); return g; })(),
      grassTuft: new THREE.IcosahedronGeometry(0.13, 0),
      logSeg: (() => { const g = new THREE.CylinderGeometry(0.07, 0.07, 0.32, 8); g.rotateZ(Math.PI / 2); return g; })(),
    };

    // Detail builders — each returns a fresh Group sized to sit on top of
    // the crate. Returned group's local origin is at the rim (y=0).
    const builders = {
      carrot: () => {
        const g = new THREE.Group();
        const positions = [[-0.13, 0.04], [0, 0.06], [0.13, 0.04],
                           [-0.07, -0.06], [0.07, -0.06]];
        for (const [x, z] of positions) {
          const carrot = new THREE.Mesh(prims.carrotCone, mats.carrot);
          carrot.position.set(x, 0.06, z);
          g.add(carrot);
          // Three little leaves at the top of each carrot
          for (let l = 0; l < 3; l++) {
            const leaf = new THREE.Mesh(prims.carrotLeaf, mats.carrotTop);
            const ang = (l / 3) * Math.PI * 2;
            leaf.position.set(x + Math.cos(ang) * 0.04, 0.18, z + Math.sin(ang) * 0.04);
            g.add(leaf);
          }
        }
        return g;
      },
      tomato: () => {
        const g = new THREE.Group();
        const positions = [[-0.10, -0.08], [0.10, -0.08], [0, 0.04],
                           [-0.10, 0.08], [0.10, 0.08]];
        for (const [x, z] of positions) {
          const t = new THREE.Mesh(prims.tomato, mats.tomato);
          t.position.set(x, 0.04, z);
          g.add(t);
          // Tiny green stem cap
          const leaf = new THREE.Mesh(prims.carrotLeaf, mats.tomatoLeaf);
          leaf.position.set(x, 0.13, z);
          leaf.scale.set(1.2, 0.5, 1.2);
          g.add(leaf);
        }
        return g;
      },
      potato: () => {
        const g = new THREE.Group();
        const positions = [[-0.12, -0.08], [0.10, -0.06], [-0.04, 0.06],
                           [0.12, 0.08], [-0.10, 0.10]];
        for (const [x, z] of positions) {
          const p = new THREE.Mesh(prims.potato, mats.potato);
          p.position.set(x, 0.03, z);
          p.scale.set(1.3, 0.85, 1.0);
          p.rotation.y = Math.random() * Math.PI;
          g.add(p);
          const eye = new THREE.Mesh(prims.carrotLeaf, mats.potatoEye);
          eye.position.set(x + 0.02, 0.06, z);
          eye.scale.setScalar(0.45);
          g.add(eye);
        }
        return g;
      },
      bale: () => {
        const g = new THREE.Group();
        const bale = new THREE.Mesh(prims.bale, mats.bale);
        bale.position.y = 0.10;
        g.add(bale);
        // Two darker baling strings wrapped around
        const s1 = new THREE.Mesh(prims.baleString, mats.baleString);
        s1.position.set(-0.08, 0.10, 0);
        s1.rotation.y = Math.PI / 2;
        g.add(s1);
        const s2 = new THREE.Mesh(prims.baleString, mats.baleString);
        s2.position.set(0.08, 0.10, 0);
        s2.rotation.y = Math.PI / 2;
        g.add(s2);
        return g;
      },
      planks: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const p = new THREE.Mesh(prims.plank, mats.planks);
          p.position.set(0, 0.03 + i * 0.045, -0.10 + i * 0.10);
          g.add(p);
          // Dark grain stripe along each plank
          const grain = new THREE.Mesh(prims.plank, mats.planksDark);
          grain.position.copy(p.position);
          grain.position.y += 0.022;
          grain.scale.set(0.95, 0.2, 0.5);
          g.add(grain);
        }
        return g;
      },
      sauce: () => {
        const g = new THREE.Group();
        const positions = [[-0.10, -0.05], [0.10, -0.05], [0, 0.07]];
        for (const [x, z] of positions) {
          const body = new THREE.Mesh(prims.bottle, mats.sauce);
          body.position.set(x, 0.11, z);
          g.add(body);
          const neck = new THREE.Mesh(prims.bottleNeck, mats.sauce);
          neck.position.set(x, 0.25, z);
          g.add(neck);
          const cap = new THREE.Mesh(prims.bottleCap, mats.sauceCap);
          cap.position.set(x, 0.30, z);
          g.add(cap);
          // Yellow paper label wrapped around the bottle
          const label = new THREE.Mesh(prims.label, mats.sauceLabel);
          label.position.set(x, 0.10, z + 0.072);
          g.add(label);
        }
        return g;
      },
      chips: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const col = i % 2, row = Math.floor(i / 2);
          const x = -0.08 + col * 0.16;
          const z = -0.06 + row * 0.12;
          const bag = new THREE.Mesh(prims.chipsBag, mats.chipsBag);
          bag.position.set(x, 0.10, z);
          g.add(bag);
          // Yellow band across the middle (chips logo)
          const band = new THREE.Mesh(prims.chipsTop, mats.chips);
          band.position.set(x, 0.11, z);
          band.scale.set(1, 0.5, 1.02);
          g.add(band);
        }
        return g;
      },
      egg: () => {
        const g = new THREE.Group();
        const positions = [[-0.12, -0.08], [0, -0.08], [0.12, -0.08],
                           [-0.12, 0.04], [0, 0.04], [0.12, 0.04]];
        for (const [x, z] of positions) {
          const e = new THREE.Mesh(prims.egg, mats.egg);
          e.position.set(x, 0.06, z);
          e.rotation.z = (Math.random() - 0.5) * 0.4;
          g.add(e);
        }
        return g;
      },
      milk: () => {
        const g = new THREE.Group();
        const positions = [[-0.12, 0], [0, 0], [0.12, 0]];
        for (const [x, z] of positions) {
          const body = new THREE.Mesh(prims.bottle, mats.milk);
          body.position.set(x, 0.11, z);
          body.scale.set(1, 1.1, 1);
          g.add(body);
          const neck = new THREE.Mesh(prims.bottleNeck, mats.milk);
          neck.position.set(x, 0.26, z);
          g.add(neck);
          const cap = new THREE.Mesh(prims.bottleCap, mats.milkCap);
          cap.position.set(x, 0.31, z);
          g.add(cap);
          // Blue label
          const label = new THREE.Mesh(prims.label, mats.milkLabel);
          label.position.set(x, 0.10, z + 0.075);
          g.add(label);
        }
        return g;
      },
      corn: () => {
        const g = new THREE.Group();
        const positions = [[-0.12, -0.06], [0.12, -0.06], [0, 0.06]];
        for (const [x, z] of positions) {
          const cob = new THREE.Mesh(prims.cornCob, mats.corn);
          cob.position.set(x, 0.10, z);
          cob.rotation.z = (Math.random() - 0.5) * 0.3;
          g.add(cob);
          const husk1 = new THREE.Mesh(prims.cornHusk, mats.cornHusk);
          husk1.position.set(x - 0.04, 0.20, z);
          husk1.rotation.z = -0.5;
          g.add(husk1);
          const husk2 = new THREE.Mesh(prims.cornHusk, mats.cornHusk);
          husk2.position.set(x + 0.04, 0.20, z);
          husk2.rotation.z = 0.5;
          g.add(husk2);
        }
        return g;
      },
      wheat: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 7; i++) {
          const x = -0.13 + (i % 4) * 0.085;
          const z = -0.06 + Math.floor(i / 4) * 0.10;
          const stalk = new THREE.Mesh(prims.wheatStalk, mats.wheatStem);
          stalk.position.set(x, 0.13, z);
          stalk.rotation.z = (Math.random() - 0.5) * 0.2;
          g.add(stalk);
          const head = new THREE.Mesh(prims.wheatHead, mats.wheat);
          head.position.set(x, 0.27, z);
          g.add(head);
        }
        return g;
      },
      grass: () => {
        const g = new THREE.Group();
        const positions = [[-0.12, -0.08], [0.10, -0.08], [-0.05, 0.05],
                           [0.12, 0.08], [-0.10, 0.10]];
        for (const [x, z] of positions) {
          const tuft = new THREE.Mesh(prims.grassTuft, mats.grass);
          tuft.position.set(x, 0.07, z);
          tuft.rotation.y = Math.random() * Math.PI;
          tuft.scale.set(0.9, 1.1, 0.9);
          g.add(tuft);
          const dark = new THREE.Mesh(prims.grassTuft, mats.grassDark);
          dark.position.set(x, 0.05, z);
          dark.scale.setScalar(0.6);
          g.add(dark);
        }
        return g;
      },
      wood: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const log = new THREE.Mesh(prims.logSeg, mats.wood);
          log.position.set(0, 0.07 + i * 0.10, -0.05 + (i % 2) * 0.10);
          g.add(log);
          // Dark end-cap rings
          const cap = new THREE.Mesh(prims.logSeg, mats.woodDark);
          cap.position.copy(log.position);
          cap.scale.set(1.05, 0.15, 1.05);
          g.add(cap);
        }
        return g;
      },
    };

    this._crateProtos = { blue, blueDark, sideGeo, endGeo, baseGeo, builders };
  }

  _makeCrate(kind) {
    this._ensureCratePrototypes();
    const p = this._crateProtos;
    const g = new THREE.Group();
    // Bottom slab + 4 panels — the open crate body
    const base = new THREE.Mesh(p.baseGeo, p.blueDark);
    base.position.y = 0.02;
    g.add(base);
    const front = new THREE.Mesh(p.sideGeo, p.blue);
    front.position.set(0, 0.13, 0.15);
    g.add(front);
    const back = new THREE.Mesh(p.sideGeo, p.blue);
    back.position.set(0, 0.13, -0.15);
    g.add(back);
    const left = new THREE.Mesh(p.endGeo, p.blue);
    left.position.set(-0.21, 0.13, 0);
    g.add(left);
    const right = new THREE.Mesh(p.endGeo, p.blue);
    right.position.set(0.21, 0.13, 0);
    g.add(right);
    // Detailed contents arrangement on top of the crate
    const builder = p.builders[kind] || p.builders.grass;
    const contents = builder();
    contents.position.y = 0.22; // sit just above the crate rim
    g.add(contents);
    g.userData.contents = contents;
    g.userData.kind = kind;
    return g;
  }

  // Back stack — vertical column of blue crates rising up the player's back.
  // Caps grass (wood) into one crate per item per Klondike convention.
  _buildBackStack() {
    this.backStackGroup = new THREE.Group();
    this.backStackGroup.position.set(0, 1.45, -0.42);
    this.bodyGroup.add(this.backStackGroup);
    this.backStackCrates = [];
    Backpack.subscribe(() => this._updateBackStack());
    this._updateBackStack();
  }

  _swapCrateContents(crate, kind) {
    if (crate.userData.kind === kind) return;
    if (crate.userData.contents) {
      crate.remove(crate.userData.contents);
      crate.userData.contents = null;
    }
    const builder = this._crateProtos.builders[kind] || this._crateProtos.builders.grass;
    const contents = builder();
    contents.position.y = 0.22;
    crate.add(contents);
    crate.userData.contents = contents;
    crate.userData.kind = kind;
  }

  _updateBackStack() {
    const items = Backpack.items;
    const sequence = [];
    for (let i = 0; i < (items.grass || 0); i++) sequence.push('grass');
    for (let i = 0; i < (items.wood || 0); i++) sequence.push('wood');
    // Expand pool
    while (this.backStackCrates.length < sequence.length) {
      const c = this._makeCrate('grass');
      c.visible = false;
      this.backStackGroup.add(c);
      this.backStackCrates.push(c);
    }
    for (let i = 0; i < this.backStackCrates.length; i++) {
      const crate = this.backStackCrates[i];
      if (i >= sequence.length) { crate.visible = false; continue; }
      crate.visible = true;
      this._swapCrateContents(crate, sequence[i]);
      const layer = Math.floor(i / 2);
      const slot = i % 2;
      const offsetX = slot === 0 ? -0.13 : 0.13;
      const wobble = ((i * 37) % 9 - 4) * 0.008;
      crate.position.set(offsetX + wobble, layer * 0.30, 0);
      crate.rotation.z = wobble * 0.4;
    }
  }

  // Front carry — Klondike-style vertical column of blue crates cradled in
  // front of the player. Each crate's filler shows the resource inside, so
  // the same crate body is reused for every product type.
  _buildFrontCarry() {
    this.carryGroup = new THREE.Group();
    this.carryGroup.position.set(0, 0.7, 0.34);
    this.bodyGroup.add(this.carryGroup);
    this.carryCrates = [];
    PlayerCarry.subscribe(() => this._updateCarry());
    this._updateCarry();
  }

  _updateCarry() {
    const items = PlayerCarry.items;
    const seq = [];
    for (const k of ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips', 'egg', 'milk', 'corn', 'wheat']) {
      for (let i = 0; i < (items[k] || 0); i++) seq.push(k);
    }
    while (this.carryCrates.length < seq.length) {
      const c = this._makeCrate('bale');
      c.visible = false;
      this.carryGroup.add(c);
      this.carryCrates.push(c);
    }
    for (let i = 0; i < this.carryCrates.length; i++) {
      const crate = this.carryCrates[i];
      if (i >= seq.length) { crate.visible = false; continue; }
      crate.visible = true;
      this._swapCrateContents(crate, seq[i]);
      const wobble = ((i * 41) % 9 - 4) * 0.010;
      crate.position.set(wobble, i * 0.30, 0);
      crate.rotation.z = wobble * 0.4;
    }
  }

  // GPS arrow — a single filled 2D arrow lying flat above the player's head
  // that rotates on Y to point at its target. Apex is in local +Z so rotating
  // by atan2(dx, dz) lines up with the world delta to the target.
  _buildGpsArrow() {
    const pivot = new THREE.Group();
    pivot.position.set(0, 3.0, 0);
    this.group.add(pivot);

    const s = 0.55;
    const shape = new THREE.Shape();
    shape.moveTo(-0.35 * s, -0.6 * s);
    shape.lineTo(-0.35 * s,  0.2 * s);
    shape.lineTo(-0.78 * s,  0.2 * s);
    shape.lineTo( 0.00 * s,  1.0 * s); // apex
    shape.lineTo( 0.78 * s,  0.2 * s);
    shape.lineTo( 0.35 * s,  0.2 * s);
    shape.lineTo( 0.35 * s, -0.6 * s);
    shape.closePath();
    // ShapeGeometry builds in the XY plane; rotate +π/2 around X so apex
    // maps from +Y to +Z and the whole arrow lies flat on the XZ plane.
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);

    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0x4aa5ff, side: THREE.DoubleSide,
      transparent: true, opacity: 0.98, depthTest: false,
    });
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0x0a2f52, side: THREE.DoubleSide,
      transparent: true, opacity: 0.95, depthTest: false,
    });
    const outline = new THREE.Mesh(geo, outlineMat);
    outline.scale.setScalar(1.22);
    outline.position.y = -0.02;
    outline.renderOrder = 1;
    const body = new THREE.Mesh(geo, bodyMat);
    body.renderOrder = 2;
    pivot.add(outline, body);

    this.gpsArrow = pivot;
    this.gpsArrow.visible = false;
    this._gpsBob = 0;
  }

  updateGpsArrow(targetPos, visible, dt) {
    if (!this.gpsArrow) return;
    this.gpsArrow.visible = !!visible && !!targetPos;
    if (!this.gpsArrow.visible) return;
    this._gpsBob += dt * 3.5;
    this.gpsArrow.position.y = 3.0 + Math.sin(this._gpsBob) * 0.15;
    const dx = targetPos.x - this.group.position.x;
    const dz = targetPos.z - this.group.position.z;
    // atan2(dx, dz): with apex in local +Z, rotating by this aligns local
    // +Z with the world (dx, dz) heading toward the target.
    this.gpsArrow.rotation.y = Math.atan2(dx, dz);
    // Gentle pulse for liveliness
    const s = 1 + Math.sin(this._gpsBob * 1.4) * 0.08;
    this.gpsArrow.scale.set(s, 1, s);
  }

  update(dt, moveInput) {
    const speed = PlayerStats.speed;
    const mag = Math.hypot(moveInput.x, moveInput.y);
    this.isMoving = mag > 0.08;

    if (this.isMoving) {
      const dirX = moveInput.x;
      const dirZ = -moveInput.y;
      const norm = Math.max(Math.hypot(dirX, dirZ), 1e-5);
      const nx = dirX / norm;
      const nz = dirZ / norm;
      this.velocity.set(nx * speed * Math.min(mag, 1), 0, nz * speed * Math.min(mag, 1));
      this.group.position.x += this.velocity.x * dt;
      this.group.position.z += this.velocity.z * dt;
      // Clamp to the rectangular playable bounds so the player can't walk
      // off the ground plane past the southern road.
      const b = CONFIG.world.bounds;
      if (b) {
        this.group.position.x = Math.max(b.minX + 0.8, Math.min(b.maxX - 0.8, this.group.position.x));
        this.group.position.z = Math.max(b.minZ + 0.8, Math.min(b.maxZ - 0.8, this.group.position.z));
      } else {
        const half = CONFIG.world.size / 2 - 1.5;
        this.group.position.x = Math.max(-half, Math.min(half, this.group.position.x));
        this.group.position.z = Math.max(-half, Math.min(half, this.group.position.z));
      }
      // Expansion gate — while locked, the player cannot cross the fence
      // line. Small tolerance so you can physically touch the gate.
      const gateZ = this._expansionGateZ;
      if (gateZ != null && !this._expansionGateOpen && this.group.position.z < gateZ + 0.5) {
        this.group.position.z = gateZ + 0.5;
      }
      const targetYaw = Math.atan2(nx, nz);
      // Faster turn so changing direction (including southward) is snappy
      this.bodyGroup.rotation.y = this._lerpAngle(this.bodyGroup.rotation.y, targetYaw, 1 - Math.exp(-18 * dt));
      this.forward.set(Math.sin(this.bodyGroup.rotation.y), 0, Math.cos(this.bodyGroup.rotation.y));
    } else {
      this.velocity.set(0, 0, 0);
    }

    if (this.isMoving) {
      this.walkPhase += dt * 10;
      this.legL.rotation.x = Math.sin(this.walkPhase) * 0.7;
      this.legR.rotation.x = -Math.sin(this.walkPhase) * 0.7;
      this.torso.position.y = 1.05 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.04;
    } else {
      this.walkPhase = 0;
      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
      this.torso.position.y = 1.05;
    }

    if (this.slashT > 0) {
      // Faster swing beat (0.22s) + big horizontal side-sweep. The body
      // twists with the swing so it reads as a real scythe arc rather
      // than a flat arm rotation.
      this.slashT += dt / 0.22;
      if (this.slashT >= 1) {
        this.slashT = 0;
        this.slashOuter.material.opacity = 0;
        this.slashInner.material.opacity = 0;
        this.slashTip.material.opacity = 0;
        this.torso.rotation.y = 0;
        this.armR.rotation.z = 0;
      } else {
        const t = this.slashT;
        const env = Math.sin(t * Math.PI);
        this.slashPivot.rotation.y = this.bodyGroup.rotation.y + (-1.2 + 2.4 * t);
        this.slashOuter.material.opacity = env * 0.7;
        this.slashInner.material.opacity = env * 0.95;
        this.slashTip.material.opacity = Math.pow(env, 1.5);
        // Arm sweeps wide sideways (rotation.z = right→left arc)
        this.armR.rotation.x = -1.2 + 1.4 * t;
        this.armR.rotation.z = 1.4 - 2.8 * t;
        // Scythe follows the arm with its blade flattening into a flat sweep
        this.scythe.rotation.z = -1.4 + 2.8 * t;
        this.scythe.rotation.x = -0.3 + env * 0.6;
        this.scythe.rotation.y = -0.5 + t * 1.0;
        // Torso twist — counter-rotates with the swing for the wind-up →
        // follow-through feel. Torso is a child of bodyGroup so this rides
        // along with the movement rotation cleanly.
        this.torso.rotation.y = (-0.35 + 0.7 * t) * env;
      }
    } else {
      this.armR.rotation.x *= 0.7;
      this.scythe.rotation.z *= 0.8;
      this.scythe.rotation.x += (-0.4 - this.scythe.rotation.x) * 0.2;
    }

    if (this.slashCooldown > 0) this.slashCooldown -= dt * 1000;
  }

  canSlash() { return this.slashCooldown <= 0; }
  startSlash() {
    this.slashT = 0.001;
    this.slashCooldown = CONFIG.player.slashCooldownMs;
  }

  // Where spawned pickups/carry items should fly toward on the player.
  // Reuse pre-allocated locals + return a shared output vector to avoid GC
  // pressure — these are called per pickup per frame.
  getCarryAnchor() {
    if (!this._carryLocal) {
      this._carryLocal = new THREE.Vector3(0, 1.2, 0.55);
      this._carryOut = new THREE.Vector3();
    }
    this._carryOut.copy(this._carryLocal);
    return this.bodyGroup.localToWorld(this._carryOut);
  }
  getBackpackAnchor() {
    if (!this._backLocal) {
      this._backLocal = new THREE.Vector3(0, 1.35, -0.5);
      this._backOut = new THREE.Vector3();
    }
    this._backOut.copy(this._backLocal);
    return this.bodyGroup.localToWorld(this._backOut);
  }

  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}
