import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  updateResolutionZone,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, OrientationState, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function pending(sourceCardId: string, id = 'pending-s-bp5-019'): PendingAbilityState {
  return {
    id,
    abilityId: S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event:${id}`],
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('s-bp5-019-not-alone-not-hitori', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmSelectedCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  const session = sessionWithState(game);
  const effect = game.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
  expect(result.success, result.error).toBe(true);
  confirmPublicSelectionIfNeeded(session);
  return session.state!;
}

function setupState(options: {
  readonly ownSuccessCount?: number;
  readonly opponentSuccessCount?: number;
  readonly cheerCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
  readonly extraPending?: readonly PendingAbilityState[];
} = {}): {
  readonly game: GameState;
  readonly sourceLiveId: string;
  readonly cheerCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const sourceLive = createCardInstance(live('PL!S-bp5-019-L'), PLAYER1, 'not-alone-live');
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(live(`PL!S-own-success-${index}`), PLAYER1, `own-success-${index}`)
  );
  const opponentSuccessLives = Array.from({ length: options.opponentSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(live(`PL!S-opponent-success-${index}`), PLAYER2, `opponent-success-${index}`)
  );
  const cheerCards = options.cheerCards ?? [];
  let game = createGameState('s-bp5-019-not-alone-not-hitori', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, ...ownSuccessLives, ...opponentSuccessLives, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
      orientation: OrientationState.ACTIVE,
    }),
    successZone: ownSuccessLives.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.successZone),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    successZone: opponentSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: options.resolutionCardIds ?? cheerCards.map((card) => card.instanceId),
    revealedCardIds: options.revealedCardIds ?? cheerCards.map((card) => card.instanceId),
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
        firstPlayerCheerCardIds:
          options.firstPlayerCheerCardIds ?? cheerCards.map((card) => card.instanceId),
        secondPlayerCheerCardIds: [],
      },
      pendingAbilities: [pending(sourceLive.instanceId), ...(options.extraPending ?? [])],
    },
    sourceLiveId: sourceLive.instanceId,
    cheerCards,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function latestPayload(game: GameState, step?: string) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID &&
        (step === undefined || action.payload.step === step)
    )?.payload;
}

describe('PL!S-bp5-019-L not ALONE not HITORI', () => {
  it('opens a 0-2 member selection when own success zone has two cards and moves two selected members to hand', () => {
    const memberA = createCardInstance(member('PL!S-cheer-member-a'), PLAYER1, 'member-a');
    const memberB = createCardInstance(member('PL!S-cheer-member-b'), PLAYER1, 'member-b');
    const memberC = createCardInstance(member('PL!S-cheer-member-c'), PLAYER1, 'member-c');
    const { game } = setupState({ ownSuccessCount: 2, cheerCards: [memberA, memberB, memberC] });

    const started = start(game);
    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID,
      selectableCardIds: [memberA.instanceId, memberB.instanceId, memberC.instanceId],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      canSkipSelection: true,
    });

    const resolved = confirmSelectedCards(started, [memberA.instanceId, memberB.instanceId]);
    expect(resolved.players[0].hand.cardIds).toEqual([memberA.instanceId, memberB.instanceId]);
    expect(resolved.resolutionZone.cardIds).toEqual([memberC.instanceId]);
    expect(latestPayload(resolved, 'MOVE_REVEALED_CHEER_MEMBER_TO_HAND')).toMatchObject({
      movedCardIds: [memberA.instanceId, memberB.instanceId],
    });
  });

  it('also satisfies the condition when opponent success zone has two cards', () => {
    const target = createCardInstance(member('PL!S-cheer-member'), PLAYER1, 'member-target');
    const { game } = setupState({ opponentSuccessCount: 2, cheerCards: [target] });

    const started = start(game);

    expect(started.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
  });

  it('consumes no-op when neither success zone has two cards or when there are no member targets', () => {
    const memberTarget = createCardInstance(member('PL!S-cheer-member'), PLAYER1, 'member-target');
    const notEnough = start(setupState({ ownSuccessCount: 1, cheerCards: [memberTarget] }).game);
    expect(notEnough.activeEffect).toBeNull();
    expect(latestPayload(notEnough, 'CONDITION_NOT_MET')).toMatchObject({
      successZoneConditionMet: false,
      conditionMet: false,
    });

    const liveTarget = createCardInstance(live('PL!S-cheer-live'), PLAYER1, 'live-target');
    const noMember = start(setupState({ ownSuccessCount: 2, cheerCards: [liveTarget] }).game);
    expect(noMember.activeEffect).toBeNull();
    expect(latestPayload(noMember, 'NO_REVEALED_CHEER_MEMBER_TARGET')).toBeTruthy();
  });

  it('allows selecting zero cards and continues pending resolution', () => {
    const target = createCardInstance(member('PL!S-cheer-member'), PLAYER1, 'member-target');
    const { game, sourceLiveId } = setupState({ ownSuccessCount: 2, cheerCards: [target] });
    const orderSelection = start({
      ...game,
      pendingAbilities: [pending(sourceLiveId), pending(sourceLiveId, 'pending-next')],
    });
    const started = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    const continued = confirmSelectedCards(started, []);

    expect(continued.activeEffect).toMatchObject({
      id: 'pending-next',
      abilityId: S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    });
    expect(continued.players[0].hand.cardIds).toEqual([]);

    const resolved = confirmSelectedCards(continued, []);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID &&
          action.payload.step === 'SKIP_REVEALED_CHEER_MEMBER_SELECTION'
      )
    ).toHaveLength(2);
  });

  it('rejects illegal, duplicate, too many, and stale revealed targets without moving cards', () => {
    const legalA = createCardInstance(member('PL!S-legal-a'), PLAYER1, 'legal-a');
    const legalB = createCardInstance(member('PL!S-legal-b'), PLAYER1, 'legal-b');
    const illegal = createCardInstance(member('PL!S-illegal'), PLAYER1, 'illegal');
    const { game } = setupState({
      ownSuccessCount: 2,
      cheerCards: [legalA, legalB, illegal],
      resolutionCardIds: [legalA.instanceId, legalB.instanceId],
      revealedCardIds: [legalA.instanceId, legalB.instanceId],
      firstPlayerCheerCardIds: [legalA.instanceId, legalB.instanceId, illegal.instanceId],
    });
    const started = start(game);

    for (const selectedCardIds of [
      [illegal.instanceId],
      [legalA.instanceId, legalA.instanceId],
      [legalA.instanceId, legalB.instanceId, illegal.instanceId],
    ]) {
      const session = sessionWithState(started);
      const result = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          started.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedCardIds
        )
      );
      expect(result.success).toBe(false);
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
    }

    const staleState = updateResolutionZone(started, (zone) => ({
      ...zone,
      cardIds: zone.cardIds.filter((cardId) => cardId !== legalA.instanceId),
      revealedCardIds: zone.revealedCardIds.filter((cardId) => cardId !== legalA.instanceId),
    }));
    const staleSession = sessionWithState(staleState);
    const staleResult = staleSession.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        staleState.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [legalA.instanceId]
      )
    );
    expect(staleResult.success).toBe(false);
    expect(staleSession.state?.players[0].hand.cardIds).toEqual([]);
  });
});
