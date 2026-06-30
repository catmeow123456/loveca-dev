import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  PB1_019_ACTIVATED_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 2): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function setupScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceOwnerId?: string;
  readonly sourceInStage?: boolean;
  readonly phase?: GamePhase;
  readonly activePlayerIndex?: number;
  readonly includeWaitingMember?: boolean;
  readonly includeWaitingLive?: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly waitingMemberId: string | null;
  readonly waitingLiveId: string | null;
} {
  const session = createGameSession();
  session.createGame('n-self-sacrifice-waiting-room-to-hand', PLAYER1, 'P1', PLAYER2, 'P2');

  const sourceOwnerId = options.sourceOwnerId ?? PLAYER1;
  const source = createCardInstance(
    createMemberCard(options.sourceCardCode, options.sourceName),
    sourceOwnerId,
    `${sourceOwnerId}-source`
  );
  const waitingMember =
    options.includeWaitingMember === true
      ? createCardInstance(createMemberCard('PL!N-test-waiting-member'), PLAYER1, 'p1-member')
      : null;
  const waitingLive =
    options.includeWaitingLive === true
      ? createCardInstance(createLiveCard('PL!N-test-waiting-live'), PLAYER1, 'p1-live')
      : null;

  let game = registerCards(session.state!, [
    source,
    ...(waitingMember ? [waitingMember] : []),
    ...(waitingLive ? [waitingLive] : []),
  ]);

  for (const playerId of [PLAYER1, PLAYER2]) {
    game = updatePlayer(game, playerId, (player) => {
      const ownsSource = sourceOwnerId === playerId;
      const sourceInStage = options.sourceInStage !== false && ownsSource;
      const sourceWaitingRoomId = ownsSource && !sourceInStage ? [source.instanceId] : [];
      const p1WaitingRoomIds =
        playerId === PLAYER1
          ? [
              ...(waitingMember ? [waitingMember.instanceId] : []),
              ...(waitingLive ? [waitingLive.instanceId] : []),
            ]
          : [];
      return {
        ...player,
        hand: { ...player.hand, cardIds: [] },
        mainDeck: { ...player.mainDeck, cardIds: [] },
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...sourceWaitingRoomId, ...p1WaitingRoomIds],
        },
        memberSlots: sourceInStage
          ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            })
          : player.memberSlots,
      };
    });
  }

  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  setAuthorityState(session, game);

  return {
    session,
    sourceId: source.instanceId,
    waitingMemberId: waitingMember?.instanceId ?? null,
    waitingLiveId: waitingLive?.instanceId ?? null,
  };
}

describe('Nijigasaki self-sacrifice waiting-room recovery abilities', () => {
  it.each([
    { cardCode: 'PL!N-bp4-017-N', name: '宮下 愛' },
    { cardCode: 'PL!N-bp4-020-N', name: 'エマ・ヴェルデ' },
  ] as const)('lets $cardCode recover the source member after paying the cost', ({ cardCode, name }) => {
    const { session, sourceId, waitingLiveId } = setupScenario({
      sourceCardCode: cardCode,
      sourceName: name,
      includeWaitingLive: true,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(session.state?.activeEffect?.abilityId).toBe(PB1_019_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([sourceId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(waitingLiveId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, sourceId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([sourceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(sourceId);
  });

  it.each([
    { cardCode: 'PL!N-PR-019-PR', name: '中須かすみ' },
    { cardCode: 'PL!N-sd1-011-SD', name: 'ミア・テイラー' },
  ] as const)('limits $cardCode recovery targets to LIVE cards', ({ cardCode, name }) => {
    const { session, sourceId, waitingMemberId, waitingLiveId } = setupScenario({
      sourceCardCode: cardCode,
      sourceName: name,
      includeWaitingMember: true,
      includeWaitingLive: true,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, RIN_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(session.state?.activeEffect?.abilityId).toBe(RIN_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([waitingLiveId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(sourceId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(waitingMemberId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, waitingLiveId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([waitingLiveId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
  });

  it('keeps the self-sacrifice cost paid when the LIVE recovery family has no legal target', () => {
    const { session, sourceId, waitingMemberId } = setupScenario({
      sourceCardCode: 'PL!N-PR-019-PR',
      sourceName: '中須かすみ',
      includeWaitingMember: true,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, RIN_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([waitingMemberId!, sourceId])
    );

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([waitingMemberId!, sourceId])
    );
  });

  it('rejects activation outside the main phase without paying the source cost', () => {
    const { session, sourceId } = setupScenario({
      sourceCardCode: 'PL!N-bp4-017-N',
      sourceName: '宮下 愛',
      phase: GamePhase.LIVE_SET_PHASE,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('rejects activation by a non-active player without paying the source cost', () => {
    const { session, sourceId } = setupScenario({
      sourceCardCode: 'PL!N-bp4-020-N',
      sourceName: 'エマ・ヴェルデ',
      sourceOwnerId: PLAYER2,
      activePlayerIndex: 0,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER2, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceId);
    expect(session.state?.players[1].waitingRoom.cardIds).toEqual([]);
  });

  it('rejects activation when the source member is not on stage', () => {
    const { session, sourceId } = setupScenario({
      sourceCardCode: 'PL!N-bp4-017-N',
      sourceName: '宮下 愛',
      sourceInStage: false,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, sourceId, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([sourceId]);
  });
});
