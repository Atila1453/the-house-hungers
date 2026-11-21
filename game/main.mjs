import { ABILITIES, ABILITY_BY_ID, abilityTargetLimit } from './abilities.mjs';
import { GameAudio } from './audio.mjs';
import { halfPotRaise } from './betting.mjs';
import { CARDS, SUITS, SUIT_NAMES, cardFace, evaluate, handName } from './cards.mjs';
import { HoldemTable, MAX_ENERGY } from './holdem.mjs';
import { OpeningStory } from './opening.mjs';
import { CASH_PER_CHIP, DIAMONDS, Progression } from './progression.mjs';
import { VENUES } from './venues.mjs';

const byId = id => document.getElementById(id);
const game = byId('game');
const panel = byId('panel');
const panelBody = byId('panel-body');
const audio = new GameAudio();
const opening = new OpeningStory(audio, () => {
  byId('table-view').hidden = false;
  byId('venues').hidden = false;
  syncMusic(.8);
  byId('deal').focus();
});
let timer;
let table;
let seatViews = [];
const tables = new Map();
const runAwards = new WeakMap();
const progression = new Progression();
const cardSuitLetters = { '♣': 'c', '♦': 'd', '♥': 'h', '♠': 's' };
const jewelerPortrait = expression => `./assets/characters/jeweler-${expression}.png`;
const phases = {
  ready: 'Ready', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', settled: 'Hand over',
};
const number = amount => amount.toLocaleString('en-GB');
const cash = amount => `$${number(amount)}`;
const carats = amount => `${number(amount)} ct`;
const opponentPortrait = (profile, expression = 'neutral') =>
  `./assets/characters/player-${profile.portrait}-${expression}.png`;
const cardSprite = id => `<img src="./assets/cards/card-${id}.png" alt="" width="40" height="56">`;
const percent = (value, exact = false) => `${exact ? '' : '≈'}${(value * 100).toFixed(1)}%`;

function cardMarkup(card) {
  if (card === null) return '<span class="card empty" aria-hidden="true"></span>';
  if (card === 'back') return `<span class="card" role="img" aria-label="Face-down card">${cardSprite('back')}</span>`;
  if (card.rank) {
    return `<span class="card known" role="img" aria-label="Privately revealed rank ${card.rank}">
      ${cardSprite('back-reveal')}<span class="rank-reveal" aria-hidden="true">${card.rank}</span>
    </span>`;
  }
  const privatelyRevealed = typeof card === 'object';
  const face = cardFace(privatelyRevealed ? card.known : card);
  const rank = /^\d$/.test(face.rank) ? `0${face.rank}` : face.rank.toLowerCase();
  const sprite = `${rank}${cardSuitLetters[face.suit]}`;
  if (privatelyRevealed) {
    return `<span class="card known" role="img" aria-label="Privately revealed ${face.name}">
      ${cardSprite('back-reveal')}${cardSprite(`${sprite}-reveal`)}
    </span>`;
  }
  return `<span class="card" role="img" aria-label="${face.name}">${cardSprite(sprite)}</span>`;
}

function renderCards(element, cards) {
  const key = JSON.stringify(cards);
  if (element.dataset.cards !== key) {
    element.innerHTML = cards.map(cardMarkup).join('');
    element.dataset.cards = key;
  }
}

function hiddenCard(slot, seat) {
  const known = table.knownCard(slot, seat);
  if (known !== null) return { known };
  const rank = table.knownRank(slot, seat);
  return rank === null ? 'back' : { rank };
}

function canVisitShop() {
  return [...tables.values()].every(item => item.hand === 0 || item.runFinished);
}

