import { describe, expect, it } from 'vitest';
import { DeckConfigSchema } from '../../src/domain/card-data/deck-loader';

describe('deck loader schema', () => {
  it('主卡组条目限制 4 张，但能量卡组条目允许 12 张', () => {
    const baseDeck = {
      player_name: 'schema-test',
      main_deck: {
        members: [{ card_code: 'LL-bp1-001-N', count: 4 }],
        lives: [{ card_code: 'PL!-bp1-001-L', count: 4 }],
      },
      energy_deck: [{ card_code: 'LL-E-003-SD', count: 12 }],
    };

    expect(DeckConfigSchema.safeParse(baseDeck).success).toBe(true);
    expect(
      DeckConfigSchema.safeParse({
        ...baseDeck,
        main_deck: {
          ...baseDeck.main_deck,
          members: [{ card_code: 'LL-bp1-001-N', count: 5 }],
        },
      }).success
    ).toBe(false);
  });
});
