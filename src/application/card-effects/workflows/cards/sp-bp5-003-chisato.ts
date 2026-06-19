import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { setEnergyOrientation } from '../../../effects/energy.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

export const CHISATO_LIVE_START_ACTIVATE_STEP_ID = 'CHISATO_LIVE_START_ACTIVATE_ALL';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const liellaMemberCard = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

export function registerChisatoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
    (game, ability, options) =>
      startChisatoLiveStartActivateAll(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
    CHISATO_LIVE_START_ACTIVATE_STEP_ID,
    (game, _input, context) =>
      finishChisatoLiveStartActivateAll(
        game,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startChisatoLiveStartActivateAll(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const liellaMemberCardIds = getStageMemberCardIdsMatching(game, player.id, liellaMemberCard);
  const energyCardIds = [...player.energyZone.cardIds];

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID),
      stepId: CHISATO_LIVE_START_ACTIVATE_STEP_ID,
      stepText: `确认后将${liellaMemberCardIds.length}名Liella!成员和${energyCardIds.length}张能量变为活跃状态。`,
      awaitingPlayerId: player.id,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        liellaMemberCardIds,
        energyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      sourceSlot: ability.sourceSlot,
      liellaMemberCardIds,
      energyCardIds,
    },
  });
}

function finishChisatoLiveStartActivateAll(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const liellaMemberCardIds = getStageMemberCardIdsMatching(game, player.id, liellaMemberCard);
  const energyCardIds = [...player.energyZone.cardIds];

  const memberOrientationChange = setMembersOrientation(
    game,
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
    game,
    {
      ...memberOrientationChange,
      gameState: energyOrientationChange.gameState,
    },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'ACTIVATE_MEMBERS_AND_ENERGY',
            sourceSlot: effect.metadata?.sourceSlot,
            activatedMemberCardIds: result.updatedMemberCardIds,
            previousMemberOrientations: result.previousOrientations,
            activatedEnergyCardIds: energyOrientationChange.updatedEnergyCardIds,
            previousEnergyOrientations: energyOrientationChange.previousOrientations,
            nextOrientation: OrientationState.ACTIVE,
          }
        ),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}
