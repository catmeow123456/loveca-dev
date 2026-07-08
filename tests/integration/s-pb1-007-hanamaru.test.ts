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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_S_PB1_007_LIVE_SUCCESS_CHEER_LIVE_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createHanamaru() {
  return createCardInstance(
    createMemberData('PL!S-pb1-007-R', '国木田花丸'),
    PLAYER1,
    's-pb1-007-source'
  );
}

function createMemberData(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createMember(cardCode: string, ownerId = PLAYER1, instanceId = cardCode) {
  return createCardInstance(createMemberData(cardCode), ownerId, instanceId);
}

function createLive(cardCode: string, ownerId = PLAYER1, instanceId = cardCode) {
  const data: LiveCardData = {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({}),
  };
  return createCardInstance(data, ownerId, instanceId);
}

function setupState(options: {
  readonly cheerCards: readonly ReturnType<typeof createCardInstance>[];
  readonly energyDeckCount?: number;
  readonly sourceOnStage?: boolean;
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
  readonly cheerEventRevealedCardIds?: readonly string[];
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyCardIds: readonly string[];
} {
  const source = createHanamaru();
  const energyCardIds = Array.from(
    { length: options.energyDeckCount ?? 1 },
    (_, index) => `s-pb1-007-energy-${index + 1}`
  );
  const energyCards = energyCardIds.map((cardId) =>
    createCardInstance(
      {
        cardCode: `ENERGY-${cardId}`,
        name: cardId,
        cardType: CardType.ENERGY,
      },
      PLAYER1,
      cardId
    )
  );

  let game = createGameState('s-pb1-007-hanamaru', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.cheerCards, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    energyDeck: energyCardIds.reduce(
      (zone, cardId) => addCardToZone(zone, cardId),
      player.energyDeck
    ),
  }));

  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds:
        options.firstPlayerCheerCardIds ?? options.cheerCards.map((card) => card.instanceId),
    },
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: options.resolutionCardIds ?? options.cheerCards.map((card) => card.instanceId),
      revealedCardIds: options.revealedCardIds ?? options.cheerCards.map((card) => card.instanceId),
    },
  };

  if (options.cheerEventRevealedCardIds) {
    game = emitGameEvent(
      game,
      createCheerEvent(PLAYER1, options.cheerEventRevealedCardIds, 0, { automated: true })
    );
  }

  return { game, sourceId: source.instanceId, energyCardIds };
}

