// Central tuning knobs. Adjust freely while iterating.

export const CONFIG = {
  world: {
    size: 80,
    // Hard rectangular bounds for the playable map. Ground + perimeter fence
    // are drawn to this rectangle. Southern edge is right past the customer
    // queue ("the road") so nothing renders behind the player.
    bounds: { minX: -32, maxX: 32, minZ: -40, maxZ: 18 },
    // Biome zones (axis-aligned rectangles on XZ plane). Smaller strips than
    // before so the interactive area is compact and everything stays within a
    // few steps of the player.
    meadow: { minX: -28, maxX: -2, minZ: -22, maxZ: 0 },
    forest: { minX: 2, maxX: 28, minZ: -22, maxZ: 0 },
    grassCount: 900,
    treeCount: 170,
    // Seconds before a harvested grass stalk regrows in place
    grassRegrowSec: 30,
    // Trees take much longer to regrow than grass so forests feel persistent.
    treeRegrowSec: 180,
    // Spawn close to the store — market is pre-built on spawn so the farmer
    // always has a place to sell. Build plots are tight around spawn.
    spawnPos: { x: 0, z: 9 },
    buildPlots: {
      market:      { x: 0, z: 13 },    // just south of spawn; pre-built
      hayBaler:    { x: 0, z: 1 },     // center of build row
      sawMill:     { x: -8, z: 1 },
      dairyFarm:   { x: 8, z: 1 },     // right of baler — milking station w/ cow
      sauceFactory:{ x: -16, z: 4 },   // left flank — unlocks after tomato chosen
      chipsFactory:{ x:  16, z: 4 },   // right flank — unlocks after potato chosen
      eggFarm:     { x: 0, z: -28 },   // deep in expansion zone (locked)
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
      prebuilt: true,              // no construction phase
      require: {},
      reward: { coin: 0 },
      blurb: 'Sells goods to customers',
    },
    sawMill: {
      id: 'sawMill',
      name: 'Saw Mill',
      icon: '🪚',
      require: { wood: 12, grass: 8 },
      reward: { coin: 40 },
      blurb: 'Cuts planks for building',
    },
    dairyFarm: {
      id: 'dairyFarm',
      name: 'Dairy Farm',
      icon: '🐄',
      require: { wood: 20, grass: 15 },
      reward: { coin: 30 },
      blurb: 'Milks cows for fresh dairy',
    },
    sauceFactory: {
      id: 'sauceFactory',
      name: 'Sauce Factory',
      icon: '🍶',
      require: { wood: 18, grass: 14 },
      reward: { coin: 15 },
      blurb: 'Bottles tomato sauce',
    },
    chipsFactory: {
      id: 'chipsFactory',
      name: 'Chips Factory',
      icon: '🥔',
      require: { wood: 18, grass: 14 },
      reward: { coin: 15 },
      blurb: 'Packs potato chips',
    },
    eggFarm: {
      id: 'eggFarm',
      name: 'Egg Farm',
      icon: '🥚',
      require: { wood: 30, planks: 15, grass: 25 },
      reward: { coin: 40 },
      blurb: 'Chickens lay eggs continuously',
    },
  },
  // After completion, buildings become passive producers.
  producers: {
    hayBaler: {
      produces: 'bale',
      consumeFrom: 'grass',
      consumePerCycle: 1,
      intervalSec: 2.5,
      maxStack: 10,           // tight visual cap keeps draw calls bounded
    },
    sawMill: {
      produces: 'planks',
      consumeFrom: 'wood',
      consumePerCycle: 1,
      intervalSec: 3.0,
      maxStack: 10,
    },
    sauceFactory: {
      produces: 'sauce',
      consumeFrom: 'tomato',
      consumePerCycle: 1,
      intervalSec: 3.0,
      maxStack: 10,
    },
    chipsFactory: {
      produces: 'chips',
      consumeFrom: 'potato',
      consumePerCycle: 1,
      intervalSec: 3.0,
      maxStack: 10,
    },
    eggFarm: {
      produces: 'egg',
      consumeFrom: 'corn',         // chickens eat corn (drop-off at DROP tile)
      consumePerCycle: 1,
      intervalSec: 3.5,
      maxStack: 10,
    },
    dairyFarm: {
      produces: 'milk',
      consumeFrom: 'bale',         // cow eats hay bales (drop-off at DROP tile)
      consumePerCycle: 1,
      intervalSec: 3.2,
      maxStack: 10,
    },
    // Market consumes stocked goods from Inventory and mints coins into the pile.
    market: {
      produces: 'coin',
      intervalSec: 1.8,
      // Coins per unit sold, by resource key
      sellRewards: { bale: 8, planks: 12, tomato: 6, potato: 9, sauce: 18, chips: 22, egg: 14, milk: 16 },
      maxStackVisual: 120,
      // Market sells in this priority order when multiple goods are stocked
      sellPriority: ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips', 'egg', 'milk'],
    },
  },
  // Resources that live in the carry slot (in front of player). Others on back.
  carryResources: ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips', 'egg', 'milk', 'corn'],
  // Crop definitions for the farm plot
  crops: {
    tomato: {
      key: 'tomato', name: 'Tomato', icon: '🍅',
      leafColor: 0x3e9a3a, fruitColor: 0xe04a3c,
      height: 0.55,
      growSec: 4.5,
    },
    potato: {
      key: 'potato', name: 'Potato', icon: '🥔',
      leafColor: 0x6aa04d, fruitColor: 0xc49a5a,
      height: 0.4,
      growSec: 6.0,
    },
    // Chicken feed — planted on any farm, delivered to the Egg Farm.
    corn: {
      key: 'corn', name: 'Corn', icon: '🌽',
      leafColor: 0x5caa38, fruitColor: 0xf2c648,
      height: 0.9,
      growSec: 5.5,
    },
  },
  // Farm plot config — replaces old passive harvest
  // Two separate farm plots so the player can grow different crops in
  // parallel. Both unlock once the Hay Baler is upgraded.
  farms: [
    {
      center: { x: -12, z: -4 },
      cols: 5, rows: 3, spacing: 1.35,
      unlockAtBalerLevel: 2,
      reseedDelayMs: 700,
      harvestYield: 1,
    },
    {
      center: { x: 12, z: -4 },
      cols: 5, rows: 3, spacing: 1.35,
      unlockAtBalerLevel: 2,
      reseedDelayMs: 700,
      harvestYield: 1,
    },
    // Expansion-zone farms — locked until the map expansion is activated.
    {
      center: { x: -12, z: -24 },
      cols: 5, rows: 3, spacing: 1.35,
      unlockAtBalerLevel: 2,
      reseedDelayMs: 700,
      harvestYield: 1,
      requiresExpansion: true,
    },
    {
      center: { x: 12, z: -24 },
      cols: 5, rows: 3, spacing: 1.35,
      unlockAtBalerLevel: 2,
      reseedDelayMs: 700,
      harvestYield: 1,
      requiresExpansion: true,
    },
  ],
  // Legacy single-farm reference, kept for any imports that still use it.
  farm: {
    center: { x: -12, z: -4 },
    cols: 5, rows: 3, spacing: 1.35,
    unlockAtBalerLevel: 2,
    reseedDelayMs: 700,
    harvestYield: 1,
  },
  // World expansion — a deeper strip of grass + forest north of the main
  // biomes that is initially un-harvestable. Unlocks when all main factories
  // are Level 3 AND the player pays the coin cost.
  expansion: {
    meadowStrip: { minX: -28, maxX: -2, minZ: -34, maxZ: -22 },
    forestStrip: { minX:  2, maxX: 28, minZ: -34, maxZ: -22 },
    grassCount: 350,
    treeCount: 80,
    unlockCost: 500,
    // Player walks onto this spot to activate the expansion once prereqs met
    tilePos: { x: 0, z: -20 },
    requiredAtL3: ['hayBaler', 'sawMill', 'sauceFactory', 'chipsFactory'],
  },
  // Building upgrades — item-cost deposits to raise a building's level.
  // Higher levels speed up production and increase output cap.
  // Market is NOT upgradeable (pre-built storefront).
  buildingLevels: {
    hayBaler: [
      { level: 2, require: { grass: 12, wood: 10 }, intervalMul: 0.7, stackMul: 1.0 },
      { level: 3, require: { grass: 25, planks: 8 }, intervalMul: 0.5, stackMul: 1.0 },
    ],
    sawMill: [
      { level: 2, require: { wood: 12, grass: 10 }, intervalMul: 0.7, stackMul: 1.0 },
      { level: 3, require: { wood: 25, bale: 8 },   intervalMul: 0.5, stackMul: 1.0 },
    ],
    sauceFactory: [
      { level: 2, require: { tomato: 10, planks: 6 }, intervalMul: 0.7, stackMul: 1.0 },
      { level: 3, require: { tomato: 20, planks: 12 }, intervalMul: 0.5, stackMul: 1.0 },
    ],
    chipsFactory: [
      { level: 2, require: { potato: 10, planks: 6 }, intervalMul: 0.7, stackMul: 1.0 },
      { level: 3, require: { potato: 20, planks: 12 }, intervalMul: 0.5, stackMul: 1.0 },
    ],
    eggFarm: [
      { level: 2, require: { corn: 10, planks: 6 }, intervalMul: 0.7, stackMul: 1.0 },
      { level: 3, require: { corn: 20, planks: 12 }, intervalMul: 0.5, stackMul: 1.0 },
    ],
    dairyFarm: [
      { level: 2, require: { bale: 10, wood: 8 }, intervalMul: 0.7, stackMul: 1.0 },
      { level: 3, require: { bale: 20, planks: 12 }, intervalMul: 0.5, stackMul: 1.0 },
    ],
  },
  // Upgrade tile sits south-west of the building (closer row), hire tile
  // south-east and pushed farther south (different row) so between adjacent
  // buildings a neighbour's HIRE and this one's UP are both separated in X
  // AND Z — no more decal overlap.
  buildingUpgradeOffset: { x: -2.6, z: 3.2 },
  // Which resources each completed building accepts at its DROP tile.
  // Market is special: it accepts crafted items delivered at the SELL tile.
  buildingInputs: {
    hayBaler: ['grass'],
    sawMill: ['wood'],
    sauceFactory: ['tomato'],
    chipsFactory: ['potato'],
    eggFarm: ['corn'],
    dairyFarm: ['bale'],
    market: ['bale', 'planks', 'tomato', 'potato', 'sauce', 'chips', 'egg', 'milk'],
  },
  // Per-building hire tile config — unlocked at Level 2. Hiring spawns a
  // worker that picks up produced items and delivers them to the market.
  buildingWorker: {
    offset: { x: 2.6, z: 5.2 },
    hireCost: 150,
    moveSpeed: 4.0,
    carryCap: 4,
  },
  // Tractor — end-game unlock. Preview sits on a pulsing ring until all
  // core buildings are Lv3 AND helper training is Lv2+. Paying the cost
  // spawns an autonomous tractor that sweeps the farm harvesting everything.
  tractor: {
    unlockPos: { x: -8, z: -10 },
    unlockCost: 800,
    moveSpeed: 7.5,
    capacity: 40,
    harvestRadius: 3.0,
    harvestIntervalSec: 0.35,
    perSweepMax: 6,
    requiredL3: ['hayBaler', 'sawMill', 'dairyFarm', 'sauceFactory', 'chipsFactory', 'eggFarm'],
  },
  // Helper training tile — revealed only after every main building is
  // complete AND the map expansion has been activated. Spending coins at
  // the tile raises HelperStats.capMul / speedMul globally, boosting all
  // hired farm + factory workers simultaneously.
  helperTraining: {
    tilePos: { x: 0, z: -14 },
    requiredBuilds: ['hayBaler', 'sawMill', 'dairyFarm', 'sauceFactory', 'chipsFactory', 'eggFarm'],
    tiers: [
      { level: 2, cost: 300, capMul: 1.4, speedMul: 1.15 },
      { level: 3, cost: 800, capMul: 1.8, speedMul: 1.3 },
      { level: 4, cost: 2000, capMul: 2.4, speedMul: 1.5 },
    ],
  },
  // Farm worker — hired at the farm's HIRE tile. Walks into the plot,
  // harvests ready crops, delivers to the matching factory (sauce for
  // tomato, chips for potato) or falls back to market, then returns.
  farmWorker: {
    hireCost: 120,
    moveSpeed: 4.0,
    carryCap: 6,
    harvestIntervalSec: 0.45,
    // HIRE tile offset south of the farm plot (toward player / camera)
    tileOffsetZ: 3.4,
  },
  // Upgrades purchased at in-world tiles. Each level multiplies next cost.
  upgradeSteps: {
    capacity:    { stat: 'capacity',    amount: 5,   baseCost: 40,  costGrowth: 1.6, icon: '🎒', label: 'Bag' },
    speed:       { stat: 'speed',       amount: 0.8, baseCost: 60,  costGrowth: 1.6, icon: '👟', label: 'Speed' },
    slashRadius: { stat: 'slashRadius', amount: 0.25, baseCost: 80, costGrowth: 1.7, icon: '⚔️', label: 'Slash' },
  },
  // Upgrade tile plot positions — row between spawn and build area.
  // Capacity upgrade removed since the backpack is uncapped.
  upgradePlots: [
    { key: 'speed',       x: -5, z: 11 },
    { key: 'slashRadius', x:  5, z: 11 },
  ],
  // Customer queue — on the SOUTH side of the store (behind, from the
  // player's viewpoint). Market sits at (0, 22), queue at z=25 so customers
  // queue between store and the camera. Player deposits from the north side
  // via the SELL tile.
  customers: {
    queueStart: { x: -1.5, z: 16 },
    queueDir:   { x: 1, z: 0 },
    spacing: 1.0,
    maxQueue: 4,
    spawnIntervalSec: 2.5,
    leaveAfterSec: 1.2,
    colors: [0x3a7dd6, 0xd4493c, 0x8a5ed1, 0xd4a53a, 0x3e9d6e, 0xd07878, 0x58b0c9],
  },
  // Passive harvest parameters (applies inside any farm plot)
  passiveHarvest: {
    intervalSec: 0.35,
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
    // Candy-bright, highly saturated palette — meant to pop against the sky
    // and read clearly on a phone screen outdoors.
    ground: 0x7ae54a,
    groundEdge: 0x4fbd2f,
    meadow: 0x8dff5a,
    forestFloor: 0x3ea238,
    grass: 0x6eff3c,
    grassDark: 0x3fd920,
    treeTrunk: 0xa66633,
    treeLeaves: 0x3fd238,
    treeLeavesDark: 0x2a9a32,
    player: 0xffd28a,
    playerShirt: 0x3ea6ff,
    playerPants: 0x344272,
    backpack: 0xb3702e,
    slash: 0xffffff,
    arrow: 0xffd847,
    buildFrame: 0xf2c14a,
    buildSiteDirt: 0xa66a3a,
    path: 0xd7a06a,
    pathEdge: 0xa07040,
  },
};
