import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { enqueueTriggeredCardEffects, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_N_BP3_005_AUTO_THIRD_MEMBER_ENTER_DRAW_TO_FIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

function member(cardCode: string): MemberCardData {
  return { cardCode, name: cardCode, cardType: CardType.MEMBER, cost: 1, blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)] };
}

function setup(handCount: number, deckCount: number) {
  const cards = Array.from({ length: handCount + deckCount }, (_, index) =>
    createCardInstance(member(`TEST-${index}`), 'p1', `card-${index}`));
  let game = registerCards(createGameState('n-bp3-005-ai', 'p1', 'P1', 'p2', 'P2'), cards);
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    hand: cards.slice(0, handCount).reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: cards.slice(handCount).reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
  }));
  const pending: PendingAbilityState = {
    id: 'ai:auto:event-3', abilityId: PL_N_BP3_005_AUTO_THIRD_MEMBER_ENTER_DRAW_TO_FIVE_ABILITY_ID,
    sourceCardId: 'ai-source', controllerId: 'p1', mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['event-3'],
  };
  return { ...game, pendingAbilities: [pending] };
}

describe('PL!N-bp3-005 宮下 愛 AUTO', () => {
  it('queues only the third own member entry and allows Ai herself to be that event', () => {
    const ai = createCardInstance(member('PL!N-bp3-005-P'), 'p1', 'ai');
    let game = registerCards(createGameState('ai-third-entry', 'p1', 'P1', 'p2', 'P2'), [ai]);
    game = updatePlayer(game, 'p1', (player) => ({ ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ai.instanceId) }));
    const events = [
      createEnterStageEvent('one', ZoneType.HAND, SlotPosition.LEFT, 'p1', 'p1'),
      createEnterStageEvent('two', ZoneType.HAND, SlotPosition.RIGHT, 'p1', 'p1'),
      createEnterStageEvent(ai.instanceId, ZoneType.HAND, SlotPosition.CENTER, 'p1', 'p1'),
      createEnterStageEvent('four', ZoneType.WAITING_ROOM, SlotPosition.LEFT, 'p1', 'p1'),
    ];
    for (const [index, event] of events.entries()) {
      game = emitGameEvent(game, event);
      game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], { enterStageEvents: [event] });
      expect(game.pendingAbilities.filter((ability) =>
        ability.abilityId === PL_N_BP3_005_AUTO_THIRD_MEMBER_ENTER_DRAW_TO_FIVE_ABILITY_ID
      )).toHaveLength(index >= 2 ? 1 : 0);
    }
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], { enterStageEvents: [events[2]!] });
    expect(game.pendingAbilities.filter((ability) =>
      ability.abilityId === PL_N_BP3_005_AUTO_THIRD_MEMBER_ENTER_DRAW_TO_FIVE_ABILITY_ID
    )).toHaveLength(1);
  });
  for (const handCount of [0, 1, 2, 3, 4, 5, 6]) {
    it(`draws a ${handCount}-card hand toward five at resolution`, () => {
      const result = resolvePendingCardEffects(setup(handCount, 8)).gameState;
      expect(result.players[0]?.hand.cardIds).toHaveLength(Math.max(5, handCount));
      expect(result.pendingAbilities).toHaveLength(0);
      const action = result.actionHistory.at(-1);
      expect(action?.payload).toMatchObject({ handCountBefore: handCount, requestedDrawCount: Math.max(0, 5 - handCount) });
      expect(action?.payload.drawnCardIds).toHaveLength(Math.max(0, 5 - handCount));
    });
  }

  it('records actual draws when the main deck is short', () => {
    const result = resolvePendingCardEffects(setup(1, 2)).gameState;
    expect(result.players[0]?.hand.cardIds).toHaveLength(3);
    expect(result.actionHistory.at(-1)?.payload).toMatchObject({ requestedDrawCount: 4 });
    expect(result.actionHistory.at(-1)?.payload.drawnCardIds).toHaveLength(2);
  });
});
