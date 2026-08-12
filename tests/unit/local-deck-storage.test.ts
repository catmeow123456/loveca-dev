import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewDeckConfig } from '../../src/domain/card-data/deck-defaults';
import {
  LOCAL_DECK_STORAGE_KEY,
  readLocalDecks,
  writeLocalDecks,
  type LocalDeckStorage,
} from '../../client/src/lib/localDeckStorage';

class MemoryStorage implements LocalDeckStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('offline local deck storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips versioned local decks without losing their deck config or timestamp', () => {
    const storage = new MemoryStorage();
    const config = createNewDeckConfig('离线测试卡组', '只保存在当前浏览器');
    const updatedAt = new Date('2026-08-12T08:00:00.000Z');

    writeLocalDecks(
      [
        {
          id: 'local-deck-1',
          name: config.player_name,
          description: config.description,
          config,
          updatedAt,
        },
      ],
      storage
    );

    expect(readLocalDecks(storage)).toEqual([
      {
        id: 'local-deck-1',
        name: '离线测试卡组',
        description: '只保存在当前浏览器',
        config,
        updatedAt,
      },
    ]);
  });

  it('rejects unversioned or malformed browser data instead of publishing partial decks', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCAL_DECK_STORAGE_KEY, JSON.stringify([{ id: 'legacy-deck' }]));

    expect(readLocalDecks(storage)).toEqual([]);

    storage.setItem(
      LOCAL_DECK_STORAGE_KEY,
      JSON.stringify({ version: 1, decks: [{ id: 'broken-deck' }] })
    );
    expect(readLocalDecks(storage)).toEqual([]);
  });

  it('returns an empty list when browser storage is unavailable or unreadable', () => {
    expect(readLocalDecks(null)).toEqual([]);

    const storage: LocalDeckStorage = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => undefined,
    };
    expect(readLocalDecks(storage)).toEqual([]);
  });

  it('handles browsers that block access to the localStorage property', () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, 'localStorage', {
      get: () => {
        throw new Error('storage blocked');
      },
    });
    vi.stubGlobal('window', blockedWindow);

    expect(readLocalDecks()).toEqual([]);
    expect(() => writeLocalDecks([])).toThrow('当前环境不支持浏览器本地存储');
  });
});
