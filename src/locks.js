import * as THREE from 'three';
import { Inventory } from './state.js';
import { ZoneDecal } from './zone.js';

// A padlock marker placed over a future build plot. Renders as a dashed-outline
// ground decal with the padlock icon and coin cost baked into the texture —
// no 3D padlock mesh, no floating DOM card. Stepping onto the decal with the
// required coin amount unlocks the underlying site.
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

    this.decal = new ZoneDecal({
      width: 3.2,
      depth: 2.6,
      label: `🪙 ${cost}`,
      icon: '🔒',
      color: '#ffd24a',
      textColor: 'rgba(255,240,200,0.98)',
      textSize: 140,
      dashSpacing: [36, 26],
    });
    this.decal.setPosition(this.position.x, this.position.z);
    this.decal.addTo(scene);
  }

  update(dt, player) {
    if (this.unlocked) return;
    this.decal.update(dt);

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
    this.decal.removeFrom(this.scene);
    if (this.buildManager && this.siteKey && this.buildManager.sites[this.siteKey]) {
      this.buildManager.sites[this.siteKey].setLocked(false);
      this.buildManager._updateActive();
    }
    if (this.onUnlock) this.onUnlock();
  }
}
