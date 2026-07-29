import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { HANAYO_ACTIVATED_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';

export function registerSd1008HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    HANAYO_ACTIVATED_ABILITY_ID,
    (game, playerId, cardId) =>
      startHanayoActivatedEffect(game, playerId, cardId, deps.enqueueTriggeredCardEffects),
    { preflight: canStartHanayoActivatedEffect }
  );
}

function startHanayoActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (!canStartHanayoActivatedEffect(game, playerId, cardId)) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  if (!player) return game;

  const stateWithAbilityUse = recordAbilityUseForContext(game, player.id, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
  });
  const costPayment = payImmediateEffectCosts(stateWithAbilityUse, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }
  const moveResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    costPayment.gameState,
    player.id,
    10,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (gameState) =>
        recordPayCostAction(gameState, player.id, {
          abilityId: HANAYO_ACTIVATED_ABILITY_ID,
          sourceCardId: cardId,
          energyCardIds: costPayment.paidEnergyCardIds,
        }),
    }
  );
  if (!moveResult) {
    return game;
  }

  let state = moveResult.gameState;
  state = addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
    effectText: getAbilityEffectText(HANAYO_ACTIVATED_ABILITY_ID),
    step: 'MILL_TOP_TEN',
    milledCardIds: moveResult.movedCardIds,
    refreshCount: moveResult.refreshCount,
  });
  return state;
}

function canStartHanayoActivatedEffect(game: GameState, playerId: string, cardId: string): boolean {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  ) {
    return false;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  return (
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-sd1-008') &&
    findMemberSlot(player, cardId) !== null &&
    getEnergySelectionCandidates(game, playerId, 'TAP_ACTIVE_ENERGY').length >= 2
  );
}
