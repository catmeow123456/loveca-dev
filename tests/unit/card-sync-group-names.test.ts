import { describe, expect, it } from 'vitest';
import { normalizeCardSyncGroupNames } from '../../src/scripts/card-sync-group-names';

describe('card sync group names', () => {
  it('normalizes the upstream Aqours! spelling to Aqours', () => {
    expect(normalizeCardSyncGroupNames(['Aqours!'])).toEqual(['Aqours']);
  });

  it('preserves other group names and removes aliases that become duplicates', () => {
    expect(normalizeCardSyncGroupNames([' Liella! ', 'Aqours!', 'Aqours'])).toEqual([
      'Liella!',
      'Aqours',
    ]);
  });
});
