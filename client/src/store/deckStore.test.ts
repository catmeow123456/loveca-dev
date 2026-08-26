import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type AuthState = {
    offlineMode: boolean;
    user: { id: string } | null;
  };
  type AuthListener = (state: AuthState) => void;

  let authState: AuthState = { offlineMode: false, user: null };
  const authListeners = new Set<AuthListener>();
  const authStore = Object.assign(() => undefined, {
    getState: () => authState,
    setState: (partial: Partial<AuthState>) => {
      authState = { ...authState, ...partial };
      for (const listener of authListeners) listener(authState);
    },
    subscribe: (listener: AuthListener) => {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
  });

  const pointTableState = {
    ensureLoaded: vi.fn<() => Promise<void>>(async () => undefined),
    refresh: vi.fn<() => Promise<void>>(async () => undefined),
    rules: {},
  };
  const pointTableStore = Object.assign(() => undefined, {
    getState: () => pointTableState,
    subscribe: vi.fn(() => () => undefined),
  });

  return {
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiDelete: vi.fn(),
    markAppBackgroundRefreshComplete: vi.fn(),
    markAppDataReady: vi.fn(),
    markAppDataRequestStart: vi.fn(),
    authStore,
    pointTableState,
    pointTableStore,
  };
});

vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    delete: mocks.apiDelete,
  },
  isApiConfigured: true,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: mocks.authStore,
}));

vi.mock('@/store/gameStore', () => ({
  useGameStore: {
    getState: () => ({ cardDataRegistry: new Map() }),
  },
}));

vi.mock('@/store/deckPointTableStore', () => ({
  getCurrentDeckPointTableRules: () => mocks.pointTableState.rules,
  useDeckPointTableStore: mocks.pointTableStore,
}));

vi.mock('@/lib/localDeckStorage', () => ({
  createLocalDeckId: () => 'local-deck',
  readLocalDecks: () => [],
  writeLocalDecks: () => undefined,
}));

vi.mock('@/lib/appPerformance', () => ({
  markAppBackgroundRefreshComplete: mocks.markAppBackgroundRefreshComplete,
  markAppDataReady: mocks.markAppDataReady,
  markAppDataRequestStart: mocks.markAppDataRequestStart,
}));

import { CLOUD_DECK_FRESHNESS_MS, useDeckStore } from './deckStore';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function deck(id: string, ownerId: string) {
  return {
    id,
    user_id: ownerId,
    name: id,
    description: null,
    main_deck: [],
    energy_deck: [],
    is_valid: true,
    validation_errors: [],
    validated_point_table_version: 'test',
    is_public: false,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
  };
}

function setAuthenticatedOwner(ownerId: string | null): void {
  mocks.authStore.setState({
    offlineMode: false,
    user: ownerId ? { id: ownerId } : null,
  });
}

