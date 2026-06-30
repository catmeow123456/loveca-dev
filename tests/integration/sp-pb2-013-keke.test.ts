import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
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
  unitName: string,
  options: { readonly bladeHeart?: boolean } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    ...(options.bladeHeart ? { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] } : {}),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupState(options: {
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly energyCount?: number;
  readonly deckCount?: number;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handIds: readonly string[];
  readonly energyIds: readonly string[];
  readonly deckIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-013-R', 'KALEIDOSCORE'),
    PLAYER1,
    'keke-source'
  );
  const energyCards = Array.from({ length: options.energyCount ?? 1 }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index + 1}`), PLAYER1, `energy-${index + 1}`)
  );
  const deckCards = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(
      createMember(`deck-${index + 1}`, 'CatChu!'),
      PLAYER1,
      `deck-${index + 1}`
    )
  );
  const handCards = options.handCards ?? [
    createCardInstance(createMember('PL!SP-test-kaleidoscore', 'KALEIDOSCORE'), PLAYER1, 'ks-hand'),
  ];
  let game = createGameState('sp-pb2-013-keke', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards, ...deckCards, ...handCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    energyDeck: energyCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.energyDeck),
    mainDeck: deckCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
  }));

  return {
    game,
    sourceId: source.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    energyIds: energyCards.map((card) => card.instanceId),
    deckIds: deckCards.map((card) => card.instanceId),
  };
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pending: PendingAbilityState = {
    id: 'sp-pb2-013-pending',
    abilityId: SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
  };
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending],
  }).gameState;
}

function selectDiscard(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, cardId);
}

function skipEffect(game: GameState): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id);
}

describe('PL!SP-pb2-013 Keke on-enter workflow', () => {
  it('discards a KALEIDOSCORE card and places one waiting energy', () => {
    const scenario = setupState({});
    const started = startAbility(scenario.game, scenario.sourceId);

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.handIds[0]]);
    const state = selectDiscard(started, scenario.handIds[0]);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.handIds[0]);
    expect(state.players[0].energyZone.cardIds).toContain(scenario.energyIds[0]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(state)).toMatchObject({
      step: 'DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW',
      placedEnergyCardIds: [scenario.energyIds[0]],
    });
  });

  it('draws one card when the discarded KALEIDOSCORE card has no Blade Heart', () => {
    const scenario = setupState({ deckCount: 1 });
    const state = selectDiscard(startAbility(scenario.game, scenario.sourceId), scenario.handIds[0]);

    expect(state.players[0].hand.cardIds).toContain(scenario.deckIds[0]);
    expect(latestPayload(state)).toMatchObject({
      drawnCardIds: [scenario.deckIds[0]],
      discardedHasBladeHeart: false,
    });
  });

  it('does not draw when the discarded KALEIDOSCORE card has Blade Heart', () => {
    const bladeHeartCard = createCardInstance(
      createMember('PL!SP-test-kaleidoscore-blade', 'KALEIDOSCORE', { bladeHeart: true }),
      PLAYER1,
      'ks-blade-heart'
    );
    const scenario = setupState({ handCards: [bladeHeartCard], deckCount: 1 });
    const state = selectDiscard(startAbility(scenario.game, scenario.sourceId), scenario.handIds[0]);

    expect(state.players[0].hand.cardIds).not.toContain(scenario.deckIds[0]);
    expect(latestPayload(state)).toMatchObject({
      drawnCardIds: [],
      discardedHasBladeHeart: true,
    });
  });

  it('does not allow non-KALEIDOSCORE hand cards to be selected', () => {
    const nonTarget = createCardInstance(
      createMember('PL!SP-test-catchu', 'CatChu!'),
      PLAYER1,
      'catchu-hand'
    );
    const scenario = setupState({ handCards: [nonTarget] });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.handIds[0]]);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW',
      reason: 'NO_KALEIDOSCORE_HAND',
    });
  });

  it('draws for no Blade Heart discard even when the energy deck is empty', () => {
    const scenario = setupState({ energyCount: 0, deckCount: 1 });
    const state = selectDiscard(startAbility(scenario.game, scenario.sourceId), scenario.handIds[0]);

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(state.players[0].hand.cardIds).toContain(scenario.deckIds[0]);
    expect(latestPayload(state)).toMatchObject({
      placedEnergyCardIds: [],
      drawnCardIds: [scenario.deckIds[0]],
    });
  });

  it('can decline without discarding or placing energy', () => {
    const scenario = setupState({});
    const state = skipEffect(startAbility(scenario.game, scenario.sourceId));

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.handIds[0]]);
    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(latestPayload(state)).toMatchObject({ step: 'SKIP' });
  });
});

function latestPayload(game: GameState): Record<string, unknown> | undefined {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID
    )?.payload;
}
