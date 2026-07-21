import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const AQOURS = 'Aqours';
const PAY_OR_DISCARD_STEP_ID = 'S_BP6_007_SELECT_COST';
const SELECT_DISCARD_STEP_ID = 'S_BP6_007_SELECT_DISCARD_TWO';
const SELECT_TARGETS_STEP_ID = 'S_BP6_007_SELECT_AQOURS_SCORE_TARGETS';
const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerSBp6007HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID,
    (game, ability, options) =>
      startHanamaruLiveStartWorkflow(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID,
    PAY_OR_DISCARD_STEP_ID,
    (game, input, context) => {
      if (input.selectedOptionId === 'pay-energy') {
        return finishPayEnergyCost(game, context.continuePendingCardEffects);
      }
      if (input.selectedOptionId === 'discard-hand') {
        return startDiscardCostSelection(game);
      }
      return finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
        step: 'DECLINE_LIVE_START_SCORE_GRANT',
      });
    }
  );
  registerActiveEffectStepHandler(
    S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDiscardCost(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID,
    SELECT_TARGETS_STEP_ID,
    (game, input, context) =>
      finishTargetSelection(game, input.selectedCardIds ?? [], context.continuePendingCardEffects)
  );
}

function startHanamaruLiveStartWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  const canPayEnergy = activeEnergyCardIds.length >= 2;
  const canDiscardHand = player.hand.cardIds.length >= 2;
  const selectableOptions = [
    ...(canPayEnergy ? [{ id: 'pay-energy', label: '支付[E][E]' }] : []),
    ...(canDiscardHand ? [{ id: 'discard-hand', label: '将2张手牌放置入休息室' }] : []),
  ];

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_OR_DISCARD_STEP_ID,
      stepText:
        selectableOptions.length > 0
          ? '可以支付[E][E]或将2张手牌放置入休息室来发动。'
          : '当前无法支付费用，可以不发动。',
      awaitingPlayerId: player.id,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: 'pay-energy',
            text: '支付[E][E]。',
            selectable: canPayEnergy,
          },
          {
            id: 'discard-hand',
            text: '将2张手牌放置入休息室。',
            selectable: canDiscardHand,
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_COST',
      sourceSlot: ability.sourceSlot,
      activeEnergyCardIds,
      canPayEnergy,
      canDiscardHand,
    },
  });
}

function startDiscardCostSelection(game: GameState): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || effect.stepId !== PAY_OR_DISCARD_STEP_ID) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '选择2张要作为费用放置入休息室的手牌。',
        effectChoice: undefined,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        selectableOptions: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_DISCARD_COST',
    }
  );
}

function finishPayEnergyCost(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || effect.stepId !== PAY_OR_DISCARD_STEP_ID) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
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

  return continueAfterCost(
    stateAfterCost,
    effect,
    continuePendingCardEffects,
    'PAY_ENERGY',
    {
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
    }
  );
}

function finishDiscardCost(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !effect ||
    !player ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return continueAfterCost(
    discardResult.gameState,
    effect,
    continuePendingCardEffects,
    'DISCARD_HAND',
    {
      discardedCardIds: discardResult.discardedCardIds,
    }
  );
}

function continueAfterCost(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  costKind: 'PAY_ENERGY' | 'DISCARD_HAND',
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const condition = getSuccessZoneCondition(game, player.id);
  if (!condition.met) {
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'CONDITION_NOT_MET_AFTER_COST',
        costKind,
        ...condition,
        ...payload,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const targetMemberCardIds = getOwnStageAqoursMemberCardIds(game, player.id);
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_TARGETS_STEP_ID,
        stepText: '选择至多2名自己的舞台上的『Aqours』成员。可以不选择。',
        effectChoice: undefined,
        selectableCardIds: targetMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, targetMemberCardIds.length),
        selectionLabel: '选择获得LIVE合计分数+1的成员',
        confirmSelectionLabel: '赋予效果',
        selectableOptions: undefined,
        canSkipSelection: true,
        skipSelectionLabel: '不选择',
        metadata: {
          ...effect.metadata,
          costKind,
          ...payload,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_AQOURS_TARGETS',
      costKind,
      targetMemberCardIds,
      ...condition,
      ...payload,
    }
  );
}

function finishTargetSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const maxCount = effect?.maxSelectableCards ?? 0;
  if (
    !effect ||
    !player ||
    effect.stepId !== SELECT_TARGETS_STEP_ID ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > maxCount ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        getOwnStageAqoursMemberCardIds(game, player.id).includes(cardId)
    )
  ) {
    return game;
  }

  let state: GameState = { ...game, activeEffect: null };
  for (const targetMemberCardId of uniqueSelectedCardIds) {
    state = addScoreModifierAndRefresh(
      state,
      player.id,
      targetMemberCardId,
      effect.abilityId,
      1
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'GRANT_AQOURS_MEMBERS_SCORE',
      costKind: effect.metadata?.costKind,
      selectedMemberCardIds: uniqueSelectedCardIds,
      scoreBonus: uniqueSelectedCardIds.length,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getSuccessZoneCondition(
  game: GameState,
  playerId: string
): { readonly met: boolean; readonly ownSuccessCount: number; readonly opponentSuccessCount: number } {
  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const ownSuccessCount = player?.successZone.cardIds.length ?? 0;
  const opponentSuccessCount = opponent?.successZone.cardIds.length ?? 0;
  return {
    met: ownSuccessCount === 0 && opponentSuccessCount >= 2,
    ownSuccessCount,
    opponentSuccessCount,
  };
}

function getOwnStageAqoursMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId &&
      card &&
      card.ownerId === player.id &&
      isMemberCardData(card.data) &&
      groupAliasIs(AQOURS)(card)
      ? [cardId]
      : [];
  });
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
