import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
  BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly hearts?: readonly ReturnType<typeof createHeartIcon>[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 5,
    blade: 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(
  cardCode: string,
  requirements: Partial<Record<HeartColor, number>>,
  groupNames: readonly string[] = ["μ's"]
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement(requirements),
  };
}

function createBaseGame(testId: string): GameState {
  return {
    ...createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.MAIN_FREE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  };
}

function sessionWithState(game: GameState, testId = 'pl-bp5-009-010'): GameSession {
  const session = createGameSession();
  session.createGame(testId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmOne(session: GameSession, selectedCardId: string | null): GameState {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  if (session.state?.activeEffect?.stepId !== 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION') {
    return result.gameState;
  }
  const confirmed = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state.activeEffect.id)
  );
  expect(confirmed.success, confirmed.error).toBe(true);
  return confirmed.gameState;
}

function confirmMany(session: GameSession, selectedCardIds: readonly string[]): GameState {
  const effect = session.state!.activeEffect!;
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
  return result.gameState;
}

function setupBp5009(
  options: {
    readonly sourceCardCode?: 'PL!-bp5-009-R' | 'PL!-bp5-009-P' | 'PL!-bp5-009-AR';
    readonly handCards?: readonly CardInstance[];
    readonly waitingCards?: readonly CardInstance[];
    readonly placeSourceOnStage?: boolean;
    readonly currentPhase?: GamePhase;
  } = {}
): {
  readonly session: GameSession;
  readonly source: CardInstance<MemberCardData>;
  readonly handCards: readonly CardInstance[];
  readonly waitingCards: readonly CardInstance[];
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!-bp5-009-R', {
      name: '矢澤にこ',
      cost: 15,
    }),
    PLAYER1,
    'bp5-009-source'
  );
  const handCards = options.handCards ?? [
    createCardInstance(createMember('PL!-bp5-009-hand-a'), PLAYER1, 'hand-a'),
    createCardInstance(createMember('PL!-bp5-009-hand-b'), PLAYER1, 'hand-b'),
  ];
  const waitingCards = options.waitingCards ?? [];

  let game = {
    ...createBaseGame('pl-bp5-009-nico'),
    currentPhase: options.currentPhase ?? GamePhase.MAIN_PHASE,
  };
  game = registerCards(game, [source, ...handCards, ...waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.placeSourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));

  return {
    session: sessionWithState(game, 'pl-bp5-009-session'),
    source,
    handCards,
    waitingCards,
  };
}

function activateBp5009(session: GameSession): GameState {
  const nextState = activateCardAbility(
    session.state!,
    PLAYER1,
    'bp5-009-source',
    BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID
  );
  (session as unknown as { authorityState: GameState }).authorityState = nextState;
  return nextState;
}

function bp5009UseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function createPendingBp5010(sourceCardId: string): PendingAbilityState {
  return {
    id: 'pending-bp5-010',
    abilityId: BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['event-bp5-010'],
  };
}

function setupBp5010(
  options: {
    readonly handCards?: readonly CardInstance[];
    readonly mainDeckCards?: readonly CardInstance[];
    readonly waitingCards?: readonly CardInstance[];
    readonly placeSourceOnStage?: boolean;
  } = {}
): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly handCards: readonly CardInstance[];
  readonly mainDeckCards: readonly CardInstance[];
  readonly waitingCards: readonly CardInstance[];
} {
  const source = createCardInstance(
    createMember('PL!-bp5-010-N', { name: '高坂穂乃果', cost: 5 }),
    PLAYER1,
    'bp5-010-source'
  );
  const handCards = options.handCards ?? [
    createCardInstance(createMember('PL!-bp5-010-hand'), PLAYER1, 'bp5-010-hand'),
  ];
  const mainDeckCards = options.mainDeckCards ?? [];
  const waitingCards = options.waitingCards ?? [];

  let game = createBaseGame('pl-bp5-010-honoka');
  game = registerCards(game, [source, ...handCards, ...mainDeckCards, ...waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.placeSourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: mainDeckCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.mainDeck
    ),
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));

  return {
    game: {
      ...game,
      pendingAbilities: [createPendingBp5010(source.instanceId)],
    },
    source,
    handCards,
    mainDeckCards,
    waitingCards,
  };
}

