import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { countSuccessZoneCardsForCardEffect } from '../../../../domain/rules/success-zone-card-queries.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { collectEffectiveStageMemberHeartColors } from '../../../effects/stage-member-heart-colors.js';
import {
  getStageMemberCardIdsMatching,
  memberHasEnergyBelow,
} from '../../../effects/stage-targets.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
  BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
  N_BP8_007_LIVE_START_ENERGY_BELOW_NIJIGASAKI_COUNT_CHOOSE_HEART_ABILITY_ID,
  N_BP8_019_LIVE_START_CHOOSE_ABSENT_NIJIGASAKI_HEART_COLOR_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  getSourceMemberSlot,
  isCurrentStageMemberAbilitySource,
} from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryOptionSelection } from '../../runtime/selection-query.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID = 'LIVE_START_SUCCESS_COUNT_CHOOSE_HEART';

const HEART_COLOR_OPTION_TEXTS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[桃ハート]。',
  [HeartColor.RED]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[赤ハート]。',
  [HeartColor.YELLOW]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[黄ハート]。',
  [HeartColor.GREEN]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[緑ハート]。',
  [HeartColor.BLUE]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[青ハート]。',
  [HeartColor.PURPLE]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[紫ハート]。',
  [HeartColor.ORANGE]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[オレンジハート]。',
  [HeartColor.GRAY]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[無色ハート]。',
  [HeartColor.RAINBOW]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[虹ハート]。',
};

interface LiveStartChooseHeartByCountConfig {
  readonly abilityId: string;
  readonly heartColorOptions: readonly HeartColor[];
  readonly countHearts: (
    game: GameState,
    controllerId: string,
    sourceCardId: string,
    selectedColor: HeartColor
  ) => number;
  readonly countDescription: string;
  readonly countPayloadKey: 'successLiveCount' | 'energyBelowMemberCount' | 'heartCount';
  readonly optionText?: (color: HeartColor) => string;
  readonly choiceAction?: 'GAIN' | 'DESIGNATE';
  readonly noHeartActionStep: string;
  readonly gainHeartActionStep: string;
}

