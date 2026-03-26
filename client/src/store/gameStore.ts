/**
 * 游戏状态管理 (Zustand Store)
 *
 * 连接 React UI 与后端 GameSession
 * 
 * 架构说明：
 * - GameSession: 充当"服务器"角色，维护权威游戏状态
 * - gameStore: 充当"客户端"角色，持有当前视角玩家的状态快照
 * - 切换视角时从 GameSession 获取对应玩家的状态
 */

import { create } from 'zustand';
import type { GameState } from '@game/domain/entities/game';
import type { CardInstance, AnyCardData } from '@game/domain/entities/card';
import type { DeckConfig } from '@game/application/game-service';
import { GameSession, createGameSession, type GameSessionEvent } from '@game/application/game-session';
import {
  type GameAction,
  createPlayMemberAction,
  createEndPhaseAction,
  createSetLiveCardAction,
  createMulliganAction,
  createTapMemberAction,
  // 阶段十新增动作
  createConfirmSubPhaseAction,
  createManualMoveCardAction,
  createConfirmJudgmentAction,
  createConfirmScoreAction,
  createSelectSuccessCardAction,
  createUndoOperationAction,
  createPerformCheerAction,
} from '@game/application/actions';
import { SlotPosition, GamePhase, SubPhase, ZoneType, CardType, GameMode } from '@game/shared/types/enums';
import { getCardById, getActivePlayer } from '@game/domain/entities/game';
import { getPhaseName } from '@game/shared/phase-config';
import { resolveCardImagePath } from '@/lib/imageService';

// ============================================
// Store 类型定义
// ============================================

export interface GameLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'action' | 'phase' | 'error';
}

export interface UIState {
  /** 当前选中的卡牌 ID */
  selectedCardId: string | null;
  /** 当前悬停的卡牌 ID (用于详情浮窗) */
  hoveredCardId: string | null;
  /** 当前是否处于拖拽中（用于区域高亮/变暗提示） */
  isDragging: boolean;
  /** 高亮的区域 */
  highlightedZones: string[];
  /** 是否显示阶段提示 */
  showPhaseBanner: boolean;
  /** 当前阶段提示文本 */
  phaseBannerText: string;
  /** 是否等待玩家输入 */
  waitingForInput: boolean;
  /** 输入请求类型 */
  inputRequestType: string | null;
  /** 游戏日志 */
  logs: GameLog[];
}

export interface GameStore {
  // ============ 状态 ============
  /** 游戏状态 (当前视角玩家的快照) */
  gameState: GameState | null;
  /** 卡牌数据注册表 (cardCode -> AnyCardData) */
  cardDataRegistry: Map<string, AnyCardData>;
  /** 游戏会话实例（服务器角色） */
  gameSession: GameSession;
  /** 当前游戏模式 */
  gameMode: GameMode;
  /** UI 状态 */
  ui: UIState;
  /** 当前视角玩家 ID */
  viewingPlayerId: string | null;

  // ============ 动作 ============
  /** 加载卡牌数据 (带文件名映射) */
  loadCardData: (cards: AnyCardData[], imageMap?: Map<string, string>) => void;
  /** 创建新游戏 */
  createGame: (
    gameId: string,
    player1Id: string,
    player1Name: string,
    player2Id: string,
    player2Name: string
  ) => void;
  /** 初始化游戏（设置卡组） */
  initializeGame: (player1Deck: DeckConfig, player2Deck: DeckConfig) => void;
  /** 执行游戏动作 */
  executeAction: (action: GameAction) => { success: boolean; error?: string };
  /** 推进阶段 */
  advancePhase: () => void;
  /** 选择卡牌 */
  selectCard: (cardId: string | null) => void;
  /** 取消选择 */
  deselectCard: () => void;
  /** 打出成员卡 */
  playMember: (cardId: string, slot: SlotPosition, isRelay?: boolean) => { success: boolean; error?: string };
  /** 放置 Live 卡到 Live 区 */
  setLiveCard: (cardId: string, faceDown?: boolean) => { success: boolean; error?: string };
  /** 换牌（Mulligan） */
  mulligan: (cardIdsToMulligan: string[]) => { success: boolean; error?: string };
  /** 切换成员状态（活跃/等待） */
  tapMember: (cardId: string, slot: SlotPosition) => { success: boolean; error?: string };
  /** 结束当前阶段 */
  endPhase: () => void;
  /** 设置视角玩家 */
  setViewingPlayer: (playerId: string) => void;
  /** 添加日志 */
  addLog: (message: string, type?: GameLog['type']) => void;
  /** 显示阶段提示 */
  showPhaseBannerFn: (text: string) => void;
  /** 隐藏阶段提示 */
  hidePhaseBanner: () => void;
  /** 设置悬停卡牌（用于详情浮窗） */
  setHoveredCard: (cardId: string | null) => void;
  /** 同步状态（从 GameSession 获取最新状态） */
  syncState: () => void;
  /** 设置拖拽提示状态（高亮推荐区域/变暗其他区域） */
  setDragHints: (isDragging: boolean, highlightedZones?: string[]) => void;
  /** 设置游戏模式（支持游戏内切换） */
  setGameMode: (mode: GameMode) => void;

