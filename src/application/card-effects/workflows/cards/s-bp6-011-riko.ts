import { type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import { type EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  consumeOnEnterSourceZoneMismatch,
  isOnEnterFromWaitingRoom,
} from '../../runtime/on-enter-source-zone.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const S_BP6_011_SELECT_DISCARD_STEP_ID = 'S_BP6_011_SELECT_DISCARD_AFTER_DRAW';

export function registerSBp6011RikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startSBp6011RikoWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    S_BP6_011_SELECT_DISCARD_STEP_ID,
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

function startSBp6011RikoWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  if (!isOnEnterFromWaitingRoom(ability)) {
    return consumeOnEnterSourceZoneMismatch(game, ability, {
      expectedFromZone: ZoneType.WAITING_ROOM,
      orderedResolution,
      continuePendingCardEffects,
    });
  }

  return startDrawThenDiscardCardsWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    drawCount: 2,
    discardCount: 1,
    stepId: S_BP6_011_SELECT_DISCARD_STEP_ID,
    orderedResolution,
    continuePendingCardEffects,
  });
}
