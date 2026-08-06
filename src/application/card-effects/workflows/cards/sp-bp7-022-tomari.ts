import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, SlotPosition } from '../../../../shared/types/enums.js';
import {
  getEnergySelectionCandidates,
  resolveEnergySelectionForOperation,
} from '../../../effects/energy-selection.js';
import { SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  resolveEnergyReturnByCardEffect,
  type EnqueueTriggeredCardEffectsForEnergyReturn,
} from '../../runtime/energy-return.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import type { EnqueueTriggeredCardEffectsForMemberSlotMoved } from '../../runtime/member-slot-moved-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import {
  createMandatoryActivatedSelfPositionChangeActiveEffect,
  finishMandatoryActivatedSelfPositionChange,
} from '../shared/activated-self-position-change.js';

const BASE_CARD_CODE = 'PL!SP-bp7-022';
const SELF_POSITION_CHANGE_STEP_ID = 'SP_BP7_022_SELF_POSITION_CHANGE';
const ENERGY_RETURN_COUNT = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnergyReturn &
  EnqueueTriggeredCardEffectsForMemberSlotMoved;

export function registerSpBp7022TomariWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
    (game, playerId, cardId) =>
      startSpBp7022TomariActivated(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
    SELF_POSITION_CHANGE_STEP_ID,
    (game, input, context) =>
      finishSpBp7022TomariPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpBp7022TomariActivated(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyReturn
): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  ) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  const sourceSlot = player ? findMemberSlot(player, sourceCardId) : null;
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== player.id ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      player.id,
      sourceCardId,
      SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      [BASE_CARD_CODE]
    ) ||
    getEnergySelectionCandidates(game, player.id, 'RETURN_TO_ENERGY_DECK').length <
      ENERGY_RETURN_COUNT
  ) {
    return game;
  }

  const energySelection = resolveEnergySelectionForOperation(
    game,
    player.id,
    'RETURN_TO_ENERGY_DECK',
    ENERGY_RETURN_COUNT
  );
  if (!energySelection) {
    return game;
  }

  const effectId = `${SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`;
  let state = recordAbilityUseForContext(energySelection.gameState, player.id, {
    abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
    sourceCardId,
  });
  const costPayment = resolveEnergyReturnByCardEffect(state, {
    playerId: player.id,
    selectedEnergyCardIds: energySelection.selectedEnergyCardIds,
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId,
      abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      pendingAbilityId: effectId,
    },
    exactCount: ENERGY_RETURN_COUNT,
    enqueueTriggeredCardEffects,
  });
  if (!costPayment) {
    return game;
  }

  state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
    sourceCardId,
    energyCardIds: costPayment.movedEnergyCardIds,
    returnedEnergyCardIds: costPayment.movedEnergyCardIds,
    amount: costPayment.movedEnergyCardIds.length,
    destinationZone: 'ENERGY_DECK',
  });

  return addAction(
    {
      ...state,
      activeEffect: createMandatoryActivatedSelfPositionChangeActiveEffect({
        id: effectId,
        abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
        sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID
        ),
        stepId: SELF_POSITION_CHANGE_STEP_ID,
        sourceSlot,
        metadata: {
          returnedEnergyCardIds: costPayment.movedEnergyCardIds,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId,
      step: 'RETURN_ENERGY_SELF_POSITION_CHANGE',
      sourceSlot,
      returnedEnergyCardIds: costPayment.movedEnergyCardIds,
    }
  );
}

function finishSpBp7022TomariPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  return finishMandatoryActivatedSelfPositionChange(
    game,
    selectedSlot,
    {
      abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      baseCardCodes: [BASE_CARD_CODE],
      stepId: SELF_POSITION_CHANGE_STEP_ID,
    },
    continuePendingCardEffects,
    enqueueTriggeredCardEffects
  );
}
