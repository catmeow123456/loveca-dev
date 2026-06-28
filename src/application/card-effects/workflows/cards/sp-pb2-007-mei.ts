import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID } from '../../ability-ids.js';

const PAY_ENERGY_STEP_ID = 'SP_PB2_007_PAY_THREE_ENERGY';
const SELECT_LIELLA_LIVE_STEP_ID = 'SP_PB2_007_SELECT_LIELLA_LIVE';
const ENERGY_COST = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2007MeiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2007MeiLiveSuccess(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayEnergy(game, context.continuePendingCardEffects)
        : finishPendingEffect(
            game,
            context.continuePendingCardEffects,
            { step: 'DECLINE_PAY_THREE_ENERGY', paidEnergyCardIds: [], selectedCardIds: [] }
          )
  );
  registerActiveEffectStepHandler(
    SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID,
    SELECT_LIELLA_LIVE_STEP_ID,
    (game, input, context) =>
      finishRecoverLiellaLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpPb2007MeiLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const selectableCardIds = getLiellaLiveWaitingRoomCardIds(game, player.id);
  if (activeEnergyCardIds.length < ENERGY_COST || selectableCardIds.length === 0) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return finishPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      {
        step: 'NO_OP_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE',
        reason: activeEnergyCardIds.length < ENERGY_COST ? 'INSUFFICIENT_ACTIVE_ENERGY' : 'NO_TARGET',
        activeEnergyCardIds,
        selectableCardIds,
      },
      continuePendingCardEffects
    );
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
      stepId: PAY_ENERGY_STEP_ID,
      stepText: '可以支付3张活跃能量，从自己的休息室将1张『Liella!』LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'pay', label: '支付3能量' },
        { id: 'decline', label: '不发动' },
      ],
      metadata: {
        orderedResolution: options.orderedResolution === true,
        activeEnergyCardIds,
        selectableCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_THREE_ENERGY_OPTION',
      activeEnergyCardIds,
      selectableCardIds,
    },
  });
}

function finishPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.stepId !== PAY_ENERGY_STEP_ID || !player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const selectableCardIds = getLiellaLiveWaitingRoomCardIds(stateAfterCost, player.id);
  if (selectableCardIds.length === 0) {
    return finishPendingEffect(
      { ...stateAfterCost, activeEffect: effect },
      continuePendingCardEffects,
      {
        step: 'PAY_THREE_ENERGY_NO_TARGET',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        selectedCardIds: [],
      }
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_LIELLA_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张『Liella!』LIVE卡加入手牌。',
        selectableOptions: undefined,
        selectableCardIds,
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要加入手牌的LIVE卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
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
      step: 'PAY_THREE_ENERGY_SELECT_LIELLA_LIVE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
    }
  );
}

function finishRecoverLiellaLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.stepId !== SELECT_LIELLA_LIVE_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds,
    exactCount: 1,
  });
  if (!recoveryResult) {
    return game;
  }

  return finishPendingEffect(
    {
      ...recoveryResult.gameState,
      activeEffect: effect,
    },
    continuePendingCardEffects,
    {
      step: 'RECOVER_LIELLA_LIVE',
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }
  );
}

function finishPendingEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
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

function getLiellaLiveWaitingRoomCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(
    game,
    playerId,
    and(typeIs(CardType.LIVE), groupAliasIs('Liella!'))
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
