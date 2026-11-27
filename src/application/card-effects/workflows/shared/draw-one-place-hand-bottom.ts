import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import {
  addAction,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import {
  S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
  S_PB2_036_LIVE_SUCCESS_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer, moveHandCardToDeckBottomForPlayer } from '../../runtime/actions.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_TO_BOTTOM_STEP_ID = 'S_SELECT_HAND_CARD_TO_DECK_BOTTOM_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerDrawOnePlaceHandBottomWorkflowHandlers(): void {
  for (const abilityId of [
    S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
    S_PB2_036_LIVE_SUCCESS_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
  ]) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options) =>
      startDrawOnePlaceHandBottomWorkflow(game, ability, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(
      abilityId,
      SELECT_HAND_TO_BOTTOM_STEP_ID,
      (game, input, context) =>
        finishDrawOnePlaceHandBottomWorkflow(
          game,
          abilityId,
          input.selectedCardId ?? null,
          context.continuePendingCardEffects
        ),
      queryCardSelection
    );
  }
}

function startDrawOnePlaceHandBottomWorkflow(
  game: GameState,
  ability: {
    readonly id: string;
    readonly abilityId: string;
    readonly sourceCardId: string;
    readonly controllerId: string;
  },
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const drawResult = drawCardsForPlayer(game, player.id, 1);
  if (!drawResult) {
    return game;
  }

  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  if (!playerAfterDraw) {
    return game;
  }

  const selectableCardIds = [...playerAfterDraw.hand.cardIds];

  return addAction(
    {
      ...drawResult.gameState,
      pendingAbilities: drawResult.gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== ability.id
      ),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_HAND_TO_BOTTOM_STEP_ID,
        stepText:
          selectableCardIds.length > 0
            ? '请选择1张手牌放置于卡组底。'
            : '没有可放置于卡组底的手牌。确认后继续。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置于卡组底的手牌',
        confirmSelectionLabel: '放置于卡组底',
        canSkipSelection: selectableCardIds.length === 0,
        skipSelectionLabel: selectableCardIds.length === 0 ? '确认' : undefined,
        metadata: {
          orderedResolution,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_ONE_START_HAND_BOTTOM',
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    }
  );
}

function finishDrawOnePlaceHandBottomWorkflow(
  game: GameState,
  abilityId: string,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getCardActiveEffect(game);
  if (!effect || effect.abilityId !== abilityId) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectableCardIds = effect.selectableCardIds ?? [];
  if (!player) {
    return game;
  }

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_HAND_CARD_TO_BOTTOM',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (
    selectedCardId === null ||
    !selectableCardIds.includes(selectedCardId) ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const moveResult = moveHandCardToDeckBottomForPlayer(game, player.id, selectedCardId, {
    candidateCardIds: selectableCardIds,
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_HAND_CARD_TO_DECK_BOTTOM',
      selectedCardId,
      movedCardIds: [moveResult.movedCardId],
    }),
    effect.metadata?.orderedResolution === true
  );
}
