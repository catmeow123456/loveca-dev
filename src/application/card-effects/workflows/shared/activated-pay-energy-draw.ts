import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import {
  doesCardAbilityDefinitionMatchCardCode,
  findCardAbilityDefinitionById,
} from '../../definitions/lookup.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

interface ActivatedPayEnergyDrawConfig {
  readonly abilityId: string;
  readonly energyCost: number;
  readonly drawCount: number;
  readonly actionStep: string;
}

const CONFIGS: readonly ActivatedPayEnergyDrawConfig[] = [
  {
    abilityId: SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
    energyCost: 2,
    drawCount: 1,
    actionStep: 'PAY_TWO_ENERGY_DRAW_ONE',
  },
];

export function registerActivatedPayEnergyDrawWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      resolveActivatedPayEnergyDraw(game, playerId, cardId, config)
    );
  }
}

function resolveActivatedPayEnergyDraw(
  game: GameState,
  playerId: string,
  cardId: string,
  config: ActivatedPayEnergyDrawConfig
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const definition = findCardAbilityDefinitionById(config.abilityId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    findMemberSlot(player, cardId) === null ||
    !definition ||
    !doesCardAbilityDefinitionMatchCardCode(definition, sourceCard.data.cardCode)
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: config.energyCost },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });
  const drawResult = drawCardsForPlayer(state, player.id, config.drawCount);
  state = drawResult?.gameState ?? state;

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    effectText: getAbilityEffectText(config.abilityId),
    step: config.actionStep,
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    drawnCardIds: drawResult?.drawnCardIds ?? [],
  });
}
