import { ABILITIES, ABILITY_BY_ID, UPGRADE_COSTS } from './abilities.mjs';
import { VENUES } from './venues.mjs';

const SAVE_KEY = 'the-house-hungers-v2-progression';
export const CASH_PER_CHIP = 10;
export const DIAMONDS = [
  { id: 'round', name: 'Round-cut diamond', carats: 1, price: 2000 },
  { id: 'emerald', name: 'Emerald-cut diamond', carats: 3, price: 9500 },
  { id: 'cushion', name: 'Cushion-cut diamond', carats: 6, price: 26000 },
];
const balance = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export class Progression {
  #storage;

  constructor(storage) {
    let saved;
    try {
      this.#storage = storage ?? globalThis.localStorage;
      saved = this.#storage.getItem(SAVE_KEY);
      saved = JSON.parse(saved);
    } catch {
      saved = null;
    }
    this.#restore(saved);
  }

  #restore(saved) {
    this.cash = balance(saved?.cash);
    this.essence = balance(saved?.essence);
    this.levels = Object.fromEntries(ABILITIES.map(({ id }) => {
      const level = saved?.levels?.[id] ?? (id === 'inhuman' ? saved?.inhumanLevel : undefined);
      return [id, [1, 2, 3].includes(level) ? level : 1];
    }));
    this.diamondGatesUnlocked = saved?.diamondGatesUnlocked === true;
    this.inventory = Object.fromEntries(DIAMONDS.map(({ id }) => [id, balance(saved?.inventory?.[id])]));
    this.largestFed = balance(saved?.largestFed);
    const unlocked = Array.isArray(saved?.unlockedVenues) ? saved.unlockedVenues : [];
    this.unlockedVenues = VENUES.filter(venue => venue.entryCost && unlocked.includes(venue.id)).map(venue => venue.id);
  }

  reset() {
    try {
      this.#storage?.removeItem(SAVE_KEY);
    } catch {
      return false;
    }
    this.#restore(null);
    return true;
  }

  get carats() {
    return DIAMONDS.reduce((total, diamond) => total + this.inventory[diamond.id] * diamond.carats, 0);
  }

  abilityLevel(id) {
    return ABILITY_BY_ID.has(id) ? this.levels[id] : undefined;
  }

  upgradeCost(id) {
    return UPGRADE_COSTS[this.abilityLevel(id)];
  }

  upgradeGateMet(id) {
    const cost = this.upgradeCost(id);
    return cost !== undefined && (this.diamondGatesUnlocked || this.largestFed >= cost);
  }

  bankWinnings(chips) {
    const cash = chips * CASH_PER_CHIP;
    if (cash > 0) {
      this.cash += cash;
      this.#save();
    }
    return cash;
  }

  isVenueUnlocked(venue) {
    return venue.entryCost === 0 || this.unlockedVenues.includes(venue.id);
  }

  unlockVenue(id) {
    const venue = VENUES.find(item => item.id === id);
    if (!venue) return false;
    if (this.isVenueUnlocked(venue)) return true;
    if (this.cash < venue.entryCost) return false;
    this.cash -= venue.entryCost;
    this.unlockedVenues.push(id);
    this.#save();
    return true;
  }

  buy(id) {
    const diamond = DIAMONDS.find(item => item.id === id);
    if (!diamond || this.cash < diamond.price) return false;
    this.cash -= diamond.price;
    this.inventory[id]++;
    this.#save();
    return true;
  }

  feed(id) {
    const diamond = DIAMONDS.find(item => item.id === id);
    if (!diamond || !this.inventory[id]) return false;
    this.inventory[id]--;
    this.essence += diamond.carats;
    this.largestFed = Math.max(this.largestFed, diamond.carats);
    this.#save();
    return true;
  }

  upgrade(id) {
    const cost = this.upgradeCost(id);
    if (!this.upgradeGateMet(id) || this.essence < cost) return false;
    this.essence -= cost;
    this.levels[id]++;
    this.#save();
    return true;
  }

  redeemCode(code) {
    switch (code.trim().toUpperCase()) {
      case 'BALLER':
        this.cash += 1_000_000;
        break;
      case 'SYMBIOTE':
        this.essence += 10_000;
        this.diamondGatesUnlocked = true;
        break;
      default:
        return false;
    }
    this.#save();
    return true;
  }

  #save() {
    try {
      this.#storage.setItem(SAVE_KEY, JSON.stringify(this));
    } catch {
      // Progress is still available in this tab when browser storage is disabled.
    }
  }
}
