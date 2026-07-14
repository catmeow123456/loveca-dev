import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
  SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const LIVE_START_DECISION_STEP_ID = 'SP_PB1_001_LIVE_START_DECISION';
const LIVE_START_SELECT_DISCARD_STEP_ID = 'SP_PB1_001_LIVE_START_SELECT_DISCARD';
const LIVE_SUCCESS_PAY_STEP_ID = 'SP_PB1_001_LIVE_SUCCESS_PAY_SIX';

const PAY_OPTION_ID = 'pay';
const DISCARD_OPTION_ID = 'discard';
const DECLINE_OPTION_ID = 'decline';
const LIVE_START_ENERGY_COST = 2;
const LIVE_START_DISCARD_COUNT = 2;
const LIVE_SUCCESS_ENERGY_COST = 6;
const SCORE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb1001KanonWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb1001LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
    LIVE_START_DECISION_STEP_ID,
    (game, input, context) =>
      finishSpPb1001LiveStartDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
    LIVE_START_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishSpPb1001LiveStartDiscard(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb1001LiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
    LIVE_SUCCESS_PAY_STEP_ID,
    (game, input, context) =>
      finishSpPb1001LiveSuccessPayDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpPb1001LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (activeEnergyCardIds.length < LIVE_START_ENERGY_COST) {
    return startOrFinishForcedDiscard(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      'NO_ACTIVE_ENERGY_FORCE_DISCARD'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_START_DECISION_STEP_ID,
      stepText: '可以支付[E][E]。若不支付，则将自己的2张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: PAY_OPTION_ID, label: '支付[E][E]' },
        { id: DISCARD_OPTION_ID, label: '不支付，放置手牌' },
      ],
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_OR_DISCARD_DECISION',
      activeEnergyCardIds,
    },
  });
}

function finishSpPb1001LiveStartDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getSpPb1001Effect(
    game,
    SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
    LIVE_START_DECISION_STEP_ID
  );
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || !selectedOptionId) {
    return game;
  }

  if (selectedOptionId === PAY_OPTION_ID) {
    const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
      { kind: 'TAP_ACTIVE_ENERGY', count: LIVE_START_ENERGY_COST },
    ]);
    if (!costPayment) {
      return game;
    }
    const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
    });
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_TWO_ENERGY_NO_DISCARD',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (selectedOptionId === DISCARD_OPTION_ID) {
    return startOrFinishForcedDiscardFromEffect(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      'DECLINED_PAY_FORCE_DISCARD'
    );
  }

  return game;
}

function startOrFinishForcedDiscard(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  reason: string
): GameState {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return game;
  }
  const discardCount = Math.min(LIVE_START_DISCARD_COUNT, player.hand.cardIds.length);
  if (discardCount === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'FORCE_DISCARD_NO_HAND',
      { reason, discardedHandCardIds: [] }
    );
  }
  if (discardCount === player.hand.cardIds.length) {
    const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      game,
      player.id,
      player.hand.cardIds,
      {
        count: discardCount,
        candidateCardIds: player.hand.cardIds,
      },
      enqueueTriggeredCardEffects
    );
    if (!discardResult) {
      return game;
    }
    return finishPendingNoOp(
      discardResult.gameState,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'FORCE_DISCARD_ALL_AVAILABLE_HAND',
      { reason, discardedHandCardIds: discardResult.discardedCardIds }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_START_SELECT_DISCARD_STEP_ID,
      stepText: '请选择要放置入休息室的2张手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: discardCount,
      maxSelectableCards: discardCount,
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        forcedDiscardReason: reason,
        discardCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_FORCE_DISCARD_SELECTION',
      reason,
      selectableCardIds: player.hand.cardIds,
      discardCount,
    },
  });
}

function startOrFinishForcedDiscardFromEffect(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  reason: string
): GameState {
  const ability = effectToPendingAbility(effect);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const stateWithoutDecision = { ...game, activeEffect: null };
  return startOrFinishForcedDiscard(
    stateWithoutDecision,
    ability,
    playerId,
    orderedResolution,
    continuePendingCardEffects,
    enqueueTriggeredCardEffects,
    reason
  );
}

function finishSpPb1001LiveStartDiscard(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getSpPb1001Effect(
    game,
    SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
    LIVE_START_SELECT_DISCARD_STEP_ID
  );
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const discardCount = getNumberMetadata(effect, 'discardCount');
  if (!effect || !player || discardCount <= 0) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== discardCount ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: discardCount,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FORCE_DISCARD_SELECTED_HAND',
      reason: effect.metadata?.forcedDiscardReason,
      discardedHandCardIds: discardResult.discardedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startSpPb1001LiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (activeEnergyCardIds.length < LIVE_SUCCESS_ENERGY_COST) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_OP_NOT_ENOUGH_ACTIVE_ENERGY',
      { activeEnergyCardIds, requiredEnergy: LIVE_SUCCESS_ENERGY_COST }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_SUCCESS_PAY_STEP_ID,
      stepText: '可以支付[E][E][E][E][E][E]。如此做时，LIVE合计分数+1。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: PAY_OPTION_ID, label: '支付[E][E][E][E][E][E]' },
        { id: DECLINE_OPTION_ID, label: '不支付' },
      ],
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_SIX_ENERGY_OPTION',
      activeEnergyCardIds,
    },
  });
}

function finishSpPb1001LiveSuccessPayDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getSpPb1001Effect(
    game,
    SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
    LIVE_SUCCESS_PAY_STEP_ID
  );
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || !selectedOptionId) {
    return game;
  }

  if (selectedOptionId === DECLINE_OPTION_ID) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_PAY_SIX_ENERGY_SCORE',
        scoreBonus: 0,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (selectedOptionId !== PAY_OPTION_ID) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: LIVE_SUCCESS_ENERGY_COST },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
  });
  const stateAfterScore = addScoreModifierAndRefresh(
    { ...stateAfterCost, activeEffect: null },
    player.id,
    effect.sourceCardId,
    effect.abilityId,
    SCORE_BONUS
  );

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_SIX_ENERGY_SCORE_PLUS_ONE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      scoreBonus: SCORE_BONUS,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function addScoreModifierAndRefresh(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string,
  scoreBonus: number
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId,
    countDelta: scoreBonus,
    sourceCardId,
    abilityId,
  };
  const stateAfterModifier = addLiveModifier(game, modifier);
  const playerScores = new Map(stateAfterModifier.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...stateAfterModifier,
    liveResolution: {
      ...stateAfterModifier.liveResolution,
      playerScores,
    },
  };
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
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
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getSpPb1001Effect(
  game: GameState,
  abilityId: string,
  stepId: string
): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === abilityId && effect.stepId === stepId ? effect : null;
}

function getActiveEnergyCardIds(
  player: NonNullable<ReturnType<typeof getPlayerById>>
): readonly string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getNumberMetadata(effect: ActiveEffectState | null, key: string): number {
  const value = effect?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function effectToPendingAbility(effect: ActiveEffectState): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
    sourceSlot: effect.metadata?.sourceSlot as PendingAbilityState['sourceSlot'],
  };
}
