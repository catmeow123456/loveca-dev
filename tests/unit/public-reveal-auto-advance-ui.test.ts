import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffectViewState } from '../../src/online/types';
import {
  buildPublicRevealDisplayEntries,
  buildPublicRevealDisplayKey,
  getPublicRevealAutoAdvanceDelayMs,
  getPublicRevealEntranceTiming,
  getPublicRevealFallbackDelayMs,
  isPublicRevealAutoAdvanceView,
  PUBLIC_REVEAL_FALLBACK_DELAY_MS,
  type PublicRevealAutoAdvanceView,
  schedulePublicRevealAutoAdvance,
} from '../../client/src/lib/publicRevealAutoAdvance';

function effect(overrides: Partial<PublicRevealAutoAdvanceView> = {}): PublicRevealAutoAdvanceView {
  return {
    id: 'effect-1',
    abilityId: 'test:public-reveal',
    sourceObjectId: 'obj_source',
    controllerSeat: 'FIRST',
    effectText: '测试公开效果',
    stepId: 'COMMON_PUBLIC_REVEAL_DWELL',
    stepText: '公开卡牌展示中',
    waitingSeat: 'FIRST',
    revealedObjectIds: ['obj_card-b', 'obj_card-a', 'obj_card-b'],
    publicRevealAutoAdvanceAt: 12_000,
    publicRevealAutoAdvanceAfterMs: 2_000,
    publicRevealGeneration: 'generation-1',
    ...overrides,
  };
}

describe('public reveal auto-advance UI model', () => {
  afterEach(() => vi.useRealTimers());

  it('recognizes one server-authoritative reveal batch and deduplicates its cards', () => {
    const view = effect();

    expect(isPublicRevealAutoAdvanceView(view)).toBe(true);
    expect(
      isPublicRevealAutoAdvanceView({
        ...view,
        publicRevealGeneration: '',
      } as ActiveEffectViewState)
    ).toBe(false);
    expect(
      isPublicRevealAutoAdvanceView({
        ...view,
        publicRevealAutoAdvanceAfterMs: undefined,
      } as ActiveEffectViewState)
    ).toBe(false);
    expect(
      isPublicRevealAutoAdvanceView({
        ...view,
        stepId: 'SOME_OTHER_STEP',
      })
    ).toBe(false);
    expect(buildPublicRevealDisplayKey(view)).toBe('effect-1:12000:generation-1');
    expect(PUBLIC_REVEAL_FALLBACK_DELAY_MS).toBe(5_000);
    expect(buildPublicRevealDisplayEntries(view)).toEqual([
      { cardId: 'card-b', entranceDelayMs: 0 },
      { cardId: 'card-a', entranceDelayMs: 45 },
    ]);
  });

  it('uses the server-clock remaining dwell projected for this client', () => {
    expect(getPublicRevealAutoAdvanceDelayMs(effect())).toBe(2_000);
    expect(getPublicRevealFallbackDelayMs(effect())).toBe(7_000);
    expect(
      getPublicRevealAutoAdvanceDelayMs(effect({ publicRevealAutoAdvanceAfterMs: -500 }))
    ).toBe(0);
  });

  it('removes entrance motion without removing the public dwell in reduced-motion mode', () => {
    const [entry] = buildPublicRevealDisplayEntries(effect());

    expect(getPublicRevealEntranceTiming(entry, false)).toEqual({
      shouldAnimate: true,
      durationSeconds: 0.2,
      delaySeconds: 0,
    });
    expect(getPublicRevealEntranceTiming(entry, true)).toEqual({
      shouldAnimate: false,
      durationSeconds: 0,
      delaySeconds: 0,
    });
    expect(getPublicRevealAutoAdvanceDelayMs(effect())).toBe(2_000);
  });

  it('requests automatic advance once and cancels stale batch timers', () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const cancel = schedulePublicRevealAutoAdvance(2_000, advance);

    vi.advanceTimersByTime(1_999);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(advance).toHaveBeenCalledTimes(1);

    const staleAdvance = vi.fn();
    const cancelStale = schedulePublicRevealAutoAdvance(2_000, staleAdvance);
    cancelStale();
    vi.advanceTimersByTime(2_000);
    expect(staleAdvance).not.toHaveBeenCalled();
    cancel();
  });
});
