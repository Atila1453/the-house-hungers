import { CARDS, evaluate } from './cards.mjs';

function estimateEquity(hole, board, opponents, trials, random) {
  const unseen = CARDS.filter(card => !hole.includes(card) && !board.includes(card));
  const boardDraws = 5 - board.length;
  const draws = boardDraws + opponents * 2;
  let share = 0;

  for (let trial = 0; trial < trials; trial++) {
    // Partial Fisher–Yates samples imagined runouts from the bot's own view.
    for (let index = 0; index < draws; index++) {
      const swap = index + Math.floor(random() * (unseen.length - index));
      [unseen[index], unseen[swap]] = [unseen[swap], unseen[index]];
    }
    const runout = [...board, ...unseen.slice(0, boardDraws)];
    const own = evaluate([...runout, ...hole]);
    let tied = 1;
    for (let index = boardDraws; index < draws; index += 2) {
      const other = evaluate([...runout, unseen[index], unseen[index + 1]]);
      if (other > own) {
        tied = 0;
        break;
      }
      if (other === own) tied++;
    }
    if (tied) share += 1 / tied;
  }
  return share / trials;
}

export function chooseBotAction(view, random = Math.random) {
  const { hole, board, legal, profile, opponents, owing, pot, callPot, bigBlind, bet } = view;
  const skill = (profile.rating - 1) / 9;
  const equity = estimateEquity(hole, board, opponents, 8 + Math.round(skill * 56), random);
  const error = (random() - .5) * (.32 - skill * .27);
  const confidence = equity + error;
  const evenShare = 1 / (opponents + 1);
  const potOdds = (legal.call ?? 0) / Math.max(1, callPot + (legal.call ?? 0));
  const price = potOdds + skill * .06 - (1 - skill) * .12 - profile.looseness;

  if (legal.call !== null && confidence < Math.max(price, evenShare * (.65 + skill * .2))
      && (owing > bigBlind || random() < .42 + skill * .45)) {
    return { type: 'fold' };
  }

  const edge = confidence - evenShare;
  const valueBet = edge > .1 + (1 - skill) * .05
    && random() < .48 + skill * .29 + profile.aggression;
  const bluff = edge < .01 && opponents <= 2 && legal.check
    && random() < .025 + skill * .09 + Math.max(0, profile.aggression) * .2;

  if (legal.raise && (valueBet || bluff)) {
    const fraction = .36 + skill * .22 + profile.aggression + Math.max(0, edge) * .35;
    const proposed = bet + Math.round(pot * fraction);
    const amount = Math.max(legal.raise.min, Math.min(legal.raise.max, proposed));
    return { type: 'raise', amount };
  }
  return { type: legal.check ? 'check' : 'call' };
}

export function resolveBotAction(view, fearLevel, policy, random) {
  if (fearLevel === 3 || fearLevel === 2 && !view.legal.check) return { type: 'fold' };
  if (fearLevel === 2) return { type: 'check' };
  const action = policy(view, random);
  if (!view.legal.raise && action.type === 'raise') {
    return { type: view.legal.check ? 'check' : 'call' };
  }
  return action;
}
