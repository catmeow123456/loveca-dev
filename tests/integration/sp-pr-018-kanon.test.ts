import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID,
  SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
  readonly cheerEventRevealedCardIds?: readonly string[];
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
  if (options.cheerEventRevealedCardIds) {
    game = emitGameEvent(
      game,
      createCheerEvent(
        PLAYER1,
        options.cheerEventRevealedCardIds,
        options.cheerEventRevealedCardIds.length,
        { automated: true }
      )
    );
  }

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

function createSpPr018PendingAbility(
  sourceCardId: string,
  id = `sp-pr-018-pending:${sourceCardId}`
): PendingAbilityState {
  return {
    id,
    abilityId: SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
    sourceSlot: SlotPosition.CENTER,
  };
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

function redHeartModifierCount(game: GameState, memberCardId: string): number {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.sourceCardId === memberCardId &&
      modifier.hearts.some((heart) => heart.color === HeartColor.RED && heart.count === 1)
  ).length;
}

function hasResolvedBp5004(game: GameState): boolean {
  return game.actionHistory.some(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID &&
      action.payload.step !== 'ABILITY_USE'
  );
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

  it('triggers PL!SP-bp5-004 when this card effect places energy', () => {
    const cheerCards = Array.from({ length: 7 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-${index + 1}`)
    );
    const scenario = setupState({ cheerCards });
    const sumire = createMember('PL!SP-bp5-004-P', {
      instanceId: 'sp-bp5-004-sumire',
    });
    const drawCard = createMember('PL!SP-PR-018-draw-card', {
      instanceId: 'sp-pr-018-draw-card',
    });
    let game = registerCards(scenario.game, [sumire, drawCard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, sumire.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    const state = startAbility(game, scenario.sourceId);

    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(state.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(redHeartModifierCount(state, sumire.instanceId)).toBe(1);
    expect(hasResolvedBp5004(state)).toBe(true);
  });

  it('lets a newly waiting AUTO join the next LIVE-success choice window', () => {
    const cheerCards = Array.from({ length: 7 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-order-${index + 1}`)
    );
    const scenario = setupState({ cheerCards });
    const secondSource = createMember('PL!SP-PR-018-PR', {
      instanceId: 'sp-pr-018-second-source',
    });
    const sumire = createMember('PL!SP-bp5-004-P', {
      instanceId: 'sp-bp5-004-order-sumire',
    });
    const drawCard = createMember('PL!SP-PR-018-order-draw', {
      instanceId: 'sp-pr-018-order-draw',
    });
    let game = registerCards(scenario.game, [secondSource, sumire, drawCard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, sumire.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        secondSource.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const firstPending = createSpPr018PendingAbility(scenario.sourceId, 'live-success-a');
    const secondPending = createSpPr018PendingAbility(secondSource.instanceId, 'live-success-b');

    let state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [firstPending, secondPending],
    }).gameState;
    expect(state.activeEffect?.metadata?.pendingAbilityIds).toEqual([
      firstPending.id,
      secondPending.id,
    ]);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      scenario.sourceId
    );
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    const sumirePending = state.pendingAbilities.find(
      (ability) =>
        ability.abilityId ===
        SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID
    );
    expect(sumirePending).toBeDefined();
    expect(state.activeEffect?.metadata?.pendingAbilityIds).toEqual([
      secondPending.id,
      sumirePending!.id,
    ]);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      sumire.instanceId
    );
    if (state.activeEffect?.metadata?.confirmOnlyPendingAbility === true) {
      state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect.id);
    }
    expect(hasResolvedBp5004(state)).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.pendingAbilityId === secondPending.id
      )
    ).toBe(true);
    expect(state.checkTimingContext).toBeNull();
  });

  it('shows the actual Liella cheer count and standby energy wording in confirmation text', () => {
    const cheerCards = Array.from({ length: 8 }, (_, index) =>
      createMember(`PL!SP-PR-018-liella-${index + 1}`)
    );
    const scenario = setupState({ cheerCards });
    const preview = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [createSpPr018PendingAbility(scenario.sourceId)],
    }).gameState;

    expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(preview.activeEffect?.effectText).toContain('声援Liella!卡 8张');
    expect(preview.activeEffect?.effectText).toContain('放置1张待机能量');
    expect(preview.activeEffect?.effectText).not.toContain('声援Liella!卡 7张');
    expect(preview.activeEffect?.effectText).not.toContain('等待能量');
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

  it('counts Liella cheer cards revealed by this cheer after they left the resolution zone', () => {
    const cheerCards = Array.from({ length: 7 }, (_, index) =>
      createMember(`PL!SP-PR-018-recovered-liella-${index + 1}`)
    );
    const scenario = setupState({
      cheerCards,
      resolutionCardIds: [],
      revealedCardIds: [],
      cheerEventRevealedCardIds: cheerCards.map((card) => card.instanceId),
    });

    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      qualifyingCheerCardIds: cheerCards.map((card) => card.instanceId),
      qualifyingCheerCardCount: 7,
      placedEnergyCardIds: [scenario.energyCardIds[0]],
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