function openVenue(venue, reset = false) {
  if (!progression.isVenueUnlocked(venue)) return;
  if (!tables.has(venue.id)) {
    for (const profile of venue.opponents) {
      for (const expression of ['happy', 'scared']) {
        new Image().src = opponentPortrait(profile, expression);
      }
    }
  }
  if (reset || !tables.has(venue.id)) tables.set(venue.id, new HoldemTable(venue));
  table = tables.get(venue.id);
  game.dataset.venue = venue.id;
  byId('venue-name').textContent = venue.name;
  byId('venue-blinds').textContent = `${venue.smallBlind} / ${venue.bigBlind} blinds`;
  byId('dealer-name').textContent = `Dealer ${venue.dealer.name}`;
  byId('dealer-portrait').src = `./assets/characters/dealer-${venue.dealer.portrait}.png`;
  byId('seats').innerHTML = venue.opponents.map(profile => `
    <div class="seat" aria-label="${profile.name}, difficulty ${profile.rating}">
      <div class="seat-portrait">
        <img src="${opponentPortrait(profile)}" alt="" width="64" height="64">
        <span class="button-marker" title="Dealer button" hidden>D</span>
        <span class="blood-mark" role="img" aria-label="Marked by the symbiote" title="Blood Marker" hidden>◆</span>
        <div class="cards seat-cards"></div>
      </div>
      <div class="seat-data">
        <span class="seat-name" title="${profile.name}">${profile.name}</span>
        <span class="seat-stack"></span>
      </div>
      <span class="seat-action" hidden></span>
    </div>`).join('');
  seatViews = [...document.querySelectorAll('.seat')].map(element => ({
    element,
    portrait: element.querySelector('.seat-portrait img'),
    stack: element.querySelector('.seat-stack'),
    action: element.querySelector('.seat-action'),
    marker: element.querySelector('.button-marker'),
    bloodMark: element.querySelector('.blood-mark'),
    cards: element.querySelector('.seat-cards'),
  }));
  syncMusic();
  render();
}

function renderSeat(seat, view) {
  const won = table.result?.winners.includes(seat.index) ?? false;
  const scared = (table.playing && Boolean(seat.terrified)) || seat.lastAction === 'Spooked';
  const portrait = opponentPortrait(seat.profile, won ? 'happy' : scared ? 'scared' : 'neutral');
  if (view.portrait.getAttribute('src') !== portrait) view.portrait.src = portrait;
  const revealed = Boolean(table.result?.hands[seat.index]);
  view.element.dataset.state = seat.status;
  view.element.dataset.current = table.actor === seat.index;
  view.element.dataset.terrified = scared;
  view.element.dataset.winner = won;
  view.stack.textContent = number(seat.stack);
  view.marker.hidden = table.button !== seat.index;
  const action = won ? `Won ${number(table.result.payouts[seat.index])}`
    : seat.terrified ? 'Shaken'
    : seat.status === 'out' ? 'Out'
    : seat.lastAction;
  view.action.textContent = action;
  view.action.hidden = !action;
  const showingBacks = table.playing && (seat.status === 'playing' || seat.status === 'all-in');
  const marked = showingBacks && table.bloodMarker?.seats.includes(seat.index) && table.hero.status !== 'folded';
  view.bloodMark.hidden = !marked;
  renderCards(view.cards, revealed ? seat.cards : showingBacks ? [hiddenCard(0, seat.index), hiddenCard(1, seat.index)] : []);
}

function statusText() {
  if (table.phase === 'ready') return `${table.venue.dealer.name} is ready to deal.`;
  if (table.actor === 0) return 'Your move';
  if (table.actor !== null) return `${table.seats[table.actor].name} to act`;
  if (table.playing) return `${table.venue.dealer.name} is dealing…`;
  if (table.result.winners.length > 1) {
    return table.result.payouts[0] ? `You collected ${number(table.result.payouts[0])} chips` : 'The pot was split';
  }
  const winner = table.seats[table.result.winners[0]];
  if (!winner) return 'Hand complete';
  return `${winner.index === 0 ? 'You' : winner.name} won ${number(table.result.payouts[winner.index])} chips`;
}

function observationText() {
  if (table.result) {
    const winningHands = new Set(table.result.winners.map(index => table.result.hands[index]).filter(Boolean));
    const award = runAwards.get(table);
    const banked = award ? `${cash(award)} banked` : '';
    return [...winningHands, table.result.bloodMarkerMessage, banked].filter(Boolean).join(' · ');
  }
  const observations = [];
  if (table.insight) {
    const { win, exact } = table.insight;
    observations.push(`Showdown win ${percent(win, exact)}`);
  }
  if (table.reservedLabel) observations.push(`Next reveal ${table.reservedLabel}`);
  return observations.join(' · ');
}

