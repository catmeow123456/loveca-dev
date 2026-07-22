import type { CardEntry, DeckConfig } from './deck-loader.js';
import { ENERGY_DECK_SIZE } from '../rules/deck-validator.js';

export const DEFAULT_ENERGY_CARD_CODE = 'LL-E-001-SD';

export function createDefaultEnergyDeck(): CardEntry[] {
  return [{ card_code: DEFAULT_ENERGY_CARD_CODE, count: ENERGY_DECK_SIZE }];
}

export function createNewDeckConfig(
  playerName: string = '新卡组',
  description: string = ''
): DeckConfig {
  return {
    player_name: playerName,
    description,
    main_deck: { members: [], lives: [] },
    energy_deck: createDefaultEnergyDeck(),
  };
}
