import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Inventory } from './state.js';
import { toast, showLevelBanner, RES_ICONS } from './hud.js';
import { ZoneDecal } from './zone.js';

// A wandering trader truck that drives onto the map periodically, parks on
// the road south of the market, and demands a stockpile of goods in exchange
// for a coin reward. Creates the "overflow sink" beat the reference uses.
function buildTruckMesh() {
  const g = new THREE.Group();
  const blue = new THREE.MeshLambertMaterial({ color: 0x3a7dd6 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a4080 });
  const bedMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  const tire = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
  const hub = new THREE.MeshLambertMaterial({ color: 0xd8d8dc });
  const winMat = new THREE.MeshLambertMaterial({ color: 0xa0d8ff, transparent: true, opacity: 0.8 });

  // Chassis + cab
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 2.8), dark);
  chassis.position.y = 0.35;
  g.add(chassis);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.0), blue);
  cab.position.set(0, 0.95, 0.9);
  g.add(cab);
  const cabWindow = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.05), winMat);
  cabWindow.position.set(0, 1.0, 1.4);
  g.add(cabWindow);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.1), dark);
  cabRoof.position.set(0, 1.42, 0.9);
  g.add(cabRoof);
  // Cargo bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.7), bedMat);
  bed.position.set(0, 0.85, -0.6);
  g.add(bed);
  // Bed side posts
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1c });
  for (const [x, z] of [[-0.6, -1.4], [0.6, -1.4], [-0.6, 0.2], [0.6, 0.2]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), postMat);
    p.position.set(x, 1.0, z);
    g.add(p);
  }
  // Wheels
  const wGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14);
  wGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[-0.6, 0.9], [0.6, 0.9], [-0.6, -0.9], [0.6, -0.9]]) {
    const w = new THREE.Mesh(wGeo, tire);
    w.position.set(x, 0.32, z);
    g.add(w);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 10), hub);
    h.rotation.z = Math.PI / 2;
    h.position.copy(w.position);
    g.add(h);
    wheels.push(w);
  }
  g.userData.wheels = wheels;

  // Crates on bed (visual, shrink as delivery progresses)
  const cratesGroup = new THREE.Group();
  cratesGroup.position.set(0, 1.25, -0.6);
  g.add(cratesGroup);
  g.userData.crates = cratesGroup;
  return g;
}

export class TraderEvent {
  constructor(scene, camera, buildManager, flight, particles = null) {
    this.scene = scene;
    this.camera = camera;
    this.buildManager = buildManager;
    this.flight = flight;
    this.particles = particles;
    this.cfg = CONFIG.trader;
    this.state = 'waiting';       // waiting → driving_in → parked → driving_out
    this.timer = this.cfg.spawnDelaySec; // first event after N seconds
    this.truck = null;
    this.order = null;
    this.delivered = {};
    this._buildCard();
    this._buildDropDecal();
  }

  _buildCard() {
    const el = document.createElement('div');
    el.className = 'trader-card';
    el.style.display = 'none';
    document.getElementById('world-overlay').appendChild(el);
    this.card = el;
    this._projVec = new THREE.Vector3();
  }

  _buildDropDecal() {
    this.decal = new ZoneDecal({
      width: 2.6, depth: 2.0,
      label: 'TRADE', icon: '📦',
      color: '#ffcc66', textColor: 'rgba(255,236,180,0.98)',
      textSize: 110, rounded: true, cornerRadius: 0.28,
    });
    this.decal.setPosition(this.cfg.parkPos.x, this.cfg.parkPos.z + 1.2);
    this.decal.addTo(this.scene);
    this.decal.mesh.visible = false;
  }

  _canSpawn() {
    // Only arrive once the market exists (need sellable goods to trade)
    return this.buildManager.sites.market?.completed;
  }

  _pickOrder() {
    const pool = this.cfg.orders.filter((o) => {
      // Only offer orders where the key is a currently-unlocked product
      const sites = this.buildManager.sites;
      if (o.key === 'bale')   return sites.hayBaler?.completed;
      if (o.key === 'planks') return sites.sawMill?.completed;
      if (o.key === 'sauce')  return sites.sauceFactory?.completed;
      if (o.key === 'chips')  return sites.chipsFactory?.completed;
      if (o.key === 'egg')    return sites.eggFarm?.completed;
      if (o.key === 'milk')   return sites.dairyFarm?.completed;
      return true;
    });
    if (pool.length === 0) return null;
    return { ...pool[Math.floor(Math.random() * pool.length)] };
  }

  _spawnTruck() {
    const order = this._pickOrder();
    if (!order) return false;
    this.order = order;
    this.delivered = {};
    this.truck = buildTruckMesh();
    // Drive in from the east off-screen
    this.truck.position.set(this.cfg.entryPos.x, 0, this.cfg.entryPos.z);
    this.truck.rotation.y = -Math.PI / 2;
    this.scene.add(this.truck);
    toast(`📦 Trader: ${order.count}× ${RES_ICONS[order.key] || ''}`);
    return true;
  }