const LIVE_START_CHOOSE_HEART_BY_COUNT_CONFIGS: readonly LiveStartChooseHeartByCountConfig[] = [
  {
    abilityId: N_BP8_019_LIVE_START_CHOOSE_ABSENT_NIJIGASAKI_HEART_COLOR_ABILITY_ID,
    heartColorOptions: [
      HeartColor.PINK,
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ],
    countHearts: (game, playerId, _sourceCardId, selectedColor) => {
      const memberCardIds = getStageMemberCardIdsMatching(game, playerId, groupAliasIs('虹ヶ咲'));
      const allMemberHeartListsValid = memberCardIds.every((id) => {
        const card = getCardById(game, id);
        return card !== null && 'hearts' in card.data && Array.isArray(card.data.hearts);
      });
      return allMemberHeartListsValid &&
        memberCardIds.length >= 3 &&
        !collectEffectiveStageMemberHeartColors(game, playerId, { memberCardIds }).has(
          selectedColor
        )
        ? 1
        : 0;
    },
    countDescription: '符合人数与缺色条件时获得的HEART数量',
    countPayloadKey: 'heartCount',
    choiceAction: 'DESIGNATE',
    optionText: (color) =>
      HEART_COLOR_OPTION_TEXTS[color].replace(
        '获得与自己的成功LIVE卡区中的卡牌数量相同数量的',
        '满足条件时，获得1个'
      ),
    noHeartActionStep: 'NIJIGASAKI_COUNT_OR_ABSENT_HEART_CONDITION_NOT_MET',
    gainHeartActionStep: 'GAIN_ABSENT_NIJIGASAKI_HEART_COLOR',
  },
  {
    abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
    heartColorOptions: [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE],
    countHearts: (game, playerId, sourceCardId) =>
      countSuccessZoneCardsForCardEffect(game, playerId, sourceCardId),
    countDescription: '自己的成功LIVE卡区中的卡牌数量',
    countPayloadKey: 'successLiveCount',
    noHeartActionStep: 'CHOOSE_HEART_NO_SUCCESS_LIVE',
    gainHeartActionStep: 'GAIN_SELECTED_HEART_BY_SUCCESS_LIVE_COUNT',
  },
  {
    abilityId: BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
    heartColorOptions: [HeartColor.GREEN, HeartColor.BLUE, HeartColor.PURPLE],
    countHearts: (game, playerId, sourceCardId) =>
      countSuccessZoneCardsForCardEffect(game, playerId, sourceCardId),
    countDescription: '自己的成功LIVE卡区中的卡牌数量',
    countPayloadKey: 'successLiveCount',
    noHeartActionStep: 'CHOOSE_HEART_NO_SUCCESS_LIVE',
    gainHeartActionStep: 'GAIN_SELECTED_HEART_BY_SUCCESS_LIVE_COUNT',
  },
  {
    abilityId: N_BP8_007_LIVE_START_ENERGY_BELOW_NIJIGASAKI_COUNT_CHOOSE_HEART_ABILITY_ID,
    heartColorOptions: [HeartColor.PINK, HeartColor.RED, HeartColor.YELLOW],
    countHearts: (game, playerId) =>
      getStageMemberCardIdsMatching(game, playerId, groupAliasIs('虹ヶ咲'), memberHasEnergyBelow)
        .length,
    countDescription: '自己舞台上下方存在能量卡的『虹咲』成员人数',
    countPayloadKey: 'energyBelowMemberCount',
    noHeartActionStep: 'CHOOSE_HEART_NO_ENERGY_BELOW_NIJIGASAKI_MEMBER',
    gainHeartActionStep: 'GAIN_SELECTED_HEART_BY_ENERGY_BELOW_NIJIGASAKI_COUNT',
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveStartChooseHeartByCountWorkflowHandlers(): void {
  for (const config of LIVE_START_CHOOSE_HEART_BY_COUNT_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveStartChooseHeartByCount(
        game,
        ability,
        options.orderedResolution === true,
        config,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID,
      (game, input, context) =>
        finishLiveStartChooseHeartByCount(
          game,
          input.selectedOptionId ?? null,
          config,
          context.continuePendingCardEffects
        ),
      queryOptionSelection
    );
  }
}

function startLiveStartChooseHeartByCount(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: LiveStartChooseHeartByCountConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  if (!player || !isCurrentStageMemberAbilitySource(game, { ...ability, sourceLifecycleId })) {
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID,
      stepText:
        config.choiceAction === 'DESIGNATE'
          ? '请选择指定的HEART颜色。随后检查当前舞台上的虹咲成员人数与其持有的HEART颜色。'
          : '请选择本次获得的Heart颜色。',
      awaitingPlayerId: player.id,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      effectChoice: {
        mode: 'SINGLE',
        options: config.heartColorOptions.map((color) => ({
          id: color,
          text:
            config.optionText?.(color) ??
            HEART_COLOR_OPTION_TEXTS[color].replace(
              '自己的成功LIVE卡区中的卡牌数量',
              config.countDescription
            ),
        })),
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: config.choiceAction === 'DESIGNATE' ? '指定HEART颜色' : '选择Heart颜色',
      confirmSelectionLabel: config.choiceAction === 'DESIGNATE' ? '指定HEART颜色' : '获得Heart',
      canSkipSelection: false,
      metadata: {
        heartColorOptions: [...config.heartColorOptions],
        orderedResolution,
        sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_SELECT_HEART_COLOR',
      heartColorOptions: config.heartColorOptions,
    },
  });
}

function finishLiveStartChooseHeartByCount(
  game: GameState,
  selectedOptionId: string | null,
  config: LiveStartChooseHeartByCountConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID
  ) {
    return game;
  }
  const selectedColor = getHeartColorOptionsForEffect(effect.metadata).includes(
    selectedOptionId as HeartColor
  )
    ? (selectedOptionId as HeartColor)
    : null;
  if (selectedColor === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || !isCurrentStageMemberAbilitySource(game, effect)) {
    return finishWithoutHeartModifier(
      game,
      effect.controllerId,
      selectedColor,
      0,
      'SOURCE_NOT_ON_STAGE',
      config.countPayloadKey,
      continuePendingCardEffects
    );
  }

  const heartCount = config.countHearts(game, player.id, effect.sourceCardId, selectedColor);
  const stateWithoutActiveEffect = { ...game, activeEffect: null };
  if (heartCount === 0) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      selectedColor,
      heartCount,
      config.noHeartActionStep,
      config.countPayloadKey,
      continuePendingCardEffects
    );
  }

  const heartResult = addHeartLiveModifierForSourceMember(stateWithoutActiveEffect, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: selectedColor, count: heartCount }],
  });

  if (!heartResult) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      selectedColor,
      heartCount,
      'SOURCE_MEMBER_HEART_MODIFIER_UNAVAILABLE',
      config.countPayloadKey,
      continuePendingCardEffects
    );
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.gainHeartActionStep,
      selectedHeartColor: selectedColor,
      heartCount,
      [config.countPayloadKey]: heartCount,
      heartBonus: heartResult.heartBonus,
      sourceSlot,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishWithoutHeartModifier(
  game: GameState,
  playerId: string,
  selectedColor: HeartColor,
  heartCount: number,
  step: string,
  countPayloadKey: LiveStartChooseHeartByCountConfig['countPayloadKey'],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedHeartColor: selectedColor,
      [countPayloadKey]: heartCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
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
        step,
        sourceSlot: ability.sourceSlot,
      }
    ),
    orderedResolution
  );
}

function getHeartColorOptionsForEffect(
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly HeartColor[] {
  if (!Array.isArray(metadata?.heartColorOptions)) {
    return [];
  }
  return metadata.heartColorOptions.filter((color): color is HeartColor =>
    Object.values(HeartColor).includes(color as HeartColor)
  );
}
