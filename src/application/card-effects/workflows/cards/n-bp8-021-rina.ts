import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  addLiveSetLimitReduction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, FaceState, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { N_BP8_021_ACTIVATED_DISCARD_TWO_PLACE_NIJIGASAKI_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { placeWaitingRoomLiveCardInLiveZoneForPlayer } from '../../runtime/actions.js';
import { createOptionalDiscardHandToWaitingRoomActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const DISCARD_STEP = 'N_BP8_021_DISCARD_TWO_HAND_CARDS';
const PLACE_STEP = 'N_BP8_021_SELECT_WAITING_NIJIGASAKI_LIVE';
type Continue = (game: GameState, ordered: boolean) => GameState;
const liveSelector = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));

export function registerNBp8021RinaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(ABILITY, start, canStart);
  registerActiveEffectStepHandler(
    ABILITY,
    DISCARD_STEP,
    (game, input, context) => {
      const effect = game.activeEffect!;
      const ids = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
      if (ids.length === 0)
        return context.continuePendingCardEffects({ ...game, activeEffect: null }, false);
      const discarded = discardHandCardsToWaitingRoomAndEnqueueTriggers(
        game,
        effect.controllerId,
        ids,
        { count: 2, candidateCardIds: effect.selectableCardIds ?? [] },
        deps.enqueueTriggeredCardEffects
      );
      if (!discarded) return game;
      const paid = recordAbilityUseForContext(
        recordPayCostAction(discarded.gameState, effect.controllerId, {
          pendingAbilityId: effect.id,
          abilityId: ABILITY,
          sourceCardId: effect.sourceCardId,
          costType: 'DISCARD_HAND_TO_WAITING_ROOM',
          discardedCardIds: discarded.discardedCardIds,
          enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId,
        }),
        effect.controllerId,
        effect
      );
      const candidates = waitingLiveIds(paid, effect.controllerId);
      const player = getPlayerById(paid, effect.controllerId)!;
      if (player.liveZone.cardIds.length > 0 || candidates.length === 0)
        return finish(paid, effect, context.continuePendingCardEffects, 'PAID_NO_LIVE_PLACEMENT');
      return {
        ...paid,
        activeEffect: {
          ...effect,
          stepId: PLACE_STEP,
          stepText: '请选择自己休息室的1张『虹咲』LIVE卡，表侧表示放置于LIVE卡区。',
          selectableCardIds: candidates,
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'SINGLE',
          minSelectableCards: 1,
          maxSelectableCards: 1,
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          selectionLabel: '选择表侧放置于LIVE卡区的LIVE卡',
          confirmSelectionLabel: '表侧放置于LIVE卡区',
          metadata: {
            discardedCardIds: discarded.discardedCardIds,
            publicCardSelectionConfirmation: { destination: 'LIVE_ZONE', source: 'WAITING_ROOM' },
          },
        },
      };
    },
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY,
    PLACE_STEP,
    (game, input, context) => {
      const effect = game.activeEffect!;
      const player = getPlayerById(game, effect.controllerId);
      if (!player) return game;
      const candidates = waitingLiveIds(game, player.id);
      if (player.liveZone.cardIds.length > 0 || candidates.length === 0)
        return finish(game, effect, context.continuePendingCardEffects, 'NO_LIVE_PLACEMENT');
      const id = input.selectedCardId;
      if (!id || !effect.selectableCardIds?.includes(id)) return game;
      if (!candidates.includes(id))
        return wasRestoredAfterPublicCardSelectionConfirmation(effect)
          ? finish(game, effect, context.continuePendingCardEffects, 'SELECTED_LIVE_UNAVAILABLE')
          : game;
      if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
      const moved = placeWaitingRoomLiveCardInLiveZoneForPlayer(game, player.id, id, {
        candidateCardIds: candidates,
        face: FaceState.FACE_UP,
      });
      return moved
        ? finish(
            moved.gameState,
            effect,
            context.continuePendingCardEffects,
            'PLACE_LIVE_FACE_UP',
            {
              placedLiveCardId: moved.movedCardId,
              enterLiveZoneEventId: moved.enterLiveZoneEvent.eventId,
            }
          )
        : game;
    },
    queryCardSelection
  );
}

function canStart(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    !!player &&
    !!card &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!N-bp8-021') &&
    getSourceMemberSlot(game, playerId, cardId) !== null &&
    player.hand.cardIds.length >= 2 &&
    canUseAbilityThisTurn(game, playerId, ABILITY, cardId)
  );
}

function start(game: GameState, playerId: string, cardId: string): GameState {
  if (!canStart(game, playerId, cardId)) return game;
  const player = getPlayerById(game, playerId)!;
  return {
    ...game,
    activeEffect: {
      ...createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability: {
          id: globalThis.crypto.randomUUID(),
          abilityId: ABILITY,
          sourceCardId: cardId,
          controllerId: playerId,
        },
        playerId,
        effectText: getAbilityEffectText(ABILITY),
        stepId: DISCARD_STEP,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: false,
        discardCount: 2,
        stepText: '可以将2张手牌放置入休息室，发动此能力。',
        selectionLabel: '选择作为费用放置入休息室的2张手牌',
      }),
      sourceLifecycleId: getStageMemberLifecycleId(game, cardId),
    },
  };
}

function waitingLiveIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, liveSelector);
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  const reduced = addLiveSetLimitReduction(game, {
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    abilityId: ABILITY,
    amount: 1,
    expiresAt: 'NEXT_LIVE_SET_PHASE',
  });
  return next(
    addAction({ ...reduced, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY,
      sourceCardId: effect.sourceCardId,
      step,
      nextLiveSetLimitReduction: 1,
      ...payload,
    }),
    false
  );
}
