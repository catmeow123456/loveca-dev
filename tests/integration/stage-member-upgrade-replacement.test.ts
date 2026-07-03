import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createActivateAbilityCommand, createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
  S_BP6_003_ACTIVATED_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
  S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
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
const BP3_006_ABILITY_ID = S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID;
const BP6_003_ABILITY_ID = S_BP6_003_ACTIVATED_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID;

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, cost = 6): LiveCardData & { readonly cost: number } {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 5,
    cost,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function baseGame(testId: string): GameState {
  return {
    ...createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function setupBp3006(options: {
  readonly testId?: string;
  readonly sourceCode?: string;
  readonly sourceSlot?: SlotPosition;
  readonly sourceOrientation?: OrientationState;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly deckCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly targetCard?: ReturnType<typeof createCardInstance>;
  readonly rightStageCard?: ReturnType<typeof createCardInstance>;
  readonly opponentStageCard?: ReturnType<typeof createCardInstance>;
  readonly opponentWaitingCard?: ReturnType<typeof createCardInstance>;
  readonly offStageCard?: ReturnType<typeof createCardInstance>;
} = {}) {
  const testId = options.testId ?? 'bp3-006';
  const source = createCardInstance(
    createMember(options.sourceCode ?? 'PL!S-bp3-006-P', { name: '津島善子', cost: 13 }),
    PLAYER1,
    `${testId}-source`
  );
  const target =
    options.targetCard ??
    createCardInstance(
      createMember('PL!S-target-aqours', { name: 'Target Aqours', cost: 4 }),
      PLAYER1,
      `${testId}-target`
    );
  const handCards =
    options.handCards ??
    [
      createCardInstance(
        createMember('PL!S-bp6-006-P', { name: '津島善子', cost: 6 }),
        PLAYER1,
        `${testId}-discard-replacement`
      ),
    ];
  const waitingCards = options.waitingCards ?? [];
  const deckCards = options.deckCards ?? [];
  const allCards = [
    source,
    target,
    ...handCards,
    ...waitingCards,
    ...deckCards,
    ...(options.rightStageCard ? [options.rightStageCard] : []),
    ...(options.opponentStageCard ? [options.opponentStageCard] : []),
    ...(options.opponentWaitingCard ? [options.opponentWaitingCard] : []),
    ...(options.offStageCard ? [options.offStageCard] : []),
  ];

  const session = createGameSession();
  session.createGame(testId, PLAYER1, 'P1', PLAYER2, 'P2');
  let game = registerCards(baseGame(testId), allCards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, options.sourceSlot ?? SlotPosition.CENTER, source.instanceId, {
      orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, target.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.rightStageCard) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, options.rightStageCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return {
      ...player,
      hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
      waitingRoom: [
        ...waitingCards,
        ...(options.offStageCard ? [options.offStageCard] : []),
      ].reduce((zone, card) => addCardToZone(zone, card.instanceId), player.waitingRoom),
      mainDeck: deckCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
      memberSlots,
    };
  });
  if (options.opponentStageCard || options.opponentWaitingCard) {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: options.opponentStageCard
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, options.opponentStageCard.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
        : player.memberSlots,
      waitingRoom: options.opponentWaitingCard
        ? addCardToZone(player.waitingRoom, options.opponentWaitingCard.instanceId)
        : player.waitingRoom,
    }));
  }
  setAuthorityState(session, game);

  return {
    session,
    source,
    target,
    handCards,
    waitingCards,
    deckCards,
  };
}

function setupBp6003(options: {
  readonly testId?: string;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
} = {}) {
  const testId = options.testId ?? 'bp6-003-shared-regression';
  const source = createCardInstance(
    createMember('PL!S-bp6-003-P', { name: '松浦果南', cost: 9 }),
    PLAYER1,
    `${testId}-source`
  );
  const target = createCardInstance(
    createMember('PL!S-target-aqours', { cost: 4 }),
    PLAYER1,
    `${testId}-target`
  );
  const handCards =
    options.handCards ??
    [
      createCardInstance(
        createMember('PL!S-bp6-006-P', { name: '津島善子', cost: 6 }),
        PLAYER1,
        `${testId}-discard-replacement`
      ),
    ];
  const energyCards = Array.from({ length: 2 }, (_unused, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `${testId}-energy-${index}`)
  );
  const session = createGameSession();
  session.createGame(testId, PLAYER1, 'P1', PLAYER2, 'P2');
  let game = registerCards(baseGame(testId), [source, target, ...handCards, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    energyZone: energyCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      target.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  setAuthorityState(session, game);

  return { session, source, target, handCards, energyCards };
}

function activate(session: ReturnType<typeof createGameSession>, sourceCardId: string, abilityId = BP3_006_ABILITY_ID) {
  return session.executeCommand(createActivateAbilityCommand(PLAYER1, sourceCardId, abilityId));
}

function confirmCard(session: ReturnType<typeof createGameSession>, selectedCardId: string) {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId));
  expect(result.success, result.error).toBe(true);
}

