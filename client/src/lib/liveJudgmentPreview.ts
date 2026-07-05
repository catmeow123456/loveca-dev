import { HeartColor } from '@game/shared/types/enums';
import { applyHeartRequirementModifiers } from '@game/domain/rules/live-requirement-modifiers';
import type { HeartRequirement } from '@game/domain/entities/card';
import { getHeartRequirementEntries } from './heartRequirementUtils';

export interface HeartRequirementDisplayEntry {
  readonly color: HeartColor;
  readonly count: number;
}

export interface LiveJudgmentPreviewCardInput {
  readonly cardId: string;
  readonly adjustedRequirements: unknown | null;
  readonly score: number;
}

export type LiveJudgmentPreviewStatus = 'WAITING_LIVE' | 'UNKNOWN' | 'SUCCESS' | 'FAILURE';

export interface LiveJudgmentPreviewInput {
  readonly liveCards: readonly LiveJudgmentPreviewCardInput[];
  readonly hearts: ReadonlyMap<HeartColor, number>;
  readonly drawBonus: number;
  readonly cheerScoreBonus: number;
  readonly effectScoreBonus: number;
}

export interface LiveJudgmentPreviewResult {
  readonly status: LiveJudgmentPreviewStatus;
  readonly mergedRequirements: HeartRequirement | null;
  readonly requirementDeficit: readonly HeartRequirementDisplayEntry[] | null;
  readonly drawBonus: number;
  readonly cheerScoreBonus: number;
  readonly effectScoreBonus: number;
  readonly liveScore: number | null;
  readonly totalScore: number | null;
}

type RequirementModifier = {
  readonly color: HeartColor;
  readonly countDelta: number;
};

const HEART_COLORS = Object.values(HeartColor);

function getRequirementTotal(
  requirements: unknown,
  entries: readonly HeartRequirementDisplayEntry[]
): number {
  const totalRequired =
    typeof requirements === 'object' &&
    requirements !== null &&
    'totalRequired' in requirements &&
    typeof (requirements as { totalRequired?: unknown }).totalRequired === 'number'
      ? (requirements as { totalRequired: number }).totalRequired
      : null;

  return totalRequired ?? entries.reduce((total, req) => total + req.count, 0);
}

export function normalizeHeartRequirement(requirements: unknown): HeartRequirement {
  const source = requirements as
    { colorRequirements?: unknown; totalRequired?: unknown } | null | undefined;
  const rawEntries = getHeartRequirementEntries(
    source?.colorRequirements as Parameters<typeof getHeartRequirementEntries>[0]
  ).map(([color, count]) => ({ color, count }));
  const totalRequired = getRequirementTotal(requirements, rawEntries);
  const colorRequirements = new Map<HeartColor, number>();
  let specificRequiredTotal = 0;
  let explicitGenericRequired = 0;

  for (const entry of rawEntries) {
    if (entry.color === HeartColor.RAINBOW) {
      explicitGenericRequired += entry.count;
      continue;
    }
    specificRequiredTotal += entry.count;
    colorRequirements.set(entry.color, (colorRequirements.get(entry.color) ?? 0) + entry.count);
  }

  const genericRequired = Math.max(
    0,
    totalRequired - specificRequiredTotal,
    explicitGenericRequired
  );
  if (genericRequired > 0) {
    colorRequirements.set(HeartColor.RAINBOW, genericRequired);
  }

  return {
    colorRequirements,
    totalRequired: specificRequiredTotal + genericRequired,
  };
}

export function getAdjustedLiveRequirements(
  requirements: unknown,
  modifiers: readonly RequirementModifier[]
): HeartRequirement {
  const normalizedRequirement = normalizeHeartRequirement(requirements);
  if (modifiers.length === 0) {
    return normalizedRequirement;
  }

  return applyHeartRequirementModifiers(normalizedRequirement, modifiers);
}

export function getRequirementEntriesForDisplay(
  requirements: unknown
): HeartRequirementDisplayEntry[] {
  const normalized = normalizeHeartRequirement(requirements);
  return getHeartRequirementEntries(normalized.colorRequirements).map(([color, count]) => ({
    color,
    count,
  }));
}

export function mergeLiveRequirementsForPreview(
  requirementsList: readonly unknown[]
): HeartRequirement {
  const colorRequirements = new Map<HeartColor, number>();
  let totalRequired = 0;

  for (const requirements of requirementsList) {
    const normalized = normalizeHeartRequirement(requirements);
    for (const [color, count] of normalized.colorRequirements) {
      colorRequirements.set(color, (colorRequirements.get(color) ?? 0) + count);
    }
    totalRequired += normalized.totalRequired;
  }

  return {
    colorRequirements,
    totalRequired,
  };
}

