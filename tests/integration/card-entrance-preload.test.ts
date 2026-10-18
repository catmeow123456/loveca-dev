import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import type { GameState } from '../../src/domain/entities/game';
import { CardType } from '../../src/shared/types/enums';
import { collectEntranceAssetIds } from '../../src/shared/card-entrance';

const deck = (codes: string[]): DeckConfig => ({
  mainDeck: Array.from({ length: 60 }, (_, i) => ({
    cardCode: codes[i % codes.length]!,
    name: 'Member',
    cardType: CardType.MEMBER,
    cost: 17,
    blade: 1,
    hearts: [],
  })),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'energy',
    name: 'Energy',
    cardType: CardType.ENERGY,
  })),
});

describe('both-deck cosmetic preload manifest', () => {
  it('deduplicates rarities and ignores unrelated cards without disclosing deck order', () => {
    const codes = ['PL!SP-pb2-005-PP', 'other', 'PL!N-bp7-006-SEC', 'PL!N-bp7-006-R+'];
    expect(collectEntranceAssetIds(codes)).toEqual(['kanata', 'ren']);
    expect(collectEntranceAssetIds([...codes].reverse())).toEqual(['kanata', 'ren']);
    expect(collectEntranceAssetIds(['PL!N-bp7-006', 'PL!N-bp7-006-R+-extra'])).toEqual(['kanata']);
    expect(collectEntranceAssetIds(['PL!N-bp7-0060-R+', 'PL!N-bp7-006-R+-extra'])).toEqual([]);
  });

  it.each(['LOCAL', 'REMOTE'] as const)(
    'publishes only the same union to both seats before any entrance, including after restore (%s)',
    (mode) => {
      const session = createGameSession({ cardEntrance: mode });
      session.createGame('preload', 'p1', 'First', 'p2', 'Second');
      expect(
        session.initializeGame(
          deck(['PL!N-bp7-006-SEC', 'PL!N-bp7-006-R+']),
          deck(['PL!SP-pb2-005-PP', 'unrelated-opponent-card'])
        ).success
      ).toBe(true);
      const assertManifest = () => {
        for (const player of ['p1', 'p2']) {
          const view = session.getPlayerViewState(player)!;
          expect(view.match.entranceAssetIds).toEqual(['kanata', 'ren']);
          expect(view.match.entrance).toBeUndefined();
          const opponent = player === 'p1' ? 'SECOND' : 'FIRST';
          expect(view.table.zones[`${opponent}_MAIN_DECK`]!.objectIds).toBeUndefined();
          expect(view.table.zones[`${opponent}_HAND`]!.objectIds).toBeUndefined();
          expect(
            Object.values(view.objects).filter(
              (object) => object.ownerSeat === opponent && object.cardType === CardType.MEMBER
            )
          ).toEqual([]);
        }
      };
      assertManifest();
      session.restoreRuntimeState({
        authorityState: session.state!,
        currentPublicSeq: session.getCurrentPublicEventSeq(),
      });
      assertManifest();
      const ended: GameState = { ...session.state!, isEnded: true };
      session.restoreRuntimeState({ authorityState: ended, currentPublicSeq: 0 });
      expect(session.getPlayerViewState('p1')!.match.entranceAssetIds).toBeUndefined();
    }
  );

  it('does not disclose a manifest in sessions without entrance presentation', () => {
    const session = createGameSession();
    session.createGame('no-entrance', 'p1', 'First', 'p2', 'Second');
    session.initializeGame(deck(['PL!N-bp7-006-SEC']), deck(['PL!SP-pb2-005-PP']));
    expect(session.getPlayerViewState('p1')!.match.entranceAssetIds).toBeUndefined();
  });
});
