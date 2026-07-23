import { describe, expect, it } from 'vitest';
import { collectWaitingRoomJudgmentStats } from '@/lib/waitingRoomJudgmentStats';
import type { AnyCardData } from '@game/domain/entities/card';
import { BladeHeartEffect, CardType, HeartColor } from '@game/shared/types/enums';

describe('waiting room judgment stats', () => {
  it('counts only blade hearts and ignores member printed hearts', () => {
    const memberWithPrintedHearts = {
      cardType: CardType.MEMBER,
      hearts: [
        { color: HeartColor.PINK, count: 3 },
        { color: HeartColor.RAINBOW, count: 1 },
      ],
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    } as AnyCardData;
    const liveWithBladeHearts = {
      cardType: CardType.LIVE,
      bladeHearts: [
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE },
        { effect: BladeHeartEffect.SCORE },
      ],
    } as AnyCardData;

    const stats = collectWaitingRoomJudgmentStats([memberWithPrintedHearts, liveWithBladeHearts]);

    expect(stats.memberCount).toBe(1);
    expect(stats.liveCount).toBe(1);
    expect(stats.hearts[HeartColor.PINK]).toBe(0);
    expect(stats.hearts[HeartColor.RAINBOW]).toBe(0);
    expect(stats.hearts[HeartColor.BLUE]).toBe(1);
    expect(stats.totalHearts).toBe(1);
    expect(stats.scoreBonus).toBe(1);
    expect(stats.drawBonus).toBe(1);
    expect(stats.noJudgmentCount).toBe(0);
  });

  it('counts cards without effective blade hearts as no-judgment cards', () => {
    const memberWithoutBladeHearts = {
      cardType: CardType.MEMBER,
      hearts: [{ color: HeartColor.RED, count: 2 }],
    } as AnyCardData;
    const liveWithoutBladeHearts = {
      cardType: CardType.LIVE,
      bladeHearts: [],
    } as AnyCardData;
    const liveWithInvalidHeartBlade = {
      cardType: CardType.LIVE,
      bladeHearts: [{ effect: BladeHeartEffect.HEART }],
    } as AnyCardData;
    const liveWithDrawBlade = {
      cardType: CardType.LIVE,
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    } as AnyCardData;

    const stats = collectWaitingRoomJudgmentStats([
      memberWithoutBladeHearts,
      liveWithoutBladeHearts,
      liveWithInvalidHeartBlade,
      liveWithDrawBlade,
    ]);

    expect(stats.memberCount).toBe(1);
    expect(stats.liveCount).toBe(3);
    expect(stats.drawBonus).toBe(1);
    expect(stats.noJudgmentCount).toBe(3);
  });
});
