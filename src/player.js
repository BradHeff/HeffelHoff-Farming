import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Backpack, PlayerCarry, PlayerStats } from './state.js';

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

    // Head — sphere
    const headGeo = new THREE.SphereGeometry(0.28, 18, 14);
    this.head = new THREE.Mesh(headGeo, skinMat);
    this.head.position.y = 1.75;
    body.add(this.head);

    // Eyes (two tiny dark spheres)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const eyeGeo = new THREE.SphereGeometry(0.04, 8, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.1, 1.78, 0.25);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.1, 1.78, 0.25);
    body.add(eyeL, eyeR);

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

  _buildGroundRing() {
    this._groundRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.groundRing = new THREE.Mesh(this._makeRingGeo(PlayerStats.slashRadius), this._groundRingMat);
    this.groundRing.position.y = 0.05;
    this.group.add(this.groundRing);
    PlayerStats.subscribe(() => {
      const old = this.groundRing.geometry;
      this.groundRing.geometry = this._makeRingGeo(PlayerStats.slashRadius);
      if (old) old.dispose();
    });
  }

  _makeRingGeo(radius) {
    const g = new THREE.RingGeometry(radius - 0.12, radius + 0.04, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  // Back stack — shared pool of meshes that renders the uncapped backpack.
  _buildBackStack() {
    this.backStackGroup = new THREE.Group();
    this.backStackGroup.position.set(0, 1.55, -0.5);
    this.bodyGroup.add(this.backStackGroup);

    this.backStackMats = {
      wood: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
      grass: new THREE.MeshLambertMaterial({ color: 0x5bbf3d }),
    };
    // Slightly rounded blocks for a less-blocky look
    this.backStackGeo = new THREE.BoxGeometry(0.42, 0.22, 0.28);
    this.backStackMeshes = [];

    Backpack.subscribe(() => this._updateBackStack());
    this._updateBackStack();
  }

  _updateBackStack() {
    const items = Backpack.items;
    const sequence = [];
    for (let i = 0; i < (items.grass || 0); i++) sequence.push('grass');
    for (let i = 0; i < (items.wood || 0); i++) sequence.push('wood');
    while (this.backStackMeshes.length < sequence.length) {
      const m = new THREE.Mesh(this.backStackGeo, this.backStackMats.wood);
      m.visible = false;
      this.backStackGroup.add(m);
      this.backStackMeshes.push(m);
    }
    for (let i = 0; i < this.backStackMeshes.length; i++) {
      const mesh = this.backStackMeshes[i];
      if (i >= sequence.length) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.material = this.backStackMats[sequence[i]];
      const layer = Math.floor(i / 2);
      const slot = i % 2;
      const offsetX = slot === 0 ? -0.12 : 0.12;
      const wobble = ((i * 37) % 9 - 4) * 0.01;
      mesh.position.set(offsetX + wobble, layer * 0.2, 0);
      mesh.rotation.z = wobble * 0.6;
    }
  }

  // Front carry stack — rendered in front of the torso (like arms cradle it).
  _buildFrontCarry() {
    this.carryGroup = new THREE.Group();
    // Slightly forward of torso, between the arms
    this.carryGroup.position.set(0, 0.9, 0.38);
    this.bodyGroup.add(this.carryGroup);

    // Geometries + materials for each carried kind
    this.carryKinds = {
      bale:   { geo: new THREE.CylinderGeometry(0.22, 0.22, 0.36, 12), mat: new THREE.MeshLambertMaterial({ color: 0xe2c35a }), layerH: 0.22 },
      planks: { geo: new THREE.BoxGeometry(0.52, 0.08, 0.18), mat: new THREE.MeshLambertMaterial({ color: 0xb77842 }), layerH: 0.12 },
      tomato: { geo: new THREE.SphereGeometry(0.18, 10, 8), mat: new THREE.MeshLambertMaterial({ color: 0xe04a3c }), layerH: 0.18 },
      potato: { geo: new THREE.SphereGeometry(0.16, 8, 6), mat: new THREE.MeshLambertMaterial({ color: 0xc49a5a }), layerH: 0.16 },
      sauce:  { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.32, 10), mat: new THREE.MeshLambertMaterial({ color: 0xd02e2a }), layerH: 0.32 },
      chips:  { geo: new THREE.BoxGeometry(0.28, 0.22, 0.18), mat: new THREE.MeshLambertMaterial({ color: 0xe6b548 }), layerH: 0.22 },
    };
    this.carryKinds.bale.geo.rotateZ(Math.PI / 2);
    this.carryMeshes = [];

    PlayerCarry.subscribe(() => this._updateCarry());
    this._updateCarry();
  }

  _updateCarry() {
    const items = PlayerCarry.items;
    const seq = [];
    for (const k of ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips']) {
      for (let i = 0; i < (items[k] || 0); i++) seq.push(k);
    }
    while (this.carryMeshes.length < seq.length) {
      const m = new THREE.Mesh(this.carryKinds.bale.geo, this.carryKinds.bale.mat);
      m.visible = false;
      this.carryGroup.add(m);
      this.carryMeshes.push(m);
    }
    let y = 0;
    for (let i = 0; i < this.carryMeshes.length; i++) {
      const mesh = this.carryMeshes[i];
      if (i >= seq.length) { mesh.visible = false; continue; }
      mesh.visible = true;
      const kind = this.carryKinds[seq[i]];
      mesh.geometry = kind.geo;
      mesh.material = kind.mat;
      const wobble = ((i * 41) % 9 - 4) * 0.012;
      mesh.position.set(wobble, y, 0);
      mesh.rotation.z = wobble * 0.5;
      y += kind.layerH;
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
      const half = CONFIG.world.size / 2 - 1.5;
      this.group.position.x = Math.max(-half, Math.min(half, this.group.position.x));
      this.group.position.z = Math.max(-half, Math.min(half, this.group.position.z));
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
      this.slashT += dt / 0.26;
      if (this.slashT >= 1) {
        this.slashT = 0;
        this.slashOuter.material.opacity = 0;
        this.slashInner.material.opacity = 0;
        this.slashTip.material.opacity = 0;
      } else {
        const t = this.slashT;
        const env = Math.sin(t * Math.PI);
        this.slashPivot.rotation.y = this.bodyGroup.rotation.y + (-0.9 + 1.8 * t);
        this.slashOuter.material.opacity = env * 0.65;
        this.slashInner.material.opacity = env * 0.95;
        this.slashTip.material.opacity = Math.pow(env, 1.5);
        this.armR.rotation.x = -1.8 + 2.6 * t;
        this.scythe.rotation.z = -1.0 + 2.2 * t;
        this.scythe.rotation.x = -0.4 + env * 0.8;
      }
    } else {
      this.armR.rotation.x *= 0.7;
      this.scythe.rotation.z *= 0.8;
      this.scythe.rotation.x += (-0.4 - this.scythe.rotation.x) * 0.2;
    }

    const pulse = 0.32 + Math.sin(this.walkPhase * 1.5) * 0.05;
    this.groundRing.material.opacity = this.isMoving ? pulse + 0.08 : pulse - 0.08;

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
