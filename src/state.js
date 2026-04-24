import { CONFIG } from './config.js';

// PlayerStats — upgradeable stats mutated by UpgradeTiles. Backpack capacity
// is cosmetic/legacy (backpack is effectively uncapped now); speed and slash
// radius drive actual behavior.
export const PlayerStats = {
  capacity: 9999,
  speed: CONFIG.player.moveSpeed,
  slashRadius: CONFIG.player.slashRadius,
  pickupRadius: CONFIG.player.pickupRadius,
  level: { capacity: 0, speed: 0, slashRadius: 0 },
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  upgrade(key) {
    const step = CONFIG.upgradeSteps[key];
    if (!step) return;
    this[step.stat] += step.amount;
    this.level[key] += 1;
    this.emit();
  },
};

// Global warehouse — all resource totals are displayed in the HUD.
export const Inventory = {
  wood: 0,
  grass: 0,
  bale: 0,
  planks: 0,
  tomato: 0,
  potato: 0,
  sauce: 0,
  chips: 0,
  egg: 0,
  milk: 0,
  corn: 0,
  wheat: 0,
  coin: 0,
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  add(key, n) { this[key] = (this[key] || 0) + n; this.emit(); },
  spend(key, n) {
    if ((this[key] || 0) < n) return false;
    this[key] -= n; this.emit(); return true;
  },
};

function isCarryResource(key) {
  return CONFIG.carryResources.includes(key);
}

// Backpack — raw harvested items only (grass, wood). Uncapped: the stack on
// the player's back just keeps growing visually.
export const Backpack = {
  items: { wood: 0, grass: 0 },
  get capacity() { return Infinity; }, // unlimited by design
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  total() { return Object.values(this.items).reduce((a, b) => a + b, 0); },
  isFull() { return false; },
  add(key, n = 1) {
    this.items[key] = (this.items[key] || 0) + n;
    this.emit();
    return n;
  },
  dump() {
    const out = { ...this.items };
    for (const k of Object.keys(this.items)) this.items[k] = 0;
    this.emit();
    return out;
  },
};

// PlayerCarry — crafted/harvested items (bales, planks, crops). Rendered as
// a stack in FRONT of the player (in their arms). Uncapped.
export const PlayerCarry = {
  items: { bale: 0, planks: 0, tomato: 0, potato: 0, sauce: 0, chips: 0, egg: 0, milk: 0, corn: 0, wheat: 0 },
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  total() { return Object.values(this.items).reduce((a, b) => a + b, 0); },
  add(key, n = 1) {
    this.items[key] = (this.items[key] || 0) + n;
    this.emit();
    return n;
  },
  dump() {
    const out = { ...this.items };
    for (const k of Object.keys(this.items)) this.items[k] = 0;
    this.emit();
    return out;
  },
};

// Router: pickups put crafted items into Carry, raw into Backpack.
export function addToPlayer(key, n = 1) {
  if (isCarryResource(key)) return PlayerCarry.add(key, n);
  return Backpack.add(key, n);
}

// Router: pack-drain into Inventory covers both pack types.
export function dumpAllToInventory() {
  const all = {};
  for (const [k, v] of Object.entries(Backpack.items)) if (v > 0) all[k] = v;
  for (const [k, v] of Object.entries(PlayerCarry.items)) all[k] = (all[k] || 0) + v;
  Backpack.dump();
  PlayerCarry.dump();
  for (const [k, v] of Object.entries(all)) Inventory.add(k, v);
  return all;
}

PlayerStats.subscribe(() => Backpack.emit());

// HelperStats — end-game multipliers shared across all hired NPCs (farm
// workers, building workers, helpers). Raised by the Helper Training tile
// which only appears after full-game prerequisites are met.
// UserLevel — overall meta-progression. Every completed goal grants 1 XP;
// leveling up unlocks higher-tier content and fires a big celebration.
// Kept here so goals, HUD pill, and crop/equipment gates can all share one
// source of truth.
export const UserLevel = {
  level: 1,
  xp: 0,
  xpToNext: 3,
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  grant(xp = 1) {
    this.xp += xp;
    let leveledUp = false;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      // Each tier needs slightly more XP than the previous
      this.xpToNext = 3 + Math.floor(this.level * 1.5);
      leveledUp = true;
    }
    this.emit();
    return leveledUp;
  },
};

// Sequential goal chain. Each entry describes ONE closable micro-goal that
// the HUD pill tracks. When `check(state)` returns true, the goal completes,
// the reward applies, and the next entry in the chain activates.
// Kept here so state listeners can trigger re-checks on emit().
export const Goals = {
  index: 0,
  // Filled by GoalManager on init
  list: [],
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  current() { return this.list[this.index] || null; },
  advance() {
    if (this.index < this.list.length - 1) this.index += 1;
    this.emit();
  },
};

export const HelperStats = {
  level: 1,
  capMul: 1.0,   // multiplier on worker carry cap
  speedMul: 1.0, // multiplier on worker move speed
  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit() { this._subs.forEach((fn) => fn(this)); },
  applyTier(tier) {
    this.level = tier.level;
    this.capMul = tier.capMul ?? this.capMul;
    this.speedMul = tier.speedMul ?? this.speedMul;
    this.emit();
  },
};
