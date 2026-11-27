import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { hasAtLeastDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { memberOriginalBladeLte } from '../../../effects/stage-targets.js';
import { hasWaitingRoomSelectionReenteredAfter } from '../../../effects/waiting-room-selection-lifecycle.js';
import { S_PB2_026_ON_ENTER_BOTTOM_THREE_GUILTY_KISS_WAIT_OPPONENT_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  payPrivateOrderedWaitingRoomBottomCost,
  PRIVATE_ORDERED_WAITING_ROOM_BOTTOM_CONFIRMATION,
} from '../../runtime/private-ordered-waiting-room-bottom-cost.js';
import {
  createPublicCardSelectionConfirmationWindowForCardIds,
  wasRestoredAfterPublicCardSelectionConfirmation,
} from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const COST_STEP = 'S_PB2_026_BOTTOM_GUILTY_KISS_MEMBERS';
const WAIT_STEP = 'S_PB2_026_WAIT_ORIGINAL_BLADE_TWO_MEMBER';
const COST_COUNT = 3;
const member = typeIs(CardType.MEMBER);
const originalBladeAtMostTwo = memberOriginalBladeLte(2);
const guiltyKissMember = and(member, unitAliasIs('Guilty Kiss'));
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Source = Pick<PendingAbilityState, 'id' | 'sourceCardId' | 'controllerId'>;

export function registerSPb2026MariWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(ABILITY, (game, ability, options, context) =>
    startCost(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY,
    COST_STEP,
    (game, input, context) =>
      payCost(game, input.selectedCardIds ?? [], context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY,
    WAIT_STEP,
    (game, input, context) =>
      waitOpponentMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryCardSelection
  );
}

function getCostCandidates(game: GameState, playerId: string): readonly string[] {
  return (
    getPlayerById(game, playerId)?.waitingRoom.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card?.ownerId === playerId && guiltyKissMember(card);
    }) ?? []
  );
}

function hasThreeDifferentNames(game: GameState, ids: readonly string[]): boolean {
  return hasAtLeastDifferentNamedCards(ids, COST_COUNT, (id) => getCardById(game, id)?.data, {
    nameComparison: 'MEMBER_IDENTITY',
  });
}

function startCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuation: Continue
): GameState {
  const candidates = getCostCandidates(game, ability.controllerId);
  if (!hasThreeDifferentNames(game, candidates)) {
    return continuation(
      recordResolution(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((entry) => entry.id !== ability.id),
        },
        ability,
        'NO_THREE_DIFFERENT_GUILTY_KISS_MEMBERS'
      ),
      orderedResolution
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      awaitingPlayerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY),
      stepId: COST_STEP,
      stepText: '可以按放置顺序选择休息室中3张名称各不相同的『Guilty Kiss』成员卡。',
      selectableCardIds: candidates,
      selectableCardMode: 'ORDERED_MULTI',
      selectableCardVisibility: 'PUBLIC',
      minSelectableCards: COST_COUNT,
      maxSelectableCards: COST_COUNT,
      selectionLabel: '按放置顺序选择3张不同名的成员卡',
      confirmSelectionLabel: '支付费用',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        waitingSelectionSequence: game.eventLog.at(-1)?.sequence ?? 0,
      },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_GUILTY_KISS_BOTTOM_COST' },
  });
}

function payCost(game: GameState, ids: readonly string[], continuation: Continue): GameState {
  const effect = getCardActiveEffect(game);
  if (effect?.stepId !== COST_STEP) return game;
  const ordered = effect.metadata?.orderedResolution === true;
  if (ids.length === 0) {
    return continuation(recordResolution(game, effect, 'DECLINE_GUILTY_KISS_BOTTOM_COST'), ordered);
  }
  if (
    ids.length !== COST_COUNT ||
    new Set(ids).size !== COST_COUNT ||
    !hasThreeDifferentNames(game, ids)
  ) {
    return game;
  }
  const candidates = new Set(getCostCandidates(game, effect.controllerId));
  const restored = wasRestoredAfterPublicCardSelectionConfirmation(effect);
  if (
    ids.some((id) => !candidates.has(id) || !effect.selectableCardIds?.includes(id)) ||
    hasWaitingRoomSelectionReenteredAfter(game, ids, effect.metadata?.waitingSelectionSequence)
  ) {
    return restored
      ? continuation(recordResolution(game, effect, 'STALE_GUILTY_KISS_BOTTOM_COST'), ordered)
      : game;
  }
  if (!restored) {
    return (
      createPublicCardSelectionConfirmationWindowForCardIds(
        game,
        effect,
        { selectedCardIds: ids },
        PRIVATE_ORDERED_WAITING_ROOM_BOTTOM_CONFIRMATION,
        ids
      ) ?? game
    );
  }
  const payment = payPrivateOrderedWaitingRoomBottomCost(game, effect, ids, {
    candidateCardIds: effect.selectableCardIds ?? [],
    minCount: COST_COUNT,
    maxCount: COST_COUNT,
  });
  return payment ? startWaitTarget(payment.gameState, effect, continuation) : game;
}

function startWaitTarget(game: GameState, effect: ActiveEffectState, continuation: Continue) {
  const opponent = getOpponent(game, effect.controllerId);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const target =
    opponent &&
    createStageMemberOrientationTargetSelection(game, {
      ability: effect,
      effectText: effect.effectText,
      stepId: WAIT_STEP,
      stepText: '请选择对方舞台上1名原本持有的[ブレード]数量小于等于2的成员变为待机状态。',
      awaitingPlayerId: effect.controllerId,
      targetPlayerId: opponent.id,
      selector: member,
      statePredicate: originalBladeAtMostTwo,
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
      orderedResolution,
    });
  if (!target?.activeEffect) {
    return continuation(
      recordResolution(game, effect, 'NO_OPPONENT_TARGET_AFTER_COST'),
      orderedResolution
    );
  }
  return {
    ...game,
    activeEffect: {
      ...target.activeEffect,
      sourceLifecycleId: effect.sourceLifecycleId,
      metadata: {
        ...target.activeEffect.metadata,
        targetLifecycles: Object.fromEntries(
          target.selectableCardIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    },
  };
}

function waitOpponentMember(
  game: GameState,
  targetId: string | null,
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = getCardActiveEffect(game);
  if (
    effect?.stepId !== WAIT_STEP ||
    targetId === null ||
    !effect.selectableCardIds?.includes(targetId)
  ) {
    return game;
  }
  const opponent = getOpponent(game, effect.controllerId);
  const lifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  const change =
    opponent &&
    lifecycles?.[targetId] === getStageMemberLifecycleId(game, targetId) &&
    originalBladeAtMostTwo(game, opponent.id, targetId)
      ? resolveStageMemberOrientationTargetSelection(game, effect, targetId)
      : null;
  const ordered = effect.metadata?.orderedResolution === true;
  if (!change?.changed) {
    return continuation(
      recordResolution(game, effect, 'STALE_OPPONENT_TARGET_AFTER_COST'),
      ordered
    );
  }
  const result = enqueueMemberStateChangedTriggersFromOrientationResult(game, change, enqueue, {
    prepareGameStateBeforeEnqueue: (state) =>
      recordResolution(state, effect, 'WAIT_OPPONENT_MEMBER_AFTER_COST', targetId),
  });
  return continuation(result.gameState, ordered);
}

function recordResolution(game: GameState, source: Source, step: string, targetCardId?: string) {
  return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', source.controllerId, {
    abilityId: ABILITY,
    pendingAbilityId: source.id,
    sourceCardId: source.sourceCardId,
    step,
    ...(targetCardId ? { targetCardId } : {}),
  });
}
