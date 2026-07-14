import { TriggerCondition } from '../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
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
  return getCardAbilityDefinitionsForCardCode(query.cardCode).filter((definition) => {
    if (
      !definition.implemented ||
      !definition.queued ||
      definition.category !== query.category ||
      definition.sourceZone !== query.sourceZone ||
      definition.triggerCondition !== query.triggerCondition
    ) {
      return false;
    }
    return (
      definition.requiredSourceSlots === undefined ||
      definition.requiredSourceSlots.length === 0 ||
      definition.requiredSourceSlots.includes(query.sourceSlot)
    );
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
      definition.delegatedOnEnterFromWaitingRoomPolicy === 'ALLOW'
  );
}
