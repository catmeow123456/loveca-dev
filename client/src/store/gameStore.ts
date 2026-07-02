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
import {
  GameSession,
  createGameSession,
  type GameSessionEvent,
} from '@game/application/game-session';
import {
  createPublicObjectId,
  type PlayerViewState,
  type Seat,
  type ViewCommandHint,
  type ViewFrontCardInfo,
  type ViewHeartRequirement,
  type ViewMemberModifierDelta,
  type ViewCardObject,
  type ViewZoneKey,
  type ViewZoneState,
  shouldIgnoreRemoteSnapshotBySeq,
  type MatchRecordReplayView,
  type MatchMode,
  type PublicEvent,
  type PublicEventsResponse,
} from '@game/online';
import {
  GameCommandType,
  type GameCommand,
  createEndPhaseCommand,
  createConfirmEffectStepCommand,
  createConfirmCostPaymentCommand,
  createMulliganCommand,
  createConfirmStepCommand,
  createConfirmPerformanceOutcomeCommand,
  createDrawCardToHandCommand,
  createDrawEnergyToZoneCommand,
  createSetLiveCardCommand,
  createFinishInspectionCommand,
  createFinishInspectionWithArrangementCommand,
  createAttachEnergyToMemberCommand,
  createActivateAbilityCommand,
  createMoveInspectedCardToBottomCommand,
  createMoveCardToInspectionCommand,
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
import {
  SlotPosition,
  GamePhase,
  SubPhase,
  ZoneType,
  CardType,
  GameMode,
} from '@game/shared/types/enums';
import { getPhaseName } from '@game/shared/phase-config';
import { preloadImage, resolveCardImagePath } from '@/lib/imageService';
import {
  createBattleFeedbackEvent,
  isBattleFeedbackEventExpired,
  type BattleDragActionHint,
  type BattleFeedbackEvent,
  type BattleFeedbackInput,
} from '@/lib/battleActionFeedback';
import { type ParsedZoneId } from '@/lib/zoneUtils';
import {
  advanceRemotePhase,
  acceptRemoteUndoRequest,
  createRemoteUndoRequest,
  executeRemoteCommand,
  fetchRemotePublicEvents,
  fetchRemoteSnapshot,
  rejectRemoteUndoRequest,
  undoRemoteMatch,
  type RemoteSessionSource,
  type RemoteSnapshot,
} from '@/lib/remoteMatchClient';
import { leaveSolitaireMatch } from '@/lib/solitaireMatchClient';
import {
  deriveBattleSurfaceCapabilities,
  type BattleSurfaceCapabilities,
} from './battleSurfaceCapabilities';

const REMOTE_SNAPSHOT_PRELOAD_BUDGET_MS = 180;
const REMOTE_SNAPSHOT_LATENCY_PROBE_STORAGE_KEY = 'loveca:remoteSnapshotLatencyProbe';

const EMPTY_PUBLIC_BATTLE_LOG: PublicBattleLogState = {
  matchId: null,
  events: [],
  cursorSeq: 0,
  currentPublicSeq: 0,
  lastReadSeq: 0,
  unreadCount: 0,
  isPanelOpen: false,
  loadState: 'idle',
  error: null,
};

interface RemoteSnapshotLatencyProbe {
  readonly context: string;
  readonly matchId: string;
  readonly snapshotSeq: number;
  readonly responseAt: number;
  applyStartAt?: number;
  applyEndAt?: number;
  preloadStartAt?: number;
  preloadEndAt?: number;
  nextPaintAt?: number;
  reported?: boolean;
}

const remoteSessionOperationQueues = new Map<string, Promise<void>>();

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
  readonly modifierDelta?: ViewMemberModifierDelta;
  readonly eventOnlyMissingData?: boolean;
}

export type SelectedCardDetail =
  | { readonly kind: 'visible'; readonly cardId: string }
  | {
      readonly kind: 'public-event-card';
      readonly cardCode: string;
      readonly publicObjectId?: string;
    };

export interface PublicBattleLogState {
  readonly matchId: string | null;
  readonly events: readonly PublicEvent[];
  readonly cursorSeq: number;
  readonly currentPublicSeq: number;
  readonly lastReadSeq: number;
  readonly unreadCount: number;
  readonly isPanelOpen: boolean;
  readonly loadState: 'idle' | 'loading' | 'error';
  readonly error: string | null;
}

export interface CommandDispatchResult {
  readonly success: boolean;
  readonly error?: string;
  readonly pending?: boolean;
}

export interface PlayMemberToSlotOptions {
  readonly relayMode?: 'SINGLE' | 'DOUBLE';
  readonly relayReplacementSlots?: readonly SlotPosition[];
}

export interface RemoteUndoResponseOptions {
  readonly grantContinuous?: boolean;
}

export interface BattleAnimationOcclusion {
  readonly eventId: string;
  readonly objectId: string;
}