describe('deckStore cloud deck cache', () => {
  beforeEach(() => {
    setAuthenticatedOwner(null);
    useDeckStore.getState().invalidateCloudDecks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.apiDelete.mockReset();
    mocks.markAppBackgroundRefreshComplete.mockReset();
    mocks.markAppDataReady.mockReset();
    mocks.markAppDataRequestStart.mockReset();
    mocks.pointTableState.ensureLoaded.mockReset();
    mocks.pointTableState.ensureLoaded.mockResolvedValue(undefined);
    mocks.pointTableState.refresh.mockReset();
    mocks.pointTableState.refresh.mockResolvedValue(undefined);
    setAuthenticatedOwner('user-a');
  });

  it('starts the first PT and deck reads in parallel and publishes only after both finish', async () => {
    const pointTable = deferred<void>();
    const decks = deferred<{
      data: ReturnType<typeof deck>[];
      error: null;
    }>();
    mocks.pointTableState.ensureLoaded.mockReturnValueOnce(pointTable.promise);
    mocks.apiGet.mockReturnValueOnce(decks.promise);

    const request = useDeckStore.getState().ensureCloudDecks();

    expect(mocks.pointTableState.ensureLoaded).toHaveBeenCalledOnce();
    expect(mocks.apiGet).toHaveBeenCalledWith('/api/decks');
    expect(useDeckStore.getState().cloudDeckLoadState).toBe('LOADING');

    decks.resolve({ data: [deck('deck-a', 'user-a')], error: null });
    await Promise.resolve();
    expect(useDeckStore.getState().cloudDeckLoadState).toBe('LOADING');

    pointTable.resolve(undefined);
    await request;
    expect(useDeckStore.getState()).toMatchObject({
      cloudDeckLoadState: 'READY',
      cloudDeckOwnerId: 'user-a',
      cloudDecks: [expect.objectContaining({ id: 'deck-a' })],
    });
    expect(mocks.pointTableState.refresh).not.toHaveBeenCalled();
    expect(mocks.markAppDataRequestStart).toHaveBeenCalledWith('cloud-decks', 'cold', {
      forced: false,
    });
    expect(mocks.markAppDataReady).toHaveBeenCalledWith('cloud-decks', 'cold', { count: 1 });
  });

  it('reuses one in-flight request for the same owner', async () => {
    const decks = deferred<{ data: ReturnType<typeof deck>[]; error: null }>();
    mocks.apiGet.mockReturnValueOnce(decks.promise);

    const first = useDeckStore.getState().ensureCloudDecks();
    const second = useDeckStore.getState().ensureCloudDecks();

    expect(second).toBe(first);
    expect(mocks.apiGet).toHaveBeenCalledOnce();

    decks.resolve({ data: [], error: null });
    await first;
  });

  it('treats a successful empty response as a fresh snapshot', async () => {
    useDeckStore.setState({
      cloudDecks: [],
      cloudDeckOwnerId: 'user-a',
      cloudDecksLoadedAt: Date.now(),
      cloudDeckLoadState: 'READY',
      cloudError: null,
    });

    await useDeckStore.getState().ensureCloudDecks();

    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(useDeckStore.getState().cloudDeckLoadState).toBe('READY');
  });

  it('keeps stale decks visible when a background refresh fails', async () => {
    const existingDeck = deck('cached-deck', 'user-a');
    useDeckStore.setState({
      cloudDecks: [existingDeck],
      cloudDeckOwnerId: 'user-a',
      cloudDecksLoadedAt: Date.now() - CLOUD_DECK_FRESHNESS_MS - 1,
      cloudDeckLoadState: 'READY',
      cloudError: null,
    });
    const decks = deferred<{
      data: null;
      error: { code: string; message: string };
    }>();
    mocks.apiGet.mockReturnValueOnce(decks.promise);

    const request = useDeckStore.getState().ensureCloudDecks();
    expect(useDeckStore.getState()).toMatchObject({
      cloudDeckLoadState: 'REFRESHING',
      cloudDecks: [existingDeck],
    });

    decks.resolve({ data: null, error: { code: 'NETWORK_ERROR', message: '读取失败' } });
    await request;

    expect(useDeckStore.getState()).toMatchObject({
      cloudDeckLoadState: 'ERROR',
      cloudError: '读取失败',
      cloudDecks: [existingDeck],
    });
    expect(mocks.markAppBackgroundRefreshComplete).toHaveBeenCalledWith('cloud-decks', 'error');
  });

  it('keeps a cold failure distinct from a successful empty snapshot', async () => {
    mocks.apiGet.mockResolvedValueOnce({
      data: null,
      error: { code: 'NETWORK_ERROR', message: '首次读取失败' },
    });

    await useDeckStore.getState().ensureCloudDecks();

    expect(useDeckStore.getState()).toMatchObject({
      cloudDeckLoadState: 'ERROR',
      cloudDecksLoadedAt: null,
      cloudDecks: [],
      cloudError: '首次读取失败',
    });
  });

  it('lets manual refresh bypass freshness while still merging concurrent refreshes', async () => {
    useDeckStore.setState({
      cloudDecks: [],
      cloudDeckOwnerId: 'user-a',
      cloudDecksLoadedAt: Date.now(),
      cloudDeckLoadState: 'READY',
      cloudError: null,
    });
    const decks = deferred<{ data: ReturnType<typeof deck>[]; error: null }>();
    mocks.apiGet.mockReturnValueOnce(decks.promise);

    const first = useDeckStore.getState().refreshCloudDecks();
    const second = useDeckStore.getState().refreshCloudDecks();

    expect(first).toBe(second);
    expect(mocks.apiGet).toHaveBeenCalledOnce();
    expect(useDeckStore.getState().cloudDeckLoadState).toBe('REFRESHING');

    decks.resolve({ data: [], error: null });
    await first;
    expect(mocks.markAppBackgroundRefreshComplete).toHaveBeenCalledWith('cloud-decks', 'success', {
      count: 0,
    });
  });

  it('rejects an old owner response after switching users', async () => {
    const userADecks = deferred<{ data: ReturnType<typeof deck>[]; error: null }>();
    const userBDecks = deferred<{ data: ReturnType<typeof deck>[]; error: null }>();
    mocks.apiGet.mockReturnValueOnce(userADecks.promise).mockReturnValueOnce(userBDecks.promise);

    const userARequest = useDeckStore.getState().ensureCloudDecks();
    setAuthenticatedOwner('user-b');
    const userBRequest = useDeckStore.getState().ensureCloudDecks();

    userADecks.resolve({ data: [deck('deck-a', 'user-a')], error: null });
    await userARequest;
    expect(useDeckStore.getState()).toMatchObject({
      cloudDeckOwnerId: 'user-b',
      cloudDecks: [],
      cloudDeckLoadState: 'LOADING',
    });

    userBDecks.resolve({ data: [deck('deck-b', 'user-b')], error: null });
    await userBRequest;
    expect(useDeckStore.getState()).toMatchObject({
      cloudDeckOwnerId: 'user-b',
      cloudDecks: [expect.objectContaining({ id: 'deck-b' })],
      cloudDeckLoadState: 'READY',
    });
  });

  it('clears online decks immediately when entering offline mode', () => {
    useDeckStore.setState({
      cloudDecks: [deck('deck-a', 'user-a')],
      cloudDeckOwnerId: 'user-a',
      cloudDecksLoadedAt: Date.now(),
      cloudDeckLoadState: 'READY',
    });

    mocks.authStore.setState({ offlineMode: true, user: null });

    expect(useDeckStore.getState()).toMatchObject({
      cloudDecks: [],
      cloudDeckOwnerId: null,
      cloudDecksLoadedAt: null,
      cloudDeckLoadState: 'IDLE',
    });
  });

  it('keeps the cache when the auth session refreshes for the same owner', () => {
    const cachedDeck = deck('deck-a', 'user-a');
    useDeckStore.setState({
      cloudDecks: [cachedDeck],
      cloudDeckOwnerId: 'user-a',
      cloudDecksLoadedAt: Date.now(),
      cloudDeckLoadState: 'READY',
    });

    mocks.authStore.setState({ user: { id: 'user-a' } });

    expect(useDeckStore.getState()).toMatchObject({
      cloudDecks: [cachedDeck],
      cloudDeckOwnerId: 'user-a',
      cloudDeckLoadState: 'READY',
    });
  });
});
