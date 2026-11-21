import { shuffleDeck } from './cards.mjs';

export class Dealer {
  #deck;
  #community = [];
  #revealed = 0;
  #reserved = null;

  constructor(random) {
    this.#deck = shuffleDeck(random);
  }

  get reserved() {
    return this.#reserved;
  }

  draw() {
    return this.#deck.shift();
  }

  stageCommunity() {
    for (const count of [3, 1, 1]) {
      this.draw(); // Burn before the flop, turn and river.
      for (let index = 0; index < count; index++) this.#community.push(this.draw());
    }
  }

  hiddenCommunity(slot) {
    return slot >= this.#revealed ? this.#community[slot] : undefined;
  }

  exchangeCommunity(slot) {
    this.#community[slot] = this.exchange(this.#community[slot]);
    if (slot === this.#revealed) this.#reserved = null;
  }

  reserveCommunityMatch(matches, random) {
    if (this.#reserved !== null || this.#revealed === this.#community.length) return false;
    const available = [...this.#community.slice(this.#revealed), ...this.#deck].filter(matches);
    if (!available.length) return false;
    return this.reserveCommunityCard(available[Math.floor(random() * available.length)]);
  }

  reserveCommunityCard(card) {
    if (this.#reserved !== null || this.#revealed === this.#community.length) return false;

    const communitySlot = this.#community.indexOf(card, this.#revealed);
    const source = communitySlot === -1 ? this.#deck : this.#community;
    const index = communitySlot === -1 ? this.#deck.indexOf(card) : communitySlot;
    if (index === -1) return false;

    source[index] = this.#community[this.#revealed];
    this.#community[this.#revealed] = card;
    this.#reserved = card;
    return true;
  }

  dealCommunity(count) {
    const cards = this.#community.slice(this.#revealed, this.#revealed + count);
    this.#revealed += cards.length;
    this.#reserved = null;
    return cards;
  }

  exchange(card) {
    const replacement = this.draw();
    this.#deck.push(card);
    return replacement;
  }
}
