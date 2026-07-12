import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, ZoneType } from '../../../../shared/types/enums.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID,
  PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID,
} from '../../ability-ids.js';
import {
  drawCardsForPlayer,
  moveWaitingRoomCardsToDeckTopForPlayer,
} from '../../runtime/actions.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_OPPONENT_LOW_COST_MEMBER_STEP_ID =
  'PL_N_BP4_004_SELECT_OPPONENT_LOW_COST_MEMBER_TO_WAIT';
const SELECT_NIJIGASAKI_MEMBERS_STEP_ID = 'PL_N_BP4_004_SELECT_NIJIGASAKI_MEMBERS_TO_DECK_TOP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const lowCostMemberSelector = and(typeIs(CardType.MEMBER), costLte(9));
const nijigasakiMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

export function registerNBp4004KarinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startKarinDrawWaitLowCostOpponentMember(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID,
    SELECT_OPPONENT_LOW_COST_MEMBER_STEP_ID,
    (game, input, context) =>
      finishKarinOpponentWaitSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID,
    (game, ability, options, context) =>
      startKarinStackNijigasakiMembers(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID,
    SELECT_NIJIGASAKI_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishKarinStackNijigasakiMembers(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects
      )
  );
}

function startKarinDrawWaitLowCostOpponentMember(
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

  const drawResult = drawCardsForPlayer(game, player.id, 1);
  if (!drawResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...drawResult.gameState,
    pendingAbilities: drawResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  const targetSelection = createStageMemberOrientationTargetSelection(stateWithoutPending, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_OPPONENT_LOW_COST_MEMBER_STEP_ID,
    stepText: '可以选择对方舞台上1名费用小于等于9的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponent.id,
    selector: lowCostMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方费用小于等于9的成员',
    orderedResolution,
    metadata: {
      sourceSlot: ability.sourceSlot,
      drawnCardIds: drawResult.drawnCardIds,
    },
  });

  if (targetSelection.activeEffect === null) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'DRAW_ONE_NO_LOW_COST_OPPONENT_MEMBER_TARGET',
        drawnCardIds: drawResult.drawnCardIds,
        targetPlayerId: opponent.id,
      }),
      orderedResolution
    );
  }

  const activeEffect: ActiveEffectState = {
    ...targetSelection.activeEffect,
    canSkipSelection: true,
    confirmSelectionLabel: '变为待机',
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
      step: 'DRAW_ONE_SELECT_LOW_COST_OPPONENT_MEMBER',
      drawnCardIds: drawResult.drawnCardIds,
      targetPlayerId: opponent.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishKarinOpponentWaitSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_LOW_COST_MEMBER_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DRAW_ONE_SKIP_WAIT_OPPONENT_MEMBER',
        drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
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
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'DRAW_ONE_WAIT_OPPONENT_LOW_COST_MEMBER',
          drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
          targetPlayerId: targetMetadata.targetPlayerId,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function startKarinStackNijigasakiMembers(
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

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const opponentWaitingMemberIds = getWaitingStageMemberIds(stateWithoutPending, opponent.id);
  const maxCount = opponentWaitingMemberIds.length;
  const selectableCardIds = selectWaitingRoomCardIds(
    stateWithoutPending,
    player.id,
    nijigasakiMemberSelector
  );

  if (maxCount === 0 || selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: maxCount === 0 ? 'NO_OPPONENT_WAITING_MEMBER' : 'NO_NIJIGASAKI_MEMBER_CANDIDATE',
        opponentWaitingMemberIds,
        selectableCardIds,
      }),
      orderedResolution
    );
  }

  const selectableCount = Math.min(maxCount, selectableCardIds.length);
  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_NIJIGASAKI_MEMBERS_STEP_ID,
        stepText: `请选择至多${selectableCount}张自己休息室的「虹ヶ咲」成员卡，按选择顺序放置于卡组顶。`,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: selectableCount,
        selectionLabel: '选择要置顶的虹咲成员',
        confirmSelectionLabel: '放到卡组顶',
        canSkipSelection: true,
        metadata: {
          publicCardSelectionConfirmation: {
            destination: 'MAIN_DECK_TOP',
            ordered: true,
          },
          orderedResolution,
          sourceZone: ZoneType.WAITING_ROOM,
          destination: ZoneType.MAIN_DECK,
          opponentWaitingMemberIds,
          maxSelectableCards: selectableCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_NIJIGASAKI_MEMBERS_TO_DECK_TOP',
      opponentWaitingMemberIds,
      selectableCardIds,
      maxSelectableCards: selectableCount,
    }
  );
}

function finishKarinStackNijigasakiMembers(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID ||
    effect.stepId !== SELECT_NIJIGASAKI_MEMBERS_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const maxSelectableCards = getNumberMetadata(effect.metadata?.maxSelectableCards) ?? 0;
  const candidateCardIds = effect.selectableCardIds ?? [];
  const selectedCardIdSet = new Set(selectedCardIds);
  const validSelection =
    selectedCardIdSet.size === selectedCardIds.length &&
    selectedCardIds.length <= maxSelectableCards &&
    selectedCardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return (
        candidateCardIds.includes(cardId) &&
        player.waitingRoom.cardIds.includes(cardId) &&
        card !== null &&
        nijigasakiMemberSelector(card)
      );
    });
  if (!validSelection) {
    return game;
  }

  const moveResult = moveWaitingRoomCardsToDeckTopForPlayer(game, player.id, selectedCardIds, {
    candidateCardIds,
    minCount: 0,
    maxCount: maxSelectableCards,
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        selectedCardIds.length === 0
          ? 'SKIP_STACK_NIJIGASAKI_MEMBERS'
          : 'STACK_NIJIGASAKI_MEMBERS_TO_DECK_TOP',
      selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      opponentWaitingMemberIds: getStringArrayMetadata(effect.metadata?.opponentWaitingMemberIds),
      maxSelectableCards,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitingStageMemberIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).filter(
    (cardId) => player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
