export function halfPotRaise(legal, currentBet, pot) {
  if (!legal.raise) return null;
  const proposed = currentBet + Math.round((pot + (legal.call ?? 0)) / 2);
  return Math.max(legal.raise.min, Math.min(legal.raise.max, proposed));
}

export function* potLayers(seats) {
  const levels = [...new Set(seats.map(seat => seat.invested).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  for (const level of levels) {
    const contributors = seats.filter(seat => seat.invested >= level);
    yield { contributors, amount: (level - previous) * contributors.length };
    previous = level;
  }
}

export function contestablePot(seats, limit) {
  return seats.reduce((sum, seat) => sum + Math.min(seat.invested, limit), 0);
}
