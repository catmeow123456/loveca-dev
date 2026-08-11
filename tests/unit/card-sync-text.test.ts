import { describe, expect, it } from 'vitest';
import {
  cardSyncTextValuesEqual,
  normalizeCardSyncTextLineEndings,
} from '../../src/scripts/card-sync-text.js';

describe('card sync text comparison', () => {
  it('treats LF, CRLF, and CR line endings as equivalent', () => {
    const lf = 'first\n\nsecond';

    expect(cardSyncTextValuesEqual(lf, 'first\r\n\r\nsecond')).toBe(true);
    expect(cardSyncTextValuesEqual(lf, 'first\r\rsecond')).toBe(true);
    expect(normalizeCardSyncTextLineEndings('first\r\nsecond')).toBe('first\nsecond');
  });

  it('keeps actual text differences visible', () => {
    expect(cardSyncTextValuesEqual('first\nsecond', 'first\r\nchanged')).toBe(false);
    expect(cardSyncTextValuesEqual(null, '')).toBe(false);
  });
});
