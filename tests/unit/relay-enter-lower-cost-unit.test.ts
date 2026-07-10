import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { evaluateRelayEnterLowerCostUnitCondition } from '../../src/application/card-effects/workflows/shared/relay-enter-lower-cost-unit';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, cost: number, unitName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(): { readonly game: GameState; readonly sourceId: string; readonly ids: string[] } {
  const source = createCardInstance(member('PL!HS-bp2-008-R', 4, 'DOLLCHESTRA'), PLAYER1, 'source');
  const wrong = createCardInstance(member('WRONG', 1, 'Cerise Bouquet'), PLAYER1, 'wrong');
  const match = createCardInstance(member('MATCH', 20, 'DOLLCHESTRA'), PLAYER1, 'match');
  let game = createGameState('relay-helper', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, wrong, match]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  return { game, sourceId: source.instanceId, ids: [wrong.instanceId, match.instanceId] };
}

describe('relay enter lower-cost unit condition helper', () => {
  it('uses event-captured replacement cost and accepts any matching replacement', () => {
    const { game, sourceId, ids } = setup();
    const result = evaluateRelayEnterLowerCostUnitCondition(
      game,
      {
        sourceCardId: sourceId,
        controllerId: PLAYER1,
        relayReplacements: [
          { cardId: ids[0], effectiveCost: 1 },
          { cardId: ids[1], effectiveCost: 3 },
        ],
      },
      'DOLLCHESTRA'
    );

    expect(result).toMatchObject({
      conditionMet: true,
      reason: 'MATCHED',
      sourceEffectiveCost: 4,
      matchingRelayReplacementCardIds: [ids[1]],
      capturedReplacementEffectiveCosts: [1, 3],
    });
  });

  it('compares against the source effective cost at resolution', () => {
    const { game, sourceId, ids } = setup();
    const gameWithSourceCostReduced: GameState = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [
          ...game.liveResolution.liveModifiers,
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: sourceId,
            countDelta: -2,
            sourceCardId: 'cost-source',
            abilityId: 'cost-ability',
          },
        ],
      },
    };

    const result = evaluateRelayEnterLowerCostUnitCondition(
      gameWithSourceCostReduced,
      {
        sourceCardId: sourceId,
        controllerId: PLAYER1,
        relayReplacements: [{ cardId: ids[1], effectiveCost: 3 }],
      },
      'DOLLCHESTRA'
    );

    expect(result).toMatchObject({
      conditionMet: false,
      sourceEffectiveCost: 2,
      matchingRelayReplacementCardIds: [],
    });
  });
});
