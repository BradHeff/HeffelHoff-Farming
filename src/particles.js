import * as THREE from 'three';

// ParticleBurst — pooled confetti/sparkle spawner. Shouts "reward!" on sales,
// builds, upgrades, unlocks. All particles share a single faceted icosahedron
// geometry; each mesh owns a cloned material so per-particle colour + fade
// work without a custom shader.
//
// The pool is pre-allocated at construction so no GPU buffers are created
// while the game is running — this matters a lot on mobile where each new
// material allocation is a potential frame stall.
const DEFAULT_PALETTE = [
  0xffd24a, 0xff6b3a, 0x4ad5ff, 0xff4a9c, 0x6fff6b, 0xffdb47, 0xffffff,
];

export class ParticleBurst {
  constructor(scene, { max = 96 } = {}) {
    this.scene = scene;
    this.MAX = max;
    this.pool = [];
    this.active = [];
    this._geo = new THREE.IcosahedronGeometry(0.12, 0);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        emissive: 0x222222,
      });
      const m = new THREE.Mesh(this._geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }

  burst(pos, {
    count = 18,
    colors = DEFAULT_PALETTE,
    power = 5.5,
    ttl = 1.2,
    scale = 1.0,
    spread = 1.0,
  } = {}) {
    for (let i = 0; i < count; i++) {
      const m = this.pool.pop();
      if (!m) return; // pool exhausted — skip rest quietly
      m.visible = true;
      m.position.set(pos.x, pos.y || 1.0, pos.z);
      m.material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
      m.material.opacity = 1;
      const baseScale = (0.5 + Math.random() * 0.7) * scale;
      m.scale.setScalar(baseScale);
      const a = Math.random() * Math.PI * 2;
      const upward = 0.55 + Math.random() * 0.55;
      const radial = 0.5 + Math.random() * 0.6;
      this.active.push({
        mesh: m,
        vx: Math.cos(a) * power * radial * spread,
        vy: upward * power * 1.25,
        vz: Math.sin(a) * power * radial * spread,
        spin: (Math.random() - 0.5) * 12,
        t: 0,
        ttl,
        baseScale,
      });
    }
  }

  // Coin-sized golden sparkle — narrower cone, shorter TTL, all gold/white.
  sparkle(pos, { count = 10 } = {}) {
    this.burst(pos, {
      count,
      colors: [0xffe166, 0xfff6a8, 0xffffff, 0xffd24a],
      power: 3.2,
      ttl: 0.7,
      scale: 0.8,
      spread: 0.6,
    });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.t += dt;
      if (p.t >= p.ttl) {
        p.mesh.visible = false;
        this.pool.push(p.mesh);
        this.active.splice(i, 1);
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 12 * dt; // gravity
      p.mesh.rotation.x += p.spin * dt * 0.8;
      p.mesh.rotation.y += p.spin * dt;
      p.mesh.rotation.z += p.spin * dt * 0.6;
      const k = p.t / p.ttl;
      p.mesh.material.opacity = 1 - k * k;
      p.mesh.scale.setScalar(p.baseScale * (1 - k * 0.4));
    }
  }
}
