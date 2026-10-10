import { queryConfirmSelection } from '../../runtime/selection-query.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import {
  BladeHeartEffect,
  CardType,
  HeartColor,
  ZoneType,
} from '../../../../shared/types/enums.js';
import {
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
  HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
  N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
  PL_BP8_007_ON_ENTER_MILL_FOUR_MUSE_LIVE_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import {
  and,
  groupAliasIs,
  memberHasHeartColor,
  typeIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import {
  allCardIdsMatchingSelector,
  getCardIdsMatchingSelector,
} from '../../../effects/conditions.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type MillTopReward =
  | {
      readonly type: 'heart';
      readonly heartColor: HeartColor;
      readonly label: string;
      readonly actionPayloadKey: 'heartBonus';
    }
  | {
      readonly type: 'blade';
      readonly amount: number;
      readonly label: string;
      readonly actionPayloadKey: 'bladeBonus';
    };

type MillTopCondition =
  | {
      readonly kind: 'ANY_MATCH';
      readonly selector: CardSelector;
      readonly label: string;
    }
  | {
      readonly kind: 'ALL_MATCH';
      readonly selector: CardSelector;
      readonly label: string;
    }
  | {
      readonly kind: 'DISTINCT_MEMBER_BLADE_HEART_COLORS';
      readonly minCount: number;
    };

interface MillTopGainLiveModifierConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly topCount: number;
  readonly condition: MillTopCondition;
  readonly reward: MillTopReward;
  readonly finishStep: string;
  readonly actionPayloadStyle?: 'LIVE_PRESENCE_BLADE';
  readonly confirmManualSelection?: true;
}

const MILL_TOP_GAIN_LIVE_MODIFIER_CONFIGS: readonly MillTopGainLiveModifierConfig[] = [
  {
    abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    stepId: 'HS_BP5_001_REVEAL_TOP_FOUR',
    topCount: 4,
    condition: { kind: 'ANY_MATCH', selector: typeIs(CardType.LIVE), label: 'LIVE卡' },
    reward: {
      type: 'blade',
      amount: 2,
      label: '[ブレード][ブレード]',
      actionPayloadKey: 'bladeBonus',
    },
    finishStep: 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE',
    actionPayloadStyle: 'LIVE_PRESENCE_BLADE',
    confirmManualSelection: true,
  },
  {
    abilityId: PL_BP8_007_ON_ENTER_MILL_FOUR_MUSE_LIVE_GAIN_BLADE_ABILITY_ID,
    stepId: 'PL_BP8_007_MILL_TOP_FOUR',
    topCount: 4,
    condition: {
      kind: 'ANY_MATCH',
      selector: and(typeIs(CardType.LIVE), groupAliasIs('μ’s')),
      label: '『μ’s』的LIVE卡',
    },
    reward: { type: 'blade', amount: 1, label: '[ブレード]', actionPayloadKey: 'bladeBonus' },
    finishStep: 'FINISH_MILL_TOP_FOUR_MUSE_LIVE_GAIN_BLADE',
  },
  {
    abilityId: HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    stepId: 'HS_PR_019_REVEAL_TOP_THREE',
    topCount: 3,
    condition: {
      kind: 'ALL_MATCH',
      selector: memberHasHeartColor(HeartColor.GREEN),
      label: '持有绿色Heart的成员',
    },
    reward: {
      type: 'heart',
      heartColor: HeartColor.GREEN,
      label: '绿色Heart',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_GREEN_HEART_MEMBERS',
  },
  {
    abilityId: HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
    stepId: 'HS_PR_021_REVEAL_TOP_THREE',
    topCount: 3,
    condition: {
      kind: 'ALL_MATCH',
      selector: memberHasHeartColor(HeartColor.PINK),
      label: '持有桃Heart的成员',
    },
    reward: {
      type: 'heart',
      heartColor: HeartColor.PINK,
      label: '桃Heart',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_PINK_HEART_MEMBERS',
  },
  {
    abilityId: HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
    stepId: 'HS_SD1_013_REVEAL_TOP_THREE',
    topCount: 3,
    condition: {
      kind: 'ALL_MATCH',
      selector: memberHasHeartColor(HeartColor.BLUE),
      label: '持有蓝Heart的成员',
    },
    reward: {
      type: 'heart',
      heartColor: HeartColor.BLUE,
      label: '蓝Heart',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_BLUE_HEART_MEMBERS',
  },
  {
    abilityId: HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
    stepId: 'HS_BP5_013_REVEAL_TOP_THREE',
    topCount: 3,
    condition: {
      kind: 'ALL_MATCH',
      selector: typeIs(CardType.MEMBER),
      label: '成员卡',
    },
    reward: {
      type: 'blade',
      amount: 2,
      label: '[BLADE][BLADE]',
      actionPayloadKey: 'bladeBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_MEMBERS_GAIN_BLADE',
  },
  {
    abilityId: HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID,
    stepId: 'HS_BP6_009_MILL_TOP_FOUR',
    topCount: 4,
    condition: {
      kind: 'ALL_MATCH',
      selector: groupAliasIs('蓮ノ空'),
      label: '『莲之空』卡',
    },
    reward: {
      type: 'blade',
      amount: 1,
      label: '[BLADE]',
      actionPayloadKey: 'bladeBonus',
    },
    finishStep: 'FINISH_MILL_TOP_FOUR_CHECK_HASUNOSORA_GAIN_BLADE',
  },
  {
    abilityId: N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
    stepId: 'N_BP7_020_MILL_TOP_THREE',
    topCount: 3,
    condition: {
      kind: 'DISTINCT_MEMBER_BLADE_HEART_COLORS',
      minCount: 2,
    },
    reward: {
      type: 'heart',
      heartColor: HeartColor.GREEN,
      label: '[緑ハート]',
      actionPayloadKey: 'heartBonus',
    },
    finishStep: 'FINISH_MILL_TOP_THREE_CHECK_BLADE_HEART_COLORS_GAIN_GREEN_HEART',
  },
];

export function registerMillTopGainLiveModifierWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of MILL_TOP_GAIN_LIVE_MODIFIER_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startMillTopGainLiveModifierInspection(
        game,
        ability,
        options,
        config,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.stepId,
      (game, _input, context) =>
        finishMillTopGainLiveModifier(game, context.continuePendingCardEffects, config),
      queryConfirmSelection
    );
  }
}

function startMillTopGainLiveModifierInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  config: MillTopGainLiveModifierConfig,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const confirmation = config.confirmManualSelection
    ? maybeStartManualPendingAbilityConfirmation(game, ability, options)
    : null;
  if (confirmation) return confirmation;
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    config.topCount,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!millResult) {
    return game;
  }

  const milledCardIds = millResult.movedCardIds;
  const revealedCardIds = [...new Set(milledCardIds)];
  const condition = evaluateCondition(millResult.gameState, milledCardIds, config);
  const conditionMet = condition.conditionMet;
  const refreshText = millResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = conditionMet
    ? `${condition.description}展示结束后获得${config.reward.label}。`
    : `${condition.description}展示结束后不获得奖励。`;

  return startPendingActiveEffect(millResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: withPublicRevealDwell({
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: `已将卡组顶合计${milledCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
      awaitingPlayerId: player.id,
      revealedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
        milledCardIds,
        ...(config.actionPayloadStyle === 'LIVE_PRESENCE_BLADE'
          ? {
              liveCardIds: condition.matchingCardIds,
              ...createRewardActionPayload(config.reward, conditionMet),
            }
          : { conditionMet, bladeHeartColors: condition.bladeHeartColors }),
        refreshCount: millResult.refreshCount,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_TOP_CARDS',
      milledCardIds,
      ...(config.actionPayloadStyle === 'LIVE_PRESENCE_BLADE'
        ? {
            liveCardIds: condition.matchingCardIds,
            ...createRewardActionPayload(config.reward, conditionMet),
          }
        : { conditionMet, bladeHeartColors: condition.bladeHeartColors }),
      refreshCount: millResult.refreshCount,
    },
  });
}

function finishMillTopGainLiveModifier(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: MillTopGainLiveModifierConfig
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const milledCardIds = getStringArrayMetadata(effect.metadata?.milledCardIds);
  const conditionMet =
    config.actionPayloadStyle === 'LIVE_PRESENCE_BLADE'
      ? typeof effect.metadata?.bladeBonus === 'number' && effect.metadata.bladeBonus > 0
      : effect.metadata?.conditionMet === true;

  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  let rewardApplied = false;

  if (conditionMet && isCurrentStageMemberAbilitySource(game, effect)) {
    const modifierResult =
      config.reward.type === 'heart'
        ? addHeartLiveModifierForSourceMember(state, {
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            hearts: [{ color: config.reward.heartColor, count: 1 }],
          })
        : addBladeLiveModifierForSourceMember(state, {
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            amount: config.reward.amount,
          });
    if (modifierResult) {
      state = modifierResult.gameState;
      rewardApplied = true;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.finishStep,
      milledCardIds,
      ...(config.actionPayloadStyle === 'LIVE_PRESENCE_BLADE'
        ? { liveCardIds: getStringArrayMetadata(effect.metadata?.liveCardIds) }
        : {
            conditionMet,
            bladeHeartColors: getStringArrayMetadata(effect.metadata?.bladeHeartColors),
            rewardApplied,
          }),
      refreshCount:
        typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0,
      ...createRewardActionPayload(config.reward, rewardApplied),
    }),
    effect.metadata?.orderedResolution === true
  );
}

function evaluateCondition(
  game: GameState,
  milledCardIds: readonly string[],
  config: MillTopGainLiveModifierConfig
): {
  readonly conditionMet: boolean;
  readonly description: string;
  readonly bladeHeartColors: readonly HeartColor[];
  readonly matchingCardIds: readonly string[];
} {
  if (config.condition.kind === 'ANY_MATCH') {
    const matchingCardIds = getCardIdsMatchingSelector(
      game,
      milledCardIds,
      config.condition.selector
    );
    const conditionMet = matchingCardIds.length > 0;
    return {
      conditionMet,
      description: conditionMet
        ? `其中存在${config.condition.label}。`
        : `其中没有${config.condition.label}。`,
      bladeHeartColors: [],
      matchingCardIds: [...new Set(matchingCardIds)],
    };
  }
  if (config.condition.kind === 'ALL_MATCH') {
    const conditionMet =
      milledCardIds.length === config.topCount &&
      allCardIdsMatchingSelector(game, milledCardIds, config.condition.selector);
    return {
      conditionMet,
      description: conditionMet
        ? `这些卡均为${config.condition.label}。`
        : `这些卡不满足均为${config.condition.label}。`,
      bladeHeartColors: [],
      matchingCardIds: [],
    };
  }

  const colors = new Set<HeartColor>();
  for (const cardId of milledCardIds) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      continue;
    }
    for (const bladeHeart of card.data.bladeHearts ?? []) {
      if (bladeHeart.effect === BladeHeartEffect.HEART && bladeHeart.heartColor !== undefined) {
        colors.add(bladeHeart.heartColor);
      }
    }
  }
  const bladeHeartColors = [...colors];
  return {
    conditionMet: bladeHeartColors.length >= config.condition.minCount,
    description: `这些成员卡的BLADE HEART颜色共${bladeHeartColors.length}种。`,
    bladeHeartColors,
    matchingCardIds: [],
  };
}

function createRewardActionPayload(
  reward: MillTopReward,
  conditionMet: boolean
): Readonly<Record<string, unknown>> {
  if (reward.type === 'heart') {
    return {
      [reward.actionPayloadKey]: conditionMet ? [{ color: reward.heartColor, count: 1 }] : [],
    };
  }
  return {
    [reward.actionPayloadKey]: conditionMet ? reward.amount : 0,
  };
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
