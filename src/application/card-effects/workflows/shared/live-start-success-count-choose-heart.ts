import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
  BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID = 'LIVE_START_SUCCESS_COUNT_CHOOSE_HEART';

const HEART_COLOR_OPTION_TEXTS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[桃ハート]。',
  [HeartColor.RED]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[赤ハート]。',
  [HeartColor.YELLOW]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[黄ハート]。',
  [HeartColor.GREEN]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[緑ハート]。',
  [HeartColor.BLUE]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[青ハート]。',
  [HeartColor.PURPLE]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[紫ハート]。',
  [HeartColor.RAINBOW]: '获得与自己的成功LIVE卡区中的卡牌数量相同数量的[虹ハート]。',
};

interface LiveStartSuccessCountChooseHeartConfig {
  readonly abilityId: string;
  readonly heartColorOptions: readonly HeartColor[];
}

const LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_CONFIGS: readonly LiveStartSuccessCountChooseHeartConfig[] =
  [
    {
      abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      heartColorOptions: [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE],
    },
    {
      abilityId: BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
      heartColorOptions: [HeartColor.GREEN, HeartColor.BLUE, HeartColor.PURPLE],
    },
  ];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveStartSuccessCountChooseHeartWorkflowHandlers(): void {
  for (const config of LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveStartSuccessCountChooseHeart(
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
        finishLiveStartSuccessCountChooseHeart(
          game,
          input.selectedOptionId ?? null,
          context.continuePendingCardEffects
        )
    );
  }
}

function startLiveStartSuccessCountChooseHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: LiveStartSuccessCountChooseHeartConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
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
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID,
      stepText: '请选择本次获得的Heart颜色。',
      awaitingPlayerId: player.id,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      effectChoice: {
        mode: 'SINGLE',
        options: config.heartColorOptions.map((color) => ({
          id: color,
          text: HEART_COLOR_OPTION_TEXTS[color],
        })),
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择Heart颜色',
      confirmSelectionLabel: '获得Heart',
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

function finishLiveStartSuccessCountChooseHeart(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== LIVE_START_SUCCESS_COUNT_CHOOSE_HEART_STEP_ID) {
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
  if (!player || sourceSlot === null) {
    return finishWithoutHeartModifier(
      game,
      effect.controllerId,
      selectedColor,
      0,
      'SOURCE_NOT_ON_STAGE',
      continuePendingCardEffects
    );
  }

  const successLiveCount = player.successZone.cardIds.length;
  const stateWithoutActiveEffect = { ...game, activeEffect: null };
  if (successLiveCount === 0) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      selectedColor,
      successLiveCount,
      'CHOOSE_HEART_NO_SUCCESS_LIVE',
      continuePendingCardEffects
    );
  }

  const heartResult = addHeartLiveModifierForMember(stateWithoutActiveEffect, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: selectedColor, count: successLiveCount }],
  });

  if (!heartResult) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      selectedColor,
      successLiveCount,
      'SOURCE_MEMBER_HEART_MODIFIER_UNAVAILABLE',
      continuePendingCardEffects
    );
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'GAIN_SELECTED_HEART_BY_SUCCESS_LIVE_COUNT',
      selectedHeartColor: selectedColor,
      successLiveCount,
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
  successLiveCount: number,
  step: string,
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
      successLiveCount,
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
