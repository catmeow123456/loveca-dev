import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface LiveStartCheerCountContext {
  readonly conditionMet: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LiveStartCheerCountWorkflowConfig {
  readonly abilityId: string;
  readonly countDelta: number;
  readonly actionStep: string;
  readonly confirmationMode?: 'CONFIRMABLE' | 'NONE';
  readonly getContext: (
    game: GameState,
    ability: PendingAbilityState
  ) => LiveStartCheerCountContext;
  readonly getConfirmationEffectText: (
    game: GameState,
    ability: PendingAbilityState,
    context: LiveStartCheerCountContext
  ) => string;
}

export function registerLiveStartCheerCountWorkflowHandlers(
  configs: readonly LiveStartCheerCountWorkflowConfig[]
): void {
  for (const config of configs) {
    const resolver = (
      game: GameState,
      ability: PendingAbilityState,
      options: { readonly orderedResolution?: boolean },
      context: { readonly continuePendingCardEffects: ContinuePendingCardEffects }
    ) =>
      resolveLiveStartCheerCount(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        config
      );
    if (config.confirmationMode === 'NONE') {
      registerPendingAbilityStarterHandler(config.abilityId, resolver);
      continue;
    }
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      resolver,
      (game, ability) => {
        const workflowContext = config.getContext(game, ability);
        return {
          effectText: config.getConfirmationEffectText(game, ability, workflowContext),
          stepText: workflowContext.conditionMet
            ? `确认后，自己的声援张数${formatDelta(config.countDelta)}。`
            : '确认后，此效果不会改变声援张数。',
        };
      }
    );
  }
}

function resolveLiveStartCheerCount(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: LiveStartCheerCountWorkflowConfig
): GameState {
  const workflowContext = config.getContext(game, ability);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = workflowContext.conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'CHEER_COUNT',
        playerId: ability.controllerId,
        countDelta: config.countDelta,
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
      conditionMet: workflowContext.conditionMet,
      cheerCountDelta: workflowContext.conditionMet ? config.countDelta : 0,
      ...workflowContext.metadata,
    }),
    orderedResolution
  );
}

export function getDefaultLiveStartCheerCountEffectText(abilityId: string): string {
  return getAbilityEffectText(abilityId);
}

function formatDelta(value: number): string {
  return value >= 0 ? `增加${value}张` : `减少${Math.abs(value)}张`;
}
