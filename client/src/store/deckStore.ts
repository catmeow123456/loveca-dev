import { create } from 'zustand';
import {
  type DeckConfig,
  type CardEntry
} from '@game/domain/card-data/deck-loader';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';
import * as yaml from 'yaml';
import { MAX_SAME_CODE_COUNT } from '../../../src/domain/rules/deck-validator';
import { getBaseCardCode } from '@/lib/cardUtils';
import { apiClient, isApiConfigured, type DeckRecord } from '@/lib/apiClient';

interface DeckState {
  player1Deck: DeckConfig | null;
  player2Deck: DeckConfig | null;
  activePlayer: 'player1' | 'player2';
  searchQuery: string;
  
  // 云端卡组列表
  cloudDecks: DeckRecord[];
  isLoadingCloud: boolean;
  cloudError: string | null;
  
  // Actions
  init: () => void;
  loadDeck: (player: 'player1' | 'player2', yamlContent: string, overrideName?: string) => void;
  setSearchQuery: (query: string) => void;
  setActivePlayer: (player: 'player1' | 'player2') => void;
  addCard: (card: AnyCardData) => void;
  removeCard: (card: AnyCardData) => void;
  resetDeck: () => void;
  
  // 云端卡组 Actions
  fetchCloudDecks: () => Promise<void>;
  saveToCloud: (player: 'player1' | 'player2', name: string, description?: string) => Promise<{ success: boolean; error?: string }>;
  loadFromCloud: (deckId: string, player: 'player1' | 'player2') => Promise<{ success: boolean; error?: string }>;
  deleteCloudDeck: (deckId: string) => Promise<{ success: boolean; error?: string }>;
  
  // Helpers
  getCurrentDeck: () => DeckConfig | null;
  getDeckYaml: (player: 'player1' | 'player2') => string;
  validateDeck: (deck: DeckConfig) => { valid: boolean; errors: string[] };
}

export const useDeckStore = create<DeckState>((set, get) => {
  return {
    player1Deck: null,
    player2Deck: null,
    activePlayer: 'player1',
    searchQuery: '',
    
    // 云端卡组状态
    cloudDecks: [],
    isLoadingCloud: false,
    cloudError: null,

    init: () => {
      // Initialize with empty decks if not already set
      const { player1Deck, player2Deck } = get();
      if (!player1Deck) set({ player1Deck: createEmptyDeck("Player 1") });
      if (!player2Deck) set({ player2Deck: createEmptyDeck("Player 2") });
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
          .filter(e => getBaseCardCode(e.card_code) === baseCode)
          .reduce((sum, e) => sum + e.count, 0);
        if (baseTotal >= MAX_SAME_CODE_COUNT) return;
      }

      // Check if exists
      const existing = targetList.find(e => e.card_code === card.cardCode);
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

      const index = targetList.findIndex(e => e.card_code === card.cardCode);
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
      const errors: string[] = [];
      
      const memberCount = deck.main_deck.members.reduce((sum, e) => sum + e.count, 0);
      const liveCount = deck.main_deck.lives.reduce((sum, e) => sum + e.count, 0);
      const energyCount = deck.energy_deck.reduce((sum, e) => sum + e.count, 0);

      if (memberCount !== 48) errors.push(`成员卡必须为 48 张 (当前 ${memberCount})`);
      if (liveCount !== 12) errors.push(`Live 卡必须为 12 张 (当前 ${liveCount})`);
      if (energyCount !== 12) errors.push(`能量卡必须为 12 张 (当前 ${energyCount})`);

      return { valid: errors.length === 0, errors };
    },

    // 云端卡组方法
    fetchCloudDecks: async () => {
      if (!isApiConfigured) {
        set({ cloudError: '服务器未配置' });
        return;
      }

      set({ isLoadingCloud: true, cloudError: null });

      try {
        const result = await apiClient.get<DeckRecord[]>('/api/decks');

        if (result.error) {
          set({ isLoadingCloud: false, cloudError: result.error.message });
          return;
        }

        set({ cloudDecks: result.data ?? [], isLoadingCloud: false });
      } catch (err) {
        set({
          isLoadingCloud: false,
          cloudError: err instanceof Error ? err.message : '获取卡组失败'
        });
      }
    },

    saveToCloud: async (player, name, description) => {
      if (!isApiConfigured) {
        return { success: false, error: '服务器未配置' };
      }

      const { player1Deck, player2Deck, validateDeck } = get();
      const deck = player === 'player1' ? player1Deck : player2Deck;

      if (!deck) {
        return { success: false, error: '卡组为空' };
      }

      const validation = validateDeck(deck);

      try {
        const mainDeck = [
          ...deck.main_deck.members.map(e => ({ card_code: e.card_code, count: e.count, card_type: 'MEMBER' as const })),
          ...deck.main_deck.lives.map(e => ({ card_code: e.card_code, count: e.count, card_type: 'LIVE' as const }))
        ];
        const energyDeck = deck.energy_deck.map(e => ({ card_code: e.card_code, count: e.count }));

        const result = await apiClient.post<DeckRecord>('/api/decks', {
          name,
          description: description || deck.description,
          main_deck: mainDeck,
          energy_deck: energyDeck,
          is_valid: validation.valid,
          validation_errors: validation.errors,
        });

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        await get().fetchCloudDecks();

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : '保存失败' };
      }
    },

    loadFromCloud: async (deckId, player) => {
      if (!isApiConfigured) {
        return { success: false, error: '服务器未配置' };
      }

      try {
        const result = await apiClient.get<DeckRecord>(`/api/decks/${deckId}`);

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        const deckRecord = result.data!;
        
        // 转换为本地格式
        const mainDeck = deckRecord.main_deck || [];
        const members: CardEntry[] = [];
        const lives: CardEntry[] = [];
        
        for (const entry of mainDeck) {
          // 优先使用 card_type 字段判断卡牌类型（新格式）
          // 如果没有 card_type 字段，则使用卡号前缀判断（向后兼容旧数据）
          const cardType = (entry as { card_type?: string }).card_type;
          
          if (cardType === 'LIVE') {
            lives.push({ card_code: entry.card_code, count: entry.count });
          } else if (cardType === 'MEMBER') {
            members.push({ card_code: entry.card_code, count: entry.count });
          } else {
            // 向后兼容：旧数据没有 card_type，使用卡号前缀判断
            // Live 卡以 PL 开头（包括 PL!-、PL-、PLHS- 等）
            // 成员卡以 LL- 开头
            if (entry.card_code.match(/^PL[!HS]?-/)) {
              lives.push({ card_code: entry.card_code, count: entry.count });
            } else {
              members.push({ card_code: entry.card_code, count: entry.count });
            }
          }
        }
        
        const localDeck: DeckConfig = {
          player_name: deckRecord.name,
          description: deckRecord.description || '',
          main_deck: { members, lives },
          energy_deck: deckRecord.energy_deck || [],
        };
        
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
      if (!isApiConfigured) {
        return { success: false, error: '服务器未配置' };
      }

      try {
        const result = await apiClient.delete(`/api/decks/${deckId}`);

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        set(state => ({
          cloudDecks: state.cloudDecks.filter(d => d.id !== deckId)
        }));

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : '删除失败' };
      }
    },
  };
});

// 开发/测试模式下暴露 store 以便 E2E 测试可以注入数据
if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  (window as any).__DECK_STORE__ = useDeckStore;
}

function createEmptyDeck(playerName: string): DeckConfig {
  return {
    player_name: playerName,
    description: "New Deck",
    main_deck: {
      members: [],
      lives: []
    },
    energy_deck: []
  };
}
