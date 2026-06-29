import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { setEnergyOrientation } from '../../../effects/energy.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const liellaMemberCard = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

export function registerChisatoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveChisatoLiveStartActivateAll(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    (game, ability) => {
      const player = getPlayerById(game, ability.controllerId);
      const liellaMemberCardIds = player
        ? getStageMemberCardIdsMatching(game, player.id, liellaMemberCard)
        : [];
      const energyCardIds = player ? [...player.energyZone.cardIds] : [];
      return {
        stepText: `确认后将${liellaMemberCardIds.length}名Liella!成员和${energyCardIds.length}张能量变为活跃状态。`,
      };
    }
  );
}

function resolveChisatoLiveStartActivateAll(
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

  const liellaMemberCardIds = getStageMemberCardIdsMatching(game, player.id, liellaMemberCard);
  const energyCardIds = [...player.energyZone.cardIds];
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  const memberOrientationChange = setMembersOrientation(
    stateWithoutPending,
    player.id,
    liellaMemberCardIds,
    OrientationState.ACTIVE
  );
  if (!memberOrientationChange) {
    return game;
  }

  const energyOrientationChange = setEnergyOrientation(
    memberOrientationChange.gameState,
    player.id,
    energyCardIds,
    OrientationState.ACTIVE
  );
  if (!energyOrientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutPending,
    {
      ...memberOrientationChange,
      gameState: energyOrientationChange.gameState,
    },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'ACTIVATE_MEMBERS_AND_ENERGY',
          sourceSlot: ability.sourceSlot,
          activatedMemberCardIds: result.updatedMemberCardIds,
          previousMemberOrientations: result.previousOrientations,
          activatedEnergyCardIds: energyOrientationChange.updatedEnergyCardIds,
          previousEnergyOrientations: energyOrientationChange.previousOrientations,
          nextOrientation: OrientationState.ACTIVE,
        }),
    }
  );
  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}
