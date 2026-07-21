import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, memberPrintedBladeLte, typeIs } from '../../../effects/card-selectors.js';
import {
  setMembersOrientation,
  type SetMembersOrientationResult,
} from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_PB1_008_ON_ENTER_WAIT_ALL_LOW_ORIGINAL_BLADE_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const lowOriginalBladeMemberSelector = and(typeIs(CardType.MEMBER), memberPrintedBladeLte(3));

interface CombinedOrientationResult extends SetMembersOrientationResult {
  readonly ownTargetCardIds: readonly string[];
  readonly opponentTargetCardIds: readonly string[];
  readonly actualWaitingTargetCardIds: readonly string[];
}

export function registerHsPb1008IzumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_PB1_008_ON_ENTER_WAIT_ALL_LOW_ORIGINAL_BLADE_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPb1008OnEnterWaitLowOriginalBladeMembers(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    () => ({
      effectText: getAbilityEffectText(
        HS_PB1_008_ON_ENTER_WAIT_ALL_LOW_ORIGINAL_BLADE_MEMBERS_ABILITY_ID
      ),
      stepText: '确认后结算此效果。',
    })
  );
}

function resolveHsPb1008OnEnterWaitLowOriginalBladeMembers(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const ownTargetCardIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    lowOriginalBladeMemberSelector
  );
  const opponentTargetCardIds = getStageMemberCardIdsMatching(
    game,
    opponent.id,
    lowOriginalBladeMemberSelector
  );
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  const ownOrientationChange = setMembersOrientation(
    stateWithoutPending,
    player.id,
    ownTargetCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!ownOrientationChange) {
    return game;
  }

  const opponentOrientationChange = setMembersOrientation(
    ownOrientationChange.gameState,
    opponent.id,
    opponentTargetCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!opponentOrientationChange) {
    return game;
  }

  const previousOrientations = [
    ...ownOrientationChange.previousOrientations,
    ...opponentOrientationChange.previousOrientations,
  ];
  const combinedOrientationChange: CombinedOrientationResult = {
    gameState: opponentOrientationChange.gameState,
    updatedMemberCardIds: [
      ...ownOrientationChange.updatedMemberCardIds,
      ...opponentOrientationChange.updatedMemberCardIds,
    ],
    blockedByEffectActivationProhibitionMemberCardIds: [
      ...ownOrientationChange.blockedByEffectActivationProhibitionMemberCardIds,
      ...opponentOrientationChange.blockedByEffectActivationProhibitionMemberCardIds,
    ],
    blockedByWaitingProtectionMemberCardIds: [
      ...ownOrientationChange.blockedByWaitingProtectionMemberCardIds,
      ...opponentOrientationChange.blockedByWaitingProtectionMemberCardIds,
    ],
    previousOrientations,
    nextOrientation: OrientationState.WAITING,
    ownTargetCardIds,
    opponentTargetCardIds,
    actualWaitingTargetCardIds: [
      ...ownOrientationChange.updatedMemberCardIds,
      ...opponentOrientationChange.updatedMemberCardIds,
    ],
  };

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutPending,
    combinedOrientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'WAIT_ALL_LOW_ORIGINAL_BLADE_MEMBERS',
          ownTargetCardIds: result.ownTargetCardIds,
          opponentTargetCardIds: result.opponentTargetCardIds,
          actualWaitingTargetCardIds: result.actualWaitingTargetCardIds,
          previousOrientations: result.previousOrientations,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}