function render() {
  const { hero, phase, playing, result } = table;
  if (table.runFinished && !runAwards.has(table)) {
    runAwards.set(table, progression.bankWinnings(table.takeRunWinnings()));
  }
  const legal = table.actor === 0 ? table.legalActions() : null;
  byId('street').textContent = phases[phase];
  byId('pot').textContent = number(result?.pot ?? table.pot);
  byId('stack').textContent = number(hero.stack);
  byId('player-button').hidden = table.button !== 0;
  byId('energy').textContent = `${table.energy} / ${MAX_ENERGY}`;
  byId('energy-fill').style.width = `${table.energy / MAX_ENERGY * 100}%`;
  byId('powers').setAttribute('aria-label', `Symbiote abilities, ${table.energy} energy out of ${MAX_ENERGY}`);
  byId('hand-number').textContent = table.hand ? `Hand ${table.hand}` : '5 seats';
  byId('history').hidden = !table.log.length;

  const currentHand = hero.status === 'folded' ? 'Folded'
    : hero.status === 'all-in' && playing ? 'All-in'
    : table.board.length >= 3 && hero.cards.length ? handName(evaluate([...table.board, ...hero.cards]))
    : '';
  byId('player-hand').textContent = currentHand;
  byId('player-hand').hidden = !currentHand;
  renderCards(byId('board'), Array.from({ length: 5 }, (_, index) =>
    table.board[index] ?? (table.communityIsHidden(index) ? hiddenCard(index) : null)));
  renderCards(byId('hole'), [hero.cards[0] ?? null, hero.cards[1] ?? null]);
  table.seats.slice(1).forEach((seat, index) => renderSeat(seat, seatViews[index]));

  const status = statusText();
  if (byId('status').textContent !== status) byId('status').textContent = status;
  const observation = observationText();
  byId('observation').textContent = observation;
  byId('observation').hidden = !observation;

  byId('deal').hidden = !table.canDeal;
  byId('deal').textContent = table.hand ? 'Next hand' : 'Deal hand';
  byId('reset').hidden = playing || table.canDeal;
  byId('reset').textContent = hero.stack > 0 ? 'Play again' : 'Rebuy';
  byId('shop').hidden = !canVisitShop();
  byId('fold').hidden = !playing;
  byId('match').hidden = !playing;
  byId('raise').hidden = !playing;
  byId('fold').disabled = !legal;
  byId('match').disabled = !legal;
  byId('raise').disabled = !legal?.raise;
  byId('match').textContent = legal?.call ? `Call ${number(legal.call)}` : 'Check';
  byId('raise').textContent = table.currentBet ? 'Raise' : 'Bet';
  scheduleTurn();
}

function scheduleTurn() {
  clearTimeout(timer);
  if (opening.active || panel.open || !table.playing || table.actor === 0) return;
  const delay = table.actor === null ? 660 : 390;
  timer = setTimeout(() => {
    if (table.actor === null) table.advanceStreet();
    else table.playBot();
    render();
  }, delay);
}

function heroAction(type, amount) {
  if (table.act(0, { type, amount })) render();
}

function syncMusic(fade) {
  if (opening.active) return;
  audio.playMusic((panel.open && panel.dataset.track) || table.venue.id, fade);
}

function showPanel(title, contents, track = '') {
  clearTimeout(timer);
  const trackChanged = (panel.dataset.track ?? '') !== track;
  panel.dataset.track = track;
  byId('panel-title').textContent = title;
  panelBody.innerHTML = contents;
  if (!panel.open) panel.showModal();
  else byId('close-panel').focus();
  panel.scrollTop = 0;
  if (trackChanged) syncMusic();
}

function showSettings() {
  showPanel('Settings', `
    <div class="audio-settings">
      ${[['music', 'Music volume'], ['effects', 'Sound effects volume']].map(([channel, label]) => `
        <div class="volume-setting">
          <label for="volume-${channel}">${label}</label>
          <output for="volume-${channel}" aria-hidden="true">${audio.volume(channel)}%</output>
          <input id="volume-${channel}" data-channel="${channel}" type="range"
            min="0" max="100" value="${audio.volume(channel)}">
        </div>`).join('')}
    </div>
    <button id="reset-game" class="panel-button danger" type="button">Reset game</button>
  `);
  panelBody.querySelectorAll('[data-channel]').forEach(input => {
    input.addEventListener('input', () => {
      const volume = input.valueAsNumber;
      audio.unlock();
      audio.setVolume(input.dataset.channel, volume);
      input.previousElementSibling.value = `${volume}%`;
    });
  });
  byId('reset-game').addEventListener('click', showResetConfirmation);
}