  // ============ 查询辅助 ============
  /** 根据 instanceId 获取卡牌实例 */
  getCardInstance: (cardId: string) => CardInstance | null;
  /** 根据 cardCode 获取卡牌数据 */
  getCardData: (cardCode: string) => AnyCardData | undefined;
  /** 获取卡牌图片路径 */
  getCardImagePath: (cardCode: string) => string;
  /** 获取当前活跃玩家 ID */
  getCurrentPlayer: () => string | null;

  // ============ 阶段十新增动作 ============
  /** 确认子阶段完成 */
  confirmSubPhase: (subPhase: SubPhase) => { success: boolean; error?: string };
  /** 手动移动卡牌（自由拖拽） */
  manualMoveCard: (
    cardId: string,
    fromZone: ZoneType,
    toZone: ZoneType,
    options?: { targetSlot?: SlotPosition; sourceSlot?: SlotPosition; position?: 'TOP' | 'BOTTOM' }
  ) => { success: boolean; error?: string };
  /** 确认 Live 判定结果 */
  confirmJudgment: (judgmentResults: Map<string, boolean>) => { success: boolean; error?: string };
  /** 确认分数（用户可调整） */
  confirmScore: (adjustedScore?: number, winnerIds?: readonly string[]) => { success: boolean; error?: string };
  /** 选择成功 Live 卡移到成功区 */
  selectSuccessCard: (cardId: string) => { success: boolean; error?: string };
  /** 撤销上一步操作 */
  undoOperation: () => { success: boolean; error?: string };
  /** 执行应援（Cheer） */
  performCheer: (cheerCount: number) => { success: boolean; error?: string };
}

// ============================================
// Store 实现
// ============================================