export interface UIState {
  /** 当前选中的卡牌 ID */
  selectedCardId: string | null;
  /** 当前悬停的卡牌 ID (用于详情浮窗) */
  hoveredCardId: string | null;
  /** 当前打开的卡牌详情来源 */
  cardDetail: SelectedCardDetail | null;
  /** 当前是否处于拖拽中（用于区域高亮/变暗提示） */
  isDragging: boolean;
  /** 高亮的区域 */
  highlightedZones: string[];
  /** 当前拖拽落点语义提示 */
  dragActionHint: BattleDragActionHint | null;
  /** 对局动作短回执 */
  battleFeedbackEvents: BattleFeedbackEvent[];
  /** 正在由动画层接管显示的卡牌对象 */
  battleAnimationOcclusions: BattleAnimationOcclusion[];
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

export interface ReplayReadonlySessionState {
  readonly matchId: string;
  readonly sourceMatchMode: MatchMode;
  readonly viewerSeat: Seat;
  readonly viewerPlayerId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly recordStatus: string;
  readonly recordCompleteness: string;
  readonly partialReasonSummary: string | null;
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
  /** 免费登场兜底开关。远程联机时只作为 PLAY_MEMBER_TO_SLOT.freePlay 的本地偏好。 */
  freePlayEnabled: boolean;
  /** UI 状态 */
  ui: UIState;
  /** 服务端公开对局日志 */
  publicBattleLog: PublicBattleLogState;
  /** 当前视角玩家 ID */
  viewingPlayerId: string | null;
  /** 当前远程联机会话 */
  remoteSession: RemoteSessionState | null;
  /** 当前历史回放只读会话 */
  replaySession: ReplayReadonlySessionState | null;

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
  /** 退出本地对局并清空当前桌面状态 */
  leaveLocalGame: () => void;
  /** 退出当前桌面对局；远程对墙打会先请求服务端封存记录 */
  leaveCurrentGame: () => Promise<void>;
  /** 推进阶段 */
  advancePhase: () => void;
  /** 是否可以撤销本地上一步 */
  canUndoLastStep: () => boolean;
  /** 撤销本地上一步 */
  undoLastStep: () => CommandDispatchResult;
  /** 处理正式联机撤销请求 */
  respondRemoteUndoRequest: (
    requestId: string,
    accepted: boolean,
    options?: RemoteUndoResponseOptions
  ) => CommandDispatchResult;
  /** 选择卡牌 */
  selectCard: (cardId: string | null) => void;
  /** 取消选择 */
  deselectCard: () => void;
  /** 通过命令层将手牌成员登场到成员槽位 */
  playMemberToSlot: (
    cardId: string,
    slot: SlotPosition,
    options?: PlayMemberToSlotOptions
  ) => CommandDispatchResult;
  /** 发动舞台上卡牌的起动效果 */
  activateCardAbility: (cardId: string, abilityId: string) => CommandDispatchResult;
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
    options?: { targetSlot?: SlotPosition; position?: 'TOP' | 'BOTTOM'; asMemberBelow?: boolean }
  ) => CommandDispatchResult;
  /** 放置 Live 卡到 Live 区 */
  setLiveCard: (cardId: string, faceDown?: boolean) => CommandDispatchResult;
  /** 确认当前卡牌效果步骤 */
  confirmEffectStep: (
    effectId: string,
    selectedCardId?: string | null,
    selectedSlot?: SlotPosition | null,
    resolveInOrder?: boolean,
    selectedOptionId?: string | null,
    selectedCardIds?: readonly string[],
    selectedNumber?: number | null,
    stageFormationMoveHistory?: readonly {
      readonly cardId: string;
      readonly toSlot: SlotPosition;
    }[],
    stageFormationPlacements?: readonly {
      readonly cardId: string;
      readonly toSlot: SlotPosition;
    }[]
  ) => CommandDispatchResult;
  /** 确认费用支付 */
  confirmCostPayment: (
    paymentId: string,
    energyCardIds: readonly string[]
  ) => CommandDispatchResult;
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
  /** 设置当前卡牌详情来源 */
  setCardDetail: (detail: SelectedCardDetail | null) => void;
  /** 打开/关闭公开对局日志面板 */
  setPublicBattleLogPanelOpen: (open: boolean) => void;
  /** 主动拉取公开对局日志 */
  syncPublicBattleLog: () => Promise<void>;
  /** 同步状态（从 GameSession 获取最新状态） */
  syncState: () => void;
  /** 设置拖拽提示状态（高亮推荐区域/变暗其他区域） */
  setDragHints: (isDragging: boolean, highlightedZones?: string[]) => void;
  /** 设置当前拖拽动作语义提示 */
  setBattleDragActionHint: (hint: BattleDragActionHint | null) => void;
  /** 推入一条对局动作短回执 */
  pushBattleFeedback: (feedback: BattleFeedbackInput) => string;
  /** 移除一条对局动作短回执 */
  dismissBattleFeedback: (feedbackId: string) => void;
  /** 登记一批由动画层临时接管显示的卡牌对象 */
  addBattleAnimationOcclusions: (occlusions: readonly BattleAnimationOcclusion[]) => void;
  /** 移除一条动画遮挡登记 */
  removeBattleAnimationOcclusion: (eventId: string) => void;
  /** 设置游戏模式（支持游戏内切换） */
  setGameMode: (mode: GameMode) => void;
  /** 设置免费登场兜底 */
  setFreePlayEnabled: (enabled: boolean) => void;
  /** 进入历史对局只读回放 */
  enterReadonlyReplay: (
    replay: MatchRecordReplayView,
    options?: { shouldCommit?: () => boolean }
  ) => Promise<void>;
  /** 离开历史对局只读回放 */
  leaveReadonlyReplay: () => void;
  /** 当前是否处于历史对局只读回放 */
  isReadonlyReplayMode: () => boolean;
  /** 接入远程联机会话 */
  connectRemoteSession: (session: RemoteSessionState) => void;
  /** 将远程快照应用到当前联机会话 */
  applyRemoteSnapshot: (snapshot: RemoteSnapshot) => Promise<void>;
  /** 断开远程联机会话 */
  disconnectRemoteSession: () => void;
  /** 主动拉取远程联机快照 */
  syncRemoteState: () => Promise<void>;
  /** 当前是否处于远程联机模式 */
  isRemoteMode: () => boolean;
  /** 获取当前共享对战桌面的 UI 能力 */
  getBattleSurfaceCapabilities: () => BattleSurfaceCapabilities;
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
  /** 通过已公开事件中的 cardCode 获取只读卡牌展示数据 */
  getPublicEventCardPresentation: (
    cardCode: string,
    publicObjectId?: string
  ) => VisibleCardPresentation;
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
  /** 获取 seat 指定成员槽位下方堆叠成员实例 ID 列表 */
  getSeatMemberBelowCardIds: (seat: Seat, slot: SlotPosition) => string[];
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
  /** 接受当前自动 Live 判定并推进判定子阶段 */
  acceptAutomaticJudgment: () => CommandDispatchResult;
  /** 确认 Live 判定结果 */
  confirmJudgment: (judgmentResults: Map<string, boolean>) => CommandDispatchResult;
  /** 确认分数（仅确认己方最终分数） */
  confirmScore: (adjustedScore?: number) => CommandDispatchResult;
  /** 选择成功 Live 卡移到成功区 */
  selectSuccessCard: (cardId: string) => CommandDispatchResult;
  /** 跳过当前成功 Live 入区，剩余 Live 在结算收尾进入休息室 */
  skipSuccessLiveSelection: () => CommandDispatchResult;
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
  /** 将手牌/休息室卡牌移入当前检视区 */
  moveCardToInspection: (
    cardId: string,
    fromZone: ZoneType.HAND | ZoneType.WAITING_ROOM
  ) => CommandDispatchResult;
  /** 调整检视区卡牌顺序 */
  reorderInspectedCard: (cardId: string, toIndex: number) => CommandDispatchResult;
  /** 按声明顺序一次性整理剩余检视牌并结束检视 */
  finishInspectionWithArrangement: (
    cardIds: readonly string[],
    toZone:
      | ZoneType.HAND
      | ZoneType.WAITING_ROOM
      | ZoneType.EXILE_ZONE
      | ZoneType.MAIN_DECK
      | ZoneType.ENERGY_DECK,
    options?: { position?: 'TOP' | 'BOTTOM' }
  ) => CommandDispatchResult;
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
      handleGameSessionEvent(event, get);
    },
  });

  const isReadonlyReplayMode = (): boolean => get().replaySession !== null;

  const rejectReadonlyReplayCommand = (): CommandDispatchResult => ({
    success: false,
    error: '历史回放为只读模式，不能提交操作',
  });

  const applyCommandSuccessEffects = (
    options: Omit<StoreCommandOptions, 'failureMessage'>
  ): void => {
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
    if (isReadonlyReplayMode()) {
      return rejectReadonlyReplayCommand();
    }

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
      get().pushBattleFeedback({
        tone: 'error',
        label: options.failureMessage,
        detail: result.error,
      });
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
    if (isReadonlyReplayMode()) {
      return rejectReadonlyReplayCommand();
    }

    const viewingPlayerId = get().viewingPlayerId;
    if (!viewingPlayerId) {
      return { success: false, error: '未设置玩家' };
    }

    return runStoreCommand(buildCommand(viewingPlayerId), options);
  };

  const runRemoteCommandSequence = (
    entries: readonly { readonly command: GameCommand; readonly options: StoreCommandOptions }[]
  ): boolean => {
    if (isReadonlyReplayMode()) {
      warnReplayGuardBypass('runRemoteCommandSequence');
      return true;
    }

    if (!get().remoteSession || entries.length === 0) {
      return false;
    }

    const dispatchAt = (index: number): void => {
      const entry = entries[index];
      if (!entry) {
        return;
      }

      dispatchRemoteCommand(entry.command, entry.options.failureMessage, () => {
        applyCommandSuccessEffects(entry.options);
        dispatchAt(index + 1);
      });
    };

    dispatchAt(0);
    return true;
  };

  return {
    // ============ 初始状态 ============
    playerViewState: null,
    cardDataRegistry: new Map(),
    gameSession,
    gameMode: GameMode.DEBUG,
    freePlayEnabled: false,
    viewingPlayerId: null,
    remoteSession: null,
    replaySession: null,
    publicBattleLog: EMPTY_PUBLIC_BATTLE_LOG,
    ui: {
      selectedCardId: null,
      hoveredCardId: null,
      cardDetail: null,
      isDragging: false,
      highlightedZones: [],
      dragActionHint: null,
      battleFeedbackEvents: [],
      battleAnimationOcclusions: [],
      showPhaseBanner: false,
      phaseBannerText: '',
      waitingForInput: false,
      inputRequestType: null,
      logs: [],
    },

    // ============ 动作实现 ============

    loadCardData: (cards) => {
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
      set({ viewingPlayerId: player1Id, replaySession: null });

      // 同步状态
      get().syncState();
      get().addLog(`游戏创建成功: ${player1Name} vs ${player2Name}`, 'info');
    },

    initializeGame: (player1Deck, player2Deck) => {
      const { gameSession } = get();
      set({ replaySession: null });

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

    leaveLocalGame: () => {
      if (get().remoteSession) {
        return;
      }

      set({
        playerViewState: null,
        viewingPlayerId: null,
        replaySession: null,
        gameMode: GameMode.DEBUG,
        freePlayEnabled: false,
        publicBattleLog: EMPTY_PUBLIC_BATTLE_LOG,
        ui: {
          selectedCardId: null,
          hoveredCardId: null,
          cardDetail: null,
          isDragging: false,
          highlightedZones: [],
          dragActionHint: null,
          battleFeedbackEvents: [],
          battleAnimationOcclusions: [],
          showPhaseBanner: false,
          phaseBannerText: '',
          waitingForInput: false,
          inputRequestType: null,
          logs: [],
        },
      });
      get().gameSession.gameMode = GameMode.DEBUG;
      get().gameSession.localFreePlay = false;
    },

    leaveCurrentGame: async () => {
      const remoteSession = get().remoteSession;
      if (!remoteSession) {
        get().leaveLocalGame();
        return;
      }

      if (remoteSession.source === 'SOLITAIRE') {
        try {
          await leaveSolitaireMatch(remoteSession.matchId);
        } catch (error) {
          get().addLog(
            `离开对墙打失败: ${error instanceof Error ? error.message : String(error)}`,
            'error'
          );
        }
      }

      get().disconnectRemoteSession();
    },

    advancePhase: () => {
      if (isReadonlyReplayMode()) {
        return;
      }

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

    canUndoLastStep: () => {
      if (isReadonlyReplayMode()) {
        return false;
      }
      const capabilities = get().getBattleSurfaceCapabilities();
      if (capabilities.undoPolicy === 'LOCAL_IMMEDIATE') {
        return get().gameSession.canUndoLastStep();
      }
      if (
        capabilities.undoPolicy === 'REMOTE_IMMEDIATE' ||
        capabilities.undoPolicy === 'REMOTE_REQUEST'
      ) {
        return get().playerViewState?.match.undo?.canUndoNow === true;
      }
      return false;
    },

    undoLastStep: () => {
      if (isReadonlyReplayMode()) {
        return rejectReadonlyReplayCommand();
      }
      const capabilities = get().getBattleSurfaceCapabilities();
      if (get().remoteSession) {
        if (capabilities.undoPolicy === 'REMOTE_IMMEDIATE') {
          return dispatchRemoteUndoLastStep();
        }
        if (capabilities.undoPolicy === 'REMOTE_REQUEST') {
          return dispatchRemoteUndoRequest();
        }
        return { success: false, error: '当前远程对局暂不支持撤销' };
      }

      const result = get().gameSession.undoLastStep();
      if (!result.success) {
        get().addLog(`撤销失败: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }

      get().syncState();
      set((state) => ({
        ui: {
          ...state.ui,
          selectedCardId: null,
          hoveredCardId: null,
          cardDetail: null,
          isDragging: false,
          highlightedZones: [],
          dragActionHint: null,
          battleAnimationOcclusions: [],
        },
      }));
      get().addLog('撤销上一步', 'action');
      return { success: true };
    },

    respondRemoteUndoRequest: (requestId, accepted, options) => {
      if (isReadonlyReplayMode()) {
        return rejectReadonlyReplayCommand();
      }
      return dispatchRemoteUndoRequestResponse(requestId, accepted, options);
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

    playMemberToSlot: (cardId, slot, options) => {
      return runViewerCommand(
        (playerId) =>
          createPlayMemberToSlotCommand(playerId, cardId, slot, {
            freePlay: get().freePlayEnabled,
            relayMode: options?.relayMode,
            relayReplacementSlots: options?.relayReplacementSlots,
          }),
        {
          failureMessage: '成员登场失败',
          successMessage: `成员登场到 ${slot}`,
          deselectCard: true,
          logError: true,
        }
      );
    },

    activateCardAbility: (cardId, abilityId) => {
      return runViewerCommand(
        (playerId) => createActivateAbilityCommand(playerId, cardId, abilityId),
        {
          failureMessage: '起动效果发动失败',
          successMessage: '发动起动效果',
          clearHoveredCardId: cardId,
          deselectCard: true,
          logError: true,
        }
      );
    },

    movePublicCardToWaitingRoom: (cardId, fromZone, sourceSlot) => {
      return runViewerCommand(
        (playerId) =>
          createMovePublicCardToWaitingRoomCommand(playerId, cardId, fromZone, sourceSlot),
        {
          failureMessage: '公开区卡牌移动失败',
          clearHoveredCardId: cardId,
          deselectCard: true,
        }
      );
    },

    movePublicCardToHand: (cardId, fromZone, sourceSlot) => {
      return runViewerCommand(
        (playerId) => createMovePublicCardToHandCommand(playerId, cardId, fromZone, sourceSlot),
        {
          failureMessage: '公开区卡牌回手失败',
          clearHoveredCardId: cardId,
          deselectCard: true,
        }
      );
    },

    movePublicCardToEnergyDeck: (cardId, fromZone) => {
      return runViewerCommand(
        (playerId) => createMovePublicCardToEnergyDeckCommand(playerId, cardId, fromZone),
        {
          failureMessage: '公开能量回到能量卡组失败',
          clearHoveredCardId: cardId,
          deselectCard: true,
        }
      );
    },

    moveOwnedCardToZone: (cardId, fromZone, toZone, options) => {
      return runViewerCommand(
        (playerId) => createMoveOwnedCardToZoneCommand(playerId, cardId, fromZone, toZone, options),
        {
          failureMessage: '己方卡牌移动失败',
          clearHoveredCardId: cardId,
          deselectCard: true,
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

    confirmEffectStep: (
      effectId,
      selectedCardId,
      selectedSlot,
      resolveInOrder,
      selectedOptionId,
      selectedCardIds,
      selectedNumber,
      stageFormationMoveHistory,
      stageFormationPlacements
    ) => {
      return runViewerCommand(
        (playerId) =>
          createConfirmEffectStepCommand(
            playerId,
            effectId,
            selectedCardId,
            selectedSlot,
            resolveInOrder,
            selectedOptionId,
            selectedCardIds,
            selectedNumber,
            stageFormationMoveHistory,
            stageFormationPlacements
          ),
        {
          failureMessage: '卡牌效果处理失败',
          successMessage: '继续处理卡牌效果',
          deselectCard: true,
          logError: true,
        }
      );
    },

    confirmCostPayment: (paymentId, energyCardIds) => {
      return runViewerCommand(
        (playerId) => createConfirmCostPaymentCommand(playerId, paymentId, energyCardIds),
        {
          failureMessage: '费用支付失败',
          successMessage: '支付费用',
          logError: true,
        }
      );
    },

    mulligan: (cardIdsToMulligan) => {
      if (isReadonlyReplayMode()) {
        return rejectReadonlyReplayCommand();
      }

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
      if (isReadonlyReplayMode()) {
        return;
      }
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
        ui: {
          ...state.ui,
          hoveredCardId: cardId,
          cardDetail: cardId
            ? { kind: 'visible', cardId }
            : state.ui.cardDetail?.kind === 'visible'
              ? null
              : state.ui.cardDetail,
        },
      }));
    },

    setCardDetail: (detail) => {
      set((state) => ({
        ui: {
          ...state.ui,
          hoveredCardId: detail?.kind === 'visible' ? detail.cardId : null,
          cardDetail: detail,
        },
      }));
    },

    setPublicBattleLogPanelOpen: (open) => {
      set((state) => {
        const lastReadSeq = open
          ? Math.max(state.publicBattleLog.lastReadSeq, state.publicBattleLog.currentPublicSeq)
          : state.publicBattleLog.lastReadSeq;
        return {
          publicBattleLog: {
            ...state.publicBattleLog,
            isPanelOpen: open,
            lastReadSeq,
            unreadCount: countUnreadPublicEvents(state.publicBattleLog.events, lastReadSeq),
          },
        };
      });
      if (open) {
        void get().syncPublicBattleLog();
      }
    },

    syncPublicBattleLog: async () => {
      const remoteSession = get().remoteSession;
      if (!remoteSession || get().replaySession) {
        return;
      }

      const afterSeq =
        get().publicBattleLog.matchId === remoteSession.matchId
          ? get().publicBattleLog.cursorSeq
          : 0;
      set((state) => ({
        publicBattleLog: {
          ...(state.publicBattleLog.matchId === remoteSession.matchId
            ? state.publicBattleLog
            : { ...EMPTY_PUBLIC_BATTLE_LOG, matchId: remoteSession.matchId }),
          loadState: 'loading',
          error: null,
        },
      }));

      try {
        const response = await fetchRemotePublicEvents(
          remoteSession.source,
          remoteSession.matchId,
          remoteSession.seat,
          afterSeq
        );
        if (!response || !isRemoteSessionStillCurrent(remoteSession)) {
          return;
        }
        set((state) => ({
          publicBattleLog: mergePublicBattleLogResponse(state.publicBattleLog, response),
        }));
      } catch (error) {
        if (!isRemoteSessionStillCurrent(remoteSession)) {
          return;
        }
        set((state) => ({
          publicBattleLog: {
            ...state.publicBattleLog,
            loadState: 'error',
            error: error instanceof Error ? error.message : '公开日志拉取失败',
          },
        }));
      }
    },

    setDragHints: (isDragging, highlightedZones) => {
      set((state) => ({
        ui: {
          ...state.ui,
          isDragging,
          highlightedZones: highlightedZones ?? (isDragging ? state.ui.highlightedZones : []),
          dragActionHint: isDragging ? state.ui.dragActionHint : null,
        },
      }));
    },

    setBattleDragActionHint: (hint) => {
      set((state) => ({
        ui: {
          ...state.ui,
          dragActionHint: hint,
        },
      }));
    },

    pushBattleFeedback: (feedback) => {
      const event = createBattleFeedbackEvent(feedback);
      const now = Date.now();
      set((state) => ({
        ui: {
          ...state.ui,
          battleFeedbackEvents: [
            ...state.ui.battleFeedbackEvents
              .filter((current) => !isBattleFeedbackEventExpired(current, now))
              .slice(-5),
            event,
          ],
        },
      }));
      return event.id;
    },

    dismissBattleFeedback: (feedbackId) => {
      set((state) => ({
        ui: {
          ...state.ui,
          battleFeedbackEvents: state.ui.battleFeedbackEvents.filter(
            (event) => event.id !== feedbackId
          ),
        },
      }));
    },

    addBattleAnimationOcclusions: (occlusions) => {
      if (occlusions.length === 0) {
        return;
      }

      set((state) => {
        const existingEventIds = new Set(
          state.ui.battleAnimationOcclusions.map((occlusion) => occlusion.eventId)
        );
        const nextOcclusions = occlusions.filter(
          (occlusion) => !existingEventIds.has(occlusion.eventId)
        );
        if (nextOcclusions.length === 0) {
          return state;
        }

        return {
          ui: {
            ...state.ui,
            battleAnimationOcclusions: [
              ...state.ui.battleAnimationOcclusions.slice(-16),
              ...nextOcclusions,
            ],
          },
        };
      });
    },

    removeBattleAnimationOcclusion: (eventId) => {
      set((state) => ({
        ui: {
          ...state.ui,
          battleAnimationOcclusions: state.ui.battleAnimationOcclusions.filter(
            (occlusion) => occlusion.eventId !== eventId
          ),
        },
      }));
    },

    setGameMode: (mode) => {
      if (isReadonlyReplayMode()) {
        return;
      }
      if (get().remoteSession) {
        return;
      }

      const { gameSession, freePlayEnabled } = get();
      // 同步更新 store 和 session 的模式
      gameSession.gameMode = mode;
      gameSession.localFreePlay = freePlayEnabled;
      set({ gameMode: mode, freePlayEnabled });
      get().addLog(`切换游戏模式: ${mode === GameMode.SOLITAIRE ? '对墙打' : '调试'}`, 'info');
      // 同步状态以反映模式变更
      get().syncState();
    },

    setFreePlayEnabled: (enabled) => {
      if (isReadonlyReplayMode()) {
        return;
      }
      const { gameSession } = get();
      if (!get().remoteSession) {
        gameSession.localFreePlay = enabled;
      }
      set({ freePlayEnabled: enabled });
      get().addLog(enabled ? '免费登场已开启' : '免费登场已关闭', 'info');
    },

    enterReadonlyReplay: async (replay, options) => {
      const viewerPlayerId = getReadonlyReplayViewerPlayerId(replay);
      const normalizedPlayerViewState = normalizeReadonlyReplayViewState(replay.playerViewState);

      await preloadFrontTransitions(
        get().playerViewState,
        normalizedPlayerViewState,
        get().cardDataRegistry
      );

      // 卡图预加载是异步的，快速切换 checkpoint 时较早的请求可能在较新请求之后完成。
      // 若调用方判定本次注入已过期，则放弃提交，避免旧 checkpoint 覆盖当前桌面视图。
      if (options?.shouldCommit && !options.shouldCommit()) {
        return;
      }

      get().gameSession.localFreePlay = false;
      set((state) => ({
        playerViewState: normalizedPlayerViewState,
        viewingPlayerId: viewerPlayerId,
        remoteSession: null,
        replaySession: {
          matchId: replay.matchId,
          sourceMatchMode: replay.sourceMatchMode,
          viewerSeat: replay.viewerSeat,
          viewerPlayerId,
          checkpointSeq: replay.replayPosition.checkpointSeq,
          timelineSeq: replay.replayPosition.timelineSeq,
          recordStatus: replay.recordStatus,
          recordCompleteness: replay.recordCompleteness,
          partialReasonSummary: replay.partialReasonSummary,
        },
        gameMode: GameMode.DEBUG,
        freePlayEnabled: false,
        publicBattleLog: EMPTY_PUBLIC_BATTLE_LOG,
        ui: {
          ...state.ui,
          selectedCardId: null,
          hoveredCardId: null,
          cardDetail: null,
          isDragging: false,
          highlightedZones: [],
          dragActionHint: null,
          battleFeedbackEvents: [],
          battleAnimationOcclusions: [],
          waitingForInput: false,
          inputRequestType: null,
        },
      }));
    },

    leaveReadonlyReplay: () => {
      set((state) => ({
        playerViewState: null,
        viewingPlayerId: null,
        replaySession: null,
        freePlayEnabled: false,
        publicBattleLog: EMPTY_PUBLIC_BATTLE_LOG,
        ui: {
          ...state.ui,
          selectedCardId: null,
          hoveredCardId: null,
          cardDetail: null,
          isDragging: false,
          highlightedZones: [],
          dragActionHint: null,
          battleFeedbackEvents: [],
          battleAnimationOcclusions: [],
          waitingForInput: false,
          inputRequestType: null,
        },
      }));
      get().gameSession.localFreePlay = false;
    },

    isReadonlyReplayMode: () => isReadonlyReplayMode(),

    connectRemoteSession: (session) => {
      get().gameSession.localFreePlay = false;
      set({
        remoteSession: session,
        replaySession: null,
        playerViewState: null,
        viewingPlayerId: session.playerId,
        gameMode: GameMode.DEBUG,
        freePlayEnabled: false,
        publicBattleLog: { ...EMPTY_PUBLIC_BATTLE_LOG, matchId: session.matchId },
      });
      void get().syncPublicBattleLog();
    },

    applyRemoteSnapshot: async (snapshot) => {
      if (isReadonlyReplayMode()) {
        return;
      }
      applyRemoteSnapshotThenPreload(snapshot, set, 'store.applyRemoteSnapshot');
    },

    disconnectRemoteSession: () => {
      set({
        remoteSession: null,
        replaySession: null,
        playerViewState: null,
        viewingPlayerId: null,
        publicBattleLog: EMPTY_PUBLIC_BATTLE_LOG,
      });
    },

    syncRemoteState: async () => {
      if (isReadonlyReplayMode()) {
        return;
      }
      const remoteSession = get().remoteSession;
      if (!remoteSession) {
        return;
      }

      const snapshot = await fetchRemoteSnapshot(
        remoteSession.source,
        remoteSession.matchId,
        remoteSession.seat,
        get().playerViewState?.match.seq
      );
      if (!snapshot) {
        await get().syncPublicBattleLog();
        return;
      }

      applyRemoteSnapshotThenPreload(snapshot, set, 'syncRemoteState');
    },

    isRemoteMode: () => get().remoteSession !== null,

    getBattleSurfaceCapabilities: () =>
      deriveBattleSurfaceCapabilities({
        gameMode: get().gameMode,
        remoteSessionSource: get().remoteSession?.source ?? null,
        replaySessionActive: get().replaySession !== null,
        replaySourceMatchMode: get().replaySession?.sourceMatchMode ?? null,
      }),

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
      if (isReadonlyReplayMode()) {
        return;
      }
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
            cardDetail: state.ui.cardDetail?.kind === 'visible' ? null : state.ui.cardDetail,
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
          cardDetail: resolveSelectedCardDetail(state.ui.cardDetail, normalizedPlayerViewState),
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
      if (isReadonlyReplayMode()) {
        return null;
      }
      const permissionView = get().playerViewState?.permissions;
      if (!permissionView) {
        return null;
      }

      const availableCommands = permissionView.availableCommands ?? [];
      return availableCommands.find((hint) => hint.command === command) ?? null;
    },

    canUseAction: (actionType) => {
      if (isReadonlyReplayMode()) {
        return false;
      }
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
        ...(frontInfo.modifierDelta ? { modifierDelta: frontInfo.modifierDelta } : {}),
      };
    },

    getPublicEventCardPresentation: (cardCode, publicObjectId) => {
      const cardData = get().getCardData(cardCode);
      const instanceId = publicObjectId
        ? getCardIdFromPublicObjectId(publicObjectId)
        : `public:${cardCode}`;
      if (cardData) {
        return {
          instanceId,
          cardCode,
          cardData,
          imagePath: get().getCardImagePath(cardCode),
        };
      }

      return {
        instanceId,
        cardCode,
        cardData: buildMissingPublicEventCardData(cardCode),
        imagePath: get().getCardImagePath(cardCode),
        eventOnlyMissingData: true,
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

    getSeatMemberBelowCardIds: (seat, slot) => {
      const zone = get().getSeatZone(seat, `MEMBER_${slot}`);
      const belowIds = zone?.memberBelow?.[slot] ?? EMPTY_PUBLIC_OBJECT_IDS;
      if (belowIds.length === 0) {
        return EMPTY_CARD_IDS as string[];
      }
      return belowIds.map(getCardIdFromPublicObjectId);
    },

    findViewerCardZone: (cardId) => {
      return findCardLocationInView(get().playerViewState, cardId)?.zoneType ?? null;
    },

    resolveCardDropTarget: (targetCardId) => {
      return findCardLocationInView(get().playerViewState, targetCardId);
    },

    getCardSlotPosition: (cardId) => {
      const location = findCardLocationInView(get().playerViewState, cardId);
      return location?.zoneType === ZoneType.MEMBER_SLOT ? (location.slotPosition ?? null) : null;
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
      return viewerSeat ? (get().playerViewState?.match.liveResult?.scores[viewerSeat] ?? 0) : 0;
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
        ? (get().playerViewState?.match.liveResult?.winnerSeats.includes(viewerSeat) ?? false)
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
        ? (get().playerViewState?.match.liveResult?.confirmedSeats.includes(viewerSeat) ?? false)
        : false;
    },

    isOpponentScoreConfirmed: () => {
      const viewerSeat = get().getViewerSeat();
      if (!viewerSeat) {
        return false;
      }
      const opponentSeat: Seat = viewerSeat === 'FIRST' ? 'SECOND' : 'FIRST';
      return (
        get().playerViewState?.match.liveResult?.confirmedSeats.includes(opponentSeat) ?? false
      );
    },

    // ============ 阶段十新增动作实现 ============

    confirmSubPhase: (subPhase) => {
      return runViewerCommand((playerId) => createConfirmStepCommand(playerId, subPhase), {
        failureMessage: '确认子阶段失败',
        successMessage: `确认子阶段完成: ${subPhase}`,
        logError: true,
      });
    },

    acceptAutomaticJudgment: () => {
      if (isReadonlyReplayMode()) {
        return rejectReadonlyReplayCommand();
      }

      const viewingPlayerId = get().viewingPlayerId;
      if (!viewingPlayerId) {
        return { success: false, error: '未设置玩家' };
      }

      const entries = [
        {
          command: createSubmitJudgmentCommand(viewingPlayerId, new Map()),
          options: {
            failureMessage: '确认判定失败',
            successMessage: '确认 Live 判定结果',
            logError: true,
          },
        },
        {
          command: createConfirmStepCommand(viewingPlayerId, SubPhase.PERFORMANCE_JUDGMENT),
          options: {
            failureMessage: '确认子阶段失败',
            successMessage: `确认子阶段完成: ${SubPhase.PERFORMANCE_JUDGMENT}`,
            logError: true,
          },
        },
      ] as const;

      if (runRemoteCommandSequence(entries)) {
        return { success: false, pending: true };
      }

      for (const entry of entries) {
        const result = get().gameSession.executeCommand(entry.command);
        if (!result.success) {
          if (entry.options.logError) {
            get().addLog(`${entry.options.failureMessage}: ${result.error}`, 'error');
          }
          return { success: false, error: result.error };
        }

        get().syncState();
        applyCommandSuccessEffects(entry.options);
      }

      return { success: true };
    },

    confirmJudgment: (judgmentResults) => {
      return runViewerCommand(
        (playerId) => createSubmitJudgmentCommand(playerId, judgmentResults),
        {
          failureMessage: '确认判定失败',
          successMessage: '确认 Live 判定结果',
          logError: true,
        }
      );
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

    skipSuccessLiveSelection: () => {
      return runViewerCommand(
        (playerId) =>
          createConfirmStepCommand(playerId, SubPhase.RESULT_SETTLEMENT, {
            skipSuccessLiveSelection: true,
          }),
        {
          failureMessage: '跳过成功 Live 选择失败',
          successMessage: '全部放置入休息室',
          logError: true,
        }
      );
    },

    moveTableCard: (cardId, fromZone, toZone, options) => {
      return runViewerCommand(
        (playerId) => createMoveTableCardCommand(playerId, cardId, fromZone, toZone, options),
        {
          failureMessage: '移动卡牌失败',
          clearHoveredCardId: cardId,
          deselectCard: true,
        }
      );
    },

    moveMemberToSlot: (cardId, sourceSlot, targetSlot) => {
      return runViewerCommand(
        (playerId) => createMoveMemberToSlotCommand(playerId, cardId, sourceSlot, targetSlot),
        {
          failureMessage: '成员换位失败',
          clearHoveredCardId: cardId,
          deselectCard: true,
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
          deselectCard: true,
        }
      );
    },

    openInspection: (sourceZone, count = 1) => {
      return runViewerCommand(
        (playerId) => createOpenInspectionCommand(playerId, sourceZone, count),
        {
          failureMessage: '开始检视失败',
          successMessage: `开始检视: ${sourceZone} 顶 ${count} 张`,
          logError: true,
        }
      );
    },

    moveInspectedCardToTop: (cardId) => {
      return runViewerCommand((playerId) => createMoveInspectedCardToTopCommand(playerId, cardId), {
        failureMessage: '检视牌放回顶部失败',
        successMessage: '检视牌放回顶部',
        clearHoveredCardId: cardId,
        deselectCard: true,
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
      return runViewerCommand(
        (playerId) => createMoveInspectedCardToBottomCommand(playerId, cardId),
        {
          failureMessage: '检视牌放回底部失败',
          successMessage: '检视牌放回底部',
          clearHoveredCardId: cardId,
          deselectCard: true,
          logError: true,
        }
      );
    },

    moveInspectedCardToZone: (cardId, toZone) => {
      return runViewerCommand(
        (playerId) => createMoveInspectedCardToZoneCommand(playerId, cardId, toZone),
        {
          failureMessage: '检视牌移动失败',
          successMessage: `检视牌移动到 ${toZone}`,
          clearHoveredCardId: cardId,
          deselectCard: true,
          logError: true,
        }
      );
    },

    moveCardToInspection: (cardId, fromZone) => {
      return runViewerCommand(
        (playerId) => createMoveCardToInspectionCommand(playerId, cardId, fromZone),
        {
          failureMessage: '卡牌移入检视区失败',
          successMessage: '卡牌移入检视区',
          clearHoveredCardId: cardId,
          deselectCard: true,
          logError: true,
        }
      );
    },

    reorderInspectedCard: (cardId, toIndex) => {
      return runViewerCommand(
        (playerId) => createReorderInspectedCardCommand(playerId, cardId, toIndex),
        {
          failureMessage: '调整检视顺序失败',
          successMessage: `调整检视顺序到位置 ${toIndex + 1}`,
          logError: true,
        }
      );
    },

    finishInspectionWithArrangement: (cardIds, toZone, options) => {
      return runViewerCommand(
        (playerId) =>
          createFinishInspectionWithArrangementCommand(
            playerId,
            cardIds,
            toZone,
            options?.position
          ),
        {
          failureMessage: '检视区批量整理失败',
          successMessage: '检视区批量整理完成',
          logError: true,
        }
      );
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
          deselectCard: true,
          logError: true,
        }
      );
    },

    confirmPerformanceOutcome: (success) => {
      return runViewerCommand(
        (playerId) => createConfirmPerformanceOutcomeCommand(playerId, success),
        {
          failureMessage: '提交 Live 判定结果失败',
          successMessage: success ? '确认 Live 成功' : '确认 Live 失败',
          logError: true,
        }
      );
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
function handleGameSessionEvent(event: GameSessionEvent, get: () => GameStore): void {
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
      get().addLog(
        event.winnerId ? `游戏结束，获胜者: ${event.winnerId}` : '游戏结束，平局',
        'info'
      );
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

function resolveSelectedCardDetail(
  detail: SelectedCardDetail | null,
  playerViewState: PlayerViewState | null
): SelectedCardDetail | null {
  if (!detail || detail.kind === 'public-event-card') {
    return detail;
  }

  return resolveHoveredCardId(detail.cardId, playerViewState)
    ? detail
    : null;
}

function buildFallbackCardData(frontInfo: ViewFrontCardInfo): AnyCardData {
  const name = frontInfo.nameCn?.trim() || frontInfo.nameJp?.trim() || frontInfo.cardCode;
  const cardText = frontInfo.cardTextCn?.trim() || frontInfo.cardTextJp?.trim() || undefined;

  switch (frontInfo.cardType) {
    case CardType.MEMBER:
      return {
        cardCode: frontInfo.cardCode,
        name,
        nameJp: frontInfo.nameJp,
        nameCn: frontInfo.nameCn,
        cardType: CardType.MEMBER,
        cost: frontInfo.cost ?? 0,
        blade: 0,
        hearts: Array.isArray(frontInfo.hearts)
          ? (frontInfo.hearts as MemberCardData['hearts'])
          : [],
        bladeHearts: frontInfo.bladeHearts as MemberCardData['bladeHearts'],
        cardText,
        cardTextJp: frontInfo.cardTextJp,
        cardTextCn: frontInfo.cardTextCn,
      };

    case CardType.LIVE:
      return {
        cardCode: frontInfo.cardCode,
        name,
        nameJp: frontInfo.nameJp,
        nameCn: frontInfo.nameCn,
        cardType: CardType.LIVE,
        score: frontInfo.score ?? 0,
        requirements: buildFallbackHeartRequirement(frontInfo.requiredHearts),
        bladeHearts: frontInfo.bladeHearts as LiveCardData['bladeHearts'],
        cardText,
        cardTextJp: frontInfo.cardTextJp,
        cardTextCn: frontInfo.cardTextCn,
      };

    case CardType.ENERGY:
    default:
      return {
        cardCode: frontInfo.cardCode,
        name,
        nameJp: frontInfo.nameJp,
        nameCn: frontInfo.nameCn,
        cardType: CardType.ENERGY,
        cardText,
        cardTextJp: frontInfo.cardTextJp,
        cardTextCn: frontInfo.cardTextCn,
      };
  }
}

function buildMissingPublicEventCardData(cardCode: string): AnyCardData {
  return {
    cardCode,
    name: '未收录卡牌',
    nameCn: '未收录卡牌',
    cardType: CardType.MEMBER,
    cost: 0,
    blade: 0,
    hearts: [],
    bladeHearts: [],
  };
}

function buildFallbackHeartRequirement(
  requirement?: ViewHeartRequirement
): LiveCardData['requirements'] {
  if (!requirement) {
    return createHeartRequirement({}, 0);
  }

  const colorRequirements: Record<string, number> = {};
  for (const [color, count] of Object.entries(requirement.colorRequirements)) {
    if (typeof count === 'number' && count > 0) {
      colorRequirements[color] = count;
    }
  }

  return createHeartRequirement(colorRequirements, requirement.totalRequired);
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

    for (const [slot, memberBelowIds] of Object.entries(zone.memberBelow ?? {})) {
      if ((memberBelowIds as readonly string[]).includes(publicObjectId)) {
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
): boolean {
  const normalizedSnapshotViewState = normalizePlayerViewState(snapshot.playerViewState);
  let applied = false;
  set((state) => {
    if (
      normalizedSnapshotViewState !== null &&
      shouldIgnoreRemoteSnapshotBySeq({
        currentMatchId: state.playerViewState?.match.matchId,
        currentPlayerId: state.viewingPlayerId,
        currentSeat: state.playerViewState?.match.viewerSeat,
        currentSeq: state.playerViewState?.match.seq,
        remoteMatchId: state.remoteSession?.matchId,
        remotePlayerId: state.remoteSession?.playerId,
        remoteSeat: state.remoteSession?.seat,
        snapshotMatchId: snapshot.matchId,
        snapshotPlayerId: snapshot.playerId,
        snapshotSeat: snapshot.seat,
        snapshotSeq: normalizedSnapshotViewState.match.seq,
      })
    ) {
      return state;
    }

    applied = true;
    const normalizedPlayerViewState = stabilizePlayerViewState(
      state.playerViewState,
      normalizedSnapshotViewState
    );
    return {
      remoteSession: state.remoteSession
        ? state.remoteSession.playerId === snapshot.playerId &&
          state.remoteSession.seat === snapshot.seat
          ? state.remoteSession
          : {
              ...state.remoteSession,
              playerId: snapshot.playerId,
              seat: snapshot.seat,
            }
        : state.remoteSession,
      viewingPlayerId: snapshot.playerId,
      playerViewState: normalizedPlayerViewState,
      ui: {
        ...state.ui,
        hoveredCardId: resolveHoveredCardId(state.ui.hoveredCardId, normalizedPlayerViewState),
        cardDetail: resolveSelectedCardDetail(state.ui.cardDetail, normalizedPlayerViewState),
      },
    };
  });
  return applied;
}

function applyRemoteSnapshotThenPreload(
  snapshot: RemoteSnapshot,
  set: (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void,
  context: string
): void {
  const previousViewState = useGameStore.getState().playerViewState;
  const nextViewState = snapshot.playerViewState;
  const cardDataRegistry = useGameStore.getState().cardDataRegistry;
  const latencyProbe = createRemoteSnapshotLatencyProbe(context, snapshot);

  markRemoteSnapshotLatencyProbe(latencyProbe, 'applyStartAt');
  const applied = applyRemoteSnapshot(snapshot, set);
  markRemoteSnapshotLatencyProbe(latencyProbe, 'applyEndAt');
  scheduleRemoteSnapshotPaintProbe(latencyProbe);

  if (!applied) {
    markRemoteSnapshotLatencyProbe(latencyProbe, 'preloadStartAt');
    markRemoteSnapshotLatencyProbe(latencyProbe, 'preloadEndAt');
    maybeReportRemoteSnapshotLatencyProbe(latencyProbe);
    return;
  }

  scheduleFrontTransitionPreload(previousViewState, nextViewState, cardDataRegistry, latencyProbe);
  mergePublicEventsFromSnapshot(snapshot);
  void useGameStore.getState().syncPublicBattleLog();
}

function mergePublicEventsFromSnapshot(snapshot: RemoteSnapshot): void {
  if (!('publicEvents' in snapshot)) {
    return;
  }

  useGameStore.setState((state) => ({
    publicBattleLog: mergePublicBattleLogResponse(state.publicBattleLog, {
      matchId: snapshot.matchId,
      currentPublicSeq: snapshot.seq,
      publicEvents: snapshot.publicEvents,
    }),
  }));
}

function mergePublicBattleLogResponse(
  previous: PublicBattleLogState,
  response: PublicEventsResponse
): PublicBattleLogState {
  const base =
    previous.matchId === response.matchId
      ? previous
      : { ...EMPTY_PUBLIC_BATTLE_LOG, matchId: response.matchId };
  const retainedEvents = base.events.filter((event) => event.seq <= response.currentPublicSeq);
  const bySeq = new Map<number, PublicEvent>();
  for (const event of retainedEvents) {
    bySeq.set(event.seq, event);
  }
  for (const event of response.publicEvents) {
    if (event.seq <= response.currentPublicSeq) {
      bySeq.set(event.seq, event);
    }
  }
  const events = [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  const cursorSeq = Math.max(response.currentPublicSeq, events.at(-1)?.seq ?? 0);
  const lastReadSeq = base.isPanelOpen
    ? Math.max(base.lastReadSeq, cursorSeq)
    : Math.min(base.lastReadSeq, cursorSeq);

  return {
    ...base,
    events,
    cursorSeq,
    currentPublicSeq: response.currentPublicSeq,
    lastReadSeq,
    unreadCount: base.isPanelOpen ? 0 : countUnreadPublicEvents(events, lastReadSeq),
    loadState: 'idle',
    error: null,
  };
}

function countUnreadPublicEvents(events: readonly PublicEvent[], lastReadSeq: number): number {
  return events.filter((event) => event.seq > lastReadSeq).length;
}

// 通用的卡图预加载:对比前后两个 PlayerViewState，预取新翻面卡的图片。
// 不含任何远程会话特有逻辑，远程同步、历史回放等路径均可复用。
async function preloadFrontTransitions(
  previousViewState: PlayerViewState | null,
  nextViewState: PlayerViewState | null,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): Promise<void> {
  if (!previousViewState || !nextViewState) {
    return;
  }

  const imageUrls = collectFrontTransitionImageUrls(
    previousViewState,
    nextViewState,
    cardDataRegistry
  );
  await preloadImagesWithinBudget(imageUrls);
}

function scheduleFrontTransitionPreload(
  previousViewState: PlayerViewState | null,
  nextViewState: PlayerViewState | null,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>,
  latencyProbe: RemoteSnapshotLatencyProbe | null
): void {
  markRemoteSnapshotLatencyProbe(latencyProbe, 'preloadStartAt');
  void preloadFrontTransitions(previousViewState, nextViewState, cardDataRegistry)
    .catch((error) => {
      console.warn(
        `[gameStore] 远程 snapshot 卡图后台预载失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    })
    .finally(() => {
      markRemoteSnapshotLatencyProbe(latencyProbe, 'preloadEndAt');
      maybeReportRemoteSnapshotLatencyProbe(latencyProbe);
    });
}

function collectFrontTransitionImageUrls(
  previousViewState: PlayerViewState,
  nextViewState: PlayerViewState,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): string[] {
  const imageUrls = new Set<string>();
  for (const [objectId, nextObject] of Object.entries(nextViewState.objects)) {
    if (nextObject.surface !== 'FRONT' || !nextObject.frontInfo) {
      continue;
    }

    const previousObject = previousViewState.objects[objectId];
    if (
      previousObject?.surface === 'FRONT' &&
      previousObject.frontInfo?.cardCode === nextObject.frontInfo.cardCode
    ) {
      continue;
    }

    const cardData =
      cardDataRegistry.get(nextObject.frontInfo.cardCode) ??
      buildFallbackCardData(nextObject.frontInfo);
    imageUrls.add(resolveCardImagePath(cardData, 'medium'));
  }

  return [...imageUrls];
}

function createRemoteSnapshotLatencyProbe(
  context: string,
  snapshot: RemoteSnapshot
): RemoteSnapshotLatencyProbe | null {
  if (!isRemoteSnapshotLatencyProbeEnabled()) {
    return null;
  }

  return {
    context,
    matchId: snapshot.matchId,
    snapshotSeq: snapshot.seq,
    responseAt: performance.now(),
  };
}

function markRemoteSnapshotLatencyProbe(
  probe: RemoteSnapshotLatencyProbe | null,
  field: 'applyStartAt' | 'applyEndAt' | 'preloadStartAt' | 'preloadEndAt'
): void {
  if (!probe) {
    return;
  }
  probe[field] = performance.now();
}

function scheduleRemoteSnapshotPaintProbe(probe: RemoteSnapshotLatencyProbe | null): void {
  if (!probe) {
    return;
  }

  const recordPaint = () => {
    probe.nextPaintAt = performance.now();
    maybeReportRemoteSnapshotLatencyProbe(probe);
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(recordPaint);
    return;
  }
  setTimeout(recordPaint, 0);
}

function maybeReportRemoteSnapshotLatencyProbe(probe: RemoteSnapshotLatencyProbe | null): void {
  if (
    !probe ||
    probe.reported ||
    probe.nextPaintAt === undefined ||
    probe.preloadEndAt === undefined
  ) {
    return;
  }

  probe.reported = true;
  const applyStartAt = probe.applyStartAt ?? probe.responseAt;
  const applyEndAt = probe.applyEndAt ?? applyStartAt;
  const preloadStartAt = probe.preloadStartAt ?? applyEndAt;
  const preloadEndAt = probe.preloadEndAt ?? preloadStartAt;
  console.table({
    remoteSnapshotLatency: {
      context: probe.context,
      matchId: probe.matchId,
      snapshotSeq: probe.snapshotSeq,
      responseToApplyMs: formatLatencyMs(applyStartAt - probe.responseAt),
      applyMs: formatLatencyMs(applyEndAt - applyStartAt),
      responseToNextPaintMs: formatLatencyMs(probe.nextPaintAt - probe.responseAt),
      preloadMs: formatLatencyMs(preloadEndAt - preloadStartAt),
      preloadFinishedBeforeReport: probe.preloadEndAt !== undefined,
    },
  });
}

function isRemoteSnapshotLatencyProbeEnabled(): boolean {
  const envValue = import.meta.env.VITE_REMOTE_SNAPSHOT_LATENCY_PROBE;
  if (envValue === '1' || envValue === 'true' || envValue === 'on') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const storageValue = window.localStorage.getItem(REMOTE_SNAPSHOT_LATENCY_PROBE_STORAGE_KEY);
    return storageValue === '1' || storageValue === 'true' || storageValue === 'on';
  } catch {
    return false;
  }
}

function formatLatencyMs(value: number): string {
  return value.toFixed(2);
}

async function preloadImagesWithinBudget(imageUrls: string[]): Promise<void> {
  if (imageUrls.length === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve();
    };

    timeoutId = setTimeout(finish, REMOTE_SNAPSHOT_PRELOAD_BUDGET_MS);
    void Promise.all(imageUrls.map((url) => preloadImage(url))).then(finish);
  });
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

function stabilizePlayerViewState(
  previous: PlayerViewState | null,
  next: PlayerViewState | null
): PlayerViewState | null {
  if (!previous || !next || previous.match.matchId !== next.match.matchId) {
    return next;
  }

  const objects = stabilizeRecordValues(previous.objects, next.objects);
  const zones = stabilizeRecordValues(previous.table.zones, next.table.zones);
  const table = zones === previous.table.zones ? previous.table : { ...next.table, zones };
  const match = areJsonLikeValuesEqual(previous.match, next.match) ? previous.match : next.match;
  const permissions = areJsonLikeValuesEqual(previous.permissions, next.permissions)
    ? previous.permissions
    : next.permissions;
  const activeEffect = areJsonLikeValuesEqual(previous.activeEffect, next.activeEffect)
    ? previous.activeEffect
    : next.activeEffect;
  const pendingCostPayment = areJsonLikeValuesEqual(
    previous.pendingCostPayment,
    next.pendingCostPayment
  )
    ? previous.pendingCostPayment
    : next.pendingCostPayment;
  const uiHints = areJsonLikeValuesEqual(previous.uiHints, next.uiHints)
    ? previous.uiHints
    : next.uiHints;

  if (
    objects === previous.objects &&
    table === previous.table &&
    match === previous.match &&
    permissions === previous.permissions &&
    activeEffect === previous.activeEffect &&
    pendingCostPayment === previous.pendingCostPayment &&
    uiHints === previous.uiHints
  ) {
    return previous;
  }

  return {
    ...next,
    match,
    table,
    objects,
    permissions,
    activeEffect,
    pendingCostPayment,
    uiHints,
  };
}

function stabilizeRecordValues<T extends Readonly<Record<string, unknown>>>(
  previous: T,
  next: T
): T {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  let allValuesStable = previousKeys.length === nextKeys.length;
  const stabilized: Record<string, unknown> = {};

  for (const key of nextKeys) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) {
      allValuesStable = false;
      stabilized[key] = next[key];
      continue;
    }

    const previousValue = previous[key];
    const nextValue = next[key];
    if (areJsonLikeValuesEqual(previousValue, nextValue)) {
      stabilized[key] = previousValue;
    } else {
      allValuesStable = false;
      stabilized[key] = nextValue;
    }
  }

  return allValuesStable ? previous : (stabilized as T);
}

function areJsonLikeValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!areJsonLikeValuesEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) {
      return false;
    }
    if (!areJsonLikeValuesEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

function normalizeReadonlyReplayViewState(playerViewState: PlayerViewState): PlayerViewState {
  const normalized = normalizePlayerViewState(playerViewState);
  if (!normalized) {
    throw new Error('历史回放视图状态为空');
  }

  return {
    ...normalized,
    permissions: {
      ...normalized.permissions,
      availableCommands: [],
    },
  };
}

function getReadonlyReplayViewerPlayerId(replay: MatchRecordReplayView): string {
  const viewerSeat = replay.viewerSeat;
  if (viewerSeat !== replay.playerViewState.match.viewerSeat) {
    throw new Error('历史回放视角与投影视角不一致');
  }

  const viewerPlayerId = replay.playerViewState.match.participants[viewerSeat]?.id;
  if (!viewerPlayerId) {
    throw new Error('历史回放缺少当前视角玩家信息');
  }

  return viewerPlayerId;
}

// 只读回放会话下，远程分发安全网被触达意味着上层 isReadonlyReplayMode() 守卫被绕过，
// 属于编程错误。这些守卫返回 true（“已消费、勿回退本地执行”）以阻止回退到本地 gameSession，
// 因为本地执行会篡改只读回放视图；返回 false 反而会触发本地变更。此处显式告警以便未来重构尽早暴露绕过。
function warnReplayGuardBypass(context: string): void {
  console.error(
    `[gameStore] ${context} 在只读回放会话中被触达并已忽略；调用方应先通过 isReadonlyReplayMode() 拦截。`
  );
}

function enqueueRemoteSessionOperation(
  remoteSession: NonNullable<GameStore['remoteSession']>,
  operation: () => Promise<void>
): Promise<void> {
  const queueKey = getRemoteSessionQueueKey(remoteSession);
  const previous = remoteSessionOperationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (!isRemoteSessionStillCurrent(remoteSession)) {
        return;
      }
      await operation();
    })
    .finally(() => {
      if (remoteSessionOperationQueues.get(queueKey) === next) {
        remoteSessionOperationQueues.delete(queueKey);
      }
    });
  remoteSessionOperationQueues.set(queueKey, next);
  return next;
}

