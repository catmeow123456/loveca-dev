import type { ActiveEffectState, GameState } from '../../../../domain/entities/game.js';
import {
  addAction,
  getPlayerById,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import {
  BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID,
  BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers,
  type ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects,
  type ActivatedWaitSelfDrawDiscardWorkflowConfig,
} from '../shared/activated-wait-self-draw-discard.js';

const ACTIVATED_SELECT_DISCARD_STEP_ID = 'BP3_001_ACTIVATED_SELECT_DISCARD_AFTER_DRAW';
const LIVE_START_SELECT_MEMBER_STEP_ID = 'BP3_001_LIVE_START_SELECT_MEMBER_TO_ACTIVE';

type EnqueueTriggeredCardEffects = ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ACTIVATED_WAIT_SELF_DRAW_DISCARD_CONFIG: ActivatedWaitSelfDrawDiscardWorkflowConfig = {
  abilityId: BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID,
  baseCardCodes: ['PL!-bp3-001'],
  drawCount: 1,
  discardCount: 1,
  stepId: ACTIVATED_SELECT_DISCARD_STEP_ID,
};

export function registerPlBp3001HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedWaitSelfDrawDiscardWorkflowHandlers(
    ACTIVATED_WAIT_SELF_DRAW_DISCARD_CONFIG,
    deps
  );
  registerPendingAbilityStarterHandler(
    BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartActivateOwnStageMember(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
    LIVE_START_SELECT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishLiveStartActivateOwnStageMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startLiveStartActivateOwnStageMember(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (sourceSlot === null) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE',
      }),
      orderedResolution
    );
  }

  const targetSelection = createStageMemberOrientationTargetSelection(stateWithoutPending, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: LIVE_START_SELECT_MEMBER_STEP_ID,
    stepText: '可以选择自己舞台上的1名成员变为活跃状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: player.id,
    selector: typeIs(CardType.MEMBER),
    targetOrientation: OrientationState.ACTIVE,
    selectionLabel: '选择要变为活跃状态的成员',
    orderedResolution,
    metadata: { sourceSlot },
  });

  if (targetSelection.activeEffect === null) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_WAITING_OWN_STAGE_MEMBER_TARGET',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  const activeEffect: ActiveEffectState = {
    ...targetSelection.activeEffect,
    canSkipSelection: true,
    skipSelectionLabel: '不发动',
    confirmSelectionLabel: '变为活跃',
  };
  return addAction(
    {
      ...stateWithoutPending,
      activeEffect,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OWN_STAGE_MEMBER_TO_ACTIVE',
      sourceSlot,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishLiveStartActivateOwnStageMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID ||
    effect.stepId !== LIVE_START_SELECT_MEMBER_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    if (effect.canSkipSelection !== true) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_ACTIVATE_OWN_STAGE_MEMBER',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!targetMetadata || !orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'ACTIVATE_OWN_STAGE_MEMBER',
          sourceSlot: effect.metadata?.sourceSlot,
          targetPlayerId: targetMetadata.targetPlayerId,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}
