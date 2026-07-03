import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createActivateAbilityCommand, createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
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
const ABILITY_ID = S_BP6_003_ACTIVATED_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID;

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

function setupKanan(options: {
  readonly testId?: string;
  readonly sourceCode?: string;
  readonly energyCount?: number;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly deckCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly targetCard?: ReturnType<typeof createCardInstance>;
  readonly rightStageCard?: ReturnType<typeof createCardInstance>;
  readonly opponentStageCard?: ReturnType<typeof createCardInstance>;
  readonly offStageCard?: ReturnType<typeof createCardInstance>;
} = {}) {
  const source = createCardInstance(
    createMember(options.sourceCode ?? 'PL!S-bp6-003-P', { name: '松浦果南', cost: 9 }),
    PLAYER1,
    `${options.testId ?? 'kanan'}-source`
  );
  const target =
    options.targetCard ??
    createCardInstance(
      createMember('PL!S-target-aqours', { name: 'Target Aqours', cost: 4 }),
      PLAYER1,
      `${options.testId ?? 'kanan'}-target`
    );
  const energyCards = Array.from({ length: options.energyCount ?? 2 }, (_unused, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `${options.testId ?? 'kanan'}-energy-${index}`)
  );
  const handCards = options.handCards ?? [
    createCardInstance(
      createMember('PL!S-bp6-006-P', { name: '津島善子', cost: 6 }),
      PLAYER1,
      `${options.testId ?? 'kanan'}-discard-replacement`
    ),
  ];
  const waitingCards = options.waitingCards ?? [];
  const deckCards = options.deckCards ?? [];
  const allCards = [
    source,
    target,
    ...energyCards,
    ...handCards,
    ...waitingCards,
    ...deckCards,
    ...(options.rightStageCard ? [options.rightStageCard] : []),
    ...(options.opponentStageCard ? [options.opponentStageCard] : []),
    ...(options.offStageCard ? [options.offStageCard] : []),
  ];

  const session = createGameSession();
  session.createGame(options.testId ?? 's-bp6-003', PLAYER1, 'P1', PLAYER2, 'P2');
  let game = registerCards(baseGame(options.testId ?? 's-bp6-003'), allCards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
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
      energyZone: energyCards.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      memberSlots,
    };
  });
  if (options.opponentStageCard) {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, options.opponentStageCard!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
  }
  setAuthorityState(session, game);

  return {
    session,
    source,
    target,
    energyCards,
    handCards,
    waitingCards,
    deckCards,
  };
}

function activate(session: ReturnType<typeof createGameSession>, sourceCardId: string) {
  return session.executeCommand(createActivateAbilityCommand(PLAYER1, sourceCardId, ABILITY_ID));
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

function abilityUseCount(game: GameState | null, sourceCardId: string): number {
  return (
    game?.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === ABILITY_ID &&
        action.payload.sourceCardId === sourceCardId &&
        action.payload.step === 'ABILITY_USE'
    ).length ?? 0
  );
}

