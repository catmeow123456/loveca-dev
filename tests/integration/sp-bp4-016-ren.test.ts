import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { emitGameEvent, registerCards, type GameState } from '../../src/domain/entities/game';
import { createEnergyPlacedByCardEffectEvent } from '../../src/domain/events/game-events';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
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

function createMemberCard(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
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

interface RenScenario {
  readonly game: GameState;
  readonly sourceId: string;
  readonly secondSourceId: string;
  readonly effectSourceId: string;
  readonly p1EnergyIds: readonly string[];
  readonly p2EnergyIds: readonly string[];
}

function setupScenario(options: { readonly includeSecondRen?: boolean } = {}): RenScenario {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-bp4-016-ren', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!SP-bp4-016-N', '葉月 恋'),
    PLAYER1,
    'p1-sp-bp4-016-source'
  );
  const secondSource = createCardInstance(
    createMemberCard('PL!SP-bp4-016-N', '葉月 恋'),
    PLAYER1,
    'p1-sp-bp4-016-second'
  );
  const effectSource = createCardInstance(
    createMemberCard('PL!SP-bp4-001-P', '澁谷かのん'),
    PLAYER1,
    'p1-effect-source'
  );
  const p1EnergyCards = Array.from({ length: 3 }, (_, index) =>
    createCardInstance(createEnergyCard(`PL!P1-ENE-${index}`), PLAYER1, `p1-energy-${index}`)
  );
  const p2EnergyCards = Array.from({ length: 2 }, (_, index) =>
    createCardInstance(createEnergyCard(`PL!P2-ENE-${index}`), PLAYER2, `p2-energy-${index}`)
  );

  const state = registerCards(session.state!, [
    source,
    secondSource,
    effectSource,
    ...p1EnergyCards,
    ...p2EnergyCards,
  ]);

  const p1 = state.players[0] as unknown as {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.energyZone.cardIds = [];
  p1.energyZone.cardStates = new Map();
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: source.instanceId,
    [SlotPosition.CENTER]: options.includeSecondRen === true ? secondSource.instanceId : null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(options.includeSecondRen === true
      ? [
          [
            secondSource.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ] as const,
        ]
      : []),
  ]);

  const p2 = state.players[1] as unknown as {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p2.energyZone.cardIds = [];
  p2.energyZone.cardStates = new Map();

  return {
    game: state,
    sourceId: source.instanceId,
    secondSourceId: secondSource.instanceId,
    effectSourceId: effectSource.instanceId,
    p1EnergyIds: p1EnergyCards.map((card) => card.instanceId),
    p2EnergyIds: p2EnergyCards.map((card) => card.instanceId),
  };
}

function placeEnergyInZone(
  game: GameState,
  playerIndex: 0 | 1,
  cardIds: readonly string[]
): void {
  const player = game.players[playerIndex] as unknown as {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.energyZone.cardIds = [...new Set([...player.energyZone.cardIds, ...cardIds])];
  player.energyZone.cardStates = new Map([
    ...player.energyZone.cardStates,
    ...cardIds.map(
      (cardId) => [cardId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }] as const
    ),
  ]);
}

function resolveEnergyPlacedEvent(
  scenario: RenScenario,
  options: {
    readonly game?: GameState;
    readonly targetPlayerId?: string;
    readonly targetPlayerIndex?: 0 | 1;
    readonly placedEnergyCardIds?: readonly string[];
    readonly causePlayerId?: string;
    readonly removeSourceAfterQueue?: boolean;
  } = {}
): GameState {
  const game = options.game ?? scenario.game;
  const targetPlayerId = options.targetPlayerId ?? PLAYER1;
  const targetPlayerIndex = options.targetPlayerIndex ?? 0;
  const placedEnergyCardIds = options.placedEnergyCardIds ?? [scenario.p1EnergyIds[0]!];
  placeEnergyInZone(game, targetPlayerIndex, placedEnergyCardIds);
  const event = createEnergyPlacedByCardEffectEvent(
    targetPlayerId,
    placedEnergyCardIds,
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
  if (options.removeSourceAfterQueue === true) {
    const p1 = stateWithPending.players[0] as unknown as {
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    p1.memberSlots.slots[SlotPosition.LEFT] = null;
  }
  return resolvePendingCardEffects(stateWithPending).gameState;
}

function enqueueEnergyPlacedEvent(
  scenario: RenScenario,
  options: {
    readonly placedEnergyCardIds?: readonly string[];
    readonly causePlayerId?: string;
  } = {}
): GameState {
  const placedEnergyCardIds = options.placedEnergyCardIds ?? [scenario.p1EnergyIds[0]!];
  placeEnergyInZone(scenario.game, 0, placedEnergyCardIds);
  const event = createEnergyPlacedByCardEffectEvent(
    PLAYER1,
    placedEnergyCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: options.causePlayerId ?? PLAYER1,
      sourceCardId: scenario.effectSourceId,
      abilityId: SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    }
  );
  const stateWithEvent = emitGameEvent(scenario.game, event);
  return enqueueTriggeredCardEffects(
    stateWithEvent,
    [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT],
    { energyPlacedByCardEffectEvents: [event] }
  );
}

function purpleHeartModifierCount(game: GameState, memberCardId: string): number {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'HEART' &&
        modifier.target === 'SOURCE_MEMBER' &&
        modifier.sourceCardId === memberCardId
    )
    .reduce(
      (total, modifier) =>
        total +
        modifier.hearts
          .filter((heart) => heart.color === HeartColor.PURPLE)
          .reduce((sum, heart) => sum + heart.count, 0),
      0
    );
}

