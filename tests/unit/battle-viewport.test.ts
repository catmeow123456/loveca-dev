import { describe, expect, it } from 'vitest';
import {
  hasBattleViewportSignatureChanged,
  isBattleViewportInteractionInvalidated,
  type BattleViewportSignature,
} from '../../client/src/lib/battleViewport';

function signature(overrides: Partial<BattleViewportSignature> = {}): BattleViewportSignature {
  return {
    width: 390,
    height: 844,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
    innerWidth: 390,
    innerHeight: 844,
    ...overrides,
  };
}

describe('battle viewport signature checks', () => {
  it('ignores sub-threshold visual viewport jitter', () => {
    expect(
      hasBattleViewportSignatureChanged(
        signature(),
        signature({ height: 845.5, offsetTop: 1.5, innerHeight: 845.5 })
      )
    ).toBe(false);
  });

  it('detects address-bar-sized viewport changes', () => {
    expect(hasBattleViewportSignatureChanged(signature(), signature({ height: 900 }))).toBe(true);
    expect(hasBattleViewportSignatureChanged(signature(), signature({ offsetTop: 12 }))).toBe(true);
    expect(hasBattleViewportSignatureChanged(signature(), signature({ scale: 1.05 }))).toBe(true);
  });

  it('invalidates an interaction when already marked or when the viewport changed', () => {
    expect(isBattleViewportInteractionInvalidated(signature(), signature(), true)).toBe(true);
    expect(isBattleViewportInteractionInvalidated(signature(), signature({ height: 900 }), false)).toBe(
      true
    );
    expect(isBattleViewportInteractionInvalidated(signature(), signature(), false)).toBe(false);
  });
});