function getRemoteSessionQueueKey(remoteSession: NonNullable<GameStore['remoteSession']>): string {
  return `${remoteSession.source}:${remoteSession.matchId}:${remoteSession.seat}:${remoteSession.playerId ?? ''}`;
}

function isRemoteSessionStillCurrent(
  remoteSession: NonNullable<GameStore['remoteSession']>
): boolean {
  const current = useGameStore.getState().remoteSession;
  return (
    current !== null &&
    current.source === remoteSession.source &&
    current.matchId === remoteSession.matchId &&
    current.seat === remoteSession.seat &&
    current.playerId === remoteSession.playerId
  );
}

function ensureRemoteCommandIdempotencyKey(command: GameCommand): GameCommand {
  if (command.idempotencyKey) {
    return command;
  }

  return {
    ...command,
    idempotencyKey: createClientIdempotencyKey('cmd'),
  };
}

function dispatchRemoteCommand(
  command: GameCommand,
  failureMessage: string,
  onSuccess?: () => void
): boolean {
  const store = useGameStore.getState();
  if (store.replaySession) {
    warnReplayGuardBypass('dispatchRemoteCommand');
    return true;
  }
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return false;
  }

  const queuedCommand = ensureRemoteCommandIdempotencyKey(command);
  void enqueueRemoteSessionOperation(remoteSession, async () => {
    const result = await executeRemoteCommand(
      remoteSession.source,
      remoteSession.matchId,
      queuedCommand,
      remoteSession.seat
    );
    if (!isRemoteSessionStillCurrent(remoteSession)) {
      return;
    }
    if (!result.success || !result.snapshot) {
      useGameStore
        .getState()
        .addLog(`${failureMessage}: ${result.error ?? '服务端拒绝了该操作'}`, 'error');
      useGameStore.getState().pushBattleFeedback({
        tone: 'error',
        label: failureMessage,
        detail: result.error ?? '服务端拒绝了该操作',
      });
      return;
    }

    applyRemoteSnapshotThenPreload(result.snapshot, useGameStore.setState, 'remoteCommand');
    onSuccess?.();
  }).catch((error) => {
    useGameStore
      .getState()
      .addLog(
        `${failureMessage}: ${error instanceof Error ? error.message : '网络请求失败'}`,
        'error'
      );
    useGameStore.getState().pushBattleFeedback({
      tone: 'error',
      label: failureMessage,
      detail: error instanceof Error ? error.message : '网络请求失败',
    });
  });

  return true;
}

