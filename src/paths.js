import * as THREE from 'three';
import { CONFIG } from './config.js';

// Paints dirt paths between the key locations so the map reads like a
// navigable farm. Each segment is a tan plane lightly raised above the
// ground with a softer edge plane behind it for a painted-look trail.
export function buildPaths(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.path,
    transparent: true,
    opacity: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  const edgeMat = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.pathEdge,
    transparent: true,
    opacity: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthWrite: false,
  });

  const segment = (x1, z1, x2, z2, width = 2.0) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;

    const geo = new THREE.PlaneGeometry(width, len);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1 + x2) / 2, 0.04, (z1 + z2) / 2);
    mesh.rotation.y = Math.atan2(dx, dz);
    mesh.renderOrder = 1;
    group.add(mesh);

    const edgeGeo = new THREE.PlaneGeometry(width + 0.7, len + 0.4);
    edgeGeo.rotateX(-Math.PI / 2);
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2);
    edge.rotation.y = Math.atan2(dx, dz);
    group.add(edge);
  };

  const pad = (x, z, r) => {
    const g = new THREE.CircleGeometry(r, 24);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, 0.045, z);
    m.renderOrder = 1;
    group.add(m);
  };

  const plots = CONFIG.world.buildPlots;
  const spawn = CONFIG.world.spawnPos;
  const ex = CONFIG.expansion;

  // Main north-south spine: customer road (south of market) → market → spawn
  // → building row → farms → expansion tile → egg farm.
  segment(plots.market.x, plots.market.z + 3, plots.market.x, plots.market.z, 3.2);     // customer road approach
  segment(plots.market.x, plots.market.z, spawn.x, spawn.z, 2.6);                         // market → spawn
  segment(spawn.x, spawn.z, plots.hayBaler.x, plots.hayBaler.z, 2.4);                     // spawn → baler
  segment(plots.hayBaler.x, plots.hayBaler.z, 0, -4, 2.0);                                // baler → farm line
  segment(0, -4, 0, ex.tilePos.z, 1.8);                                                    // farm line → expansion tile
  segment(ex.tilePos.x, ex.tilePos.z, plots.eggFarm.x, plots.eggFarm.z, 1.8);             // expansion → egg farm

  // East-west branches at the building row
  segment(plots.hayBaler.x, plots.hayBaler.z, plots.sawMill.x, plots.sawMill.z, 1.8);
  segment(plots.hayBaler.x, plots.hayBaler.z, plots.dairyFarm.x, plots.dairyFarm.z, 1.8);
  segment(plots.sawMill.x, plots.sawMill.z, plots.sauceFactory.x, plots.sauceFactory.z, 1.6);
  segment(plots.dairyFarm.x, plots.dairyFarm.z, plots.chipsFactory.x, plots.chipsFactory.z, 1.6);

  // East-west branch at the farm line — one link to each farm
  for (const farm of CONFIG.farms) {
    segment(0, -4, farm.center.x, farm.center.z, 1.6);
  }

  // Plaza pads at each building + spawn + market so junctions don't look
  // like disjointed crossings.
  pad(spawn.x, spawn.z, 2.0);
  pad(plots.market.x, plots.market.z, 3.0);
  pad(plots.hayBaler.x, plots.hayBaler.z, 2.4);
  pad(plots.sawMill.x, plots.sawMill.z, 2.4);
  pad(plots.dairyFarm.x, plots.dairyFarm.z, 2.4);
  pad(plots.sauceFactory.x, plots.sauceFactory.z, 2.2);
  pad(plots.chipsFactory.x, plots.chipsFactory.z, 2.2);
  pad(0, -4, 1.6);
  pad(ex.tilePos.x, ex.tilePos.z, 2.2);
  pad(plots.eggFarm.x, plots.eggFarm.z, 2.2);

  return group;
}
