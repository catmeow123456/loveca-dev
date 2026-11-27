import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  EnergySelectionRequiredError,
  getEnergySelectionCandidates,
} from '../../../effects/energy-selection.js';
import { hasWaitingRoomSelectionReenteredAfter } from '../../../effects/waiting-room-selection-lifecycle.js';
import { S_PB2_002_ACTIVATED_BOTTOM_AQOURS_LIVES_ACTIVATE_ENERGY_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { createActiveEffectEnergySelectionWindow } from '../../runtime/energy-operation-selection.js';
import {
  payPrivateOrderedWaitingRoomBottomCost,
  PRIVATE_ORDERED_WAITING_ROOM_BOTTOM_CONFIRMATION,
} from '../../runtime/private-ordered-waiting-room-bottom-cost.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const COST_STEP = 'S_PB2_002_BOTTOM_AQOURS_LIVES';
const ENERGY_STEP = 'S_PB2_002_ACTIVATE_ENERGY';
const MAX_COST = 2;
const isAqours = groupAliasIs('Aqours');
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSPb2002RikoWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY, startCost, sourceIsOnStage);
  registerActiveEffectStepHandler(
    ABILITY,
    COST_STEP,
    (game, input, context) =>
      payCost(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : null),
        context.continuePendingCardEffects
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(ABILITY, ENERGY_STEP, (game, _input, context) => {
    const effect = getCardActiveEffect(game);
    return effect?.stepId === ENERGY_STEP
      ? activateEnergy(game, effect, context.continuePendingCardEffects)
      : game;
  });
}

function sourceIsOnStage(game: GameState, controllerId: string, sourceCardId: string): boolean {
  const card = getCardById(game, sourceCardId);
  return (
    card?.ownerId === controllerId &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!S-pb2-002') &&
    isCurrentStageMemberAbilitySource(game, { controllerId, sourceCardId })
  );
}

function getEligibleLives(game: GameState, playerId: string): readonly string[] {
  return (
    getPlayerById(game, playerId)?.waitingRoom.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card?.ownerId === playerId && isLiveCardData(card.data) && isAqours(card);
    }) ?? []
  );
}

function startCost(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (game.activeEffect || !sourceIsOnStage(game, playerId, sourceCardId)) return game;
  const cards = getEligibleLives(game, playerId);
  const id = `${ABILITY}:${sourceCardId}:${game.actionSequence + 1}`;
  const state: GameState = {
    ...game,
    activeEffect: {
      id,
      abilityId: ABILITY,
      sourceCardId,
      sourceLifecycleId: getAbilitySourceLifecycleId(game, ABILITY, sourceCardId),
      controllerId: playerId,
      awaitingPlayerId: playerId,
      effectText: getAbilityEffectText(ABILITY),
      stepId: COST_STEP,
      stepText: '按放置顺序选择至多2张『Aqours』LIVE卡。可以选择0张发动。',
      selectableCardIds: cards,
      selectableCardMode: 'ORDERED_MULTI',
      selectableCardVisibility: 'PUBLIC',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(MAX_COST, cards.length),
      selectionLabel: '按放置顺序选择要支付的LIVE卡',
      confirmSelectionLabel: '支付费用并发动',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: PRIVATE_ORDERED_WAITING_ROOM_BOTTOM_CONFIRMATION,
        waitingSelectionSequence: game.eventLog.at(-1)?.sequence ?? 0,
      },
    },
  };
  return addAction(state, 'RESOLVE_ABILITY', playerId, {
    abilityId: ABILITY,
    sourceCardId,
    pendingAbilityId: id,
    step: 'START_AQOURS_LIVE_BOTTOM_COST',
  });
}

function payCost(
  game: GameState,
  selectedCardIds: readonly string[] | null,
  continuation: Continue
): GameState {
  const effect = getCardActiveEffect(game);
  if (effect?.abilityId !== ABILITY || effect.stepId !== COST_STEP) return game;
  if (selectedCardIds === null) return finish(game, effect, continuation, 'DECLINE_ACTIVATION');
  if (
    !sourceIsOnStage(game, effect.controllerId, effect.sourceCardId) ||
    !isCurrentStageMemberAbilitySource(game, effect) ||
    !canUseAbilityThisTurn(
      { ...game, activeEffect: null },
      effect.controllerId,
      ABILITY,
      effect.sourceCardId,
      undefined,
      effect.sourceLifecycleId
    )
  ) {
    return finish(game, effect, continuation, 'ACTIVATION_SOURCE_UNAVAILABLE');
  }
  const current = new Set(getEligibleLives(game, effect.controllerId));
  if (
    selectedCardIds.some((id) => !current.has(id)) ||
    hasWaitingRoomSelectionReenteredAfter(
      game,
      selectedCardIds,
      effect.metadata?.waitingSelectionSequence
    )
  ) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finish(game, effect, continuation, 'STALE_AQOURS_LIVE_BOTTOM_COST')
      : game;
  }
  const cost = payPrivateOrderedWaitingRoomBottomCost(game, effect, selectedCardIds, {
    candidateCardIds: effect.selectableCardIds ?? [],
    minCount: 0,
    maxCount: MAX_COST,
  });
  if (!cost) return game;
  const paid = recordAbilityUseForContext(cost.gameState, effect.controllerId, {
    abilityId: ABILITY,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    pendingAbilityId: effect.id,
  });
  const reward: ActiveEffectState = {
    id: effect.id,
    abilityId: ABILITY,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    controllerId: effect.controllerId,
    awaitingPlayerId: effect.controllerId,
    effectText: effect.effectText,
    stepId: ENERGY_STEP,
    stepText: '将能量变为活跃状态。',
    metadata: { movedCount: cost.movedCardIds.length },
  };
  try {
    return activateEnergy(paid, reward, continuation);
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createActiveEffectEnergySelectionWindow(paid, reward, {}, error);
  }
}

function activateEnergy(game: GameState, effect: ActiveEffectState, continuation: Continue) {
  const movedCount = Number(effect.metadata?.movedCount ?? 0);
  const waiting = getEnergySelectionCandidates(
    game,
    effect.controllerId,
    'ACTIVATE_WAITING_ENERGY'
  );
  const result = activateWaitingEnergyCardsForPlayer(
    game,
    effect.controllerId,
    Math.min(movedCount, waiting.length)
  );
  return finish(
    result?.gameState ?? game,
    effect,
    continuation,
    'ACTIVATE_ENERGY_AFTER_BOTTOM_COST',
    {
      movedCount,
      activatedEnergyCardIds: result?.activatedEnergyCardIds ?? [],
    }
  );
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  continuation: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuation(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      abilityId: ABILITY,
      pendingAbilityId: effect.id,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    false
  );
}