function showResetConfirmation() {
  showPanel('Reset game?', `
    <p class="panel-intro">This deletes your cash, diamonds, upgrades and venue unlocks, and restarts the opening story.</p>
    <div class="reset-actions">
      <button id="cancel-reset" class="panel-button" type="button">Cancel</button>
      <button id="confirm-reset" class="panel-button danger" type="button">Delete save and restart</button>
    </div>
    <p id="reset-error" class="panel-intro" role="status" hidden>Could not delete your save. Try again.</p>
  `);
  byId('cancel-reset').focus();
  byId('cancel-reset').addEventListener('click', () => {
    showSettings();
    byId('reset-game').focus();
  });
  byId('confirm-reset').addEventListener('click', () => {
    if (progression.reset()) {
      panel.close();
      restartGame();
    } else {
      byId('reset-error').hidden = false;
    }
  });
}

function restartGame() {
  clearTimeout(timer);
  tables.clear();
  byId('table-view').hidden = true;
  byId('venues').hidden = true;
  opening.open();
  openVenue(VENUES[0]);
}

function showVenues() {
  showPanel('Choose a venue', `
    <div class="balances"><span>Cash <strong>${cash(progression.cash)}</strong></span></div>
    <div class="panel-list">${VENUES.map(venue => {
      const locked = !progression.isVenueUnlocked(venue);
      const canAfford = progression.cash >= venue.entryCost;
      return `<button class="target venue" type="button" data-venue-id="${venue.id}"
          aria-current="${venue === table.venue}" ${locked && !canAfford ? 'disabled' : ''}>
        <img src="./assets/${venue.id}.png" alt="" width="54" height="54">
        <span>
          <strong>${venue.name}</strong>
          <small>Bots ${venue.difficulty} · ${venue.smallBlind} / ${venue.bigBlind} blinds</small>
          <small>${venue.description}</small>
          ${locked ? `<small class="reason">${canAfford ? 'Unlock and enter' : 'Locked'} · ${cash(venue.entryCost)}</small>` : ''}
        </span>
      </button>`;
    }).join('')}</div>`);
  panelBody.querySelectorAll('[data-venue-id]').forEach(button => button.addEventListener('click', () => {
    const venue = VENUES.find(item => item.id === button.dataset.venueId);
    if (!progression.unlockVenue(venue.id)) return;
    panel.close();
    if (venue !== table.venue) openVenue(venue);
  }));
}

function showShop(purchased) {
  if (!canVisitShop()) return;
  const award = runAwards.get(table);
  const message = purchased ? `Bought a ${purchased.name.toLowerCase()} (${carats(purchased.carats)}).`
    : award ? `${cash(award)} from your last table run.`
    : `Earn ${cash(CASH_PER_CHIP)} per chip of profit on winning hands. Collect it when the table run ends.`;
  showPanel('Jewellery Shop', `
    <div class="shop-scene">
      <img src="${jewelerPortrait(purchased ? 'happy' : 'neutral')}" alt="${purchased ? 'The jeweler smiles' : 'The jeweler behind the counter'}" width="96" height="96">
    </div>
    <div class="balances">
      <span>Cash <strong>${cash(progression.cash)}</strong></span>
      <span>Diamonds <strong>${carats(progression.carats)}</strong></span>
    </div>
    <p class="panel-intro" role="status">${message}</p>
    <div class="panel-list">${DIAMONDS.map(diamond => `
      <button class="target shop-item" type="button" data-buy="${diamond.id}" ${progression.cash < diamond.price ? 'disabled' : ''}>
        <span class="shop-gem" aria-hidden="true">◆</span>
        <span><strong>${diamond.name}</strong><small>${carats(diamond.carats)}</small></span>
        <span class="cost">${cash(diamond.price)}</span>
      </button>`).join('')}</div>
  `, 'jewellery-shop');
  new Image().src = jewelerPortrait('happy');
  panelBody.querySelectorAll('[data-buy]').forEach(button => button.addEventListener('click', () => {
    if (canVisitShop() && progression.buy(button.dataset.buy)) {
      showShop(DIAMONDS.find(diamond => diamond.id === button.dataset.buy));
    }
  }));
}

