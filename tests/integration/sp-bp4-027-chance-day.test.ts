import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
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
import { SP_BP4_027_LIVE_SUCCESS_LIELLA_STAGE_FORMATION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createChanceDay(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp4-027-SRL',
    name: 'Chance Day, Chance Way!',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createMember(name: string): MemberCardData {
  return {
    cardCode: `PL!SP-test-${name}`,
    name,
    groupNames: ['Liella!'],
    unitName: 'CatChu!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp4-027-pending',
    abilityId: SP_BP4_027_LIVE_SUCCESS_LIELLA_STAGE_FORMATION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

describe('PL!SP-bp4-027 Chance Day, Chance Way! workflow', () => {
  it('allows stage rearrangement on live success when every own stage member is Liella', () => {
    const live = createCardInstance(createChanceDay(), PLAYER1, 'chance-day');
    const kanon = createCardInstance(createMember('Kanon'), PLAYER1, 'kanon');
    const keke = createCardInstance(createMember('Keke'), PLAYER1, 'keke');
    let game = createGameState('sp-bp4-027-chance-day', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [live, kanon, keke]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kanon.instanceId),
        SlotPosition.RIGHT,
        keke.instanceId
      ),
    }));

    let state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pendingAbility(live.instanceId)],
    }).gameState;
    expect(state.activeEffect?.selectableOptions).toBeUndefined();
    expect(state.activeEffect?.stageFormation).toBeDefined();

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      [
        { cardId: keke.instanceId, toSlot: SlotPosition.CENTER },
        { cardId: kanon.instanceId, toSlot: SlotPosition.RIGHT },
      ]
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(keke.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(kanon.instanceId);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: SP_BP4_027_LIVE_SUCCESS_LIELLA_STAGE_FORMATION_CHANGE_ABILITY_ID,
      step: 'STAGE_FORMATION_CHANGE',
    });
  });
});
