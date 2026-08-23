import type { DeckClassifierRuleDefinitionView } from '@game/online/deck-classifier-types';

export type CommonRuleConditionKind = 'CARD_COUNT' | 'COUNT_SUM' | 'FORBID_CARD';
export type CommonRuleCardType = '' | 'MEMBER' | 'LIVE';

export interface CommonRuleCondition {
  readonly kind: CommonRuleConditionKind;
  readonly cardType: CommonRuleCardType;
  /** One code for CARD_COUNT/FORBID_CARD; comma- or whitespace-separated codes for COUNT_SUM. */
  readonly cardCodes: string;
  readonly minCount: string;
  readonly maxCount: string;
}

export const DEFAULT_COMMON_RULE_CONDITION: CommonRuleCondition = {
  kind: 'CARD_COUNT',
  cardType: '',
  cardCodes: '',
  minCount: '1',
  maxCount: '',
};

export function definitionToCommonRuleConditions(
  definition: DeckClassifierRuleDefinitionView
): readonly CommonRuleCondition[] | null {
  if ((definition.includeAny?.length ?? 0) > 0) return null;

  const conditions: CommonRuleCondition[] = [];
  for (const constraint of definition.includeAll ?? []) {
    conditions.push({
      kind: 'CARD_COUNT',
      cardType: constraint.cardType ?? '',
      cardCodes: constraint.baseCardCode,
      minCount: String(constraint.minCount ?? 1),
      maxCount: constraint.maxCount === undefined ? '' : String(constraint.maxCount),
    });
  }
  for (const constraint of definition.countSums ?? []) {
    if (constraint.minCount === undefined && constraint.maxCount === undefined) return null;
    conditions.push({
      kind: 'COUNT_SUM',
      cardType: constraint.cardType ?? '',
      cardCodes: constraint.baseCardCodes.join('、'),
      minCount: constraint.minCount === undefined ? '' : String(constraint.minCount),
      maxCount: constraint.maxCount === undefined ? '' : String(constraint.maxCount),
    });
  }
  for (const constraint of definition.forbidAny ?? []) {
    if (
      (constraint.minCount !== undefined && constraint.minCount !== 1) ||
      constraint.maxCount !== undefined
    ) {
      return null;
    }
    conditions.push({
      kind: 'FORBID_CARD',
      cardType: constraint.cardType ?? '',
      cardCodes: constraint.baseCardCode,
      minCount: '',
      maxCount: '',
    });
  }
  return conditions.length > 0 ? conditions : null;
}

export function commonRuleConditionsToDefinition(
  conditions: readonly CommonRuleCondition[]
): DeckClassifierRuleDefinitionView {
  if (conditions.length === 0) throw new Error('请至少添加一个直观条件');

  const includeAll: NonNullable<DeckClassifierRuleDefinitionView['includeAll']>[number][] = [];
  const forbidAny: NonNullable<DeckClassifierRuleDefinitionView['forbidAny']>[number][] = [];
  const countSums: NonNullable<DeckClassifierRuleDefinitionView['countSums']>[number][] = [];

  conditions.forEach((condition, index) => {
    const codes = splitCardCodes(condition.cardCodes);
    if (codes.length === 0) throw new Error(`第 ${index + 1} 个条件缺少卡牌编号`);
    const cardType = condition.cardType || undefined;

    if (condition.kind === 'FORBID_CARD') {
      if (codes.length !== 1) throw new Error(`第 ${index + 1} 个禁止条件只能填写一张卡`);
      forbidAny.push({ baseCardCode: codes[0]!, cardType });
      return;
    }

    const minCount = readOptionalCount(condition.minCount, index, '最少数量');
    const maxCount = readOptionalCount(condition.maxCount, index, '最多数量');
    if (minCount !== undefined && maxCount !== undefined && minCount > maxCount) {
      throw new Error(`第 ${index + 1} 个条件的最少数量不能大于最多数量`);
    }

    if (condition.kind === 'CARD_COUNT') {
      if (codes.length !== 1) throw new Error(`第 ${index + 1} 个单卡条件只能填写一张卡`);
      includeAll.push({
        baseCardCode: codes[0]!,
        cardType,
        minCount: minCount ?? 1,
        ...(maxCount === undefined ? {} : { maxCount }),
      });
      return;
    }

    if (minCount === undefined && maxCount === undefined) {
      throw new Error(`第 ${index + 1} 个合计条件至少要填写最少或最多数量`);
    }
    countSums.push({
      baseCardCodes: codes,
      cardType,
      ...(minCount === undefined ? {} : { minCount }),
      ...(maxCount === undefined ? {} : { maxCount }),
    });
  });

  return {
    ...(includeAll.length > 0 ? { includeAll } : {}),
    ...(forbidAny.length > 0 ? { forbidAny } : {}),
    ...(countSums.length > 0 ? { countSums } : {}),
  };
}

export function describeRuleDefinition(
  definition: DeckClassifierRuleDefinitionView
): readonly string[] | null {
  const conditions = definitionToCommonRuleConditions(definition);
  return conditions?.map(describeCommonRuleCondition) ?? null;
}

export function describeCommonRuleCondition(condition: CommonRuleCondition): string {
  const codes = splitCardCodes(condition.cardCodes);
  const cardLabel = codes.join('、') || '未填写卡牌';
  const typeLabel =
    condition.cardType === 'MEMBER'
      ? 'MEMBER'
      : condition.cardType === 'LIVE'
        ? 'LIVE'
        : '任意类型';
  if (condition.kind === 'FORBID_CARD') return `不得包含 ${typeLabel} 卡 ${cardLabel}`;

  const minCount = condition.minCount.trim();
  const maxCount = condition.maxCount.trim();
  const range =
    minCount && maxCount
      ? `${minCount}～${maxCount} 张`
      : minCount
        ? `≥ ${minCount} 张`
        : maxCount
          ? `≤ ${maxCount} 张`
          : '≥ 1 张';
  return condition.kind === 'COUNT_SUM'
    ? `${typeLabel} 卡 ${cardLabel} 合计 ${range}`
    : `${typeLabel} 卡 ${cardLabel} ${range}`;
}

export function splitCardCodes(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(/[\s,，、]+/u)
        .map((code) => code.trim())
        .filter(Boolean)
    ),
  ];
}

function readOptionalCount(value: string, index: number, label: string): number | undefined {
  if (!value.trim()) return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 60) {
    throw new Error(`第 ${index + 1} 个条件的${label}必须是 0～60 的整数`);
  }
  return count;
}
