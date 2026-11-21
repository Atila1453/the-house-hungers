import { ABILITY_BY_ID, abilityTargetLimit } from './abilities.mjs';
import { contestablePot, potLayers } from './betting.mjs';
import { chooseBotAction, resolveBotAction } from './bots.mjs';
import { CARDS, RANKS, SUITS, SUIT_NAMES, cardFace, evaluate, handName } from './cards.mjs';
import { Dealer } from './dealer.mjs';
import { bettingAdvice, showdownOdds } from './odds.mjs';

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const COMMUNITY_COUNTS = [0, 3, 1, 1];
const ENERGY_RECOVERY = 22;
const BLOOD_MARKER_REWARD = 35;
export const MAX_ENERGY = 100;

const inHand = seat => seat.status === 'playing' || seat.status === 'all-in';
const canAct = seat => seat.status === 'playing';
const cardKey = (slot, seat) => `${seat ?? 'board'}:${slot}`;

function newSeat(index, profile, stack) {
  return {
    index, profile, name: profile?.name ?? 'You', stack,
    cards: [], status: 'waiting', invested: 0, streetBet: 0,
    actedAt: null, terrified: 0, lastAction: '',
  };
}

export class HoldemTable {
  #random;
  #botPolicy;
  #dealer;
  #knownCards = new Map();
  #reservedLabel = '';
  #runWinnings = 0;

  constructor(venue, { random = Math.random, botPolicy = chooseBotAction } = {}) {
    this.venue = venue;
    this.#random = random;
    this.#botPolicy = botPolicy;
    this.seats = [newSeat(0, null, venue.buyIn), ...venue.opponents.map(
      (profile, index) => newSeat(index + 1, profile, venue.buyIn),
    )];
    this.hand = 0;
    this.phase = 'ready';
    this.button = -1;
    this.bigBlindSeat = null;
    this.actor = null;
    this.board = [];
    this.log = [];
    this.energy = MAX_ENERGY;
    this.insight = null;
    this.bloodMarker = null;
    this.result = null;
  }

  get hero() {
    return this.seats[0];
  }

  get playing() {
    return STREETS.includes(this.phase);
  }

  get canDeal() {
    return !this.playing && this.hero.stack > 0 && this.seats.slice(1).some(seat => seat.stack > 0);
  }

  get runFinished() {
    return this.phase === 'settled' && !this.canDeal;
  }

  takeRunWinnings() {
    if (!this.runFinished) return 0;
    const winnings = this.#runWinnings;
    this.#runWinnings = 0;
    return winnings;
  }

  get pot() {
    return this.seats.reduce((sum, seat) => sum + seat.invested, 0);
  }

  get reservedCard() {
    return this.#dealer?.reserved ?? null;
  }

  get reservedLabel() {
    return this.reservedCard === null ? '' : this.#reservedLabel;
  }

  communityIsHidden(slot) {
    return this.hand > 0 && (slot === 3 || slot === 4) && slot >= this.board.length;
  }

  knownCard(slot, seat) {
    const value = this.#knownCards.get(cardKey(slot, seat));
    return typeof value === 'number' ? value : null;
  }

  knownRank(slot, seat) {
    const value = this.#knownCards.get(cardKey(slot, seat));
    return typeof value === 'string' ? value : null;
  }

  cardTargetLabel({ seat, slot }) {
    if (seat === undefined) return slot === 3 ? 'Turn' : 'River';
    const side = slot === 0 ? 'left card' : 'right card';
    return seat === 0 ? `Your ${side}` : `${this.seats[seat].name}’s ${side}`;
  }