describe('PL!-bp5-009 Nico activated discard-two recovery', () => {
  it('uses an exact two-card hand discard cost, rescans waiting room, and recovers only LIVE with necessary [紫ハート] >= 3', () => {
    const validLive = createCardInstance(
      createLive('PL!-valid-purple-live', { [HeartColor.PURPLE]: 3 }),
      PLAYER1,
      'valid-purple-live'
    );
    const lowPurpleLive = createCardInstance(
      createLive('PL!-low-purple-live', { [HeartColor.PURPLE]: 2 }),
      PLAYER1,
      'low-purple-live'
    );
    const purpleMember = createCardInstance(
      createMember('PL!-purple-member', { hearts: [createHeartIcon(HeartColor.PURPLE, 3)] }),
      PLAYER1,
      'purple-member'
    );
    const scenario = setupBp5009({
      sourceCardCode: 'PL!-bp5-009-AR',
      waitingCards: [validLive, lowPurpleLive, purpleMember],
    });

    expect(activateBp5009(scenario.session).activeEffect).not.toBeNull();
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: false,
    });

    const invalid = confirmActiveEffectStepThroughPublicReveal(
      scenario.session.state!,
      PLAYER1,
      scenario.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.handCards[0]!.instanceId]
    );
    expect(invalid.activeEffect?.stepId).toBe('BP5_009_SELECT_TWO_HAND_CARDS_TO_DISCARD');

    confirmMany(scenario.session, [
      scenario.handCards[0]!.instanceId,
      scenario.handCards[1]!.instanceId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([validLive.instanceId]);

    confirmOne(scenario.session, validLive.instanceId);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([validLive.instanceId]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      lowPurpleLive.instanceId,
      purpleMember.instanceId,
      scenario.handCards[0]!.instanceId,
      scenario.handCards[1]!.instanceId,
    ]);
    expect(bp5009UseCount(scenario.session.state!)).toBe(1);
  });

  it('can recover a qualifying LIVE discarded as cost and keeps cost on no-target no-op', () => {
    const discardedLive = createCardInstance(
      createLive('PL!-discarded-purple-live', { [HeartColor.PURPLE]: 3 }),
      PLAYER1,
      'discarded-purple-live'
    );
    const fodder = createCardInstance(
      createMember('PL!-discard-fodder'),
      PLAYER1,
      'discard-fodder'
    );
    const recoverScenario = setupBp5009({ handCards: [discardedLive, fodder] });

    expect(activateBp5009(recoverScenario.session).activeEffect).not.toBeNull();
    confirmMany(recoverScenario.session, [discardedLive.instanceId, fodder.instanceId]);
    expect(recoverScenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      discardedLive.instanceId,
    ]);
    confirmOne(recoverScenario.session, discardedLive.instanceId);
    expect(recoverScenario.session.state?.players[0].hand.cardIds).toEqual([
      discardedLive.instanceId,
    ]);
    expect(recoverScenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      fodder.instanceId,
    ]);

    const noTargetScenario = setupBp5009();
    expect(activateBp5009(noTargetScenario.session).activeEffect).not.toBeNull();
    confirmMany(noTargetScenario.session, [
      noTargetScenario.handCards[0]!.instanceId,
      noTargetScenario.handCards[1]!.instanceId,
    ]);
    expect(noTargetScenario.session.state?.activeEffect).toBeNull();
    expect(noTargetScenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      noTargetScenario.handCards[0]!.instanceId,
      noTargetScenario.handCards[1]!.instanceId,
    ]);
    expect(bp5009UseCount(noTargetScenario.session.state!)).toBe(1);
  });

  it('does not start with fewer than two hand cards and cannot be used twice in one turn', () => {
    const oneHand = setupBp5009({
      handCards: [createCardInstance(createMember('PL!-single-hand'), PLAYER1, 'single-hand')],
    });
    expect(activateBp5009(oneHand.session).activeEffect).toBeNull();
    expect(oneHand.session.state?.activeEffect).toBeNull();

    const scenario = setupBp5009();
    expect(activateBp5009(scenario.session).activeEffect).not.toBeNull();
    confirmMany(scenario.session, [
      scenario.handCards[0]!.instanceId,
      scenario.handCards[1]!.instanceId,
    ]);
    expect(bp5009UseCount(scenario.session.state!)).toBe(1);

    const extraHandA = createCardInstance(
      createMember('PL!-extra-hand-a'),
      PLAYER1,
      'extra-hand-a'
    );
    const extraHandB = createCardInstance(
      createMember('PL!-extra-hand-b'),
      PLAYER1,
      'extra-hand-b'
    );
    (scenario.session as unknown as { authorityState: GameState }).authorityState = registerCards(
      updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: [extraHandA.instanceId, extraHandB.instanceId],
        },
      })),
      [extraHandA, extraHandB]
    );
    expect(
      activateCardAbility(
        scenario.session.state!,
        PLAYER1,
        scenario.source.instanceId,
        BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID
      ).activeEffect
    ).toBeNull();
  });
});

