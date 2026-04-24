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

    // Stylish money safe — green velvet base, gold-trimmed rim, brass corner
    // studs, and a wide cream "MONEY" plaque on the front skirt. Replaces
    // the plain wooden tray that read as drab next to the candy palette.
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(trayW + 0.4, 0.36, trayD + 0.4),
      new THREE.MeshLambertMaterial({ color: 0x2c7d3a })   // dark velvet green
    );
    skirt.position.y = 0.18;
    this.group.add(skirt);
    // Cream tray base — money sits here
    const trayBase = new THREE.Mesh(
      new THREE.BoxGeometry(trayW, 0.06, trayD),
      new THREE.MeshLambertMaterial({ color: 0xfff3d3 })
    );
    trayBase.position.y = 0.39;
    this.group.add(trayBase);
    // Gold rim around the tray edge
    const rimMat = new THREE.MeshLambertMaterial({ color: 0xf2c14a });
    const rimAccent = new THREE.MeshLambertMaterial({ color: 0xb8862e });
    const rimH = 0.08;
    const rimT = 0.10;
    const yRim = 0.42;
    const addRim = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), rimMat);
      m.position.set(x, yRim, z);
      this.group.add(m);
    };
    addRim(trayW + 0.18, rimT, 0, -trayD / 2 + rimT / 2);
    addRim(trayW + 0.18, rimT, 0,  trayD / 2 - rimT / 2);
    addRim(rimT, trayD + 0.18, -trayW / 2 + rimT / 2, 0);
    addRim(rimT, trayD + 0.18,  trayW / 2 - rimT / 2, 0);
    // Brass corner studs — half-spheres on each rim corner for jewelry feel
    const studGeo = new THREE.SphereGeometry(0.10, 10, 8);
    for (const cx of [-trayW / 2, trayW / 2]) {
      for (const cz of [-trayD / 2, trayD / 2]) {
        const stud = new THREE.Mesh(studGeo, rimAccent);
        stud.position.set(cx, yRim + 0.05, cz);
        this.group.add(stud);
      }
    }
    // Cream "$" plaque on the front skirt
    const plaque = new THREE.Mesh(
      new THREE.BoxGeometry(trayW * 0.55, 0.16, 0.04),
      new THREE.MeshLambertMaterial({ color: 0xfff7c4 })
    );
    plaque.position.set(0, 0.18, trayD / 2 + 0.22);
    this.group.add(plaque);
    const plaqueRim = new THREE.Mesh(
      new THREE.BoxGeometry(trayW * 0.6, 0.20, 0.02),
      rimAccent
    );
    plaqueRim.position.set(0, 0.18, trayD / 2 + 0.215);
    this.group.add(plaqueRim);
    // Embossed dollar sign — three small gold cylinders forming "$"
    const sShape = (offsetX) => {
      const dollar = new THREE.Group();
      const stem = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.13, 0.02),
        rimAccent
      );
      stem.position.set(offsetX, 0.18, trayD / 2 + 0.245);
      this.group.add(stem);
      const top = new THREE.Mesh(
        new THREE.TorusGeometry(0.045, 0.018, 6, 12, Math.PI),
        rimAccent
      );
      top.position.set(offsetX, 0.215, trayD / 2 + 0.245);
      top.rotation.x = -Math.PI / 2;
      this.group.add(top);
      const bot = new THREE.Mesh(
        new THREE.TorusGeometry(0.045, 0.018, 6, 12, Math.PI),
        rimAccent
      );
      bot.position.set(offsetX, 0.145, trayD / 2 + 0.245);
      bot.rotation.x = Math.PI / 2;
      bot.rotation.z = Math.PI;
      this.group.add(bot);
      void dollar;
    };
    sShape(0);

    // Pre-computed local positions per slot (cell * perStack)
    this.slots = new Array(this.total);
    for (let i = 0; i < this.stacksCount; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const x = (col - (this.cols - 1) / 2) * cellW;
      const z = (row - (this.rows - 1) / 2) * cellD;
      for (let k = 0; k < this.perStack; k++) {
        this.slots[i * this.perStack + k] = { x, y: 0.46 + k * 0.07, z };
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

    // Klondike-style flight pool — mix of fat gold coins and rectangular
    // green cash bills. Cash bills are clearly readable from a distance and
    // give the pickup the "money exploding from the till" vibe from the
    // reference screenshots.
    this._flyPool = [];
    this._flyActive = [];
    const coinFlyGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.07, 14);
    const coinFlyMat = new THREE.MeshLambertMaterial({ color: 0xffd04a });
    const billGeo = new THREE.BoxGeometry(0.34, 0.02, 0.20);
    const billMat = new THREE.MeshLambertMaterial({ color: 0x46c455 });
    const billStripeGeo = new THREE.BoxGeometry(0.10, 0.025, 0.08);
    const billStripeMat = new THREE.MeshLambertMaterial({ color: 0xfff7c4 });
    const POOL = 30;
    for (let i = 0; i < POOL; i++) {
      const isBill = i % 2 === 0;
      let m;
      if (isBill) {
        m = new THREE.Group();
        const card = new THREE.Mesh(billGeo, billMat);
        m.add(card);
        const stripe = new THREE.Mesh(billStripeGeo, billStripeMat);
        stripe.position.y = 0.015;
        m.add(stripe);
        m.userData.kind = 'bill';
      } else {
        m = new THREE.Mesh(coinFlyGeo, coinFlyMat);
        m.userData.kind = 'coin';
      }
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

    // Use up to the entire pool — bigger explosions for bigger payouts.
    const flights = Math.min(total, this._flyPool.length);
    for (let i = 0; i < flights; i++) {
      const m = this._flyPool.pop();
      if (!m) break;
      // Start each piece with a big upward burst from the tray center,
      // not from individual slots — looks like the till exploded open.
      const cx = this.origin.x + (Math.random() - 0.5) * 0.4;
      const cz = this.origin.z + (Math.random() - 0.5) * 0.4;
      const cy = 0.6 + Math.random() * 0.3;
      m.position.set(cx, cy, cz);
      // Random initial outward velocity for a fountain pop
      const ang = Math.random() * Math.PI * 2;
      const speed = 2.6 + Math.random() * 2.0;
      m.userData.vx = Math.cos(ang) * speed;
      m.userData.vy = 4.5 + Math.random() * 2.5;
      m.userData.vz = Math.sin(ang) * speed;
      m.userData.phase = 'fountain';
      m.userData.phaseT = 0;
      m.visible = true;
      this._flyActive.push({
        mesh: m,
        t: 0,
        ttl: 1.1 + Math.random() * 0.2,
        delay: i * 0.018,
        spin: (Math.random() - 0.5) * 14,
        spinX: (Math.random() - 0.5) * 10,
        player,
      });
    }
    if (floaters) {
      floaters.spawn(
        { x: this.origin.x, y: 2.4, z: this.origin.z },
        `+${total} ${RES_ICONS?.coin || '🪙'}`,
        { cls: 'gain', ttl: 1.4, vy: 2.6 }
      );
    }
    this._refresh();
  }

  _tickFlights(dt, player) {
    if (this._flyActive.length === 0) return;
    const G = -14;  // gravity for the fountain phase
    for (let i = this._flyActive.length - 1; i >= 0; i--) {
      const f = this._flyActive[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      const m = f.mesh;
      const ud = m.userData;
      ud.phaseT += dt;

      if (ud.phase === 'fountain') {
        // Fountain pop — physics integrate v + gravity for a beat.
        m.position.x += ud.vx * dt;
        m.position.y += ud.vy * dt;
        m.position.z += ud.vz * dt;
        ud.vy += G * dt;
        if (ud.phaseT > 0.32) {
          ud.phase = 'home';
          ud.phaseT = 0;
          ud.homeStart = m.position.clone();
          ud.homeDur = 0.55 + Math.random() * 0.18;
        }
      } else if (ud.phase === 'home') {
        // Sweep toward the player with a parabolic arc.
        const k = Math.min(1, ud.phaseT / ud.homeDur);
        const targ = player.group.position;
        const tx = targ.x, ty = 2.3, tz = targ.z;
        const sx = ud.homeStart.x, sy = ud.homeStart.y, sz = ud.homeStart.z;
        const ease = 1 - (1 - k) * (1 - k);  // ease-out
        const arc = Math.sin(k * Math.PI) * 1.1;
        m.position.x = sx + (tx - sx) * ease;
        m.position.y = sy + (ty - sy) * ease + arc;
        m.position.z = sz + (tz - sz) * ease;
        if (k >= 1) {
          m.visible = false;
          this._flyPool.push(m);
          this._flyActive.splice(i, 1);
          continue;
        }
      }
      m.rotation.y += f.spin * dt;
      m.rotation.x += f.spinX * dt;
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
