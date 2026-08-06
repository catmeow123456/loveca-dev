import { N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID } from '../../ability-ids.js';
import {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers,
  type ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects,
  type ActivatedWaitSelfDrawDiscardWorkflowConfig,
} from '../shared/activated-wait-self-draw-discard.js';

const N_BP7_023_SELECT_TWO_DISCARD_STEP_ID = 'N_BP7_023_SELECT_TWO_DISCARD_AFTER_DRAW';

const N_BP7_023_WAIT_SELF_DRAW_DISCARD_CONFIG: ActivatedWaitSelfDrawDiscardWorkflowConfig = {
  abilityId: N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  baseCardCodes: ['PL!N-bp7-023'],
  drawCount: 2,
  discardCount: 2,
  stepId: N_BP7_023_SELECT_TWO_DISCARD_STEP_ID,
};

export function registerNBp7023MiaTaylorWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects;
}): void {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers(
    N_BP7_023_WAIT_SELF_DRAW_DISCARD_CONFIG,
    deps
  );
}