  deal() {
    if (!this.canDeal) return false;
    this.#dealer = new Dealer(this.#random);
    this.hand++;
    this.phase = 'preflop';
    this.board = [];
    this.log = [];
    this.#knownCards.clear();
    this.insight = null;
    this.bloodMarker = null;
    this.result = null;
    for (const seat of this.seats) {
      Object.assign(seat, {
        cards: [], status: seat.stack > 0 ? 'playing' : 'out', invested: 0, streetBet: 0,
        actedAt: null, terrified: 0, lastAction: '',
      });
    }

    const headsUp = this.seats.filter(canAct).length === 2;
    this.button = this.#nextSeat(this.button, canAct);
    if (headsUp && this.#nextSeat(this.button, canAct) === this.bigBlindSeat) {
      this.button = this.#nextSeat(this.button, canAct);
    }
    const small = headsUp ? this.button : this.#nextSeat(this.button, canAct);
    const big = this.#nextSeat(small, canAct);
    this.bigBlindSeat = big;

    const dealOrder = this.#clockwise().filter(canAct);
    for (let round = 0; round < 2; round++) {
      for (const seat of dealOrder) seat.cards.push(this.#dealer.draw());
    }
    this.#dealer.stageCommunity();

    this.currentBet = this.venue.bigBlind;
    this.minRaise = this.venue.bigBlind;
    this.#commit(this.seats[small], this.venue.smallBlind);
    this.#commit(this.seats[big], this.venue.bigBlind);
    this.seats[small].lastAction = 'Small blind';
    this.seats[big].lastAction = 'Big blind';
    this.#record(`${this.venue.dealer.name} dealt hand ${this.hand}.`);
    this.#progress(big);
    return true;
  }

  legalActions() {
    if (this.actor === null || !this.playing) return null;
    const seat = this.seats[this.actor];
    const bet = this.#betToMatch(seat);
    const owing = Math.max(0, bet - seat.streetBet);
    const max = seat.streetBet + seat.stack;
    const bettingReopened = seat.actedAt === null || bet - seat.actedAt >= this.minRaise;
    const mayRaise = !seat.terrified && bettingReopened && max > bet
      && this.seats.some(other => other !== seat && canAct(other));

    return {
      check: owing === 0,
      call: owing ? Math.min(owing, seat.stack) : null,
      raise: mayRaise ? { min: Math.min(bet + this.minRaise, max), max } : null,
    };
  }

  act(seatIndex, action) {
    if (seatIndex === null || seatIndex !== this.actor || !action) return false;
    const legal = this.legalActions();
    if (!legal) return false;
    const seat = this.seats[seatIndex];
    const wasTerrified = seat.terrified;
    const { type, amount } = action;
    if (wasTerrified >= 2 && type !== (wasTerrified === 2 && legal.check ? 'check' : 'fold')) return false;

    switch (type) {
      case 'fold':
        seat.status = 'folded';
        seat.lastAction = wasTerrified >= 2 ? 'Spooked' : 'Fold';
        this.insight = null;
        break;
      case 'check':
        if (!legal.check) return false;
        seat.lastAction = 'Check';
        break;
      case 'call':
        if (legal.call === null) return false;
        this.#commit(seat, legal.call);
        seat.lastAction = seat.status === 'all-in' ? 'All-in' : `Call ${legal.call}`;
        break;
      case 'raise': {
        if (!legal.raise || !Number.isSafeInteger(amount) || amount < legal.raise.min || amount > legal.raise.max) return false;
        const increment = amount - this.currentBet;
        const opening = this.currentBet === 0;
        this.#commit(seat, amount - seat.streetBet);
        this.currentBet = amount;
        this.minRaise = Math.max(this.minRaise, increment);
        seat.lastAction = seat.status === 'all-in' ? `All-in ${amount}` : `${opening ? 'Bet' : 'Raise'} ${amount}`;
        break;
      }
      default:
        return false;
    }

    seat.actedAt = this.currentBet;
    seat.terrified = 0;
    if (this.insight?.level >= 2) this.insight = null;
    this.#record(`${seat.name} · ${seat.lastAction}`);
    this.#progress(seatIndex);
    return true;
  }

  playBot() {
    const seat = this.seats[this.actor];
    if (!seat?.profile || !this.playing) return false;
    const legal = this.legalActions();
    const bet = this.#betToMatch(seat);
    const callLimit = seat.invested + (legal.call ?? 0);
    const callPot = contestablePot(this.seats, callLimit);
    const view = {
      hole: [...seat.cards], board: [...this.board], profile: seat.profile, legal,
      opponents: this.seats.filter(other => other !== seat && inHand(other)).length,
      owing: bet - seat.streetBet, bet, pot: this.pot, callPot, bigBlind: this.venue.bigBlind,
    };
    const action = resolveBotAction(view, seat.terrified, this.#botPolicy, this.#random);
    return this.act(seat.index, action);
  }

  advanceStreet() {
    if (!this.playing || this.actor !== null || this.phase === 'river') return false;
    const next = STREETS.indexOf(this.phase) + 1;
    this.phase = STREETS[next];
    const previousLength = this.board.length;
    this.board.push(...this.#dealer.dealCommunity(COMMUNITY_COUNTS[next]));
    for (let slot = previousLength; slot < this.board.length; slot++) this.#knownCards.delete(cardKey(slot));
    this.insight = null;
    this.currentBet = 0;
    this.minRaise = this.venue.bigBlind;
    for (const seat of this.seats) {
      seat.streetBet = 0;
      seat.actedAt = null;
      if (canAct(seat)) seat.lastAction = '';
    }
    this.#record(`${this.venue.dealer.name} revealed the ${this.phase}.`);
    this.#progress(this.button);
    return true;
  }

  abilityTargets(id, level = 1) {
    if (id === 'terrify') return this.seats.slice(1).filter(seat => canAct(seat) && !seat.terrified);
    if (id === 'blood-marker') return this.seats.slice(1).filter(inHand);
    if (id === 'peek' || id === 'swap') {
      if (id === 'swap' && level === 1) return [0, 1].map(slot => ({ seat: 0, slot }));
      const community = [3, 4].filter(slot => this.communityIsHidden(slot)).map(slot => ({ slot }));
      const hole = this.seats.filter(seat => inHand(seat) && (seat.index !== 0 || id === 'swap'))
        .flatMap(seat => [0, 1].map(slot => ({ seat: seat.index, slot })));
      return [...community, ...hole].filter(({ slot, seat }) => id === 'swap'
        || this.knownCard(slot, seat) === null && (level > 1 || this.knownRank(slot, seat) === null));
    }
    if (id === 'mind') {
      if (level === 1) return SUITS;
      if (level === 2) return RANKS;
      return CARDS.filter(card => !this.hero.cards.includes(card) && !this.board.includes(card));
    }
    return [];
  }

  abilityReason(id, level = 1) {
    const ability = ABILITY_BY_ID.get(id);
    if (!ability) return 'Unknown ability';
    if (![1, 2, 3].includes(level)) return 'Unknown ability level';
    if (this.actor !== 0) return 'Available on your turn';
    if (id === 'blood-marker' && this.bloodMarker) return 'Already used this hand';
    if (id === 'blood-marker' && (this.phase === 'turn' || this.phase === 'river')) return 'Use before the turn card';
    if (this.energy < ability.cost) return 'Needs more energy';
    if (id === 'mind' && (this.phase === 'river' || this.reservedCard !== null)) return 'No community card to control';
    if (id === 'inhuman' && this.insight) return 'Odds already calculated for this position';
    if (['peek', 'swap'].includes(id) && !this.abilityTargets(id, level).length) return 'No eligible card';
    if (['terrify', 'blood-marker'].includes(id) && !this.abilityTargets(id, level).length) return 'No eligible opponent';
    return '';
  }

  cast(id, { seat, slot, targets, choice, card, level = 1 } = {}) {
    if (this.abilityReason(id, level)) return false;
    const ability = ABILITY_BY_ID.get(id);
    let message;

    switch (id) {
      case 'terrify': {
        const target = this.seats[seat];
        if (!this.abilityTargets(id, level).includes(target)) return false;
        target.terrified = level;
        if (this.insight?.advice) this.insight = null;
        const effect = ['cannot bet or raise', 'will check or fold', 'will fold'][level - 1];
        message = `${target.name} looks shaken. They ${effect} on their next action.`;
        break;
      }
      case 'mind': {
        const selected = choice ?? card;
        if (!this.abilityTargets(id, level).includes(selected)) return false;
        const match = level === 1 ? 'suit' : 'rank';
        const reserved = level === 3 ? this.#dealer.reserveCommunityCard(selected)
          : this.#dealer.reserveCommunityMatch(value => cardFace(value)[match] === selected, this.#random);
        if (reserved) {
          for (const slot of [3, 4]) {
            const known = this.#knownCards.get(cardKey(slot));
            const current = this.#dealer.hiddenCommunity(slot);
            if (known !== undefined && known !== current && known !== cardFace(current).rank) {
              this.#knownCards.delete(cardKey(slot));
            }
          }
          this.#reservedLabel = level === 1 ? SUIT_NAMES[SUITS.indexOf(selected)]
            : level === 2 ? selected : cardFace(selected).name;
          message = level === 3 ? `${this.venue.dealer.name} will reveal the ${this.#reservedLabel} next.`
            : `The next reveal will match ${this.#reservedLabel}.`;
        } else {
          message = 'The dealer could not reach a matching card.';
        }
        break;
      }
      case 'peek':
      case 'swap': {
        const selection = targets ?? [{ seat, slot }];
        const eligible = new Set(this.abilityTargets(id, level).map(item => cardKey(item.slot, item.seat)));
        if (!Array.isArray(selection) || !selection.length || selection.length > abilityTargetLimit(id, level)
            || ![...selection].every(item => item && Number.isInteger(item.slot)
              && (item.seat === undefined || Number.isInteger(item.seat))
              && eligible.delete(cardKey(item.slot, item.seat)))) return false;
        message = selection.map(item => this.#affectCard(id, level, item)).join(' · ');
        break;
      }
      case 'inhuman': {
        this.insight = this.#readPosition(level);
        const { win, tie, exact } = this.insight;
        const format = value => `${exact ? '' : '≈'}${(value * 100).toFixed(1)}%`;
        message = `${format(win)} to win outright · ${format(tie)} to tie`;
        break;
      }
      case 'blood-marker': {
        const selection = targets ?? [seat];
        const eligible = new Set(this.abilityTargets(id, level).map(item => item.index));
        if (!Array.isArray(selection) || !selection.length || selection.length > abilityTargetLimit(id, level)
            || ![...selection].every(index => eligible.delete(index))) return false;
        this.bloodMarker = { seats: [...selection], level };
        message = `Marked ${selection.map(index => this.seats[index].name).join(' and ')}. Beat a marked hand at showdown to feed the symbiote.`;
        break;
      }
    }
    this.energy -= ability.cost;
    this.#record(message);
    return message;
  }

  #affectCard(id, level, target) {
    const { seat, slot } = target;
    const player = this.seats[seat];
    const key = cardKey(slot, seat);
    const label = this.cardTargetLabel(target);
    if (id === 'peek') {
      const hidden = player ? player.cards[slot] : this.#dealer.hiddenCommunity(slot);
      const { rank, name } = cardFace(hidden);
      this.#knownCards.set(key, level === 1 ? rank : hidden);
      return `${label}: ${level === 1 ? rank : name}`;
    }
    if (player) {
      player.cards[slot] = this.#dealer.exchange(player.cards[slot]);
      this.insight = null;
    } else {
      this.#dealer.exchangeCommunity(slot);
    }
    this.#knownCards.delete(key);
    return `${label} was swapped`;
  }

  #readPosition(level) {
    const { board, hero, seats, pot } = this;
    const opponents = seats.slice(1).filter(inHand).map(() => []);
    const insight = { level, ...showdownOdds({ hole: hero.cards, board, opponents }) };
    if (level === 1) return insight;
    const legal = this.legalActions();
    const call = legal.call ?? 0;
    const callPot = contestablePot(seats, hero.invested + call);
    insight.callEquity = call ? call / (callPot + call) : null;
    if (level === 3) {
      const position = seats.map(seat => {
        const { index, profile, stack, status, invested, streetBet, actedAt, terrified } = seat;
        return { index, profile, stack, status, invested, streetBet, actedAt, terrified, live: inHand(seat) };
      });
      insight.advice = bettingAdvice({
        hole: hero.cards, board, seats: position, legal, currentBet: this.#betToMatch(hero),
        pot, bigBlind: this.venue.bigBlind,
      });
    }
    return insight;
  }

  #record(message) {
    this.log.push(message);
  }

  #commit(seat, requested) {
    const paid = Math.min(seat.stack, requested);
    seat.stack -= paid;
    seat.streetBet += paid;
    seat.invested += paid;
    if (seat.stack === 0) seat.status = 'all-in';
  }

