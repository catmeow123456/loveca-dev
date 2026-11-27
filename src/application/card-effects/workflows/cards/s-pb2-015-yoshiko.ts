import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_PB2_015_ON_ENTER_LOOK_TOP_BY_OTHER_GUILTY_KISS_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  getPendingAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  resolveLookTopSelectToHandSelection,
  startPrivateLookTopTakeOneWorkflow,
} from '../shared/look-top-select-to-hand.js';

const STEP_ID = 'S_PB2_015_SELECT_CARD_FROM_INSPECTION';
const isGuiltyKiss = unitAliasIs('Guilty Kiss');

export function registerSPb2015YoshikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
    const otherGuiltyKissMembers = getStageMemberCardIdsMatching(
      game,
      ability.controllerId,
      isGuiltyKiss,
      (state, _playerId, id) =>
        id !== ability.sourceCardId || getStageMemberLifecycleId(state, id) !== sourceLifecycleId
    );
    const topCount = otherGuiltyKissMembers.length * 2;
    return startPrivateLookTopTakeOneWorkflow(
      game,
      ability,
      {
        topCount,
        selectStepId: STEP_ID,
        sourceActionLabel: '登场',
        startActionPayload: { otherGuiltyKissMemberIds: otherGuiltyKissMembers, topCount },
      },
      {
        ...deps,
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      }
    );
  });

  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          ...deps,
          continuePendingCardEffects: context.continuePendingCardEffects,
        }
      ),
    queryCardSelection
  );
}
