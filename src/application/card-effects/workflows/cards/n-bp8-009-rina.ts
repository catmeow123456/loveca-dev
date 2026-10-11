import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getLiveZoneCardEffectiveScores } from '../../../../domain/rules/live-zone-score.js';
import { FaceState, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID,
  N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  drawCardsForPlayer,
  moveHandCardToDeckBottomForPlayer,
  placeWaitingRoomLiveCardInLiveZoneForPlayer,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveLiveZoneCardToDeckTopForPlayer } from '../../runtime/live-zone-deck.js';
import { moveExactBottomDeckCardsToWaitingRoomAsCostAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import {
  createPublicRevealDwellBeforeNextEffect,
  withPublicRevealDwell,
} from '../../runtime/public-reveal-dwell.js';
import {
  queryCardSelection,
  queryConfirmSelection,
  queryOptionSelection,
} from '../../runtime/selection-query.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  registerActiveEffectStepHandler,
  type ActiveEffectStepHandlerInput,
} from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_HAND_STEP = 'N_BP8_009_SELECT_HAND_TO_BOTTOM';
const NO_HAND_DRAW_STEP = 'N_BP8_009_NO_HAND_CONTINUE_DRAW_TWO';
const OPTIONAL_BOTTOM_COST_STEP = 'N_BP8_009_OPTIONAL_BOTTOM_COST';
const SELECT_LIVE_TO_TOP_STEP = 'N_BP8_009_SELECT_LIVE_TO_TOP';
const SELECT_WAITING_LIVE_STEP = 'N_BP8_009_SELECT_WAITING_LIVE';
const FINISH_REVEAL_STEP = 'N_BP8_009_FINISH_BOTTOM_REVEAL';
const PAY_BOTTOM_OPTION = 'PLACE_BOTTOM_CARD_IN_WAITING_ROOM';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface NBp8009RinaWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}

export function registerNBp8009RinaWorkflowHandlers(
  dependencies: NBp8009RinaWorkflowDependencies
): void {
  registerActivatedAbilityHandler(
    N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID,
    startActivated
  );
  registerActiveEffectStepHandler(
    N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID,
    SELECT_HAND_STEP,
    (game, input, context) =>
      finishHandSelection(game, input.selectedCardId, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID,
    NO_HAND_DRAW_STEP,
    (game, _input, context) =>
      game.activeEffect
        ? context.continuePendingCardEffects(
            drawTwo(game, game.activeEffect.controllerId, game.activeEffect.sourceCardId),
            false
          )
        : game,
    queryConfirmSelection
  );
  registerPendingAbilityStarterHandler(
    N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveEffect(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID,
    OPTIONAL_BOTTOM_COST_STEP,
    (game, input, context) =>
      payBottomCost(game, input.selectedOptionId, dependencies, context.continuePendingCardEffects),
    queryOptionSelection
  );
  registerActiveEffectStepHandler(
    N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID,
    FINISH_REVEAL_STEP,
    (game, _input, context) =>
      finish(game, 'BOTTOM_CARD_REVEAL_COMPLETE', {}, context.continuePendingCardEffects),
    queryConfirmSelection
  );
  registerActiveEffectStepHandler(
    N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID,
    SELECT_LIVE_TO_TOP_STEP,
    (game, input, context) => selectLiveToTop(game, input, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID,
    SELECT_WAITING_LIVE_STEP,
    (game, input, context) => selectWaitingLive(game, input, context.continuePendingCardEffects),
    queryCardSelection
  );
}

function getHandCandidates(game: GameState, playerId: string): readonly string[] {
  return (getPlayerById(game, playerId)?.hand.cardIds ?? []).filter(
    (id) => getCardById(game, id)?.ownerId === playerId
  );
}

function startActivated(game: GameState, playerId: string, cardId: string): GameState {
  const source = getCardById(game, cardId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, 'PL!N-bp8-009') ||
    getSourceMemberSlot(game, playerId, cardId) === null
  )
    return game;
  const abilityId = N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID;
  const state = recordAbilityUseForContext(game, playerId, { abilityId, sourceCardId: cardId });
  const candidateCardIds = getHandCandidates(state, playerId);
  if (candidateCardIds.length === 0) return drawTwo(state, playerId, cardId);
  return {
    ...state,
    activeEffect: {
      id: globalThis.crypto.randomUUID(),
      abilityId,
      sourceCardId: cardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(abilityId),
      stepId: SELECT_HAND_STEP,
      stepText: '请选择1张手牌放置于卡组底，然后抽2张卡。',
      awaitingPlayerId: playerId,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择放置于卡组底的手牌',
      confirmSelectionLabel: '放置于卡组底',
    },
  };
}

function drawTwo(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  bottomedCardId?: string
): GameState {
  const result = drawCardsForPlayer(game, playerId, 2);
  return addAction(
    { ...(result?.gameState ?? game), activeEffect: null },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID,
      sourceCardId,
      effectText: getAbilityEffectText(N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID),
      step: 'BOTTOM_HAND_DRAW_TWO',
      bottomedCardId: bottomedCardId ?? null,
      drawnCardIds: result?.drawnCardIds ?? [],
    }
  );
}

function finishHandSelection(
  game: GameState,
  selectedCardId: string | null | undefined,
  continuePending: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  const candidates = getHandCandidates(game, effect.controllerId);
  if (!selectedCardId || !effect.selectableCardIds?.includes(selectedCardId)) return game;
  if (candidates.length === 0)
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepId: NO_HAND_DRAW_STEP,
        stepText: '已没有可放置于卡组底的手牌。确认后继续抽2张卡。',
        selectableCardIds: undefined,
        selectableCardMode: undefined,
        selectableCardVisibility: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: '继续抽2张卡',
      },
    };
  if (!candidates.includes(selectedCardId))
    return { ...game, activeEffect: { ...effect, selectableCardIds: candidates } };
  const moved = moveHandCardToDeckBottomForPlayer(game, effect.controllerId, selectedCardId, {
    candidateCardIds: effect.selectableCardIds ?? [],
  });
  return moved
    ? continuePending(
        drawTwo(moved.gameState, effect.controllerId, effect.sourceCardId, moved.movedCardId),
        false
      )
    : game;
}

function startLiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePending: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  // The AUTO has already triggered. Leaving the stage does not cancel its non-source actions.
  if (player.mainDeck.cardIds.length === 0) {
    return continuePending(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'BOTTOM_COST_UNPAYABLE',
        }
      ),
      orderedResolution
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      sourceLifecycleId: ability.sourceLifecycleId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: OPTIONAL_BOTTOM_COST_STEP,
      stepText: '可以将卡组底的1张卡放置入休息室，发动此效果。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: PAY_BOTTOM_OPTION, label: '将卡组底的卡放置入休息室' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'CHOOSE_BOTTOM_COST' },
  });
}

function getLiveToTopCandidates(game: GameState, playerId: string): readonly string[] {
  return getLiveZoneCardEffectiveScores(game, playerId).flatMap(({ cardId, effectiveScore }) => {
    const card = getCardById(game, cardId);
    return effectiveScore <= 2 && card && groupAliasIs('虹ヶ咲')(card) ? [cardId] : [];
  });
}

function getWaitingLiveCandidates(game: GameState, playerId: string): readonly string[] {
  return (getPlayerById(game, playerId)?.waitingRoom.cardIds ?? []).filter((id) => {
    const card = getCardById(game, id);
    return card?.ownerId === playerId && isLiveCardData(card.data);
  });
}

function payBottomCost(
  game: GameState,
  optionId: string | null | undefined,
  dependencies: NBp8009RinaWorkflowDependencies,
  continuePending: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  if (!optionId) return finish(game, 'DECLINE_BOTTOM_COST', {}, continuePending);
  if (optionId !== PAY_BOTTOM_OPTION) return game;
  const paid = moveExactBottomDeckCardsToWaitingRoomAsCostAndEnqueueTriggers(
    game,
    effect.controllerId,
    1,
    dependencies.enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!paid) return finish(game, 'BOTTOM_COST_UNPAYABLE', {}, continuePending);
  let state = recordPayCostAction(paid.gameState, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    movedCardIds: paid.movedCardIds,
    amount: 1,
  });
  const paidCard = getCardById(state, paid.movedCardIds[0]!);
  const bottomCardWasLive = paidCard !== null && isLiveCardData(paidCard.data);
  const candidates = bottomCardWasLive ? getLiveToTopCandidates(state, effect.controllerId) : [];
  const nextEffect: ActiveEffectState = {
    ...effect,
    selectableOptions: undefined,
    canSkipSelection: false,
    skipSelectionLabel: undefined,
    metadata: {
      ...effect.metadata,
      paidBottomCardIds: paid.movedCardIds,
      bottomCardWasLive,
      refreshCount: paid.refreshCount,
    },
    stepId: candidates.length > 0 ? SELECT_LIVE_TO_TOP_STEP : FINISH_REVEAL_STEP,
    stepText:
      candidates.length > 0
        ? '请选择1张分数小于等于2的虹咲LIVE卡放置于卡组顶。'
        : '卡组底的卡已放置入休息室，展示结束后继续处理。',
    selectableCardIds: candidates.length > 0 ? candidates : undefined,
    selectableCardMode: candidates.length > 0 ? 'SINGLE' : undefined,
    selectableCardVisibility: candidates.length > 0 ? 'PUBLIC' : undefined,
    selectionLabel: candidates.length > 0 ? '选择放置于卡组顶的LIVE卡' : undefined,
    confirmSelectionLabel: candidates.length > 0 ? '放置于卡组顶' : undefined,
  };
  state = addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PAY_BOTTOM_COST',
    movedCardIds: paid.movedCardIds,
    bottomCardWasLive,
    refreshCount: paid.refreshCount,
  });
  return candidates.length > 0
    ? createPublicRevealDwellBeforeNextEffect(state, nextEffect, {
        revealedCardIds: paid.movedCardIds,
      })
    : { ...state, activeEffect: withPublicRevealDwell(nextEffect, paid.movedCardIds) };
}

