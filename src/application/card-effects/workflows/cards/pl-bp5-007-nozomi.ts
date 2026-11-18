import {
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  HAND_RESET_DISCARD_STEP_ID,
  startNextHandResetDiscard,
  finishHandResetDiscard,
} from '../shared/hand-reset.js';

/** Original 13-cost Nozomi keeps its timing, cost and continuation; only the hand-reset procedure is shared. */
export function registerBp5007NozomiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
    (game, ability, options, context) => {
      const player = getPlayerById(game, ability.controllerId);
      const opponent = player ? getOpponent(game, player.id) : null;
      if (!player || !opponent) return game;
      return startNextHandResetDiscard(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        { ...ability, effectText: getAbilityEffectText(ability.abilityId) },
        [player.id, opponent.id],
        0,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerActiveEffectStepHandler(
    BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
    HAND_RESET_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHandResetDiscard(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}