export const useGameStore = create<GameStore>((set, get) => {
  // 创建游戏会话，设置事件监听
  const gameSession = createGameSession({
    onEvent: (event: GameSessionEvent) => {
      handleGameSessionEvent(event, get, set);
    },
  });

  return {
    // ============ 初始状态 ============
    gameState: null,
    cardDataRegistry: new Map(),
    gameSession,
    gameMode: GameMode.DEBUG,
    viewingPlayerId: null,
    ui: {
      selectedCardId: null,
      hoveredCardId: null,
      isDragging: false,
      highlightedZones: [],
      showPhaseBanner: false,
      phaseBannerText: '',
      waitingForInput: false,
      inputRequestType: null,
      logs: [],
    },

    // ============ 动作实现 ============

    loadCardData: (cards, _imageMap) => {
      const registry = new Map<string, AnyCardData>();
      for (const card of cards) {
        registry.set(card.cardCode, card);
      }
      set({
        cardDataRegistry: registry,
      });
      get().addLog(`已加载 ${cards.length} 张卡牌数据`, 'info');
    },

    createGame: (gameId, player1Id, player1Name, player2Id, player2Name) => {
      const { gameSession } = get();
      gameSession.createGame(gameId, player1Id, player1Name, player2Id, player2Name);
      
      // 默认设置玩家1为初始视角
      set({ viewingPlayerId: player1Id });
      
      // 同步状态
      get().syncState();
      get().addLog(`游戏创建成功: ${player1Name} vs ${player2Name}`, 'info');
    },

    initializeGame: (player1Deck, player2Deck) => {
      const { gameSession } = get();

      const result = gameSession.initializeGame(player1Deck, player2Deck);
      
      if (result.success) {
        // 同步状态
        get().syncState();
        get().addLog('游戏初始化完成，双方抽取初始手牌', 'info');
        get().showPhaseBannerFn('游戏开始!');
        setTimeout(() => get().hidePhaseBanner(), 2000);
      } else {
        get().addLog(`初始化失败: ${result.error}`, 'error');
      }
    },

    executeAction: (action) => {
      const { gameSession } = get();

      const result = gameSession.dispatch(action);

      if (result.success) {
        // 同步状态
        get().syncState();
        get().addLog(`执行动作: ${action.type}`, 'action');

        // 如果需要输入，更新 UI 状态
        if (result.needsInput) {
          set((state) => ({
            ui: {
              ...state.ui,
              waitingForInput: true,
              inputRequestType: result.inputRequest?.type || null,
            },
          }));
        }

        return { success: true };
      } else {
        get().addLog(`动作失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    advancePhase: () => {
      const { gameSession } = get();

      const result = gameSession.advancePhase();
      
      if (result.success) {
        // 同步状态
        get().syncState();

        const phaseName = getPhaseName(result.gameState.currentPhase);
        get().addLog(`进入 ${phaseName}`, 'phase');
        get().showPhaseBannerFn(phaseName);
        setTimeout(() => get().hidePhaseBanner(), 1500);
      }
    },

    selectCard: (cardId) => {
      set((state) => ({
        ui: { ...state.ui, selectedCardId: cardId },
      }));
    },

    deselectCard: () => {
      set((state) => ({
        ui: { ...state.ui, selectedCardId: null },
      }));
    },

    playMember: (cardId, slot, isRelay = false) => {
      const { viewingPlayerId } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createPlayMemberAction(viewingPlayerId, cardId, slot, { isRelay });
      const result = get().executeAction(action);

      if (result.success) {
        get().deselectCard();
      }

      return result;
    },

    setLiveCard: (cardId, faceDown = true) => {
      const { viewingPlayerId } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createSetLiveCardAction(viewingPlayerId, cardId, faceDown);
      const result = get().executeAction(action);

      if (result.success) {
        get().deselectCard();
        get().addLog('放置卡牌到 Live 区', 'action');
      }

      return result;
    },

    mulligan: (cardIdsToMulligan) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createMulliganAction(viewingPlayerId, cardIdsToMulligan);
      const result = gameSession.dispatch(action);

      if (result.success) {
        // 同步状态
        get().syncState();

        if (cardIdsToMulligan.length > 0) {
          get().addLog(`换牌: 换掉 ${cardIdsToMulligan.length} 张卡牌`, 'action');
        } else {
          get().addLog('确认不换牌', 'action');
        }

        // 如果换牌阶段结束，显示提示
        const currentPhase = result.gameState.currentPhase;
        if (currentPhase !== GamePhase.MULLIGAN_PHASE) {
          const phaseName = getPhaseName(currentPhase);
          get().showPhaseBannerFn(phaseName);
          setTimeout(() => get().hidePhaseBanner(), 1500);
        }

        return { success: true };
      } else {
        get().addLog(`换牌失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    tapMember: (cardId, slot) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createTapMemberAction(viewingPlayerId, cardId, slot);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog('切换成员状态', 'action');
        return { success: true };
      } else {
        get().addLog(`切换状态失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    endPhase: () => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) return;

      const action = createEndPhaseAction(viewingPlayerId);
      const result = gameSession.dispatch(action);
      
      if (result.success) {
        // 同步状态
        get().syncState();
        get().addLog('结束当前阶段', 'action');
      }
    },

    setViewingPlayer: (playerId) => {
      set({ viewingPlayerId: playerId });
      // 切换视角时同步状态
      get().syncState();
      get().addLog(`切换视角到: ${playerId}`, 'info');
    },

    addLog: (message, type = 'info') => {
      const log: GameLog = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        message,
        type,
      };
      set((state) => ({
        ui: {
          ...state.ui,
          logs: [...state.ui.logs.slice(-99), log], // 保留最近 100 条
        },
      }));
    },

    showPhaseBannerFn: (text) => {
      set((state) => ({
        ui: { ...state.ui, showPhaseBanner: true, phaseBannerText: text },
      }));
    },

    hidePhaseBanner: () => {
      set((state) => ({
        ui: { ...state.ui, showPhaseBanner: false },
      }));
    },

    setHoveredCard: (cardId) => {
      set((state) => ({
        ui: { ...state.ui, hoveredCardId: cardId },
      }));
    },

    setDragHints: (isDragging, highlightedZones) => {
      set((state) => ({
        ui: {
          ...state.ui,
          isDragging,
          highlightedZones:
            highlightedZones ?? (isDragging ? state.ui.highlightedZones : []),
        },
      }));
    },

    setGameMode: (mode) => {
      const { gameSession } = get();
      // 同步更新 store 和 session 的模式
      gameSession.gameMode = mode;
      set({ gameMode: mode });
      get().addLog(`切换游戏模式: ${mode === GameMode.SOLITAIRE ? '对墙打' : '调试'}`, 'info');
      // 同步状态以反映模式变更
      get().syncState();
    },

    syncState: () => {
      const { gameSession, viewingPlayerId } = get();
      
      if (!viewingPlayerId) {
        // 如果没有设置视角玩家，使用权威状态
        const state = gameSession.state;
        set({ gameState: state });
        return;
      }

      // 获取指定玩家视角的状态
      const playerState = gameSession.getStateForPlayer(viewingPlayerId);
      set({ gameState: playerState });
    },

    // ============ 查询辅助实现 ============

    getCardInstance: (cardId) => {
      const { gameState } = get();
      if (!gameState) return null;
      return getCardById(gameState, cardId);
    },

    getCardData: (cardCode) => {
      return get().cardDataRegistry.get(cardCode);
    },

    getCardImagePath: (cardCode) => {
      const cardData = get().cardDataRegistry.get(cardCode);
      return resolveCardImagePath(cardData ?? { cardCode, cardType: CardType.MEMBER });
    },

    getCurrentPlayer: () => {
      const { gameState } = get();
      if (!gameState) return null;
      return getActivePlayer(gameState).id;
    },

    // ============ 阶段十新增动作实现 ============

    confirmSubPhase: (subPhase) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createConfirmSubPhaseAction(viewingPlayerId, subPhase);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog(`确认子阶段完成: ${subPhase}`, 'action');
        return { success: true };
      } else {
        get().addLog(`确认子阶段失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    manualMoveCard: (cardId, fromZone, toZone, options) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createManualMoveCardAction(viewingPlayerId, cardId, fromZone, toZone, options);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog(`移动卡牌: ${fromZone} → ${toZone}`, 'action');
        return { success: true };
      } else {
        get().addLog(`移动卡牌失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    confirmJudgment: (judgmentResults) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createConfirmJudgmentAction(viewingPlayerId, judgmentResults);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog('确认 Live 判定结果', 'action');
        return { success: true };
      } else {
        get().addLog(`确认判定失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    confirmScore: (adjustedScore, winnerIds) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createConfirmScoreAction(viewingPlayerId, adjustedScore, winnerIds);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog(`确认分数${adjustedScore !== undefined ? `: ${adjustedScore}` : ''}`, 'action');
        return { success: true };
      } else {
        get().addLog(`确认分数失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    selectSuccessCard: (cardId) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createSelectSuccessCardAction(viewingPlayerId, cardId);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog('选择成功 Live 卡移到成功区', 'action');
        return { success: true };
      } else {
        get().addLog(`选择成功卡失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    undoOperation: () => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createUndoOperationAction(viewingPlayerId);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog('撤销上一步操作', 'action');
        return { success: true };
      } else {
        get().addLog(`撤销操作失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    performCheer: (cheerCount) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const action = createPerformCheerAction(viewingPlayerId, cheerCount);
      const result = gameSession.dispatch(action);

      if (result.success) {
        get().syncState();
        get().addLog(`执行应援: ${cheerCount} 张卡牌`, 'action');
        return { success: true };
      } else {
        get().addLog(`应援失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },
  };
});

// ============================================
// 辅助函数
// ============================================

/**
 * 处理 GameSession 事件
 */
function handleGameSessionEvent(
  event: GameSessionEvent,
  get: () => GameStore,
  set: (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void
): void {
  switch (event.type) {
    case 'PHASE_CHANGED':
      // 阶段变化时自动同步状态
      get().syncState();
      break;

    case 'TURN_CHANGED':
      get().addLog(`回合 ${event.turnNumber} 开始，活跃玩家: ${event.activePlayerId}`, 'phase');
      get().syncState();
      break;

    case 'GAME_ENDED':
      get().addLog(event.winnerId ? `游戏结束，获胜者: ${event.winnerId}` : '游戏结束，平局', 'info');
      get().syncState();
      break;

    case 'ACTION_EXECUTED':
      // 动作执行后自动同步状态
      get().syncState();
      break;
  }
}
