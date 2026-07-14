import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { successLiveScoreAtLeast, sumSuccessfulLiveScore } from '../../../effects/conditions.js';
import {
  MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID,
  PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OnEnterActivateWaitingEnergyConfig {
  readonly abilityId: string;
  readonly activationCount: number;
  readonly minSuccessLiveScore?: number;
  readonly actionStep: string;
}

const ON_ENTER_ACTIVATE_WAITING_ENERGY_CONFIGS: readonly OnEnterActivateWaitingEnergyConfig[] = [
  {
    abilityId: MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID,
    activationCount: 2,
    actionStep: 'ACTIVATE_WAITING_ENERGY',
  },
  {
    abilityId: PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    activationCount: 2,
    minSuccessLiveScore: 6,
    actionStep: 'ON_ENTER_SUCCESS_LIVE_SCORE_SIX_ACTIVATE_TWO_ENERGY',
  },
];

export function registerOnEnterActivateWaitingEnergyWorkflowHandlers(): void {
  for (const config of ON_ENTER_ACTIVATE_WAITING_ENERGY_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnEnterActivateWaitingEnergy(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnEnterActivateWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  config: OnEnterActivateWaitingEnergyConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successLiveScore =
    config.minSuccessLiveScore === undefined
      ? undefined
      : sumSuccessfulLiveScore(game, player.id);
  if (
    config.minSuccessLiveScore !== undefined &&
    successLiveScore !== undefined &&
    !successLiveScoreAtLeast(game, player.id, config.minSuccessLiveScore)
  ) {
    const stateWithoutPending: GameState = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        successLiveScore,
        requiredSuccessLiveScore: config.minSuccessLiveScore,
      }),
      orderedResolution
    );
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const activationCount = Math.min(config.activationCount, waitingEnergyCardIds.length);
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...activationResult.gameState,
    pendingAbilities: activationResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      requestedActivationCount: config.activationCount,
      ...(config.minSuccessLiveScore === undefined
        ? {}
        : {
            successLiveScore,
            requiredSuccessLiveScore: config.minSuccessLiveScore,
          }),
      waitingEnergyCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }),
    orderedResolution
  );
}
