import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { findCardAbilityDefinitionById } from '../../definitions/lookup.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { startConfirmOnlyPendingAbilityEffect } from '../../runtime/active-effect.js';
import { getPendingLeaveStageEvent } from '../../runtime/events.js';
import {
  doesOnLeaveStageSourceMatchAbilityDefinition,
  type OnLeaveStageTriggerSource,
} from '../../runtime/on-leave-stage-trigger-filter.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RelayReplacementActivateEnergyWorkflowConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly activationCount: number;
  readonly actionStep: string;
}

const CONFIGS: readonly RelayReplacementActivateEnergyWorkflowConfig[] = [
  {
    abilityId: HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
    expectedBaseCardCodes: ['PL!HS-sd1-001'],
    activationCount: 2,
    actionStep: 'ACTIVATE_TWO_ENERGY_AFTER_RELAY',
  },
  {
    abilityId: PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-pb2-009'],
    activationCount: 2,
    actionStep: 'ACTIVATE_TWO_ENERGY_AFTER_RELAY',
  },
];

export function registerRelayReplacementActivateEnergyWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startRelayReplacementActivateEnergy(
        game,
        ability,
        options,
        config,
        context.continuePendingCardEffects
      )
    );
  }
}

function startRelayReplacementActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  config: RelayReplacementActivateEnergyWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const definition = findCardAbilityDefinitionById(config.abilityId);
  const leaveStageEvent = getPendingLeaveStageEvent(game, ability);
  const source: OnLeaveStageTriggerSource | null = leaveStageEvent
    ? {
        cardId: leaveStageEvent.cardInstanceId,
        controllerId: leaveStageEvent.controllerId,
        sourceSlot: leaveStageEvent.fromSlot,
        eventId: leaveStageEvent.eventId,
        toZone: leaveStageEvent.toZone,
        replacingCardId: leaveStageEvent.replacingCardId,
      }
    : null;
  const conditionMet =
    player !== null &&
    sourceCard !== null &&
    definition !== null &&
    config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) &&
    source !== null &&
    source.cardId === ability.sourceCardId &&
    source.controllerId === player.id &&
    doesOnLeaveStageSourceMatchAbilityDefinition(game, definition, source);

  if (!conditionMet) {
    return finishWithoutActivation(
      game,
      ability,
      options,
      leaveStageEvent?.replacingCardId ?? null,
      continuePendingCardEffects
    );
  }

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(config.activationCount, waitingEnergyCount);
  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: `${getAbilityEffectText(config.abilityId)}\n\n\uff08\u5f53\u524d\u5f85\u673a\u80fd\u91cf${waitingEnergyCount}\u5f20\uff0c\u672c\u6b21\u5c06${activationCount}\u5f20\u80fd\u91cf\u53d8\u4e3a\u6d3b\u8dc3\u72b6\u6001\u3002\uff09`,
      orderedResolution: options.orderedResolution === true,
    });
  }

  const orientationChange = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!orientationChange) {
    return finishWithoutActivation(
      game,
      ability,
      options,
      leaveStageEvent?.replacingCardId ?? null,
      continuePendingCardEffects
    );
  }

  const state = {
    ...orientationChange.gameState,
    pendingAbilities: orientationChange.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      leaveStageEventId: leaveStageEvent?.eventId ?? null,
      replacingCardId: leaveStageEvent?.replacingCardId ?? null,
      activatedEnergyCardIds: orientationChange.activatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    options.orderedResolution === true
  );
}

function finishWithoutActivation(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  replacingCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
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
      step: 'CONDITION_NOT_MET',
      replacingCardId,
      activatedEnergyCardIds: [],
    }),
    options.orderedResolution === true
  );
}
