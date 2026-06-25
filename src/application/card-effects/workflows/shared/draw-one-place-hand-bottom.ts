import {
  addAction,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addCardToZone } from '../../../../domain/entities/zone.js';
import { S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_TO_BOTTOM_STEP_ID = 'S_SELECT_HAND_CARD_TO_DECK_BOTTOM_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerDrawOnePlaceHandBottomWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
    (game, ability, options) =>
      startDrawOnePlaceHandBottomWorkflow(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID,
    SELECT_HAND_TO_BOTTOM_STEP_ID,
    (game, input, context) =>
      finishDrawOnePlaceHandBottomWorkflow(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
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
        effectText: getAbilityEffectText(S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID),
        stepId: SELECT_HAND_TO_BOTTOM_STEP_ID,
        stepText:
          selectableCardIds.length > 0
            ? '请选择1张手牌放置到卡组底。'
            : '没有可放置到卡组底的手牌。确认后继续。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置到卡组底的手牌',
        confirmSelectionLabel: '放置到卡组底',
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
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== S_DRAW_ONE_PLACE_HAND_BOTTOM_ABILITY_ID) {
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

  const state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: currentPlayer.hand.cardIds.filter((cardId) => cardId !== selectedCardId),
    },
    mainDeck: addCardToZone(currentPlayer.mainDeck, selectedCardId),
  }));

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_HAND_CARD_TO_DECK_BOTTOM',
      selectedCardId,
      movedCardIds: [selectedCardId],
    }),
    effect.metadata?.orderedResolution === true
  );
}
