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
import type { AnyCardData, MemberCardData, LiveCardData } from '@game/domain/entities/card';
import { createHeartRequirement } from '@game/domain/entities/card';
import type { DeckConfig } from '@game/application/game-service';
import { GameSession, createGameSession, type GameSessionEvent } from '@game/application/game-session';
import {
  createPublicObjectId,
  type PlayerViewState,
  type RemoteMatchSnapshot,
  type Seat,
  type ViewCommandHint,
  type ViewFrontCardInfo,
  type ViewCardObject,
  type ViewZoneKey,
  type ViewZoneState,
} from '@game/online';
import {
  GameCommandType,
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
  createMoveOwnedCardToZoneCommand,
  createMovePublicCardToEnergyDeckCommand,
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
import { getPhaseName } from '@game/shared/phase-config';
import { resolveCardImagePath } from '@/lib/imageService';
import { type ParsedZoneId } from '@/lib/zoneUtils';
import {
  advanceRemotePhase,
  executeRemoteCommand,
  fetchRemoteSnapshot,
  type RemoteSessionSource,
  type RemoteSnapshot,
} from '@/lib/remoteMatchClient';

// ============================================
// Store 类型定义
// ============================================

export interface GameLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'action' | 'phase' | 'error';
}

export interface PlayerIdentity {
  readonly id: string;
  readonly name: string;
}

export interface VisibleCardPresentation {
  readonly instanceId: string;
  readonly cardCode: string;
  readonly cardData: AnyCardData;
  readonly imagePath: string;
}

export interface CommandDispatchResult {
  readonly success: boolean;
  readonly error?: string;
  readonly pending?: boolean;
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

export interface RemoteSessionState {
  readonly matchId: string;
  readonly source: RemoteSessionSource;
  readonly seat?: Seat;
  readonly playerId: string | null;
}

export interface GameStore {
  // ============ 状态 ============
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
  /** 当前远程联机会话 */
  remoteSession: RemoteSessionState | null;

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
  /** 推进阶段 */
  advancePhase: () => void;
  /** 选择卡牌 */
  selectCard: (cardId: string | null) => void;
  /** 取消选择 */
  deselectCard: () => void;
  /** 通过命令层将手牌成员登场到成员槽位 */
  playMemberToSlot: (cardId: string, slot: SlotPosition) => CommandDispatchResult;
  /** 将公开区卡牌移入休息室 */
  movePublicCardToWaitingRoom: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE,
    sourceSlot?: SlotPosition
  ) => CommandDispatchResult;
  /** 将公开区卡牌移入手牌 */
  movePublicCardToHand: (
    cardId: string,
    fromZone:
      | ZoneType.MEMBER_SLOT
      | ZoneType.LIVE_ZONE
      | ZoneType.SUCCESS_ZONE
      | ZoneType.WAITING_ROOM,
    sourceSlot?: SlotPosition
  ) => CommandDispatchResult;
  /** 将公开的能量牌移回能量卡组 */
  movePublicCardToEnergyDeck: (
    cardId: string,
    fromZone: ZoneType.ENERGY_ZONE
  ) => CommandDispatchResult;
  /** 将己方私有区卡牌移动到目标区域 */
  moveOwnedCardToZone: (
    cardId: string,
    fromZone: ZoneType.HAND | ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK,
    toZone:
      | ZoneType.HAND
      | ZoneType.MAIN_DECK
      | ZoneType.ENERGY_DECK
      | ZoneType.MEMBER_SLOT
      | ZoneType.ENERGY_ZONE
      | ZoneType.LIVE_ZONE
    | ZoneType.SUCCESS_ZONE
      | ZoneType.WAITING_ROOM
      | ZoneType.EXILE_ZONE,
    options?: { targetSlot?: SlotPosition; position?: 'TOP' | 'BOTTOM' }
  ) => CommandDispatchResult;
  /** 放置 Live 卡到 Live 区 */
  setLiveCard: (cardId: string, faceDown?: boolean) => CommandDispatchResult;
  /** 换牌（Mulligan） */
  mulligan: (cardIdsToMulligan: string[]) => CommandDispatchResult;
  /** 切换成员状态（活跃/等待） */
  tapMember: (cardId: string, slot: SlotPosition) => CommandDispatchResult;
  /** 切换能量状态（活跃/等待） */
  tapEnergy: (cardId: string) => CommandDispatchResult;
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
  /** 接入远程联机会话 */
  connectRemoteSession: (session: RemoteSessionState) => void;
  /** 断开远程联机会话 */
  disconnectRemoteSession: () => void;
  /** 主动拉取远程联机快照 */
  syncRemoteState: () => Promise<void>;
  /** 当前是否处于远程联机模式 */
  isRemoteMode: () => boolean;
  /** 接入远程联机调试会话 */
  connectRemoteDebugSession: (session: Omit<RemoteSessionState, 'source'>) => void;
  /** 断开远程联机调试会话 */
  disconnectRemoteDebugSession: () => void;
  /** 主动拉取远程联机调试快照 */
  syncRemoteDebugState: () => Promise<void>;
  /** 当前是否处于远程联机调试模式 */
  isRemoteDebugMode: () => boolean;

