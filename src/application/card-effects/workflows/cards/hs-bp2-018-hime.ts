import { isAbilityActivationCostWaived } from '../../runtime/on-enter-ability-invocation.js';
import { createWaivedOnEnterCostContinuationState } from '../../runtime/waived-on-enter-cost.js';
import {
  addAction,
  addLiveSetLimitReduction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
} from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID } from '../../ability-ids.js';
import { placeWaitingRoomLiveCardInLiveZoneForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_TWO_ENERGY_STEP_ID = 'HS_BP2_018_PAY_TWO_ENERGY_FOR_WAITING_LIVE';
const SELECT_WAITING_LIVE_STEP_ID = 'HS_BP2_018_SELECT_WAITING_LIVE_TO_PLACE_FACE_UP';
const PAY_OPTION_ID = 'pay';
const ENERGY_COST = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2018HimeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp2018HimeOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
    PAY_TWO_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === PAY_OPTION_ID
        ? finishPayTwoEnergy(game, context.continuePendingCardEffects)
        : finishDecline(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
    SELECT_WAITING_LIVE_STEP_ID,
    (game, input, context) =>
      finishPlaceWaitingLive(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startHsBp2018HimeOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (isAbilityActivationCostWaived(ability))
    return finishPayTwoEnergy(
      createWaivedOnEnterCostContinuationState(
        game,
        ability,
        PAY_TWO_ENERGY_STEP_ID,
        orderedResolution
      ),
      continuePendingCardEffects
    );

  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  const selectableCardIds = selectWaitingRoomLiveCardIds(game, player.id);
  if (!isOwnMainPhase(game, player.id) || activeEnergyCardIds.length < ENERGY_COST) {
    return finishPendingAbility(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OP_PAY_TWO_ENERGY_PLACE_WAITING_LIVE',
      reason: !isOwnMainPhase(game, player.id)
        ? 'NOT_OWN_MAIN_PHASE'
        : 'INSUFFICIENT_ACTIVE_ENERGY',
      activeEnergyCardIds,
      selectableCardIds,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_TWO_ENERGY_STEP_ID,
      stepText: '可以支付[E][E]；如此做时，从自己的休息室将1张LIVE卡以正面朝上放置入LIVE卡区。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: PAY_OPTION_ID, label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        selectableCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_TWO_ENERGY_PLACE_WAITING_LIVE',
      activeEnergyCardIds,
      selectableCardIds,
    },
  });
}

function finishDecline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedActiveEffect(game, PAY_TWO_ENERGY_STEP_ID);
  if (!effect) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE_PAY_TWO_ENERGY_PLACE_WAITING_LIVE',
      paidEnergyCardIds: [],
      placedLiveCardIds: [],
      nextLiveSetLimitReduction: 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPayTwoEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedActiveEffect(game, PAY_TWO_ENERGY_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  const selectableCardIdsBeforePayment = selectWaitingRoomLiveCardIds(game, player.id);
  if (
    !isOwnMainPhase(game, player.id) ||
    (!isAbilityActivationCostWaived(effect) &&
      getActiveEnergyCardIds(game, player.id).length < ENERGY_COST)
  ) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_TWO_ENERGY_PRECONDITION_FAILED_NO_OP',
        paidEnergyCardIds: [],
        selectableCardIds: selectableCardIdsBeforePayment,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const costPayment = isAbilityActivationCostWaived(effect)
    ? { gameState: game, paidEnergyCardIds: [] }
    : payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
        { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
      ]);
  if (
    !costPayment ||
    (!isAbilityActivationCostWaived(effect) && costPayment.paidEnergyCardIds.length !== ENERGY_COST)
  ) {
    return game;
  }

  const stateAfterCost = isAbilityActivationCostWaived(effect)
    ? game
    : recordPayCostAction(costPayment.gameState, player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        energyCardIds: costPayment.paidEnergyCardIds,
        amount: ENERGY_COST,
      });
  const selectableCardIds = selectWaitingRoomLiveCardIds(stateAfterCost, player.id);
  if (selectableCardIds.length === 0) {
    return finishLiveSetLimitReduction(
      stateAfterCost,
      {
        ...effect,
        metadata: { ...effect.metadata, paidEnergyCardIds: costPayment.paidEnergyCardIds },
      },
      continuePendingCardEffects
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_WAITING_LIVE_STEP_ID,
        stepText: '请选择自己休息室中的1张LIVE卡，以正面朝上放置入LIVE卡区。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择要正面放置的LIVE卡',
        confirmSelectionLabel: '正面放置',
        canSkipSelection: false,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          selectableCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAID_TWO_ENERGY_SELECT_WAITING_LIVE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
    }
  );
}

function finishPlaceWaitingLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedActiveEffect(game, SELECT_WAITING_LIVE_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) return game;
  const selectableCardIds = selectWaitingRoomLiveCardIds(game, player.id);
  if (selectableCardIds.length === 0)
    return finishLiveSetLimitReduction(game, effect, continuePendingCardEffects);
  if (!selectedCardId || !selectableCardIds.includes(selectedCardId)) {
    return { ...game, activeEffect: { ...effect, selectableCardIds } };
  }

  const placeResult = placeWaitingRoomLiveCardInLiveZoneForPlayer(game, player.id, selectedCardId, {
    candidateCardIds: selectableCardIds,
    face: FaceState.FACE_UP,
  });
  if (!placeResult) {
    return game;
  }

  return finishLiveSetLimitReduction(
    placeResult.gameState,
    effect,
    continuePendingCardEffects,
    placeResult
  );
}

function finishLiveSetLimitReduction(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  placed?: NonNullable<ReturnType<typeof placeWaitingRoomLiveCardInLiveZoneForPlayer>>
): GameState {
  const state = addLiveSetLimitReduction(game, {
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 1,
    expiresAt: 'NEXT_LIVE_SET_PHASE',
  });
  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_WAITING_LIVE_FACE_UP_AND_REDUCE_NEXT_LIVE_SET_LIMIT',
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
      selectedCardId: placed?.movedCardId,
      selectedCardIds: placed ? [placed.movedCardId] : [],
      enterLiveZoneEventId: placed?.enterLiveZoneEvent.eventId,
      nextLiveSetLimitReduction: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getExpectedActiveEffect(
  game: GameState,
  stepId: string
): GameState['activeEffect'] | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID ||
    effect.stepId !== stepId
  ) {
    return null;
  }
  return effect;
}

function selectWaitingRoomLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE));
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  return getEnergyCardIdsByOrientation(game, playerId, OrientationState.ACTIVE);
}

function isOwnMainPhase(game: GameState, playerId: string): boolean {
  return (
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId
  );
}
