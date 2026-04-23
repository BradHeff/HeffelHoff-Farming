import * as THREE from 'three';

// World-space DOM "floaters" — short-lived labels like "+1 🌿" or "FULL" that
// get projected to screen coordinates each frame and fade out. Cheap to
// implement and resolution-independent on mobile.
export class FloaterManager {
  constructor(camera) {
    this.camera = camera;
    this.container = document.getElementById('world-overlay');
    this.items = []; // {el, worldPos, vy, ttl, age}
    this._projVec = new THREE.Vector3();
  }

  /**
   * Spawn a floating label at a world position.
   * @param {THREE.Vector3|{x,y,z}} worldPos
   * @param {string} text
   * @param {object} [opts] {color, ttl, vy, cls}
   */
  spawn(worldPos, text, opts = {}) {
    const el = document.createElement('div');
    el.className = `floater ${opts.cls || ''}`;
    el.textContent = text;
    if (opts.color) el.style.color = opts.color;
    this.container.appendChild(el);
    this.items.push({
      el,
      worldPos: new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z),
      vy: opts.vy ?? 1.6,
      ttl: opts.ttl ?? 0.9,
      age: 0,
    });
  }

  update(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.worldPos.y += it.vy * dt;
      const life = it.age / it.ttl;
      if (life >= 1) {
        it.el.remove();
        this.items.splice(i, 1);
        continue;
      }
      this._projVec.copy(it.worldPos).project(this.camera);
      const sx = (this._projVec.x * 0.5 + 0.5) * w;
      const sy = (-this._projVec.y * 0.5 + 0.5) * h;
      const behind = this._projVec.z > 1;
      it.el.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
      it.el.style.opacity = behind ? 0 : String(1 - life * life);
    }
  }
}

// Persistent "FULL" label that tracks a target (e.g., backpack), shown/hidden
// externally. Kept separate from spawn-then-fade floaters.
export class StickyLabel {
  constructor(camera, text, cls = 'sticky-label') {
    this.camera = camera;
    this.el = document.createElement('div');
    this.el.className = `floater ${cls}`;
    this.el.textContent = text;
    this.el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(this.el);
    this.target = new THREE.Vector3();
    this.visible = false;
    this._projVec = new THREE.Vector3();
  }

  show(v) {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  setTarget(vec3) { this.target.copy(vec3); }

  update() {
    if (!this.visible) return;
    this._projVec.copy(this.target).project(this.camera);
    const sx = (this._projVec.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-this._projVec.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
  }
}
