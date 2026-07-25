import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID,
  N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForMember } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const LIVE_START_ABILITY_ID =
  N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID;
const LIVE_SUCCESS_ABILITY_ID = N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID;
const BASE_CARD_CODE = 'PL!N-bp7-026';
const SELECT_DISCARD_STEP_ID = 'N_BP7_026_SELECT_UP_TO_TWO_HAND_CARDS';
const SELECT_TARGETS_STEP_ID = 'N_BP7_026_SELECT_NIJIGASAKI_BLADE_TARGETS';
const MAX_DISCARD_COUNT = 2;
const SCORE_BONUS = 1;
const REQUIRED_NO_BLADE_HEART_MEMBER_COUNT = 2;

const nijigasakiMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));
const memberWithoutBladeHeartSelector = and(typeIs(CardType.MEMBER), not(hasBladeHeart()));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7026JustBelieveWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(LIVE_START_ABILITY_ID, (game, ability, options, context) =>
    startLiveStart(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    LIVE_START_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDiscardSelection(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    LIVE_START_ABILITY_ID,
    SELECT_TARGETS_STEP_ID,
    (game, input, context) =>
      finishTargetSelection(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects
      )
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    LIVE_SUCCESS_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveSuccessConfirmation
  );
}

function startLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const targetCardIds = getCurrentTargetCardIds(game, ability.controllerId);
  const maxDiscardCount = player
    ? Math.min(MAX_DISCARD_COUNT, player.hand.cardIds.length, targetCardIds.length)
    : 0;
  if (!player || !sourceValid || maxDiscardCount === 0) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      sourceValid ? 'NO_PAYABLE_DISCARD_AND_TARGET_PAIR' : 'SOURCE_INVALID_AT_START',
      {
        handCount: player?.hand.cardIds.length ?? 0,
        targetCardIds,
        maxDiscardCount,
      }
    );
  }

  const discardCost = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: maxDiscardCount,
    optional: true,
  } as const;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText:
        maxDiscardCount === 1
          ? '可以将至多1张手牌放置入休息室；如此做时，选择相同数量的自己舞台上的『虹咲』成员获得[ブレード]。'
          : '可以将至多2张手牌放置入休息室；如此做时，选择相同数量的自己舞台上的『虹咲』成员获得[ブレード]。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 1,
      maxSelectableCards: maxDiscardCount,
      selectionLabel: '选择要放置入休息室的卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        maxDiscardCount,
        effectCosts: [discardCost],
        handToWaitingRoomCost: {
          minCount: discardCost.minCount,
          maxCount: discardCost.maxCount,
          optional: discardCost.optional,
        },
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_UP_TO_TWO_HAND_CARDS',
      selectableCardIds: player.hand.cardIds,
      targetCardIds,
      maxDiscardCount,
    },
  });
}

function finishDiscardSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getLiveStartEffect(game, SELECT_DISCARD_STEP_ID);
  if (!effect) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!isValidSourceLive(game, player.id, effect.sourceCardId)) {
    return consumeActiveEffectNoOp(
      game,
      effect,
      continuePendingCardEffects,
      'SOURCE_INVALID_BEFORE_DISCARD'
    );
  }
  if (selectedCardIds.length === 0) {
    return consumeActiveEffectNoOp(game, effect, continuePendingCardEffects, 'DECLINE_DISCARD');
  }

  const maxDiscardCount = getInteger(effect.metadata?.maxDiscardCount);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const targetCardIds = getCurrentTargetCardIds(game, player.id);
  if (
    selectedCardIds.length !== uniqueSelectedCardIds.length ||
    selectedCardIds.length < 1 ||
    selectedCardIds.length > maxDiscardCount ||
    selectedCardIds.length > targetCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: uniqueSelectedCardIds.length,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  const paidState = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    liveCardId: effect.sourceCardId,
    step: 'DISCARD_HAND_FOR_NIJIGASAKI_BLADE',
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const currentTargetCardIds = getCurrentTargetCardIds(paidState, player.id);
  const requiredTargetCount = discardResult.discardedCardIds.length;
  if (currentTargetCardIds.length < requiredTargetCount) {
    return consumeActiveEffectNoOp(
      paidState,
      effect,
      continuePendingCardEffects,
      'INSUFFICIENT_TARGETS_AFTER_DISCARD',
      {
        discardedHandCardIds: discardResult.discardedCardIds,
        requiredTargetCount,
        targetCardIds: currentTargetCardIds,
      }
    );
  }
  if (currentTargetCardIds.length === requiredTargetCount) {
    return resolveBladeTargets(
      paidState,
      effect,
      currentTargetCardIds,
      discardResult.discardedCardIds,
      continuePendingCardEffects
    );
  }

  return {
    ...paidState,
    activeEffect: {
      ...effect,
      stepId: SELECT_TARGETS_STEP_ID,
      stepText: `请选择${requiredTargetCount}名自己舞台上的『虹咲』成员获得[ブレード]。`,
      selectableCardIds: currentTargetCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: requiredTargetCount > 1 ? 'ORDERED_MULTI' : 'SINGLE',
      minSelectableCards: requiredTargetCount,
      maxSelectableCards: requiredTargetCount,
      selectionLabel: '选择获得[ブレード]的成员',
      confirmSelectionLabel: '获得[ブレード]',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        discardedHandCardIds: discardResult.discardedCardIds,
        targetCardIds: currentTargetCardIds,
        requiredTargetCount,
      },
    },
  };
}

function finishTargetSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getLiveStartEffect(game, SELECT_TARGETS_STEP_ID);
  if (!effect) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!isValidSourceLive(game, player.id, effect.sourceCardId)) {
    return consumeActiveEffectNoOp(
      game,
      effect,
      continuePendingCardEffects,
      'SOURCE_INVALID_BEFORE_TARGET_RESOLUTION'
    );
  }

  const requiredTargetCount = getInteger(effect.metadata?.requiredTargetCount);
  const currentTargetCardIds = getCurrentTargetCardIds(game, player.id);
  if (currentTargetCardIds.length < requiredTargetCount) {
    return consumeActiveEffectNoOp(
      game,
      effect,
      continuePendingCardEffects,
      'INSUFFICIENT_TARGETS_BEFORE_TARGET_RESOLUTION'
    );
  }
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    requiredTargetCount <= 0 ||
    selectedCardIds.length !== uniqueSelectedCardIds.length ||
    selectedCardIds.length !== requiredTargetCount ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !currentTargetCardIds.includes(cardId)
    )
  ) {
    return game;
  }

  return resolveBladeTargets(
    game,
    effect,
    uniqueSelectedCardIds,
    getStringArray(effect.metadata?.discardedHandCardIds),
    continuePendingCardEffects
  );
}

function resolveBladeTargets(
  game: GameState,
  effect: ActiveEffectState,
  targetCardIds: readonly string[],
  discardedHandCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  if (!isValidSourceLive(game, effect.controllerId, effect.sourceCardId)) {
    return consumeActiveEffectNoOp(
      game,
      effect,
      continuePendingCardEffects,
      'SOURCE_INVALID_BEFORE_BLADE'
    );
  }
  const currentTargetCardIdSet = new Set(getCurrentTargetCardIds(game, effect.controllerId));
  if (
    targetCardIds.length === 0 ||
    new Set(targetCardIds).size !== targetCardIds.length ||
    targetCardIds.some((cardId) => !currentTargetCardIdSet.has(cardId))
  ) {
    return game;
  }

  let state = game;
  for (const memberCardId of targetCardIds) {
    const result = addBladeLiveModifierForMember(state, {
      playerId: effect.controllerId,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      countDelta: 1,
    });
    if (!result) return game;
    state = result.gameState;
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_AND_TARGET_NIJIGASAKI_MEMBERS_GAIN_BLADE',
      discardedHandCardIds,
      targetMemberCardIds: targetCardIds,
      bladeBonusPerMember: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getLiveSuccessConfirmation(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const evaluation = evaluateLiveSuccess(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前公开的不持有BLADE HEART的成员卡${evaluation.matchingCardIds.length}张；${
      evaluation.conditionMet ? '满足条件，实际此卡[スコア]+1' : '未满足条件，实际不增加[スコア]'
    }。）`,
    stepText: '确认后结算此效果。',
  };
}

function resolveLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const evaluation = evaluateLiveSuccess(game, ability);
  const stateWithoutPending = removePendingAbility(game, ability.id);
  const scoreBonus = evaluation.conditionMet ? SCORE_BONUS : 0;
  const stateAfterScore = evaluation.sourceValid
    ? replaceScoreModifierAndRefresh(stateWithoutPending, ability, scoreBonus)
    : stateWithoutPending;
  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet ? 'TWO_NO_BLADE_HEART_MEMBERS_SCORE' : 'CONDITION_NOT_MET',
      matchingCardIds: evaluation.matchingCardIds,
      matchingCount: evaluation.matchingCardIds.length,
      conditionMet: evaluation.conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function evaluateLiveSuccess(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceValid: boolean;
  readonly matchingCardIds: readonly string[];
  readonly conditionMet: boolean;
} {
  const sourceValid = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const matchingCardIds = sourceValid
    ? [
        ...new Set(
          selectCurrentLiveRevealedCheerCardIds(game, ability.controllerId, {
            cardTypes: CardType.MEMBER,
            predicate: memberWithoutBladeHeartSelector,
          })
        ),
      ]
    : [];
  return {
    sourceValid,
    matchingCardIds,
    conditionMet: sourceValid && matchingCardIds.length >= REQUIRED_NO_BLADE_HEART_MEMBER_COUNT,
  };
}

function getCurrentTargetCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMemberSelector);
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === player.id &&
    isLiveCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  ability: Pick<PendingAbilityState, 'abilityId' | 'controllerId' | 'sourceCardId'>,
  scoreBonus: number
): GameState {
  const matches = (modifier: LiveModifierState) =>
    modifier.kind === 'SCORE' &&
    modifier.playerId === ability.controllerId &&
    modifier.liveCardId === ability.sourceCardId &&
    modifier.sourceCardId === ability.sourceCardId &&
    modifier.abilityId === ability.abilityId;
  const previousScoreBonus = game.liveResolution.liveModifiers
    .filter(matches)
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: ability.controllerId,
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    replacement
  );
  const scoreDelta = scoreBonus - previousScoreBonus;
  if (scoreDelta === 0) return state;
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(
    ability.controllerId,
    (playerScores.get(ability.controllerId) ?? 0) + scoreDelta
  );
  return {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      playerScores,
    },
  };
}

function getLiveStartEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === LIVE_START_ABILITY_ID && effect.stepId === stepId ? effect : null;
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      ...payload,
    }),
    orderedResolution
  );
}

function consumeActiveEffectNoOp(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function getInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}
