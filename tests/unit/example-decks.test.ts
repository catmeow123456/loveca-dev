import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { DeckConfigSchema, type DeckConfig } from '../../src/domain/card-data/deck-loader';
import { validateDeckConfig } from '../../src/domain/rules/deck-construction';
import { normalizeCardCode } from '../../src/shared/utils/card-code';
import { resolveBuiltInDeckPointTableRules } from '../../client/src/lib/deckPointTableClient';

const EXAMPLE_DECKS = [
  ['decklog-1Y9J3S.yaml', 'Liella! 加分星', '熱血解放', 6],
  ['decklog-222H9S.yaml', 'Liella! 可香三神', 'クーカー三神0809', 5],
  ['decklog-1YWYS4.yaml', "μ's DGG混合", '宴確定', 2],
  ['decklog-N33A0.yaml', '彩虹混合', '5ダイヤLU', 9],
] as const;

const CRAWL_DATE_POINT_TABLE = resolveBuiltInDeckPointTableRules(
  new Date('2026-08-12T00:00:00.000+08:00')
);

function readExampleDeck(filename: string): DeckConfig {
  const path = fileURLToPath(new URL(`../../assets/decks/${filename}`, import.meta.url));
  return DeckConfigSchema.parse(yaml.parse(readFileSync(path, 'utf8')));
}

describe('DeckLog example decks', () => {
  it.each(EXAMPLE_DECKS)(
    '%s uses a curated display name, preserves its source title, and remains legal under the 2026-08-12 point table',
    (file, displayName, sourceTitle, pointTotal) => {
      const deck = readExampleDeck(file);
      const validation = validateDeckConfig(deck, CRAWL_DATE_POINT_TABLE);

      expect(deck.player_name).toBe(displayName);
      expect(validation.valid, validation.errors.join('\n')).toBe(true);
      expect(validation.stats).toMatchObject({
        memberCount: 48,
        liveCount: 12,
        energyCount: 12,
        pointTotal,
      });
      expect(deck.description).toContain(file.slice('decklog-'.length, -'.yaml'.length));
      expect(deck.description).toContain(sourceTitle);
    }
  );

  it('uses canonical card codes that all exist in the bundled card database with matching types', () => {
    const cardDatabasePath = fileURLToPath(
      new URL('../../llocg_db/json/cards.json', import.meta.url)
    );
    const rawCards = JSON.parse(readFileSync(cardDatabasePath, 'utf8')) as Record<
      string,
      { type?: string }
    >;
    const cards = new Map(
      Object.entries(rawCards).map(([code, card]) => [normalizeCardCode(code), card] as const)
    );

    for (const [file] of EXAMPLE_DECKS) {
      const deck = readExampleDeck(file);
      const typedEntries = [
        ...deck.main_deck.members.map((entry) => [entry, 'メンバー'] as const),
        ...deck.main_deck.lives.map((entry) => [entry, 'ライブ'] as const),
        ...deck.energy_deck.map((entry) => [entry, 'エネルギー'] as const),
      ];

      for (const [entry, expectedType] of typedEntries) {
        expect(entry.card_code).not.toContain('＋');
        expect(cards.get(entry.card_code)?.type, `${file}: ${entry.card_code}`).toBe(expectedType);
      }
    }
  });
});
