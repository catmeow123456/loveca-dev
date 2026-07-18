import { BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID } from '../../ability-ids.js';
import {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers,
  type ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects,
  type ActivatedWaitSelfDrawDiscardWorkflowConfig,
} from '../shared/activated-wait-self-draw-discard.js';

const ACTIVATED_SELECT_DISCARD_STEP_ID = 'BP3_001_ACTIVATED_SELECT_DISCARD_AFTER_DRAW';
type EnqueueTriggeredCardEffects = ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects;

const ACTIVATED_WAIT_SELF_DRAW_DISCARD_CONFIG: ActivatedWaitSelfDrawDiscardWorkflowConfig = {
  abilityId: BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID,
  baseCardCodes: ['PL!-bp3-001'],
  drawCount: 1,
  discardCount: 1,
  stepId: ACTIVATED_SELECT_DISCARD_STEP_ID,
};

export function registerPlBp3001HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers(
    ACTIVATED_WAIT_SELF_DRAW_DISCARD_CONFIG,
    deps
  );
}