function eventCardIds(game: GameState, eventType: TriggerCondition): readonly string[] {
  return game.eventLog.flatMap((entry) =>
    entry.event.eventType === eventType
      ? (entry.event.cardInstanceIds ?? [entry.event.cardInstanceId])
      : []
  );
}

function moveEventsForCard(game: GameState, eventType: TriggerCondition, cardId: string) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === eventType &&
        (event.cardInstanceId === cardId || event.cardInstanceIds?.includes(cardId) === true)
    );
}

function abilityUseCount(game: GameState | null, abilityId: string, sourceCardId: string): number {
  return (
    game?.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === abilityId &&
        action.payload.sourceCardId === sourceCardId &&
        action.payload.step === 'ABILITY_USE'
    ).length ?? 0
  );
}

describe('stage member upgrade replacement shared workflow', () => {
  it('handles PL!S-bp3-006 wait self cost, discard cost, target move, and replacement on-enter triggers', () => {
    const drawnCards = [
      createCardInstance(createMember('PL!S-draw-1'), PLAYER1, 'bp3-draw-1'),
      createCardInstance(createMember('PL!S-draw-2'), PLAYER1, 'bp3-draw-2'),
    ];
    const scenario = setupBp3006({
      testId: 'bp3-006-normal',
      deckCards: drawnCards,
    });

    const activation = activate(scenario.session, scenario.source.instanceId);
    expect(activation.success, activation.error).toBe(true);
    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(moveEventsForCard(scenario.session.state!, TriggerCondition.ON_MEMBER_STATE_CHANGED, scenario.source.instanceId)[0]).toMatchObject({
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });

    confirmCard(scenario.session, scenario.handCards[0]!.instanceId);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.handCards[0]!.instanceId
    );
    expect(moveEventsForCard(scenario.session.state!, TriggerCondition.ON_ENTER_WAITING_ROOM, scenario.handCards[0]!.instanceId)[0]).toMatchObject({
      fromZone: ZoneType.HAND,
      toZone: ZoneType.WAITING_ROOM,
    });
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.target.instanceId,
    ]);

    confirmCard(scenario.session, scenario.target.instanceId);
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(moveEventsForCard(scenario.session.state!, TriggerCondition.ON_LEAVE_STAGE, scenario.target.instanceId)[0]).toMatchObject({
      fromZone: ZoneType.MEMBER_SLOT,
      fromSlot: SlotPosition.LEFT,
    });
    expect(moveEventsForCard(scenario.session.state!, TriggerCondition.ON_ENTER_WAITING_ROOM, scenario.target.instanceId)[0]).toMatchObject({
      fromZone: ZoneType.MEMBER_SLOT,
      toZone: ZoneType.WAITING_ROOM,
    });
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.handCards[0]!.instanceId,
    ]);

    confirmCard(scenario.session, scenario.handCards[0]!.instanceId);

    const finalState = scenario.session.state!;
    expect(finalState.activeEffect).toBeNull();
    expect(finalState.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.source.instanceId
    );
    expect(finalState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.handCards[0]!.instanceId
    );
    expect(finalState.players[0].waitingRoom.cardIds).toContain(scenario.target.instanceId);
    expect(finalState.players[0].waitingRoom.cardIds).not.toContain(
      scenario.handCards[0]!.instanceId
    );
    expect(moveEventsForCard(finalState, TriggerCondition.ON_ENTER_STAGE, scenario.handCards[0]!.instanceId)[0]).toMatchObject({
      fromZone: ZoneType.WAITING_ROOM,
      toZone: ZoneType.MEMBER_SLOT,
      toSlot: SlotPosition.LEFT,
    });
    expect(finalState.players[0].hand.cardIds).toEqual(drawnCards.map((card) => card.instanceId));
    expect(
      finalState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID &&
          action.payload.step === 'DRAW_TWO_GAIN_THREE_BLADE'
      )
    ).toBe(true);
  });

  it('filters PL!S-bp3-006 target and replacement candidates after the discard has entered waiting room', () => {
    const discardCandidate = createCardInstance(
      createMember('PL!S-discard-candidate', { cost: 6 }),
      PLAYER1,
      'bp3-discard-candidate'
    );
    const legalWaiting = createCardInstance(
      createMember('PL!S-legal-waiting', { cost: 6 }),
      PLAYER1,
      'bp3-legal-waiting'
    );
    const wrongCost = createCardInstance(
      createMember('PL!S-wrong-cost', { cost: 5 }),
      PLAYER1,
      'bp3-wrong-cost'
    );
    const nonAqours = createCardInstance(
      createMember('PL!SP-non-aqours', { cost: 6, groupNames: ['Liella!'] }),
      PLAYER1,
      'bp3-non-aqours'
    );
    const aqoursLive = createCardInstance(createLive('PL!S-live-candidate', 6), PLAYER1, 'bp3-aqours-live');
    const nonAqoursStage = createCardInstance(
      createMember('PL!SP-stage-non-aqours', { cost: 4, groupNames: ['Liella!'] }),
      PLAYER1,
      'bp3-stage-non-aqours'
    );
    const opponentStage = createCardInstance(
      createMember('PL!S-opponent-stage', { cost: 4 }),
      PLAYER2,
      'bp3-opponent-stage'
    );
    const opponentWaiting = createCardInstance(
      createMember('PL!S-opponent-waiting', { cost: 6 }),
      PLAYER2,
      'bp3-opponent-waiting'
    );
    const offStageAqours = createCardInstance(
      createMember('PL!S-off-stage', { cost: 4 }),
      PLAYER1,
      'bp3-off-stage'
    );
    const scenario = setupBp3006({
      testId: 'bp3-006-filtering',
      handCards: [discardCandidate],
      waitingCards: [legalWaiting, wrongCost, nonAqours, aqoursLive],
      rightStageCard: nonAqoursStage,
      opponentStageCard: opponentStage,
      opponentWaitingCard: opponentWaiting,
      offStageCard: offStageAqours,
    });

    expect(activate(scenario.session, scenario.source.instanceId).success).toBe(true);
    confirmCard(scenario.session, discardCandidate.instanceId);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.target.instanceId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.source.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      nonAqoursStage.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      opponentStage.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      offStageAqours.instanceId
    );

    confirmCard(scenario.session, scenario.target.instanceId);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      legalWaiting.instanceId,
      discardCandidate.instanceId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.source.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      wrongCost.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      nonAqours.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      aqoursLive.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      opponentWaiting.instanceId
    );
  });

  it('keeps PL!S-bp3-006 paid costs and sent target when no cost+2 replacement candidate exists', () => {
    const discard = createCardInstance(
      createMember('PL!S-discard-not-candidate', { cost: 1 }),
      PLAYER1,
      'bp3-discard-not-candidate'
    );
    const wrongCost = createCardInstance(
      createMember('PL!S-wrong-cost', { cost: 7 }),
      PLAYER1,
      'bp3-wrong-cost-no-candidate'
    );
    const scenario = setupBp3006({
      testId: 'bp3-006-no-candidate',
      handCards: [discard],
      waitingCards: [wrongCost],
    });

    expect(activate(scenario.session, scenario.source.instanceId).success).toBe(true);
    confirmCard(scenario.session, discard.instanceId);
    confirmCard(scenario.session, scenario.target.instanceId);

    const state = scenario.session.state!;
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      wrongCost.instanceId,
      discard.instanceId,
      scenario.target.instanceId,
    ]);
    expect(abilityUseCount(state, BP3_006_ABILITY_ID, scenario.source.instanceId)).toBe(1);

    const secondActivation = activate(scenario.session, scenario.source.instanceId);
    expect(secondActivation.success).toBe(false);
    expect(abilityUseCount(scenario.session.state, BP3_006_ABILITY_ID, scenario.source.instanceId)).toBe(1);
  });

  it('does not activate PL!S-bp3-006 outside CENTER, while already WAITING, or without hand cost', () => {
    const nonCenter = setupBp3006({ testId: 'bp3-006-non-center', sourceSlot: SlotPosition.RIGHT });
    const nonCenterResult = activate(nonCenter.session, nonCenter.source.instanceId);
    expect(nonCenterResult.success).toBe(false);
    expect(
      nonCenter.session.state?.players[0].memberSlots.cardStates.get(nonCenter.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(abilityUseCount(nonCenter.session.state, BP3_006_ABILITY_ID, nonCenter.source.instanceId)).toBe(0);

    const alreadyWaiting = setupBp3006({
      testId: 'bp3-006-already-waiting',
      sourceOrientation: OrientationState.WAITING,
    });
    const waitingResult = activate(alreadyWaiting.session, alreadyWaiting.source.instanceId);
    expect(waitingResult.success).toBe(false);
    expect(abilityUseCount(alreadyWaiting.session.state, BP3_006_ABILITY_ID, alreadyWaiting.source.instanceId)).toBe(0);

    const noHand = setupBp3006({ testId: 'bp3-006-no-hand', handCards: [] });
    const noHandResult = activate(noHand.session, noHand.source.instanceId);
    expect(noHandResult.success).toBe(false);
    expect(noHand.session.state?.players[0].memberSlots.cardStates.get(noHand.source.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(abilityUseCount(noHand.session.state, BP3_006_ABILITY_ID, noHand.source.instanceId)).toBe(0);
  });

  it('keeps PL!S-bp6-003 on the same shared target and replacement steps', () => {
    const scenario = setupBp6003();

    expect(activate(scenario.session, scenario.source.instanceId, BP6_003_ABILITY_ID).success).toBe(true);
    confirmCard(scenario.session, scenario.handCards[0]!.instanceId);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.target.instanceId,
    ]);
    confirmCard(scenario.session, scenario.target.instanceId);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.handCards[0]!.instanceId,
    ]);
    confirmCard(scenario.session, scenario.handCards[0]!.instanceId);

    const finalState = scenario.session.state!;
    expect(finalState.activeEffect).toBeNull();
    expect(finalState.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.source.instanceId
    );
    expect(finalState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.handCards[0]!.instanceId
    );
    expect(eventCardIds(finalState, TriggerCondition.ON_ENTER_STAGE)).toContain(
      scenario.handCards[0]!.instanceId
    );
  });
});
