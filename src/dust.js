import * as THREE from 'three';

// Pool of ground-hugging disc meshes spawned behind the player's feet while
// walking. Each instance has its own material so per-mesh opacity can be
// tweened without allocating anything per-spawn.
export class DustPuffManager {
  constructor(scene, poolSize = 18) {
    this.scene = scene;
    this.pool = [];
    const geo = new THREE.CircleGeometry(0.38, 12);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
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
      this.pool.push({
        mesh, mat, active: false, t: 0, ttl: 0.6,
        peakScale: 2.6, peakOpacity: 0.75,
      });
    }
  }

  // `kind`: 'walk' (default, small amber puff) or 'slash' (big white puff
  // that blooms twice the size and lingers slightly longer).
  spawn(x, z, kind = 'walk') {
    const p = this.pool.find((p) => !p.active);
    if (!p) return;
    p.active = true;
    p.t = 0;
    p.mesh.position.set(x, 0.07, z);
    p.mesh.scale.setScalar(0.9);
    p.mesh.visible = true;
    if (kind === 'slash') {
      p.mat.color.setHex(0xffffff);
      p.mat.opacity = 0.9;
      p.peakScale = 3.2;
      p.peakOpacity = 0.9;
      p.ttl = 0.55;
    } else {
      p.mat.color.setHex(0xddc090);
      p.mat.opacity = 0.55;
      p.peakScale = 2.0;
      p.peakOpacity = 0.55;
      p.ttl = 0.6;
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      const life = p.t / p.ttl;
      p.mesh.scale.setScalar(0.9 + life * p.peakScale);
      p.mat.opacity = p.peakOpacity * (1 - life);
      if (p.t >= p.ttl) {
        p.mesh.visible = false;
        p.active = false;
      }
    }
  }
}
