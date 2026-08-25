import { create } from 'zustand';
import { type DeckConfig, type CardEntry } from '@game/domain/card-data/deck-loader';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';
import * as yaml from 'yaml';
import { MAX_SAME_CODE_COUNT } from '../../../src/domain/rules/deck-validator';
import { validateDeckConfig } from '../../../src/domain/rules/deck-construction';
import { getBaseCardCode } from '@/lib/cardUtils';
import { apiClient, isApiConfigured, type DeckRecord } from '@/lib/apiClient';
import {
  createDeckRecordCardTypeResolver,
  deckConfigToRecordPayload,
  deckRecordToConfig,
} from '@/lib/deckRecordUtils';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import { createNewDeckConfig } from '@game/domain/card-data/deck-defaults';
import { LatestRequestGate } from '@/lib/asyncRequestControl';
import { getCurrentDeckPointTableRules, useDeckPointTableStore } from '@/store/deckPointTableStore';
import {
  createLocalDeckId,
  readLocalDecks,
  writeLocalDecks,
  type LocalDeck,
} from '@/lib/localDeckStorage';

const cloudDeckRequestGate = new LatestRequestGate();
export const CLOUD_DECK_FRESHNESS_MS = 30_000;

export type CloudDeckLoadState = 'IDLE' | 'LOADING' | 'READY' | 'REFRESHING' | 'ERROR';

interface CloudDeckInFlight {
  readonly ownerId: string;
  readonly promise: Promise<void>;
}

let cloudDeckInFlight: CloudDeckInFlight | null = null;

interface DeckState {
  player1Deck: DeckConfig | null;
  player2Deck: DeckConfig | null;
  activePlayer: 'player1' | 'player2';
  searchQuery: string;

  // 云端卡组列表
  cloudDecks: DeckRecord[];
  cloudDeckOwnerId: string | null;
  cloudDecksLoadedAt: number | null;
  cloudDeckLoadState: CloudDeckLoadState;
  cloudError: string | null;

  // 离线卡组列表（仅保存在当前浏览器）
  localDecks: LocalDeck[];
  localDecksInitialized: boolean;

  // Actions
  init: () => void;
  loadDeck: (player: 'player1' | 'player2', yamlContent: string, overrideName?: string) => void;
  setSearchQuery: (query: string) => void;
  setActivePlayer: (player: 'player1' | 'player2') => void;
  addCard: (card: AnyCardData) => void;
  removeCard: (card: AnyCardData) => void;
  resetDeck: () => void;

  // 云端卡组 Actions
  ensureCloudDecks: () => Promise<void>;
  refreshCloudDecks: () => Promise<void>;
  invalidateCloudDecks: (nextOwnerId?: string | null) => void;
  saveToCloud: (
    player: 'player1' | 'player2',
    name: string,
    description?: string
  ) => Promise<{ success: boolean; error?: string }>;
  loadFromCloud: (
    deckId: string,
    player: 'player1' | 'player2'
  ) => Promise<{ success: boolean; error?: string }>;
  deleteCloudDeck: (deckId: string) => Promise<{ success: boolean; error?: string }>;
  saveLocalDeck: (
    deck: DeckConfig,
    deckId?: string | null
  ) => { success: boolean; deck?: LocalDeck; error?: string };
  deleteLocalDeck: (deckId: string) => { success: boolean; error?: string };

  // Helpers
  getCurrentDeck: () => DeckConfig | null;
  getDeckYaml: (player: 'player1' | 'player2') => string;
  validateDeck: (deck: DeckConfig) => { valid: boolean; errors: string[] };
}

