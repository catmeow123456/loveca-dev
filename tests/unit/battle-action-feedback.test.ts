import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBattleFeedbackEvent,
  escapeCssAttributeValue,
  getNextBattleFeedbackExpiryDelay,
  isBattleFeedbackEventExpired,
} from '../../client/src/lib/battleActionFeedback';

describe('battle action feedback events', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates events with default durations and checks expiration by createdAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const event = createBattleFeedbackEvent({
      label: '移动失败',
      tone: 'error',
    });

    expect(event.createdAt).toBe(1_000);
    expect(event.durationMs).toBe(2_600);
    expect(isBattleFeedbackEventExpired(event, 3_599)).toBe(false);
    expect(isBattleFeedbackEventExpired(event, 3_600)).toBe(true);
  });

  it('computes the next exact expiry delay for visible feedback events', () => {
    expect(getNextBattleFeedbackExpiryDelay([], 1_000)).toBeNull();
    expect(
      getNextBattleFeedbackExpiryDelay(
        [
          {
            id: 'late',
            label: 'late',
            tone: 'info',
            createdAt: 1_000,
            durationMs: 1_500,
          },
          {
            id: 'soon',
            label: 'soon',
            tone: 'success',
            createdAt: 1_200,
            durationMs: 600,
          },
        ],
        1_300
      )
    ).toBe(500);
  });

  it('escapes CSS attribute values for the quoted selector fallback', () => {
    expect(escapeCssAttributeValue('obj.card#1:[x]')).toBe('obj.card#1:[x]');
    expect(escapeCssAttributeValue('obj_"a"\\b\nc')).toBe('obj_\\"a\\"\\\\b\\a c');
  });
});
