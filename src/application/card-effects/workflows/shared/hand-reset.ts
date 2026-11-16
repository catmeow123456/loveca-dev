import {
  addAction,
  getPlayerById,
  type GameState,
  type ActiveEffectState,
  type HextechActiveEffectState,
} from '../../../../domain/entities/game.js';
import { drawCardsForEachPlayer } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';

export const HAND_RESET_DISCARD_STEP_ID = 'BP5_007_SELECT_HAND_DISCARD_TO_THREE';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
export type HandResetContext =
  | Pick<ActiveEffectState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId' | 'effectText'>
  | Pick<
      HextechActiveEffectState,
      | 'id'
      | 'abilityId'
      | 'sourceKind'
      | 'sourceHextechInstanceId'
      | 'sourceCardId'
      | 'controllerId'
      | 'effectText'
    >;
function handResetSource(context: HandResetContext) {
  return context.sourceCardId !== undefined
    ? { sourceCardId: context.sourceCardId }
    : { sourceKind: 'HEXTECH' as const, sourceHextechInstanceId: context.sourceHextechInstanceId };
}

export function startNextHandResetDiscard(
  game: GameState,
  context: HandResetContext,
  playerIds: readonly string[],
  startIndex: number,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  for (let index = startIndex; index < playerIds.length; index += 1) {
    const playerId = playerIds[index];
    const player = getPlayerById(game, playerId);
    const discardCount = Math.max(0, (player?.hand.cardIds.length ?? 0) - 3);
    if (!player || discardCount === 0) {
      continue;
    }

    const stepText = `请选择${discardCount}张手牌放置入休息室，使手牌数变为3张。`;
    return addAction(
      {
        ...game,
        activeEffect: {
          id: context.id,
          abilityId: context.abilityId,
          ...handResetSource(context),
          controllerId: context.controllerId,
          effectText: context.effectText,
          stepId: HAND_RESET_DISCARD_STEP_ID,
          stepText,
          awaitingPlayerId: player.id,
          selectableCardIds: player.hand.cardIds,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: discardCount,
          maxSelectableCards: discardCount,
          selectionLabel: '请选择要放置入休息室的手牌',
          confirmSelectionLabel: '放置入休息室',
          metadata: {
            orderedResolution,
            discardPlayerIds: playerIds,
            discardPlayerIndex: index,
            discardCount,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: context.id,
        abilityId: context.abilityId,
        ...handResetSource(context),
        step: 'START_DISCARD_TO_THREE',
        discardPlayerId: player.id,
        discardCount,
      }
    );
  }

  return finishHandResetDraw(
    game,
    context,
    playerIds,
    orderedResolution,
    continuePendingCardEffects
  );
}

export function finishHandResetDiscard(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== HAND_RESET_DISCARD_STEP_ID || !effect.awaitingPlayerId) {
    return game;
  }

  const player = getPlayerById(game, effect.awaitingPlayerId);
  if (!player) {
    return game;
  }

  const discardCount =
    typeof effect.metadata?.discardCount === 'number'
      ? Math.floor(effect.metadata.discardCount)
      : Math.max(0, player.hand.cardIds.length - 3);
  const selectedCardIdsList =
    selectedCardIds && selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId
        ? [selectedCardId]
        : [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIdsList)];
  const selectableCardIds = effect.selectableCardIds ?? [];

  if (
    uniqueSelectedCardIds.length !== discardCount ||
    uniqueSelectedCardIds.length !== selectedCardIdsList.length ||
    uniqueSelectedCardIds.some(
      (cardId) => !selectableCardIds.includes(cardId) || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: discardCount,
      candidateCardIds: selectableCardIds,
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const playerIds = Array.isArray(effect.metadata?.discardPlayerIds)
    ? effect.metadata.discardPlayerIds.filter((value): value is string => typeof value === 'string')
    : [effect.controllerId];
  const currentIndex =
    typeof effect.metadata?.discardPlayerIndex === 'number'
      ? Math.floor(effect.metadata.discardPlayerIndex)
      : 0;
  const orderedResolution = effect.metadata?.orderedResolution === true;

  const stateAfterDiscard = addAction(
    {
      ...discardResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      ...handResetSource(effect),
      step: 'DISCARD_TO_THREE',
      discardPlayerId: player.id,
      discardedCardIds: discardResult.discardedCardIds,
    }
  );

  return startNextHandResetDiscard(
    stateAfterDiscard,
    effect,
    playerIds,
    currentIndex + 1,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishHandResetDraw(
  game: GameState,
  context: HandResetContext,
  playerIds: readonly string[],
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  let state: GameState = {
    ...game,
    activeEffect: null,
  };

  const drawResult = drawCardsForEachPlayer(state, playerIds, 3);
  if (!drawResult) {
    return game;
  }
  state = drawResult.gameState;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', context.controllerId, {
      pendingAbilityId: context.id,
      abilityId: context.abilityId,
      ...handResetSource(context),
      step: 'DRAW_THREE_AFTER_HAND_ADJUST',
      drawnCardIdsByPlayer: drawResult.drawnCardIdsByPlayer,
    }),
    orderedResolution
  );
}
