import type { TriggerCondition } from '../../../shared/types/enums.js';
import { cardCodeMatchesBase, normalizeCardCode } from '../../../shared/utils/card-code.js';
import {
  CardAbilitySourceZone,
  type CardAbilityCategory,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { CARD_ABILITY_DEFINITIONS } from '../definitions/index.js';
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
  return CARD_ABILITY_DEFINITIONS.filter((definition) => {
    if (
      !definition.implemented ||
      !definition.queued ||
      definition.category !== query.category ||
      definition.sourceZone !== query.sourceZone ||
      definition.triggerCondition !== query.triggerCondition ||
      !doesDefinitionMatchCardCode(definition, query.cardCode)
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

function doesDefinitionMatchCardCode(
  definition: CardAbilityDefinition,
  cardCode: string
): boolean {
  const normalizedCardCode = normalizeCardCode(cardCode);
  return (
    definition.cardCodes?.map(normalizeCardCode).includes(normalizedCardCode) === true ||
    definition.baseCardCodes?.some((baseCardCode) =>
      cardCodeMatchesBase(normalizedCardCode, baseCardCode)
    ) === true
  );
}
