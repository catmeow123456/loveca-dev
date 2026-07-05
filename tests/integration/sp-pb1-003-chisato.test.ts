import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID,
  SP_PB1_006_AUTO_ENTER_OR_MOVE_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string, unitName = '5yncri5e!'): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function placeMembers(
  game: GameState,
  playerId: string,
  placements: readonly { readonly slot: SlotPosition; readonly cardId: string }[]
): GameState {
  return updatePlayer(game, playerId, (player) => {
    let memberSlots = player.memberSlots;
    for (const placement of placements) {
      memberSlots = placeCardInSlot(memberSlots, placement.slot, placement.cardId);
    }
    return { ...player, memberSlots };
  });
}

function queueOnEnter(game: GameState, sourceId: string, sourceSlot = SlotPosition.CENTER): GameState {
  const event = createEnterStageEvent(sourceId, ZoneType.HAND, sourceSlot, PLAYER1, PLAYER1);
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_ENTER_STAGE]);
}

describe('PL!SP-pb1-003 Chisato fixed stage rotation', () => {
  it('queues from the enter-stage event and rotates both players three slots', () => {
    const source = createCardInstance(
      createMember('PL!SP-pb1-003-R', '嵐 千砂都'),
      PLAYER1,
      'chisato'
    );
    const ownLeft = createCardInstance(createMember('PL!SP-test-own-left', 'Own Left'), PLAYER1, 'own-left');
    const ownRight = createCardInstance(createMember('PL!SP-test-own-right', 'Own Right'), PLAYER1, 'own-right');
    const oppLeft = createCardInstance(createMember('PL!SP-test-opp-left', 'Opp Left'), PLAYER2, 'opp-left');
    const oppCenter = createCardInstance(createMember('PL!SP-test-opp-center', 'Opp Center'), PLAYER2, 'opp-center');
    const oppRight = createCardInstance(createMember('PL!SP-test-opp-right', 'Opp Right'), PLAYER2, 'opp-right');

    let game = createGameState('sp-pb1-003-rotation', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, ownLeft, ownRight, oppLeft, oppCenter, oppRight]);
    game = placeMembers(game, PLAYER1, [
      { slot: SlotPosition.LEFT, cardId: ownLeft.instanceId },
      { slot: SlotPosition.CENTER, cardId: source.instanceId },
      { slot: SlotPosition.RIGHT, cardId: ownRight.instanceId },
    ]);
    game = placeMembers(game, PLAYER2, [
      { slot: SlotPosition.LEFT, cardId: oppLeft.instanceId },
      { slot: SlotPosition.CENTER, cardId: oppCenter.instanceId },
      { slot: SlotPosition.RIGHT, cardId: oppRight.instanceId },
    ]);

    const queued = queueOnEnter(game, source.instanceId);
    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID,
      sourceCardId: source.instanceId,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      sourceSlot: SlotPosition.CENTER,
    });

    const state = resolvePendingCardEffects(queued).gameState;
    expect(state.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: source.instanceId,
      [SlotPosition.CENTER]: ownRight.instanceId,
      [SlotPosition.RIGHT]: ownLeft.instanceId,
    });
    expect(state.players[1].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: oppCenter.instanceId,
      [SlotPosition.CENTER]: oppRight.instanceId,
      [SlotPosition.RIGHT]: oppLeft.instanceId,
    });
    expect(
      state.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cause?.abilityId === SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID
      )
    ).toHaveLength(6);
  });

  it('consumes pending no-op when own stage contains a non-5yncri5e member', () => {
    const source = createCardInstance(createMember('PL!SP-pb1-003-P＋', '嵐 千砂都'), PLAYER1, 'source');
    const nonTarget = createCardInstance(
      createMember('PL!SP-test-catchu', 'Other', 'CatChu!'),
      PLAYER1,
      'non-target'
    );
    let game = createGameState('sp-pb1-003-condition', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, nonTarget]);
    game = placeMembers(game, PLAYER1, [
      { slot: SlotPosition.LEFT, cardId: nonTarget.instanceId },
      { slot: SlotPosition.CENTER, cardId: source.instanceId },
    ]);

    const state = resolvePendingCardEffects(queueOnEnter(game, source.instanceId)).gameState;
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(nonTarget.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(source.instanceId);
    expect(
      state.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED)
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'ROTATE_STAGE_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('rotates safely through empty slots', () => {
    const source = createCardInstance(createMember('PL!SP-pb1-003-R', '嵐 千砂都'), PLAYER1, 'source');
    const opponent = createCardInstance(createMember('PL!SP-test-opponent', 'Opponent'), PLAYER2, 'opponent');
    let game = createGameState('sp-pb1-003-empty-slots', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, opponent]);
    game = placeMembers(game, PLAYER1, [{ slot: SlotPosition.CENTER, cardId: source.instanceId }]);
    game = placeMembers(game, PLAYER2, [{ slot: SlotPosition.LEFT, cardId: opponent.instanceId }]);

    const state = resolvePendingCardEffects(queueOnEnter(game, source.instanceId)).gameState;
    expect(state.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: source.instanceId,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    });
    expect(state.players[1].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: opponent.instanceId,
    });
  });

  it('continues into moved-member pending abilities after the rotation', () => {
    const source = createCardInstance(createMember('PL!SP-pb1-003-R', '嵐 千砂都'), PLAYER1, 'source');
    const kinako = createCardInstance(
      createMember('PL!SP-pb1-006-R', '桜小路きな子'),
      PLAYER1,
      'kinako'
    );
    let game = createGameState('sp-pb1-003-continuation', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, kinako]);
    game = placeMembers(game, PLAYER1, [
      { slot: SlotPosition.LEFT, cardId: kinako.instanceId },
      { slot: SlotPosition.CENTER, cardId: source.instanceId },
    ]);

    const state = resolvePendingCardEffects(queueOnEnter(game, source.instanceId)).gameState;
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === SP_PB1_006_AUTO_ENTER_OR_MOVE_GAIN_TWO_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kinako.instanceId
      )
    ).toBe(true);
  });
});
