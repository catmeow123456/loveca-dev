import { createHeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import {
  BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
  BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
} from '../../ability-ids.js';
import { finishSkippedActiveEffect, startPendingActiveEffect } from '../../runtime/active-effect.js';
import { revealHandCardForActiveEffect } from '../../runtime/active-effect.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  getCardIdsInZoneMatching,
  getCardIdsMatchingSelector,
} from '../../../effects/conditions.js';
import { playMemberBelowCardToEmptySlot } from '../../../effects/member-state.js';

const KOTORI_SELECT_HAND_MEMBER_STEP_ID = 'BP6_003_KOTORI_SELECT_HAND_MEMBER';
const KOTORI_SELECT_HEART_COLOR_STEP_ID = 'BP6_003_KOTORI_SELECT_HEART_COLOR';
const KOTORI_SELECT_MEMBER_BELOW_STEP_ID = 'BP6_003_KOTORI_SELECT_MEMBER_BELOW';
const KOTORI_SELECT_EMPTY_SLOT_STEP_ID = 'BP6_003_KOTORI_SELECT_EMPTY_SLOT';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

export interface Bp6003KotoriWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerBp6003KotoriWorkflowHandlers(
  dependencies: Bp6003KotoriWorkflowDependencies
): void {
  registerPendingAbilityStarterHandler(
    BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startKotoriLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    KOTORI_SELECT_HAND_MEMBER_STEP_ID,
    (game, input, context) =>
      revealKotoriHandMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    KOTORI_SELECT_HEART_COLOR_STEP_ID,
    (game, input, context) =>
      finishKotoriLiveStart(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    (game, ability, options, context) =>
      startKotoriLiveSuccess(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    KOTORI_SELECT_MEMBER_BELOW_STEP_ID,
    (game, input, context) =>
      selectKotoriMemberBelow(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    KOTORI_SELECT_EMPTY_SLOT_STEP_ID,
    (game, input, context) =>
      finishKotoriLiveSuccess(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        dependencies.enqueueTriggeredCardEffects
      )
  );
}

function startKotoriLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot !== SlotPosition.CENTER) {
    return skipPendingAbility(game, ability, ability.controllerId, orderedResolution, 'SOURCE_NOT_CENTER', continuePendingCardEffects);
  }

  const selectableCardIds = getLowCostMuseMemberIdsInHand(game, player.id);
  if (selectableCardIds.length === 0) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, 'NO_HAND_LOW_COST_MUSE_MEMBER', continuePendingCardEffects);
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: KOTORI_SELECT_HAND_MEMBER_STEP_ID,
      stepText: "请选择手牌中1张费用<=2的『μ's』成员卡公开。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectionLabel: '选择要公开并放到下方的成员',
      confirmSelectionLabel: '公开',
      metadata: {
        orderedResolution,
        sourceSlot,
        liveStartEventIds: ability.eventIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      selectableCardIds,
      step: 'START_SELECT_HAND_LOW_COST_MUSE_MEMBER',
    },
  });
}

function revealKotoriHandMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID ||
    effect.stepId !== KOTORI_SELECT_HAND_MEMBER_STEP_ID
  ) {
    return game;
  }
  if (selectedCardId === null) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, {
      step: 'DECLINE_REVEAL_HAND_MEMBER',
    });
  }

  const state = revealHandCardForActiveEffect(game, {
    effect,
    playerId: effect.controllerId,
    selectedCardId,
    nextStepId: KOTORI_SELECT_HEART_COLOR_STEP_ID,
    nextStepText: '请选择本次获得的Heart颜色。',
    actionStep: 'REVEAL_LOW_COST_MUSE_HAND_MEMBER',
    actionPayload: {
      revealedCardId: selectedCardId,
      sourceSlot: effect.metadata?.sourceSlot,
    },
    metadata: {
      revealedCardId: selectedCardId,
    },
  });
  if (state === game || !state.activeEffect) {
    return state;
  }
  return {
    ...state,
    activeEffect: {
      ...state.activeEffect,
      selectableOptions: HEART_COLOR_OPTIONS.map((color) => ({ id: color, label: color })),
      selectionLabel: '选择Heart颜色',
      confirmSelectionLabel: '获得Heart',
      canSkipSelection: false,
    },
  };
}

