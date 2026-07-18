import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { hasOtherStageMember } from '../../../effects/conditions.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  PL_BP4_013_LIVE_START_DISCARD_TARGET_OTHER_MEMBER_GAIN_PINK_HEART_ABILITY_ID,
  PL_N_BP3_002_LIVE_START_DISCARD_CHOOSE_HEART_OTHER_NIJIGASAKI_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID = 'KOTORI_LIVE_START_SELECT_DISCARD';
export const KOTORI_LIVE_START_SELECT_HEART_STEP_ID = 'KOTORI_LIVE_START_SELECT_HEART';
export const LIVE_START_DISCARD_GAIN_HEART_SELECT_MEMBER_STEP_ID =
  'LIVE_START_DISCARD_GAIN_HEART_SELECT_MEMBER';

const KOTORI_HEART_COLOR_OPTIONS = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE] as const;
const STANDARD_HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

const HEART_COLOR_OPTION_LABELS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '粉心',
  [HeartColor.RED]: '红心',
  [HeartColor.YELLOW]: '黄心',
  [HeartColor.GREEN]: '绿心',
  [HeartColor.BLUE]: '蓝心',
  [HeartColor.PURPLE]: '紫心',
  [HeartColor.RAINBOW]: '虹心',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type HeartRecipient =
  | { readonly mode: 'SOURCE_MEMBER'; readonly requiresOtherStageMember: boolean }
  | { readonly mode: 'SELECT_OTHER_STAGE_MEMBER'; readonly groupAlias?: string };

type HeartSelection =
  | { readonly mode: 'CHOOSE'; readonly options: readonly HeartColor[] }
  | { readonly mode: 'FIXED'; readonly color: HeartColor };

interface LiveStartDiscardGainHeartConfig {
  readonly abilityId: string;
  readonly heartSelection: HeartSelection;
  readonly recipient: HeartRecipient;
}

const LIVE_START_DISCARD_GAIN_HEART_CONFIGS: readonly LiveStartDiscardGainHeartConfig[] = [
  {
    abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
    heartSelection: { mode: 'CHOOSE', options: KOTORI_HEART_COLOR_OPTIONS },
    recipient: { mode: 'SOURCE_MEMBER', requiresOtherStageMember: false },
  },
  {
    abilityId: HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
    heartSelection: { mode: 'CHOOSE', options: STANDARD_HEART_COLOR_OPTIONS },
    recipient: { mode: 'SOURCE_MEMBER', requiresOtherStageMember: true },
  },
  {
    abilityId:
      PL_N_BP3_002_LIVE_START_DISCARD_CHOOSE_HEART_OTHER_NIJIGASAKI_MEMBER_ABILITY_ID,
    heartSelection: { mode: 'CHOOSE', options: STANDARD_HEART_COLOR_OPTIONS },
    recipient: { mode: 'SELECT_OTHER_STAGE_MEMBER', groupAlias: '虹ヶ咲' },
  },
  {
    abilityId: PL_BP4_013_LIVE_START_DISCARD_TARGET_OTHER_MEMBER_GAIN_PINK_HEART_ABILITY_ID,
    heartSelection: { mode: 'FIXED', color: HeartColor.PINK },
    recipient: { mode: 'SELECT_OTHER_STAGE_MEMBER' },
  },
];

export function registerLiveStartDiscardGainHeartWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of LIVE_START_DISCARD_GAIN_HEART_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startLiveStartDiscardGainHeartEffect(
        game,
        ability,
        options.orderedResolution === true,
        config
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardId
          ? startLiveStartDiscardGainHeartChoice(
              game,
              input.selectedCardId,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      LIVE_START_DISCARD_GAIN_HEART_SELECT_MEMBER_STEP_ID,
      (game, input, context) =>
        finishLiveStartDiscardGainHeartTarget(
          game,
          input.selectedCardId ?? null,
          context.continuePendingCardEffects
        )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
      (game, input, context) =>
        finishLiveStartDiscardGainHeartBonus(
          game,
          input.selectedOptionId ?? null,
          context.continuePendingCardEffects
        )
    );
  }
}

function startLiveStartDiscardGainHeartEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: LiveStartDiscardGainHeartConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
      metadata: {
        ...(config.heartSelection.mode === 'CHOOSE'
          ? { heartColorOptions: [...config.heartSelection.options] }
          : { fixedHeartColor: config.heartSelection.color }),
        heartRecipientMode: config.recipient.mode,
        ...(config.recipient.mode === 'SOURCE_MEMBER'
          ? { requiresOtherStageMemberForHeart: config.recipient.requiresOtherStageMember }
          : { heartRecipientGroupAlias: config.recipient.groupAlias }),
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    },
  });
}

