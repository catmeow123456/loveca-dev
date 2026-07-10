import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addAction,
  emitGameEvent,
  registerCards,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createEnergyPlacedByCardEffectEvent,
  createMemberSlotMovedEvent,
} from '../../src/domain/events/game-events';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID,
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

function createMemberCard(
  cardCode: string,
  name = cardCode,
  groupName = 'Liella!',
  unitName = 'CatChu!'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

interface SumireScenario {
  readonly game: GameState;
  readonly sourceId: string;
  readonly secondSourceId: string;
  readonly otherMemberId: string;
  readonly effectSourceId: string;
  readonly drawCardIds: readonly string[];
  readonly energyCardIds: readonly string[];
}

function setupScenario(options: { readonly includeSecondSumire?: boolean } = {}): SumireScenario {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-bp5-004-sumire', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!SP-bp5-004-R＋', '平安名すみれ'),
    PLAYER1,
    'p1-sp-bp5-004-source'
  );
  const secondSource = createCardInstance(
    createMemberCard('PL!SP-bp5-004-P', '平安名すみれ'),
    PLAYER1,
    'p1-sp-bp5-004-second'
  );
  const otherMember = createCardInstance(
    createMemberCard('PL!SP-test-other-member', 'Other member'),
    PLAYER1,
    'p1-other-member'
  );
  const effectSource = createCardInstance(
    createMemberCard('PL!SP-bp4-001-P', '澁谷かのん'),
    PLAYER1,
    'p1-effect-source'
  );
  const drawCards = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(createMemberCard(`PL!SP-draw-${index}`), PLAYER1, `p1-draw-${index}`)
  );
  const energyCards = Array.from({ length: 3 }, (_, index) =>
    createCardInstance(createEnergyCard(`PL!ENE-${index}`), PLAYER1, `p1-energy-${index}`)
  );

  const state = registerCards(session.state!, [
    source,
    secondSource,
    otherMember,
    effectSource,
    ...drawCards,
    ...energyCards,
  ]);

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    energyDeck: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  p1.energyDeck.cardIds = [];
  p1.energyZone.cardIds = [];
  p1.energyZone.cardStates = new Map();
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: source.instanceId,
    [SlotPosition.CENTER]: otherMember.instanceId,
    [SlotPosition.RIGHT]: options.includeSecondSumire === true ? secondSource.instanceId : null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [otherMember.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(options.includeSecondSumire === true
      ? [
          [
            secondSource.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ] as const,
        ]
      : []),
  ]);

  return {
    game: state,
    sourceId: source.instanceId,
    secondSourceId: secondSource.instanceId,
    otherMemberId: otherMember.instanceId,
    effectSourceId: effectSource.instanceId,
    drawCardIds: drawCards.map((card) => card.instanceId),
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function resolveOwnCardEffectMove(
  scenario: SumireScenario,
  options: {
    readonly movedCardId?: string;
    readonly controllerId?: string;
    readonly fromSlot?: SlotPosition;
    readonly toSlot?: SlotPosition;
    readonly causePlayerId?: string;
    readonly manual?: boolean;
  } = {}
): GameState {
  const movedCardId = options.movedCardId ?? scenario.sourceId;
  const controllerId = options.controllerId ?? PLAYER1;
  const fromSlot = options.fromSlot ?? SlotPosition.LEFT;
  const toSlot = options.toSlot ?? SlotPosition.CENTER;
  const mutablePlayer = scenario.game.players[0] as unknown as {
    memberSlots: { slots: Record<SlotPosition, string | null> };
  };
  mutablePlayer.memberSlots.slots[fromSlot] =
    movedCardId === scenario.sourceId ? scenario.otherMemberId : scenario.sourceId;
  mutablePlayer.memberSlots.slots[toSlot] = movedCardId;

  const event = createMemberSlotMovedEvent(
    movedCardId,
    controllerId,
    fromSlot,
    toSlot,
    undefined,
    options.manual
      ? { kind: 'PLAYER_ACTION', playerId: controllerId }
      : {
          kind: 'CARD_EFFECT',
          playerId: options.causePlayerId ?? PLAYER1,
          sourceCardId: scenario.effectSourceId,
          abilityId: SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
        }
  );
  const stateWithEvent = emitGameEvent(scenario.game, event);
  const stateWithPending = enqueueTriggeredCardEffects(
    stateWithEvent,
    [TriggerCondition.ON_MEMBER_SLOT_MOVED],
    { memberSlotMovedEvents: [event] }
  );
  return resolvePendingCardEffects(stateWithPending).gameState;
}

function resolvePlacedEnergy(
  game: GameState,
  scenario: SumireScenario,
  options: {
    readonly placedEnergyCardIds?: readonly string[];
    readonly payloadKind?: 'placed' | 'empty' | 'paid';
    readonly causePlayerId?: string;
    readonly addToEnergyZone?: boolean;
  } = {}
): GameState {
  const placedEnergyCardIds = options.placedEnergyCardIds ?? [scenario.energyCardIds[0]!];
  const mutablePlayer = game.players[0] as unknown as {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  if (
    options.payloadKind !== 'empty' &&
    options.payloadKind !== 'paid' &&
    options.addToEnergyZone !== false
  ) {
    mutablePlayer.energyZone.cardIds = [
      ...new Set([...mutablePlayer.energyZone.cardIds, ...placedEnergyCardIds]),
    ];
    mutablePlayer.energyZone.cardStates = new Map([
      ...mutablePlayer.energyZone.cardStates,
      ...placedEnergyCardIds.map(
        (cardId) =>
          [cardId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }] as const
      ),
    ]);
  }

  if (options.payloadKind === 'paid') {
    const stateWithPaidPayload = addAction(game, 'RESOLVE_ABILITY', PLAYER1, {
      abilityId: SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
      sourceCardId: scenario.effectSourceId,
      step: 'TEST_PAY_ENERGY',
      energyCardIds: placedEnergyCardIds,
    });
    return resolvePendingCardEffects(stateWithPaidPayload).gameState;
  }

  const event = createEnergyPlacedByCardEffectEvent(
    PLAYER1,
    options.payloadKind === 'empty' ? [] : placedEnergyCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: options.causePlayerId ?? PLAYER1,
      sourceCardId: scenario.effectSourceId,
      abilityId: SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    }
  );
  const stateWithEvent = emitGameEvent(game, event);
  const stateWithPending = enqueueTriggeredCardEffects(
    stateWithEvent,
    [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT],
    { energyPlacedByCardEffectEvents: [event] }
  );
  return resolvePendingCardEffects(stateWithPending).gameState;
}

function latestSumirePayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID &&
        action.payload.step !== 'ABILITY_USE'
    )
    .at(-1)?.payload;
}

function sumireResolveCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID &&
      action.payload.step !== 'ABILITY_USE'
  ).length;
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

describe('PL!SP-bp5-004 Sumire own-effect move or energy placement auto workflow', () => {
  it('draws one and gives this member red Heart when own card effect moves this member', () => {
    const scenario = setupScenario();

    const state = resolveOwnCardEffectMove(scenario);

    expect(state.players[0].hand.cardIds).toContain(scenario.drawCardIds[0]);
    expect(redHeartModifierCount(state, scenario.sourceId)).toBe(1);
    expect(latestSumirePayload(state)).toMatchObject({
      conditionMet: true,
      triggerKind: 'MEMBER_MOVED_BY_OWN_CARD_EFFECT',
      sourceCardId: scenario.sourceId,
      drawnCardIds: [scenario.drawCardIds[0]],
    });
  });

  it('draws one and gives this member red Heart when own card effect places energy', () => {
    const scenario = setupScenario();

    const state = resolvePlacedEnergy(scenario.game, scenario);

    expect(state.players[0].hand.cardIds).toContain(scenario.drawCardIds[0]);
    expect(redHeartModifierCount(state, scenario.sourceId)).toBe(1);
    expect(latestSumirePayload(state)).toMatchObject({
      conditionMet: true,
      triggerKind: 'ENERGY_PLACED_BY_OWN_CARD_EFFECT',
      placedEnergyCardIds: [scenario.energyCardIds[0]],
      drawnCardIds: [scenario.drawCardIds[0]],
    });
  });

  it('shares the turn-once limit across movement and energy placement entrances', () => {
    const scenario = setupScenario();

    const afterMove = resolveOwnCardEffectMove(scenario);
    const afterEnergy = resolvePlacedEnergy(afterMove, scenario, {
      placedEnergyCardIds: [scenario.energyCardIds[1]!],
    });

    expect(sumireResolveCount(afterEnergy)).toBe(1);
    expect(afterEnergy.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(redHeartModifierCount(afterEnergy, scenario.sourceId)).toBe(1);
  });

  it('does not trigger for manual movement, opponent card-effect movement, or another member moving', () => {
    const manual = setupScenario();
    const afterManual = resolveOwnCardEffectMove(manual, { manual: true });
    expect(sumireResolveCount(afterManual)).toBe(0);
    expect(afterManual.players[0].hand.cardIds).toEqual([]);

    const opponentEffect = setupScenario();
    const afterOpponentEffect = resolveOwnCardEffectMove(opponentEffect, {
      causePlayerId: PLAYER2,
    });
    expect(sumireResolveCount(afterOpponentEffect)).toBe(0);
    expect(afterOpponentEffect.players[0].hand.cardIds).toEqual([]);

    const otherMoved = setupScenario();
    const afterOtherMoved = resolveOwnCardEffectMove(otherMoved, {
      movedCardId: otherMoved.otherMemberId,
      fromSlot: SlotPosition.CENTER,
      toSlot: SlotPosition.LEFT,
    });
    expect(sumireResolveCount(afterOtherMoved)).toBe(0);
    expect(afterOtherMoved.players[0].hand.cardIds).toEqual([]);
  });

  it('does not trigger for empty placedEnergyCardIds, paid energy payloads, or cards not in energy zone', () => {
    const empty = setupScenario();
    const afterEmpty = resolvePlacedEnergy(empty.game, empty, { payloadKind: 'empty' });
    expect(sumireResolveCount(afterEmpty)).toBe(0);

    const paid = setupScenario();
    const afterPaid = resolvePlacedEnergy(paid.game, paid, { payloadKind: 'paid' });
    expect(sumireResolveCount(afterPaid)).toBe(0);

    const notInZone = setupScenario();
    const afterNotInZone = resolvePlacedEnergy(notInZone.game, notInZone, {
      placedEnergyCardIds: [notInZone.energyCardIds[2]!],
      payloadKind: 'placed',
      addToEnergyZone: false,
    });
    expect(sumireResolveCount(afterNotInZone)).toBe(0);
  });

  it('does not trigger when an opponent card effect places energy into this player energy zone', () => {
    const scenario = setupScenario();

    const state = resolvePlacedEnergy(scenario.game, scenario, { causePlayerId: PLAYER2 });

    expect(sumireResolveCount(state)).toBe(0);
    expect(state.players[0].hand.cardIds).toEqual([]);
  });

  it('uses cardInstanceId precisely when multiple same-name Sumire cards are on stage', () => {
    const scenario = setupScenario({ includeSecondSumire: true });

    const state = resolveOwnCardEffectMove(scenario);

    expect(redHeartModifierCount(state, scenario.sourceId)).toBe(1);
    expect(redHeartModifierCount(state, scenario.secondSourceId)).toBe(0);
    expect(latestSumirePayload(state)?.sourceCardId).toBe(scenario.sourceId);
  });
});
