export const ABILITIES = [
  {
    id: 'terrify', name: 'Terrifying Presence', cost: 25,
    levels: [
      'Stop one opponent from betting or raising on their next action.',
      'One opponent checks if possible and folds when facing a bet.',
      'One opponent folds on their next action.',
    ],
  },
  {
    id: 'mind', name: 'Mind Control', cost: 40,
    levels: [
      'Name a suit for the next community reveal.',
      'Name a rank for the next community reveal.',
      'Name the exact card for the next community reveal.',
    ],
  },
  {
    id: 'peek', name: 'Diamond Eyes', cost: 12,
    levels: [
      'Privately see the rank of one hidden card.',
      'Privately see one hidden card in full.',
      'Privately see up to two hidden cards in full.',
    ],
  },
  {
    id: 'swap', name: 'Lightning Speed', cost: 20,
    levels: [
      'Blindly replace one of your cards.',
      'Blindly replace a player card or a hidden turn or river.',
      'Blindly replace up to two player cards or hidden turn or river cards.',
    ],
  },
  {
    id: 'blood-marker', name: 'Blood Marker', cost: 25,
    levels: [
      'Mark one opponent before the turn. Beat them at showdown to recover up to 35 energy.',
      'Mark up to two opponents before the turn. Beat either at showdown to recover up to 35 energy.',
      'Mark up to two opponents before the turn. Beat both at showdown to recover up to 55 energy.',
    ],
  },
  {
    id: 'inhuman', name: 'Inhuman Mind', cost: 15,
    levels: [
      'Estimate your chances of winning or tying at showdown.',
      'Also see your estimated pot share and the break-even equity to call.',
      'Also compare the chip value of folding, checking or calling, and a half-pot bet or raise.',
    ],
  },
];

export const ABILITY_BY_ID = new Map(ABILITIES.map(ability => [ability.id, ability]));
export const UPGRADE_COSTS = [0, 3, 6];

export function abilityTargetLimit(id, level) {
  if (id === 'blood-marker') return level >= 2 ? 2 : 1;
  return level === 3 && (id === 'peek' || id === 'swap') ? 2 : 1;
}
