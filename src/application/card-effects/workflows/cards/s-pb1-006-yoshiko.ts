import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, SubPhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PL_S_PB1_006_ACTIVATED_REVEAL_HAND_LIVE_OPPONENT_DISCARD_OR_GAIN_FOUR_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID =
  PL_S_PB1_006_ACTIVATED_REVEAL_HAND_LIVE_OPPONENT_DISCARD_OR_GAIN_FOUR_BLADE_ABILITY_ID;
const BASE_CARD_CODE = 'PL!S-pb1-006';
const REVEAL_HAND_LIVE_STEP_ID = 'PL_S_PB1_006_REVEAL_HAND_LIVE';
const OPPONENT_DISCARD_STEP_ID = 'PL_S_PB1_006_OPPONENT_DISCARD_HAND';
const BLADE_BONUS = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSPb1006YoshikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, startYoshikoRevealLiveOpponentDiscardOrBlade);
  registerActiveEffectStepHandler(ABILITY_ID, REVEAL_HAND_LIVE_STEP_ID, (game, input, context) =>
    revealYoshikoHandLive(
      game,
      input.selectedCardId ?? null,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, OPPONENT_DISCARD_STEP_ID, (game, input, context) =>
    finishYoshikoOpponentDiscardOrBlade(
      game,
      input.selectedCardId ?? null,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    )
  );
}

function startYoshikoRevealLiveOpponentDiscardOrBlade(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.currentSubPhase !== SubPhase.NONE
  ) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot === null
  ) {
    return game;
  }

  const selectableCardIds = getPlayerHandLiveCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: REVEAL_HAND_LIVE_STEP_ID,
        stepText: '请选择并公开手牌中的1张LIVE卡。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要公开的LIVE卡',
        confirmSelectionLabel: '公开LIVE卡',
        metadata: {
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_REVEAL_HAND_LIVE',
      selectableCardIds,
    }
  );
}

function revealYoshikoHandLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getYoshikoActiveEffect(game, REVEAL_HAND_LIVE_STEP_ID);
  if (!effect || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectedCard = getCardById(game, selectedCardId);
  if (
    !player ||
    !selectedCard ||
    !player.hand.cardIds.includes(selectedCardId) ||
    !isLiveCardData(selectedCard.data)
  ) {
    return game;
  }

  const opponent = getOpponent(game, player.id);
  const revealedCardIds = Array.from(
    new Set([...(effect.revealedCardIds ?? []), selectedCardId])
  );
  const opponentHandCardIds = opponent ? [...opponent.hand.cardIds] : [];
  let state = addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: OPPONENT_DISCARD_STEP_ID,
        stepText:
          opponentHandCardIds.length > 0
            ? '对方可以将自己手牌1张放置入休息室；不放置时，来源成员获得[BLADE]x4。'
            : '对方没有手牌可放置。确认后，来源成员获得[BLADE]x4。',
        awaitingPlayerId: opponent?.id ?? player.id,
        revealedCardIds,
        selectableCardIds: opponentHandCardIds,
        selectableCardVisibility:
          opponentHandCardIds.length > 0 ? 'AWAITING_PLAYER_ONLY' : 'PUBLIC',
        selectableCardMode: opponentHandCardIds.length > 0 ? 'SINGLE' : undefined,
        selectionLabel: opponentHandCardIds.length > 0 ? '选择要放置入休息室的手牌' : undefined,
        confirmSelectionLabel: opponentHandCardIds.length > 0 ? '放置手牌' : '确认',
        canSkipSelection: true,
        skipSelectionLabel: opponentHandCardIds.length > 0 ? '不放置' : '确认',
        metadata: {
          ...effect.metadata,
          revealedHandLiveCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_HAND_LIVE',
      revealedHandLiveCardId: selectedCardId,
    }
  );
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
  });

  if (opponentHandCardIds.length === 0) {
    const nextEffect = getYoshikoActiveEffect(state, OPPONENT_DISCARD_STEP_ID);
    return nextEffect
      ? applyBladeOrNoOpAndFinish(
          state,
          nextEffect,
          player.id,
          'OPPONENT_NO_HAND',
          continuePendingCardEffects
        )
      : state;
  }

  return state;
}

function finishYoshikoOpponentDiscardOrBlade(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getYoshikoActiveEffect(game, OPPONENT_DISCARD_STEP_ID);
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponent = getOpponent(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    return applyBladeOrNoOpAndFinish(
      game,
      effect,
      player.id,
      'OPPONENT_DECLINED_DISCARD',
      continuePendingCardEffects
    );
  }
  if (
    !opponent ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !opponent.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    opponent.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'OPPONENT_DISCARD_HAND',
      opponentId: opponent.id,
      discardedCardId: selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
      bladeBonus: 0,
    }),
    false
  );
}

function applyBladeOrNoOpAndFinish(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const sourceSlot = getSourceMemberSlot(game, playerId, effect.sourceCardId);
  const bladeResult =
    sourceSlot === null
      ? null
      : addBladeLiveModifierForSourceMember(game, {
          playerId,
          sourceCardId: effect.sourceCardId,
          abilityId: ABILITY_ID,
          amount: BLADE_BONUS,
        });
  const state = bladeResult?.gameState ?? game;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      sourceSlot,
      step: sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : step,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    false
  );
}

function getPlayerHandLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
}

function getYoshikoActiveEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== stepId) {
    return null;
  }
  return effect;
}