function finishKotoriLiveStart(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID ||
    effect.stepId !== KOTORI_SELECT_HEART_COLOR_STEP_ID ||
    !isHeartColorOption(selectedOptionId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const revealedCardId = getStringMetadata(effect, 'revealedCardId');
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || !revealedCardId || sourceSlot !== SlotPosition.CENTER) {
    return game;
  }

  const stackResult = stackMemberCardBelowStageMember(game, {
    playerId: player.id,
    sourceZone: ZoneType.HAND,
    movedCardId: revealedCardId,
    hostCardId: effect.sourceCardId,
    targetSlot: sourceSlot,
  });
  if (!stackResult) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(stackResult.gameState, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [createHeartIcon(selectedOptionId, 1)],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'STACK_REVEALED_MEMBER_GAIN_SELECTED_HEART',
      revealedCardId,
      stackedCardId: stackResult.movedCardId,
      selectedHeartColor: selectedOptionId,
      heartBonus: heartResult.heartBonus,
      sourceSlot,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startKotoriLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot === null) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      'SOURCE_NOT_ON_STAGE',
      continuePendingCardEffects
    );
  }
  const selectableCardIds = getLowCostMuseMemberIdsBelowSource(game, player.id, sourceSlot);
  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (selectableCardIds.length === 0 || emptySlots.length === 0) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return skipPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      selectableCardIds.length === 0 ? 'NO_LOW_COST_MUSE_MEMBER_BELOW' : 'NO_EMPTY_MEMBER_SLOT',
      continuePendingCardEffects
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: KOTORI_SELECT_MEMBER_BELOW_STEP_ID,
      stepText: "请选择此成员下方1张费用<=2的『μ's』成员卡。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectionLabel: '选择要登场的下方成员',
      confirmSelectionLabel: '选择登场区域',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        sourceSlot,
        liveSuccessEventIds: ability.eventIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      selectableCardIds,
      emptySlots,
      step: 'START_SELECT_MEMBER_BELOW',
    },
  });
}

function selectKotoriMemberBelow(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID ||
    effect.stepId !== KOTORI_SELECT_MEMBER_BELOW_STEP_ID
  ) {
    return game;
  }
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_PLAY_MEMBER_BELOW',
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const emptySlots = getEmptyMemberSlots(game, effect.controllerId);
  if (effect.selectableCardIds?.includes(selectedCardId) !== true || emptySlots.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: KOTORI_SELECT_EMPTY_SLOT_STEP_ID,
        stepText: '请选择登场到哪个空成员区。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableSlots: emptySlots,
        selectionLabel: '选择空成员区',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedMemberBelowCardId: selectedCardId,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_MEMBER_BELOW',
      selectedMemberBelowCardId: selectedCardId,
      emptySlots,
    }
  );
}

function finishKotoriLiveSuccess(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID ||
    effect.stepId !== KOTORI_SELECT_EMPTY_SLOT_STEP_ID ||
    selectedSlot === null ||
    !MEMBER_SLOT_ORDER.includes(selectedSlot)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId = getStringMetadata(effect, 'selectedMemberBelowCardId');
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || !selectedCardId || sourceSlot === null) {
    return game;
  }

  const playResult = playMemberBelowCardToEmptySlot(game, player.id, {
    hostCardId: effect.sourceCardId,
    fromSlot: sourceSlot,
    cardId: selectedCardId,
    toSlot: selectedSlot,
  });
  if (!playResult) {
    return game;
  }
  const stateWithOnEnter = enqueueTriggeredCardEffects(
    playResult.gameState,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, playResult.gameState),
    }
  );

  return continuePendingCardEffects(
    addAction({ ...stateWithOnEnter, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLAY_MEMBER_BELOW_TO_EMPTY_SLOT',
      playedCardId: selectedCardId,
      fromSlot: sourceSlot,
      toSlot: selectedSlot,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getLowCostMuseMemberIdsInHand(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.HAND,
    and(typeIs(CardType.MEMBER), costLte(2), groupAliasIs("μ's"))
  );
}

function getLowCostMuseMemberIdsBelowSource(
  game: GameState,
  playerId: string,
  sourceSlot: SlotPosition
): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getCardIdsMatchingSelector(
    game,
    player?.memberSlots.memberBelow[sourceSlot] ?? [],
    and(typeIs(CardType.MEMBER), costLte(2), groupAliasIs("μ's"))
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function isHeartColorOption(value: string | null): value is HeartColor {
  return HEART_COLOR_OPTIONS.some((color) => color === value);
}

function getStringMetadata(
  effect: { readonly metadata?: Readonly<Record<string, unknown>> },
  key: string
): string | null {
  const value = effect.metadata?.[key];
  return typeof value === 'string' ? value : null;
}
