import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createMemberSlotMovedEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID,
  SP_PB2_011_LIVE_START_SELF_POSITION_CHANGE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
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

function createMember(cardCode: string, name = cardCode, blade = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName: '5yncri5e!',
    cardType: CardType.MEMBER,
    cost: 13,
    blade,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function setupState(options: {
  readonly sourceSlot?: SlotPosition;
  readonly lowOpponentOrientation?: OrientationState;
  readonly includeRightOccupant?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly centerMemberId: string;
  readonly sideMemberId: string;
  readonly lowOpponentId: string;
  readonly highOpponentId: string;
  readonly drawCardId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-011-R', '鬼塚冬毬', 1),
    PLAYER1,
    'sp-pb2-011-source'
  );
  const centerMember = createCardInstance(
    createMember('PL!SP-test-center', 'Center member', 1),
    PLAYER1,
    'sp-pb2-011-center-member'
  );
  const sideMember = createCardInstance(
    createMember('PL!SP-test-side', 'Side member', 1),
    PLAYER1,
    'sp-pb2-011-side-member'
  );
  const lowOpponent = createCardInstance(
    createMember('PL!SP-test-opponent-low', 'Opponent low blade', 2),
    PLAYER2,
    'sp-pb2-011-opponent-low'
  );
  const highOpponent = createCardInstance(
    createMember('PL!SP-test-opponent-high', 'Opponent high blade', 3),
    PLAYER2,
    'sp-pb2-011-opponent-high'
  );
  const drawCard = createCardInstance(
    createMember('PL!SP-test-draw-card', 'Draw card', 1),
    PLAYER1,
    'sp-pb2-011-draw-card'
  );

  const sourceSlot = options.sourceSlot ?? SlotPosition.RIGHT;
  let game = createGameState('sp-pb2-011-tomari', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    centerMember,
    sideMember,
    lowOpponent,
    highOpponent,
    drawCard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const slots = {
      ...player.memberSlots.slots,
      [SlotPosition.LEFT]: options.includeRightOccupant ? null : sideMember.instanceId,
      [SlotPosition.CENTER]: sourceSlot === SlotPosition.CENTER ? source.instanceId : centerMember.instanceId,
      [SlotPosition.RIGHT]:
        sourceSlot === SlotPosition.RIGHT
          ? source.instanceId
          : options.includeRightOccupant
            ? sideMember.instanceId
            : null,
    };
    return {
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots,
        cardStates: new Map(
          [source, centerMember, sideMember].map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [drawCard.instanceId],
      },
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.LEFT]: lowOpponent.instanceId,
        [SlotPosition.RIGHT]: highOpponent.instanceId,
      },
      cardStates: new Map([
        [
          lowOpponent.instanceId,
          {
            orientation: options.lowOpponentOrientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ],
        [highOpponent.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    centerMemberId: centerMember.instanceId,
    sideMemberId: sideMember.instanceId,
    lowOpponentId: lowOpponent.instanceId,
    highOpponentId: highOpponent.instanceId,
    drawCardId: drawCard.instanceId,
  };
}

function withMovedSlot(
  game: GameState,
  playerId: string,
  cardId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [fromSlot]: null,
        [toSlot]: cardId,
      },
    },
  }));
}

function enqueueMove(
  game: GameState,
  cardId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  const event = createMemberSlotMovedEvent(cardId, PLAYER1, fromSlot, toSlot);
  return enqueueTriggeredCardEffects(
    emitGameEvent(withMovedSlot(game, PLAYER1, cardId, fromSlot, toSlot), event),
    [TriggerCondition.ON_MEMBER_SLOT_MOVED]
  );
}

function pendingLiveStart(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-011-live-start-pending',
    abilityId: SP_PB2_011_LIVE_START_SELF_POSITION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function startLiveStartPositionChange(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingLiveStart(sourceId)],
  }).gameState;
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function chooseEffectOption(game: GameState, optionId: string): GameState {
  const selected = confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    optionId
  );
  return continuePublicEffectChoiceForTest(selected, PLAYER1);
}

