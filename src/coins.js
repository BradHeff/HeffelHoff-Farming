import * as THREE from 'three';
import { Inventory } from './state.js';

// Distributed coin pile — up to 10 small stacks arranged in a grid. Each
// stack grows to `perStack` before the next stack fills. Matches the
// reference screenshots where coins sit on the ground as multiple piles.
export class CoinPile {
  constructor(scene, origin, opts = {}) {
    this.scene = scene;
    this.origin = new THREE.Vector3(origin.x, 0, origin.z);
    this.pending = 0;
    this.stacksCount = opts.stacksCount || 10;
    this.perStack = opts.perStack || 12;        // coins per visual stack
    this.pickupRadius = opts.pickupRadius || 2.0;

    this.group = new THREE.Group();
    this.group.position.copy(this.origin);
    scene.add(this.group);

    // Small wooden pad under the pile
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.06, 24),
      new THREE.MeshLambertMaterial({ color: 0x8a6b42 })
    );
    pad.position.y = 0.03;
    this.group.add(pad);

    this.coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.08, 14);
    this.coinMat = new THREE.MeshLambertMaterial({ color: 0xf7c648 });
    this.edgeMat = new THREE.MeshLambertMaterial({ color: 0xd09822 });

    // 2 rows x 5 cols laid out inside the pad
    this.stacks = [];
    const cols = 5, rows = Math.ceil(this.stacksCount / cols);
    const cellW = 0.55;
    for (let i = 0; i < this.stacksCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * cellW;
      const z = (row - (rows - 1) / 2) * cellW * 0.9;
      const stack = { meshes: [], x, z };
      for (let k = 0; k < this.perStack; k++) {
        const mesh = new THREE.Mesh(this.coinGeo, k % 3 === 0 ? this.edgeMat : this.coinMat);
        mesh.position.set(x, 0.06 + k * 0.08, z);
        mesh.rotation.y = (i * 0.3 + k * 0.5) % (Math.PI * 2);
        mesh.visible = false;
        this.group.add(mesh);
        stack.meshes.push(mesh);
      }
      this.stacks.push(stack);
    }

    this._t = 0;
  }

  get capacity() { return this.stacksCount * this.perStack; }

  // Returns the world position where the next coin mesh will appear — used by
  // flight animations to target the pile visually.
  getNextCoinTargetWorld() {
    const total = Math.min(this.pending, this.capacity);
    const stackIdx = Math.min(Math.floor(total / this.perStack), this.stacksCount - 1);
    const coinIdx = total - stackIdx * this.perStack;
    const s = this.stacks[stackIdx];
    const local = new THREE.Vector3(s.x, 0.06 + coinIdx * 0.08, s.z);
    return this.group.localToWorld(local);
  }

  addPending(n) {
    this.pending = Math.max(0, this.pending + n);
    this._refresh();
  }

  _refresh() {
    let remaining = Math.min(this.pending, this.capacity);
    for (let i = 0; i < this.stacks.length; i++) {
      const s = this.stacks[i];
      const show = Math.min(remaining, s.meshes.length);
      for (let k = 0; k < s.meshes.length; k++) s.meshes[k].visible = k < show;
      remaining -= show;
    }
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

// Player coin tower — small vertical stack above head reflecting Inventory.coin.
export class PlayerCoinTower {
  constructor(player) {
    this.player = player;
    this.group = new THREE.Group();
    this.group.position.set(0, 2.3, -0.1);
    player.bodyGroup.add(this.group);

    this.coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.09, 12);
    this.coinMat = new THREE.MeshLambertMaterial({ color: 0xf7c648 });
    this.edgeMat = new THREE.MeshLambertMaterial({ color: 0xd09822 });

    this.meshes = [];

    Inventory.subscribe(() => this._refresh());
    this._refresh();
  }

  _refresh() {
    const n = Inventory.coin;
    while (this.meshes.length < n) {
      const i = this.meshes.length;
      const m = new THREE.Mesh(this.coinGeo, i % 3 === 0 ? this.edgeMat : this.coinMat);
      m.position.y = i * 0.09;
      m.rotation.y = (i * 0.4) % (Math.PI * 2);
      this.group.add(m);
      this.meshes.push(m);
    }
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = i < n;
  }
}
