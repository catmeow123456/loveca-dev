import { describe, expect, it } from 'vitest';
import {
  createBlindCardSelectionToken,
  resolveBlindCardSelectionToken,
} from '../../src/shared/utils/blind-card-selection';

describe('blind card selection tokens', () => {
  it('maps opaque positional tokens without embedding card ids', () => {
    const candidates = ['known-public-card-id', 'private-card-id'];
    const token = createBlindCardSelectionToken(1);

    expect(token).toBe('blind-card-1');
    expect(token).not.toContain(candidates[1]);
    expect(resolveBlindCardSelectionToken(candidates, token)).toBe(candidates[1]);
  });

  it.each(['blind-card--1', 'blind-card-1.5', 'blind-card-x', 'forged', '', null])(
    'rejects malformed or forged token %s',
    (token) => {
      expect(resolveBlindCardSelectionToken(['card-0'], token)).toBeNull();
    }
  );

  it('rejects a well-formed token outside the candidate snapshot', () => {
    expect(resolveBlindCardSelectionToken(['card-0'], 'blind-card-1')).toBeNull();
  });
});
