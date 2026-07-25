import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID } from '../../ability-ids.js';
import {
  drawCardsForEachPlayer,
  shuffleHandCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_KEPT_HAND_CARDS_STEP_ID = 'S_BP7_004_SELECT_UP_TO_THREE_KEPT_HAND_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface HandAdjustContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

export function registerSBp7004DiaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID,
    (game, ability, options, context) =>
      startDiaHandAdjustThenDraw(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID,
    SELECT_KEPT_HAND_CARDS_STEP_ID,
    (game, input, context) =>
      finishDiaHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startDiaHandAdjustThenDraw(
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

  return startNextDiaHandSelection(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    ability,
    [player.id, opponent.id],
    0,
    orderedResolution,
    continuePendingCardEffects
  );
}

function startNextDiaHandSelection(
  game: GameState,
  context: HandAdjustContext,
  playerIds: readonly string[],
  startIndex: number,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  for (let index = startIndex; index < playerIds.length; index += 1) {
    const playerId = playerIds[index];
    const player = getPlayerById(game, playerId);
    if (!player || player.hand.cardIds.length === 0) {
      continue;
    }

    return addAction(
      {
        ...game,
        activeEffect: {
          id: context.id,
          abilityId: context.abilityId,
          sourceCardId: context.sourceCardId,
          controllerId: context.controllerId,
          effectText: getAbilityEffectText(
            S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID
          ),
          stepId: SELECT_KEPT_HAND_CARDS_STEP_ID,
          stepText: '请选择至多3张保留在手牌中。未选择的手牌将洗牌后放置于自己的卡组底。',
          awaitingPlayerId: player.id,
          selectableCardIds: player.hand.cardIds,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: 0,
          maxSelectableCards: Math.min(3, player.hand.cardIds.length),
          selectionLabel: '选择要保留的手牌',
          confirmSelectionLabel: '将其余手牌放置于卡组底',
          metadata: {
            orderedResolution,
            handAdjustPlayerIds: playerIds,
            handAdjustPlayerIndex: index,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: context.id,
        abilityId: context.abilityId,
        sourceCardId: context.sourceCardId,
        step: 'START_KEEP_HAND_SELECTION',
        handAdjustPlayerId: player.id,
        handCount: player.hand.cardIds.length,
      }
    );
  }

  return finishDiaDrawThreeForEachPlayer(
    game,
    context,
    playerIds,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishDiaHandSelection(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP7_004_ON_ENTER_AQOURS_RELAY_KEEP_THREE_HAND_BOTTOM_DRAW_THREE_ABILITY_ID ||
    effect.stepId !== SELECT_KEPT_HAND_CARDS_STEP_ID ||
    !effect.awaitingPlayerId
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.awaitingPlayerId);
  if (!player) {
    return game;
  }

  const keptCardIds = selectedCardIds ?? (selectedCardId ? [selectedCardId] : []);
  const uniqueKeptCardIds = [...new Set(keptCardIds)];
  const selectableCardIds = effect.selectableCardIds ?? [];
  const handMatchesSnapshot =
    player.hand.cardIds.length === selectableCardIds.length &&
    player.hand.cardIds.every((cardId) => selectableCardIds.includes(cardId));
  if (
    !handMatchesSnapshot ||
    uniqueKeptCardIds.length !== keptCardIds.length ||
    uniqueKeptCardIds.length > Math.min(3, selectableCardIds.length) ||
    uniqueKeptCardIds.some(
      (cardId) => !selectableCardIds.includes(cardId) || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const returnedCardIds = player.hand.cardIds.filter(
    (cardId) => !uniqueKeptCardIds.includes(cardId)
  );
  const moveResult = shuffleHandCardsToDeckBottomForPlayer(game, player.id, returnedCardIds);
  if (!moveResult) {
    return game;
  }

  const playerIds = Array.isArray(effect.metadata?.handAdjustPlayerIds)
    ? effect.metadata.handAdjustPlayerIds.filter(
        (value): value is string => typeof value === 'string'
      )
    : [effect.controllerId];
  const currentIndex =
    typeof effect.metadata?.handAdjustPlayerIndex === 'number'
      ? Math.floor(effect.metadata.handAdjustPlayerIndex)
      : 0;
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const stateAfterMove = addAction(
    {
      ...moveResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'KEEP_HAND_AND_SHUFFLE_REST_TO_BOTTOM',
      handAdjustPlayerId: player.id,
      keptCardIds: uniqueKeptCardIds,
      returnedCardIds: moveResult.originalCardIds,
      shuffledCardIds: moveResult.movedCardIds,
    }
  );

  return startNextDiaHandSelection(
    stateAfterMove,
    effect,
    playerIds,
    currentIndex + 1,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishDiaDrawThreeForEachPlayer(
  game: GameState,
  context: HandAdjustContext,
  playerIds: readonly string[],
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const drawResult = drawCardsForEachPlayer(
    {
      ...game,
      activeEffect: null,
    },
    playerIds,
    3
  );
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', context.controllerId, {
      pendingAbilityId: context.id,
      abilityId: context.abilityId,
      sourceCardId: context.sourceCardId,
      step: 'DRAW_THREE_FOR_EACH_PLAYER',
      drawnCardIdsByPlayer: drawResult.drawnCardIdsByPlayer,
    }),
    orderedResolution
  );
}
