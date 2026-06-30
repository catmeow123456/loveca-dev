import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    readonly groupNames?: readonly string[];
    readonly ownerId?: string;
    readonly instanceId?: string;
  } = {}
) {
  return createCardInstance(
    createMemberData(cardCode, options.groupNames ?? ['Liella!']),
    options.ownerId ?? PLAYER1,
    options.instanceId ?? cardCode
  );
}

function createMemberData(
  cardCode: string,
  groupNames: readonly string[] = ['Liella!']
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupState(options: {
  readonly cheerCards: readonly ReturnType<typeof createCardInstance>[];
  readonly energyDeckCount?: number;
  readonly sourceOnStage?: boolean;
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMemberData('PL!SP-PR-018-PR'),
    PLAYER1,
    'sp-pr-018-source'
  );
  const energyCardIds = Array.from(
    { length: options.energyDeckCount ?? 1 },
    (_, index) => `sp-pr-018-energy-${index + 1}`
  );
  const energyCards = energyCardIds.map((cardId) =>
    createCardInstance(
      {
        cardCode: `PL!SP-PR-018-energy-${cardId}`,
        name: cardId,
        cardType: CardType.ENERGY,
      },
      PLAYER1,
      cardId
    )
  );

  let game = createGameState('sp-pr-018-kanon', PLAYER1, 'P1', PLAYER2, 'P2');
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

  return { game, sourceId: source.instanceId, energyCardIds };
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'sp-pr-018-pending',
    abilityId: SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
    sourceSlot: SlotPosition.CENTER,
  };
  return confirmIfConfirmOnly(
    resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState
  );
}

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-PR-018 Kanon live success waiting energy workflow', () => {
  it('places one waiting energy when seven own revealed cheer cards are Liella', () => {
    const cheerCards = Array.from({ length: 7 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-${index + 1}`)
    );
    const scenario = setupState({ cheerCards });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      sourceOnStage: true,
      qualifyingCheerCardCount: 7,
      placedEnergyCardIds: [scenario.energyCardIds[0]],
    });
  });

  it('consumes pending as no-op when revealed Liella cheer cards are fewer than seven', () => {
    const cheerCards = Array.from({ length: 6 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-${index + 1}`)
    );
    const scenario = setupState({ cheerCards });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toEqual(scenario.energyCardIds);
    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      qualifyingCheerCardCount: 6,
      placedEnergyCardIds: [],
    });
  });

  it('consumes pending as no-op when the energy deck is empty', () => {
    const cheerCards = Array.from({ length: 7 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-${index + 1}`)
    );
    const scenario = setupState({ cheerCards, energyDeckCount: 0 });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyDeck.cardIds).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      qualifyingCheerCardCount: 7,
      placedEnergyCardIds: [],
    });
  });

  it('counts only own current revealed cheer cards from this resolution', () => {
    const validCards = Array.from({ length: 6 }, (_, index) =>
      createMember(`PL!SP-PR-018-valid-${index + 1}`)
    );
    const notRevealed = createMember('PL!SP-PR-018-not-revealed');
    const oldRevealed = createMember('PL!SP-PR-018-old-revealed');
    const opponentOwned = createMember('PL!SP-PR-018-opponent-owned', {
      ownerId: PLAYER2,
    });
    const nonLiella = createMember('PL!SP-PR-018-non-liella', {
      groupNames: ['Aqours'],
    });
    const allCards = [...validCards, notRevealed, oldRevealed, opponentOwned, nonLiella];
    const scenario = setupState({
      cheerCards: allCards,
      firstPlayerCheerCardIds: [
        ...validCards.map((card) => card.instanceId),
        notRevealed.instanceId,
        opponentOwned.instanceId,
        nonLiella.instanceId,
      ],
      resolutionCardIds: [
        ...validCards.map((card) => card.instanceId),
        notRevealed.instanceId,
        opponentOwned.instanceId,
        nonLiella.instanceId,
      ],
      revealedCardIds: [
        ...validCards.map((card) => card.instanceId),
        oldRevealed.instanceId,
        opponentOwned.instanceId,
        nonLiella.instanceId,
      ],
    });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      qualifyingCheerCardIds: validCards.map((card) => card.instanceId),
      qualifyingCheerCardCount: 6,
      placedEnergyCardIds: [],
    });
  });

  it('consumes pending as no-op when the source member is no longer on stage', () => {
    const cheerCards = Array.from({ length: 7 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-${index + 1}`)
    );
    const scenario = setupState({ cheerCards, sourceOnStage: false });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      sourceOnStage: false,
      qualifyingCheerCardCount: 0,
      placedEnergyCardIds: [],
    });
  });
});
