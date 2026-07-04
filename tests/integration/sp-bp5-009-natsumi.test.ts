import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 1,
    requirements: [],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-009-pending',
    abilityId: SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  deckData: readonly AnyCardData[],
  options: { waiting?: boolean; waitingRoomData?: readonly AnyCardData[] } = {}
) {
  const source = createCardInstance(member('PL!SP-bp5-009-R', '鬼塚夏美'), PLAYER1, 'natsumi');
  const deckCards = deckData.map((data, index) =>
    createCardInstance(data, PLAYER1, `deck-${index}`)
  );
  const waitingRoomCards = (options.waitingRoomData ?? []).map((data, index) =>
    createCardInstance(data, PLAYER1, `waiting-${index}`)
  );
  let game = createGameState('sp-bp5-009-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...deckCards, ...waitingRoomCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: deckCards.map((card) => card.instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoomCards.map((card) => card.instanceId),
    },
    memberSlots: {
      ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
      cardStates: new Map([
        [
          source.instanceId,
          {
            orientation: options.waiting ? OrientationState.WAITING : OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ],
      ]),
    },
  }));
  return {
    game,
    sourceId: source.instanceId,
    deckCardIds: deckCards.map((card) => card.instanceId),
    waitingRoomCardIds: waitingRoomCards.map((card) => card.instanceId),
  };
}

function start(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pending(sourceId)] }).gameState;
}

function chooseContinue(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'continue'
  );
}

function chooseDecline(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'decline'
  );
}

describe('PL!SP-bp5-009 Natsumi live-start repeat mill', () => {
  it('declines without moving the deck or writing BLADE', () => {
    const scenario = setup([member('top')]);
    const started = start(scenario.game, scenario.sourceId);
    expect(started.activeEffect?.selectableOptions).toEqual([
      { id: 'continue', label: '放置入休息室' },
      { id: 'decline', label: '不放置' },
    ]);
    expect(started.activeEffect?.stepText).toContain('要将自己卡组顶的卡片放置入休息室');

    const state = chooseDecline(started);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.deckCardIds);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
    expect(collectLiveModifiers(state)).toEqual([]);
  });

  it('can repeat at most five successful non-LIVE mills and gains BLADE each time', () => {
    const scenario = setup(Array.from({ length: 6 }, (_, index) => member(`top-${index}`)));
    let state = start(scenario.game, scenario.sourceId);

    for (let index = 0; index < 5; index += 1) {
      state = chooseContinue(state);
    }

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual(scenario.deckCardIds.slice(0, 5));
    expect(state.players[0].mainDeck.cardIds).toEqual([scenario.deckCardIds[5]]);
    expect(
      collectLiveModifiers(state).filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID
      )
    ).toHaveLength(5);
  });

  it('waits the source and can continue repeating when the milled card is LIVE', () => {
    const scenario = setup([live('live-top'), member('after-live'), member('remaining')]);
    let state = chooseContinue(start(scenario.game, scenario.sourceId));

    expect(state.activeEffect?.stepId).toBe('SP_BP5_009_REPEAT_MILL_TOP');
    expect(state.players[0].waitingRoom.cardIds).toEqual([scenario.deckCardIds[0]]);
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.deckCardIds.slice(1, 3));
    expect(state.players[0].memberSlots.cardStates.get(scenario.sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.sourceId
      )
    ).toBe(true);
    expect(
      collectLiveModifiers(state).filter((modifier) => modifier.kind === 'BLADE')
    ).toHaveLength(1);

    state = chooseContinue(state);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.deckCardIds[0],
      scenario.deckCardIds[1],
    ]);
    expect(state.players[0].mainDeck.cardIds).toEqual([scenario.deckCardIds[2]]);
    expect(
      collectLiveModifiers(state).filter((modifier) => modifier.kind === 'BLADE')
    ).toHaveLength(2);
  });

  it('refreshes around a short deck while milling exactly one top card for this iteration', () => {
    const scenario = setup([], { waitingRoomData: [member('refresh-source')] });
    let state = start(scenario.game, scenario.sourceId);

    expect(state.activeEffect).not.toBeNull();
    state = chooseContinue(state);

    const milledCardId = state.actionHistory.findLast(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID &&
        action.payload.step === 'REPEAT_MILL_TOP_CONTINUE_PROMPT'
    )?.payload.milledCardId;
    expect(scenario.waitingRoomCardIds).toContain(milledCardId);
    expect(state.actionHistory.some((action) => action.type === 'RULE_ACTION')).toBe(true);
    expect(state.actionHistory.at(-1)?.payload.refreshCount).toBe(2);
    expect(state.activeEffect).toMatchObject({
      abilityId: SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID,
      metadata: { refreshCount: 2 },
    });

    const enterWaitingRoomEvents = state.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(enterWaitingRoomEvents).toHaveLength(1);
    expect(enterWaitingRoomEvents[0]).toMatchObject({
      fromZone: 'MAIN_DECK',
      cardInstanceId: milledCardId,
      cardInstanceIds: [milledCardId],
    });
  });

  it('does not open an empty prompt when the deck and waiting room cannot provide a top card', () => {
    const emptyDeck = setup([]);
    const emptyState = start(emptyDeck.game, emptyDeck.sourceId);
    expect(emptyState.activeEffect).toBeNull();
    expect(emptyState.actionHistory.at(-1)?.payload.reason).toBe('NO_REFRESHABLE_TOP_CARD');

    const waitingSource = setup([member('top')], { waiting: true });
    const waitingState = start(waitingSource.game, waitingSource.sourceId);
    expect(waitingState.activeEffect?.stepId).toBe('SP_BP5_009_REPEAT_MILL_TOP');
    expect(waitingState.players[0].waitingRoom.cardIds).toEqual([]);
  });
});
