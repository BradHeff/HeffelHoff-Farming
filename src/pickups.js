import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Backpack, PlayerCarry } from './state.js';

// Flies a resource mesh from world position into the right player anchor:
// raw harvest → back; crafted items → front. Lands, credits the right store.
export class PickupManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.active = [];
    this.mats = {
      grass: new THREE.MeshLambertMaterial({ color: 0x5bbf3d }),
      wood: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
      bale: new THREE.MeshLambertMaterial({ color: 0xe2c35a }),
      planks: new THREE.MeshLambertMaterial({ color: 0xb77842 }),
      tomato: new THREE.MeshLambertMaterial({ color: 0xe04a3c }),
      potato: new THREE.MeshLambertMaterial({ color: 0xc49a5a }),
      sauce: new THREE.MeshLambertMaterial({ color: 0xd02e2a }),
      chips: new THREE.MeshLambertMaterial({ color: 0xe6b548 }),
      egg:   new THREE.MeshLambertMaterial({ color: 0xf4e9c8 }),
    };
    this.geos = {
      grass: new THREE.IcosahedronGeometry(0.22, 0),
      wood: new THREE.BoxGeometry(0.32, 0.22, 0.22),
      bale: new THREE.CylinderGeometry(0.2, 0.2, 0.3, 10),
      planks: new THREE.BoxGeometry(0.42, 0.08, 0.18),
      tomato: new THREE.SphereGeometry(0.18, 10, 8),
      potato: new THREE.SphereGeometry(0.16, 8, 6),
      sauce: new THREE.CylinderGeometry(0.11, 0.13, 0.32, 10),
      chips: new THREE.BoxGeometry(0.28, 0.18, 0.22),
      egg: new THREE.SphereGeometry(0.14, 10, 8),
    };
    // Eggs are slightly squished spheres for egg-shape
    this.geos.egg.scale(1, 1.25, 1);
  }

  _isCarry(key) { return CONFIG.carryResources.includes(key); }

  spawn(type, worldPos) {
    const mesh = new THREE.Mesh(this.geos[type] || this.geos.grass, this.mats[type] || this.mats.grass);
    mesh.position.copy(worldPos);
    this.scene.add(mesh);
    const start = worldPos.clone();
    start.y += 0.5;
    this.active.push({
      mesh,
      start,
      t: 0,
      duration: CONFIG.pickups.travelMs / 1000,
      arcH: CONFIG.pickups.arcHeight,
      type,
      spin: (Math.random() - 0.5) * 8,
      isCarry: this._isCarry(type),
    });
    return true;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.t += dt / p.duration;
      const end = p.isCarry ? this.player.getCarryAnchor() : this.player.getBackpackAnchor();

      const t = Math.min(p.t, 1);
      const x = THREE.MathUtils.lerp(p.start.x, end.x, t);
      const z = THREE.MathUtils.lerp(p.start.z, end.z, t);
      const yBase = THREE.MathUtils.lerp(p.start.y, end.y, t);
      const arc = Math.sin(t * Math.PI) * p.arcH;
      p.mesh.position.set(x, yBase + arc, z);
      p.mesh.rotation.y += p.spin * dt;
      p.mesh.rotation.x += p.spin * 0.6 * dt;

      if (p.t >= 1) {
        if (p.isCarry) PlayerCarry.add(p.type, 1);
        else Backpack.add(p.type, 1);
        this.scene.remove(p.mesh);
        this.active.splice(i, 1);
      }
    }
  }
}
