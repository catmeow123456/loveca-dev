import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/apiClient';
import type { DeckRecord } from '@/lib/apiClient';
import { buildHomeDeckProjection } from '@/lib/homeDeckProjection';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';
import {
  deckPointTableViewToRules,
  getNextBuiltInDeckPointTableEffectiveAt,
  resolveBuiltInDeckPointTableRules,
  type CurrentDeckPointTableView,
} from '@/lib/deckPointTableClient';
import {
  DECK_POINT_TABLE_REFRESH_INTERVAL_MS,
  startDeckPointTableAutoRefresh,
  useDeckPointTableStore,
} from '@/store/deckPointTableStore';

function createCurrentView(
  overrides: Partial<CurrentDeckPointTableView> = {}
): CurrentDeckPointTableView {
  return {
    version: 'server-v1',
    displayName: '服务端当前表',
    pointLimit: 9,
    effectiveFrom: '2026-08-07T16:00:00.000Z',
    platformTimeZone: 'Asia/Shanghai',
    entries: [{ baseCardCode: 'PL!N-pb1-011', points: 2 }],
    ...overrides,
  };
}

function createPointSensitiveDeck(): {
  deck: DeckRecord;
  cardDataRegistry: ReadonlyMap<string, AnyCardData>;
} {
  const memberEntries: DeckRecord['main_deck'] = [
    { card_code: 'LL-bp2-001-R+', count: 2, card_type: 'MEMBER' },
    ...Array.from({ length: 12 }, (_, index) => ({
      card_code: `PL!N-bp9-${String(index + 1).padStart(3, '0')}-N`,
      count: index < 11 ? 4 : 2,
      card_type: 'MEMBER' as const,
    })),
  ];
  const liveEntries: DeckRecord['main_deck'] = Array.from({ length: 3 }, (_, index) => ({
    card_code: `PL!-bp9-${String(index + 1).padStart(3, '0')}-L`,
    count: 4,
    card_type: 'LIVE' as const,
  }));
  const energyDeck = [{ card_code: 'LL-E-001-SD', count: 12 }];
  const cardDataRegistry = new Map<string, AnyCardData>();
  for (const entry of memberEntries) {
    cardDataRegistry.set(entry.card_code, {
      cardCode: entry.card_code,
      cardType: CardType.MEMBER,
    } as AnyCardData);
  }
  for (const entry of liveEntries) {
    cardDataRegistry.set(entry.card_code, {
      cardCode: entry.card_code,
      cardType: CardType.LIVE,
    } as AnyCardData);
  }
  cardDataRegistry.set('LL-E-001-SD', {
    cardCode: 'LL-E-001-SD',
    cardType: CardType.ENERGY,
  } as AnyCardData);

  return {
    deck: {
      id: 'point-sensitive-deck',
      user_id: 'user-1',
      name: 'PT切换测试',
      description: null,
      main_deck: [...memberEntries, ...liveEntries],
      energy_deck: energyDeck,
      is_valid: true,
      validation_errors: [],
      validated_point_table_version: '2026-04-03',
      point_total: 6,
      point_limit: 9,
      is_public: false,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    },
    cardDataRegistry,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('deck point table client fallback', () => {
  it('recomputes the home projection when the active rules change', () => {
    const { deck, cardDataRegistry } = createPointSensitiveDeck();
    const oldRules = resolveBuiltInDeckPointTableRules(new Date('2026-08-07T15:59:59.999Z'));
    const newRules = resolveBuiltInDeckPointTableRules(new Date('2026-08-07T16:00:00.000Z'));

    const before = buildHomeDeckProjection({
      cloudDecks: [deck],
      cardDataRegistry,
      pointTable: oldRules,
    });
    const after = buildHomeDeckProjection({
      cloudDecks: [deck],
      cardDataRegistry,
      pointTable: newRules,
    });

    expect(before.deckItems[0]).toMatchObject({ pointTotal: 6, isValid: true });
    expect(before.validCloudDecks).toEqual([deck]);
    expect(before.validDeckItems).toHaveLength(1);
    expect(after.deckItems[0]).toMatchObject({ pointTotal: 10, isValid: false });
    expect(after.validCloudDecks).toEqual([]);
    expect(after.validDeckItems).toEqual([]);
  });

  it('switches the confirmed built-in snapshots at Beijing midnight on 2026-08-08', () => {
    const before = resolveBuiltInDeckPointTableRules(new Date('2026-08-07T15:59:59.999Z'));
    const after = resolveBuiltInDeckPointTableRules(new Date('2026-08-07T16:00:00.000Z'));

    expect(before.version).toBe('2026-04-03');
    expect(before.entries['LL-bp2-001']).toBe(3);
    expect(before.entries['PL!SP-bp2-024']).toBe(1);
    expect(before.entries['PL!N-pb1-011']).toBeUndefined();

    expect(after.version).toBe('2026-08-08');
    expect(after.entries['LL-bp2-001']).toBe(5);
    expect(after.entries['PL!SP-bp2-024']).toBeUndefined();
    expect(after.entries['PL!N-pb1-011']).toBe(2);
    expect(after.entries['PL!N-bp1-011']).toBeUndefined();
    expect(
      getNextBuiltInDeckPointTableEffectiveAt(new Date('2026-08-07T15:59:59.999Z'))?.toISOString()
    ).toBe('2026-08-07T16:00:00.000Z');
    expect(
      getNextBuiltInDeckPointTableEffectiveAt(new Date('2026-08-07T16:00:00.000Z'))
    ).toBeNull();
  });

  it('accepts the real minimal public response and converts it into immutable rules', () => {
    const rules = deckPointTableViewToRules(createCurrentView());

    expect(rules).toEqual({
      version: 'server-v1',
      pointLimit: 9,
      effectiveFrom: '2026-08-07T16:00:00.000Z',
      entries: { 'PL!N-pb1-011': 2 },
    });
    expect(Object.isFrozen(rules)).toBe(true);
    expect(Object.isFrozen(rules.entries)).toBe(true);
    expect(() =>
      deckPointTableViewToRules(
        createCurrentView({
          entries: [
            { baseCardCode: 'PL!N-pb1-011', points: 2 },
            { baseCardCode: 'PL!N-pb1-011', points: 3 },
          ],
        })
      )
    ).toThrow('重复');
  });
});

describe('deck point table store', () => {
  it('replaces the display fallback with the public server rules', async () => {
    const fallback = resolveBuiltInDeckPointTableRules();
    useDeckPointTableStore.setState({
      rules: fallback,
      source: 'BUILT_IN',
      initialized: false,
      loading: false,
      error: null,
    });
    const getSpy = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: createCurrentView(), error: null });

    await useDeckPointTableStore.getState().ensureLoaded();

    expect(getSpy).toHaveBeenCalledWith('/api/deck-point-tables/current');
    expect(useDeckPointTableStore.getState()).toMatchObject({
      source: 'SERVER',
      initialized: true,
      loading: false,
      error: null,
      rules: {
        version: 'server-v1',
        entries: { 'PL!N-pb1-011': 2 },
      },
    });
  });

  it('keeps the confirmed built-in snapshot when the startup API is unavailable', async () => {
    const fallback = resolveBuiltInDeckPointTableRules();
    useDeckPointTableStore.setState({
      rules: fallback,
      source: 'BUILT_IN',
      initialized: false,
      loading: false,
      error: null,
    });
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: null,
      error: { code: 'NETWORK_ERROR', message: '无法连接服务器' },
    });

    await useDeckPointTableStore.getState().ensureLoaded();

    expect(useDeckPointTableStore.getState()).toMatchObject({
      rules: fallback,
      source: 'BUILT_IN',
      initialized: true,
      loading: false,
      error: '无法连接服务器',
    });
  });

  it('keeps the last server rules when a later refresh fails transiently', async () => {
    const fallback = resolveBuiltInDeckPointTableRules();
    useDeckPointTableStore.setState({
      rules: fallback,
      source: 'BUILT_IN',
      initialized: false,
      loading: false,
      error: null,
    });
    vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: createCurrentView(), error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'NETWORK_ERROR', message: '暂时无法连接服务器' },
      });

    await useDeckPointTableStore.getState().refresh();
    const serverRules = useDeckPointTableStore.getState().rules;
    await useDeckPointTableStore.getState().refresh();

    expect(useDeckPointTableStore.getState()).toMatchObject({
      rules: serverRules,
      source: 'SERVER',
      initialized: true,
      loading: false,
      error: '暂时无法连接服务器',
    });
  });

  it('refreshes a long-lived visible page on focus, visibility and a low-frequency timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));

    const browserWindow = new EventTarget() as EventTarget & {
      setInterval: typeof globalThis.setInterval;
      clearInterval: typeof globalThis.clearInterval;
      setTimeout: typeof globalThis.setTimeout;
      clearTimeout: typeof globalThis.clearTimeout;
    };
    browserWindow.setInterval = globalThis.setInterval.bind(globalThis);
    browserWindow.clearInterval = globalThis.clearInterval.bind(globalThis);
    browserWindow.setTimeout = globalThis.setTimeout.bind(globalThis);
    browserWindow.clearTimeout = globalThis.clearTimeout.bind(globalThis);

    let visibilityState: DocumentVisibilityState = 'hidden';
    const browserDocument = new EventTarget();
    Object.defineProperty(browserDocument, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', browserDocument);

    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startDeckPointTableAutoRefresh(refresh);

    browserWindow.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DECK_POINT_TABLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    visibilityState = 'visible';
    browserDocument.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DECK_POINT_TABLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(3);

    stop();
    browserWindow.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(DECK_POINT_TABLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
