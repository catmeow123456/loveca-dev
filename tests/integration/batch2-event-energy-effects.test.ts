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

describe('shared own Nijigasaki member waited -> optional discard -> exact reactivation', () => {
  function setup(abilityId: string, sourceCode: string, turnType: TurnType) {
    const source = member(sourceCode, 'shioriko');
    const target = member('TARGET-NIJIGASAKI', 'target');
    const hand = member('HAND-CARD', 'hand-card');
    let game = registerCards(createGameState('waited-family', P1, 'P1', P2, 'P2'), [
      source,
      target,
      hand,
    ]);
    game = putMembersAndEnergyDeck(game, {
      [SlotPosition.CENTER]: source.instanceId,
      [SlotPosition.LEFT]: target.instanceId,
    });
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, hand.instanceId),
    }));
    return {
      game: { ...game, currentTurnType: turnType },
      source,
      target,
      hand,
      abilityId,
    };
  }

  it('applies the LIVE gate, preserves exact event target, and skip does not consume turn1', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-N',
      TurnType.FIRST_PLAYER_TURN
    );
    const outsideLive = enqueueWaitingTransition(scenario.game, scenario.target.instanceId);
    expect(outsideLive.pendingAbilities).toHaveLength(0);

    const liveGame = { ...scenario.game, currentTurnType: TurnType.LIVE_PHASE };
    const triggered = enqueueWaitingTransition(liveGame, scenario.target.instanceId);
    expect(triggered.pendingAbilities).toHaveLength(1);
    expect(triggered.pendingAbilities[0]?.metadata?.changedCardId).toBe(scenario.target.instanceId);
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

  it('pays discard through the event wrapper, records turn1 only on success, then activates', () => {
    const scenario = setup(
      N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      'PL!N-bp7-022-R',
      TurnType.LIVE_PHASE
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
      TurnType.FIRST_PLAYER_TURN
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
      targetMemberCardId: scenario.target.instanceId,
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