function dispatchRemoteAdvancePhase(): boolean {
  const store = useGameStore.getState();
  if (store.replaySession) {
    warnReplayGuardBypass('dispatchRemoteAdvancePhase');
    return true;
  }
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return false;
  }

  void enqueueRemoteSessionOperation(remoteSession, async () => {
    const result = await advanceRemotePhase(
      remoteSession.source,
      remoteSession.matchId,
      remoteSession.seat
    );
    if (!isRemoteSessionStillCurrent(remoteSession)) {
      return;
    }
    if (!result.success || !result.snapshot) {
      useGameStore
        .getState()
        .addLog(`阶段推进失败: ${result.error ?? '服务端拒绝了该操作'}`, 'error');
      return;
    }

    applyRemoteSnapshotThenPreload(result.snapshot, useGameStore.setState, 'remoteAdvancePhase');
    const currentPhase = result.snapshot.playerViewState.match.phase as GamePhase | undefined;
    if (currentPhase) {
      const phaseName = getPhaseName(currentPhase);
      useGameStore.getState().addLog(`进入 ${phaseName}`, 'phase');
      useGameStore.getState().showPhaseBannerFn(phaseName);
      setTimeout(() => useGameStore.getState().hidePhaseBanner(), 1500);
    }
  }).catch((error) => {
    useGameStore
      .getState()
      .addLog(`阶段推进失败: ${error instanceof Error ? error.message : '网络请求失败'}`, 'error');
  });

  return true;
}

