import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, CardType, ZoneType } from '../../../../shared/types/enums.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID } from '../../ability-ids.js';
import {
  drawCardsForPlayer,
  moveWaitingRoomCardsToDeckTopForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_STEP_ID = 'PL_PB1_006_SELECT_MUSE_LIVE_TO_DECK_TOP';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
const museLive = and(typeIs(CardType.LIVE), groupIs("μ's"));

export function registerPlPb1006MakiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID,
    (game, ability, options, context) =>
      start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID,
    SELECT_STEP_ID,
    (game, input, context) =>
      finish(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  cont: Continue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((p) => p.id !== ability.id),
  };
  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, museLive);
  if (selectableCardIds.length === 0)
    return resolveAfterChoice(
      state,
      ability.id,
      ability.abilityId,
      ability.sourceCardId,
      player.id,
      ordered,
      cont,
      'NO_TARGET'
    );
  return addAction(
    {
      ...state,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_STEP_ID,
        stepText: "可以选择自己休息室1张『μ's』的LIVE卡放置于卡组顶。",
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: "选择放置到卡组顶的『μ's』LIVE卡",
        confirmSelectionLabel: '放置到卡组顶',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          publicCardSelectionConfirmation: { destination: 'MAIN_DECK_TOP' },
          orderedResolution: ordered,
          sourceZone: ZoneType.WAITING_ROOM,
          destination: ZoneType.MAIN_DECK,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT',
      selectableCardIds,
    }
  );
}

function finish(game: GameState, selectedCardId: string | null, cont: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID ||
    effect.stepId !== SELECT_STEP_ID
  )
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  let state: GameState = game;
  if (selectedCardId !== null) {
    if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
    const selectedCard = getCardById(game, selectedCardId);
    if (
      !selectedCard ||
      selectedCard.ownerId !== player.id ||
      !player.waitingRoom.cardIds.includes(selectedCardId) ||
      !museLive(selectedCard)
    ) {
      return resolveAfterChoice(
        { ...game, activeEffect: null },
        effect.id,
        effect.abilityId,
        effect.sourceCardId,
        player.id,
        effect.metadata?.orderedResolution === true,
        cont,
        'STALE_TARGET'
      );
    }
    const moved = moveWaitingRoomCardsToDeckTopForPlayer(game, player.id, [selectedCardId], {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: 1,
      maxCount: 1,
    });
    if (!moved) return game;
    state = moved.gameState;
  }
  return resolveAfterChoice(
    { ...state, activeEffect: null },
    effect.id,
    effect.abilityId,
    effect.sourceCardId,
    player.id,
    effect.metadata?.orderedResolution === true,
    cont,
    selectedCardId ? 'STACKED' : 'SKIPPED'
  );
}

function resolveAfterChoice(
  game: GameState,
  pendingId: string,
  abilityId: string,
  sourceCardId: string,
  playerId: string,
  ordered: boolean,
  cont: Continue,
  step: string
): GameState {
  const opponent = getOpponent(game, playerId);
  const hasWaiting = opponent
    ? Object.values(opponent.memberSlots.slots).some(
        (id) =>
          id && opponent.memberSlots.cardStates.get(id)?.orientation === OrientationState.WAITING
      )
    : false;
  const drawn = hasWaiting ? drawCardsForPlayer(game, playerId, 1) : null;
  const state = drawn?.gameState ?? game;
  return cont(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: pendingId,
      abilityId,
      sourceCardId,
      step,
      opponentHasWaitingMember: hasWaiting,
      drawnCardIds: drawn?.drawnCardIds ?? [],
    }),
    ordered
  );
}
