import { appendTriggeredAbility, recordTriggeredAbility } from './enqueue-pending-ability.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import {
  createRevealedCheerCardsMovedEvent,
  type RevealedCheerCardDestination,
  type RevealedCheerCardsMovedEvent,
} from '../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType, type SlotPosition } from '../../../shared/types/enums.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import {
  moveRevealedCheerCards,
  type MoveRevealedCheerCardsResult,
  type RevealedCheerCardListDestination,
} from '../../effects/cheer-selection.js';
import { getAbilitySourceLifecycleId } from './ability-source-lifecycle.js';
import { canUseAbilityThisTurn } from './ability-turn-limit.js';
import { isCurrentLiveCardAbilitySource } from './source-live.js';
import { markTriggerEventDispatched } from './trigger-event-dispatch.js';
import {
  playMemberFromZoneToEmptySlot,
  type EnqueueCardEffectPlacementTriggers,
  type PlayMemberFromZoneToEmptySlotResult,
} from './play-member-to-stage.js';

const TIMING = TriggerCondition.ON_REVEALED_CHEER_CARDS_MOVED;

type MovingCardEffect = Pick<
  ActiveEffectState,
  'id' | 'controllerId' | 'sourceCardId' | 'abilityId'
>;

/** Records only actual moves and captures listeners before the moving effect continues. */
export function moveRevealedCheerCardsAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  destination: RevealedCheerCardListDestination,
  effect: MovingCardEffect
): MoveRevealedCheerCardsResult | null {
  const result = moveRevealedCheerCards(game, playerId, cardIds, destination);
  if (!result || result.movedCardIds.length === 0) {
    return result;
  }

  return {
    ...result,
    gameState: recordRevealedCheerMovement(
      result.gameState,
      playerId,
      result.movedCardIds,
      destination,
      effect
    ),
  };
}

/** The entry and cheer movement describe the same completed placement. */
export function playRevealedCheerMemberToEmptySlotAndEnqueueTriggers(
  game: GameState,
  effect: MovingCardEffect,
  cardId: string,
  slot: SlotPosition,
  enqueue: EnqueueCardEffectPlacementTriggers
): PlayMemberFromZoneToEmptySlotResult | null {
  const placement = playMemberFromZoneToEmptySlot(game, effect.controllerId, {
    cardId,
    toSlot: slot,
    sourceZone: ZoneType.RESOLUTION_ZONE,
  });
  if (!placement) return null;
  const state = recordRevealedCheerMovement(
    placement.gameState,
    effect.controllerId,
    [placement.playedCardId],
    'MEMBER_SLOT',
    effect
  );
  return {
    ...placement,
    gameState: enqueue(state, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [placement.enterStageEvent],
    }),
  };
}

function recordRevealedCheerMovement(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  destination: RevealedCheerCardDestination,
  effect: MovingCardEffect
): GameState {
  const event = createRevealedCheerCardsMovedEvent(playerId, cardIds, destination, {
    kind: 'CARD_EFFECT',
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    pendingAbilityId: effect.id,
  });
  return enqueueMovementTriggers(emitGameEvent(game, event), event);
}

function enqueueMovementTriggers(game: GameState, event: RevealedCheerCardsMovedEvent): GameState {
  // This dispatcher is private to the atomic move. Historical movement events cannot
  // be replayed against LIVE cards that were absent when the move took place.
  let state = markTriggerEventDispatched(game, {
    eventId: event.eventId,
    triggerCondition: TIMING,
    playerId: event.playerId,
  });
  const player = getPlayerById(state, event.playerId);
  const effectSource = getCardById(state, event.cause.sourceCardId);
  if (!player || event.controllerId !== player.id || effectSource?.ownerId !== player.id) {
    return state;
  }

  for (const sourceCardId of player.liveZone.cardIds) {
    const source = getCardById(state, sourceCardId);
    if (!source) continue;

    const definitions = getCardAbilityDefinitionsForCardCode(source.data.cardCode).filter(
      (definition) =>
        definition.category === CardAbilityCategory.AUTO &&
        definition.sourceZone === CardAbilitySourceZone.LIVE_CARD &&
        definition.queued &&
        definition.implemented &&
        definition.triggerCondition === TIMING
    );
    for (const { abilityId } of definitions) {
      if (
        !isCurrentLiveCardAbilitySource(state, { abilityId, controllerId: player.id, sourceCardId })
      ) {
        continue;
      }
      const sourceLifecycleId = getAbilitySourceLifecycleId(state, abilityId, sourceCardId, [
        event.eventId,
      ]);
      if (
        !canUseAbilityThisTurn(
          state,
          player.id,
          abilityId,
          sourceCardId,
          undefined,
          sourceLifecycleId
        )
      ) {
        continue;
      }

      const pending: PendingAbilityState = {
        id: `${abilityId}:${sourceCardId}:${event.eventId}`,
        abilityId,
        sourceCardId,
        sourceLifecycleId,
        controllerId: player.id,
        mandatory: true,
        timingId: TIMING,
        eventIds: [event.eventId],
      };
      state = recordTriggeredAbility(
        { ...state, pendingAbilities: appendTriggeredAbility(state, pending) },
        'TRIGGER_ABILITY',
        player.id,
        {
          pendingAbilityId: pending.id,
          abilityId,
          sourceCardId,
          sourceLifecycleId,
          eventId: event.eventId,
          movedCardIds: event.movedCardIds,
          destination: event.destination,
        }
      );
    }
  }
  return state;
}
