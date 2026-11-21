export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS = ['♣', '♦', '♥', '♠'];
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
const HAND_NAMES = [
  'High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];
const CATEGORY_VALUE = 16 ** 5;
export const CARDS = Array.from({ length: 52 }, (_, card) => card);

export function cardFace(card) {
  const rank = RANKS[card % 13];
  const suit = Math.floor(card / 13);
  return { rank, suit: SUITS[suit], red: suit === 1 || suit === 2, name: `${rank} of ${SUIT_NAMES[suit]}` };
}

export function shuffleDeck(random = Math.random) {
  const deck = [...CARDS];
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function straightHigh(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let high = 14; high >= 5; high--) {
    const run = 31 << (high - 4);
    if ((mask & run) === run) return high;
  }
  return 0;
}

function topRanks(mask, limit) {
  const result = [];
  for (let rank = 14; rank >= 2 && result.length < limit; rank--) {
    if (mask & (1 << rank)) result.push(rank);
  }
  return result;
}

function score(category, ranks) {
  let result = category;
  for (let index = 0; index < 5; index++) result = result * 16 + (ranks[index] ?? 0);
  return result;
}

// Evaluate the best five-card hand directly from up to seven cards.
export function evaluate(cards) {
  const counts = new Uint8Array(15);
  const suitCounts = [0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  let mask = 0;
  for (const card of cards) {
    const rank = card % 13 + 2;
    const suit = Math.floor(card / 13);
    counts[rank]++;
    suitCounts[suit]++;
    suitMasks[suit] |= 1 << rank;
    mask |= 1 << rank;
  }

  const flushSuit = suitCounts.findIndex(count => count >= 5);
  if (flushSuit !== -1) {
    const high = straightHigh(suitMasks[flushSuit]);
    if (high) return score(8, [high]);
  }

  const pairs = [];
  const trips = [];
  for (let rank = 14; rank >= 2; rank--) {
    if (counts[rank] === 4) return score(7, [rank, ...topRanks(mask & ~(1 << rank), 1)]);
    if (counts[rank] === 3) trips.push(rank);
    if (counts[rank] === 2) pairs.push(rank);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    return score(6, [trips[0], Math.max(trips[1] ?? 0, pairs[0] ?? 0)]);
  }
  if (flushSuit !== -1) return score(5, topRanks(suitMasks[flushSuit], 5));
  const high = straightHigh(mask);
  if (high) return score(4, [high]);
  if (trips.length) return score(3, [trips[0], ...topRanks(mask & ~(1 << trips[0]), 2)]);
  if (pairs.length >= 2) {
    return score(2, [pairs[0], pairs[1], ...topRanks(mask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1)]);
  }
  if (pairs.length) return score(1, [pairs[0], ...topRanks(mask & ~(1 << pairs[0]), 3)]);
  return score(0, topRanks(mask, 5));
}

export function handName(value) {
  return HAND_NAMES[Math.floor(value / CATEGORY_VALUE)];
}
