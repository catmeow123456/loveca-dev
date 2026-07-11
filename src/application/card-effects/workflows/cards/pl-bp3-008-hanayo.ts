import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase, HeartColor, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
  PL_BP3_008_LIVE_START_OPTIONAL_WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-bp3-008';
const ACTIVATED_RECOVER_STEP_ID = 'PL_BP3_008_SELECT_MUSE_LIVE_FROM_WAITING_ROOM';
const LIVE_START_WAIT_MEMBER_STEP_ID = 'PL_BP3_008_SELECT_MUSE_MEMBER_TO_WAIT';
const YELLOW_HEART_BONUS = [{ color: HeartColor.YELLOW, count: 2 }] as const;

const museLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs("μ's"));
const museMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs("μ's"));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3008HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(
    PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
    (game, playerId, cardId) => startActivatedRecoverMuseLive(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
    ACTIVATED_RECOVER_STEP_ID,
    (game, input, context) =>
      finishActivatedRecoverMuseLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    PL_BP3_008_LIVE_START_OPTIONAL_WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartOptionalWait(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_008_LIVE_START_OPTIONAL_WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID,
    LIVE_START_WAIT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishLiveStartOptionalWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startActivatedRecoverMuseLive(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    !isHanayoSource(game, playerId, cardId)
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }
  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        addAction(state, 'PAY_COST', playerId, {
          abilityId: PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  const stateAfterUse = recordAbilityUseForContext(stateWithTriggers.gameState, playerId, {
    abilityId: PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
    sourceCardId: cardId,
  });
  const selectableCardIds = selectWaitingRoomCardIds(stateAfterUse, playerId, museLiveSelector);
  if (selectableCardIds.length === 0) {
    return addAction(stateAfterUse, 'RESOLVE_ABILITY', playerId, {
      abilityId: PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'PAID_COST_NO_MUSE_LIVE_TO_RECOVER',
      memberStateChangedEventIds: stateWithTriggers.memberStateChangedEvents.map(
        (event) => event.eventId
      ),
    });
  }

  return {
    ...stateAfterUse,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID}:${cardId}:turn-${stateAfterUse.turnCount}:action-${stateAfterUse.actionHistory.length}`,
      abilityId: PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID),
      stepId: ACTIVATED_RECOVER_STEP_ID,
      stepText: "请选择自己休息室中1张『μ's』的LIVE卡加入手牌。",
      awaitingPlayerId: playerId,
      selectableCardIds,
      selectionLabel: "选择要加入手牌的『μ's』LIVE卡",
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        sourceSlot,
        memberStateChangedEventIds: stateWithTriggers.memberStateChangedEvents.map(
          (event) => event.eventId
        ),
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({ minCount: 1, maxCount: 1, optional: false }),
    }),
  };
}

function finishActivatedRecoverMuseLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID ||
    effect.stepId !== ACTIVATED_RECOVER_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !selectWaitingRoomCardIds(game, player.id, museLiveSelector).includes(selectedCardId)
  ) {
    return game;
  }
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds ?? [],
    exactCount: 1,
  });
  if (!recovery) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...recovery.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'RECOVER_MUSE_LIVE',
      selectedCardId: recovery.movedCardIds[0] ?? null,
      memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds,
    }),
    false
  );
}

function startLiveStartOptionalWait(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null || !isHanayoSource(game, player.id, ability.sourceCardId)) {
    return consumePending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_OWN_STAGE',
    });
  }
  const selectableCardIds = getActiveMuseStageMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumePending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ACTIVE_MUSE_MEMBER_TO_WAIT',
    });
  }
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_START_WAIT_MEMBER_STEP_ID,
      stepText: "可以将自己舞台上的1名『μ's』成员变为待机状态。如此做时，LIVE结束时为止，此成员获得[黄ハート][黄ハート]。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: "选择变为待机状态的『μ's』成员",
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution, sourceSlot },
    },
  };
}

function finishLiveStartOptionalWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_008_LIVE_START_OPTIONAL_WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID ||
    effect.stepId !== LIVE_START_WAIT_MEMBER_STEP_ID ||
    !player
  ) {
    return game;
  }
  if (selectedCardId === null) {
    return finishLiveStart(game, player.id, 'DECLINE_WAIT_MUSE_MEMBER', {}, continuePendingCardEffects);
  }
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getActiveMuseStageMemberCardIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }
  const waitResult = setMemberOrientation(game, player.id, selectedCardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    pendingAbilityId: effect.id,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }
  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        addAction({ ...state, activeEffect: null }, 'PAY_COST', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          waitedMemberCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  const sourceStillOnStage = getSourceMemberSlot(
    stateWithTriggers.gameState,
    player.id,
    effect.sourceCardId
  ) !== null;
  const heartResult = sourceStillOnStage
    ? addHeartLiveModifierForMember(stateWithTriggers.gameState, {
        playerId: player.id,
        memberCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        hearts: YELLOW_HEART_BONUS,
      })
    : null;
  const stateAfterHeart = heartResult?.gameState ?? stateWithTriggers.gameState;
  return continuePendingCardEffects(
    addAction(stateAfterHeart, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: heartResult ? 'WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART' : 'PAID_COST_SOURCE_LEFT_STAGE',
      waitedMemberCardId: selectedCardId,
      heartBonus: heartResult?.heartBonus ?? [],
      memberStateChangedEventIds: stateWithTriggers.memberStateChangedEvents.map(
        (event) => event.eventId
      ),
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isHanayoSource(game: GameState, playerId: string, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return (
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, BASE_CARD_CODE)
  );
}

function getActiveMuseStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, museMemberSelector).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
}

function consumePending(
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
      ...payload,
    }),
    orderedResolution
  );
}

function finishLiveStart(
  game: GameState,
  playerId: string,
  step: string,
  payload: Readonly<Record<string, unknown>>,
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
      sourceSlot: effect.metadata?.sourceSlot,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
