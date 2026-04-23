import * as THREE from 'three';
import { CONFIG } from './config.js';

// Paints dirt paths between the key locations so the map reads like a
// navigable farm. Each segment is a thin rotated plane just above the ground.
export function buildPaths(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.path,
    transparent: true,
    opacity: 0.92,
  });
  const edgeMat = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.pathEdge,
    transparent: true,
    opacity: 0.75,
  });

  const segment = (x1, z1, x2, z2, width = 2.0) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;

    // Core path
    const geo = new THREE.PlaneGeometry(width, len);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1 + x2) / 2, 0.04, (z1 + z2) / 2);
    mesh.rotation.y = Math.atan2(dx, dz);
    group.add(mesh);

    // Softer edge (slightly wider, behind)
    const edgeGeo = new THREE.PlaneGeometry(width + 0.7, len + 0.4);
    edgeGeo.rotateX(-Math.PI / 2);
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set((x1 + x2) / 2, 0.035, (z1 + z2) / 2);
    edge.rotation.y = Math.atan2(dx, dz);
    group.add(edge);
  };

  const plots = CONFIG.world.buildPlots;
  const spawn = CONFIG.world.spawnPos;
  const farm = CONFIG.farm.center;

  // Spawn <-> Market (south)
  segment(spawn.x, spawn.z, plots.market.x, plots.market.z, 2.4);
  // Spawn <-> Hay Baler (north center)
  segment(spawn.x, spawn.z, plots.hayBaler.x, plots.hayBaler.z, 2.0);
  // Hay Baler <-> Saw Mill
  segment(plots.hayBaler.x, plots.hayBaler.z, plots.sawMill.x, plots.sawMill.z, 1.8);
  // Hay Baler <-> Fence (even while locked so layout is visible)
  segment(plots.hayBaler.x, plots.hayBaler.z, plots.fence.x, plots.fence.z, 1.8);
  // Spawn <-> Farm (west)
  segment(spawn.x, spawn.z, farm.x + 3, farm.z + 1, 1.8);
  // Farm <-> Hay Baler
  segment(farm.x + 3, farm.z + 1, plots.hayBaler.x, plots.hayBaler.z, 1.6);

  // Small widened plaza rings at key nodes for polish
  const pad = (x, z, r) => {
    const g = new THREE.CircleGeometry(r, 20);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, 0.05, z);
    group.add(m);
  };
  pad(spawn.x, spawn.z, 2.0);
  pad(plots.hayBaler.x, plots.hayBaler.z, 2.8);
  pad(plots.sawMill.x, plots.sawMill.z, 2.8);
  pad(plots.market.x, plots.market.z, 3.4);

  return group;
}
