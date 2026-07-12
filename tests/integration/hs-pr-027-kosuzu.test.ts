import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
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
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
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

function member(cardCode: string, cost: number): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function pending(sourceCardId: string, suffix = sourceCardId): PendingAbilityState {
  return {
    id: `pending-${suffix}`,
    abilityId: N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  cheerCards: readonly ReturnType<typeof createCardInstance>[];
  revealedCardIds?: readonly string[];
  ownCheerCardIds?: readonly string[];
  sourceCount?: number;
}) {
  const sourceCount = options.sourceCount ?? 1;
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(member('PL!HS-PR-027-PR', 7), PLAYER1, `kosuzu-${index + 1}`)
  );
  const discards = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(member(`PL!HS-test-discard-${index + 1}`, 1), PLAYER1, `discard-${index + 1}`)
  );
  let game = createGameState('hs-pr-027-kosuzu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sources, ...discards, ...options.cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: sources.reduce(
      (slots, source, index) =>
        placeCardInSlot(
          slots,
          index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT,
          source.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
      player.memberSlots
    ),
    hand: { ...player.hand, cardIds: discards.map((card) => card.instanceId) },
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
        options.ownCheerCardIds ?? options.cheerCards.map((card) => card.instanceId),
    },
  };
  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: sources.map((source, index) => pending(source.instanceId, String(index + 1))),
  }).gameState;
  const session = createGameSession();
  session.createGame('hs-pr-027-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return {
    session,
    sourceIds: sources.map((source) => source.instanceId),
    discardIds: discards.map((card) => card.instanceId),
    discardId: discards[0]!.instanceId,
  };
}

function choose(session: GameSession, selectedCardId: string | null) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
  if (result.success) confirmPublicSelectionIfNeeded(session);
  return result;
}

describe('PL!HS-PR-027 Kosuzu shared LIVE success workflow', () => {
  it('uses the existing N_PR_021 ability definition for the exact card code', () => {
    expect(
      getCardAbilityDefinitionsForCardCode('PL!HS-PR-027-PR').find(
        (definition) =>
          definition.abilityId ===
          N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID
      )
    ).toMatchObject({
      baseCardCodes: ['PL!N-PR-021', 'PL!HS-PR-027'],
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      queued: true,
      implemented: true,
    });
  });

  it.each([
    ['member', createCardInstance(member('PL!HS-test-member-2', 2), PLAYER1, 'member-2')],
    ['LIVE', createCardInstance(live('PL!HS-test-live-2', 2), PLAYER1, 'live-2')],
  ])('discards one hand card and recovers a legal low %s target', (_kind, target) => {
    const { session, discardId } = setup({ cheerCards: [target] });
    expect(session.state?.activeEffect?.stepId).toContain('SELECT_DISCARD');
    expect(session.state?.activeEffect?.stepText).not.toMatch(/confirm|确认后/i);

    expect(choose(session, discardId).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(choose(session, target.instanceId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardId);
    expect(session.state?.players[0].hand.cardIds).toContain(target.instanceId);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(discardId) === true
      )
    ).toBe(true);
  });

  it('declines without paying or moving a revealed cheer card', () => {
    const target = createCardInstance(member('PL!HS-test-member-1', 1), PLAYER1, 'member-1');
    const { session, discardId } = setup({ cheerCards: [target] });
    expect(choose(session, null).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(discardId);
    expect(session.state?.resolutionZone.cardIds).toContain(target.instanceId);
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('keeps the discard cost and continues when no legal target remains', () => {
    const target = createCardInstance(member('PL!HS-test-member-3', 3), PLAYER1, 'member-3');
    const { session, discardId } = setup({ cheerCards: [target] });
    expect(choose(session, discardId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardId);
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('excludes illegal type, high cost, high score, opponent, initially unrevealed, and non-cheer targets', () => {
    const valid = createCardInstance(member('PL!HS-test-valid', 2), PLAYER1, 'valid');
    const highCost = createCardInstance(member('PL!HS-test-high-cost', 3), PLAYER1, 'high-cost');
    const highScore = createCardInstance(live('PL!HS-test-high-score', 3), PLAYER1, 'high-score');
    const opponent = createCardInstance(member('PL!HS-test-opponent', 1), PLAYER2, 'opponent');
    const stale = createCardInstance(member('PL!HS-test-stale', 1), PLAYER1, 'stale');
    const { session, discardId } = setup({
      cheerCards: [valid, highCost, highScore, opponent, stale],
      ownCheerCardIds: [valid.instanceId, highCost.instanceId, highScore.instanceId, opponent.instanceId],
      revealedCardIds: [valid.instanceId, highCost.instanceId, highScore.instanceId, opponent.instanceId],
    });
    expect(choose(session, discardId).success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([valid.instanceId]);
    expect(choose(session, highCost.instanceId).success).toBe(false);
    expect(choose(session, valid.instanceId).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).not.toContain(stale.instanceId);
  });

  it('continues from the first real discard interaction to the second pending interaction', () => {
    const firstTarget = createCardInstance(member('PL!HS-test-first-target', 1), PLAYER1, 'first-target');
    const secondTarget = createCardInstance(member('PL!HS-test-second-target', 2), PLAYER1, 'second-target');
    const { session, sourceIds, discardIds } = setup({
      cheerCards: [firstTarget, secondTarget],
      sourceCount: 2,
    });

    expect(session.state?.activeEffect).toMatchObject({ canResolveInOrder: true });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          sourceIds[0]
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      sourceCardId: sourceIds[0],
      abilityId: N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    });
    expect(session.state?.activeEffect?.stepId).toContain('SELECT_DISCARD');
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);

    expect(choose(session, discardIds[0]!).success).toBe(true);
    expect(choose(session, firstTarget.instanceId).success).toBe(true);

    expect(session.state?.activeEffect).toMatchObject({
      sourceCardId: sourceIds[1],
      abilityId: N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    });
    expect(session.state?.activeEffect?.stepId).toContain('SELECT_DISCARD');
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(session.state?.pendingAbilities).toEqual([]);

    expect(choose(session, null).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toContain(discardIds[1]);
  });
});