describe('PL!S-bp6-003 松浦果南 activated upgrade replacement workflow', () => {
  it('pays [E][E], discards one hand card, replaces another Aqours member, and enqueues the replacement on-enter effect', () => {
    const drawnCards = [
      createCardInstance(createMember('PL!S-draw-1'), PLAYER1, 'draw-1'),
      createCardInstance(createMember('PL!S-draw-2'), PLAYER1, 'draw-2'),
    ];
    const scenario = setupKanan({
      testId: 'kanan-normal',
      energyCount: 4,
      deckCards: drawnCards,
    });

    const activation = activate(scenario.session, scenario.source.instanceId);
    expect(activation.success, activation.error).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.handCards[0]!.instanceId,
    ]);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCards[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCards[1]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);

    confirmCard(scenario.session, scenario.handCards[0]!.instanceId);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.handCards[0]!.instanceId
    );
    expect(eventCardIds(scenario.session.state!, TriggerCondition.ON_ENTER_WAITING_ROOM)).toContain(
      scenario.handCards[0]!.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.target.instanceId,
    ]);

    confirmCard(scenario.session, scenario.target.instanceId);
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.handCards[0]!.instanceId,
    ]);
    expect(eventCardIds(scenario.session.state!, TriggerCondition.ON_LEAVE_STAGE)).toContain(
      scenario.target.instanceId
    );
    expect(eventCardIds(scenario.session.state!, TriggerCondition.ON_ENTER_WAITING_ROOM)).toContain(
      scenario.target.instanceId
    );

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
    expect(eventCardIds(finalState, TriggerCondition.ON_ENTER_STAGE)).toContain(
      scenario.handCards[0]!.instanceId
    );
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

  it('filters stage targets and replacement candidates, including the just-discarded hand card, and queues wrapper triggers', () => {
    const discardCandidate = createCardInstance(
      createMember('PL!S-discard-candidate', { cost: 6 }),
      PLAYER1,
      'discard-candidate'
    );
    const legalWaiting = createCardInstance(
      createMember('PL!S-legal-waiting', { cost: 6 }),
      PLAYER1,
      'legal-waiting'
    );
    const wrongCost = createCardInstance(
      createMember('PL!S-wrong-cost', { cost: 5 }),
      PLAYER1,
      'wrong-cost'
    );
    const nonAqours = createCardInstance(
      createMember('PL!SP-non-aqours', { cost: 6, groupNames: ['Liella!'] }),
      PLAYER1,
      'non-aqours'
    );
    const aqoursLive = createCardInstance(createLive('PL!S-live-candidate', 6), PLAYER1, 'aqours-live');
    const leaveStageTarget = createCardInstance(
      createMember('PL!HS-bp2-012-N', { cost: 4, groupNames: ['Aqours'] }),
      PLAYER1,
      'leave-stage-target'
    );
    const handWatcher = createCardInstance(
      createMember('PL!HS-pb1-003-P', { cost: 9, groupNames: ['蓮ノ空'] }),
      PLAYER1,
      'hand-watcher'
    );
    const opponentMember = createCardInstance(
      createMember('PL!S-opponent', { cost: 4 }),
      PLAYER2,
      'opponent-member'
    );
    const offStageAqours = createCardInstance(
      createMember('PL!S-off-stage', { cost: 4 }),
      PLAYER1,
      'off-stage-aqours'
    );
    const scenario = setupKanan({
      testId: 'kanan-filtering',
      handCards: [discardCandidate],
      waitingCards: [legalWaiting, wrongCost, nonAqours, aqoursLive],
      targetCard: leaveStageTarget,
      rightStageCard: handWatcher,
      opponentStageCard: opponentMember,
      offStageCard: offStageAqours,
    });

    expect(activate(scenario.session, scenario.source.instanceId).success).toBe(true);
    confirmCard(scenario.session, discardCandidate.instanceId);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      leaveStageTarget.instanceId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.source.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      handWatcher.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      opponentMember.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      offStageAqours.instanceId
    );
    expect(
      scenario.session.state?.pendingAbilities.some(
        (pending) =>
          pending.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          pending.metadata?.movedCardIds?.includes(discardCandidate.instanceId) === true
      )
    ).toBe(true);

    confirmCard(scenario.session, leaveStageTarget.instanceId);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      legalWaiting.instanceId,
      discardCandidate.instanceId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      wrongCost.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      nonAqours.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      aqoursLive.instanceId
    );
    expect(
      scenario.session.state?.pendingAbilities.some(
        (pending) =>
          pending.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID &&
          pending.sourceCardId === leaveStageTarget.instanceId
      )
    ).toBe(true);
  });

  it('keeps paid costs and the sent target when no cost+2 replacement candidate exists', () => {
    const discard = createCardInstance(
      createMember('PL!S-discard-not-candidate', { cost: 1 }),
      PLAYER1,
      'discard-not-candidate'
    );
    const wrongCost = createCardInstance(
      createMember('PL!S-wrong-cost', { cost: 7 }),
      PLAYER1,
      'wrong-cost-no-candidate'
    );
    const scenario = setupKanan({
      testId: 'kanan-no-candidate',
      handCards: [discard],
      waitingCards: [wrongCost],
    });

    expect(activate(scenario.session, scenario.source.instanceId).success).toBe(true);
    confirmCard(scenario.session, discard.instanceId);
    confirmCard(scenario.session, scenario.target.instanceId);

    const state = scenario.session.state!;
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.source.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      wrongCost.instanceId,
      discard.instanceId,
      scenario.target.instanceId,
    ]);
    expect(abilityUseCount(state, scenario.source.instanceId)).toBe(1);
  });

  it('does not activate or consume turn1 when energy or hand costs are missing, and blocks a second successful activation', () => {
    const noEnergy = setupKanan({ testId: 'kanan-no-energy', energyCount: 1 });
    const noEnergyResult = activate(noEnergy.session, noEnergy.source.instanceId);
    expect(noEnergyResult.success).toBe(false);
    expect(abilityUseCount(noEnergy.session.state, noEnergy.source.instanceId)).toBe(0);
    expect(
      noEnergy.session.state?.players[0].energyZone.cardStates.get(noEnergy.energyCards[0]!.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);

    const noHand = setupKanan({ testId: 'kanan-no-hand', handCards: [] });
    const noHandResult = activate(noHand.session, noHand.source.instanceId);
    expect(noHandResult.success).toBe(false);
    expect(abilityUseCount(noHand.session.state, noHand.source.instanceId)).toBe(0);

    const extraHand = createCardInstance(
      createMember('PL!S-extra-hand', { cost: 6 }),
      PLAYER1,
      'extra-hand'
    );
    const success = setupKanan({
      testId: 'kanan-turn-once',
      energyCount: 4,
      handCards: [
        createCardInstance(createMember('PL!S-first-replacement', { cost: 6 }), PLAYER1, 'first-replacement'),
        extraHand,
      ],
    });
    expect(activate(success.session, success.source.instanceId).success).toBe(true);
    confirmCard(success.session, 'first-replacement');
    confirmCard(success.session, success.target.instanceId);
    confirmCard(success.session, 'first-replacement');
    expect(abilityUseCount(success.session.state, success.source.instanceId)).toBe(1);

    const secondActivation = activate(success.session, success.source.instanceId);
    expect(secondActivation.success).toBe(false);
    expect(secondActivation.error).toContain('本回合已发动');
    expect(abilityUseCount(success.session.state, success.source.instanceId)).toBe(1);
  });
});
