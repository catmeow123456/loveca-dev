import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addMemberActivePhaseSkip } from '../../../../domain/rules/member-active-skips.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerHsBp6006HimeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveHsBp6006HimeLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      );
    }
  );
}

function resolveHsBp6006HimeLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot =
    ability.sourceSlot ?? getSourceMemberSlot(game, player.id, ability.sourceCardId);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!sourceSlot) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
      }),
      orderedResolution
    );
  }

  const waitResult = setMemberOrientation(
    state,
    player.id,
    ability.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!waitResult) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  const stateWithSkipMarker = addMemberActivePhaseSkip(waitResult.gameState, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
  });

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    state,
    {
      ...waitResult,
      gameState: stateWithSkipMarker,
    },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterSkip, result) =>
        addAction(stateAfterSkip, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'WAIT_SOURCE_SKIP_NEXT_ACTIVE',
          sourceSlot,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          skipNextActivePlayerId: player.id,
          skipNextActiveMemberCardId: ability.sourceCardId,
        }),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    orderedResolution
  );
}