  #nextSeat(from, matches) {
    for (let offset = 1; offset <= this.seats.length; offset++) {
      const index = (from + offset) % this.seats.length;
      if (matches(this.seats[index])) return index;
    }
    return null;
  }

  #clockwise() {
    return this.seats.map((_, offset) => this.seats[(this.button + offset + 1) % this.seats.length]);
  }

  #betToMatch(seat) {
    if (this.seats.some(other => other !== seat && canAct(other))) return this.currentBet;
    // With nobody left to raise, only chips actually committed can be owed.
    const others = this.seats.filter(other => other !== seat && inHand(other));
    return Math.max(seat.streetBet, ...others.map(other => other.streetBet));
  }

  #progress(from) {
    const live = this.seats.filter(inHand);
    if (live.length === 1) {
      this.#settle(false, live);
      return;
    }
    const active = live.filter(canAct);
    this.actor = this.#nextSeat(from, seat => {
      if (!canAct(seat)) return false;
      if (active.length === 1) return seat.streetBet < this.#betToMatch(seat);
      return seat.actedAt === null || seat.streetBet < this.currentBet;
    });
    if (this.actor === null && this.phase === 'river') this.#settle(true, live);
  }

  #settle(showdown, live) {
    const scores = new Map();
    if (showdown) {
      for (const seat of live) scores.set(seat.index, evaluate([...seat.cards, ...this.board]));
    }
    const payouts = this.seats.map(() => 0);
    const refunds = this.seats.map(() => 0);
    const ordered = this.#clockwise();

    for (const { contributors, amount } of potLayers(ordered)) {
      if (contributors.length === 1) {
        refunds[contributors[0].index] += amount;
        continue;
      }
      const eligible = contributors.filter(inHand);
      const candidates = eligible.length ? eligible : ordered.filter(inHand);
      const topScore = Math.max(...candidates.map(seat => scores.get(seat.index) ?? 0));
      const winners = candidates.filter(seat => (scores.get(seat.index) ?? 0) === topScore);
      const share = Math.floor(amount / winners.length);
      const odd = amount % winners.length;
      winners.forEach((seat, index) => { payouts[seat.index] += share + Number(index < odd); });
    }
    for (const seat of this.seats) seat.stack += payouts[seat.index] + refunds[seat.index];
    const net = payouts[0] + refunds[0] - this.hero.invested;
    if (net > 0) {
      this.energy = Math.min(MAX_ENERGY, this.energy + ENERGY_RECOVERY);
      this.#runWinnings += net;
    }
    let bloodMarkerMessage = '';
    if (this.bloodMarker) {
      const heroScore = scores.get(0);
      const beaten = this.bloodMarker.seats.filter(index => scores.has(index) && heroScore > scores.get(index)).length;
      if (beaten) {
        const reward = BLOOD_MARKER_REWARD + (beaten === 2 && this.bloodMarker.level === 3 ? 20 : 0);
        const gained = Math.min(reward, MAX_ENERGY - this.energy);
        this.energy += gained;
        bloodMarkerMessage = `Blood Marker restored ${gained} energy`;
      } else {
        bloodMarkerMessage = 'Blood Marker went cold';
      }
    }
    this.result = {
      payouts, refunds, net, showdown, bloodMarkerMessage,
      hands: this.seats.map(seat => scores.has(seat.index) ? handName(scores.get(seat.index)) : null),
      winners: live.filter(seat => payouts[seat.index] > 0).map(seat => seat.index),
      pot: payouts.reduce((total, payout) => total + payout, 0),
    };
    for (const seat of this.seats) {
      const { index, name } = seat;
      const hand = this.result.hands[index];
      if (payouts[index]) this.#record(`${name} collected ${payouts[index]} chips${hand ? ` (${hand})` : ''}.`);
      if (refunds[index]) this.#record(`${name} took back ${refunds[index]} uncalled chips.`);
    }
    if (bloodMarkerMessage) this.#record(`${bloodMarkerMessage}.`);
    this.actor = null;
    this.phase = 'settled';
  }
}