function dispatchRemoteUndoLastStep(): CommandDispatchResult {
  const store = useGameStore.getState();
  if (store.replaySession) {
    warnReplayGuardBypass('dispatchRemoteUndoLastStep');
    return { success: false, pending: true };
  }
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return { success: false, error: '未连接远程对局' };
  }
  const undoView = store.playerViewState?.match.undo;
  const undoEntry = undoView?.entry;
  if (!undoView?.canUndoNow || !undoEntry) {
    return {
      success: false,
      error: undoView?.disabledReason ?? '没有可撤销的步骤',
    };
  }

  const input = {
    expectedRevision: store.playerViewState?.match.seq ?? 0,
    undoEntryId: undoEntry.undoEntryId,
    idempotencyKey: createClientIdempotencyKey('undo'),
  };
  void enqueueRemoteSessionOperation(remoteSession, async () => {
    const result = await undoRemoteMatch(remoteSession.source, remoteSession.matchId, input);
    if (!isRemoteSessionStillCurrent(remoteSession)) {
      return;
    }
    if (!result.success || !result.snapshot) {
      useGameStore.getState().addLog(`撤销失败: ${result.error ?? '服务端拒绝了该操作'}`, 'error');
      return;
    }

    applyRemoteSnapshotThenPreload(result.snapshot, useGameStore.setState, 'remoteUndo');
    useGameStore.getState().addLog('撤销上一步', 'action');
  }).catch((error) => {
    useGameStore
      .getState()
      .addLog(`撤销失败: ${error instanceof Error ? error.message : '网络请求失败'}`, 'error');
  });

  return { success: false, pending: true };
}

