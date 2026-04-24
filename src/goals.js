import { Goals, Inventory, HelperStats, UserLevel } from './state.js';
import { showLevelBanner, toast } from './hud.js';

// Goal definitions — sequential chain. Each goal has:
//   id:       unique key
//   title:    short text for the pill
//   icon:     emoji shown in the pill's gold badge
//   target:   integer count
//   progress: function (game) => number in [0..target] reflecting current
//             progress. Pulled every emit() (inventory change, build,
//             etc.) so no polling needed.
//   reward:   function (game) => void, applied on completion
//
// The list is short and tutorial-oriented at the start, then loops on an
// endgame "sell N each day" beat so the pill always has something to show.
export function buildGoals(game) {
  return [
    {
      id: 'chop-trees',
      title: 'Chop 5 Trees',
      icon: '🪵',
      target: 5,
      progress: () => Math.min(5, game._countSlashed?.tree || 0),
    },
    {
      id: 'harvest-grass',
      title: 'Cut 20 Grass',
      icon: '🌿',
      target: 20,
      progress: () => Math.min(20, game._countSlashed?.grass || 0),
    },
    {
      id: 'build-baler',
      title: 'Build the Hay Baler',
      icon: '🌾',
      target: 1,
      progress: () => game.builds.sites.hayBaler.completed ? 1 : 0,
    },
    {
      id: 'collect-bales',
      title: 'Collect 5 Hay Bales',
      icon: '🌾',
      target: 5,
      progress: () => Math.min(5, game._lifetimeCollected?.bale || 0),
    },
    {
      id: 'sell-bales',
      title: 'Sell 5 Hay Bales',
      icon: '🪙',
      target: 5,
      progress: () => Math.min(5, game._lifetimeSold?.bale || 0),
    },
    {
      id: 'build-sawmill',
      title: 'Build the Saw Mill',
      icon: '🪚',
      target: 1,
      progress: () => game.builds.sites.sawMill.completed ? 1 : 0,
    },
    {
      id: 'plant-crop',
      title: 'Plant a Crop',
      icon: '🍅',
      target: 1,
      progress: () => game.farms.some((f) => f.cropKey) ? 1 : 0,
    },
    {
      id: 'sell-crops',
      title: 'Sell 10 Crops',
      icon: '🍅',
      target: 10,
      progress: () => {
        const s = game._lifetimeSold || {};
        return Math.min(10, (s.tomato || 0) + (s.potato || 0));
      },
    },
    {
      id: 'unlock-dairy',
      title: 'Unlock the Dairy Farm',
      icon: '🐄',
      target: 1,
      progress: () => game.dairyLock?.unlocked ? 1 : 0,
    },
    {
      id: 'build-dairy',
      title: 'Build the Dairy Farm',
      icon: '🐄',
      target: 1,
      progress: () => game.builds.sites.dairyFarm?.completed ? 1 : 0,
    },
    {
      id: 'hire-helper',
      title: 'Hire a Farmhand',
      icon: '👨‍🌾',
      target: 1,
      progress: () => (game.helpers.helpers.length > 0) ? 1 : 0,
    },
    {
      id: 'expand-map',
      title: 'Expand the Map',
      icon: '🗺️',
      target: 1,
      progress: () => game.expansionTile?.activated ? 1 : 0,
    },
    {
      id: 'build-egg',
      title: 'Build the Egg Farm',
      icon: '🥚',
      target: 1,
      progress: () => game.builds.sites.eggFarm?.completed ? 1 : 0,
    },
    {
      id: 'train-helpers',
      title: 'Train Helpers to Lv 2',
      icon: '🎓',
      target: 1,
      progress: () => HelperStats.level >= 2 ? 1 : 0,
    },
    {
      id: 'unlock-tractor',
      title: 'Unlock the Tractor',
      icon: '🚜',
      target: 1,
      progress: () => game.tractorUnlock?.unlocked ? 1 : 0,
    },
    {
      id: 'earn-1000',
      title: 'Earn 1000 Coins',
      icon: '🪙',
      target: 1000,
      progress: () => Math.min(1000, game._lifetimeCoinsEarned || 0),
    },
    // Mid-game mastery loop
    {
      id: 'sell-milk',
      title: 'Sell 10 Milk',
      icon: '🥛',
      target: 10,
      progress: () => Math.min(10, game._lifetimeSold?.milk || 0),
    },
    {
      id: 'sell-egg',
      title: 'Sell 10 Eggs',
      icon: '🥚',
      target: 10,
      progress: () => Math.min(10, game._lifetimeSold?.egg || 0),
    },
    {
      id: 'collect-planks',
      title: 'Collect 30 Planks',
      icon: '🪚',
      target: 30,
      progress: () => Math.min(30, game._lifetimeCollected?.planks || 0),
    },
    {
      id: 'baler-l2',
      title: 'Upgrade Hay Baler to Lv 2',
      icon: '🌾',
      target: 1,
      progress: () => (game.builds.sites.hayBaler?.level || 1) >= 2 ? 1 : 0,
    },
    {
      id: 'sawmill-l2',
      title: 'Upgrade Saw Mill to Lv 2',
      icon: '🪚',
      target: 1,
      progress: () => (game.builds.sites.sawMill?.level || 1) >= 2 ? 1 : 0,
    },
    {
      id: 'fulfill-trader',
      title: 'Complete a Trader Order',
      icon: '📦',
      target: 1,
      progress: () => Math.min(1, game._traderCompleted || 0),
    },
    {
      id: 'hire-2-workers',
      title: 'Hire 2 Farmhands',
      icon: '👨‍🌾',
      target: 2,
      progress: () => Math.min(2, game.helpers.helpers.length),
    },
    {
      id: 'build-sauce',
      title: 'Build the Sauce Factory',
      icon: '🍶',
      target: 1,
      progress: () => game.builds.sites.sauceFactory?.completed ? 1 : 0,
    },
    {
      id: 'build-chips',
      title: 'Build the Chips Factory',
      icon: '🍟',
      target: 1,
      progress: () => game.builds.sites.chipsFactory?.completed ? 1 : 0,
    },
    {
      id: 'sell-sauce',
      title: 'Sell 15 Sauce',
      icon: '🍶',
      target: 15,
      progress: () => Math.min(15, game._lifetimeSold?.sauce || 0),
    },
    {
      id: 'sell-chips',
      title: 'Sell 15 Chips',
      icon: '🍟',
      target: 15,
      progress: () => Math.min(15, game._lifetimeSold?.chips || 0),
    },
    {
      id: 'earn-5000',
      title: 'Earn 5000 Coins',
      icon: '🪙',
      target: 5000,
      progress: () => Math.min(5000, game._lifetimeCoinsEarned || 0),
    },
    {
      id: 'baler-l3',
      title: 'Max Hay Baler (Lv 3)',
      icon: '🌾',
      target: 1,
      progress: () => (game.builds.sites.hayBaler?.level || 1) >= 3 ? 1 : 0,
    },
    {
      id: 'sawmill-l3',
      title: 'Max Saw Mill (Lv 3)',
      icon: '🪚',
      target: 1,
      progress: () => (game.builds.sites.sawMill?.level || 1) >= 3 ? 1 : 0,
    },
    {
      id: 'plant-wheat',
      title: 'Plant Wheat',
      icon: '🌾',
      target: 1,
      progress: () => game.farms.some((f) => f.cropKey === 'wheat') ? 1 : 0,
    },
    {
      id: 'sell-wheat',
      title: 'Sell 20 Wheat',
      icon: '🌾',
      target: 20,
      progress: () => Math.min(20, game._lifetimeSold?.wheat || 0),
    },
    {
      id: 'fulfill-3-traders',
      title: 'Complete 3 Trader Orders',
      icon: '📦',
      target: 3,
      progress: () => Math.min(3, game._traderCompleted || 0),
    },
    {
      id: 'max-every-factory',
      title: 'Upgrade Every Factory to Lv 3',
      icon: '⭐',
      target: 1,
      progress: () => {
        const sites = ['hayBaler', 'sawMill', 'sauceFactory', 'chipsFactory', 'eggFarm', 'dairyFarm'];
        return sites.every((k) => (game.builds.sites[k]?.level || 1) >= 3) ? 1 : 0;
      },
    },
    {
      id: 'earn-10000',
      title: 'Earn 10000 Coins',
      icon: '🪙',
      target: 10000,
      progress: () => Math.min(10000, game._lifetimeCoinsEarned || 0),
    },
    {
      id: 'hire-full-crew',
      title: 'Hire 4 Farmhands',
      icon: '👨‍🌾',
      target: 4,
      progress: () => Math.min(4, game.helpers.helpers.length),
    },
    {
      id: 'train-helpers-3',
      title: 'Train Helpers to Lv 3',
      icon: '🎓',
      target: 1,
      progress: () => HelperStats.level >= 3 ? 1 : 0,
    },
    {
      id: 'fulfill-10-traders',
      title: 'Complete 10 Trader Orders',
      icon: '📦',
      target: 10,
      progress: () => Math.min(10, game._traderCompleted || 0),
    },
    {
      id: 'collect-100-eggs',
      title: 'Collect 100 Eggs',
      icon: '🥚',
      target: 100,
      progress: () => Math.min(100, game._lifetimeCollected?.egg || 0),
    },
    {
      id: 'collect-100-milk',
      title: 'Collect 100 Milk',
      icon: '🥛',
      target: 100,
      progress: () => Math.min(100, game._lifetimeCollected?.milk || 0),
    },
    {
      id: 'earn-25000',
      title: 'Earn 25000 Coins',
      icon: '🪙',
      target: 25000,
      progress: () => Math.min(25000, game._lifetimeCoinsEarned || 0),
    },
    {
      id: 'train-helpers-4',
      title: 'Max Helper Training (Lv 4)',
      icon: '🎓',
      target: 1,
      progress: () => HelperStats.level >= 4 ? 1 : 0,
    },
    {
      id: 'grand-farmer',
      title: 'Earn 50000 Coins (Grand Farmer)',
      icon: '🏆',
      target: 50000,
      progress: () => Math.min(50000, game._lifetimeCoinsEarned || 0),
    },
  ];
}

