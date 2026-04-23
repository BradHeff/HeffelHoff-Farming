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

// PlayerCarry — crafted items from factories (bales, planks). Rendered as a
// stack in FRONT of the player (in their arms). Uncapped like the backpack.
export const PlayerCarry = {
  items: { bale: 0, planks: 0 },
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
