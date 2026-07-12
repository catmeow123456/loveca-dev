import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
}

function card(
  data: MemberCardData | LiveCardData,
  id: string,
  ownerId: string = PLAYER1
): CardInstance {
  return createCardInstance(data, ownerId, id);
}

function setupState(options: {
  readonly waitingCards?: readonly CardInstance[];
  readonly opponentWaitingCards?: readonly CardInstance[];
  readonly otherCards?: readonly CardInstance[];
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance;
} {
  const source = card(createMember('PL!SP-bp2-011-R', '鬼塚冬毬'), 'tomari-source');
  const allCards = [
    source,
    ...(options.waitingCards ?? []),
    ...(options.opponentWaitingCards ?? []),
    ...(options.otherCards ?? []),
  ];
  let game = createGameState('sp-bp2-011-tomari', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, allCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingCards?.map((waitingCard) => waitingCard.instanceId) ?? [],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds:
        options.opponentWaitingCards?.map((waitingCard) => waitingCard.instanceId) ?? [],
    },
  }));
  return { game, source };
}

function queueOnEnter(game: GameState, sourceId: string): GameState {
  const withEvent = emitGameEvent(
    game,
    createEnterStageEvent(sourceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  return enqueueTriggeredCardEffects(withEvent, [TriggerCondition.ON_ENTER_STAGE]);
}

function startAbility(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects(queueOnEnter(game, sourceId)).gameState;
}

function chooseDistinctLives(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  return confirmActiveEffectStepThroughPublicReveal(
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

function opponentChooses(game: GameState, selectedCardId: string): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER2, game.activeEffect!.id, selectedCardId);
}

function continuationPending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'continuation-pending',
    abilityId: SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
    eventIds: ['move-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

describe('PL!SP-bp2-011 Tomari on-enter opponent-selected live recovery', () => {
  it('consumes pending as no-op when waiting room lacks two different-named LIVE cards', () => {
    const onlyLive = card(createLive('PL!SP-test-live-a', 'Only Live'), 'only-live');
    const scenario = setupState({ waitingCards: [onlyLive] });
    const state = startAbility(scenario.game, scenario.source.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID &&
          action.payload.step === 'NO_DIFFERENT_NAMED_LIVE_PAIR'
      )
    ).toBe(true);
  });

  it('lets controller choose two different-named LIVE cards and opponent choose one to recover', () => {
    const liveA = card(createLive('PL!SP-test-live-a', 'Song A'), 'live-a');
    const liveB = card(createLive('PL!SP-test-live-b', 'Song B'), 'live-b');
    const scenario = setupState({ waitingCards: [liveA, liveB] });
    let state = startAbility(scenario.game, scenario.source.instanceId);

    expect(state.activeEffect).toMatchObject({
      abilityId: SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [liveA.instanceId, liveB.instanceId],
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: false,
    });

    state = chooseDistinctLives(state, [liveA.instanceId, liveB.instanceId]);
    expect(state.activeEffect).toMatchObject({
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [liveA.instanceId, liveB.instanceId],
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
    });

    state = opponentChooses(state, liveB.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([liveB.instanceId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([liveA.instanceId]);
  });

  it('does not accept two same-name LIVE cards as the controller selection', () => {
    const sameA = card(createLive('PL!SP-test-live-a', 'Same Song'), 'same-a');
    const sameB = card(createLive('PL!SP-test-live-b', 'Same Song'), 'same-b');
    const different = card(createLive('PL!SP-test-live-c', 'Different Song'), 'different');
    const scenario = setupState({ waitingCards: [sameA, sameB, different] });
    const started = startAbility(scenario.game, scenario.source.instanceId);

    const rejected = chooseDistinctLives(started, [sameA.instanceId, sameB.instanceId]);

    expect(rejected).toBe(started);
    expect(rejected.activeEffect?.awaitingPlayerId).toBe(PLAYER1);
    expect(rejected.players[0].hand.cardIds).toEqual([]);
  });

  it('rejects non-LIVE, opponent waiting room, and non-selectable cards in the first step', () => {
    const liveA = card(createLive('PL!SP-test-live-a', 'Song A'), 'live-a');
    const liveB = card(createLive('PL!SP-test-live-b', 'Song B'), 'live-b');
    const nonLive = card(createMember('PL!SP-test-member', 'Member'), 'non-live');
    const opponentLive = card(
      createLive('PL!SP-test-opponent-live', 'Opponent Song'),
      'opponent-live',
      PLAYER2
    );
    const outsideLive = card(createLive('PL!SP-test-outside-live', 'Outside Song'), 'outside-live');
    const scenario = setupState({
      waitingCards: [liveA, liveB, nonLive],
      opponentWaitingCards: [opponentLive],
      otherCards: [outsideLive],
    });
    const started = startAbility(scenario.game, scenario.source.instanceId);

    expect(chooseDistinctLives(started, [liveA.instanceId, nonLive.instanceId])).toBe(started);
    expect(chooseDistinctLives(started, [liveA.instanceId, opponentLive.instanceId])).toBe(
      started
    );
    expect(chooseDistinctLives(started, [liveA.instanceId, outsideLive.instanceId])).toBe(
      started
    );
    expect(started.players[0].hand.cardIds).toEqual([]);
  });

  it('continues pending effects after the opponent finishes the recovery choice', () => {
    const liveA = card(createLive('PL!SP-test-live-a', 'Song A'), 'live-a');
    const liveB = card(createLive('PL!SP-test-live-b', 'Song B'), 'live-b');
    const scenario = setupState({ waitingCards: [liveA, liveB] });
    let state = chooseDistinctLives(startAbility(scenario.game, scenario.source.instanceId), [
      liveA.instanceId,
      liveB.instanceId,
    ]);
    state = {
      ...state,
      pendingAbilities: [continuationPending(scenario.source.instanceId)],
    };

    state = opponentChooses(state, liveA.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ENERGY_DECK_EMPTY'
      )
    ).toBe(true);
  });

  it('keeps the opponent choice active and moves nothing if a candidate leaves waiting room first', () => {
    const liveA = card(createLive('PL!SP-test-live-a', 'Song A'), 'live-a');
    const liveB = card(createLive('PL!SP-test-live-b', 'Song B'), 'live-b');
    const scenario = setupState({ waitingCards: [liveA, liveB] });
    let state = chooseDistinctLives(startAbility(scenario.game, scenario.source.instanceId), [
      liveA.instanceId,
      liveB.instanceId,
    ]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== liveA.instanceId),
      },
      hand: addCardToZone(player.hand, liveA.instanceId),
    }));

    const rejected = opponentChooses(state, liveA.instanceId);

    expect(rejected).toBe(state);
    expect(rejected.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
    expect(rejected.players[0].hand.cardIds).toEqual([liveA.instanceId]);
    expect(rejected.players[0].waitingRoom.cardIds).toEqual([liveB.instanceId]);
  });
});