function levelMeter(level) {
  return `<span class="level-meter" role="img" aria-label="Level ${level} of 3">
    ${[1, 2, 3].map(rank => `<span class="${rank <= level ? 'filled' : ''}"></span>`).join('')}
  </span>`;
}

function insightMarkup(insight) {
  if (!insight || insight.level === 1) return '';
  const actionName = option => option.amount === undefined ? option.label
    : `${option.label} ${number(option.amount)} (½ pot)`;
  const chipValue = value => new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 1, signDisplay: 'exceptZero',
  }).format(value);
  return `<div class="insight-readout">
    <p>Estimated showdown equity <strong>${percent(insight.equity, insight.exact)}</strong></p>
    <p>${insight.callEquity === null ? 'You can check for free.'
      : `Break-even equity to call <strong>${percent(insight.callEquity, true)}</strong>`}</p>
    ${insight.advice ? `
      <p>Estimated best action <strong>${actionName(insight.advice.best)}</strong></p>
      <ul>${insight.advice.options.map(option =>
        `<li>${actionName(option)} <strong>${chipValue(option.value)} chips</strong></li>`).join('')}</ul>
      <p class="panel-intro">Estimates one response per opponent and no further betting.</p>
    ` : ''}
  </div>`;
}

function showPowers(message = '', revealedCards = []) {
  showPanel('Symbiote abilities', `
    <p class="panel-intro" role="status">${message || `${table.energy} / ${MAX_ENERGY} energy. Winning chips restores energy.`}</p>
    ${revealedCards.length ? `<div class="cards card-reveal">${revealedCards.map(cardMarkup).join('')}</div>` : ''}
    ${insightMarkup(table.insight)}
    <button id="feed-diamonds" class="target resource-button" type="button">
      <strong>Feed &amp; upgrade</strong>
      <span class="cost">${number(progression.essence)} Vitriolic Essence</span>
    </button>
    <div class="panel-list">${ABILITIES.map(ability => {
      const level = progression.abilityLevel(ability.id);
      const reason = table.abilityReason(ability.id, level);
      return `<button class="target ability" type="button" data-power="${ability.id}" ${reason ? 'disabled' : ''}>
        <img src="./assets/abilities/${ability.id}.png" alt="" width="32" height="32">
        <strong>${ability.name}</strong>
        <span class="cost">${ability.cost} energy</span>
        <span class="ability-details">
          <span class="level-row">${levelMeter(level)} <small>Level ${level}</small></span>
          <small>${ability.levels[level - 1]}</small>
          ${reason ? `<small class="reason">${reason}</small>` : ''}
        </span>
      </button>`;
    }).join('')}</div>
    <button id="cheat-codes" class="panel-button full" type="button">Cheat codes</button>`);
  byId('feed-diamonds').addEventListener('click', () => showFeeding());
  byId('cheat-codes').addEventListener('click', () => showCheatCodes());
  panelBody.querySelectorAll('[data-power]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.power;
    if (id === 'peek' || id === 'swap') showCardTargets(id);
    else if (id === 'inhuman') cast(id);
    else if (id === 'mind') showMindControl();
    else showOpponents(id);
  }));
}

function showCheatCodes(message = '') {
  showPanel('Cheat codes', `
    <div class="balances">
      <span>Cash <strong>${cash(progression.cash)}</strong></span>
      <span>Vitriolic Essence <strong>${number(progression.essence)}</strong></span>
    </div>
    ${message ? `<p class="panel-intro" role="status">${message}</p>` : ''}
    <form class="cheat-form">
      <label for="cheat-code">Code</label>
      <input id="cheat-code" name="code" type="text" maxlength="24" required autocomplete="off" spellcheck="false" autocapitalize="characters">
      <button class="panel-button primary" type="submit">Redeem</button>
    </form>`);
  panelBody.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const code = byId('cheat-code').value.trim().toUpperCase();
    if (!progression.redeemCode(code)) {
      showCheatCodes('Unknown code.');
    } else {
      showCheatCodes(code === 'BALLER' ? 'Added $1,000,000 to your wallet.'
        : 'Added 10,000 Vitriolic Essence and unlocked both diamond gates.');
    }
    byId('cheat-code').focus();
  });
  backButton();
}

