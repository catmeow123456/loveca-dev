type RuleCardType = 'MEMBER' | 'LIVE' | 'ENERGY';

interface ExistingRuleFields {
  readonly cost: number | null;
  readonly blade: number | null;
  readonly score: number | null;
}

interface SourceRuleFields {
  readonly cost: string | null;
  readonly blade: string | null;
  readonly score: string | null;
}

export function parseOptionalNonNegativeInteger(
  value: string | null,
  context: string,
  warnings: string[]
): number | null {
  const normalized = value?.trim() ?? null;
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  warnings.push(`${context}: expected a non-negative integer, received ${JSON.stringify(value)}`);
  return null;
}

export function resolveSyncedRuleFields(
  cardType: RuleCardType,
  source: SourceRuleFields,
  existing: ExistingRuleFields,
  context: string,
  warnings: string[]
): ExistingRuleFields {
  const cost =
    cardType === 'MEMBER'
      ? parseOptionalNonNegativeInteger(source.cost, `${context} コスト`, warnings)
      : null;
  const blade =
    cardType === 'MEMBER'
      ? parseOptionalNonNegativeInteger(source.blade, `${context} ブレード`, warnings)
      : null;
  const score =
    cardType === 'LIVE'
      ? parseOptionalNonNegativeInteger(source.score, `${context} スコア`, warnings)
      : null;

  return {
    cost: cost ?? existing.cost,
    blade: blade ?? existing.blade,
    score: score ?? existing.score,
  };
}
