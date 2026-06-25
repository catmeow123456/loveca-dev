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
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_050_LIVE_START_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createJellyfish(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-050-L',
    name: 'Jellyfish',
    groupName: 'Liella!',
    unitName: '5yncri5e!',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createMember(name: string, unitName: string): MemberCardData {
  return {
    cardCode: `PL!SP-test-${name}`,
    name,
    groupName: 'Liella!',
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-050-pending',
    abilityId: SP_PB2_050_LIVE_START_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
  };
}

describe('PL!SP-pb2-050 Jellyfish stage rearrangement workflow', () => {
  it('opens a stage formation window and resolves move history atomically', () => {
    const live = createCardInstance(createJellyfish(), PLAYER1, 'jellyfish-live');
    const kinako = createCardInstance(createMember('Kinako', '5yncri5e!'), PLAYER1, 'kinako');
    const mei = createCardInstance(createMember('Mei', '5yncri5e!'), PLAYER1, 'mei');
    let game = createGameState('sp-pb2-050-jellyfish', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [live, kinako, mei]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kinako.instanceId),
        SlotPosition.CENTER,
        mei.instanceId
      ),
    }));

    let state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pendingAbility(live.instanceId)],
    }).gameState;
    expect(state.activeEffect?.selectableOptions).toBeUndefined();
    expect(state.activeEffect?.stageFormation?.slots.map((slot) => slot.cardId)).toEqual([
      kinako.instanceId,
      mei.instanceId,
      null,
    ]);

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
        { cardId: kinako.instanceId, toSlot: SlotPosition.RIGHT },
        { cardId: mei.instanceId, toSlot: SlotPosition.LEFT },
      ]
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(mei.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(kinako.instanceId);
    expect(
      state.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toHaveLength(2);
    expect(state.eventLog.at(-1)?.event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: live.instanceId,
        abilityId: SP_PB2_050_LIVE_START_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
      },
    });
  });
});
