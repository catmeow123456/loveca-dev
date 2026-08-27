import { describe, expect, it, vi } from 'vitest';
import { freezeThemeTableAssignment } from '../../src/server/services/theme-table-allocation-service';

describe('freezeThemeTableAssignment', () => {
  it('freezes the enabled matchup selected by both queue tickets', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('FROM theme_table_assignments')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM public_table_reservations')) {
        return { rows: [selectedPair('pair-a', 2, 'deck-a', 'hash-a', 'deck-b', 'hash-b')] };
      }
      return { rows: [], rowCount: 1 };
    });

    await freezeThemeTableAssignment(
      { query } as never,
      'reservation-1',
      'theme-1',
      'ticket-1',
      'ticket-2',
      Date.parse('2026-08-02T12:00:00.000Z')
    );

    const insert = calls.find((call) => call.text.includes('INSERT INTO theme_table_assignments'));
    expect(insert?.values?.slice(0, 6)).toEqual([
      'reservation-1',
      'theme-1',
      'pair-a',
      'deck-a',
      'deck-b',
      'THEME_DECK_CHOICE_V2',
    ]);
    expect(insert?.values?.[6]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert?.values?.[7]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(String(insert?.values?.[8]))).toEqual({
      selectionMode: 'POST_MATCH_PLAYER_CHOICE',
      selectedPairSnapshot: {
        pairId: 'pair-a',
        weight: 2,
        firstDeckId: 'deck-a',
        firstContentHash: 'hash-a',
        secondDeckId: 'deck-b',
        secondContentHash: 'hash-b',
      },
    });
    expect(calls.some((call) => call.text.includes('UPDATE public_table_tickets'))).toBe(false);
  });

  it('fails closed when the selected decks do not form an enabled matchup', async () => {
    const query = vi.fn((text: string) =>
      Promise.resolve(
        text.includes('FROM theme_table_assignments')
          ? { rows: [], rowCount: 0 }
          : { rows: [], rowCount: 0 }
      )
    );

    await expect(
      freezeThemeTableAssignment(
        { query } as never,
        'reservation-1',
        'theme-1',
        'ticket-1',
        'ticket-2',
        Date.now()
      )
    ).rejects.toMatchObject({ code: 'THEME_MATCHUP_POOL_EMPTY' });
  });

  it('supports both players selecting the same deck when its mirror matchup is enabled', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const query = vi.fn((text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.includes('FROM theme_table_assignments')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('FROM public_table_reservations')) {
        return Promise.resolve({
          rows: [selectedPair('pair-mirror', 1, 'deck-a', 'hash-a', 'deck-a', 'hash-a')],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await freezeThemeTableAssignment(
      { query } as never,
      'reservation-mirror',
      'theme-1',
      'ticket-1',
      'ticket-2',
      Date.parse('2026-08-02T12:00:00.000Z')
    );

    const assignment = calls.find((call) =>
      call.text.includes('INSERT INTO theme_table_assignments')
    );
    expect(assignment?.values?.[3]).toBe('deck-a');
    expect(assignment?.values?.[4]).toBe('deck-a');
  });

  it('is idempotent when the reservation already has a frozen assignment', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [{ id: 'assignment-1' }], rowCount: 1 }));

    await freezeThemeTableAssignment(
      { query } as never,
      'reservation-1',
      'theme-1',
      'ticket-1',
      'ticket-2',
      Date.now()
    );

    expect(query).toHaveBeenCalledTimes(1);
  });
});

function selectedPair(
  pairId: string,
  weight: number,
  firstDeckId: string,
  firstHash: string,
  secondDeckId: string,
  secondHash: string
) {
  return {
    pair_id: pairId,
    weight,
    first_deck_id: firstDeckId,
    first_content_hash: firstHash,
    second_deck_id: secondDeckId,
    second_content_hash: secondHash,
    allocation_algorithm_version: 'THEME_DECK_CHOICE_V2',
  };
}