function createPending(sourceCardId: string): PendingAbilityState {
  return {
    id: 's-pb1-007-pending',
    abilityId: PL_S_PB1_007_LIVE_SUCCESS_CHEER_LIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolveWithConfirmation(game: GameState, sourceCardId: string): GameState {
  const pendingAbility = createPending(sourceCardId);
  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility],
  }).gameState;
  return started.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(started, PLAYER1, started.activeEffect.id)
    : started;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_S_PB1_007_LIVE_SUCCESS_CHEER_LIVE_PLACE_WAITING_ENERGY_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!S-pb1-007 Hanamaru live success waiting energy workflow', () => {
  it('places one own waiting energy after confirmation when this own revealed cheer has a LIVE card', () => {
    const live = createLive('PL!S-pb1-007-cheer-live', PLAYER1, 'own-cheer-live');
    const scenario = setupState({ cheerCards: [live] });

    const started = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [createPending(scenario.sourceId)],
    }).gameState;

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('本次自己声援公开 LIVE 1张');
    expect(started.players[0].energyZone.cardIds).toHaveLength(0);

    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(state)).toMatchObject({
      sourceOnStage: true,
      conditionMet: true,
      ownCheerLiveCardCount: 1,
      ownCheerLiveCardIds: [live.instanceId],
      placedEnergyCardIds: [scenario.energyCardIds[0]],
    });
  });

  it('consumes pending as no-op without own current revealed cheer LIVE cards', () => {
    const ownMember = createMember('PL!S-pb1-007-own-member', PLAYER1, 'own-member');
    const opponentLive = createLive('PL!S-pb1-007-opponent-live', PLAYER2, 'opponent-live');
    const oldResolutionLive = createLive('PL!S-pb1-007-old-live', PLAYER1, 'old-live');
    const unrevealedLive = createLive('PL!S-pb1-007-unrevealed-live', PLAYER1, 'unrevealed-live');
    const staleLive = createLive('PL!S-pb1-007-stale-live', PLAYER1, 'stale-live');
    const scenario = setupState({
      cheerCards: [ownMember, opponentLive, oldResolutionLive, unrevealedLive, staleLive],
      firstPlayerCheerCardIds: [
        ownMember.instanceId,
        opponentLive.instanceId,
        unrevealedLive.instanceId,
        staleLive.instanceId,
      ],
      resolutionCardIds: [ownMember.instanceId, opponentLive.instanceId, unrevealedLive.instanceId],
      revealedCardIds: [
        ownMember.instanceId,
        opponentLive.instanceId,
        oldResolutionLive.instanceId,
        staleLive.instanceId,
      ],
    });

    const state = resolveWithConfirmation(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toEqual(scenario.energyCardIds);
    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      sourceOnStage: true,
      conditionMet: false,
      ownCheerLiveCardIds: [],
      ownCheerLiveCardCount: 0,
      placedEnergyCardIds: [],
    });
  });

  it('counts an own LIVE card revealed by this cheer even after another effect moved it from the resolution zone', () => {
    const recoveredLive = createLive(
      'PL!S-pb1-007-recovered-cheer-live',
      PLAYER1,
      'recovered-cheer-live'
    );
    const scenario = setupState({
      cheerCards: [recoveredLive],
      firstPlayerCheerCardIds: [recoveredLive.instanceId],
      resolutionCardIds: [],
      revealedCardIds: [],
      cheerEventRevealedCardIds: [recoveredLive.instanceId],
    });

    const state = resolveWithConfirmation(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(state)).toMatchObject({
      sourceOnStage: true,
      conditionMet: true,
      ownCheerLiveCardIds: [recoveredLive.instanceId],
      ownCheerLiveCardCount: 1,
      placedEnergyCardIds: [scenario.energyCardIds[0]],
    });
  });

  it('consumes pending as no-op when the energy deck is empty', () => {
    const live = createLive('PL!S-pb1-007-cheer-live', PLAYER1, 'own-cheer-live');
    const scenario = setupState({ cheerCards: [live], energyDeckCount: 0 });
    const state = resolveWithConfirmation(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      ownCheerLiveCardCount: 1,
      placedEnergyCardIds: [],
    });
  });

  it('consumes pending as no-op when the source member has left the stage', () => {
    const live = createLive('PL!S-pb1-007-cheer-live', PLAYER1, 'own-cheer-live');
    const scenario = setupState({ cheerCards: [live], sourceOnStage: false });
    const state = resolveWithConfirmation(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toEqual(scenario.energyCardIds);
    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      sourceOnStage: false,
      conditionMet: false,
      ownCheerLiveCardCount: 1,
      placedEnergyCardIds: [],
    });
  });

  it('does not resolve a single pending ability until the confirm-only effect is confirmed', () => {
    const live = createLive('PL!S-pb1-007-cheer-live', PLAYER1, 'own-cheer-live');
    const scenario = setupState({ cheerCards: [live] });
    const started = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [createPending(scenario.sourceId)],
    }).gameState;

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.pendingAbilities).toHaveLength(1);
    expect(started.players[0].energyDeck.cardIds).toEqual(scenario.energyCardIds);
    expect(started.players[0].energyZone.cardIds).toHaveLength(0);

    const confirmed = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(confirmed.activeEffect).toBeNull();
    expect(confirmed.pendingAbilities).toHaveLength(0);
    expect(confirmed.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
  });
});