export const useDeckStore = create<DeckState>((set, get) => {
  const invalidateCloudDecks = (nextOwnerId: string | null = null): void => {
    cloudDeckRequestGate.invalidate();
    cloudDeckInFlight = null;
    set({
      cloudDecks: [],
      cloudDeckOwnerId: nextOwnerId,
      cloudDecksLoadedAt: null,
      cloudDeckLoadState: 'IDLE',
      cloudError: null,
    });
  };

  const loadCloudDecks = (forceRefresh: boolean): Promise<void> => {
    const ownerId = getCloudDeckOwnerId();
    if (!ownerId) {
      const state = get();
      if (
        state.cloudDeckOwnerId !== null ||
        state.cloudDecksLoadedAt !== null ||
        state.cloudDecks.length > 0
      ) {
        invalidateCloudDecks();
      }
      return Promise.resolve();
    }

    let state = get();
    if (state.cloudDeckOwnerId !== ownerId) {
      invalidateCloudDecks(ownerId);
      state = get();
    }

    if (cloudDeckInFlight?.ownerId === ownerId) {
      return cloudDeckInFlight.promise;
    }

    const hasSnapshot = state.cloudDecksLoadedAt !== null;
    const isFresh = hasSnapshot && Date.now() - state.cloudDecksLoadedAt! < CLOUD_DECK_FRESHNESS_MS;
    if (!forceRefresh && isFresh) {
      return Promise.resolve();
    }

    const requestGeneration = cloudDeckRequestGate.begin();
    set({
      cloudDeckLoadState: hasSnapshot ? 'REFRESHING' : 'LOADING',
      cloudError: null,
    });

    // Start both independent reads before awaiting either one. The PT store owns its
    // own freshness and resolves immediately when it has already initialized.
    const pointTablePromise = useDeckPointTableStore.getState().ensureLoaded();
    const deckRequestPromise = apiClient.get<DeckRecord[]>('/api/decks');
    const operation = (async () => {
      try {
        const [, result] = await Promise.all([pointTablePromise, deckRequestPromise]);
        if (
          !cloudDeckRequestGate.isCurrent(requestGeneration) ||
          getCloudDeckOwnerId() !== ownerId ||
          get().cloudDeckOwnerId !== ownerId
        ) {
          return;
        }

        if (result.error) {
          set({ cloudDeckLoadState: 'ERROR', cloudError: result.error.message });
          return;
        }

        set({
          cloudDecks: result.data ?? [],
          cloudDeckOwnerId: ownerId,
          cloudDecksLoadedAt: Date.now(),
          cloudDeckLoadState: 'READY',
          cloudError: null,
        });
      } catch (error) {
        if (
          !cloudDeckRequestGate.isCurrent(requestGeneration) ||
          getCloudDeckOwnerId() !== ownerId ||
          get().cloudDeckOwnerId !== ownerId
        ) {
          return;
        }
        set({
          cloudDeckLoadState: 'ERROR',
          cloudError: error instanceof Error ? error.message : '获取卡组失败',
        });
      } finally {
        if (
          cloudDeckRequestGate.isCurrent(requestGeneration) &&
          cloudDeckInFlight?.ownerId === ownerId
        ) {
          cloudDeckInFlight = null;
        }
      }
    })();

    cloudDeckInFlight = { ownerId, promise: operation };
    return operation;
  };

  return {
    player1Deck: null,
    player2Deck: null,
    activePlayer: 'player1',
    searchQuery: '',

    // 云端卡组状态
    cloudDecks: [],
    cloudDeckOwnerId: null,
    cloudDecksLoadedAt: null,
    cloudDeckLoadState: 'IDLE',
    cloudError: null,
    localDecks: [],
    localDecksInitialized: false,

    init: () => {
      // Initialize with empty decks if not already set
      const { player1Deck, player2Deck, localDecksInitialized } = get();
      if (!player1Deck) set({ player1Deck: createEmptyDeck('Player 1') });
      if (!player2Deck) set({ player2Deck: createEmptyDeck('Player 2') });
      if (!localDecksInitialized) {
        set({ localDecks: readLocalDecks(), localDecksInitialized: true });
      }
    },

    loadDeck: (player, yamlContent, overrideName) => {
      try {
        const deck = yaml.parse(yamlContent) as DeckConfig;
        // Ensure structure
        if (!deck.main_deck) deck.main_deck = { members: [], lives: [] };
        if (!deck.energy_deck) deck.energy_deck = [];

        if (overrideName) {
          deck.player_name = overrideName;
        }

        if (player === 'player1') {
          set({ player1Deck: deck });
        } else {
          set({ player2Deck: deck });
        }
      } catch (e) {
        console.error(`Failed to parse ${player} YAML`, e);
        // Optionally show error toast
      }
    },

    setSearchQuery: (query) => set({ searchQuery: query }),

    setActivePlayer: (player) => set({ activePlayer: player }),

    getCurrentDeck: () => {
      const { activePlayer, player1Deck, player2Deck } = get();
      return activePlayer === 'player1' ? player1Deck : player2Deck;
    },

    getDeckYaml: (player) => {
      const { player1Deck, player2Deck } = get();
      const deck = player === 'player1' ? player1Deck : player2Deck;
      if (!deck) return '';
      return yaml.stringify(deck);
    },

    addCard: (card) => {
      const { activePlayer, player1Deck, player2Deck } = get();
      const currentDeck = activePlayer === 'player1' ? player1Deck : player2Deck;

      if (!currentDeck) return;

      const newDeck = JSON.parse(JSON.stringify(currentDeck)) as DeckConfig;

      // Determine where to add
      let targetList: CardEntry[];
      if (card.cardType === CardType.MEMBER) {
        targetList = newDeck.main_deck.members;
      } else if (card.cardType === CardType.LIVE) {
        targetList = newDeck.main_deck.lives;
      } else {
        targetList = newDeck.energy_deck;
      }
      const count = targetList.reduce((sum, e) => sum + e.count, 0);
      if (card.cardType === CardType.MEMBER && count >= 48) {
        // Cannot add more member cards
        return;
      }
      if (card.cardType === CardType.LIVE && count >= 12) {
        // Cannot add more live cards
        return;
      }
      if (card.cardType === CardType.ENERGY && count >= 12) {
        // Cannot add more energy cards
        return;
      }

      // 同基础编号限制检查（不同稀有度视为同一张卡，合计最多 4 张）
      if (card.cardType !== CardType.ENERGY) {
        const baseCode = getBaseCardCode(card.cardCode);
        const allMainEntries = [...newDeck.main_deck.members, ...newDeck.main_deck.lives];
        const baseTotal = allMainEntries
          .filter((e) => getBaseCardCode(e.card_code) === baseCode)
          .reduce((sum, e) => sum + e.count, 0);
        if (baseTotal >= MAX_SAME_CODE_COUNT) return;
      }

      // Check if exists
      const existing = targetList.find((e) => e.card_code === card.cardCode);
      if (existing) {
        existing.count++;
      } else {
        targetList.push({ card_code: card.cardCode, count: 1 });
      }

      if (activePlayer === 'player1') {
        set({ player1Deck: newDeck });
      } else {
        set({ player2Deck: newDeck });
      }
    },

    removeCard: (card) => {
      const { activePlayer, player1Deck, player2Deck } = get();
      const currentDeck = activePlayer === 'player1' ? player1Deck : player2Deck;

      if (!currentDeck) return;

      const newDeck = JSON.parse(JSON.stringify(currentDeck)) as DeckConfig;

      // Determine where to remove from
      let targetList: CardEntry[];
      if (card.cardType === CardType.MEMBER) {
        targetList = newDeck.main_deck.members;
      } else if (card.cardType === CardType.LIVE) {
        targetList = newDeck.main_deck.lives;
      } else {
        targetList = newDeck.energy_deck;
      }

      const index = targetList.findIndex((e) => e.card_code === card.cardCode);
      if (index !== -1) {
        if (targetList[index].count > 1) {
          targetList[index].count--;
        } else {
          targetList.splice(index, 1);
        }
      }

      if (activePlayer === 'player1') {
        set({ player1Deck: newDeck });
      } else {
        set({ player2Deck: newDeck });
      }
    },

    resetDeck: () => {
      // TODO: Implement reset to initial state
    },

    validateDeck: (deck) => {
      const validation = validateDeckConfig(deck, getCurrentDeckPointTableRules());
      return { valid: validation.valid, errors: validation.errors };
    },

    // 云端卡组方法
    ensureCloudDecks: () => loadCloudDecks(false),
    refreshCloudDecks: () => loadCloudDecks(true),
    invalidateCloudDecks,

    saveToCloud: async (player, name, description) => {
      if (useAuthStore.getState().offlineMode) {
        return { success: false, error: '离线模式下无法保存云端卡组' };
      }

      if (!isApiConfigured) {
        return { success: false, error: '服务器未配置' };
      }

      const { player1Deck, player2Deck } = get();
      const deck = player === 'player1' ? player1Deck : player2Deck;

      if (!deck) {
        return { success: false, error: '卡组为空' };
      }

      try {
        const deckPayload = deckConfigToRecordPayload(deck);

        const result = await apiClient.post<DeckRecord>('/api/decks', {
          name,
          description: description || deck.description,
          main_deck: deckPayload.main_deck,
          energy_deck: deckPayload.energy_deck,
        });

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        await get().refreshCloudDecks();

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : '保存失败' };
      }
    },

    loadFromCloud: async (deckId, player) => {
      if (useAuthStore.getState().offlineMode) {
        return { success: false, error: '离线模式下无法加载云端卡组' };
      }

      if (!isApiConfigured) {
        return { success: false, error: '服务器未配置' };
      }

      try {
        const result = await apiClient.get<DeckRecord>(`/api/decks/${deckId}`);

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        const deckRecord = result.data!;

        const localDeck = deckRecordToConfig(deckRecord, {
          resolveCardType: createDeckRecordCardTypeResolver(
            useGameStore.getState().cardDataRegistry
          ),
        });

        if (player === 'player1') {
          set({ player1Deck: localDeck });
        } else {
          set({ player2Deck: localDeck });
        }

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : '加载失败' };
      }
    },

    deleteCloudDeck: async (deckId) => {
      if (useAuthStore.getState().offlineMode) {
        return { success: false, error: '离线模式下无法删除云端卡组' };
      }

      if (!isApiConfigured) {
        return { success: false, error: '服务器未配置' };
      }

      try {
        const result = await apiClient.delete(`/api/decks/${deckId}`);

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        set((state) => ({
          cloudDecks: state.cloudDecks.filter((d) => d.id !== deckId),
        }));

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : '删除失败' };
      }
    },

    saveLocalDeck: (deck, deckId = null) => {
      const now = new Date();
      const nextDeck: LocalDeck = {
        id: deckId ?? createLocalDeckId(),
        name: deck.player_name,
        description: deck.description,
        config: structuredClone(deck),
        updatedAt: now,
      };
      const currentDecks = get().localDecks;
      const existingIndex = currentDecks.findIndex((candidate) => candidate.id === deckId);
      const nextDecks =
        existingIndex === -1
          ? [nextDeck, ...currentDecks]
          : currentDecks.map((candidate, index) =>
              index === existingIndex ? nextDeck : candidate
            );

      try {
        writeLocalDecks(nextDecks);
        set({ localDecks: nextDecks, localDecksInitialized: true });
        return { success: true, deck: nextDeck };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '保存本地卡组失败',
        };
      }
    },

    deleteLocalDeck: (deckId) => {
      const currentDecks = get().localDecks;
      if (!currentDecks.some((deck) => deck.id === deckId)) {
        return { success: false, error: '未找到本地卡组' };
      }

      const nextDecks = currentDecks.filter((deck) => deck.id !== deckId);
      try {
        writeLocalDecks(nextDecks);
        set({ localDecks: nextDecks, localDecksInitialized: true });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '删除本地卡组失败',
        };
      }
    },
  };
});

