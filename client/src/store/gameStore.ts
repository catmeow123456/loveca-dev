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
import type { PlayerState } from '@game/domain/entities/player';
import type { CardInstance, AnyCardData } from '@game/domain/entities/card';
import type { DeckConfig } from '@game/application/game-service';
import { GameSession, createGameSession, type GameSessionEvent } from '@game/application/game-session';
import {
  createPublicObjectId,
  type DebugMatchSnapshot,
  type PlayerViewState,
  type Seat,
  type ViewCardObject,
  type ViewZoneKey,
  type ViewZoneState,
} from '@game/online';
import { type GameAction } from '@game/application/actions';
import {
  type GameCommand,
  createEndPhaseCommand,
  createMulliganCommand,
  createConfirmStepCommand,
  createConfirmPerformanceOutcomeCommand,
  createDrawCardToHandCommand,
  createDrawEnergyToZoneCommand,
  createSetLiveCardCommand,
  createFinishInspectionCommand,
  createAttachEnergyToMemberCommand,
  createMoveInspectedCardToBottomCommand,
  createMoveMemberToSlotCommand,
  createMovePublicCardToWaitingRoomCommand,
  createMovePublicCardToHandCommand,
  createReorderInspectedCardCommand,
  createMoveInspectedCardToTopCommand,
  createMoveInspectedCardToZoneCommand,
  createMoveTableCardCommand,
  createOpenInspectionCommand,
  createPlayMemberToSlotCommand,
  createRevealCheerCardCommand,
  createRevealInspectedCardCommand,
  createMoveResolutionCardToZoneCommand,
  createReturnHandCardToTopCommand,
  createSelectSuccessLiveCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
  createTapEnergyCommand,
  createTapMemberCommand,
} from '@game/application/game-commands';
import { SlotPosition, GamePhase, SubPhase, ZoneType, CardType, GameMode } from '@game/shared/types/enums';
import { getCardById, getActivePlayer } from '@game/domain/entities/game';
import { getPhaseName } from '@game/shared/phase-config';
import { resolveCardImagePath } from '@/lib/imageService';
import {
  advanceOnlineDebugPhase,
  executeOnlineDebugCommand,
  fetchOnlineDebugSnapshot,
} from '@/lib/onlineDebugClient';

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

interface RemoteDebugSessionState {
  readonly matchId: string;
  readonly seat: Seat;
  readonly playerId: string;
}