const canUpgradeBetweenHands = () => [...tables.values()].every(item => !item.playing);

function showFeeding(message = '') {
  const canUpgrade = canUpgradeBetweenHands();
  showPanel('Feed the symbiote', `
    <div class="balances">
      <span>Diamonds <strong>${carats(progression.carats)}</strong></span>
      <span>Vitriolic Essence <strong>${number(progression.essence)}</strong></span>
    </div>
    <p class="panel-intro" role="status">${message || (progression.carats
      ? 'Each carat yields 1 Vitriolic Essence.'
      : 'Buy diamonds at the Jewellery Shop between table runs.')}</p>
    <div class="panel-list">${DIAMONDS.filter(diamond => progression.inventory[diamond.id]).map(diamond => `
      <button class="target" type="button" data-feed="${diamond.id}">
        <span><strong>Feed ${carats(diamond.carats)} diamond</strong><small>${number(progression.inventory[diamond.id])} in inventory</small></span>
        <span class="cost">+${diamond.carats} Essence</span>
      </button>`).join('')}</div>
    ${canUpgrade ? '' : '<p class="upgrade-requirement">Finish active hands to upgrade.</p>'}
    ${ABILITIES.map(({ id, name, levels }) => {
      const level = progression.abilityLevel(id);
      const cost = progression.upgradeCost(id);
      const gateMet = progression.upgradeGateMet(id);
      return `<section class="upgrade" aria-label="${name} upgrade">
        <div class="upgrade-heading">
          <img src="./assets/abilities/${id}.png" alt="" width="32" height="32">
          <strong>${name}</strong>
          ${levelMeter(level)}
        </div>
        <dl class="upgrade-levels">
          <dt>Current · Level ${level}</dt><dd>${levels[level - 1]}</dd>
          ${cost ? `<dt>After upgrade · Level ${level + 1}</dt><dd>${levels[level]}</dd>` : ''}
        </dl>
        ${cost ? `
          ${gateMet ? '' : `<p class="upgrade-requirement">Feed a diamond of at least ${carats(cost)} to unlock.</p>`}
          <button class="panel-button full" type="button" data-upgrade="${id}"
            ${canUpgrade && gateMet && progression.essence >= cost ? '' : 'disabled'}>
            Upgrade to level ${level + 1} · ${cost} Essence
          </button>` : '<p class="upgrade-requirement">Maximum level reached.</p>'}
      </section>`;
    }).join('')}
  `);
  panelBody.querySelectorAll('[data-feed]').forEach(button => button.addEventListener('click', () => {
    const diamond = DIAMONDS.find(item => item.id === button.dataset.feed);
    if (progression.feed(diamond.id)) showFeeding(`Gained ${diamond.carats} Vitriolic Essence.`);
  }));
  panelBody.querySelectorAll('[data-upgrade]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.upgrade;
    if (canUpgradeBetweenHands() && progression.upgrade(id)) {
      showFeeding(`${ABILITY_BY_ID.get(id).name} reached level ${progression.abilityLevel(id)}.`);
      const next = panelBody.querySelector(`[data-upgrade="${id}"]`);
      (next ?? panelBody.querySelector(`[aria-label="${ABILITY_BY_ID.get(id).name} upgrade"]`))?.scrollIntoView({ block: 'nearest' });
    }
  }));
  backButton();
}

function cast(id, target) {
  const message = table.cast(id, { ...target, level: progression.abilityLevel(id) });
  if (message) {
    if (id === 'terrify') panel.close();
    render();
    if (id === 'peek') showPowers(message, target.targets.map(({ slot, seat }) => hiddenCard(slot, seat)));
    else if (id !== 'terrify') showPowers(message);
  }
}

function backButton() {
  const button = document.createElement('button');
  button.className = 'panel-button full';
  button.type = 'button';
  button.textContent = 'Back to abilities';
  button.addEventListener('click', () => showPowers());
  panelBody.append(button);
}