  // ============ 查询辅助 ============
  /** 根据 cardCode 获取卡牌数据 */
  getCardData: (cardCode: string) => AnyCardData | undefined;
  /** 获取卡牌图片路径 */
  getCardImagePath: (cardCode: string) => string;
  /** 获取当前视角 seat */
  getViewerSeat: () => Seat | null;
  /** 获取当前联机 match 视图 */
  getMatchView: () => PlayerViewState['match'] | null;
  /** 获取当前联机权限视图 */
  getPermissionView: () => PlayerViewState['permissions'] | null;
  /** 获取指定命令提示 */
  getCommandHint: (command: string) => ViewCommandHint | null;
  /** 获取当前回合数 */
  getTurnCountView: () => number | null;
  /** 获取当前主阶段 */
  getCurrentPhaseView: () => GamePhase | null;
  /** 获取当前子阶段 */
  getCurrentSubPhaseView: () => SubPhase | null;
  /** 获取当前活跃 seat */
  getActiveSeatView: () => Seat | null;
  /** 获取当前视角玩家身份信息 */
  getViewingPlayerIdentity: () => PlayerIdentity | null;
  /** 获取当前对手身份信息 */
  getOpponentPlayerIdentity: () => PlayerIdentity | null;
  /** 按 seat 获取玩家身份信息 */
  getPlayerIdentityForSeat: (seat: Seat) => PlayerIdentity | null;
  /** 根据实例 ID 获取投影视图中的卡牌对象 */
  getCardViewObject: (cardId: string) => ViewCardObject | null;
  /** 根据实例 ID 获取投影视图中的正面信息 */
  getCardFrontInfo: (cardId: string) => ViewFrontCardInfo | null;
  /** 获取当前视角可见卡牌的展示数据 */
  getVisibleCardPresentation: (cardId: string) => VisibleCardPresentation | null;
  /** 获取当前视角已知的卡牌类型 */
  getKnownCardType: (cardId: string) => CardType | null;
  /** 获取区域中的公开对象 ID 列表 */
  getZonePublicObjectIds: (zoneKey: ViewZoneKey) => readonly string[];
  /** 获取 seat 归属区域 */
  getSeatZone: (seat: Seat, suffix: string) => ViewZoneState | null;
  /** 获取 seat 归属区域中的实例 ID 列表 */
  getSeatZoneCardIds: (seat: Seat, suffix: string) => string[];
  /** 获取区域中的实例 ID 列表 */
  getZoneCardIds: (zoneKey: ViewZoneKey) => string[];
  /** 获取共享解决区中指定 seat 拥有的实例 ID 列表 */
  getResolutionCardIdsForSeat: (seat: Seat) => string[];
  /** 获取 seat 指定成员槽位中的成员实例 ID */
  getSeatMemberSlotCardId: (seat: Seat, slot: SlotPosition) => string | null;
  /** 获取 seat 指定成员槽位下方附着能量实例 ID 列表 */
  getSeatMemberOverlayCardIds: (seat: Seat, slot: SlotPosition) => string[];
  /** 查找当前视角下卡牌所在区域 */
  findViewerCardZone: (cardId: string) => ZoneType | null;
  /** 根据卡牌实例解析其可落点区域信息 */
  resolveCardDropTarget: (targetCardId: string) => ParsedZoneId | null;
  /** 查找卡牌所在成员槽位 */
  getCardSlotPosition: (cardId: string) => SlotPosition | null;
  /** 检视区卡牌是否已正式公开 */
  isInspectionCardPubliclyRevealed: (cardId: string) => boolean;
  /** 当前视角是否处于自己的检视流程 */
  isInspectionOpenForViewer: () => boolean;
  /** 当前视角是否已完成换牌 */
  hasViewerCompletedMulligan: () => boolean;
  /** 获取指定 Live 卡的判定结果 */
  getLiveResultForCard: (cardId: string) => boolean | undefined;
  /** 获取当前视角玩家的 Live 分数 */
  getViewerLiveScore: () => number;
  /** 获取当前对手的 Live 分数 */
  getOpponentLiveScore: () => number;
  /** 当前视角玩家是否为 Live 胜者 */
  isViewerLiveWinner: () => boolean;
  /** 当前对手是否为 Live 胜者 */
  isOpponentLiveWinner: () => boolean;
  /** 当前 Live 是否平局 */
  isLiveDraw: () => boolean;
  /** 当前已确认分数的玩家数量 */
  getConfirmedScoreCount: () => number;
  /** 当前视角玩家是否已确认分数 */
  isViewerScoreConfirmed: () => boolean;
  /** 当前对手是否已确认分数 */
  isOpponentScoreConfirmed: () => boolean;

