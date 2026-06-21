import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import type {
  EnterWaitingRoomEvent,
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import {
  GamePhase,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID,
  PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { getNewMemberStateChangedEvents } from '../../runtime/events.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../runtime/member-state-changed-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

export const N_BP3_008_ACTIVATED_SELECT_WAIT_TARGET_STEP_ID =
  'N_BP3_008_ACTIVATED_SELECT_WAIT_TARGET';
export const N_BP3_008_LIVE_START_SELECT_DISCARD_TWO_STEP_ID =
  'N_BP3_008_LIVE_START_SELECT_DISCARD_TWO';
export const N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET_STEP_ID =
  'N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

const GREEN_HEART_BONUS = [{ color: HeartColor.GREEN, count: 1 }] as const;
const isNijigasakiCard = groupAliasIs('虹ヶ咲');

export function registerNBp3008EmmaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID,
    (game, playerId, cardId) => startActivatedWaitOtherNijigasakiDrawOne(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID,
    N_BP3_008_ACTIVATED_SELECT_WAIT_TARGET_STEP_ID,
    (game, input) =>
      finishActivatedWaitOtherNijigasakiDrawOne(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
    (game, ability, options) =>
      startLiveStartDiscardTwoActivateOtherMember(
        game,
        ability,
        options.orderedResolution === true
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
    N_BP3_008_LIVE_START_SELECT_DISCARD_TWO_STEP_ID,
    (game, input, context) =>
      input.selectedCardId === null || input.selectedCardIds === undefined
        ? finishSkippedActiveEffect(game, context.continuePendingCardEffects)
        : finishLiveStartDiscardTwo(
            game,
            input.selectedCardIds,
            deps.enqueueTriggeredCardEffects,
            context.continuePendingCardEffects
          )
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
    N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET_STEP_ID,
    (game, input, context) =>
      finishLiveStartActivateTarget(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startActivatedWaitOtherNijigasakiDrawOne(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !isEmmaSourceOnOwnStage(game, player.id, cardId) ||
    sourceSlot === null
  ) {
    return game;
  }

  const selectableCardIds = getActivatedCostTargetIds(game, player.id, cardId);
  if (selectableCardIds.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID
        ),
        stepId: N_BP3_008_ACTIVATED_SELECT_WAIT_TARGET_STEP_ID,
        stepText: '请选择此成员以外的1名「虹咲」成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择变为待机状态的成员',
        confirmSelectionLabel: '变为待机状态',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_SELECT_WAIT_OTHER_NIJIGASAKI',
      selectableCardIds,
    }
  );
}

function finishActivatedWaitOtherNijigasakiDrawOne(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID ||
    effect.stepId !== N_BP3_008_ACTIVATED_SELECT_WAIT_TARGET_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getActivatedCostTargetIds(game, player.id, effect.sourceCardId).includes(selectedCardId)
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, player.id, selectedCardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  if (!waitResult || waitResult.previousOrientation === OrientationState.WAITING) {
    return game;
  }

  const memberStateChangedEvents = getNewMemberStateChangedEvents(game, waitResult.gameState);
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result) =>
        addAction(stateAfterWait, 'PAY_COST', player.id, {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          waitedMemberCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  let state = recordAbilityUseForContext(stateWithMemberStateTriggers.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }
  state = drawResult.gameState;

  return addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: 'WAIT_OTHER_NIJIGASAKI_DRAW_ONE',
    waitedMemberCardId: selectedCardId,
    drawnCardIds: drawResult.drawnCardIds,
  });
}

function startLiveStartDiscardTwoActivateOtherMember(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: N_BP3_008_LIVE_START_SELECT_DISCARD_TWO_STEP_ID,
      stepText: '请选择2张手牌放置入休息室。也可以选择不发动此效果。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_DISCARD_TWO',
      selectableCardIds,
    },
  });
}

function finishLiveStartDiscardTwo(
  game: GameState,
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== N_BP3_008_LIVE_START_SELECT_DISCARD_TWO_STEP_ID ||
    !player ||
    selectedCardIds.length !== 2 ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
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
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const state = discardResult.gameState;
  const selectableCardIds = getLiveStartActivateTargetIds(
    state,
    player.id,
    effect.sourceCardId
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DISCARD_TWO_NO_WAITING_TARGET',
        discardedCardIds: discardResult.discardedCardIds,
        activatedMemberCardIds: [],
        greenHeartMemberCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET_STEP_ID,
        stepText: '请选择此成员以外的1名待机状态成员变为活跃状态。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择变为活跃状态的成员',
        confirmSelectionLabel: '变为活跃状态',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'DISCARD_TWO_SELECT_ACTIVATE_TARGET',
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishLiveStartActivateTarget(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getLiveStartActivateTargetIds(game, player.id, effect.sourceCardId).includes(selectedCardId)
  ) {
    return game;
  }

  const activateResult = setMemberOrientation(
    game,
    player.id,
    selectedCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!activateResult || activateResult.previousOrientation !== OrientationState.WAITING) {
    return game;
  }

  const memberStateChangedEvents = getNewMemberStateChangedEvents(game, activateResult.gameState);
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    activateResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterActivate, result) =>
        addAction(stateAfterActivate, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'ACTIVATE_WAITING_MEMBER',
          targetMemberCardId: selectedCardId,
          discardedCardIds: getDiscardedCardIds(effect.metadata),
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  const targetHeartResult = addHeartLiveModifierForMember(
    stateWithMemberStateTriggers.gameState,
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: GREEN_HEART_BONUS,
    }
  );
  if (!targetHeartResult) {
    return game;
  }
  const sourceHeartResult = addHeartLiveModifierForMember(targetHeartResult.gameState, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: GREEN_HEART_BONUS,
  });
  if (!sourceHeartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...sourceHeartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'GAIN_GREEN_HEARTS',
      targetMemberCardId: selectedCardId,
      discardedCardIds: getDiscardedCardIds(effect.metadata),
      greenHeartMemberCardIds: [selectedCardId, effect.sourceCardId],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isEmmaSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const sourceCard = getCardById(game, sourceCardId);
  return (
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isMemberCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp3-008') &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null
  );
}

function getActivatedCostTargetIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getOwnStageMemberCardIds(game, playerId).filter((cardId) => {
    if (cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    const player = getPlayerById(game, playerId);
    const state = player?.memberSlots.cardStates.get(cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      isNijigasakiCard(card) &&
      state?.orientation !== OrientationState.WAITING
    );
  });
}

function getLiveStartActivateTargetIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getOwnStageMemberCardIds(game, playerId).filter((cardId) => {
    if (cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    const player = getPlayerById(game, playerId);
    const state = player?.memberSlots.cardStates.get(cardId);
    return card !== null && isMemberCardData(card.data) && state?.orientation === OrientationState.WAITING;
  });
}

function getOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player ? Object.values(player.memberSlots.slots).filter((cardId): cardId is string => cardId !== null) : [];
}

function getDiscardedCardIds(metadata: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  return Array.isArray(metadata?.discardedCardIds)
    ? metadata.discardedCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
}
