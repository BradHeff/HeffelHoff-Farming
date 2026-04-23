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
    this.stacksCount = opts.stacksCount || 10;
    this.perStack = opts.perStack || 12;
    this.pickupRadius = opts.pickupRadius || 2.0;
    this.total = this.stacksCount * this.perStack;

    this.group = new THREE.Group();
    this.group.position.copy(this.origin);
    scene.add(this.group);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.06, 24),
      new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
    );
    pad.position.y = 0.03;
    this.group.add(pad);

    // Pre-computed local positions per slot (stack * coin)
    this.slots = new Array(this.total);
    const cols = 5, rows = Math.ceil(this.stacksCount / cols);
    const cellW = 0.55;
    for (let i = 0; i < this.stacksCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * cellW;
      const z = (row - (rows - 1) / 2) * cellW * 0.9;
      for (let k = 0; k < this.perStack; k++) {
        this.slots[i * this.perStack + k] = { x, y: 0.06 + k * 0.08, z };
      }
    }

    const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.08, 14);
    const coinMat = new THREE.MeshLambertMaterial({ color: 0xf7c648 });
    this.coinInst = new THREE.InstancedMesh(coinGeo, coinMat, this.total);
    this.coinInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Start all hidden
    for (let i = 0; i < this.total; i++) this.coinInst.setMatrixAt(i, _coinZero);
    this.coinInst.instanceMatrix.needsUpdate = true;
    this.group.add(this.coinInst);

    this._t = 0;
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
    if (this.pending <= 0) return;
    const dx = player.group.position.x - this.origin.x;
    const dz = player.group.position.z - this.origin.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > this.pickupRadius * this.pickupRadius) return;
    this._drainAcc = (this._drainAcc || 0) + dt;
    const rate = 0.035;
    while (this._drainAcc >= rate && this.pending > 0) {
      this._drainAcc -= rate;
      this.pending -= 1;
      Inventory.add('coin', 1);
    }
    this._floatAcc = (this._floatAcc || 0) + dt;
    if (this._floatAcc >= 0.25 && floaters) {
      this._floatAcc = 0;
      floaters.spawn(
        { x: this.origin.x + (Math.random() - 0.5) * 1.0, y: 1.3, z: this.origin.z + (Math.random() - 0.5) * 0.8 },
        `+ ${RES_ICONS?.coin || '🪙'}`,
        { cls: 'gain', ttl: 0.55, vy: 2.4 }
      );
    }
    this._refresh();
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
