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
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
  SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createWelcome(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-047-L',
    name: 'Welcome to 僕らのセカイ',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.RED]: 1,
      [HeartColor.YELLOW]: 1,
      [HeartColor.PURPLE]: 1,
    }),
  };
}

function createZettaiLover(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-045-L',
    name: '絶対的LOVER',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
  };
}

function createButterflyWing(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-046-L',
    name: 'Butterfly Wing',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 3, [HeartColor.RAINBOW]: 3 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly groupNames?: readonly string[];
  readonly cost?: number;
  readonly purpleHearts?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.cardCode,
    groupNames: options.groupNames,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, options.purpleHearts ?? 1)],
  };
}

function setupState(options: {
  readonly handCount?: number;
  readonly ownMembers?: Partial<Record<SlotPosition, MemberCardData>>;
  readonly opponentMembers?: Partial<Record<SlotPosition, MemberCardData>>;
  readonly opponentWaitingSlots?: readonly SlotPosition[];
  readonly includeButterfly?: boolean;
  readonly includeZettai?: boolean;
}): {
  readonly game: GameState;
  readonly welcome: ReturnType<typeof createCardInstance>;
  readonly ownMembers: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly opponentMembers: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const welcome = createCardInstance(createWelcome(), PLAYER1, 'welcome-live');
  const butterfly = options.includeButterfly
    ? createCardInstance(createButterflyWing(), PLAYER1, 'butterfly-live')
    : null;
  const zettai = options.includeZettai
    ? createCardInstance(createZettaiLover(), PLAYER1, 'zettai-live')
    : null;
  const ownMemberEntries = Object.entries(options.ownMembers ?? {}).map(([slot, data]) => {
    const card = createCardInstance(data, PLAYER1, `own-${slot.toLowerCase()}`);
    return [slot as SlotPosition, card] as const;
  });
  const opponentMemberEntries = Object.entries(options.opponentMembers ?? {}).map(
    ([slot, data]) => {
      const card = createCardInstance(data, PLAYER2, `opponent-${slot.toLowerCase()}`);
      return [slot as SlotPosition, card] as const;
    }
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(
      createMember({ cardCode: `HAND-${index}`, groupNames: ['Liella!'], cost: 1 }),
      PLAYER1,
      `hand-${index}`
    )
  );
  const liveCards = [butterfly, welcome, zettai].filter(
    (card): card is ReturnType<typeof createCardInstance> => card !== null
  );

  let game = createGameState('sp-pb2-047-welcome', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    ...liveCards,
    ...ownMemberEntries.map(([, card]) => card),
    ...opponentMemberEntries.map(([, card]) => card),
    ...handCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    liveZone: liveCards.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.liveZone
    ),
    memberSlots: ownMemberEntries.reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentMemberEntries.reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: options.opponentWaitingSlots?.includes(slot)
            ? OrientationState.WAITING
            : OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, 1]]),
      performingPlayerId: PLAYER1,
    },
  };

  return {
    game,
    welcome,
    ownMembers: Object.fromEntries(ownMemberEntries),
    opponentMembers: Object.fromEntries(opponentMemberEntries),
    handCards,
  };
}

function startLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function createSession(state: GameState, id = 'sp-pb2-047-session') {
  const session = createGameSession();
  session.createGame(id, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function latestWelcomePayload(game: GameState, step: string) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID &&
        action.payload.step === step
    )?.payload;
}

