import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import { SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import { hasAbilityInstance } from '../../runtime/ability-instance.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerMemberSlotMovedObserver } from '../../runtime/member-slot-moved-observers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2022TomariWorkflowHandlers(): void {
  registerMemberSlotMovedObserver((game, context) =>
    enqueueSpPb2022MemberSlotMovedObserver(game, context.events)
  );
  registerPendingAbilityStarterHandler(
    SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2022TomariOnMove(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

function enqueueSpPb2022MemberSlotMovedObserver(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  const matchingEventIds = new Set(
    events
      .filter((event) => doesMoveEventMeetTrigger(game, event))
      .map((event) => event.eventId)
  );
  const controllersWithMatchingEvent = new Set(
    events
      .filter((event) => matchingEventIds.has(event.eventId))
      .map((event) => event.controllerId)
  );
  let state = game;
  for (const event of events) {
    if (
      controllersWithMatchingEvent.has(event.controllerId) &&
      !matchingEventIds.has(event.eventId)
    ) {
      continue;
    }
    const player = getPlayerById(state, event.controllerId);
    if (!player) {
      continue;
    }

    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
      if (
        !sourceCardId ||
        !sourceCard ||
        !hasObserverAbility(sourceCard.data.cardCode, sourceSlot)
      ) {
        continue;
      }

      const abilityId = SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID;
      if (
        !canUseAbilityThisTurn(state, player.id, abilityId, sourceCardId) ||
        hasAbilityInstance(state, `${abilityId}:${sourceCardId}:${event.eventId}`)
      ) {
        continue;
      }

      const pendingAbilityId = `${abilityId}:${sourceCardId}:${event.eventId}`;
      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        mandatory: true,
        timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
        eventIds: [event.eventId],
        sourceSlot,
        metadata: {
          movedCardId: event.cardInstanceId,
          fromSlot: event.fromSlot,
          toSlot: event.toSlot,
          swappedCardInstanceId: event.swappedCardInstanceId ?? null,
        },
      };

      state = addAction(
        { ...state, pendingAbilities: [...state.pendingAbilities, pendingAbility] },
        'TRIGGER_ABILITY',
        player.id,
        {
          pendingAbilityId,
          abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          movedCardId: event.cardInstanceId,
          fromSlot: event.fromSlot,
          toSlot: event.toSlot,
          sourceSlot,
        }
      );
    }
  }
  return state;
}

function doesMoveEventMeetTrigger(game: GameState, event: MemberSlotMovedEvent): boolean {
  if (event.toSlot !== SlotPosition.CENTER) {
    return false;
  }
  const player = getPlayerById(game, event.controllerId);
  const movedCard = getCardById(game, event.cardInstanceId);
  return (
    player !== null &&
    player.memberSlots.slots[SlotPosition.CENTER] === event.cardInstanceId &&
    movedCard !== null &&
    movedCard.ownerId === player.id &&
    isMemberCardData(movedCard.data) &&
    unitAliasIs('5yncri5e!')(movedCard)
  );
}

function hasObserverAbility(cardCode: string, sourceSlot: SlotPosition): boolean {
  return getCardAbilityDefinitionsForCardCode(cardCode).some(
    (ability) =>
      ability.abilityId ===
        SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID &&
      ability.category === CardAbilityCategory.AUTO &&
      ability.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
      ability.triggerCondition === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      ability.queued &&
      ability.implemented &&
      (!ability.requiredSourceSlots || ability.requiredSourceSlots.includes(sourceSlot))
  );
}

function resolveSpPb2022TomariOnMove(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  const movedMemberIsOwnFiveyncrise =
    moveEvent !== null && isOwnFiveyncriseMember(game, player.id, moveEvent.cardInstanceId);
  const movedToCenter = moveEvent?.toSlot === SlotPosition.CENTER;
  const movedMemberCurrentlyCenter =
    moveEvent !== null && player.memberSlots.slots[SlotPosition.CENTER] === moveEvent.cardInstanceId;
  const conditionMet = movedMemberIsOwnFiveyncrise && movedToCenter && movedMemberCurrentlyCenter;
  const bladeResult = conditionMet
    ? addBladeLiveModifierForSourceMember(game, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 4,
      })
    : null;
  const stateAfterBlade = bladeResult?.gameState ?? game;
  const stateAfterUseRecord =
    conditionMet && bladeResult
      ? recordAbilityUseForContext(stateAfterBlade, player.id, {
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
        })
      : stateAfterBlade;
  const stateWithoutPending: GameState = {
    ...stateAfterUseRecord,
    pendingAbilities: stateAfterUseRecord.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'FIVEYNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE' : 'CONDITION_NOT_MET',
      conditionMet,
      moveEventId: moveEvent?.eventId ?? null,
      movedCardId: moveEvent?.cardInstanceId ?? null,
      fromSlot: moveEvent?.fromSlot ?? null,
      toSlot: moveEvent?.toSlot ?? null,
      movedMemberIsOwnFiveyncrise,
      movedToCenter,
      movedMemberCurrentlyCenter,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    orderedResolution
  );
}

function getPendingMoveEvent(
  game: GameState,
  ability: PendingAbilityState
): MemberSlotMovedEvent | null {
  const eventIds = new Set(ability.eventIds);
  for (const entry of game.eventLog) {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      'fromSlot' in event &&
      'toSlot' in event &&
      'cardInstanceId' in event &&
      eventIds.has(event.eventId)
    ) {
      return event as MemberSlotMovedEvent;
    }
  }
  return null;
}

function isOwnFiveyncriseMember(game: GameState, playerId: string, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return (
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    unitAliasIs('5yncri5e!')(card)
  );
}
