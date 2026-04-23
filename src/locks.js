import * as THREE from 'three';
import { Inventory } from './state.js';

// A padlock marker placed over a future build plot. Once the player has
// enough coins and steps inside, the lock unlocks and the underlying plot
// (build site or upgrade tile) becomes visible/usable.
export class LockedPlot {
  constructor(scene, camera, position, cost, onUnlock, buildManager, siteKey) {
    this.scene = scene;
    this.camera = camera;
    this.position = new THREE.Vector3(position.x, 0, position.z);
    this.radius = 2.0;
    this.cost = cost;
    this.unlocked = false;
    this.onUnlock = onUnlock;
    this.buildManager = buildManager;
    this.siteKey = siteKey;

    // Lock the underlying site if provided — prevents it from being active.
    if (buildManager && siteKey && buildManager.sites[siteKey]) {
      buildManager.sites[siteKey].setLocked(true);
      buildManager._updateActive();
    }

    const g = new THREE.Group();
    g.position.copy(this.position);
    // Dirt pad
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.06, 18),
      new THREE.MeshLambertMaterial({ color: 0x4a3a28, transparent: true, opacity: 0.85 })
    );
    pad.position.y = 0.03;
    g.add(pad);

    // Stylised padlock
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.9, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x9a9aa4 })
    );
    body.position.y = 1.0;
    g.add(body);
    const shackle = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.08, 8, 16, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x5a5a64 })
    );
    shackle.position.set(0, 1.6, 0);
    shackle.rotation.x = Math.PI / 2;
    g.add(shackle);
    // Keyhole
    const keyhole = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 12),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
    );
    keyhole.position.set(0, 1.0, 0.21);
    g.add(keyhole);

    scene.add(g);
    this.group = g;

    // Floating cost card
    const el = document.createElement('div');
    el.className = 'lock-card';
    el.innerHTML = `<span class="lock-icon">🔒</span><span class="lock-cost">🪙 ${cost}</span>`;
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();
  }

  update(dt, player) {
    if (this.unlocked) return;
    // Bob the lock
    this.group.position.y = Math.sin(performance.now() * 0.003) * 0.1;

    this._projVec.set(this.position.x, 2.4, this.position.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';

    // Unlock on approach + funds
    const dx = player.group.position.x - this.position.x;
    const dz = player.group.position.z - this.position.z;
    if (Math.hypot(dx, dz) < this.radius && Inventory.coin >= this.cost) {
      Inventory.coin -= this.cost;
      Inventory.emit();
      this._unlock();
    }
  }

  _unlock() {
    this.unlocked = true;
    this.scene.remove(this.group);
    this.card.remove();
    if (this.buildManager && this.siteKey && this.buildManager.sites[this.siteKey]) {
      this.buildManager.sites[this.siteKey].setLocked(false);
      this.buildManager._updateActive();
    }
    if (this.onUnlock) this.onUnlock();
  }
}