describe('PL!SP-pb2-047-L Welcome to Bokura no Sekai workflow', () => {
  it('discards one hand card through trigger wrapper, then waits an active opponent cost <=2 member', () => {
    const { game, handCards, opponentMembers } = setupState({
      handCount: 1,
      ownMembers: {
        [SlotPosition.CENTER]: createMember({
          cardCode: 'PL!SP-test-own',
          groupNames: ['Liella!'],
          cost: 4,
        }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({
          cardCode: 'PL!SP-test-opponent-low',
          groupNames: ['Liella!'],
          cost: 2,
        }),
      },
    });
    const state = startLiveStart(game);
    expect(state.activeEffect?.stepId).toBe('SP_PB2_047_SELECT_DISCARD');

    const session = createSession(state);
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, handCards[0]!.instanceId)
    );
    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([handCards[0]!.instanceId]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === handCards[0]!.instanceId
      )
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('SP_PB2_047_SELECT_OPPONENT_LOW_COST_MEMBER');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      opponentMembers[SlotPosition.LEFT]!.instanceId,
    ]);

    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        opponentMembers[SlotPosition.LEFT]!.instanceId
      )
    );
    expect(targetResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(
        opponentMembers[SlotPosition.LEFT]!.instanceId
      )?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === opponentMembers[SlotPosition.LEFT]!.instanceId &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(latestWelcomePayload(session.state!, 'WAIT_OPPONENT_LOW_COST_MEMBER')).toMatchObject({
      discardedCardId: handCards[0]!.instanceId,
      targetCardId: opponentMembers[SlotPosition.LEFT]!.instanceId,
    });
  });

  it('skips cleanly when the player declines to discard', () => {
    const { game } = setupState({
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-test-own', groupNames: ['Liella!'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
    });
    const state = startLiveStart(game);
    const session = createSession(state, 'sp-pb2-047-skip');
    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(latestWelcomePayload(session.state!, 'SKIP_DISCARD')).toBeTruthy();
  });

  it.each([
    {
      label: 'no hand',
      handCount: 0,
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-test-own', groupNames: ['Liella!'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
      reason: 'NO_HAND',
    },
    {
      label: 'non-Liella own stage',
      handCount: 1,
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!S-test-own', groupNames: ['Aqours'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
      reason: 'NON_LIELLA_STAGE',
    },
    {
      label: 'empty own stage',
      handCount: 1,
      ownMembers: {},
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
      reason: 'NO_STAGE_MEMBERS',
    },
    {
      label: 'no legal opponent target',
      handCount: 1,
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-test-own', groupNames: ['Liella!'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 3 }),
      },
      reason: 'NO_TARGET',
    },
  ])(
    'does not open discard selection for $label',
    ({ handCount, ownMembers, opponentMembers, reason }) => {
      const { game } = setupState({
        handCount,
        ownMembers,
        opponentMembers,
      });

      const state = startLiveStart(game);

      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toEqual([]);
      expect(latestWelcomePayload(state, 'NO_OP')).toMatchObject({ reason });
    }
  );

  it('does not offer cost >2 or already WAITING opponent members as targets', () => {
    const { game, handCards, opponentMembers } = setupState({
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-test-own', groupNames: ['Liella!'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-high-cost', cost: 3 }),
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-waiting-low', cost: 2 }),
        [SlotPosition.RIGHT]: createMember({ cardCode: 'PL!SP-active-low', cost: 2 }),
      },
      opponentWaitingSlots: [SlotPosition.CENTER],
    });
    const state = startLiveStart(game);
    const session = createSession(state, 'sp-pb2-047-filter-targets');
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, handCards[0]!.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      opponentMembers[SlotPosition.RIGHT]!.instanceId,
    ]);
  });

  it('keeps the paid discard if the opponent target disappears after cost payment', () => {
    const { game, handCards, opponentMembers } = setupState({
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-test-own', groupNames: ['Liella!'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
    });
    const state = startLiveStart(game);
    const changedState = updatePlayer(state, PLAYER2, (player) => {
      const cardStates = new Map(player.memberSlots.cardStates);
      cardStates.set(opponentMembers[SlotPosition.LEFT]!.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
      return {
        ...player,
        memberSlots: {
          ...player.memberSlots,
          cardStates,
        },
      };
    });
    const session = createSession(changedState, 'sp-pb2-047-target-disappears');
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        changedState.activeEffect!.id,
        handCards[0]!.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([handCards[0]!.instanceId]);
    expect(latestWelcomePayload(session.state!, 'DISCARD_HAND_CARD_NO_TARGET')).toMatchObject({
      discardedCardId: handCards[0]!.instanceId,
      legalTargetCardIds: [],
    });
  });

  it('still resolves as a LIVE_CARD source when Butterfly Wing is also in liveZone', () => {
    const { game } = setupState({
      includeButterfly: true,
      ownMembers: {
        [SlotPosition.CENTER]: createMember({ cardCode: 'PL!SP-test-own', groupNames: ['Liella!'] }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
    });

    const state = startLiveStart(game);

    expect(state.activeEffect?.abilityId).toBe(
      SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID
    );
    expect(state.activeEffect?.stepId).toBe('SP_PB2_047_SELECT_DISCARD');
  });

  it('continues ordered pending resolution after target selection', () => {
    const { game, handCards, opponentMembers } = setupState({
      includeZettai: true,
      ownMembers: {
        [SlotPosition.CENTER]: createMember({
          cardCode: 'PL!SP-test-own',
          groupNames: ['Liella!'],
          purpleHearts: 4,
        }),
      },
      opponentMembers: {
        [SlotPosition.LEFT]: createMember({ cardCode: 'PL!SP-test-opponent', cost: 2 }),
      },
    });
    const state = startLiveStart(game);
    expect(state.activeEffect?.canResolveInOrder).toBe(true);

    const session = createSession(state, 'sp-pb2-047-ordered');
    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, undefined, null, true)
    );
    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('SP_PB2_047_SELECT_DISCARD');

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        handCards[0]!.instanceId
      )
    );
    expect(discardResult.success).toBe(true);
    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        opponentMembers[SlotPosition.LEFT]!.instanceId
      )
    );

    expect(targetResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(true);
  });
});
