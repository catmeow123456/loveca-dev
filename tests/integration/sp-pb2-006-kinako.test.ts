import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createLiveSuccessEvent,
  createMemberSlotMovedEvent,
} from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName ?? '5yncri5e!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function setupState(options: {
  readonly waitingRoomCards?: 'liella' | 'mixed' | 'none';
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly liveId: string;
  readonly liellaId: string;
  readonly secondLiellaId: string;
  readonly nonLiellaId: string;
  readonly liveWaitingId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-006-R', { name: '桜小路きな子' }),
    PLAYER1,
    'sp-pb2-006-source'
  );
  const live = createCardInstance(createLive('PL!SP-pb2-006-live'), PLAYER1, 'sp-pb2-006-live');
  const liella = createCardInstance(
    createMember('PL!SP-pb2-006-liella-member', { name: 'Liella member' }),
    PLAYER1,
    'sp-pb2-006-liella-member'
  );
  const secondLiella = createCardInstance(
    createMember('PL!SP-pb2-006-second-liella-member', { name: 'Second Liella member' }),
    PLAYER1,
    'sp-pb2-006-second-liella-member'
  );
  const nonLiella = createCardInstance(
    createMember('PL!N-pb2-006-non-liella-member', {
      name: 'Non Liella',
      groupNames: ['虹咲学園スクールアイドル同好会'],
      unitName: 'A・ZU・NA',
    }),
    PLAYER1,
    'sp-pb2-006-non-liella-member'
  );
  const liveWaiting = createCardInstance(
    createLive('PL!SP-pb2-006-waiting-live'),
    PLAYER1,
    'sp-pb2-006-waiting-live'
  );

  let game = createGameState('sp-pb2-006-kinako', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, live, liella, secondLiella, nonLiella, liveWaiting]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const waitingRoomCards =
      options.waitingRoomCards === 'none'
        ? []
        : options.waitingRoomCards === 'mixed'
          ? [nonLiella.instanceId, liveWaiting.instanceId, liella.instanceId]
          : [liella.instanceId, secondLiella.instanceId];
    return {
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      liveZone: {
        ...player.liveZone,
        cardIds: [live.instanceId],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingRoomCards,
      },
    };
  });

  return {
    game,
    sourceId: source.instanceId,
    liveId: live.instanceId,
    liellaId: liella.instanceId,
    secondLiellaId: secondLiella.instanceId,
    nonLiellaId: nonLiella.instanceId,
    liveWaitingId: liveWaiting.instanceId,
  };
}

function enqueueLiveSuccess(game: GameState, liveId: string): GameState {
  const event = createLiveSuccessEvent(PLAYER1, [liveId], 3);
  return enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS], {
    liveSuccessEvents: [event],
  });
}

function enqueueSourceMove(
  game: GameState,
  sourceId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  const moved = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [fromSlot]: null,
        [toSlot]: sourceId,
      },
    },
  }));
  const event = createMemberSlotMovedEvent(sourceId, PLAYER1, fromSlot, toSlot);
  return enqueueTriggeredCardEffects(
    emitGameEvent(moved, event),
    [TriggerCondition.ON_MEMBER_SLOT_MOVED]
  );
}

function resolveAndStack(game: GameState, selectedCardId: string): GameState {
  let state = resolvePendingCardEffects(game).gameState;
  expect(state.activeEffect?.abilityId).toBe(
    SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID
  );
  state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, selectedCardId);
  return state;
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_PB2_006_AUTO_LIVE_SUCCESS_OR_MOVE_STACK_LIELLA_MEMBER_BELOW_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-pb2-006 Kinako stack Liella member below', () => {
  it('stacks a waiting room Liella member below this member after own LIVE success', () => {
    const scenario = setupState();
    const queued = enqueueLiveSuccess(scenario.game, scenario.liveId);
    expect(queued.pendingAbilities).toHaveLength(1);

    const state = resolveAndStack(queued, scenario.liellaId);

    expect(state.players[0].waitingRoom.cardIds).not.toContain(scenario.liellaId);
    expect(state.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      scenario.liellaId,
    ]);
    expect(abilityUseCount(state)).toBe(1);
  });

  it('stacks after this source member moves between slots', () => {
    const scenario = setupState({ waitingRoomCards: 'mixed' });
    const queued = enqueueSourceMove(
      scenario.game,
      scenario.sourceId,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );
    expect(queued.pendingAbilities).toHaveLength(1);

    let state = resolvePendingCardEffects(queued).gameState;
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.liellaId]);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.liellaId);

    expect(state.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([
      scenario.liellaId,
    ]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.nonLiellaId,
      scenario.liveWaitingId,
    ]);
  });

  it('shares per-turn limit between LIVE success and move triggers', () => {
    const scenario = setupState();
    let state = resolveAndStack(enqueueLiveSuccess(scenario.game, scenario.liveId), scenario.liellaId);

    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, scenario.secondLiellaId],
      },
    }));
    const queuedMove = enqueueSourceMove(
      state,
      scenario.sourceId,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );

    expect(queuedMove.pendingAbilities).toEqual([]);
    expect(abilityUseCount(queuedMove)).toBe(1);
  });

  it('no-ops without a waiting room Liella member and does not consume the turn use', () => {
    const scenario = setupState({ waitingRoomCards: 'none' });
    let state = resolvePendingCardEffects(enqueueLiveSuccess(scenario.game, scenario.liveId)).gameState;

    expect(state.activeEffect).toBeNull();
    expect(abilityUseCount(state)).toBe(0);

    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [scenario.liellaId],
      },
    }));
    const queuedMove = enqueueSourceMove(
      state,
      scenario.sourceId,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );
    state = resolveAndStack(queuedMove, scenario.liellaId);

    expect(state.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([
      scenario.liellaId,
    ]);
    expect(abilityUseCount(state)).toBe(1);
  });
});
