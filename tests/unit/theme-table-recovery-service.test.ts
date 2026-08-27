import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  return {
    query,
    release: vi.fn(),
    connect: vi.fn(),
  };
});

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { connect: mocks.connect },
}));

import { recoverNoFaultThemeOpeningPlayers } from '../../src/server/services/theme-table-recovery-service';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const baseRow = {
  queue_kind: 'THEME',
  theme_table_version_id: '11111111-1111-4111-8111-111111111111',
  environment_id: 'sha256:theme-environment',
  theme_lifecycle: 'ACTIVE',
  theme_platform_time_zone: 'Asia/Shanghai',
  theme_open_windows: [{ weekdays: [7], startMinute: 0, endMinute: 1440 }],
  theme_starts_at: new Date('2026-08-01T00:00:00.000Z'),
  theme_ends_at: new Date('2026-08-03T00:00:00.000Z'),
  first_ticket_id: '21111111-1111-4111-8111-111111111111',
  first_user_id: '31111111-1111-4111-8111-111111111111',
  first_joined_at: new Date('2026-08-02T11:55:00.000Z'),
  first_source_deck_name: '甲组',
  first_runtime_deck: { mainDeck: [{ cardCode: 'deck-a' }], energyDeck: [] },
  first_deck_content_hash: 'hash-a',
  first_point_table_version: 'pt-2026-08',
  first_point_limit: 9,
  second_ticket_id: '41111111-1111-4111-8111-111111111111',
  second_user_id: '51111111-1111-4111-8111-111111111111',
  second_joined_at: new Date('2026-08-02T11:56:00.000Z'),
  second_source_deck_name: '乙组',
  second_runtime_deck: { mainDeck: [{ cardCode: 'deck-b' }], energyDeck: [] },
  second_deck_content_hash: 'hash-b',
  second_point_table_version: 'pt-2026-08',
  second_point_limit: 9,
} as const;

describe('recoverNoFaultThemeOpeningPlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  });

  it('creates a fresh ticket for the no-fault player while preserving FIFO age', async () => {
    mocks.query.mockImplementation(async (text: string) => {
      if (text.includes('SELECT') && text.includes('theme_table_versions')) {
        return { rows: [baseRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await recoverNoFaultThemeOpeningPlayers({
      reservationId: '61111111-1111-4111-8111-111111111111',
      roomGeneration: 'room-generation-1',
      faultUserIds: [baseRow.first_user_id],
      reason: 'PLAYER_ABANDONED_OPENING',
      now: NOW,
    });

    expect(result.handled).toBe(true);
    expect(result.requeued).toHaveLength(1);
    expect(result.requeued[0]).toMatchObject({
      userId: baseRow.second_user_id,
      previousTicketId: baseRow.second_ticket_id,
    });
    expect(result.requeued[0]?.ticketId).toMatch(/^[0-9a-f-]{36}$/);

    const insert = mocks.query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO public_table_tickets')
    );
    expect(insert?.[1]?.[4]).toBe(baseRow.second_source_deck_name);
    expect(insert?.[1]?.[5]).toEqual(JSON.stringify(baseRow.second_runtime_deck));
    expect(insert?.[1]?.[6]).toBe(baseRow.second_deck_content_hash);
    expect(insert?.[1]?.[7]).toBe(baseRow.second_point_table_version);
    expect(insert?.[1]?.[8]).toBe(baseRow.second_point_limit);
    expect(insert?.[1]?.[9]).toEqual(new Date(NOW));
    expect(insert?.[1]?.[10]).toEqual(baseRow.second_joined_at);
    expect(insert?.[1]?.[11]).toBe(baseRow.second_ticket_id);
    expect(String(insert?.[0])).toContain("'NO_FAULT_RECOVERY'");
    expect(String(insert?.[0])).toContain('$8, 0, $9');

    const participation = mocks.query.mock.calls.find(([text]) =>
      String(text).includes("SET kind = 'THEME_QUEUE'")
    );
    expect(participation?.[1]?.[0]).toBe(baseRow.second_user_id);
    expect(participation?.[1]?.[2]).toBe(baseRow.second_ticket_id);
    expect(mocks.query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not requeue either player after the event window has closed', async () => {
    mocks.query.mockImplementation(async (text: string) => {
      if (text.includes('SELECT') && text.includes('theme_table_versions')) {
        return {
          rows: [{ ...baseRow, theme_lifecycle: 'PAUSED' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await recoverNoFaultThemeOpeningPlayers({
      reservationId: '61111111-1111-4111-8111-111111111111',
      roomGeneration: 'room-generation-1',
      faultUserIds: [],
      reason: 'OPENING_TIMEOUT',
      now: NOW,
    });

    expect(result).toEqual({ handled: true, requeued: [] });
    expect(
      mocks.query.mock.calls.some(([text]) =>
        String(text).includes('INSERT INTO public_table_tickets')
      )
    ).toBe(false);
    expect(
      mocks.query.mock.calls.filter(([text]) => String(text).includes("SET state = 'CANCELED'"))
    ).toHaveLength(2);
  });

  it('leaves non-theme reservations to the existing room cleanup path', async () => {
    mocks.query.mockImplementation(async (text: string) => {
      if (text.includes('SELECT') && text.includes('theme_table_versions')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(
      recoverNoFaultThemeOpeningPlayers({
        reservationId: '61111111-1111-4111-8111-111111111111',
        roomGeneration: 'room-generation-1',
        faultUserIds: [],
        reason: 'OPENING_TIMEOUT',
        now: NOW,
      })
    ).resolves.toEqual({ handled: false, requeued: [] });
  });
});
