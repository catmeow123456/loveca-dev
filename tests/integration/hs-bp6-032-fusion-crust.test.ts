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
import { HS_BP6_032_LIVE_SUCCESS_LOW_COST_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(cardCode: string, cost: number, groupName = '蓮ノ空'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, score = 2, groupName = '蓮ノ空'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupFusionCrustScenario(options: {
  readonly includeLowCostTarget: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly lowCostMemberId: string;
  readonly staleLowCostMemberId: string;
  readonly opponentLowCostMemberId: string;
  readonly highCostMemberId: string;
  readonly liveCheerId: string;
} {
  const session = createGameSession();
  session.createGame('hs-bp6-032-fusion-crust', PLAYER1, 'P1', PLAYER2, 'P2');

  const fusionCrust = createCardInstance(
    createLiveCard('PL!HS-bp6-032-L'),
    PLAYER1,
    'p1-fusion-crust'
  );
  const lowCostMember = createCardInstance(
    createMemberCard('PL!HS-test-low-member', 4),
    PLAYER1,
    'p1-low-member'
  );
  const staleLowCostMember = createCardInstance(
    createMemberCard('PL!HS-test-stale-low-member', 4),
    PLAYER1,
    'p1-stale-low-member'
  );
  const opponentLowCostMember = createCardInstance(
    createMemberCard('PL!HS-test-opponent-low-member', 4),
    PLAYER2,
    'p2-low-member'
  );
  const highCostMember = createCardInstance(
    createMemberCard('PL!HS-test-high-member', 5),
    PLAYER1,
    'p1-high-member'
  );
  const liveCheer = createCardInstance(
    createLiveCard('PL!HS-test-live-cheer'),
    PLAYER1,
    'p1-live-cheer'
  );

  let game = registerCards(session.state!, [
    fusionCrust,
    lowCostMember,
    staleLowCostMember,
    opponentLowCostMember,
    highCostMember,
    liveCheer,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    liveZone: {
      ...player.liveZone,
      cardIds: [fusionCrust.instanceId],
      cardStates: new Map([
        [
          fusionCrust.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ],
      ]),
    },
  }));

  const currentProcessingCheerIds = [
    ...(options.includeLowCostTarget ? [lowCostMember.instanceId] : []),
    highCostMember.instanceId,
    liveCheer.instanceId,
    opponentLowCostMember.instanceId,
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
      revealedCardIds: currentProcessingCheerIds,
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[fusionCrust.instanceId, true]]),
      firstPlayerCheerCardIds: [...currentProcessingCheerIds, staleLowCostMember.instanceId],
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
    lowCostMemberId: lowCostMember.instanceId,
    staleLowCostMemberId: staleLowCostMember.instanceId,
    opponentLowCostMemberId: opponentLowCostMember.instanceId,
    highCostMemberId: highCostMember.instanceId,
    liveCheerId: liveCheer.instanceId,
  };
}

describe('PL!HS-bp6-032-L Fusion Crust live-success workflow', () => {
  it('recovers exactly one own low-cost member still revealed in the current cheer processing zone', () => {
    const {
      session,
      lowCostMemberId,
      staleLowCostMemberId,
      opponentLowCostMemberId,
      highCostMemberId,
      liveCheerId,
    } = setupFusionCrustScenario({ includeLowCostTarget: true });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_032_LIVE_SUCCESS_LOW_COST_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostMemberId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(staleLowCostMemberId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(opponentLowCostMemberId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowCostMemberId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([lowCostMemberId]);
    expect(session.state?.resolutionZone.cardIds).toEqual([
      highCostMemberId,
      liveCheerId,
      opponentLowCostMemberId,
    ]);
  });

  it('does not open a selection step when no legal revealed cheer target exists', () => {
    const { session } = setupFusionCrustScenario({ includeLowCostTarget: false });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_032_LIVE_SUCCESS_LOW_COST_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID &&
          action.payload.step === 'NO_REVEALED_CHEER_TARGET'
      )
    ).toBe(true);
  });

  it('rejects an illegal revealed cheer selection without moving cards', () => {
    const { session, highCostMemberId } = setupFusionCrustScenario({ includeLowCostTarget: true });

    const rejectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, highCostMemberId)
    );

    expect(rejectResult.success).toBe(false);
    expect(rejectResult.error).toBe('选择的卡牌不能用于当前效果');
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_032_LIVE_SUCCESS_LOW_COST_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.cardIds).toContain(highCostMemberId);
  });
});
