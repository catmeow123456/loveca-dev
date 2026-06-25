import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_SD2_001_LIVE_START_DRAW_STAGE_FORMATION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    unitName: 'CatChu!',
    cardType: CardType.MEMBER,
    cost: 17,
    blade: 7,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-sd2-001-pending',
    abilityId: SP_SD2_001_LIVE_START_DRAW_STAGE_FORMATION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
  };
}

describe('PL!SP-sd2-001 Kanon live start workflow', () => {
  it('draws one card before optional stage rearrangement and preserves the draw on decline', () => {
    const kanon = createCardInstance(
      createMember('PL!SP-sd2-001-SD2', '澁谷かのん'),
      PLAYER1,
      'kanon'
    );
    const drawn = createCardInstance(createMember('PL!SP-test-draw', 'Drawn'), PLAYER1, 'drawn');
    let game = createGameState('sp-sd2-001-kanon', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [kanon, drawn]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kanon.instanceId),
    }));

    let state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pendingAbility(kanon.instanceId)],
    }).gameState;

    expect(state.players[0].hand.cardIds).toEqual([drawn.instanceId]);
    expect(state.activeEffect?.selectableOptions).toBeUndefined();
    expect(state.activeEffect?.stageFormation).toBeDefined();
    expect(state.activeEffect?.canSkipSelection).toBe(true);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([drawn.instanceId]);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(kanon.instanceId);
    expect(
      state.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toBe(false);
  });
});
