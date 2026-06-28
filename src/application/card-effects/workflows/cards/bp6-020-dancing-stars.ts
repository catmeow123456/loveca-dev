import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { hasMemberPositionMovedThisTurn } from '../../../../domain/rules/member-turn-state.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import {
  BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID,
  BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerResolvedAbilityObserver } from '../../runtime/resolved-ability-observers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const POSITION_CHANGE_STEP_ID = 'BP6_020_DANCING_STARS_SELECT_POSITION_SLOT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp6020DancingStarsWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerResolvedAbilityObserver((game, context) =>
    enqueueBp6020DancingStarsResolvedAbilityObserver(game, context.resolvedAction)
  );
  registerPendingAbilityStarterHandler(
    BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options, context) =>
      startResolvedLiveStartPositionChange(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID,
    POSITION_CHANGE_STEP_ID,
    (game, input, context) =>
      finishResolvedLiveStartPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccessResolvedScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function enqueueBp6020DancingStarsResolvedAbilityObserver(
  game: GameState,
  resolvedAction: GameAction
): GameState {
  const resolved = getResolvedCenterMuseStageMemberAbility(game, resolvedAction);
  if (!resolved) {
    return game;
  }

  const observerAbilityId =
    resolved.category === CardAbilityCategory.LIVE_START
      ? BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID
      : BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID;
  const player = getPlayerById(game, resolved.playerId);
  if (!player) {
    return game;
  }

  let state = game;
  for (const liveCardId of player.liveZone.cardIds) {
    const liveCard = getCardById(state, liveCardId);
    if (!liveCard || liveCard.ownerId !== player.id) {
      continue;
    }
    const hasDancingAbility = getCardAbilityDefinitionsForCardCode(liveCard.data.cardCode).some(
      (definition) =>
        definition.abilityId === observerAbilityId &&
        definition.sourceZone === CardAbilitySourceZone.LIVE_CARD &&
        definition.category === CardAbilityCategory.AUTO
    );
    if (!hasDancingAbility || hasUsedAbilityThisTurn(state, player.id, observerAbilityId, liveCardId)) {
      continue;
    }

    const pendingAbilityId = `${observerAbilityId}:${liveCardId}:resolved-${resolvedAction.id}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId: observerAbilityId,
      sourceCardId: liveCardId,
      controllerId: player.id,
      mandatory: true,
      timingId:
        resolved.category === CardAbilityCategory.LIVE_START
          ? TriggerCondition.ON_LIVE_START
          : TriggerCondition.ON_LIVE_SUCCESS,
      eventIds: [resolvedAction.id],
      sourceSlot: SlotPosition.CENTER,
      metadata: {
        resolvedActionId: resolvedAction.id,
        resolvedAbilityId: resolved.abilityId,
        resolvedMemberCardId: resolved.memberCardId,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      player.id,
      {
        pendingAbilityId,
        abilityId: observerAbilityId,
        sourceCardId: liveCardId,
        timingId: pendingAbility.timingId,
        resolvedActionId: resolvedAction.id,
        resolvedAbilityId: resolved.abilityId,
        resolvedMemberCardId: resolved.memberCardId,
      }
    );
  }

  return state;
}

function startResolvedLiveStartPositionChange(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const targetMemberId = getResolvedMemberCardId(ability);
  if (!player || !targetMemberId || !isOwnStageMuseMember(game, player.id, targetMemberId)) {
    return finishNoOp(game, ability, player?.id ?? ability.controllerId, orderedResolution, {
      step: 'DANCING_STARS_POSITION_CHANGE_NOOP',
      reason: 'TARGET_NOT_STAGE_MUSE_MEMBER',
      targetMemberId,
    }, continuePendingCardEffects);
  }

  const sourceSlot = findMemberSlot(player, targetMemberId);
  if (!sourceSlot) {
    return finishNoOp(game, ability, player.id, orderedResolution, {
      step: 'DANCING_STARS_POSITION_CHANGE_NOOP',
      reason: 'TARGET_NOT_ON_STAGE',
      targetMemberId,
    }, continuePendingCardEffects);
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: POSITION_CHANGE_STEP_ID,
        stepText: '请选择要让该中心 μ’s 成员移动到的成员区。',
        awaitingPlayerId: player.id,
        selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          targetMemberId,
          sourceSlot,
          resolvedAbilityId: ability.metadata?.resolvedAbilityId ?? null,
          resolvedActionId: ability.metadata?.resolvedActionId ?? null,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_DANCING_STARS_POSITION_CHANGE',
      targetMemberId,
      sourceSlot,
    }
  );
}

function finishResolvedLiveStartPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== POSITION_CHANGE_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetMemberId =
    typeof effect.metadata?.targetMemberId === 'string' ? effect.metadata.targetMemberId : null;
  if (!player || !targetMemberId) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    targetMemberId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) => {
        const stateWithUse = recordAbilityUseForContext(
          {
            ...state,
            activeEffect: null,
          },
          player.id,
          {
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
          }
        );
        return addAction(stateWithUse, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'DANCING_STARS_POSITION_CHANGE',
          targetMemberId,
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        });
      },
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function resolveLiveSuccessResolvedScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targetMemberId = getResolvedMemberCardId(ability);
  const movedThisTurn =
    targetMemberId !== null && hasMemberPositionMovedThisTurn(game, player.id, targetMemberId);
  const scoreBonus = movedThisTurn ? 1 : 0;
  const stateWithoutPending = removePending(game, ability.id);
  const stateAfterModifier =
    scoreBonus > 0
      ? addLiveModifier(stateWithoutPending, {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        })
      : stateWithoutPending;
  const stateAfterScoreRefresh =
    scoreBonus > 0 ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus) : stateAfterModifier;
  const stateWithUse = recordAbilityUseForContext(stateAfterScoreRefresh, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  return continuePendingCardEffects(
    addAction(stateWithUse, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DANCING_STARS_MOVED_THIS_LIVE_SCORE',
      targetMemberId,
      movedThisTurn,
      scoreBonus,
      resolvedAbilityId: ability.metadata?.resolvedAbilityId ?? null,
      resolvedActionId: ability.metadata?.resolvedActionId ?? null,
    }),
    orderedResolution
  );
}

function finishNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const state = removePending(game, ability.id);
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function getResolvedMemberCardId(ability: PendingAbilityState): string | null {
  return typeof ability.metadata?.resolvedMemberCardId === 'string'
    ? ability.metadata.resolvedMemberCardId
    : null;
}

function isOwnStageMuseMember(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    player !== null &&
    card !== null &&
    Object.values(player.memberSlots.slots).includes(cardId) &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardBelongsToGroup(card.data, "μ's")
  );
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function getResolvedCenterMuseStageMemberAbility(
  game: GameState,
  action: GameAction
): {
  readonly abilityId: string;
  readonly category: CardAbilityCategory.LIVE_START | CardAbilityCategory.LIVE_SUCCESS;
  readonly memberCardId: string;
  readonly playerId: string;
} | null {
  const abilityId =
    typeof action.payload.abilityId === 'string' ? action.payload.abilityId : null;
  const sourceCardId =
    typeof action.payload.sourceCardId === 'string' ? action.payload.sourceCardId : null;
  if (!abilityId || !sourceCardId) {
    return null;
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (
    !sourceCard ||
    !isMemberCardData(sourceCard.data) ||
    !cardBelongsToGroup(sourceCard.data, "μ's")
  ) {
    return null;
  }

  const player = getPlayerById(game, sourceCard.ownerId);
  if (!player) {
    return null;
  }
  const sourceSlot =
    action.payload.sourceSlot === SlotPosition.LEFT ||
    action.payload.sourceSlot === SlotPosition.CENTER ||
    action.payload.sourceSlot === SlotPosition.RIGHT
      ? action.payload.sourceSlot
      : null;
  const isCenterSource =
    sourceSlot !== null
      ? sourceSlot === SlotPosition.CENTER
      : player.memberSlots.slots[SlotPosition.CENTER] === sourceCardId;
  if (!isCenterSource) {
    return null;
  }

  const definition = getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).find(
    (candidate) =>
      candidate.abilityId === abilityId &&
      candidate.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
      (candidate.category === CardAbilityCategory.LIVE_START ||
        candidate.category === CardAbilityCategory.LIVE_SUCCESS)
  );
  if (
    !definition ||
    (definition.category !== CardAbilityCategory.LIVE_START &&
      definition.category !== CardAbilityCategory.LIVE_SUCCESS)
  ) {
    return null;
  }

  return {
    abilityId,
    category: definition.category,
    memberCardId: sourceCardId,
    playerId: player.id,
  };
}

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

function hasUsedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  return game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.playerId === playerId &&
      historyAction.payload.step === 'ABILITY_USE' &&
      historyAction.payload.turnCount === game.turnCount &&
      historyAction.payload.abilityId === abilityId &&
      historyAction.payload.sourceCardId === sourceCardId
  );
}
