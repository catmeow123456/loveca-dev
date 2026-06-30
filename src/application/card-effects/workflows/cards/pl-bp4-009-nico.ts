import {
  getOpponent,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import {
  finishTargetPlayerWaitOwnActiveMemberWorkflow,
  startTargetPlayerWaitOwnActiveMemberFromPending,
  type TargetPlayerWaitOwnActiveMemberWorkflowConfig,
} from '../shared/target-player-wait-own-active-member.js';
import type { EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';

const BP4_009_SELECT_OPPONENT_ACTIVE_MEMBER_STEP_ID = 'BP4_009_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const BP4_009_CONFIG: TargetPlayerWaitOwnActiveMemberWorkflowConfig = {
  abilityId: BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
  effectTextAbilityId: BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
  stepId: BP4_009_SELECT_OPPONENT_ACTIVE_MEMBER_STEP_ID,
  stepText: '请选择自己舞台上1名活跃状态的成员变为待机状态。',
  selectionLabel: '选择自己的活跃成员',
  startActionStep: 'START_OPPONENT_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT',
  finishActionStep: 'OPPONENT_WAIT_OWN_ACTIVE_MEMBER',
  noTargetActionStep: 'NO_OP_OPPONENT_HAS_NO_ACTIVE_MEMBER',
};

export function registerPlBp4009NicoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startPlBp4009NicoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP4_009_ON_ENTER_OPPONENT_WAIT_OWN_ACTIVE_MEMBER_ABILITY_ID,
    BP4_009_SELECT_OPPONENT_ACTIVE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishTargetPlayerWaitOwnActiveMemberWorkflow(
        game,
        input.selectedCardId ?? null,
        BP4_009_CONFIG,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startPlBp4009NicoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const opponent = getOpponent(game, ability.controllerId);
  if (!opponent) {
    return game;
  }

  return startTargetPlayerWaitOwnActiveMemberFromPending(game, ability, BP4_009_CONFIG, {
    targetPlayerId: opponent.id,
    orderedResolution,
    continuePendingCardEffects,
  });
}