  // ============ 阶段十新增动作 ============
  /** 确认子阶段完成 */
  confirmSubPhase: (subPhase: SubPhase) => CommandDispatchResult;
  /** 确认 Live 判定结果 */
  confirmJudgment: (judgmentResults: Map<string, boolean>) => CommandDispatchResult;
  /** 确认分数（仅确认己方最终分数） */
  confirmScore: (adjustedScore?: number) => CommandDispatchResult;
  /** 选择成功 Live 卡移到成功区 */
  selectSuccessCard: (cardId: string) => CommandDispatchResult;
  /** 通过命令层移动牌桌卡牌 */
  moveTableCard: (
    cardId: string,
    fromZone: ZoneType,
    toZone: ZoneType,
    options?: { targetSlot?: SlotPosition; sourceSlot?: SlotPosition; position?: 'TOP' | 'BOTTOM' }
  ) => CommandDispatchResult;
  /** 将成员从一个槽位移动到另一个槽位 */
  moveMemberToSlot: (
    cardId: string,
    sourceSlot: SlotPosition,
    targetSlot: SlotPosition
  ) => CommandDispatchResult;
  /** 将能量附着到指定成员槽位 */
  attachEnergyToMember: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK,
    targetSlot: SlotPosition,
    sourceSlot?: SlotPosition
  ) => CommandDispatchResult;
  /** 从牌库打开检视流程 */
  openInspection: (
    sourceZone: ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK,
    count?: number
  ) => CommandDispatchResult;
  /** 将检视区卡牌放回来源区顶部 */
  moveInspectedCardToTop: (cardId: string) => CommandDispatchResult;
  /** 将检视区卡牌公开给双方 */
  revealInspectedCard: (cardId: string) => CommandDispatchResult;
  /** 将检视区卡牌放回来源区底部 */
  moveInspectedCardToBottom: (cardId: string) => CommandDispatchResult;
  /** 将检视区卡牌移动到指定区域 */
  moveInspectedCardToZone: (
    cardId: string,
    toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.EXILE_ZONE
  ) => CommandDispatchResult;
  /** 调整检视区卡牌顺序 */
  reorderInspectedCard: (cardId: string, toIndex: number) => CommandDispatchResult;
  /** 声明当前检视流程完成 */
  finishInspection: () => CommandDispatchResult;
  /** 翻开一张应援牌到解决区 */
  revealCheerCard: () => CommandDispatchResult;
  /** 将解决区卡牌移到指定区域 */
  moveResolutionCardToZone: (
    cardId: string,
    toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.MAIN_DECK | ZoneType.EXILE_ZONE,
    options?: { position?: 'TOP' | 'BOTTOM' }
  ) => CommandDispatchResult;
  /** 提交当前 Live 判定结果并推进子阶段 */
  confirmPerformanceOutcome: (success: boolean) => CommandDispatchResult;
  /** 主卡组顶抽一张到手牌 */
  drawCardToHand: () => CommandDispatchResult;
  /** 将能量卡组顶的一张能量牌放到能量区 */
  drawEnergyToZone: (cardId: string) => CommandDispatchResult;
  /** 将手牌一张放回主卡组顶 */
  returnHandCardToTop: (cardId: string) => CommandDispatchResult;
  /** 当前视角是否可使用指定联机命令 */
  canUseAction: (actionType: string) => boolean;
  /** 指定区域是否在命令作用域内 */
  isZoneInCommandScope: (command: string, zoneKey: ViewZoneKey) => boolean;
  /** 指定卡牌是否在命令作用域内 */
  isCardInCommandScope: (command: string, cardId: string) => boolean;
}

// ============================================
// Store 实现
// ============================================

const EMPTY_PUBLIC_OBJECT_IDS: readonly string[] = [];
const EMPTY_CARD_IDS: readonly string[] = [];

function getCardIdFromPublicObjectId(publicObjectId: string): string {
  return publicObjectId.startsWith('obj_') ? publicObjectId.slice(4) : publicObjectId;
}

interface StoreCommandOptions {
  readonly failureMessage: string;
  readonly successMessage?: string;
  readonly clearHoveredCardId?: string;
  readonly deselectCard?: boolean;
  readonly logError?: boolean;
}

