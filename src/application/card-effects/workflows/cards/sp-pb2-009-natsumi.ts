import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberOriginalBladeCount } from '../../../../domain/rules/live-modifiers.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { memberOriginalBladeLte } from '../../../effects/stage-targets.js';
import {
  SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
  SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_LIELLA_MEMBER_STEP_ID = 'SP_PB2_009_SELECT_LIELLA_MEMBER_TO_WAIT';
const SELECT_OPPONENT_MEMBER_STEP_ID = 'SP_PB2_009_SELECT_OPPONENT_LOWER_BLADE_MEMBER_TO_WAIT';

const SP_PB2_009_ABILITY_IDS = [
  SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
  SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const memberSelector = typeIs(CardType.MEMBER);
const liellaMemberSelector = and(memberSelector, groupAliasIs('Liella!'));

export function registerSpPb2009NatsumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of SP_PB2_009_ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startSpPb2009NatsumiWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_LIELLA_MEMBER_STEP_ID, (game, input, context) =>
      finishSelectLiellaMemberToWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_OPPONENT_MEMBER_STEP_ID, (game, input, context) =>
      finishSelectOpponentMemberToWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startSpPb2009NatsumiWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_LIELLA_MEMBER_STEP_ID,
    stepText:
      '可以将自己舞台上的1名『Liella!』成员变为待机状态。若如此做，将按该成员原本 BLADE 选择对方成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: player.id,
    selector: liellaMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的 Liella! 成员',
    orderedResolution,
    metadata: {
      sourceSlot: ability.sourceSlot,
      opponentPlayerId: opponent.id,
    },
  });

  if (targetSelection.activeEffect === null) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NO_LIELLA_MEMBER_OR_OPPONENT_TARGET',
        sourceSlot: ability.sourceSlot,
        opponentPlayerId: opponent.id,
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...trackWaitTargetLifecycles(game, targetSelection.activeEffect),
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LIELLA_MEMBER_TO_WAIT',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: targetSelection.selectableCardIds,
      opponentPlayerId: opponent.id,
    },
  });
}

function finishSelectLiellaMemberToWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = getCardActiveEffect(game);
  if (!effect || effect.stepId !== SELECT_LIELLA_MEMBER_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponentPlayerId =
    typeof effect.metadata?.opponentPlayerId === 'string' ? effect.metadata.opponentPlayerId : null;
  if (!player || !opponentPlayerId) {
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
        step: 'DECLINE_WAIT_LIELLA_MEMBER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const waitedCard = getCardById(game, selectedCardId);
  if (
    !waitedCard ||
    !liellaMemberSelector(waitedCard) ||
    !isSameWaitTarget(game, effect, selectedCardId)
  ) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!orientationChange?.changed) {
    return game;
  }
  const originalBladeAfterPayment = getMemberOriginalBladeCount(
    orientationChange.gameState,
    player.id,
    selectedCardId
  );

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
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_LIELLA_MEMBER',
            waitedLiellaMemberId: selectedCardId,
            // Preserve the historical payload field for the original BLADE used at payment.
            waitedLiellaPrintedBlade: originalBladeAfterPayment,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  const nextState = stateWithMemberStateTriggers.gameState;
  const opponentSelection = createStageMemberOrientationTargetSelection(nextState, {
    ability: effect,
    effectText: effect.effectText,
    stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText:
      '请选择对方舞台上1名原本 BLADE 比待机的 Liella! 成员少2个以上的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponentPlayerId,
    selector: memberSelector,
    statePredicate: memberOriginalBladeLte(originalBladeAfterPayment - 2),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方原本 BLADE 较少的成员',
    orderedResolution: effect.metadata?.orderedResolution === true,
    metadata: {
      waitedLiellaMemberId: selectedCardId,
      waitedLiellaPrintedBlade: originalBladeAfterPayment,
    },
  });
  if (opponentSelection.activeEffect === null) {
    return continuePendingCardEffects(
      addAction(nextState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_NO_OPPONENT_TARGET_AFTER_WAIT_LIELLA_MEMBER',
        waitedLiellaMemberId: selectedCardId,
        waitedLiellaPrintedBlade: originalBladeAfterPayment,
        opponentPlayerId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...nextState,
    activeEffect: {
      ...trackWaitTargetLifecycles(nextState, opponentSelection.activeEffect),
      selectableCardVisibility: 'PUBLIC',
    },
  };
}

function finishSelectOpponentMemberToWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = getCardActiveEffect(game);
  if (!effect || effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const targetPlayerId = effect.metadata?.targetPlayerId;
  const originalBladeAtPayment = effect.metadata?.waitedLiellaPrintedBlade;
  const orientationChange =
    typeof targetPlayerId === 'string' &&
    typeof originalBladeAtPayment === 'number' &&
    isSameWaitTarget(game, effect, selectedCardId) &&
    getMemberOriginalBladeCount(game, targetPlayerId, selectedCardId) <= originalBladeAtPayment - 2
      ? resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId)
      : null;
  if (!orientationChange?.changed) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_OPPONENT_TARGET_UNAVAILABLE',
        waitedLiellaMemberId: effect.metadata?.waitedLiellaMemberId ?? null,
        waitedLiellaPrintedBlade: effect.metadata?.waitedLiellaPrintedBlade ?? null,
        targetCardId: selectedCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
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
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_OPPONENT_LOWER_PRINTED_BLADE_MEMBER',
            waitedLiellaMemberId: effect.metadata?.waitedLiellaMemberId ?? null,
            waitedLiellaPrintedBlade: effect.metadata?.waitedLiellaPrintedBlade ?? null,
            targetPlayerId: effect.metadata?.targetPlayerId ?? null,
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

function trackWaitTargetLifecycles(
  game: GameState,
  effect: ActiveEffectState
): ActiveEffectState {
  return {
    ...effect,
    metadata: {
      ...effect.metadata,
      targetLifecycles: Object.fromEntries(
        (effect.selectableCardIds ?? []).map((id) => [id, getStageMemberLifecycleId(game, id)])
      ),
    },
  };
}

function isSameWaitTarget(
  game: GameState,
  effect: ActiveEffectState,
  cardId: string
): boolean {
  const lifecycles = effect.metadata?.targetLifecycles as
    | Readonly<Record<string, string>>
    | undefined;
  return lifecycles === undefined || lifecycles[cardId] === getStageMemberLifecycleId(game, cardId);
}
