import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { applyCheckTopRefreshForPlayer } from '../../../effects/refresh.js';
import { PL_PB2_013_ON_ENTER_REVEAL_FOUR_ALL_LILY_WHITE_RECOVER_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveRevealedTopDeckSelectionToHandRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = PL_PB2_013_ON_ENTER_REVEAL_FOUR_ALL_LILY_WHITE_RECOVER_LIVE_ABILITY_ID;
const CHECK_REVEAL = 'PL_PB2_013_CHECK_REVEALED_TOP_FOUR';
const SELECT_LIVE = 'PL_PB2_013_SELECT_REVEALED_LILY_WHITE_LIVE';
const lilyWhite = unitAliasIs('lily white');
const lilyWhiteLive = and(typeIs(CardType.LIVE), lilyWhite);
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom;

export function registerPlPb2013UmiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, CHECK_REVEAL, (game, _input, context) =>
    checkRevealed(game, deps.enqueueTriggeredCardEffects, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_LIVE, (game, input, context) => {
    const effect = game.activeEffect;
    if (!effect || effect.stepId !== SELECT_LIVE) return game;
    if (!isCurrentRevealValid(game, effect) || !allLilyWhite(game, effect))
      return finish(game, effect, context.continuePendingCardEffects, 'REVEALED_TOP_CHANGED');
    const selected = input.selectedCardId;
    const card = selected ? getCardById(game, selected) : null;
    if (!selected || !effect.selectableCardIds?.includes(selected) || !card || !lilyWhiteLive(card))
      return game;
    return moveAndFinish(
      game,
      effect,
      selected,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    );
  });
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuation: Continue
): GameState {
  const source = getCardById(game, ability.sourceCardId);
  if (!source || source.ownerId !== ability.controllerId)
    return consume(game, ability, orderedResolution, continuation, 'SOURCE_UNAVAILABLE');
  const state = applyCheckTopRefreshForPlayer(game, ability.controllerId, 4);
  const player = getPlayerById(state, ability.controllerId);
  if (!player)
    return consume(state, ability, orderedResolution, continuation, 'PLAYER_UNAVAILABLE');
  const cardIds = player.mainDeck.cardIds.slice(0, 4);
  if (cardIds.length === 0)
    return consume(state, ability, orderedResolution, continuation, 'NO_TOP_CARDS');
  if (cardIds.some((id) => getCardById(state, id)?.ownerId !== player.id))
    return consume(state, ability, orderedResolution, continuation, 'TOP_CARDS_UNAVAILABLE');
  return startPendingActiveEffect(state, {
    ability,
    playerId: player.id,
    activeEffect: withPublicRevealDwell({
      id: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      controllerId: player.id,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: CHECK_REVEAL,
      stepText: `已公开卡组顶的${cardIds.length}张卡牌。展示结束后，若全部是『lily white』的卡片，将其中1张『lily white』的LIVE卡加入手牌，其余放置入休息室；否则将公开的卡片全部放置入休息室。`,
      awaitingPlayerId: player.id,
      revealedCardIds: cardIds,
      metadata: { orderedResolution },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'REVEAL_TOP_FOUR_IN_DECK',
      revealedCardIds: cardIds,
    },
  });
}

function isCurrentRevealValid(game: GameState, effect: ActiveEffectState): boolean {
  const player = getPlayerById(game, effect.controllerId);
  const source = getCardById(game, effect.sourceCardId);
  const ids = effect.revealedCardIds ?? [];
  return (
    !!player &&
    !!source &&
    source.ownerId === player.id &&
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every(
      (id, index) =>
        player.mainDeck.cardIds[index] === id && getCardById(game, id)?.ownerId === player.id
    )
  );
}
function allLilyWhite(game: GameState, effect: ActiveEffectState): boolean {
  return (effect.revealedCardIds ?? []).every((id) => {
    const card = getCardById(game, id);
    return !!card && lilyWhite(card);
  });
}

function checkRevealed(game: GameState, enqueue: Enqueue, continuation: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== CHECK_REVEAL) return game;
  if (!isCurrentRevealValid(game, effect))
    return finish(game, effect, continuation, 'REVEALED_TOP_CHANGED');
  if (!allLilyWhite(game, effect))
    return moveAndFinish(game, effect, null, enqueue, continuation);
  const candidates = (effect.revealedCardIds ?? []).filter((id) => {
    const card = getCardById(game, id);
    return !!card && lilyWhiteLive(card);
  });
  if (candidates.length === 0) return moveAndFinish(game, effect, null, enqueue, continuation);
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_LIVE,
      stepText: '请选择公开卡片中的1张『lily white』LIVE卡加入手牌，其余放置入休息室。',
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要加入手牌的LIVE卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    },
  };
}

function moveAndFinish(
  game: GameState,
  effect: ActiveEffectState,
  selected: string | null,
  enqueue: Enqueue,
  continuation: Continue
): GameState {
  const moved = moveRevealedTopDeckSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    effect.controllerId,
    effect.revealedCardIds ?? [],
    selected,
    enqueue,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moved) return finish(game, effect, continuation, 'REVEALED_TOP_CHANGED');
  return finish(moved.gameState, effect, continuation, 'RECOVER_LIVE_AND_SEND_REST_TO_WAITING', {
    handCardIds: moved.handCardIds,
    waitingRoomCardIds: moved.waitingRoomCardIds,
  });
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  continuation: Continue,
  step: string,
  extra: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuation(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      sourceLifecycleId: effect.sourceLifecycleId,
      step,
      revealedCardIds: effect.revealedCardIds ?? [],
      ...extra,
    }),
    effect.metadata?.orderedResolution === true
  );
}
function consume(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  continuation: Continue,
  step: string
): GameState {
  return continuation(
    addAction(
      { ...game, pendingAbilities: game.pendingAbilities.filter((a) => a.id !== ability.id) },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        step,
      }
    ),
    ordered
  );
}
