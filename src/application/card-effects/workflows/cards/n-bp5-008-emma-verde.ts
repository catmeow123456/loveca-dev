import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

export function registerNBp5008EmmaVerdeWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    startEmmaStackEnergyActivateTwoEnergy
  );
}

function startEmmaStackEnergyActivateTwoEnergy(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp5-008') ||
    sourceSlot === null ||
    player.energyZone.cardIds.length === 0
  ) {
    return game;
  }

  const stackResult = stackEnergyFromEnergyZoneBelowMember(game, player.id, sourceSlot, 1);
  if (!stackResult) {
    return game;
  }

  let state = recordPayCostAction(stackResult.gameState, player.id, {
    abilityId: N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    costType: 'STACK_ENERGY_BELOW',
    energyCardId: stackResult.stackedEnergyCardIds[0] ?? null,
    stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
  });

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    state,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(2, waitingEnergyCount);
  const activationResult = activateWaitingEnergyCardsForPlayer(
    state,
    player.id,
    activationCount
  );
  if (!activationResult) {
    return game;
  }

  return addAction(activationResult.gameState, 'RESOLVE_ABILITY', player.id, {
    abilityId: N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    step: 'STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY',
    stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
    activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
    previousOrientations: activationResult.previousOrientations,
    nextOrientation: activationResult.nextOrientation,
  });
}
