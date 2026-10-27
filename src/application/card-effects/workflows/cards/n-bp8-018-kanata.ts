import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  and,
  costGte,
  groupAliasIs,
  hasBladeHeart,
  not,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { N_BP8_018_LIVE_START_REVEAL_HIGH_COST_NIJIGASAKI_HAND_BOTTOM_WAIT_OPPONENT_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { moveHandCardToDeckBottomForPlayer } from '../../runtime/actions.js';
import {
  finishSkippedActiveEffect,
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { queryCardSelection, queryConfirmSelection } from '../../runtime/selection-query.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const REVEAL = 'N_BP8_018_REVEAL_HAND_MEMBER';
const BOTTOM = 'N_BP8_018_PLACE_REVEALED_MEMBER_BOTTOM';
const TARGET = 'N_BP8_018_WAIT_OPPONENT_MEMBER';
const COST_MEMBER = and(
  typeIs(CardType.MEMBER),
  groupAliasIs('虹ヶ咲'),
  costGte(11),
  not(hasBladeHeart())
);
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp8018KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    REVEAL,
    (game, input, context) =>
      input.selectedCardId
        ? reveal(game, input.selectedCardId)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    BOTTOM,
    (game, _input, context) => placeBottom(game, context.continuePendingCardEffects),
    queryConfirmSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    TARGET,
    (game, input, context) =>
      waitTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryCardSelection
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuation: Continue
): GameState {
  const ordered = options.orderedResolution === true;
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = player.hand.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card?.ownerId === player.id && COST_MEMBER(card);
  });
  if (selectableCardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      stepText: '当前手牌没有可公开作为费用的成员卡，本次不发动。',
    });
    if (confirmation) return confirmation;
    return continuation(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'NO_REVEAL_COST',
        }
      ),
      ordered
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: REVEAL,
      stepText:
        '可以公开手牌中1张费用大于等于11且不持有BLADE HEART的『虹咲』成员卡以发动。展示结束后将其放置于卡组底，再将对方1名费用小于等于11的成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要公开的手牌成员卡',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution: ordered },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_REVEAL_HAND_COST' },
  });
}

function reveal(game: GameState, id: string): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const card = getCardById(game, id);
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== REVEAL ||
    !player ||
    !card ||
    !effect.selectableCardIds?.includes(id) ||
    !player.hand.cardIds.includes(id) ||
    card.ownerId !== player.id ||
    !COST_MEMBER(card)
  )
    return game;
  const state = revealHandCardForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardId: id,
    nextStepId: BOTTOM,
    nextStepText: '已公开所选成员卡。展示结束后将其放置于卡组底，再选择对方的成员变为待机状态。',
    canSkipSelection: false,
    metadata: { revealedCostCardId: id },
    actionStep: 'REVEAL_HAND_MEMBER_AS_COST',
    actionPayload: { revealedCardIds: [id] },
  });
  return state === game
    ? game
    : recordPayCostAction(state, player.id, {
        pendingAbilityId: effect.id,
        abilityId: ABILITY_ID,
        sourceCardId: effect.sourceCardId,
        revealedCardIds: [id],
      });
}

function placeBottom(game: GameState, continuation: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== BOTTOM) return game;
  const id = effect.metadata?.revealedCostCardId;
  if (typeof id !== 'string') return game;
  const card = getCardById(game, id);
  const moved =
    card?.ownerId === effect.controllerId
      ? moveHandCardToDeckBottomForPlayer(game, effect.controllerId, id, { candidateCardIds: [id] })
      : null;
  // The reveal already paid the cost. The following wait does not depend on a successful move.
  const state = addAction(moved?.gameState ?? game, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'PLACE_REVEALED_MEMBER_BOTTOM',
    movedCardIds: moved ? [id] : [],
  });
  return openTarget(state, effect, continuation);
}

function targetSelection(game: GameState, effect: ActiveEffectState) {
  const opponent = getOpponent(game, effect.controllerId);
  if (!opponent) return null;
  return createStageMemberOrientationTargetSelection(game, {
    ability: {
      id: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
      eventIds: [],
    },
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: TARGET,
    stepText: '请选择对方舞台上1名费用小于等于11的成员变为待机状态。',
    awaitingPlayerId: effect.controllerId,
    targetPlayerId: opponent.id,
    selector: typeIs(CardType.MEMBER),
    statePredicate: (state, playerId, id) => getMemberEffectiveCost(state, playerId, id) <= 11,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的成员',
    confirmSelectionLabel: '变为待机状态',
    orderedResolution: effect.metadata?.orderedResolution === true,
  });
}

function openTarget(game: GameState, effect: ActiveEffectState, continuation: Continue): GameState {
  const selection = targetSelection(game, effect);
  if (!selection?.activeEffect) return finish(game, effect, continuation, 'NO_OPPONENT_TARGET');
  return {
    ...game,
    activeEffect: {
      ...effect,
      ...selection.activeEffect,
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
      revealedCardIds: undefined,
      metadata: {
        ...selection.activeEffect.metadata,
        targetLifecycles: Object.fromEntries(
          selection.selectableCardIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    },
  };
}

function waitTarget(
  game: GameState,
  id: string | null,
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== TARGET ||
    !id ||
    !effect.selectableCardIds?.includes(id)
  )
    return game;
  const current = targetSelection(game, effect);
  const lifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  if (
    !current?.selectableCardIds.includes(id) ||
    lifecycles?.[id] !== getStageMemberLifecycleId(game, id)
  ) {
    return current?.activeEffect
      ? openTarget(game, effect, continuation)
      : finish(game, effect, continuation, 'STALE_NO_OPPONENT_TARGET');
  }
  const result = resolveStageMemberOrientationTargetSelection(game, effect, id);
  if (!result?.changed) return finish(game, effect, continuation, 'TARGET_NOT_WAITED');
  const triggered = enqueueMemberStateChangedTriggersFromOrientationResult(game, result, enqueue, {
    prepareGameStateBeforeEnqueue: (state) =>
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: ABILITY_ID,
        sourceCardId: effect.sourceCardId,
        step: 'WAIT_OPPONENT_MEMBER',
        targetMemberCardId: id,
      }),
  });
  return continuation(triggered.gameState, effect.metadata?.orderedResolution === true);
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  continuation: Continue,
  step: string
): GameState {
  return continuation(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}
