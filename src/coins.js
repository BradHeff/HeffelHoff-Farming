import * as THREE from 'three';
import { Inventory } from './state.js';

// Distributed coin pile — up to 10 small stacks arranged in a grid. Uses a
// single InstancedMesh so the whole pile is 2 draw calls (coin + pad) rather
// than 120. Individual coins show/hide by setting a zero-scale matrix.
const _coinZero = new THREE.Matrix4().makeScale(0, 0, 0);
const _coinM4 = new THREE.Matrix4();

export class CoinPile {
  constructor(scene, origin, opts = {}) {
    this.scene = scene;
    this.origin = new THREE.Vector3(origin.x, 0, origin.z);
    this.pending = 0;
    // Flat tray layout: a rectangular grid of cells, each holding up to
    // `perStack` coins. Default 8×6 = 48 cells × 2 coins = 96 visual total.
    this.cols = opts.cols || 8;
    this.rows = opts.rows || 6;
    this.perStack = opts.perStack || 2;
    this.pickupRadius = opts.pickupRadius || 2.2;
    this.stacksCount = this.cols * this.rows;
    this.total = this.stacksCount * this.perStack;

    this.group = new THREE.Group();
    this.group.position.copy(this.origin);
    scene.add(this.group);

    const cellW = 0.36;
    const cellD = 0.3;
    const trayW = this.cols * cellW + 0.4;
    const trayD = this.rows * cellD + 0.4;

    // Rectangular wooden tray
    const trayBase = new THREE.Mesh(
      new THREE.BoxGeometry(trayW, 0.08, trayD),
      new THREE.MeshLambertMaterial({ color: 0xc78b4a })
    );
    trayBase.position.y = 0.04;
    this.group.add(trayBase);
    const rim = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const rimH = 0.1;
    const rimT = 0.08;
    const addRim = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), rim);
      m.position.set(x, 0.08 + rimH / 2, z);
      this.group.add(m);
    };
    addRim(trayW, rimT, 0, -trayD / 2 + rimT / 2);
    addRim(trayW, rimT, 0,  trayD / 2 - rimT / 2);
    addRim(rimT, trayD, -trayW / 2 + rimT / 2, 0);
    addRim(rimT, trayD,  trayW / 2 - rimT / 2, 0);

    // Pre-computed local positions per slot (cell * perStack)
    this.slots = new Array(this.total);
    for (let i = 0; i < this.stacksCount; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const x = (col - (this.cols - 1) / 2) * cellW;
      const z = (row - (this.rows - 1) / 2) * cellD;
      for (let k = 0; k < this.perStack; k++) {
        this.slots[i * this.perStack + k] = { x, y: 0.12 + k * 0.07, z };
      }
    }

    const coinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12);
    const coinMat = new THREE.MeshLambertMaterial({ color: 0xf7c648 });
    this.coinInst = new THREE.InstancedMesh(coinGeo, coinMat, this.total);
    this.coinInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.total; i++) this.coinInst.setMatrixAt(i, _coinZero);
    this.coinInst.instanceMatrix.needsUpdate = true;
    this.group.add(this.coinInst);

    // Destination arrow floating above the tray — tells the player "payment
    // collects here". Two-piece (shaft + head), bob-animated.
    const arrow = new THREE.Group();
    const arrowMat = new THREE.MeshLambertMaterial({ color: 0x2e9bff });
    const shaftGeo = new THREE.BoxGeometry(0.24, 0.55, 0.24);
    const shaft = new THREE.Mesh(shaftGeo, arrowMat);
    shaft.position.y = 0.95;
    arrow.add(shaft);
    const headGeo = new THREE.ConeGeometry(0.45, 0.55, 4);
    headGeo.rotateX(Math.PI);
    headGeo.rotateY(Math.PI / 4);
    const head = new THREE.Mesh(headGeo, arrowMat);
    head.position.y = 0.4;
    arrow.add(head);
    arrow.position.y = 1.9;
    this.group.add(arrow);
    this._arrow = arrow;

    this._t = 0;
    this._splashed = false;

    // Pool of small coin meshes used for the splash-to-player flight anim.
    this._flyPool = [];
    this._flyActive = [];
    const flyGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10);
    const flyMat = new THREE.MeshLambertMaterial({ color: 0xffd04a });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(flyGeo, flyMat);
      m.visible = false;
      scene.add(m);
      this._flyPool.push(m);
    }
  }

  get capacity() { return this.total; }

  getNextCoinTargetWorld() {
    const idx = Math.min(this.pending, this.total - 1);
    const slot = this.slots[Math.max(idx, 0)];
    const local = new THREE.Vector3(slot.x, slot.y, slot.z);
    return this.group.localToWorld(local);
  }

  addPending(n) {
    this.pending = Math.max(0, this.pending + n);
    this._refresh();
  }

  _refresh() {
    const shown = Math.min(this.pending, this.total);
    for (let i = 0; i < this.total; i++) {
      if (i < shown) {
        const s = this.slots[i];
        _coinM4.makeTranslation(s.x, s.y, s.z);
        this.coinInst.setMatrixAt(i, _coinM4);
      } else {
        this.coinInst.setMatrixAt(i, _coinZero);
      }
    }
    this.coinInst.instanceMatrix.needsUpdate = true;
  }

  update(dt, player, floaters, RES_ICONS) {
    this._t += dt;
    this.group.position.y = Math.sin(this._t * 2.2) * 0.04;
    if (this._arrow) {
      this._arrow.position.y = 1.9 + Math.sin(this._t * 3.4) * 0.18;
      this._arrow.rotation.y = this._t * 1.2;
      // Hide arrow when there are no coins to collect
      this._arrow.visible = this.pending > 0;
    }

    // Tick any in-flight coin meshes (splash flies)
    this._tickFlights(dt, player);

    if (this.pending <= 0) {
      this._splashed = false;
      return;
    }
    const dx = player.group.position.x - this.origin.x;
    const dz = player.group.position.z - this.origin.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > this.pickupRadius * this.pickupRadius) {
      this._splashed = false;
      return;
    }
    // One-shot splash on enter: dump all pending into Inventory, then
    // animate up to ~18 coin meshes flying from the tray into the player.
    if (this._splashed) return;
    this._splashed = true;
    this._splashCollect(player, floaters, RES_ICONS);
  }

  _splashCollect(player, floaters, RES_ICONS) {
    const total = this.pending;
    if (total <= 0) return;
    Inventory.add('coin', total);
    this.pending = 0;

    const flights = Math.min(total, this._flyPool.length);
    for (let i = 0; i < flights; i++) {
      const m = this._flyPool.pop();
      if (!m) break;
      const slot = this.slots[Math.min(i, this.slots.length - 1)];
      const wp = this.group.localToWorld(new THREE.Vector3(slot.x, slot.y + 0.2, slot.z));
      m.position.copy(wp);
      m.visible = true;
      this._flyActive.push({
        mesh: m,
        t: 0,
        ttl: 0.42 + Math.random() * 0.12,
        start: wp.clone(),
        // Stagger starts so they form a trail, not a single pop
        delay: i * 0.03,
        spin: (Math.random() - 0.5) * 18,
        player,
      });
    }
    if (floaters) {
      floaters.spawn(
        { x: this.origin.x, y: 2.0, z: this.origin.z },
        `+${total} ${RES_ICONS?.coin || '🪙'}`,
        { cls: 'gain', ttl: 1.1, vy: 2.2 }
      );
    }
    this._refresh();
  }

  _tickFlights(dt, player) {
    if (this._flyActive.length === 0) return;
    for (let i = this._flyActive.length - 1; i >= 0; i--) {
      const f = this._flyActive[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      const k = Math.min(1, f.t / f.ttl);
      // Player's current coin tower anchor
      const targ = player.group.position;
      const tx = targ.x, ty = 2.3, tz = targ.z;
      const sx = f.start.x, sy = f.start.y, sz = f.start.z;
      // Parabolic lerp with extra rise
      const arc = Math.sin(k * Math.PI) * 0.8;
      f.mesh.position.x = sx + (tx - sx) * k;
      f.mesh.position.y = sy + (ty - sy) * k + arc;
      f.mesh.position.z = sz + (tz - sz) * k;
      f.mesh.rotation.y += f.spin * dt;
      f.mesh.rotation.x += f.spin * 0.6 * dt;
      if (k >= 1) {
        f.mesh.visible = false;
        this._flyPool.push(f.mesh);
        this._flyActive.splice(i, 1);
      }
    }
  }
}