export class GoalManager {
  constructor(game) {
    this.game = game;
    Goals.list = buildGoals(game);
    Goals.index = 0;
    this.pill = document.getElementById('goal-pill');
    this._lastSig = '';
    Inventory.subscribe(() => this._tick());
    // Tick once at boot
    setTimeout(() => this._tick(), 50);
  }

  _tick() {
    const g = Goals.current();
    if (!g) {
      this.pill?.classList.remove('show');
      return;
    }
    const prog = Math.max(0, Math.min(g.target, g.progress() || 0));
    const sig = `${Goals.index}|${prog}|${g.target}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render(g, prog);
    }
    if (prog >= g.target) {
      this._complete(g);
    }
  }

  _render(g, prog) {
    if (!this.pill) return;
    this.pill.classList.add('show');
    this.pill.querySelector('.goal-icon').textContent = g.icon;
    this.pill.querySelector('.goal-title').textContent = g.title;
    this.pill.querySelector('.goal-count').textContent =
      g.target > 1 ? `${prog}/${g.target}` : '';
    const pct = Math.min(1, prog / g.target);
    this.pill.querySelector('.goal-fill').style.width = `${pct * 100}%`;
  }

  _complete(g) {
    if (g._done) return;
    g._done = true;
    if (g.reward) g.reward(this.game);
    // Every goal grants 1 XP toward overall user level
    UserLevel.grant(1);
    showLevelBanner({ tier: 'GOAL!', name: g.title, icon: g.icon });
    toast(`✓ ${g.title}`);
    // Pulse the pill, then advance after a short beat
    this.pill?.classList.add('pulse');
    setTimeout(() => this.pill?.classList.remove('pulse'), 500);
    setTimeout(() => {
      Goals.advance();
      this._lastSig = '';
      this._tick();
    }, 900);
  }

  update() { this._tick(); }
}
