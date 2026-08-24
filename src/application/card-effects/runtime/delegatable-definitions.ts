import { TriggerCondition } from '../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import {
  getCardAbilityDefinitionsForCardCode,
  getImplementedQueuedAbilityDefinitionsForCardCode,
} from '../definitions/lookup.js';
import type { SlotPosition } from '../../../shared/types/enums.js';

export interface DelegatableDefinitionQuery {
  readonly cardCode: string;
  readonly category: CardAbilityCategory;
  readonly sourceZone: CardAbilitySourceZone;
  readonly triggerCondition: TriggerCondition;
  readonly sourceSlot: SlotPosition;
}

export function getDelegatableQueuedAbilityDefinitions(
  query: DelegatableDefinitionQuery
): readonly CardAbilityDefinition[] {
  return getImplementedQueuedAbilityDefinitionsForCardCode(query.cardCode, {
    category: query.category,
    sourceZone: query.sourceZone,
    triggerCondition: query.triggerCondition,
    sourceSlot: query.sourceSlot,
  });
}

export function getWaitingRoomDelegatableOnEnterDefinitions(
  cardCode: string
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter(
    (definition) =>
      definition.implemented &&
      definition.queued &&
      definition.category === CardAbilityCategory.ON_ENTER &&
      definition.sourceZone === CardAbilitySourceZone.PLAYED_MEMBER &&
      definition.triggerCondition === TriggerCondition.ON_ENTER_STAGE &&
      definition.delegatedOnEnterFromWaitingRoomPolicy?.decision === 'ALLOW'
  );
}

/**
 * ON_ENTER abilities a concrete, current top-level stage member may delegate.
 * Historical definitions use both PLAYED_MEMBER and STAGE_MEMBER for this timing.
 */
export function getStageMemberDelegatableOnEnterDefinitions(
  cardCode: string,
  sourceSlot: SlotPosition
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter(
    (definition) =>
      definition.implemented &&
      definition.queued &&
      definition.category === CardAbilityCategory.ON_ENTER &&
      (definition.sourceZone === CardAbilitySourceZone.PLAYED_MEMBER ||
        definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER) &&
      definition.triggerCondition === TriggerCondition.ON_ENTER_STAGE &&
      (definition.requiredSourceSlots === undefined ||
        definition.requiredSourceSlots.length === 0 ||
        definition.requiredSourceSlots.includes(sourceSlot))
  );
}
