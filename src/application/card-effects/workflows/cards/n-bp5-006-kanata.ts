import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID,
    (game, ability, options, context) =>
      resolveKanataLiveSuccessWaitSelf(
        game,
        ability,
        options,
        context.continuePendingCardEffects,
        deps
      ),
    getKanataConfirmationConfig
  );
}

function getKanataConfirmationConfig(game: GameState, ability: PendingAbilityState): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const context = getKanataLiveSuccessContext(game, ability);
  const previewText = getKanataPreviewText(context);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveKanataLiveSuccessWaitSelf(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  }
): GameState {
  const context = getKanataLiveSuccessContext(game, ability);
  const stateWithoutPending = removePendingAbility(game, ability.id);

  if (!context.willChangeToWaiting) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: context.sourceSlot,
        step: context.noOpStep,
        sourceOnStage: context.sourceOnStage,
        otherStageMemberCount: context.otherStageMemberCount,
        previousOrientation: context.sourceOrientation,
        nextOrientation: context.sourceOrientation,
      }),
      options.orderedResolution === true
    );
  }

  const waitResult = setMemberOrientation(
    stateWithoutPending,
    ability.controllerId,
    ability.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: ability.controllerId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    }
  );
  if (!waitResult) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: context.sourceSlot,
        step: 'SOURCE_NOT_ON_STAGE',
        sourceOnStage: false,
        otherStageMemberCount: context.otherStageMemberCount,
      }),
      options.orderedResolution === true
    );
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutPending,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'RESOLVE_ABILITY', ability.controllerId, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          sourceSlot: context.sourceSlot,
          step: 'WAIT_SELF_BY_OTHER_STAGE_MEMBER',
          sourceOnStage: true,
          otherStageMemberCount: context.otherStageMemberCount,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    options.orderedResolution === true
  );
}

function getKanataLiveSuccessContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceSlot: ReturnType<typeof findMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly sourceOrientation: OrientationState | null;
  readonly otherStageMemberCount: number;
  readonly willChangeToWaiting: boolean;
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const sourceOnStage = sourceSlot !== null;
  const sourceOrientation = player?.memberSlots.cardStates.get(ability.sourceCardId)?.orientation ?? null;
  const otherStageMemberCount = player
    ? Object.values(SlotPosition).filter((slot) => {
        const cardId = player.memberSlots.slots[slot];
        return Boolean(cardId && cardId !== ability.sourceCardId);
      }).length
    : 0;
  const conditionMet = sourceOnStage && otherStageMemberCount > 0;
  const willChangeToWaiting = conditionMet && sourceOrientation !== OrientationState.WAITING;
  const noOpStep = !sourceOnStage
    ? 'SOURCE_NOT_ON_STAGE'
    : otherStageMemberCount === 0
      ? 'NO_OTHER_STAGE_MEMBER'
      : 'SOURCE_ALREADY_WAITING';

  return {
    sourceSlot,
    sourceOnStage,
    sourceOrientation,
    otherStageMemberCount,
    willChangeToWaiting,
    noOpStep,
  };
}

function getKanataPreviewText(
  context: ReturnType<typeof getKanataLiveSuccessContext>
): string {
  if (!context.sourceOnStage) {
    return '此成员已不在舞台，不改变成员状态。';
  }
  if (context.otherStageMemberCount === 0) {
    return '自己的舞台没有其他成员，条件不满足，不改变成员状态。';
  }
  if (!context.willChangeToWaiting) {
    return '此成员已经是待机状态，不再产生状态变化。';
  }
  return `自己的舞台有${context.otherStageMemberCount}名其他成员；此成员当前为${formatOrientation(
    context.sourceOrientation
  )}。将此成员变为待机状态。`;
}

function formatOrientation(orientation: OrientationState | null): string {
  switch (orientation) {
    case OrientationState.ACTIVE:
      return '活跃状态';
    case OrientationState.WAITING:
      return '待机状态';
    default:
      return '未知';
  }
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