describe('PL!-bp5-010 Honoka LIVE start discard, mill, and A-RISE recovery', () => {
  it('opens a real optional discard window, can decline, and consumes no-op when there is no hand or source left stage', () => {
    const decline = setupBp5010();
    const started = resolvePendingCardEffects(decline.game).gameState;
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect).toMatchObject({
      abilityId: BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const declined = confirmOne(sessionWithState(started), null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.players[0].waitingRoom.cardIds).toEqual([]);

    const noHand = resolvePendingCardEffects(setupBp5010({ handCards: [] }).game).gameState;
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.pendingAbilities).toEqual([]);

    const sourceLeft = resolvePendingCardEffects(
      setupBp5010({ placeSourceOnStage: false }).game
    ).gameState;
    expect(sourceLeft.activeEffect).toBeNull();
    expect(sourceLeft.pendingAbilities).toEqual([]);
  });

  it('discards one, mills top three, and can recover an A-RISE member from discard or mill', () => {
    const discardedArise = createCardInstance(
      createMember('PL!-discarded-arise', { groupNames: ['A-RISE'] }),
      PLAYER1,
      'discarded-arise'
    );
    const deckA = createCardInstance(createMember('PL!-deck-a'), PLAYER1, 'deck-a');
    const deckArise = createCardInstance(
      createMember('PL!-deck-arise', { groupNames: ['A-RISE'] }),
      PLAYER1,
      'deck-arise'
    );
    const deckLive = createCardInstance(
      createLive('PL!-deck-live', { [HeartColor.PINK]: 1 }, ['A-RISE']),
      PLAYER1,
      'deck-live'
    );
    const deckFiller = createCardInstance(createMember('PL!-deck-filler'), PLAYER1, 'deck-filler');
    const setup = setupBp5010({
      handCards: [discardedArise],
      mainDeckCards: [deckA, deckArise, deckLive, deckFiller],
    });
    const started = resolvePendingCardEffects(setup.game).gameState;
    const session = sessionWithState(started);

    confirmOne(session, discardedArise.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardedArise.instanceId,
      deckA.instanceId,
      deckArise.instanceId,
      deckLive.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      discardedArise.instanceId,
      deckArise.instanceId,
    ]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.MAIN_DECK &&
          entry.event.cardInstanceIds?.join(',') ===
            [deckA.instanceId, deckArise.instanceId, deckLive.instanceId].join(',')
      )
    ).toBe(true);

    confirmOne(session, deckArise.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([deckArise.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardedArise.instanceId,
      deckA.instanceId,
      deckLive.instanceId,
    ]);
  });

  it('keeps discard and mill on no-target no-op when no A-RISE member exists', () => {
    const discard = createCardInstance(createMember('PL!-discard-non-arise'), PLAYER1, 'discard');
    const deckCards = ['deck-a', 'deck-b', 'deck-c', 'deck-d'].map((id) =>
      createCardInstance(createMember(`PL!-${id}`), PLAYER1, id)
    );
    const setup = setupBp5010({
      handCards: [discard],
      mainDeckCards: deckCards,
    });
    const started = resolvePendingCardEffects(setup.game).gameState;
    const session = sessionWithState(started);

    confirmOne(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      deckCards[0]!.instanceId,
      deckCards[1]!.instanceId,
      deckCards[2]!.instanceId,
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID &&
          action.payload.step === 'NO_ARISE_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it('records refresh-aware mill payload when top three crosses a refresh boundary', () => {
    const discard = createCardInstance(createMember('PL!-discard-non-arise'), PLAYER1, 'discard');
    const firstDeck = createCardInstance(createMember('PL!-first-deck'), PLAYER1, 'first-deck');
    const waitingA = createCardInstance(createMember('PL!-waiting-a'), PLAYER1, 'waiting-a');
    const waitingB = createCardInstance(createMember('PL!-waiting-b'), PLAYER1, 'waiting-b');
    const waitingC = createCardInstance(createMember('PL!-waiting-c'), PLAYER1, 'waiting-c');
    const setup = setupBp5010({
      handCards: [discard],
      mainDeckCards: [firstDeck],
      waitingCards: [waitingA, waitingB, waitingC],
    });
    const started = resolvePendingCardEffects(setup.game).gameState;
    const session = sessionWithState(started);

    confirmOne(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    const millPayload = session.state?.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID &&
        action.payload.step === 'MILL_TOP_THREE'
    )?.payload;
    expect(millPayload?.refreshCount).toBeGreaterThanOrEqual(1);
    expect((millPayload?.milledCardIds as readonly string[] | undefined)?.length).toBe(3);
    expect(millPayload?.discardedHandCardIds).toEqual([discard.instanceId]);
    expect(millPayload?.milledCardIds as readonly string[] | undefined).toContain(
      firstDeck.instanceId
    );
  });
});