export const useGameStore = create<GameStore>((set, get) => {
  // 创建游戏会话，设置事件监听
  const gameSession = createGameSession({
    onEvent: (event: GameSessionEvent) => {
      handleGameSessionEvent(event, get, set);
    },
  });

  const applyCommandSuccessEffects = (options: Omit<StoreCommandOptions, 'failureMessage'>): void => {
    if (options.clearHoveredCardId && get().ui.hoveredCardId === options.clearHoveredCardId) {
      get().setHoveredCard(null);
    }
    if (options.deselectCard) {
      get().deselectCard();
    }
    if (options.successMessage) {
      get().addLog(options.successMessage, 'action');
    }
  };

  const runStoreCommand = (
    command: GameCommand,
    options: StoreCommandOptions
  ): CommandDispatchResult => {
    if (
      dispatchRemoteCommand(command, options.failureMessage, () => {
        applyCommandSuccessEffects(options);
      })
    ) {
      return { success: false, pending: true };
    }

    const result = get().gameSession.executeCommand(command);
    if (!result.success) {
      if (options.logError) {
        get().addLog(`${options.failureMessage}: ${result.error}`, 'error');
      }
      return { success: false, error: result.error };
    }

    get().syncState();
    applyCommandSuccessEffects(options);
    return { success: true };
  };

  const runViewerCommand = (
    buildCommand: (playerId: string) => GameCommand,
    options: StoreCommandOptions
  ): CommandDispatchResult => {
    const viewingPlayerId = get().viewingPlayerId;
    if (!viewingPlayerId) {
      return { success: false, error: '未设置玩家' };
    }

    return runStoreCommand(buildCommand(viewingPlayerId), options);
  };

  return {
    // ============ 初始状态 ============
    playerViewState: null,
    cardDataRegistry: new Map(),
    gameSession,
    gameMode: GameMode.DEBUG,
    viewingPlayerId: null,
    remoteSession: null,
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

    advancePhase: () => {
      if (dispatchRemoteAdvancePhase()) {
        return;
      }

      const { gameSession } = get();

      const result = gameSession.advancePhase();
      
      if (result.success) {
        // 同步状态
        get().syncState();

        const currentPhase = get().getCurrentPhaseView();
        if (currentPhase) {
          const phaseName = getPhaseName(currentPhase);
          get().addLog(`进入 ${phaseName}`, 'phase');
          get().showPhaseBannerFn(phaseName);
          setTimeout(() => get().hidePhaseBanner(), 1500);
        }
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

    playMemberToSlot: (cardId, slot) => {
      return runViewerCommand((playerId) => createPlayMemberToSlotCommand(playerId, cardId, slot), {
        failureMessage: '成员登场失败',
        successMessage: `成员登场到 ${slot}`,
        deselectCard: true,
        logError: true,
      });
    },

    movePublicCardToWaitingRoom: (cardId, fromZone, sourceSlot) => {
      return runViewerCommand(
        (playerId) => createMovePublicCardToWaitingRoomCommand(playerId, cardId, fromZone, sourceSlot),
        {
        failureMessage: '公开区卡牌移动失败',
        clearHoveredCardId: cardId,
        }
      );
    },

    movePublicCardToHand: (cardId, fromZone, sourceSlot) => {
      return runViewerCommand(
        (playerId) => createMovePublicCardToHandCommand(playerId, cardId, fromZone, sourceSlot),
        {
        failureMessage: '公开区卡牌回手失败',
        clearHoveredCardId: cardId,
        }
      );
    },

    movePublicCardToEnergyDeck: (cardId, fromZone) => {
      return runViewerCommand((playerId) => createMovePublicCardToEnergyDeckCommand(playerId, cardId, fromZone), {
        failureMessage: '公开能量回到能量卡组失败',
        clearHoveredCardId: cardId,
      });
    },

    moveOwnedCardToZone: (cardId, fromZone, toZone, options) => {
      return runViewerCommand(
        (playerId) => createMoveOwnedCardToZoneCommand(playerId, cardId, fromZone, toZone, options),
        {
        failureMessage: '己方卡牌移动失败',
        clearHoveredCardId: cardId,
        }
      );
    },

    setLiveCard: (cardId, faceDown = true) => {
      return runViewerCommand((playerId) => createSetLiveCardCommand(playerId, cardId, faceDown), {
        failureMessage: '放置 Live 卡失败',
        successMessage: '放置卡牌到 Live 区',
        deselectCard: true,
        logError: true,
      });
    },

    mulligan: (cardIdsToMulligan) => {
      const { viewingPlayerId, gameSession } = get();
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const command = createMulliganCommand(viewingPlayerId, cardIdsToMulligan);
      const successMessage =
        cardIdsToMulligan.length > 0
          ? `换牌: 换掉 ${cardIdsToMulligan.length} 张卡牌`
          : '确认不换牌';

      if (
        dispatchRemoteCommand(command, '换牌失败', () => {
          get().addLog(successMessage, 'action');

          const currentPhase = useGameStore.getState().getCurrentPhaseView();
          if (currentPhase && currentPhase !== GamePhase.MULLIGAN_PHASE) {
            const phaseName = getPhaseName(currentPhase);
            useGameStore.getState().showPhaseBannerFn(phaseName);
            setTimeout(() => useGameStore.getState().hidePhaseBanner(), 1500);
          }
        })
      ) {
        return { success: false, pending: true };
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
        const currentPhase = get().getCurrentPhaseView();
        if (currentPhase && currentPhase !== GamePhase.MULLIGAN_PHASE) {
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
      return runViewerCommand((playerId) => createTapMemberCommand(playerId, cardId, slot), {
        failureMessage: '切换状态失败',
        successMessage: '切换成员状态',
        logError: true,
      });
    },

    tapEnergy: (cardId) => {
      return runViewerCommand((playerId) => createTapEnergyCommand(playerId, cardId), {
        failureMessage: '切换能量状态失败',
        successMessage: '切换能量状态',
        logError: true,
      });
    },

    endPhase: () => {
      void runViewerCommand((playerId) => createEndPhaseCommand(playerId), {
        failureMessage: '结束阶段失败',
        successMessage: '结束当前阶段',
        logError: true,
      });
    },

    setViewingPlayer: (playerId) => {
      if (get().remoteSession) {
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
      if (get().remoteSession) {
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

    connectRemoteSession: (session) => {
      set({
        remoteSession: session,
        viewingPlayerId: session.playerId,
        gameMode: GameMode.DEBUG,
      });
    },

    disconnectRemoteSession: () => {
      set({
        remoteSession: null,
        playerViewState: null,
        viewingPlayerId: null,
      });
    },

    syncRemoteState: async () => {
      const remoteSession = get().remoteSession;
      if (!remoteSession) {
        return;
      }

      const snapshot = await fetchRemoteSnapshot(
        remoteSession.source,
        remoteSession.matchId,
        remoteSession.seat
      );
      applyRemoteSnapshot(snapshot, set);
    },

    isRemoteMode: () => get().remoteSession !== null,

    connectRemoteDebugSession: (session) => {
      get().connectRemoteSession({
        ...session,
        source: 'DEBUG',
      });
    },

    disconnectRemoteDebugSession: () => {
      get().disconnectRemoteSession();
    },

    syncRemoteDebugState: async () => {
      await get().syncRemoteState();
    },

    isRemoteDebugMode: () => get().remoteSession?.source === 'DEBUG',

    syncState: () => {
      if (get().remoteSession) {
        return;
      }

      const { gameSession, viewingPlayerId } = get();
      if (!viewingPlayerId) {
        set((state) => ({
          playerViewState: null,
          ui: {
            ...state.ui,
            hoveredCardId: null,
          },
        }));
        return;
      }

      const nextPlayerViewState = gameSession.getPlayerViewState(viewingPlayerId);
      const normalizedPlayerViewState = normalizePlayerViewState(nextPlayerViewState);

      set((state) => ({
          playerViewState: normalizedPlayerViewState,
          ui: {
            ...state.ui,
            hoveredCardId: resolveHoveredCardId(state.ui.hoveredCardId, normalizedPlayerViewState),
          },
        }));
    },

    // ============ 查询辅助实现 ============

    getCardData: (cardCode) => {
      return get().cardDataRegistry.get(cardCode);
    },

    getCardImagePath: (cardCode) => {
      const cardData = get().cardDataRegistry.get(cardCode);
      return resolveCardImagePath(cardData ?? { cardCode, cardType: CardType.MEMBER });
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

    getCommandHint: (command) => {
      const permissionView = get().playerViewState?.permissions;
      if (!permissionView) {
        return null;
      }

      const availableCommands = permissionView.availableCommands ?? [];
      return availableCommands.find((hint) => hint.command === command) ?? null;
    },

    canUseAction: (actionType) => {
      return get().getCommandHint(actionType)?.enabled === true;
    },

    isZoneInCommandScope: (command, zoneKey) => {
      const hint = get().getCommandHint(command);
      if (!hint?.scope?.zoneKeys || hint.scope.zoneKeys.length === 0) {
        return false;
      }

      return hint.scope.zoneKeys.includes(zoneKey);
    },

    isCardInCommandScope: (command, cardId) => {
      const hint = get().getCommandHint(command);
      const objectIds = hint?.scope?.objectIds;
      if (!objectIds || objectIds.length === 0) {
        return false;
      }

      return objectIds.includes(createPublicObjectId(cardId));
    },

    getTurnCountView: () => {
      return get().playerViewState?.match.turnCount ?? null;
    },

    getCurrentPhaseView: () => {
      return (get().playerViewState?.match.phase as GamePhase | undefined) ?? null;
    },

    getCurrentSubPhaseView: () => {
      return (get().playerViewState?.match.subPhase as SubPhase | undefined) ?? null;
    },

    getActiveSeatView: () => {
      return get().playerViewState?.match.activeSeat ?? null;
    },

    getViewingPlayerIdentity: () => {
      const viewerSeat = get().getViewerSeat();
      if (!viewerSeat) {
        return null;
      }
      return get().getPlayerIdentityForSeat(viewerSeat);
    },

    getOpponentPlayerIdentity: () => {
      const viewerSeat = get().getViewerSeat();
      if (!viewerSeat) {
        return null;
      }
      return get().getPlayerIdentityForSeat(viewerSeat === 'FIRST' ? 'SECOND' : 'FIRST');
    },

    getPlayerIdentityForSeat: (seat) => {
      const participant = get().playerViewState?.match.participants[seat];
      return participant ?? null;
    },

    getCardViewObject: (cardId) => {
      const { playerViewState } = get();
      if (!playerViewState) return null;
      return playerViewState.objects[createPublicObjectId(cardId)] ?? null;
    },

    getCardFrontInfo: (cardId) => {
      return get().getCardViewObject(cardId)?.frontInfo ?? null;
    },

    getVisibleCardPresentation: (cardId) => {
      const frontInfo = get().getCardFrontInfo(cardId);
      if (!frontInfo) {
        return null;
      }

      const cardData = get().getCardData(frontInfo.cardCode) ?? buildFallbackCardData(frontInfo);
      return {
        instanceId: cardId,
        cardCode: frontInfo.cardCode,
        cardData,
        imagePath: get().getCardImagePath(frontInfo.cardCode),
      };
    },

    getKnownCardType: (cardId) => {
      return get().getCardViewObject(cardId)?.cardType ?? null;
    },

    getZonePublicObjectIds: (zoneKey) => {
      const { playerViewState } = get();
      if (!playerViewState) {
        return EMPTY_PUBLIC_OBJECT_IDS;
      }
      return playerViewState.table.zones[zoneKey]?.objectIds ?? EMPTY_PUBLIC_OBJECT_IDS;
    },

    getSeatZone: (seat, suffix) => {
      const { playerViewState } = get();
      if (!playerViewState) return null;
      return playerViewState.table.zones[`${seat}_${suffix}` as ViewZoneKey] ?? null;
    },

    getSeatZoneCardIds: (seat, suffix) => {
      return get().getZoneCardIds(`${seat}_${suffix}` as ViewZoneKey);
    },

    getZoneCardIds: (zoneKey) => {
      const objectIds = get().getZonePublicObjectIds(zoneKey);
      if (objectIds.length === 0) {
        return EMPTY_CARD_IDS as string[];
      }
      return objectIds.map(getCardIdFromPublicObjectId);
    },

    getResolutionCardIdsForSeat: (seat) => {
      const { playerViewState } = get();
      if (!playerViewState) {
        return EMPTY_CARD_IDS as string[];
      }

      const resolutionObjectIds =
        playerViewState.table.zones.SHARED_RESOLUTION_ZONE?.objectIds ?? EMPTY_PUBLIC_OBJECT_IDS;
      if (resolutionObjectIds.length === 0) {
        return EMPTY_CARD_IDS as string[];
      }

      return resolutionObjectIds
        .filter((publicObjectId) => playerViewState.objects[publicObjectId]?.ownerSeat === seat)
        .map(getCardIdFromPublicObjectId);
    },

    getSeatMemberSlotCardId: (seat, slot) => {
      const zone = get().getSeatZone(seat, `MEMBER_${slot}`);
      const publicObjectId = zone?.slotMap?.[slot] ?? null;
      return publicObjectId ? getCardIdFromPublicObjectId(publicObjectId) : null;
    },

    getSeatMemberOverlayCardIds: (seat, slot) => {
      const zone = get().getSeatZone(seat, `MEMBER_${slot}`);
      const overlayIds = zone?.overlays?.[slot] ?? EMPTY_PUBLIC_OBJECT_IDS;
      if (overlayIds.length === 0) {
        return EMPTY_CARD_IDS as string[];
      }
      return overlayIds.map(getCardIdFromPublicObjectId);
    },

    findViewerCardZone: (cardId) => {
      return findCardLocationInView(get().playerViewState, cardId)?.zoneType ?? null;
    },

    resolveCardDropTarget: (targetCardId) => {
      return findCardLocationInView(get().playerViewState, targetCardId);
    },

    getCardSlotPosition: (cardId) => {
      const location = findCardLocationInView(get().playerViewState, cardId);
      return location?.zoneType === ZoneType.MEMBER_SLOT ? location.slotPosition ?? null : null;
    },

    isInspectionCardPubliclyRevealed: (cardId) => {
      return get().getCardViewObject(cardId)?.publiclyRevealed === true;
    },

    isInspectionOpenForViewer: () => {
      const { playerViewState } = get();
      return (
        playerViewState?.match.window?.windowType === 'INSPECTION' &&
        get().getCommandHint(GameCommandType.FINISH_INSPECTION) !== null
      );
    },

    hasViewerCompletedMulligan: () => {
      const { playerViewState } = get();
      if (!playerViewState) {
        return false;
      }

      if (playerViewState.match.phase !== GamePhase.MULLIGAN_PHASE) {
        return true;
      }

      if (
        playerViewState.match.subPhase === SubPhase.MULLIGAN_SECOND_PLAYER &&
        playerViewState.match.viewerSeat === 'FIRST'
      ) {
        return true;
      }

      return false;
    },

    getLiveResultForCard: (cardId) => {
      return get().getCardViewObject(cardId)?.judgmentResult;
    },

    getViewerLiveScore: () => {
      const viewerSeat = get().getViewerSeat();
      return viewerSeat ? get().playerViewState?.match.liveResult?.scores[viewerSeat] ?? 0 : 0;
    },

    getOpponentLiveScore: () => {
      const viewerSeat = get().getViewerSeat();
      if (!viewerSeat) {
        return 0;
      }
      const opponentSeat: Seat = viewerSeat === 'FIRST' ? 'SECOND' : 'FIRST';
      return get().playerViewState?.match.liveResult?.scores[opponentSeat] ?? 0;
    },

    isViewerLiveWinner: () => {
      const viewerSeat = get().getViewerSeat();
      return viewerSeat
        ? get().playerViewState?.match.liveResult?.winnerSeats.includes(viewerSeat) ?? false
        : false;
    },

    isOpponentLiveWinner: () => {
      const viewerSeat = get().getViewerSeat();
      if (!viewerSeat) {
        return false;
      }
      const opponentSeat: Seat = viewerSeat === 'FIRST' ? 'SECOND' : 'FIRST';
      return get().playerViewState?.match.liveResult?.winnerSeats.includes(opponentSeat) ?? false;
    },

    isLiveDraw: () => {
      return (get().playerViewState?.match.liveResult?.winnerSeats.length ?? 0) === 2;
    },

    getConfirmedScoreCount: () => {
      return get().playerViewState?.match.liveResult?.confirmedSeats.length ?? 0;
    },

    isViewerScoreConfirmed: () => {
      const viewerSeat = get().getViewerSeat();
      return viewerSeat
        ? get().playerViewState?.match.liveResult?.confirmedSeats.includes(viewerSeat) ?? false
        : false;
    },

    isOpponentScoreConfirmed: () => {
      const viewerSeat = get().getViewerSeat();
      if (!viewerSeat) {
        return false;
      }
      const opponentSeat: Seat = viewerSeat === 'FIRST' ? 'SECOND' : 'FIRST';
      return get().playerViewState?.match.liveResult?.confirmedSeats.includes(opponentSeat) ?? false;
    },

    // ============ 阶段十新增动作实现 ============

    confirmSubPhase: (subPhase) => {
      return runViewerCommand((playerId) => createConfirmStepCommand(playerId, subPhase), {
        failureMessage: '确认子阶段失败',
        successMessage: `确认子阶段完成: ${subPhase}`,
        logError: true,
      });
    },

    confirmJudgment: (judgmentResults) => {
      return runViewerCommand((playerId) => createSubmitJudgmentCommand(playerId, judgmentResults), {
        failureMessage: '确认判定失败',
        successMessage: '确认 Live 判定结果',
        logError: true,
      });
    },

    confirmScore: (adjustedScore) => {
      return runViewerCommand((playerId) => createSubmitScoreCommand(playerId, adjustedScore), {
        failureMessage: '确认分数失败',
        successMessage: `确认分数${adjustedScore !== undefined ? `: ${adjustedScore}` : ''}`,
        logError: true,
      });
    },

    selectSuccessCard: (cardId) => {
      return runViewerCommand((playerId) => createSelectSuccessLiveCommand(playerId, cardId), {
        failureMessage: '选择成功卡失败',
        successMessage: '选择成功 Live 卡移到成功区',
        logError: true,
      });
    },

    moveTableCard: (cardId, fromZone, toZone, options) => {
      return runViewerCommand(
        (playerId) => createMoveTableCardCommand(playerId, cardId, fromZone, toZone, options),
        {
        failureMessage: '移动卡牌失败',
        clearHoveredCardId: cardId,
        }
      );
    },

    moveMemberToSlot: (cardId, sourceSlot, targetSlot) => {
      return runViewerCommand(
        (playerId) => createMoveMemberToSlotCommand(playerId, cardId, sourceSlot, targetSlot),
        {
        failureMessage: '成员换位失败',
        clearHoveredCardId: cardId,
        }
      );
    },

    attachEnergyToMember: (cardId, fromZone, targetSlot, sourceSlot) => {
      return runViewerCommand(
        (playerId) =>
          createAttachEnergyToMemberCommand(playerId, cardId, fromZone, targetSlot, sourceSlot),
        {
        failureMessage: '附着能量失败',
        clearHoveredCardId: cardId,
        }
      );
    },

    openInspection: (sourceZone, count = 1) => {
      return runViewerCommand((playerId) => createOpenInspectionCommand(playerId, sourceZone, count), {
        failureMessage: '开始检视失败',
        successMessage: `开始检视: ${sourceZone} 顶 ${count} 张`,
        logError: true,
      });
    },

    moveInspectedCardToTop: (cardId) => {
      return runViewerCommand((playerId) => createMoveInspectedCardToTopCommand(playerId, cardId), {
        failureMessage: '检视牌放回顶部失败',
        successMessage: '检视牌放回顶部',
        clearHoveredCardId: cardId,
        logError: true,
      });
    },

    revealInspectedCard: (cardId) => {
      return runViewerCommand((playerId) => createRevealInspectedCardCommand(playerId, cardId), {
        failureMessage: '公开检视牌失败',
        successMessage: '公开检视牌',
        logError: true,
      });
    },

    moveInspectedCardToBottom: (cardId) => {
      return runViewerCommand((playerId) => createMoveInspectedCardToBottomCommand(playerId, cardId), {
        failureMessage: '检视牌放回底部失败',
        successMessage: '检视牌放回底部',
        clearHoveredCardId: cardId,
        logError: true,
      });
    },

    moveInspectedCardToZone: (cardId, toZone) => {
      return runViewerCommand((playerId) => createMoveInspectedCardToZoneCommand(playerId, cardId, toZone), {
        failureMessage: '检视牌移动失败',
        successMessage: `检视牌移动到 ${toZone}`,
        clearHoveredCardId: cardId,
        logError: true,
      });
    },

    reorderInspectedCard: (cardId, toIndex) => {
      return runViewerCommand((playerId) => createReorderInspectedCardCommand(playerId, cardId, toIndex), {
        failureMessage: '调整检视顺序失败',
        successMessage: `调整检视顺序到位置 ${toIndex + 1}`,
        logError: true,
      });
    },

    finishInspection: () => {
      return runViewerCommand((playerId) => createFinishInspectionCommand(playerId), {
        failureMessage: '检视流程结束失败',
        successMessage: '检视流程结束',
        logError: true,
      });
    },

    revealCheerCard: () => {
      return runViewerCommand((playerId) => createRevealCheerCardCommand(playerId), {
        failureMessage: '翻开应援牌失败',
        successMessage: '翻开一张应援牌',
        logError: true,
      });
    },

    moveResolutionCardToZone: (cardId, toZone, options) => {
      return runViewerCommand(
        (playerId) =>
          createMoveResolutionCardToZoneCommand(playerId, cardId, toZone, options?.position),
        {
        failureMessage: '解决区卡牌移动失败',
        successMessage: `解决区卡牌移动到 ${toZone}`,
        clearHoveredCardId: cardId,
        logError: true,
        }
      );
    },

    confirmPerformanceOutcome: (success) => {
      return runViewerCommand((playerId) => createConfirmPerformanceOutcomeCommand(playerId, success), {
        failureMessage: '提交 Live 判定结果失败',
        successMessage: success ? '确认 Live 成功' : '确认 Live 失败',
        logError: true,
      });
    },

    drawCardToHand: () => {
      return runViewerCommand((playerId) => createDrawCardToHandCommand(playerId), {
        failureMessage: '抽卡失败',
        successMessage: '抽一张到手牌',
        logError: true,
      });
    },

    drawEnergyToZone: (cardId) => {
      return runViewerCommand((playerId) => createDrawEnergyToZoneCommand(playerId, cardId), {
        failureMessage: '放置能量失败',
        clearHoveredCardId: cardId,
        logError: true,
      });
    },

    returnHandCardToTop: (cardId) => {
      return runViewerCommand((playerId) => createReturnHandCardToTopCommand(playerId, cardId), {
        failureMessage: '放回顶部失败',
        successMessage: '手牌放回主卡组顶',
        clearHoveredCardId: cardId,
        logError: true,
      });
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
  playerViewState: PlayerViewState | null
): string | null {
  if (!hoveredCardId || !playerViewState) {
    return null;
  }

  const viewObject = playerViewState.objects[createPublicObjectId(hoveredCardId)];
  if (!viewObject) {
    return null;
  }

  return viewObject.surface === 'FRONT' ? hoveredCardId : null;
}

function buildFallbackCardData(frontInfo: ViewFrontCardInfo): AnyCardData {
  switch (frontInfo.cardType) {
    case CardType.MEMBER:
      return {
        cardCode: frontInfo.cardCode,
        name: frontInfo.name,
        cardType: CardType.MEMBER,
        cost: frontInfo.cost ?? 0,
        blade: 0,
        hearts: Array.isArray(frontInfo.hearts)
          ? (frontInfo.hearts as MemberCardData['hearts'])
          : [],
        bladeHearts: frontInfo.bladeHearts as MemberCardData['bladeHearts'],
        cardText: frontInfo.text,
      };

    case CardType.LIVE:
      return {
        cardCode: frontInfo.cardCode,
        name: frontInfo.name,
        cardType: CardType.LIVE,
        score: frontInfo.score ?? 0,
        requirements: frontInfo.requiredHearts
          ? (frontInfo.requiredHearts as LiveCardData['requirements'])
          : createHeartRequirement({}, 0),
        bladeHearts: frontInfo.bladeHearts as LiveCardData['bladeHearts'],
        cardText: frontInfo.text,
      };

    case CardType.ENERGY:
    default:
      return {
        cardCode: frontInfo.cardCode,
        name: frontInfo.name,
        cardType: CardType.ENERGY,
        cardText: frontInfo.text,
      };
  }
}

function findCardLocationInView(
  playerViewState: PlayerViewState | null,
  cardId: string
): ParsedZoneId | null {
  if (!playerViewState) {
    return null;
  }

  const publicObjectId = createPublicObjectId(cardId);
  for (const zone of Object.values(playerViewState.table.zones)) {
    if (!isZoneType(zone.zone)) {
      continue;
    }

    if (zone.objectIds?.includes(publicObjectId)) {
      return { zoneType: zone.zone };
    }

    for (const [slot, occupantId] of Object.entries(zone.slotMap ?? {})) {
      if (occupantId === publicObjectId) {
        return {
          zoneType: zone.zone,
          slotPosition: parseSlotPosition(slot),
        };
      }
    }

    for (const [slot, overlayIds] of Object.entries(zone.overlays ?? {})) {
      if (overlayIds.includes(publicObjectId)) {
        return {
          zoneType: zone.zone,
          slotPosition: parseSlotPosition(slot),
        };
      }
    }
  }

  return null;
}

function parseSlotPosition(slot: string): SlotPosition | undefined {
  return Object.values(SlotPosition).includes(slot as SlotPosition)
    ? (slot as SlotPosition)
    : undefined;
}

function isZoneType(zone: string): zone is ZoneType {
  return Object.values(ZoneType).includes(zone as ZoneType);
}

function applyRemoteSnapshot(
  snapshot: RemoteSnapshot,
  set: (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void
): void {
  const normalizedPlayerViewState = normalizePlayerViewState(snapshot.playerViewState);
  set((state) => ({
    remoteSession: state.remoteSession
      ? {
          ...state.remoteSession,
          playerId: snapshot.playerId,
          seat: snapshot.seat,
        }
      : state.remoteSession,
    viewingPlayerId: snapshot.playerId,
    playerViewState: normalizedPlayerViewState,
    ui: {
      ...state.ui,
      hoveredCardId: resolveHoveredCardId(
        state.ui.hoveredCardId,
        normalizedPlayerViewState
      ),
    },
  }));
}

function normalizePlayerViewState(playerViewState: PlayerViewState | null): PlayerViewState | null {
  if (!playerViewState) {
    return null;
  }

  return {
    ...playerViewState,
    permissions: {
      ...playerViewState.permissions,
      availableCommands: playerViewState.permissions?.availableCommands ?? [],
    },
  };
}

function dispatchRemoteCommand(
  command: GameCommand,
  failureMessage: string,
  onSuccess?: () => void
): boolean {
  const store = useGameStore.getState();
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return false;
  }

  void executeRemoteCommand(
    remoteSession.source,
    remoteSession.matchId,
    command,
    remoteSession.seat
  )
    .then((result) => {
      if (!result.success || !result.snapshot) {
        useGameStore.getState().addLog(
          `${failureMessage}: ${result.error ?? '服务端拒绝了该操作'}`,
          'error'
        );
        return;
      }

      applyRemoteSnapshot(result.snapshot, useGameStore.setState);
      onSuccess?.();
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
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return false;
  }

  void advanceRemotePhase(
    remoteSession.source,
    remoteSession.matchId,
    remoteSession.seat
  )
    .then((result) => {
      if (!result.success || !result.snapshot) {
        useGameStore.getState().addLog(
          `阶段推进失败: ${result.error ?? '服务端拒绝了该操作'}`,
          'error'
        );
        return;
      }

      applyRemoteSnapshot(result.snapshot, useGameStore.setState);
      const currentPhase = result.snapshot.playerViewState.match.phase as GamePhase | undefined;
      if (currentPhase) {
        const phaseName = getPhaseName(currentPhase);
        useGameStore.getState().addLog(`进入 ${phaseName}`, 'phase');
        useGameStore.getState().showPhaseBannerFn(phaseName);
        setTimeout(() => useGameStore.getState().hidePhaseBanner(), 1500);
      }
    })
    .catch((error) => {
      useGameStore.getState().addLog(
        `阶段推进失败: ${error instanceof Error ? error.message : '网络请求失败'}`,
        'error'
      );
    });

  return true;
}