function bindTargets(targets, limit, apply) {
  const buttons = [...panelBody.querySelectorAll('[data-target]')];
  const confirm = byId('confirm-targets');
  const selected = new Set();
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.target);
      if (!confirm) {
        apply([targets[index]]);
        return;
      }
      if (!selected.delete(index)) selected.add(index);
      for (const item of buttons) {
        const active = selected.has(Number(item.dataset.target));
        item.setAttribute('aria-pressed', String(active));
        item.disabled = !active && selected.size >= limit;
      }
      confirm.disabled = !selected.size;
      confirm.textContent = selected.size ? `Cast with ${selected.size} selected` : 'Cast';
    });
  }
  confirm?.addEventListener('click', () => apply([...selected].map(index => targets[index])));
}

function confirmTargets(limit) {
  return limit > 1
    ? '<button id="confirm-targets" class="panel-button primary full" type="button" disabled>Cast</button>'
    : '';
}

function showOpponents(id) {
  const ability = ABILITY_BY_ID.get(id);
  const level = progression.abilityLevel(id);
  const limit = abilityTargetLimit(id, level);
  const targets = table.abilityTargets(id, level);
  showPanel(ability.name, `
    <p class="panel-intro">${ability.levels[level - 1]}</p>
    <div class="panel-list">${targets.map((seat, index) => `
      <button class="target" type="button" data-target="${index}" ${limit > 1 ? 'aria-pressed="false"' : ''}>
        <img src="${opponentPortrait(seat.profile, seat.terrified ? 'scared' : 'neutral')}" alt="" width="40" height="40">
        <strong>${seat.name}</strong>
        <span class="cost">${number(seat.stack)} chips</span>
      </button>`).join('')}</div>
    ${confirmTargets(limit)}`);
  bindTargets(targets, limit, selection => {
    if (id === 'terrify') cast(id, { seat: selection[0].index });
    else cast(id, { targets: selection.map(seat => seat.index) });
  });
  backButton();
}

function showCardTargets(id) {
  const ability = ABILITY_BY_ID.get(id);
  const level = progression.abilityLevel(id);
  const limit = abilityTargetLimit(id, level);
  const targets = table.abilityTargets(id, level);
  const groups = [undefined, ...table.seats.map(seat => seat.index)];
  showPanel(ability.name, `
    <p class="panel-intro">${ability.levels[level - 1]}</p>
    <div class="card-targets">${groups.map(seat => {
      const cards = targets.filter(target => target.seat === seat);
      if (!cards.length) return '';
      const name = seat === undefined ? 'Community cards' : seat === 0 ? 'Your cards' : table.seats[seat].name;
      return `<div class="card-target-row">
        <strong>${name}</strong>
        ${cards.map(target => {
          const { slot } = target;
          const label = seat === undefined ? table.cardTargetLabel(target) : slot === 0 ? 'Left' : 'Right';
          const card = seat === 0 ? table.hero.cards[slot] : hiddenCard(slot, seat);
          return `<button class="panel-button card-target" type="button" data-target="${targets.indexOf(target)}"
            ${limit > 1 ? 'aria-pressed="false"' : ''}
            aria-label="${table.cardTargetLabel(target)}">${cardMarkup(card)}${label}</button>`;
        }).join('')}
      </div>`;
    }).join('')}</div>
    ${confirmTargets(limit)}`);
  bindTargets(targets, limit, selection => cast(id, { targets: selection }));
  backButton();
}

function showMindControl() {
  const level = progression.abilityLevel('mind');
  const choices = table.abilityTargets('mind', level);
  const allowed = new Set(choices);
  const suits = Array.from({ length: 4 }, (_, index) => CARDS.slice(index * 13, (index + 1) * 13));
  showPanel('Mind Control', `
    <p class="panel-intro">${ABILITY_BY_ID.get('mind').levels[level - 1]} The cast costs energy even if the dealer finds no match.</p>
    ${level < 3 ? `<div class="suit-row">${choices.map((choice, index) => `
      <button class="panel-button" type="button" data-choice="${index}"
        aria-label="${level === 1 ? SUIT_NAMES[SUITS.indexOf(choice)] : choice}">${choice}</button>
    `).join('')}</div>` : `<div class="card-select">${suits.map(suit => `<div class="suit-row">${suit.map(card => {
      const face = cardFace(card);
      return `<button class="panel-button" type="button" data-card="${card}"
        aria-label="${face.name}" ${allowed.has(card) ? '' : 'disabled'}>${cardMarkup(card)}</button>`;
    }).join('')}</div>`).join('')}</div>`}`);
  panelBody.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
    cast('mind', { choice: choices[Number(button.dataset.choice)] });
  }));
  panelBody.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => {
    cast('mind', { card: Number(button.dataset.card) });
  }));
  backButton();
}

