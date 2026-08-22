import { getBaseCardCode, normalizeCardCode } from '../../../shared/utils/card-code.js';
import type { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import type {
  CardAbilityCategory,
  CardAbilityDefinition,
  CardAbilitySourceZone,
} from '../ability-definition-types.js';
import { CARD_ABILITY_DEFINITIONS } from './index.js';

const definitionsByAbilityId = new Map<string, CardAbilityDefinition>();
const definitionsByExactCardCode = new Map<string, CardAbilityDefinition[]>();
const definitionsByBaseCardCode = new Map<string, CardAbilityDefinition[]>();
const definitionOrder = new Map<CardAbilityDefinition, number>();
const exactCardCodeSetsByDefinition = new Map<CardAbilityDefinition, ReadonlySet<string>>();
const baseCardCodeSetsByDefinition = new Map<CardAbilityDefinition, ReadonlySet<string>>();

for (const [index, definition] of CARD_ABILITY_DEFINITIONS.entries()) {
  definitionOrder.set(definition, index);
  if (!definitionsByAbilityId.has(definition.abilityId)) {
    definitionsByAbilityId.set(definition.abilityId, definition);
  }

  const exactCardCodes = new Set((definition.cardCodes ?? []).map(normalizeCardCode));
  exactCardCodeSetsByDefinition.set(definition, exactCardCodes);
  for (const cardCode of exactCardCodes) {
    appendDefinition(definitionsByExactCardCode, cardCode, definition);
  }

  const baseCardCodes = new Set(
    (definition.baseCardCodes ?? []).map((cardCode) => getBaseCardCode(normalizeCardCode(cardCode)))
  );
  baseCardCodeSetsByDefinition.set(definition, baseCardCodes);
  for (const baseCardCode of baseCardCodes) {
    appendDefinition(definitionsByBaseCardCode, baseCardCode, definition);
  }
}

export const IMPLEMENTED_QUEUED_ABILITY_IDS: ReadonlySet<string> = new Set(
  CARD_ABILITY_DEFINITIONS.filter((ability) => ability.implemented && ability.queued).map(
    (ability) => ability.abilityId
  )
);

export function findCardAbilityDefinitionById(abilityId: string): CardAbilityDefinition | null {
  return definitionsByAbilityId.get(abilityId) ?? null;
}

export function getCardAbilityDefinitionById(abilityId: string): CardAbilityDefinition {
  const definition = findCardAbilityDefinitionById(abilityId);
  if (!definition) {
    throw new Error(`Missing card ability definition for abilityId: ${abilityId}`);
  }
  return definition;
}

export function getCardAbilityDefinitionsForCardCode(
  cardCode: string | undefined
): readonly CardAbilityDefinition[] {
  if (!cardCode) {
    return [];
  }

  const normalizedCardCode = normalizeCardCode(cardCode);
  const baseCardCode = getBaseCardCode(normalizedCardCode);
  const exactDefinitions = definitionsByExactCardCode.get(normalizedCardCode) ?? [];
  const baseDefinitions = definitionsByBaseCardCode.get(baseCardCode) ?? [];
  if (exactDefinitions.length === 0) {
    return baseDefinitions;
  }
  if (baseDefinitions.length === 0) {
    return exactDefinitions;
  }

  return [...new Set([...exactDefinitions, ...baseDefinitions])].sort(
    (left, right) => (definitionOrder.get(left) ?? 0) - (definitionOrder.get(right) ?? 0)
  );
}

export interface ImplementedQueuedAbilityDefinitionQuery {
  readonly category: CardAbilityCategory;
  readonly sourceZone: CardAbilitySourceZone;
  readonly triggerCondition: TriggerCondition;
  readonly sourceSlot?: SlotPosition | null;
  readonly ignoreRequiredSourceSlots?: boolean;
}

/**
 * Read-only definition-shape query for effects that inspect a concrete card's
 * queued abilities. By default required source slots are checked against the
 * concrete source slot; callers inspecting every printed ability may opt out.
 */
export function getImplementedQueuedAbilityDefinitionsForCardCode(
  cardCode: string | undefined,
  query: ImplementedQueuedAbilityDefinitionQuery
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter((definition) => {
    if (
      !definition.implemented ||
      !definition.queued ||
      definition.category !== query.category ||
      definition.sourceZone !== query.sourceZone ||
      definition.triggerCondition !== query.triggerCondition
    ) {
      return false;
    }
    if (!definition.requiredSourceSlots || definition.requiredSourceSlots.length === 0) {
      return true;
    }
    if (query.ignoreRequiredSourceSlots === true) {
      return true;
    }
    return (
      query.sourceSlot !== undefined &&
      query.sourceSlot !== null &&
      definition.requiredSourceSlots.includes(query.sourceSlot)
    );
  });
}

export function doesCardAbilityDefinitionMatchCardCode(
  definition: CardAbilityDefinition,
  cardCode: string
): boolean {
  const normalizedCardCode = normalizeCardCode(cardCode);
  const baseCardCode = getBaseCardCode(normalizedCardCode);
  return (
    exactCardCodeSetsByDefinition.get(definition)?.has(normalizedCardCode) === true ||
    baseCardCodeSetsByDefinition.get(definition)?.has(baseCardCode) === true
  );
}

function appendDefinition(
  index: Map<string, CardAbilityDefinition[]>,
  key: string,
  definition: CardAbilityDefinition
): void {
  const definitions = index.get(key);
  if (definitions) {
    definitions.push(definition);
    return;
  }
  index.set(key, [definition]);
}
