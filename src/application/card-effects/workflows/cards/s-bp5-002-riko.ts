import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, memberPrintedBladeLte, typeIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_S_BP5_002_LIVE_START_CENTER_EQUAL_SIDE_COSTS_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const lowOriginalBladeMemberSelector = and(typeIs(CardType.MEMBER), memberPrintedBladeLte(3));

interface RikoSideCostState {
  readonly sourceSlot: SlotPosition | null;
  readonly leftMemberCardId: string | null;
  readonly rightMemberCardId: string | null;
  readonly leftCost: number | null;
  readonly rightCost: number | null;
  readonly sideCostsEqual: boolean;
  readonly opponentTargetCardIds: readonly string[];
  readonly actualWaitingTargetCardIds: readonly string[];
}

export function registerSBp5002RikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_S_BP5_002_LIVE_START_CENTER_EQUAL_SIDE_COSTS_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveRikoLiveStartWaitOpponentLowOriginalBladeMembers(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    getRikoLiveStartConfirmationConfig
  );
}

function resolveRikoLiveStartWaitOpponentLowOriginalBladeMembers(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const current = getRikoSideCostState(game, ability);
  if (current.sourceSlot !== SlotPosition.CENTER) {
    return consumePendingNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_CENTER',
      ...current,
    });
  }
  if (current.leftCost === null || current.rightCost === null) {
    return consumePendingNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'MISSING_SIDE_MEMBER',
      ...current,
    });
  }
  if (!current.sideCostsEqual) {
    return consumePendingNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SIDE_COSTS_NOT_EQUAL',
      ...current,
    });
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const orientationChange = setMembersOrientation(
    stateWithoutPending,
    getOpponent(game, player.id)?.id ?? '',
    current.opponentTargetCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!orientationChange) {
    return consumePendingNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OPPONENT',
      ...current,
    });
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutPending,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'WAIT_OPPONENT_LOW_ORIGINAL_BLADE_MEMBERS',
          ...current,
          targetCardIds: current.opponentTargetCardIds,
          actualWaitingTargetCardIds: current.actualWaitingTargetCardIds,
          previousOrientations: result.previousOrientations,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}

function getRikoLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string; readonly stepText: string } {
  const current = getRikoSideCostState(game, ability);
  const leftCost = current.leftCost === null ? '无成员' : `${current.leftCost}`;
  const rightCost = current.rightCost === null ? '无成员' : `${current.rightCost}`;
  const statusText =
    current.sourceSlot !== SlotPosition.CENTER
      ? '来源不在 CENTER，确认后不处理。'
      : current.leftCost === null || current.rightCost === null
        ? `左侧费用 ${leftCost}，右侧费用 ${rightCost}，缺少侧区成员，确认后不处理。`
        : `左侧费用 ${leftCost}，右侧费用 ${rightCost}，${
            current.sideCostsEqual ? '费用相同' : '费用不同'
          }；合法目标 ${current.opponentTargetCardIds.length}名，实际会变为WAITING ${
            current.actualWaitingTargetCardIds.length
          }名。`;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前${statusText}）`,
    stepText: statusText,
  };
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getRikoSideCostState(game: GameState, ability: PendingAbilityState): RikoSideCostState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const leftMemberCardId = player?.memberSlots.slots[SlotPosition.LEFT] ?? null;
  const rightMemberCardId = player?.memberSlots.slots[SlotPosition.RIGHT] ?? null;
  const leftCost =
    player && leftMemberCardId ? getMemberEffectiveCost(game, player.id, leftMemberCardId) : null;
  const rightCost =
    player && rightMemberCardId ? getMemberEffectiveCost(game, player.id, rightMemberCardId) : null;
  const sideCostsEqual = leftCost !== null && rightCost !== null && leftCost === rightCost;
  const opponentTargetCardIds = opponent
    ? getStageMemberCardIdsMatching(game, opponent.id, lowOriginalBladeMemberSelector)
    : [];
  const actualWaitingTargetCardIds = opponent
    ? opponentTargetCardIds.filter(
        (cardId) =>
          opponent.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
      )
    : [];
  return {
    sourceSlot,
    leftMemberCardId,
    rightMemberCardId,
    leftCost,
    rightCost,
    sideCostsEqual,
    opponentTargetCardIds,
    actualWaitingTargetCardIds,
  };
}