  _despawnTruck() {
    if (this.truck) {
      this.scene.remove(this.truck);
      this.truck = null;
    }
    this.decal.mesh.visible = false;
    this.card.style.display = 'none';
  }

  _driveTo(targetX, targetZ, speed, dt) {
    const t = this.truck;
    const dx = targetX - t.position.x;
    const dz = targetZ - t.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;
    const step = Math.min(dist, speed * dt);
    t.position.x += (dx / dist) * step;
    t.position.z += (dz / dist) * step;
    t.rotation.y = Math.atan2(dx / dist, dz / dist);
    for (const w of t.userData.wheels || []) w.rotation.x += step * 3;
    return false;
  }

  update(dt, player) {
    if (this.state === 'waiting') {
      this.timer -= dt;
      if (this.timer <= 0 && this._canSpawn()) {
        if (this._spawnTruck()) {
          this.state = 'driving_in';
        } else {
          this.timer = 30; // retry soon
        }
      }
      return;
    }
    if (!this.truck) return;

    if (this.state === 'driving_in') {
      if (this._driveTo(this.cfg.parkPos.x, this.cfg.parkPos.z, 5.5, dt)) {
        this.state = 'parked';
        this.decal.mesh.visible = true;
        // Restart the wait timer with the parkSec budget — was previously
        // continuing the spawn-countdown which had already expired, so the
        // trader timed out the same frame it parked and drove away.
        this.timer = this.cfg.parkSec;
      }
    } else if (this.state === 'parked') {
      this.decal.update(dt);
      // Player drop-off
      const dx = player.group.position.x - this.cfg.parkPos.x;
      const dz = player.group.position.z - (this.cfg.parkPos.z + 1.2);
      const dist = Math.hypot(dx, dz);
      if (dist < 1.4) this._acceptDelivery();

      this._refreshCard(player);

      // Time out if the player ignores it
      this.timer -= dt;
      if (this.timer <= 0) {
        toast('🚚 Trader left unsatisfied');
        this.state = 'driving_out';
      }
    } else if (this.state === 'driving_out') {
      const done = this._driveTo(this.cfg.exitPos.x, this.cfg.exitPos.z, 6.5, dt);
      if (done) {
        this._despawnTruck();
        this.state = 'waiting';
        this.timer = this.cfg.intervalSec;
      }
    }
  }

  _acceptDelivery() {
    if (!this.order) return;
    const { key, count } = this.order;
    const need = count - (this.delivered[key] || 0);
    if (need <= 0) return;
    const have = Inventory[key] || 0;
    if (have <= 0) return;
    // Take whatever fits, drain 1 per frame for a visible rhythmic deposit
    this._drainAcc = (this._drainAcc || 0) + 0.034;
    while (this._drainAcc >= 0.12 && (Inventory[key] || 0) > 0 &&
           (this.delivered[key] || 0) < count) {
      this._drainAcc -= 0.12;
      Inventory[key] -= 1;
      Inventory.emit();
      this.delivered[key] = (this.delivered[key] || 0) + 1;
      if ((this.delivered[key] || 0) >= count) break;
    }
    if ((this.delivered[key] || 0) >= count) this._completeOrder();
  }

  _completeOrder() {
    const reward = this.order.reward;
    Inventory.add('coin', reward);
    if (this.onComplete) this.onComplete(this.order);
    if (this.particles) {
      this.particles.burst(
        { x: this.cfg.parkPos.x, y: 1.5, z: this.cfg.parkPos.z },
        { count: 28, power: 6, ttl: 1.2, scale: 1.0 },
      );
    }
    showLevelBanner({
      tier: 'ORDER!',
      name: `+${reward} 🪙`,
      icon: '📦',
    });
    this.order = null;
    this.delivered = {};
    this.state = 'driving_out';
    this.timer = this.cfg.intervalSec;
  }

  _refreshCard(player) {
    if (!this.order) {
      this.card.style.display = 'none';
      return;
    }
    const key = this.order.key;
    const delivered = this.delivered[key] || 0;
    const need = this.order.count;
    const pct = Math.min(1, delivered / need);
    const sig = `${key}|${delivered}|${need}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this.card.innerHTML = `
        <div class="trader-title">📦 Trader Order</div>
        <div class="trader-row">
          <span class="trader-icon">${RES_ICONS[key] || ''}</span>
          <span class="trader-count">${delivered}/${need}</span>
        </div>
        <div class="trader-bar"><div class="trader-fill" style="width: ${pct * 100}%"></div></div>
        <div class="trader-reward">🪙 ${this.order.reward}</div>
      `;
    }
    this._projVec.set(this.cfg.parkPos.x, 2.4, this.cfg.parkPos.z);
    const v = this._projVec.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.card.style.display = 'block';
    this.card.style.transform = `translate(calc(-50% + ${sx}px), calc(-100% + ${sy}px))`;
    this.card.style.opacity = (v.z > 0 && v.z < 1) ? '1' : '0';
    void player;
  }
}
