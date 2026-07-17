import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasMemberEnteredStageThisTurnMatching } from '../../../effects/conditions.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
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

const SELECT_DISCARD_STEP_ID = 'PL_N_BP1_006_SELECT_HAND_CARD_TO_DISCARD';

export function registerNBp1006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  const abilityId =
    PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID;
  registerActivatedAbilityHandler(abilityId, (game, playerId, cardId) =>
    startKanataDiscardActivateEnergy(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(abilityId, SELECT_DISCARD_STEP_ID, (game, input, context) =>
    input.selectedCardId === null
      ? finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
          step: 'DECLINE_DISCARD_COST',
        })
      : finishKanataDiscardActivateEnergy(
          game,
          input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
          deps.enqueueTriggeredCardEffects
        )
  );
}

function startKanataDiscardActivateEnergy(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, 'PL!N-bp1-006') ||
    findMemberSlot(player, cardId) === null ||
    player.hand.cardIds.length < 1
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId:
          PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: playerId,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId:
        PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishKanataDiscardActivateEnergy(
  game: GameState,
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    selectedCardIds.length !== 1 ||
    new Set(selectedCardIds).size !== 1
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const source = getCardById(game, effect.sourceCardId);
  const selectedCardId = selectedCardIds[0]!;
  if (
    !player ||
    !source ||
    source.ownerId !== player.id ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, 'PL!N-bp1-006') ||
    findMemberSlot(player, effect.sourceCardId) === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const conditionMet = hasMemberEnteredStageThisTurnMatching(
    game,
    player.id,
    groupAliasIs('虹ヶ咲')
  );
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  let state = recordPayCostAction(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    state,
    player.id,
    OrientationState.WAITING
  );
  const activationCount = conditionMet ? Math.min(2, waitingEnergyCardIds.length) : 0;
  const activationResult = activateWaitingEnergyCardsForPlayer(state, player.id, activationCount);
  if (!activationResult) return game;

  return addAction(
    { ...activationResult.gameState, activeEffect: null },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_AND_ACTIVATE_WAITING_ENERGY',
      conditionMet,
      discardedHandCardIds: discardResult.discardedCardIds,
      requestedActivationCount: 2,
      waitingEnergyCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }
  );
}
