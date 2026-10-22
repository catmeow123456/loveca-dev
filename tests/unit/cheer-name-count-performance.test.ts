import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { countCurrentLiveRevealedDifferentNamedCheerCards } from '../../src/application/effects/cheer-selection';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { CardType } from '../../src/shared/types/enums';

const LIELLA_NAMES = [
  ['澁谷かのん', '涩谷香音'],
  ['唐可可', '唐可可'],
  ['嵐千砂都', '岚千砂都'],
  ['平安名すみれ', '平安名堇'],
  ['葉月恋', '叶月恋'],
  ['桜小路きな子', '樱小路希奈子'],
  ['米女メイ', '米女芽衣'],
  ['若菜四季', '若菜四季'],
  ['鬼塚夏美', '鬼冢夏美'],
  ['ウィーン・マルガレーテ', '薇恩・玛格丽特'],
  ['鬼塚冬毬', '鬼冢冬毬'],
] as const;

// Always-on regression: four copies per member made the old subset search take seconds.
// The generous one-second budget catches that regression without requiring benchmark hardware.
describe('revealed cheer different-name count performance', () => {
  it.each([false, true])(
    'counts 44 duplicate/alias cards promptly (DUO: %s)',
    (withDuo) => {
      const cards = Array.from({ length: 4 }, (_, copy) =>
        LIELLA_NAMES.map((aliases, index) => {
          const name = aliases[copy % 2];
          const data: MemberCardData = {
            cardCode: `CHEER-PERF-${index}`,
            name: withDuo && index === 0 ? `${name}&唐可可` : name,
            groupNames: ['Liella!'],
            cardType: CardType.MEMBER,
            cost: 2,
            blade: 1,
            hearts: [],
          };
          return createCardInstance(data, 'p1', `cheer-${copy}-${index}`);
        })
      ).flat();
      let game = registerCards(createGameState('cheer-perf', 'p1', 'P1', 'p2', 'P2'), cards);
      const ids = cards.map((card) => card.instanceId);
      game = { ...game, liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: ids } };
      game = emitGameEvent(game, createCheerEvent('p1', ids, ids.length, { automated: true }));

      const start = performance.now();
      const result = countCurrentLiveRevealedDifferentNamedCheerCards(game, 'p1', {
        cardTypes: CardType.MEMBER,
        groupAliases: ['Liella!'],
      });
      const elapsedMs = performance.now() - start;

      expect(result.matchingCardIds).toEqual(ids);
      expect(result.differentNameCount).toBe(11);
      expect(result.normalizedNames).toEqual(LIELLA_NAMES.map(([name]) => name.replace(/・/g, '')));
      expect(elapsedMs).toBeLessThan(1_000);
    },
    30_000
  );
});
