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
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
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
    readonly groupName?: string;
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: options.groupName ?? "μ's",
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(
  cardCode: string,
  options: {
    readonly groupName?: string;
    readonly score?: number;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: options.groupName ?? "μ's",
    cardType: CardType.LIVE,
    score: options.score ?? 7,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `${BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID}:${sourceCardId}:pending`,
    abilityId: BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

function createSessionFromGame(game: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('pl-bp6-021-wonderful-rush', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupScenario(options: {
  readonly museStageMember?: boolean;
  readonly aqoursStageMember?: boolean;
  readonly museWaitingLive?: boolean;
  readonly aqoursWaitingLive?: boolean;
  readonly waitingMember?: boolean;
}) {
  const sourceLive = createCardInstance(
    createLive('PL!-bp6-021-L', { score: 7 }),
    PLAYER1,
    'bp6-021-source-live'
  );
  const museMember =
    options.museStageMember === true
      ? createCardInstance(createMember('PL!-bp6-021-muse-member'), PLAYER1, 'bp6-021-muse-member')
      : null;
  const aqoursMember =
    options.aqoursStageMember === true
      ? createCardInstance(
          createMember('PL!S-bp6-021-aqours-member', { groupName: 'Aqours' }),
          PLAYER1,
          'bp6-021-aqours-member'
        )
      : null;
  const museWaitingLive =
    options.museWaitingLive === true
      ? createCardInstance(createLive('PL!-bp6-021-muse-live'), PLAYER1, 'bp6-021-muse-live')
      : null;
  const aqoursWaitingLive =
    options.aqoursWaitingLive === true
      ? createCardInstance(
          createLive('PL!S-bp6-021-aqours-live', { groupName: 'Aqours' }),
          PLAYER1,
          'bp6-021-aqours-live'
        )
      : null;
  const waitingMember =
    options.waitingMember === true
      ? createCardInstance(createMember('PL!-bp6-021-waiting-member'), PLAYER1, 'bp6-021-waiting-member')
      : null;

  let game = createGameState('pl-bp6-021-wonderful-rush', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    sourceLive,
    ...(museMember ? [museMember] : []),
    ...(aqoursMember ? [aqoursMember] : []),
    ...(museWaitingLive ? [museWaitingLive] : []),
    ...(aqoursWaitingLive ? [aqoursWaitingLive] : []),
    ...(waitingMember ? [waitingMember] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (museMember) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, museMember.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (aqoursMember) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, aqoursMember.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      liveZone: {
        ...player.liveZone,
        cardIds: [sourceLive.instanceId],
        cardStates: new Map([
          [
            sourceLive.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]),
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [
          ...(museWaitingLive ? [museWaitingLive.instanceId] : []),
          ...(aqoursWaitingLive ? [aqoursWaitingLive.instanceId] : []),
          ...(waitingMember ? [waitingMember.instanceId] : []),
        ],
      },
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 7]]),
    },
  };

  return {
    game,
    sourceLiveId: sourceLive.instanceId,
    museMemberId: museMember?.instanceId ?? null,
    aqoursMemberId: aqoursMember?.instanceId ?? null,
    museWaitingLiveId: museWaitingLive?.instanceId ?? null,
    aqoursWaitingLiveId: aqoursWaitingLive?.instanceId ?? null,
    waitingMemberId: waitingMember?.instanceId ?? null,
  };
}

function startAbility(game: GameState, sourceLiveId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(sourceLiveId)],
  }).gameState;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!-bp6-021 Wonderful Rush workflow', () => {
  it('skips without moving members or adding score', () => {
    const scenario = setupScenario({ museStageMember: true, museWaitingLive: true });
    const started = startAbility(scenario.game, scenario.sourceLiveId);
    const session = createSessionFromGame(started);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(result.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.museMemberId
    );
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('consumes pending when there is no selectable Muse stage member', () => {
    const scenario = setupScenario({ aqoursStageMember: true, museWaitingLive: true });
    const state = startAbility(scenario.game, scenario.sourceLiveId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.aqoursMemberId);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(latestPayload(state)).toMatchObject({ step: 'NO_MUSE_MEMBER_TARGET' });
  });

  it('sends a Muse member to waiting room, adds score, and recovers a Muse live', () => {
    const scenario = setupScenario({
      museStageMember: true,
      aqoursStageMember: true,
      museWaitingLive: true,
      aqoursWaitingLive: true,
      waitingMember: true,
    });
    const started = startAbility(scenario.game, scenario.sourceLiveId);

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.museMemberId]);

    const session = createSessionFromGame(started);
    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        scenario.museMemberId ?? undefined
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(scenario.museMemberId);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(8);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: scenario.sourceLiveId,
      sourceCardId: scenario.sourceLiveId,
      abilityId: BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID,
    });
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === scenario.museMemberId
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === scenario.museMemberId
      )
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([scenario.museWaitingLiveId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        scenario.museWaitingLiveId ?? undefined
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([scenario.museWaitingLiveId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(
      scenario.museWaitingLiveId
    );
  });

  it('keeps paid cost and score when there is no Muse live recovery target', () => {
    const scenario = setupScenario({
      museStageMember: true,
      aqoursWaitingLive: true,
      waitingMember: true,
    });
    const started = startAbility(scenario.game, scenario.sourceLiveId);
    const session = createSessionFromGame(started);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        scenario.museMemberId ?? undefined
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(scenario.museMemberId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(8);
    expect(latestPayload(session.state!)).toMatchObject({
      step: 'SCORE_NO_RECOVERY_TARGET',
      movedMemberCardId: scenario.museMemberId,
    });
  });
});
