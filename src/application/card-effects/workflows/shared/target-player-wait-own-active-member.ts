import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export interface TargetPlayerWaitOwnActiveMemberWorkflowConfig {
  readonly abilityId: string;
  readonly effectTextAbilityId: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly startActionStep: string;
  readonly finishActionStep: string;
  readonly noTargetActionStep: string;
}

export interface StartTargetPlayerWaitOwnActiveMemberOptions {
  readonly targetPlayerId: string;
  readonly orderedResolution: boolean;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TransitionTargetPlayerWaitOwnActiveMemberOptions extends StartTargetPlayerWaitOwnActiveMemberOptions {
  readonly activeEffect: ActiveEffectState;
  readonly actionPlayerId: string;
  readonly actionPayload?: Readonly<Record<string, unknown>>;
}

export function startTargetPlayerWaitOwnActiveMemberFromPending(
  game: GameState,
  ability: PendingAbilityState,
  config: TargetPlayerWaitOwnActiveMemberWorkflowConfig,
  options: StartTargetPlayerWaitOwnActiveMemberOptions
): GameState {
  const controller = getPlayerById(game, ability.controllerId);
  const targetPlayer = getPlayerById(game, options.targetPlayerId);
  if (!controller || !targetPlayer) {
    return game;
  }

  const targetSelection = createTargetPlayerWaitOwnActiveMemberSelection(game, ability, config, {
    targetPlayerId: targetPlayer.id,
    orderedResolution: options.orderedResolution,
    metadata: options.metadata,
  });
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (targetSelection.activeEffect === null) {
    return options.continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', controller.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: config.noTargetActionStep,
        sourceSlot: ability.sourceSlot,
        targetPlayerId: targetPlayer.id,
      }),
      options.orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    controller.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep,
      sourceSlot: ability.sourceSlot,
      targetPlayerId: targetPlayer.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

export function transitionToTargetPlayerWaitOwnActiveMemberStep(
  game: GameState,
  config: TargetPlayerWaitOwnActiveMemberWorkflowConfig,
  options: TransitionTargetPlayerWaitOwnActiveMemberOptions
): GameState {
  const effect = options.activeEffect;
  const targetPlayer = getPlayerById(game, options.targetPlayerId);
  if (!targetPlayer) {
    return game;
  }

  const ability = createPendingAbilityFromActiveEffect(effect);
  const targetSelection = createTargetPlayerWaitOwnActiveMemberSelection(game, ability, config, {
    targetPlayerId: targetPlayer.id,
    orderedResolution: options.orderedResolution,
    metadata: {
      ...effect.metadata,
      ...options.metadata,
    },
  });

  if (targetSelection.activeEffect === null) {
    return options.continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', options.actionPlayerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: config.noTargetActionStep,
        sourceSlot: effect.metadata?.sourceSlot,
        targetPlayerId: targetPlayer.id,
        ...options.actionPayload,
      }),
      options.orderedResolution
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    options.actionPlayerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.startActionStep,
      sourceSlot: effect.metadata?.sourceSlot,
      targetPlayerId: targetPlayer.id,
      selectableCardIds: targetSelection.selectableCardIds,
      ...options.actionPayload,
    }
  );
}

export function finishTargetPlayerWaitOwnActiveMemberWorkflow(
  game: GameState,
  selectedCardId: string | null,
  config: TargetPlayerWaitOwnActiveMemberWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) {
    return game;
  }
  if (!selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const controller = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!controller || !targetMetadata) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          controller.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: config.finishActionStep,
            sourceSlot: effect.metadata?.sourceSlot,
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function createTargetPlayerWaitOwnActiveMemberSelection(
  game: GameState,
  ability: PendingAbilityState,
  config: TargetPlayerWaitOwnActiveMemberWorkflowConfig,
  options: {
    readonly targetPlayerId: string;
    readonly orderedResolution: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }
): {
  readonly selectableCardIds: readonly string[];
  readonly activeEffect: ActiveEffectState | null;
} {
  return createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(config.effectTextAbilityId),
    stepId: config.stepId,
    stepText: config.stepText,
    awaitingPlayerId: options.targetPlayerId,
    targetPlayerId: options.targetPlayerId,
    selector: typeIs(CardType.MEMBER),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: config.selectionLabel,
    orderedResolution: options.orderedResolution,
    metadata: {
      ...options.metadata,
      sourceSlot: ability.sourceSlot,
    },
  });
}

function createPendingAbilityFromActiveEffect(effect: ActiveEffectState): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId:
      typeof effect.metadata?.timingId === 'string'
        ? (effect.metadata.timingId as TriggerCondition)
        : TriggerCondition.ON_ENTER_STAGE,
    eventIds: getStringArray(effect.metadata?.eventIds),
    sourceSlot: toSlotPosition(effect.metadata?.sourceSlot) ?? undefined,
    metadata: effect.metadata,
  };
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function toSlotPosition(value: unknown): SlotPosition | null {
  return Object.values(SlotPosition).includes(value as SlotPosition)
    ? (value as SlotPosition)
    : null;
}
