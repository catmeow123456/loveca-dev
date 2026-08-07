import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
  N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
  N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
  SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
  SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../src/application/card-effects/runtime/member-state-changed-triggers';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../src/application/effects/energy';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(code: string, id: string, groupNames: readonly string[] = ['虹ヶ咲']) {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      groupNames,
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    P1,
    id
  );
}

function energy(id: string) {
  return createCardInstance(
    { cardCode: `ENERGY-${id}`, name: id, cardType: CardType.ENERGY },
    P1,
    id
  );
}

function pending(
  abilityId: string,
  sourceCardId: string,
  id: string,
  timingId = TriggerCondition.ON_ENTER_STAGE
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds: [`event-${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function putMembersAndEnergyDeck(
  game: GameState,
  cardsBySlot: Readonly<Partial<Record<SlotPosition, string>>>,
  energyCardIds: readonly string[] = []
): GameState {
  return updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [slot, cardId] of Object.entries(cardsBySlot)) {
      memberSlots = placeCardInSlot(memberSlots, slot as SlotPosition, cardId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      energyDeck: { ...player.energyDeck, cardIds: energyCardIds },
    };
  });
}

function enqueueWaitingTransition(game: GameState, cardId: string): GameState {
  const result = setMemberOrientation(game, P1, cardId, OrientationState.WAITING, {
    kind: 'PLAYER_ACTION',
    playerId: P1,
  });
  expect(result).not.toBeNull();
  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    result!,
    enqueueTriggeredCardEffects
  ).gameState;
}

function enqueueWaitingTransitions(game: GameState, cardIds: readonly string[]): GameState {
  let state = game;
  for (const cardId of cardIds) {
    const result = setMemberOrientation(state, P1, cardId, OrientationState.WAITING, {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'batch-wait-source',
    });
    expect(result?.changed).toBe(true);
    state = result!.gameState;
  }
  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { gameState: state },
    enqueueTriggeredCardEffects
  ).gameState;
}

describe('PL!N-bp7-017 optional energy-deck placement below a Nijigasaki member', () => {
  it('uses the full definition text, supports skip, and never emits the ENERGY_ZONE-to-below trigger', () => {
    const source = member('PL!N-bp7-017-TEST', 'ai');
    const target = member('TARGET-NIJIGASAKI', 'target');
    const topEnergy = energy('energy-top');
    let game = registerCards(createGameState('n017', P1, 'P1', P2, 'P2'), [
      source,
      target,
      topEnergy,
    ]);
    game = putMembersAndEnergyDeck(
      game,
      { [SlotPosition.CENTER]: source.instanceId, [SlotPosition.LEFT]: target.instanceId },
      [topEnergy.instanceId]
    );
    game = {
      ...game,
      pendingAbilities: [
        pending(
          N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
          source.instanceId,
          'n017'
        ),
      ],
    };

    const choosing = resolvePendingCardEffects(game).gameState;
    expect(choosing.activeEffect?.effectText).toBe(
      findCardAbilityDefinitionById(
        N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID
      )?.effectText
    );
    expect(choosing.activeEffect?.canSkipSelection).toBe(true);
    expect(choosing.activeEffect?.selectableCardIds).toEqual([
      target.instanceId,
      source.instanceId,
    ]);

    const skipped = confirmActiveEffectStep(choosing, P1, choosing.activeEffect!.id, null);
    expect(skipped.players[0].energyDeck.cardIds).toEqual([topEnergy.instanceId]);

    const choosingAgain = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
          source.instanceId,
          'n017-again'
        ),
      ],
    }).gameState;
    const done = confirmActiveEffectStep(
      choosingAgain,
      P1,
      choosingAgain.activeEffect!.id,
      target.instanceId
    );
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([
      topEnergy.instanceId,
    ]);
    expect(
      done.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER
      )
    ).toHaveLength(0);
  });

  it('consumes no-target and empty-deck cases without opening a selection window', () => {
    const source = member('PL!N-bp7-017-N', 'ai');
    let game = registerCards(createGameState('n017-empty', P1, 'P1', P2, 'P2'), [source]);
    game = putMembersAndEnergyDeck(game, { [SlotPosition.CENTER]: source.instanceId });
    const done = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
          source.instanceId,
          'n017-empty'
        ),
      ],
    }).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toHaveLength(0);
    expect(done.actionHistory.at(-1)?.payload.step).toBe('EMPTY_ENERGY_DECK');

    const nonNijigasakiSource = member('PL!N-bp7-017-OTHER', 'other-source', ['Aqours']);
    const availableEnergy = energy('no-target-energy');
    let noTargetGame = registerCards(createGameState('n017-no-target', P1, 'P1', P2, 'P2'), [
      nonNijigasakiSource,
      availableEnergy,
    ]);
    noTargetGame = putMembersAndEnergyDeck(
      noTargetGame,
      { [SlotPosition.CENTER]: nonNijigasakiSource.instanceId },
      [availableEnergy.instanceId]
    );
    const noTargetDone = resolvePendingCardEffects({
      ...noTargetGame,
      pendingAbilities: [
        pending(
          N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
          nonNijigasakiSource.instanceId,
          'n017-no-target'
        ),
      ],
    }).gameState;
    expect(noTargetDone.activeEffect).toBeNull();
    expect(noTargetDone.pendingAbilities).toHaveLength(0);
    expect(noTargetDone.players[0].energyDeck.cardIds).toEqual([availableEnergy.instanceId]);
    expect(noTargetDone.actionHistory.at(-1)?.payload.step).toBe('NO_VALID_TARGET');
  });
});

describe('shared own Nijigasaki member waited -> optional discard -> batch target reactivation', () => {
  function setup(
    abilityId: string,
    sourceCode: string,
    turnType: TurnType,
    currentPhase = GamePhase.MAIN_PHASE
  ) {
    const source = member(sourceCode, 'shioriko');
    const target = member('TARGET-NIJIGASAKI', 'target');
    const secondTarget = member('SECOND-TARGET-NIJIGASAKI', 'second-target');
    const hand = member('HAND-CARD', 'hand-card');
    const secondHand = member('SECOND-HAND-CARD', 'second-hand-card');
    let game = registerCards(createGameState('waited-family', P1, 'P1', P2, 'P2'), [
      source,
      target,
      secondTarget,
      hand,
      secondHand,
    ]);
    game = putMembersAndEnergyDeck(game, {
      [SlotPosition.CENTER]: source.instanceId,
      [SlotPosition.LEFT]: target.instanceId,
      [SlotPosition.RIGHT]: secondTarget.instanceId,
    });
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToZone(addCardToZone(player.hand, hand.instanceId), secondHand.instanceId),
    }));
    return {
      game: { ...game, currentPhase, currentTurnType: turnType },
      source,
      target,
      secondTarget,
      hand,
      secondHand,
      abilityId,
    };
  }

  it('applies the complete Live-stage GamePhase gate and skip does not consume turn1', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-N',
      TurnType.FIRST_PLAYER_TURN,
      GamePhase.MAIN_PHASE
    );
    const outsideLive = enqueueWaitingTransition(scenario.game, scenario.target.instanceId);
    expect(outsideLive.pendingAbilities).toHaveLength(0);

    const liveGame = {
      ...scenario.game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
    };
    const triggered = enqueueWaitingTransition(liveGame, scenario.target.instanceId);
    expect(triggered.pendingAbilities).toHaveLength(1);
    expect(triggered.pendingAbilities[0]?.metadata?.changedCardIds).toEqual([
      scenario.target.instanceId,
    ]);
    const choosing = resolvePendingCardEffects(triggered).gameState;
    expect(choosing.activeEffect?.effectText).toBe(
      findCardAbilityDefinitionById(scenario.abilityId)?.effectText
    );
    const skipped = confirmActiveEffectStep(choosing, P1, choosing.activeEffect!.id, null);
    expect(
      skipped.actionHistory.filter(
        (action) =>
          action.payload.abilityId === scenario.abilityId && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(0);

    const activated = setMemberOrientation(
      skipped,
      P1,
      scenario.target.instanceId,
      OrientationState.ACTIVE
    )!;
    const retriggered = enqueueWaitingTransition(activated.gameState, scenario.target.instanceId);
    expect(retriggered.pendingAbilities).toHaveLength(1);
  });

  it.each([GamePhase.LIVE_SET_PHASE, GamePhase.LIVE_RESULT_PHASE])(
    'also triggers during the %s portion of the rules Live stage',
    (currentPhase) => {
      const scenario = setup(
        N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
        'PL!N-bp7-022-TEST',
        TurnType.LIVE_PHASE,
        currentPhase
      );

      const triggered = enqueueWaitingTransition(scenario.game, scenario.target.instanceId);

      expect(triggered.pendingAbilities).toHaveLength(1);
      expect(triggered.pendingAbilities[0]?.metadata?.changedCardIds).toEqual([
        scenario.target.instanceId,
      ]);
    }
  );

  it('aggregates three simultaneous waiting events into one pending with all candidates', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-N',
      TurnType.LIVE_PHASE,
      GamePhase.PERFORMANCE_PHASE
    );
    const changedCardIds = [
      scenario.target.instanceId,
      scenario.source.instanceId,
      scenario.secondTarget.instanceId,
    ];
    const triggered = enqueueWaitingTransitions(scenario.game, changedCardIds);

    expect(triggered.pendingAbilities).toHaveLength(1);
    expect(triggered.pendingAbilities[0]).toMatchObject({
      abilityId: scenario.abilityId,
      sourceCardId: scenario.source.instanceId,
      eventIds: expect.any(Array),
      metadata: { changedCardIds },
    });
    expect(triggered.pendingAbilities[0]?.eventIds).toHaveLength(3);

    const choosing = resolvePendingCardEffects(triggered).gameState;
    const skipped = confirmActiveEffectStep(choosing, P1, choosing.activeEffect!.id, null);
    expect(skipped.pendingAbilities).toHaveLength(0);
    expect(
      skipped.actionHistory.filter(
        (action) =>
          action.payload.abilityId === scenario.abilityId && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(0);
  });

  it('after payment opens an exact public choice and can activate a non-first batch target', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-N',
      TurnType.LIVE_PHASE,
      GamePhase.PERFORMANCE_PHASE
    );
    const changedCardIds = [
      scenario.target.instanceId,
      scenario.source.instanceId,
      scenario.secondTarget.instanceId,
    ];
    const choosingDiscard = resolvePendingCardEffects(
      enqueueWaitingTransitions(scenario.game, changedCardIds)
    ).gameState;
    const choosingTarget = confirmActiveEffectStep(
      choosingDiscard,
      P1,
      choosingDiscard.activeEffect!.id,
      scenario.hand.instanceId
    );
    expect(choosingTarget.activeEffect).toMatchObject({
      selectableCardIds: changedCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要变为活跃状态的成员',
      confirmSelectionLabel: '变为活跃状态',
      canSkipSelection: false,
    });
    expect(
      confirmActiveEffectStep(
        choosingTarget,
        P1,
        choosingTarget.activeEffect!.id,
        'not-offered'
      )
    ).toBe(choosingTarget);
    expect(
      confirmActiveEffectStep(choosingTarget, P1, choosingTarget.activeEffect!.id, null)
    ).toBe(choosingTarget);
    expect(
      confirmActiveEffectStep(
        choosingTarget,
        P1,
        choosingTarget.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [scenario.target.instanceId, scenario.target.instanceId]
      )
    ).toBe(choosingTarget);

    const done = confirmActiveEffectStep(
      choosingTarget,
      P1,
      choosingTarget.activeEffect!.id,
      scenario.secondTarget.instanceId
    );
    expect(
      done.players[0].memberSlots.cardStates.get(scenario.secondTarget.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(done.players[0].memberSlots.cardStates.get(scenario.target.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('refreshes a stale submitted target without advancing while another batch target remains', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-N',
      TurnType.LIVE_PHASE,
      GamePhase.PERFORMANCE_PHASE
    );
    const choosingDiscard = resolvePendingCardEffects(
      enqueueWaitingTransitions(scenario.game, [
        scenario.target.instanceId,
        scenario.secondTarget.instanceId,
      ])
    ).gameState;
    const choosingTarget = confirmActiveEffectStep(
      choosingDiscard,
      P1,
      choosingDiscard.activeEffect!.id,
      scenario.hand.instanceId
    );
    const stale = updatePlayer(choosingTarget, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.target.instanceId),
    }));
    const refreshed = confirmActiveEffectStep(
      stale,
      P1,
      stale.activeEffect!.id,
      scenario.target.instanceId
    );
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([
      scenario.secondTarget.instanceId,
    ]);
    expect(refreshed.activeEffect?.stepId).toBe(choosingTarget.activeEffect?.stepId);
    expect(refreshed.actionHistory).toHaveLength(stale.actionHistory.length);
  });

  it('keeps the paid discard and safely finishes when every target becomes stale after payment', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-N',
      TurnType.LIVE_PHASE,
      GamePhase.PERFORMANCE_PHASE
    );
    const choosingDiscard = resolvePendingCardEffects(
      enqueueWaitingTransitions(scenario.game, [
        scenario.target.instanceId,
        scenario.secondTarget.instanceId,
      ])
    ).gameState;
    const choosingTarget = confirmActiveEffectStep(
      choosingDiscard,
      P1,
      choosingDiscard.activeEffect!.id,
      scenario.hand.instanceId
    );
    const allStale = updatePlayer(choosingTarget, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.RIGHT
      ),
      waitingRoom: addCardToZone(
        addCardToZone(player.waitingRoom, scenario.target.instanceId),
        scenario.secondTarget.instanceId
      ),
    }));
    const done = confirmActiveEffectStep(
      allStale,
      P1,
      allStale.activeEffect!.id,
      scenario.target.instanceId
    );
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toContain(scenario.hand.instanceId);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'PAID_COST_TARGETS_NO_LONGER_AVAILABLE',
      targetMemberCardId: null,
      changedCardIds: [scenario.target.instanceId, scenario.secondTarget.instanceId],
    });
  });

  it('pays discard through the event wrapper, records turn1 only on success, then activates', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-R',
      TurnType.SECOND_PLAYER_TURN,
      GamePhase.PERFORMANCE_PHASE
    );
    const choosing = resolvePendingCardEffects(
      enqueueWaitingTransition(scenario.game, scenario.target.instanceId)
    ).gameState;
    expect(choosing.activeEffect?.effectText).toBe(
      findCardAbilityDefinitionById(scenario.abilityId)?.effectText
    );
    const done = confirmActiveEffectStep(
      choosing,
      P1,
      choosing.activeEffect!.id,
      scenario.hand.instanceId
    );
    expect(done.players[0].hand.cardIds).not.toContain(scenario.hand.instanceId);
    expect(done.players[0].waitingRoom.cardIds).toContain(scenario.hand.instanceId);
    expect(
      done.players[0].memberSlots.cardStates.get(scenario.target.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      done.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.target.instanceId
      )
    ).toHaveLength(2);
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId === scenario.abilityId && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });

  it('with no hand, resolves without a window or turn1 use', () => {
    const scenario = setup(
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
      'PL!N-sd2-010-SD2',
      TurnType.FIRST_PLAYER_TURN,
      GamePhase.MAIN_PHASE
    );
    const noHand = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const done = resolvePendingCardEffects(
      enqueueWaitingTransition(noHand, scenario.target.instanceId)
    ).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toHaveLength(0);
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId === scenario.abilityId && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(0);
    expect(done.actionHistory.at(-1)?.payload.step).toBe('NO_HAND_TO_DISCARD');
  });

  it('N-sd2-010 AUTO keeps paid cost when the exact target is stale and never substitutes', () => {
    const scenario = setup(
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
      'PL!N-sd2-010-TEST',
      TurnType.FIRST_PLAYER_TURN
    );
    const choosing = resolvePendingCardEffects(
      enqueueWaitingTransition(scenario.game, scenario.target.instanceId)
    ).gameState;
    const stale = updatePlayer(choosing, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.target.instanceId),
    }));
    const done = confirmActiveEffectStep(
      stale,
      P1,
      stale.activeEffect!.id,
      scenario.hand.instanceId
    );
    expect(done.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([scenario.target.instanceId, scenario.hand.instanceId])
    );
    expect(
      done.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' && modifier.targetMemberCardId === scenario.target.instanceId
      )
    ).toHaveLength(0);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      targetMemberCardId: null,
      changedCardIds: [scenario.target.instanceId],
      targetStillOnStage: false,
      bladeBonus: 0,
    });
  });

  it('N-sd2-010 AUTO gives the exact target BLADE +2 after successful payment', () => {
    const scenario = setup(
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
      'PL!N-sd2-010-SD2',
      TurnType.FIRST_PLAYER_TURN
    );
    const choosing = resolvePendingCardEffects(
      enqueueWaitingTransition(scenario.game, scenario.target.instanceId)
    ).gameState;
    expect(choosing.activeEffect?.effectText).toBe(
      findCardAbilityDefinitionById(scenario.abilityId)?.effectText
    );
    const done = confirmActiveEffectStep(
      choosing,
      P1,
      choosing.activeEffect!.id,
      scenario.hand.instanceId
    );
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        targetMemberCardId: scenario.target.instanceId,
        countDelta: 2,
        abilityId: scenario.abilityId,
      })
    );
  });

  it('N-sd2-010 can choose a non-first simultaneous target and gives only it BLADE +2', () => {
    const scenario = setup(
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
      'PL!N-sd2-010-SD2',
      TurnType.FIRST_PLAYER_TURN
    );
    const choosingDiscard = resolvePendingCardEffects(
      enqueueWaitingTransitions(scenario.game, [
        scenario.target.instanceId,
        scenario.secondTarget.instanceId,
      ])
    ).gameState;
    const choosingTarget = confirmActiveEffectStep(
      choosingDiscard,
      P1,
      choosingDiscard.activeEffect!.id,
      scenario.hand.instanceId
    );
    const done = confirmActiveEffectStep(
      choosingTarget,
      P1,
      choosingTarget.activeEffect!.id,
      scenario.secondTarget.instanceId
    );
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        targetMemberCardId: scenario.secondTarget.instanceId,
        countDelta: 2,
        abilityId: scenario.abilityId,
      })
    );
    expect(
      done.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.targetMemberCardId === scenario.target.instanceId
      )
    ).toHaveLength(0);
  });

  it('keeps two source abilities independent and removes an activated target from the later choice', () => {
    const livePhaseSource = member('PL!N-bp7-022-N', 'live-phase-shioriko');
    const bladeSource = member('PL!N-sd2-010-SD2', 'blade-shioriko');
    const target = member('TARGET-NIJIGASAKI', 'shared-target');
    const firstHand = member('HAND-ONE', 'hand-one');
    const secondHand = member('HAND-TWO', 'hand-two');
    let game = registerCards(createGameState('two-waited-sources', P1, 'P1', P2, 'P2'), [
      livePhaseSource,
      bladeSource,
      target,
      firstHand,
      secondHand,
    ]);
    game = putMembersAndEnergyDeck(game, {
      [SlotPosition.LEFT]: livePhaseSource.instanceId,
      [SlotPosition.CENTER]: bladeSource.instanceId,
      [SlotPosition.RIGHT]: target.instanceId,
    });
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToZone(addCardToZone(player.hand, firstHand.instanceId), secondHand.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentTurnType: TurnType.LIVE_PHASE,
    };
    const triggered = enqueueWaitingTransitions(game, [
      livePhaseSource.instanceId,
      bladeSource.instanceId,
      target.instanceId,
    ]);
    expect(triggered.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
    ]);

    const orderChoice = resolvePendingCardEffects(triggered).gameState;
    const firstDiscard = confirmActiveEffectStep(
      orderChoice,
      P1,
      orderChoice.activeEffect!.id,
      livePhaseSource.instanceId
    );
    const firstTargetChoice = confirmActiveEffectStep(
      firstDiscard,
      P1,
      firstDiscard.activeEffect!.id,
      firstHand.instanceId
    );
    const secondDiscard = confirmActiveEffectStep(
      firstTargetChoice,
      P1,
      firstTargetChoice.activeEffect!.id,
      target.instanceId
    );
    expect(secondDiscard.activeEffect?.abilityId).toBe(
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID
    );
    const secondTargetChoice = confirmActiveEffectStep(
      secondDiscard,
      P1,
      secondDiscard.activeEffect!.id,
      secondHand.instanceId
    );
    expect(secondTargetChoice.activeEffect?.selectableCardIds).not.toContain(target.instanceId);
    expect(secondTargetChoice.activeEffect?.selectableCardIds).toEqual([
      livePhaseSource.instanceId,
      bladeSource.instanceId,
    ]);
  });
});

describe('shared own-card-effect energy placement listeners and skipped waiting energy', () => {
  it('PL!SP-bp7-016 ignores an opponent-caused placement into the controller energy zone', () => {
    const source = member('PL!SP-bp7-016-N', 'ren-listener', ['Liella!']);
    const placedEnergy = energy('opponent-caused-energy');
    let game = registerCards(createGameState('sp016-opponent-cause', P1, 'P1', P2, 'P2'), [
      source,
      placedEnergy,
    ]);
    game = putMembersAndEnergyDeck(game, { [SlotPosition.CENTER]: source.instanceId }, [
      placedEnergy.instanceId,
    ]);
    const placement = placeEnergyFromDeckToZoneByCardEffect(game, P1, 1, OrientationState.WAITING, {
      kind: 'CARD_EFFECT',
      playerId: P2,
      sourceCardId: 'opponent-source',
    })!;
    const afterTriggerCheck = enqueueTriggeredCardEffects(placement.gameState, [
      TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    ]);
    expect(afterTriggerCheck.pendingAbilities).toHaveLength(0);
    expect(afterTriggerCheck.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('PL!SP-bp7-016 gains source BLADE +1 only from an own card-effect placement and only once', () => {
    const source = member('PL!SP-bp7-016-TEST', 'ren-listener', ['Liella!']);
    const firstEnergy = energy('energy-1');
    const secondEnergy = energy('energy-2');
    let game = registerCards(createGameState('sp016', P1, 'P1', P2, 'P2'), [
      source,
      firstEnergy,
      secondEnergy,
    ]);
    game = putMembersAndEnergyDeck(game, { [SlotPosition.CENTER]: source.instanceId }, [
      firstEnergy.instanceId,
      secondEnergy.instanceId,
    ]);

    const firstPlacement = placeEnergyFromDeckToZoneByCardEffect(
      game,
      P1,
      1,
      OrientationState.WAITING,
      { kind: 'CARD_EFFECT', playerId: P1, sourceCardId: 'external', abilityId: 'external' }
    )!;
    game = enqueueTriggeredCardEffects(firstPlacement.gameState, [
      TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    ]);
    expect(game.pendingAbilities.map((ability) => ability.abilityId)).toContain(
      SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID
    );
    game = resolvePendingCardEffects(game).gameState;
    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        sourceCardId: source.instanceId,
        countDelta: 1,
      })
    );

    const secondPlacement = placeEnergyFromDeckToZoneByCardEffect(
      game,
      P1,
      1,
      OrientationState.WAITING,
      { kind: 'CARD_EFFECT', playerId: P1, sourceCardId: 'external-2', abilityId: 'external-2' }
    )!;
    const afterSecond = enqueueTriggeredCardEffects(secondPlacement.gameState, [
      TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    ]);
    expect(
      afterSecond.pendingAbilities.filter(
        (ability) =>
          ability.abilityId === SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID
      )
    ).toHaveLength(0);
  });

  it('PL!SP-bp7-017 places exactly one WAITING energy, marks its next Active Phase skip, and chains SP016', () => {
    const source = member('PL!SP-bp7-017-N', 'kinako', ['Liella!']);
    const listener = member('PL!SP-bp7-016-N', 'ren-listener', ['Liella!']);
    const topEnergy = energy('energy-top');
    let game = registerCards(createGameState('sp017', P1, 'P1', P2, 'P2'), [
      source,
      listener,
      topEnergy,
    ]);
    game = putMembersAndEnergyDeck(
      game,
      { [SlotPosition.CENTER]: source.instanceId, [SlotPosition.LEFT]: listener.instanceId },
      [topEnergy.instanceId]
    );
    game = {
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
          source.instanceId,
          'sp017'
        ),
      ],
    };

    const done = resolvePendingCardEffects(game).gameState;
    expect(done.players[0].energyZone.cardIds).toEqual([topEnergy.instanceId]);
    expect(done.players[0].energyZone.cardStates.get(topEnergy.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.energyActivePhaseSkips).toContainEqual({
      playerId: P1,
      energyCardId: topEnergy.instanceId,
      sourceCardId: source.instanceId,
      abilityId: SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
    });
    expect(
      done.eventLog.find(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )?.event
    ).toMatchObject({
      targetPlayerId: P1,
      placedEnergyCardIds: [topEnergy.instanceId],
      orientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: source.instanceId,
        abilityId: SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
      },
    });
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: listener.instanceId,
        abilityId: SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
      })
    );
  });

  it('PL!SP-bp7-017 empty energy deck is a clean no-op with no event or skip marker', () => {
    const source = member('PL!SP-bp7-017-TEST', 'kinako', ['Liella!']);
    let game = registerCards(createGameState('sp017-empty', P1, 'P1', P2, 'P2'), [source]);
    game = putMembersAndEnergyDeck(game, { [SlotPosition.CENTER]: source.instanceId });
    const done = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
          source.instanceId,
          'sp017-empty'
        ),
      ],
    }).gameState;
    expect(done.energyActivePhaseSkips).toEqual([]);
    expect(
      done.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toHaveLength(0);
    expect(done.pendingAbilities).toHaveLength(0);
  });
});