describe('PL!SP-pb2-011 Tomari center move option workflow', () => {
  it('triggers when an own CENTER member moves away, but not when a member moves into CENTER', () => {
    const scenario = setupState();
    const queued = enqueueMove(
      scenario.game,
      scenario.centerMemberId,
      SlotPosition.CENTER,
      SlotPosition.LEFT
    );
    expect(queued.pendingAbilities).toHaveLength(1);

    const movedIntoCenter = enqueueMove(
      scenario.game,
      scenario.sideMemberId,
      SlotPosition.LEFT,
      SlotPosition.CENTER
    );
    expect(movedIntoCenter.pendingAbilities).toEqual([]);
  });

  it('chooses BLADE +2 for the source member', () => {
    const scenario = setupState();
    const started = resolvePendingCardEffects(
      enqueueMove(scenario.game, scenario.centerMemberId, SlotPosition.CENTER, SlotPosition.LEFT)
    ).gameState;

    const state = chooseEffectOption(started, 'gain-blade');

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: scenario.sourceId,
      abilityId: SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID,
    });
    expect(abilityUseCount(state)).toBe(1);
  });

  it('chooses an opponent printed BLADE <= 2 member to WAITING', () => {
    const scenario = setupState();
    let state = resolvePendingCardEffects(
      enqueueMove(scenario.game, scenario.centerMemberId, SlotPosition.CENTER, SlotPosition.LEFT)
    ).gameState;

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'gain-blade',
      'wait-opponent',
      'draw',
    ]);
    state = chooseEffectOption(state, 'wait-opponent');
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.lowOpponentId]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.lowOpponentId);
    expect(state.players[1].memberSlots.cardStates.get(scenario.lowOpponentId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.highOpponentId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(abilityUseCount(state)).toBe(1);
  });

  it('hides the opponent WAITING option when no non-WAITING low printed BLADE target exists', () => {
    const scenario = setupState({ lowOpponentOrientation: OrientationState.WAITING });
    const state = resolvePendingCardEffects(
      enqueueMove(scenario.game, scenario.centerMemberId, SlotPosition.CENTER, SlotPosition.LEFT)
    ).gameState;

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'gain-blade',
      'draw',
    ]);
  });

  it('chooses draw 1', () => {
    const scenario = setupState();
    const started = resolvePendingCardEffects(
      enqueueMove(scenario.game, scenario.centerMemberId, SlotPosition.CENTER, SlotPosition.LEFT)
    ).gameState;

    const state = chooseEffectOption(started, 'draw');

    expect(state.players[0].hand.cardIds).toContain(scenario.drawCardId);
    expect(abilityUseCount(state)).toBe(1);
  });

  it('respects per-turn limit after the first successful option resolution', () => {
    const scenario = setupState();
    const started = resolvePendingCardEffects(
      enqueueMove(scenario.game, scenario.centerMemberId, SlotPosition.CENTER, SlotPosition.LEFT)
    ).gameState;
    const resolved = chooseEffectOption(started, 'draw');

    const queuedAgain = enqueueMove(
      resolved,
      scenario.sideMemberId,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );

    expect(queuedAgain.pendingAbilities).toEqual([]);
    expect(abilityUseCount(queuedAgain)).toBe(1);
  });

  it('live start self position change can be skipped', () => {
    const scenario = setupState({ sourceSlot: SlotPosition.CENTER });
    const started = startLiveStartPositionChange(scenario.game, scenario.sourceId);
    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('live start self position change moves from CENTER and opens the AUTO option window', () => {
    const scenario = setupState({ sourceSlot: SlotPosition.CENTER });
    const started = startLiveStartPositionChange(scenario.game, scenario.sourceId);

    const state = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      SlotPosition.RIGHT
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(scenario.sourceId);
    expect(state.activeEffect).toMatchObject({
      abilityId: SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      stepId: 'SP_PB2_011_SELECT_CENTER_MOVE_OPTION',
    });
  });

  it('live start self position change swaps members and still opens the AUTO option window', () => {
    const scenario = setupState({ sourceSlot: SlotPosition.CENTER, includeRightOccupant: true });
    const started = startLiveStartPositionChange(scenario.game, scenario.sourceId);

    const state = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      SlotPosition.RIGHT
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(scenario.sourceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sideMemberId);
    expect(state.activeEffect?.abilityId).toBe(
      SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID
    );
  });
});
