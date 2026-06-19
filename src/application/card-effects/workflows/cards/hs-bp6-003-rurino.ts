import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type {
  EnterWaitingRoomEvent,
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
  HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP6_003_SELECT_ACTIVATE_MEMBER_STEP_ID = 'HS_BP6_003_SELECT_WAITING_MIRACRA_MEMBER';
export const HS_BP6_003_SELECT_RECOVER_LIVE_STEP_ID =
  'HS_BP6_003_SELECT_MIRACRA_LIVE_FROM_WAITING_ROOM';
export const HS_BP6_003_SELECT_DISCARD_STEP_ID = 'HS_BP6_003_SELECT_DISCARD_FOR_HEART';
export const HS_BP6_003_SELECT_HEART_TARGET_STEP_ID = 'HS_BP6_003_SELECT_MIRACRA_HEART_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

const miraCraMember = and(typeIs(CardType.MEMBER), unitAliasIs('Mira-Cra Park!'));
const miraCraLive = and(typeIs(CardType.LIVE), unitAliasIs('Mira-Cra Park!'));

export function registerHsBp6003RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp6003RurinoOnEnterActivateMember(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
    HS_BP6_003_SELECT_ACTIVATE_MEMBER_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsBp6003RurinoActivateMember(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
    HS_BP6_003_SELECT_RECOVER_LIVE_STEP_ID,
    (game, input, context) =>
      finishHsBp6003RurinoRecoverLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
    (game, ability, options) =>
      startHsBp6003RurinoLiveStartDiscard(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
    HS_BP6_003_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startHsBp6003RurinoHeartTargetSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
    HS_BP6_003_SELECT_HEART_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsBp6003RurinoHeartTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp6003RurinoOnEnterActivateMember(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(
      HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID
    ),
    stepId: HS_BP6_003_SELECT_ACTIVATE_MEMBER_STEP_ID,
    stepText: '可以选择自己舞台1名待机状态的 Mira-Cra 成员变为活跃。',
    awaitingPlayerId: player.id,
    targetPlayerId: player.id,
    selector: miraCraMember,
    targetOrientation: OrientationState.ACTIVE,
    selectionLabel: '选择变为活跃的成员',
    orderedResolution,
    metadata: {
      sourceSlot: ability.sourceSlot,
    },
  });

  if (!targetSelection.activeEffect) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_WAITING_MIRACRA_MEMBER_TARGET',
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...targetSelection.activeEffect,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_WAITING_MIRACRA_MEMBER',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: targetSelection.selectableCardIds,
    },
  });
}

function finishHsBp6003RurinoActivateMember(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP6_003_SELECT_ACTIVATE_MEMBER_STEP_ID ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange) {
    return game;
  }

  const stateAfterAction = addAction(orientationChange.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'ACTIVATE_MIRACRA_MEMBER',
    sourceSlot: effect.metadata?.sourceSlot,
    targetCardId: selectedCardId,
    previousOrientation: orientationChange.previousOrientation,
    nextOrientation: orientationChange.nextOrientation,
  });

  const selectableCardIds = selectWaitingRoomCardIds(stateAfterAction, player.id, miraCraLive);
  if (selectableCardIds.length === 0) {
    const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      orientationChange,
      enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: () => ({
          ...stateAfterAction,
          activeEffect: null,
        }),
      }
    );
    return continuePendingCardEffects(
      addAction(stateWithMemberStateTriggers.gameState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_MIRACRA_LIVE_TO_RECOVER',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const stateWithRecoverStep = {
    ...stateAfterAction,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: effect.effectText,
      stepId: HS_BP6_003_SELECT_RECOVER_LIVE_STEP_ID,
      stepText: '请选择自己休息室中1张 Mira-Cra LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        orderedResolution: effect.metadata?.orderedResolution === true,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };

  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: () => stateWithRecoverStep,
    }
  ).gameState;
}

function finishHsBp6003RurinoRecoverLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP6_003_SELECT_RECOVER_LIVE_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...recoveryResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'RECOVER_MIRACRA_LIVE',
        sourceSlot: effect.metadata?.sourceSlot,
        selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function startHsBp6003RurinoLiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID),
      stepId: HS_BP6_003_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function startHsBp6003RurinoHeartTargetSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP6_003_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
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

  const selectableCardIds = getStageMemberCardIdsMatching(
    discardResult.gameState,
    player.id,
    miraCraMember
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...discardResult.gameState,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'DISCARD_HAND_CARD_NO_MIRACRA_TARGET',
          sourceSlot: effect.metadata?.sourceSlot,
          discardedCardId: discardResult.discardedCardIds[0],
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: HS_BP6_003_SELECT_HEART_TARGET_STEP_ID,
        stepText: '请选择自己舞台1名 Mira-Cra 成员获得桃Heart。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得桃Heart的成员',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardId: discardResult.discardedCardIds[0],
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
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      selectableCardIds,
    }
  );
}

function finishHsBp6003RurinoHeartTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP6_003_SELECT_HEART_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const modifierResult = addHeartLiveModifierForMember(
    {
      ...game,
      activeEffect: null,
    },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
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
      step: 'APPLY_MIRACRA_TARGET_MEMBER_HEART',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      targetCardId: selectedCardId,
      heartColor: HeartColor.PINK,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbilityWithoutActiveEffect(
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
