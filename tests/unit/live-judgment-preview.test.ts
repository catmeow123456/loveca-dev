import { describe, expect, it } from 'vitest';
import { HeartColor } from '../../src/shared/types/enums';
import type { HeartRequirement } from '../../src/domain/entities/card';
import {
  buildLiveJudgmentPreview,
  calculateLiveRequirementDeficit,
  getAdjustedLiveRequirements,
  getRequirementEntriesForDisplay,
  mergeLiveRequirementsForPreview,
} from '../../client/src/lib/liveJudgmentPreview';

function requirement(colorReqs: Partial<Record<HeartColor, number>>, totalRequired?: number) {
  const colorRequirements = new Map<HeartColor, number>();
  let computedTotal = 0;

  for (const [color, count] of Object.entries(colorReqs)) {
    if (!count) {
      continue;
    }
    colorRequirements.set(color as HeartColor, count);
    computedTotal += count;
  }

  return {
    colorRequirements,
    totalRequired: totalRequired ?? computedTotal,
  } satisfies HeartRequirement;
}

function hearts(entries: Partial<Record<HeartColor, number>>) {
  const result = new Map<HeartColor, number>();
  for (const [color, count] of Object.entries(entries)) {
    result.set(color as HeartColor, count ?? 0);
  }
  return result;
}

describe('live judgment preview', () => {
  it('normalizes generic requirements represented only by totalRequired for display', () => {
    expect(getRequirementEntriesForDisplay(requirement({ [HeartColor.RED]: 1 }, 3))).toEqual([
      { color: HeartColor.RED, count: 1 },
      { color: HeartColor.RAINBOW, count: 2 },
    ]);
  });

  it('uses Rainbow Heart to cover specific requirements before calculating generic deficit', () => {
    const merged = requirement({ [HeartColor.RED]: 3 }, 5);

    expect(
      calculateLiveRequirementDeficit(
        hearts({
          [HeartColor.RED]: 1,
          [HeartColor.BLUE]: 1,
          [HeartColor.RAINBOW]: 1,
        }),
        merged
      )
    ).toEqual([
      { color: HeartColor.RED, count: 1 },
      { color: HeartColor.RAINBOW, count: 1 },
    ]);

    expect(
      calculateLiveRequirementDeficit(
        hearts({
          [HeartColor.RED]: 1,
          [HeartColor.BLUE]: 2,
          [HeartColor.RAINBOW]: 2,
        }),
        merged
      )
    ).toEqual([]);
  });

  it('calculates preview success and scores only after all Live requirements are visible', () => {
    const preview = buildLiveJudgmentPreview({
      liveCards: [
        {
          cardId: 'live-1',
          adjustedRequirements: requirement({ [HeartColor.RED]: 2 }),
          score: 4,
        },
        {
          cardId: 'live-2',
          adjustedRequirements: null,
          score: 6,
        },
      ],
      hearts: hearts({ [HeartColor.RED]: 10 }),
      drawBonus: 1,
      cheerScoreBonus: 2,
      effectScoreBonus: 3,
    });

    expect(preview.status).toBe('UNKNOWN');
    expect(preview.requirementDeficit).toBeNull();
    expect(preview.totalScore).toBeNull();
    expect(preview.drawBonus).toBe(1);
  });

  it('returns waiting state when there is no Live card', () => {
    const preview = buildLiveJudgmentPreview({
      liveCards: [],
      hearts: hearts({ [HeartColor.RED]: 10 }),
      drawBonus: 0,
      cheerScoreBonus: 0,
      effectScoreBonus: 0,
    });

    expect(preview.status).toBe('WAITING_LIVE');
    expect(preview.mergedRequirements).toBeNull();
    expect(preview.totalScore).toBeNull();
  });

  it('merges adjusted requirements before judging success', () => {
    const redRequirement = getAdjustedLiveRequirements(requirement({ [HeartColor.RED]: 2 }), [
      { color: HeartColor.RED, countDelta: -1 },
    ]);
    const genericRequirement = getAdjustedLiveRequirements(
      requirement({ [HeartColor.RAINBOW]: 3 }),
      [{ color: HeartColor.RAINBOW, countDelta: -1 }]
    );
    const merged = mergeLiveRequirementsForPreview([redRequirement, genericRequirement]);

    expect(getRequirementEntriesForDisplay(merged)).toEqual([
      { color: HeartColor.RED, count: 1 },
      { color: HeartColor.RAINBOW, count: 2 },
    ]);

    expect(
      buildLiveJudgmentPreview({
        liveCards: [
          { cardId: 'live-1', adjustedRequirements: redRequirement, score: 3 },
          { cardId: 'live-2', adjustedRequirements: genericRequirement, score: 2 },
        ],
        hearts: hearts({ [HeartColor.RED]: 1, [HeartColor.BLUE]: 2 }),
        drawBonus: 1,
        cheerScoreBonus: 1,
        effectScoreBonus: 1,
      })
    ).toMatchObject({
      status: 'SUCCESS',
      requirementDeficit: [],
      liveScore: 5,
      totalScore: 7,
    });
  });

  it('sets total score to 0 when the overall Live judgment fails', () => {
    const preview = buildLiveJudgmentPreview({
      liveCards: [
        {
          cardId: 'live-1',
          adjustedRequirements: requirement({ [HeartColor.PINK]: 2 }),
          score: 9,
        },
      ],
      hearts: hearts({ [HeartColor.PINK]: 1 }),
      drawBonus: 2,
      cheerScoreBonus: 3,
      effectScoreBonus: 4,
    });

    expect(preview.status).toBe('FAILURE');
    expect(preview.requirementDeficit).toEqual([{ color: HeartColor.PINK, count: 1 }]);
    expect(preview.liveScore).toBe(0);
    expect(preview.totalScore).toBe(0);
  });
});
