import { describe, expect, it } from 'vitest';
import { reconcileSelection } from './useSelectionDraft';
describe('selection reconciliation', () => {
  it('retains legal order, removes stale or duplicate candidates and enforces current maximum', () => {
    expect(reconcileSelection(['b', 'expired', 'a', 'b'], ['a', 'b', 'new'], 2)).toEqual([
      'b',
      'a',
    ]);
    expect(reconcileSelection(['b', 'a'], ['a', 'b'], 1)).toEqual(['b']);
  });
});
