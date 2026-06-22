import { S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const S_BP2_024_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID =
  'S_BP2_024_LIVE_SUCCESS_SELECT_DISCARD_AFTER_DRAW';

export function registerSBp2024KimikokoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    (game, ability, options) =>
      startDrawThenDiscardCardsWorkflow(game, {
        ability,
        effectText: getAbilityEffectText(S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID),
        drawCount: 2,
        discardCount: 1,
        stepId: S_BP2_024_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
        orderedResolution: options.orderedResolution === true,
      })
  );
  registerActiveEffectStepHandler(
    S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    S_BP2_024_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}
