// Snapshot + restore helpers. We serialize the minimum durable state that
// the player cares about — totals, unlocks, build levels, farm crops, level
// progression — and skip transient in-flight NPCs. On load we recreate
// helpers / building-workers from their counts so the farm looks "populated"
// again without trying to rebuild their pathing mid-trip.
import {
  Inventory, PlayerStats, Backpack, PlayerCarry, UserLevel, HelperStats,
} from './state.js';
import { Helper } from './npcs.js';

const SAVE_VERSION = 1;

export function serializeGame(game) {
  const builds = {};
  for (const [key, site] of Object.entries(game.builds.sites)) {
    builds[key] = {
      completed: !!site.completed,
      level: site.level || 1,
      locked: !!site._locked,
    };
  }
  const farms = game.farms.map((f) => ({
    tier: f.tier || 1,
    cropKey: f.cropKey || null,
    unlocked: !!f.unlocked,
    expansionUnlocked: !!f.expansionUnlocked,
  }));
  return {
    v: SAVE_VERSION,
    inventory: { ...Inventory, _subs: undefined },
    backpack: { ...Backpack.items },
    playerCarry: { ...PlayerCarry.items },
    playerStats: {
      capacity: PlayerStats.capacity,
      speed: PlayerStats.speed,
      slashRadius: PlayerStats.slashRadius,
      pickupRadius: PlayerStats.pickupRadius,
      level: { ...PlayerStats.level },
    },
    userLevel: {
      level: UserLevel.level,
      xp: UserLevel.xp,
      xpToNext: UserLevel.xpToNext,
    },
    helperStats: {
      level: HelperStats.level,
      capMul: HelperStats.capMul,
      speedMul: HelperStats.speedMul,
    },
    builds,
    unlocks: {
      dairyLock: !!game.dairyLock?.unlocked,
      expansion: !!game.expansionTile?.activated,
      tractor: !!game.tractorUnlock?.unlocked,
      harvester: !!game.harvesterUnlock?.unlocked,
    },
    farms,
    helpersCount: game.helpers.helpers.length,
    buildingWorkers: game.helpers.buildingWorkers.map((w) => w.buildingKey),
    farmWorkers: game.helpers.farmWorkers.map((w) => {
      const idx = game.farms.indexOf(w.farm);
      return idx >= 0 ? idx : null;
    }).filter((i) => i !== null),
    goals: { index: game.goals ? (game.goals.game && game.goals._lastSig, 0) : 0 },
    lifetime: {
      coinsEarned: game._lifetimeCoinsEarned || 0,
      sold: { ...(game._lifetimeSold || {}) },
      collected: { ...(game._lifetimeCollected || {}) },
      slashed: { ...(game._countSlashed || {}) },
      traderCompleted: game._traderCompleted || 0,
    },
  };
}

