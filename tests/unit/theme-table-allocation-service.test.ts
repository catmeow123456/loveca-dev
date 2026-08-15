import { describe, expect, it, vi } from 'vitest';
import { freezeThemeTableAssignment } from '../../src/server/services/theme-table-allocation-service';

describe('freezeThemeTableAssignment', () => {
  it('freezes one approved matchup before writing both server-owned decks to tickets', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('FROM theme_table_assignments')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM theme_matchup_pair_versions')) {
        return {
          rows: [
            pair('pair-a', 2, 'deck-a', '甲组', 'hash-a', 'deck-b', '乙组', 'hash-b'),
            pair('pair-b', 1, 'deck-c', '丙组', 'hash-c', 'deck-d', '丁组', 'hash-d'),
          ],
          rowCount: 2,
        };
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

    const insertIndex = calls.findIndex((call) =>
      call.text.includes('INSERT INTO theme_table_assignments')
    );
    const ticketUpdates = calls.filter((call) => call.text.includes('UPDATE public_table_tickets'));
    expect(insertIndex).toBeGreaterThan(0);
    expect(ticketUpdates).toHaveLength(2);
    expect(calls.findIndex((call) => call === ticketUpdates[0])).toBeGreaterThan(insertIndex);

    const insertValues = calls[insertIndex].values!;
    expect(insertValues[0]).toBe('reservation-1');
    expect(insertValues[1]).toBe('theme-1');
    expect(insertValues[6]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertValues[7]).toMatch(/^[a-f0-9]{64}$/);
    const proof = JSON.parse(String(insertValues[8])) as {
      entropyHex: string;
      totalWeight: number;
      eligiblePairSnapshot: unknown[];
      swapSeats: boolean;
    };
    expect(proof.entropyHex).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.totalWeight).toBe(3);
    expect(proof.eligiblePairSnapshot).toHaveLength(2);
    expect(typeof proof.swapSeats).toBe('boolean');

    const assignedNames = ticketUpdates.map((call) => call.values?.[1]);
    expect(
      [
        ['甲组', '乙组'],
        ['乙组', '甲组'],
        ['丙组', '丁组'],
        ['丁组', '丙组'],
      ].some((candidate) => candidate[0] === assignedNames[0] && candidate[1] === assignedNames[1])
    ).toBe(true);
  });

  it('fails closed when no approved matchup is available', async () => {
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
    expect(
      query.mock.calls.some(([text]) => String(text).includes('UPDATE public_table_tickets'))
    ).toBe(false);
  });

  it('assigns the same prebuilt deck to both tickets for an enabled mirror matchup', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const query = vi.fn((text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.includes('FROM theme_table_assignments')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('FROM theme_matchup_pair_versions')) {
        return Promise.resolve({
          rows: [
            pair('pair-mirror', 1, 'deck-a', '彩虹混合', 'hash-a', 'deck-a', '彩虹混合', 'hash-a'),
          ],
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
    const ticketUpdates = calls.filter((call) => call.text.includes('UPDATE public_table_tickets'));
    expect(ticketUpdates.map((call) => call.values?.[1])).toEqual(['彩虹混合', '彩虹混合']);
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

function pair(
  pairId: string,
  weight: number,
  firstDeckId: string,
  firstName: string,
  firstHash: string,
  secondDeckId: string,
  secondName: string,
  secondHash: string
) {
  return {
    pair_id: pairId,
    weight,
    first_deck_id: firstDeckId,
    first_deck_name: firstName,
    first_runtime_deck: { mainDeck: [{ cardCode: firstDeckId }], energyDeck: [] },
    first_content_hash: firstHash,
    second_deck_id: secondDeckId,
    second_deck_name: secondName,
    second_runtime_deck: { mainDeck: [{ cardCode: secondDeckId }], energyDeck: [] },
    second_content_hash: secondHash,
    allocation_algorithm_version: 'THEME_WEIGHTED_PAIR_V1',
  };
}
