import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type EnergyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { ENERGY_OPERATION_SELECTION_STEP_ID } from '../../src/application/card-effects/runtime/energy-operation-selection';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'tomari-source';
const ABILITY = SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID;
const EFFECT_TEXT =
  '【起动】【1回合1次】将存在于能量区的1张能量放置于能量卡组：将此成员站位变换。(将此成员移动至当前区域以外的区域。该区域存在成员的场合，将该成员移动至此成员曾存在的区域。)';

function member(cardCode: string, name: string, instanceId: string) {
  return createCardInstance<MemberCardData>(
    {
      cardCode,
      name,
      groupNames: ['Liella!'],
      unitName: '5yncri5e!',
      cardType: CardType.MEMBER,
      cost: cardCode.startsWith('PL!SP-bp7-022') ? 2 : 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
    },
    P1,
    instanceId
  );
}

function energy(instanceId: string) {
  return createCardInstance<EnergyCardData>(
    { cardCode: `ENERGY-${instanceId}`, name: instanceId, cardType: CardType.ENERGY },
    P1,
    instanceId
  );
}

function setup(
  orientations: readonly OrientationState[] = [OrientationState.ACTIVE],
  markedIndex?: number
) {
  const source = member('PL!SP-bp7-022-N', '鬼塚冬毬', SOURCE_ID);
  const other = member('TEST-OTHER', '若菜四季', 'other-member');
  const energyCards = orientations.map((_, index) => energy(`energy-${index}`));
  let game = registerCards(createGameState('sp-bp7-022', P1, 'P1', P2, 'P2'), [
    source,
    other,
    ...energyCards,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    energyZone: energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: orientations[index]!,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId),
      SlotPosition.CENTER,
      source.instanceId
    ),
  }));
  if (markedIndex !== undefined) {
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energyCards[markedIndex]!.instanceId,
          sourceCardId: 'skip-marker-source',
          abilityId: 'skip-marker-ability',
        },
      ],
    };
  }
  return { game, source, other, energyCards };
}

function activate(game: GameState): GameState {
  return activateCardAbility(game, P1, SOURCE_ID, ABILITY);
}

function eventEntries(game: GameState, trigger: TriggerCondition) {
  return game.eventLog.filter(({ event }) => event.eventType === trigger);
}

