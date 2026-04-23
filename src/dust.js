import * as THREE from 'three';

// Pool of ground-hugging disc meshes spawned behind the player's feet while
// walking. Each instance has its own material so per-mesh opacity can be
// tweened without allocating anything per-spawn.
export class DustPuffManager {
  constructor(scene, poolSize = 12) {
    this.scene = scene;
    this.pool = [];
    const geo = new THREE.CircleGeometry(0.22, 10);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xddc090,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, mat, active: false, t: 0, ttl: 0.6 });
    }
  }

  spawn(x, z) {
    const p = this.pool.find((p) => !p.active);
    if (!p) return; // pool exhausted — ignore, avoids overhead
    p.active = true;
    p.t = 0;
    p.mesh.position.set(x, 0.07, z);
    p.mesh.scale.setScalar(1);
    p.mesh.visible = true;
    p.mat.opacity = 0.55;
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      const life = p.t / p.ttl;
      p.mesh.scale.setScalar(1 + life * 1.6);
      p.mat.opacity = 0.55 * (1 - life);
      if (p.t >= p.ttl) {
        p.mesh.visible = false;
        p.active = false;
      }
    }
  }
}
