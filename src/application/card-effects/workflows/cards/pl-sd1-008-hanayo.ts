import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
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
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';

export function registerSd1008HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(HANAYO_ACTIVATED_ABILITY_ID, (game, playerId, cardId) =>
    startHanayoActivatedEffect(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
}

function startHanayoActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-sd1-008')
  ) {
    return game;
  }

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