describe('PL!SP-bp4-016 Ren card-effect energy placement auto workflow', () => {
  it('gains one purple Heart when own card effect places one energy into own energy zone', () => {
    const scenario = setupScenario();

    const state = resolveEnergyPlacedEvent(scenario);

    expect(purpleHeartModifierCount(state, scenario.sourceId)).toBe(1);
  });

  it('resolves immediately after a queued card effect places energy', () => {
    const scenario = setupScenario();
    const player = scenario.game.players[0] as unknown as {
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
    const placedEnergyCardId = player.energyDeck.cardIds[0]!;
    const startingEnergyCardIds = player.energyDeck.cardIds.slice(1, 8);
    player.energyDeck.cardIds = [placedEnergyCardId, ...player.energyDeck.cardIds.slice(8)];
    player.energyZone.cardIds = startingEnergyCardIds;
    player.energyZone.cardStates = new Map(
      startingEnergyCardIds.map(
        (cardId) =>
          [cardId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }] as const
      )
    );
    player.memberSlots.slots[SlotPosition.CENTER] = scenario.effectSourceId;
    player.memberSlots.cardStates.set(scenario.effectSourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    const stateWithPending: GameState = {
      ...scenario.game,
      pendingAbilities: [
        ...scenario.game.pendingAbilities,
        {
          id: 'test:sp-bp4-001-on-enter',
          abilityId: SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
          sourceCardId: scenario.effectSourceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          eventIds: ['test:on-enter'],
          sourceSlot: SlotPosition.CENTER,
        },
      ],
    };

    const state = resolvePendingCardEffects(stateWithPending).gameState;

    expect(state.players[0]?.energyZone.cardIds).toContain(placedEnergyCardId);
    expect(purpleHeartModifierCount(state, scenario.sourceId)).toBe(1);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID
      )
    ).toBe(true);
  });

  it('also triggers when opponent card effect places energy into own energy zone', () => {
    const scenario = setupScenario();

    const state = resolveEnergyPlacedEvent(scenario, { causePlayerId: PLAYER2 });

    expect(purpleHeartModifierCount(state, scenario.sourceId)).toBe(1);
  });

  it('gains two purple Hearts when one event places two energy cards', () => {
    const scenario = setupScenario();

    const state = resolveEnergyPlacedEvent(scenario, {
      placedEnergyCardIds: [scenario.p1EnergyIds[0]!, scenario.p1EnergyIds[1]!],
    });

    expect(purpleHeartModifierCount(state, scenario.sourceId)).toBe(2);
  });

  it('does not trigger this member when energy is placed into the opponent energy zone', () => {
    const scenario = setupScenario();

    const state = resolveEnergyPlacedEvent(scenario, {
      targetPlayerId: PLAYER2,
      targetPlayerIndex: 1,
      placedEnergyCardIds: [scenario.p2EnergyIds[0]!],
    });

    expect(purpleHeartModifierCount(state, scenario.sourceId)).toBe(0);
  });

  it('no-ops if the source leaves stage before resolution', () => {
    const scenario = setupScenario();

    const state = resolveEnergyPlacedEvent(scenario, { removeSourceAfterQueue: true });

    expect(purpleHeartModifierCount(state, scenario.sourceId)).toBe(0);
  });

  it('triggers each Ren source on stage from the same energy placement event', () => {
    const scenario = setupScenario({ includeSecondRen: true });

    const state = enqueueEnergyPlacedEvent(scenario);

    expect(state.pendingAbilities.map((ability) => ability.sourceCardId)).toEqual([
      scenario.sourceId,
      scenario.secondSourceId,
    ]);
  });
});
