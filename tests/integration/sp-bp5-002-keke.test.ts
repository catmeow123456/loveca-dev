import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly bladeHearts?: MemberCardData['bladeHearts'];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    ...(options.bladeHearts ? { bladeHearts: options.bladeHearts } : {}),
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

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

interface KekeScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly discardCardIds: readonly string[];
  readonly drawCardIds: readonly string[];
  readonly watcherId?: string;
}

function setupKekeScenario(options: {
  readonly sourceSlot?: SlotPosition;
  readonly discardCards?: readonly MemberCardData[];
  readonly includeWatcher?: boolean;
} = {}): KekeScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-bp5-002-keke', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!SP-bp5-002-P', { name: '唐 可可', cost: 13 }),
    PLAYER1,
    'p1-sp-bp5-002-source'
  );
  const discardCards = (
    options.discardCards ?? [
      createMemberCard('PL!SP-test-discard-1'),
      createMemberCard('PL!SP-test-discard-2'),
    ]
  ).map((cardData, index) =>
    createCardInstance(cardData, PLAYER1, `p1-sp-bp5-002-discard-${index + 1}`)
  );
  const drawCards = [1, 2, 3].map((index) =>
    createCardInstance(
      createMemberCard(`PL!SP-test-draw-${index}`),
      PLAYER1,
      `p1-sp-bp5-002-draw-${index}`
    )
  );
  const watcher = options.includeWatcher
    ? createCardInstance(
        createMemberCard('PL!HS-pb1-003-R', {
          name: '大泽瑠璃乃',
          groupNames: ['莲之空'],
        }),
        PLAYER1,
        'p1-hs-pb1-003-watcher'
      )
    : null;

  const state = registerCards(session.state!, [
    source,
    ...discardCards,
    ...drawCards,
    ...(watcher ? [watcher] : []),
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const sourceSlot = options.sourceSlot ?? SlotPosition.LEFT;
  p1.hand.cardIds = discardCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: sourceSlot === SlotPosition.LEFT ? source.instanceId : null,
    [SlotPosition.CENTER]:
      sourceSlot === SlotPosition.CENTER ? source.instanceId : watcher?.instanceId ?? null,
    [SlotPosition.RIGHT]: sourceSlot === SlotPosition.RIGHT ? source.instanceId : null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(watcher
      ? [[watcher.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }] as const]
      : []),
  ]);

  return {
    session,
    sourceId: source.instanceId,
    discardCardIds: discardCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
    watcherId: watcher?.instanceId,
  };
}

function bladeHeartMember(cardCode: string): MemberCardData {
  return createMemberCard(cardCode, {
    bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
  });
}

function activateKeke(scenario: KekeScenario): void {
  const result = scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID
    )
  );
  expect(result.success).toBe(true);
}

function discardSelectedCards(scenario: KekeScenario): void {
  const effectId = scenario.session.state!.activeEffect!.id;
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      undefined,
      undefined,
      undefined,
      undefined,
      scenario.discardCardIds
    )
  );
  expect(result.success).toBe(true);
}

function sourceOrientation(scenario: KekeScenario): OrientationState | undefined {
  return scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)
    ?.orientation;
}

describe('PL!SP-bp5-002 Keke activated workflow', () => {
  it('waits the source, draws three, discards two, and gives no reward for zero no-BLADE-HEART members', () => {
    const scenario = setupKekeScenario({
      discardCards: [bladeHeartMember('PL!SP-test-blade-1'), bladeHeartMember('PL!SP-test-blade-2')],
    });

    activateKeke(scenario);

    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining([...scenario.discardCardIds, ...scenario.drawCardIds])
    );
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      selectableCardIds: expect.arrayContaining([
        ...scenario.discardCardIds,
        ...scenario.drawCardIds,
      ]),
      canSkipSelection: false,
    });

    discardSelectedCards(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(scenario.discardCardIds)
    );
    expect(scenario.session.state?.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: scenario.sourceId,
        abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      })
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID &&
          action.payload.noBladeHeartMemberDiscardCount === 0 &&
          action.payload.activatedSource === false &&
          action.payload.bladeBonus === 0
      )
    ).toBe(true);
  });

  it('activates the source without BLADE bonus for one no-BLADE-HEART member', () => {
    const scenario = setupKekeScenario({
      discardCards: [createMemberCard('PL!SP-test-no-blade'), bladeHeartMember('PL!SP-test-blade')],
    });

    activateKeke(scenario);
    discardSelectedCards(scenario);

    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
    expect(scenario.session.state?.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: scenario.sourceId,
        abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      })
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID &&
          action.payload.noBladeHeartMemberDiscardCount === 1 &&
          action.payload.activatedSource === true &&
          action.payload.bladeBonus === 0
      )
    ).toBe(true);
  });

  it('activates the source and grants BLADE plus two for two no-BLADE-HEART members', () => {
    const scenario = setupKekeScenario();

    activateKeke(scenario);
    discardSelectedCards(scenario);

    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: scenario.sourceId,
      abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      countDelta: 2,
    });
  });

  it('does not activate from a non-left slot', () => {
    const scenario = setupKekeScenario({ sourceSlot: SlotPosition.CENTER });

    const result = scenario.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        scenario.sourceId,
        SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID
      )
    );

    expect(result.success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
    expect(scenario.session.state?.activeEffect).toBeNull();
  });

  it('enforces the once per turn limit', () => {
    const scenario = setupKekeScenario();

    activateKeke(scenario);
    discardSelectedCards(scenario);

    const result = scenario.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        scenario.sourceId,
        SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID
      )
    );
    expect(result.success).toBe(false);
  });

  it('enqueues on-enter-waiting-room triggers for the discarded hand cards', () => {
    const scenario = setupKekeScenario({ includeWatcher: true });

    activateKeke(scenario);
    discardSelectedCards(scenario);

    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.watcherId
      )
    ).toBe(true);
  });
});