function cloneHeartCounts(source: ReadonlyMap<HeartColor, number>): Map<HeartColor, number> {
  const result = new Map<HeartColor, number>();
  HEART_COLORS.forEach((color) => {
    result.set(color, source.get(color) ?? 0);
  });
  return result;
}

function evaluateHeartRequirement(
  hearts: ReadonlyMap<HeartColor, number>,
  requirements: unknown
): {
  readonly success: boolean;
  readonly remaining: Map<HeartColor, number>;
  readonly deficit: Map<HeartColor, number>;
} {
  const requirement = normalizeHeartRequirement(requirements);
  const remaining = cloneHeartCounts(hearts);
  const deficit = new Map<HeartColor, number>();
  let rainbowAvailable = remaining.get(HeartColor.RAINBOW) ?? 0;
  let consumedCount = 0;

  for (const [color, required] of requirement.colorRequirements) {
    if (color === HeartColor.RAINBOW) {
      continue;
    }

    const available = remaining.get(color) ?? 0;
    const normalUsed = Math.min(available, required);
    const rainbowNeeded = required - normalUsed;
    const rainbowUsed = Math.min(rainbowAvailable, rainbowNeeded);
    const missing = rainbowNeeded - rainbowUsed;

    remaining.set(color, available - normalUsed);
    rainbowAvailable -= rainbowUsed;
    consumedCount += normalUsed + rainbowUsed + missing;

    if (missing > 0) {
      deficit.set(color, (deficit.get(color) ?? 0) + missing);
    }
  }

  let genericNeeded = Math.max(0, requirement.totalRequired - consumedCount);
  for (const color of HEART_COLORS) {
    if (genericNeeded <= 0 || color === HeartColor.RAINBOW) {
      continue;
    }
    const available = remaining.get(color) ?? 0;
    const used = Math.min(available, genericNeeded);
    remaining.set(color, available - used);
    genericNeeded -= used;
  }

  const rainbowUsedForGeneric = Math.min(rainbowAvailable, genericNeeded);
  rainbowAvailable -= rainbowUsedForGeneric;
  genericNeeded -= rainbowUsedForGeneric;
  if (genericNeeded > 0) {
    deficit.set(HeartColor.RAINBOW, genericNeeded);
  }

  remaining.set(HeartColor.RAINBOW, rainbowAvailable);

  return {
    success: deficit.size === 0,
    remaining,
    deficit,
  };
}

export function judgeLiveWithHeartCounts(
  hearts: ReadonlyMap<HeartColor, number>,
  requirements: unknown
): { success: boolean; remaining: Map<HeartColor, number> } {
  const result = evaluateHeartRequirement(hearts, requirements);
  return {
    success: result.success,
    remaining: result.success ? result.remaining : cloneHeartCounts(hearts),
  };
}

export function calculateLiveRequirementDeficit(
  hearts: ReadonlyMap<HeartColor, number>,
  requirements: unknown
): HeartRequirementDisplayEntry[] {
  const result = evaluateHeartRequirement(hearts, requirements);
  return [...result.deficit.entries()].map(([color, count]) => ({ color, count }));
}

export function buildLiveJudgmentPreview(
  input: LiveJudgmentPreviewInput
): LiveJudgmentPreviewResult {
  const baseResult = {
    drawBonus: input.drawBonus,
    cheerScoreBonus: 0,
    effectScoreBonus: 0,
    liveScore: null,
    totalScore: null,
  };

  if (input.liveCards.length === 0) {
    return {
      ...baseResult,
      status: 'WAITING_LIVE',
      mergedRequirements: null,
      requirementDeficit: null,
    };
  }

  const allRequirementsVisible = input.liveCards.every(
    (card) => card.adjustedRequirements !== null
  );
  if (!allRequirementsVisible) {
    return {
      ...baseResult,
      status: 'UNKNOWN',
      mergedRequirements: null,
      requirementDeficit: null,
    };
  }

  const mergedRequirements = mergeLiveRequirementsForPreview(
    input.liveCards.map((card) => card.adjustedRequirements)
  );
  const judgment = judgeLiveWithHeartCounts(input.hearts, mergedRequirements);
  if (!judgment.success) {
    return {
      ...baseResult,
      status: 'FAILURE',
      mergedRequirements,
      requirementDeficit: calculateLiveRequirementDeficit(input.hearts, mergedRequirements),
      liveScore: 0,
      totalScore: 0,
    };
  }

  const liveScore = input.liveCards.reduce((total, card) => total + card.score, 0);
  const totalScore = liveScore + input.cheerScoreBonus + input.effectScoreBonus;

  return {
    status: 'SUCCESS',
    mergedRequirements,
    requirementDeficit: [],
    drawBonus: input.drawBonus,
    cheerScoreBonus: input.cheerScoreBonus,
    effectScoreBonus: input.effectScoreBonus,
    liveScore,
    totalScore,
  };
}