export function applySave(game, state) {
  if (!state || typeof state !== 'object') return;
  // Inventory
  if (state.inventory) {
    for (const k of Object.keys(Inventory)) {
      if (k === '_subs' || k === 'subscribe' || k === 'emit' || k === 'add' || k === 'spend') continue;
      if (typeof state.inventory[k] === 'number') Inventory[k] = state.inventory[k];
    }
    Inventory.emit();
  }
  if (state.backpack) {
    for (const k of Object.keys(Backpack.items)) {
      if (typeof state.backpack[k] === 'number') Backpack.items[k] = state.backpack[k];
    }
    Backpack.emit();
  }
  if (state.playerCarry) {
    for (const k of Object.keys(PlayerCarry.items)) {
      if (typeof state.playerCarry[k] === 'number') PlayerCarry.items[k] = state.playerCarry[k];
    }
    PlayerCarry.emit();
  }
  if (state.playerStats) {
    const ps = state.playerStats;
    if (typeof ps.speed === 'number') PlayerStats.speed = ps.speed;
    if (typeof ps.slashRadius === 'number') PlayerStats.slashRadius = ps.slashRadius;
    if (typeof ps.pickupRadius === 'number') PlayerStats.pickupRadius = ps.pickupRadius;
    if (ps.level) Object.assign(PlayerStats.level, ps.level);
    PlayerStats.emit();
  }
  if (state.userLevel) {
    UserLevel.level = state.userLevel.level || 1;
    UserLevel.xp = state.userLevel.xp || 0;
    UserLevel.xpToNext = state.userLevel.xpToNext || 3;
    UserLevel.emit();
  }
  if (state.helperStats) {
    HelperStats.level = state.helperStats.level || 1;
    HelperStats.capMul = state.helperStats.capMul || 1;
    HelperStats.speedMul = state.helperStats.speedMul || 1;
    HelperStats.emit();
  }
  // Builds — complete + level each site
  if (state.builds) {
    for (const [key, info] of Object.entries(state.builds)) {
      const site = game.builds.sites[key];
      if (!site) continue;
      if (info.completed && !site.completed) site.complete();
      if (info.level && site.level < info.level) {
        for (let l = site.level + 1; l <= info.level; l++) {
          const tierObj = (site.tiers && site.tiers.find((t) => t.level === l))
            || { level: l, intervalMul: 1, stackMul: 1, require: {} };
          if (site.applyLevel) site.applyLevel(tierObj);
        }
      }
      if (typeof info.locked === 'boolean') site._locked = info.locked;
    }
    game.builds._updateActive();
  }
  // Unlocks
  if (state.unlocks) {
    if (state.unlocks.dairyLock && game.dairyLock && !game.dairyLock.unlocked) {
      game.dairyLock._unlock();
    }
    if (state.unlocks.expansion && game.expansionTile && !game.expansionTile.activated) {
      game.expansionTile._activate();
    }
    if (state.unlocks.tractor && game.tractorUnlock && !game.tractorUnlock.unlocked) {
      game.tractorUnlock._unlock(game.particles);
    }
    if (state.unlocks.harvester && game.harvesterUnlock && !game.harvesterUnlock.unlocked) {
      game.harvesterUnlock._unlock(game.particles);
    }
  }
  // Farms — re-apply tier up to saved tier, then seed the saved crop
  if (state.farms) {
    state.farms.forEach((f, i) => {
      const farm = game.farms[i];
      if (!farm) return;
      if (f.expansionUnlocked) farm.setExpansionUnlocked(true);
      if (f.unlocked) farm.setUnlocked(true);
      while (farm.tier < (f.tier || 1)) {
        const grew = farm.upgradeSize();
        if (!grew) break;
      }
      if (f.cropKey && !farm.cropKey) {
        farm.seed(f.cropKey, game.world.harvestables);
      }
    });
  }
  // Re-hire workers (bypass cost — this is a restore, not a purchase)
  if (state.helpersCount) {
    for (let i = 0; i < state.helpersCount; i++) {
      game.helpers.helpers.push(new Helper(
        game.scene, game.world, game.builds, game.particles,
      ));
    }
  }
  if (state.buildingWorkers) {
    for (const key of state.buildingWorkers) {
      game.helpers.hireBuildingWorker(key);
    }
  }
  if (state.farmWorkers) {
    for (const idx of state.farmWorkers) {
      const farm = game.farms[idx];
      if (farm) game.helpers.hireFarmWorker(farm);
    }
  }
  // Lifetime counters
  if (state.lifetime) {
    game._lifetimeCoinsEarned = state.lifetime.coinsEarned || 0;
    game._lifetimeSold = { ...(state.lifetime.sold || {}) };
    game._lifetimeCollected = { ...(state.lifetime.collected || {}) };
    game._countSlashed = { tree: 0, grass: 0, crop: 0, ...(state.lifetime.slashed || {}) };
    game._traderCompleted = state.lifetime.traderCompleted || 0;
  }
  if (state.goals && game.goals) {
    game.goals.update();
  }
}

// Periodic + event-driven save. Auto-saves every 30s and forces a write
// whenever a subscribed store emits (inventory change, level up, etc).
export function startAutoSave(game, auth) {
  const push = () => {
    try {
      const snap = serializeGame(game);
      auth.writeSave(snap);
    } catch (err) {
      console.warn('[save] snapshot failed:', err?.message);
    }
  };
  // Immediate save after boot so the token/email user has SOMETHING stored
  setTimeout(push, 5000);
  // Timer-based save
  setInterval(push, 30_000);
  // Event-driven on level up / completion beats
  UserLevel.subscribe(push);
  HelperStats.subscribe(push);
  // Inventory emits a lot — throttle with a trailing timeout
  let invTimer = null;
  Inventory.subscribe(() => {
    clearTimeout(invTimer);
    invTimer = setTimeout(push, 2000);
  });
}
