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
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_PR_016_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, cost: number, groupName = '5yncri5e!'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createLive(cardCode: string, score: number, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: SP_PR_016_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function createSessionWithState(state: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-sp-pr-016-chisato-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function setupChisatoScenario(options: {
  readonly cheerCards: readonly ReturnType<typeof createCardInstance>[];
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly secondPlayerCheerCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly handCount?: number;
}): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly discardCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-PR-016-PR', 7),
    PLAYER1,
    'chisato-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMember(`PL!SP-test-discard-${index}`, 1), PLAYER1, `discard-${index}`)
  );

  let game = createGameState('pl-sp-pr-016-chisato', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCards, ...options.cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    hand: {
      ...player.hand,
      cardIds: handCards.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: options.resolutionCardIds ?? options.cheerCards.map((card) => card.instanceId),
      revealedCardIds:
        options.revealedCardIds ?? options.cheerCards.map((card) => card.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds:
        options.firstPlayerCheerCardIds ?? options.cheerCards.map((card) => card.instanceId),
      secondPlayerCheerCardIds: options.secondPlayerCheerCardIds ?? [],
    },
  };

  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(source.instanceId)],
  }).gameState;

  return {
    session: createSessionWithState(started),
    sourceCardId: source.instanceId,
    discardCardIds: handCards.map((card) => card.instanceId),
  };
}

function confirm(session: GameSession, selectedCardId: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
}

function enterWaitingRoomFromHandCount(game: GameState): number {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.HAND
    ).length;
}

describe('PL!SP-PR-016 Chisato LIVE success discard recover revealed cheer', () => {
  it('declines the optional discard without moving revealed cheer cards', () => {
    const lowCostMember = createCardInstance(
      createMember('PL!SP-test-low-cost-member', 2),
      PLAYER1,
      'low-cost-member'
    );
    const { session, discardCardIds } = setupChisatoScenario({ cheerCards: [lowCostMember] });

    expect(confirm(session, null).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(discardCardIds[0]);
    expect(session.state?.players[0].hand.cardIds).not.toContain(lowCostMember.instanceId);
    expect(session.state?.resolutionZone.cardIds).toContain(lowCostMember.instanceId);
  });

  it('discards one hand card then moves a cost 2 or lower member from own revealed cheer to hand', () => {
    const lowCostMember = createCardInstance(
      createMember('PL!SP-test-low-cost-member', 2),
      PLAYER1,
      'low-cost-member'
    );
    const { session, discardCardIds } = setupChisatoScenario({ cheerCards: [lowCostMember] });
    const discardCardId = discardCardIds[0]!;

    expect(confirm(session, discardCardId).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostMember.instanceId]);

    expect(confirm(session, lowCostMember.instanceId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(lowCostMember.instanceId);
    expect(session.state?.resolutionZone.cardIds).not.toContain(lowCostMember.instanceId);
    expect(enterWaitingRoomFromHandCount(session.state!)).toBe(1);
  });

  it('discards one hand card then moves a score 2 or lower LIVE from own revealed cheer to hand', () => {
    const lowScoreLive = createCardInstance(
      createLive('PL!SP-test-low-score-live', 2),
      PLAYER1,
      'low-score-live'
    );
    const { session, discardCardIds } = setupChisatoScenario({ cheerCards: [lowScoreLive] });

    expect(confirm(session, discardCardIds[0]!).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowScoreLive.instanceId]);

    expect(confirm(session, lowScoreLive.instanceId).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toContain(lowScoreLive.instanceId);
    expect(session.state?.resolutionZone.revealedCardIds).not.toContain(lowScoreLive.instanceId);
  });

  it('excludes high cost, high score, opponent, stale, absent, and unrevealed cheer candidates', () => {
    const validMember = createCardInstance(
      createMember('PL!SP-test-valid-member', 1),
      PLAYER1,
      'valid-member'
    );
    const highCostMember = createCardInstance(
      createMember('PL!SP-test-high-cost-member', 3),
      PLAYER1,
      'high-cost-member'
    );
    const highScoreLive = createCardInstance(
      createLive('PL!SP-test-high-score-live', 3),
      PLAYER1,
      'high-score-live'
    );
    const staleMember = createCardInstance(
      createMember('PL!SP-test-stale-member', 1),
      PLAYER1,
      'stale-member'
    );
    const absentMember = createCardInstance(
      createMember('PL!SP-test-absent-member', 1),
      PLAYER1,
      'absent-member'
    );
    const unrevealedMember = createCardInstance(
      createMember('PL!SP-test-unrevealed-member', 1),
      PLAYER1,
      'unrevealed-member'
    );
    const opponentMember = createCardInstance(
      createMember('PL!SP-test-opponent-member', 1),
      PLAYER2,
      'opponent-member'
    );
    const { session, discardCardIds } = setupChisatoScenario({
      cheerCards: [
        validMember,
        highCostMember,
        highScoreLive,
        staleMember,
        absentMember,
        unrevealedMember,
        opponentMember,
      ],
      firstPlayerCheerCardIds: [
        validMember.instanceId,
        highCostMember.instanceId,
        highScoreLive.instanceId,
        opponentMember.instanceId,
        absentMember.instanceId,
        unrevealedMember.instanceId,
      ],
      secondPlayerCheerCardIds: [opponentMember.instanceId],
      resolutionCardIds: [
        validMember.instanceId,
        highCostMember.instanceId,
        highScoreLive.instanceId,
        staleMember.instanceId,
        unrevealedMember.instanceId,
        opponentMember.instanceId,
      ],
      revealedCardIds: [
        validMember.instanceId,
        highCostMember.instanceId,
        highScoreLive.instanceId,
        staleMember.instanceId,
        opponentMember.instanceId,
      ],
    });

    expect(confirm(session, discardCardIds[0]!).success).toBe(true);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validMember.instanceId]);
  });

  it('keeps discard cost and resolves when there is no legal revealed cheer candidate', () => {
    const highCostMember = createCardInstance(
      createMember('PL!SP-test-high-cost-member', 3),
      PLAYER1,
      'high-cost-member'
    );
    const { session, discardCardIds } = setupChisatoScenario({ cheerCards: [highCostMember] });

    expect(confirm(session, discardCardIds[0]!).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardIds[0]);
    expect(session.state?.players[0].hand.cardIds).not.toContain(highCostMember.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DISCARD_HAND_CARD_NO_REVEALED_CHEER_TARGET'
      )
    ).toBe(true);
  });
});