// Existing deck screens memoize projections by the cloud deck array. Re-publish that
// immutable array when the active PT rules change so already-open screens recalculate.
useDeckPointTableStore.subscribe((state, previousState) => {
  if (state.rules === previousState.rules || useDeckStore.getState().cloudDecks.length === 0) {
    return;
  }
  useDeckStore.setState((state) => ({ cloudDecks: [...state.cloudDecks] }));
});

declare global {
  interface Window {
    __DECK_STORE__?: typeof useDeckStore;
  }
}

// 开发/测试模式下暴露 store 以便 E2E 测试可以注入数据
if (typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.MODE === 'test')) {
  window.__DECK_STORE__ = useDeckStore;
}

function getCloudDeckOwnerId(): string | null {
  const authState = useAuthStore.getState();
  return authState.offlineMode ? null : (authState.user?.id ?? null);
}

let observedCloudDeckOwnerId = getCloudDeckOwnerId();
useAuthStore.subscribe((state) => {
  const nextOwnerId = state.offlineMode ? null : (state.user?.id ?? null);
  if (nextOwnerId === observedCloudDeckOwnerId) return;
  observedCloudDeckOwnerId = nextOwnerId;
  useDeckStore.getState().invalidateCloudDecks(nextOwnerId);
});

function createEmptyDeck(playerName: string): DeckConfig {
  return createNewDeckConfig(playerName, 'New Deck');
}
