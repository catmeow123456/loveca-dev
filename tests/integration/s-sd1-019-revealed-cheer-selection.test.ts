import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { S_SD1_019_LIVE_SUCCESS_AQOURS_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLiveCard(cardCode: string, name = cardCode, groupName = 'Aqours'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createMemberCard(cardCode: string, name = cardCode, groupName = 'Aqours'): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupMiraBokuScenario(): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly validAqoursLiveId: string;
  readonly otherGroupLiveId: string;
  readonly aqoursMemberId: string;
  readonly opponentAqoursLiveId: string;
  readonly staleAqoursLiveId: string;
  readonly unrevealedAqoursLiveId: string;
} {
  const session = createGameSession();
  session.createGame('s-sd1-019-mira-boku-cheer', PLAYER1, 'P1', PLAYER2, 'P2');

  const sourceLive = createCardInstance(
    createLiveCard('PL!S-sd1-019-SD', '未来の僕らは知ってるよ'),
    PLAYER1,
    'p1-s-sd1-019-source'
  );
  const validAqoursLive = createCardInstance(
    createLiveCard('PL!S-test-valid-aqours-live', 'Valid Aqours Live'),
    PLAYER1,
    'p1-valid-aqours-live'
  );
  const otherGroupLive = createCardInstance(
    createLiveCard('PL!S-test-other-live', 'Other Live', 'Other'),
    PLAYER1,
    'p1-other-live'
  );
  const aqoursMember = createCardInstance(
    createMemberCard('PL!S-test-aqours-member', 'Aqours Member'),
    PLAYER1,
    'p1-aqours-member'
  );
  const opponentAqoursLive = createCardInstance(
    createLiveCard('PL!S-test-opponent-aqours-live', 'Opponent Aqours Live'),
    PLAYER2,
    'p2-aqours-live'
  );
  const staleAqoursLive = createCardInstance(
    createLiveCard('PL!S-test-stale-aqours-live', 'Stale Aqours Live'),
    PLAYER1,
    'p1-stale-aqours-live'
  );
  const unrevealedAqoursLive = createCardInstance(
    createLiveCard('PL!S-test-unrevealed-aqours-live', 'Unrevealed Aqours Live'),
    PLAYER1,
    'p1-unrevealed-aqours-live'
  );

  let game = registerCards(session.state!, [
    sourceLive,
    validAqoursLive,
    otherGroupLive,
    aqoursMember,
    opponentAqoursLive,
    staleAqoursLive,
    unrevealedAqoursLive,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: {
      ...player.liveZone,
      cardIds: [sourceLive.instanceId],
      cardStates: new Map([
        [sourceLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));

  const currentProcessingCheerIds = [
    validAqoursLive.instanceId,
    otherGroupLive.instanceId,
    aqoursMember.instanceId,
    opponentAqoursLive.instanceId,
    unrevealedAqoursLive.instanceId,
  ];
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentProcessingCheerIds,
      revealedCardIds: currentProcessingCheerIds.filter(
        (cardId) => cardId !== unrevealedAqoursLive.instanceId
      ),
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[sourceLive.instanceId, true]]),
      firstPlayerCheerCardIds: [...currentProcessingCheerIds, staleAqoursLive.instanceId],
      performingPlayerId: PLAYER1,
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  const checkResult = new GameService().executeCheckTiming(game, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(checkResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

  return {
    session,
    validAqoursLiveId: validAqoursLive.instanceId,
    otherGroupLiveId: otherGroupLive.instanceId,
    aqoursMemberId: aqoursMember.instanceId,
    opponentAqoursLiveId: opponentAqoursLive.instanceId,
    staleAqoursLiveId: staleAqoursLive.instanceId,
    unrevealedAqoursLiveId: unrevealedAqoursLive.instanceId,
  };
}

describe('PL!S-sd1-019-SD revealed cheer selection', () => {
  it('moves one current revealed own Aqours LIVE card to hand', () => {
    const {
      session,
      validAqoursLiveId,
      otherGroupLiveId,
      aqoursMemberId,
      opponentAqoursLiveId,
      staleAqoursLiveId,
      unrevealedAqoursLiveId,
    } = setupMiraBokuScenario();

    expect(session.state?.activeEffect?.abilityId).toBe(
      S_SD1_019_LIVE_SUCCESS_AQOURS_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validAqoursLiveId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(otherGroupLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(aqoursMemberId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(opponentAqoursLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(staleAqoursLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(unrevealedAqoursLiveId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, validAqoursLiveId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([validAqoursLiveId]);
    expect(session.state?.resolutionZone.cardIds).not.toContain(validAqoursLiveId);
    expect(session.state?.resolutionZone.revealedCardIds).not.toContain(validAqoursLiveId);
  });

  it('rejects stale or illegal revealed cheer selections without moving cards', () => {
    const { session, staleAqoursLiveId, validAqoursLiveId } = setupMiraBokuScenario();

    const rejectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, staleAqoursLiveId)
    );

    expect(rejectResult.success).toBe(false);
    expect(rejectResult.error).toBe('选择的卡牌不能用于当前效果');
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_SD1_019_LIVE_SUCCESS_AQOURS_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.cardIds).toContain(validAqoursLiveId);
  });
});
