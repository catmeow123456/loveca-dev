import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
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
    readonly groupName?: string;
    readonly unitName?: string;
    readonly cost?: number;
    readonly bladeHearts?: MemberCardData['bladeHearts'];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? 'Liella!',
    unitName: options.unitName ?? 'Liella!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    ...(options.bladeHearts ? { bladeHearts: options.bladeHearts } : {}),
  };
}

function createLiveCard(cardCode: string, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    unitName: groupName,
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
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
  readonly targetId: string;
  readonly watcherId: string;
  readonly discardCardId: string;
  readonly energyDeckCardIds: readonly string[];
}

function setupKekeScenario(
  options: {
    readonly discardCard?: MemberCardData | LiveCardData;
    readonly handCards?: readonly (MemberCardData | LiveCardData)[];
    readonly energyDeckCount?: number;
    readonly includeTarget?: boolean;
  } = {}
): KekeScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-pb2-002-keke', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!SP-pb2-002-R', { name: '唐 可可', cost: 11 }),
    PLAYER1,
    'p1-sp-pb2-002-source'
  );
  const target = createCardInstance(
    createMemberCard('PL!SP-test-target', { name: 'Liella target' }),
    PLAYER1,
    'p1-sp-pb2-002-target'
  );
  const watcher = createCardInstance(
    createMemberCard('PL!HS-pb1-003-R', {
      name: '大泽瑠璃乃',
      groupName: '莲之空',
      unitName: 'みらくらぱーく！',
    }),
    PLAYER1,
    'p1-sp-pb2-002-watcher'
  );
  const handCards = (
    options.handCards ?? [options.discardCard ?? createMemberCard('PL!SP-test-no-blade-discard')]
  ).map((cardData, index) =>
    createCardInstance(cardData, PLAYER1, `p1-sp-pb2-002-hand-${index + 1}`)
  );

  const state = registerCards(session.state!, [source, target, watcher, ...handCards]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
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
  const energyDeckCardIds = p1.energyDeck.cardIds.slice(0, options.energyDeckCount ?? 3);

  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = [];
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.energyDeck.cardIds = [...energyDeckCardIds];
  p1.energyZone.cardIds = [];
  p1.energyZone.cardStates = new Map();
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: options.includeTarget === false ? null : target.instanceId,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: watcher.instanceId,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(options.includeTarget === false
      ? []
      : [
          [
            target.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ] as const,
        ]),
    [watcher.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    targetId: target.instanceId,
    watcherId: watcher.instanceId,
    discardCardId: handCards[0].instanceId,
    energyDeckCardIds,
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
      SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID
    )
  );
  expect(result.success).toBe(true);
}

function discardLiellaCard(scenario: KekeScenario): void {
  const effectId = scenario.session.state!.activeEffect!.id;
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, scenario.discardCardId)
  );
  expect(result.success).toBe(true);
}

function selectOption(scenario: KekeScenario, optionId: string): void {
  const effectId = scenario.session.state!.activeEffect!.id;
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, undefined, undefined, undefined, optionId)
  );
  expect(result.success).toBe(true);
}

function selectHeartTarget(scenario: KekeScenario, targetId = scenario.targetId): void {
  const effectId = scenario.session.state!.activeEffect!.id;
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, targetId)
  );
  expect(result.success).toBe(true);
}

describe('PL!SP-pb2-002 Keke activated workflow', () => {
  it('lets a normal Liella! live discard choose only one legal option and place waiting energy', () => {
    const scenario = setupKekeScenario({
      discardCard: createLiveCard('PL!SP-test-liella-live'),
    });

    activateKeke(scenario);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
      selectableCardIds: [scenario.discardCardId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });

    discardLiellaCard(scenario);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.discardCardId
    );
    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'energy', label: '从能量卡组放置1张待机能量' },
      { id: 'heart', label: '使此成员以外的1名『Liella!』成员获得heart06 heart06' },
    ]);

    selectOption(scenario, 'energy');

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].energyZone.cardIds).toEqual([
      scenario.energyDeckCardIds[0],
    ]);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyDeckCardIds[0])
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.discardedCardId === scenario.discardCardId &&
          action.payload.discardedNoBladeHeartMember === false &&
          action.payload.selectedOptionIds?.includes('energy') === true &&
          action.payload.placedEnergyCardIds?.includes(scenario.energyDeckCardIds[0]) === true
      )
    ).toBe(true);
  });

  it('lets a no-Blade-Heart Liella! member discard choose both energy and target heart', () => {
    const scenario = setupKekeScenario();

    activateKeke(scenario);
    discardLiellaCard(scenario);

    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'energy', label: '从能量卡组放置1张待机能量' },
      { id: 'heart', label: '使此成员以外的1名『Liella!』成员获得heart06 heart06' },
      { id: 'energy-and-heart', label: '放置待机能量，并给予1名成员heart06 heart06' },
    ]);

    selectOption(scenario, 'energy-and-heart');
    expect(scenario.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [scenario.targetId],
      selectableCardMode: 'SINGLE',
    });

    selectHeartTarget(scenario);

    expect(scenario.session.state?.players[0].energyZone.cardIds).toEqual([
      scenario.energyDeckCardIds[0],
    ]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: scenario.sourceId,
      abilityId: SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: scenario.targetId,
      hearts: [{ color: HeartColor.PURPLE, count: 2 }],
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID &&
          action.payload.step === 'GAIN_HEART' &&
          action.payload.discardedCardId === scenario.discardCardId &&
          action.payload.discardedNoBladeHeartMember === true &&
          action.payload.selectedOptionIds?.includes('energy') === true &&
          action.payload.selectedOptionIds?.includes('heart') === true &&
          action.payload.targetMemberCardId === scenario.targetId &&
          action.payload.heartBonus?.[0]?.color === HeartColor.PURPLE &&
          action.payload.heartBonus?.[0]?.count === 2
      )
    ).toBe(true);
  });

  it('does not offer the source member or non-Liella! members as heart targets', () => {
    const scenario = setupKekeScenario({
      discardCard: bladeHeartMember('PL!SP-test-blade-heart-discard'),
    });

    activateKeke(scenario);
    discardLiellaCard(scenario);
    selectOption(scenario, 'heart');

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([scenario.targetId]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.sourceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.watcherId
    );
  });

  it('enqueues on-enter-waiting-room triggers for the discarded hand card and enforces once per turn', () => {
    const scenario = setupKekeScenario({
      handCards: [
        createMemberCard('PL!SP-test-no-blade-discard'),
        createLiveCard('PL!SP-test-second-liella-live'),
      ],
    });

    activateKeke(scenario);
    discardLiellaCard(scenario);
    selectOption(scenario, 'energy');

    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.watcherId
      )
    ).toBe(true);

    const secondActivation = scenario.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        scenario.sourceId,
        SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID
      )
    );
    expect(secondActivation.success).toBe(false);
  });

  it('does not activate without a Liella! hand card or without any legal resolution option', () => {
    const nonLiellaHand = setupKekeScenario({
      handCards: [createLiveCard('PL!HS-test-live', '莲之空')],
    });
    const noHandResult = nonLiellaHand.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        nonLiellaHand.sourceId,
        SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID
      )
    );
    expect(noHandResult.success).toBe(false);

    const noOption = setupKekeScenario({
      energyDeckCount: 0,
      includeTarget: false,
    });
    const noOptionResult = noOption.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        noOption.sourceId,
        SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID
      )
    );
    expect(noOptionResult.success).toBe(false);
  });
});