describe('PL!SP-bp7-022 费用2「鬼冢冬毬」返回能量后自身站位变换', () => {
  it('uses the complete activated UI text for every rarity of the base number', () => {
    const definition = findCardAbilityDefinitionById(ABILITY);
    expect(definition).toMatchObject({
      baseCardCodes: ['PL!SP-bp7-022'],
      implemented: true,
      perTurnLimit: 1,
      effectText: EFFECT_TEXT,
      activatedUi: {
        abilityId: ABILITY,
        text: EFFECT_TEXT,
      },
    });
  });

  it('returns the waiting energy first, then moves to an empty slot and emits both standard events', () => {
    const scenario = setup([OrientationState.ACTIVE, OrientationState.WAITING]);
    let state = activate(scenario.game);

    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: SOURCE_ID,
      effectText: EFFECT_TEXT,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
      selectionLabel: '选择移动区域',
      confirmSelectionLabel: '站位变换',
    });
    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCards[0]!.instanceId]);
    expect(state.players[0].energyDeck.cardIds).toEqual([scenario.energyCards[1]!.instanceId]);
    expect(eventEntries(state, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(1);
    expect(eventEntries(state, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)[0]!.event).toMatchObject({
      movedEnergyCardIds: [scenario.energyCards[1]!.instanceId],
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: SOURCE_ID,
        abilityId: ABILITY,
      },
    });

    state = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      undefined,
      SlotPosition.RIGHT
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(SOURCE_ID);
    expect(eventEntries(state, TriggerCondition.ON_MEMBER_SLOT_MOVED)).toHaveLength(1);
    expect(eventEntries(state, TriggerCondition.ON_MEMBER_SLOT_MOVED)[0]!.event).toMatchObject({
      cardInstanceId: SOURCE_ID,
      fromSlot: SlotPosition.CENTER,
      toSlot: SlotPosition.RIGHT,
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: SOURCE_ID,
        abilityId: ABILITY,
      },
    });
    expect(
      state.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
      )?.payload
    ).toMatchObject({
      energyCardIds: [scenario.energyCards[1]!.instanceId],
      returnedEnergyCardIds: [scenario.energyCards[1]!.instanceId],
      destinationZone: 'ENERGY_DECK',
    });
  });

  it('does not activate or consume the turn use without an energy card', () => {
    const scenario = setup([]);
    const state = activate(scenario.game);

    expect(state).toBe(scenario.game);
    expect(state.activeEffect).toBeNull();
    expect(
      state.actionHistory.some(
        (action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
    expect(eventEntries(state, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toEqual([]);
  });

  it('opens the common exact-energy selection for excess marked candidates and clears the returned marker', () => {
    const scenario = setup(
      [OrientationState.WAITING, OrientationState.ACTIVE, OrientationState.ACTIVE],
      1
    );
    let state = activate(scenario.game);

    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY,
      stepId: ENERGY_OPERATION_SELECTION_STEP_ID,
      stepText: '请选择要放回能量卡组的能量。',
      selectableCardIds: scenario.energyCards.map((card) => card.instanceId),
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放回能量卡组的能量',
      confirmSelectionLabel: '放回能量卡组',
      canSkipSelection: false,
    });
    expect(eventEntries(state, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toEqual([]);

    const unchanged = confirmActiveEffectStep(state, P1, state.activeEffect!.id, 'not-an-energy');
    expect(unchanged).toBe(state);

    state = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      scenario.energyCards[1]!.instanceId
    );
    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });
    expect(state.players[0].energyDeck.cardIds).toEqual([scenario.energyCards[1]!.instanceId]);
    expect(state.energyActivePhaseSkips).toEqual([]);
    expect(eventEntries(state, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(1);
  });

  it('rejects a stale selected energy without paying, using the ability, or advancing the window', () => {
    const scenario = setup([OrientationState.ACTIVE, OrientationState.ACTIVE], 1);
    let state = activate(scenario.game);
    const selectedEnergyCardId = scenario.energyCards[1]!.instanceId;
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((cardId) => cardId !== selectedEnergyCardId),
        cardStates: new Map(
          [...player.energyZone.cardStates].filter(([cardId]) => cardId !== selectedEnergyCardId)
        ),
      },
    }));

    const unchanged = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      selectedEnergyCardId
    );
    expect(unchanged).toBe(state);
    expect(unchanged.activeEffect?.stepId).toBe(ENERGY_OPERATION_SELECTION_STEP_ID);
    expect(eventEntries(unchanged, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toEqual([]);
    expect(
      unchanged.actionHistory.some(
        (action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('keeps the paid energy return when the source becomes stale before the move and continues cleanly', () => {
    const scenario = setup();
    let state = activate(scenario.game);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));

    state = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      undefined,
      SlotPosition.RIGHT
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(state.players[0].energyDeck.cardIds).toEqual([scenario.energyCards[0]!.instanceId]);
    expect(eventEntries(state, TriggerCondition.ON_MEMBER_SLOT_MOVED)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'POSITION_CHANGE_SOURCE_STALE_AFTER_COST'
      )
    ).toBe(true);
  });

  it('swaps with an occupied slot and rejects a second activation in the same turn', () => {
    const scenario = setup([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    let state = activate(scenario.game);
    state = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(SOURCE_ID);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.other.instanceId);
    expect(eventEntries(state, TriggerCondition.ON_MEMBER_SLOT_MOVED)).toHaveLength(2);
    const afterSecondAttempt = activate(state);
    expect(afterSecondAttempt).toBe(state);
    expect(afterSecondAttempt.players[0].energyZone.cardIds).toHaveLength(1);
  });
});