export interface GameStore {
  // ============ 状态 ============
  /** 游戏状态 (当前视角玩家的快照) */
  gameState: GameState | null;
  /** 联机视图状态（按当前视角投影） */
  playerViewState: PlayerViewState | null;
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
  /** 当前远程联机调试会话 */
  remoteDebugSession: RemoteDebugSessionState | null;

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
  /** 通过命令层将手牌成员登场到成员槽位 */
  playMemberToSlot: (cardId: string, slot: SlotPosition) => { success: boolean; error?: string };
  /** 将公开区卡牌移入休息室 */
  movePublicCardToWaitingRoom: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE,
    sourceSlot?: SlotPosition
  ) => { success: boolean; error?: string };
  /** 将公开区卡牌移入手牌 */
  movePublicCardToHand: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE,
    sourceSlot?: SlotPosition
  ) => { success: boolean; error?: string };
  /** 放置 Live 卡到 Live 区 */
  setLiveCard: (cardId: string, faceDown?: boolean) => { success: boolean; error?: string };
  /** 换牌（Mulligan） */
  mulligan: (cardIdsToMulligan: string[]) => { success: boolean; error?: string };
  /** 切换成员状态（活跃/等待） */
  tapMember: (cardId: string, slot: SlotPosition) => { success: boolean; error?: string };
  /** 切换能量状态（活跃/等待） */
  tapEnergy: (cardId: string) => { success: boolean; error?: string };
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
  /** 接入远程联机调试会话 */
  connectRemoteDebugSession: (session: RemoteDebugSessionState) => void;
  /** 断开远程联机调试会话 */
  disconnectRemoteDebugSession: () => void;
  /** 主动拉取远程联机调试快照 */
  syncRemoteDebugState: () => Promise<void>;
  /** 当前是否处于远程联机调试模式 */
  isRemoteDebugMode: () => boolean;

  // ============ 查询辅助 ============
  /** 根据 instanceId 获取卡牌实例 */
  getCardInstance: (cardId: string) => CardInstance | null;
  /** 根据 cardCode 获取卡牌数据 */
  getCardData: (cardCode: string) => AnyCardData | undefined;
  /** 获取卡牌图片路径 */
  getCardImagePath: (cardCode: string) => string;
  /** 获取当前活跃玩家 ID */
  getCurrentPlayer: () => string | null;
  /** 获取当前视角 seat */
  getViewerSeat: () => Seat | null;
  /** 获取当前联机 match 视图 */
  getMatchView: () => PlayerViewState['match'] | null;
  /** 获取当前联机权限视图 */
  getPermissionView: () => PlayerViewState['permissions'] | null;
  /** 获取当前回合数 */
  getTurnCountView: () => number | null;
  /** 获取当前主阶段 */
  getCurrentPhaseView: () => GamePhase | null;
  /** 获取当前子阶段 */
  getCurrentSubPhaseView: () => SubPhase | null;
  /** 获取当前活跃 seat */
  getActiveSeatView: () => Seat | null;
  /** 获取当前视角玩家状态 */
  getViewingPlayerState: () => PlayerState | null;
  /** 获取当前对手玩家状态 */
  getOpponentPlayerState: () => PlayerState | null;
  /** 按玩家 ID 获取玩家状态 */
  getPlayerStateById: (playerId: string) => PlayerState | null;
  /** 获取当前活跃玩家状态 */
  getActivePlayerState: () => PlayerState | null;
  /** 获取先攻玩家状态 */
  getFirstPlayerState: () => PlayerState | null;
  /** 获取后攻玩家状态 */
  getSecondPlayerState: () => PlayerState | null;
  /** 根据实例 ID 获取投影视图中的卡牌对象 */
  getCardViewObject: (cardId: string) => ViewCardObject | null;
  /** 获取视图区域 */
  getViewZone: (zoneKey: ViewZoneKey) => ViewZoneState | null;
  /** 获取 seat 归属区域 */
  getSeatZone: (seat: Seat, suffix: string) => ViewZoneState | null;
  /** 获取区域中的实例 ID 列表 */
  getZoneCardIds: (zoneKey: ViewZoneKey) => string[];
  /** 当前视角是否可见该卡牌正面 */
  canSeeCardFront: (cardId: string) => boolean;
  /** 获取指定玩家的 Live 分数 */
  getLiveScoreForPlayer: (playerId: string) => number;
  /** 指定玩家是否为 Live 胜者 */
  isLiveWinner: (playerId: string) => boolean;
  /** 当前 Live 是否平局 */
  isLiveDraw: () => boolean;
  /** 当前已确认分数的玩家数量 */
  getConfirmedScoreCount: () => number;
  /** 指定玩家是否已确认分数 */
  isScoreConfirmed: (playerId: string) => boolean;

  // ============ 阶段十新增动作 ============
  /** 确认子阶段完成 */
  confirmSubPhase: (subPhase: SubPhase) => { success: boolean; error?: string };
  /** 确认 Live 判定结果 */
  confirmJudgment: (judgmentResults: Map<string, boolean>) => { success: boolean; error?: string };
  /** 确认分数（仅确认己方最终分数） */
  confirmScore: (adjustedScore?: number) => { success: boolean; error?: string };
  /** 选择成功 Live 卡移到成功区 */
  selectSuccessCard: (cardId: string) => { success: boolean; error?: string };
  /** 通过命令层移动牌桌卡牌 */
  moveTableCard: (
    cardId: string,
    fromZone: ZoneType,
    toZone: ZoneType,
    options?: { targetSlot?: SlotPosition; sourceSlot?: SlotPosition; position?: 'TOP' | 'BOTTOM' }
  ) => { success: boolean; error?: string };
  /** 将成员从一个槽位移动到另一个槽位 */
  moveMemberToSlot: (cardId: string, sourceSlot: SlotPosition, targetSlot: SlotPosition) => { success: boolean; error?: string };
  /** 将能量附着到指定成员槽位 */
  attachEnergyToMember: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK,
    targetSlot: SlotPosition
  ) => { success: boolean; error?: string };
  /** 从牌库打开检视流程 */
  openInspection: (sourceZone: ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK, count?: number) => { success: boolean; error?: string };
  /** 将检视区卡牌放回来源区顶部 */
  moveInspectedCardToTop: (cardId: string) => { success: boolean; error?: string };
  /** 将检视区卡牌公开给双方 */
  revealInspectedCard: (cardId: string) => { success: boolean; error?: string };
  /** 将检视区卡牌放回来源区底部 */
  moveInspectedCardToBottom: (cardId: string) => { success: boolean; error?: string };
  /** 将检视区卡牌移动到指定区域 */
  moveInspectedCardToZone: (cardId: string, toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.EXILE_ZONE) => { success: boolean; error?: string };
  /** 调整检视区卡牌顺序 */
  reorderInspectedCard: (cardId: string, toIndex: number) => { success: boolean; error?: string };
  /** 声明当前检视流程完成 */
  finishInspection: () => { success: boolean; error?: string };
  /** 翻开一张应援牌到解决区 */
  revealCheerCard: () => { success: boolean; error?: string };
  /** 将解决区卡牌移到指定区域 */
  moveResolutionCardToZone: (
    cardId: string,
    toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.MAIN_DECK | ZoneType.EXILE_ZONE,
    options?: { position?: 'TOP' | 'BOTTOM' }
  ) => { success: boolean; error?: string };
  /** 提交当前 Live 判定结果并推进子阶段 */
  confirmPerformanceOutcome: (success: boolean) => { success: boolean; error?: string };
  /** 主卡组顶抽一张到手牌 */
  drawCardToHand: () => { success: boolean; error?: string };
  /** 将能量卡组顶的一张能量牌放到能量区 */
  drawEnergyToZone: (cardId: string) => { success: boolean; error?: string };
  /** 将手牌一张放回主卡组顶 */
  returnHandCardToTop: (cardId: string) => { success: boolean; error?: string };
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
    playerViewState: null,
    cardDataRegistry: new Map(),
    gameSession,
    gameMode: GameMode.DEBUG,
    viewingPlayerId: null,
    remoteDebugSession: null,
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
      if (dispatchRemoteAdvancePhase()) {
        return;
      }

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
      const result = get().playMemberToSlot(cardId, slot);
      if (!result.success && isRelay) {
        return result;
      }
      return result;
    },

    playMemberToSlot: (cardId, slot) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createPlayMemberToSlotCommand(viewingPlayerId, cardId, slot);
      if (dispatchRemoteCommand(command, '成员登场失败')) {
        get().deselectCard();
        get().addLog(`成员登场到 ${slot}`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().deselectCard();
        get().addLog(`成员登场到 ${slot}`, 'action');
        return { success: true };
      }

      get().addLog(`成员登场失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    movePublicCardToWaitingRoom: (cardId, fromZone, sourceSlot) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMovePublicCardToWaitingRoomCommand(viewingPlayerId, cardId, fromZone, sourceSlot);
      if (dispatchRemoteCommand(command, '公开区卡牌移动失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      return { success: false, error: result.error };
    },

    movePublicCardToHand: (cardId, fromZone, sourceSlot) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMovePublicCardToHandCommand(viewingPlayerId, cardId, fromZone, sourceSlot);
      if (dispatchRemoteCommand(command, '公开区卡牌回手失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      return { success: false, error: result.error };
    },

    setLiveCard: (cardId, faceDown = true) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createSetLiveCardCommand(viewingPlayerId, cardId, faceDown);
      if (dispatchRemoteCommand(command, '放置 Live 卡失败')) {
        get().deselectCard();
        get().addLog('放置卡牌到 Live 区', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

      if (result.success) {
        get().syncState();
        get().deselectCard();
        get().addLog('放置卡牌到 Live 区', 'action');
        return { success: true };
      }

      get().addLog(`放置 Live 卡失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    mulligan: (cardIdsToMulligan) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMulliganCommand(viewingPlayerId, cardIdsToMulligan);
      if (dispatchRemoteCommand(command, '换牌失败')) {
        if (cardIdsToMulligan.length > 0) {
          get().addLog(`换牌: 换掉 ${cardIdsToMulligan.length} 张卡牌`, 'action');
        } else {
          get().addLog('确认不换牌', 'action');
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

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

      const command = createTapMemberCommand(viewingPlayerId, cardId, slot);
      if (dispatchRemoteCommand(command, '切换状态失败')) {
        get().addLog('切换成员状态', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

      if (result.success) {
        get().syncState();
        get().addLog('切换成员状态', 'action');
        return { success: true };
      } else {
        get().addLog(`切换状态失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    tapEnergy: (cardId) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createTapEnergyCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '切换能量状态失败')) {
        get().addLog('切换能量状态', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

      if (result.success) {
        get().syncState();
        get().addLog('切换能量状态', 'action');
        return { success: true };
      }

      get().addLog(`切换能量状态失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    endPhase: () => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) return;

      const command = createEndPhaseCommand(viewingPlayerId);
      if (dispatchRemoteCommand(command, '结束阶段失败')) {
        get().addLog('结束当前阶段', 'action');
        return;
      }

      const result = gameSession.executeCommand(command);
      
      if (result.success) {
        // 同步状态
        get().syncState();
        get().addLog('结束当前阶段', 'action');
      } else {
        get().addLog(`结束阶段失败: ${result.error}`, 'error');
      }
    },

    setViewingPlayer: (playerId) => {
      if (get().remoteDebugSession) {
        return;
      }

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
      if (get().remoteDebugSession) {
        return;
      }

      const { gameSession } = get();
      // 同步更新 store 和 session 的模式
      gameSession.gameMode = mode;
      set({ gameMode: mode });
      get().addLog(`切换游戏模式: ${mode === GameMode.SOLITAIRE ? '对墙打' : '调试'}`, 'info');
      // 同步状态以反映模式变更
      get().syncState();
    },

    connectRemoteDebugSession: (session) => {
      set({
        remoteDebugSession: session,
        viewingPlayerId: session.playerId,
        gameMode: GameMode.DEBUG,
      });
    },

    disconnectRemoteDebugSession: () => {
      set({
        remoteDebugSession: null,
        gameState: null,
        playerViewState: null,
        viewingPlayerId: null,
      });
    },

    syncRemoteDebugState: async () => {
      const remoteSession = get().remoteDebugSession;
      if (!remoteSession) {
        return;
      }

      const snapshot = await fetchOnlineDebugSnapshot(remoteSession.matchId, remoteSession.seat);
      applyRemoteDebugSnapshot(snapshot, set);
    },

    isRemoteDebugMode: () => get().remoteDebugSession !== null,

    syncState: () => {
      if (get().remoteDebugSession) {
        return;
      }

      const { gameSession, viewingPlayerId } = get();
      let nextState: GameState | null;
      let nextPlayerViewState: PlayerViewState | null = null;

      if (!viewingPlayerId) {
        // 如果没有设置视角玩家，使用权威状态
        nextState = gameSession.state;
      } else {
        // 获取指定玩家视角的状态
        nextState = gameSession.getStateForPlayer(viewingPlayerId);
        nextPlayerViewState = gameSession.getPlayerViewState(viewingPlayerId);
      }

      set((state) => ({
        gameState: nextState,
        playerViewState: nextPlayerViewState,
        ui: {
          ...state.ui,
          hoveredCardId:
            resolveHoveredCardId(state.ui.hoveredCardId, nextState, nextPlayerViewState),
        },
      }));
    },

    // ============ 查询辅助实现 ============

    getCardInstance: (cardId) => {
      const { gameState, playerViewState } = get();
      if (!gameState) return null;
      if (playerViewState) {
        const viewObject = playerViewState.objects[createPublicObjectId(cardId)];
        if (!viewObject || viewObject.surface !== 'FRONT') {
          return null;
        }
      }
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

    getViewerSeat: () => {
      return get().playerViewState?.match.viewerSeat ?? null;
    },

    getMatchView: () => {
      return get().playerViewState?.match ?? null;
    },

    getPermissionView: () => {
      return get().playerViewState?.permissions ?? null;
    },

    getTurnCountView: () => {
      return get().playerViewState?.match.turnCount ?? get().gameState?.turnCount ?? null;
    },

    getCurrentPhaseView: () => {
      return (get().playerViewState?.match.phase as GamePhase | undefined) ?? get().gameState?.currentPhase ?? null;
    },

    getCurrentSubPhaseView: () => {
      return (get().playerViewState?.match.subPhase as SubPhase | undefined) ?? get().gameState?.currentSubPhase ?? null;
    },

    getActiveSeatView: () => {
      return get().playerViewState?.match.activeSeat ?? null;
    },

    getViewingPlayerState: () => {
      const { gameState, viewingPlayerId } = get();
      if (!gameState || !viewingPlayerId) {
        return null;
      }
      return gameState.players.find((player) => player.id === viewingPlayerId) ?? null;
    },

    getOpponentPlayerState: () => {
      const { gameState, viewingPlayerId } = get();
      if (!gameState || !viewingPlayerId) {
        return null;
      }
      return gameState.players.find((player) => player.id !== viewingPlayerId) ?? null;
    },

    getPlayerStateById: (playerId) => {
      const { gameState } = get();
      if (!gameState) {
        return null;
      }
      return gameState.players.find((player) => player.id === playerId) ?? null;
    },

    getActivePlayerState: () => {
      const { gameState } = get();
      if (!gameState) {
        return null;
      }
      return gameState.players[gameState.activePlayerIndex] ?? null;
    },

    getFirstPlayerState: () => {
      const { gameState } = get();
      if (!gameState) {
        return null;
      }
      return gameState.players[gameState.firstPlayerIndex] ?? null;
    },

    getSecondPlayerState: () => {
      const { gameState } = get();
      if (!gameState) {
        return null;
      }
      return gameState.players[gameState.firstPlayerIndex === 0 ? 1 : 0] ?? null;
    },

    getCardViewObject: (cardId) => {
      const { playerViewState } = get();
      if (!playerViewState) return null;
      return playerViewState.objects[createPublicObjectId(cardId)] ?? null;
    },

    getViewZone: (zoneKey) => {
      const { playerViewState } = get();
      if (!playerViewState) return null;
      return playerViewState.table.zones[zoneKey] ?? null;
    },

    getSeatZone: (seat, suffix) => {
      const { playerViewState } = get();
      if (!playerViewState) return null;
      return playerViewState.table.zones[`${seat}_${suffix}` as ViewZoneKey] ?? null;
    },

    getZoneCardIds: (zoneKey) => {
      const zone = get().getViewZone(zoneKey);
      if (!zone?.objectIds) {
        return [];
      }
      return zone.objectIds.map((publicObjectId) =>
        publicObjectId.startsWith('obj_') ? publicObjectId.slice(4) : publicObjectId
      );
    },

    canSeeCardFront: (cardId) => {
      const viewObject = get().getCardViewObject(cardId);
      return viewObject?.surface === 'FRONT';
    },

    getLiveScoreForPlayer: (playerId) => {
      const { gameState } = get();
      if (!gameState) {
        return 0;
      }
      return gameState.liveResolution.playerScores.get(playerId) ?? 0;
    },

    isLiveWinner: (playerId) => {
      const { gameState } = get();
      if (!gameState) {
        return false;
      }
      return gameState.liveResolution.liveWinnerIds.includes(playerId);
    },

    isLiveDraw: () => {
      const { gameState } = get();
      if (!gameState) {
        return false;
      }
      return gameState.liveResolution.liveWinnerIds.length === 2;
    },

    getConfirmedScoreCount: () => {
      const { gameState } = get();
      if (!gameState) {
        return 0;
      }
      return gameState.liveResolution.scoreConfirmedBy.length;
    },

    isScoreConfirmed: (playerId) => {
      const { gameState } = get();
      if (!gameState) {
        return false;
      }
      return gameState.liveResolution.scoreConfirmedBy.includes(playerId);
    },

    // ============ 阶段十新增动作实现 ============

    confirmSubPhase: (subPhase) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createConfirmStepCommand(viewingPlayerId, subPhase);
      if (dispatchRemoteCommand(command, '确认子阶段失败')) {
        get().addLog(`确认子阶段完成: ${subPhase}`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

      if (result.success) {
        get().syncState();
        get().addLog(`确认子阶段完成: ${subPhase}`, 'action');
        return { success: true };
      } else {
        get().addLog(`确认子阶段失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    confirmJudgment: (judgmentResults) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createSubmitJudgmentCommand(viewingPlayerId, judgmentResults);
      if (dispatchRemoteCommand(command, '确认判定失败')) {
        get().addLog('确认 Live 判定结果', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

      if (result.success) {
        get().syncState();
        get().addLog('确认 Live 判定结果', 'action');
        return { success: true };
      } else {
        get().addLog(`确认判定失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    confirmScore: (adjustedScore) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createSubmitScoreCommand(viewingPlayerId, adjustedScore);
      if (dispatchRemoteCommand(command, '确认分数失败')) {
        get().addLog(`确认分数${adjustedScore !== undefined ? `: ${adjustedScore}` : ''}`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

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

      const command = createSelectSuccessLiveCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '选择成功卡失败')) {
        get().addLog('选择成功 Live 卡移到成功区', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);

      if (result.success) {
        get().syncState();
        get().addLog('选择成功 Live 卡移到成功区', 'action');
        return { success: true };
      } else {
        get().addLog(`选择成功卡失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
    },

    moveTableCard: (cardId, fromZone, toZone, options) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMoveTableCardCommand(viewingPlayerId, cardId, fromZone, toZone, options);
      if (dispatchRemoteCommand(command, '移动卡牌失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      return { success: false, error: result.error };
    },

    moveMemberToSlot: (cardId, sourceSlot, targetSlot) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMoveMemberToSlotCommand(viewingPlayerId, cardId, sourceSlot, targetSlot);
      if (dispatchRemoteCommand(command, '成员换位失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      return { success: false, error: result.error };
    },

    attachEnergyToMember: (cardId, fromZone, targetSlot) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createAttachEnergyToMemberCommand(viewingPlayerId, cardId, fromZone, targetSlot);
      if (dispatchRemoteCommand(command, '附着能量失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      return { success: false, error: result.error };
    },

    openInspection: (sourceZone, count = 1) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createOpenInspectionCommand(viewingPlayerId, sourceZone, count);
      if (dispatchRemoteCommand(command, '开始检视失败')) {
        get().addLog(`开始检视: ${sourceZone} 顶 ${count} 张`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog(`开始检视: ${sourceZone} 顶 ${count} 张`, 'action');
        return { success: true };
      }

      get().addLog(`开始检视失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    moveInspectedCardToTop: (cardId) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMoveInspectedCardToTopCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '检视牌放回顶部失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog('检视牌放回顶部', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog('检视牌放回顶部', 'action');
        return { success: true };
      }

      get().addLog(`检视牌放回顶部失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    revealInspectedCard: (cardId) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createRevealInspectedCardCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '公开检视牌失败')) {
        get().addLog('公开检视牌', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog('公开检视牌', 'action');
        return { success: true };
      }

      get().addLog(`公开检视牌失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    moveInspectedCardToBottom: (cardId) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMoveInspectedCardToBottomCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '检视牌放回底部失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog('检视牌放回底部', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog('检视牌放回底部', 'action');
        return { success: true };
      }

      get().addLog(`检视牌放回底部失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    moveInspectedCardToZone: (cardId, toZone) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMoveInspectedCardToZoneCommand(viewingPlayerId, cardId, toZone);
      if (dispatchRemoteCommand(command, '检视牌移动失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog(`检视牌移动到 ${toZone}`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog(`检视牌移动到 ${toZone}`, 'action');
        return { success: true };
      }

      get().addLog(`检视牌移动失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    reorderInspectedCard: (cardId, toIndex) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createReorderInspectedCardCommand(viewingPlayerId, cardId, toIndex);
      if (dispatchRemoteCommand(command, '调整检视顺序失败')) {
        get().addLog(`调整检视顺序到位置 ${toIndex + 1}`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog(`调整检视顺序到位置 ${toIndex + 1}`, 'action');
        return { success: true };
      }

      get().addLog(`调整检视顺序失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    finishInspection: () => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createFinishInspectionCommand(viewingPlayerId);
      if (dispatchRemoteCommand(command, '检视流程结束失败')) {
        get().addLog('检视流程结束', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog('检视流程结束', 'action');
        return { success: true };
      }

      get().addLog(`检视流程结束失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    revealCheerCard: () => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createRevealCheerCardCommand(viewingPlayerId);
      if (dispatchRemoteCommand(command, '翻开应援牌失败')) {
        get().addLog('翻开一张应援牌', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog('翻开一张应援牌', 'action');
        return { success: true };
      }

      get().addLog(`翻开应援牌失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    moveResolutionCardToZone: (cardId, toZone, options) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMoveResolutionCardToZoneCommand(viewingPlayerId, cardId, toZone, options?.position);
      if (dispatchRemoteCommand(command, '解决区卡牌移动失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog(`解决区卡牌移动到 ${toZone}`, 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog(`解决区卡牌移动到 ${toZone}`, 'action');
        return { success: true };
      }

      get().addLog(`解决区卡牌移动失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    confirmPerformanceOutcome: (success) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createConfirmPerformanceOutcomeCommand(viewingPlayerId, success);
      if (dispatchRemoteCommand(command, '提交 Live 判定结果失败')) {
        get().addLog(success ? '确认 Live 成功' : '确认 Live 失败', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog(success ? '确认 Live 成功' : '确认 Live 失败', 'action');
        return { success: true };
      }

      get().addLog(`提交 Live 判定结果失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    drawCardToHand: () => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createDrawCardToHandCommand(viewingPlayerId);
      if (dispatchRemoteCommand(command, '抽卡失败')) {
        get().addLog('抽一张到手牌', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        get().addLog('抽一张到手牌', 'action');
        return { success: true };
      }

      get().addLog(`抽卡失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    drawEnergyToZone: (cardId) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createDrawEnergyToZoneCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '放置能量失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        return { success: true };
      }

      get().addLog(`放置能量失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
    },

    returnHandCardToTop: (cardId) => {
      const { viewingPlayerId, gameSession, ui } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createReturnHandCardToTopCommand(viewingPlayerId, cardId);
      if (dispatchRemoteCommand(command, '放回顶部失败')) {
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog('手牌放回主卡组顶', 'action');
        return { success: true };
      }

      const result = gameSession.executeCommand(command);
      if (result.success) {
        get().syncState();
        if (ui.hoveredCardId === cardId) {
          get().setHoveredCard(null);
        }
        get().addLog('手牌放回主卡组顶', 'action');
        return { success: true };
      }

      get().addLog(`放回顶部失败: ${result.error}`, 'error');
      return { success: false, error: result.error };
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

function resolveHoveredCardId(
  hoveredCardId: string | null,
  gameState: GameState | null,
  playerViewState: PlayerViewState | null
): string | null {
  if (!hoveredCardId || !gameState || !getCardById(gameState, hoveredCardId)) {
    return null;
  }

  if (!playerViewState) {
    return hoveredCardId;
  }

  const viewObject = playerViewState.objects[createPublicObjectId(hoveredCardId)];
  if (!viewObject) {
    return null;
  }

  return viewObject.surface === 'FRONT' ? hoveredCardId : null;
}

function applyRemoteDebugSnapshot(
  snapshot: DebugMatchSnapshot,
  set: (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void
): void {
  set((state) => ({
    viewingPlayerId: snapshot.playerId,
    gameState: snapshot.gameState,
    playerViewState: snapshot.playerViewState,
    ui: {
      ...state.ui,
      hoveredCardId: resolveHoveredCardId(
        state.ui.hoveredCardId,
        snapshot.gameState,
        snapshot.playerViewState
      ),
    },
  }));
}

function dispatchRemoteCommand(command: GameCommand, failureMessage: string): boolean {
  const store = useGameStore.getState();
  const remoteSession = store.remoteDebugSession;
  if (!remoteSession) {
    return false;
  }

  void executeOnlineDebugCommand(remoteSession.matchId, remoteSession.seat, command)
    .then((result) => {
      if (!result.success || !result.snapshot) {
        useGameStore.getState().addLog(
          `${failureMessage}: ${result.error ?? '服务端拒绝了该操作'}`,
          'error'
        );
        return;
      }

      applyRemoteDebugSnapshot(result.snapshot, useGameStore.setState);
    })
    .catch((error) => {
      useGameStore.getState().addLog(
        `${failureMessage}: ${error instanceof Error ? error.message : '网络请求失败'}`,
        'error'
      );
    });

  return true;
}

function dispatchRemoteAdvancePhase(): boolean {
  const store = useGameStore.getState();
  const remoteSession = store.remoteDebugSession;
  if (!remoteSession) {
    return false;
  }

  void advanceOnlineDebugPhase(remoteSession.matchId, remoteSession.seat)
    .then((result) => {
      if (!result.success || !result.snapshot) {
        useGameStore.getState().addLog(
          `阶段推进失败: ${result.error ?? '服务端拒绝了该操作'}`,
          'error'
        );
        return;
      }

      applyRemoteDebugSnapshot(result.snapshot, useGameStore.setState);
      const phaseName = getPhaseName(result.snapshot.gameState.currentPhase);
      useGameStore.getState().addLog(`进入 ${phaseName}`, 'phase');
      useGameStore.getState().showPhaseBannerFn(phaseName);
      setTimeout(() => useGameStore.getState().hidePhaseBanner(), 1500);
    })
    .catch((error) => {
      useGameStore.getState().addLog(
        `阶段推进失败: ${error instanceof Error ? error.message : '网络请求失败'}`,
        'error'
      );
    });

  return true;
}