function dispatchRemoteUndoRequest(): CommandDispatchResult {
  const store = useGameStore.getState();
  if (store.replaySession) {
    warnReplayGuardBypass('dispatchRemoteUndoRequest');
    return { success: false, pending: true };
  }
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return { success: false, error: '未连接远程对局' };
  }
  const undoView = store.playerViewState?.match.undo;
  const undoEntry = undoView?.entry;
  if (!undoView?.canUndoNow || !undoEntry) {
    return {
      success: false,
      error: undoView?.disabledReason ?? '没有可请求撤销的步骤',
    };
  }
  if (
    undoView.grant &&
    undoView.grant.requesterSeat === store.playerViewState?.match.viewerSeat &&
    undoView.grant.boundaryKey === undoEntry.boundaryKey
  ) {
    return dispatchRemoteUndoLastStep();
  }

  const input = {
    expectedRevision: store.playerViewState?.match.seq ?? 0,
    undoEntryId: undoEntry.undoEntryId,
    idempotencyKey: createClientIdempotencyKey('undo-request'),
  };
  void enqueueRemoteSessionOperation(remoteSession, async () => {
    const result = await createRemoteUndoRequest(
      remoteSession.source,
      remoteSession.matchId,
      input
    );
    if (!isRemoteSessionStillCurrent(remoteSession)) {
      return;
    }
    if (!result.success || !result.snapshot) {
      useGameStore
        .getState()
        .addLog(`请求撤销失败: ${result.error ?? '服务端拒绝了该操作'}`, 'error');
      return;
    }

    applyRemoteSnapshotThenPreload(result.snapshot, useGameStore.setState, 'remoteUndoRequest');
    useGameStore.getState().addLog('已发送撤销请求', 'action');
  }).catch((error) => {
    useGameStore
      .getState()
      .addLog(`请求撤销失败: ${error instanceof Error ? error.message : '网络请求失败'}`, 'error');
  });

  return { success: false, pending: true };
}

