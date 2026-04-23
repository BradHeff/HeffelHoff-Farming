// Central tuning knobs. Adjust freely while iterating.

export const CONFIG = {
  world: {
    size: 80,
    // Biome zones (axis-aligned rectangles on XZ plane).
    // Biomes north of the spawn; market/build plots sit south
    meadow: { minX: -36, maxX: -4, minZ: -34, maxZ: -8 },
    forest: { minX: 4, maxX: 36, minZ: -34, maxZ: -8 },
    grassCount: 1200,
    treeCount: 160,
    // Player spawns south-center; market sits behind them to the south.
    // Build area (hay baler, saw mill, fence) is north of spawn. Meadow and
    // forest fill the north half of the map.
    spawnPos: { x: 0, z: 20 },
    buildPlots: {
      market:   { x: 0, z: 32 },    // south of spawn (behind player)
      hayBaler: { x: 0, z: 4 },     // north of spawn, center
      sawMill:  { x: -14, z: 4 },
      fence:    { x: 14, z: 4 },
    },
  },
  player: {
    radius: 0.45,
    moveSpeed: 6.4,
    slashRadius: 2.0,       // wider reach for carpet harvesting
    slashArcDeg: 200,       // wide frontal sweep
    slashCooldownMs: 240,   // snappy, continuous
    backpackCapacity: 999,  // effectively uncapped; legacy field kept for PlayerStats init
    pickupRadius: 1.8,
  },
  camera: {
    height: 15,
    backDistance: 11,
    lookAheadZ: 0,
    fov: 55,
  },
  pickups: {
    travelMs: 480,
    arcHeight: 2.2,
  },
  // Build recipes: material requirements + reward when complete.
  // Priority order picks the next active build site.
  builds: {
    hayBaler: {
      id: 'hayBaler',
      name: 'Hay Baler',
      icon: '🌾',
      require: { grass: 15, wood: 6 },
      reward: { coin: 25 },
      blurb: 'Bales hay into sellable bundles',
    },
    market: {
      id: 'market',
      name: 'Farmers Market',
      icon: '🏪',
      require: { bale: 4, wood: 4 },
      reward: { coin: 60 },
      blurb: 'Sells bundles for coins',
    },
    sawMill: {
      id: 'sawMill',
      name: 'Saw Mill',
      icon: '🪚',
      require: { wood: 12, grass: 8 },
      reward: { coin: 40 },
      blurb: 'Cuts planks for building',
    },
    fence: {
      id: 'fence',
      name: 'Fence Ring',
      icon: '🛡️',
      require: { wood: 20 },
      reward: { coin: 0 },
      blurb: 'Defensive wall against enemies',
    },
  },
  // After completion, buildings become passive producers.
  producers: {
    hayBaler: {
      produces: 'bale',
      consumeFrom: 'grass',
      consumePerCycle: 1,
      intervalSec: 2.5,
      maxStack: 24,           // plenty of room; pad shows a tall pile
    },
    sawMill: {
      produces: 'planks',
      consumeFrom: 'wood',
      consumePerCycle: 1,
      intervalSec: 3.0,
      maxStack: 24,
    },
    // Market consumes bales/planks from Inventory and mints coins into the pile.
    market: {
      produces: 'coin',
      intervalSec: 1.8,
      coinsPerBale: 8,
      coinsPerPlanks: 12,
      maxStackVisual: 120,
      balesPerCycle: 1,
      planksPerCycle: 1,
    },
  },
  // Resources that live in the carry slot (in front of player). All others
  // live in the backpack (raw harvest).
  carryResources: ['bale', 'planks'],
  // Upgrades purchased at in-world tiles. Each level multiplies next cost.
  upgradeSteps: {
    capacity:    { stat: 'capacity',    amount: 5,   baseCost: 40,  costGrowth: 1.6, icon: '🎒', label: 'Bag' },
    speed:       { stat: 'speed',       amount: 0.8, baseCost: 60,  costGrowth: 1.6, icon: '👟', label: 'Speed' },
    slashRadius: { stat: 'slashRadius', amount: 0.25, baseCost: 80, costGrowth: 1.7, icon: '⚔️', label: 'Slash' },
  },
  // Upgrade tile plot positions — a row between the store and the build area
  upgradePlots: [
    { key: 'capacity',    x: -7, z: 15 },
    { key: 'speed',       x:  0, z: 15 },
    { key: 'slashRadius', x:  7, z: 15 },
  ],
  // Cosmetic customer NPCs at the market (queue forms south-east of store)
  customers: {
    queueStart: { x: 4.5, z: 34 },
    queueDir:   { x: 1, z: 0 },
    spacing: 1.2,
    maxQueue: 5,
    spawnIntervalSec: 3.5,
    leaveAfterSec: 2.0,
    colors: [0x3a7dd6, 0xd4493c, 0x8a5ed1, 0xd4a53a, 0x3e9d6e, 0xd07878, 0x58b0c9],
  },
  // Passive harvest zone sits inside the meadow
  passiveHarvest: {
    center: { x: -20, z: -2 },
    radiusX: 6,
    radiusZ: 5,
    intervalSec: 0.3,
    reach: 3.5,
  },
  // Helper NPCs that replicate player loop
  helpers: {
    hireCostBase: 150,
    costGrowth: 1.8,
    maxHelpers: 4,
    moveSpeed: 4.2,
    capacity: 10,
  },
  colors: {
    ground: 0x62a042,
    groundEdge: 0x4a7f33,
    meadow: 0x7dc24e,       // brighter green tile for meadow
    forestFloor: 0x4f7a36,  // darker underbrush
    grass: 0x7fd35a,
    grassDark: 0x5ea838,
    treeTrunk: 0x6b4423,
    treeLeaves: 0x3f9a3a,
    treeLeavesDark: 0x2e7a2a,
    player: 0xffcf87,
    playerShirt: 0x3a7dd6,
    playerPants: 0x333a55,
    backpack: 0x8b5a2b,
    slash: 0xffffff,
    arrow: 0xffd34e,
    buildFrame: 0xc09050,
    buildSiteDirt: 0x7d5a3a,
  },
};
