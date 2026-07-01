import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const CHOOSE_ENERGY_COUNT_STEP_ID = 'SP_BP5_025_CHOOSE_ENERGY_COUNT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5025TokonatsuSunshineWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startChooseEnergyCount(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID,
    CHOOSE_ENERGY_COUNT_STEP_ID,
    (game, input, context) =>
      finishChooseEnergyCount(
        game,
        input.selectedNumber,
        context.continuePendingCardEffects
      )
  );
}

function startChooseEnergyCount(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !sourceIsCurrentBp5025Live(game, player.id, ability.sourceCardId)) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_CURRENT_LIVE',
    });
  }

  const activeEnergyCount = getActiveEnergyCardIds(game, player.id).length;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_ENERGY_COUNT_STEP_ID,
      stepText: '选择要支付的 [E] 数量。',
      awaitingPlayerId: player.id,
      numericInput: {
        min: 0,
        max: activeEnergyCount,
        integerOnly: true,
        label: '选择要支付的 [E] 数量',
        placeholder: '0',
        confirmLabel: '支付并结算',
      },
      metadata: {
        orderedResolution,
        maxPayableEnergyCount: activeEnergyCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_ENERGY_COUNT',
      maxPayableEnergyCount: activeEnergyCount,
    },
  });
}

function finishChooseEnergyCount(
  game: GameState,
  selectedNumber: number | null | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID ||
    effect.stepId !== CHOOSE_ENERGY_COUNT_STEP_ID ||
    typeof selectedNumber !== 'number' ||
    !Number.isFinite(selectedNumber) ||
    !Number.isInteger(selectedNumber) ||
    selectedNumber < 0 ||
    (typeof effect.numericInput?.max === 'number' && selectedNumber > effect.numericInput.max)
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedNumber === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_ZERO_ENERGY',
        selectedEnergyCount: 0,
        paidEnergyCardIds: [],
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  if (!sourceIsCurrentBp5025Live(game, player.id, effect.sourceCardId)) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_CURRENT_LIVE_AFTER_CHOICE',
        selectedEnergyCount: selectedNumber,
        paidEnergyCardIds: [],
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: selectedNumber },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const scoreBonus = Math.floor(selectedNumber / 4);
  if (scoreBonus > 0) {
    state = refreshPlayerScoreDraft(
      addLiveModifier(state, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: scoreBonus,
        liveCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      }),
      player.id,
      scoreBonus
    );
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_THIS_LIVE_SCORE',
      selectedEnergyCount: selectedNumber,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      scoreBonus,
    }),
    orderedResolution
  );
}

function consumePendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      selectedEnergyCount: 0,
      paidEnergyCardIds: [],
      scoreBonus: 0,
      ...payload,
    }),
    orderedResolution
  );
}

function sourceIsCurrentBp5025Live(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!sourceCard &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-025') &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.energyZone.cardIds.filter(
    (energyCardId) =>
      player.energyZone.cardStates.get(energyCardId)?.orientation !== OrientationState.WAITING
  );
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}
