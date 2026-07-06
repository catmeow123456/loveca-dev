import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';

const SELECT_OPPONENT_LIVE_STEP_ID = 'PL_S_PB1_002_SELECT_OPPONENT_HAND_LIVE';
const SCORE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSPb1002RikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startOpponentDiscardLiveOrScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
    SELECT_OPPONENT_LIVE_STEP_ID,
    (game, input, context) =>
      finishOpponentDiscardLiveOrScore(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startOpponentDiscardLiveOrScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (!player || !opponent) {
    return game;
  }

  const opponentLiveCardIds = getPlayerHandLiveCardIds(game, opponent.id);
  if (opponentLiveCardIds.length === 0) {
    return applyScoreOrNoOpAndContinue(
      consumePendingAbility(game, ability),
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_OPPONENT_HAND_LIVE'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: opponent.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_OPPONENT_LIVE_STEP_ID,
      stepText: '对方可以将自己手牌中1张LIVE卡放置入休息室；不放置时，来源成员获得LIVE合计[スコア]+1。',
      awaitingPlayerId: opponent.id,
      selectableCardIds: opponentLiveCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要放置入休息室的LIVE卡',
      confirmSelectionLabel: '放置LIVE卡',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_OPPONENT_DISCARD_LIVE_OR_SCORE',
      selectableCardIds: opponentLiveCardIds,
    },
  });
}

function finishOpponentDiscardLiveOrScore(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game);
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const opponent = getOpponent(game, effect.controllerId);
  if (!player || !opponent) {
    return game;
  }

  if (selectedCardId === null) {
    return applyScoreOrNoOpAndContinue(
      { ...game, activeEffect: null },
      effect,
      player.id,
      effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      'OPPONENT_DECLINED_DISCARD_LIVE'
    );
  }
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const currentOpponentLiveCardIds = getPlayerHandLiveCardIds(game, opponent.id);
  if (!currentOpponentLiveCardIds.includes(selectedCardId)) {
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
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'OPPONENT_DISCARD_HAND_LIVE',
      opponentId: opponent.id,
      discardedCardId: selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function applyScoreOrNoOpAndContinue(
  game: GameState,
  ability: Pick<PendingAbilityState | ActiveEffectState, 'id' | 'abilityId' | 'sourceCardId'>,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const sourceSlot = getSourceMemberSlot(game, playerId, ability.sourceCardId);
  const state =
    sourceSlot === null
      ? game
      : addPlayerScoreDraft(
          addLiveModifier(game, createSourceScoreModifier(playerId, ability.sourceCardId)),
          playerId,
          SCORE_BONUS
        );

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : step,
      scoreBonus: sourceSlot === null ? 0 : SCORE_BONUS,
    }),
    orderedResolution
  );
}

function createSourceScoreModifier(
  playerId: string,
  sourceCardId: string
): Extract<LiveModifierState, { readonly kind: 'SCORE' }> {
  return {
    kind: 'SCORE',
    playerId,
    countDelta: SCORE_BONUS,
    sourceCardId,
    abilityId: PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
  };
}

function addPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
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

function getActiveEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_LIVE_STEP_ID
  ) {
    return null;
  }
  return effect;
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}
