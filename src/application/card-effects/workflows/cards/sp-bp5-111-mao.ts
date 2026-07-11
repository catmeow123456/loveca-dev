import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { moveEnergyZoneCardsToEnergyDeckByCardEffect } from '../../../effects/energy.js';
import { resolveEnergySelectionForOperation } from '../../../effects/energy-selection.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'SP_BP5_111_SELECT_WAITING_ROOM_LIVE';

interface EnergyCostContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly effectText: string;
}

type Enqueue = (game: GameState, triggers: readonly TriggerCondition[]) => GameState;
let enqueueTriggeredCardEffects: Enqueue = (game) => game;
export function registerSpBp5111MaoWorkflowHandlers(deps?: { readonly enqueueTriggeredCardEffects: Enqueue }): void {
  enqueueTriggeredCardEffects = deps?.enqueueTriggeredCardEffects ?? enqueueTriggeredCardEffects;
  registerActivatedAbilityHandler(
    SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID,
    (game, playerId, cardId) => startActivatedReturnEnergyRecoverLive(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID,
    SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input) => finishWaitingRoomLiveSelection(game, input.selectedCardId ?? null)
  );
}

function startActivatedReturnEnergyRecoverLive(
  game: GameState,
  playerId: string,
  sourceCardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceIsOwnStageBp5111(game, playerId, sourceCardId) ||
    player.energyZone.cardIds.length < 2 ||
    getWaitingRoomLiveCandidateIds(game, playerId).length === 0
  ) {
    return game;
  }

  const selection = resolveEnergySelectionForOperation(
    game,
    player.id,
    'RETURN_TO_ENERGY_DECK',
    2
  );
  if (!selection) return game;
  return finishEnergyCostSelection(
    selection.gameState,
    {
      id: `${SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
      abilityId: SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID,
      sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(
        SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID
      ),
    },
    selection.selectedEnergyCardIds
  );
}

function finishEnergyCostSelection(
  game: GameState,
  context: EnergyCostContext,
  selectedEnergyCardIds: readonly string[]
): GameState {
  const player = getPlayerById(game, context.controllerId);
  if (!player || !sourceIsOwnStageBp5111(game, player.id, context.sourceCardId)) {
    return game;
  }

  const costPayment = moveEnergyZoneCardsToEnergyDeckByCardEffect(
    game, player.id, selectedEnergyCardIds,
    { kind: 'CARD_EFFECT', playerId: player.id, sourceCardId: context.sourceCardId, abilityId: context.abilityId },
    { exactCount: 2 }
  );
  if (!costPayment) {
    return game;
  }

  let state = enqueueTriggeredCardEffects(costPayment.gameState, [TriggerCondition.ON_ENERGY_MOVED_TO_DECK]);
  state = recordPayCostAction(state, player.id, {
    abilityId: context.abilityId,
    sourceCardId: context.sourceCardId,
    energyCardIds: costPayment.movedEnergyCardIds,
    amount: costPayment.movedEnergyCardIds.length,
    destinationZone: 'ENERGY_DECK',
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: context.abilityId,
    sourceCardId: context.sourceCardId,
  });

  const candidateCardIds = getWaitingRoomLiveCandidateIds(state, player.id);
  if (candidateCardIds.length === 0) {
    return addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: context.abilityId,
      sourceCardId: context.sourceCardId,
      step: 'RETURN_TWO_ENERGY_NO_WAITING_ROOM_LIVE',
      returnedEnergyCardIds: costPayment.movedEnergyCardIds,
      recoveredCardIds: [],
    });
  }

  return {
    ...state,
    activeEffect: {
      id: context.id,
      abilityId: context.abilityId,
      sourceCardId: context.sourceCardId,
      controllerId: context.controllerId,
      effectText: context.effectText,
      stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '请选择自己休息室中1张LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      canSkipSelection: false,
      metadata: {
        returnedEnergyCardIds: costPayment.movedEnergyCardIds,
      },
    },
  };
}

function finishWaitingRoomLiveSelection(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_LIVE_STEP_ID ||
    !selectedCardId
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'WAITING_ROOM_LIVE_TARGET_LOST_AFTER_COST',
      returnedEnergyCardIds: getReturnedEnergyCardIds(effect),
      recoveredCardIds: [],
    });
  }

  return addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'RETURN_TWO_ENERGY_RECOVER_LIVE',
    returnedEnergyCardIds: getReturnedEnergyCardIds(effect),
    selectedCardId: recoveryResult.movedCardIds[0] ?? null,
    recoveredCardIds: recoveryResult.movedCardIds,
  });
}

function sourceIsOwnStageBp5111(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-111')
  ) {
    return false;
  }
  return [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].some(
    (slot) => player.memberSlots.slots[slot] === sourceCardId
  );
}

function getWaitingRoomLiveCandidateIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE));
}

function getReturnedEnergyCardIds(effect: NonNullable<GameState['activeEffect']>): readonly string[] {
  const value = effect.metadata?.returnedEnergyCardIds;
  return Array.isArray(value) && value.every((cardId) => typeof cardId === 'string')
    ? value
    : [];
}
