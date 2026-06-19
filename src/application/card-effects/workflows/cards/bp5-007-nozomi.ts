import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID } from '../../ability-ids.js';
import {
  discardHandCardsToWaitingRoomForPlayer,
  drawCardsForEachPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const BP5_007_SELECT_HAND_DISCARD_STEP_ID = 'BP5_007_SELECT_HAND_DISCARD_TO_THREE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface Bp5007NozomiEffectContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

export function registerBp5007NozomiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startBp5007NozomiDiscardToThreeThenDraw(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
    BP5_007_SELECT_HAND_DISCARD_STEP_ID,
    (game, input, context) =>
      finishBp5007NozomiDiscardToThree(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startBp5007NozomiDiscardToThreeThenDraw(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return startBp5007NozomiNextDiscardStep(
    state,
    ability,
    [player.id, opponent.id],
    0,
    orderedResolution,
    continuePendingCardEffects
  );
}

function startBp5007NozomiNextDiscardStep(
  game: GameState,
  context: Bp5007NozomiEffectContext,
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
          sourceCardId: context.sourceCardId,
          controllerId: context.controllerId,
          effectText: getAbilityEffectText(
            BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
          ),
          stepId: BP5_007_SELECT_HAND_DISCARD_STEP_ID,
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
        sourceCardId: context.sourceCardId,
        step: 'START_DISCARD_TO_THREE',
        discardPlayerId: player.id,
        discardCount,
      }
    );
  }

  return finishBp5007NozomiDrawThree(
    game,
    context,
    playerIds,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishBp5007NozomiDiscardToThree(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID ||
    effect.stepId !== BP5_007_SELECT_HAND_DISCARD_STEP_ID ||
    !effect.awaitingPlayerId
  ) {
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

  const discardResult = discardHandCardsToWaitingRoomForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: discardCount,
      candidateCardIds: selectableCardIds,
    }
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
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_TO_THREE',
      discardPlayerId: player.id,
      discardedCardIds: discardResult.discardedCardIds,
    }
  );

  return startBp5007NozomiNextDiscardStep(
    stateAfterDiscard,
    effect,
    playerIds,
    currentIndex + 1,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishBp5007NozomiDrawThree(
  game: GameState,
  context: Bp5007NozomiEffectContext,
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
      sourceCardId: context.sourceCardId,
      step: 'DRAW_THREE_AFTER_HAND_ADJUST',
      drawnCardIdsByPlayer: drawResult.drawnCardIdsByPlayer,
    }),
    orderedResolution
  );
}
