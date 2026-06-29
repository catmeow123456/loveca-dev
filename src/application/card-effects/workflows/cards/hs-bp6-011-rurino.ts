import type { GameState } from '../../../../domain/entities/game.js';
import { HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers,
  startActivatedWaitSelfDrawDiscard,
  type ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects,
  type ActivatedWaitSelfDrawDiscardWorkflowConfig,
} from '../shared/activated-wait-self-draw-discard.js';

const HS_BP6_011_SELECT_DISCARD_STEP_ID = 'HS_BP6_011_SELECT_DISCARD_AFTER_DRAW';

const HS_BP6_011_WAIT_SELF_DRAW_DISCARD_CONFIG: ActivatedWaitSelfDrawDiscardWorkflowConfig = {
  abilityId: HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  baseCardCodes: ['PL!HS-bp6-011'],
  drawCount: 1,
  discardCount: 1,
  stepId: HS_BP6_011_SELECT_DISCARD_STEP_ID,
};

export function registerHsBp6011RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects;
}): void {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers(
    HS_BP6_011_WAIT_SELF_DRAW_DISCARD_CONFIG,
    deps
  );
}

export function startHsBp6011WaitSelfDrawDiscard(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects;
  }
): GameState {
  return startActivatedWaitSelfDrawDiscard(
    game,
    playerId,
    cardId,
    HS_BP6_011_WAIT_SELF_DRAW_DISCARD_CONFIG,
    deps
  );
}
