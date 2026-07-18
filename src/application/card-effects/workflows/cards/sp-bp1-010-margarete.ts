import { isMemberCardData } from '../../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID } from '../../ability-ids.js';
import {
  doesCardAbilityDefinitionMatchCardCode,
  findCardAbilityDefinitionById,
} from '../../definitions/lookup.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const SELECT_DISCARD_COST_STEP_ID = 'SP_BP1_010_SELECT_DISCARD_COST';
const SELECT_LIELLA_CARD_STEP_ID = 'SP_BP1_010_SELECT_LIELLA_CARD_FROM_TOP_FIVE';
const REVEAL_LIELLA_CARD_STEP_ID = 'SP_BP1_010_REVEAL_SELECTED_LIELLA_CARD';

export function registerSpBp1010MargareteWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
    startSpBp1010MargareteActivated
  );
  registerActiveEffectStepHandler(
    SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
    SELECT_DISCARD_COST_STEP_ID,
    (game, input, context) =>
      input.selectedCardId || input.selectedCardIds?.length
        ? payCompositeCostAndInspect(
            game,
            input.selectedCardId ?? null,
            input.selectedCardIds,
            context.continuePendingCardEffects,
            deps
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_COMPOSITE_COST',
          })
  );
  registerActiveEffectStepHandler(
    SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
    SELECT_LIELLA_CARD_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );
  registerActiveEffectStepHandler(
    SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID,
    REVEAL_LIELLA_CARD_STEP_ID,
    (game, _input, context) =>
      finishRevealedLookTopSelectToHandWorkflow(game, {
        continuePendingCardEffects: context.continuePendingCardEffects,
        enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
      })
  );
}

function startSpBp1010MargareteActivated(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const definition = findCardAbilityDefinitionById(
    SP_BP1_010_ACTIVATED_PAY_TWO_ENERGY_DISCARD_LOOK_TOP_FIVE_LIELLA_ABILITY_ID
  );
  const activeEnergyCount =
    player?.energyZone.cardIds.filter(
      (energyCardId) =>
        player.energyZone.cardStates.get(energyCardId)?.orientation === OrientationState.ACTIVE
    ).length ?? 0;
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    player.hand.cardIds.length === 0 ||
    activeEnergyCount < 2 ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    findMemberSlot(player, cardId) === null ||
    !definition ||
    !doesCardAbilityDefinitionMatchCardCode(definition, sourceCard.data.cardCode)
  ) {
    return game;
  }

  return {
    ...game,
    activeEffect: {
      id: `${definition.abilityId}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
      abilityId: definition.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(definition.abilityId),
      stepId: SELECT_DISCARD_COST_STEP_ID,
      stepText: '支付[E][E]并将1张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    },
  };
}

function payCompositeCostAndInspect(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom }
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const submittedIds = selectedCardIds ?? (selectedCardId ? [selectedCardId] : []);
  const discardCardId = submittedIds[0] ?? null;
  const activeEnergyCount =
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
    ).length ?? 0;
  if (
    !effect ||
    effect.stepId !== SELECT_DISCARD_COST_STEP_ID ||
    !player ||
    submittedIds.length !== 1 ||
    new Set(submittedIds).size !== 1 ||
    !discardCardId ||
    effect.selectableCardIds?.includes(discardCardId) !== true ||
    !player.hand.cardIds.includes(discardCardId) ||
    activeEnergyCount < 2
  ) {
    return game;
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!payment) return game;
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    payment.gameState,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    deps.enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  let state = recordPayCostAction(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
    discardedCardId: discardCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  return startLookTopSelectToHandWorkflow(
    { ...state, activeEffect: null },
    effect,
    {
      effectText: effect.effectText,
      topCount: 5,
      selector: (card) => card.ownerId === player.id && groupAliasIs('Liella!')(card),
      countRule: { minCount: 0, maxCount: 1 },
      revealSelectedBeforeHand: true,
      selectStepId: SELECT_LIELLA_CARD_STEP_ID,
      revealStepId: REVEAL_LIELLA_CARD_STEP_ID,
      selectStepText: '请选择至多1张『Liella!』卡片公开并加入手牌。其余的卡片放置入休息室。',
      noTargetStepText: '没有可公开并加入手牌的『Liella!』卡片。确认后全部放置入休息室。',
      selectionLabel: '选择要公开并加入手牌的『Liella!』卡片',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '全部放置入休息室',
      revealStepText: '选择的卡片已公开。确认后加入手牌，其余的卡片放置入休息室。',
      startActionStep: 'START_LOOK_TOP_FIVE_LIELLA_CARD',
      revealActionStep: 'REVEAL_SELECTED_LIELLA_CARD',
      finishActionStep: 'TAKE_LIELLA_CARD_REST_TO_WAITING_ROOM',
    },
    {
      orderedResolution: false,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
    }
  );
}
