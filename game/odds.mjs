import { CARDS, evaluate } from './cards.mjs';
import { contestablePot, halfPotRaise, potLayers } from './betting.mjs';
import { chooseBotAction, resolveBotAction } from './bots.mjs';

const SIMULATIONS = 8000;
const DECISION_TRIALS = 128;

function samplePrefix(cards, length, random) {
  for (let index = 0; index < length; index++) {
    const swap = index + Math.floor(random() * (cards.length - index));
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }
}

export function showdownOdds({ hole, board, opponents }, random = Math.random) {
  const known = new Set([...hole, ...board, ...opponents.flat()]);
  const available = CARDS.filter(card => !known.has(card));
  const missingBoard = 5 - board.length;
  const exact = missingBoard <= 2 && opponents.every(cards => cards.length === 2);
  let wins = 0;
  let ties = 0;
  let trials = 0;
  let share = 0;

  function compare(community, hands) {
    trials++;
    const hero = evaluate([...hole, ...community]);
    let tied = 1;
    for (const cards of hands) {
      const opponent = evaluate([...cards, ...community]);
      if (opponent > hero) return;
      if (opponent === hero) tied++;
    }
    if (tied > 1) ties++;
    else wins++;
    share += 1 / tied;
  }

  if (exact && missingBoard === 0) {
    compare(board, opponents);
  } else if (exact) {
    for (const [index, turn] of available.entries()) {
      if (missingBoard === 1) compare([...board, turn], opponents);
      else for (const river of available.slice(index + 1)) compare([...board, turn, river], opponents);
    }
  } else {
    const missing = missingBoard + opponents.reduce((total, cards) => total + 2 - cards.length, 0);
    for (let trial = 0; trial < SIMULATIONS; trial++) {
      samplePrefix(available, missing, random);
      let offset = missingBoard;
      const hands = opponents.map(cards => {
        const end = offset + 2 - cards.length;
        const hand = [...cards, ...available.slice(offset, end)];
        offset = end;
        return hand;
      });
      compare([...board, ...available.slice(0, missingBoard)], hands);
    }
  }

  return { win: wins / trials, tie: ties / trials, equity: share / trials, exact, trials };
}

function decisionValue(position, payment, targetBet, hands, scores, random) {
  const { seats, board, bigBlind } = position;
  const projected = seats.map(seat => ({ ...seat }));
  const hero = projected[0];
  hero.invested += payment;
  for (const seat of projected.slice(1)) {
    const owed = Math.max(0, targetBet - seat.streetBet);
    if (seat.status !== 'playing' || (!owed && seat.actedAt !== null)) continue;
    const call = Math.min(owed, seat.stack);
    const callPot = contestablePot(projected, seat.invested + call);
    const action = resolveBotAction({
      hole: hands.get(seat.index), board, profile: seat.profile,
      legal: { check: owed === 0, call: call || null, raise: null },
      opponents: projected.filter(other => other !== seat && other.live).length,
      owing: owed, bet: targetBet, pot: projected.reduce((sum, other) => sum + other.invested, 0),
      callPot, bigBlind,
    }, seat.terrified, chooseBotAction, random);
    if (action.type === 'fold') seat.live = false;
    if (action.type === 'call') seat.invested += call;
  }

  let received = 0;
  for (const { contributors, amount } of potLayers(projected)) {
    if (contributors.length === 1) {
      if (contributors[0] === hero) received += amount;
      continue;
    }
    const eligible = contributors.filter(seat => seat.live);
    const candidates = eligible.length ? eligible : projected.filter(seat => seat.live);
    if (!candidates.includes(hero)) continue;
    const best = Math.max(...candidates.map(seat => scores.get(seat.index)));
    if (scores.get(0) === best) {
      received += amount / candidates.filter(seat => scores.get(seat.index) === best).length;
    }
  }
  return received - payment;
}

export function bettingAdvice(position, random = Math.random) {
  const { hole, board, seats, legal, currentBet, pot } = position;
  const opponents = seats.slice(1).filter(seat => seat.live);
  const unseen = CARDS.filter(card => !hole.includes(card) && !board.includes(card));
  const missingBoard = 5 - board.length;
  const halfPot = halfPotRaise(legal, currentBet, pot);
  const choices = [
    { label: legal.check ? 'Check' : 'Call', payment: legal.call ?? 0, target: currentBet, value: 0 },
  ];
  if (halfPot !== null) {
    choices.push({
      label: currentBet ? 'Raise' : 'Bet',
      payment: halfPot - seats[0].streetBet, target: halfPot, amount: halfPot, value: 0,
    });
  }
  for (let trial = 0; trial < DECISION_TRIALS; trial++) {
    samplePrefix(unseen, missingBoard + opponents.length * 2, random);
    const runout = [...board, ...unseen.slice(0, missingBoard)];
    const hands = new Map(opponents.map((seat, index) => {
      const offset = missingBoard + index * 2;
      return [seat.index, unseen.slice(offset, offset + 2)];
    }));
    const scores = new Map([[0, evaluate([...hole, ...runout])]]);
    for (const [index, cards] of hands) scores.set(index, evaluate([...cards, ...runout]));
    for (const choice of choices) {
      choice.value += decisionValue(position, choice.payment, choice.target, hands, scores, random) / DECISION_TRIALS;
    }
  }
  const options = [...choices, { label: 'Fold', value: 0 }];
  const best = options.reduce((previous, option) => option.value > previous.value ? option : previous);
  return { options, best };
}