function dispatchRemoteUndoRequestResponse(
  requestId: string,
  accepted: boolean,
  options: RemoteUndoResponseOptions = {}
): CommandDispatchResult {
  const store = useGameStore.getState();
  if (store.replaySession) {
    warnReplayGuardBypass('dispatchRemoteUndoRequestResponse');
    return { success: false, pending: true };
  }
  const remoteSession = store.remoteSession;
  if (!remoteSession) {
    return { success: false, error: '未连接远程对局' };
  }

  const input = {
    expectedRevision: store.playerViewState?.match.seq ?? 0,
    idempotencyKey: createClientIdempotencyKey(accepted ? 'undo-accept' : 'undo-reject'),
    ...(accepted && options.grantContinuous ? { grantContinuous: true } : {}),
  };
  void enqueueRemoteSessionOperation(remoteSession, async () => {
    const result = accepted
      ? await acceptRemoteUndoRequest(remoteSession.source, remoteSession.matchId, requestId, input)
      : await rejectRemoteUndoRequest(
          remoteSession.source,
          remoteSession.matchId,
          requestId,
          input
        );
    if (!isRemoteSessionStillCurrent(remoteSession)) {
      return;
    }
    if (!result.success || !result.snapshot) {
      useGameStore
        .getState()
        .addLog(
          `${accepted ? '接受' : '拒绝'}撤销失败: ${result.error ?? '服务端拒绝了该操作'}`,
          'error'
        );
      return;
    }

    applyRemoteSnapshotThenPreload(
      result.snapshot,
      useGameStore.setState,
      accepted ? 'remoteUndoAccept' : 'remoteUndoReject'
    );
    useGameStore.getState().addLog(accepted ? '已接受撤销请求' : '已拒绝撤销请求', 'action');
  }).catch((error) => {
    useGameStore
      .getState()
      .addLog(
        `${accepted ? '接受' : '拒绝'}撤销失败: ${
          error instanceof Error ? error.message : '网络请求失败'
        }`,
        'error'
      );
  });

  return { success: false, pending: true };
}

function createClientIdempotencyKey(prefix: string): string {
  const random =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}
