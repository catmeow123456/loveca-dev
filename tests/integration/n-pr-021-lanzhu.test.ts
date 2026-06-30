import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
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
import { N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, cost: number, groupName = 'R3BIRTH'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, score: number, groupName = 'R3BIRTH'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
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
  session.createGame('n-pr-021-lanzhu-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

interface LanzhuScenario {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly discardCardIds: readonly string[];
  readonly cheerCardIds: readonly string[];
}

function setupLanzhuScenario(options: {
  readonly cheerCards: readonly ReturnType<typeof createCardInstance>[];
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
  readonly handCount?: number;
}): LanzhuScenario {
  const source = createCardInstance(createMember('PL!N-PR-021-PR', 7), PLAYER1, 'lanzhu');
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMember(`PL!N-test-discard-${index}`, 1), PLAYER1, `discard-${index}`)
  );

  let game = createGameState('n-pr-021-lanzhu', PLAYER1, 'P1', PLAYER2, 'P2');
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
      cardIds: options.cheerCards.map((card) => card.instanceId),
      revealedCardIds:
        options.revealedCardIds ?? options.cheerCards.map((card) => card.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds:
        options.firstPlayerCheerCardIds ?? options.cheerCards.map((card) => card.instanceId),
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
    cheerCardIds: options.cheerCards.map((card) => card.instanceId),
  };
}

function confirm(session: GameSession, selectedCardId: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
}

describe('PL!N-PR-021 Lanzhu LIVE success discard recover revealed cheer', () => {
  it('discards one hand card then moves a cost 2 or lower member from own revealed cheer to hand', () => {
    const lowCostMember = createCardInstance(
      createMember('PL!N-test-low-cost-member', 2),
      PLAYER1,
      'low-cost-member'
    );
    const { session, discardCardIds } = setupLanzhuScenario({ cheerCards: [lowCostMember] });
    const discardCardId = discardCardIds[0]!;

    expect(confirm(session, discardCardId).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostMember.instanceId]);

    expect(confirm(session, lowCostMember.instanceId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(lowCostMember.instanceId);
    expect(session.state?.resolutionZone.cardIds).not.toContain(lowCostMember.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DISCARD_HAND_CARD_MOVE_REVEALED_CHEER_TO_HAND' &&
          action.payload.discardedCardId === discardCardId &&
          action.payload.selectedCardId === lowCostMember.instanceId
      )
    ).toBe(true);
  });

  it('discards one hand card then moves a score 2 or lower LIVE from own revealed cheer to hand', () => {
    const lowScoreLive = createCardInstance(
      createLive('PL!N-test-low-score-live', 2),
      PLAYER1,
      'low-score-live'
    );
    const { session, discardCardIds } = setupLanzhuScenario({ cheerCards: [lowScoreLive] });

    expect(confirm(session, discardCardIds[0]!).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowScoreLive.instanceId]);

    expect(confirm(session, lowScoreLive.instanceId).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toContain(lowScoreLive.instanceId);
    expect(session.state?.resolutionZone.revealedCardIds).not.toContain(lowScoreLive.instanceId);
  });

  it('excludes illegal, stale, and opponent revealed cheer candidates', () => {
    const validMember = createCardInstance(
      createMember('PL!N-test-valid-member', 1),
      PLAYER1,
      'valid-member'
    );
    const highCostMember = createCardInstance(
      createMember('PL!N-test-high-cost-member', 3),
      PLAYER1,
      'high-cost-member'
    );
    const highScoreLive = createCardInstance(
      createLive('PL!N-test-high-score-live', 3),
      PLAYER1,
      'high-score-live'
    );
    const staleMember = createCardInstance(
      createMember('PL!N-test-stale-member', 1),
      PLAYER1,
      'stale-member'
    );
    const opponentMember = createCardInstance(
      createMember('PL!N-test-opponent-member', 1),
      PLAYER2,
      'opponent-member'
    );
    const { session, discardCardIds } = setupLanzhuScenario({
      cheerCards: [validMember, highCostMember, highScoreLive, staleMember, opponentMember],
      firstPlayerCheerCardIds: [
        validMember.instanceId,
        highCostMember.instanceId,
        highScoreLive.instanceId,
        opponentMember.instanceId,
      ],
    });

    expect(confirm(session, discardCardIds[0]!).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validMember.instanceId]);

    const illegalResult = confirm(session, highCostMember.instanceId);
    expect(illegalResult.success).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validMember.instanceId]);
    expect(session.state?.players[0].hand.cardIds).not.toContain(highCostMember.instanceId);

    expect(confirm(session, validMember.instanceId).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(validMember.instanceId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(staleMember.instanceId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(opponentMember.instanceId);
  });

  it('keeps discard cost and resolves without opening a target choice when there is no legal candidate', () => {
    const highCostMember = createCardInstance(
      createMember('PL!N-test-high-cost-member', 3),
      PLAYER1,
      'high-cost-member'
    );
    const { session, discardCardIds } = setupLanzhuScenario({ cheerCards: [highCostMember] });
    const discardCardId = discardCardIds[0]!;

    expect(confirm(session, discardCardId).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(highCostMember.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DISCARD_HAND_CARD_NO_REVEALED_CHEER_TARGET' &&
          action.payload.movedCardIds instanceof Array &&
          action.payload.movedCardIds.length === 0
      )
    ).toBe(true);
  });

  it('declines without discarding or moving revealed cheer cards', () => {
    const lowCostMember = createCardInstance(
      createMember('PL!N-test-low-cost-member', 2),
      PLAYER1,
      'low-cost-member'
    );
    const { session, discardCardIds } = setupLanzhuScenario({ cheerCards: [lowCostMember] });
    const discardCardId = discardCardIds[0]!;

    expect(confirm(session, null).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(lowCostMember.instanceId);
    expect(session.state?.resolutionZone.cardIds).toContain(lowCostMember.instanceId);
  });

  it('consumes pending without a discard choice when hand is empty', () => {
    const lowCostMember = createCardInstance(
      createMember('PL!N-test-low-cost-member', 2),
      PLAYER1,
      'low-cost-member'
    );
    const { session } = setupLanzhuScenario({
      cheerCards: [lowCostMember],
      handCount: 0,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).not.toContain(lowCostMember.instanceId);
    expect(session.state?.resolutionZone.cardIds).toContain(lowCostMember.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });
});
