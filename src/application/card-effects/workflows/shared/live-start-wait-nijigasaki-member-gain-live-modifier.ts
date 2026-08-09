import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
  N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { waitStageMembersAndEnqueueTriggers } from '../../runtime/wait-stage-members.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

// Keep the promoted family's original step ID so persisted PL!N-sd2-006 windows remain valid.
const SELECT_WAIT_COST_MEMBER_STEP_ID = 'N_SD2_006_SELECT_NIJIGASAKI_MEMBER_TO_WAIT';
const SELECT_HEART_COLOR_STEP_ID = 'N_BP7_012_SELECT_HEART_COLOR';
const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));
const STANDARD_HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;
const HEART_COLOR_OPTION_TEXTS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '获得[桃ハート]。',
  [HeartColor.RED]: '获得[赤ハート]。',
  [HeartColor.YELLOW]: '获得[黄ハート]。',
  [HeartColor.GREEN]: '获得[緑ハート]。',
  [HeartColor.BLUE]: '获得[青ハート]。',
  [HeartColor.PURPLE]: '获得[紫ハート]。',
  [HeartColor.ORANGE]: '获得[オレンジハート]。',
  [HeartColor.GRAY]: '获得[無色ハート]。',
  [HeartColor.RAINBOW]: '获得[虹ハート]。',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type LiveModifierReward =
  | { readonly kind: 'BLADE'; readonly amount: number }
  | { readonly kind: 'CHOOSE_HEART'; readonly options: readonly HeartColor[] };

interface LiveStartWaitNijigasakiMemberConfig {
  readonly abilityId: string;
  readonly reward: LiveModifierReward;
}

const WORKFLOW_CONFIGS: readonly LiveStartWaitNijigasakiMemberConfig[] = [
  {
    abilityId: N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    reward: { kind: 'BLADE', amount: 2 },
  },
  {
    abilityId: N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
    reward: { kind: 'CHOOSE_HEART', options: STANDARD_HEART_COLOR_OPTIONS },
  },
];

export function registerLiveStartWaitNijigasakiMemberGainLiveModifierWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  for (const config of WORKFLOW_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      start(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_WAIT_COST_MEMBER_STEP_ID,
      (game, input, context) =>
        finishWaitCost(
          game,
          input.selectedCardId ?? null,
          config,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }

  registerActiveEffectStepHandler(
    N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
    SELECT_HEART_COLOR_STEP_ID,
    (game, input, context) =>
      finishHeartSelection(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveStartWaitNijigasakiMemberConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = getActiveNijigasakiMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ACTIVE_NIJIGASAKI_MEMBER_FOR_COST',
      paidCostCardId: null,
      bladeBonus: 0,
      bladeApplied: false,
      heartApplied: false,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: SELECT_WAIT_COST_MEMBER_STEP_ID,
      stepText: '可以将自己舞台上1名活跃状态的『虹咲』成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要用于支付费用的成员',
      confirmSelectionLabel: '支付费用',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NIJIGASAKI_MEMBER_WAIT_COST',
      selectableCardIds,
      sourceSlot: ability.sourceSlot,
    },
  });
}

function finishWaitCost(
  game: GameState,
  selectedCardId: string | null,
  config: LiveStartWaitNijigasakiMemberConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_WAIT_COST_MEMBER_STEP_ID
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
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_WAIT_COST',
        paidCostCardId: null,
        bladeBonus: 0,
        bladeApplied: false,
        heartApplied: false,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getActiveNijigasakiMemberCardIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const waitResult = waitStageMembersAndEnqueueTriggers(game, {
    playerId: player.id,
    memberCardIds: [selectedCardId],
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
    enqueueTriggeredCardEffects,
  });
  if (waitResult.actuallyWaitedMemberCardIds.length !== 1) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(waitResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    paidCostCardId: selectedCardId,
    previousOrientation: OrientationState.ACTIVE,
    nextOrientation: OrientationState.WAITING,
    memberStateChangedEventIds: waitResult.memberStateChangedEventIds,
  });

  if (config.reward.kind === 'CHOOSE_HEART') {
    return startHeartSelection(stateAfterCost, effect, player.id, selectedCardId, config.reward);
  }

  const bladeResult = addBladeLiveModifierForSourceMember(stateAfterCost, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: config.reward.amount,
  });
  const state = bladeResult?.gameState ?? stateAfterCost;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: bladeResult ? 'PAY_WAIT_COST_GAIN_TWO_BLADE' : 'PAY_WAIT_COST_SOURCE_NO_LONGER_VALID',
      paidCostCardId: selectedCardId,
      actuallyWaitedMemberCardIds: waitResult.actuallyWaitedMemberCardIds,
      memberStateChangedEventIds: waitResult.memberStateChangedEventIds,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
      bladeApplied: bladeResult !== null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startHeartSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  paidCostCardId: string,
  reward: Extract<LiveModifierReward, { readonly kind: 'CHOOSE_HEART' }>
): GameState {
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_HEART_COLOR_STEP_ID,
        stepText: '请选择本次LIVE结束前获得的Heart颜色。',
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: undefined,
        effectChoice: {
          mode: 'SINGLE',
          options: reward.options.map((color) => ({
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
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          paidCostCardId,
          heartColorOptions: [...reward.options],
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_WAIT_COST_SELECT_HEART',
      paidCostCardId,
    }
  );
}

function finishHeartSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedColor =
    STANDARD_HEART_COLOR_OPTIONS.find((color) => color === selectedOptionId) ?? null;
  if (
    !effect ||
    effect.abilityId !== N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_COLOR_STEP_ID ||
    !player ||
    selectedColor === null
  ) {
    return game;
  }

  const stateWithoutEffect = { ...game, activeEffect: null };
  const sourceStillOnStage = getStageMemberCardIdsMatching(
    stateWithoutEffect,
    player.id,
    typeIs(CardType.MEMBER)
  ).includes(effect.sourceCardId);
  const modifierResult = sourceStillOnStage
    ? addHeartLiveModifierForSourceMember(stateWithoutEffect, {
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        hearts: [{ color: selectedColor, count: 1 }],
      })
    : null;
  const state = modifierResult?.gameState ?? stateWithoutEffect;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: modifierResult
        ? 'PAY_WAIT_COST_GAIN_SELECTED_HEART'
        : 'PAY_WAIT_COST_SOURCE_NO_LONGER_VALID_AFTER_HEART_SELECTION',
      paidCostCardId: effect.metadata?.paidCostCardId,
      heartColor: selectedColor,
      heartApplied: modifierResult !== null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveNijigasakiMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}
