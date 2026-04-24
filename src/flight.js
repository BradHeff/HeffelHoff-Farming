import * as THREE from 'three';

// Lightweight world→world animation: flies a mesh from start to a target
// (either a fixed point or a callback that returns a moving target) along a
// parabolic arc, firing an onLand callback when it arrives.
export class FlightManager {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
  }

  spawn({ geometry, material, startPos, endPos, endFn, durationMs = 520, arcH = 1.6, spin = true, onLand = null, scale = 1, delayMs = 0 }) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(startPos);
    mesh.scale.setScalar(scale);
    mesh.visible = delayMs <= 0;
    this.scene.add(mesh);
    this.active.push({
      mesh,
      start: startPos.clone(),
      endPos: endPos ? endPos.clone() : null,
      endFn,
      t: 0,
      duration: durationMs / 1000,
      arcH,
      spin: spin ? (Math.random() - 0.5) * 10 : 0,
      onLand,
      delay: delayMs / 1000,
    });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      if (!p.mesh.visible) p.mesh.visible = true;
      p.t += dt / p.duration;
      const end = p.endFn ? p.endFn() : p.endPos;
      const t = Math.min(p.t, 1);
      const x = THREE.MathUtils.lerp(p.start.x, end.x, t);
      const z = THREE.MathUtils.lerp(p.start.z, end.z, t);
      const yBase = THREE.MathUtils.lerp(p.start.y, end.y, t);
      const arc = Math.sin(t * Math.PI) * p.arcH;
      p.mesh.position.set(x, yBase + arc, z);
      if (p.spin) {
        p.mesh.rotation.y += p.spin * dt;
        p.mesh.rotation.x += p.spin * 0.5 * dt;
      }
      if (p.t >= 1) {
        if (p.onLand) p.onLand();
        this.scene.remove(p.mesh);
        this.active.splice(i, 1);
      }
    }
  }
}