// Player coin tower — small vertical stack above head. Capped at MAX_VISUAL
// coins to prevent runaway allocation (was the root cause of freezes once
// coin totals climbed into the hundreds after L3 production).
const MAX_VISUAL_COINS = 20;

export class PlayerCoinTower {
  constructor(player) {
    this.player = player;
    this.group = new THREE.Group();
    this.group.position.set(0, 2.3, -0.1);
    player.bodyGroup.add(this.group);

    this.coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.09, 12);
    this.coinMat = new THREE.MeshLambertMaterial({ color: 0xf7c648 });
    this.edgeMat = new THREE.MeshLambertMaterial({ color: 0xd09822 });

    // Pre-allocate the max so _refresh never allocates per-frame
    this.meshes = [];
    for (let i = 0; i < MAX_VISUAL_COINS; i++) {
      const m = new THREE.Mesh(this.coinGeo, i % 3 === 0 ? this.edgeMat : this.coinMat);
      m.position.y = i * 0.09;
      m.rotation.y = (i * 0.4) % (Math.PI * 2);
      m.visible = false;
      this.group.add(m);
      this.meshes.push(m);
    }

    Inventory.subscribe(() => this._refresh());
    this._refresh();
  }

  _refresh() {
    const n = Math.min(Inventory.coin, MAX_VISUAL_COINS);
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = i < n;
  }
}
