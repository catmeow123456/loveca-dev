import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
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
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    unitName: '5yncri5e!',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  sourceSlot: SlotPosition
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot,
  };
}

function setupScenario(options: {
  readonly sourceCardCode: string;
  readonly abilityId: string;
  readonly sourceSlot: SlotPosition;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly watcherId: string;
  readonly handIds: readonly string[];
  readonly drawIds: readonly string[];
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode, 'Source'),
    PLAYER1,
    `${options.sourceCardCode}:source`
  );
  const watcher = createCardInstance(
    createMember('PL!HS-pb1-003-R', '大沢瑠璃乃'),
    PLAYER1,
    `${options.sourceCardCode}:watcher`
  );
  const handCards = [0, 1].map((index) =>
    createCardInstance(
      createMember(`PL!SP-test-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `${options.sourceCardCode}:hand-${index}`
    )
  );
  const drawCards = [0, 1].map((index) =>
    createCardInstance(
      createMember(`PL!SP-test-draw-${index}`, `Draw ${index}`),
      PLAYER1,
      `${options.sourceCardCode}:draw-${index}`
    )
  );

  let game = createGameState('sp-pb2-side-draw-discard', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, watcher, ...handCards, ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, options.sourceSlot, source.instanceId),
      SlotPosition.CENTER,
      watcher.instanceId
    ),
  }));

  return {
    game,
    sourceId: source.instanceId,
    watcherId: watcher.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    drawIds: drawCards.map((card) => card.instanceId),
  };
}

function startAbility(game: GameState, abilityId: string, sourceId: string, sourceSlot: SlotPosition): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(abilityId, sourceId, sourceSlot)],
  }).gameState;
}

function finishDiscard(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

describe('PL!SP-pb2 side draw then discard workflows', () => {
  it('resolves PL!SP-pb2-036 on right side by drawing two then discarding two', () => {
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-pb2-036-N',
      abilityId: SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      sourceSlot: SlotPosition.RIGHT,
    });
    let state = startAbility(
      scenario.game,
      SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      scenario.sourceId,
      SlotPosition.RIGHT
    );

    expect(state.activeEffect).toMatchObject({
      abilityId: SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    expect(state.activeEffect?.selectableCardIds).toEqual([...scenario.handIds, ...scenario.drawIds]);

    const discardedIds = [scenario.handIds[0]!, scenario.drawIds[0]!];
    state = finishDiscard(state, discardedIds);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual(discardedIds);
    expect(state.players[0].hand.cardIds).toEqual([scenario.handIds[1]!, scenario.drawIds[1]!]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.watcherId
      )
    ).toBe(true);
  });

  it('consumes PL!SP-pb2-036 without drawing when not on right side', () => {
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-pb2-036-N',
      abilityId: SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      sourceSlot: SlotPosition.LEFT,
    });
    const state = startAbility(
      scenario.game,
      SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      scenario.sourceId,
      SlotPosition.LEFT
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual(scenario.handIds);
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.drawIds);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
          action.payload.step === 'DRAW_DISCARD_SOURCE_SLOT_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('resolves PL!SP-pb2-037 on left side by drawing two then discarding two', () => {
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-pb2-037-N',
      abilityId: SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      sourceSlot: SlotPosition.LEFT,
    });
    let state = startAbility(
      scenario.game,
      SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      scenario.sourceId,
      SlotPosition.LEFT
    );

    expect(state.activeEffect?.selectableCardIds).toEqual([...scenario.handIds, ...scenario.drawIds]);
    state = finishDiscard(state, [scenario.handIds[1]!, scenario.drawIds[1]!]);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.handIds[1]!,
      scenario.drawIds[1]!,
    ]);
  });

  it('consumes PL!SP-pb2-037 without drawing when not on left side', () => {
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-pb2-037-N',
      abilityId: SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      sourceSlot: SlotPosition.RIGHT,
    });
    const state = startAbility(
      scenario.game,
      SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      scenario.sourceId,
      SlotPosition.RIGHT
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual(scenario.handIds);
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.drawIds);
  });
});
