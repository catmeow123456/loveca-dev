import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getOpponent,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { S_PB2_006_ON_ENTER_OPPONENT_HAND_TWO_TO_DECK_EDGE_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { moveHandCardsToDeckEdgeForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const EDGE_STEP = 'S_PB2_006_CHOOSE_OPPONENT_DECK_EDGE';
const HAND_STEP = 'S_PB2_006_ORDER_OPPONENT_HAND_CARDS';
const HAND_THRESHOLD = 6;
const MOVE_COUNT = 2;
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Position = 'TOP' | 'BOTTOM';

export function registerSPb2006YoshikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY,
    EDGE_STEP,
    (game, input, context) =>
      chooseEdge(game, input.selectedOptionId, context.continuePendingCardEffects),
    queryOptionSelection
  );
  registerActiveEffectStepHandler(
    ABILITY,
    HAND_STEP,
    (game, input, context) =>
      moveCards(game, input.selectedCardIds ?? [], context.continuePendingCardEffects),
    queryCardSelection
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuation: Continue
) {
  const opponent = getOpponent(game, ability.controllerId);
  if (!opponent || opponent.hand.cardIds.length < HAND_THRESHOLD) {
    return finish(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((entry) => entry.id !== ability.id),
      },
      ability,
      orderedResolution,
      continuation,
      0
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      awaitingPlayerId: opponent.id,
      effectText: getAbilityEffectText(ABILITY),
      stepId: EDGE_STEP,
      stepText: '请选择将2张手牌放置于自己的卡组顶或卡组底。',
      selectableOptions: [
        { id: 'TOP', label: '两张都放置于卡组顶' },
        { id: 'BOTTOM', label: '两张都放置于卡组底' },
      ],
      metadata: { orderedResolution },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'CHOOSE_OPPONENT_DECK_EDGE' },
  });
}

function getOpponentHandIds(game: GameState, effect: ActiveEffectState): readonly string[] {
  const opponent = getOpponent(game, effect.controllerId);
  return opponent && opponent.id === effect.awaitingPlayerId
    ? opponent.hand.cardIds.filter((id) => getCardById(game, id)?.ownerId === opponent.id)
    : [];
}

function createHandSelection(
  effect: ActiveEffectState,
  position: Position,
  cardIds: readonly string[]
): ActiveEffectState {
  return {
    ...effect,
    stepId: HAND_STEP,
    stepText: '请选择并排列要放回自己卡组的2张手牌。第一张在第二张上方。',
    selectableOptions: undefined,
    selectableCardIds: cardIds,
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: MOVE_COUNT,
    maxSelectableCards: MOVE_COUNT,
    selectionLabel: '按放置顺序选择2张手牌',
    confirmSelectionLabel: '按此顺序放回卡组',
    metadata: { ...effect.metadata, position },
  };
}

function chooseEdge(game: GameState, position: string | null | undefined, continuation: Continue) {
  const effect = getCardActiveEffect(game);
  if (!effect || (position !== 'TOP' && position !== 'BOTTOM')) return game;
  const cardIds = getOpponentHandIds(game, effect);
  return cardIds.length < MOVE_COUNT
    ? finish(game, effect, effect.metadata?.orderedResolution === true, continuation, 0)
    : { ...game, activeEffect: createHandSelection(effect, position, cardIds) };
}

function moveCards(game: GameState, selected: readonly string[], continuation: Continue) {
  const effect = getCardActiveEffect(game);
  const position = effect?.metadata?.position;
  if (!effect?.awaitingPlayerId || (position !== 'TOP' && position !== 'BOTTOM')) return game;
  const cardIds = getOpponentHandIds(game, effect);
  const ordered = effect.metadata?.orderedResolution === true;
  if (cardIds.length < MOVE_COUNT) return finish(game, effect, ordered, continuation, 0);
  if (selected.some((id) => !cardIds.includes(id))) {
    return { ...game, activeEffect: createHandSelection(effect, position, cardIds) };
  }
  const result = moveHandCardsToDeckEdgeForPlayer(game, effect.awaitingPlayerId, selected, {
    candidateCardIds: effect.selectableCardIds ?? [],
    exactCount: MOVE_COUNT,
    position,
  });
  return result ? finish(result.gameState, effect, ordered, continuation, MOVE_COUNT) : game;
}

function finish(
  game: GameState,
  source: Pick<PendingAbilityState, 'id' | 'controllerId' | 'sourceCardId'>,
  orderedResolution: boolean,
  continuation: Continue,
  movedCount: number
): GameState {
  return continuation(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', source.controllerId, {
      abilityId: ABILITY,
      pendingAbilityId: source.id,
      sourceCardId: source.sourceCardId,
      step: movedCount > 0 ? 'OPPONENT_HAND_CARDS_TO_DECK' : 'NO_OPPONENT_HAND_MOVE',
      movedCount,
    }),
    orderedResolution
  );
}