function hasOnlyCardInput(input: ActiveEffectStepHandlerInput): boolean {
  return Object.entries(input).every(
    ([key, value]) =>
      value === undefined ||
      value === null ||
      (key === 'resolveInOrder' && value === false) ||
      key === 'selectedCardId'
  );
}

function selectLiveToTop(
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  continuePending: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !hasOnlyCardInput(input)) return game;
  if (input.selectedCardId && !effect.selectableCardIds?.includes(input.selectedCardId))
    return game;
  const candidates = getLiveToTopCandidates(game, effect.controllerId);
  if (candidates.length === 0) return finish(game, 'NO_LIVE_TO_TOP', {}, continuePending);
  const selectedId = input.selectedCardId;
  if (!selectedId) return game;
  if (!candidates.includes(selectedId))
    return { ...game, activeEffect: { ...effect, selectableCardIds: candidates } };
  const moved = moveLiveZoneCardToDeckTopForPlayer(game, effect.controllerId, selectedId, {
    candidateCardIds: candidates,
  });
  if (!moved) return game;
  const state = addAction(moved.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'RETURN_LIVE_TO_DECK_TOP',
    movedCardId: moved.movedCardId,
  });
  const waitingCandidates = getWaitingLiveCandidates(state, effect.controllerId);
  if (waitingCandidates.length === 0)
    return finish(
      state,
      'NO_WAITING_ROOM_LIVE',
      { returnedLiveCardId: selectedId },
      continuePending
    );
  return {
    ...state,
    activeEffect: {
      ...effect,
      stepId: SELECT_WAITING_LIVE_STEP,
      stepText: '请选择休息室的1张LIVE卡正面放置入LIVE卡区。',
      selectableCardIds: waitingCandidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择正面放置入LIVE卡区的LIVE卡',
      confirmSelectionLabel: '正面放置入LIVE卡区',
      metadata: {
        ...effect.metadata,
        returnedLiveCardId: selectedId,
        publicCardSelectionConfirmation: { destination: 'LIVE_ZONE', source: 'WAITING_ROOM' },
      },
    },
  };
}

function selectWaitingLive(
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  continuePending: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !hasOnlyCardInput(input)) return game;
  if (input.selectedCardId && !effect.selectableCardIds?.includes(input.selectedCardId))
    return game;
  const candidates = getWaitingLiveCandidates(game, effect.controllerId);
  if (candidates.length === 0) return finish(game, 'NO_WAITING_ROOM_LIVE', {}, continuePending);
  const selectedId = input.selectedCardId;
  if (
    !selectedId ||
    !candidates.includes(selectedId) ||
    !effect.selectableCardIds?.includes(selectedId)
  ) {
    return {
      ...game,
      activeEffect: {
        ...effect,
        selectableCardIds: candidates,
        revealedCardIds: undefined,
        metadata: { ...effect.metadata, publicCardSelectionResolutionCompleted: undefined },
      },
    };
  }
  // Movement only follows the timed public selection restoration, and rechecks the current source.
  if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
  const placed = placeWaitingRoomLiveCardInLiveZoneForPlayer(
    game,
    effect.controllerId,
    selectedId,
    { candidateCardIds: candidates, face: FaceState.FACE_UP }
  );
  return placed
    ? finish(
        placed.gameState,
        'PLACE_WAITING_ROOM_LIVE_FACE_UP',
        { placedLiveCardId: placed.movedCardId },
        continuePending
      )
    : game;
}

function finish(
  game: GameState,
  step: string,
  payload: Readonly<Record<string, unknown>>,
  continuePending: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  return continuePending(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
