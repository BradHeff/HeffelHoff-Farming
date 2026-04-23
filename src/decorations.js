import * as THREE from 'three';

// Static props sprinkled across the map to give it life: scarecrows, water
// troughs, broken carts, hay bales, log piles, stones, fence segments.
// All meshes are Lambert-shaded low-poly blobs matching the core style.
export function populateDecorations(scene, rand) {
  const decorations = new THREE.Group();
  scene.add(decorations);

  const placeAtRandom = (regions, makerFn, count) => {
    for (let i = 0; i < count; i++) {
      const region = regions[Math.floor(rand() * regions.length)];
      const x = region.x0 + rand() * (region.x1 - region.x0);
      const z = region.z0 + rand() * (region.z1 - region.z0);
      const obj = makerFn();
      obj.position.set(x, 0, z);
      obj.rotation.y = rand() * Math.PI * 2;
      decorations.add(obj);
    }
  };

  // Safe decorating regions (avoid spawn area, build plots, farm, market)
  const regions = [
    { x0: -36, x1: -8,  z0: -3,  z1: 8 },   // west of spawn (meadow edge)
    { x0: 8,   x1: 36,  z0: -3,  z1: 8 },   // east of spawn
    { x0: -36, x1: -8,  z0: 8,   z1: 28 },  // south-west
    { x0: 8,   x1: 36,  z0: 8,   z1: 28 },  // south-east
  ];

  // -- Prop makers ---------------------------------------------------------
  const scarecrow = () => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.0, 8),
      new THREE.MeshLambertMaterial({ color: 0x6b4423 })
    );
    pole.position.y = 1.0;
    const cross = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.08, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x6b4423 })
    );
    cross.position.y = 1.5;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xe6be5a })
    );
    head.position.y = 2.05;
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.3, 10),
      new THREE.MeshLambertMaterial({ color: 0x2a3a5a })
    );
    hat.position.y = 2.32;
    const shirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.6, 0.2),
      new THREE.MeshLambertMaterial({ color: 0xa84040 })
    );
    shirt.position.y = 1.2;
    g.add(pole, cross, head, hat, shirt);
    return g;
  };

  const haypile = () => {
    const g = new THREE.Group();
    const baleGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.85, 12);
    const baleMat = new THREE.MeshLambertMaterial({ color: 0xe2c35a });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(baleGeo, baleMat);
      b.rotation.z = Math.PI / 2;
      b.position.set((i % 2) * 0.6 - 0.3, 0.5 + Math.floor(i / 2) * 0.55, 0);
      g.add(b);
    }
    return g;
  };

  const waterTrough = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.5, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x6b4423 })
    );
    body.position.y = 0.25;
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.08, 0.7),
      new THREE.MeshLambertMaterial({ color: 0x4a90c4 })
    );
    water.position.y = 0.46;
    g.add(body, water);
    return g;
  };

  const brokenCart = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 1.0),
      new THREE.MeshLambertMaterial({ color: 0x8a5a2b })
    );
    body.position.y = 0.5;
    body.rotation.z = 0.2;
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.08, 8, 14),
      new THREE.MeshLambertMaterial({ color: 0x4a2f1a })
    );
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0.6, 0.35, 0.55);
    // Broken wheel lying on ground
    const bwheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.08, 8, 14),
      new THREE.MeshLambertMaterial({ color: 0x4a2f1a })
    );
    bwheel.rotation.x = Math.PI / 2;
    bwheel.position.set(-0.2, 0.08, 0.95);
    g.add(body, wheel, bwheel);
    return g;
  };

  const stone = () => {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xa0a0a8 });
    const s1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), mat);
    s1.position.y = 0.2;
    const s2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat);
    s2.position.set(0.32, 0.12, 0.2);
    g.add(s1, s2);
    return g;
  };

  const logPile = () => {
    const g = new THREE.Group();
    const logGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.3, 10);
    const logMat = new THREE.MeshLambertMaterial({ color: 0x7a5232 });
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      log.rotation.z = Math.PI / 2;
      log.position.set((i % 2) * 0.4 - 0.2, 0.2 + Math.floor(i / 2) * 0.38, 0);
      g.add(log);
    }
    return g;
  };

  const fenceSegment = () => {
    // 3 posts connected by two rails — random broken versions
    const g = new THREE.Group();
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const railMat = new THREE.MeshLambertMaterial({ color: 0xa97240 });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 0.15), postMat);
      p.position.set(-1 + i, 0.45, 0);
      if (rand() < 0.25) p.rotation.z = (rand() - 0.5) * 0.6; // broken/tilted
      g.add(p);
    }
    for (let row = 0; row < 2; row++) {
      if (rand() < 0.25) continue; // missing rail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.08), railMat);
      rail.position.set(0, 0.35 + row * 0.35, 0);
      g.add(rail);
    }
    return g;
  };

  const pumpkin = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xd67a2a })
    );
    body.scale.set(1.1, 0.85, 1.1);
    body.position.y = 0.3;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.15, 5),
      new THREE.MeshLambertMaterial({ color: 0x3a5a2a })
    );
    stem.position.y = 0.58;
    g.add(body, stem);
    return g;
  };

  const flower = () => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5),
      new THREE.MeshLambertMaterial({ color: 0x3a6a3a })
    );
    stem.position.y = 0.23;
    const petalColors = [0xf07b7b, 0xf0d34e, 0xf0a4e8, 0xa4d4f0];
    const petalMat = new THREE.MeshLambertMaterial({ color: petalColors[Math.floor(rand() * petalColors.length)] });
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), petalMat);
    petal.position.y = 0.5;
    g.add(stem, petal);
    return g;
  };

  // Reduced counts — decorations were ~250 draw calls (each group has
  // multiple meshes). Keep enough for atmosphere but trim aggressively.
  placeAtRandom(regions, scarecrow, 3);
  placeAtRandom(regions, haypile, 3);
  placeAtRandom(regions, waterTrough, 2);
  placeAtRandom(regions, brokenCart, 1);
  placeAtRandom(regions, stone, 8);
  placeAtRandom(regions, logPile, 2);
  placeAtRandom(regions, fenceSegment, 3);
  placeAtRandom(regions, pumpkin, 5);
  placeAtRandom(regions, flower, 18);

  return decorations;
}