function showRaise() {
  if (table.actor !== 0) return;
  const legal = table.legalActions();
  if (!legal.raise) return;
  const { min, max } = legal.raise;
  const label = table.currentBet ? 'Raise to' : 'Bet';
  const pot = table.pot + (legal.call ?? 0);
  const clamp = amount => Math.max(min, Math.min(max, amount));
  const presets = [
    ['Min', min], ['½ pot', halfPotRaise(legal, table.currentBet, table.pot)],
    ['Pot', clamp(table.currentBet + pot)], ['All-in', max],
  ];
  showPanel(label, `
    <p class="panel-intro">Total chips to put in on this street. ${number(min)}–${number(max)} chips.</p>
    <form class="raise-form">
      <div class="raise-controls">
        <input type="range" aria-label="Wager slider" min="${min}" max="${max}" value="${min}">
        <input type="number" inputmode="numeric" aria-label="Wager amount" min="${min}" max="${max}" value="${min}" required>
      </div>
      <div class="presets">
        ${presets.map(([name, value]) => `<button class="panel-button" type="button" data-amount="${value}">${name}</button>`).join('')}
      </div>
      <button class="panel-button primary" type="submit">${label} ${number(min)}</button>
    </form>`);
  const form = panelBody.querySelector('form');
  const slider = form.querySelector('[type="range"]');
  const input = form.querySelector('[type="number"]');
  const submit = form.querySelector('[type="submit"]');
  const update = () => {
    const value = input.valueAsNumber;
    submit.disabled = !input.validity.valid;
    submit.textContent = submit.disabled ? label : `${label} ${number(value)}`;
  };
  const setAmount = value => {
    input.value = value;
    slider.value = value;
    update();
  };
  slider.addEventListener('input', () => setAmount(slider.value));
  input.addEventListener('input', () => {
    if (input.validity.valid) slider.value = input.value;
    update();
  });
  form.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => setAmount(button.dataset.amount)));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    panel.close();
    heroAction('raise', input.valueAsNumber);
  });
}

byId('settings').addEventListener('click', showSettings);
byId('venues').addEventListener('click', showVenues);
byId('shop').addEventListener('click', () => showShop());
byId('powers').addEventListener('click', () => showPowers());
byId('deal').addEventListener('click', () => {
  if (table.deal()) render();
});
byId('reset').addEventListener('click', () => openVenue(table.venue, true));
byId('fold').addEventListener('click', () => heroAction('fold'));
byId('match').addEventListener('click', () => heroAction(table.legalActions()?.check ? 'check' : 'call'));
byId('raise').addEventListener('click', showRaise);
byId('close-panel').addEventListener('click', () => panel.close());
panel.addEventListener('close', () => {
  if (!panel.open && panel.dataset.track) {
    delete panel.dataset.track;
    syncMusic();
  }
  scheduleTurn();
});
byId('history').addEventListener('click', () => showPanel(`Hand ${table.hand} log`, `
  <ol class="history">${table.log.map(line => `<li>${line}</li>`).join('')}</ol>`));
byId('help').addEventListener('click', () => showPanel('How to play', `
  <p class="panel-intro">Win the pot by making the best five-card hand or getting the other players to fold.</p>
  <ul class="help-copy">
    <li>Use any five cards from your two private cards and the five cards revealed in the centre.</li>
    <li>Check to pass when no chips are owed. Call to match, bet or raise to put in more, or fold to give up the hand.</li>
    <li>The dealer reveals three cards on the flop, one on the turn, and one on the river. Players still in the hand show their cards after the last betting round.</li>
    <li>Tap the symbiote on your turn to spend energy on an ability. Earn energy when you finish a hand ahead in chips.</li>
    <li>Bank winnings when a table run ends. Use cash to unlock casinos or buy diamonds at the Jewellery Shop to feed your symbiote.</li>
  </ul>`));

restartGame();
