import { describe, expect, it } from 'vitest';
import {
  LOVECA_SYNC_BLADE_HEART_COLOR_MAP,
  LOVECA_SYNC_HEART_COLOR_MAP,
  LOVECA_SYNC_RAINBOW_HEART_TOKENS,
} from '../../src/scripts/card-sync-heart-colors';

describe('Loveca card sync Heart colors', () => {
  it('maps the orange source token to an independent ORANGE color', () => {
    expect(LOVECA_SYNC_HEART_COLOR_MAP.orange).toBe('ORANGE');
    expect(LOVECA_SYNC_BLADE_HEART_COLOR_MAP.orange).toBe('ORANGE');
  });

  it('keeps All Heart tokens mapped to RAINBOW instead of ORANGE', () => {
    expect(LOVECA_SYNC_RAINBOW_HEART_TOKENS.has('all')).toBe(true);
    expect(LOVECA_SYNC_RAINBOW_HEART_TOKENS.has('any')).toBe(true);
    expect(LOVECA_SYNC_BLADE_HEART_COLOR_MAP.all).toBe('RAINBOW');
  });
});
