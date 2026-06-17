import type { CardAbilityDefinition } from '../card-effects/ability-definition-types.js';
import type { GameEvent } from '../../domain/events/game-events.js';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../shared/types/enums.js';
import { getBaseCardCode, normalizeCardCode } from '../../shared/utils/card-code.js';

export type TriggerSourceCardRequirement = 'none' | 'event-subject' | 'event-card-list';
export type TriggerControllerRequirement = 'none' | 'same-controller' | 'different-controller';
export type TriggerSourceSlotRequirement =
  | 'none'
  | 'event-from-slot'
  | 'event-to-slot'
  | 'event-current-slot';

export interface TriggerMatcherSource {
  readonly cardId?: string | null;
  readonly cardCode?: string | null;
  readonly controllerId?: string | null;
  readonly category: CardAbilityDefinition['category'];
  readonly sourceZone: CardAbilityDefinition['sourceZone'];
  readonly sourceSlot?: SlotPosition | null;
}

export interface TriggerMemberStateTransitionRequirement {
  readonly from?: OrientationState;
  readonly to?: OrientationState;
}

export interface TriggerMatcherRequirements {
  readonly sourceCard?: TriggerSourceCardRequirement;
  readonly controller?: TriggerControllerRequirement;
  readonly sourceSlot?: TriggerSourceSlotRequirement;
  readonly memberStateTransition?: TriggerMemberStateTransitionRequirement;
}

export interface TriggerMatcherInput {
  readonly ability: CardAbilityDefinition;
  readonly event: GameEvent;
  readonly source?: TriggerMatcherSource | null;
  readonly requirements?: TriggerMatcherRequirements;
}

export function doesTriggerEventMatchAbility(input: TriggerMatcherInput): boolean {
  const { ability, event, source, requirements = {} } = input;
  if (!source || !source.cardId || !source.cardCode || !source.controllerId) {
    return false;
  }
  if (!ability.queued || !ability.implemented) {
    return false;
  }
  if (ability.triggerCondition !== event.eventType) {
    return false;
  }
  if (ability.category !== source.category || ability.sourceZone !== source.sourceZone) {
    return false;
  }
  if (!doesAbilityDefinitionMatchSourceCard(ability, source.cardCode)) {
    return false;
  }
  if (!doesSourceSlotSatisfyAbility(ability, source.sourceSlot)) {
    return false;
  }
  if (getTriggerEventIds(event).length === 0) {
    return false;
  }

  return (
    doesSourceCardRequirementMatch(event, source, requirements.sourceCard ?? 'none') &&
    doesControllerRequirementMatch(event, source, requirements.controller ?? 'none') &&
    doesSourceSlotRequirementMatch(event, source, requirements.sourceSlot ?? 'none') &&
    doesMemberStateTransitionMatch(event, requirements.memberStateTransition)
  );
}

export function getTriggerEventIds(event: GameEvent): readonly string[] {
  return event.eventId.trim().length > 0 ? [event.eventId] : [];
}

function doesAbilityDefinitionMatchSourceCard(
  ability: CardAbilityDefinition,
  sourceCardCode: string
): boolean {
  const normalizedSourceCardCode = normalizeCardCode(sourceCardCode);
  const sourceBaseCardCode = getBaseCardCode(normalizedSourceCardCode);

  return (
    ability.cardCodes?.map(normalizeCardCode).includes(normalizedSourceCardCode) === true ||
    ability.baseCardCodes?.map(normalizeCardCode).includes(sourceBaseCardCode) === true
  );
}

function doesSourceSlotSatisfyAbility(
  ability: CardAbilityDefinition,
  sourceSlot?: SlotPosition | null
): boolean {
  if (!ability.requiredSourceSlots || ability.requiredSourceSlots.length === 0) {
    return true;
  }
  return sourceSlot !== undefined && sourceSlot !== null && ability.requiredSourceSlots.includes(sourceSlot);
}

function doesSourceCardRequirementMatch(
  event: GameEvent,
  source: TriggerMatcherSource,
  requirement: TriggerSourceCardRequirement
): boolean {
  if (requirement === 'none') {
    return true;
  }
  if (requirement === 'event-subject') {
    return getEventSubjectCardId(event) === source.cardId;
  }
  return getEventCardIds(event).includes(source.cardId ?? '');
}

function doesControllerRequirementMatch(
  event: GameEvent,
  source: TriggerMatcherSource,
  requirement: TriggerControllerRequirement
): boolean {
  if (requirement === 'none') {
    return true;
  }

  const eventControllerId = getEventControllerId(event);
  if (!eventControllerId || !source.controllerId) {
    return false;
  }

  return requirement === 'same-controller'
    ? eventControllerId === source.controllerId
    : eventControllerId !== source.controllerId;
}

function doesSourceSlotRequirementMatch(
  event: GameEvent,
  source: TriggerMatcherSource,
  requirement: TriggerSourceSlotRequirement
): boolean {
  if (requirement === 'none') {
    return true;
  }
  if (source.sourceSlot === undefined || source.sourceSlot === null) {
    return false;
  }

  const eventSlot =
    requirement === 'event-from-slot'
      ? getEventFromSlot(event)
      : requirement === 'event-to-slot'
        ? getEventToSlot(event)
        : getEventCurrentSlot(event);

  return eventSlot === source.sourceSlot;
}

function doesMemberStateTransitionMatch(
  event: GameEvent,
  requirement: TriggerMemberStateTransitionRequirement | undefined
): boolean {
  if (!requirement) {
    return true;
  }
  if (event.eventType !== TriggerCondition.ON_MEMBER_STATE_CHANGED) {
    return false;
  }
  if (!('previousOrientation' in event) || !('nextOrientation' in event)) {
    return false;
  }

  return (
    (requirement.from === undefined || event.previousOrientation === requirement.from) &&
    (requirement.to === undefined || event.nextOrientation === requirement.to)
  );
}

function getEventSubjectCardId(event: GameEvent): string | null {
  return 'cardInstanceId' in event ? event.cardInstanceId : null;
}

function getEventControllerId(event: GameEvent): string | null {
  if ('controllerId' in event) {
    return event.controllerId;
  }
  if ('performerId' in event) {
    return event.performerId;
  }
  if ('playerId' in event) {
    return event.playerId;
  }
  if ('currentPlayerId' in event) {
    return event.currentPlayerId;
  }
  return event.triggerPlayerId ?? null;
}

function getEventCardIds(event: GameEvent): readonly string[] {
  if ('liveCardIds' in event) {
    return event.liveCardIds;
  }
  if ('successfulLiveCardIds' in event) {
    return event.successfulLiveCardIds;
  }
  if ('failedLiveCardIds' in event) {
    return event.failedLiveCardIds;
  }
  if ('revealedCardIds' in event) {
    return event.revealedCardIds;
  }
  if ('replacedMemberCardId' in event && 'newMemberCardId' in event) {
    return [event.replacedMemberCardId, event.newMemberCardId];
  }
  if ('drawnCardIds' in event) {
    return event.drawnCardIds;
  }
  if ('energyCardIds' in event) {
    return event.energyCardIds;
  }
  return 'cardInstanceId' in event ? [event.cardInstanceId] : [];
}

function getEventFromSlot(event: GameEvent): SlotPosition | null {
  return 'fromSlot' in event ? event.fromSlot ?? null : null;
}

function getEventToSlot(event: GameEvent): SlotPosition | null {
  return 'toSlot' in event ? event.toSlot ?? null : null;
}

function getEventCurrentSlot(event: GameEvent): SlotPosition | null {
  return 'slot' in event ? event.slot : null;
}
