import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function registerPlBp3005RinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePlBp3005RinOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

export function resolvePlBp3005RinOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stageMemberCardIds = MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    return cardId ? [cardId] : [];
  });
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const orientationResult = setMembersOrientation(
    stateWithoutPending,
    player.id,
    stageMemberCardIds,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!orientationResult) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'ACTIVATE_ALL_STAGE_MEMBERS_FAILED',
      }),
      orderedResolution
    );
  }

  const activatedMemberCardIds = orientationResult.previousOrientations
    .filter((entry) => entry.orientation === OrientationState.WAITING)
    .map((entry) => entry.cardId);
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutPending,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, _result, memberStateChangedEvents) =>
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'ACTIVATE_ALL_STAGE_MEMBERS',
          stageMemberCardIds,
          activatedMemberCardIds,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          nextOrientation: OrientationState.ACTIVE,
        }),
    }
  );

  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}
