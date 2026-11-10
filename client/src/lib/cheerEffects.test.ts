import { describe, expect, it } from 'vitest';
import { BladeHeartEffect as B, HeartColor as H } from '@game/shared/types/enums';
import { calculateCheerEffects, summarizeLiveHearts } from './cheerEffects';
import { formatTextHearts, formatTextJudgment } from './excelCardView';
import { buildLiveJudgmentPreview } from './liveJudgmentPreview';

describe('effective cheer summaries', () => {
  it('displays effective ORANGE while separating its gray judgment contribution', () => {
    const markers = [
      { effect: B.HEART, heartColor: H.ORANGE },
      { effect: B.HEART, heartColor: H.RAINBOW },
      { effect: B.DRAW },
      { effect: B.SCORE },
    ];
    expect(calculateCheerEffects(markers)).toEqual({
      penLightHearts: [
        { color: H.ORANGE, count: 1 },
        { color: H.RAINBOW, count: 1 },
      ],
      judgmentHearts: [
        { color: H.GRAY, count: 1 },
        { color: H.RAINBOW, count: 1 },
      ],
      drawBonus: 1,
      scoreBonus: 1,
    });
    expect(formatTextJudgment(markers)).toBe('橙 1、彩虹 1、抽卡 +1、分数 +1');
    expect(markers[0].heartColor).toBe(H.ORANGE);
    expect(formatTextHearts([{ color: H.ORANGE, count: 2 }])).toBe('橙 2');
  });
  it('preserves specified-color, ALL, gray and absent marker behavior', () => {
    expect(
      calculateCheerEffects([
        { effect: B.HEART, heartColor: H.RED },
        { effect: B.HEART, heartColor: H.GRAY },
      ]).penLightHearts
    ).toEqual([
      { color: H.RED, count: 1 },
      { color: H.GRAY, count: 1 },
    ]);
    expect(calculateCheerEffects()).toEqual({
      penLightHearts: [],
      judgmentHearts: [],
      drawBonus: 0,
      scoreBonus: 0,
    });
  });
  it('uses the supplied effective color after a replacement for both display and judgment', () => {
    const purple = [{ effect: B.HEART, heartColor: H.PURPLE }];
    expect(calculateCheerEffects(purple).penLightHearts).toEqual([{ color: H.PURPLE, count: 1 }]);
    expect(calculateCheerEffects(purple).judgmentHearts).toEqual([{ color: H.PURPLE, count: 1 }]);
    expect(
      calculateCheerEffects([{ effect: B.HEART, heartColor: H.ORANGE }]).penLightHearts
    ).toEqual([{ color: H.ORANGE, count: 1 }]);
  });
});

describe('live Heart display and judgment totals', () => {
  it('displays both ordinary and cheer ORANGE, but converts only cheer markers for the verdict', () => {
    const totals = summarizeLiveHearts(new Map([[H.ORANGE, 1]]), [
      calculateCheerEffects([{ effect: B.HEART, heartColor: H.ORANGE }]),
    ]);
    expect(totals.bladeHearts.get(H.ORANGE)).toBe(1);
    expect(totals.bladeHearts.get(H.GRAY)).toBe(0);
    expect(totals.totalHearts.get(H.ORANGE)).toBe(2);
    expect(totals.totalHearts.get(H.GRAY)).toBe(0);
    expect(totals.judgmentHearts.get(H.ORANGE)).toBe(1);
    expect(totals.judgmentHearts.get(H.GRAY)).toBe(1);
    const preview = (colorRequirements: Partial<Record<H, number>>) =>
      buildLiveJudgmentPreview({
        liveCards: [
          {
            cardId: 'live',
            adjustedRequirements: { colorRequirements, totalRequired: 2 },
            score: 1,
          },
        ],
        hearts: totals.judgmentHearts,
        drawBonus: 0,
        cheerScoreBonus: 0,
        effectScoreBonus: 0,
      });
    expect(preview({ ORANGE: 2 }).status).toBe('FAILURE');
    expect(preview({ ORANGE: 1, GRAY: 1 }).status).toBe('SUCCESS');
    expect(preview({ RED: 1, GRAY: 1 }).status).toBe('FAILURE');
  });
  it('preserves ordinary Heart bonuses, GRAY and ALL, and keeps display and judgment totals equal in size', () => {
    const totals = summarizeLiveHearts(
      new Map([[H.ORANGE, 2]]),
      [
        calculateCheerEffects([
          { effect: B.HEART, heartColor: H.GRAY },
          { effect: B.HEART, heartColor: H.RAINBOW },
          { effect: B.HEART, heartColor: H.ORANGE },
        ]),
      ],
      [{ color: H.ORANGE, count: 1 }]
    );
    expect(totals.totalHearts.get(H.ORANGE)).toBe(4);
    expect(totals.judgmentHearts.get(H.ORANGE)).toBe(3);
    expect(totals.totalHearts.get(H.GRAY)).toBe(1);
    expect(totals.judgmentHearts.get(H.GRAY)).toBe(2);
    expect(totals.totalHearts.get(H.RAINBOW)).toBe(1);
    expect(totals.judgmentHearts.get(H.RAINBOW)).toBe(1);
    expect([...totals.totalHearts.values()].reduce((sum, count) => sum + count, 0)).toBe(6);
    expect([...totals.judgmentHearts.values()].reduce((sum, count) => sum + count, 0)).toBe(6);
  });
});
