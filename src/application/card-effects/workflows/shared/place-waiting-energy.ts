import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import {
  N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID,
  PL_N_PB1_012_AUTO_TURN_ONCE_OTHER_COST_ELEVEN_MEMBER_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
  SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  maybeStartManualPendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  placeWaitingEnergyWithActivePhaseSkip,
  type EnqueueTriggeredCardEffectsForWaitingEnergyPlacement,
} from '../../runtime/waiting-energy-placement.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface PlaceWaitingEnergyConfig {
  readonly abilityId: string;
  readonly actionStep: string;
  readonly recordAbilityUse: boolean;
  readonly skipNextActivePhase?: boolean;
}

const PLACE_WAITING_ENERGY_CONFIGS: readonly PlaceWaitingEnergyConfig[] = [
  {
    abilityId: N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID,
    actionStep: 'PLACE_WAITING_ENERGY_AFTER_ENERGY_PLACED_BELOW_MEMBER',
    recordAbilityUse: true,
  },
  {
    abilityId: SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    actionStep: 'PLACE_WAITING_ENERGY',
    recordAbilityUse: false,
  },
  {
    abilityId:
      PL_N_PB1_012_AUTO_TURN_ONCE_OTHER_COST_ELEVEN_MEMBER_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    actionStep: 'PLACE_WAITING_ENERGY_AFTER_OTHER_COST_ELEVEN_MEMBER_ENTER',
    recordAbilityUse: true,
  },
  {
    abilityId: SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
    actionStep: 'PLACE_WAITING_ENERGY_SKIP_NEXT_ACTIVE_PHASE',
    recordAbilityUse: false,
    skipNextActivePhase: true,
  },
];

export function registerPlaceWaitingEnergyWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement;
}): void {
  for (const config of PLACE_WAITING_ENERGY_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolvePlaceWaitingEnergy(
        game,
        ability,
        config,
        options,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function resolvePlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  config: PlaceWaitingEnergyConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options, {
    stepText: '确认后结算此效果。',
  });
  if (manualConfirmation) {
    return manualConfirmation;
  }

  const cause = {
    kind: 'CARD_EFFECT' as const,
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    pendingAbilityId: ability.id,
  };
  const stateBeforePlacement = config.skipNextActivePhase
    ? {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      }
    : game;
  const placement = config.skipNextActivePhase
    ? placeWaitingEnergyWithActivePhaseSkip(stateBeforePlacement, {
        count: 1,
        cause,
        enqueueTriggeredCardEffects,
      })
    : placeEnergyFromDeckToZoneByCardEffect(
        stateBeforePlacement,
        player.id,
        1,
        OrientationState.WAITING,
        cause
      );
  const stateAfterPlacement = placement?.gameState ?? stateBeforePlacement;
  let state: GameState = {
    ...stateAfterPlacement,
    pendingAbilities: stateAfterPlacement.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  if (config.recordAbilityUse) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
    }),
    options.orderedResolution === true
  );
}