function startLiveStartDiscardGainHeartChoice(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const state = discardResult.gameState;
  const fixedHeartColor = getFixedHeartColorForEffect(effect.metadata);
  if (
    fixedHeartColor !== null &&
    effect.metadata?.heartRecipientMode === 'SELECT_OTHER_STAGE_MEMBER'
  ) {
    return startTargetMemberSelection(
      state,
      effect,
      player.id,
      fixedHeartColor,
      continuePendingCardEffects,
      {
        step: 'DISCARD_HAND_CARD',
        discardCardId: discardResult.discardedCardIds[0],
      }
    );
  }

  const requiresOtherStageMember = effect.metadata?.requiresOtherStageMemberForHeart === true;
  if (requiresOtherStageMember && !hasOtherStageMember(state, player.id, effect.sourceCardId)) {
    const finishedState = {
      ...state,
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(finishedState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_HAND_CARD_NO_OTHER_MEMBER',
        discardCardId: discardResult.discardedCardIds[0],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
        stepText: '请选择本次 Live 结束前获得的 Heart。',
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: getHeartColorOptionsForEffect(effect.metadata).map((color) => ({
          id: color,
          label: HEART_COLOR_OPTION_LABELS[color],
        })),
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardCardId: discardResult.discardedCardIds[0],
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      discardCardId: discardResult.discardedCardIds[0],
    }
  );
}

function finishLiveStartDiscardGainHeartBonus(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedColor = getHeartColorOptionsForEffect(effect.metadata).includes(
    selectedOptionId as HeartColor
  )
    ? (selectedOptionId as HeartColor)
    : null;
  if (!player || selectedColor === null) {
    return game;
  }

  if (effect.metadata?.heartRecipientMode === 'SELECT_OTHER_STAGE_MEMBER') {
    return startTargetMemberSelection(
      game,
      effect,
      player.id,
      selectedColor,
      continuePendingCardEffects,
      { step: 'SELECT_HEART_COLOR', heartColor: selectedColor }
    );
  }

  const heartBonus = { color: selectedColor, count: 1 };
  const modifierResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [heartBonus],
    }
  );
  if (!modifierResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_HEART_BONUS',
      heartColor: selectedColor,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startTargetMemberSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  heartColor: HeartColor,
  continuePendingCardEffects: ContinuePendingCardEffects,
  actionPayload: Readonly<Record<string, unknown>>
): GameState {
  const selectableCardIds = getOtherStageMemberCardIdsForEffect(game, effect);
  if (selectableCardIds.length === 0) {
    return finishWithoutHeartModifier(
      game,
      effect,
      playerId,
      continuePendingCardEffects,
      'NO_LEGAL_TARGET'
    );
  }
  const groupAlias = effect.metadata?.heartRecipientGroupAlias;
  const isAnyOtherStageMember = groupAlias === undefined;
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: LIVE_START_DISCARD_GAIN_HEART_SELECT_MEMBER_STEP_ID,
        stepText: isAnyOtherStageMember
          ? '请选择自己舞台上此成员以外的1名成员获得[桃ハート]。'
          : "请选择自己舞台上此成员以外的1名『虹咲』成员获得所选Heart。",
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: undefined,
        skipSelectionLabel: undefined,
        selectionLabel: isAnyOtherStageMember
          ? '选择获得[桃ハート]的成员'
          : "选择获得Heart的『虹咲』成员",
        confirmSelectionLabel: isAnyOtherStageMember ? '获得[桃ハート]' : '获得所选Heart',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        canSkipSelection: false,
        metadata: { ...effect.metadata, selectedHeartColor: heartColor },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...actionPayload,
      selectableCardIds,
    }
  );
}

function finishLiveStartDiscardGainHeartTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedColor = effect?.metadata?.selectedHeartColor;
  if (
    !effect ||
    effect.stepId !== LIVE_START_DISCARD_GAIN_HEART_SELECT_MEMBER_STEP_ID ||
    !player ||
    selectedCardId === null ||
    !Object.values(HeartColor).includes(selectedColor as HeartColor) ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const selectableCardIds = getOtherStageMemberCardIdsForEffect(game, effect);
  if (!selectableCardIds.includes(selectedCardId)) {
    if (
      !isSourceMemberOnMainStage(game, effect.controllerId, effect.sourceCardId) ||
      selectableCardIds.length === 0
    ) {
      return finishWithoutHeartModifier(
        game,
        effect,
        player.id,
        continuePendingCardEffects,
        'SOURCE_OR_TARGET_NO_LONGER_AVAILABLE'
      );
    }
    return {
      ...game,
      activeEffect: {
        ...effect,
        selectableCardIds,
      },
    };
  }
  const modifierResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: selectedColor as HeartColor, count: 1 }],
    }
  );
  if (!modifierResult) {
    return finishWithoutHeartModifier(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'TARGET_OR_SOURCE_INVALID'
    );
  }
  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_HEART_BONUS_TO_TARGET_MEMBER',
      targetMemberCardId: selectedCardId,
      heartColor: selectedColor,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getOtherStageMemberCardIdsForEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>
): readonly string[] {
  const groupAlias = effect.metadata?.heartRecipientGroupAlias;
  if (groupAlias !== undefined && typeof groupAlias !== 'string') return [];
  if (!isSourceMemberOnMainStage(game, effect.controllerId, effect.sourceCardId)) return [];
  return getStageMemberCardIdsMatching(
    game,
    effect.controllerId,
    typeof groupAlias === 'string'
      ? and(typeIs(CardType.MEMBER), groupAliasIs(groupAlias))
      : typeIs(CardType.MEMBER)
  ).filter((cardId) => cardId !== effect.sourceCardId);
}

function isSourceMemberOnMainStage(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).includes(
    sourceCardId
  );
}

function finishWithoutHeartModifier(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'NO_HEART_MODIFIER',
      reason,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getHeartColorOptionsForEffect(
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly HeartColor[] {
  if (Array.isArray(metadata?.heartColorOptions)) {
    const colors = metadata.heartColorOptions.filter((color): color is HeartColor =>
      Object.values(HeartColor).includes(color as HeartColor)
    );
    if (colors.length > 0) {
      return colors;
    }
  }
  return KOTORI_HEART_COLOR_OPTIONS;
}

function getFixedHeartColorForEffect(
  metadata: Readonly<Record<string, unknown>> | undefined
): HeartColor | null {
  const color = metadata?.fixedHeartColor;
  return Object.values(HeartColor).includes(color as HeartColor) ? (color as HeartColor) : null;
}
