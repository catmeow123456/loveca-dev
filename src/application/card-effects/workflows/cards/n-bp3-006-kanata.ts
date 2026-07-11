import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_N_BP3_006_ON_ENTER_WAIT_SELF_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_006_ON_ENTER_WAIT_SELF_ABILITY_ID,
    (game, ability, options, context) =>
      resolveOnEnterWaitSelf(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolveOnEnterWaitSelf(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceState = player?.memberSlots.cardStates.get(ability.sourceCardId);
  if (!player || sourceSlot === null || !sourceState) {
    return finish(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_OWN_STAGE',
    });
  }
  if (sourceState.orientation === OrientationState.WAITING) {
    return finish(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_ALREADY_WAITING',
      memberStateChangedEventIds: [],
    });
  }

  const waitResult = setMemberOrientation(
    game,
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
    return finish(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'WAIT_SELF_NO_CHANGE',
      memberStateChangedEventIds: [],
    });
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        addAction(
          {
            ...state,
            pendingAbilities: state.pendingAbilities.filter(
              (candidate) => candidate.id !== ability.id
            ),
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            sourceSlot,
            step: 'WAIT_SELF',
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            memberStateChangedEventIds: events.map((event) => event.eventId),
          }
        ),
    }
  );
  return continuePendingCardEffects(stateWithTriggers.gameState, orderedResolution);
}

function finish(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
