import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import {
  LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { cardNameAliasAny } from '../../../effects/card-selectors.js';
import { getCardIdsMatchingSelector } from '../../../effects/conditions.js';

export const SELECT_NAMED_HAND_DISCARD_STEP_ID = 'SELECT_NAMED_HAND_DISCARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface NamedHandDiscardLiveStartConfig {
  readonly abilityId: string;
  readonly names: readonly string[];
  readonly minCount: number;
  readonly maxCount?: number;
  readonly rewardKind: 'SCORE' | 'BLADE_PER_DISCARDED';
  readonly rewardAmount?: number;
}

const NAMED_HAND_DISCARD_LIVE_START_CONFIGS: readonly NamedHandDiscardLiveStartConfig[] = [
  {
    abilityId: LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
    names: ['上原歩夢', '澁谷かのん', '日野下花帆'],
    minCount: 3,
    maxCount: 3,
    rewardKind: 'SCORE',
    rewardAmount: 3,
  },
  {
    abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
    names: ['渡辺曜', '鬼塚夏美', '大沢瑠璃乃'],
    minCount: 0,
    rewardKind: 'BLADE_PER_DISCARDED',
  },
];

export function registerNamedHandDiscardLiveStartWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of NAMED_HAND_DISCARD_LIVE_START_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startNamedHandDiscardLiveStartEffect(
        game,
        ability,
        options.orderedResolution === true,
        config
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_NAMED_HAND_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardIds
          ? finishNamedHandDiscardLiveStartEffect(
              game,
              input.selectedCardIds,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
  }
}

function startNamedHandDiscardLiveStartEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: NamedHandDiscardLiveStartConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getNamedHandDiscardCandidateIds(game, player.id, config.names);
  const maxSelectableCards = Math.min(
    config.maxCount ?? selectableCardIds.length,
    selectableCardIds.length
  );

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: SELECT_NAMED_HAND_DISCARD_STEP_ID,
      stepText: '选择要作为费用放置入休息室的指定姓名手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: config.minCount,
      maxSelectableCards,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        namedHandDiscardNames: [...config.names],
        namedHandDiscardRewardKind: config.rewardKind,
        namedHandDiscardRewardAmount: config.rewardAmount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NAMED_HAND_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
      minSelectableCards: config.minCount,
      maxSelectableCards,
    },
  });
}

function finishNamedHandDiscardLiveStartEffect(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const minCount = effect?.minSelectableCards ?? 0;
  const maxCount = effect?.maxSelectableCards ?? 0;
  if (
    !effect ||
    !player ||
    effect.stepId !== SELECT_NAMED_HAND_DISCARD_STEP_ID ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length < minCount ||
    uniqueSelectedCardIds.length > maxCount ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
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
  if (!discardResult) {
    return game;
  }

  const rewardKind =
    effect.metadata?.namedHandDiscardRewardKind === 'SCORE'
      ? 'SCORE'
      : effect.metadata?.namedHandDiscardRewardKind === 'BLADE_PER_DISCARDED'
        ? 'BLADE_PER_DISCARDED'
        : null;
  if (rewardKind === null) {
    return game;
  }

  const rewardAmount =
    rewardKind === 'SCORE'
      ? typeof effect.metadata?.namedHandDiscardRewardAmount === 'number'
        ? effect.metadata.namedHandDiscardRewardAmount
        : 0
      : discardResult.discardedCardIds.length;
  const stateAfterReward =
    rewardAmount === 0
      ? discardResult.gameState
      : addLiveModifier(discardResult.gameState, {
          kind: rewardKind === 'SCORE' ? 'SCORE' : 'BLADE',
          playerId: player.id,
          countDelta: rewardAmount,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        });
  const state = { ...stateAfterReward, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        rewardKind === 'SCORE'
          ? 'DISCARD_NAMED_HAND_CARDS_GAIN_SCORE'
          : 'DISCARD_NAMED_HAND_CARDS_GAIN_BLADE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: discardResult.discardedCardIds,
      rewardKind,
      rewardAmount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getNamedHandDiscardCandidateIds(
  game: GameState,
  playerId: string,
  names: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return getCardIdsMatchingSelector(game, player.hand.cardIds, cardNameAliasAny(names));
}
