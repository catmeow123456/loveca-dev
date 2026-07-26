import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface CheerCardHeartColorReplacementWorkflowConfig {
  readonly abilityId: string;
  readonly fromColors: readonly HeartColor[];
  readonly toColor: HeartColor;
  readonly actionStep: string;
  readonly isSourceAvailable?: (
    game: GameState,
    ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
  ) => boolean;
  readonly getConfirmationEffectText?: (
    game: GameState,
    ability: PendingAbilityState,
    context: CheerCardHeartColorReplacementContext
  ) => string;
  readonly getConfirmationStepText?: (
    game: GameState,
    ability: PendingAbilityState,
    context: CheerCardHeartColorReplacementContext
  ) => string;
}

export interface CheerCardHeartColorReplacementContext {
  readonly sourceInLiveZone: boolean;
  readonly sourceAvailable: boolean;
}

export function registerCheerCardHeartColorReplacementWorkflowHandlers(
  configs: readonly CheerCardHeartColorReplacementWorkflowConfig[]
): void {
  for (const config of configs) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveCheerCardHeartColorReplacement(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          config
        ),
      (game, ability) => {
        const replacementContext = getCheerCardHeartColorReplacementContext(game, ability, config);
        return {
          effectText:
            config.getConfirmationEffectText?.(game, ability, replacementContext) ??
            getAbilityEffectText(ability.abilityId),
          stepText: config.getConfirmationStepText?.(game, ability, replacementContext),
        };
      }
    );
  }
}

function resolveCheerCardHeartColorReplacement(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: CheerCardHeartColorReplacementWorkflowConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const replacementContext = getCheerCardHeartColorReplacementContext(game, ability, config);
  const stateWithoutPending = removePending(game, ability.id);
  const stateAfterModifier =
    player && replacementContext.sourceAvailable
      ? addLiveModifier(stateWithoutPending, {
          kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
          playerId: player.id,
          fromColors: config.fromColors,
          toColor: config.toColor,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        })
      : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      sourceInLiveZone: replacementContext.sourceInLiveZone,
      sourceAvailable: replacementContext.sourceAvailable,
      fromColors: config.fromColors,
      toColor: config.toColor,
      applied: player !== undefined && replacementContext.sourceAvailable,
    }),
    orderedResolution
  );
}

function getCheerCardHeartColorReplacementContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>,
  config: CheerCardHeartColorReplacementWorkflowConfig
): CheerCardHeartColorReplacementContext {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  return {
    sourceInLiveZone,
    sourceAvailable: config.isSourceAvailable?.(game, ability) ?? sourceInLiveZone,
  };
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
